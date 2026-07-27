import {
  normalizeMetaTemplate,
  type MetaTemplate,
  type NormalizedMetaTemplate
} from "@/lib/meta-template-normalizer";
import {
  MetaTemplateClient,
  type MetaTemplateClientInput,
  type MetaTemplateClientResult
} from "@/lib/meta-template-client";

export type SyncMetaTemplatesForWabaInput = {
  companyId: string;
  wabaId: string;
  accessToken: string;
  channelId?: string | null;
  signal?: AbortSignal;
  pageLimit?: number;
  reason: string;
};

export type MetaTemplateSyncError = {
  code: string;
  message: string;
  retryable: boolean;
  template?: {
    name?: string;
    language?: string;
    metaTemplateId?: string | null;
  };
};

export type MetaTemplateSyncResult = {
  companyId: string;
  wabaId: string;
  channelId: string | null;
  reason: string;
  startedAt: Date;
  finishedAt: Date;
  complete: boolean;
  totalFetched: number;
  totalDeduplicated: number;
  totalNormalized: number;
  created: number;
  updated: number;
  reactivated: number;
  markedNotReturned: number;
  skipped: number;
  failed: number;
  warnings: string[];
  errors: MetaTemplateSyncError[];
};

export type MetaTemplateSyncExistingTemplate = {
  id: string;
  companyId: string;
  wabaId: string;
  name: string;
  language: string;
  isActive: boolean;
  operationalStatus: string;
  defaultHeaderMediaAssetId?: string | null;
};

export type MetaTemplateSyncUpsertInput = {
  companyId: string;
  wabaId: string;
  template: NormalizedMetaTemplate;
  rawPayload: unknown;
  now: Date;
  existingDefaultHeaderMediaAssetId?: string | null;
};

type MetaTemplateClientPort = {
  fetchAllMetaTemplates: (
    input: MetaTemplateClientInput
  ) => Promise<MetaTemplateClientResult>;
};

export type MetaTemplateSyncDependencies = {
  metaTemplateClient?: MetaTemplateClientPort;
  findExistingTemplate: (input: {
    companyId: string;
    wabaId: string;
    name: string;
    language: string;
  }) => Promise<MetaTemplateSyncExistingTemplate | null>;
  upsertTemplate: (
    input: MetaTemplateSyncUpsertInput
  ) => Promise<MetaTemplateSyncExistingTemplate>;
  listActiveTemplatesByWaba: (input: {
    companyId: string;
    wabaId: string;
  }) => Promise<MetaTemplateSyncExistingTemplate[]>;
  markTemplateNotReturned: (input: {
    companyId: string;
    templateId: string;
  }) => Promise<MetaTemplateSyncExistingTemplate>;
  now?: () => Date;
};

type DeduplicatedMetaTemplate = {
  key: string;
  template: MetaTemplate;
  rawPayload: unknown;
};

const MAX_SYNC_MESSAGE_LENGTH = 300;
const KNOWN_DOMAIN_ERROR_CODES = new Set([
  "META_TEMPLATE_ID_CONFLICT",
  "TEMPLATE_NOT_FOUND",
  "INVALID_INPUT"
]);

function limitMessage(value: string, maxLength = MAX_SYNC_MESSAGE_LENGTH) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}...`
    : normalized;
}

function normalizeRequiredString(value: string | null | undefined, fieldName: string) {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${fieldName} obrigatorio.`);
  }

  return normalized;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMetaTemplate(value: unknown): MetaTemplate | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readOptionalString(value.name);
  const status = readOptionalString(value.status);
  const language = readOptionalString(value.language);
  const components = value.components;

  if (!name || !status || !language || !Array.isArray(components)) {
    return null;
  }

  return {
    ...value,
    id: readOptionalString(value.id),
    name,
    status,
    category: readOptionalString(value.category),
    language,
    components
  };
}

