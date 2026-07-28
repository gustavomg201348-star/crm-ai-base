export type MetaTemplateClientInput = {
  companyId: string;
  wabaId: string;
  accessToken: string;
  signal?: AbortSignal;
  pageLimit?: number;
};

export type MetaTemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION" | (string & {});

export type MetaTemplateApiComponentType =
  | "HEADER"
  | "BODY"
  | "FOOTER"
  | "BUTTONS"
  | (string & {});

export type MetaTemplateApiComponent = {
  type: MetaTemplateApiComponentType;
  format?: string;
  text?: string;
  example?: unknown;
  buttons?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type MetaTemplateClientErrorCode =
  | "INVALID_INPUT"
  | "META_AUTH_ERROR"
  | "META_RATE_LIMIT"
  | "META_SERVER_ERROR"
  | "META_GRAPH_ERROR"
  | "META_TIMEOUT"
  | "META_FETCH_ERROR"
  | "META_INVALID_RESPONSE"
  | "META_PAYLOAD_ERROR"
  | "META_CONFLICT"
  | "META_WABA_ERROR"
  | "META_UPLOAD_ERROR";

export type MetaTemplateClientOperation =
  | "LIST_TEMPLATES"
  | "CREATE_UPLOAD_SESSION"
  | "UPLOAD_TEMPLATE_FILE"
  | "CREATE_TEMPLATE"
  | "GET_TEMPLATE"
  | "DELETE_TEMPLATE";

export type MetaTemplateClientError = {
  code: MetaTemplateClientErrorCode;
  message: string;
  retryable: boolean;
  operation?: MetaTemplateClientOperation;
  httpStatus?: number;
  metaCode?: string | null;
  metaSubcode?: string | null;
  metaType?: string | null;
  fbtraceId?: string | null;
};

export class MetaTemplateClientRequestError extends Error {
  readonly code: MetaTemplateClientErrorCode;
  readonly retryable: boolean;
  readonly operation: MetaTemplateClientOperation;
  readonly httpStatus?: number;
  readonly metaCode?: string | null;
  readonly metaSubcode?: string | null;
  readonly metaType?: string | null;
  readonly fbtraceId?: string | null;

  constructor(error: MetaTemplateClientError & { operation: MetaTemplateClientOperation }) {
    super(error.message);
    this.name = "MetaTemplateClientRequestError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.operation = error.operation;
    this.httpStatus = error.httpStatus;
    this.metaCode = error.metaCode;
    this.metaSubcode = error.metaSubcode;
    this.metaType = error.metaType;
    this.fbtraceId = error.fbtraceId;
  }

  toJSON(): MetaTemplateClientError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      operation: this.operation,
      httpStatus: this.httpStatus,
      metaCode: this.metaCode,
      metaSubcode: this.metaSubcode,
      metaType: this.metaType,
      fbtraceId: this.fbtraceId
    };
  }
}

export type MetaTemplateClientResult = {
  complete: boolean;
  templates: unknown[];
  warnings: string[];
  errors: MetaTemplateClientError[];
  nextCursor: string | null;
  pagesFetched: number;
  totalFetched: number;
};

export type CreateTemplateUploadSessionInput = {
  appId: string;
  accessToken: string;
  fileName: string;
  fileLength: number;
  fileType: string;
  signal?: AbortSignal;
};

export type TemplateUploadSessionResult = {
  uploadSessionId: string;
  rawPayload: unknown;
};

export type UploadTemplateFileInput = {
  uploadSessionId: string;
  accessToken: string;
  fileBuffer: Uint8Array;
  fileType?: string | null;
  fileOffset?: number;
  signal?: AbortSignal;
};

export type TemplateFileUploadResult = {
  headerHandle: string;
  rawPayload: unknown;
};

export type CreateMetaMessageTemplateInput = {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  components: MetaTemplateApiComponent[];
  signal?: AbortSignal;
};

