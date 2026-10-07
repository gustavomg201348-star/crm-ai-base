import assert from "node:assert/strict";
import test from "node:test";
import { classifyProductIntent, resolveProductIntent, hasUsableCpf, normalizeProposalStatus, selectProposalFacts, type ProposalRecord, type CustomerFacts } from "./ai-response-facts";
import { buildResponseGoal, reconcileResponseGoal } from "./ai-response-goal";
import { enforceFinancialReplyGuardrails, FINANCIAL_VERIFICATION_REPLY, type AuthorizedFinancialFacts } from "./ai-response-guardrails";
import { redactAiSensitiveText } from "./ai-response-context";

const now = new Date("2026-10-07T12:00:00Z");
const customer: CustomerFacts = { hasCpf: true, hasLocallyValidCpf: true, hasPhone: true, hasEmail: false, hasResponsibleAgent: true };
function record(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return { companyId: "tenant-a", contactId: "contact-a", product: "Credito CLT", bank: "Banco de teste",
    status: "DRAFT", amount: "15000.00", financedAmount: "16000.00", releasedAmount: "15000.00",
    installmentAmount: "400.00", term: 48, createdAt: now, updatedAt: now, ...overrides };
}
function project(records: ProposalRecord[] = [record()], requestedProduct: string | null = null) {
  return selectProposalFacts({ records, companyId: "tenant-a", contactId: "contact-a", requestedProduct, now, sanitize: redactAiSensitiveText });
}
function facts(proposal = project().proposal): AuthorizedFinancialFacts {
  return { proposal, proposalAmounts: ["999999"], proposalStatuses: ["APPROVED"], proposalProducts: [], proposalBanks: [],
    installmentAmounts: [], installmentCounts: [], rates: [], cets: [], margins: [], limits: [], paymentDates: [], discountDates: [] };
}
function goal(question: string, projection = project()) {
  return buildResponseGoal({ question, customer, proposal: projection.proposal, proposalSelection: projection.selection });
}
function reply(suggestedReply: string, nextAction = "Informar valor liberado.") {
  return { summary: "Cliente fez uma pergunta.", temperature: "WARM" as const, confidence: 80,
    tags: [], suggestedReply, nextAction, shouldTransferToHuman: false };
}

