import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import { validateMetaWhatsAppCredentials } from "@/lib/meta-whatsapp-diagnostics";
import { sanitizeMetaDiagnostics } from "@/lib/meta-diagnostics-sanitizer";

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
  externalId
}: {
  phoneNumberId?: string | null;
  externalId?: string | null;
}) {
  if (phoneNumberId) {
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "meta",
        phoneNumberId
      },
      select: { id: true, name: true }
    });

    if (channel) {
      return `Phone Number ID ja esta em uso por outro canal Meta (${channel.name}).`;
    }
  }

  if (externalId) {
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "meta",
        externalId
      },
      select: { id: true, name: true }
    });

    if (channel) {
      return `External ID ja esta em uso por outro canal Meta (${channel.name}).`;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const channels = await prisma.channel.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({ channels: channels.map(mapChannel) });
  } catch {
    return NextResponse.json(
      { error: "CHANNELS_LIST_FAILED" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          provider?: string;
          externalId?: string;
          phoneNumberId?: string;
          wabaId?: string;
          displayPhone?: string;
          accessToken?: string;
          verifyToken?: string;
          appSecret?: string;
        }
      | null;

    if (!body?.name?.trim()) {
      return NextResponse.json({ error: "Nome obrigatorio." }, { status: 400 });
    }

    const provider = body.provider?.trim() || "sandbox";
    const phoneNumberId = body.phoneNumberId?.trim() || null;
    const externalId = body.externalId?.trim() || phoneNumberId;

    if (provider === "meta") {
      const conflict = await findMetaIdentifierConflict({
        phoneNumberId,
        externalId
      });

      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 });
      }

      const diagnostics = await validateMetaWhatsAppCredentials({
        accessToken: body.accessToken,
        wabaId: body.wabaId,
        phoneNumberId: body.phoneNumberId
      });

      if (!diagnostics.ok) {
        const publicDiagnostics = sanitizeMetaDiagnostics(diagnostics);
        const reason =
          publicDiagnostics.token.error ||
          publicDiagnostics.waba.error ||
          publicDiagnostics.phone.error ||
          (publicDiagnostics.permissions.missing.length
            ? `Permissoes ausentes: ${publicDiagnostics.permissions.missing.join(", ")}.`
            : "Validacao Meta incompleta.");
        return NextResponse.json(
          { error: reason, diagnostics: publicDiagnostics },
          { status: 400 }
        );
      }
    }

    const channel = await prisma.channel.create({
      data: {
        companyId: session.companyId,
        name: body.name.trim(),
        type: "whatsapp",
        provider,
        externalId,
        phoneNumberId,
        wabaId: body.wabaId?.trim() || null,
        displayPhone: body.displayPhone?.trim() || null,
        accessToken: body.accessToken?.trim() || null,
        verifyToken: body.verifyToken?.trim() || null,
        appSecret: body.appSecret?.trim() || null,
        status: "ACTIVE"
      }
    });

    return NextResponse.json({ channel: mapChannel(channel) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "CHANNEL_CREATE_FAILED" },
      { status: 500 }
    );
  }
}
