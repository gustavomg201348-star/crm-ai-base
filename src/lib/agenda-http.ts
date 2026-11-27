import { NextResponse, type NextRequest } from "next/server";
import { AgendaError } from "./agenda.service";

export function agendaFailure(error: unknown) {
  return NextResponse.json({ error: error instanceof AgendaError ? error.code : "UNAVAILABLE" },
    { status: error instanceof AgendaError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
export async function agendaBody(request: NextRequest) {
  const origin = request.headers.get("origin");
  let sameOrigin = true;
  if (origin) {
    try {
      const source = new URL(origin);
      // Next may normalize the internal URL to localhost behind a reverse proxy.
      // Compare the browser origin with the actual request Host; never trust forwarded headers.
      sameOrigin = source.origin === origin && ["http:", "https:"].includes(source.protocol)
        && source.host === (request.headers.get("host") ?? request.nextUrl.host);
    } catch { sameOrigin = false; }
  }
  if (request.headers.get("sec-fetch-site") === "cross-site" || !sameOrigin) throw new AgendaError("FORBIDDEN", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AgendaError("INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new AgendaError("INVALID_REQUEST");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { void reader.cancel().catch(() => {}); throw new AgendaError("INVALID_REQUEST"); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { throw new AgendaError("INVALID_REQUEST"); }
  finally { reader.releaseLock(); }
}
