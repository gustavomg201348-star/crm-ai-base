import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { parseCreateClientDiagnostic as parse, safeDiagnosticId, diagnosticMessages, type OpenCreditCreateClientDiagnostic } from "./opencredit-create-client-diagnostic";
let storage: typeof import("./opencredit-create-client-diagnostic.service");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }; const original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try { storage = await import("./opencredit-create-client-diagnostic.service"); } finally { loader._load = original; }
});
export function diagnostic(): OpenCreditCreateClientDiagnostic {
  return { version: 1, category: "INVALID_JSON", stage: "RESPONSE", providerHttpStatus: 201, providerRequestId: null,
    providerCorrelationId: null, providerSuccess: null, providerCreated: null, providerErrorCode: null,
    responseReadable: false, responseParsed: false, observedAt: "2026-10-26T00:00:02.000Z",
    dispatchCommittedAt: "2026-10-26T00:00:00.000Z", respondedAt: "2026-10-26T00:00:01.000Z", settlement: "NOT_CONFIRMED" };
}
test("closed DTO roundtrip, immutable copy, controlled message only", () => {
  const d = diagnostic(); assert.deepEqual(parse(d), d); assert.notEqual(parse(d), d);
  for (const category of Object.keys(diagnosticMessages)) assert.equal(typeof diagnosticMessages[category as keyof typeof diagnosticMessages], "string");
});
for (const key of ["raw", "body", "cpf", "phone", "email", "message", "headers", "accessToken", "Authorization", "password", "payload"])
  test("no raw/private key " + key, () => assert.equal(parse({ ...diagnostic(), [key]: "PRIVATE" }), null));
for (const field of Object.keys(diagnostic())) test("missing/getter/hidden field rejected " + field, () => {
  let calls = 0; const a: Record<string, unknown> = { ...diagnostic() }; delete a[field]; assert.equal(parse(a), null);
  Object.defineProperty(a, field, { enumerable: true, get() { calls++; throw Error("private"); } });
  assert.equal(parse(a), null); assert.equal(calls, 0);
});
for (const id of ["Bearer private", "00000000000", "5511900000000", "name@example.invalid", "eyJhbGciOiJ.private.jwt", "req_00000000000a", "raw-secret", "req_abcdefabcdef\n"])
  test("unsafe identifier rejected " + id.length + id.slice(0, 2), () => { assert.equal(safeDiagnosticId(id), null); assert.equal(parse({ ...diagnostic(), providerRequestId: id }), null); });
test("strict status, booleans, timestamps, enum and correlations", () => {
  for (const status of [99, 600, 201.5, "201", NaN]) assert.equal(parse({ ...diagnostic(), providerHttpStatus: status }), null);
  for (const change of [{ providerSuccess: "true" }, { category: "SECRET" }, { providerErrorCode: "private" }, { settlement: "SUCCEEDED" },
    { observedAt: "2026-02-30T00:00:00.000Z" }, { respondedAt: "2027-01-01T00:00:00.000Z" }, { providerSuccess: true },
    { stage: "AUTHENTICATION" }, { category: "NONE" }]) assert.equal(parse({ ...diagnostic(), ...change }), null);
});
test("storage CAS is scoped, authorized, independent of domain revision/state/events", async () => {
  const oldCompany = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = "platform";
  const actor = { id: "actor", companyId: "platform", role: "ADMIN" as const, name: "Synthetic", email: "synthetic@example.invalid" };
  let encoded: string | null = null; const writes: Record<string, unknown>[] = [];
  const tx = { user: { findUnique: async () => actor }, openCreditCommercialOperation: {
    findFirst: async () => ({ diagnostic: encoded }), updateMany: async (q: { where: Record<string, unknown>; data: { diagnostic: string } }) => {
      writes.push(q); if (q.where.diagnostic !== encoded || q.where.companyId !== "company" || q.where.providerScope !== "scope") return { count: 0 };
      encoded = q.data.diagnostic; return { count: 1 };
    } } };
  const db = { user: {}, $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) } as unknown as Parameters<typeof storage.persistCreateClientDiagnostic>[0];
  const input = { actor, companyId: "company", providerScope: "scope", operationId: "operation", expectedRevision: 1 };
  try {
    assert.equal(await storage.persistCreateClientDiagnostic(db, input, diagnostic()), true);
    assert.equal(await storage.persistCreateClientDiagnostic(db, input, diagnostic()), false);
    assert.equal(await storage.persistCreateClientDiagnostic(db, { ...input, companyId: "other" }, { ...diagnostic(), settlement: "ERROR" }, diagnostic()), false);
    assert.equal(await storage.persistCreateClientDiagnostic(db, input, { ...diagnostic(), settlement: "ERROR" }, diagnostic()), true);
    assert.deepEqual(Object.keys((writes[0] as { data: object }).data), ["diagnostic"]);
    assert.equal(await storage.persistCreateClientDiagnostic(db, { ...input, actor: { ...actor, role: "AGENT" as never } }, diagnostic()), false);
  } finally { if (oldCompany === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = oldCompany; }
});
