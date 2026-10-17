// Test-only subprocess: stdout/stderr are captured by the disposable SQLite integration suite.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { closeTextAuthorityShadow, observeTextOutboundAuthority, readTextAuthority } from "./authority-text-shadow-runtime";

async function probe() {
  const url = process.env.QEVORA_TEXT_AUTHORITY_DATABASE_URL;
  assert(url?.startsWith("file:"));
  const file = path.resolve(url!.slice(5));
  assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert(path.basename(file).startsWith("qevora-authority-shadow-log-"));
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const row = await db.conversationAuthority.findFirstOrThrow({ where: { state: "HUMAN" } });
    await db.$executeRawUnsafe('UPDATE "ConversationAuthority" SET generation = ? WHERE id = ?',
      "SYNTHETIC_PHONE_CPF_TOKEN_DO_NOT_LOG", row.id);
    const scope = { companyId: row.companyId, channelId: row.channelId, conversationId: row.conversationId };
    await assert.rejects(readTextAuthority(scope), error => error instanceof Error && error.message === "SHADOW_READ_UNAVAILABLE");
    observeTextOutboundAuthority({}, { ...scope, actorUserId: row.ownerUserId!, assignedUserId: row.ownerUserId,
      source: "CONVERSATION_TEXT", intentId: null });
    await new Promise(resolve => setTimeout(resolve, 200));
  } finally { await closeTextAuthorityShadow(); await db.$disconnect(); }
}

void probe().catch(() => { console.error("SHADOW_LOG_PROBE_FAILED"); process.exitCode = 1; });
