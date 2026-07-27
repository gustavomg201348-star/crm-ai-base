export type MetaTemplateClientInput = {
  companyId: string;
  wabaId: string;
  accessToken: string;
  signal?: AbortSignal;
  pageLimit?: number;
};

export type MetaTemplateClientError = {
  code:
    | "INVALID_INPUT"
    | "META_AUTH_ERROR"
    | "META_RATE_LIMIT"
    | "META_SERVER_ERROR"
    | "META_GRAPH_ERROR"
    | "META_TIMEOUT"
    | "META_FETCH_ERROR"
    | "META_INVALID_RESPONSE";
  message: string;
  retryable: boolean;
};

export type MetaTemplateClientResult = {
  complete: boolean;
  templates: unknown[];
  warnings: string[];
  errors: MetaTemplateClientError[];
  nextCursor: string | null;
  pagesFetched: number;
  totalFetched: number;
};

type MetaTemplateClientFetch = typeof fetch;

type MetaTemplateClientOptions = {
  fetcher?: MetaTemplateClientFetch;
  graphVersion?: string;
  timeoutMs?: number;
};

const DEFAULT_GRAPH_VERSION = "v20.0";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 30_000;
const MESSAGE_TEMPLATE_FIELDS = "id,name,status,category,language,components";
const RATE_LIMIT_ERROR_CODES = new Set(["4", "17", "32", "613", "80004"]);
const AUTH_ERROR_CODES = new Set(["190", "102", "10", "200", "294"]);

function createEmptyResult(): MetaTemplateClientResult {
  return {
    complete: true,
    templates: [],
    warnings: [],
    errors: [],
    nextCursor: null,
    pagesFetched: 0,
    totalFetched: 0
  };
}

