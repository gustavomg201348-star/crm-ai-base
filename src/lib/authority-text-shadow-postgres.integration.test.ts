import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";
import { createShadowAuthorityReader } from "./authority-text-shadow-reader";
import { createTextAuthorityObserver } from "./authority-text-shadow";
import type { ShadowMetric } from "./authority-text-shadow-contract";
import { createConversationAuthorityService } from "./conversation-authority.service";
import { createInboundMessageWithDurableEvent, inboundEventTransaction } from "./conversation-inbound-event";
import { conversationInclude, mapConversation } from "./conversations";

test("real private PostgreSQL pool cannot starve either legacy text route, even under an authority-only lock", async () => {
  const configured = process.env.SHADOW_TEST_DATABASE_URL;
  assert.equal(process.env.AUTHORITY_POSTGRES_TEST, "1", "Explicit disposable PostgreSQL required; no skips");
  assert(configured);
  const url = new URL(configured);
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.pathname, "/qevora_shadow_test");
  assert(!url.searchParams.has("host"));
  url.searchParams.set("connection_limit", "1"); url.searchParams.set("pool_timeout", "1");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } }, log: [] });
  // Only a fixed disposable template may be cloned; every invocation owns its database and locks.
  const databaseName = `qevora_shadow_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}" TEMPLATE qevora_shadow_test`);
  } catch (error) { await admin.$disconnect(); throw error; }
  url.pathname = `/${databaseName}`;
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const locker = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const privateUrl = new URL(url);
  privateUrl.searchParams.set("application_name", `qevora_shadow_fixture_${process.pid}`);
  const reader = createShadowAuthorityReader(() => privateUrl.toString());
  const created: string[] = [];
  try {
    const company = await db.company.create({ data: { name: "Shadow isolated fixture" } });
    const fixtureChannel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta" } });
    const actor = await db.user.create({ data: { companyId: company.id, name: "Synthetic admin", email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN" } });
    const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5500000000000" } });
    const fixtureConversation = await db.conversation.create({ data: { contactId: contact.id, channelId: fixtureChannel.id } });
    await createConversationAuthorityService({ db, provider: "postgresql" }).initialize({
      companyId: company.id, channelId: fixtureChannel.id, conversationId: fixtureConversation.id,
      actorUserId: actor.id, ownerUserId: actor.id, logicalKey: randomUUID(), reason: "SHADOW_TEST", state: "HUMAN"
    });
    const authority = await db.conversationAuthority.findUniqueOrThrow({ where: { conversationId: fixtureConversation.id } });
    const conversation = await db.conversation.findUniqueOrThrow({ where: { id: authority.conversationId }, include: conversationInclude });
    const channel = { ...await db.channel.findUniqueOrThrow({ where: { id: authority.channelId } }), phoneNumberId: "fake", accessToken: "fake" };
    const scope = { companyId: authority.companyId, channelId: authority.channelId, conversationId: authority.conversationId };
    assert(await reader.read(scope));
    let unlock: () => void = () => {}, signal: () => void = () => {};
    const acquired = new Promise<void>(resolve => { signal = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const holding = locker.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE "ConversationAuthority" IN ACCESS EXCLUSIVE MODE`;
      signal(); await release;
    }, { timeout: 30000 });
    await acquired;
    try {
      for (const category of ["conversations", "channels"]) {
        const outcomes = [];
        for (const mode of ["OFF", "SHADOW"]) {
          let sends = 0, reads = 0, pending = false, pendingAtSave = false;
          const metrics: ShadowMetric[] = [];
          let evaluated: Promise<unknown> = Promise.resolve();
          const observe = createTextAuthorityObserver({ mode: () => mode, read: input => {
            reads++; pending = true;
            const operation = reader.read(input);
            evaluated = operation.catch(() => null).finally(() => { pending = false; });
            return operation;
          }, emit: metric => metrics.push(metric) });
          const persist = async () => {
            pendingAtSave = pending;
            const message = await db.message.create({ data: { conversationId: conversation.id, direction: "outbound", senderType: "agent", body: "Synthetic private pool fixture" } });
            created.push(message.id); return conversation;
          };
          class InvalidMessageReplyError extends Error {}
          const mocks: Record<string, unknown> = {
            "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } },
            "@/lib/auth": { getSessionFromRequest: async () => ({ id: authority.ownerUserId, companyId: authority.companyId, role: "ADMIN" }) },
            "@/lib/authority-text-shadow-runtime": { observeTextOutboundAuthority: observe },
            "@/lib/conversation-inbound-event": { createInboundMessageWithDurableEvent, inboundEventTransaction },
            "@/lib/activities": { createActivity: async () => {} },
            "@/lib/db": { prisma: { conversation: { findFirst: async () => conversation }, channel: { findFirst: async () => channel },
              $transaction: async (fn: (tx: unknown) => unknown) => fn({ message: { create: persist }, conversation: { update: async () => conversation } }) } },
            "@/lib/channel-secrets": { resolveChannelAccessToken: () => "fake" },
            "@/lib/conversation-channel.service": { conversationMatchesChannel: () => true },
            "@/lib/conversation-lifecycle.service": {}, "@/lib/contacts": { normalizeContactPhone: (value: string) => value, getContactNormalizedPhone: (value: string) => value },
            "@/lib/conversation-message.service": { getConversationIntegration: async () => ({ conversation, channel }),
              saveOutboundMessage: async () => { await persist(); return mapConversation(conversation); } },
            "@/lib/conversations": { conversationInclude, mapConversation },
            "@/lib/http-error-response": { publicErrorResponse: ({ status }: { status: number }) => new Response("failure", { status }) },
            "@/lib/message-delivery": { saveFailedOutboundMessage: async () => {} },
            "@/lib/meta-whatsapp": { readMetaMessageId: () => "fake", sendMetaTextMessage: async () => {
              sends++; await new Promise(resolve => setTimeout(resolve, 10)); return {};
            } },
            "@/lib/permissions": { canAccessConversation: () => true },
            "@/lib/outbound-message-reply": { InvalidMessageReplyError, resolveOutboundReplyContext: async () => null },
            "@/lib/phone-normalization.service": { digitsOnlyPhone: (value: string) => value },
            "@/lib/prisma-errors": {}, "@/lib/safe-logger": { safeLogError: () => {} },
            "@/lib/rate-limit": { enforceRateLimits: async () => null, rateLimitPolicies: { messageSend: {} } }
          };
          const compiled = ts.transpileModule(readFileSync(`src/app/api/${category}/[id]/messages/route.ts`, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
          }).outputText;
          const loaded = { exports: {} as { POST: (request: object, context: unknown) => Promise<Response> } };
          new Function("require", "module", "exports", compiled)((name: string) => { assert(name in mocks, name); return mocks[name]; }, loaded, loaded.exports);
          const before = created.length;
          const response = await loaded.exports.POST({ json: async () => ({ conversationId: conversation.id, to: conversation.contact.phone, body: "Synthetic private pool fixture" }) },
            { params: Promise.resolve({ id: category === "channels" ? channel.id : conversation.id }) });
          assert.equal(response.status, 200);
          assert.equal(sends, 1); assert.equal(created.length, before + 1);
          assert(await db.message.findUnique({ where: { id: created[created.length - 1] } }));
          outcomes.push(await response.text());
          if (mode === "SHADOW") {
            assert.equal(reads, 1); assert.equal(pendingAtSave, true, "real persistence must run while shadow read is pending");
            await evaluated;
            assert.equal(metrics.length, 1);
            assert(["READ_FAILED", "TIME_BUDGET"].includes(metrics[0].reason));
          } else assert.equal(reads, 0);
        }
        assert.equal(outcomes[0], outcomes[1]);
      }
      const waiting = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${privateUrl.searchParams.get("application_name")!}
          AND wait_event_type = 'Lock' AND query LIKE '%FROM%ConversationAuthority%'`;
      assert.equal(Number(waiting[0].count), 0, "server lock timeout must actually cancel shadow SELECTs");
      const openTransactions = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${privateUrl.searchParams.get("application_name")!}
          AND xact_start IS NOT NULL`;
      assert.equal(Number(openTransactions[0].count), 0, "private read must leave no open transaction after timeout");
      const probe = `
        const assert = require('node:assert/strict');
        const { createShadowAuthorityReader } = require('./src/lib/authority-text-shadow-reader.ts');
        const reader = createShadowAuthorityReader(() => process.env.SHADOW_PROBE_URL);
        (async () => {
          const scope = JSON.parse(process.env.SHADOW_PROBE_SCOPE);
          const pending = reader.read(scope).catch(error => {
            assert.equal(error.reason, 'READ_FAILED');
          });
          let shed = 0;
          await Promise.all(Array.from({length: 1000}, () => reader.read(scope).catch(error => {
            assert.equal(error.reason, 'CAPACITY'); shed++;
          })));
          await pending;
          await reader.close();
          assert.equal(shed, 1000);
          process.stdout.write(JSON.stringify({shed}));
        })().catch(() => { process.exitCode = 1; });`;
      const children = [1, 2, 3].map(index => new Promise<void>((resolve, reject) => {
        const childUrl = new URL(url);
        childUrl.searchParams.set("application_name", `qevora_shadow_saturation_${process.pid}_${index}`);
        const child = spawn(process.execPath, [...process.execArgv, "-e", probe], {
          env: { ...process.env, SHADOW_PROBE_URL: childUrl.toString(), SHADOW_PROBE_SCOPE: JSON.stringify(scope) },
          stdio: ["ignore", "pipe", "pipe"]
        });
        let output = "", errors = "";
        const timeout = setTimeout(() => { child.kill(); reject(new Error("Disposable saturation probe timed out")); }, 15000);
        child.stdout.on("data", data => { output += String(data); });
        child.stderr.on("data", data => { errors += String(data); });
        child.on("error", error => { clearTimeout(timeout); reject(error); });
        child.on("close", code => {
          clearTimeout(timeout);
          try { assert.equal(code, 0); assert.equal(errors, ""); assert.deepEqual(JSON.parse(output), { shed: 1000 }); resolve(); }
          catch { reject(new Error("Disposable saturation probe failed")); }
        });
      }));
      await Promise.all(children);
      const interrupted = assert.rejects(reader.read(scope), /SHADOW_READ_UNAVAILABLE/);
      const termination = await db.$queryRaw<Array<{ terminated: boolean }>>`SELECT pg_terminate_backend(pid) AS terminated
        FROM pg_stat_activity WHERE datname = current_database() AND application_name = ${`qevora_shadow_fixture_${process.pid}`}`;
      await interrupted;
      assert.equal(termination.length, 1, "the private pool has exactly one server connection");
      assert.equal(termination[0].terminated, true);
    } finally { unlock(); await holding; }
    assert(await reader.read(scope), "reader recovers after real server cancellation");
    await reader.close();
    assert(await reader.read(scope), "runtime can restart its private client after a completed shutdown");
    const unavailable = createShadowAuthorityReader(() => undefined);
    await assert.rejects(unavailable.read(scope), /SHADOW_READ_UNAVAILABLE/); await unavailable.close();
    const disconnected = createShadowAuthorityReader(() => {
      const offline = new URL(url); offline.port = "1"; return offline.toString();
    });
    await assert.rejects(disconnected.read(scope), /SHADOW_READ_UNAVAILABLE/); await disconnected.close();
    assert.equal(Number((await db.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`)[0].value), 1);
  } finally {
    try {
      await reader.close();
      if (created.length) await db.message.deleteMany({ where: { id: { in: created } } });
    } finally {
      try { await locker.$disconnect(); await db.$disconnect(); }
      finally {
        try { await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`); }
        finally { await admin.$disconnect(); }
      }
    }
  }
});
