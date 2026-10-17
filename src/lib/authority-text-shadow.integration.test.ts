import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { copyFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { readTextAuthority } from "./authority-text-shadow-runtime";
import { createShadowAuthorityReader } from "./authority-text-shadow-reader";
import { createTextAuthorityObserver } from "./authority-text-shadow";
import type { ShadowMetric } from "./authority-text-shadow-contract";

test("real scoped snapshot reads only the isolated authority fixtures and leaves every table unchanged", async () => {
  const url = process.env.AUTHORITY_TEST_DATABASE_URL;
  assert(url, "Dedicated TEMP SQLite required; integration cannot silently skip");
  assert(url.startsWith("file:"), "Only disposable SQLite is allowed");
  const file = path.resolve(url.slice(5));
  assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert(path.basename(file).startsWith("qevora-authority-") && file.endsWith(".db"));
  const db = new PrismaClient({ datasources: { db: { url } } });
  const reader = createShadowAuthorityReader(() => url);
  try {
    const row = await db.conversationAuthority.findFirstOrThrow();
    const snapshot = async () => ({
      authorities: await db.conversationAuthority.findMany({ orderBy: { id: "asc" } }),
      operations: await db.outboundOperation.findMany({ orderBy: { id: "asc" } }),
      events: await db.authorityEvent.findMany({ orderBy: { id: "asc" } }),
      messages: await db.message.count(), conversations: await db.conversation.count(),
      contacts: await db.contact.count(), tasks: await db.task.count(), proposals: await db.proposal.count()
    });
    const before = await snapshot();
    for (const field of ["companyId", "channelId", "conversationId"] as const) {
      for (const bad of [undefined, null, "", " ", false, 0]) {
        assert.throws(() => readTextAuthority({ companyId: "c", channelId: "h", conversationId: "v", [field]: bad } as never), /INVALID_SHADOW_SCOPE/);
      }
    }
    const scope = { companyId: row.companyId, channelId: row.channelId, conversationId: row.conversationId };
    const read = await reader.read(scope);
    assert.equal(read?.generation, row.generation);
    for (const field of ["companyId", "channelId", "conversationId"] as const) {
      assert.equal(await reader.read({ ...scope, [field]: "nonexistent-test-scope" }), null);
    }
    const metrics: ShadowMetric[] = [];
    const emitted = new Promise<void>(resolve => {
      const observer = createTextAuthorityObserver({ mode: () => "SHADOW", read: reader.read,
        emit: metric => { metrics.push(metric); resolve(); } });
      const request = {};
      const input = { ...scope, actorUserId: row.ownerUserId ?? "synthetic-actor", assignedUserId: null,
        source: "CONVERSATION_TEXT" as const, intentId: null };
      observer(request, input);
      observer(request, input);
    });
    await emitted;
    assert.equal(metrics.length, 1);
    assert.notEqual(metrics[0].reason, "READ_FAILED");
    assert.deepEqual(await snapshot(), before);
  } finally { await reader.close(); await db.$disconnect(); }
});

test("native Prisma errors cannot emit sensitive sentinels to stdout/stderr", async () => {
  const source = process.env.AUTHORITY_TEST_DATABASE_URL;
  assert(source?.startsWith("file:"));
  const original = path.resolve(source!.slice(5));
  assert.equal(path.dirname(original).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  const file = path.join(os.tmpdir(), `qevora-authority-shadow-log-${process.pid}-${Date.now()}.db`);
  await copyFile(original, file);
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [...process.execArgv, path.resolve("src/lib/authority-text-shadow-log-probe.ts")], {
        env: { ...process.env, NODE_ENV: "production", QEVORA_TEXT_AUTHORITY_MODE: "SHADOW", QEVORA_TEXT_AUTHORITY_DATABASE_URL: `file:${file}` },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "", stderr = "";
      const deadline = setTimeout(() => { child.kill(); reject(new Error("Log probe timed out")); }, 15000);
      child.stdout.on("data", data => { stdout += String(data); });
      child.stderr.on("data", data => { stderr += String(data); });
      child.on("error", error => { clearTimeout(deadline); reject(error); });
      child.on("close", code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, "Log probe must complete without raw diagnostics");
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC_PHONE_CPF_TOKEN_DO_NOT_LOG|Invalid.*prisma|generation.*BigInt|SHADOW_LOG_PROBE_FAILED/);
    const events = result.stdout.split(/\r?\n/).filter(line => line.includes('"event":"authority_text_shadow"')).map(line => JSON.parse(line));
    assert.equal(events.length, 1);
    assert.equal(events[0].result, "EVALUATION_ERROR");
    assert.equal(events[0].reason, "READ_FAILED");
  } finally { await unlink(file); }
});
