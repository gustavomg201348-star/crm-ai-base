import type * as Xlsx from "xlsx";
import { inflateRawSync } from "node:zlib";
import { SPREADSHEET_IMPORT_MAX_COLUMNS } from "@/lib/spreadsheet-import-columns";

export const CONTACT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const CONTACT_IMPORT_MAX_REQUEST_BYTES = 6 * 1024 * 1024;
export const CONTACT_IMPORT_MAX_DATA_ROWS = 5_000;
export const CONTACT_IMPORT_MAX_WORKSHEETS = 4;
export const CONTACT_IMPORT_MAX_CELLS = 200_000;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GENERIC_BINARY_MIME = "application/octet-stream";
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x8;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const MAX_ZIP_ENTRIES = 256;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export type ContactImportUploadErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "INVALID_XLSX"
  | "WORKBOOK_LIMIT_EXCEEDED";

export class ContactImportUploadError extends Error {
  readonly code: ContactImportUploadErrorCode;
  readonly status: 400 | 413;
  readonly reason: string;

  constructor({
    code,
    status,
    reason,
    message
  }: {
    code: ContactImportUploadErrorCode;
    status: 400 | 413;
    reason: string;
    message: string;
  }) {
    super(message);
    this.name = "ContactImportUploadError";
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

type XlsxModule = Pick<typeof Xlsx, "read" | "utils">;

type ParseSpreadsheetOptions = {
  loadXlsx?: () => Promise<XlsxModule>;
  ooxmlLimits?: Partial<XlsxOoxmlValidationLimits>;
};

type XlsxOoxmlValidationLimits = {
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxWorksheets: number;
};

const DEFAULT_OOXML_LIMITS: XlsxOoxmlValidationLimits = {
  maxEntryUncompressedBytes: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalUncompressedBytes: MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  maxWorksheets: CONTACT_IMPORT_MAX_WORKSHEETS
};

function failInvalidXlsx(reason: string): never {
  throw new ContactImportUploadError({
    code: "INVALID_XLSX",
    status: 400,
    reason,
    message: "O arquivo .xlsx e invalido ou esta corrompido."
  });
}

function failWorkbookLimit(reason: string, message: string): never {
  throw new ContactImportUploadError({
    code: "WORKBOOK_LIMIT_EXCEEDED",
    status: 413,
    reason,
    message
  });
}

function getExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if ((char === "," || char === ";") && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string) {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimumOffset = Math.max(0, bytes.length - (MAX_ZIP_COMMENT_BYTES + 22));
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function normalizeZipEntryName(rawName: Buffer) {
  const slashNormalized = rawName.toString("utf8").replace(/\\/g, "/");
  if (
    slashNormalized.includes("\0") ||
    slashNormalized.startsWith("/") ||
    /^[a-z]:($|\/)/i.test(slashNormalized)
  ) {
    failInvalidXlsx("unsafe_zip_entry_name");
  }

  const segments = slashNormalized.split("/");
  if (segments.includes("..")) failInvalidXlsx("unsafe_zip_entry_name");

  const normalized = segments
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/")
    .toLowerCase();
  if (!normalized) failInvalidXlsx("unsafe_zip_entry_name");
  return normalized;
}

function containsZip64ExtraField(bytes: Buffer, start: number, length: number) {
  const end = start + length;
  let offset = start;

  while (offset < end) {
    if (offset + 4 > end) failInvalidXlsx("invalid_zip_extra_field");
    const headerId = bytes.readUInt16LE(offset);
    const dataSize = bytes.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + dataSize > end) failInvalidXlsx("invalid_zip_extra_field");
    if (headerId === ZIP64_EXTRA_FIELD_ID) return true;
    offset += dataSize;
  }

  return false;
}

function resolveOoxmlLimits(overrides: Partial<XlsxOoxmlValidationLimits> = {}) {
  const limits = { ...DEFAULT_OOXML_LIMITS, ...overrides };
  if (
    !Number.isSafeInteger(limits.maxEntryUncompressedBytes) ||
    limits.maxEntryUncompressedBytes <= 0 ||
    !Number.isSafeInteger(limits.maxTotalUncompressedBytes) ||
    limits.maxTotalUncompressedBytes <= 0 ||
    !Number.isSafeInteger(limits.maxWorksheets) ||
    limits.maxWorksheets <= 0
  ) {
    throw new Error("Invalid OOXML validation limits.");
  }
  return limits;
}

export function validateXlsxOoxmlPackage(
  bytes: Buffer,
  limitOverrides: Partial<XlsxOoxmlValidationLimits> = {}
) {
  const limits = resolveOoxmlLimits(limitOverrides);
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== ZIP_LOCAL_FILE_SIGNATURE) {
    failInvalidXlsx("missing_zip_signature");
  }

  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) failInvalidXlsx("missing_zip_directory");

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const zipCommentLength = bytes.readUInt16LE(eocdOffset + 20);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0 ||
    totalEntries > MAX_ZIP_ENTRIES ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset ||
    eocdOffset + 22 + zipCommentLength !== bytes.length
  ) {
    failInvalidXlsx("unsupported_zip_structure");
  }

  const entries = new Set<string>();
  let offset = centralDirectoryOffset;
  const directoryEnd = centralDirectoryOffset + centralDirectorySize;
  let totalActualUncompressedBytes = 0;
  let worksheetEntryCount = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      failInvalidXlsx("invalid_zip_directory_entry");
    }

    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;

    if (
      (flags & 0x1) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > limits.maxEntryUncompressedBytes ||
      fileNameLength === 0 ||
      nextOffset > directoryEnd ||
      localHeaderOffset + 30 > centralDirectoryOffset ||
      bytes.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      failInvalidXlsx("encrypted_or_invalid_zip_entry");
    }

    const centralNameStart = offset + 46;
    const centralExtraStart = centralNameStart + fileNameLength;
    const name = normalizeZipEntryName(
      bytes.subarray(centralNameStart, centralNameStart + fileNameLength)
    );
    if (entries.has(name)) failInvalidXlsx("duplicate_zip_entry");
    if (containsZip64ExtraField(bytes, centralExtraStart, extraLength)) {
      failInvalidXlsx("unsupported_zip64_extra_field");
    }

    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = bytes.readUInt16LE(localHeaderOffset + 8);
    const localCompressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localHeaderOffset + 22);
    const localFileNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const localExtraStart = localNameStart + localFileNameLength;
    const localDataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    if (localDataOffset > centralDirectoryOffset) {
      failInvalidXlsx("invalid_zip_local_entry");
    }
    const localName = normalizeZipEntryName(
      bytes.subarray(localNameStart, localNameStart + localFileNameLength)
    );
    const usesDataDescriptor = (flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0;
    if (
      localName !== name ||
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod ||
      (!usesDataDescriptor &&
        (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) ||
      (usesDataDescriptor &&
        ((localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
          (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize))) ||
      containsZip64ExtraField(bytes, localExtraStart, localExtraLength) ||
      localDataOffset + compressedSize > centralDirectoryOffset
    ) {
      failInvalidXlsx("invalid_zip_local_entry");
    }

    const compressedPayload = bytes.subarray(localDataOffset, localDataOffset + compressedSize);
    if (compressedPayload.byteLength !== compressedSize) {
      failInvalidXlsx("truncated_zip_entry");
    }

    const remainingTotalBytes = limits.maxTotalUncompressedBytes - totalActualUncompressedBytes;
    const entryOutputLimit = Math.min(limits.maxEntryUncompressedBytes, remainingTotalBytes);
    let actualUncompressedLength: number;
    if (compressionMethod === 0) {
      if (compressedSize !== uncompressedSize) {
        failInvalidXlsx("stored_zip_size_mismatch");
      }
      actualUncompressedLength = compressedPayload.byteLength;
    } else {
      let inflated: { buffer: Buffer; engine: { bytesWritten: number } };
      try {
        inflated = inflateRawSync(compressedPayload, {
          info: true,
          maxOutputLength: Math.max(1, entryOutputLimit)
        }) as unknown as typeof inflated;
      } catch {
        failInvalidXlsx("zip_inflate_failed_or_output_limit_exceeded");
      }
      if (inflated.engine.bytesWritten !== compressedPayload.byteLength) {
        failInvalidXlsx("zip_compressed_size_mismatch");
      }
      actualUncompressedLength = inflated.buffer.byteLength;
    }

    if (actualUncompressedLength !== uncompressedSize) {
      failInvalidXlsx("zip_uncompressed_size_mismatch");
    }
    if (actualUncompressedLength > entryOutputLimit) {
      failInvalidXlsx("ooxml_uncompressed_size_exceeded");
    }
    totalActualUncompressedBytes += actualUncompressedLength;

    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      worksheetEntryCount += 1;
      if (worksheetEntryCount > limits.maxWorksheets) {
        failWorkbookLimit(
          "too_many_worksheets",
          `A planilha excede o limite de ${limits.maxWorksheets} abas.`
        );
      }
    }

    entries.add(name);
    offset = nextOffset;
  }

  if (offset !== directoryEnd) failInvalidXlsx("invalid_zip_directory_size");

  const requiredEntries = [
    "[content_types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels"
  ];
  const hasWorksheet = Array.from(entries).some((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
  );
  const hasUnsupportedActiveContent = Array.from(entries).some(
    (name) => name === "xl/vbaproject.bin" || name === "xl/workbook.bin"
  );

  if (
    requiredEntries.some((name) => !entries.has(name)) ||
    !hasWorksheet ||
    hasUnsupportedActiveContent
  ) {
    failInvalidXlsx("missing_or_unsupported_ooxml_components");
  }
}

function validateDeclaredXlsxType(file: File) {
  const declaredType = file.type.trim().toLowerCase();
  if (declaredType && declaredType !== XLSX_MIME && declaredType !== GENERIC_BINARY_MIME) {
    throw new ContactImportUploadError({
      code: "UNSUPPORTED_FILE",
      status: 400,
      reason: "xlsx_mime_mismatch",
      message: "O tipo declarado do arquivo .xlsx nao e suportado."
    });
  }
}

function validateWorksheetDimensions(XLSX: XlsxModule, sheet: Xlsx.WorkSheet) {
  const reference = (sheet as Xlsx.WorkSheet & { "!fullref"?: string })["!fullref"] ?? sheet["!ref"];
  if (!reference) return;

  let range: Xlsx.Range;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch {
    failInvalidXlsx("invalid_worksheet_range");
  }

  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  const cellCount = rowCount * columnCount;

  if (rowCount > CONTACT_IMPORT_MAX_DATA_ROWS + 1) {
    failWorkbookLimit(
      "too_many_rows",
      `A planilha excede o limite de ${CONTACT_IMPORT_MAX_DATA_ROWS} linhas de dados.`
    );
  }
  if (columnCount > SPREADSHEET_IMPORT_MAX_COLUMNS) {
    failWorkbookLimit(
      "too_many_columns",
      `A planilha excede o limite de ${SPREADSHEET_IMPORT_MAX_COLUMNS} colunas.`
    );
  }
  if (cellCount > CONTACT_IMPORT_MAX_CELLS) {
    failWorkbookLimit(
      "too_many_cells",
      `A planilha excede o limite de ${CONTACT_IMPORT_MAX_CELLS} celulas processaveis.`
    );
  }
}

export async function parseContactImportSpreadsheet(
  file: File,
  options: ParseSpreadsheetOptions = {}
): Promise<string[][]> {
  const extension = getExtension(file.name);
  const isCsv = extension === ".csv" || file.type.toLowerCase().includes("csv");

  if (extension !== ".xlsx" && !isCsv) {
    throw new ContactImportUploadError({
      code: "UNSUPPORTED_FILE",
      status: 400,
      reason: "unsupported_extension",
      message: "Arquivo deve ser CSV ou Excel .xlsx."
    });
  }

  if (extension === ".xlsx") validateDeclaredXlsxType(file);

  if (file.size > CONTACT_IMPORT_MAX_FILE_BYTES) {
    throw new ContactImportUploadError({
      code: "FILE_TOO_LARGE",
      status: 413,
      reason: "file_too_large",
      message: "O arquivo excede o tamanho máximo permitido."
    });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > CONTACT_IMPORT_MAX_FILE_BYTES) {
    throw new ContactImportUploadError({
      code: "FILE_TOO_LARGE",
      status: 413,
      reason: "file_buffer_too_large",
      message: "O arquivo excede o tamanho máximo permitido."
    });
  }

  if (extension !== ".xlsx") return parseCsv(bytes.toString("utf8"));

  validateXlsxOoxmlPackage(bytes, options.ooxmlLimits);

  const loadXlsx = options.loadXlsx ?? (() => import("xlsx"));
  const XLSX = await loadXlsx();
  let workbook: Xlsx.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "buffer",
      cellFormula: false,
      cellHTML: false,
      bookVBA: false,
      dense: true,
      sheetRows: CONTACT_IMPORT_MAX_DATA_ROWS + 2
    });
  } catch {
    failInvalidXlsx("xlsx_parser_rejected_file");
  }

  if (workbook.SheetNames.length === 0) failInvalidXlsx("workbook_without_worksheet");
  if (workbook.SheetNames.length > CONTACT_IMPORT_MAX_WORKSHEETS) {
    failWorkbookLimit(
      "too_many_worksheets",
      `A planilha excede o limite de ${CONTACT_IMPORT_MAX_WORKSHEETS} abas.`
    );
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) failInvalidXlsx("missing_first_worksheet");
  validateWorksheetDimensions(XLSX, sheet);

  const table = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  if (table.length > CONTACT_IMPORT_MAX_DATA_ROWS + 1) {
    failWorkbookLimit(
      "too_many_rows",
      `A planilha excede o limite de ${CONTACT_IMPORT_MAX_DATA_ROWS} linhas de dados.`
    );
  }

  return table;
}
