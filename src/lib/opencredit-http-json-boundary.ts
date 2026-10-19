import "server-only";
import { parseOpenCreditStrictJson, type OpenCreditJsonValue } from "./opencredit-strict-json";

const CODES = ["INVALID_RESPONSE", "INVALID_CONTENT_TYPE", "TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "TIMEOUT", "STREAM_ERROR"] as const;
type Code = typeof CODES[number];

export class OpenCreditHttpJsonBoundaryError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    const safe = CODES.includes(code) ? code : "INVALID_RESPONSE";
    super("OPENCREDIT_HTTP_JSON_" + safe);
    this.code = safe;
    this.name = "OpenCreditHttpJsonBoundaryError";
    this.stack = this.name + ": " + this.message;
  }
}

// LOCAL QEVORA LIMIT — NOT PROVIDER CONTRACT. Matches the banks reader's byte
// ceiling (status catalog is 32 KiB); both existing readers use a 20-second deadline.
const MAX_BYTES = 64 * 1024;
const DEADLINE_MS = 20_000;
// Only SP/HTAB OWS, a single optional UTF-8 charset, and no other parameters.
const JSON_TYPE = /^[\t ]*application\/json[\t ]*(?:;[\t ]*charset[\t ]*=[\t ]*(?:utf-8|"utf-8")[\t ]*)?(?![\s\S])/i;

/** Consumes one already-obtained Response. No request, status classification or ledger effect. */
export async function readOpenCreditStrictJsonResponse(response: Response): Promise<OpenCreditJsonValue> {
  const started = performance.now();
  let body: ReadableStream<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let failure: Code | undefined;
  const fail: (code: Code) => never = code => { failure = code; throw new OpenCreditHttpJsonBoundaryError(code); };
  const checkDeadline = () => { if (timedOut || performance.now() - started >= DEADLINE_MS) fail("TIMEOUT"); };
  const cancel = () => {
    // Never await an untrusted source's cancel promise: it may never settle.
    try { void (reader ? reader.cancel() : body && !body.locked ? body.cancel() : undefined)?.catch(() => {}); }
    catch { /* Cancellation must not replace the fixed boundary error. */ }
  };
  try {
    if (typeof window !== "undefined" || !(response instanceof Response)) fail("INVALID_RESPONSE");
    body = response.body;
    if (!body || response.bodyUsed || body.locked) fail("INVALID_RESPONSE");
    if (!JSON_TYPE.test(response.headers.get("content-type") ?? "")) fail("INVALID_CONTENT_TYPE");
    const length = response.headers.get("content-length");
    if (length !== null && /^[0-9]+(?![\s\S])/.test(length) && Number(length) > MAX_BYTES) fail("TOO_LARGE");
    reader = body.getReader();
    // ignoreBOM:true PRESERVES U+FEFF for the strict parser to reject, rather
    // than silently stripping the signature (the TextDecoder default).
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; cancel(); reject(new OpenCreditHttpJsonBoundaryError("TIMEOUT")); }, DEADLINE_MS);
    });
    const read = async (): Promise<OpenCreditJsonValue> => {
      let bytes = 0, raw = "";
      for (;;) {
        checkDeadline();
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader!.read(); }
        catch { return fail(timedOut ? "TIMEOUT" : "STREAM_ERROR"); }
        checkDeadline();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) fail("STREAM_ERROR");
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) fail("TOO_LARGE");
        try { raw += decoder.decode(chunk.value, { stream: true }); }
        catch { return fail("INVALID_UTF8"); }
      }
      try { raw += decoder.decode(); }
      catch { return fail("INVALID_UTF8"); }
      checkDeadline();
      let parsed: OpenCreditJsonValue;
      try { parsed = parseOpenCreditStrictJson(raw); }
      catch { return fail("INVALID_JSON"); }
      checkDeadline();
      return parsed;
    };
    // One race per body, not one retained deadline reaction per chunk.
    try { return await Promise.race([read(), deadline]); }
    catch { return fail(timedOut ? "TIMEOUT" : (failure ?? "STREAM_ERROR")); }
  } catch {
    cancel();
    // Do not inspect or expose arbitrary stream/Response exceptions or causes.
    throw new OpenCreditHttpJsonBoundaryError(failure ?? "INVALID_RESPONSE");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try { reader?.releaseLock(); } catch { /* No caller-owned lock is released. */ }
  }
}
