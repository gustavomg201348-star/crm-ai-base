import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  DeleteStoredTemplateMediaResult,
  R2StorageConfig,
  ReadTemplateMediaInput,
  ReadTemplateMediaResult,
  StoredTemplateMedia,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
  TemplateHeaderMediaExtension,
  TemplateHeaderMediaMimeType,
  TemplateMediaS3Client,
  TemplateMediaStorageOptions,
  TemplateMediaStorageError
} from "@/lib/template-media-storage-types";
import {
  assertTemplateStorageKey,
  readFileNameFromStorageKey
} from "@/lib/template-media-storage-key";
import {
  normalizePublicBaseUrl,
  s3BodyToBuffer,
  toPublicUrl
} from "@/lib/template-media-storage-utils";
import { withStorageLocation } from "@/lib/template-media-storage-validation";

const TEMPLATE_MEDIA_R2_DEFAULT_TIMEOUT_MS = 15_000;
const TEMPLATE_MEDIA_R2_MIN_TIMEOUT_MS = 1_000;
const TEMPLATE_MEDIA_R2_MAX_TIMEOUT_MS = 120_000;

type R2Operation = "put" | "get" | "delete";
type R2ClientFactory = (config: R2StorageConfig) => TemplateMediaS3Client;

let cachedR2Client:
  | {
      cacheKey: string;
      client: TemplateMediaS3Client;
    }
  | null = null;
let r2ClientFactory: R2ClientFactory = createUncachedR2Client;

function requireR2Value(value: string | undefined, name: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new TemplateMediaStorageError(
      "STORAGE_PROVIDER_NOT_CONFIGURED",
      `Configuracao ${name} ausente para storage R2.`
    );
  }

  return normalized;
}

function readR2TimeoutMs(overrides: Partial<R2StorageConfig> = {}) {
  if (typeof overrides.timeoutMs === "number") {
    return normalizeR2TimeoutMs(overrides.timeoutMs);
  }

  return normalizeR2TimeoutMs(process.env.TEMPLATE_MEDIA_R2_TIMEOUT_MS);
}

function normalizeR2TimeoutMs(value: number | string | undefined) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value.trim())
        : TEMPLATE_MEDIA_R2_DEFAULT_TIMEOUT_MS;

  if (
    !Number.isInteger(parsed) ||
    parsed < TEMPLATE_MEDIA_R2_MIN_TIMEOUT_MS ||
    parsed > TEMPLATE_MEDIA_R2_MAX_TIMEOUT_MS
  ) {
    return TEMPLATE_MEDIA_R2_DEFAULT_TIMEOUT_MS;
  }

  return parsed;
}

function readR2Config(overrides: Partial<R2StorageConfig> = {}): R2StorageConfig {
  return {
    bucket: requireR2Value(
      overrides.bucket ?? process.env.TEMPLATE_MEDIA_BUCKET,
      "TEMPLATE_MEDIA_BUCKET"
    ),
    endpoint: requireR2Value(
      overrides.endpoint ?? process.env.TEMPLATE_MEDIA_ENDPOINT,
      "TEMPLATE_MEDIA_ENDPOINT"
    ),
    region: overrides.region ?? process.env.TEMPLATE_MEDIA_REGION?.trim() ?? "auto",
    accessKeyId: requireR2Value(
      overrides.accessKeyId ?? process.env.TEMPLATE_MEDIA_ACCESS_KEY_ID,
      "TEMPLATE_MEDIA_ACCESS_KEY_ID"
    ),
    secretAccessKey: requireR2Value(
      overrides.secretAccessKey ?? process.env.TEMPLATE_MEDIA_SECRET_ACCESS_KEY,
      "TEMPLATE_MEDIA_SECRET_ACCESS_KEY"
    ),
    publicBaseUrl:
      overrides.publicBaseUrl ??
      normalizePublicBaseUrl(process.env.TEMPLATE_MEDIA_PUBLIC_BASE_URL),
    timeoutMs: readR2TimeoutMs(overrides)
  };
}

