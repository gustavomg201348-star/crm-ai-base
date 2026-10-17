import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertInboundEventTestDatabase } from "./conversation-inbound-event-test.guard";
import { createInboundMessageWithDurableEvent, inboundEventTransaction } from "./conversation-inbound-event";
import { persistInboundMessage } from "./meta-reply-ingestion";
import { readReplySnapshot } from "./meta-reply-snapshot";
import { readMetaReplyMetadata } from "./meta-reply-metadata";

const provider = assertInboundEventTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
const independent = new PrismaClient({ log: [] });
before(async () => {
  if (provider === "sqlite") {
    // Explicit bootstrap mirrors production partial ID uniqueness and custom guards.
    const sql = readFileSync("prisma/sqlite/conversation-inbound-event-guards.sql", "utf8");
    for (const statement of sql.split("-- statement").map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
  }
});
after(async () => { await independent.$disconnect(); await db.$disconnect(); });
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic inbound event company" } });
  const other = await db.company.create({ data: { name: "Synthetic other company" } });
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "SYNTHETIC_NOT_A_PHONE" } });
  const foreignContact = await db.contact.create({ data: { companyId: other.id, name: "Synthetic", phone: "SYNTHETIC_NOT_A_PHONE" } });
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", type: "whatsapp", provider: "meta" } });
  const alternative = await db.channel.create({ data: { companyId: company.id, name: "Synthetic other channel", type: "whatsapp", provider: "meta" } });
  const foreignChannel = await db.channel.create({ data: { companyId: other.id, name: "Synthetic foreign channel", type: "whatsapp", provider: "meta" } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
  const legacy = await db.conversation.create({ data: { contactId: contact.id, channelId: null, status: "PENDING" } });
  const foreign = await db.conversation.create({ data: { contactId: foreignContact.id, channelId: foreignChannel.id, status: "PENDING" } });
  const write = (id = randomUUID(), target = conversation.id, client = db) => inboundEventTransaction(client,
    tx => createInboundMessageWithDurableEvent(tx, company.id, { conversationId: target, direction: "inbound", senderType: "customer", body: "Synthetic private message", providerMessageId: id }));
  const events = (target = conversation.id) => db.conversationInboundEvent.findMany({ where: { conversationId: target }, orderBy: { sequence: "asc" } });
  const counter = async (target = conversation.id) => (await db.conversation.findUniqueOrThrow({ where: { id: target } })).inboundEventSequence;
  return { company, other, contact, foreignContact, channel, alternative, foreignChannel, conversation, legacy, foreign, write, events, counter };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, work: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try { await work(await fixture()); }
    catch (error) {
      // Never let Prisma arguments, message body, identifiers or datasource leak to logs.
      const state = error instanceof Prisma.PrismaClientKnownRequestError && /^[0-9A-Z]{5}$/.test(String(error.meta?.code)) ? ":" + String(error.meta?.code) : "";
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code + state : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("INBOUND_EVENT_MATERIAL_FAILED:" + code);
    }
  });
}
material("01 schema columns, PK, unique indexes, composite FKs and conservative actions", async f => {
  if (provider === "postgresql") {
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ConversationInboundEvent'`;
    assert.deepEqual(columns.map(row => row.column_name).sort(), ["id", "companyId", "contactId", "channelId", "conversationId", "messageId", "sequence", "createdAt"].sort());
    const constraints = await db.$queryRaw<Array<{ contype: string; confdeltype: string; confupdtype: string }>>`SELECT contype::text, confdeltype::text, confupdtype::text FROM pg_constraint WHERE conrelid='"ConversationInboundEvent"'::regclass`;
    assert.equal(constraints.filter(row => row.contype === "p").length, 1);
    const fks = constraints.filter(row => row.contype === "f"); assert.equal(fks.length, 6);
    assert.ok(fks.every(row => row.confdeltype === "r" && row.confupdtype === "a"));
    const indexes = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='ConversationInboundEvent'`;
    for (const name of ["ConversationInboundEvent_pkey", "InboundEvent_message_key", "InboundEvent_message_conversation_key", "InboundEvent_conversation_sequence_key", "InboundEvent_scope_created_idx"]) assert.ok(indexes.some(row => row.indexname === name));
    assert.match(indexes.find(row => row.indexname === "InboundEvent_conversation_sequence_key")!.indexdef, /UNIQUE.*"conversationId", sequence/);
    const definitions = await db.$queryRaw<Array<{ definition: string }>>`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='"ConversationInboundEvent"'::regclass AND contype='f'`;
    for (const fields of ['("companyId", "contactId")', '("companyId", "channelId")', '("conversationId", "contactId", "channelId")', '("messageId", "conversationId")']) assert.ok(definitions.some(row => row.definition.includes(fields)));
  } else {
    const columns = await db.$queryRawUnsafe<Array<{ name: string; pk: bigint }>>('PRAGMA table_info("ConversationInboundEvent")');
    assert.deepEqual(columns.map(row => row.name).sort(), ["id", "companyId", "contactId", "channelId", "conversationId", "messageId", "sequence", "createdAt"].sort());
    assert.equal(columns.filter(row => Number(row.pk) === 1).length, 1);
    const fks = await db.$queryRawUnsafe<Array<{ id: bigint; on_delete: string; on_update: string }>>('PRAGMA foreign_key_list("ConversationInboundEvent")');
    assert.equal(new Set(fks.map(row => String(row.id))).size, 6);
    assert.ok(fks.every(row => row.on_delete === "RESTRICT" && row.on_update === "NO ACTION"));
  }
  assert.equal(await f.counter(), BigInt("0"));
});
material("02 first sequence, exact Message linkage, monotonicity and no duplicated PII", async f => {
  const a = await f.write(); const b = await f.write(); const rows = await f.events();
  assert.deepEqual(rows.map(row => row.sequence), [BigInt("1"), BigInt("2")]);
  assert.deepEqual(rows.map(row => row.messageId), [a.id, b.id]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "companyId", "contactId", "channelId", "conversationId", "messageId", "sequence", "createdAt"].sort());
  assert.equal(rows[0].companyId, f.company.id); assert.equal(rows[0].channelId, f.channel.id);
  assert.ok(rows[0].createdAt instanceof Date);
  const after = await db.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } });
  assert.equal(after.updatedAt.getTime(), f.conversation.updatedAt.getTime());
  assert.equal(after.unreadCount, f.conversation.unreadCount);
  assert.equal(after.lastMessagePreview, f.conversation.lastMessagePreview);
});
material("03 channel-null legacy and channel-bound Conversations have independent counters", async f => {
  await f.write(); const legacy = await f.write(randomUUID(), f.legacy.id);
  const rows = await f.events(f.legacy.id); assert.equal(rows[0].channelId, null);
  assert.equal(rows[0].messageId, legacy.id); assert.equal(rows[0].sequence, BigInt("1"));
  assert.equal(await f.counter(), BigInt("1"));
});
material("04 two independent clients, distinct inbound Messages and consecutive sequences", async f => {
  const rows = await Promise.all([f.write(randomUUID(), f.conversation.id, db), f.write(randomUUID(), f.conversation.id, independent)]);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.deepEqual((await f.events()).map(row => row.sequence), [BigInt("1"), BigInt("2")]);
});
material("05 duplicate provider ID race recovers existing Message and rolls back losing allocation", async f => {
  const providerMessageId = randomUUID();
  // Same recovery used by processInboundMessage after P2002, before its post-persistence effects.
  const ingress = async (client: PrismaClient) => {
    try { return await f.write(providerMessageId, f.conversation.id, client); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      return client.message.findFirstOrThrow({ where: { providerMessageId, conversation: { contact: { companyId: f.company.id } } } });
    }
  };
  const [a, b] = await Promise.all([ingress(db), ingress(independent)]); assert.equal(a.id, b.id);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 1);
  assert.equal((await f.events()).length, 1); assert.equal(await f.counter(), BigInt("1"));
  assert.equal((await ingress(independent)).id, a.id); assert.equal(await f.counter(), BigInt("1"));
  await f.write(); assert.deepEqual((await f.events()).map(row => row.sequence), [BigInt("1"), BigInt("2")]);
});
material("06 real rollback AFTER observed Message, snapshot, counter AND Event inserts", async f => {
  let observed = false;
  await assert.rejects(inboundEventTransaction(db, async tx => {
    const message = await createInboundMessageWithDurableEvent(tx, f.company.id, { conversationId: f.conversation.id, direction: "inbound", body: "Synthetic", metaReplySnapshot: "synthetic-snapshot" });
    observed = Boolean(await tx.message.findUnique({ where: { id: message.id } })) &&
      await tx.conversationInboundEvent.count({ where: { conversationId: f.conversation.id } }) === 1 &&
      (await tx.conversation.findUniqueOrThrow({ where: { id: f.conversation.id } })).inboundEventSequence === BigInt("1");
    throw new Error("SYNTHETIC_ROLLBACK");
  }), /SYNTHETIC_ROLLBACK/);
  assert.equal(observed, true); assert.equal(await f.counter(), BigInt("0"));
  assert.equal((await f.events()).length, 0); assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 0);
  await f.write(); assert.equal((await f.events())[0].sequence, BigInt("1"));
});
material("07 real Event FK/scope failure after Message insert rolls back Message and allocation", async f => {
  let observed = false;
  await assert.rejects(inboundEventTransaction(db, async tx => {
    const wrapped = new Proxy(tx, { get(target, key) {
      if (key !== "conversationInboundEvent") return Reflect.get(target, key);
      return { create: async (args: Prisma.ConversationInboundEventCreateArgs) => {
        observed = await tx.message.count({ where: { conversationId: f.conversation.id } }) === 1;
        return tx.conversationInboundEvent.create({ ...args, data: { ...args.data, messageId: "missing-synthetic-message" } } as Prisma.ConversationInboundEventCreateArgs);
      } };
    } });
    await createInboundMessageWithDurableEvent(wrapped, f.company.id, { conversationId: f.conversation.id, direction: "inbound", body: "Synthetic" });
  }));
  assert.equal(observed, true); assert.equal(await f.counter(), BigInt("0")); assert.equal((await f.events()).length, 0);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 0);
});
for (const variant of ["company", "contact", "channel", "null-channel", "conversation", "message", "direction", "sequence-zero", "unallocated"] as const) {
  material("08 scope/constraint rejection: " + variant, async f => {
    const message = await f.write(); const event = (await f.events())[0];
    const outside = await db.message.create({ data: { conversationId: f.legacy.id, direction: "inbound", body: "Synthetic" } });
    const outbound = await db.message.create({ data: { conversationId: f.conversation.id, direction: "outbound", body: "Synthetic" } });
    const data = { companyId: event.companyId, contactId: event.contactId, channelId: event.channelId,
      conversationId: event.conversationId, messageId: message.id, sequence: event.sequence };
    if (variant === "company") data.companyId = f.other.id;
    if (variant === "contact") data.contactId = f.foreignContact.id;
    if (variant === "channel") data.channelId = f.alternative.id;
    if (variant === "null-channel") data.channelId = null;
    if (variant === "conversation") data.conversationId = f.foreign.id;
    if (variant === "message") data.messageId = outside.id;
    if (variant === "direction") data.messageId = outbound.id;
    if (variant === "sequence-zero") data.sequence = BigInt("0");
    if (variant === "unallocated") data.sequence = BigInt("2");
    // UPDATE avoids a duplicate message unique masking the intended scope check.
    await assert.rejects(db.conversationInboundEvent.update({ where: { id: event.id }, data }));
    assert.deepEqual(await f.events(), [event]);
  });
}
material("09 unique message and unique Conversation+sequence are enforced independently", async f => {
  await f.write(); const event = (await f.events())[0];
  const { id: _id, createdAt: _at, ...data } = event;
  await assert.rejects(db.conversationInboundEvent.create({ data }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
  const message = await db.message.create({ data: { conversationId: f.conversation.id, direction: "inbound", body: "Synthetic" } });
  await assert.rejects(db.conversationInboundEvent.create({ data: { ...data, messageId: message.id } }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
});
material("10 parent Message/Conversation deletion and structural Message rebinding rejected", async f => {
  const message = await f.write();
  await assert.rejects(db.message.delete({ where: { id: message.id } }));
  await assert.rejects(db.conversation.delete({ where: { id: f.conversation.id } }));
  await assert.rejects(db.message.update({ where: { id: message.id }, data: { direction: "outbound" } }));
  await assert.rejects(db.message.update({ where: { id: message.id }, data: { conversationId: f.legacy.id } }));
  assert.equal((await f.events()).length, 1);
});
material("11 cross-company call and inconsistent concrete Channel fail closed", async f => {
  await assert.rejects(f.write(randomUUID(), f.foreign.id));
  const malformed = await db.conversation.create({ data: { contactId: f.contact.id, channelId: f.foreignChannel.id } });
  await assert.rejects(f.write(randomUUID(), malformed.id));
  assert.equal(await f.counter(malformed.id), BigInt("0"));
  assert.equal((await f.events()).length, 0);
});
material("12 Meta adapter captures original snapshot and event in same commit", async f => {
  const message = await persistInboundMessage(db, { conversationId: f.conversation.id, direction: "inbound", senderType: "customer", body: "Synthetic", providerMessageId: randomUUID() }, {
    companyId: f.company.id, contactId: f.contact.id, channelId: f.channel.id,
    senderPhone: "00000000000", metadata: readMetaReplyMetadata({ type: "text", timestamp: "1792238400" }),
  }, f.company.id);
  assert.ok(message.metaReplySnapshot); assert.equal(readReplySnapshot(message.metaReplySnapshot).providerMessageId, message.providerMessageId);
  assert.equal((await f.events())[0].messageId, message.id);
});
material("13 legacy historical Message remains without backfill; new Message starts at one", async f => {
  const historical = await db.message.create({ data: { conversationId: f.conversation.id, direction: "inbound", body: "Synthetic historical fixture" } });
  assert.equal(await db.conversationInboundEvent.count({ where: { messageId: historical.id } }), 0);
  await f.write(); assert.equal((await f.events())[0].sequence, BigInt("1"));
});
material("14 mismatched Meta snapshot binding rejects before Message/counter/Event", async f => {
  for (const binding of [{ contactId: f.foreignContact.id, channelId: f.channel.id }, { contactId: f.contact.id, channelId: f.alternative.id }]) {
    await assert.rejects(persistInboundMessage(db, {
      conversationId: f.conversation.id, direction: "inbound", body: "Synthetic", providerMessageId: randomUUID(),
    }, { companyId: f.company.id, ...binding, senderPhone: "00000000000", metadata: readMetaReplyMetadata({ type: "text" }) }, f.company.id));
  }
  assert.equal(await f.counter(), BigInt("0")); assert.equal((await f.events()).length, 0);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 0);
});
