import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  readAssignmentConfiguration,
  integrationReadFlags,
  safeMonitorCode,
} from "./automation-monitor.service";
import { getVisibleNavigation } from "./sidebar-navigation";
test("technical diagnostic codes use a closed allowlist, never free text or uppercase personal data", () => {
  assert.equal(
    safeMonitorCode("CONTACT_DATA_INCOMPLETE"),
    "CONTACT_DATA_INCOMPLETE",
  );
  assert.equal(safeMonitorCode("PRIVATE_NAME_12345"), "UNKNOWN");
  assert.equal(safeMonitorCode("query error: SECRET"), "UNKNOWN");
  assert.equal(safeMonitorCode(null), null);
});
test("interlock projection preserves preflight definition and never conflates pause with readiness", () => {
  const base = {
    enabled: false,
    paused: true,
    passiveInboundEnabled: true,
    materializationEnabled: true,
    providerScope: "synthetic",
  };
  assert.equal(integrationReadFlags(base).interlockReady, true);
  assert.equal(integrationReadFlags(base).gatesConfigured, false);
  assert.equal(
    integrationReadFlags({ ...base, paused: false }).gatesConfigured,
    true,
  );
  assert.equal(
    integrationReadFlags({ ...base, enabled: true }).interlockReady,
    false,
  );
  assert.equal(
    integrationReadFlags({ ...base, paused: false, providerScope: null })
      .gatesConfigured,
    false,
  );
});

