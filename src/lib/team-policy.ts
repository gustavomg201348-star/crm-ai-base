import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
export function canManageTeamIdentity(
  actor: SessionUser,
  target: { email: string; companyId: string; role: string },
) {
  return (
    actor.role === "ADMIN" &&
    target.companyId === actor.companyId &&
    (isPlatformAdmin(actor) ||
      !isPlatformAdmin({
        ...target,
        role: "ADMIN",
        id: "policy-only",
        name: "",
      }))
  );
}
export function validTeamInput(value: unknown, creating: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["name", "email", "role", "password"].includes(key),
    )
  )
    return false;
  if (
    (creating || body.name !== undefined) &&
    (typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 150)
  )
    return false;
  if (
    (creating || body.email !== undefined) &&
    (typeof body.email !== "string" ||
      body.email.length > 254 ||
      !/^\S+@\S+\.\S+$/.test(body.email.trim()))
  )
    return false;
  if (
    body.role !== undefined &&
    (typeof body.role !== "string" ||
      !["ADMIN", "SUPERVISOR", "AGENT"].includes(body.role))
  )
    return false;
  if (
    (creating || body.password !== undefined) &&
    (typeof body.password !== "string" ||
      body.password.length > 1024 ||
      ((creating || body.password.length > 0) && body.password.length < 6))
  )
    return false;
  return true;
}
