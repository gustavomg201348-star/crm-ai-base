import assert from "node:assert/strict";
import { test } from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { enforceFinancialReplyGuardrails } from "./ai-response-guardrails";
const loader=Module as typeof Module & {_load(name:string,...args:unknown[]):unknown};
const original=loader._load; let facts:typeof import("./opencredit-ai-financial-facts");
loader._load=(name,...args)=>name==="server-only"?{}:original.call(loader,name,...args);
try {facts=createRequire(import.meta.url)("./opencredit-ai-financial-facts");} finally {loader._load=original;}
test("financial facts require encryption, bind workflow, preserve nulls and never invent CET/expiry",()=>{
  const previous=process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  try {
    process.env.QEVORA_DATA_ENCRYPTION_KEY_V1=Buffer.alloc(32,24).toString("base64");
    const result={bankId:"synthetic",simulationId:"simulation",status:"aprovado" as const,simulationType:null,offers:[
      {offerId:"offer",installments:12,installmentAmount:100.12,liquidAmount:1000.25,interestRate:null,totalAmount:null,hasInsurance:null}]};
    const envelope=facts.protectCltFinancialFacts("workflow",result);assert(!envelope.includes("1000.25"));
    const read=facts.readCltFinancialFacts("workflow",envelope);assert.equal(read.offers[0].releasedAmountCents,100025);
    assert.equal(read.offers[0].installmentCents,10012);assert.equal(read.offers[0].interestRateMonthly,null);
    assert.equal(read.offers[0].cetMonthly,null);assert.equal(read.offers[0].expiresAt,null);
    assert.throws(()=>facts.readCltFinancialFacts("foreign-workflow",envelope));
    const reply=facts.renderCltFinancialFacts(read);assert.match(reply,/1\.000,25/);assert.match(reply,/100,12/);assert.doesNotMatch(reply,/CET|melhor|aprovado|liberado/);
    assert.throws(()=>facts.protectCltFinancialFacts("workflow",{...result,offers:[{...result.offers[0],liquidAmount:1.005}]}));
  } finally {if(previous===undefined)delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1=previous;}
});
test("untrusted history/model financial claims are not authorized",()=>{
  const empty={proposal:null,proposalAmounts:[],proposalStatuses:[],proposalProducts:[],proposalBanks:[],installmentAmounts:[],installmentCounts:[],rates:[],cets:[],margins:[],limits:[],paymentDates:[],discountDates:[]};
  for(const text of ["Você tem R$ 20.000,00 aprovado","A parcela é R$ 100,00 em 12 vezes","A taxa é 1,2%","O CET é 1%"])
    assert.notEqual(enforceFinancialReplyGuardrails({suggestedReply:text,facts:empty}),text);
});
test("runtime is opt-in and financial service never receives model bank/amount/CPF parameters",()=>{
  const runtime=readFileSync("src/lib/ai-attendant.service.ts","utf8"),service=readFileSync("src/lib/opencredit-ai-simulation.service.ts","utf8");
  assert.match(runtime,/OPENCREDIT_CLT_AI_ENABLED === "true"/);
  assert.match(service,/mode: "maximum", amountBRL: ""/);assert.match(service,/OPENCREDIT_CLT_AI_BANK_ID/);
  assert.doesNotMatch(service,/fetch\(|createClient|bank-accounts|\/margem|\/proposals|\/select/);
  assert.match(service,/readCltFinancialFacts\(id,persisted.protectedFacts/);
});
