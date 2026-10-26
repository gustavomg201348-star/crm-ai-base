import "server-only";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { openCreditApiClient, readOpenCreditApiErrorCode } from "./opencredit-api-client";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { reserveOpenCreditClientProfileOperationForDispatch, applyOpenCreditCreateClientObservation,
  OpenCreditCommercialOperationServiceError, readOpenCreditCommercialOperationServiceErrorCode,
  type OpenCreditClientProfileReservation } from "./opencredit-commercial-operation.service";
import { readOpenCreditStrictJsonResponse, OpenCreditHttpJsonBoundaryError } from "./opencredit-http-json-boundary";
import { parseOpenCreditClientProfileResult } from "./opencredit-client-profile-contract";
import { classifyOpenCreditCreateClientOutcome, type OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";
import { safeDiagnosticId, type OpenCreditCreateClientDiagnostic } from "./opencredit-create-client-diagnostic";
import { persistCreateClientDiagnostic, logCreateClientDiagnostic } from "./opencredit-create-client-diagnostic.service";

type Input = Readonly<{ actor: SessionUser; companyId: string; operationId: string; expectedRevision: number }>;
type Db = Parameters<typeof reserveOpenCreditClientProfileOperationForDispatch>[0] & Parameters<typeof persistCreateClientDiagnostic>[0];
type Options = Readonly<{ client?: Pick<typeof openCreditApiClient, "postJsonAfterCommit"> }>;
export type OpenCreditCreateClientDispatchResult =
  | Readonly<{ operationId: string; state: "SUCCEEDED"; revision: number; created: boolean }>
  | Readonly<{ operationId: string; state: "UNKNOWN"; revision: number }>;
const CODES = ["INVALID_INPUT", "CONFIGURATION", "AUTHENTICATION", "PRE_DISPATCH_UNAVAILABLE", "SETTLEMENT_FAILED"] as const;
type Code = typeof CODES[number];
export class OpenCreditCreateClientDispatchError extends Error {
  constructor(readonly code: Code) {
    super("OPENCREDIT_CREATE_CLIENT_DISPATCH_" + code);
    this.name = "OpenCreditCreateClientDispatchError";
    this.stack = this.name + ": " + this.message;
  }
}
/** Closed, module-instance-stable error contract. Never invoke exception accessors. */
export function readOpenCreditCreateClientDispatchErrorCode(error: unknown): Code | null {
  try {
    if (!(error instanceof Error)) return null;
    const name = Object.getOwnPropertyDescriptor(error, "name");
    const code = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    if (!name || !("value" in name) || name.value !== "OpenCreditCreateClientDispatchError"
      || !code || !("value" in code) || !message || !("value" in message)) return null;
    const recognized = CODES.find(candidate => candidate === code.value);
    return recognized && message.value === "OPENCREDIT_CREATE_CLIENT_DISPATCH_" + recognized ? recognized : null;
  } catch { return null; }
}
const fail = (code: Code): never => { throw new OpenCreditCreateClientDispatchError(code); };
function closed(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) throw Error();
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !d.enumerable || !("value" in d)) throw Error();
    result[k] = d.value;
  }
  return result;
}
function input(value: unknown): Input {
  try {
    if (typeof window !== "undefined") throw Error();
    const r = closed(value, ["actor", "companyId", "operationId", "expectedRevision"]);
    const a = closed(r.actor, ["id", "companyId", "role", "name", "email"]);
    const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
    if (!id(r.companyId) || !id(r.operationId) || !id(a.id) || !id(a.companyId) || a.role !== "ADMIN"
      || typeof a.name !== "string" || typeof a.email !== "string" || !a.email.trim() || a.email.length > 254
      || typeof r.expectedRevision !== "number" || !Number.isSafeInteger(r.expectedRevision)
      || r.expectedRevision < 0 || r.expectedRevision >= 2147483647) throw Error();
    const actor: SessionUser = { id: a.id, companyId: a.companyId, role: a.role, name: a.name, email: a.email };
    if (!isPlatformAdmin(actor)) throw Error();
    return { actor, companyId: r.companyId, operationId: r.operationId, expectedRevision: r.expectedRevision };
  } catch { return fail("INVALID_INPUT"); }
}
type Diagnostic = { -readonly [K in keyof OpenCreditCreateClientDiagnostic]: OpenCreditCreateClientDiagnostic[K] };
function technicalDiagnostic(): Diagnostic {
  return { version: 1, category: "UNKNOWN_TRANSPORT", stage: "AUTHENTICATION", providerHttpStatus: null,
    providerRequestId: null, providerCorrelationId: null, providerSuccess: null, providerCreated: null,
    providerErrorCode: null, responseReadable: false, responseParsed: false, observedAt: new Date().toISOString(),
    dispatchCommittedAt: null, respondedAt: null, settlement: "NOT_ATTEMPTED" };
}
async function observe(response: Response, diagnostic: Diagnostic, sensitive: readonly string[],
  sanitize: (value: unknown) => string | null): Promise<OpenCreditCreateClientObservation> {
  // A transport Response without a real HTTP status cannot be a positive observation.
  if (!(response instanceof Response) || response.status < 100 || response.status > 599) return { kind: "NO_RESPONSE", reason: "NETWORK" };
  diagnostic.stage = "RESPONSE";
  diagnostic.providerHttpStatus = response.status;
  diagnostic.respondedAt = new Date().toISOString();
  const identifier = (value: unknown) => {
    const safe = safeDiagnosticId(sanitize(value));
    return safe && !sensitive.some(v => v.length >= 4 && safe.toLowerCase().includes(v.toLowerCase())) ? safe : null;
  };
  diagnostic.providerRequestId = identifier(response.headers.get("x-request-id"));
  diagnostic.providerCorrelationId = identifier(response.headers.get("x-correlation-id"));
  let payload: Awaited<ReturnType<typeof readOpenCreditStrictJsonResponse>>;
  try { payload = await readOpenCreditStrictJsonResponse(response); }
  catch (error) {
    if (error instanceof OpenCreditHttpJsonBoundaryError) {
      // INVALID_JSON is reported only after bounded body read and UTF-8 decoding completed.
      diagnostic.responseReadable = error.code === "INVALID_JSON";
      diagnostic.category = error.code === "TIMEOUT" ? "RESPONSE_TIMEOUT" : error.code === "TOO_LARGE" ? "RESPONSE_TOO_LARGE"
        : error.code === "INVALID_UTF8" ? "INVALID_UTF8" : error.code === "INVALID_JSON" ? "INVALID_JSON" : "INVALID_RESPONSE";
      if (error.code === "TIMEOUT") return { kind: "NO_RESPONSE", reason: "TIMEOUT" };
      return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: error.code };
    }
    diagnostic.category = "INVALID_RESPONSE";
    return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: "INVALID_RESPONSE" };
  }
  diagnostic.responseReadable = true;
  diagnostic.responseParsed = true;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    diagnostic.providerRequestId ??= identifier(payload.requestId);
    const error = payload.error;
    if (error && typeof error === "object" && !Array.isArray(error)
      && (error.code === "VALIDATION_ERROR" || error.code === "UNAUTHORIZED")) diagnostic.providerErrorCode = error.code;
  }
  try {
    const result = parseOpenCreditClientProfileResult(payload);
    diagnostic.providerSuccess = result.success; diagnostic.providerCreated = result.created;
    diagnostic.category = response.status !== 201 ? "HTTP_NON_201" : result.success ? "NONE" : "PROVIDER_SUCCESS_FALSE";
    return { kind: "PARSED_RESPONSE", status: response.status, result };
  } catch {
    diagnostic.category = response.status !== 201 ? "HTTP_NON_201" : "INVALID_CONTRACT";
    return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: "INVALID_CONTRACT" };
  }
}