export type MetaMessageTemplateCreationResult = {
  id: string | null;
  status: string | null;
  category: string | null;
  rawPayload: unknown;
};

export type GetMetaMessageTemplateInput =
  | {
      accessToken: string;
      templateId: string;
      wabaId?: string | null;
      name?: string | null;
      signal?: AbortSignal;
    }
  | {
      accessToken: string;
      wabaId: string;
      name: string;
      templateId?: string | null;
      signal?: AbortSignal;
    };

export type MetaMessageTemplateQueryResult = {
  template: unknown | null;
  templates: unknown[];
  rawPayload: unknown;
};

export type DeleteMetaMessageTemplateInput = {
  wabaId: string;
  accessToken: string;
  name: string;
  templateId?: string | null;
  signal?: AbortSignal;
};

export type MetaMessageTemplateDeleteResult = {
  success: boolean;
  rawPayload: unknown;
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
const CONFLICT_ERROR_CODES = new Set(["2388024", "2388040"]);
const INVALID_WABA_ERROR_CODES = new Set(["100", "190", "200"]);

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

function requireString(
  value: string | null | undefined,
  fieldName: string,
  operation: MetaTemplateClientOperation
) {
  const normalized = normalizeRequiredString(value, fieldName);

  if (!normalized.ok) {
    throw new MetaTemplateClientRequestError({
      ...normalized.error,
      operation
    });
  }

  return normalized.value;
}

function requirePositiveInteger(
  value: number,
  fieldName: string,
  operation: MetaTemplateClientOperation
) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new MetaTemplateClientRequestError({
      code: "INVALID_INPUT",
      message: `${fieldName} deve ser um inteiro positivo.`,
      retryable: false,
      operation
    });
  }

  return value;
}