test("new modules remain company-admin only; operational CLT and communication stay in place", () => {
  const ids = [
    "automacoes",
    "regras-automaticas",
    "distribuicao-leads",
    "opencredit",
    "bancos",
  ];
  for (const role of ["AGENT", "SUPERVISOR", "ADMIN"] as const) {
    const n = getVisibleNavigation(role, false);
    for (const id of ids)
      assert.equal(
        n.visibleItems.some((i) => i.id === id),
        role === "ADMIN",
      );
  }
  const { sections } = getVisibleNavigation("ADMIN", false);
  const financial = sections.find((s) => s.id === "produtos-financeiros");
  assert(
    financial &&
      "items" in financial &&
      financial.items.some((i) => i.id === "simulacao-clt"),
  );
  const comm = sections.find((s) => s.id === "comunicacao");
  assert(
    comm &&
      "items" in comm &&
      comm.items.some((i) => i.id === "chatbot") &&
      comm.items.some((i) => i.id === "inteligencia-artificial"),
  );
});
test("missing assignment config returns existing defaults without initializing a record", async () => {
  let reads = 0;
  const db = {
    leadAssignmentSetting: {
      findUnique: async (args: unknown) => {
        assert.deepEqual((args as { where: unknown }).where, {
          companyId: "synthetic-company",
        });
        reads++;
        return null;
      },
    },
  } as unknown as Pick<PrismaClient, "leadAssignmentSetting">;
  assert.deepEqual(await readAssignmentConfiguration(db, "synthetic-company"), {
    mode: "CLAIM_FIRST",
    onlineOnly: true,
    maxOpenPerAttendant: null,
    allowAttendantClaim: true,
    redistributeWhenOffline: false,
    fallback: false,
  });
  assert.equal(reads, 1);
});
test("stored assignment modes and limits are preserved by readonly projection", async () => {
  for (const mode of ["CLAIM_FIRST", "ROUND_ROBIN", "ADMIN_MANUAL"]) {
    const row = {
      mode,
      onlineOnly: false,
      maxOpenPerAttendant: 3,
      allowAttendantClaim: false,
      redistributeWhenOffline: true,
    };
    const db = {
      leadAssignmentSetting: { findUnique: async () => row },
    } as unknown as Pick<PrismaClient, "leadAssignmentSetting">;
    assert.deepEqual(
      await readAssignmentConfiguration(db, "synthetic-company"),
      { ...row, fallback: false },
    );
  }
});
test("monitor reads use transaction deadlines and explicit bounded projections, never operational actions", () => {
  const src = readFileSync("src/lib/automation-monitor.service.ts", "utf8");
  assert(src.includes("READ ONLY"));
  assert(src.includes("statement_timeout"));
  assert(src.includes("take: 51"));
  assert(src.includes("take: 20"));
  assert(src.includes("take: 501"));
  assert(
    !/\.(create|upsert|update|updateMany|delete|deleteMany|claim|recover|expire|process)\(/.test(
      src,
    ),
  );
  for (const key of [
    "protectedEnvelope",
    "leaseToken:",
    "webhookSecret:",
    "accessToken:",
    "password:",
    "inputJson:",
    "outputJson:",
    "cpf:",
    "phone:",
  ])
    assert(!src.includes(key), key);
  assert(src.includes('operational: "UNKNOWN"'));
  assert(!src.includes("rolloutId:"));
});
test("GET assignment uses readonly projection while PATCH keeps the existing writer", () => {
  const src = readFileSync(
    "src/app/api/settings/lead-assignment/route.ts",
    "utf8",
  );
  assert(
    /readAssignmentConfiguration\(\s*prisma,\s*session\.companyId,?\s*\)/.test(
      src,
    ),
  );
  assert(src.includes("updateLeadAssignmentSettings"));
  assert(!src.includes("getLeadAssignmentSettings("));
});
test("configuration has shortcuts instead of duplicate integration/distribution controls", () => {
  const src = readFileSync(
    "src/app/components/settings/SettingsWorkspace.tsx",
    "utf8",
  );
  assert(!src.includes("OperationalSettings"));
  assert(!src.includes("OpenCreditSettingsCard"));
  for (const name of [
    "opencredit",
    "bancos",
    "automacoes",
    "distribuicao-leads",
    "chatbot",
    "inteligencia-artificial",
  ])
    assert(src.includes('"' + name + '"'));
});
test("bank credentials/admin requests are extracted and no longer present in operational simulation", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const simulation = page.slice(
    page.indexOf("function SimulacaoClt("),
    page.indexOf("function InfoField("),
  );
  assert(!simulation.includes("/api/clt/integrations"));
  for (const path of [
    "/api/clt/customer",
    "/api/clt/simulations",
    "/api/clt/proposals",
  ])
    assert(simulation.includes(path));
  const bank = readFileSync(
    "src/app/components/integrations/BankIntegrationsPage.tsx",
    "utf8",
  );
  for (const path of [
    "/api/clt/integrations/authenticate",
    "/api/clt/integrations/verify-sms",
    "/api/clt/integrations/test",
  ])
    assert(bank.includes(path));
  assert(bank.includes("mutation.current"));
  assert(bank.includes('"password"'));
  assert(bank.includes('autoComplete="off"'));
  assert(!bank.includes("localStorage"));
  assert(bank.includes("fallback"));
  // The shared theme defines brand, not primary. White action labels need a real background.
  assert(bank.includes("bg-brand"));
  assert(!/(?:bg|text|border)-primary/.test(bank));
});
test("new monitor handler derives company only from authenticated ADMIN and returns safe failures", () => {
  const src = readFileSync("src/lib/automation-monitor-handler.ts", "utf8");
  assert(src.includes("requireCompanyAdmin(session)"));
  assert(src.includes("session.companyId"));
  assert(!src.includes('params.get("companyId")'));
  assert(src.includes("MONITOR_UNAVAILABLE"));
  assert(!src.includes("console."));
});
test("monitoring never imports/starts automation actions in the client", () => {
  for (const file of ["AutomationControlCenter.tsx", "monitor-ui.tsx"]) {
    const src = readFileSync("src/app/components/automation/" + file, "utf8");
    assert(!/method:\s*["'](POST|PATCH|PUT|DELETE)/.test(src));
    assert(!src.includes("setInterval"));
    assert(!src.includes("materializer.process"));
  }
});
