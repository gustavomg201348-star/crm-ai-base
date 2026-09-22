import type { NextRequest } from "next/server";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export type SessionUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUPERVISOR" | "AGENT";
};

type SessionTokenPayload = SessionUser & {
  exp: number;
  securityStamp: string;
};

export type SessionSecurityUser = SessionUser & {
  passwordHash: string;
};

export type AuthenticatedSession = {
  user: SessionUser;
};

const cookieName = "crm_session";

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET precisa estar configurado em producao.");
  }

  return "dev-secret-change-me";
}

function sign(payload: string) {
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

function safeEqualHex(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function securityStamp(
  user: Pick<SessionSecurityUser, "id" | "companyId" | "email" | "role" | "passwordHash">
) {
  return sign(
    JSON.stringify([user.id, user.companyId, user.email.toLowerCase(), user.role, user.passwordHash])
  );
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;

  const candidate = pbkdf2Sync(password, salt, 100000, 64, "sha512");
  const expected = Buffer.from(hash, "hex");

  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSessionToken(
  user: SessionUser,
  passwordHash: string,
  expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7
) {
  const payload = Buffer.from(
    JSON.stringify({
      ...user,
      securityStamp: securityStamp({ ...user, passwordHash }),
      exp: expiresAt
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

function parseSessionTokenPayload(token?: string): SessionTokenPayload | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqualHex(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
      | SessionTokenPayload
      | null;

    if (
      !parsed ||
      parsed.exp < Date.now() ||
      typeof parsed.securityStamp !== "string" ||
      !parsed.securityStamp
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function validateSessionToken(
  token: string | undefined,
  findUser: (id: string) => Promise<SessionSecurityUser | null> = async (id) =>
    prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        name: true,
        email: true,
        role: true,
        passwordHash: true
      }
    }) as Promise<SessionSecurityUser | null>
): Promise<AuthenticatedSession | null> {
  const parsed = parseSessionTokenPayload(token);
  if (!parsed) return null;

  const current = await findUser(parsed.id);
  if (!current) return null;
  if (!(["ADMIN", "SUPERVISOR", "AGENT"] as const).includes(current.role as SessionUser["role"])) {
    return null;
  }

  if (!safeEqualHex(parsed.securityStamp, securityStamp(current))) {
    return null;
  }

  return {
    user: {
      id: current.id,
      companyId: current.companyId,
      name: current.name,
      email: current.email,
      role: current.role as SessionUser["role"]
    }
  };
}

const requestSessionCacheKey = Symbol("qevora.request-session");
type RequestWithSessionCache = NextRequest & {
  [requestSessionCacheKey]?: Promise<AuthenticatedSession | null>;
};

export function getAuthenticatedSessionFromRequest(
  request: NextRequest
) {
  const cacheOwner = request as RequestWithSessionCache;
  const cached = cacheOwner[requestSessionCacheKey];
  if (cached) return cached;

  const pending = validateSessionToken(request.cookies.get(cookieName)?.value).catch(() => null);
  cacheOwner[requestSessionCacheKey] = pending;
  return pending;
}

export async function getSessionFromRequest(request: NextRequest) {
  return (await getAuthenticatedSessionFromRequest(request))?.user ?? null;
}

export const sessionCookie = {
  name: cookieName,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  }
};
