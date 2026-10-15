import "server-only";
import type { NextRequest } from "next/server";

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (!origin || (site && site !== "same-origin")) return false;
  // Next's URL hostname may be the internal listener behind a reverse proxy.
  // Use the actual Host, never X-Forwarded-Host, with Next's request protocol.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  if (/[\s,\\/@?#]/.test(host) || !["http:", "https:"].includes(request.nextUrl.protocol)) return false;
  try { return origin === new URL(`${request.nextUrl.protocol}//${host}`).origin; }
  catch { return false; }
}

export async function emptyBody(request: NextRequest) {
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const deadline = new Promise<boolean>(resolve => {
    timer = setTimeout(() => { cancel(); resolve(false); }, 1000);
  });
  const read = async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return true;
        if (value.byteLength) { cancel(); return false; }
      }
    } catch { return false; }
  };
  try { return await Promise.race([read(), deadline]); }
  finally {
    if (timer) clearTimeout(timer);
    try { reader.releaseLock(); } catch { /* A cancelled read may still settle. */ }
  }
}
