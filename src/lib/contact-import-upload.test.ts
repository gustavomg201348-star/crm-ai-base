import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import {
  CONTACT_IMPORT_MAX_CELLS,
  CONTACT_IMPORT_MAX_DATA_ROWS,
  CONTACT_IMPORT_MAX_FILE_BYTES,
  CONTACT_IMPORT_MAX_WORKSHEETS,
  ContactImportUploadError,
  parseContactImportSpreadsheet,
  validateXlsxOoxmlPackage
} from "./contact-import-upload";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ZipFixtureEntry = {
  name: string;
  data?: Buffer;
  method?: 0 | 8;
  localName?: string;
  localMethod?: 0 | 8;
  centralFlags?: number;
  localFlags?: number;
  centralCompressedSize?: number;
  centralUncompressedSize?: number;
  localCompressedSize?: number;
  localUncompressedSize?: number;
  centralExtra?: Buffer;
  localExtra?: Buffer;
  includeDataDescriptor?: boolean;
};

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipFixture(entries: ZipFixtureEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const data = entry.data ?? Buffer.from("<xml/>");
    const method = entry.method ?? 0;
    const localMethod = entry.localMethod ?? method;
    const centralFlags = entry.centralFlags ?? 0;
    const localFlags = entry.localFlags ?? centralFlags;
    const name = Buffer.from(entry.name);
    const localName = Buffer.from(entry.localName ?? entry.name);
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const centralCompressedSize = entry.centralCompressedSize ?? compressed.byteLength;
    const centralUncompressedSize = entry.centralUncompressedSize ?? data.byteLength;
    const localCompressedSize =
      entry.localCompressedSize ??
      ((localFlags & 0x8) !== 0 ? 0 : centralCompressedSize);
    const localUncompressedSize =
      entry.localUncompressedSize ??
      ((localFlags & 0x8) !== 0 ? 0 : centralUncompressedSize);
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(localFlags, 6);
    localHeader.writeUInt16LE(localMethod, 8);
    localHeader.writeUInt32LE((localFlags & 0x8) !== 0 ? 0 : checksum, 14);
    localHeader.writeUInt32LE(localCompressedSize, 18);
    localHeader.writeUInt32LE(localUncompressedSize, 22);
    localHeader.writeUInt16LE(localName.byteLength, 26);
    localHeader.writeUInt16LE(localExtra.byteLength, 28);

    const descriptor = entry.includeDataDescriptor
      ? (() => {
          const value = Buffer.alloc(16);
          value.writeUInt32LE(0x08074b50, 0);
          value.writeUInt32LE(checksum, 4);
          value.writeUInt32LE(centralCompressedSize, 8);
          value.writeUInt32LE(centralUncompressedSize, 12);
          return value;
        })()
      : Buffer.alloc(0);
    const localPart = Buffer.concat([localHeader, localName, localExtra, compressed, descriptor]);
    localParts.push(localPart);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(centralFlags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(centralCompressedSize, 20);
    centralHeader.writeUInt32LE(centralUncompressedSize, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(centralExtra.byteLength, 30);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, name, centralExtra]));
    localOffset += localPart.byteLength;
  }

  const localArea = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(localArea.byteLength, 16);
  return Buffer.concat([localArea, centralDirectory, eocd]);
}

function requiredOoxmlEntries(overrides: ZipFixtureEntry[] = []) {
  const entries: ZipFixtureEntry[] = [
    { name: "[Content_Types].xml" },
    { name: "_rels/.rels" },
    { name: "xl/workbook.xml" },
    { name: "xl/_rels/workbook.xml.rels" },
    { name: "xl/worksheets/sheet1.xml" }
  ];
  for (const override of overrides) {
    const index = entries.findIndex((entry) => entry.name === override.name);
    if (index >= 0) entries[index] = override;
    else entries.push(override);
  }
  return entries;
}

function workbookFile(
  sheets: Array<{ name: string; rows: unknown[][] }>,
  {
    name = "contatos.xlsx",
    type = XLSX_MIME,
    compression = false
  }: { name?: string; type?: string; compression?: boolean } = {}
) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer", compression });
  return new File([bytes], name, { type });
}

function smallWorkbookFile(options?: { name?: string; type?: string }) {
  return workbookFile(
    [
      {
        name: "Contatos",
        rows: [
          ["CPF", "Nome", "Telefone"],
          ["12345678900", "Cliente Teste", "5533999999999"]
        ]
      },
      { name: "Como usar", rows: [["Instrucoes"]] }
    ],
    options
  );
}

