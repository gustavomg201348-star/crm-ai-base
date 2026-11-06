import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_TRANSPORT_ISOLATION_POSTGRES_TEST !== "1") throw new Error("ISOLATION_TEST_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
after(() => db.$disconnect());
const kind = { type: "OPEN_CREDIT", provider: "internal" };
const migration = "20261106130000_opencredit_transport_isolation";

test("PostgreSQL reserves one credential-free OpenCredit channel per company", async () => {
  const a = await db.company.create({ data: { name: "Isolation A" } });
  const b = await db.company.create({ data: { name: "Isolation B" } });
  const ids = [a.id, b.id];
  try {
    const data = { companyId: a.id, name: "Internal", ...kind };
    await assert.rejects(() => db.channel.create({ data: { ...data, provider: "meta" } }));
    for (const column of ["externalId", "phoneNumberId", "wabaId", "displayPhone", "accessToken", "verifyToken", "appSecret"]) {
      await assert.rejects(() => db.channel.create({ data: { ...data, [column]: "synthetic" } }));
    }
    for (const column of ["lastWebhookSubscribedAt", "lastWebhookReceivedAt"]) {
      await assert.rejects(() => db.channel.create({ data: { ...data, [column]: new Date() } }));
    }
    assert.equal(await db.channel.count({ where: { companyId: a.id } }), 0);
    await db.channel.create({ data });
    await assert.rejects(() => db.channel.create({ data }), { code: "P2002" });
    await db.channel.create({ data: { ...data, companyId: b.id } });
    assert.equal(await db.channel.count({ where: { companyId: { in: ids }, ...kind } }), 2);
  } finally {
    await db.channel.deleteMany({ where: { companyId: { in: ids } } });
    await db.company.deleteMany({ where: { id: { in: ids } } });
  }
});

test("conversation uniqueness excludes SOLD only for OpenCredit and requires an explicit channel for its marker", async () => {
  const company = await db.company.create({ data: { name: "Conversation isolation" } });
  const companyId = company.id;
  try {
    const contact = await db.contact.create({ data: { companyId, name: "Synthetic", phone: "5511987654321" } });
    const internal = await db.channel.create({ data: { companyId, name: "Internal", ...kind } });
    const meta = await db.channel.create({ data: { companyId, name: "External", type: "whatsapp", provider: "meta" } });
    const contactId = contact.id;
    await assert.rejects(() => db.conversation.create({ data: { contactId, channel: "OPEN_CREDIT" } }));
    const openCredit = { contactId, channelId: internal.id, channel: "OPEN_CREDIT" };
    await db.conversation.create({ data: { ...openCredit, status: "SOLD" } });
    await db.conversation.create({ data: { ...openCredit, status: "OPEN" } });
    for (const status of ["OPEN", "PENDING", "BOT"]) {
      await assert.rejects(() => db.conversation.create({ data: { ...openCredit, status } }), { code: "P2002" });
    }
    const whatsapp = { contactId, channelId: meta.id, channel: "whatsapp:" + meta.id };
    await db.conversation.create({ data: { ...whatsapp, status: "SOLD" } });
    await assert.rejects(() => db.conversation.create({ data: { ...whatsapp, status: "OPEN" } }), { code: "P2002" });
    assert.equal(await db.conversation.count({ where: { contactId } }), 3);
  } finally {
    await db.conversation.deleteMany({ where: { contact: { companyId } } });
    await db.channel.deleteMany({ where: { companyId } });
    await db.contact.deleteMany({ where: { companyId } });
    await db.company.delete({ where: { id: companyId } });
  }
});

test("migration upgrades preexisting WhatsApp rows without backfill or changing their uniqueness", async () => {
  const name = "qevora_isolation_upgrade_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^qevora_isolation_upgrade_[a-f0-9]{32}$/);
  const temp = mkdtempSync(join(tmpdir(), "qevora-isolation-upgrade-"));
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const deploy = () => {
    const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", join(temp, "schema.postgres.prisma")], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120000,
    });
    assert.equal(result.status, 0, "ISOLATION_UPGRADE_MIGRATION_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", join(temp, "schema.postgres.prisma"));
    mkdirSync(join(temp, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(temp, "migrations/migration_lock.toml"));
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    assert(migrations.includes(migration));
    for (const dir of migrations.filter(dir => dir < migration)) cpSync(join("prisma/migrations", dir), join(temp, "migrations", dir), { recursive: true });
    deploy();
    const company = await isolated.company.create({ data: { name: "Historical WhatsApp" } });
    const contact = await isolated.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5511987654321" } });
    const channel = await isolated.channel.create({
      data: { companyId: company.id, name: "Existing", provider: "meta", accessToken: "synthetic-token", phoneNumberId: "synthetic-phone" },
    });
    const binding = { contactId: contact.id, channelId: channel.id, channel: "whatsapp:" + channel.id };
    const sold = await isolated.conversation.create({ data: { ...binding, status: "SOLD" } });
    const oldIndex = await isolated.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'Conversation_open_contact_channel_unique'`;
    assert.match(oldIndex[0].indexdef, /SOLD/);
    assert.doesNotMatch(oldIndex[0].indexdef, /OPEN_CREDIT/);
    cpSync(join("prisma/migrations", migration), join(temp, "migrations", migration), { recursive: true });
    deploy();
    await isolated.$disconnect();
    assert.deepEqual(await isolated.channel.findMany(), [channel]);
    assert.deepEqual(await isolated.conversation.findMany(), [sold]);
    assert.deepEqual(await isolated.contact.findMany(), [contact]);
    await assert.rejects(() => isolated.conversation.create({ data: { ...binding, status: "OPEN" } }), { code: "P2002" });
  } finally {
    await isolated.$disconnect();
    await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    rmSync(temp, { recursive: true, force: true });
  }
});