function createR2CacheKey(config: R2StorageConfig) {
  const secretFingerprint = createHash("sha256")
    .update(config.secretAccessKey)
    .digest("hex");

  return [
    config.endpoint,
    config.region,
    config.bucket,
    config.accessKeyId,
    secretFingerprint
  ].join("|");
}

function createUncachedR2Client(config: R2StorageConfig): TemplateMediaS3Client {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    send(command) {
      return client.send(command);
    }
  };
}

function getCachedR2Client(config: R2StorageConfig): TemplateMediaS3Client {
  const cacheKey = createR2CacheKey(config);

  if (cachedR2Client?.cacheKey === cacheKey) {
    return cachedR2Client.client;
  }

  const client = r2ClientFactory(config);
  cachedR2Client = { cacheKey, client };

  return client;
}

export function resetTemplateMediaR2ClientCacheForTests() {
  cachedR2Client = null;
  r2ClientFactory = createUncachedR2Client;
}

export function setTemplateMediaR2ClientFactoryForTests(factory: R2ClientFactory) {
  cachedR2Client = null;
  r2ClientFactory = factory;
}

function isObjectNotFoundError(error: unknown) {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata.httpStatusCode === 404)
  );
}

function readSizeFromHeaders(contentLength: number | undefined, bytes: Buffer) {
  return typeof contentLength === "number" && contentLength >= 0
    ? contentLength
    : bytes.byteLength;
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function sanitizeStorageKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const fileName = parts.at(-1) ?? "";
  const prefix = parts.slice(0, 3).join("/");
  const shortFileName =
    fileName.length > 18
      ? `${fileName.slice(0, 10)}...${fileName.slice(-8)}`
      : fileName;

  return [prefix, shortFileName].filter(Boolean).join("/");
}

function getSafeOriginalErrorName(error: unknown) {
  return error instanceof Error ? error.name : null;
}

function createR2ErrorContext({
  operation,
  config,
  storageKey,
  mimeType,
  sizeBytes,
  error
}: {
  operation: R2Operation;
  config: R2StorageConfig;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  error?: unknown;
}) {
  return {
    operation,
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
    bucket: config.bucket,
    storageKey: sanitizeStorageKey(storageKey),
    mimeType: mimeType ?? null,
    sizeBytes: sizeBytes ?? null,
    timeoutMs: config.timeoutMs,
    originalErrorName: getSafeOriginalErrorName(error)
  };
}

