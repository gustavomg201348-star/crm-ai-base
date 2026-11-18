import "server-only";
import { encryptSecret, decryptSecret } from "./secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "./secret-encryption-env";
import type { PrequalificationResult } from "./opencredit-clt-prequalification";
import { parsePrequalificationView } from "./opencredit-clt-prequalification";

type Envelope = {
  version: 1;
  purpose: "CLT_PREQUALIFICATION_RESULT";
  workflowId: string;
  result: PrequalificationResult;
};
const id = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);
export function protectCltPrequalificationResult(workflowId: string, result: PrequalificationResult) {
  if (!id(workflowId)) throw Error("INVALID_PREQUALIFICATION_WORKFLOW");
  const options = getSecretEncryptionOptionsFromEnv();
  if (!options) throw Error("PREQUALIFICATION_STORAGE_UNAVAILABLE");
  // Reuse the browser-safe parser to close the DTO before encryption.
  const parsed = parsePrequalificationView({ state: "COMPLETED", result, errorCode: null });
  if (!parsed.result) throw Error("INVALID_PREQUALIFICATION_RESULT");
  const envelope: Envelope = { version: 1, purpose: "CLT_PREQUALIFICATION_RESULT", workflowId, result: parsed.result };
  return encryptSecret(JSON.stringify(envelope), options);
}
export function readCltPrequalificationResult(workflowId: string, protectedResult: string): PrequalificationResult {
  if (!id(workflowId)) throw Error("INVALID_PREQUALIFICATION_WORKFLOW");
  const options = getSecretEncryptionOptionsFromEnv();
  if (!options) throw Error("PREQUALIFICATION_STORAGE_UNAVAILABLE");
  const value: unknown = JSON.parse(decryptSecret(protectedResult, options));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_PREQUALIFICATION_RESULT");
  const e = value as Partial<Envelope>;
  if (e.version !== 1 || e.purpose !== "CLT_PREQUALIFICATION_RESULT" || e.workflowId !== workflowId || !e.result) throw Error("INVALID_PREQUALIFICATION_RESULT");
  const parsed = parsePrequalificationView({ state: "COMPLETED", result: e.result, errorCode: null });
  if (!parsed.result) throw Error("INVALID_PREQUALIFICATION_RESULT");
  return parsed.result;
}
