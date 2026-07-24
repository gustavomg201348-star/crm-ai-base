import type { MediaAsset, MetaTemplate } from "@prisma/client";
import type { NormalizedMetaTemplate } from "@/lib/meta-template-normalizer";
import { findMediaAssetById, type CreateMediaAssetInput } from "@/lib/media-asset-repository";
import {
  createMetaTemplate,
  findMetaTemplateById,
  markMetaTemplateNotReturned,
  MetaTemplateRepositoryError,
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
