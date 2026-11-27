import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
assertOpenCreditCommercialOperationTestDatabase(process.env);
async function main() {
  const previousKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 31).toString(
    "base64",
  );
  const { prepareOpenCreditWebhookSecret } = await import(
    "./opencredit-secrets"
  );
  const { prisma: db } = await import("./db");
  const { hashPassword, createSessionToken } = await import("./auth");
  const overview = await import("../app/api/automations/overview/route"),
    distribution = await import("../app/api/automations/distribution/route"),
    monitor = await import("../app/api/integrations/opencredit/monitor/route"),
    assignment = await import("../app/api/settings/lead-assignment/route");
  const bank = await import("../app/api/clt/integrations/route"),
    bankTest = await import("../app/api/clt/integrations/test/route"),
    banksCatalog = await import("../app/api/clt/banks/route");
  const opencredit = await import(
    "../app/api/integrations/opencredit/[id]/route"
  );
  const { readAutomationMonitor } = await import(
    "./automation-monitor.service"
  );
  const { nextSemMargemReturnWindow, semMargemAutomaticTaskId } = await import(
    "./sem-margem-return"
  );
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw Error("EXTERNAL_TRANSPORT_FORBIDDEN");
  };
  after(async () => {
    if (previousKey === undefined)
      delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previousKey;
    globalThis.fetch = originalFetch;
    await db.$disconnect();
  });
  const passwordHash = hashPassword("synthetic-stage07-password"),
    privateValue = "PRIVATE_STAGE07_CREDENTIAL";
  async function fixture() {
    const company = await db.company.create({
      data: {
        name: "Synthetic stage07",
        aiMode: "OFF",
        cltChatbotEnabled: false,
        cltCheckAutoReplyEnabled: false,
      },
    });
    const createUser = (role: string) =>
      db.user.create({
        data: {
          companyId: company.id,
          name: "Synthetic " + role,
          email: randomUUID() + "@invalid.test",
          role,
          passwordHash,
        },
      });
    const admin = await createUser("ADMIN"),
      agent = await createUser("AGENT"),
      supervisor = await createUser("SUPERVISOR"),
      offline = await createUser("AGENT"),
      busy = await createUser("AGENT");
    for (const [u, status] of [
      [admin, "ONLINE"],
      [agent, "ONLINE"],
      [supervisor, "PAUSED"],
      [offline, "OFFLINE"],
      [busy, "BUSY"],
    ] as const)
      await db.userAvailability.create({
        data: { companyId: company.id, userId: u.id, status },
      });
    const channel = await db.channel.create({
      data: {
        companyId: company.id,
        name: "Synthetic Meta",
        type: "whatsapp",
        provider: "meta",
        status: "ACTIVE",
      },
    });
    const contact = await db.contact.create({
      data: {
        companyId: company.id,
        name: "PRIVATE_STAGE07_NAME",
        phone: "5511999990077",
      },
    });
    const conversation = await db.conversation.create({
      data: {
        contactId: contact.id,
        channelId: channel.id,
        status: "OPEN",
        agentId: admin.id,
      },
    });
    const queuedContact = await db.contact.create({
      data: {
        companyId: company.id,
        name: "PRIVATE_STAGE07_OTHER",
        phone: "5511999990078",
      },
    });
    await db.conversation.create({
      data: {
        contactId: queuedContact.id,
        channelId: channel.id,
        status: "PENDING",
      },
    });
    const integration = await db.openCreditIntegration.create({
      data: {
        companyId: company.id,
        // Break numeric runs: random UUID tails can otherwise resemble an 11-digit CPF.
        providerScope:
          "synthetic-" +
          randomUUID().replaceAll("-", "").replace(/(.{8})/g, "$1f"),
        publicWebhookId: randomUUID(),
        webhookSecret: prepareOpenCreditWebhookSecret(privateValue),
        enabled: false,
        paused: false,
        passiveInboundEnabled: true,
        materializationEnabled: true,
      },
    });
    await db.openCreditWhatsappConfig.create({
      data: {
        companyId: company.id,
        integrationId: integration.id,
        providerScope: integration.providerScope!,
        configuredByUserId: admin.id,
        defaultWhatsappChannelId: channel.id,
        autoStartEnabled: true,
        initialTemplateName: "synthetic_template",
        initialTemplateLanguage: "pt_BR",
      },
    });
    await db.tag.create({
      data: { companyId: company.id, name: "Sem margem", color: "#2563eb" },
    });
    const due = nextSemMargemReturnWindow().dueAt;
    await db.task.create({
      data: {
        id: semMargemAutomaticTaskId(company.id, contact.id, due),
        companyId: company.id,
        contactId: contact.id,
        title: "Retorno: SEM MARGEM",
        note: "PRIVATE_STAGE07_NOTE",
        dueAt: due,
        status: "PENDING",
      },
    });
    await db.cltIntegration.create({
      data: {
        companyId: company.id,
        bankId: "mercantil",
        bankName: "Mercantil",
        provider: "newcorban",
        status: "ASSISTED",
        authType: "login-sms",
        apiKey: privateValue,
        username: privateValue,
        password: privateValue,
        certifiedAgentCpf: "00000000000",
      },
    });
    return {
      company,
      admin,
      agent,
      supervisor,
      channel,
      contact,
      conversation,
      integration,
    };
  }
  type F = Awaited<ReturnType<typeof fixture>>;
  function req(
    f: F,
    path: string,
    role: "admin" | "agent" | "supervisor" = "admin",
    body?: unknown,
  ) {
    return new NextRequest("http://localhost" + path, {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        cookie:
          "crm_session=" + createSessionToken({ ...f[role], role: f[role].role as SessionUser["role"] }, f[role].passwordHash),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function job(f: F, state: string, index = 0) {
    const binding = {
      companyId: f.company.id,
      integrationId: f.integration.id,
      providerScope: f.integration.providerScope!,
      externalLeadId: "synthetic-" + randomUUID(),
    };
    const event = await db.openCreditInboundEvent.create({
      data: {
        ...binding,
        eventId: randomUUID(),
        eventType: "lead.assigned",
        provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED",
        provenanceVersion: 1,
      },
    });
    return db.openCreditLeadMaterialization.create({
      data: {
        ...binding,
        inboundEventId: event.id,
        state,
        createdAt: new Date(Date.now() - 60000 - index),
        expiresAt: new Date(Date.now() + 3600000),
        protectedEnvelope:
          state === "EXPIRED" || state === "COMPLETED"
            ? null
            : "PRIVATE_STAGE07_ENVELOPE",
        ...(state === "PROCESSING"
          ? {
              leaseToken: "PRIVATE_STAGE07_LEASE",
              leaseUntil: new Date(Date.now() - 60000),
            }
          : {}),
        ...(state === "RETRY"
          ? {
              availableAt: new Date(),
              lastErrorCode: "TRANSIENT_FAILURE",
              attempts: 1,
            }
          : {}),
        ...(state === "NEEDS_REVIEW"
          ? { reviewCode: "CONTACT_DATA_INCOMPLETE" }
          : {}),
        ...(state === "COMPLETED"
          ? {
              contactId: f.contact.id,
              channelId: f.channel.id,
              conversationId: f.conversation.id,
              attempts: 1,
            }
          : {}),
      },
    });
  }
  async function snapshot(f: F) {
    return {
      integration: await db.openCreditIntegration.findUnique({
        where: { id: f.integration.id },
        select: {
          enabled: true,
          paused: true,
          passiveInboundEnabled: true,
          materializationEnabled: true,
          updatedAt: true,
        },
      }),
      settings: await db.leadAssignmentSetting.count({
        where: { companyId: f.company.id },
      }),
      jobs: await db.openCreditLeadMaterialization.findMany({
        where: { companyId: f.company.id },
        select: {
          id: true,
          state: true,
          attempts: true,
          leaseUntil: true,
          updatedAt: true,
        },
        orderBy: { id: "asc" },
      }),
      tasks: await db.task.findMany({
        where: { companyId: f.company.id },
        select: { id: true, dueAt: true, status: true, updatedAt: true },
      }),
      counts: await Promise.all([
        db.contact.count({ where: { companyId: f.company.id } }),
        db.channel.count({ where: { companyId: f.company.id } }),
        db.conversation.count({
          where: { contact: { companyId: f.company.id } },
        }),
        db.message.count({
          where: { conversation: { contact: { companyId: f.company.id } } },
        }),
        db.cltIntegration.count({ where: { companyId: f.company.id } }),
        db.openCreditInboundEvent.count({ where: { companyId: f.company.id } }),
      ]),
      bankUpdates: await db.cltIntegration.findMany({
        where: { companyId: f.company.id },
        select: { id: true, updatedAt: true },
      }),
    };
  }
  test("01 authenticated ADMIN boundary for every monitor; AGENT/SUPERVISOR denied", async () => {
    const f = await fixture();
    for (const [route, path] of [
      [overview, "/api/automations/overview"],
      [distribution, "/api/automations/distribution"],
      [monitor, "/api/integrations/opencredit/monitor"],
    ] as const) {
      assert.equal(
        (await route.GET(new NextRequest("http://localhost" + path))).status,
        401,
      );
      for (const role of ["agent", "supervisor"] as const)
        assert.equal((await route.GET(req(f, path, role))).status, 403);
      assert.equal((await route.GET(req(f, path))).status, 200);
    }
  });
  test("02 monitor and assignment GET never initialize defaults or mutate operational records", async () => {
    const f = await fixture();
    await job(f, "PENDING");
    const before = await snapshot(f);
    for (let i = 0; i < 2; i++) {
      assert.equal(
        (await overview.GET(req(f, "/api/automations/overview"))).status,
        200,
      );
      assert.equal(
        (await distribution.GET(req(f, "/api/automations/distribution")))
          .status,
        200,
      );
      assert.equal(
        (await monitor.GET(req(f, "/api/integrations/opencredit/monitor")))
          .status,
        200,
      );
      const response = await assignment.GET(
        req(f, "/api/settings/lead-assignment"),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).settings.mode, "CLAIM_FIRST");
    }
    assert.deepEqual(await snapshot(f), before);
  });
  test("03 exact flags and unknown worker health never infer operational status from enabled", async () => {
    const f = await fixture();
    const a = await readAutomationMonitor(db, f.company.id);
    assert.equal(a.ai.mode, "OFF");
    assert.equal(a.chatbot.enabled, false);
    assert.equal(a.opencredit.worker.operational, "UNKNOWN");
    assert.equal(a.opencredit.integrations[0].interlockReady, true);
    assert.equal(a.opencredit.integrations[0].autoStartConfigured, true);
    assert.equal(a.opencredit.inbound.total, 0);
  });
  test("04 exact queue states, leases, attempts, pending processing and independent legacy counts", async () => {
    const f = await fixture();
    for (const state of [
      "PENDING",
      "RETRY",
      "PROCESSING",
      "NEEDS_REVIEW",
      "COMPLETED",
      "EXPIRED",
    ])
      await job(f, state);
    const response = await monitor.GET(
      req(f, "/api/integrations/opencredit/monitor"),
    );
    const a = await response.json();
    assert.equal(a.total, 6);
    for (const s of a.counts) assert.equal(s._count._all, 1);
    assert.equal(a.stale, 1);
    assert.equal(a.legacy, 0);
    assert.equal(a.inbound.total, 6);
    assert.equal(a.duplicateCount, null);
    assert.equal(a.integrations[0].enabled, false);
    assert.equal(a.integrations[0].passiveInboundEnabled, true);
  });
  test("05 envelopes, secrets, personal identity, webhook IDs and lease tokens never enter monitor DTOs", async () => {
    const f = await fixture();
    await job(f, "PROCESSING");
    for (const route of [overview, monitor]) {
      const text = await (
        await route.GET(req(f, "/api/automations/overview"))
      ).text();
      for (const secret of [
        privateValue,
        f.integration.webhookSecret,
        "PRIVATE_STAGE07_ENVELOPE",
        "PRIVATE_STAGE07_NAME",
        "PRIVATE_STAGE07_LEASE",
        "00000000000",
        "5511999990077",
        f.integration.publicWebhookId,
      ])
        assert.equal(text.includes(secret), false);
      for (const key of [
        "protectedEnvelope",
        "webhookSecret",
        "leaseToken",
        "apiKeyPreview",
        "inputJson",
        "outputJson",
      ])
        assert.equal(text.includes('"' + key + '"'), false);
    }
  });
  test("06 cross-company filters cannot expose another integration or records", async () => {
    const f = await fixture(),
      foreign = await fixture();
    await job(foreign, "PENDING");
    assert.equal(
      (
        await monitor.GET(
          req(
            f,
            "/api/integrations/opencredit/monitor?integrationId=" +
              foreign.integration.id,
          ),
        )
      ).status,
      404,
    );
    const a = await (
      await monitor.GET(
        req(
          f,
          "/api/integrations/opencredit/monitor?companyId=" +
            foreign.company.id,
        ),
      )
    ).json();
    assert.equal(a.total, 0);
    assert.equal(JSON.stringify(a).includes(foreign.integration.id), false);
  });
  test("07 bounded jobs, real state filter and second page", async () => {
    const f = await fixture();
    for (let i = 0; i < 53; i++) await job(f, "PENDING", i);
    const a = await (
      await monitor.GET(req(f, "/api/integrations/opencredit/monitor"))
    ).json();
    assert.equal(a.jobs.length, 50);
    assert.equal(a.hasMore, true);
    assert.equal(a.total, 53);
    assert.equal(a.recentInbound.length, 20);
    const b = await (
      await monitor.GET(req(f, "/api/integrations/opencredit/monitor?page=1"))
    ).json();
    assert.equal(b.jobs.length, 3);
    assert(
      !b.jobs.some((j: { id: string }) =>
        a.jobs.some((k: { id: string }) => j.id === k.id),
      ),
    );
    assert.equal(
      (
        await (
          await monitor.GET(
            req(f, "/api/integrations/opencredit/monitor?state=RETRY"),
          )
        ).json()
      ).jobs.length,
      0,
    );
  });
  test("08 malformed filters are rejected without modifying queue", async () => {
    const f = await fixture();
    for (const query of ["page=-1", "page=1.2", "page=10001", "state=BOGUS"])
      assert.equal(
        (
          await monitor.GET(
            req(f, "/api/integrations/opencredit/monitor?" + query),
          )
        ).status,
        400,
      );
  });
  test("09 distribution capacity matches existing ONLINE roles and open workload semantics", async () => {
    const f = await fixture();
    await db.leadAssignmentSetting.create({
      data: {
        companyId: f.company.id,
        mode: "ROUND_ROBIN",
        onlineOnly: true,
        maxOpenPerAttendant: 1,
      },
    });
    const a = await (
      await distribution.GET(req(f, "/api/automations/distribution"))
    ).json();
    assert.equal(a.metrics.online, 2);
    assert.equal(a.metrics.assigned, 1);
    assert.equal(a.metrics.unassigned, 1);
    assert.equal(a.capacity.remaining, 1);
    assert.equal(a.settings.mode, "ROUND_ROBIN");
    assert.equal(
      a.attendants.filter(
        (u: { availabilityStatus: string }) =>
          u.availabilityStatus === "ONLINE",
      ).length,
      2,
    );
  });
  test("10 existing PATCH modes preserve full setting fields and no assignment occurs just by configuration", async () => {
    const f = await fixture();
    const before = await db.conversation.findMany({
      where: { contact: { companyId: f.company.id } },
      select: { id: true, agentId: true },
    });
    for (const mode of ["CLAIM_FIRST", "ROUND_ROBIN", "ADMIN_MANUAL"]) {
      const body = {
        mode,
        onlineOnly: true,
        maxOpenPerAttendant: 3,
        allowAttendantClaim: false,
        redistributeWhenOffline: false,
      };
      const r = await assignment.PATCH(
        req(f, "/api/settings/lead-assignment", "admin", body),
      );
      assert.equal(r.status, 200);
      assert.equal((await r.json()).settings.mode, mode);
    }
    assert.deepEqual(
      await db.conversation.findMany({
        where: { contact: { companyId: f.company.id } },
        select: { id: true, agentId: true },
      }),
      before,
    );
  });
  test("11 SEM MARGEM actual due date and state are preserved, no synthetic next execution", async () => {
    const f = await fixture(),
      before = await snapshot(f);
    const a = await readAutomationMonitor(db, f.company.id);
    assert.equal(a.rules.semMargem.tagPresent, true);
    assert.equal(a.rules.semMargem.nextTasks.length, 1);
    assert.equal(
      a.rules.semMargem.nextTasks[0].dueAt.toISOString(),
      before.tasks[0].dueAt.toISOString(),
    );
    assert.equal(a.rules.semMargem.tasks[0]._count._all, 1);
    assert.deepEqual(await snapshot(f), before);
  });
  test("12 legacy start and pause remain separate from passive materialization gate", async () => {
    const f = await fixture();
    await db.openCreditIntegration.update({
      where: { id: f.integration.id },
      data: { materializationEnabled: false },
    });
    for (const status of ["ACTIVE", "PAUSED", "DISABLED"]) {
      const r = await opencredit.PATCH(
        req(f, "/api/integrations/opencredit/" + f.integration.id, "admin", {
          status,
        }),
        { params: Promise.resolve({ id: f.integration.id }) },
      );
      assert.equal(r.status, 200);
      const stored = await db.openCreditIntegration.findUniqueOrThrow({
        where: { id: f.integration.id },
      });
      assert.equal(stored.enabled, status !== "DISABLED");
      assert.equal(stored.paused, status === "PAUSED");
      assert.equal(stored.passiveInboundEnabled, true);
      assert.equal(stored.materializationEnabled, false);
    }
  });
  test("13 legacy activation still fails closed while materialization is enabled", async () => {
    const f = await fixture(),
      before = await snapshot(f);
    assert.equal(
      (
        await opencredit.PATCH(
          req(f, "/api/integrations/opencredit/" + f.integration.id, "admin", {
            status: "ACTIVE",
          }),
          { params: Promise.resolve({ id: f.integration.id }) },
        )
      ).status,
      409,
    );
    assert.deepEqual(await snapshot(f), before);
  });
  test("14 bank GET is non-provisioning, secrets stay masked and write privileges unchanged", async () => {
    const f = await fixture(),
      before = await snapshot(f);
    for (const role of ["admin", "agent", "supervisor"] as const) {
      const r = await bank.GET(req(f, "/api/clt/integrations", role));
      assert.equal(r.status, 200);
      const text = await r.text();
      assert(!text.includes(privateValue));
      assert(!text.includes("00000000000"));
      if (role !== "admin")
        assert.equal(
          (
            await bank.PATCH(
              req(f, "/api/clt/integrations", role, {
                bankId: "mercantil",
                password: "synthetic-replacement",
              }),
            )
          ).status,
          403,
        );
    }
    assert.deepEqual(await snapshot(f), before);
    assert.equal(
      (await banksCatalog.GET(req(f, "/api/clt/banks"))).status,
      200,
    );
  });
  test("15 credential preservation for blank fields and explicit local bank test, no provider call", async () => {
    const f = await fixture();
    const before = await db.cltIntegration.findUniqueOrThrow({
      where: {
        companyId_bankId: { companyId: f.company.id, bankId: "mercantil" },
      },
    });
    const r = await bank.PATCH(
      req(f, "/api/clt/integrations", "admin", {
        bankId: "mercantil",
        provider: "newcorban",
        password: "",
        apiKey: "",
        username: "",
      }),
    );
    assert.equal(r.status, 200);
    const after = await db.cltIntegration.findUniqueOrThrow({
      where: { id: before.id },
    });
    assert(
      before.password === after.password &&
        before.apiKey === after.apiKey &&
        before.username === after.username,
    );
    const testReq = new NextRequest(
      "http://localhost/api/clt/integrations/test",
      {
        method: "POST",
        headers: {
          cookie:
            "crm_session=" + createSessionToken({ ...f.admin, role: "ADMIN" }, f.admin.passwordHash),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bankId: "mercantil" }),
      },
    );
    assert.equal((await bankTest.POST(testReq)).status, 200);
    assert.equal(externalCalls, 0);
  });
  test("16 concurrent readonly monitoring keeps queue and domain snapshots identical", async () => {
    const f = await fixture();
    await job(f, "PENDING");
    const before = await snapshot(f);
    await Promise.all(
      Array.from({ length: 3 }, () => readAutomationMonitor(db, f.company.id)),
    );
    assert.deepEqual(await snapshot(f), before);
    assert.equal(externalCalls, 0);
  });
  test("17 stale and expired-active records are reported without recover or expire", async () => {
    const f = await fixture(),
      pending = await job(f, "PENDING");
    await job(f, "PROCESSING");
    await db.openCreditLeadMaterialization.update({
      where: { id: pending.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const before = await snapshot(f);
    const a = await (
      await monitor.GET(req(f, "/api/integrations/opencredit/monitor"))
    ).json();
    assert.equal(a.stale, 1);
    assert.equal(a.expiredActive, 1);
    assert.deepEqual(await snapshot(f), before);
  });
  test("18 large team is bounded and incomplete capacity is never presented as exact", async () => {
    const f = await fixture();
    await db.user.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        companyId: f.company.id,
        name: "Volume " + i,
        email: randomUUID() + "@invalid.test",
        passwordHash,
        role: "AGENT",
      })),
    });
    const a = await (
      await distribution.GET(req(f, "/api/automations/distribution"))
    ).json();
    assert.equal(a.attendants.length, 500);
    assert.equal(a.metrics.totalUsers, 506);
    assert.equal(a.capacity.complete, false);
    assert.equal(a.capacity.remaining, null);
    assert.equal(a.metrics.online, 2);
  });
  test("19 enabling company flags does not create runtime sessions, send or prove worker health", async () => {
    const f = await fixture();
    await db.company.update({
      where: { id: f.company.id },
      data: {
        aiMode: "AUTO",
        cltChatbotEnabled: true,
        cltCheckAutoReplyEnabled: true,
      },
    });
    const before = await snapshot(f);
    const a = await readAutomationMonitor(db, f.company.id);
    assert.equal(a.ai.mode, "AUTO");
    assert.equal(a.ai.fixedReplyEnabled, true);
    assert.equal(a.chatbot.enabled, true);
    assert.equal(a.ai.operational, "UNKNOWN");
    assert.equal(a.opencredit.worker.operational, "UNKNOWN");
    assert.equal(a.chatbot.sessions.length, 0);
    assert.deepEqual(await snapshot(f), before);
    assert.equal(externalCalls, 0);
  });
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
