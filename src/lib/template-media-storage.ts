import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException
} from "@aws-sdk/client-s3";

const megabyte = 1024 * 1024;

export const TEMPLATE_IMAGE_MAX_BYTES = 5 * megabyte;
export const TEMPLATE_DOCUMENT_MAX_BYTES = 10 * megabyte;
export const TEMPLATE_VIDEO_MAX_BYTES = 16 * megabyte;
export const TEMPLATE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export const TEMPLATE_DOCUMENT_MIME_TYPES = ["application/pdf"] as const;
export const TEMPLATE_VIDEO_MIME_TYPES = ["video/mp4"] as const;
export const TEMPLATE_HEADER_MEDIA_MIME_TYPES = [
  ...TEMPLATE_IMAGE_MIME_TYPES,
  ...TEMPLATE_DOCUMENT_MIME_TYPES,
  ...TEMPLATE_VIDEO_MIME_TYPES
] as const;
export const TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL = "local";
export const TEMPLATE_MEDIA_STORAGE_PROVIDER_R2 = "r2";
export const TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC = "local-public";
export const TEMPLATE_MEDIA_STORAGE_PREFIX = "templates";
const LEGACY_TEMPLATE_MEDIA_STORAGE_PREFIX = "uploads/templates";
const TEMPLATE_MEDIA_STORAGE_PROVIDERS = [
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_R2
] as const;
const READABLE_TEMPLATE_MEDIA_STORAGE_PROVIDERS = [
  ...TEMPLATE_MEDIA_STORAGE_PROVIDERS,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC
] as const;

export type TemplateMediaStorageProvider =
  (typeof TEMPLATE_MEDIA_STORAGE_PROVIDERS)[number];
export type ReadableTemplateMediaStorageProvider =
  (typeof READABLE_TEMPLATE_MEDIA_STORAGE_PROVIDERS)[number];
export type TemplateImageMimeType = (typeof TEMPLATE_IMAGE_MIME_TYPES)[number];
export type TemplateDocumentMimeType = (typeof TEMPLATE_DOCUMENT_MIME_TYPES)[number];
export type TemplateVideoMimeType = (typeof TEMPLATE_VIDEO_MIME_TYPES)[number];
export type TemplateHeaderMediaMimeType = (typeof TEMPLATE_HEADER_MEDIA_MIME_TYPES)[number];
export type TemplateImageExtension = ".jpg" | ".png";
export type TemplateDocumentExtension = ".pdf";
export type TemplateVideoExtension = ".mp4";
type TemplateHeaderMediaInputExtension = TemplateHeaderMediaExtension | ".jpeg";
export type TemplateHeaderMediaExtension =
  | TemplateImageExtension
  | TemplateDocumentExtension
  | TemplateVideoExtension;
export type TemplateMediaChecksumAlgorithm = "sha256";

export type SaveTemplateHeaderMediaInput = {
  fileName: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
  namespace?: string;
};

export type SaveTemplateImageInput = SaveTemplateHeaderMediaInput;

export type StoredTemplateMedia<
  TMimeType extends TemplateHeaderMediaMimeType = TemplateImageMimeType,
  TExtension extends TemplateHeaderMediaExtension = TemplateImageExtension
> = {
  storageProvider: TemplateMediaStorageProvider;
  storageKey: string;
  publicUrl: string | null;
  checksum: string;
  checksumAlgorithm: TemplateMediaChecksumAlgorithm;
  mimeType: TMimeType;
  sizeBytes: number;
  originalFileName: string;
  storedFileName: string;
  extension: TExtension;
};

export type ReadTemplateMediaInput = {
  storageProvider: string | null | undefined;
  storageKey: string | null | undefined;
  mimeType?: string | null;
  fileName?: string | null;
};

export type ReadTemplateMediaResult = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
};

export type DeleteTemplateMediaInput = {
  storageProvider: string | null | undefined;
  storageKey: string | null | undefined;
};

export type DeleteStoredTemplateMediaResult = {
  deleted: boolean;
  storageProvider: ReadableTemplateMediaStorageProvider;
  storageKey: string;
};

