import type { MediaAsset, MetaTemplate } from "@prisma/client";
import type { MetaTemplateApiComponent } from "@/lib/meta-template-client";
import {
  normalizeMetaTemplate,
  type MetaTemplate as MetaTemplatePayload,
  type NormalizedMetaTemplate
} from "@/lib/meta-template-normalizer";
import { prisma } from "@/lib/db";
import {
  createMediaAsset,
  findMediaAssetByHeaderHandle,
  findMediaAssetById,
  findMediaAssetByStorageIdentity,
  updateMediaAssetStatus,
  updateMediaAssetStorageDetails,
  type CreateMediaAssetInput
} from "@/lib/media-asset-repository";
import {
  createMetaTemplate,
  findMetaTemplateById,
  listMetaTemplatesForAdmin,
  markMetaTemplateNotReturned,
  MetaTemplateRepositoryError,
  persistCreatedMetaTemplateRecord,
  setMetaTemplateDefaultHeaderMediaAndStatus,
  upsertMetaTemplateFromMeta,
  type AdminMetaTemplateListRecord
} from "@/lib/meta-template-repository";
import { parseJsonField, serializeJsonField } from "@/lib/json-storage";
import {
  calculateMetaTemplateOperationalStatus,
  isMetaTemplateSupportFlags,
  isValidMetaTemplateComponentsField,
  isValidMetaTemplateSupportFlagsField,
  supportFlagsIndicateSupportedComponents
} from "@/lib/meta-template-status";
import {
  type StoredTemplateMedia,
  type TemplateHeaderMediaExtension,
  type TemplateHeaderMediaMimeType
} from "@/lib/template-media-storage";

type TemplateHeaderMediaHeaderType = "IMAGE" | "DOCUMENT" | "VIDEO";
type TemplateHeaderMediaAssetType =
  | "TEMPLATE_HEADER_IMAGE"
  | "TEMPLATE_HEADER_DOCUMENT"
  | "TEMPLATE_HEADER_VIDEO";
type HeaderMediaAssetLookup = (
  companyId: string,
  headerHandle: string
) => Promise<MediaAsset | null>;

const TEMPLATE_MEDIA_ASSET_STORED_STATUS = "STORED";
const TEMPLATE_MEDIA_ASSET_READY_STATUS = "READY";

export type MetaTemplateServiceErrorCode =
  | "INVALID_INPUT"
  | "TEMPLATE_NOT_FOUND"
  | "MEDIA_ASSET_NOT_FOUND"
  | "INVALID_STORED_JSON"
  | "COMPANY_ISOLATION_VIOLATION"
  | "CHANNEL_NOT_FOUND"
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
  headerType: TemplateHeaderMediaHeaderType;
  storedMedia: StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>;
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
  defaultHeaderMediaAssetId?: string | null;
  now?: Date;
};

export type AdminTemplateListFilters = {
  q?: string;
  channelId?: string;
  category?: string;
  language?: string;
  metaStatus?: string;
  operationalStatus?: string;
  hasImage?: boolean;
};

