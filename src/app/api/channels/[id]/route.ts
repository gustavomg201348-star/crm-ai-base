import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
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
      return NextResponse.json({ error: "Canal nao encontrado." }, { status: 404 });
    }

    const name = body?.name?.trim();
    const type = body?.type?.trim();
    const provider = body?.provider?.trim();
    const status = body?.status?.trim().toUpperCase();

    if (body?.name !== undefined && !name) {
      return NextResponse.json({ error: "Nome obrigatorio." }, { status: 400 });
    }

    if (type !== undefined && !["whatsapp"].includes(type)) {
      return NextResponse.json({ error: "Tipo de canal invalido." }, { status: 400 });
    }

    if (status !== undefined && !["ACTIVE", "INACTIVE"].includes(status)) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }

    const phoneNumberId = body?.phoneNumberId?.trim();

    const channel = await prisma.channel.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(provider !== undefined ? { provider: provider || "meta" } : {}),
        ...(body?.displayPhone !== undefined
          ? { displayPhone: body.displayPhone.trim() || null }
          : {}),
        ...(body?.phoneNumberId !== undefined ? { phoneNumberId: phoneNumberId || null } : {}),
        ...(body?.wabaId !== undefined ? { wabaId: body.wabaId.trim() || null } : {}),
        ...(body?.externalId !== undefined
          ? { externalId: body.externalId.trim() || phoneNumberId || null }
          : body?.phoneNumberId !== undefined
            ? { externalId: phoneNumberId || current.externalId }
            : {}),
        ...(body?.accessToken?.trim() ? { accessToken: body.accessToken.trim() } : {}),
        ...(body?.verifyToken?.trim() ? { verifyToken: body.verifyToken.trim() } : {}),
        ...(body?.appSecret?.trim() ? { appSecret: body.appSecret.trim() } : {}),
        ...(status !== undefined ? { status } : {})
      }
    });

    return NextResponse.json({ channel: mapChannel(channel) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar canal." },
      { status: 500 }
    );
  }
}
