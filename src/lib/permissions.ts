import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, type SessionUser } from "@/lib/auth";

export type Role = SessionUser["role"];

export function isAdmin(session: SessionUser) {
  return session.role === "ADMIN" || session.role === "SUPERVISOR";
}

export function isPlatformAdmin(session: SessionUser) {
  if (session.role !== "ADMIN") return false;

  const companyId = process.env.PLATFORM_COMPANY_ID;
  const emails = (process.env.PLATFORM_ADMIN_EMAILS || "admin@crm.local")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (companyId) return session.companyId === companyId;
  return emails.includes(session.email.toLowerCase());
}

export function isAgent(session: SessionUser) {
  return session.role === "AGENT";
}

export function getSessionOrUnauthorized(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Nao autenticado." }, { status: 401 })
    };
  }

  return { session, response: null };
}

export function forbidden(message = "Voce nao tem permissao para acessar este recurso.") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function requireAdmin(session: SessionUser) {
  return isAdmin(session) ? null : forbidden();
}

export function requirePlatformAdmin(session: SessionUser) {
  return isPlatformAdmin(session)
    ? null
    : forbidden("Apenas o administrador master pode gerenciar empresas.");
}

export function canAccessConversation({
  session,
  agentId
}: {
  session: SessionUser;
  agentId?: string | null;
}) {
  if (isAdmin(session)) return true;
  return !agentId || agentId === session.id;
}

export function conversationVisibilityWhere(session: SessionUser) {
  if (isAdmin(session)) return {};

  return {
    OR: [{ agentId: session.id }, { agentId: null }]
  };
}
