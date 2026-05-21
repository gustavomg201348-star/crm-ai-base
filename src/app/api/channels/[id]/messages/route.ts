import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { readMetaMessageId, sendMetaTextMessage } from "@/lib/meta-whatsapp";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = context.params;
    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; to?: string; body?: string }
      | null;
    const message = body?.body?.trim();

    if (!message || !body?.to) {
      return NextResponse.json(
        { error: "Destino e mensagem sao obrigatorios." },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.findFirst({
      where: { id, companyId: session.companyId, type: "whatsapp" }
    });

    if (!channel) {
      return NextResponse.json({ error: "Canal nao encontrado." }, { status: 404 });
    }

    if (channel.provider !== "meta") {
      return NextResponse.json(
        { error: "Envio real exige canal provider=meta." },
        { status: 400 }
      );
    }

    if (!channel.phoneNumberId || !channel.accessToken) {
      return NextResponse.json(
        { error: "Canal sem phoneNumberId ou accessToken." },
        { status: 400 }
      );
    }

    const sent = await sendMetaTextMessage({
      phoneNumberId: channel.phoneNumberId,
      accessToken: channel.accessToken,
      to: body.to.replace(/\D/g, ""),
      body: message
    });
    const providerMessageId = readMetaMessageId(sent);

    const normalizedPhone = body.to.replace(/\D/g, "");
    let conversation = body.conversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: body.conversationId,
            contact: { companyId: session.companyId }
          },
          include: { contact: true }
        })
      : null;

    if (!conversation) {
      const [origin, stage] = await Promise.all([
        prisma.origin.findFirst({
          where: { companyId: session.companyId },
          orderBy: { name: "asc" }
        }),
        prisma.pipelineStage.findFirst({
          where: { companyId: session.companyId },
          orderBy: { position: "asc" }
        })
      ]);

      const contact =
        (await prisma.contact.findFirst({
          where: { companyId: session.companyId, phone: normalizedPhone }
        })) ??
        (await prisma.contact.create({
          data: {
            companyId: session.companyId,
            ownerId: session.id,
            originId: origin?.id,
            stageId: stage?.id,
            name: normalizedPhone,
            phone: normalizedPhone,
            temperature: "WARM",
            lastMessage: message
          }
        }));

      conversation =
        (await prisma.conversation.findFirst({
          where: {
            contactId: contact.id,
            channel: `whatsapp:${channel.id}`,
            status: { in: ["OPEN", "PENDING", "BOT"] }
          },
          include: { contact: true }
        })) ??
        (await prisma.conversation.create({
          data: {
            contactId: contact.id,
            agentId: session.id,
            status: "OPEN",
            channel: `whatsapp:${channel.id}`
          },
          include: { contact: true }
        }));
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          body: message,
          type: "text",
          status: "sent",
          providerMessageId
        }
      });

      await createActivity(tx, {
        contactId: conversation.contactId,
        userId: session.id,
        type: "MESSAGE_SENT",
        title: "Mensagem enviada pela Meta",
        detail: message
      });

      return tx.conversation.update({
        where: { id: conversation.id },
        data: {
          channel: `whatsapp:${channel.id}`,
          updatedAt: new Date(),
          contact: { update: { lastMessage: message } }
        },
        include: conversationInclude
      });
    });

    return NextResponse.json({
      ok: true,
      meta: sent,
      conversation: mapConversation(updated)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar mensagem."
      },
      { status: 500 }
    );
  }
}
