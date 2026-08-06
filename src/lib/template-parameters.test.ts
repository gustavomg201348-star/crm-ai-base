import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpreadsheetImportColumns,
  buildSpreadsheetRawValues
} from "./spreadsheet-import-columns";
import {
  deserializeResolvedTemplateVariablesV1,
  deserializeTemplateVariableMappingV1,
  extractTemplateBodyVariableIndexes,
  resolveTemplateColumnParameters,
  serializeResolvedTemplateVariablesV1,
  serializeTemplateVariableMappingV1,
  TemplateParameterError
} from "./template-parameters";

const columns = buildSpreadsheetImportColumns([
  "Telefone",
  "Nome",
  "Valor liberado",
  "Valor liberado"
]);

test("resolve uma variavel mapeada para coluna", () => {
  const result = resolveTemplateColumnParameters({
    templateBody: "Ola {{1}}.",
    mapping: { "1": "col_1_nome" },
    columns,
    rawValues: buildSpreadsheetRawValues(["31999999999", "Joao", "R$ 50,00"], columns)
  });

  assert.deepEqual(result.variables, ["Joao"]);
  assert.equal(result.renderedBody, "Ola Joao.");
});

test("resolve duas variaveis na ordem correta", () => {
  const result = resolveTemplateColumnParameters({
    templateBody: "Ola {{1}}, voce possui {{2}}.",
    mapping: { "1": "col_1_nome", "2": "col_2_valor_liberado" },
    columns,
    rawValues: buildSpreadsheetRawValues(["31999999999", "Maria", "R$ 237,45"], columns)
  });

  assert.deepEqual(result.variables, ["Maria", "R$ 237,45"]);
  assert.equal(result.renderedBody, "Ola Maria, voce possui R$ 237,45.");
});

test("mantem valores diferentes por linha", () => {
  const first = resolveTemplateColumnParameters({
    templateBody: "{{1}} tem {{2}}.",
    mapping: { "1": "col_1_nome", "2": "col_2_valor_liberado" },
    columns,
    rawValues: buildSpreadsheetRawValues(["1", "Joao", "R$ 50,00"], columns)
  });
  const second = resolveTemplateColumnParameters({
    templateBody: "{{1}} tem {{2}}.",
    mapping: { "1": "col_1_nome", "2": "col_2_valor_liberado" },
    columns,
    rawValues: buildSpreadsheetRawValues(["2", "Maria", "R$ 237,45"], columns)
  });

  assert.deepEqual(first.variables, ["Joao", "R$ 50,00"]);
  assert.deepEqual(second.variables, ["Maria", "R$ 237,45"]);
});

test("valor vazio gera erro especifico da linha", () => {
  assert.throws(
    () =>
      resolveTemplateColumnParameters({
        templateBody: "Ola {{1}}.",
        mapping: { "1": "col_1_nome" },
        columns,
        rawValues: buildSpreadsheetRawValues(["31999999999", ""], columns)
      }),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_VALUE_EMPTY"
  );
});

test("mapping incompleto bloqueia resolucao", () => {
  assert.throws(
    () =>
      resolveTemplateColumnParameters({
        templateBody: "Ola {{1}}, voce possui {{2}}.",
        mapping: { "1": "col_1_nome" },
        columns,
        rawValues: buildSpreadsheetRawValues(["1", "Joao", "R$ 50,00"], columns)
      }),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_MAPPING_INCOMPLETE"
  );
});

test("coluna inexistente bloqueia resolucao", () => {
  assert.throws(
    () =>
      resolveTemplateColumnParameters({
        templateBody: "Ola {{1}}.",
        mapping: { "1": "col_99_inexistente" },
        columns,
        rawValues: buildSpreadsheetRawValues(["1", "Joao"], columns)
      }),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND"
  );
});

test("placeholders fora de sequencia sao rejeitados", () => {
  assert.throws(
    () => extractTemplateBodyVariableIndexes("Ola {{1}} {{3}}."),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_SEQUENCE_INVALID"
  );
});

test("headers duplicados geram chaves estaveis por indice original", () => {
  assert.equal(columns[2].key, "col_2_valor_liberado");
  assert.equal(columns[3].key, "col_3_valor_liberado");
});

test("header com acento e espaco gera label normalizado e chave segura", () => {
  const [column] = buildSpreadsheetImportColumns([" Valor Líberado "]);

  assert.equal(column.label, "Valor Líberado");
  assert.equal(column.normalized, "valor liberado");
  assert.equal(column.key, "col_0_valor_liberado");
});

test("planilha sem colunas extras continua representada", () => {
  const basicColumns = buildSpreadsheetImportColumns(["CPF", "Nome", "Telefone"]);
  const rawValues = buildSpreadsheetRawValues(
    ["12345678901", "Ana", "33999999999"],
    basicColumns
  );

  assert.deepEqual(
    basicColumns.map((column) => column.key),
    ["col_0_cpf", "col_1_nome", "col_2_telefone"]
  );
  assert.equal(rawValues.col_1_nome, "Ana");
});

test("template sem variaveis retorna array vazio e texto original", () => {
  const result = resolveTemplateColumnParameters({
    templateBody: "Mensagem sem variavel.",
    mapping: {},
    columns,
    rawValues: buildSpreadsheetRawValues(["1", "Joao"], columns)
  });

  assert.deepEqual(result.variables, []);
  assert.equal(result.renderedBody, "Mensagem sem variavel.");
});

