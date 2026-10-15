import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createChatbotFoundation } from "./chatbot-foundation.service";

const definition = { schemaVersion: 1, entryStepId: "end", steps: [{ id: "end", type: "END" }] };
const base = {
  companyId: "company", channelId: "channel", sessionId: "session", flowId: "flow",
  versionId: "version", flowVersionId: "version", conversationId: "conversation", contactId: "contact",
  eventId: "event", leaseToken: "lease", idempotencyKey: "inbound", expectedRevision: 0,
  name: "Synthetic", definition, expiresAt: new Date(Date.now() + 3600000),
  occurredAt: new Date(), kind: "INBOUND_TEXT", payload: {}, reason: "MANUAL", result: "PROCESSED"
};
const invalid = [undefined, null, "", " \t\n ", 42, false, {}, [], ["company"]];
const methods = {
  createDraft: ["companyId"],
  createDraftVersion: ["companyId", "flowId"],
  publishVersion: ["companyId", "flowId", "versionId"],
  getPublishedVersion: ["companyId", "flowId"],
  createSession: ["companyId", "channelId", "conversationId", "contactId", "flowId", "flowVersionId"],
  getSession: ["companyId", "channelId", "sessionId"],
  suspendSession: ["companyId", "channelId", "sessionId"],
  closeSession: ["companyId", "channelId", "sessionId"],
  recordEvent: ["companyId", "channelId", "sessionId"],
  claimEvent: ["companyId", "channelId", "sessionId", "eventId"],
  finishEvent: ["companyId", "channelId", "sessionId", "eventId", "leaseToken"]
} as const;
type Method = keyof typeof methods;
const errorCode = (code: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

function guardedService() {
  let accesses = 0;
  // Even opening a transaction is forbidden for invalid input, not just queries.
  const db = new Proxy({}, { get() { accesses++; throw new Error("Unexpected database access"); } }) as PrismaClient;
  return { service: createChatbotFoundation(db), accesses: () => accesses };
}

for (const method of Object.keys(methods) as Method[]) {
  test(`${method} rejects each incomplete/invalid reference before accessing Prisma`, async () => {
    const { service, accesses } = guardedService();
    const call = service[method] as (input: unknown) => Promise<unknown>;
    for (const field of methods[method]) {
      for (const value of invalid) {
        await assert.rejects(call({ ...base, [field]: value }), errorCode("INVALID_SCOPE"), `${method}: ${field}=${String(value)}`);
        assert.equal(accesses(), 0);
      }
      const missing: Record<string, unknown> = { ...base };
      delete missing[field];
      await assert.rejects(call(missing), errorCode("INVALID_SCOPE"));
    }
    for (const input of invalid) await assert.rejects(call(input), errorCode("INVALID_SCOPE"));
    assert.equal(accesses(), 0);
  });
}

test("all revision-dependent methods reject omitted/invalid revisions before accessing Prisma", async () => {
  for (const method of ["createDraftVersion", "publishVersion", "suspendSession", "closeSession", "claimEvent", "finishEvent"] as const) {
    const { service, accesses } = guardedService();
    const call = service[method] as (input: unknown) => Promise<unknown>;
    for (const value of [...invalid.filter((value) => value !== 42), "42", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(call({ ...base, expectedRevision: value }), errorCode("INVALID_INPUT"));
    }
    assert.equal(accesses(), 0);
  }
});

test("optional campaign references must both be valid when supplied", async () => {
  const { service, accesses } = guardedService();
  const call = service.createSession as (input: unknown) => Promise<unknown>;
  for (const field of ["campaignId", "campaignRecipientId"]) {
    for (const value of invalid) {
      await assert.rejects(call({ ...base, campaignId: "campaign", campaignRecipientId: "recipient", [field]: value }), errorCode("INVALID_CAMPAIGN_REFERENCE"));
    }
  }
  assert.equal(accesses(), 0);
});

test("event idempotency keys cannot be omitted or malformed", async () => {
  const { service, accesses } = guardedService();
  const call = service.recordEvent as (input: unknown) => Promise<unknown>;
  for (const value of invalid) await assert.rejects(call({ ...base, idempotencyKey: value }), errorCode("INVALID_INPUT"));
  assert.equal(accesses(), 0);
});

test("valid references are snapshotted across awaits without trimming or defaults", async () => {
  const input = { companyId: "company", flowId: "flow" };
  const queries: unknown[] = [];
  const db = {
    chatbotFlow: { async findFirst(query: unknown) {
      queries.push(query);
      Object.assign(input, { companyId: undefined, flowId: undefined });
      return { id: "flow", publishedVersionId: "version" };
    } },
    chatbotFlowVersion: { async findFirst(query: unknown) { queries.push(query); return null; } }
  } as unknown as PrismaClient;
  assert.equal(await createChatbotFoundation(db).getPublishedVersion(input), null);
  assert.deepEqual(queries, [
    { where: { id: "flow", companyId: "company", isActive: true } },
    { where: { id: "version", companyId: "company", flowId: "flow", status: "PUBLISHED" } }
  ]);
});
