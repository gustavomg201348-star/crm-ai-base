import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { authorityStorage, type AuthorityTx } from "./conversation-authority-storage";
import { createConversationAuthorityService } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import { authorityFingerprint, authorityScope, MAX_AUTHORITY_GENERATION, nextGeneration } from "./conversation-authority-contract";

const errorCode = (code: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

test("runtime scope, canonical fingerprints and generation boundaries fail closed", async () => {
  for (const field of ["companyId", "channelId", "conversationId"] as const) {
    let reads = 0;
    const input = Object.defineProperty({ companyId: "company", channelId: "channel", conversationId: "conversation" }, field,
      { get: () => ++reads === 1 ? field : undefined });
    const snapshot = authorityScope(input);
    assert.equal(snapshot[field], field);
    assert.equal(reads, 1);
    assert(Object.isFrozen(snapshot));
  }
  for (const bad of [undefined, null, "", " ", 0, false, [], {}]) {
    for (const field of ["companyId", "channelId", "conversationId"]) {
      assert.throws(() => authorityScope({ companyId: "company", channelId: "channel", conversationId: "conversation", [field]: bad } as never));
    }
  }
  assert.equal(nextGeneration(BigInt("0")), BigInt("1"));
  assert.equal(nextGeneration(MAX_AUTHORITY_GENERATION - BigInt("1")), MAX_AUTHORITY_GENERATION);
  assert.throws(() => nextGeneration(MAX_AUTHORITY_GENERATION), errorCode("GENERATION_OVERFLOW"));
  for (const bad of [-BigInt("1"), MAX_AUTHORITY_GENERATION + BigInt("1"), 0, Infinity, "1", null]) assert.throws(() => nextGeneration(bad as never));
  assert.equal(authorityFingerprint({ b: [1, { y: 2, x: 1 }], a: true }), authorityFingerprint({ a: true, b: [1, { x: 1, y: 2 }] }));
  assert.notEqual(authorityFingerprint([1, 2]), authorityFingerprint([2, 1]));
  assert.throws(() => authorityFingerprint({ missing: undefined }));

  let queries = 0;
  const fake = new Proxy({}, { get() { queries++; throw new Error("database must not be reached"); } }) as PrismaClient;
  const database = { db: fake, provider: "sqlite" as const };
  const authority = createConversationAuthorityService(database);
  const outbound = createOutboundOperationService(database);
  const input = { companyId: "c", channelId: "h", conversationId: "v", actorUserId: "u", logicalKey: "key", reason: "TEST",
    state: "HUMAN_QUEUE", expectedGeneration: BigInt("0"), operationId: "op", token: "token", origin: "AI", payload: {},
    status: "UNKNOWN", evidenceReference: "evidence", executorTerminated: true, resolution: "FAILED" };
  for (const bad of [undefined, null, "", " ", 7, false]) {
    for (const field of ["companyId", "channelId", "conversationId"]) {
      const invalid = { ...input, [field]: bad } as never;
      for (const invoke of [() => authority.get(invalid), () => authority.initialize(invalid), () => authority.transition(invalid),
        () => outbound.prepare(invalid), () => outbound.reserve(invalid), () => outbound.authorizeDispatch(invalid),
        () => outbound.finish(invalid), () => outbound.recover(invalid), () => outbound.reconcileUnknown(invalid)]) {
        await assert.rejects(invoke);
      }
    }
  }
  assert.equal(queries, 0);
});

test("raw PostgreSQL serialization errors retry only bounded pre-effect transactions", async () => {
  for (const sqlState of ["40001", "40P01", "23514"]) {
    let attempts = 0;
    const database = { $transaction: async (fn: (tx: AuthorityTx) => Promise<unknown>) => {
      attempts++;
      if (attempts === 1) throw new Prisma.PrismaClientKnownRequestError("synthetic raw transaction failure", {
        code: "P2010", clientVersion: "test", meta: { code: sqlState }
      });
      return fn({ $queryRaw: async () => [], $executeRaw: async () => 0 } as unknown as AuthorityTx);
    } } as unknown as PrismaClient;
    const execute = () => authorityStorage({ db: database, provider: "postgresql" }).transaction(async () => "committed");
    if (sqlState === "23514") { await assert.rejects(execute); assert.equal(attempts, 1); }
    else { assert.equal(await execute(), "committed"); assert.equal(attempts, 2); }
  }
  let attempts = 0;
  const alwaysConflicting = { $transaction: async () => { attempts++; throw new Prisma.PrismaClientKnownRequestError("conflict", {
    code: "P2010", clientVersion: "test", meta: { code: "40001" }
  }); } } as unknown as PrismaClient;
  await assert.rejects(authorityStorage({ db: alwaysConflicting, provider: "postgresql" }).transaction(async () => "never"));
  assert.equal(attempts, 4);
});

test("PostgreSQL validation gate precedes COMMIT and never returns a rejected callback result", async () => {
  for (const fail of [false, true]) {
    const phases: string[] = [];
    const db = { $transaction: async (fn: (tx: AuthorityTx) => Promise<unknown>) => {
      const result = await fn({
        $queryRaw: async () => [],
        $executeRaw: async (sql: TemplateStringsArray) => {
          assert.equal(sql.join(""), "SET CONSTRAINTS ALL IMMEDIATE"); phases.push("VALIDATE");
          if (fail) throw new Error("DEFERRED_CHECK_REJECTED");
          return 0;
        }
      } as unknown as AuthorityTx);
      phases.push("COMMIT"); return result;
    } } as unknown as PrismaClient;
    const execute = () => authorityStorage({ db, provider: "postgresql" }).transaction(async () => { phases.push("CALLBACK"); return "persisted"; });
    if (fail) { await assert.rejects(execute(), /DEFERRED_CHECK_REJECTED/); assert.deepEqual(phases, ["CALLBACK", "VALIDATE"]); }
    else { assert.equal(await execute(), "persisted"); assert.deepEqual(phases, ["CALLBACK", "VALIDATE", "COMMIT"]); }
  }
});

test("CI explicitly runs authority integration for both disposable providers", async () => {
  const workflow = await readFile(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  assert.equal(workflow.match(/--test src\/lib\/conversation-authority\.test\.ts/g)?.length, 2);
  assert(workflow.includes('AUTHORITY_POSTGRES_TEST: "1"'));
  assert(workflow.includes("CREATE DATABASE qevora_authority_test;"));
  assert(workflow.includes('export DATABASE_URL="$AUTHORITY_TEST_DATABASE_URL"'));
});

test("shared authority persistence and real concurrent transactions", async t => {
  const url = process.env.AUTHORITY_TEST_DATABASE_URL;
  assert(url, "AUTHORITY_TEST_DATABASE_URL required: integration must not silently skip");
  const postgres = process.env.AUTHORITY_POSTGRES_TEST === "1";
  if (postgres) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "postgresql:");
    assert(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/qevora_authority_test");
    assert(!parsed.searchParams.has("host"));
  } else {
    assert(url.startsWith("file:"));
    const file = path.resolve(url.slice(5));
    assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert(path.basename(file).startsWith("qevora-authority-") && file.endsWith(".db"));
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  const peer = new PrismaClient({ datasources: { db: { url } } });
  const provider = postgres ? "postgresql" as const : "sqlite" as const;
  const authority = createConversationAuthorityService({ db, provider });
  const outbound = createOutboundOperationService({ db, provider });
  const peerOutbound = createOutboundOperationService({ db: peer, provider });
  const peerAuthority = createConversationAuthorityService({ db: peer, provider });
  const key = () => crypto.randomUUID();
  try {
    if (!postgres) {
      const guards = await readFile(path.join(process.cwd(), "prisma/sqlite/conversation-authority-guards.sql"), "utf8");
      for (const statement of guards.split(/\r?\n-- statement\r?\n/)) await db.$executeRawUnsafe(statement);
    }
    const company = await db.company.create({ data: { name: "Authority synthetic test" } });
    const foreignCompany = await db.company.create({ data: { name: "Foreign synthetic test" } });
    const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta" } });
    const otherChannel = await db.channel.create({ data: { companyId: company.id, name: "Other", provider: "meta" } });
    const foreignChannel = await db.channel.create({ data: { companyId: foreignCompany.id, name: "Foreign", provider: "meta" } });
    const admin = await db.user.create({ data: { companyId: company.id, name: "Test admin", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN" } });
    const agent = await db.user.create({ data: { companyId: company.id, name: "Test agent", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role: "AGENT" } });
    const foreignUser = await db.user.create({ data: { companyId: foreignCompany.id, name: "Foreign", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role: "ADMIN" } });
    const fixture = async (state: "HUMAN_QUEUE" | "HUMAN" | "AI" = "HUMAN") => {
      const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5500000000000" } });
      const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id } });
      const scope = { companyId: company.id, channelId: channel.id, conversationId: conversation.id };
      const initialized = await authority.initialize({ ...scope, actorUserId: admin.id, logicalKey: key(), reason: "TEST_INITIALIZE", state: "HUMAN_QUEUE" });
      if (state !== "HUMAN_QUEUE") await authority.transition({ ...scope, actorUserId: admin.id, logicalKey: key(), reason: "TEST_ENABLE", expectedGeneration: BigInt("0"),
        state, ...(state === "HUMAN" ? { ownerUserId: admin.id } : {}) });
      const current = await authority.get(scope); assert(current);
      const prepared = { ...scope, expectedGeneration: current.generation, logicalKey: key(), origin: state === "AI" ? "AI" as const : "HUMAN" as const,
        ...(state !== "AI" ? { actorUserId: admin.id } : {}), payload: { body: "Synthetic. Never sent." } };
      return { ...scope, scope, current, prepared, initialized, contact, conversation };
    }
    const opInput = (f: Awaited<ReturnType<typeof fixture>>, operationId: string) => ({ ...f.scope, operationId });
    await t.test("unstable getters cannot omit scope in any public service operation", async () => {
      const operationsBefore = await db.outboundOperation.count();
      const f = await fixture();
      const input = { ...f.prepared, state: "HUMAN_QUEUE", operationId: "nonexistent", token: "token", reason: "SCOPE_TEST",
        status: "UNKNOWN", evidenceReference: "TEST_EVIDENCE", executorTerminated: true, resolution: "FAILED" };
      for (const field of ["companyId", "channelId", "conversationId"] as const) {
        for (const invoke of [authority.get, authority.initialize, authority.transition, outbound.prepare, outbound.reserve,
          outbound.authorizeDispatch, outbound.finish, outbound.recover, outbound.reconcileUnknown]) {
          let reads = 0;
          const invalid = Object.defineProperty({ ...input }, field, { enumerable: true,
            get: () => ++reads === 1 ? "foreign-scope" : undefined });
          const result = await invoke(invalid as never).catch(() => null);
          assert.equal(result, null);
          assert.equal(reads, 1);
        }
      }
      assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
      assert.equal(await db.outboundOperation.count(), operationsBefore);
    });
    await t.test("HUMAN owner history A -> B -> C remains reconstructible", async () => {
      const f = await fixture();
      const third = await db.user.create({ data: { companyId: company.id, name: "Third synthetic owner", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role: "AGENT" } });
      const change = { ...f.scope, actorUserId: admin.id, state: "HUMAN" as const, reason: "OWNER_TRANSFER" };
      const first = await authority.transition({ ...change, logicalKey: key(), expectedGeneration: BigInt(1), ownerUserId: agent.id });
      const second = await authority.transition({ ...change, logicalKey: key(), expectedGeneration: BigInt(2), ownerUserId: third.id });
      const events = await db.authorityEvent.findMany({ where: { authorityId: f.current.id, reason: "OWNER_TRANSFER" }, orderBy: { toGeneration: "asc" } });
      assert.deepEqual(events.map(e => [e.fromOwnerUserId, e.toOwnerUserId]), [[admin.id, agent.id], [agent.id, third.id]]);
      assert.deepEqual(events.map(e => e.id), [first.id, second.id]);
      assert(events.every(e => e.actorUserId === admin.id && e.reason === "OWNER_TRANSFER"));
      const initialization = await db.authorityEvent.findUniqueOrThrow({ where: { id: f.initialized.id } });
      assert.equal(initialization.fromOwnerUserId, null);
      assert.equal(initialization.toOwnerUserId, null);
      const contact = await db.contact.create({ data: { companyId: company.id, name: "Initial human", phone: "5500000000000" } });
      const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id } });
      const initialized = await authority.initialize({ ...f.scope, conversationId: conversation.id, actorUserId: admin.id,
        logicalKey: key(), reason: "INITIAL_HUMAN", state: "HUMAN", ownerUserId: agent.id });
      assert.equal(initialized.toOwnerUserId, agent.id);
    });
    await t.test("ledger retention rejects deletion in every operation state and parent cascades", async () => {
      for (const status of ["PREPARED", "RESERVED", "DISPATCHING", "UNKNOWN", "SENT", "FAILED", "CANCELED"]) {
        const f = await fixture(), op = await outbound.prepare(f.prepared);
        if (!["PREPARED", "CANCELED"].includes(status)) {
          const reserved = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reserved?.reservationToken);
          if (status !== "RESERVED") {
            await outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reserved.reservationToken });
            if (status !== "DISPATCHING") await outbound.finish({ ...opInput(f, op.id), token: reserved.reservationToken,
              status: status as "UNKNOWN" | "SENT" | "FAILED", ...(status === "SENT" ? { providerMessageId: key() } : {}) });
          }
        } else if (status === "CANCELED") {
          await authority.transition({ ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "CANCEL_TEST", expectedGeneration: BigInt(1), state: "HUMAN_QUEUE" });
        }
        await assert.rejects(db.outboundOperation.delete({ where: { id: op.id } }));
        await assert.rejects(db.outboundOperation.deleteMany({ where: { id: op.id } }));
        await assert.rejects(db.conversationAuthority.delete({ where: { id: f.current.id } }));
        await assert.rejects(db.conversation.delete({ where: { id: f.conversationId } }));
        await assert.rejects(db.contact.delete({ where: { id: f.contact.id } }));
        await assert.rejects(db.channel.delete({ where: { id: channel.id } }));
        await assert.rejects(db.company.delete({ where: { id: company.id } }));
        assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, status);
        await assert.rejects(outbound.prepare({ ...f.prepared, payload: { body: "Conflicting replay" } }), errorCode("IDEMPOTENCY_CONFLICT"));
        if (status === "UNKNOWN" || status === "DISPATCHING") {
          const alternative = await outbound.prepare({ ...f.prepared, logicalKey: key() });
          assert.equal(await outbound.reserve({ ...opInput(f, alternative.id), expectedGeneration: BigInt(1) }), null);
          assert.equal(await db.outboundOperation.count({ where: { activeSlot: f.current.id } }), 1);
        }
        if (postgres) await assert.rejects(db.$executeRawUnsafe('TRUNCATE TABLE "OutboundOperation", "AuthorityEvent"'));
      }
    });
    if (postgres) await t.test("ordinary ORM cannot bypass matrix or same-transaction transition audit", async () => {
      const f = await fixture();
      const before = await authority.get(f.scope); assert(before);
      await assert.rejects(db.conversationAuthority.update({ where: { id: before.id }, data: { state: "CLOSED", ownerUserId: null, generation: BigInt(2) } }));
      await assert.rejects(db.conversationAuthority.update({ where: { id: before.id }, data: { ownerUserId: agent.id, generation: BigInt(2) } }));
      await assert.rejects(db.conversationAuthority.update({ where: { id: before.id }, data: { generation: BigInt(2) } }));
      // A previously committed matching event cannot authorize a later mutation.
      await db.authorityEvent.create({ data: { ...f.scope, authorityId: before.id, actorUserId: admin.id, logicalKey: key(),
        fingerprint: authorityFingerprint({ test: "OLD_TRANSACTION" }), kind: "TRANSITION", reason: "OLD_TRANSACTION",
        fromState: "HUMAN", toState: "CLOSED", fromGeneration: BigInt(1), toGeneration: BigInt(2), fromOwnerUserId: admin.id } });
      await assert.rejects(db.conversationAuthority.update({ where: { id: before.id }, data: { state: "CLOSED", ownerUserId: null, generation: BigInt(2) } }));
      assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
      await authority.transition({ ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "LEGITIMATE_CLOSE", expectedGeneration: BigInt(1), state: "CLOSED" });
      await assert.rejects(db.conversationAuthority.update({ where: { id: before.id }, data: { state: "AI", generation: BigInt(3) } }));
      assert.equal((await authority.get(f.scope))?.state, "CLOSED");
      await assert.rejects(db.authorityEvent.update({ where: { id: f.initialized.id }, data: { reason: "TAMPER" } }));
      const contact = await db.contact.create({ data: { companyId: company.id, name: "Unaudited", phone: "5500000000000" } });
      const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id } });
      await assert.rejects(db.conversationAuthority.create({ data: { ...f.scope, conversationId: conversation.id, contactId: contact.id, state: "HUMAN_QUEUE" } }));
    });
    if (postgres) {
      const withAuditSavepoint = (discard: boolean) => new Proxy(db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (fn: (tx: AuthorityTx) => Promise<unknown>, options: { maxWait?: number; timeout?: number; isolationLevel?: "Serializable" }) => target.$transaction(tx => fn(new Proxy(tx, {
          get(transaction, name) {
            if (name !== "authorityEvent") return Reflect.get(transaction, name);
            return new Proxy(transaction.authorityEvent, { get(events, method) {
              if (method !== "create") return Reflect.get(events, method);
              return async (args: Prisma.AuthorityEventCreateArgs) => {
                await transaction.$executeRawUnsafe("SAVEPOINT authority_event_test");
                const event = await events.create({ ...args, data: { ...args.data, auditTransactionId: "caller-cannot-forge-this" } });
                const [{ top }] = await transaction.$queryRaw<Array<{ top: string }>>`SELECT pg_current_xact_id()::text AS top`;
                assert.equal(event.auditTransactionId, top);
                if (discard) await transaction.$executeRawUnsafe("ROLLBACK TO SAVEPOINT authority_event_test");
                await transaction.$executeRawUnsafe("RELEASE SAVEPOINT authority_event_test");
                return event;
              };
            } });
          }
        })), options);
      } });
      await t.test("deferred audit failure rejects before returning any unpersisted result", async () => {
        const f = await fixture(), op = await outbound.prepare(f.prepared);
        assert(await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }));
        const change = { state: "HUMAN_QUEUE", ownerUserId: null, generation: BigInt(2) };
        // Record raw Prisma behavior without requiring a future Prisma version to retain its bug.
        let rawResolved = false;
        try { await db.$transaction(async tx => { await tx.conversationAuthority.update({ where: { id: f.current.id }, data: change }); }); rawResolved = true; } catch { /* A driver rejection is also safe. */ }
        assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
        t.diagnostic(`raw interactive COMMIT resolved after rejection: ${rawResolved}`);
        let returned = false;
        await assert.rejects(async () => {
          await authorityStorage({ db, provider }).transaction(async tx => {
            const updated = await tx.conversationAuthority.update({ where: { id: f.current.id }, data: change });
            await tx.outboundOperation.update({ where: { id: op.id }, data: { status: "CANCELED", activeSlot: null, reservationToken: null, leaseUntil: null } });
            return updated;
          }); returned = true;
        });
        assert.equal(returned, false);
        assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
        assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "RESERVED");
      });
      await t.test("savepoint audit stamp and returned event match committed state and owners", async () => {
        const f = await fixture(), op = await outbound.prepare(f.prepared);
        assert(await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }));
        const nested = createConversationAuthorityService({ db: withAuditSavepoint(false), provider });
        const command = { ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "SAVEPOINT_TRANSFER", expectedGeneration: BigInt(1), state: "HUMAN" as const, ownerUserId: agent.id };
        const event = await nested.transition(command);
        const persisted = await db.authorityEvent.findUniqueOrThrow({ where: { id: event.id } });
        assert.deepEqual(event, persisted);
        assert.match(event.auditTransactionId, /^[0-9]+$/);
        assert.equal(event.fromOwnerUserId, admin.id); assert.equal(event.toOwnerUserId, agent.id);
        assert.equal((await authority.get(f.scope))?.generation, event.toGeneration);
        assert.equal((await authority.get(f.scope))?.ownerUserId, agent.id);
        assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "CANCELED");
        assert.equal((await nested.transition(command)).id, event.id);
        await assert.rejects(db.authorityEvent.update({ where: { id: event.id }, data: { auditTransactionId: "forged" } }));
        const initialContact = await db.contact.create({ data: { companyId: f.companyId, name: "Savepoint initial owner", phone: "5500000000001" } });
        const conversation = await db.conversation.create({ data: { contactId: initialContact.id, channelId: f.channelId } });
        const initialized = await nested.initialize({ ...f.scope, conversationId: conversation.id, actorUserId: admin.id,
          logicalKey: key(), reason: "SAVEPOINT_INITIALIZE", state: "HUMAN", ownerUserId: agent.id });
        assert.equal(initialized.toGeneration, BigInt(0)); assert.equal(initialized.toOwnerUserId, agent.id);
        assert.deepEqual(initialized, await db.authorityEvent.findUniqueOrThrow({ where: { id: initialized.id } }));
        assert.match(initialized.auditTransactionId, /^[0-9]+$/);
      });
      await t.test("rolled-back savepoint cannot supply an audit or a phantom successful transition", async () => {
        const f = await fixture();
        const command = { ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "ROLLBACK_SAVEPOINT", expectedGeneration: BigInt(1), state: "HUMAN_QUEUE" as const };
        await assert.rejects(createConversationAuthorityService({ db: withAuditSavepoint(true), provider }).transition(command));
        assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
        assert.equal(await db.authorityEvent.count({ where: { logicalKey: command.logicalKey } }), 0);
        const storage = authorityStorage({ db, provider });
        const preserved = await storage.transaction(async tx => {
          await tx.$executeRawUnsafe("SAVEPOINT discarded_change");
          await tx.conversationAuthority.update({ where: { id: f.current.id }, data: { state: "HUMAN_QUEUE", ownerUserId: null, generation: BigInt(2) } });
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT discarded_change");
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT discarded_change");
          return tx.conversationAuthority.findUniqueOrThrow({ where: { id: f.current.id } });
        });
        assert.deepEqual(preserved, await authority.get(f.scope));
        const successful = await authority.transition(command);
        assert.equal(successful.toGeneration, BigInt(2));
        assert.deepEqual(successful, await db.authorityEvent.findUniqueOrThrow({ where: { id: successful.id } }));
      });
      await t.test("an older transaction stamp cannot be forged or reused", async () => {
        const f = await fixture();
        const old = await db.authorityEvent.create({ data: { ...f.scope, authorityId: f.current.id, actorUserId: admin.id,
          logicalKey: key(), fingerprint: authorityFingerprint({ old: true }), reason: "OLD_STAMP", kind: "TRANSITION",
          fromState: "HUMAN", toState: "HUMAN_QUEUE", fromGeneration: BigInt(1), toGeneration: BigInt(2), fromOwnerUserId: admin.id,
          auditTransactionId: "forged" } });
        assert.notEqual(old.auditTransactionId, "forged");
        await assert.rejects(authorityStorage({ db, provider }).transaction(async tx => {
          const [{ top }] = await tx.$queryRaw<Array<{ top: string }>>`SELECT pg_current_xact_id()::text AS top`;
          assert.notEqual(old.auditTransactionId, top);
          return tx.conversationAuthority.update({ where: { id: f.current.id }, data: { state: "HUMAN_QUEUE", ownerUserId: null, generation: BigInt(2) } });
        }));
        assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
      });
      await t.test("a fresh transaction stamp cannot authorize mismatched generation, state or owner snapshots", async () => {
        const f = await fixture();
        const valid = { ...f.scope, authorityId: f.current.id, actorUserId: admin.id, fingerprint: authorityFingerprint({ snapshot: true }),
          reason: "SNAPSHOT_MISMATCH", kind: "TRANSITION", fromState: "HUMAN", toState: "HUMAN", fromGeneration: BigInt(1), toGeneration: BigInt(2),
          fromOwnerUserId: admin.id, toOwnerUserId: agent.id };
        for (const mismatch of [{ fromGeneration: BigInt(0) }, { toOwnerUserId: admin.id }, { fromState: "AI", fromOwnerUserId: null }]) {
          const logicalKey = key();
          await assert.rejects(authorityStorage({ db, provider }).transaction(async tx => {
            await tx.conversationAuthority.update({ where: { id: f.current.id }, data: { ownerUserId: agent.id, generation: BigInt(2) } });
            return tx.authorityEvent.create({ data: { ...valid, ...mismatch, logicalKey } });
          }));
          assert.equal(await db.authorityEvent.count({ where: { logicalKey } }), 0);
          assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
          assert.equal((await authority.get(f.scope))?.ownerUserId, admin.id);
        }
      });
      await t.test("late custom deferred constraints reject the public service and roll back revocation", async () => {
        const f = await fixture(), op = await outbound.prepare(f.prepared);
        assert(await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }));
        await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qevora_test_late_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'TEST_LATE_CHECK' THEN RAISE EXCEPTION 'SYNTHETIC_LATE_FAILURE'; END IF; RETURN NEW; END $$`);
        await db.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER authority_test_late_check AFTER INSERT ON "AuthorityEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qevora_test_late_check()');
        try {
          await assert.rejects(authority.transition({ ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "TEST_LATE_CHECK",
            expectedGeneration: BigInt(1), state: "HUMAN_QUEUE" }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "P0001");
          assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
          assert.equal(await db.authorityEvent.count({ where: { authorityId: f.current.id, reason: "TEST_LATE_CHECK" } }), 0);
          assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "RESERVED");
        } finally {
          await db.$executeRawUnsafe('DROP TRIGGER authority_test_late_check ON "AuthorityEvent"');
          await db.$executeRawUnsafe('DROP FUNCTION qevora_test_late_check()');
        }
      });
      await t.test("UNKNOWN release without fresh reconciliation rejects through the protected transaction", async () => {
        const f = await fixture(), op = await outbound.prepare(f.prepared);
        const reserved = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reserved?.reservationToken);
        await outbound.authorizeDispatch({ ...opInput(f, op.id), token: reserved.reservationToken, expectedGeneration: BigInt(1) });
        await outbound.finish({ ...opInput(f, op.id), token: reserved.reservationToken, status: "UNKNOWN" });
        await assert.rejects(authorityStorage({ db, provider }).transaction(tx => tx.outboundOperation.update({ where: { id: op.id },
          data: { status: "FAILED", activeSlot: null, reservationToken: null } })));
        const row = await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } });
        assert.equal(row.status, "UNKNOWN"); assert.equal(row.activeSlot, f.current.id);
        const event = await outbound.reconcileUnknown({ ...opInput(f, op.id), actorUserId: admin.id, logicalKey: key(),
          evidenceReference: "CONTROLLED_EXECUTOR_TERMINATED", executorTerminated: true, resolution: "FAILED" });
        assert.deepEqual(event, await db.authorityEvent.findUniqueOrThrow({ where: { id: event.id } }));
        assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).activeSlot, null);
      });
      await t.test("connection terminated before COMMIT cannot return an unpersisted service transaction result", async () => {
        const f = await fixture();
        await assert.rejects(authorityStorage({ db, provider }).transaction(async tx => {
          await tx.conversationAuthority.update({ where: { id: f.current.id }, data: { updatedAt: new Date() } });
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          const [{ terminated }] = await peer.$queryRaw<Array<{ terminated: boolean }>>`SELECT pg_terminate_backend(${pid}::int) AS terminated`;
          assert.equal(terminated, true);
          return "must not escape";
        }));
        assert.deepEqual(await authority.get(f.scope), f.current);
      });
    }
    await t.test("initialization/admin replay, transitions and takeover CAS", async () => {
      const f = await fixture("HUMAN_QUEUE");
      const cmd = { ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "TAKEOVER", state: "HUMAN" as const, ownerUserId: admin.id, expectedGeneration: BigInt("0") };
      const [a, b] = await Promise.all([authority.transition(cmd), peerAuthority.transition(cmd)]);
      assert.equal(a.id, b.id); assert.equal(a.toGeneration, BigInt("1"));
      await assert.rejects(authority.transition({ ...cmd, ownerUserId: agent.id }), errorCode("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(authority.transition({ ...cmd, logicalKey: key() }), errorCode("GENERATION_CONFLICT"));
      const same = await authority.transition({ ...cmd, logicalKey: key(), expectedGeneration: BigInt("1") });
      assert.equal(same.toGeneration, BigInt("1"));
      await assert.rejects(authority.transition({ ...cmd, logicalKey: key(), expectedGeneration: BigInt("1"), state: "CHATBOT", ownerUserId: null }), errorCode("CHATBOT_ACTIVATION_BLOCKED"));
      await assert.rejects(authority.transition({ ...cmd, actorUserId: agent.id, ownerUserId: agent.id, logicalKey: key(), expectedGeneration: BigInt("1") }), errorCode("FORBIDDEN"));
      await authority.transition({ ...cmd, logicalKey: key(), expectedGeneration: BigInt("1"), state: "HUMAN_QUEUE", ownerUserId: null });
      assert.equal((await authority.get(f.scope))?.state, "HUMAN_QUEUE");
      await authority.transition({ ...cmd, logicalKey: key(), expectedGeneration: BigInt("2"), state: "CLOSED", ownerUserId: null });
      await assert.rejects(authority.transition({ ...cmd, logicalKey: key(), expectedGeneration: BigInt("3"), state: "AI", ownerUserId: null }), errorCode("INVALID_TRANSITION"));
    });
    await t.test("two distinct transitions with the same generation commit only one audited outcome", async () => {
      const f = await fixture();
      const base = { ...f.scope, actorUserId: admin.id, reason: "COMPETING_TRANSITION", expectedGeneration: BigInt(1) };
      const commands = [{ ...base, logicalKey: key(), state: "HUMAN" as const, ownerUserId: agent.id },
        { ...base, logicalKey: key(), state: "HUMAN_QUEUE" as const, ownerUserId: null }];
      const results = await Promise.allSettled([authority.transition(commands[0]), peerAuthority.transition(commands[1])]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const success = results.find(result => result.status === "fulfilled"); assert(success?.status === "fulfilled");
      const row = await authority.get(f.scope); assert(row);
      assert.equal(row.generation, BigInt(2)); assert.equal(row.state, success.value.toState); assert.equal(row.ownerUserId, success.value.toOwnerUserId);
      assert.equal(await db.authorityEvent.count({ where: { authorityId: f.current.id, reason: "COMPETING_TRANSITION" } }), 1);
    });
    await t.test("scope isolation and required real channel, including owner", async () => {
      const f = await fixture();
      assert.equal(await authority.get({ ...f.scope, companyId: foreignCompany.id }), null);
      assert.equal(await authority.get({ ...f.scope, channelId: otherChannel.id }), null);
      await assert.rejects(authority.initialize({ ...f.scope, channelId: foreignChannel.id, state: "HUMAN_QUEUE", actorUserId: admin.id, logicalKey: key(), reason: "TEST" }), errorCode("INVALID_CONVERSATION_SCOPE"));
      await assert.rejects(authority.transition({ ...f.scope, state: "HUMAN", ownerUserId: foreignUser.id, actorUserId: admin.id, logicalKey: key(), reason: "TEST", expectedGeneration: BigInt("1") }), errorCode("FORBIDDEN"));
      const legacy = await db.conversation.create({ data: { contactId: f.contact.id } });
      await assert.rejects(authority.initialize({ ...f.scope, conversationId: legacy.id, state: "HUMAN_QUEUE", actorUserId: admin.id, logicalKey: key(), reason: "TEST" }), errorCode("INVALID_CONVERSATION_SCOPE"));
      await assert.rejects(db.conversationAuthority.create({ data: { ...f.scope, conversationId: legacy.id, channelId: foreignChannel.id, contactId: f.contact.id, state: "HUMAN_QUEUE" } }));
    });
    await t.test("canonical operation replay and immutable intent", async () => {
      const f = await fixture();
      const [a, b] = await Promise.all([outbound.prepare(f.prepared), peerOutbound.prepare(f.prepared)]);
      assert.equal(a.id, b.id);
      await assert.rejects(outbound.prepare({ ...f.prepared, payload: { body: "Different" } }), errorCode("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(outbound.prepare({ ...f.prepared, logicalKey: key(), origin: "CHATBOT" }), errorCode("CHATBOT_ACTIVATION_BLOCKED"));
      await assert.rejects(outbound.prepare({ ...f.prepared, companyId: foreignCompany.id }), errorCode("AUTHORITY_NOT_FOUND"));
      assert.equal(await db.message.count(), 0);
      if (postgres) await assert.rejects(db.outboundOperation.update({ where: { id: a.id }, data: { payload: "tampered" } }));
    });
    await t.test("only one active reservation across independent clients", async () => {
      const f = await fixture();
      const a = await outbound.prepare(f.prepared), b = await outbound.prepare({ ...f.prepared, logicalKey: key() });
      const results = await Promise.all([outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }), peerOutbound.reserve({ ...opInput(f, b.id), expectedGeneration: BigInt("1") })]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await db.outboundOperation.count({ where: { activeSlot: f.current.id } }), 1);
    });
    await t.test("two independent OS processes receive at most one dispatch permit", async () => {
      const f = await fixture(), op = await outbound.prepare(f.prepared);
      const competing = await outbound.prepare({ ...f.prepared, logicalKey: key() });
      const moduleUrl = (file: string) => pathToFileURL(path.join(process.cwd(), file)).href;
      const source = `
        import { PrismaClient } from ${JSON.stringify(moduleUrl("node_modules/@prisma/client/default.js"))};
        const module = await import(${JSON.stringify(moduleUrl("src/lib/outbound-operation.service.ts"))});
        const { createOutboundOperationService } = module.default ?? module;
        const db = new PrismaClient({ datasources: { db: { url: process.env.AUTHORITY_TEST_DATABASE_URL } } });
        try {
          const service = createOutboundOperationService({ db, provider: ${JSON.stringify(provider)} });
          const input = JSON.parse(process.env.AUTHORITY_PROCESS_INPUT);
          input.expectedGeneration = BigInt(input.expectedGeneration);
          const reserved = await service.reserve(input);
          if (reserved) await service.authorizeDispatch({ ...input, token: reserved.reservationToken });
          console.log(JSON.stringify({ permit: Boolean(reserved) }));
        } finally { await db.$disconnect(); }
      `;
      const run = (operationId: string) => new Promise<boolean>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, "--input-type=module", "--eval", source], {
          env: { ...process.env, AUTHORITY_PROCESS_INPUT: JSON.stringify({ ...opInput(f, operationId), expectedGeneration: "1" }) },
          windowsHide: true, timeout: 20000
        });
        let stdout = "", stderr = "";
        child.stdout.on("data", data => { stdout += data; });
        child.stderr.on("data", data => { stderr += data; });
        child.on("error", reject);
        child.on("close", code => {
          if (code !== 0) reject(new Error(`Disposable authority child failed: ${stderr}`));
          else { try { resolve(JSON.parse(stdout.trim()).permit); } catch (error) { reject(error); } }
        });
      });
      assert.equal((await Promise.all([run(op.id), run(competing.id)])).filter(Boolean).length, 1);
      assert.equal(await db.outboundOperation.count({ where: { authorityId: f.current.id, status: "DISPATCHING" } }), 1);
    });
    await t.test("revocation cancels only un-dispatched operations and never increments on replay", async () => {
      const f = await fixture("AI"); const a = await outbound.prepare(f.prepared);
      const reserve = await outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }); assert(reserve?.reservationToken);
      const cmd = { ...f.scope, actorUserId: admin.id, state: "HUMAN" as const, ownerUserId: admin.id, expectedGeneration: BigInt("1"), logicalKey: key(), reason: "HUMAN_TAKEOVER" };
      await authority.transition(cmd); await authority.transition(cmd);
      assert.equal((await authority.get(f.scope))?.generation, BigInt("2"));
      assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: a.id } })).status, "CANCELED");
      await assert.rejects(outbound.authorizeDispatch({ ...opInput(f, a.id), token: reserve.reservationToken, expectedGeneration: BigInt("1") }));
      await assert.rejects(outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }));
      assert.equal((await outbound.prepare(f.prepared)).status, "CANCELED");
    });
    await t.test("dispatch authorization is not replayable; late result never restores authority", async () => {
      const f = await fixture("AI"); const a = await outbound.prepare(f.prepared);
      const reserve = await outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }); assert(reserve?.reservationToken);
      const dispatch = { ...opInput(f, a.id), token: reserve.reservationToken, expectedGeneration: BigInt("1") };
      const outcomes = await Promise.allSettled([outbound.authorizeDispatch(dispatch), peerOutbound.authorizeDispatch(dispatch)]);
      assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
      await authority.transition({ ...f.scope, actorUserId: admin.id, state: "HUMAN", ownerUserId: admin.id, expectedGeneration: BigInt("1"), logicalKey: key(), reason: "HUMAN_TAKEOVER" });
      const done = { ...opInput(f, a.id), token: reserve.reservationToken, status: "SENT" as const, providerMessageId: key() };
      await outbound.finish(done); await outbound.finish(done);
      await assert.rejects(outbound.finish({ ...done, providerMessageId: key() }), errorCode("RESULT_CONFLICT"));
      assert.equal((await authority.get(f.scope))?.state, "HUMAN");
      assert.equal((await authority.get(f.scope))?.generation, BigInt("2"));
      assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversationId } })).agentId, null);
    });
    await t.test("expired reservation recovers; expired dispatch stays UNKNOWN until audited reconciliation", async () => {
      const f = await fixture(); const a = await outbound.prepare(f.prepared);
      const first = await outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1"), leaseMs: 100 }); assert(first?.reservationToken);
      await new Promise(resolve => setTimeout(resolve, 150));
      await assert.rejects(outbound.authorizeDispatch({ ...opInput(f, a.id), expectedGeneration: BigInt("1"), token: first.reservationToken }), errorCode("RESERVATION_CONFLICT"));
      assert.equal((await outbound.recover(opInput(f, a.id))).status, "PREPARED");
      const second = await outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }); assert(second?.reservationToken);
      assert.notEqual(first.reservationToken, second.reservationToken);
      await outbound.authorizeDispatch({ ...opInput(f, a.id), expectedGeneration: BigInt("1"), token: second.reservationToken });
      assert.equal((await outbound.recover(opInput(f, a.id))).status, "DISPATCHING");
      await db.outboundOperation.update({ where: { id: a.id }, data: { dispatchDeadline: new Date(0) } });
      const unknown = await outbound.recover(opInput(f, a.id));
      assert.equal(unknown.status, "UNKNOWN"); assert.equal(unknown.activeSlot, f.current.id);
      await assert.rejects(outbound.reserve({ ...opInput(f, a.id), expectedGeneration: BigInt("1") }), errorCode("INVALID_OPERATION_STATE"));
      const b = await outbound.prepare({ ...f.prepared, logicalKey: key() });
      assert.equal(await outbound.reserve({ ...opInput(f, b.id), expectedGeneration: BigInt("1") }), null);
      const reconcile = { ...opInput(f, a.id), actorUserId: admin.id, logicalKey: key(), evidenceReference: "TEST_EXECUTOR_TERMINATED_NO_ACCEPTANCE", executorTerminated: true, resolution: "FAILED" as const };
      await assert.rejects(outbound.reconcileUnknown({ ...reconcile, executorTerminated: false }), errorCode("EXECUTOR_QUIESCENCE_REQUIRED"));
      await assert.rejects(outbound.reconcileUnknown({ ...reconcile, actorUserId: agent.id }), errorCode("FORBIDDEN"));
      const event = await outbound.reconcileUnknown(reconcile);
      assert.equal((await outbound.reconcileUnknown(reconcile)).id, event.id);
      assert.equal(event.fromGeneration, event.toGeneration);
      assert(await outbound.reserve({ ...opInput(f, b.id), expectedGeneration: BigInt("1") }));
      if (postgres) await assert.rejects(db.authorityEvent.delete({ where: { id: event.id } }));
    });
    await t.test("campaign intent never acquires authority and terminal failures never retry", async () => {
      const f = await fixture("HUMAN_QUEUE");
      const campaign = await outbound.prepare({ ...f.prepared, origin: "CAMPAIGN" });
      const reservation = await outbound.reserve({ ...opInput(f, campaign.id), expectedGeneration: BigInt("0") }); assert(reservation?.reservationToken);
      await outbound.authorizeDispatch({ ...opInput(f, campaign.id), expectedGeneration: BigInt("0"), token: reservation.reservationToken });
      await outbound.finish({ ...opInput(f, campaign.id), token: reservation.reservationToken, status: "FAILED" });
      await assert.rejects(outbound.reserve({ ...opInput(f, campaign.id), expectedGeneration: BigInt("0") }), errorCode("INVALID_OPERATION_STATE"));
      assert.equal((await authority.get(f.scope))?.state, "HUMAN_QUEUE");
      assert.equal((await authority.get(f.scope))?.generation, BigInt("0"));
      assert.equal(await db.message.count(), 0); assert.equal(await db.task.count(), 0); assert.equal(await db.proposal.count(), 0);
      assert.equal(await db.chatbotSession.count(), 0); assert.equal(await db.campaign.count(), 0);
    });
    await t.test("state matrix is exhaustive for reachable states and initialization is replayable", async () => {
      for (const from of ["HUMAN_QUEUE", "HUMAN", "AI", "CLOSED"] as const) {
        for (const to of ["HUMAN_QUEUE", "HUMAN", "AI", "CLOSED"] as const) {
          const f = await fixture("HUMAN_QUEUE");
          const initialize = { ...f.scope, state: "HUMAN_QUEUE" as const, actorUserId: admin.id,
            logicalKey: f.initialized.logicalKey, reason: "TEST_INITIALIZE" };
          assert.equal((await authority.initialize(initialize)).id, f.initialized.id);
          await assert.rejects(authority.initialize({ ...initialize, state: "AI" }), errorCode("EXPLICIT_AI_TRANSITION_REQUIRED"));
          if (from !== "HUMAN_QUEUE") await authority.transition({ ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "SETUP", expectedGeneration: BigInt(0), state: from,
            ...(from === "HUMAN" ? { ownerUserId: admin.id } : {}) });
          const current = await authority.get(f.scope); assert(current);
          const change = { ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "MATRIX", expectedGeneration: current.generation,
            state: to, ...(to === "HUMAN" ? { ownerUserId: admin.id } : {}) };
          if (from === "CLOSED" && to === "AI") await assert.rejects(authority.transition(change), errorCode("INVALID_TRANSITION"));
          else {
            const event = await authority.transition(change);
            assert.equal(event.toState, to);
            assert.equal(event.toGeneration, current.generation + BigInt(from === to ? 0 : 1));
          }
        }
      }
    });
    await t.test("takeover races dispatch without authorizing after revocation", async () => {
      for (let iteration = 0; iteration < 4; iteration++) {
        const f = await fixture("AI"), op = await outbound.prepare(f.prepared);
        const reservation = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reservation?.reservationToken);
        const results = await Promise.allSettled([
          outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reservation.reservationToken }),
          peerAuthority.transition({ ...f.scope, actorUserId: admin.id, logicalKey: key(), reason: "RACE_TAKEOVER", state: "HUMAN", ownerUserId: admin.id, expectedGeneration: BigInt(1) })
        ]);
        assert.equal(results[1].status, "fulfilled");
        const row = await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } });
        assert.equal(row.status, results[0].status === "fulfilled" ? "DISPATCHING" : "CANCELED");
        await assert.rejects(outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reservation.reservationToken }));
        assert.equal((await authority.get(f.scope))?.generation, BigInt(2));
      }
    });
    await t.test("audit write failure rolls back generation and revocation atomically", async () => {
      const f = await fixture("AI"), op = await outbound.prepare(f.prepared);
      assert(await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }));
      const faulty = new Proxy(db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (fn: (tx: AuthorityTx) => Promise<unknown>, options: { maxWait?: number; timeout?: number; isolationLevel?: "Serializable" }) => target.$transaction(tx => fn(new Proxy(tx, {
          get(transaction, name) {
            if (name !== "authorityEvent") return Reflect.get(transaction, name);
            return new Proxy(transaction.authorityEvent, { get(events, method) {
              if (method === "create") return () => { throw new Error("SIMULATED_AUDIT_FAILURE"); };
              return Reflect.get(events, method);
            } });
          }
        })), options);
      } });
      await assert.rejects(createConversationAuthorityService({ db: faulty, provider }).transition({ ...f.scope,
        actorUserId: admin.id, logicalKey: key(), reason: "ROLLBACK", expectedGeneration: BigInt(1), state: "HUMAN", ownerUserId: admin.id }), /SIMULATED_AUDIT_FAILURE/);
      assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
      assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "RESERVED");
    });
    await t.test("destination changes and malformed results never consume a send permit", async () => {
      const f = await fixture(), op = await outbound.prepare(f.prepared);
      const reserve = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reserve?.reservationToken);
      await db.contact.update({ where: { id: f.contact.id }, data: { phone: "5500000000001" } });
      await assert.rejects(outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reserve.reservationToken }), errorCode("DESTINATION_CHANGED"));
      await assert.rejects(outbound.finish({ ...opInput(f, op.id), token: reserve.reservationToken, status: "SENT" }), errorCode("INVALID_REFERENCE"));
      await assert.rejects(outbound.finish({ ...opInput(f, op.id), token: reserve.reservationToken, status: "FAILED", providerMessageId: "invalid" }), errorCode("INVALID_RESULT"));
      if (postgres) {
        await assert.rejects(db.outboundOperation.update({ where: { id: op.id }, data: { activeSlot: "different-authority" } }));
        await assert.rejects(db.outboundOperation.update({ where: { id: op.id }, data: { origin: "CHATBOT" } }));
        await assert.rejects(db.conversationAuthority.update({ where: { id: f.current.id }, data: { generation: BigInt(100) } }));
      }
    });
    await t.test("explicit UNKNOWN retains exclusivity and requires audit even for SQL reconciliation", async () => {
      const f = await fixture(), op = await outbound.prepare(f.prepared);
      const reserve = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reserve?.reservationToken);
      await outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reserve.reservationToken });
      const finish = { ...opInput(f, op.id), token: reserve.reservationToken, status: "UNKNOWN" as const };
      assert.equal((await outbound.finish(finish)).status, "UNKNOWN");
      assert.equal((await outbound.finish(finish)).status, "UNKNOWN");
      await assert.rejects(outbound.finish({ ...finish, status: "SENT", providerMessageId: key() }), errorCode("RESULT_CONFLICT"));
      if (postgres) await assert.rejects(db.outboundOperation.update({ where: { id: op.id }, data: { status: "FAILED", activeSlot: null, reservationToken: null } }));
      const providerMessageId = key();
      const audit = await outbound.reconcileUnknown({ ...opInput(f, op.id), actorUserId: admin.id, logicalKey: key(), evidenceReference: "CONFIRMED_ACCEPTANCE_AND_EXECUTOR_STOPPED",
        executorTerminated: true, resolution: "SENT", providerMessageId });
      assert.equal(audit.kind, "RECONCILE_UNKNOWN");
      assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).providerMessageId, providerMessageId);
      assert.equal((await authority.get(f.scope))?.generation, BigInt(1));
    });
    await t.test("a lease expiring during eligibility cannot cross the dispatch CAS", async () => {
      const f = await fixture(), op = await outbound.prepare(f.prepared);
      const reserved = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1), leaseMs: 1000 }); assert(reserved?.reservationToken);
      let eligibilityReads = 0;
      const delayed = new Proxy(db, { get(target, property) {
        if (property !== "$transaction") return Reflect.get(target, property);
        return (fn: (tx: AuthorityTx) => Promise<unknown>, options: { maxWait?: number; timeout?: number; isolationLevel?: "Serializable" }) => target.$transaction(tx => fn(new Proxy(tx, {
          get(transaction, name) {
            if (name !== "conversation") return Reflect.get(transaction, name);
            return new Proxy(transaction.conversation, { get(conversations, method) {
              if (method === "findFirst") return async (...args: Parameters<typeof conversations.findFirst>) => {
                eligibilityReads++; await new Promise(resolve => setTimeout(resolve, 1200));
                return conversations.findFirst(...args);
              };
              return Reflect.get(conversations, method);
            } });
          }
        })), options);
      } });
      await assert.rejects(createOutboundOperationService({ db: delayed, provider }).authorizeDispatch({ ...opInput(f, op.id),
        expectedGeneration: BigInt(1), token: reserved.reservationToken }), errorCode("RESERVATION_CONFLICT"));
      assert.equal(eligibilityReads, 1);
      assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } })).status, "RESERVED");
      assert.equal((await outbound.recover(opInput(f, op.id))).status, "PREPARED");
    });
    await t.test("simulated external acceptance followed by crash never causes a blind resend", async () => {
      const f = await fixture("AI"), op = await outbound.prepare(f.prepared);
      const reserved = await outbound.reserve({ ...opInput(f, op.id), expectedGeneration: BigInt(1) }); assert(reserved?.reservationToken);
      let simulatedMetaCalls = 0;
      const simulatedMeta = async () => { simulatedMetaCalls++; return { id: "synthetic-provider-acceptance" }; };
      await outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reserved.reservationToken });
      await simulatedMeta();
      // Simulate process death before finish(): recovery cannot know acceptance occurred.
      await db.outboundOperation.update({ where: { id: op.id }, data: { dispatchDeadline: new Date(0) } });
      assert.equal((await outbound.recover(opInput(f, op.id))).status, "UNKNOWN");
      for (let repeat = 0; repeat < 3; repeat++) {
        await assert.rejects(outbound.authorizeDispatch({ ...opInput(f, op.id), expectedGeneration: BigInt(1), token: reserved.reservationToken }));
        assert.equal((await outbound.recover(opInput(f, op.id))).status, "UNKNOWN");
      }
      assert.equal(simulatedMetaCalls, 1);
      assert.equal(await db.message.count(), 0);
    });
  } finally { await db.$disconnect(); await peer.$disconnect(); }
});