async function expectUploadError(
  promise: Promise<unknown>,
  expected: { code: ContactImportUploadError["code"]; status: number; reason?: string }
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ContactImportUploadError);
    assert.equal(error.code, expected.code);
    assert.equal(error.status, expected.status);
    if (expected.reason) assert.equal(error.reason, expected.reason);
    assert.doesNotMatch(error.message, /stack|buffer|byte|PK\x03/i);
    return true;
  });
}

test("aceita XLSX OOXML pequeno e compativel com dense sheet_to_json", async () => {
  const table = await parseContactImportSpreadsheet(smallWorkbookFile());
  assert.deepEqual(table[0], ["CPF", "Nome", "Telefone"]);
  assert.deepEqual(table[1], ["12345678900", "Cliente Teste", "5533999999999"]);
});

test("aceita CSV pequeno abaixo do limite real de arquivo", async () => {
  const file = new File(
    ["CPF,Nome,Telefone\n12345678900,Cliente Teste,5533999999999"],
    "contatos.csv",
    { type: "text/csv" }
  );
  const table = await parseContactImportSpreadsheet(file);
  assert.deepEqual(table[0], ["CPF", "Nome", "Telefone"]);
  assert.deepEqual(table[1], ["12345678900", "Cliente Teste", "5533999999999"]);
});

test("rejeita CSV com File.size acima do limite antes de materializar bytes", async () => {
  let arrayBufferCalls = 0;
  const file = {
    name: "grande.csv",
    type: "text/csv",
    size: CONTACT_IMPORT_MAX_FILE_BYTES + 1,
    arrayBuffer: async () => {
      arrayBufferCalls += 1;
      return new ArrayBuffer(0);
    }
  } as File;

  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "FILE_TOO_LARGE",
    status: 413,
    reason: "file_too_large"
  });
  assert.equal(arrayBufferCalls, 0);
});

test("rejeita CSV quando bytes reais excedem limite apesar de File.size menor", async () => {
  const actualBytes = new Uint8Array(CONTACT_IMPORT_MAX_FILE_BYTES + 1);
  const file = {
    name: "tamanho-falso.csv",
    type: "text/csv",
    size: 1,
    arrayBuffer: async () => actualBytes.buffer
  } as File;

  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "FILE_TOO_LARGE",
    status: 413,
    reason: "file_buffer_too_large"
  });
});

test("Node zlib limita o output real do inflate", () => {
  const compressed = deflateRawSync(Buffer.alloc(4_096, 0x41));
  assert.throws(
    () => inflateRawSync(compressed, { maxOutputLength: 128 }),
    (error: unknown) => {
      assert.ok(error instanceof RangeError);
      assert.equal((error as NodeJS.ErrnoException).code, "ERR_BUFFER_TOO_LARGE");
      return true;
    }
  );
});

test("rejeita output DEFLATE real acima do limite antes de carregar o parser", async () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data: Buffer.alloc(4_096, 0x41),
        method: 8,
        centralUncompressedSize: 64,
        localUncompressedSize: 64
      }
    ])
  );
  let parserLoads = 0;

  await expectUploadError(
    parseContactImportSpreadsheet(new File([bytes], "bounded.xlsx", { type: XLSX_MIME }), {
      ooxmlLimits: {
        maxEntryUncompressedBytes: 128,
        maxTotalUncompressedBytes: 1_024
      },
      loadXlsx: async () => {
        parserLoads += 1;
        return XLSX;
      }
    }),
    {
      code: "INVALID_XLSX",
      status: 400,
      reason: "zip_inflate_failed_or_output_limit_exceeded"
    }
  );
  assert.equal(parserLoads, 0);
});

test("rejeita metadata menor que o output real mesmo dentro do limite", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data: Buffer.alloc(512, 0x41),
        method: 8,
        centralUncompressedSize: 511,
        localUncompressedSize: 511
      }
    ])
  );
  assert.throws(
    () =>
      validateXlsxOoxmlPackage(bytes, {
        maxEntryUncompressedBytes: 1_024,
        maxTotalUncompressedBytes: 4_096
      }),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "zip_uncompressed_size_mismatch"
  );
});

test("rejeita metadata maior que o output real", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data: Buffer.alloc(512, 0x41),
        method: 8,
        centralUncompressedSize: 513,
        localUncompressedSize: 513
      }
    ])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "zip_uncompressed_size_mismatch"
  );
});

test("limita o total real produzido por todas as entries", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      { name: "xl/sharedStrings.xml", data: Buffer.alloc(80, 0x41), method: 8 }
    ])
  );
  assert.throws(
    () =>
      validateXlsxOoxmlPackage(bytes, {
        maxEntryUncompressedBytes: 100,
        maxTotalUncompressedBytes: 100
      }),
    (error: unknown) =>
      error instanceof ContactImportUploadError &&
      error.reason === "zip_inflate_failed_or_output_limit_exceeded"
  );
});

