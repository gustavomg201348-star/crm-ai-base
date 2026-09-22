import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  ensureCltIntegrations,
  mapCltIntegration,
  resolveCltIntegrationSecrets,
  resolveSensitivePasswordUpdate,
  resolveSensitiveTextUpdate
} from "@/lib/clt-settings";
import {
  CltSecretStorageError,
  prepareCltSecretPasswordUpdate,
  prepareCltSecretTextUpdate
} from "@/lib/clt-secrets";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | { bankId?: string; username?: string; password?: string }
      | null;

    if (!body?.bankId) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    await ensureCltIntegrations(session.companyId);

    const current = await prisma.cltIntegration.findUnique({
      where: { companyId_bankId: { companyId: session.companyId, bankId: body.bankId } }
    });

    if (!current) {
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    }

    if (current.provider !== "newcorban") {
      return publicErrorResponse({ code: "CLT_PROVIDER_REJECTED", status: 400 });
    }

    const resolvedCurrent = resolveCltIntegrationSecrets(current);
    const username = resolveSensitiveTextUpdate(resolvedCurrent.username, body.username);
    const password = resolveSensitivePasswordUpdate(resolvedCurrent.password, body.password);
    const storedUsername = prepareCltSecretTextUpdate(current.username, body.username, "username");
    const storedPassword = prepareCltSecretPasswordUpdate(current.password, body.password);

    if (!username || !password) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        username: storedUsername,
        password: storedPassword,
        authType: "login-sms",
        status: "SMS_PENDING",
        smsStatus: "SMS_SENT",
        smsRequestedAt: new Date(),
        lastTestAt: new Date(),
        lastTestStatus: "PENDING",
        lastTestMessage:
          "Autenticacao assistida preparada. Solicite o SMS no Newcorban e informe o codigo recebido."
      }
    });

    return NextResponse.json({
      integration: mapCltIntegration(updated),
      message:
        "Fluxo assistido preparado. O envio real do SMS ainda precisa ser solicitado no Newcorban."
    });
  } catch (error) {
    if (error instanceof CltSecretStorageError) {
      return publicErrorResponse({
        code:
          error.code === "reserved_envelope"
            ? "CLT_INVALID_REQUEST"
            : "CLT_PROVIDER_UNAVAILABLE",
        status: error.code === "reserved_envelope" ? 400 : 500
      });
    }

    const session = await getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/integrations/authenticate",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_PROVIDER_UNAVAILABLE",
      status: 500,
      providerCode: "newcorban"
    });

    return publicErrorResponse({ code: "CLT_PROVIDER_UNAVAILABLE", status: 500 });
  }
}
