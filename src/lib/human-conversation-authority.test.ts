import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { authorityStorage, type AuthorityDatabase, type AuthorityTx } from "./conversation-authority-storage";
import { createConversationAuthorityService } from "./conversation-authority.service";
import { createOutboundOperationService } from "./outbound-operation.service";
import type { HumanAuthorityCommand } from "./human-conversation-authority.service";

let human: typeof import("./human-conversation-authority.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { human = await import("./human-conversation-authority.service"); }
  finally { loader._load = original; }
});
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);
const zero = BigInt(0), one = BigInt(1);
const base: HumanAuthorityCommand = { kind: "CLAIM_SELF", companyId: "company", conversationId: "conversation", actorUserId: "actor",
  logicalKey: "intent", expectation: { kind: "ABSENT" } };

test("human commands validate a closed intent contract before touching the database", async () => {
  const fake = new Proxy({}, { get() { throw new Error("DATABASE_TOUCHED"); } }) as PrismaClient;
  const service = human.createHumanConversationAuthorityService({ db: fake, provider: "sqlite" });
  for (const field of ["companyId", "conversationId", "actorUserId", "logicalKey"] as const) {
    for (const bad of [null, undefined, "", " ", "x".repeat(257), 4, [], {}]) {
      await assert.rejects(service.execute({ ...base, [field]: bad } as never), code("INVALID_REFERENCE"));
    }
  }
  for (const extra of ["state", "ownerUserId", "generation", "channelId", "targetUserId"]) {
    await assert.rejects(service.execute({ ...base, [extra]: "caller-chosen" } as never), code("INVALID_COMMAND"));
  }
  for (const expectation of [undefined, null, {}, { kind: "EXISTING" }, { kind: "EXISTING", expectedGeneration: "0" },
    { kind: "EXISTING", expectedGeneration: -one }, { kind: "ABSENT", expectedGeneration: zero }]) {
    await assert.rejects(service.execute({ ...base, expectation } as never));
  }
  for (const kind of ["AI", "ROUND_ROBIN", "CLOSE", "REOPEN", "", null]) {
    await assert.rejects(service.execute({ ...base, kind } as never), code("INVALID_COMMAND"));
  }
  for (const kind of ["ASSIGN", "TRANSFER"] as const) {
    await assert.rejects(service.execute({ ...base, kind, targetUserId: "" }), code("INVALID_REFERENCE"));
  }
  const source = { ...base, expectation: { kind: "EXISTING" as const, expectedGeneration: zero } };
  const parsed = human.parseHumanAuthorityCommand(source);
  source.expectation.expectedGeneration = one;
  assert.equal(parsed.expectation.kind === "EXISTING" && parsed.expectation.expectedGeneration, zero);
  assert(Object.isFrozen(parsed) && Object.isFrozen(parsed.expectation));
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    assert.throws(() => human.createHumanConversationAuthorityService({ db: fake, provider: "sqlite" }), code("SERVER_ONLY"));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("adoption mapping uses status/owner only; BOT, SOLD and AI configuration never acquire automation", () => {
  for (const status of ["OPEN", "PENDING", "BOT", "SOLD"]) {
    assert.deepEqual(human.legacyHumanAuthorityState({ status, agentId: null }), { state: "HUMAN_QUEUE", ownerUserId: null });
    assert.deepEqual(human.legacyHumanAuthorityState({ status, agentId: "a" }), { state: "HUMAN", ownerUserId: "a" });
  }
  assert.deepEqual(human.legacyHumanAuthorityState({ status: "RESOLVED", agentId: "a" }), { state: "CLOSED", ownerUserId: null });
  assert.throws(() => human.legacyHumanAuthorityState({ status: "UNKNOWN", agentId: null }), code("INVALID_LEGACY_STATUS"));
  for (const status of ["PENDING", "RESOLVED"]) {
    for (const agentId of ["", "   ", " padded ", "x".repeat(257), undefined, 4]) {
      assert.throws(() => human.legacyHumanAuthorityState({ status, agentId } as never), code("INVALID_LEGACY_OWNER"));
    }
  }
});

test("top-level expectation getter is captured once, preserving the first EXISTING generation", () => {
  let reads = 0;
  const input = Object.defineProperty({ ...base }, "expectation", { enumerable: true, get() {
    return ++reads === 1 ? { kind: "EXISTING", expectedGeneration: BigInt(9) } : { kind: "ABSENT" };
  } });
  const parsed = human.parseHumanAuthorityCommand(input);
  assert.equal(reads, 1);
  assert.deepEqual(parsed.expectation, { kind: "EXISTING", expectedGeneration: BigInt(9) });
  assert(Object.isFrozen(parsed) && Object.isFrozen(parsed.expectation));
});

test("nested expectation getters are captured once into a new plain frozen snapshot", () => {
  let kindReads = 0, generationReads = 0;
  const expectation = {
    get kind() { return ++kindReads === 1 ? "EXISTING" : "ABSENT"; },
    get expectedGeneration() { return ++generationReads === 1 ? BigInt(9) : BigInt(10); }
  };
  const parsed = human.parseHumanAuthorityCommand({ ...base, expectation } as HumanAuthorityCommand);
  assert.equal(kindReads, 1); assert.equal(generationReads, 1);
  assert.notEqual(parsed.expectation, expectation);
  assert.deepEqual(parsed.expectation, { kind: "EXISTING", expectedGeneration: BigInt(9) });
  assert.equal(Object.getOwnPropertyDescriptor(parsed.expectation, "kind")?.get, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(parsed.expectation, "expectedGeneration")?.get, undefined);
  assert(Object.isFrozen(parsed.expectation));
});

test("all caller-controlled command fields are read once; invalid first expectations never become ABSENT", () => {
  const first = { ...base, kind: "ASSIGN", targetUserId: "target", expectation: { kind: "EXISTING", expectedGeneration: BigInt(9) } };
  const reads: Record<string, number> = {};
  const source = Object.fromEntries(Object.entries(first).map(([field, value]) => [field, value]));
  for (const [field, value] of Object.entries(first)) Object.defineProperty(source, field, { enumerable: true, get() {
    reads[field] = (reads[field] ?? 0) + 1;
    return reads[field] === 1 ? value : undefined;
  } });
  const parsed = human.parseHumanAuthorityCommand(source as HumanAuthorityCommand);
  assert.deepEqual(parsed, first);
  assert.deepEqual(reads, Object.fromEntries(Object.keys(first).map(field => [field, 1])));
  for (const bad of [undefined, null, { kind: "UNKNOWN" }, { kind: "EXISTING" },
    { kind: "EXISTING", expectedGeneration: BigInt("9223372036854775808") }]) {
    let count = 0;
    const input = Object.defineProperty({ ...base }, "expectation", { enumerable: true,
      get() { return ++count === 1 ? bad : { kind: "ABSENT" }; } });
    assert.throws(() => human.parseHumanAuthorityCommand(input));
    assert.equal(count, 1);
  }
});

test("passive server-only adapter has no production caller or external effects; CI preserves both material providers", async () => {
  const file = path.join(process.cwd(), "src/lib/human-conversation-authority.service.ts");
  const source = await readFile(file, "utf8");
  assert(source.includes('import "server-only"'));
  assert(source.includes('typeof window === "undefined"'));
  assert(!/\b(fetch|sendMeta|publish|notification|aiPaused|aiMode)\b/.test(source));
  async function scan(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const name = path.join(directory, item.name);
      if (item.isDirectory()) await scan(name);
      else if (/\.tsx?$/.test(item.name) && !/\.(test|integration)\./.test(item.name) && name !== file) {
        const text = await readFile(name, "utf8");
        assert(!/from\s+["'][^"']*human-conversation-authority\.service["']|import\s*\(["'][^"']*human-conversation-authority\.service["']/.test(text), name);
      }
    }
  }
  await scan(path.join(process.cwd(), "src"));
  const ci = await readFile(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  assert.equal(ci.match(/--test src\/lib\/human-conversation-authority\.test\.ts/g)?.length, 2);
});

test("human authority commands commit atomically on a disposable real database", async t => {
  const url = process.env.AUTHORITY_TEST_DATABASE_URL;
  assert(url, "AUTHORITY_TEST_DATABASE_URL required; never skip material checks");
  const postgres = process.env.AUTHORITY_POSTGRES_TEST === "1";
  if (postgres) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "postgresql:");
    assert(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/qevora_authority_test");
    assert(!parsed.searchParams.has("host"));
  } else {
    assert(url.startsWith("file:"));
    const file = path.resolve(url.slice(5));
    assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert(path.basename(file).startsWith("qevora-authority-") && file.endsWith(".db"));
  }
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const peer = new PrismaClient({ datasources: { db: { url } }, log: [] });
  const database: AuthorityDatabase = { db, provider: postgres ? "postgresql" : "sqlite" };
  const service = human.createHumanConversationAuthorityService(database);
  const other = human.createHumanConversationAuthorityService({ ...database, db: peer });
  const storage = authorityStorage(database);
  const authority = createConversationAuthorityService(database);
  const key = () => crypto.randomUUID();
  try {
    if (!postgres) {
      const guards = await readFile(path.join(process.cwd(), "prisma/sqlite/conversation-authority-guards.sql"), "utf8");
      for (const statement of guards.split(/\r?\n-- statement\r?\n/)) await db.$executeRawUnsafe(statement);
    }
    const company = await db.company.create({ data: { name: "Human authority synthetic" } });
    const foreign = await db.company.create({ data: { name: "Foreign synthetic" } });
    const user = async (role: string, companyId = company.id) => db.user.create({ data: {
      companyId, name: "Synthetic", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role
    } });
    const admin = await user("ADMIN"), a = await user("AGENT"), b = await user("AGENT"), supervisor = await user("SUPERVISOR");
    const foreignUser = await user("ADMIN", foreign.id);
    const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta", status: "ACTIVE" } });
    const fixture = async (agentId: string | null = null, status = "PENDING", channelId: string | null = channel.id) => {
      const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5500000000000" } });
      return db.conversation.create({ data: { contactId: contact.id, channelId, agentId, status } });
    };
    const command = (conversationId: string, actorUserId = a.id): HumanAuthorityCommand => ({ ...base, companyId: company.id, conversationId, actorUserId, logicalKey: key() });
    const existing = (generation = one) => ({ kind: "EXISTING" as const, expectedGeneration: generation });
    const row = (conversationId: string) => db.conversationAuthority.findUniqueOrThrow({ where: { conversationId } });
    const projection = async (conversationId: string) => (await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).agentId;
    const snapshot = async () => ({ authorities: await db.conversationAuthority.count(), events: await db.authorityEvent.count(),
      history: await db.leadAssignmentHistory.count() });

    await t.test("invalid legacy owners fail before mutations even for RESOLVED; real empty/whitespace/foreign/unsupported owners remain unchanged", async () => {
      const invalidRole = await user("VIEWER");
      for (const id of ["", "   "]) await db.user.create({ data: {
        id, companyId: company.id, name: "Synthetic invalid reference", email: `${key()}@example.invalid`, passwordHash: "not-a-login", role: "AGENT"
      } });
      for (const status of ["PENDING", "RESOLVED"]) {
        for (const agentId of ["", "   ", foreignUser.id, invalidRole.id]) {
          const c = await fixture(agentId, status), before = await snapshot();
          const original = await db.conversation.findUniqueOrThrow({ where: { id: c.id } });
          let writes = 0;
          const guarded = db.$extends({ query: { $allModels: { async $allOperations({ operation, args, query }) {
            if (/^(create|update|upsert|delete)/.test(operation)) writes++;
            return query(args);
          } } } }) as unknown as PrismaClient;
          const guardedDatabase = { ...database, db: guarded };
          await assert.rejects(authorityStorage(guardedDatabase).transaction(tx =>
            human.adoptLegacyHumanAuthorityInTx(guardedDatabase, tx, { ...command(c.id, admin.id), kind: "RETURN_TO_QUEUE" })), code("INVALID_LEGACY_OWNER"));
          await assert.rejects(human.createHumanConversationAuthorityService(guardedDatabase).execute({
            ...command(c.id, admin.id), kind: "RETURN_TO_QUEUE"
          }), code("INVALID_LEGACY_OWNER"));
          assert.equal(writes, 0);
          assert.deepEqual(await snapshot(), before);
          assert.deepEqual(await db.conversation.findUniqueOrThrow({ where: { id: c.id } }), original);
        }
      }
    });
    await t.test("nonexistent legacy owner at the read boundary fails without writes, not as projection drift", async () => {
      // FKs forbid persisting a nonexistent User. Inject only that impossible read;
      // all other reads and the transaction still cross the real Prisma/database boundary.
      for (const status of ["PENDING", "RESOLVED"]) {
        const c = await fixture(null, status), before = await snapshot(); let writes = 0;
        const missing = db.$extends({ query: {
          conversation: { async findFirst({ args, query }) {
            const result = await query(args);
            return result?.id === c.id ? { ...result, agentId: "synthetic-missing-owner" } : result;
          } },
          $allModels: { async $allOperations({ operation, args, query }) {
            if (/^(create|update|upsert|delete)/.test(operation)) writes++;
            return query(args);
          } }
        } }) as unknown as PrismaClient;
        await assert.rejects(human.createHumanConversationAuthorityService({ ...database, db: missing }).execute({
          ...command(c.id, admin.id), kind: "RETURN_TO_QUEUE"
        }), code("INVALID_LEGACY_OWNER"));
        assert.equal(writes, 0); assert.deepEqual(await snapshot(), before); assert.equal(await projection(c.id), null);
      }
    });

    await t.test("AGENT lazy claim adopts queue generation 0 then HUMAN generation 1 and projection/history atomically", async () => {
      const c = await fixture(); const input = command(c.id);
      const result = await service.execute(input);
      assert.equal(result.event.toGeneration, one); assert.equal(result.replayed, false);
      assert.equal((await row(c.id)).ownerUserId, a.id); assert.equal(await projection(c.id), a.id);
      assert.equal(await db.authorityEvent.count({ where: { conversationId: c.id } }), 2);
      assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 1);
      const before = await snapshot();
      assert.equal((await service.execute(input)).replayed, true);
      assert.deepEqual(await snapshot(), before);
      await service.execute({ ...command(c.id), expectation: existing() });
      assert.equal((await row(c.id)).generation, one);
      assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 1);
    });
    await t.test("public initialize remains administrative; AGENT cannot adopt foreign ownership or return/assign/transfer", async () => {
      const c = await fixture(b.id); const before = await snapshot();
      await assert.rejects(service.execute(command(c.id)), code("OWNERSHIP_CONFLICT"));
      for (const kind of ["ASSIGN", "TRANSFER", "RETURN_TO_QUEUE"] as const) {
        await assert.rejects(service.execute({ ...command(c.id), kind, ...(kind !== "RETURN_TO_QUEUE" ? { targetUserId: a.id } : {}) } as HumanAuthorityCommand), code("FORBIDDEN"));
      }
      await assert.rejects(authority.initialize({ companyId: company.id, channelId: channel.id, conversationId: c.id,
        actorUserId: a.id, logicalKey: key(), reason: "TEST", state: "HUMAN", ownerUserId: b.id }), code("FORBIDDEN"));
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("administrator assign, supervisor transfer and administrative return preserve status and increment only real ownership changes", async () => {
      const c = await fixture(null, "SOLD");
      await service.execute({ ...command(c.id, admin.id), kind: "ASSIGN", targetUserId: a.id });
      await service.execute({ ...command(c.id, supervisor.id), kind: "TRANSFER", targetUserId: b.id, expectation: existing() });
      assert.equal((await row(c.id)).generation, BigInt(2)); assert.equal(await projection(c.id), b.id);
      await service.execute({ ...command(c.id, admin.id), kind: "RETURN_TO_QUEUE", expectation: existing(BigInt(2)) });
      assert.equal((await row(c.id)).generation, BigInt(3)); assert.equal(await projection(c.id), null);
      assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: c.id } })).status, "SOLD");
      assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 3);
    });
    await t.test("RESOLVED primitive adopts CLOSED and clears projection; execute never closes/reopens implicitly", async () => {
      const c = await fixture(a.id, "RESOLVED");
      await storage.transaction(tx => human.adoptLegacyHumanAuthorityInTx(database, tx, command(c.id, admin.id)));
      assert.equal((await row(c.id)).state, "CLOSED"); assert.equal((await row(c.id)).generation, zero);
      assert.equal(await projection(c.id), null);
      const before = await snapshot();
      await assert.rejects(service.execute({ ...command(c.id, admin.id), kind: "ASSIGN", targetUserId: a.id, expectation: existing(zero) }), code("INVALID_TRANSITION"));
      assert.deepEqual(await snapshot(), before);
      const otherResolved = await fixture(a.id, "RESOLVED");
      await assert.rejects(service.execute(command(otherResolved.id)), code("INVALID_TRANSITION"));
    });
    await t.test("existing authority requires generation; ABSENT cannot silently mean latest generation", async () => {
      const c = await fixture(); await service.execute(command(c.id));
      await assert.rejects(service.execute(command(c.id)), code("GENERATION_CONFLICT"));
      await assert.rejects(service.execute({ ...command(c.id), expectation: existing(zero) }), code("GENERATION_CONFLICT"));
      const fresh = await fixture();
      await assert.rejects(service.execute({ ...command(fresh.id), expectation: existing(zero) }), code("GENERATION_CONFLICT"));
    });
    await t.test("same key with changed actor, target, command or expected generation conflicts", async () => {
      const c = await fixture(); const input: HumanAuthorityCommand = { ...command(c.id, admin.id), kind: "ASSIGN", targetUserId: a.id };
      await service.execute(input);
      for (const update of [{ targetUserId: b.id }, { actorUserId: supervisor.id }, { kind: "TRANSFER" }, { expectation: existing() }]) {
        await assert.rejects(service.execute({ ...input, ...update } as HumanAuthorityCommand), code("IDEMPOTENCY_CONFLICT"));
      }
      assert.equal((await row(c.id)).ownerUserId, a.id);
    });
    await t.test("drift in existing authority fails without repair, including replay", async () => {
      const c = await fixture(); const input = command(c.id); await service.execute(input);
      await db.conversation.update({ where: { id: c.id }, data: { agentId: b.id } });
      const before = await snapshot();
      await assert.rejects(service.execute({ ...command(c.id, admin.id), kind: "ASSIGN", targetUserId: a.id, expectation: existing() }), code("AUTHORITY_PROJECTION_DRIFT"));
      await assert.rejects(service.execute(input), code("AUTHORITY_PROJECTION_DRIFT"));
      assert.equal(await projection(c.id), b.id); assert.deepEqual(await snapshot(), before);
    });
    await t.test("cross-company actor/target, invalid role, archived contact and null/foreign/non-Meta channels fail closed", async () => {
      const c = await fixture(); const before = await snapshot();
      await assert.rejects(service.execute({ ...command(c.id), companyId: foreign.id }), code("INVALID_CONVERSATION_SCOPE"));
      await assert.rejects(service.execute(command(c.id, foreignUser.id)), code("FORBIDDEN"));
      const invalid = await user("VIEWER");
      for (const targetUserId of [foreignUser.id, invalid.id, "missing"]) {
        await assert.rejects(service.execute({ ...command(c.id, admin.id), kind: "ASSIGN", targetUserId }), code("FORBIDDEN"));
      }
      const foreignChannel = await db.channel.create({ data: { companyId: foreign.id, name: "Foreign", provider: "meta" } });
      const nonMeta = await db.channel.create({ data: { companyId: company.id, name: "Other", provider: "other" } });
      for (const channelId of [null, foreignChannel.id, nonMeta.id]) {
        const bad = await fixture(null, "PENDING", channelId);
        await assert.rejects(service.execute(command(bad.id)), code("INVALID_CONVERSATION_SCOPE"));
      }
      const archived = await fixture();
      await db.contact.update({ where: { id: archived.contactId }, data: { archivedAt: new Date() } });
      await assert.rejects(service.execute(command(archived.id)), code("INVALID_CONVERSATION_SCOPE"));
      assert.deepEqual(await snapshot(), before);
    });
    const race = async (inputs: HumanAuthorityCommand[]) => {
      const results = await Promise.allSettled(inputs.map((input, index) => (index % 2 ? other : service).execute(input)));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
      assert(code("GENERATION_CONFLICT")(failure.reason));
    };
    await t.test("concurrent adoption/self-claims yield exactly one owner, one Authority and one assignment", async () => {
      const c = await fixture(); await race([command(c.id, a.id), command(c.id, b.id)]);
      assert.equal(await db.conversationAuthority.count({ where: { conversationId: c.id } }), 1);
      assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 1);
      assert.equal((await row(c.id)).generation, one); assert.equal(await projection(c.id), (await row(c.id)).ownerUserId);
    });
    await t.test("existing queue concurrent claim has one generation winner", async () => {
      const c = await fixture();
      await storage.transaction(tx => human.adoptLegacyHumanAuthorityInTx(database, tx, command(c.id, admin.id)));
      await race([ { ...command(c.id, a.id), expectation: existing(zero) }, { ...command(c.id, b.id), expectation: existing(zero) } ]);
      assert.equal((await row(c.id)).generation, one);
    });
    await t.test("transfer vs return and two-admin transfer races cannot last-write-win", async () => {
      for (const returnRace of [true, false]) {
        const c = await fixture(); await service.execute(command(c.id));
        const transfer: HumanAuthorityCommand = { ...command(c.id, admin.id), kind: "TRANSFER", targetUserId: b.id, expectation: existing() };
        const competitor: HumanAuthorityCommand = returnRace
          ? { ...command(c.id, supervisor.id), kind: "RETURN_TO_QUEUE", expectation: existing() }
          : { ...command(c.id, supervisor.id), kind: "TRANSFER", targetUserId: supervisor.id, expectation: existing() };
        await race([transfer, competitor]);
        assert.equal((await row(c.id)).generation, BigInt(2));
        assert.equal(await projection(c.id), (await row(c.id)).ownerUserId);
        assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 2);
      }
    });
    await t.test("concurrent identical key commits one logical mutation; stale replay never restores an older projection", async () => {
      const c = await fixture(); const input = command(c.id);
      const results = await Promise.all([service.execute(input), other.execute(input)]);
      assert.equal(results.filter(r => r.replayed).length, 1);
      await service.execute({ ...command(c.id, admin.id), kind: "TRANSFER", targetUserId: b.id, expectation: existing() });
      assert.equal((await service.execute(input)).replayed, true);
      assert.equal(await projection(c.id), b.id); assert.equal((await row(c.id)).generation, BigInt(2));
      assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: c.id } }), 2);
    });
    await t.test("history failure, transition-event failure and post-command rollback undo adoption/projection/generation/events", async () => {
      for (const table of ["leadAssignmentHistory", "authorityEvent", "outer"] as const) {
        const c = await fixture(); const before = await snapshot();
        let events = 0, transactions = 0;
        const fault = new Proxy(db, { get(target, property) {
          if (property === "$transaction") return (fn: (tx: AuthorityTx) => Promise<unknown>, options: unknown) => target.$transaction(async tx => {
            transactions++;
            const result = await fn(new Proxy(tx, { get(transaction, delegate) {
              if (table !== "outer" && delegate === table) {
                const model = transaction[delegate];
                return new Proxy(model, { get(actual, method) {
                  if (method === "create") return async (...args: unknown[]) => {
                    if (table === "leadAssignmentHistory" || ++events === 2) throw new Error("SYNTHETIC_ROLLBACK");
                    return Reflect.apply(actual.create, actual, args);
                  };
                  return Reflect.get(actual, method);
                } });
              }
              return Reflect.get(transaction, delegate);
            } }));
            if (table === "outer") throw new Error("SYNTHETIC_ROLLBACK");
            return result;
          }, options as never);
          return Reflect.get(target, property);
        } });
        await assert.rejects(human.createHumanConversationAuthorityService({ ...database, db: fault }).execute(command(c.id)), /SYNTHETIC_ROLLBACK/);
        assert.equal(transactions, 1, "no autonomous nested authority transaction");
        assert.equal(await projection(c.id), null); assert.deepEqual(await snapshot(), before);
      }
    });
    await t.test("history failure after an existing transition rolls back generation, projection, audit and reservation cancellation together", async () => {
      const c = await fixture(); await service.execute(command(c.id));
      const scope = { companyId: company.id, channelId: channel.id, conversationId: c.id };
      const outbound = createOutboundOperationService(database);
      const operation = await outbound.prepare({ ...scope, expectedGeneration: one, logicalKey: key(), origin: "HUMAN", actorUserId: a.id, payload: { text: "Synthetic" } });
      await outbound.reserve({ ...scope, operationId: operation.id, expectedGeneration: one });
      const previousAuthority = await row(c.id), before = await snapshot();
      const previousOperation = await db.outboundOperation.findUniqueOrThrow({ where: { id: operation.id } });
      const fault = db.$extends({ query: { leadAssignmentHistory: {
        async create() { throw new Error("SYNTHETIC_HISTORY_FAILURE"); }
      } } }) as unknown as PrismaClient;
      await assert.rejects(human.createHumanConversationAuthorityService({ ...database, db: fault }).execute({
        ...command(c.id, admin.id), kind: "TRANSFER", targetUserId: b.id, expectation: existing()
      }), /SYNTHETIC_HISTORY_FAILURE/);
      assert.deepEqual(await row(c.id), previousAuthority);
      assert.equal(await projection(c.id), a.id);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await db.outboundOperation.findUniqueOrThrow({ where: { id: operation.id } }), previousOperation);
    });
    await t.test("ownership changes cancel only PREPARED/RESERVED; dispatching/unknown/terminal records remain byte-for-byte unchanged", async () => {
      for (const status of ["PREPARED", "RESERVED", "DISPATCHING", "UNKNOWN", "SENT", "FAILED", "CANCELED"] as const) {
        const c = await fixture(); await service.execute(command(c.id));
        const scope = { companyId: company.id, channelId: channel.id, conversationId: c.id };
        const outbound = createOutboundOperationService(database);
        const op = await outbound.prepare({ ...scope, expectedGeneration: one, logicalKey: key(), origin: "HUMAN", actorUserId: a.id, payload: { text: "Synthetic" } });
        const selected = { ...scope, operationId: op.id };
        if (status !== "PREPARED" && status !== "CANCELED") {
          const reservation = await outbound.reserve({ ...selected, expectedGeneration: one }); assert(reservation?.reservationToken);
          if (status !== "RESERVED") {
            await outbound.authorizeDispatch({ ...selected, token: reservation.reservationToken, expectedGeneration: one });
            if (status !== "DISPATCHING") await outbound.finish({ ...selected, token: reservation.reservationToken, status,
              ...(status === "SENT" ? { providerMessageId: key() } : {}) });
          }
        }
        if (status === "CANCELED") {
          await service.execute({ ...command(c.id, admin.id), kind: "TRANSFER", targetUserId: b.id, expectation: existing() });
        }
        const before = await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } });
        await service.execute({ ...command(c.id, admin.id), kind: "RETURN_TO_QUEUE", expectation: existing(status === "CANCELED" ? BigInt(2) : one) });
        const after = await db.outboundOperation.findUniqueOrThrow({ where: { id: op.id } });
        if (status === "PREPARED" || status === "RESERVED") {
          assert.equal(after.status, "CANCELED"); assert.equal(after.activeSlot, null); assert.equal(after.reservationToken, null); assert.equal(after.leaseUntil, null);
        } else assert.deepEqual(after, before);
      }
    });
  } finally { await peer.$disconnect(); await db.$disconnect(); }
});
