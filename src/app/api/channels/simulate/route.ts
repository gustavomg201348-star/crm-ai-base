import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { processInboundMessage } from "@/lib/inbound-message";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

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
          channelId?: string;
          name?: string;
          phone?: string;
          message?: string;
        }
      | null;

    if (!body?.phone || !body?.message) {
      return NextResponse.json(
        { error: "Telefone e mensagem sao obrigatorios." },
        { status: 400 }
      );
    }

    const channel = body.channelId
      ? await prisma.channel.findFirst({
          where: { id: body.channelId, companyId: session.companyId }
        })
      : await prisma.channel.findFirst({
          where: { companyId: session.companyId, type: "whatsapp" }
        });

    const conversation = await processInboundMessage({
      companyId: session.companyId,
      channelId: channel?.id ?? null,
      name: body.name,
      phone: body.phone,
      body: body.message
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel simular mensagem." },
      { status: 500 }
    );
  }
}