export type AdminTemplateListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type AdminTemplateListItem = {
  id: string;
  name: string;
  category: string | null;
  language: string;
  metaStatus: string | null;
  operationalStatus: string;
  channelLabel: string;
  hasImage: boolean;
  requiresHeaderMedia: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminTemplateListResponse = {
  templates: AdminTemplateListItem[];
  pagination: AdminTemplateListPagination;
};

export type AdminTemplateDetail = AdminTemplateListItem & {
  headerFormat: string | null;
  content: {
    header: {
      present: boolean;
      format: string | null;
      text: string;
      variables: number[];
      exampleText: string[];
      requiresMedia: boolean;
      mediaType: "image" | "video" | "document" | "location" | null;
    };
    body: {
      text: string;
      variables: number[];
      exampleValues: string[][];
    };
    footer: {
      text: string;
    };
    buttons: Array<{
      type: string;
      text: string;
      url: string | null;
      phoneNumber: string | null;
      variables: number[];
      exampleValues: string[];
      isDynamicUrl: boolean;
    }>;
    totalVariables: number;
    unknownComponents: string[];
    unknownButtonTypes: string[];
    compatibility: {
      canSendWithCurrentBuilder: boolean;
      requiresHeaderMediaConfiguration: boolean;
      hasUnsupportedDynamicHeader: boolean;
      hasUnsupportedDynamicButtons: boolean;
      unsupportedReasons: string[];
    };
  };
};

export type AdminTemplateDetailResponse = {
  template: AdminTemplateDetail;
};

export type ListAdminTemplateLibraryInput = AdminTemplateListFilters & {
  companyId: string;
  page: number;
  pageSize: number;
};

type AdminTemplateChannelRecord = {
  id: string;
  name: string;
  displayPhone: string | null;
  wabaId: string | null;
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

function normalizeSafeDisplayUrl(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function buildAdminTemplatePagination({
  page,
  pageSize,
  total
}: {
  page: number;
  pageSize: number;
  total: number;
}): AdminTemplateListPagination {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: totalPages > 0 && page < totalPages,
    hasPreviousPage: totalPages > 0 && page > 1
  };
}

function buildChannelLabel(channels: AdminTemplateChannelRecord[] | undefined) {
  if (!channels?.length) return "Canal nao identificado";
  if (channels.length > 1) return `${channels.length} canais`;

  const [channel] = channels;
  const name = channel.name.trim();
  const displayPhone = channel.displayPhone?.trim();

  if (name && displayPhone) return `${name} · ${displayPhone}`;
  if (name) return name;
  if (displayPhone) return displayPhone;
  return "Canal WhatsApp";
}

function mapAdminTemplateListItem({
  template,
  channelsByWaba
}: {
  template: AdminMetaTemplateListRecord;
  channelsByWaba: Map<string, AdminTemplateChannelRecord[]>;
}): AdminTemplateListItem {
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    language: template.language,
    metaStatus: template.metaStatus,
    operationalStatus: template.operationalStatus,
    channelLabel: buildChannelLabel(channelsByWaba.get(template.wabaId)),
    hasImage: Boolean(template.defaultHeaderMediaAssetId),
    requiresHeaderMedia: template.requiresHeaderMedia,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

function mapAdminTemplateDetail({
  template,
  channelsByWaba
}: {
  template: MetaTemplateLibraryEntry;
  channelsByWaba: Map<string, AdminTemplateChannelRecord[]>;
}): AdminTemplateDetail {
  const components = Array.isArray(template.components) ? template.components : [];
  const normalized = normalizeMetaTemplate({
    id: template.metaTemplateId ?? template.id,
    name: template.name,
    status: template.metaStatus ?? "",
    category: template.category ?? undefined,
    language: template.language,
    components
  } satisfies MetaTemplatePayload);

  return {
    id: template.id,
    name: template.name,
    category: template.category,
    language: template.language,
    metaStatus: template.metaStatus,
    operationalStatus: template.operationalStatus,
    channelLabel: buildChannelLabel(channelsByWaba.get(template.wabaId)),
    hasImage: Boolean(template.defaultHeaderMediaAssetId),
    requiresHeaderMedia: template.requiresHeaderMedia,
    headerFormat: template.headerFormat,
    isActive: template.isActive,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
    content: {
      header: {
        present: normalized.header.present,
        format: normalized.header.format,
        text: normalized.header.text,
        variables: normalized.header.variables,
        exampleText: normalized.header.exampleText,
        requiresMedia: normalized.header.requiresMedia,
        mediaType: normalized.headerMediaType
      },
      body: {
        text: normalized.body.text,
        variables: normalized.body.variables,
        exampleValues: normalized.body.exampleValues
      },
      footer: {
        text: normalized.footer.text
      },
      buttons: normalized.buttons.map((button) => ({
        type: button.type,
        text: button.text,
        url: normalizeSafeDisplayUrl(button.url),
        phoneNumber: button.phoneNumber,
        variables: button.variables,
        exampleValues: button.exampleValues,
        isDynamicUrl: button.isDynamicUrl
      })),
      totalVariables: normalized.totalVariables,
      unknownComponents: normalized.unknownComponents,
      unknownButtonTypes: normalized.unknownButtonTypes,
      compatibility: {
        canSendWithCurrentBuilder: normalized.compatibility.canSendWithCurrentBuilder,
        requiresHeaderMediaConfiguration:
          normalized.compatibility.requiresHeaderMediaConfiguration,
        hasUnsupportedDynamicHeader: normalized.compatibility.hasUnsupportedDynamicHeader,
        hasUnsupportedDynamicButtons: normalized.compatibility.hasUnsupportedDynamicButtons,
        unsupportedReasons: normalized.compatibility.unsupportedReasons
      }
    }
  };
}

function assertComponentsField(value: unknown, fieldName: string) {
  if (!isValidMetaTemplateComponentsField(value)) {
    throw new MetaTemplateServiceError("INVALID_INPUT", `${fieldName} deve ser um array.`);
  }

  return value;
}

function readComponentType(component: unknown) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return null;
  const type = (component as { type?: unknown }).type;
  return typeof type === "string" ? type.trim().toUpperCase() : null;
}

function readComponentFormat(component: unknown) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return null;
  const format = (component as { format?: unknown }).format;
  return typeof format === "string" ? format.trim().toUpperCase() : null;
}

function readHeaderFormatFromComponents(components: unknown[]) {
  const header = components.find((component) => readComponentType(component) === "HEADER");
  return header ? readComponentFormat(header) : null;
}

function requiresHeaderMediaFromFormat(headerFormat: string | null) {
  return headerFormat === "IMAGE" || headerFormat === "DOCUMENT" || headerFormat === "VIDEO";
}

function buildCreatedTemplateSupportFlags(headerFormat: string | null) {
  if (headerFormat === "DOCUMENT") {
    return {
      canSendWithCurrentBuilder: false,
      unsupportedReasons: ["HEADER_DOCUMENT_UNSUPPORTED"]
    };
  }

  if (headerFormat === "VIDEO") {
    return {
      canSendWithCurrentBuilder: false,
      unsupportedReasons: ["HEADER_VIDEO_UNSUPPORTED"]
    };
  }

  return {
    canSendWithCurrentBuilder: true,
    unsupportedReasons: []
  };
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

export async function listAdminTemplateLibrary({
  companyId,
  q,
  channelId,
  category,
  language,
  metaStatus,
  operationalStatus,
  hasImage,
  page,
  pageSize
}: ListAdminTemplateLibraryInput): Promise<AdminTemplateListResponse> {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  let wabaId: string | undefined;

  if (channelId) {
    const channel = await prisma.channel.findFirst({
      where: {
        id: normalizeRequiredString(channelId, "channelId"),
        companyId: safeCompanyId,
        type: "whatsapp",
        provider: "meta"
      },
      select: {
        id: true,
        wabaId: true
      }
    });

    if (!channel) {
      throw new MetaTemplateServiceError("CHANNEL_NOT_FOUND", "Canal nao encontrado.");
    }

    if (!channel.wabaId?.trim()) {
      return {
        templates: [],
        pagination: buildAdminTemplatePagination({ page, pageSize, total: 0 })
      };
    }

    wabaId = channel.wabaId.trim();
  }

  const { templates, total } = await listMetaTemplatesForAdmin({
    companyId: safeCompanyId,
    q: normalizeOptionalString(q) ?? undefined,
    wabaId,
    category: normalizeOptionalString(category) ?? undefined,
    language: normalizeOptionalString(language) ?? undefined,
    metaStatus: normalizeOptionalString(metaStatus) ?? undefined,
    operationalStatus: normalizeOptionalString(operationalStatus) ?? undefined,
    hasImage,
    page,
    pageSize
  });
  const wabaIds = Array.from(new Set(templates.map((template) => template.wabaId)));
  const channels =
    wabaIds.length > 0
      ? await prisma.channel.findMany({
          where: {
            companyId: safeCompanyId,
            provider: "meta",
            type: "whatsapp",
            wabaId: { in: wabaIds }
          },
          select: {
            id: true,
            name: true,
            displayPhone: true,
            wabaId: true
          },
          orderBy: [{ name: "asc" }, { id: "asc" }]
        })
      : [];
  const channelsByWaba = new Map<string, AdminTemplateChannelRecord[]>();

  for (const channel of channels) {
    const safeWabaId = channel.wabaId?.trim();
    if (!safeWabaId) continue;

    const current = channelsByWaba.get(safeWabaId) ?? [];
    current.push(channel);
    channelsByWaba.set(safeWabaId, current);
  }

  return {
    templates: templates.map((template) =>
      mapAdminTemplateListItem({ template, channelsByWaba })
    ),
    pagination: buildAdminTemplatePagination({ page, pageSize, total })
  };
}

export async function getAdminTemplateDetail({
  companyId,
  templateId
}: {
  companyId: string;
  templateId: string;
}): Promise<AdminTemplateDetailResponse> {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const safeTemplateId = normalizeRequiredString(templateId, "templateId");
  const templateRecord = await findMetaTemplateById(safeCompanyId, safeTemplateId);

  if (!templateRecord) {
    throw new MetaTemplateServiceError("TEMPLATE_NOT_FOUND", "Template nao encontrado.");
  }

  const template = deserializeMetaTemplate(templateRecord);
  const channels = await prisma.channel.findMany({
    where: {
      companyId: safeCompanyId,
      provider: "meta",
      type: "whatsapp",
      wabaId: template.wabaId
    },
    select: {
      id: true,
      name: true,
      displayPhone: true,
      wabaId: true
    },
    orderBy: [{ name: "asc" }, { id: "asc" }]
  });
  const channelsByWaba = new Map<string, AdminTemplateChannelRecord[]>();
  const safeWabaId = template.wabaId.trim();

  if (safeWabaId) {
    channelsByWaba.set(safeWabaId, channels);
  }

  return {
    template: mapAdminTemplateDetail({ template, channelsByWaba })
  };
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
  storedMedia: StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>;
}) {
  return {
    scope: "META_TEMPLATE_HEADER",
    ...(channelId?.trim() ? { channelId: channelId.trim() } : {}),
    originalFileName: storedMedia.originalFileName,
    storedFileName: storedMedia.storedFileName,
    checksumAlgorithm: storedMedia.checksumAlgorithm
  };
}

function getTemplateHeaderMediaAssetType(
  headerType: TemplateHeaderMediaHeaderType
): TemplateHeaderMediaAssetType {
  switch (headerType) {
    case "IMAGE":
      return "TEMPLATE_HEADER_IMAGE";
    case "DOCUMENT":
      return "TEMPLATE_HEADER_DOCUMENT";
    case "VIDEO":
      return "TEMPLATE_HEADER_VIDEO";
  }
}

function isUsableTemplateHeaderImageAsset(mediaAsset: MediaAsset) {
  return (
    mediaAsset.companyId.trim().length > 0 &&
    mediaAsset.type === "TEMPLATE_HEADER_IMAGE" &&
    mediaAsset.mimeType.startsWith("image/") &&
    Boolean(mediaAsset.publicUrl?.trim().match(/^https:\/\//i))
  );
}

export async function resolveDefaultHeaderMediaAssetForTemplate({
  companyId,
  normalizedTemplate,
  existingDefaultHeaderMediaAssetId,
  findMediaAsset = findMediaAssetByHeaderHandle
}: {
  companyId: string;
  normalizedTemplate: NormalizedMetaTemplate;
  existingDefaultHeaderMediaAssetId?: string | null;
  findMediaAsset?: HeaderMediaAssetLookup;
}) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const preservedMediaAssetId = normalizeOptionalString(existingDefaultHeaderMediaAssetId);

  if (preservedMediaAssetId) {
    return preservedMediaAssetId;
  }

  if (!normalizedTemplate.requiresHeaderMedia || normalizedTemplate.header.format !== "IMAGE") {
    return null;
  }

  const headerHandle = normalizeOptionalString(normalizedTemplate.header.exampleHandles[0]);
  if (!headerHandle) {
    return null;
  }

  const mediaAsset = await findMediaAsset(safeCompanyId, headerHandle);
  if (!mediaAsset || mediaAsset.companyId !== safeCompanyId) {
    return null;
  }

  return isUsableTemplateHeaderImageAsset(mediaAsset) ? mediaAsset.id : null;
}

function mediaNeedsStorageRefresh(
  mediaAsset: MediaAsset,
  mediaAssetType: TemplateHeaderMediaAssetType,
  storedMedia: StoredTemplateMedia<TemplateHeaderMediaMimeType, TemplateHeaderMediaExtension>,
  metadata: string | null
) {
  return (
    mediaAsset.type !== mediaAssetType ||
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
  headerType,
  storedMedia
}: PersistTemplateHeaderMediaAssetInput) {
  const safeCompanyId = normalizeRequiredString(companyId, "companyId");
  const mediaAssetType = getTemplateHeaderMediaAssetType(headerType);
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

    if (!mediaNeedsStorageRefresh(existing, mediaAssetType, storedMedia, metadata)) {
      return deserializeMediaAsset(existing);
    }

    const updated = await updateMediaAssetStorageDetails(safeCompanyId, existing.id, {
      type: mediaAssetType,
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
      type: mediaAssetType,
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
  const safeDefaultHeaderMediaAssetId = normalizeOptionalString(defaultHeaderMediaAssetId);
  const safeComponents = assertComponentsField(components, "MetaTemplate.components");
  const headerFormat = readHeaderFormatFromComponents(safeComponents);
  const requiresHeaderMedia = requiresHeaderMediaFromFormat(headerFormat);

  if (safeDefaultHeaderMediaAssetId) {
    const mediaAsset = await findMediaAssetById(safeCompanyId, safeDefaultHeaderMediaAssetId);

    if (!mediaAsset) {
      throw new MetaTemplateServiceError("MEDIA_ASSET_NOT_FOUND", "Midia nao encontrada.");
    }
  }

  const supportFlags = assertSupportFlagsField(
    buildCreatedTemplateSupportFlags(headerFormat),
    "MetaTemplate.supportFlags"
  );
  const operationalStatus = calculateMetaTemplateOperationalStatus({
    metaStatus,
    requiresHeaderMedia,
    defaultHeaderMediaAssetId: safeDefaultHeaderMediaAssetId,
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
    requiresHeaderMedia,
    headerFormat,
    components: serializeJsonField(safeComponents, "MetaTemplate.components") ?? "[]",
    rawPayload: serializeJsonField(rawPayload, "MetaTemplate.rawPayload"),
    supportFlags: serializeJsonField(supportFlags, "MetaTemplate.supportFlags"),
    defaultHeaderMediaAssetId: safeDefaultHeaderMediaAssetId,
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
