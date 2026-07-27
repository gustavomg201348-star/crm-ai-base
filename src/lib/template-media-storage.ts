import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const TEMPLATE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TEMPLATE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export const TEMPLATE_MEDIA_STORAGE_PROVIDER = "local-public";
export const TEMPLATE_MEDIA_STORAGE_PREFIX = "uploads/templates";

export type TemplateImageMimeType = (typeof TEMPLATE_IMAGE_MIME_TYPES)[number];
export type TemplateImageExtension = ".jpg" | ".png";
export type TemplateMediaChecksumAlgorithm = "sha256";

export type SaveTemplateImageInput = {
  fileName: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
  namespace?: string;
};

export type StoredTemplateMedia = {
  storageProvider: typeof TEMPLATE_MEDIA_STORAGE_PROVIDER;
  storageKey: string;
  publicUrl: string;
  checksum: string;
  checksumAlgorithm: TemplateMediaChecksumAlgorithm;
  mimeType: TemplateImageMimeType;
  sizeBytes: number;
  originalFileName: string;
  storedFileName: string;
  extension: TemplateImageExtension;
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

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTemplateImageMimeType(mimeType: string): mimeType is TemplateImageMimeType {
  return (TEMPLATE_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
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

function readExtension(fileName: string, mimeType: TemplateImageMimeType): TemplateImageExtension {
  const extension = path.extname(fileName).toLowerCase();

  if (mimeType === "image/png") {
    if (extension !== ".png") {
      throw new TemplateMediaStorageError(
        "UNSUPPORTED_MIME_TYPE",
        "Extensao do arquivo nao corresponde ao MIME image/png."
      );
    }

    return ".png";
  }

  if (extension !== ".jpg" && extension !== ".jpeg") {
    throw new TemplateMediaStorageError(
      "UNSUPPORTED_MIME_TYPE",
      "Extensao do arquivo nao corresponde ao MIME image/jpeg."
    );
  }

  return ".jpg";
}

function assertValidSignature(bytes: Buffer, mimeType: TemplateImageMimeType) {
  if (mimeType === "image/jpeg") {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new TemplateMediaStorageError(
        "INVALID_FILE_SIGNATURE",
        "Assinatura do arquivo nao corresponde a uma imagem JPEG."
      );
    }

    return;
  }

  if (
    bytes.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    throw new TemplateMediaStorageError(
      "INVALID_FILE_SIGNATURE",
      "Assinatura do arquivo nao corresponde a uma imagem PNG."
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

export async function saveTemplateImage(
  input: SaveTemplateImageInput,
  options: TemplateMediaStorageOptions = {}
): Promise<StoredTemplateMedia> {
  const originalFileName = readOriginalFileName(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);

  if (!isTemplateImageMimeType(mimeType)) {
    throw new TemplateMediaStorageError(
      "UNSUPPORTED_MIME_TYPE",
      "Formato de imagem nao suportado para template."
    );
  }

  const bytes = Buffer.from(input.bytes);
  if (bytes.byteLength === 0) {
    throw new TemplateMediaStorageError("EMPTY_FILE", "Arquivo vazio.");
  }

  if (bytes.byteLength > TEMPLATE_IMAGE_MAX_BYTES) {
    throw new TemplateMediaStorageError(
      "FILE_TOO_LARGE",
      "Imagem acima do limite de 5 MB."
    );
  }

  assertValidSignature(bytes, mimeType);
  const extension = readExtension(originalFileName, mimeType);
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