function readErrorCode(error: unknown) {
  if (!isRecord(error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (!isRecord(error)) return "Erro desconhecido.";
  return typeof error.message === "string" ? error.message : "Erro desconhecido.";
}

function defaultMessageForErrorCode(code: string) {
  switch (code) {
    case "FETCH_FAILED":
      return "Falha ao buscar templates na origem.";
    case "FETCH_INVALID_RESULT":
      return "A origem retornou um resultado de sincronizacao invalido.";
    case "FETCH_ERROR":
      return "A origem informou erro ao buscar templates.";
    case "FETCH_INCOMPLETE":
      return "A origem informou sincronizacao incompleta; templates nao retornados nao serao marcados.";
    case "NORMALIZATION_FAILED":
    case "INVALID_TEMPLATE_PAYLOAD":
      return "Template remoto ignorado por payload invalido.";
    case "UPSERT_FAILED":
      return "Falha ao salvar template sincronizado.";
    case "LIST_LOCAL_TEMPLATES_FAILED":
      return "Falha ao listar templates locais.";
    case "MARK_NOT_RETURNED_FAILED":
      return "Falha ao atualizar template nao retornado.";
    default:
      return "Falha interna durante a sincronizacao.";
  }
}

function normalizeIdentityPart(value: string) {
  return value.trim().toLowerCase();
}

export function buildMetaTemplateIdentityKey({
  companyId,
  wabaId,
  name,
  language
}: {
  companyId: string;
  wabaId: string;
  name: string;
  language: string;
}) {
  return [
    normalizeIdentityPart(companyId),
    normalizeIdentityPart(wabaId),
    normalizeIdentityPart(name),
    normalizeIdentityPart(language)
  ].join("::");
}

export function sanitizeMetaTemplateSyncError(
  error: unknown,
  fallbackCode = "INTERNAL_ERROR",
  retryable = false,
  template?: MetaTemplateSyncError["template"]
): MetaTemplateSyncError {
  const repositoryCode = readErrorCode(error);
  const code =
    repositoryCode === "META_TEMPLATE_ID_CONFLICT"
      ? "META_TEMPLATE_ID_CONFLICT"
      : fallbackCode;
  const domainMessage =
    KNOWN_DOMAIN_ERROR_CODES.has(code) && readErrorMessage(error).trim()
      ? limitMessage(readErrorMessage(error))
      : null;

  return {
    code,
    message: domainMessage ?? defaultMessageForErrorCode(code),
    retryable,
    ...(template ? { template } : {})
  };
}

export function createEmptyMetaTemplateSyncResult({
  companyId,
  wabaId,
  channelId,
  reason,
  startedAt
}: {
  companyId: string;
  wabaId: string;
  channelId: string | null;
  reason: string;
  startedAt: Date;
}): MetaTemplateSyncResult {
  return {
    companyId,
    wabaId,
    channelId,
    reason,
    startedAt,
    finishedAt: startedAt,
    complete: true,
    totalFetched: 0,
    totalDeduplicated: 0,
    totalNormalized: 0,
    created: 0,
    updated: 0,
    reactivated: 0,
    markedNotReturned: 0,
    skipped: 0,
    failed: 0,
    warnings: [],
    errors: []
  };
}

export function deduplicateMetaTemplates({
  companyId,
  wabaId,
  templates
}: {
  companyId: string;
  wabaId: string;
  templates: unknown[];
}) {
  const deduplicated = new Map<string, DeduplicatedMetaTemplate>();
  const warnings: string[] = [];
  let skipped = 0;
  const errors: MetaTemplateSyncError[] = [];

  for (const rawTemplate of templates) {
    const template = toMetaTemplate(rawTemplate);

    if (!template) {
      skipped += 1;
      errors.push({
        code: "INVALID_TEMPLATE_PAYLOAD",
        message: defaultMessageForErrorCode("INVALID_TEMPLATE_PAYLOAD"),
        retryable: false
      });
      continue;
    }

    const key = buildMetaTemplateIdentityKey({
      companyId,
      wabaId,
      name: template.name,
      language: template.language
    });

    if (deduplicated.has(key)) {
      warnings.push(
        `Template duplicado na origem para ${template.name}/${template.language}; a ultima ocorrencia foi usada.`
      );
    }

    deduplicated.set(key, {
      key,
      template,
      rawPayload: rawTemplate
    });
  }

  return {
    templates: Array.from(deduplicated.values()),
    warnings,
    skipped,
    errors,
    hasDuplicateIdentity: warnings.length > 0
  };
}

export function canMarkTemplatesNotReturned({
  fetchComplete,
  localComplete,
  hasDuplicateIdentity,
  errors
}: {
  fetchComplete: boolean;
  localComplete: boolean;
  hasDuplicateIdentity: boolean;
  errors: MetaTemplateSyncError[];
}) {
  return fetchComplete && localComplete && !hasDuplicateIdentity && errors.length === 0;
}

function templateErrorDetails(template?: MetaTemplate | NormalizedMetaTemplate) {
  if (!template) return undefined;
  const templateRecord: Record<string, unknown> = isRecord(template) ? template : {};

  return {
    name: template.name,
    language: template.language,
    metaTemplateId:
      "metaId" in template
        ? readOptionalNullableString(templateRecord["metaId"])
        : readOptionalNullableString(templateRecord["id"])
  };
}

function markIncomplete(result: MetaTemplateSyncResult) {
  result.complete = false;
}

async function markNotReturnedTemplates({
  input,
  dependencies,
  seenKeys,
  result
}: {
  input: {
    companyId: string;
    wabaId: string;
  };
  dependencies: MetaTemplateSyncDependencies;
  seenKeys: Set<string>;
  result: MetaTemplateSyncResult;
}) {
  let activeTemplates: MetaTemplateSyncExistingTemplate[];

  try {
    activeTemplates = await dependencies.listActiveTemplatesByWaba({
      companyId: input.companyId,
      wabaId: input.wabaId
    });
  } catch (error) {
    result.failed += 1;
    result.errors.push(
      sanitizeMetaTemplateSyncError(error, "LIST_LOCAL_TEMPLATES_FAILED", true)
    );
    markIncomplete(result);
    return;
  }

  for (const template of activeTemplates) {
    const key = buildMetaTemplateIdentityKey({
      companyId: input.companyId,
      wabaId: input.wabaId,
      name: template.name,
      language: template.language
    });

    if (seenKeys.has(key)) {
      continue;
    }

    try {
      await dependencies.markTemplateNotReturned({
        companyId: input.companyId,
        templateId: template.id
      });
      result.markedNotReturned += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        sanitizeMetaTemplateSyncError(error, "MARK_NOT_RETURNED_FAILED", true, {
          name: template.name,
          language: template.language
        })
      );
      markIncomplete(result);
    }
  }
}

export async function syncMetaTemplatesForWaba(
  rawInput: SyncMetaTemplatesForWabaInput,
  dependencies: MetaTemplateSyncDependencies
): Promise<MetaTemplateSyncResult> {
  const now = dependencies.now ?? (() => new Date());
  const input = {
    companyId: normalizeRequiredString(rawInput.companyId, "companyId"),
    wabaId: normalizeRequiredString(rawInput.wabaId, "wabaId"),
    channelId: rawInput.channelId?.trim() || null,
    reason: normalizeRequiredString(rawInput.reason, "reason")
  };
  const result = createEmptyMetaTemplateSyncResult({
    ...input,
    startedAt: now()
  });
  const metaTemplateClient = dependencies.metaTemplateClient ?? new MetaTemplateClient();
  let fetchResult: MetaTemplateClientResult;

  try {
    fetchResult = await metaTemplateClient.fetchAllMetaTemplates({
      companyId: input.companyId,
      wabaId: input.wabaId,
      accessToken: rawInput.accessToken,
      signal: rawInput.signal,
      pageLimit: rawInput.pageLimit
    });
  } catch (error) {
    result.failed += 1;
    result.errors.push(sanitizeMetaTemplateSyncError(error, "FETCH_FAILED", true));
    markIncomplete(result);
    result.finishedAt = now();
    return result;
  }

  result.totalFetched = fetchResult.templates.length;
  result.warnings.push(...fetchResult.warnings);
  result.errors.push(...fetchResult.errors);

  if (!fetchResult.complete) {
    result.errors.push({
      code: "FETCH_INCOMPLETE",
      message: "A origem informou sincronizacao incompleta; templates nao retornados nao serao marcados.",
      retryable: true
    });
    markIncomplete(result);
  }

  if (fetchResult.errors.length > 0) {
    markIncomplete(result);
  }

  const deduplicated = deduplicateMetaTemplates({
    companyId: input.companyId,
    wabaId: input.wabaId,
    templates: fetchResult.templates
  });
  result.totalDeduplicated = deduplicated.templates.length;
  result.skipped += deduplicated.skipped;
  result.warnings.push(...deduplicated.warnings);
  result.errors.push(...deduplicated.errors);

  if (deduplicated.errors.length > 0 || deduplicated.hasDuplicateIdentity) {
    markIncomplete(result);
  }

  const seenKeys = new Set<string>();

  for (const item of deduplicated.templates) {
    let normalized: NormalizedMetaTemplate;

    try {
      normalized = normalizeMetaTemplate(item.template);
      result.totalNormalized += 1;
    } catch (error) {
      result.skipped += 1;
      result.errors.push(
        sanitizeMetaTemplateSyncError(
          error,
          "NORMALIZATION_FAILED",
          false,
          templateErrorDetails(item.template)
        )
      );
      markIncomplete(result);
      continue;
    }

    try {
      const existing = await dependencies.findExistingTemplate({
        companyId: input.companyId,
        wabaId: input.wabaId,
        name: normalized.name,
        language: normalized.language
      });

      await dependencies.upsertTemplate({
        companyId: input.companyId,
        wabaId: input.wabaId,
        template: normalized,
        rawPayload: item.rawPayload,
        now: now(),
        existingDefaultHeaderMediaAssetId: existing?.defaultHeaderMediaAssetId ?? null
      });

      seenKeys.add(item.key);

      if (!existing) {
        result.created += 1;
      } else if (!existing.isActive || existing.operationalStatus === "NOT_RETURNED") {
        result.reactivated += 1;
      } else {
        result.updated += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.errors.push(
        sanitizeMetaTemplateSyncError(
          error,
          readErrorCode(error) === "META_TEMPLATE_ID_CONFLICT"
            ? "META_TEMPLATE_ID_CONFLICT"
            : "UPSERT_FAILED",
          false,
          templateErrorDetails(normalized)
        )
      );
      markIncomplete(result);
    }
  }

  if (
    canMarkTemplatesNotReturned({
      fetchComplete: fetchResult.complete,
      localComplete: result.complete,
      hasDuplicateIdentity: deduplicated.hasDuplicateIdentity,
      errors: result.errors
    })
  ) {
    await markNotReturnedTemplates({
      input,
      dependencies,
      seenKeys,
      result
    });
  }

  // Sincronizacao automatica periodica em multiplas instancias deve avaliar lock distribuido
  // por companyId + wabaId antes de habilitar execucao concorrente.
  result.finishedAt = now();
  return result;
}
