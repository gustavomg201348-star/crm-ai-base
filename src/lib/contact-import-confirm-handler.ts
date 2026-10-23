import { NextResponse, type NextRequest } from "next/server";
import {
  CONTACT_IMPORT_MAX_FIELD_LENGTH,
  CONTACT_IMPORT_MAX_ROWS,
  ContactImportConflictError,
  ContactImportIdempotencyConflictError,
  ContactImportInProgressError,
  confirmContactImport,
  type ContactImportConfirmRowInput,
  type ContactImportRetirementLeadInput
} from "@/lib/contact-import.service";
import { CONTACT_IMPORT_MAX_REQUEST_BYTES } from "@/lib/contact-import-upload";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { enforceRateLimits, getRequestIpKey } from "@/lib/rate-limit";
import { safeLogError } from "@/lib/safe-logger";

export const CONTACT_IMPORT_CONFIRM_MAX_REQUEST_BYTES = CONTACT_IMPORT_MAX_REQUEST_BYTES;
export const CONTACT_IMPORT_CONFIRM_USER_LIMIT = { limit: 5, windowMs: 60_000 } as const;
export const CONTACT_IMPORT_CONFIRM_IP_LIMIT = { limit: 10, windowMs: 60_000 } as const;

const ROW_KEYS = new Set(["name", "cpf", "phone", "retirementLead"]);
const RETIREMENT_LEAD_KEYS = new Set(["grantDate", "benefitType", "city", "state"]);
const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContactImportConfirmRequestError extends Error {
  readonly code: "CONTACT_IMPORT_INVALID_PAYLOAD" | "CONTACT_IMPORT_PAYLOAD_TOO_LARGE";
  readonly status: 400 | 413;

  constructor({
    code,
    status,
    message
  }: {
    code: ContactImportConfirmRequestError["code"];
    status: ContactImportConfirmRequestError["status"];
    message: string;
  }) {
    super(message);
    this.name = "ContactImportConfirmRequestError";
    this.code = code;
    this.status = status;
  }
}

function invalidPayload(message = "Payload de importacao invalido."): never {
  throw new ContactImportConfirmRequestError({
    code: "CONTACT_IMPORT_INVALID_PAYLOAD",
    status: 400,
    message
  });
}

function payloadTooLarge(): never {
  throw new ContactImportConfirmRequestError({
    code: "CONTACT_IMPORT_PAYLOAD_TOO_LARGE",
    status: 413,
    message: `A importacao excede o limite de ${CONTACT_IMPORT_MAX_ROWS} linhas.`
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertStrictKeys(value: Record<string, unknown>, allowed: Set<string>) {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalidPayload();
}

function parseRequiredString(value: unknown) {
  if (typeof value !== "string" || value.length > CONTACT_IMPORT_MAX_FIELD_LENGTH) {
    invalidPayload();
  }
  return value;
}

function parseOptionalString(value: unknown) {
  if (value === undefined || value === null) return value;
  return parseRequiredString(value);
}

function parseIdempotencyKey(value: unknown) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    invalidPayload("Chave de idempotencia da importacao invalida.");
  }
  return value.toLowerCase();
}

function parseRetirementLead(value: unknown): ContactImportRetirementLeadInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalidPayload();
  assertStrictKeys(value, RETIREMENT_LEAD_KEYS);

  return {
    grantDate: parseOptionalString(value.grantDate),
    benefitType: parseOptionalString(value.benefitType),
    city: parseOptionalString(value.city),
    state: parseOptionalString(value.state)
  };
}

export function parseContactImportConfirmBody(value: unknown): {
  idempotencyKey: string;
  rows: ContactImportConfirmRowInput[];
} {
  if (!isRecord(value)) invalidPayload();
  assertStrictKeys(value, new Set(["idempotencyKey", "rows"]));
  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    invalidPayload("Nenhuma linha valida para confirmar.");
  }
  if (value.rows.length > CONTACT_IMPORT_MAX_ROWS) payloadTooLarge();

  const rows = value.rows.map((row) => {
    if (!isRecord(row)) invalidPayload();
    assertStrictKeys(row, ROW_KEYS);

    return {
      name: parseRequiredString(row.name),
      cpf: parseRequiredString(row.cpf),
      phone: parseRequiredString(row.phone),
      ...(row.retirementLead === undefined
        ? {}
        : { retirementLead: parseRetirementLead(row.retirementLead) })
    };
  });

  return {
    idempotencyKey: parseIdempotencyKey(value.idempotencyKey),
    rows
  };
}

function readContentLength(request: NextRequest) {
  const raw = request.headers.get("content-length");
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function readLimitedJsonBody(
  request: NextRequest,
  maxBytes = CONTACT_IMPORT_CONFIRM_MAX_REQUEST_BYTES
) {
  const contentLength = readContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) payloadTooLarge();

  const reader = request.body?.getReader();
  if (!reader) invalidPayload();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        payloadTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    invalidPayload();
  }
}

