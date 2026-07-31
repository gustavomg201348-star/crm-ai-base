import type {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand
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
export const LEGACY_TEMPLATE_MEDIA_STORAGE_PREFIX = "uploads/templates";
export const TEMPLATE_MEDIA_STORAGE_PROVIDERS = [
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_R2
] as const;
export const READABLE_TEMPLATE_MEDIA_STORAGE_PROVIDERS = [
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
export type TemplateHeaderMediaInputExtension = TemplateHeaderMediaExtension | ".jpeg";
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

export type TemplateMediaStorageOptions = {
  provider?: string | null;
  publicRootDir?: string;
  publicBaseUrl?: string | null;
  r2Client?: TemplateMediaS3Client;
  r2Config?: Partial<R2StorageConfig>;
};

export type TemplateHeaderMediaConfig = {
  extensions: readonly TemplateHeaderMediaInputExtension[];
  maxBytes: number;
  mimeType: TemplateHeaderMediaMimeType;
  signature: readonly number[] | "jpeg" | "mp4" | null;
  tooLargeMessage: string;
  typeLabel: string;
};

export type R2StorageConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
};

export type TemplateMediaS3Command =
  | PutObjectCommand
  | GetObjectCommand
  | DeleteObjectCommand;

export type TemplateMediaS3Client = {
  send(command: TemplateMediaS3Command): Promise<unknown>;
};
