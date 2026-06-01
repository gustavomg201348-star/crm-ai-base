import type { NextRequest } from "next/server";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export type SessionUser = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: "ADMIN" | "SUPERVISOR" | "AGENT";
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

export function createSessionToken(user: SessionUser) {
  const payload = Buffer.from(
    JSON.stringify({
      ...user,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7
    })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

export function parseSessionToken(token?: string): SessionUser | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as
      | (SessionUser & { exp: number })
      | null;

    if (!parsed || parsed.exp < Date.now()) return null;

    return {
      id: parsed.id,
      companyId: parsed.companyId,
      name: parsed.name,
      email: parsed.email,
      role: parsed.role
    };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: NextRequest) {
  return parseSessionToken(request.cookies.get(cookieName)?.value);
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
