import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
export const TEMPLATE_MEDIA_STORAGE_PROVIDER = "local-public";
export const TEMPLATE_MEDIA_STORAGE_PREFIX = "uploads/templates";

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
  storageProvider: typeof TEMPLATE_MEDIA_STORAGE_PROVIDER;
  storageKey: string;
  publicUrl: string;
  checksum: string;
  checksumAlgorithm: TemplateMediaChecksumAlgorithm;
  mimeType: TMimeType;
  sizeBytes: number;
  originalFileName: string;
  storedFileName: string;
  extension: TExtension;
};

export type DeleteStoredTemplateMediaResult = {
  deleted: boolean;
  storageKey: string;
};

export type TemplateMediaStorageErrorCode =
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
  publicRootDir?: string;
  publicBaseUrl?: string | null;
};

type TemplateHeaderMediaConfig = {
  extensions: readonly TemplateHeaderMediaInputExtension[];
  maxBytes: number;
  mimeType: TemplateHeaderMediaMimeType;
  signature: readonly number[] | "jpeg" | "mp4" | null;
  tooLargeMessage: string;
  typeLabel: string;
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

function resolvePublicBaseUrl(configured?: string | null) {
  const value =
    configured?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/g, "")}`
      : "");

  if (!value) {
    throw new TemplateMediaStorageError(
      "STORAGE_CONFIGURATION_ERROR",
      "URL publica da aplicacao nao configurada para armazenar midia de template."
    );
  }

  const normalized = value.replace(/\/+$/g, "");
  if (process.env.NODE_ENV === "production" && !normalized.startsWith("https://")) {
    throw new TemplateMediaStorageError(
      "STORAGE_CONFIGURATION_ERROR",
      "URL publica da aplicacao precisa ser HTTPS em producao."
    );
  }

  return normalized;
}

function resolvePublicRootDir(configured?: string) {
  return path.resolve(configured ?? path.join(process.cwd(), "public"));
}

function toPublicUrl(baseUrl: string, storageKey: string) {
  return `${baseUrl}/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

function assertTemplateStorageKey(storageKey: string) {
  const normalized = storageKey.replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    !normalized.startsWith(`${TEMPLATE_MEDIA_STORAGE_PREFIX}/`) ||
    normalized.includes("../") ||
    normalized.includes("/..") ||
    path.isAbsolute(storageKey)
  ) {
    throw new TemplateMediaStorageError(
      "INVALID_FILE_NAME",
      "Chave de armazenamento invalida."
    );
  }

  return normalized;
}

async function fileExists(filePath: string) {
  return access(filePath, fsConstants.F_OK)
    .then(() => true)
    .catch(() => false);
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
    throw new TemplateMediaStorageError("EMPTY_FILE", "Arquivo vazio.");
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
  const publicRootDir = resolvePublicRootDir(options.publicRootDir);
  const targetPath = path.join(publicRootDir, storageKey);
  const targetDir = path.dirname(targetPath);
  const publicBaseUrl = resolvePublicBaseUrl(options.publicBaseUrl);

  try {
    await mkdir(targetDir, { recursive: true });

    if (!(await fileExists(targetPath))) {
      await writeFile(targetPath, bytes, { flag: "wx" });
    }
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_ERROR",
      "Nao foi possivel armazenar a midia do template.",
      error
    );
  }

  return {
    storageProvider: TEMPLATE_MEDIA_STORAGE_PROVIDER,
    storageKey,
    publicUrl: toPublicUrl(publicBaseUrl, storageKey),
    checksum,
    checksumAlgorithm: "sha256",
    mimeType,
    sizeBytes: bytes.byteLength,
    originalFileName,
    storedFileName,
    extension
  };
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

export async function deleteStoredTemplateMedia(
  storageKey: string,
  options: Pick<TemplateMediaStorageOptions, "publicRootDir"> = {}
): Promise<DeleteStoredTemplateMediaResult> {
  const safeStorageKey = assertTemplateStorageKey(storageKey);
  const publicRootDir = resolvePublicRootDir(options.publicRootDir);
  const targetPath = path.join(publicRootDir, safeStorageKey);

  try {
    await rm(targetPath, { force: true });
  } catch (error) {
    throw new TemplateMediaStorageError(
      "STORAGE_WRITE_ERROR",
      "Nao foi possivel remover a midia do template.",
      error
    );
  }

  return {
    deleted: true,
    storageKey: safeStorageKey
  };
}
