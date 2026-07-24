export const metaTemplateOperationalStatuses = [
  "SYNCED",
  "NEEDS_MEDIA",
  "READY",
  "UNSUPPORTED",
  "NOT_RETURNED",
  "SYNC_ERROR"
] as const;

export type MetaTemplateOperationalStatus = (typeof metaTemplateOperationalStatuses)[number];

export type MetaTemplateSupportFlags = {
  canSendWithCurrentBuilder?: boolean;
  unsupportedReasons?: string[];
  compatibility?: {
    canSendWithCurrentBuilder?: boolean;
    unsupportedReasons?: string[];
  };
};

export type CalculateMetaTemplateOperationalStatusInput = {
  metaStatus?: string | null;
  requiresHeaderMedia: boolean;
  defaultHeaderMediaAssetId?: string | null;
  componentsSupported: boolean;
  syncError?: string | null;
  isActive: boolean;
};

export function isMetaTemplateSupportFlags(value: unknown): value is MetaTemplateSupportFlags {
  if (!isRecord(value)) {
    return false;
  }

  const compatibility = isRecord(value.compatibility) ? value.compatibility : null;

  return (
    typeof value.canSendWithCurrentBuilder === "boolean" ||
    Array.isArray(value.unsupportedReasons) ||
    typeof compatibility?.canSendWithCurrentBuilder === "boolean" ||
    Array.isArray(compatibility?.unsupportedReasons)
  );
}

export function isValidMetaTemplateComponentsField(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isValidMetaTemplateSupportFlagsField(
  value: unknown
): value is MetaTemplateSupportFlags | null | undefined {
  return value === null || value === undefined || isMetaTemplateSupportFlags(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function supportFlagsIndicateSupportedComponents(flags?: unknown) {
  if (!isMetaTemplateSupportFlags(flags)) {
    return false;
  }

  const compatibility = isRecord(flags.compatibility) ? flags.compatibility : null;
  const unsupportedReasons = [
    ...readStringArray(flags.unsupportedReasons),
    ...readStringArray(compatibility?.unsupportedReasons)
  ];

  if (unsupportedReasons.length > 0) {
    return false;
  }

  if (typeof flags.canSendWithCurrentBuilder === "boolean") {
    return flags.canSendWithCurrentBuilder;
  }

  if (typeof compatibility?.canSendWithCurrentBuilder === "boolean") {
    return compatibility.canSendWithCurrentBuilder;
  }

  return true;
}

export function calculateMetaTemplateOperationalStatus({
  metaStatus,
  requiresHeaderMedia,
  defaultHeaderMediaAssetId,
  componentsSupported,
  syncError,
  isActive
}: CalculateMetaTemplateOperationalStatusInput): MetaTemplateOperationalStatus {
  if (isNonEmptyString(syncError)) {
    return "SYNC_ERROR";
  }

  if (!isActive) {
    return "NOT_RETURNED";
  }

  if (!componentsSupported) {
    return "UNSUPPORTED";
  }

  if (metaStatus?.trim().toUpperCase() !== "APPROVED") {
    return "SYNCED";
  }

  if (requiresHeaderMedia && !isNonEmptyString(defaultHeaderMediaAssetId)) {
    return "NEEDS_MEDIA";
  }

  return "READY";
}
