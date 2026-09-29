import { NextResponse, type NextRequest } from "next/server";
import {
  CONTACT_IMPORT_MAX_FIELD_LENGTH,
  CONTACT_IMPORT_MAX_ROWS,
  ContactImportConflictError,
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
    message: "A importacao excede o limite permitido."
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
  rows: ContactImportConfirmRowInput[];
} {
  if (!isRecord(value)) invalidPayload();
  assertStrictKeys(value, new Set(["rows"]));
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

  return { rows };
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
