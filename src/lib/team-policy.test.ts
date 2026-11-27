import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { SessionUser } from "./auth";
import { canManageTeamIdentity, validTeamInput } from "./team-policy";
const actor: SessionUser = {
  id: "a",
  name: "Synthetic",
  email: "admin@invalid.test",
  companyId: "a",
  role: "ADMIN",
};
test("team input rejects privilege fields, malformed roles and credentials", () => {
  const valid = {
    name: "Synthetic",
    email: "synthetic@invalid.test",
    password: "synthetic-password",
    role: "AGENT",
  };
  assert(validTeamInput(valid, true));
  assert(validTeamInput({ name: "Changed" }, false));
  for (const bad of [
    { ...valid, companyId: "other" },
    { ...valid, role: "PLATFORM_ADMIN" },
    { ...valid, role: ["ADMIN"] },
    { ...valid, email: "bad" },
    { ...valid, password: "a" },
    { ...valid, password: "a".repeat(1025) },
  ])
    assert(!validTeamInput(bad, true));
});
test("team management never grants platform privileges through a company profile", () => {
  const oldCompany = process.env.PLATFORM_COMPANY_ID,
    oldEmails = process.env.PLATFORM_ADMIN_EMAILS;
  try {
    delete process.env.PLATFORM_COMPANY_ID;
    process.env.PLATFORM_ADMIN_EMAILS = "platform@invalid.test";
    assert(canManageTeamIdentity(actor, { ...actor, role: "AGENT" }));
    assert(!canManageTeamIdentity({ ...actor, role: "SUPERVISOR" }, actor));
    assert(!canManageTeamIdentity({ ...actor, role: "AGENT" }, actor));
    assert(!canManageTeamIdentity(actor, { ...actor, companyId: "foreign" }));
    assert(
      !canManageTeamIdentity(actor, {
        ...actor,
        email: "platform@invalid.test",
        role: "AGENT",
      }),
    );
    assert(
      !canManageTeamIdentity(actor, {
        ...actor,
        email: "platform@invalid.test",
      }),
    );
    assert(
      canManageTeamIdentity(
        { ...actor, email: "platform@invalid.test" },
        { ...actor, email: "platform@invalid.test" },
      ),
    );
    process.env.PLATFORM_COMPANY_ID = "platform-company";
    assert(
      !canManageTeamIdentity(actor, {
        ...actor,
        companyId: "platform-company",
      }),
    );
  } finally {
    if (oldCompany === undefined) delete process.env.PLATFORM_COMPANY_ID;
    else process.env.PLATFORM_COMPANY_ID = oldCompany;
    if (oldEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = oldEmails;
  }
});
test("settings controls have one home and do not add operational integration switches", () => {
  const page = readFileSync("src/app/page.tsx", "utf8"),
    workspace = readFileSync(
      "src/app/components/settings/SettingsWorkspace.tsx",
      "utf8",
    );
  assert(!page.includes("function Configuracoes("));
  assert(!page.includes("function TagsSettingsPage("));
  assert(page.includes('active === "equipe"'));
  assert(page.includes('<ReferenceManager kind="stages"'));
  assert.match(workspace, /<ReferenceManager\s+kind="origins"/);
  assert(!workspace.includes('kind="stages"'));
  assert(!workspace.includes("materializationEnabled"));
  assert(!workspace.includes("worker"));
  const operational = readFileSync(
    "src/app/components/settings/OperationalSettings.tsx",
    "utf8",
  );
  assert(!operational.includes("onUpdateAttendantStatus"));
  assert(operational.includes("assignmentForm.mode"));
});