test("coluna nao utilizada e aceita", () => {
  const result = resolveTemplateColumnParameters({
    templateBody: "Ola {{1}}.",
    mapping: { "1": "col_1_nome" },
    columns,
    rawValues: buildSpreadsheetRawValues(
      ["1", "Joao", "R$ 50,00", "nao usado"],
      columns
    )
  });

  assert.deepEqual(result.variables, ["Joao"]);
});

test("formula e caracteres especiais sao tratados apenas como texto", () => {
  const result = resolveTemplateColumnParameters({
    templateBody: "Valor: {{1}}.",
    mapping: { "1": "col_2_valor_liberado" },
    columns,
    rawValues: buildSpreadsheetRawValues(
      ["1", "Joao", "=IMPORTXML(\"http://example.test\")"],
      columns
    )
  });

  assert.deepEqual(result.variables, ["=IMPORTXML(\"http://example.test\")"]);
  assert.equal(result.renderedBody, "Valor: =IMPORTXML(\"http://example.test\").");
});

test("serializa mapping valido preservando somente colunas usadas", () => {
  const serialized = serializeTemplateVariableMappingV1({
    version: 1,
    mode: "COLUMN_MAPPING",
    body: { "1": "col_1_nome", "2": "col_2_valor_liberado" },
    columns
  });
  const parsed = JSON.parse(serialized) as {
    version: number;
    mode: string;
    body: Record<string, string>;
    columns: Array<{ key: string }>;
  };

  assert.equal(parsed.version, 1);
  assert.equal(parsed.mode, "COLUMN_MAPPING");
  assert.deepEqual(parsed.body, {
    "1": "col_1_nome",
    "2": "col_2_valor_liberado"
  });
  assert.deepEqual(
    parsed.columns.map((column) => column.key),
    ["col_1_nome", "col_2_valor_liberado"]
  );
});

test("desserializa mapping valido", () => {
  const serialized = serializeTemplateVariableMappingV1({
    version: 1,
    mode: "COLUMN_MAPPING",
    body: { "1": "col_1_nome" },
    columns
  });

  const result = deserializeTemplateVariableMappingV1(serialized);

  assert.equal(result?.version, 1);
  assert.equal(result?.mode, "COLUMN_MAPPING");
  assert.deepEqual(result?.body, { "1": "col_1_nome" });
});

test("mapping null preserva compatibilidade", () => {
  assert.equal(deserializeTemplateVariableMappingV1(null), null);
  assert.equal(deserializeTemplateVariableMappingV1(undefined), null);
});

test("JSON invalido de mapping e rejeitado", () => {
  assert.throws(
    () => deserializeTemplateVariableMappingV1("{invalido"),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_JSON_INVALID"
  );
});

test("version nao suportada e rejeitada", () => {
  assert.throws(
    () =>
      deserializeTemplateVariableMappingV1(
        JSON.stringify({
          version: 2,
          mode: "COLUMN_MAPPING",
          body: { "1": "col_1_nome" },
          columns
        })
      ),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_VERSION_UNSUPPORTED"
  );
});

test("mode invalido e rejeitado", () => {
  assert.throws(
    () =>
      deserializeTemplateVariableMappingV1(
        JSON.stringify({
          version: 1,
          mode: "AUTO",
          body: { "1": "col_1_nome" },
          columns
        })
      ),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_MODE_INVALID"
  );
});

test("body fora de sequencia no mapping e rejeitado", () => {
  assert.throws(
    () =>
      deserializeTemplateVariableMappingV1(
        JSON.stringify({
          version: 1,
          mode: "COLUMN_MAPPING",
          body: { "1": "col_1_nome", "3": "col_2_valor_liberado" },
          columns
        })
      ),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_SEQUENCE_INVALID"
  );
});

test("coluna mencionada no body ausente em columns e rejeitada", () => {
  assert.throws(
    () =>
      deserializeTemplateVariableMappingV1(
        JSON.stringify({
          version: 1,
          mode: "COLUMN_MAPPING",
          body: { "1": "col_99_inexistente" },
          columns
        })
      ),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND"
  );
});

test("serializa e desserializa variaveis resolvidas validas", () => {
  const serialized = serializeResolvedTemplateVariablesV1({
    version: 1,
    body: ["Joao", "R$ 50,00"]
  });

  assert.deepEqual(deserializeResolvedTemplateVariablesV1(serialized), {
    version: 1,
    body: ["Joao", "R$ 50,00"]
  });
});

test("variaveis resolvidas null preservam compatibilidade", () => {
  assert.equal(deserializeResolvedTemplateVariablesV1(null), null);
  assert.equal(deserializeResolvedTemplateVariablesV1(undefined), null);
});

test("quantidade errada de variaveis resolvidas e rejeitada quando esperada", () => {
  const serialized = serializeResolvedTemplateVariablesV1({
    version: 1,
    body: ["Joao"]
  });

  assert.throws(
    () => deserializeResolvedTemplateVariablesV1(serialized, 2),
    (error: unknown) =>
      error instanceof TemplateParameterError &&
      error.code === "TEMPLATE_VARIABLE_COUNT_INVALID"
  );
});

test("valores resolvidos preservam texto literal", () => {
  const serialized = serializeResolvedTemplateVariablesV1({
    version: 1,
    body: ["=1+1", "<b>texto</b>", "R$ 50,00"]
  });

  assert.deepEqual(deserializeResolvedTemplateVariablesV1(serialized)?.body, [
    "=1+1",
    "<b>texto</b>",
    "R$ 50,00"
  ]);
});