export type TemplateMediaStorageErrorCode =
  | "STORAGE_PROVIDER_NOT_CONFIGURED"
  | "STORAGE_FILE_NOT_FOUND"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_DELETE_FAILED"
  | "STORAGE_INVALID_KEY"
  | "STORAGE_EMPTY_FILE"
  | "INVALID_FILE_NAME"
  | "EMPTY_FILE"
  | "UNSUPPORTED_MIME_TYPE"
  | "INVALID_FILE_SIGNATURE"
  | "FILE_TOO_LARGE"
  | "STORAGE_CONFIGURATION_ERROR"
  | "STORAGE_WRITE_ERROR";

export class TemplateMediaStorageError extends Error {
  readonly code: TemplateMediaStorageErrorCode;
  readonly cause?: unknown;

  constructor(code: TemplateMediaStorageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TemplateMediaStorageError";
    this.code = code;
    this.cause = cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message
    };
  }
}

type TemplateMediaStorageOptions = {
  provider?: string | null;
  publicRootDir?: string;
  publicBaseUrl?: string | null;
  r2Client?: TemplateMediaS3Client;
  r2Config?: Partial<R2StorageConfig>;
};

type TemplateHeaderMediaConfig = {
  extensions: readonly TemplateHeaderMediaInputExtension[];
  maxBytes: number;
  mimeType: TemplateHeaderMediaMimeType;
  signature: readonly number[] | "jpeg" | "mp4" | null;
  tooLargeMessage: string;
  typeLabel: string;
};

type R2StorageConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
};

type TemplateMediaS3Command = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;
type TemplateMediaS3Client = {
  send(command: TemplateMediaS3Command): Promise<unknown>;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

const TEMPLATE_HEADER_MEDIA_CONFIG = {
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    maxBytes: TEMPLATE_IMAGE_MAX_BYTES,
    mimeType: "image/jpeg",
    signature: "jpeg",
    tooLargeMessage: "Imagem acima do limite de 5 MB.",
    typeLabel: "imagem JPEG"
  },
  "image/png": {
    extensions: [".png"],
    maxBytes: TEMPLATE_IMAGE_MAX_BYTES,
    mimeType: "image/png",
    signature: PNG_SIGNATURE,
    tooLargeMessage: "Imagem acima do limite de 5 MB.",
    typeLabel: "imagem PNG"
  },
  "application/pdf": {
    extensions: [".pdf"],
    maxBytes: TEMPLATE_DOCUMENT_MAX_BYTES,
    mimeType: "application/pdf",
    signature: PDF_SIGNATURE,
    tooLargeMessage: "Documento acima do limite de 10 MB.",
    typeLabel: "documento PDF"
  },
  "video/mp4": {
    extensions: [".mp4"],
    maxBytes: TEMPLATE_VIDEO_MAX_BYTES,
    mimeType: "video/mp4",
    signature: "mp4",
    tooLargeMessage: "Video acima do limite de 16 MB.",
    typeLabel: "video MP4"
  }
} satisfies Record<TemplateHeaderMediaMimeType, TemplateHeaderMediaConfig>;

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTemplateImageMimeType(mimeType: string): mimeType is TemplateImageMimeType {
  return (TEMPLATE_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function isTemplateHeaderMediaMimeType(
  mimeType: string
): mimeType is TemplateHeaderMediaMimeType {
  return (TEMPLATE_HEADER_MEDIA_MIME_TYPES as readonly string[]).includes(mimeType);
}

function readOriginalFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop()?.trim() ?? "";

  if (!baseName || baseName === "." || baseName === "..") {
    throw new TemplateMediaStorageError(
      "INVALID_FILE_NAME",
      "Nome de arquivo invalido."
    );
  }

  return baseName.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
}

function readSafeNamespace(namespace?: string) {
  const normalized = namespace
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || "default";
}

function readExtension(
  fileName: string,
  config: TemplateHeaderMediaConfig
): TemplateHeaderMediaExtension {
  const extension = path.extname(fileName).toLowerCase();

  if (!config.extensions.includes(extension as TemplateHeaderMediaExtension)) {
    throw new TemplateMediaStorageError(
      "UNSUPPORTED_MIME_TYPE",
      `Extensao do arquivo nao corresponde ao MIME ${config.mimeType}.`
    );
  }

  if (extension === ".jpeg") return ".jpg";
  return extension as TemplateHeaderMediaExtension;
}

function assertValidSignature(bytes: Buffer, config: TemplateHeaderMediaConfig) {
  if (config.signature === null) return;

  if (config.signature === "jpeg") {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new TemplateMediaStorageError(
        "INVALID_FILE_SIGNATURE",
        "Assinatura do arquivo nao corresponde a uma imagem JPEG."
      );
    }

    return;
  }

  if (config.signature === "mp4") {
    if (
      bytes.length < 12 ||
      bytes[4] !== 0x66 ||
      bytes[5] !== 0x74 ||
      bytes[6] !== 0x79 ||
      bytes[7] !== 0x70
    ) {
      throw new TemplateMediaStorageError(
        "INVALID_FILE_SIGNATURE",
        "Assinatura do arquivo nao corresponde a um video MP4."
      );
    }

    return;
  }

  if (bytes.length < config.signature.length) {
    throw new TemplateMediaStorageError(
      "INVALID_FILE_SIGNATURE",
      `Assinatura do arquivo nao corresponde a ${config.typeLabel}.`
    );
  }

  const signatureMatches = config.signature.every((value, index) => bytes[index] === value);
  if (!signatureMatches) {
    throw new TemplateMediaStorageError(
      "INVALID_FILE_SIGNATURE",
      `Assinatura do arquivo nao corresponde a ${config.typeLabel}.`
    );
  }
}

function calculateSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizePublicBaseUrl(value?: string | null) {
  const normalized = value?.trim().replace(/\/+$/g, "") ?? "";
  return normalized || null;
}

function resolveOptionalLocalPublicBaseUrl(configured?: string | null) {
  return normalizePublicBaseUrl(
    configured ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      process.env.PUBLIC_APP_URL ??
      (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/g, "")}`
        : null)
  );
}

function toPublicUrl(baseUrl: string | null, storageKey: string) {
  if (!baseUrl) return null;
  return `${baseUrl}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function resolvePublicRootDir(configured?: string) {
  return path.resolve(configured ?? path.join(process.cwd(), "public"));
}

function normalizeConfiguredStorageProvider(provider?: string | null) {
  const configured = provider?.trim() || process.env.TEMPLATE_MEDIA_STORAGE_PROVIDER?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new TemplateMediaStorageError(
        "STORAGE_PROVIDER_NOT_CONFIGURED",
        "Provider de armazenamento de midia de template nao configurado."
      );
    }

    return TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL;
  }

  if (configured === TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL) {
    if (process.env.NODE_ENV === "production") {
      throw new TemplateMediaStorageError(
        "STORAGE_PROVIDER_NOT_CONFIGURED",
        "Provider local nao deve ser usado em producao."
      );
    }

    return configured;
  }

  if (configured === TEMPLATE_MEDIA_STORAGE_PROVIDER_R2) {
    return configured;
  }

  throw new TemplateMediaStorageError(
    "STORAGE_PROVIDER_NOT_CONFIGURED",
    "Provider de armazenamento de midia de template invalido."
  );
}

function normalizeReadableStorageProvider(
  storageProvider: string | null | undefined
): ReadableTemplateMediaStorageProvider {
  const normalized = storageProvider?.trim();

  if (
    normalized === TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL ||
    normalized === TEMPLATE_MEDIA_STORAGE_PROVIDER_R2 ||
    normalized === TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC
  ) {
    return normalized;
  }

  throw new TemplateMediaStorageError(
    "STORAGE_PROVIDER_NOT_CONFIGURED",
    "Provider de armazenamento de midia de template invalido."
  );
}

function assertTemplateStorageKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");
  const validPrefix =
    normalized.startsWith(`${TEMPLATE_MEDIA_STORAGE_PREFIX}/`) ||
    normalized.startsWith(`${LEGACY_TEMPLATE_MEDIA_STORAGE_PREFIX}/`);

  if (
    !validPrefix ||
    normalized.includes("../") ||
    normalized.includes("/..") ||
    path.isAbsolute(storageKey)
  ) {
    throw new TemplateMediaStorageError(
      "STORAGE_INVALID_KEY",
      "Chave de armazenamento invalida."
    );
  }

  return normalized;
}

function resolveLocalStoragePath(storageKey: string, publicRootDir?: string) {
  const safeStorageKey = assertTemplateStorageKey(storageKey);
  const rootDir = resolvePublicRootDir(publicRootDir);
  const targetPath = path.resolve(rootDir, safeStorageKey);
  const expectedPrefix = `${rootDir}${path.sep}`;

  if (targetPath !== rootDir && !targetPath.startsWith(expectedPrefix)) {
    throw new TemplateMediaStorageError(
      "STORAGE_INVALID_KEY",
      "Chave de armazenamento invalida."
    );
  }

  return { safeStorageKey, targetPath };
}

