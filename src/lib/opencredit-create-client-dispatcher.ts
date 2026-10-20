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

type Input = Readonly<{ actor: SessionUser; companyId: string; operationId: string; expectedRevision: number }>;
type Db = Parameters<typeof reserveOpenCreditClientProfileOperationForDispatch>[0];
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
async function observe(response: Response): Promise<OpenCreditCreateClientObservation> {
  // A transport Response without a real HTTP status cannot be a positive observation.
  if (!(response instanceof Response) || response.status < 100 || response.status > 599) return { kind: "NO_RESPONSE", reason: "NETWORK" };
  let payload: Awaited<ReturnType<typeof readOpenCreditStrictJsonResponse>>;
  try { payload = await readOpenCreditStrictJsonResponse(response); }
  catch (error) {
    if (error instanceof OpenCreditHttpJsonBoundaryError) {
      if (error.code === "TIMEOUT") return { kind: "NO_RESPONSE", reason: "TIMEOUT" };
      return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: error.code };
    }
    return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: "INVALID_RESPONSE" };
  }
  try { return { kind: "PARSED_RESPONSE", status: response.status, result: parseOpenCreditClientProfileResult(payload) }; }
  catch { return { kind: "UNREADABLE_RESPONSE", status: response.status, reason: "INVALID_CONTRACT" }; }
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
  let observation: OpenCreditCreateClientObservation;
  try {
    const execution = await client.postJsonAfterCommit(path, async () => {
      reservation = await reserveOpenCreditClientProfileOperationForDispatch(db, { ...command, providerScope: context.providerScope });
      return { body: reservation.profileJson, committed: reservation };
    });
    observation = await observe(execution.response);
  } catch (error) {
    const apiCode = readOpenCreditApiErrorCode(error);
    if (!reservation) {
      const domainCode = readOpenCreditCommercialOperationServiceErrorCode(error);
      if (domainCode) throw new OpenCreditCommercialOperationServiceError(domainCode);
      if (apiCode === "CONFIGURATION") return fail("CONFIGURATION");
      if (apiCode === "AUTH_FAILED" || apiCode === "INVALID_RESPONSE") return fail("AUTHENTICATION");
      return fail("PRE_DISPATCH_UNAVAILABLE");
    }
    // The client contract guarantees one attempted transport after callback commit.
    observation = { kind: "NO_RESPONSE", reason: apiCode === "TIMEOUT" ? "TIMEOUT" : "NETWORK" };
  }
  if (!reservation) return fail("PRE_DISPATCH_UNAVAILABLE");
  try {
    const result = await applyOpenCreditCreateClientObservation(db,
      { ...command, providerScope: context.providerScope, expectedRevision: reservation.revision }, observation);
    const outcome = classifyOpenCreditCreateClientOutcome(observation);
    if (result.state === "SUCCEEDED" && outcome.state === "SUCCEEDED") return {
      operationId: result.operationId, state: "SUCCEEDED", revision: result.revision, created: outcome.created
    };
    if (result.state === "UNKNOWN") return { operationId: result.operationId, state: "UNKNOWN", revision: result.revision };
    return fail("SETTLEMENT_FAILED");
  } catch { return fail("SETTLEMENT_FAILED"); }
}
