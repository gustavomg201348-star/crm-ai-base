import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveChannelAccessToken } from "@/lib/channel-secrets";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  markTemplateNotReturned,
  resolveDefaultHeaderMediaAssetForTemplate,
  upsertNormalizedMetaTemplate
} from "@/lib/meta-template-service";
import { findMetaTemplateByIdentity, listMetaTemplatesByWaba } from "@/lib/meta-template-repository";
import { syncMetaTemplatesForWaba } from "@/lib/meta-template-sync";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readOptionalPageLimit(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const company = await prisma.company.findUnique({
      where: { id: session.companyId },
      select: { id: true }
    });

    if (!company) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const { id } = await params;
    const channel = await prisma.channel.findFirst({
      where: {
        id,
        companyId: session.companyId,
        type: "whatsapp",
        provider: "meta"
      },
      select: {
        id: true,
        companyId: true,
        wabaId: true,
        accessToken: true
      }
    });

    if (!channel?.wabaId) {
      return publicErrorResponse({ code: "CHANNEL_INVALID_INPUT", status: 400 });
    }

    const accessToken = resolveChannelAccessToken(channel.accessToken, {
      channelId: channel.id
    });

    if (!accessToken) {
      return publicErrorResponse({ code: "CHANNEL_INVALID_INPUT", status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | { pageLimit?: unknown }
      | null;
    const result = await syncMetaTemplatesForWaba(
      {
        companyId: session.companyId,
        wabaId: channel.wabaId,
        channelId: channel.id,
        accessToken,
        pageLimit: readOptionalPageLimit(body?.pageLimit),
        reason: "admin_endpoint"
      },
      {
        findExistingTemplate: ({ companyId, wabaId, name, language }) =>
          findMetaTemplateByIdentity(companyId, wabaId, name, language),
        upsertTemplate: upsertNormalizedMetaTemplate,
        resolveDefaultHeaderMediaAsset: ({
          companyId,
          normalizedTemplate,
          existingDefaultHeaderMediaAssetId
        }) =>
          resolveDefaultHeaderMediaAssetForTemplate({
            companyId,
            normalizedTemplate,
            existingDefaultHeaderMediaAssetId
          }),
        listActiveTemplatesByWaba: ({ companyId, wabaId }) =>
          listMetaTemplatesByWaba(companyId, wabaId, { isActive: true }),
        markTemplateNotReturned: ({ companyId, templateId }) =>
          markTemplateNotReturned(companyId, templateId)
      }
    );

    return NextResponse.json(result);
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "admin-template-sync",
      route: "/api/channels/[id]/templates/sync",
      publicErrorCode: "TEMPLATE_FETCH_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "TEMPLATE_FETCH_FAILED",
      status: 500,
      message: "Nao foi possivel sincronizar templates da Meta."
    });
  }
}