/** Explicit server core, composed only by the human admin command. No automatic preparation or replay.
 * Auth completes before reservation; only the API client transports the one-shot POST. */
export async function dispatchOpenCreditCreateClient(db: Db, supplied: Input, options: Options = {}): Promise<OpenCreditCreateClientDispatchResult> {
  const command = input(supplied);
  let context: ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
  try { context = resolveConfiguredOpenCreditProviderContext(); } catch { return fail("CONFIGURATION"); }
  const path = `/api/tenants/${encodeURIComponent(context.tenantId)}/integration/clients`;
  const client = options.client ?? openCreditApiClient;
  let reservation: OpenCreditClientProfileReservation | undefined;
  const diagnostic = technicalDiagnostic();
  const diagnosticInput = { ...command, providerScope: context.providerScope };
  let observation: OpenCreditCreateClientObservation;
  try {
    const execution = await client.postJsonAfterCommit(path, async () => {
      reservation = await reserveOpenCreditClientProfileOperationForDispatch(db, { ...command, providerScope: context.providerScope });
      // Commit-to-dispatch timestamp, NOT proof of provider receipt. No additional DB work before transport.
      diagnostic.dispatchCommittedAt = new Date().toISOString(); diagnostic.stage = "TRANSPORT";
      diagnostic.settlement = "NOT_CONFIRMED";
      return { body: reservation.profileJson, committed: reservation };
    });
    observation = await observe(execution.response, diagnostic, [...Object.values(reservation!.profile),
      process.env.OPENCREDIT_API_EMAIL ?? "", process.env.OPENCREDIT_API_PASSWORD ?? ""],
    value => execution.sanitizeDiagnosticIdentifier?.(value) ?? null);
  } catch (error) {
    const apiCode = readOpenCreditApiErrorCode(error);
    if (!reservation) {
      const domainCode = readOpenCreditCommercialOperationServiceErrorCode(error);
      if (domainCode) throw new OpenCreditCommercialOperationServiceError(domainCode);
      diagnostic.category = apiCode === "AUTH_FAILED" || apiCode === "INVALID_RESPONSE" ? "AUTH_ERROR"
        : apiCode === "TIMEOUT" ? "REQUEST_TIMEOUT" : apiCode === "NETWORK" ? "NETWORK_ERROR" : "UNKNOWN_TRANSPORT";
      const status = apiCode && error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "status") : undefined;
      if (apiCode && status && "value" in status && typeof status.value === "number"
        && Number.isInteger(status.value) && status.value >= 100 && status.value <= 599) diagnostic.providerHttpStatus = status.value;
      diagnostic.observedAt = new Date().toISOString();
      const persisted = await persistCreateClientDiagnostic(db, diagnosticInput, diagnostic);
      logCreateClientDiagnostic(command.operationId, diagnostic, persisted);
      if (apiCode === "CONFIGURATION") return fail("CONFIGURATION");
      if (apiCode === "AUTH_FAILED" || apiCode === "INVALID_RESPONSE") return fail("AUTHENTICATION");
      return fail("PRE_DISPATCH_UNAVAILABLE");
    }
    // The client contract guarantees one attempted transport after callback commit.
    observation = { kind: "NO_RESPONSE", reason: apiCode === "TIMEOUT" ? "TIMEOUT" : "NETWORK" };
    diagnostic.category = apiCode === "TIMEOUT" ? "REQUEST_TIMEOUT" : apiCode === "NETWORK" ? "NETWORK_ERROR" : "UNKNOWN_TRANSPORT";
  }
  if (!reservation) return fail("PRE_DISPATCH_UNAVAILABLE");
  diagnostic.observedAt = new Date().toISOString();
  const observedInput = { ...diagnosticInput, expectedRevision: reservation.revision };
  // Independent commit survives a failed terminal transaction. Failure does not trigger replay or suppress settlement.
  const persisted = await persistCreateClientDiagnostic(db, observedInput, diagnostic);
  logCreateClientDiagnostic(command.operationId, diagnostic, persisted);
  try {
    const result = await applyOpenCreditCreateClientObservation(db,
      { ...command, providerScope: context.providerScope, expectedRevision: reservation.revision }, observation);
    const outcome = classifyOpenCreditCreateClientOutcome(observation);
    const confirmed = { ...diagnostic, settlement: "CONFIRMED" as const };
    const confirmationPersisted = await persistCreateClientDiagnostic(db,
      { ...observedInput, expectedRevision: result.revision }, confirmed, persisted ? diagnostic : null);
    logCreateClientDiagnostic(command.operationId, confirmed, confirmationPersisted);
    if (result.state === "SUCCEEDED" && outcome.state === "SUCCEEDED") return {
      operationId: result.operationId, state: "SUCCEEDED", revision: result.revision, created: outcome.created
    };
    if (result.state === "UNKNOWN") return { operationId: result.operationId, state: "UNKNOWN", revision: result.revision };
    return fail("SETTLEMENT_FAILED");
  } catch {
    // Original provider observation retained, settlement status remains NOT_CONFIRMED; no second transport.
    const failed = { ...diagnostic, settlement: "ERROR" as const };
    const failurePersisted = await persistCreateClientDiagnostic(db, observedInput, failed, persisted ? diagnostic : null);
    logCreateClientDiagnostic(command.operationId, failed, failurePersisted);
    return fail("SETTLEMENT_FAILED");
  }
}