async function fileExists(filePath: string) {
  return access(filePath, fsConstants.F_OK)
    .then(() => true)
    .catch(() => false);
}

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

function isAsyncIterableBytes(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function hasTransformToByteArray(
  value: unknown
): value is { transformToByteArray: () => Promise<Uint8Array> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToByteArray" in value &&
    typeof value.transformToByteArray === "function"
  );
}

function hasArrayBuffer(value: unknown): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  );
}

async function s3BodyToBuffer(body: unknown) {
  if (!body) {
    throw new TemplateMediaStorageError(
      "STORAGE_READ_FAILED",
      "Storage retornou conteudo vazio."
    );
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (hasTransformToByteArray(body)) {
    return Buffer.from(await body.transformToByteArray());
  }

  if (hasArrayBuffer(body)) {
    return Buffer.from(await body.arrayBuffer());
  }

  if (body instanceof Readable || isAsyncIterableBytes(body)) {
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  throw new TemplateMediaStorageError(
    "STORAGE_READ_FAILED",
    "Formato de resposta do storage nao suportado."
  );
}

function readFileNameFromStorageKey(storageKey: string) {
  return path.posix.basename(storageKey.replace(/\\/g, "/"));
}

function readSizeFromHeaders(contentLength: number | undefined, bytes: Buffer) {
  return typeof contentLength === "number" && contentLength >= 0
    ? contentLength
    : bytes.byteLength;
}

async function saveLocalTemplateMedia<
  TMimeType extends TemplateHeaderMediaMimeType,
  TExtension extends TemplateHeaderMediaExtension
>({
  storageKey,
  bytes,
  publicRootDir,
  publicBaseUrl,
  storedMedia
}: {
  storageKey: string;
  bytes: Buffer;
  publicRootDir?: string;
  publicBaseUrl?: string | null;
  storedMedia: Omit<
    StoredTemplateMedia<TMimeType, TExtension>,
    "storageProvider" | "storageKey" | "publicUrl"
  >;
}): Promise<StoredTemplateMedia<TMimeType, TExtension>> {
  const { safeStorageKey, targetPath } = resolveLocalStoragePath(storageKey, publicRootDir);
  const targetDir = path.dirname(targetPath);

  try {
    await mkdir(targetDir, { recursive: true });

    if (!(await fileExists(targetPath))) {
      await writeFile(targetPath, bytes, { flag: "wx" });
    }
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_FAILED",
      "Nao foi possivel armazenar a midia do template.",
      error
    );
  }

  return {
    ...storedMedia,
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
    storageKey: safeStorageKey,
    publicUrl: toPublicUrl(publicBaseUrl ?? resolveOptionalLocalPublicBaseUrl(), safeStorageKey)
  };
}

async function saveR2TemplateMedia<
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

  return {
    ...storedMedia,
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
    storageKey: safeStorageKey,
    publicUrl: toPublicUrl(config.publicBaseUrl, safeStorageKey)
  };
}

export async function saveTemplateHeaderMedia(
  input: SaveTemplateHeaderMediaInput,
  options: TemplateMediaStorageOptions = {}
): Promise<StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>> {
  const originalFileName = readOriginalFileName(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);

  if (!isTemplateHeaderMediaMimeType(mimeType)) {
    throw new TemplateMediaStorageError(
      "UNSUPPORTED_MIME_TYPE",
      "Formato de midia nao suportado para template."
    );
  }

  const config = TEMPLATE_HEADER_MEDIA_CONFIG[mimeType];
  const bytes = Buffer.from(input.bytes);
  if (bytes.byteLength === 0) {
    throw new TemplateMediaStorageError("STORAGE_EMPTY_FILE", "Arquivo vazio.");
  }

  if (bytes.byteLength > config.maxBytes) {
    throw new TemplateMediaStorageError(
      "FILE_TOO_LARGE",
      config.tooLargeMessage
    );
  }

  assertValidSignature(bytes, config);
  const extension = readExtension(originalFileName, config);
  const checksum = calculateSha256(bytes);
  const namespace = readSafeNamespace(input.namespace);
  const storedFileName = `${checksum}${extension}`;
  const storageKey = [
    TEMPLATE_MEDIA_STORAGE_PREFIX,
    namespace,
    checksum.slice(0, 2),
    storedFileName
  ].join("/");
  const storageProvider = normalizeConfiguredStorageProvider(options.provider);
  const storedMedia = {
    checksum,
    checksumAlgorithm: "sha256",
    mimeType,
    sizeBytes: bytes.byteLength,
    originalFileName,
    storedFileName,
    extension
  } satisfies Omit<
    StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>,
    "storageProvider" | "storageKey" | "publicUrl"
  >;

  if (storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_R2) {
    return saveR2TemplateMedia({
      storageKey,
      bytes,
      mimeType,
      storedMedia,
      options
    });
  }

  return saveLocalTemplateMedia({
    storageKey,
    bytes,
    publicRootDir: options.publicRootDir,
    publicBaseUrl: options.publicBaseUrl,
    storedMedia
  });
}

