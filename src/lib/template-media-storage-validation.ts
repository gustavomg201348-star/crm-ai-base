import { createHash } from "node:crypto";
import path from "node:path";
import {
  StoredTemplateMedia,
  TEMPLATE_DOCUMENT_MAX_BYTES,
  TEMPLATE_DOCUMENT_MIME_TYPES,
  TEMPLATE_HEADER_MEDIA_MIME_TYPES,
  TEMPLATE_IMAGE_MAX_BYTES,
  TEMPLATE_IMAGE_MIME_TYPES,
  TEMPLATE_VIDEO_MAX_BYTES,
  TEMPLATE_VIDEO_MIME_TYPES,
  TemplateHeaderMediaConfig,
  TemplateHeaderMediaExtension,
  TemplateHeaderMediaInputExtension,
  TemplateHeaderMediaMimeType,
  TemplateImageMimeType,
  TemplateMediaStorageError,
  TemplateMediaStorageProvider
} from "@/lib/template-media-storage-types";

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

export function isTemplateImageMimeType(mimeType: string): mimeType is TemplateImageMimeType {
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

function readExtension(
  fileName: string,
  config: TemplateHeaderMediaConfig
): TemplateHeaderMediaExtension {
  const extension = path.extname(fileName).toLowerCase();

  if (!config.extensions.includes(extension as TemplateHeaderMediaInputExtension)) {
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

export function validateTemplateHeaderMedia(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
}) {
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
  const storedFileName = `${checksum}${extension}`;
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

  return { bytes, storedMedia };
}

export function withStorageLocation<
  TMimeType extends TemplateHeaderMediaMimeType,
  TExtension extends TemplateHeaderMediaExtension
>(
  storedMedia: Omit<
    StoredTemplateMedia<TMimeType, TExtension>,
    "storageProvider" | "storageKey" | "publicUrl"
  >,
  location: Pick<StoredTemplateMedia, "storageProvider" | "storageKey" | "publicUrl">
): StoredTemplateMedia<TMimeType, TExtension> {
  return {
    ...storedMedia,
    storageProvider: location.storageProvider as TemplateMediaStorageProvider,
    storageKey: location.storageKey,
    publicUrl: location.publicUrl
  };
}