test("CPF utilizavel exige formato e digitos verificadores, sem validacao externa", () => {
  assert.equal(hasUsableCpf("529.982.247-25"), true);
  for (const value of [null, "", "11111111111", "52998224724", "nao informado"]) assert.equal(hasUsableCpf(value), false);
});
for (const [raw, normalized] of Object.entries({ DRAFT: "DRAFT", APPROVED: "APPROVED", NEW: "PROCESSING", TYPED: "PROCESSING",
  ANALYSIS: "PROCESSING", PENDING: "PROCESSING", FORMALIZING: "PROCESSING", REWORK: "PROCESSING", PAID: "COMPLETED",
  CANCELED: "CLOSED", REJECTED: "CLOSED", LIBERADO: "UNKNOWN" })) {
  test(`status real ${raw} tem significado explicito ${normalized}`, () => assert.equal(normalizeProposalStatus(raw), normalized));
}
test("CLT DRAFT sem proveniencia e somente rascunho; valores separados", () => {
  const proposal = project().proposal!;
  assert.equal(proposal.amount?.meaning, "DRAFT_PROPOSAL_AMOUNT");
  assert.equal(proposal.releasedAmount?.meaning, "RECORDED_RELEASED_AMOUNT");
  assert.equal(proposal.financedAmount?.meaning, "FINANCED_AMOUNT");
  const responseGoal = goal("Quanto libera pra mim hoje?");
  assert.match(responseGoal.safeReply, /rascunho.*R\$\s*15\.000,00/);
  assert.match(responseGoal.safeReply, /nao confirma liberacao nem pagamento hoje/);
});
test("propostas multiplas nao misturam dados nem escolhem somente updatedAt", () => {
  const result = project([record(), record({ amount: "20000", bank: "Outro banco", status: "APPROVED" })]);
  assert.equal(result.selection, "UNKNOWN"); assert.equal(result.proposal, null);
});
test("produto explicito seleciona uma proposta relevante sem usar inferencia Observer", () => {
  const result = project([record(), record({ product: "FGTS", amount: "20000" })], "CLT");
  assert.equal(result.proposal?.amount?.value, "15000.00");
  assert.equal(project([record({ product: "FGTS" })], "CLT").selection, "UNKNOWN");
});
for (const [name, records] of [
  ["tenant diferente", [record({ companyId: "tenant-b" })]],
  ["contact diferente", [record({ contactId: "contact-b" })]],
  ["antiga", [record({ updatedAt: new Date("2025-01-01"), createdAt: new Date("2025-01-01") })]],
  ["futura", [record({ updatedAt: new Date("2027-01-01") })]],
  ["status desconhecido", [record({ status: "APPROVED_BY_BANK" })]],
  ["cancelada", [record({ status: "CANCELED" })]],
  ["scan incompleto", Array.from({ length: 51 }, () => record())]
] as const) {
  test(`selecao conservadora rejeita proposta ${name}`, () => assert.equal(project([...records]).proposal, null));
}
test("APPROVED relata estado CRM sem prometer pagamento", () => {
  const responseGoal = goal("Foi aprovado?", project([record({ status: "APPROVED" })]));
  assert.match(responseGoal.safeReply, /CRM registra.*aprovada/);
  assert.match(responseGoal.safeReply, /nao confirma pagamento/);
});
for (const question of ["Qual parcela?", "Qual prazo?", "Qual banco?"]) {
  test(`fato vinculado permite ${question}`, () => {
    const responseGoal = goal(question);
    assert.equal(responseGoal.canAnswerDirectly, true);
    assert.equal(enforceFinancialReplyGuardrails({ suggestedReply: responseGoal.safeReply, facts: facts() }), responseGoal.safeReply);
  });
}
test("CPF presente e sem valor confiavel nao pede documento nem inventa requisito", () => {
  const responseGoal = goal("Quanto libera no CLT?", project([]));
  assert.equal(responseGoal.action, "HUMAN_VALIDATION");
  assert.doesNotMatch(responseGoal.safeReply, /cpf/i);
  const result = reconcileResponseGoal({ reply: reply("Envie seu CPF para verificar."), goal: responseGoal, customer, guarded: false });
  assert.equal(result.suggestedReply, responseGoal.safeReply);
});
test("sem CPF nao transforma ausencia automaticamente em pedir CPF", () => {
  const responseGoal = buildResponseGoal({ question: "Quanto libera no CLT?", customer: { ...customer, hasCpf: false }, proposal: null, proposalSelection: "NONE" });
  assert.equal(responseGoal.shouldTransferToHuman, true); assert.doesNotMatch(responseGoal.safeReply, /cpf/i);
});
test("produto nao identificado e pergunta de valor produz uma pergunta objetiva", () => {
  const responseGoal = goal("Quanto libera?", project([]));
  assert.equal(responseGoal.nextRequiredInformation, "PRODUCT");
  const result = reconcileResponseGoal({ reply: reply("Vou verificar."), goal: responseGoal, customer, guarded: false });
  assert.match(result.suggestedReply, /Qual produto/); assert.equal(result.nextAction, responseGoal.nextAction);
});
test("intencao ambigua nao finge entender e nao associa propostas", () => {
  assert.equal(goal("Qual banco e quanto libera?").intent, "UNKNOWN");
});
test("promessa recente e cliente pedindo retorno nao produz promessa vazia", () => {
  const responseGoal = goal("Algum retorno?", project([]));
  const result = reconcileResponseGoal({ reply: reply("Estou verificando e em breve retorno."), goal: responseGoal, customer, guarded: false });
  assert.match(result.suggestedReply, /validacao de um atendente/);
  assert.doesNotMatch(result.suggestedReply, /vou verificar|em breve/i);
});
test("nextAction concreta e reply vazio operacional sao reconciliados", () => {
  const responseGoal = goal("Quanto libera?");
  const result = reconcileResponseGoal({ reply: reply("Vou verificar."), goal: responseGoal, customer, guarded: false });
  assert.equal(result.suggestedReply, responseGoal.safeReply); assert.equal(result.nextAction, responseGoal.nextAction);
});
test("guardrail bloqueia dado nao autorizado e reconcilia action/reason/handoff", () => {
  const responseGoal = goal("Quando cai?", project([]));
  const unsupported = reply("O banco aprovou R$ 20 mil e cai hoje.");
  assert.equal(enforceFinancialReplyGuardrails({ suggestedReply: unsupported.suggestedReply, facts: facts(null) }), FINANCIAL_VERIFICATION_REPLY);
  const result = reconcileResponseGoal({ reply: unsupported, goal: responseGoal, customer, guarded: true });
  assert.equal(result.source, "guardrail"); assert.equal(result.nextAction, responseGoal.nextAction);
  assert.equal(result.shouldTransferToHuman, true); assert.doesNotMatch(result.reason!, /20 mil/);
});
for (const claim of ["Sua taxa e 5%.", "A margem e R$ 400.", "Seu limite e R$ 15000.", "Cai dia 10.",
  "O valor esta liberado.", "O credito esta disponivel.", "O banco aprovou R$ 15000.", "Sua parcela e R$ 999."]) {
  test(`campos de outra categoria nao autorizam: ${claim}`, () => {
    assert.equal(enforceFinancialReplyGuardrails({ suggestedReply: claim, facts: facts() }), FINANCIAL_VERIFICATION_REPLY);
  });
}
test("arrays legados nao podem sobrepor proposta vinculada nula", () => {
  assert.equal(enforceFinancialReplyGuardrails({ suggestedReply: "Sua proposta e R$ 999999.", facts: facts(null) }), FINANCIAL_VERIFICATION_REPLY);
});
test("simulacao local e logs SUCCESS nao entram na projecao de fatos", () => {
  assert.equal(project([]).proposal, null);
  assert.equal(goal("Quanto libera no CLT?", project([])).canAnswerDirectly, false);
});