export async function saveTemplateImage(
  input: SaveTemplateImageInput,
  options: TemplateMediaStorageOptions = {}
): Promise<StoredTemplateMedia> {
  const storedMedia = await saveTemplateHeaderMedia(input, options);

  if (!isTemplateImageMimeType(storedMedia.mimeType)) {
    throw new TemplateMediaStorageError(
      "UNSUPPORTED_MIME_TYPE",
      "Formato de imagem nao suportado para template."
    );
  }

  return storedMedia as StoredTemplateMedia;
}

async function readLocalTemplateMedia(
  input: ReadTemplateMediaInput,
  options: Pick<TemplateMediaStorageOptions, "publicRootDir"> = {}
): Promise<ReadTemplateMediaResult> {
  const storageKey = assertTemplateStorageKey(input.storageKey?.trim() ?? "");
  const { targetPath } = resolveLocalStoragePath(storageKey, options.publicRootDir);

  let bytes: Buffer;
  let fileStat: Awaited<ReturnType<typeof stat>>;

  try {
    [bytes, fileStat] = await Promise.all([readFile(targetPath), stat(targetPath)]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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

  if (bytes.byteLength === 0 || fileStat.size === 0) {
    throw new TemplateMediaStorageError("STORAGE_EMPTY_FILE", "Arquivo vazio.");
  }

  return {
    bytes,
    mimeType: input.mimeType?.trim() || "application/octet-stream",
    fileName: input.fileName?.trim() || readFileNameFromStorageKey(storageKey),
    sizeBytes: bytes.byteLength
  };
}

async function readR2TemplateMedia(
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

export async function readTemplateMedia(
  input: ReadTemplateMediaInput,
  options: Pick<
    TemplateMediaStorageOptions,
    "publicRootDir" | "r2Client" | "r2Config"
  > = {}
): Promise<ReadTemplateMediaResult> {
  const storageProvider = normalizeReadableStorageProvider(input.storageProvider);

  if (
    storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL ||
    storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC
  ) {
    return readLocalTemplateMedia(input, options);
  }

  return readR2TemplateMedia(input, options);
}

export async function deleteStoredTemplateMedia(
  storageKey: string,
  options: Pick<TemplateMediaStorageOptions, "publicRootDir"> = {}
): Promise<DeleteStoredTemplateMediaResult> {
  return deleteTemplateMedia(
    {
      storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
      storageKey
    },
    options
  );
}

export async function deleteTemplateMedia(
  input: DeleteTemplateMediaInput,
  options: Pick<
    TemplateMediaStorageOptions,
    "publicRootDir" | "r2Client" | "r2Config"
  > = {}
): Promise<DeleteStoredTemplateMediaResult> {
  const storageProvider = normalizeReadableStorageProvider(input.storageProvider);
  const storageKey = assertTemplateStorageKey(input.storageKey?.trim() ?? "");

  if (
    storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL ||
    storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC
  ) {
    const { safeStorageKey, targetPath } = resolveLocalStoragePath(
      storageKey,
      options.publicRootDir
    );

    try {
      await rm(targetPath, { force: true });
    } catch (error) {
      throw new TemplateMediaStorageError(
        "STORAGE_DELETE_FAILED",
        "Nao foi possivel remover a midia do template.",
        error
      );
    }

    return {
      deleted: true,
      storageProvider,
      storageKey: safeStorageKey
    };
  }

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
    storageProvider,
    storageKey
  };
}
