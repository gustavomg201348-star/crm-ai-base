import {
  DeleteStoredTemplateMediaResult,
  ReadableTemplateMediaStorageProvider,
  ReadTemplateMediaInput,
  ReadTemplateMediaResult,
  SaveTemplateHeaderMediaInput,
  SaveTemplateImageInput,
  StoredTemplateMedia,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
  TemplateHeaderMediaExtension,
  TemplateHeaderMediaMimeType,
  TemplateMediaStorageError,
  TemplateMediaStorageOptions
} from "@/lib/template-media-storage-types";
import { buildTemplateStorageKey, assertTemplateStorageKey } from "@/lib/template-media-storage-key";
import {
  isTemplateImageMimeType,
  validateTemplateHeaderMedia
} from "@/lib/template-media-storage-validation";
import {
  deleteLocalTemplateMedia,
  readLocalTemplateMedia,
  saveLocalTemplateMedia
} from "@/lib/template-media-storage-local";
import {
  deleteR2TemplateMedia,
  readR2TemplateMedia,
  saveR2TemplateMedia
} from "@/lib/template-media-storage-r2";

export {
  TEMPLATE_DOCUMENT_MAX_BYTES,
  TEMPLATE_DOCUMENT_MIME_TYPES,
  TEMPLATE_HEADER_MEDIA_MIME_TYPES,
  TEMPLATE_IMAGE_MAX_BYTES,
  TEMPLATE_IMAGE_MIME_TYPES,
  TEMPLATE_MEDIA_STORAGE_PREFIX,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LEGACY_LOCAL_PUBLIC,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_LOCAL,
  TEMPLATE_MEDIA_STORAGE_PROVIDER_R2,
  TEMPLATE_VIDEO_MAX_BYTES,
  TEMPLATE_VIDEO_MIME_TYPES,
  TemplateMediaStorageError
} from "@/lib/template-media-storage-types";
export type {
  DeleteStoredTemplateMediaResult,
  DeleteTemplateMediaInput,
  ReadableTemplateMediaStorageProvider,
  ReadTemplateMediaInput,
  ReadTemplateMediaResult,
  SaveTemplateHeaderMediaInput,
  SaveTemplateImageInput,
  StoredTemplateMedia,
  TemplateDocumentExtension,
  TemplateDocumentMimeType,
  TemplateHeaderMediaExtension,
  TemplateHeaderMediaMimeType,
  TemplateImageExtension,
  TemplateImageMimeType,
  TemplateMediaChecksumAlgorithm,
  TemplateMediaStorageErrorCode,
  TemplateMediaStorageProvider,
  TemplateVideoExtension,
  TemplateVideoMimeType
} from "@/lib/template-media-storage-types";

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

export async function saveTemplateHeaderMedia(
  input: SaveTemplateHeaderMediaInput,
  options: TemplateMediaStorageOptions = {}
): Promise<StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>> {
  const { bytes, storedMedia } = validateTemplateHeaderMedia(input);
  const storageKey = buildTemplateStorageKey({
    namespace: input.namespace,
    checksum: storedMedia.checksum,
    storedFileName: storedMedia.storedFileName
  });
  const storageProvider = normalizeConfiguredStorageProvider(options.provider);

  if (storageProvider === TEMPLATE_MEDIA_STORAGE_PROVIDER_R2) {
    return saveR2TemplateMedia({
      storageKey,
      bytes,
      mimeType: storedMedia.mimeType,
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
  input: {
    storageProvider: string | null | undefined;
    storageKey: string | null | undefined;
  },
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
    return deleteLocalTemplateMedia({
      storageKey,
      storageProvider,
      publicRootDir: options.publicRootDir
    });
  }

  return deleteR2TemplateMedia({ storageKey, options });
}