type ConfirmRouteDependencies = {
  getSession: typeof getSessionOrUnauthorized;
  requireAdmin: typeof requireCompanyAdmin;
  enforceLimits: typeof enforceRateLimits;
  confirmImport: typeof confirmContactImport;
  maxRequestBytes: number;
};

const defaultDependencies: ConfirmRouteDependencies = {
  getSession: getSessionOrUnauthorized,
  requireAdmin: requireCompanyAdmin,
  enforceLimits: enforceRateLimits,
  confirmImport: confirmContactImport,
  maxRequestBytes: CONTACT_IMPORT_CONFIRM_MAX_REQUEST_BYTES
};

function classifyPrismaTransactionError(error: unknown): "timeout" | "unknown" | null {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2028") {
    return null;
  }

  const record = error as { message?: unknown; meta?: unknown };
  const metaMessage =
    record.meta && typeof record.meta === "object" && "error" in record.meta
      ? (record.meta as { error?: unknown }).error
      : undefined;
  const diagnostic = [record.message, metaMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  return /(?:expired transaction|transaction[^.]*tim(?:ed out|eout)|tim(?:ed out|eout)[^.]*transaction)/i.test(
    diagnostic
  )
    ? "timeout"
    : "unknown";
}

export async function handleContactImportConfirm(
  request: NextRequest,
  dependencies: ConfirmRouteDependencies = defaultDependencies
) {
  try {
    const { session, response } = await dependencies.getSession(request);
    if (response) return response;
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const blocked = dependencies.requireAdmin(session);
    if (blocked) return blocked;

    const limited = await dependencies.enforceLimits([
      {
        category: "contact-import-confirm-user",
        identifiers: [session.companyId, session.id],
        ...CONTACT_IMPORT_CONFIRM_USER_LIMIT
      },
      {
        category: "contact-import-confirm-ip",
        identifiers: [session.companyId, getRequestIpKey(request)],
        ...CONTACT_IMPORT_CONFIRM_IP_LIMIT
      }
    ]);
    if (limited) return limited;

    const rawBody = await readLimitedJsonBody(request, dependencies.maxRequestBytes);
    const body = parseContactImportConfirmBody(rawBody);
    const result = await dependencies.confirmImport({
      companyId: session.companyId,
      userId: session.id,
      idempotencyKey: body.idempotencyKey,
      rows: body.rows
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ContactImportConfirmRequestError) {
      return publicErrorResponse({
        code: error.code,
        status: error.status,
        message: error.message
      });
    }
    if (error instanceof ContactImportConflictError) {
      return publicErrorResponse({
        code: "CONFLICT",
        status: 409,
        message: error.message
      });
    }
    if (error instanceof ContactImportInProgressError) {
      return publicErrorResponse({
        code: "CONTACT_IMPORT_IN_PROGRESS",
        status: 409,
        message: error.message
      });
    }
    if (error instanceof ContactImportIdempotencyConflictError) {
      return publicErrorResponse({
        code: "CONTACT_IMPORT_IDEMPOTENCY_CONFLICT",
        status: 409,
        message: error.message
      });
    }
    const transactionError = classifyPrismaTransactionError(error);
    if (transactionError) {
      const sanitizedTimeoutError = Object.assign(
        new Error(
          transactionError === "timeout"
            ? "Contact import transaction timed out"
            : "Contact import transaction result is unknown"
        ),
        { code: "P2028" }
      );
      safeLogError("http-api", sanitizedTimeoutError, {
        operation: "contact-import-confirm",
        route: "/api/imports/contacts/confirm",
        publicErrorCode:
          transactionError === "timeout"
            ? "CONTACT_IMPORT_TIMEOUT"
            : "CONTACT_IMPORT_RESULT_UNKNOWN",
        status: 503
      });

      return publicErrorResponse({
        code:
          transactionError === "timeout"
            ? "CONTACT_IMPORT_TIMEOUT"
            : "CONTACT_IMPORT_RESULT_UNKNOWN",
        status: 503,
        message:
          transactionError === "timeout"
            ? "A importacao levou mais tempo que o permitido e foi revertida. Nenhum contato foi importado. Tente novamente com uma planilha menor."
            : "Nao foi possivel confirmar o resultado da importacao. Atualize a lista de contatos antes de tentar novamente."
      });
    }

    safeLogError("http-api", error, {
      operation: "contact-import-confirm",
      route: "/api/imports/contacts/confirm",
      publicErrorCode: "CONTACT_IMPORT_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CONTACT_IMPORT_FAILED",
      status: 500,
      message: "Nao foi possivel importar os contatos."
    });
  }
}
