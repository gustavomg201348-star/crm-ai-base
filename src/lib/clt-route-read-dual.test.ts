import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as getCltIntegrations } from "../app/api/clt/integrations/route";
import {
  createSessionToken,
  sessionCookie,
  type SessionSecurityUser,
  type SessionUser
} from "./auth";
import { prisma } from "./db";

process.env.AUTH_SECRET = "clt-get-read-only-test-secret";

const admin: SessionSecurityUser = {
  id: "clt-read-admin",
  companyId: "company-clt-read",
  name: "CLT Read Admin",
  email: "clt-read-admin@example.test",
  role: "ADMIN",
  passwordHash: "pbkdf2$test-salt$test-hash"
};

function publicUser(user: SessionSecurityUser): SessionUser {
  return {
    id: user.id,
    companyId: user.companyId,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function authenticatedGetRequest() {
  const token = createSessionToken(publicUser(admin), admin.passwordHash);
  return new NextRequest("http://localhost/api/clt/integrations", {
    headers: { cookie: `${sessionCookie.name}=${token}` }
  });
}

function integration(bankId: string, bankName: string) {
  return {
    id: `integration-${bankId}`,
    companyId: admin.companyId,
    bankId,
    bankName,
    provider: bankId === "mercantil" ? "newcorban" : "manual",
    baseUrl: bankId === "mercantil" ? "https://viva.newcorban.com.br" : null,
    authType: bankId === "mercantil" ? "login-sms" : "none",
    apiKey: null,
    username: null,
    password: null,
    newcorbanIdentifier: null,
    digitadorCode: null,
    certifiedAgentCpf: null,
    actingUf: null,
    smsStatus: null,
    smsRequestedAt: null,
    status: bankId === "mercantil" ? "ASSISTED" : "MANUAL",
    lastTestAt: null,
    lastTestStatus: null,
    lastTestMessage: null,
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
    updatedAt: new Date("2026-09-25T10:00:00.000Z")
  };
}

async function withReadOnlyGetMocks(
  rowsOrError: ReturnType<typeof integration>[] | Error,
  action: (mutationCalls: string[], readCalls: unknown[]) => Promise<void>
) {
  const userDelegate = prisma.user;
  const integrationDelegate = prisma.cltIntegration as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  const originalUserFindUnique = userDelegate.findUnique;
  const methodNames = [
    "findMany",
    "create",
    "update",
    "updateMany",
    "upsert",
    "delete"
  ] as const;
  const originals = Object.fromEntries(methodNames.map((name) => [name, integrationDelegate[name]]));
  const mutationCalls: string[] = [];
  const readCalls: unknown[] = [];

  userDelegate.findUnique = (async () => admin) as unknown as typeof userDelegate.findUnique;
  integrationDelegate.findMany = async (args) => {
    readCalls.push(args);
    if (rowsOrError instanceof Error) throw rowsOrError;
    return rowsOrError;
  };
  for (const name of methodNames.filter((name) => name !== "findMany")) {
    integrationDelegate[name] = async () => {
      mutationCalls.push(name);
      throw new Error(`${name} must not be called by GET /api/clt/integrations`);
    };
  }

  try {
    await action(mutationCalls, readCalls);
  } finally {
    userDelegate.findUnique = originalUserFindUnique;
    for (const name of methodNames) integrationDelegate[name] = originals[name];
  }
}

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("authenticate route resolve username/password before validation and preserves stored value on write", () => {
  const code = source("src/app/api/clt/integrations/authenticate/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedCurrent = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolveSensitiveTextUpdate\(resolvedCurrent\.username, body\.username\)/);
  assert.match(code, /resolveSensitivePasswordUpdate\(resolvedCurrent\.password, body\.password\)/);
  assert.match(code, /const storedUsername = prepareCltSecretTextUpdate\(current\.username, body\.username, "username"\)/);
  assert.match(code, /const storedPassword = prepareCltSecretPasswordUpdate\(current\.password, body\.password\)/);
  assert.match(code, /username: storedUsername/);
  assert.match(code, /password: storedPassword/);
  assert.ok(code.indexOf("const updated = await prisma.cltIntegration.update") > code.indexOf("const storedPassword"));
  assert.equal(code.includes("encryptSecret("), false);
});

test("verify-sms route resolve CLT operational secrets before validation and preserves stored value on write", () => {
  const code = source("src/app/api/clt/integrations/verify-sms/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedCurrent = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedCurrent\.newcorbanIdentifier/);
  assert.match(code, /resolvedCurrent\.digitadorCode/);
  assert.match(code, /resolvedCurrent\.certifiedAgentCpf/);
  assert.match(code, /const storedNewcorbanIdentifier = prepareCltSecretTextUpdate/);
  assert.match(code, /const storedDigitadorCode = prepareCltSecretTextUpdate/);
  assert.match(code, /const storedCertifiedAgentCpf = prepareCltSecretTextUpdate/);
  assert.match(code, /newcorbanIdentifier: storedNewcorbanIdentifier/);
  assert.match(code, /digitadorCode: storedDigitadorCode/);
  assert.match(code, /certifiedAgentCpf: storedCertifiedAgentCpf/);
  assert.ok(
    code.indexOf("const updated = await prisma.cltIntegration.update") >
      code.indexOf("const storedCertifiedAgentCpf")
  );
  assert.equal(code.includes("encryptSecret("), false);
});

test("test route evaluates minimum config from resolved apiKey/username", () => {
  const code = source("src/app/api/clt/integrations/test/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedSecrets = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedSecrets\.apiKey/);
  assert.match(code, /resolvedSecrets\.username/);
});

test("integrations PATCH prepara os seis secrets CLT antes do Prisma update sem encrypt direto na rota", () => {
  const code = source("src/app/api/clt/integrations/route.ts");

  assert.match(code, /const preparedSecrets = \{/);
  assert.match(code, /apiKey: prepareCltSecretTextUpdate\(current\.apiKey, body\.apiKey, "apiKey"\)/);
  assert.match(code, /username: prepareCltSecretTextUpdate\(current\.username, body\.username, "username"\)/);
  assert.match(code, /password: prepareCltSecretPasswordUpdate\(current\.password, body\.password\)/);
  assert.match(code, /newcorbanIdentifier: prepareCltSecretTextUpdate/);
  assert.match(code, /digitadorCode: prepareCltSecretTextUpdate/);
  assert.match(code, /certifiedAgentCpf: prepareCltSecretTextUpdate/);
  assert.ok(code.indexOf("const updated = await prisma.cltIntegration.update") > code.indexOf("const preparedSecrets"));
  assert.match(code, /\.\.\.preparedSecrets/);
  assert.equal(code.includes("encryptSecret("), false);
});

test("integrations PATCH remains tenant-scoped and delegates metadata canonicalization", () => {
  const code = source("src/app/api/clt/integrations/route.ts");

  assert.match(
    code,
    /findCltIntegrationForPatch\(session\.companyId, body\.bankId\)/
  );
  assert.match(code, /const metadata = resolveCltIntegrationPatchMetadata\(current, body\)/);
  assert.match(code, /where: \{ id: current\.id \}/);
  assert.match(code, /\.\.\.metadata/);
});

test("integrations GET reads the tenant catalog without provisioning or Prisma mutations", async () => {
  const rows = [
    integration("3rn", "3RN"),
    integration("bmg", "BMG"),
    integration("c6-ficsa", "C6 Ficsa"),
    integration("mercantil", "Mercantil")
  ];

  await withReadOnlyGetMocks(rows, async (mutationCalls, readCalls) => {
    const response = await getCltIntegrations(authenticatedGetRequest());
    const body = (await response.json()) as { integrations: Array<{ bankId: string }> };

    assert.equal(response.status, 200);
    assert.deepEqual(readCalls, [
      {
        where: { companyId: admin.companyId },
        orderBy: { bankName: "asc" }
      }
    ]);
    assert.deepEqual(body.integrations.map((item) => item.bankId), [
      "3rn",
      "bmg",
      "c6-ficsa",
      "mercantil"
    ]);
    assert.deepEqual(mutationCalls, []);
  });
});

test("integrations GET leaves an incomplete tenant catalog unchanged", async () => {
  const rows = [integration("mercantil", "Mercantil")];

  await withReadOnlyGetMocks(rows, async (mutationCalls, readCalls) => {
    const response = await getCltIntegrations(authenticatedGetRequest());
    const body = (await response.json()) as { integrations: Array<{ bankId: string }> };

    assert.equal(response.status, 200);
    assert.deepEqual(body.integrations.map((item) => item.bankId), ["mercantil"]);
    assert.equal(readCalls.length, 1);
    assert.deepEqual(mutationCalls, []);
  });
});

test("integrations GET fallback remains zero-write when the read fails", async () => {
  await withReadOnlyGetMocks(new Error("simulated read failure"), async (mutationCalls, readCalls) => {
    const response = await getCltIntegrations(authenticatedGetRequest());
    const body = (await response.json()) as {
      integrations: Array<{ bankId: string }>;
      fallback?: boolean;
    };

    assert.equal(response.status, 200);
    assert.equal(body.fallback, true);
    assert.deepEqual(body.integrations.map((item) => item.bankId), [
      "mercantil",
      "c6-ficsa",
      "bmg",
      "3rn"
    ]);
    assert.equal(readCalls.length, 1);
    assert.deepEqual(mutationCalls, []);
  });
});

test("integrations GET source uses the read helper while PATCH keeps provisioning", () => {
  const code = source("src/app/api/clt/integrations/route.ts");
  const getSource = code.slice(code.indexOf("export async function GET"), code.indexOf("export async function PATCH"));
  const patchSource = code.slice(code.indexOf("export async function PATCH"));

  assert.match(getSource, /listCltIntegrations\(session\.companyId\)/);
  assert.doesNotMatch(getSource, /provisionCltIntegrations/);
  assert.doesNotMatch(getSource, /\.(?:create|update|updateMany|upsert|delete)\s*\(/);
  assert.match(patchSource, /provisionCltIntegrations\(session\.companyId\)/);
});
