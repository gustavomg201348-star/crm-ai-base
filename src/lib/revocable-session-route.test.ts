import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST as createUser } from "../app/api/settings/users/route";
import { GET as getSession } from "../app/api/auth/session/route";
import {
  createSessionToken,
  sessionCookie,
  type SessionSecurityUser,
  type SessionUser
} from "./auth";
import { prisma } from "./db";

process.env.AUTH_SECRET = "revocable-session-route-test-secret";

const admin: SessionSecurityUser = {
  id: "admin-1",
  companyId: "company-a",
  name: "Admin Test",
  email: "admin@example.test",
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

function tokenFor(user: SessionSecurityUser) {
  return createSessionToken(publicUser(user), user.passwordHash);
}

function requestFor(
  path: string,
  token: string,
  init?: { method?: string; body?: string }
) {
  return new NextRequest(`http://localhost${path}`, {
    ...init,
    headers: {
      cookie: `${sessionCookie.name}=${token}`,
      "content-type": "application/json"
    }
  });
}

test("/api/auth/session faz um lookup de User e um lookup isolado de Company", async () => {
  let userLookups = 0;
  let companyLookups = 0;
  const originalUserFindUnique = prisma.user.findUnique;
  const originalCompanyFindUnique = prisma.company.findUnique;

  prisma.user.findUnique = (async () => {
    userLookups += 1;
    return admin;
  }) as unknown as typeof prisma.user.findUnique;
  prisma.company.findUnique = (async () => {
    companyLookups += 1;
    return { id: "company-a", name: "Company A", segment: null };
  }) as unknown as typeof prisma.company.findUnique;

  try {
    const response = await getSession(requestFor("/api/auth/session", tokenFor(admin)));
    assert.equal(response.status, 200);
    assert.equal(userLookups, 1);
    assert.equal(companyLookups, 1);
  } finally {
    prisma.user.findUnique = originalUserFindUnique;
    prisma.company.findUnique = originalCompanyFindUnique;
  }
});

test("token ADMIN revogado por downgrade e rejeitado antes da mutation da rota", async () => {
  let creates = 0;
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;

  prisma.user.findUnique = (async () => ({
    ...admin,
    role: "AGENT" as const
  })) as unknown as typeof prisma.user.findUnique;
  prisma.user.create = (async () => {
    creates += 1;
    throw new Error("mutation must not run");
  }) as unknown as typeof prisma.user.create;

  try {
    const response = await createUser(
      requestFor("/api/settings/users", tokenFor(admin), {
        method: "POST",
        body: JSON.stringify({
          name: "Blocked User",
          email: "blocked@example.test",
          password: "not-used",
          role: "AGENT"
        })
      })
    );
    assert.equal(response.status, 401);
    assert.equal(creates, 0);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
  }
});

test("token da company antiga e rejeitado antes da mutation da rota", async () => {
  let creates = 0;
  const originalFindUnique = prisma.user.findUnique;
  const originalCreate = prisma.user.create;

  prisma.user.findUnique = (async () => ({
    ...admin,
    companyId: "company-b"
  })) as unknown as typeof prisma.user.findUnique;
  prisma.user.create = (async () => {
    creates += 1;
    throw new Error("mutation must not run");
  }) as unknown as typeof prisma.user.create;

  try {
    const response = await createUser(
      requestFor("/api/settings/users", tokenFor(admin), {
        method: "POST",
        body: JSON.stringify({
          name: "Blocked User",
          email: "blocked@example.test",
          password: "not-used",
          role: "AGENT"
        })
      })
    );
    assert.equal(response.status, 401);
    assert.equal(creates, 0);
  } finally {
    prisma.user.findUnique = originalFindUnique;
    prisma.user.create = originalCreate;
  }
});
