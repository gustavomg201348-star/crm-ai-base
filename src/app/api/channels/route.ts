import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

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
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const channels = await prisma.channel.findMany({
      where: { companyId: session.companyId },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({ channels: channels.map(mapChannel) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar canais." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

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

    const channel = await prisma.channel.create({
      data: {
        companyId: session.companyId,
        name: body.name.trim(),
        type: "whatsapp",
        provider: body.provider?.trim() || "sandbox",
        externalId: body.externalId?.trim() || body.phoneNumberId?.trim() || null,
        phoneNumberId: body.phoneNumberId?.trim() || null,
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
      { error: "Nao foi possivel criar canal." },
      { status: 500 }
    );
  }
}