test("rejeita entrada duplicada depois de normalizar case e slash", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([{ name: "XL\\WORKSHEETS\\SHEET1.XML" }])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "duplicate_zip_entry"
  );
});

test("rejeita metodo divergente entre local header e central directory", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      { name: "xl/workbook.xml", data: Buffer.from("workbook"), method: 8, localMethod: 0 }
    ])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "invalid_zip_local_entry"
  );
});

test("rejeita flags divergentes entre local header e central directory", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data: Buffer.from("workbook"),
        method: 8,
        centralFlags: 0,
        localFlags: 0x8
      }
    ])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "invalid_zip_local_entry"
  );
});

test("rejeita compressedSize que inclui bytes depois do stream DEFLATE", () => {
  const data = Buffer.from("workbook");
  const declaredCompressedSize = deflateRawSync(data).byteLength + 1;
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data,
        method: 8,
        centralCompressedSize: declaredCompressedSize,
        localCompressedSize: declaredCompressedSize
      }
    ])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "zip_compressed_size_mismatch"
  );
});

test("aceita data descriptor com tamanhos locais zero e metadata central coerente", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        data: Buffer.from("workbook"),
        method: 8,
        centralFlags: 0x8,
        localFlags: 0x8,
        includeDataDescriptor: true
      }
    ])
  );
  assert.doesNotThrow(() => validateXlsxOoxmlPackage(bytes));
});

test("rejeita ZIP64 declarado em extra field", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([
      {
        name: "xl/workbook.xml",
        centralExtra: Buffer.from([0x01, 0x00, 0x00, 0x00])
      }
    ])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError &&
      error.reason === "unsupported_zip64_extra_field"
  );
});

test("rejeita drive-letter em nome de entrada ZIP", () => {
  const bytes = zipFixture(
    requiredOoxmlEntries([{ name: "C:\\xl\\workbook.xml" }])
  );
  assert.throws(
    () => validateXlsxOoxmlPackage(bytes),
    (error: unknown) =>
      error instanceof ContactImportUploadError && error.reason === "unsafe_zip_entry_name"
  );
});

