import type { MediaAsset, MetaTemplate } from "@prisma/client";
import type { MetaTemplateApiComponent } from "@/lib/meta-template-client";
import type { NormalizedMetaTemplate } from "@/lib/meta-template-normalizer";
import {
  createMediaAsset,
  findMediaAssetById,
  findMediaAssetByStorageIdentity,
  updateMediaAssetStatus,
  updateMediaAssetStorageDetails,
  type CreateMediaAssetInput
} from "@/lib/media-asset-repository";
import {
  createMetaTemplate,
  findMetaTemplateById,
  markMetaTemplateNotReturned,
  MetaTemplateRepositoryError,
  persistCreatedMetaTemplateRecord,
  setMetaTemplateDefaultHeaderMediaAndStatus,
  upsertMetaTemplateFromMeta
} from "@/lib/meta-template-repository";
import { parseJsonField, serializeJsonField } from "@/lib/json-storage";
import {
  calculateMetaTemplateOperationalStatus,
  isMetaTemplateSupportFlags,
  isValidMetaTemplateComponentsField,
  isValidMetaTemplateSupportFlagsField,
  supportFlagsIndicateSupportedComponents
} from "@/lib/meta-template-status";
import { type StoredTemplateMedia } from "@/lib/template-media-storage";

const TEMPLATE_HEADER_MEDIA_ASSET_TYPE = "TEMPLATE_HEADER_IMAGE";
const TEMPLATE_MEDIA_ASSET_STORED_STATUS = "STORED";
const TEMPLATE_MEDIA_ASSET_READY_STATUS = "READY";
const CREATED_TEMPLATE_SUPPORT_FLAGS = {
  canSendWithCurrentBuilder: true,
  unsupportedReasons: []
};

export type MetaTemplateServiceErrorCode =
  | "INVALID_INPUT"
  | "TEMPLATE_NOT_FOUND"
  | "MEDIA_ASSET_NOT_FOUND"
  | "INVALID_STORED_JSON"
  | "COMPANY_ISOLATION_VIOLATION"
  | "META_TEMPLATE_ID_CONFLICT";

export class MetaTemplateServiceError extends Error {
  readonly code: MetaTemplateServiceErrorCode;

  constructor(code: MetaTemplateServiceErrorCode, message: string) {
    super(message);
    this.name = "MetaTemplateServiceError";
    this.code = code;
  }
}

export type MetaTemplateLibraryEntry = Omit<
  MetaTemplate,
  "components" | "rawPayload" | "supportFlags"
> & {
  components: unknown;
  rawPayload: unknown | null;
  supportFlags: unknown | null;
};

export type MediaAssetLibraryEntry = Omit<MediaAsset, "metadata"> & {
  metadata: unknown | null;
};

export type UpsertNormalizedMetaTemplateInput = {
  companyId: string;
  wabaId: string;
  template: NormalizedMetaTemplate;
  rawPayload?: unknown;
  now?: Date;
  existingDefaultHeaderMediaAssetId?: string | null;
};

export type PersistTemplateHeaderMediaAssetInput = {
  companyId: string;
  channelId?: string | null;
  storedMedia: StoredTemplateMedia;
  now?: Date;
};

export type UpdateTemplateHeaderMediaHandleInput = {
  companyId: string;
  mediaAssetId: string;
  headerHandle: string;
  now?: Date;
};

export type PersistCreatedMetaTemplateInput = {
  companyId: string;
  wabaId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string | null;
  metaStatus: string | null;
  components: MetaTemplateApiComponent[];
  rawPayload?: unknown;
  defaultHeaderMediaAssetId: string;
  now?: Date;
};

function normalizeRequiredString(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new MetaTemplateServiceError("INVALID_INPUT", `Campo obrigatorio ausente: ${fieldName}.`);
  }

  return normalized;
}

