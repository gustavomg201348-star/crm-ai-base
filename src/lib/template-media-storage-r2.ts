import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";
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
      normalizePublicBaseUrl(process.env.TEMPLATE_MEDIA_PUBLIC_BASE_URL)
  };
}

function createR2Client(config: R2StorageConfig): TemplateMediaS3Client {
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
  const client = options.r2Client ?? createR2Client(config);

  try {
    await client.send(
      new PutObjectCommand({
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
    );
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_FAILED",
      "Nao foi possivel armazenar a midia do template.",
      error
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
  const client = options.r2Client ?? createR2Client(config);

  try {
    const response = (await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: storageKey
      })
    )) as { Body?: unknown; ContentType?: string; ContentLength?: number };
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
      error
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
  const client = options.r2Client ?? createR2Client(config);

  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: storageKey
      })
    );
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_DELETE_FAILED",
      "Nao foi possivel remover a midia do template.",
      error
    );
  }

  return {
    deleted: true,
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
    storageKey
  };
}
