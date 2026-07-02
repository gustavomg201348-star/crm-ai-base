import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

function mapAvailableChannel(channel: {
  id: string;
  name: string;
  type: string;
  provider: string;
  displayPhone: string | null;
  status: string;
}) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    provider: channel.provider,
    displayPhone: channel.displayPhone,
    status: channel.status
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const channels = await prisma.channel.findMany({
      where: {
        companyId: session.companyId,
        type: "whatsapp",
        provider: "meta",
        status: { in: ["ACTIVE", "CONNECTED"] }
      },
      select: {
        id: true,
        name: true,
        type: true,
        provider: true,
        displayPhone: true,
        status: true
      },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({ channels: channels.map(mapAvailableChannel) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar canais disponiveis." },
      { status: 500 }
    );
  }
}