for (const question of ["Qual taxa?", "Qual CET?", "Qual margem?", "Qual limite?", "Posso amortizar?", "Quando comeca descontar?"]) {
  test(`fato financeiro indisponivel exige validacao humana: ${question}`, () => {
    assert.equal(goal(question).action, "HUMAN_VALIDATION");
    assert.equal(goal(question).nextRequiredInformation, null);
  });
}
test("perguntas comuns de parcela e banco nao viram intencao ambigua artificial", () => {
  assert.equal(goal("Quanto e a parcela?").intent, "INSTALLMENT");
  assert.equal(goal("Qual o banco?").intent, "BANK");
});

for (const [text, state, product] of [
  ["Quero CLT", "SINGLE_POSITIVE", "CLT"],
  ["Nao quero CLT", "NEGATED", null], ["Nao e CLT", "NEGATED", null],
  ["sem CLT", "NEGATED", null], ["CLT ou FGTS", "AMBIGUOUS", null],
  ["Quanto libera?", "NO_MENTION", null]
] as const) {
  test(`intencao conservadora: ${text}`, () => assert.deepEqual(classifyProductIntent(text), { state, product }));
}
for (const text of ["CLT ou FGTS", "Nao quero CLT", "Nao e CLT", "sem CLT"]) {
  test(`historico nao resolve intencao atual: ${text}`, () => {
    assert.equal(resolveProductIntent(text, ["Quero CLT"]).product, null);
    assert.equal(resolveProductIntent(text, ["Quero CLT"]).source, "CURRENT_MESSAGE");
  });
}
test("historico positivo somente preenche NO_MENTION", () => {
  assert.deepEqual(resolveProductIntent("Quanto libera?", ["Quero CLT"]),
    { state: "SINGLE_POSITIVE", product: "CLT", source: "HISTORY" });
  assert.equal(resolveProductIntent("Quanto libera?", ["Nao quero CLT"]).product, null);
});
for (const days of [29, 30, 31]) {
  test(`freshness material ${days} dias`, () => {
    const date = new Date(now.getTime() - days * 86_400_000);
    const result = project([record({ status: "APPROVED", createdAt: date, updatedAt: date })]);
    assert.equal(result.history[0].freshness, days <= 30 ? "RECENT" : "STALE");
    assert.equal(result.selection, days <= 30 ? "SELECTED" : "UNKNOWN");
    if (days > 30) {
      assert.equal(result.proposal, null);
      assert.equal(goal("Foi aprovado?", result).shouldTransferToHuman, true);
      assert.doesNotMatch(JSON.stringify(result.history), /15000|16000|400|Banco de teste/);
    }
  });
}
test("APPROVED stale e DRAFT recente preservam conflito sem misturar banco ou valor", () => {
  const date = new Date(now.getTime() - 31 * 86_400_000);
  const result = project([record({ status: "APPROVED", bank: "Banco A", amount: "1000", createdAt: date, updatedAt: date }),
    record({ bank: "Banco B", amount: "2000" })]);
  assert.equal(result.selection, "UNKNOWN"); assert.equal(result.proposal, null);
  assert.deepEqual(result.history.map((item) => item.freshness), ["STALE", "RECENT"]);
  assert.equal(goal("Quanto libera?", result).action, "HUMAN_VALIDATION");
});
test("duas stale nao autorizam condicao atual", () => {
  const date = new Date(now.getTime() - 31 * 86_400_000);
  const result = project([record({ createdAt: date, updatedAt: date }), record({ status: "APPROVED", createdAt: date, updatedAt: date })]);
  assert.equal(result.selection, "UNKNOWN"); assert.equal(result.proposal, null);
  assert.equal(result.history.length, 2);
});
for (const product of ["CLT", "FGTS"]) {
  test(`DRAFT ${product} nao e simulacao sem proveniencia`, () => {
    const result = goal("Quanto libera?", project([record({ product })]));
    assert.match(result.safeReply, /rascunho/);
    assert.doesNotMatch(result.safeReply, /simulac|oferta simulada|aprovad|liberado|disponivel hoje/i);
  });
}
for (const [status, label] of [["DRAFT", "rascunho"], ["ANALYSIS", "em processamento"], ["PAID", "paga"]]) {
  test(`status ${status} informa registro sem handoff contraditorio`, () => {
    const result = goal("Foi aprovado?", project([record({ status })]));
    assert.match(result.safeReply, new RegExp(label));
    assert.doesNotMatch(result.safeReply, /precisa ser confirmado/);
    assert.equal(result.canAnswerDirectly, true); assert.equal(result.shouldTransferToHuman, false);
  });
}
test("todos os goals substituem summary e reason livres mesmo com reply coerente", () => {
  for (const question of ["Ola", "Quanto libera?", "Qual parcela?", "Quando cai?", "Meu CPF?"]) {
    const responseGoal = goal(question);
    const original = { ...reply(responseGoal.safeReply, responseGoal.nextAction),
      summary: "Banco aprovou.", reason: "Pagamento confirmado.", shouldTransferToHuman: responseGoal.shouldTransferToHuman };
    const result = reconcileResponseGoal({ reply: original, goal: responseGoal, customer, guarded: false });
    assert.doesNotMatch(`${result.summary} ${result.reason}`, /aprovou|pagamento confirmado/i);
    assert.equal(result.suggestedReply, responseGoal.safeReply);
    assert.equal(result.nextAction, responseGoal.nextAction);
    assert.equal(result.shouldTransferToHuman, responseGoal.shouldTransferToHuman);
    assert.equal(result.temperature, original.temperature); assert.equal(result.confidence, original.confidence);
    assert.deepEqual(result.tags, original.tags);
  }
});
