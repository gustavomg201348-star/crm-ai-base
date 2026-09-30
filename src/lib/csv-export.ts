export type CsvCellKind = "untrusted-text" | "trusted-number" | "trusted-value";
export type CsvDelimiter = "," | ";";

export type SerializeCsvCellOptions = {
  kind?: CsvCellKind;
  delimiter?: CsvDelimiter;
};

const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

function isWhitespaceOrControl(character: string) {
  const code = character.charCodeAt(0);
  return /\s/.test(character) || code <= 0x1f || code === 0x7f;
}

/**
 * CSV quoting is not formula protection. Untrusted text is neutralized first;
 * trusted-number must only receive a number already validated by the caller.
 * trusted-value is reserved for static, system-controlled values such as fixed headers.
 */
export function neutralizeSpreadsheetFormula(value: string) {
  if (!value || value.startsWith("'")) return value;

  let index = 0;
  let hasDangerousLeadingControl = false;

  while (index < value.length && isWhitespaceOrControl(value[index])) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      hasDangerousLeadingControl = true;
    }
    index += 1;
  }

  const firstSignificantCharacter = value[index] ?? "";
  if (hasDangerousLeadingControl || FORMULA_PREFIXES.has(firstSignificantCharacter)) {
    return `'${value}`;
  }

  return value;
}

export function quoteCsvCell(value: string, delimiter: CsvDelimiter = ",") {
  if (delimiter !== "," && delimiter !== ";") {
    throw new TypeError("Unsupported CSV delimiter.");
  }

  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeCsvCell(value: unknown, options: SerializeCsvCellOptions = {}) {
  const kind = options.kind ?? "untrusted-text";
  const delimiter = options.delimiter ?? ",";

  if (kind === "trusted-number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("trusted-number requires a finite number.");
    }
    return quoteCsvCell(String(value), delimiter);
  }

  const text = value === null || value === undefined ? "" : String(value);
  const safeText = kind === "untrusted-text" ? neutralizeSpreadsheetFormula(text) : text;
  return quoteCsvCell(safeText, delimiter);
}
