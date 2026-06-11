import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "Nao foi possivel obter a midia na Meta."
    );
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

    if (!message.mediaId) {
      return NextResponse.json({ error: "Mensagem sem midia vinculada." }, { status: 404 });
    }

    const channelId = message.conversation.channel.startsWith("whatsapp:")
      ? message.conversation.channel.replace("whatsapp:", "")
      : null;

    const channel = channelId
      ? await prisma.channel.findFirst({
          where: { id: channelId, companyId: session.companyId, type: "whatsapp" }
        })
      : await prisma.channel.findFirst({
          where: {
            companyId: session.companyId,
            type: "whatsapp",
            provider: "meta",
            status: { in: ["ACTIVE", "CONNECTED"] }
          },
          orderBy: { updatedAt: "desc" }
        });

    if (!channel?.accessToken) {
      return NextResponse.json(
        { error: "Canal WhatsApp sem token para recuperar midia." },
        { status: 400 }
      );
    }

    const media = await getMetaMediaUrl({
      mediaId: message.mediaId,
      accessToken: channel.accessToken
    });

    const mediaResponse = await fetch(media.url, {
      headers: {
        Authorization: `Bearer ${channel.accessToken}`
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
    const message =
      error instanceof Error ? error.message : "Nao foi possivel carregar a midia.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
