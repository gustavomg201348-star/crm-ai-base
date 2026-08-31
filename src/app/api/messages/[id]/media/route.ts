import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveChannelAccessToken } from "@/lib/channel-secrets";
import { resolveConversationChannelId } from "@/lib/conversation-channel.service";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { canAccessConversation } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

async function getMetaMediaUrl({
  mediaId,
  accessToken
}: {
  mediaId: string;
  accessToken: string;
}) {
  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    }
  );
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.url) {
    throw new Error("META_MEDIA_URL_FAILED");
  }

  return {
    url: String(data.url),
    mimeType: typeof data.mime_type === "string" ? data.mime_type : null
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const message = await prisma.message.findFirst({
      where: {
        id: context.params.id,
        conversation: { contact: { companyId: session.companyId } }
      },
      include: {
        conversation: {
          include: {
            contact: true
          }
        }
      }
    });

    if (!message) {
      return NextResponse.json({ error: "Mensagem nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: message.conversation.agentId })) {
      return NextResponse.json(
        { error: "Conversa atribuida a outro atendente." },
        { status: 403 }
      );
    }

    if (!message.mediaId) {
      return NextResponse.json({ error: "Mensagem sem midia vinculada." }, { status: 404 });
    }

    const channelId = resolveConversationChannelId(message.conversation);

    const channel = channelId
      ? await prisma.channel.findFirst({
          where: {
            id: channelId,
            companyId: session.companyId,
            type: "whatsapp",
            provider: "meta"
          }
        })
      : await prisma.channel.findMany({
          where: {
            companyId: session.companyId,
            type: "whatsapp",
            provider: "meta",
            status: { in: ["ACTIVE", "CONNECTED"] }
          },
          take: 2
        });

    if (!channelId && Array.isArray(channel) && channel.length > 1) {
      return NextResponse.json(
        { error: "A conversa nao possui canal WhatsApp definido." },
        { status: 409 }
      );
    }

    const resolvedChannel = Array.isArray(channel) ? channel[0] : channel;

    const accessToken = resolveChannelAccessToken(resolvedChannel?.accessToken, {
      channelId: resolvedChannel?.id
    });

    if (!accessToken) {
      return NextResponse.json(
        { error: "Canal WhatsApp sem token para recuperar midia." },
        { status: 400 }
      );
    }

    const media = await getMetaMediaUrl({
      mediaId: message.mediaId,
      accessToken
    });

    const mediaResponse = await fetch(media.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    });

    if (!mediaResponse.ok || !mediaResponse.body) {
      return NextResponse.json(
        { error: "Nao foi possivel baixar a midia da Meta." },
        { status: 502 }
      );
    }

    const fileName = (message.fileName ?? `${message.id}.bin`).replace(/["\r\n]/g, "");
    const disposition = request.nextUrl.searchParams.get("download") === "1"
      ? "attachment"
      : "inline";

    return new Response(mediaResponse.body, {
      headers: {
        "Content-Type": message.mimeType ?? media.mimeType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `${disposition}; filename="${fileName}"`
      }
    });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "message-media-fetch",
      route: "/api/messages/[id]/media",
      publicErrorCode: "MEDIA_FETCH_FAILED",
      status: 500,
      messageId: context.params.id
    });

    return publicErrorResponse({
      code: "MEDIA_FETCH_FAILED",
      status: 500
    });
  }
}
