import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "./db";
import {
  createSessionToken,
  getAuthenticatedSessionFromRequest,
  sessionCookie,
  type SessionSecurityUser,
  type SessionUser,
  validateSessionToken
} from "./auth";
import { POST as logout } from "../app/api/auth/logout/route";

process.env.AUTH_SECRET = "revocable-session-test-secret";

const baseUser: SessionSecurityUser = {
  id: "user-1",
  companyId: "company-a",
  name: "Admin Test",
  email: "admin@example.test",
  role: "ADMIN",
  passwordHash: "pbkdf2$test-salt$test-hash",
  company: { id: "company-a", name: "Company A", segment: null }
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

function tokenFor(user: SessionSecurityUser, expiresAt?: number) {
  return createSessionToken(publicUser(user), user.passwordHash, expiresAt);
}

function requestWithToken(token: string) {
  return new NextRequest("http://localhost/api/test", {
    headers: { cookie: `${sessionCookie.name}=${token}` }
  });
}

test("login valido produz sessao valida com o estado atual", async () => {
  const result = await validateSessionToken(tokenFor(baseUser), async () => baseUser);
  assert.deepEqual(result?.user, publicUser(baseUser));
});

test("token expirado e rejeitado antes do lookup", async () => {
  let lookups = 0;
  const result = await validateSessionToken(tokenFor(baseUser, Date.now() - 1), async () => {
    lookups += 1;
    return baseUser;
  });
  assert.equal(result, null);
  assert.equal(lookups, 0);
});

test("assinatura invalida e rejeitada antes do lookup", async () => {
  let lookups = 0;
  const token = tokenFor(baseUser);
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  const result = await validateSessionToken(tampered, async () => {
    lookups += 1;
    return baseUser;
  });
  assert.equal(result, null);
  assert.equal(lookups, 0);
});

test("downgrade ADMIN para AGENT revoga token antigo", async () => {
  const current = { ...baseUser, role: "AGENT" as const };
  assert.equal(await validateSessionToken(tokenFor(baseUser), async () => current), null);
});

test("upgrade AGENT para ADMIN nao concede privilegio ao token antigo", async () => {
  const previous = { ...baseUser, role: "AGENT" as const };
  assert.equal(await validateSessionToken(tokenFor(previous), async () => baseUser), null);
});

test("mudanca de company revoga token antigo", async () => {
  const current = {
    ...baseUser,
    companyId: "company-b",
    company: { id: "company-b", name: "Company B", segment: null }
  };
  assert.equal(await validateSessionToken(tokenFor(baseUser), async () => current), null);
});

test("mudanca de senha revoga token antigo", async () => {
  const current = { ...baseUser, passwordHash: "pbkdf2$new-salt$new-hash" };
  assert.equal(await validateSessionToken(tokenFor(baseUser), async () => current), null);
});

test("mudanca de email revoga token antigo", async () => {
  const current = { ...baseUser, email: "agent@example.test" };
  assert.equal(await validateSessionToken(tokenFor(baseUser), async () => current), null);
});

test("usuario excluido revoga token antigo", async () => {
  assert.equal(await validateSessionToken(tokenFor(baseUser), async () => null), null);
});

test("security stamp divergente e rejeitado", async () => {
  const current = { ...baseUser, passwordHash: `${baseUser.passwordHash}-changed` };
  assert.equal(
    await validateSessionToken(tokenFor(baseUser), async () => current),
    null
  );
});

test("novo login apos cada mudanca produz nova sessao valida", async () => {
  const changedUsers: SessionSecurityUser[] = [
    { ...baseUser, role: "AGENT" },
    {
      ...baseUser,
      companyId: "company-b",
      company: { id: "company-b", name: "Company B", segment: null }
    },
    { ...baseUser, passwordHash: "pbkdf2$new-salt$new-hash" }
  ];

  for (const current of changedUsers) {
    const result = await validateSessionToken(tokenFor(current), async () => current);
    assert.deepEqual(result?.user, publicUser(current));
  }
});

test("duas chamadas no mesmo request fazem somente um lookup", async () => {
  let lookups = 0;
  const request = requestWithToken(tokenFor(baseUser));
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = (async () => {
    lookups += 1;
    return baseUser;
  }) as unknown as typeof prisma.user.findUnique;

  try {
    const first = await getAuthenticatedSessionFromRequest(request);
    const second = await getAuthenticatedSessionFromRequest(request);
    assert.equal(first?.user.id, baseUser.id);
    assert.equal(second?.user.id, baseUser.id);
    assert.equal(lookups, 1);
  } finally {
    prisma.user.findUnique = originalFindUnique;
  }
});

test("requests diferentes fazem validacoes independentes", async () => {
  let lookups = 0;
  const token = tokenFor(baseUser);
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = (async () => {
    lookups += 1;
    return baseUser;
  }) as unknown as typeof prisma.user.findUnique;

  try {
    await getAuthenticatedSessionFromRequest(requestWithToken(token));
    await getAuthenticatedSessionFromRequest(requestWithToken(token));
    assert.equal(lookups, 2);
  } finally {
    prisma.user.findUnique = originalFindUnique;
  }
});

test("token ADMIN antigo rejeitado nao chega a autorizacao ADMIN", async () => {
  const downgraded = { ...baseUser, role: "AGENT" as const };
  const authenticated = await validateSessionToken(tokenFor(baseUser), async () => downgraded);
  assert.equal(authenticated, null);
});

test("token da company antiga e rejeitado antes de acesso tenant", async () => {
  const transferred = {
    ...baseUser,
    companyId: "company-b",
    company: { id: "company-b", name: "Company B", segment: null }
  };
  const authenticated = await validateSessionToken(tokenFor(baseUser), async () => transferred);
  assert.equal(authenticated, null);
});

test("logout remove o cookie do navegador atual", async () => {
  const response = await logout();
  const cookie = response.cookies.get(sessionCookie.name);
  assert.equal(cookie?.value, "");
  assert.equal(cookie?.maxAge, 0);
});

test("flags de cookie em production permanecem seguras", () => {
  assert.equal(sessionCookie.options.httpOnly, true);
  assert.equal(sessionCookie.options.sameSite, "lax");
  assert.equal(sessionCookie.options.path, "/");
  assert.equal(sessionCookie.options.maxAge, 60 * 60 * 24 * 7);
  assert.equal(sessionCookie.options.secure, process.env.NODE_ENV === "production");
});
