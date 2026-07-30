import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

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
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
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
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/channels/available",
      method: "GET",
      publicErrorCode: "CHANNELS_LIST_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "CHANNELS_LIST_FAILED", status: 500 });
  }
}