function normalizeRequiredString(value: string | null | undefined, fieldName: string) {
  const normalized = value?.trim();

  if (!normalized) {
    return {
      ok: false as const,
      error: {
        code: "INVALID_INPUT" as const,
        message: `${fieldName} obrigatorio.`,
        retryable: false
      }
    };
  }

  return { ok: true as const, value: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readGraphErrorCode(value: unknown) {
  if (!isRecord(value)) return null;
  const error = isRecord(value.error) ? value.error : null;
  const rawCode = error?.code;

  if (typeof rawCode === "number" || typeof rawCode === "string") {
    return String(rawCode);
  }

  return null;
}

function readAfterCursor(value: unknown) {
  if (!isRecord(value)) return null;
  const paging = isRecord(value.paging) ? value.paging : null;
  const cursors = paging && isRecord(paging.cursors) ? paging.cursors : null;
  return readString(cursors?.after);
}

function readNextUrl(value: unknown) {
  if (!isRecord(value)) return null;
  const paging = isRecord(value.paging) ? value.paging : null;
  return readString(paging?.next);
}

function hasGraphError(value: unknown) {
  return isRecord(value) && isRecord(value.error);
}

function mapStatusError(status: number): MetaTemplateClientError {
  if (status === 401 || status === 403) {
    return {
      code: "META_AUTH_ERROR",
      message: "Credenciais da Meta invalidas ou sem permissao para consultar templates.",
      retryable: false
    };
  }

  if (status === 429) {
    return {
      code: "META_RATE_LIMIT",
      message: "Limite da Meta atingido ao consultar templates.",
      retryable: true
    };
  }

  if (status >= 500) {
    return {
      code: "META_SERVER_ERROR",
      message: "Falha temporaria da Meta ao consultar templates.",
      retryable: true
    };
  }

  return {
    code: "META_GRAPH_ERROR",
    message: "A Meta retornou erro ao consultar templates.",
    retryable: false
  };
}

function mapGraphPayloadError(payload: unknown): MetaTemplateClientError {
  const code = readGraphErrorCode(payload);

  if (code && AUTH_ERROR_CODES.has(code)) {
    return {
      code: "META_AUTH_ERROR",
      message: "Credenciais da Meta invalidas ou sem permissao para consultar templates.",
      retryable: false
    };
  }

  if (code && RATE_LIMIT_ERROR_CODES.has(code)) {
    return {
      code: "META_RATE_LIMIT",
      message: "Limite da Meta atingido ao consultar templates.",
      retryable: true
    };
  }

  return {
    code: "META_GRAPH_ERROR",
    message: "A Meta retornou erro ao consultar templates.",
    retryable: false
  };
}

function createTemplatesUrl({
  graphVersion,
  wabaId,
  after
}: {
  graphVersion: string;
  wabaId: string;
  after?: string | null;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates`
  );
  url.searchParams.set("fields", MESSAGE_TEMPLATE_FIELDS);
  url.searchParams.set("limit", String(DEFAULT_PAGE_LIMIT));

  if (after) {
    url.searchParams.set("after", after);
  }

  return url.toString();
}

function createTimeoutSignal(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const clear = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    clear
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export class MetaTemplateClient {
  private readonly fetcher: MetaTemplateClientFetch;
  private readonly graphVersion: string;
  private readonly timeoutMs: number;

  constructor(options: MetaTemplateClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.graphVersion =
      options.graphVersion?.trim() || process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchAllMetaTemplates(input: MetaTemplateClientInput) {
    const companyId = normalizeRequiredString(input.companyId, "companyId");
    const wabaId = normalizeRequiredString(input.wabaId, "wabaId");
    const accessToken = normalizeRequiredString(input.accessToken, "accessToken");
    const result = createEmptyResult();

    if (!companyId.ok) {
      result.complete = false;
      result.errors.push(companyId.error);
      return result;
    }

    if (!wabaId.ok) {
      result.complete = false;
      result.errors.push(wabaId.error);
      return result;
    }

    if (!accessToken.ok) {
      result.complete = false;
      result.errors.push(accessToken.error);
      return result;
    }

    const pageLimit =
      typeof input.pageLimit === "number" && Number.isInteger(input.pageLimit)
        ? input.pageLimit
        : null;
    let nextUrl: string | null = createTemplatesUrl({
      graphVersion: this.graphVersion,
      wabaId: wabaId.value
    });
    let nextCursor: string | null = null;

    while (nextUrl) {
      if (pageLimit !== null && result.pagesFetched >= pageLimit) {
        result.complete = false;
        result.nextCursor = nextCursor;
        result.warnings.push("PAGE_LIMIT_REACHED");
        return result;
      }

      const timeout = createTimeoutSignal(input.signal, this.timeoutMs);
      let response: Response;

      try {
        response = await this.fetcher(nextUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken.value}`
          },
          signal: timeout.signal
        });
      } catch (error) {
        timeout.clear();
        result.complete = false;
        result.errors.push(
          isAbortError(error)
            ? {
                code: "META_TIMEOUT",
                message: "Tempo limite excedido ao consultar templates da Meta.",
                retryable: true
              }
            : {
                code: "META_FETCH_ERROR",
                message: "Falha de rede ao consultar templates da Meta.",
                retryable: true
              }
        );
        return result;
      } finally {
        timeout.clear();
      }

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        result.complete = false;
        result.errors.push(mapStatusError(response.status));
        return result;
      }

      if (hasGraphError(payload)) {
        result.complete = false;
        result.errors.push(mapGraphPayloadError(payload));
        return result;
      }

      if (!isRecord(payload) || !Array.isArray(payload.data)) {
        result.complete = false;
        result.errors.push({
          code: "META_INVALID_RESPONSE",
          message: "A Meta retornou uma resposta invalida ao consultar templates.",
          retryable: true
        });
        return result;
      }

      result.pagesFetched += 1;
      result.templates.push(...payload.data);
      result.totalFetched = result.templates.length;
      nextCursor = readAfterCursor(payload);
      result.nextCursor = nextCursor;

      const next = readNextUrl(payload);
      nextUrl =
        next ??
        (nextCursor
          ? createTemplatesUrl({
              graphVersion: this.graphVersion,
              wabaId: wabaId.value,
              after: nextCursor
            })
          : null);
    }

    result.nextCursor = null;
    return result;
  }
}

export async function fetchAllMetaTemplates(
  input: MetaTemplateClientInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).fetchAllMetaTemplates(input);
}