async function sendR2Command({
  client,
  command,
  operation,
  config,
  storageKey,
  mimeType,
  sizeBytes
}: {
  client: TemplateMediaS3Client;
  command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand;
  operation: R2Operation;
  config: R2StorageConfig;
  storageKey: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const controller = new AbortController();
  let timeoutReached = false;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    return await client.send(command, { abortSignal: controller.signal });
  } catch (error) {
    if (timeoutReached || isAbortError(error)) {
      throw new TemplateMediaStorageError(
        "STORAGE_OPERATION_TIMEOUT",
        "Operacao de storage R2 excedeu o tempo limite.",
        error,
        createR2ErrorContext({
          operation,
          config,
          storageKey,
          mimeType,
          sizeBytes,
          error
        })
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveR2TemplateMedia<
  TMimeType extends TemplateHeaderMediaMimeType,
  TExtension extends TemplateHeaderMediaExtension
>({
  storageKey,
  bytes,
  mimeType,
  storedMedia,
  options
}: {
  storageKey: string;
  bytes: Buffer;
  mimeType: TMimeType;
  storedMedia: Omit<
    StoredTemplateMedia<TMimeType, TExtension>,
    "storageProvider" | "storageKey" | "publicUrl"
  >;
  options: Pick<TemplateMediaStorageOptions, "r2Client" | "r2Config">;
}): Promise<StoredTemplateMedia<TMimeType, TExtension>> {
  const safeStorageKey = assertTemplateStorageKey(storageKey);
  const config = readR2Config(options.r2Config);
  const client = options.r2Client ?? getCachedR2Client(config);

  try {
    await sendR2Command({
      client,
      operation: "put",
      config,
      storageKey: safeStorageKey,
      mimeType,
      sizeBytes: bytes.byteLength,
      command: new PutObjectCommand({
          Bucket: config.bucket,
          Key: safeStorageKey,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: mimeType,
          Metadata: {
            checksum: storedMedia.checksum,
            checksumAlgorithm: storedMedia.checksumAlgorithm,
            originalFileName: encodeURIComponent(storedMedia.originalFileName)
          }
      })
    });
  } catch (error) {
    if (error instanceof TemplateMediaStorageError) {
      throw error;
    }

    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_FAILED",
      "Nao foi possivel armazenar a midia do template.",
      error,
      createR2ErrorContext({
        operation: "put",
        config,
        storageKey: safeStorageKey,
        mimeType,
        sizeBytes: bytes.byteLength,
        error
      })
    );
  }

  return withStorageLocation(storedMedia, {
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
    storageKey: safeStorageKey,
    publicUrl: toPublicUrl(config.publicBaseUrl, safeStorageKey)
  });
}

export async function readR2TemplateMedia(
  input: ReadTemplateMediaInput,
  options: Pick<TemplateMediaStorageOptions, "r2Client" | "r2Config"> = {}
): Promise<ReadTemplateMediaResult> {
  const storageKey = assertTemplateStorageKey(input.storageKey?.trim() ?? "");
  const config = readR2Config(options.r2Config);
  const client = options.r2Client ?? getCachedR2Client(config);

  try {
    const response = (await sendR2Command({
      client,
      operation: "get",
      config,
      storageKey,
      mimeType: input.mimeType,
      command: new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey
      })
    })) as { Body?: unknown; ContentType?: string; ContentLength?: number };
    const bytes = await s3BodyToBuffer(response.Body);

    if (bytes.byteLength === 0) {
      throw new TemplateMediaStorageError("STORAGE_EMPTY_FILE", "Arquivo vazio.");
    }

    return {
      bytes,
      mimeType:
        input.mimeType?.trim() ||
        response.ContentType?.trim() ||
        "application/octet-stream",
      fileName: input.fileName?.trim() || readFileNameFromStorageKey(storageKey),
      sizeBytes: readSizeFromHeaders(response.ContentLength, bytes)
    };
  } catch (error) {
    if (error instanceof TemplateMediaStorageError) {
      throw error;
    }

    if (isObjectNotFoundError(error)) {
      throw new TemplateMediaStorageError(
        "STORAGE_FILE_NOT_FOUND",
        "Midia de template nao encontrada."
      );
    }

    throw new TemplateMediaStorageError(
      "STORAGE_READ_FAILED",
      "Nao foi possivel ler a midia do template.",
      error,
      createR2ErrorContext({
        operation: "get",
        config,
        storageKey,
        mimeType: input.mimeType,
        error
      })
    );
  }
}

export async function deleteR2TemplateMedia({
  storageKey,
  options
}: {
  storageKey: string;
  options: Pick<TemplateMediaStorageOptions, "r2Client" | "r2Config">;
}): Promise<DeleteStoredTemplateMediaResult> {
  const config = readR2Config(options.r2Config);
  const client = options.r2Client ?? getCachedR2Client(config);

  try {
    await sendR2Command({
      client,
      operation: "delete",
      config,
      storageKey,
      command: new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: storageKey
      })
    });
  } catch (error) {
    if (error instanceof TemplateMediaStorageError) {
      throw error;
    }

    throw new TemplateMediaStorageError(
      "STORAGE_DELETE_FAILED",
      "Nao foi possivel remover a midia do template.",
      error,
      createR2ErrorContext({
        operation: "delete",
        config,
        storageKey,
        error
      })
    );
  }

  return {
    deleted: true,
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
    storageKey
  };
}
