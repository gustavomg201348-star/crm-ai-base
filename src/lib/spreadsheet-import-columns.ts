export const SPREADSHEET_IMPORT_MAX_COLUMNS = 80;
export const SPREADSHEET_IMPORT_MAX_HEADER_LENGTH = 120;
export const SPREADSHEET_IMPORT_MAX_CELL_LENGTH = 1000;

export type SpreadsheetImportColumn = {
  key: string;
  label: string;
  normalized: string;
  index: number;
};

export type SpreadsheetImportRawValues = Record<string, string>;

export class SpreadsheetImportColumnError extends Error {
  code: "TOO_MANY_COLUMNS";

  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetImportColumnError";
    this.code = "TOO_MANY_COLUMNS";
  }
}

export function normalizeSpreadsheetColumnLabel(value: string) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeColumnKeyPart(value: string) {
  const normalized = normalizeSpreadsheetColumnLabel(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || "coluna";
}

export function sanitizeSpreadsheetCellText(
  value: unknown,
  maxLength = SPREADSHEET_IMPORT_MAX_CELL_LENGTH
) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function buildSpreadsheetImportColumns(
  headers: unknown[]
): SpreadsheetImportColumn[] {
  if (headers.length > SPREADSHEET_IMPORT_MAX_COLUMNS) {
    throw new SpreadsheetImportColumnError(
      `A planilha possui mais de ${SPREADSHEET_IMPORT_MAX_COLUMNS} colunas.`
    );
  }

  return headers.map((header, index) => {
    const label = sanitizeSpreadsheetCellText(
      header,
      SPREADSHEET_IMPORT_MAX_HEADER_LENGTH
    );
    const normalized = normalizeSpreadsheetColumnLabel(label);

    return {
      key: `col_${index}_${normalizeColumnKeyPart(label)}`,
      label,
      normalized,
      index
    };
  });
}

export function buildSpreadsheetRawValues(
  row: unknown[],
  columns: SpreadsheetImportColumn[]
): SpreadsheetImportRawValues {
  return columns.reduce<SpreadsheetImportRawValues>((values, column) => {
    values[column.key] = sanitizeSpreadsheetCellText(row[column.index]);
    return values;
  }, {});
}
