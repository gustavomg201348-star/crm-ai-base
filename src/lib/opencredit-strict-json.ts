import "server-only";

export type OpenCreditJsonValue = null | boolean | number | string | OpenCreditJsonValue[] | { [key: string]: OpenCreditJsonValue };
const CODES = ["INVALID_INPUT", "TOO_LARGE", "TOO_DEEP", "TOO_MANY_NODES", "TOO_MANY_OBJECT_KEYS",
  "TOO_MANY_ARRAY_ITEMS", "STRING_TOO_LARGE", "UNEXPECTED_TOKEN", "UNEXPECTED_END", "INVALID_STRING",
  "INVALID_ESCAPE", "INVALID_UNICODE", "INVALID_NUMBER", "DUPLICATE_KEY", "TRAILING_DATA"] as const;
type Code = typeof CODES[number];
export class OpenCreditStrictJsonError extends Error {
  constructor(readonly code: Code) {
    super("OPENCREDIT_STRICT_JSON_" + code);
    this.name = "OpenCreditStrictJsonError";
    // Fixed diagnostic only: no parser/caller stack, offsets, input or original cause.
    this.stack = this.name + ": " + this.message;
  }
}

// LOCAL QEVORA limits, not provider guarantees. Keys count per object, items per array;
// nodes count every JSON value (including containers), not object-key strings.
const MAX_RAW_CODE_UNITS = 1_000_000;
const MAX_DEPTH = 64; // Container nesting; scalar root has depth zero.
const MAX_OBJECT_KEYS = 10_000;
const MAX_ARRAY_ITEMS = 100_000;
const MAX_TOTAL_NODES = 200_000;
const MAX_STRING_CODE_UNITS = 262_144; // Decoded keys and values, measured in UTF-16.
const fail = (code: Code): never => { throw new OpenCreditStrictJsonError(code); };

