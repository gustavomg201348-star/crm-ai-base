import "server-only";

export type OpenCreditCreateClientObservation =
  | { kind: "PARSED_RESPONSE"; status: number; result: { success: boolean; created: boolean } }
  | { kind: "UNREADABLE_RESPONSE"; status: number; reason: "INVALID_CONTENT_TYPE" | "TOO_LARGE" | "INVALID_UTF8" | "INVALID_JSON" | "STREAM_ERROR" }
  | { kind: "NO_RESPONSE"; reason: "TIMEOUT" | "NETWORK" };

export type OpenCreditCreateClientOutcome =
  | { state: "SUCCEEDED"; basis: "HTTP_201_SUCCESS_CREATED" | "HTTP_201_SUCCESS_UPDATED"; created: boolean }
  | { state: "UNKNOWN"; basis: "HTTP_201_UNCONFIRMED_RESULT" | "HTTP_201_CONTRADICTORY_RESULT" | "UNPUBLISHED_HTTP_STATUS" | "UNREADABLE_RESPONSE" | "NO_RESPONSE" };

export class OpenCreditCreateClientOutcomeError extends Error {
  readonly code = "INVALID_OBSERVATION";
  constructor() {
    super("OPENCREDIT_CREATE_CLIENT_INVALID_OBSERVATION");
    this.name = "OpenCreditCreateClientOutcomeError";
    this.stack = this.name + ": " + this.message;
  }
}

/** Copy own enumerable data descriptors only; never read caller accessors. */
function closedRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw Error();
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.length !== keys.length) throw Error();
  const copy: Record<string, unknown> = {};
  for (const key of ownKeys) {
    if (typeof key !== "string" || !keys.includes(key)) throw Error();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw Error();
    copy[key] = descriptor.value;
  }
  return copy;
}

/**
 * LOCAL QEVORA policy, not a formal provider schema or permission to operate.
 * Classifies sanitized observations in memory only; no reservation or transition.
 * A timeout/unreadable/non-201 observation cannot prove non-application remotely.
 */
export function classifyOpenCreditCreateClientOutcome(input: unknown): OpenCreditCreateClientOutcome {
  try {
    if (typeof window !== "undefined") throw Error();
    // Read kind through its descriptor first, never through property access.
    if (!input || typeof input !== "object") throw Error();
    const descriptor = Object.getOwnPropertyDescriptor(input, "kind");
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw Error();
    const kind: unknown = descriptor.value;
    if (kind !== "PARSED_RESPONSE" && kind !== "UNREADABLE_RESPONSE" && kind !== "NO_RESPONSE") throw Error();
    const observation = closedRecord(input, kind === "PARSED_RESPONSE" ? ["kind", "status", "result"]
      : kind === "UNREADABLE_RESPONSE" ? ["kind", "status", "reason"] : ["kind", "reason"]);
    if (kind === "NO_RESPONSE") {
      if (observation.reason !== "TIMEOUT" && observation.reason !== "NETWORK") throw Error();
      return { state: "UNKNOWN", basis: "NO_RESPONSE" };
    }
    const status = observation.status;
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) throw Error();
    if (kind === "UNREADABLE_RESPONSE") {
      if (!["INVALID_CONTENT_TYPE", "TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "STREAM_ERROR"].includes(observation.reason as string)) throw Error();
      return { state: "UNKNOWN", basis: "UNREADABLE_RESPONSE" };
    }
    const result = closedRecord(observation.result, ["success", "created"]);
    if (typeof result.success !== "boolean" || typeof result.created !== "boolean") throw Error();
    if (status !== 201) return { state: "UNKNOWN", basis: "UNPUBLISHED_HTTP_STATUS" };
    if (result.success) return {
      state: "SUCCEEDED", basis: result.created ? "HTTP_201_SUCCESS_CREATED" : "HTTP_201_SUCCESS_UPDATED", created: result.created
    };
    // Example-only booleans cannot prove that the remote operation was not applied.
    if (!result.created) return { state: "UNKNOWN", basis: "HTTP_201_UNCONFIRMED_RESULT" };
    return { state: "UNKNOWN", basis: "HTTP_201_CONTRADICTORY_RESULT" };
  } catch {
    // Never retain caller data, original exceptions, messages or causes.
    throw new OpenCreditCreateClientOutcomeError();
  }
}
