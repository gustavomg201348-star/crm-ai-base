import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as ts from "typescript";
import { interpretOpenCreditStatus, type OpenCreditStatusMetadata, type OpenCreditStatusMeaning } from "./opencredit-status-interpreter";

const cases: readonly [string, OpenCreditStatusMeaning, boolean][] = [
  ["EM_ANDAMENTO", "IN_PROGRESS", false], ["PENDENTE", "ACTION_REQUIRED", false],
  ["APROVADA", "SUCCESS", true], ["REPROVADA", "REJECTED", true],
  ["CANCELADA", "CANCELED", true], ["ERRO", "TECHNICAL_ATTENTION", false]
];
for (const [category, meaning, terminal] of cases) {
  test(`observed ${category} preserves terminal=${terminal}`, () => {
    assert.deepEqual(interpretOpenCreditStatus({ category, terminal }), {
      meaning, terminal, shouldPoll: !terminal, requiresSignature: false
    });
  });
  for (const terminal of [false, true]) for (const hasSignUrl of [undefined, false, true]) {
    test(`${category}: flags remain independent, terminal=${terminal}, signature=${hasSignUrl}`, () => {
      const input: OpenCreditStatusMetadata = Object.freeze({ category, terminal, ...(hasSignUrl === undefined ? {} : { hasSignUrl }) });
      assert.deepEqual(interpretOpenCreditStatus(input), {
        meaning, terminal, shouldPoll: !terminal, requiresSignature: hasSignUrl === true
      });
      assert.deepEqual(input, { category, terminal, ...(hasSignUrl === undefined ? {} : { hasSignUrl }) });
    });
  }
}
for (const category of ["AGUARDANDO_ANALISE_ESPECIAL", "FUTURE_42", "__proto__", "constructor", "toString", "aprovada", " APROVADA "]) {
  for (const terminal of [false, true]) test(`unknown ${category}, terminal=${terminal} retains signature flag`, () => {
    assert.deepEqual(interpretOpenCreditStatus({ category, terminal, hasSignUrl: true }), {
      meaning: "UNKNOWN", terminal, shouldPoll: !terminal, requiresSignature: true
    });
  });
}
test("unknown without a signature flag does not infer an action", () => {
  assert.deepEqual(interpretOpenCreditStatus({ category: "FUTURE", terminal: false }), {
    meaning: "UNKNOWN", terminal: false, shouldPoll: true, requiresSignature: false
  });
});
test("no bank ID or status label is needed or even read", () => {
  const input = {
    category: "PENDENTE", terminal: false,
    get status(): never { throw Error("Status text must not be read"); },
    get bankId(): never { throw Error("Bank must not be read"); },
    get bankName(): never { throw Error("Bank name must not be read"); }
  };
  assert.deepEqual(interpretOpenCreditStatus(input), { meaning: "ACTION_REQUIRED", terminal: false, shouldPoll: true, requiresSignature: false });
});
test("deterministic fresh outputs cannot contaminate subsequent interpretations", () => {
  const input = Object.freeze({ category: "APROVADA", terminal: false, hasSignUrl: false });
  const first = interpretOpenCreditStatus(input);
  const second = interpretOpenCreditStatus(input);
  assert.deepEqual(first, second); assert.notEqual(first, second);
  first.terminal = true; first.meaning = "UNKNOWN";
  assert.deepEqual(interpretOpenCreditStatus(input), second);
});
test("module is shared-safe: no imports, env, HTTP, credentials, Prisma or I/O dependencies", () => {
  const source = readFileSync(new URL("./opencredit-status-interpreter.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("interpreter.ts", source, ts.ScriptTarget.Latest, true);
  const calls: string[] = []; const reads = new Set<string>();
  function visit(node: ts.Node) {
    assert.equal(ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node), false);
    if (ts.isExportDeclaration(node)) assert.equal(node.moduleSpecifier, undefined);
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
    if (ts.isPropertyAccessExpression(node)) reads.add(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(calls, ["meaning"]);
  assert.deepEqual(Array.from(reads).sort(), ["input.category", "input.hasSignUrl", "input.terminal"]);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|process|window|document|require|prisma|bankId|bankName|setTimeout|setInterval)\b|opencredit-api-client|server-only/);
});

// Compile-time regressions checked by the project's strict typecheck; never executed.
if (false) {
  // @ts-expect-error terminal is required; parser output without it cannot be used directly.
  interpretOpenCreditStatus({ category: "APROVADA" });
  // @ts-expect-error terminal must be boolean, not a string.
  interpretOpenCreditStatus({ category: "APROVADA", terminal: "true" });
  // @ts-expect-error category must be a string.
  interpretOpenCreditStatus({ category: 123, terminal: true });
  // @ts-expect-error hasSignUrl is boolean when present, not null.
  interpretOpenCreditStatus({ category: "PENDENTE", terminal: false, hasSignUrl: null });
  // @ts-expect-error hasSignUrl is not a string.
  interpretOpenCreditStatus({ category: "PENDENTE", terminal: false, hasSignUrl: "true" });
}
