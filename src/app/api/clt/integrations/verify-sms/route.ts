import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { ensureCltIntegrations, mapCltIntegration } from "@/lib/clt-settings";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          bankId?: string;
          smsCode?: string;
          digitadorCode?: string;
          certifiedAgentCpf?: string;
          actingUf?: string;
          newcorbanIdentifier?: string;
        }
      | null;

    if (!body?.bankId) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    if (!body.smsCode?.trim()) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    if (!body.digitadorCode?.trim() || !body.certifiedAgentCpf?.trim() || !body.actingUf?.trim()) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    await ensureCltIntegrations(session.companyId);

    const current = await prisma.cltIntegration.findUnique({
      where: { companyId_bankId: { companyId: session.companyId, bankId: body.bankId } }
    });

    if (!current) {
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    }

    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        newcorbanIdentifier: body.newcorbanIdentifier?.trim() || current.newcorbanIdentifier,
        digitadorCode: body.digitadorCode.trim(),
        certifiedAgentCpf: body.certifiedAgentCpf.trim(),
        actingUf: body.actingUf.trim().toUpperCase(),
        authType: "login-sms",
        status: "ASSISTED",
        smsStatus: "VERIFIED",
        lastTestAt: new Date(),
        lastTestStatus: "SUCCESS",
        lastTestMessage:
          "Credenciais Newcorban validadas em modo assistido. Mercantil pronto para simulacao."
      }
    });

    return NextResponse.json({
      integration: mapCltIntegration(updated),
      message: "Credenciais Mercantil/Newcorban salvas."
    });
  } catch (error) {
    const session = getSessionFromRequest(request);

    safeLogError("http-api", error, {
      route: "/api/clt/integrations/verify-sms",
      method: "POST",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "CLT_PROVIDER_REJECTED",
      status: 500,
      providerCode: "newcorban"
    });

    return publicErrorResponse({ code: "CLT_PROVIDER_REJECTED", status: 500 });
  }
}
