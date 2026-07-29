const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /access[_-]?token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /app[_-]?secret/i,
  /client[_-]?secret/i,
  /password/i,
  /senha/i,
  /^database_url$/i,
  /^openai_api_key$/i,
  /cpf/i,
  /cnpj/i,
  /phone/i,
  /telefone/i,
  /display[_-]?phone/i,
  /display_phone_number/i,
  /^from$/i,
  /^wa[_-]?id$/i,
  /contactWaIds/i,
  /^body$/i,
  /^message$/i,
  /messageText/i,
  /^payload$/i,
  /payloadFinal/i,
  /components/i,
  /parameters/i,
  /headers/i,
  /buffer/i,
  /base64/i,
  /^raw$/i,
  /^response$/i
] as const;

const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 180;
const MAX_CONTEXT_JSON_LENGTH = 8_000;
const REDACTED = "[redacted]";
const TRUNCATED = "[truncated]";

type SafeLogContext = Record<string, unknown>;

function isSensitiveKey(key: string) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:EAAG|EAAJ|EAAI)[A-Za-z0-9_-]{12,}\b/g, "[redacted-token]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[redacted-document]")
    .replace(/\b\d{7,15}\b/g, "[redacted-number]");
}

function truncateString(value: string) {
  const redacted = redactSensitiveText(value);
  if (redacted.length <= MAX_STRING_LENGTH) {
    return redacted;
  }

  return `${redacted.slice(0, MAX_STRING_LENGTH)}...${TRUNCATED}`;
}

function isBinaryLike(value: unknown) {
  return (
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) ||
    (typeof Blob !== "undefined" && value instanceof Blob) ||
    (typeof File !== "undefined" && value instanceof File) ||
    (typeof FormData !== "undefined" && value instanceof FormData) ||
    (typeof Request !== "undefined" && value instanceof Request) ||
    (typeof Response !== "undefined" && value instanceof Response) ||
    (typeof URL !== "undefined" && value instanceof URL)
  );
}

function describeBinaryLike(value: unknown) {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { type: "Buffer", byteLength: value.byteLength };
  }

  if (value instanceof ArrayBuffer) {
    return { type: "ArrayBuffer", byteLength: value.byteLength };
  }

  if (ArrayBuffer.isView(value)) {
    return { type: value.constructor.name, byteLength: value.byteLength };
  }

  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { type: value.constructor.name, size: value.size, mimeType: value.type || null };
  }

  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return { type: "FormData" };
  }

  if (typeof Request !== "undefined" && value instanceof Request) {
    return { type: "Request", method: value.method, url: REDACTED };
  }

  if (typeof Response !== "undefined" && value instanceof Response) {
    return { type: "Response", status: value.status, ok: value.ok };
  }

  if (typeof URL !== "undefined" && value instanceof URL) {
    return { type: "URL", protocol: value.protocol, url: REDACTED };
  }

  return { type: "BinaryLike" };
}

export function redactSensitiveData(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "symbol" || typeof value === "function") {
    return `[${typeof value}]`;
  }

  if (isBinaryLike(value)) {
    return describeBinaryLike(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      safeMessage: truncateString(value.message)
    };
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactSensitiveData(item, depth + 1, seen));

    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`${TRUNCATED}:${value.length - MAX_ARRAY_ITEMS}`);
    }

    return items;
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);

    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    const sanitized: SafeLogContext = {};

    for (const [key, entryValue] of entries) {
      sanitized[key] = isSensitiveKey(key)
        ? REDACTED
        : redactSensitiveData(entryValue, depth + 1, seen);
    }

    if (Object.keys(value as Record<string, unknown>).length > MAX_OBJECT_KEYS) {
      sanitized.__truncatedKeys = true;
    }

    seen.delete(value);
    return sanitized;
  }

  return String(value);
}

export function sanitizeLogContext(context?: unknown) {
  if (!context || typeof context !== "object") {
    return undefined;
  }

  const sanitized = redactSensitiveData(context) as SafeLogContext;
  const serialized = JSON.stringify(sanitized);

  if (serialized.length <= MAX_CONTEXT_JSON_LENGTH) {
    return sanitized;
  }

  return {
    __truncatedContext: true,
    approxOriginalLength: serialized.length
  };
}

function formatLogScope(scope: string) {
  return `[${truncateString(scope)}]`;
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    const details = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };

    return {
      name: error.name,
      errorSafeMessage: truncateString(error.message),
      code: typeof details.code === "string" || typeof details.code === "number" ? details.code : undefined,
      status:
        typeof details.status === "number"
          ? details.status
          : typeof details.statusCode === "number"
            ? details.statusCode
            : undefined
    };
  }

  if (typeof error === "string") {
    return { errorSafeMessage: truncateString(error) };
  }

  return { errorSafeMessage: "unknown-error" };
}

export function safeLogInfo(scope: string, message: string, context?: SafeLogContext) {
  try {
    safeConsole("info", scope, truncateString(message), sanitizeLogContext(context) ?? {});
  } catch {
    console.info("[safe-logger]", "log-sanitization-failed");
  }
}

export function safeLogWarn(scope: string, message: string, context?: SafeLogContext) {
  try {
    safeConsole("warn", scope, truncateString(message), sanitizeLogContext(context) ?? {});
  } catch {
    console.warn("[safe-logger]", "log-sanitization-failed");
  }
}

export function safeLogError(scope: string, error: unknown, context?: SafeLogContext) {
  try {
    safeConsole("error", scope, "error", {
      ...(sanitizeLogContext(context) ?? {}),
      error: sanitizeError(error)
    });
  } catch {
    console.error("[safe-logger]", "log-sanitization-failed");
  }
}

function safeConsole(
  level: "info" | "warn" | "error",
  scope: string,
  message: string,
  context: SafeLogContext
) {
  try {
    console[level](formatLogScope(scope), message, context);
  } catch {
    console[level]("[safe-logger]", "log-sanitization-failed");
  }
}