function normalizeOptionalString(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function assertComponentsField(value: unknown, fieldName: string) {
  if (!isValidMetaTemplateComponentsField(value)) {
    throw new MetaTemplateServiceError("INVALID_INPUT", `${fieldName} deve ser um array.`);
  }

  return value;
}

function assertSupportFlagsField(value: unknown, fieldName: string) {
  if (!isValidMetaTemplateSupportFlagsField(value)) {
    throw new MetaTemplateServiceError(
      "INVALID_INPUT",
      `${fieldName} deve ser um objeto de compatibilidade valido.`
    );
  }

  return value ?? null;
}

function mapRepositoryError(error: unknown): never {
  if (
    error instanceof MetaTemplateRepositoryError &&
    error.code === "META_TEMPLATE_ID_CONFLICT"
  ) {
    throw new MetaTemplateServiceError(
      "META_TEMPLATE_ID_CONFLICT",
      "Identificador Meta do template conflita com outro template da mesma WABA."
    );
  }

  throw error;
}

export function deserializeMetaTemplate(template: MetaTemplate): MetaTemplateLibraryEntry {
  try {
    return {
      ...template,
      components: parseJsonField<unknown>(template.components, "MetaTemplate.components"),
      rawPayload: parseJsonField<unknown>(template.rawPayload, "MetaTemplate.rawPayload"),
      supportFlags: parseJsonField<unknown>(template.supportFlags, "MetaTemplate.supportFlags")
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new MetaTemplateServiceError("INVALID_STORED_JSON", error.message);
    }

    throw error;
  }
}

export function deserializeMediaAsset(mediaAsset: MediaAsset): MediaAssetLibraryEntry {
  try {
    return {
      ...mediaAsset,
      metadata: parseJsonField<unknown>(mediaAsset.metadata, "MediaAsset.metadata")
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new MetaTemplateServiceError("INVALID_STORED_JSON", error.message);
    }

    throw error;
  }
}

function calculateStatusForTemplateRecord(template: MetaTemplate) {
  const supportFlags = parseJsonField<unknown>(
    template.supportFlags,
    "MetaTemplate.supportFlags"
  );

  return calculateMetaTemplateOperationalStatus({
    metaStatus: template.metaStatus,
    requiresHeaderMedia: template.requiresHeaderMedia,
    defaultHeaderMediaAssetId: template.defaultHeaderMediaAssetId,
    componentsSupported: supportFlagsIndicateSupportedComponents(supportFlags),
    syncError: template.syncError,
    isActive: template.isActive
  });
}

export async function createLocalMetaTemplate(input: {
  companyId: string;
  wabaId: string;
  name: string;
  language: string;
  metaStatus?: string | null;
  category?: string | null;
  requiresHeaderMedia?: boolean;
  headerFormat?: string | null;
  components: unknown;
  rawPayload?: unknown;
  supportFlags?: unknown;
  defaultHeaderMediaAssetId?: string | null;
}) {
  const safeCompanyId = normalizeRequiredString(input.companyId, "companyId");
  const components = assertComponentsField(input.components, "MetaTemplate.components");
  const supportFlags = assertSupportFlagsField(input.supportFlags, "MetaTemplate.supportFlags");
  const defaultHeaderMediaAssetId = normalizeOptionalString(input.defaultHeaderMediaAssetId);

  if (defaultHeaderMediaAssetId) {
    const mediaAsset = await findMediaAssetById(safeCompanyId, defaultHeaderMediaAssetId);

    if (!mediaAsset) {
      throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
    }
  }

  const operationalStatus = calculateMetaTemplateOperationalStatus({
    metaStatus: input.metaStatus,
    requiresHeaderMedia: input.requiresHeaderMedia ?? false,
    defaultHeaderMediaAssetId,
    componentsSupported: supportFlagsIndicateSupportedComponents(supportFlags),
    syncError: null,
    isActive: true
  });

  const created = await createMetaTemplate({
    companyId: safeCompanyId,
    wabaId: normalizeRequiredString(input.wabaId, "wabaId"),
    name: normalizeRequiredString(input.name, "name"),
    language: normalizeRequiredString(input.language, "language"),
    metaStatus: normalizeOptionalString(input.metaStatus),
    category: normalizeOptionalString(input.category),
    operationalStatus,
    requiresHeaderMedia: input.requiresHeaderMedia ?? false,
    headerFormat: normalizeOptionalString(input.headerFormat),
    components: serializeJsonField(components, "MetaTemplate.components") ?? "[]",
    rawPayload: serializeJsonField(input.rawPayload, "MetaTemplate.rawPayload"),
    supportFlags: serializeJsonField(supportFlags, "MetaTemplate.supportFlags"),
    defaultHeaderMediaAssetId
  });

  return deserializeMetaTemplate(created);
}

export async function upsertNormalizedMetaTemplate({
  companyId,
  wabaId,
  template,
  rawPayload,
  now = new Date(),
  existingDefaultHeaderMediaAssetId
}: UpsertNormalizedMetaTemplateInput) {
  const components = assertComponentsField(template.rawComponents, "MetaTemplate.components");
  const supportFlags = assertSupportFlagsField(
    template.compatibility,
    "MetaTemplate.supportFlags"
  );
  const operationalStatus = calculateMetaTemplateOperationalStatus({
    metaStatus: template.status,
    requiresHeaderMedia: template.requiresHeaderMedia,
    defaultHeaderMediaAssetId: existingDefaultHeaderMediaAssetId,
    componentsSupported: supportFlagsIndicateSupportedComponents(supportFlags),
    syncError: null,
    isActive: true
  });

  const upserted = await upsertMetaTemplateFromMeta({
    companyId: normalizeRequiredString(companyId, "companyId"),
    wabaId: normalizeRequiredString(wabaId, "wabaId"),
    name: normalizeRequiredString(template.name, "name"),
    language: normalizeRequiredString(template.language, "language"),
    metaTemplateId: template.metaId,
    category: normalizeOptionalString(template.category),
    metaStatus: normalizeOptionalString(template.status),
    requiresHeaderMedia: template.requiresHeaderMedia,
    headerFormat: template.header.format,
    components: serializeJsonField(components, "MetaTemplate.components") ?? "[]",
    rawPayload: serializeJsonField(rawPayload, "MetaTemplate.rawPayload"),
    supportFlags: serializeJsonField(supportFlags, "MetaTemplate.supportFlags"),
    lastSyncedAt: now,
    lastSeenAt: now,
    syncError: null,
    isActive: true,
    operationalStatus
  }).catch(mapRepositoryError);

  return deserializeMetaTemplate(upserted);
}

function buildTemplateMediaMetadata({
  channelId,
  storedMedia
}: {
  channelId?: string | null;
  storedMedia: StoredTemplateMedia;
}) {
  return {
    scope: "META_TEMPLATE_HEADER",
    ...(channelId?.trim() ? { channelId: channelId.trim() } : {}),
    originalFileName: storedMedia.originalFileName,
    storedFileName: storedMedia.storedFileName,
    checksumAlgorithm: storedMedia.checksumAlgorithm
  };
}

function mediaNeedsStorageRefresh(
  mediaAsset: MediaAsset,
  storedMedia: StoredTemplateMedia,
  metadata: string | null
) {
  return (
    mediaAsset.type !== TEMPLATE_HEADER_MEDIA_ASSET_TYPE ||
    mediaAsset.mimeType !== storedMedia.mimeType ||
    mediaAsset.fileName !== storedMedia.originalFileName ||
    mediaAsset.sizeBytes !== storedMedia.sizeBytes ||
    mediaAsset.storageKey !== storedMedia.storageKey ||
    mediaAsset.publicUrl !== storedMedia.publicUrl ||
    mediaAsset.metadata !== metadata
  );
}

export async function persistTemplateHeaderMediaAsset({
  companyId,
  channelId,
  storedMedia
}: PersistTemplateHeaderMediaAssetInput) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const storageProvider = normalizeRequiredString(
    storedMedia.storageProvider,
    "storageProvider"
  );
  const checksum = normalizeRequiredString(storedMedia.checksum, "checksum");
  const metadata = serializeJsonField(
    buildTemplateMediaMetadata({ channelId, storedMedia }),
    "MediaAsset.metadata"
  );
  const existing = await findMediaAssetByStorageIdentity(
    safeCompanyId,
    storageProvider,
    checksum
  );

  if (existing) {
    if (existing.companyId !== safeCompanyId) {
      throw new MetaTemplateServiceError(
        "COMPANY_ISOLATION_VIOLATION",
        "Midia nao pertence a empresa informada."
      );
    }

    if (!mediaNeedsStorageRefresh(existing, storedMedia, metadata)) {
      return deserializeMediaAsset(existing);
    }

    const updated = await updateMediaAssetStorageDetails(safeCompanyId, existing.id, {
      type: TEMPLATE_HEADER_MEDIA_ASSET_TYPE,
      mimeType: storedMedia.mimeType,
      fileName: storedMedia.originalFileName,
      sizeBytes: storedMedia.sizeBytes,
      storageProvider,
      storageKey: storedMedia.storageKey,
      publicUrl: storedMedia.publicUrl,
      checksum,
      metadata
    });

    if (!updated) {
      throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
    }

    return deserializeMediaAsset(updated);
  }

  const created = await createMediaAsset(
    buildCreateMediaAssetInput({
      companyId: safeCompanyId,
      type: TEMPLATE_HEADER_MEDIA_ASSET_TYPE,
      mimeType: storedMedia.mimeType,
      fileName: storedMedia.originalFileName,
      sizeBytes: storedMedia.sizeBytes,
      status: TEMPLATE_MEDIA_ASSET_STORED_STATUS,
      storageProvider,
      storageKey: storedMedia.storageKey,
      publicUrl: storedMedia.publicUrl,
      checksum,
      metadata
    })
  );

  return deserializeMediaAsset(created);
}

