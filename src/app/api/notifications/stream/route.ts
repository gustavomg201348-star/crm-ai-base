import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { registerNotificationClient } from "@/lib/notification-stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function encodeSse(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, payload)));
      };

      cleanup = registerNotificationClient({ session, send });
      send("connected", { ok: true, timestamp: new Date().toISOString() });

      keepAlive = setInterval(() => {
        send("heartbeat", { timestamp: new Date().toISOString() });
      }, 25000);
    },
    cancel() {
      cleanup?.();
      if (keepAlive) clearInterval(keepAlive);
    }
  });

  request.signal.addEventListener("abort", () => {
    cleanup?.();
    if (keepAlive) clearInterval(keepAlive);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