function requireNonNegativeInteger(
  value: number,
  fieldName: string,
  operation: MetaTemplateClientOperation
) {
  if (!Number.isInteger(value) || value < 0) {
    throw new MetaTemplateClientRequestError({
      code: "INVALID_INPUT",
      message: `${fieldName} deve ser um inteiro maior ou igual a zero.`,
      retryable: false,
      operation
    });
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readGraphError(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;

  const error = payload.error;
  const code = error.code;
  const subcode = error.error_subcode;

  return {
    message:
      readString(error.message) ??
      readString(isRecord(error.error_data) ? error.error_data.details : null),
    code: typeof code === "number" || typeof code === "string" ? String(code) : null,
    subcode:
      typeof subcode === "number" || typeof subcode === "string" ? String(subcode) : null,
    type: readString(error.type),
    fbtraceId: readString(error.fbtrace_id)
  };
}

function readGraphErrorCode(value: unknown) {
  return readGraphError(value)?.code ?? null;
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

function sanitizeMetaMessage(value: string | null, fallback: string) {
  if (!value) return fallback;

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/OAuth\s+[A-Za-z0-9._~+/=-]+/gi, "OAuth [redacted]")
    .replace(/access_token=([^&\s]+)/gi, "access_token=[redacted]");
}

function classifyGraphError({
  status,
  payload,
  operation
}: {
  status?: number;
  payload?: unknown;
  operation: MetaTemplateClientOperation;
}): MetaTemplateClientError {
  const metaError = readGraphError(payload);
  const metaCode = metaError?.code ?? null;
  const message = sanitizeMetaMessage(
    metaError?.message ?? null,
    defaultErrorMessageForOperation(operation)
  );

  if (status === 401 || status === 403 || (metaCode && AUTH_ERROR_CODES.has(metaCode))) {
    return {
      code: "META_AUTH_ERROR",
      message,
      retryable: false,
      operation,
      httpStatus: status,
      metaCode,
      metaSubcode: metaError?.subcode ?? null,
      metaType: metaError?.type ?? null,
      fbtraceId: metaError?.fbtraceId ?? null
    };
  }

  if (status === 429 || (metaCode && RATE_LIMIT_ERROR_CODES.has(metaCode))) {
    return {
      code: "META_RATE_LIMIT",
      message,
      retryable: true,
      operation,
      httpStatus: status,
      metaCode,
      metaSubcode: metaError?.subcode ?? null,
      metaType: metaError?.type ?? null,
      fbtraceId: metaError?.fbtraceId ?? null
    };
  }

  if (status && status >= 500) {
    return {
      code: "META_SERVER_ERROR",
      message,
      retryable: true,
      operation,
      httpStatus: status,
      metaCode,
      metaSubcode: metaError?.subcode ?? null,
      metaType: metaError?.type ?? null,
      fbtraceId: metaError?.fbtraceId ?? null
    };
  }

  if (metaCode && CONFLICT_ERROR_CODES.has(metaCode)) {
    return {
      code: "META_CONFLICT",
      message,
      retryable: false,
      operation,
      httpStatus: status,
      metaCode,
      metaSubcode: metaError?.subcode ?? null,
      metaType: metaError?.type ?? null,
      fbtraceId: metaError?.fbtraceId ?? null
    };
  }

  if (metaCode && INVALID_WABA_ERROR_CODES.has(metaCode) && operation !== "LIST_TEMPLATES") {
    return {
      code: "META_WABA_ERROR",
      message,
      retryable: false,
      operation,
      httpStatus: status,
      metaCode,
      metaSubcode: metaError?.subcode ?? null,
      metaType: metaError?.type ?? null,
      fbtraceId: metaError?.fbtraceId ?? null
    };
  }

  return {
    code: "META_GRAPH_ERROR",
    message,
    retryable: false,
    operation,
    httpStatus: status,
    metaCode,
    metaSubcode: metaError?.subcode ?? null,
    metaType: metaError?.type ?? null,
    fbtraceId: metaError?.fbtraceId ?? null
  };
}

function mapStatusError(
  status: number,
  operation: MetaTemplateClientOperation = "LIST_TEMPLATES"
): MetaTemplateClientError {
  return classifyGraphError({ status, operation });
}

function mapGraphPayloadError(
  payload: unknown,
  operation: MetaTemplateClientOperation = "LIST_TEMPLATES"
): MetaTemplateClientError {
  return classifyGraphError({ payload, operation });
}

function defaultErrorMessageForOperation(operation: MetaTemplateClientOperation) {
  if (operation === "CREATE_UPLOAD_SESSION") {
    return "Falha ao iniciar upload resumable da Meta.";
  }

  if (operation === "UPLOAD_TEMPLATE_FILE") {
    return "Falha ao enviar arquivo do template para a Meta.";
  }

  if (operation === "CREATE_TEMPLATE") {
    return "Falha ao criar template na Meta.";
  }

  if (operation === "GET_TEMPLATE") {
    return "Falha ao consultar template na Meta.";
  }

  if (operation === "DELETE_TEMPLATE") {
    return "Falha ao excluir template na Meta.";
  }

  return "A Meta retornou erro ao consultar templates.";
}

function createTemplatesUrl({
  graphVersion,
  wabaId,
  after,
  name
}: {
  graphVersion: string;
  wabaId: string;
  after?: string | null;
  name?: string | null;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates`
  );
  url.searchParams.set("fields", MESSAGE_TEMPLATE_FIELDS);

  if (name) {
    url.searchParams.set("name", name);
  } else {
    url.searchParams.set("limit", String(DEFAULT_PAGE_LIMIT));
  }

  if (after) {
    url.searchParams.set("after", after);
  }

  return url.toString();
}

function createTemplateByIdUrl({
  graphVersion,
  templateId
}: {
  graphVersion: string;
  templateId: string;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(templateId)}`
  );
  url.searchParams.set("fields", MESSAGE_TEMPLATE_FIELDS);
  return url.toString();
}

function createTemplateCollectionUrl({
  graphVersion,
  wabaId
}: {
  graphVersion: string;
  wabaId: string;
}) {
  return `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates`;
}

function createUploadSessionUrl({
  graphVersion,
  appId,
  fileName,
  fileLength,
  fileType
}: {
  graphVersion: string;
  appId: string;
  fileName: string;
  fileLength: number;
  fileType: string;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(appId)}/uploads`
  );
  url.searchParams.set("file_name", fileName);
  url.searchParams.set("file_length", String(fileLength));
  url.searchParams.set("file_type", fileType);
  return url.toString();
}

function createUploadFileUrl({
  graphVersion,
  uploadSessionId
}: {
  graphVersion: string;
  uploadSessionId: string;
}) {
  return `https://graph.facebook.com/${graphVersion}/${uploadSessionId}`;
}

function createDeleteTemplateUrl({
  graphVersion,
  wabaId,
  name,
  templateId
}: {
  graphVersion: string;
  wabaId: string;
  name: string;
  templateId?: string | null;
}) {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates`
  );
  url.searchParams.set("name", name);

  if (templateId) {
    url.searchParams.set("hsm_id", templateId);
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

function createTransportError({
  error,
  operation
}: {
  error: unknown;
  operation: MetaTemplateClientOperation;
}) {
  return new MetaTemplateClientRequestError({
    code: isAbortError(error) ? "META_TIMEOUT" : "META_FETCH_ERROR",
    message: isAbortError(error)
      ? "Tempo limite excedido ao comunicar com a Meta."
      : "Falha de rede ao comunicar com a Meta.",
    retryable: true,
    operation
  });
}

function assertValidComponents(
  components: MetaTemplateApiComponent[],
  operation: MetaTemplateClientOperation
) {
  if (!Array.isArray(components) || components.length === 0) {
    throw new MetaTemplateClientRequestError({
      code: "INVALID_INPUT",
      message: "components deve ser um array nao vazio.",
      retryable: false,
      operation
    });
  }

  for (const component of components) {
    if (!isRecord(component) || !readString(component.type)) {
      throw new MetaTemplateClientRequestError({
        code: "INVALID_INPUT",
        message: "Cada componente do template deve possuir type.",
        retryable: false,
        operation
      });
    }
  }
}

async function readJsonPayload(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function assertUploadSessionPayload(
  payload: unknown,
  operation: MetaTemplateClientOperation
): TemplateUploadSessionResult {
  if (!isRecord(payload)) {
    throw new MetaTemplateClientRequestError({
      code: "META_INVALID_RESPONSE",
      message: "A Meta retornou resposta invalida ao iniciar upload.",
      retryable: true,
      operation
    });
  }

  const uploadSessionId = readString(payload.id);
  if (!uploadSessionId) {
    throw new MetaTemplateClientRequestError({
      code: "META_INVALID_RESPONSE",
      message: "A resposta da Meta nao informou a sessao de upload.",
      retryable: true,
      operation
    });
  }

  return { uploadSessionId, rawPayload: payload };
}

function assertUploadFilePayload(
  payload: unknown,
  operation: MetaTemplateClientOperation
): TemplateFileUploadResult {
  if (!isRecord(payload)) {
    throw new MetaTemplateClientRequestError({
      code: "META_INVALID_RESPONSE",
      message: "A Meta retornou resposta invalida ao enviar arquivo.",
      retryable: true,
      operation
    });
  }

  const headerHandle = readString(payload.h);
  if (!headerHandle) {
    throw new MetaTemplateClientRequestError({
      code: "META_UPLOAD_ERROR",
      message: "A resposta da Meta nao informou header_handle valido.",
      retryable: true,
      operation
    });
  }

  return { headerHandle, rawPayload: payload };
}

function mapTemplateCreationPayload(payload: unknown): MetaMessageTemplateCreationResult {
  const record = isRecord(payload) ? payload : {};

  return {
    id: readString(record.id),
    status: readString(record.status),
    category: readString(record.category),
    rawPayload: payload
  };
}

function mapTemplateQueryPayload(payload: unknown): MetaMessageTemplateQueryResult {
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return {
      template: payload.data[0] ?? null,
      templates: payload.data,
      rawPayload: payload
    };
  }

  return {
    template: payload ?? null,
    templates: payload ? [payload] : [],
    rawPayload: payload
  };
}

function mapDeletePayload(payload: unknown): MetaMessageTemplateDeleteResult {
  const success = isRecord(payload) ? payload.success === true : false;

  return {
    success,
    rawPayload: payload
  };
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

  private async requestJson({
    url,
    operation,
    accessToken,
    signal,
    init
  }: {
    url: string;
    operation: MetaTemplateClientOperation;
    accessToken: string;
    signal?: AbortSignal;
    init?: RequestInit;
  }) {
    const timeout = createTimeoutSignal(signal, this.timeoutMs);
    let response: Response;

    try {
      response = await this.fetcher(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers ?? {})
        },
        signal: timeout.signal
      });
    } catch (error) {
      throw createTransportError({ error, operation });
    } finally {
      timeout.clear();
    }

    const payload = await readJsonPayload(response);

    if (!response.ok) {
      const error = classifyGraphError({ status: response.status, payload, operation });
      throw new MetaTemplateClientRequestError({
        ...error,
        operation: error.operation ?? operation
      });
    }

    if (hasGraphError(payload)) {
      const error = classifyGraphError({ payload, operation });
      throw new MetaTemplateClientRequestError({
        ...error,
        operation: error.operation ?? operation
      });
    }

    return payload;
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
                retryable: true,
                operation: "LIST_TEMPLATES"
              }
            : {
                code: "META_FETCH_ERROR",
                message: "Falha de rede ao consultar templates da Meta.",
                retryable: true,
                operation: "LIST_TEMPLATES"
              }
        );
        return result;
      } finally {
        timeout.clear();
      }

      const payload = await readJsonPayload(response);

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
          retryable: true,
          operation: "LIST_TEMPLATES"
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

  async createTemplateUploadSession(
    input: CreateTemplateUploadSessionInput
  ): Promise<TemplateUploadSessionResult> {
    const operation = "CREATE_UPLOAD_SESSION";
    const appId = requireString(input.appId, "appId", operation);
    const accessToken = requireString(input.accessToken, "accessToken", operation);
    const fileName = requireString(input.fileName, "fileName", operation);
    const fileType = requireString(input.fileType, "fileType", operation);
    const fileLength = requirePositiveInteger(input.fileLength, "fileLength", operation);
    const payload = await this.requestJson({
      url: createUploadSessionUrl({
        graphVersion: this.graphVersion,
        appId,
        fileName,
        fileLength,
        fileType
      }),
      operation,
      accessToken,
      signal: input.signal,
      init: {
        method: "POST"
      }
    });

    return assertUploadSessionPayload(payload, operation);
  }

  async uploadTemplateFile(
    input: UploadTemplateFileInput
  ): Promise<TemplateFileUploadResult> {
    const operation = "UPLOAD_TEMPLATE_FILE";
    const uploadSessionId = requireString(
      input.uploadSessionId,
      "uploadSessionId",
      operation
    );
    const accessToken = requireString(input.accessToken, "accessToken", operation);
    const fileOffset = requireNonNegativeInteger(
      input.fileOffset ?? 0,
      "fileOffset",
      operation
    );

    if (!(input.fileBuffer instanceof Uint8Array) || input.fileBuffer.byteLength === 0) {
      throw new MetaTemplateClientRequestError({
        code: "INVALID_INPUT",
        message: "fileBuffer deve conter bytes do arquivo.",
        retryable: false,
        operation
      });
    }

    const fileBody = input.fileBuffer.buffer.slice(
      input.fileBuffer.byteOffset,
      input.fileBuffer.byteOffset + input.fileBuffer.byteLength
    ) as ArrayBuffer;
    const fileType = input.fileType?.trim() || "application/octet-stream";
    const payload = await this.requestJson({
      url: createUploadFileUrl({
        graphVersion: this.graphVersion,
        uploadSessionId
      }),
      operation,
      accessToken,
      signal: input.signal,
      init: {
        method: "POST",
        headers: {
          Authorization: `OAuth ${accessToken}`,
          "Content-Type": fileType,
          file_offset: String(fileOffset)
        },
        body: fileBody
      }
    });

    return assertUploadFilePayload(payload, operation);
  }

  async createMetaMessageTemplate(
    input: CreateMetaMessageTemplateInput
  ): Promise<MetaMessageTemplateCreationResult> {
    const operation = "CREATE_TEMPLATE";
    const wabaId = requireString(input.wabaId, "wabaId", operation);
    const accessToken = requireString(input.accessToken, "accessToken", operation);
    const name = requireString(input.name, "name", operation);
    const language = requireString(input.language, "language", operation);
    const category = requireString(input.category, "category", operation);
    assertValidComponents(input.components, operation);

    const payload = await this.requestJson({
      url: createTemplateCollectionUrl({ graphVersion: this.graphVersion, wabaId }),
      operation,
      accessToken,
      signal: input.signal,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          language,
          category,
          components: input.components
        })
      }
    });

    return mapTemplateCreationPayload(payload);
  }

  async getMetaMessageTemplate(
    input: GetMetaMessageTemplateInput
  ): Promise<MetaMessageTemplateQueryResult> {
    const operation = "GET_TEMPLATE";
    const accessToken = requireString(input.accessToken, "accessToken", operation);
    const templateId = readString(input.templateId);
    const wabaId = readString(input.wabaId);
    const name = readString(input.name);

    if (!templateId && (!wabaId || !name)) {
      throw new MetaTemplateClientRequestError({
        code: "INVALID_INPUT",
        message: "Informe templateId ou wabaId e name para consultar template.",
        retryable: false,
        operation
      });
    }

    const payload = await this.requestJson({
      url: templateId
        ? createTemplateByIdUrl({ graphVersion: this.graphVersion, templateId })
        : createTemplatesUrl({ graphVersion: this.graphVersion, wabaId: wabaId!, name }),
      operation,
      accessToken,
      signal: input.signal,
      init: {
        method: "GET"
      }
    });

    return mapTemplateQueryPayload(payload);
  }

  async deleteMetaMessageTemplate(
    input: DeleteMetaMessageTemplateInput
  ): Promise<MetaMessageTemplateDeleteResult> {
    const operation = "DELETE_TEMPLATE";
    const wabaId = requireString(input.wabaId, "wabaId", operation);
    const accessToken = requireString(input.accessToken, "accessToken", operation);
    const name = requireString(input.name, "name", operation);
    const templateId = input.templateId?.trim() || null;
    const payload = await this.requestJson({
      url: createDeleteTemplateUrl({
        graphVersion: this.graphVersion,
        wabaId,
        name,
        templateId
      }),
      operation,
      accessToken,
      signal: input.signal,
      init: {
        method: "DELETE"
      }
    });

    return mapDeletePayload(payload);
  }
}

export async function fetchAllMetaTemplates(
  input: MetaTemplateClientInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).fetchAllMetaTemplates(input);
}

export async function createTemplateUploadSession(
  input: CreateTemplateUploadSessionInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).createTemplateUploadSession(input);
}

export async function uploadTemplateFile(
  input: UploadTemplateFileInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).uploadTemplateFile(input);
}

export async function createMetaMessageTemplate(
  input: CreateMetaMessageTemplateInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).createMetaMessageTemplate(input);
}

export async function getMetaMessageTemplate(
  input: GetMetaMessageTemplateInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).getMetaMessageTemplate(input);
}

export async function deleteMetaMessageTemplate(
  input: DeleteMetaMessageTemplateInput,
  options?: MetaTemplateClientOptions
) {
  return new MetaTemplateClient(options).deleteMetaMessageTemplate(input);
}