/** Pure JS-string primitive. Bytes/UTF-8 validation belongs to the future boundary. */
export function parseOpenCreditStrictJson(raw: string): OpenCreditJsonValue {
  if (typeof raw !== "string") return fail("INVALID_INPUT");
  if (raw.length > MAX_RAW_CODE_UNITS) return fail("TOO_LARGE");
  let at = 0; let nodes = 0;
  const digit = (c: number) => c >= 48 && c <= 57;
  function whitespace() {
    while (at < raw.length && [32, 9, 13, 10].includes(raw.charCodeAt(at))) at++;
  }
  function string(): string {
    at++; let result = ""; let pendingHigh = false;
    function append(code: number) {
      const low = code >= 0xdc00 && code <= 0xdfff;
      if (pendingHigh ? !low : low) return fail("INVALID_UNICODE");
      pendingHigh = code >= 0xd800 && code <= 0xdbff;
      if (result.length >= MAX_STRING_CODE_UNITS) return fail("STRING_TOO_LARGE");
      result += String.fromCharCode(code);
    }
    while (at < raw.length) {
      let code = raw.charCodeAt(at++);
      if (code === 34) { if (pendingHigh) return fail("INVALID_UNICODE"); return result; }
      if (code < 32) return fail("INVALID_STRING");
      if (code === 92) {
        if (at === raw.length) return fail("UNEXPECTED_END");
        const escaped = raw.charCodeAt(at++);
        if (escaped === 117) {
          if (raw.length - at < 4) return fail("INVALID_ESCAPE");
          code = 0;
          for (let n = 0; n < 4; n++) {
            const hex = raw.charCodeAt(at++);
            const value = digit(hex) ? hex - 48 : hex >= 65 && hex <= 70 ? hex - 55 : hex >= 97 && hex <= 102 ? hex - 87 : -1;
            if (value < 0) return fail("INVALID_ESCAPE");
            code = code * 16 + value;
          }
        } else {
          const escapes: Record<number, number> = { 34: 34, 92: 92, 47: 47, 98: 8, 102: 12, 110: 10, 114: 13, 116: 9 };
          if (!Object.hasOwn(escapes, escaped)) return fail("INVALID_ESCAPE");
          code = escapes[escaped];
        }
      }
      append(code);
    }
    return fail("UNEXPECTED_END");
  }
  function number(): number {
    const start = at;
    if (raw[at] === "-") at++;
    if (raw[at] === "0") at++;
    else {
      if (!(raw.charCodeAt(at) >= 49 && raw.charCodeAt(at) <= 57)) return fail("INVALID_NUMBER");
      while (digit(raw.charCodeAt(at))) at++;
    }
    if (digit(raw.charCodeAt(at))) return fail("INVALID_NUMBER");
    let approximate = false;
    if (raw[at] === ".") {
      approximate = true; at++;
      if (!digit(raw.charCodeAt(at))) return fail("INVALID_NUMBER");
      while (digit(raw.charCodeAt(at))) at++;
    }
    const mantissaEnd = at;
    if (raw[at] === "e" || raw[at] === "E") {
      approximate = true; at++;
      if (raw[at] === "+" || raw[at] === "-") at++;
      if (!digit(raw.charCodeAt(at))) return fail("INVALID_NUMBER");
      while (digit(raw.charCodeAt(at))) at++;
    }
    const token = raw.slice(start, at); const value = Number(token);
    const significant = raw.slice(start, mantissaEnd).replace(/[-.]/g, "").replace(/^0+|0+$/g, "");
    // Integer results must be safe. Fraction/exponent forms permit at most 15
    // significant decimal digits; ordinary binary64 rounding remains intentional.
    // Reject overflow and nonzero underflow, never claim arbitrary precision.
    if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)
      || value === 0 && significant.length > 0 || approximate && significant.length > 15) return fail("INVALID_NUMBER");
    return value;
  }
  function value(depth: number): OpenCreditJsonValue {
    whitespace(); if (at === raw.length) return fail("UNEXPECTED_END");
    if (++nodes > MAX_TOTAL_NODES) return fail("TOO_MANY_NODES");
    const token = raw[at];
    if (token === "\"") return string();
    if (token === "-" || digit(raw.charCodeAt(at))) return number();
    for (const [literal, result] of [["true", true], ["false", false], ["null", null]] as const) {
      if (token !== literal[0]) continue;
      if (raw.slice(at, at + literal.length) !== literal) return fail(at + literal.length > raw.length ? "UNEXPECTED_END" : "UNEXPECTED_TOKEN");
      at += literal.length; return result;
    }
    if (token !== "{" && token !== "[") return fail("UNEXPECTED_TOKEN");
    if (depth >= MAX_DEPTH) return fail("TOO_DEEP");
    at++; whitespace();
    if (token === "[") {
      const array: OpenCreditJsonValue[] = [];
      if (raw[at] === "]") { at++; return array; }
      for (;;) {
        if (array.length >= MAX_ARRAY_ITEMS) return fail("TOO_MANY_ARRAY_ITEMS");
        array.push(value(depth + 1)); whitespace();
        if (at === raw.length) return fail("UNEXPECTED_END");
        if (raw[at] === "]") { at++; return array; }
        if (raw[at++] !== ",") return fail("UNEXPECTED_TOKEN");
        whitespace(); if (raw[at] === "]") return fail("UNEXPECTED_TOKEN");
      }
    }
    const object: { [key: string]: OpenCreditJsonValue } = Object.create(null);
    const keys = new Set<string>();
    if (raw[at] === "}") { at++; return object; }
    for (;;) {
      if (at === raw.length) return fail("UNEXPECTED_END");
      if (raw[at] !== "\"") return fail("UNEXPECTED_TOKEN");
      if (keys.size >= MAX_OBJECT_KEYS) return fail("TOO_MANY_OBJECT_KEYS");
      const key = string();
      if (keys.has(key)) return fail("DUPLICATE_KEY");
      keys.add(key); whitespace();
      if (at === raw.length) return fail("UNEXPECTED_END");
      if (raw[at++] !== ":") return fail("UNEXPECTED_TOKEN");
      object[key] = value(depth + 1); whitespace();
      if (at === raw.length) return fail("UNEXPECTED_END");
      if (raw[at] === "}") { at++; return object; }
      if (raw[at++] !== ",") return fail("UNEXPECTED_TOKEN");
      whitespace(); if (raw[at] === "}") return fail("UNEXPECTED_TOKEN");
    }
  }
  const result = value(0); whitespace();
  if (at !== raw.length) return fail("TRAILING_DATA");
  return result;
}
