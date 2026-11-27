import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
assertOpenCreditCommercialOperationTestDatabase(process.env);
async function main() {
  const { prisma: db } = await import("./db"),
    { hashPassword, createSessionToken } = await import("./auth");
  const users = await import("../app/api/settings/users/route"),
    member = await import("../app/api/settings/users/[id]/route"),
    presence = await import("../app/api/users/[id]/status/route");
  const tags = await import("../app/api/settings/tags/route"),
    tag = await import("../app/api/settings/tags/[id]/route");
  const stages = await import("../app/api/settings/stages/route"),
    stage = await import("../app/api/settings/stages/[id]/route");
  const origins = await import("../app/api/settings/origins/route"),
    origin = await import("../app/api/settings/origins/[id]/route");
  const kanban = await import("../app/api/kanban/route"),
    assignment = await import("../app/api/settings/lead-assignment/route");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("EXTERNAL_TRANSPORT_FORBIDDEN");
  };
  const oldCompany = process.env.PLATFORM_COMPANY_ID,
    oldEmail = process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_COMPANY_ID;
  const platformEmail = randomUUID() + "@invalid.test";
  process.env.PLATFORM_ADMIN_EMAILS = platformEmail;
  after(async () => {
    globalThis.fetch = originalFetch;
    if (oldCompany === undefined) delete process.env.PLATFORM_COMPANY_ID;
    else process.env.PLATFORM_COMPANY_ID = oldCompany;
    if (oldEmail === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = oldEmail;
    await db.$disconnect();
  });
  const company = await db.company.create({
      data: { name: "Settings synthetic" },
    }),
    other = await db.company.create({ data: { name: "Other synthetic" } });
  const passwordHash = hashPassword("local-synthetic-settings-password");
  const makeUser = (
    role: string,
    companyId = company.id,
    email = randomUUID() + "@invalid.test",
  ) =>
    db.user.create({
      data: { companyId, role, email, name: "Synthetic " + role, passwordHash },
    });
  const admin = await makeUser("ADMIN"),
    supervisor = await makeUser("SUPERVISOR"),
    agent = await makeUser("AGENT"),
    foreign = await makeUser("ADMIN", other.id),
    platform = await makeUser("ADMIN", company.id, platformEmail);
  type User = typeof admin;
  const req = (
    path: string,
    actor: User | null = admin,
    body?: unknown,
    method = "POST",
  ) =>
    new NextRequest("http://localhost:3000" + path, {
      method: body === undefined ? "GET" : method,
      headers: {
        ...(actor
          ? {
              cookie:
                "crm_session=" +
                createSessionToken(
                  { ...actor, role: actor.role as "ADMIN" },
                  actor.passwordHash,
                ),
            }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  let target: User;
  test("team listing requires management permission and returns only safe own-tenant fields", async () => {
    assert.equal(
      (await users.GET(req("/api/settings/users", null))).status,
      401,
    );
    assert.equal(
      (await users.GET(req("/api/settings/users", agent))).status,
      403,
    );
    for (const actor of [admin, supervisor]) {
      const r = await users.GET(req("/api/settings/users", actor));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const text = await r.text();
      assert(!text.includes("password"));
      assert(!text.includes(passwordHash));
      assert(!text.includes(foreign.email));
      const rows = JSON.parse(text).users;
      assert.equal(rows.length, 4);
      assert(
        rows.find((u: { id: string }) => u.id === platform.id).platformAdmin,
      );
      if (actor.id === supervisor.id)
        assert(rows.every((u: { canManage: boolean }) => !u.canManage));
    }
  });
  test("user creation and edits preserve company, roles and unaffected sessions", async () => {
    const data = {
      name: "Created synthetic",
      email: randomUUID() + "@invalid.test",
      role: "AGENT",
      password: "synthetic-password",
    };
    assert.equal(
      (await users.POST(req("/api/settings/users", supervisor, data))).status,
      403,
    );
    assert.equal(
      (await users.POST(req("/api/settings/users", agent, data))).status,
      403,
    );
    assert.equal(
      (
        await users.POST(
          req("/api/settings/users", admin, { ...data, companyId: other.id }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await users.POST(
          req("/api/settings/users", admin, {
            ...data,
            role: "PLATFORM_ADMIN",
          }),
        )
      ).status,
      400,
    );
    const created = await users.POST(req("/api/settings/users", admin, data));
    assert.equal(created.status, 201);
    const result = await created.json();
    target = await db.user.findUniqueOrThrow({ where: { id: result.user.id } });
    assert.equal(target.companyId, company.id);
    assert(!JSON.stringify(result).includes("password"));
    assert.equal(
      (await users.POST(req("/api/settings/users", admin, data))).status,
      409,
    );
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + target.id, supervisor, {
            role: "ADMIN",
          }),
          ctx(target.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + target.id, foreign, { name: "Foreign" }),
          ctx(target.id),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + target.id, admin, {
            name: "Edited",
            role: "SUPERVISOR",
          }),
          ctx(target.id),
        )
      ).status,
      200,
    );
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: target.id } })).role,
      "SUPERVISOR",
    );
    assert.equal(
      (await users.GET(req("/api/settings/users", admin))).status,
      200,
    );
  });
  test("company administrators cannot edit, delete or manufacture a platform identity", async () => {
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + platform.id, admin, {
            name: "Forbidden",
          }),
          ctx(platform.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await member.DELETE(
          req("/api/settings/users/" + platform.id, admin, {}, "DELETE"),
          ctx(platform.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + admin.id, admin, {
            email: platformEmail,
          }),
          ctx(admin.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await users.POST(
          req("/api/settings/users", admin, {
            name: "Spoof",
            email: platformEmail,
            role: "AGENT",
            password: "synthetic-password",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await member.PATCH(
          req("/api/settings/users/" + platform.id, platform, {
            name: "Authorized platform",
          }),
          ctx(platform.id),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await member.DELETE(
          req("/api/settings/users/" + admin.id, admin, {}, "DELETE"),
          ctx(admin.id),
        )
      ).status,
      403,
    );
  });
  test("availability writes persist exact operational states without changing lead distribution", async () => {
    const before = await db.leadAssignmentSetting.findMany({
      where: { companyId: company.id },
    });
    for (const status of ["ONLINE", "PAUSED", "OFFLINE", "BUSY"]) {
      const r = await presence.PATCH(
        req("/api/users/" + agent.id + "/status", supervisor, { status }),
        ctx(agent.id),
      );
      assert.equal(r.status, 200);
      assert.equal(
        (
          await db.userAvailability.findUniqueOrThrow({
            where: { userId: agent.id },
          })
        ).status,
        status,
      );
    }
    assert.equal(
      (
        await presence.PATCH(
          req("/api/users/" + admin.id + "/status", agent, {
            status: "ONLINE",
          }),
          ctx(admin.id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await presence.PATCH(
          req("/api/users/" + foreign.id + "/status", admin, {
            status: "ONLINE",
          }),
          ctx(foreign.id),
        )
      ).status,
      404,
    );
    assert.deepEqual(
      await db.leadAssignmentSetting.findMany({
        where: { companyId: company.id },
      }),
      before,
    );
    const body = {
      mode: "ROUND_ROBIN",
      onlineOnly: true,
      maxOpenPerAttendant: 1,
      allowAttendantClaim: true,
      redistributeWhenOffline: false,
    };
    assert.equal(
      (
        await assignment.PATCH(
          req("/api/settings/lead-assignment", admin, body),
        )
      ).status,
      200,
    );
    const stored = await db.leadAssignmentSetting.findFirstOrThrow({
      where: { companyId: company.id },
    });
    assert.equal(stored.mode, "ROUND_ROBIN");
    assert.equal(stored.maxOpenPerAttendant, 1);
  });
  test("tag CRUD preserves links and protected SEM MARGEM identity and schedule", async () => {
    const created = await tags.POST(
      req("/api/settings/tags", admin, {
        name: "Synthetic tag",
        color: "#2563eb",
      }),
    );
    assert.equal(created.status, 201);
    const id = (await created.json()).tag.id;
    assert.equal(
      (
        await tag.PATCH(
          req("/api/settings/tags/" + id, foreign, { name: "Foreign" }),
          ctx(id),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await tag.PATCH(
          req("/api/settings/tags/" + id, agent, { name: "Forbidden" }),
          ctx(id),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await tag.PATCH(
          req("/api/settings/tags/" + id, supervisor, {
            name: "Edited tag",
            color: "#16a34a",
            textColor: "#ffffff",
          }),
          ctx(id),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await tag.DELETE(
          req("/api/settings/tags/" + id, admin, {}, "DELETE"),
          ctx(id),
        )
      ).status,
      200,
    );
    assert.equal(
      (await db.tag.findUniqueOrThrow({ where: { id } })).isActive,
      false,
    );
    const protectedTag = await db.tag.create({
      data: { companyId: company.id, name: "SEM MARGEM", color: "#2563eb" },
    });
    const contact = await db.contact.create({
      data: {
        companyId: company.id,
        name: "Synthetic contact",
        phone: "5511900000044",
      },
    });
    await db.contactTag.create({
      data: { contactId: contact.id, tagId: protectedTag.id },
    });
    const dueAt = new Date("2027-01-23T11:00:00Z");
    const task = await db.task.create({
      data: {
        companyId: company.id,
        contactId: contact.id,
        title: "Retorno: Sem margem",
        dueAt,
      },
    });
    for (const body of [{ name: "Renamed" }, { isActive: false }])
      assert.equal(
        (
          await tag.PATCH(
            req("/api/settings/tags/" + protectedTag.id, admin, body),
            ctx(protectedTag.id),
          )
        ).status,
        409,
      );
    assert.equal(
      (
        await tag.DELETE(
          req("/api/settings/tags/" + protectedTag.id, admin, {}, "DELETE"),
          ctx(protectedTag.id),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await tag.PATCH(
          req("/api/settings/tags/" + protectedTag.id, admin, {
            color: "#16a34a",
          }),
          ctx(protectedTag.id),
        )
      ).status,
      200,
    );
    assert.equal(
      await db.contactTag.count({
        where: { contactId: contact.id, tagId: protectedTag.id },
      }),
      1,
    );
    assert.equal(
      (
        await db.task.findUniqueOrThrow({ where: { id: task.id } })
      ).dueAt.toISOString(),
      dueAt.toISOString(),
    );
  });
  test("contextual stage management shares real Kanban records and preserves tenant restrictions", async () => {
    const first = await stages.POST(
      req("/api/settings/stages", supervisor, {
        name: "First",
        color: "#2563eb",
        position: 1,
      }),
    );
    assert.equal(first.status, 201);
    const id = (await first.json()).stage.id;
    assert.equal(
      (
        await stages.POST(
          req("/api/settings/stages", agent, { name: "Forbidden" }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await stage.PATCH(
          req("/api/settings/stages/" + id, foreign, { name: "Foreign" }),
          ctx(id),
        )
      ).status,
      404,
    );
    const contact = await db.contact.create({
      data: {
        companyId: company.id,
        name: "Kanban synthetic",
        phone: "5511900000055",
        stageId: id,
      },
    });
    assert.equal(
      (
        await stage.PATCH(
          req("/api/settings/stages/" + id, supervisor, {
            name: "Updated",
            color: "#16a34a",
            position: 3,
          }),
          ctx(id),
        )
      ).status,
      200,
    );
    assert.equal(
      (await db.contact.findUniqueOrThrow({ where: { id: contact.id } }))
        .stageId,
      id,
    );
    const list = await kanban.GET(req("/api/kanban", admin));
    assert.equal(list.status, 200);
    assert((await list.text()).includes("Updated"));
    assert.equal(
      (
        await stage.DELETE(
          req("/api/settings/stages/" + id, admin, {}, "DELETE"),
          ctx(id),
        )
      ).status,
      400,
    );
  });
  test("origins remain shared, authorized and editable; unrelated user deletion preserves actor session", async () => {
    const created = await origins.POST(
      req("/api/settings/origins", admin, { name: "Synthetic origin" }),
    );
    assert.equal(created.status, 201);
    const id = (await created.json()).origin.id;
    assert.equal(
      (
        await origin.PATCH(
          req("/api/settings/origins/" + id, foreign, { name: "Foreign" }),
          ctx(id),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await origin.PATCH(
          req("/api/settings/origins/" + id, supervisor, {
            name: "Edited origin",
          }),
          ctx(id),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await origin.DELETE(
          req("/api/settings/origins/" + id, admin, {}, "DELETE"),
          ctx(id),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await member.DELETE(
          req("/api/settings/users/" + target.id, admin, {}, "DELETE"),
          ctx(target.id),
        )
      ).status,
      200,
    );
    assert.equal(
      (await users.GET(req("/api/settings/users", admin))).status,
      200,
    );
  });
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
