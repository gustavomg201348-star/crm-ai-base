const PUBLIC_META_PERMISSIONS = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "whatsapp_business_manage_events"
];

const MAX_PUBLIC_MESSAGE_LENGTH = 220;

type MetaDiagnostics = {
  ok?: boolean;
  tokenPreview?: string | null;
  token?: {
    ok?: boolean;
    id?: string | null;
    name?: string | null;
    appId?: string | null;
    tokenType?: string | null;
    expiresAt?: number | null;
    error?: unknown;
  };
  permissions?: {
    ok?: boolean;
    detected?: unknown;
    required?: unknown;
    missing?: unknown;
    optionalMissing?: unknown;
    error?: unknown;
  };
  waba?: {
    ok?: boolean;
    id?: unknown;
    name?: string | null;
    error?: unknown;
  };
  phone?: {
    ok?: boolean;
    id?: unknown;
    displayPhone?: unknown;
    verifiedName?: string | null;
    qualityRating?: string | null;
    wabaId?: unknown;
    belongsToWaba?: boolean;
    error?: unknown;
  };
  checklist?: {
    tokenValid?: boolean;
    permissionsChecked?: boolean;
    wabaAccessible?: boolean;
    phoneFound?: boolean;
    phoneBelongsToWaba?: boolean;
  };
};

function sanitizePublicMessage(value?: unknown) {
  if (typeof value !== "string" || !value) return null;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:EAAG|EAAJ|EAAI)[A-Za-z0-9_-]{12,}\b/g, "[redacted-token]")
    .replace(/\b\d{7,20}\b/g, "[redacted-id]")
    .slice(0, MAX_PUBLIC_MESSAGE_LENGTH);
}

function maskExternalId(value?: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 6) return "***";

  return `${trimmed.slice(0, 2)}...${trimmed.slice(-4)}`;
}

function maskDisplayPhone(value?: unknown) {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "***";

  return `***${digits.slice(-4)}`;
}

function sanitizePermissionList(values?: unknown) {
  const allowed = new Set(PUBLIC_META_PERMISSIONS);
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter((value): value is string => typeof value === "string" && allowed.has(value));
}

export function sanitizeMetaDiagnostics(diagnostics: MetaDiagnostics) {
  const required = sanitizePermissionList(diagnostics.permissions?.required);
  const missing = sanitizePermissionList(diagnostics.permissions?.missing);
  const optionalMissing = sanitizePermissionList(diagnostics.permissions?.optionalMissing);
  const detected = sanitizePermissionList(diagnostics.permissions?.detected);

  return {
    ok: Boolean(diagnostics.ok),
    valid: Boolean(diagnostics.ok),
    connected: Boolean(diagnostics.ok),
    status: diagnostics.ok ? "CONNECTED" : "ACTION_REQUIRED",
    code: diagnostics.ok ? "META_VALID" : "META_VALIDATION_FAILED",
    message: diagnostics.ok
      ? "Integracao Meta validada."
      : "Nao foi possivel validar completamente a integracao Meta.",
    hasAccessToken: Boolean(diagnostics.tokenPreview || diagnostics.token?.ok),
    hasWaba: Boolean(diagnostics.waba?.id),
    hasPhoneNumber: Boolean(diagnostics.phone?.id),
    permissionsOk: Boolean(diagnostics.permissions?.ok),
    webhookConfigured: null,
    businessVerified: null,
    phoneStatus: diagnostics.phone?.ok ? "FOUND" : "NOT_FOUND",
    qualityRating: diagnostics.phone?.qualityRating ?? null,
    templateAccess: null,
    tokenPreview: diagnostics.tokenPreview ? "cadastrado" : null,
    token: {
      ok: Boolean(diagnostics.token?.ok),
      id: null,
      name: null,
      appId: null,
      tokenType: diagnostics.token?.tokenType ?? null,
      expiresAt: diagnostics.token?.expiresAt ?? null,
      error: sanitizePublicMessage(diagnostics.token?.error)
    },
    permissions: {
      ok: Boolean(diagnostics.permissions?.ok),
      detected,
      required,
      missing,
      optionalMissing,
      error: sanitizePublicMessage(diagnostics.permissions?.error)
    },
    waba: {
      ok: Boolean(diagnostics.waba?.ok),
      id: maskExternalId(diagnostics.waba?.id),
      name: diagnostics.waba?.ok ? diagnostics.waba?.name ?? null : null,
      error: sanitizePublicMessage(diagnostics.waba?.error)
    },
    phone: {
      ok: Boolean(diagnostics.phone?.ok),
      id: maskExternalId(diagnostics.phone?.id),
      displayPhone: maskDisplayPhone(diagnostics.phone?.displayPhone),
      verifiedName: diagnostics.phone?.ok ? diagnostics.phone?.verifiedName ?? null : null,
      qualityRating: diagnostics.phone?.qualityRating ?? null,
      wabaId: maskExternalId(diagnostics.phone?.wabaId),
      belongsToWaba: Boolean(diagnostics.phone?.belongsToWaba),
      error: sanitizePublicMessage(diagnostics.phone?.error)
    },
    checklist: {
      tokenValid: Boolean(diagnostics.checklist?.tokenValid),
      permissionsChecked: Boolean(diagnostics.checklist?.permissionsChecked),
      wabaAccessible: Boolean(diagnostics.checklist?.wabaAccessible),
      phoneFound: Boolean(diagnostics.checklist?.phoneFound),
      phoneBelongsToWaba: Boolean(diagnostics.checklist?.phoneBelongsToWaba)
    },
    warnings: [],
    errors: diagnostics.ok
      ? []
      : [
          sanitizePublicMessage(diagnostics.token?.error),
          sanitizePublicMessage(diagnostics.permissions?.error),
          sanitizePublicMessage(diagnostics.waba?.error),
          sanitizePublicMessage(diagnostics.phone?.error)
        ].filter((error): error is string => Boolean(error))
  };
}