export async function updateTemplateHeaderMediaHandle({
  companyId,
  mediaAssetId,
  headerHandle,
  now = new Date()
}: UpdateTemplateHeaderMediaHandleInput) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const updated = await updateMediaAssetStatus(
    safeCompanyId,
    normalizeRequiredString(mediaAssetId, "mediaAssetId"),
    {
      status: TEMPLATE_MEDIA_ASSET_READY_STATUS,
      headerHandle: normalizeRequiredString(headerHandle, "headerHandle"),
      lastValidatedAt: now,
      validationError: null
    }
  );

  if (!updated) {
    throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
  }

  return deserializeMediaAsset(updated);
}

export async function persistCreatedMetaTemplate({
  companyId,
  wabaId,
  metaTemplateId,
  name,
  language,
  category,
  metaStatus,
  components,
  rawPayload,
  defaultHeaderMediaAssetId,
  now = new Date()
}: PersistCreatedMetaTemplateInput) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const safeDefaultHeaderMediaAssetId = normalizeRequiredString(
    defaultHeaderMediaAssetId,
    "defaultHeaderMediaAssetId"
  );
  const mediaAsset = await findMediaAssetById(safeCompanyId, safeDefaultHeaderMediaAssetId);

  if (!mediaAsset) {
    throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
  }

  const safeComponents = assertComponentsField(components, "MetaTemplate.components");
  const supportFlags = assertSupportFlagsField(
    CREATED_TEMPLATE_SUPPORT_FLAGS,
    "MetaTemplate.supportFlags"
  );
  const operationalStatus = calculateMetaTemplateOperationalStatus({
    metaStatus,
    requiresHeaderMedia: true,
    defaultHeaderMediaAssetId: mediaAsset.id,
    componentsSupported: supportFlagsIndicateSupportedComponents(supportFlags),
    syncError: null,
    isActive: true
  });
  const persisted = await persistCreatedMetaTemplateRecord({
    companyId: safeCompanyId,
    wabaId: normalizeRequiredString(wabaId, "wabaId"),
    name: normalizeRequiredString(name, "name"),
    language: normalizeRequiredString(language, "language"),
    metaTemplateId: normalizeOptionalString(metaTemplateId),
    category: normalizeOptionalString(category),
    metaStatus: normalizeOptionalString(metaStatus),
    operationalStatus,
    components: serializeJsonField(safeComponents, "MetaTemplate.components") ?? "[]",
    rawPayload: serializeJsonField(rawPayload, "MetaTemplate.rawPayload"),
    supportFlags: serializeJsonField(supportFlags, "MetaTemplate.supportFlags"),
    defaultHeaderMediaAssetId: mediaAsset.id,
    lastSeenAt: now
  });

  return deserializeMetaTemplate(persisted);
}

