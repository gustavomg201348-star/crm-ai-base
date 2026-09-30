import assert from "node:assert/strict";
import test from "node:test";
import {
  neutralizeSpreadsheetFormula,
  quoteCsvCell,
  serializeCsvCell
} from "./csv-export";

const dangerousValues = ["=1+1", "+1+1", "-1+1", "@SUM(1,1)"];
const leadingWhitespace = [" ", "   ", "\t", "\r", "\n", " \t\r\n"];

test("neutraliza todos os prefixos de formula em texto nao confiavel", () => {
  for (const value of dangerousValues) {
    assert.equal(serializeCsvCell(value), `"'${value.replace(/"/g, '""')}"`);
  }
});

test("detecta formula depois de whitespace sem alterar o valor original", () => {
  for (const whitespace of leadingWhitespace) {
    for (const value of dangerousValues) {
      assert.equal(
        serializeCsvCell(`${whitespace}${value}`),
        `"'${whitespace}${value.replace(/"/g, '""')}"`
      );
    }
  }

  assert.equal(serializeCsvCell("\u00a0=1+1"), `"'\u00a0=1+1"`);
});

test("trata TAB, CR e LF iniciais como perigosos mesmo sem formula posterior", () => {
  assert.equal(serializeCsvCell("\tMaria"), `"'\tMaria"`);
  assert.equal(serializeCsvCell("\rMaria"), `"'\rMaria"`);
  assert.equal(serializeCsvCell("\nMaria"), `"'\nMaria"`);
});

test("preserva valores seguros, Unicode e acentos", () => {
  const safeValues = [
    "Maria",
    "Joao da Silva",
    "11999999999",
    "12345678901",
    "email@example.com",
    "texto normal",
    "acao",
    "Sao Paulo",
    "João da Silva",
    "ação",
    "São Paulo"
  ];

  for (const value of safeValues) {
    assert.equal(serializeCsvCell(value), `"${value}"`);
  }
});

test("faz quoting de delimitadores, aspas, newline e CRLF", () => {
  assert.equal(serializeCsvCell("a,b", { delimiter: "," }), '"a,b"');
  assert.equal(serializeCsvCell("a;b", { delimiter: ";" }), '"a;b"');
  assert.equal(serializeCsvCell('ele disse "oi"'), '"ele disse ""oi"""');
  assert.equal(serializeCsvCell("linha 1\nlinha 2"), '"linha 1\nlinha 2"');
  assert.equal(serializeCsvCell("linha 1\r\nlinha 2"), '"linha 1\r\nlinha 2"');
});

test("serializa vazio, null e undefined como celula vazia", () => {
  assert.equal(serializeCsvCell(""), '""');
  assert.equal(serializeCsvCell(null), '""');
  assert.equal(serializeCsvCell(undefined), '""');
});

test("trusted-number preserva numero negativo e rejeita string numerica", () => {
  assert.equal(serializeCsvCell(-150, { kind: "trusted-number" }), '"-150"');
  assert.equal(serializeCsvCell("-150"), '"\'-150"');
  assert.throws(
    () => serializeCsvCell("-150", { kind: "trusted-number" }),
    /requires a finite number/
  );
});

test("apostrophe existente tem comportamento deterministico e nao e duplicado", () => {
  assert.equal(neutralizeSpreadsheetFormula("'=1+1"), "'=1+1");
  assert.equal(serializeCsvCell("'=1+1"), '"\'=1+1"');
});

test("trusted-value e reservado para valores estaticos confiaveis", () => {
  assert.equal(serializeCsvCell("=header", { kind: "trusted-value" }), '"=header"');
});

test("quoteCsvCell valida o delimitador em runtime", () => {
  assert.throws(
    () => quoteCsvCell("valor", "|" as never),
    /Unsupported CSV delimiter/
  );
});

test("fixture do export de Contacts neutraliza todos os dados com delimitador virgula", () => {
  const row = ["=1+1", "+telefone", "-cpf", "@email", "Origem", "Etapa"]
    .map((value) => serializeCsvCell(value, { delimiter: "," }))
    .join(",");

  assert.equal(row, `"'=1+1","'+telefone","'-cpf","'@email","Origem","Etapa"`);
});

test("fixture de erros de importacao preserva numero confiavel e neutraliza nome", () => {
  const row = [
    serializeCsvCell(7, { delimiter: ";", kind: "trusted-number" }),
    serializeCsvCell("   =1+1", { delimiter: ";" }),
    serializeCsvCell("12345678901", { delimiter: ";" }),
    serializeCsvCell("11999999999", { delimiter: ";" }),
    serializeCsvCell("Nome invalido", { delimiter: ";" })
  ].join(";");

  assert.equal(
    row,
    `"7";"'   =1+1";"12345678901";"11999999999";"Nome invalido"`
  );
});

test("fixture de campanha preserva BOM e neutraliza campos controlaveis", () => {
  const row = ["=Campanha", "+Contato", "11999999999", "FAILED", "@erro", "", ""]
    .map((value) => serializeCsvCell(value, { delimiter: ";" }))
    .join(";");
  const csv = `\uFEFF${row}`;

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(
    csv.slice(1),
    `"'=Campanha";"'+Contato";"11999999999";"FAILED";"'@erro";"";""`
  );
});
