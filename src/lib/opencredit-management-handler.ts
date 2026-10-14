import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import { requireCompanyAdmin } from "./permissions";
import { publicErrorResponse } from "./http-error-response";
import { safeLogError } from "./safe-logger";
import { OpenCreditConfigurationError, type createOpenCreditIntegrationService } from "./opencredit-integration.service";

type Context = { params: Promise<{ id: string }> };
type Service = ReturnType<typeof createOpenCreditIntegrationService>;
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
async function bodyObject(request: NextRequest) {
  if (!request.body) return {} as Record<string, unknown>;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2048) {
        await reader.cancel();
        throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new OpenCreditConfigurationError("INVALID_REQUEST", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
  return body as Record<string, unknown>;
}

export function createOpenCreditManagementHandlers(deps: {
  getSession(request: NextRequest): Promise<SessionUser | null>; service: Service;
}) {
  const run = (action: "list" | "create" | "patch" | "rotate") => async (request: NextRequest, context?: Context) => {
    try {
      const session = await deps.getSession(request);
      if (!session) return noStore(publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 }));
      const blocked = requireCompanyAdmin(session);
      if (blocked) return noStore(blocked);
      if (action === "list") return noStore(NextResponse.json({ integrations: await deps.service.list(session.companyId) }));
      const body = await bodyObject(request);
      if (action === "patch") {
        if (Object.keys(body).length !== 1 || typeof body.enabled !== "boolean") throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
      } else if (Object.keys(body).length !== 0) throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
      if (action === "create") return noStore(NextResponse.json(await deps.service.create(session.companyId), { status: 201 }));
      const id = (await context?.params)?.id;
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new OpenCreditConfigurationError("INVALID_REQUEST", 400);
      const result = action === "patch"
        ? await deps.service.setEnabled(session.companyId, id, body.enabled as boolean)
        : await deps.service.rotate(session.companyId, id);
      return noStore(NextResponse.json(result));
    } catch (error) {
      if (error instanceof OpenCreditConfigurationError) return noStore(publicErrorResponse({ code: error.code, status: error.status }));
      // Never pass a Prisma/encryption exception or request data to the logger.
      safeLogError("http-api", new Error("OPENCREDIT_CONFIGURATION_FAILED"), { action, status: 500 });
      return noStore(publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 }));
    }
  };
  return { GET: run("list"), POST: run("create"), PATCH: run("patch"), ROTATE: run("rotate") };
}