test("rejeita mais de quatro worksheets antes de carregar o parser", async () => {
  const worksheets = Array.from({ length: CONTACT_IMPORT_MAX_WORKSHEETS + 1 }, (_, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`
  }));
  const bytes = zipFixture(requiredOoxmlEntries(worksheets));
  let parserLoads = 0;

  await expectUploadError(
    parseContactImportSpreadsheet(new File([bytes], "abas.xlsx", { type: XLSX_MIME }), {
      loadXlsx: async () => {
        parserLoads += 1;
        return XLSX;
      }
    }),
    { code: "WORKBOOK_LIMIT_EXCEEDED", status: 413, reason: "too_many_worksheets" }
  );
  assert.equal(parserLoads, 0);
});

test("aceita XLSX real comum com entries DEFLATE coerentes", async () => {
  const file = workbookFile(
    [{ name: "Contatos", rows: [["CPF", "Nome", "Telefone"], ["1", "Teste", "2"]] }],
    { compression: true }
  );
  const table = await parseContactImportSpreadsheet(file);
  assert.deepEqual(table[1], ["1", "Teste", "2"]);
});

test("rejeita XLSX acima do limite antes de carregar o parser", async () => {
  let parserLoads = 0;
  const file = new File(
    [new Uint8Array(CONTACT_IMPORT_MAX_FILE_BYTES + 1)],
    "grande.xlsx",
    { type: XLSX_MIME }
  );

  await expectUploadError(
    parseContactImportSpreadsheet(file, {
      loadXlsx: async () => {
        parserLoads += 1;
        return XLSX;
      }
    }),
    { code: "FILE_TOO_LARGE", status: 413, reason: "file_too_large" }
  );
  assert.equal(parserLoads, 0);
});

test("rejeita arquivo .xlsx sem pacote OOXML", async () => {
  const file = new File(["conteudo arbitrario"], "falso.xlsx", { type: XLSX_MIME });
  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "INVALID_XLSX",
    status: 400,
    reason: "missing_zip_signature"
  });
});

test("MIME de XLSX nao aprova arquivo com extensao incorreta", async () => {
  const file = smallWorkbookFile({ name: "contatos.xls", type: XLSX_MIME });
  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "UNSUPPORTED_FILE",
    status: 400,
    reason: "unsupported_extension"
  });
});

test("rejeita MIME explicitamente incompatível mesmo com OOXML valido", async () => {
  const file = smallWorkbookFile({ type: "text/html" });
  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "UNSUPPORTED_FILE",
    status: 400,
    reason: "xlsx_mime_mismatch"
  });
});

test("arquivo nomeado .xlsx nao desvia para CSV por MIME falsificado", async () => {
  const file = new File(["CPF,Nome,Telefone\n1,Teste,2"], "falso.xlsx", {
    type: "text/csv"
  });
  await expectUploadError(parseContactImportSpreadsheet(file), {
    code: "UNSUPPORTED_FILE",
    status: 400,
    reason: "xlsx_mime_mismatch"
  });
});

test("arquivo XLSX corrompido falha com erro sanitizado", async () => {
  const original = smallWorkbookFile();
  const bytes = Buffer.from(await original.arrayBuffer());
  const corrupted = new File([bytes.subarray(0, bytes.length - 22)], "corrompido.xlsx", {
    type: XLSX_MIME
  });
  await expectUploadError(parseContactImportSpreadsheet(corrupted), {
    code: "INVALID_XLSX",
    status: 400
  });
});

test("rejeita metadata de entrada OOXML com expansao excessiva antes do parser", async () => {
  const original = smallWorkbookFile();
  const bytes = Buffer.from(await original.arrayBuffer());
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const centralOffset = bytes.indexOf(centralSignature);
  assert.ok(centralOffset >= 0);
  bytes.writeUInt32LE(25 * 1024 * 1024 + 1, centralOffset + 24);
  let parserLoads = 0;

  await expectUploadError(
    parseContactImportSpreadsheet(
      new File([bytes], "expansao.xlsx", { type: XLSX_MIME }),
      {
        loadXlsx: async () => {
          parserLoads += 1;
          return XLSX;
        }
      }
    ),
    { code: "INVALID_XLSX", status: 400, reason: "encrypted_or_invalid_zip_entry" }
  );
  assert.equal(parserLoads, 0);
});

test("rejeita excesso de linhas", async () => {
  const rows = Array.from({ length: CONTACT_IMPORT_MAX_DATA_ROWS + 2 }, (_, index) => [
    index === 0 ? "CPF" : String(index)
  ]);
  await expectUploadError(
    parseContactImportSpreadsheet(workbookFile([{ name: "Dados", rows }])),
    { code: "WORKBOOK_LIMIT_EXCEEDED", status: 413, reason: "too_many_rows" }
  );
});

test("rejeita excesso de worksheets", async () => {
  const sheets = Array.from({ length: CONTACT_IMPORT_MAX_WORKSHEETS + 1 }, (_, index) => ({
    name: `Aba ${index + 1}`,
    rows: [["CPF"], [String(index)]]
  }));
  await expectUploadError(parseContactImportSpreadsheet(workbookFile(sheets)), {
    code: "WORKBOOK_LIMIT_EXCEEDED",
    status: 413,
    reason: "too_many_worksheets"
  });
});

test("rejeita excesso de colunas", async () => {
  const columns = Array.from({ length: 81 }, (_, index) => `Coluna ${index + 1}`);
  await expectUploadError(
    parseContactImportSpreadsheet(
      workbookFile([{ name: "Dados", rows: [columns, columns] }])
    ),
    { code: "WORKBOOK_LIMIT_EXCEEDED", status: 413, reason: "too_many_columns" }
  );
});

test("rejeita excesso de celulas dentro dos limites individuais", async () => {
  const columnCount = 80;
  const rowCount = Math.floor(CONTACT_IMPORT_MAX_CELLS / columnCount) + 2;
  const row = Array.from({ length: columnCount }, () => 1);
  const rows = Array.from({ length: rowCount }, () => row);
  await expectUploadError(
    parseContactImportSpreadsheet(workbookFile([{ name: "Dados", rows }])),
    { code: "WORKBOOK_LIMIT_EXCEEDED", status: 413, reason: "too_many_cells" }
  );
});

test("desabilita formulas HTML e VBA e limita linhas no XLSX.read", async () => {
  let readOptions: XLSX.ParsingOptions | undefined;
  const file = smallWorkbookFile();
  const fakeXlsx = {
    read(_bytes: unknown, options: XLSX.ParsingOptions) {
      readOptions = options;
      return {
        SheetNames: ["Contatos"],
        Sheets: { Contatos: { "!ref": "A1:C2" } }
      } as XLSX.WorkBook;
    },
    utils: {
      decode_range: XLSX.utils.decode_range,
      sheet_to_json: () => [["CPF", "Nome", "Telefone"], ["1", "Teste", "2"]]
    }
  };

  await parseContactImportSpreadsheet(file, {
    loadXlsx: async () => fakeXlsx as never
  });

  assert.deepEqual(readOptions, {
    type: "buffer",
    cellFormula: false,
    cellHTML: false,
    bookVBA: false,
    dense: true,
    sheetRows: CONTACT_IMPORT_MAX_DATA_ROWS + 2
  });
});
