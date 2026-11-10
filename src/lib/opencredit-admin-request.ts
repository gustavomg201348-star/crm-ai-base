import "server-only";
import type { NextRequest } from "next/server";
import { parseOpenCreditStrictJson } from "./opencredit-strict-json";

export async function readOpenCreditAdminJson(request: NextRequest) {
  const reader = request.body?.getReader(); if (!reader) throw Error("INVALID_BODY");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; cancel(); reject(Error("INVALID_BODY")); }, 1000); });
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), timeout]); if (expired) throw Error("INVALID_BODY"); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 1024) { cancel(); throw Error("INVALID_BODY"); }
      chunks.push(part.value);
    }
    return parseOpenCreditStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  } finally { if (timer) clearTimeout(timer); try { reader.releaseLock(); } catch {} }
}

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
