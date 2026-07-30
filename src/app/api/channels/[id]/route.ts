import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

function mapChannel(channel: {
  id: string;
  name: string;
  type: string;
  provider: string;
  externalId: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhone: string | null;
  accessToken: string | null;
  verifyToken: string | null;
  appSecret: string | null;
  status: string;
  lastWebhookSubscribedAt: Date | null;
  lastWebhookReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    provider: channel.provider,
    externalId: channel.externalId,
    phoneNumberId: channel.phoneNumberId,
    wabaId: channel.wabaId,
    displayPhone: channel.displayPhone,
    hasAccessToken: Boolean(channel.accessToken),
    hasVerifyToken: Boolean(channel.verifyToken),
    hasAppSecret: Boolean(channel.appSecret),
    status: channel.status,
    lastWebhookSubscribedAt: channel.lastWebhookSubscribedAt,
    lastWebhookReceivedAt: channel.lastWebhookReceivedAt,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

async function findMetaIdentifierConflict({
  phoneNumberId,
  externalId,
  excludeChannelId
}: {
  phoneNumberId?: string | null;
  externalId?: string | null;
  excludeChannelId: string;
}) {
  if (phoneNumberId) {
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "meta",
        phoneNumberId,
        id: { not: excludeChannelId }
      },
      select: { id: true, name: true }
    });

    if (channel) {
      return true;
    }
  }

  if (externalId) {
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "meta",
        externalId,
        id: { not: excludeChannelId }
      },
      select: { id: true, name: true }
    });

    if (channel) {
      return true;
    }
  }

  return null;
}

export async function PATCH(
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

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          type?: string;
          provider?: string;
          externalId?: string;
          phoneNumberId?: string;
          wabaId?: string;
          displayPhone?: string;
          accessToken?: string;
          verifyToken?: string;
          appSecret?: string;
          status?: string;
        }
      | null;

    const current = await prisma.channel.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return publicErrorResponse({ code: "CHANNEL_NOT_FOUND", status: 404 });
    }

    const name = body?.name?.trim();
    const type = body?.type?.trim();
    const provider = body?.provider?.trim();
    const status = body?.status?.trim().toUpperCase();

    if (body?.name !== undefined && !name) {
      return publicErrorResponse({ code: "CHANNEL_INVALID_INPUT", status: 400 });
    }

    if (type !== undefined && !["whatsapp"].includes(type)) {
      return publicErrorResponse({ code: "CHANNEL_INVALID_INPUT", status: 400 });
    }

    if (status !== undefined && !["ACTIVE", "INACTIVE"].includes(status)) {
      return publicErrorResponse({ code: "CHANNEL_INVALID_INPUT", status: 400 });
    }

    const phoneNumberId = body?.phoneNumberId?.trim();
    const effectiveProvider = provider !== undefined ? provider || "meta" : current.provider;
    const effectivePhoneNumberId =
      body?.phoneNumberId !== undefined ? phoneNumberId || null : current.phoneNumberId;
    const effectiveExternalId =
      body?.externalId !== undefined
        ? body.externalId.trim() || effectivePhoneNumberId || null
        : body?.phoneNumberId !== undefined
          ? effectivePhoneNumberId || current.externalId
          : current.externalId;

    if (effectiveProvider === "meta") {
      const conflict = await findMetaIdentifierConflict({
        phoneNumberId: effectivePhoneNumberId,
        externalId: effectiveExternalId,
        excludeChannelId: current.id
      });

      if (conflict) {
        return publicErrorResponse({ code: "CHANNEL_CONFLICT", status: 409 });
      }
    }

    const channel = await prisma.channel.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(provider !== undefined ? { provider: effectiveProvider } : {}),
        ...(body?.displayPhone !== undefined
          ? { displayPhone: body.displayPhone.trim() || null }
          : {}),
        ...(body?.phoneNumberId !== undefined ? { phoneNumberId: effectivePhoneNumberId } : {}),
        ...(body?.wabaId !== undefined ? { wabaId: body.wabaId.trim() || null } : {}),
        ...(body?.externalId !== undefined
          ? { externalId: effectiveExternalId }
          : body?.phoneNumberId !== undefined
            ? { externalId: effectiveExternalId }
            : {}),
        ...(body?.accessToken?.trim() ? { accessToken: body.accessToken.trim() } : {}),
        ...(body?.verifyToken?.trim() ? { verifyToken: body.verifyToken.trim() } : {}),
        ...(body?.appSecret?.trim() ? { appSecret: body.appSecret.trim() } : {}),
        ...(status !== undefined ? { status } : {})
      }
    });

    return NextResponse.json({ channel: mapChannel(channel) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/channels/[id]",
      method: "PATCH",
      publicErrorCode: "CHANNEL_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "CHANNEL_UPDATE_FAILED", status: 500 });
  }
}