export async function setDefaultHeaderMediaForTemplate({
  companyId,
  templateId,
  mediaAssetId
}: {
  companyId: string;
  templateId: string;
  mediaAssetId: string;
}) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const template = await findMetaTemplateById(
    safeCompanyId,
    normalizeRequiredString(templateId, "templateId")
  );

  if (!template) {
    throw new MetaTemplateServiceError("TEMPLATE_NOT_FOUND", "Template nao encontrado.");
  }

  const mediaAsset = await findMediaAssetById(
    safeCompanyId,
    normalizeRequiredString(mediaAssetId, "mediaAssetId")
  );

  if (!mediaAsset) {
    throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
  }

  if (mediaAsset.companyId !== template.companyId) {
    throw new MetaTemplateServiceError(
      "COMPANY_ISOLATION_VIOLATION",
      "Midia nao pertence a empresa do template."
    );
  }

  const operationalStatus = calculateMetaTemplateOperationalStatus({
    metaStatus: template.metaStatus,
    requiresHeaderMedia: template.requiresHeaderMedia,
    defaultHeaderMediaAssetId: mediaAsset.id,
    componentsSupported: supportFlagsIndicateSupportedComponents(
      parseJsonField<unknown>(template.supportFlags, "MetaTemplate.supportFlags")
    ),
    syncError: template.syncError,
    isActive: template.isActive
  });
  const updated = await setMetaTemplateDefaultHeaderMediaAndStatus(
    safeCompanyId,
    template.id,
    mediaAsset.id,
    operationalStatus
  );

  return deserializeMetaTemplate(updated);
}

export async function markTemplateNotReturned(companyId: string, templateId: string) {
  const updated = await markMetaTemplateNotReturned(
    normalizeRequiredString(companyId, "companyId"),
    normalizeRequiredString(templateId, "templateId")
  );

  return deserializeMetaTemplate(updated);
}

export function buildCreateMediaAssetInput(input: CreateMediaAssetInput) {
  return {
    ...input,
    companyId: normalizeRequiredString(input.companyId, "companyId"),
    type: normalizeRequiredString(input.type, "type"),
    mimeType: normalizeRequiredString(input.mimeType, "mimeType"),
    fileName: normalizeRequiredString(input.fileName, "fileName"),
    metadata: serializeJsonField(input.metadata, "MediaAsset.metadata")
  } satisfies CreateMediaAssetInput;
}

export { calculateStatusForTemplateRecord };
