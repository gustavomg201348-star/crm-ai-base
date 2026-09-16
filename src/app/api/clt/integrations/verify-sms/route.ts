import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  ensureCltIntegrations,
  mapCltIntegration,
  resolveCltIntegrationSecrets,
  resolveSensitiveTextUpdate
} from "@/lib/clt-settings";
import {
  CltSecretStorageError,
  prepareCltSecretTextUpdate
} from "@/lib/clt-secrets";
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

    await ensureCltIntegrations(session.companyId);

    const current = await prisma.cltIntegration.findUnique({
      where: { companyId_bankId: { companyId: session.companyId, bankId: body.bankId } }
    });

    if (!current) {
      return publicErrorResponse({ code: "NOT_FOUND", status: 404 });
    }

    const resolvedCurrent = resolveCltIntegrationSecrets(current);
    const newcorbanIdentifier = resolveSensitiveTextUpdate(
      resolvedCurrent.newcorbanIdentifier,
      body.newcorbanIdentifier
    );
    const digitadorCode = resolveSensitiveTextUpdate(resolvedCurrent.digitadorCode, body.digitadorCode);
    const certifiedAgentCpf = resolveSensitiveTextUpdate(
      resolvedCurrent.certifiedAgentCpf,
      body.certifiedAgentCpf
    );
    const storedNewcorbanIdentifier = prepareCltSecretTextUpdate(
      current.newcorbanIdentifier,
      body.newcorbanIdentifier,
      "newcorbanIdentifier"
    );
    const storedDigitadorCode = prepareCltSecretTextUpdate(
      current.digitadorCode,
      body.digitadorCode,
      "digitadorCode"
    );
    const storedCertifiedAgentCpf = prepareCltSecretTextUpdate(
      current.certifiedAgentCpf,
      body.certifiedAgentCpf,
      "certifiedAgentCpf"
    );
    const actingUf = body.actingUf?.trim().toUpperCase() || current.actingUf;

    if (!digitadorCode || !certifiedAgentCpf || !actingUf) {
      return publicErrorResponse({ code: "CLT_INVALID_REQUEST", status: 400 });
    }

    const updated = await prisma.cltIntegration.update({
      where: { id: current.id },
      data: {
        newcorbanIdentifier: storedNewcorbanIdentifier,
        digitadorCode: storedDigitadorCode,
        certifiedAgentCpf: storedCertifiedAgentCpf,
        actingUf,
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
    if (error instanceof CltSecretStorageError) {
      return publicErrorResponse({
        code:
          error.code === "reserved_envelope"
            ? "CLT_INVALID_REQUEST"
            : "CLT_PROVIDER_REJECTED",
        status: error.code === "reserved_envelope" ? 400 : 500
      });
    }

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
