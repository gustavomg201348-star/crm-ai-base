import assert from "node:assert/strict";
import test from "node:test";
import { parseCompanyAiSettingsUpdate, resolveCltCheckAutoReply } from "./company-ai-settings";
import { classifyOpenCreditTemplateButton } from "./opencredit-whatsapp-button-policy";

test("the per-company override takes precedence over the exact historical environment setting", () => {
  assert.equal(resolveCltCheckAutoReply(null, "true"), true);
  assert.equal(resolveCltCheckAutoReply(null, "false"), false);
  assert.equal(resolveCltCheckAutoReply(null, "TRUE"), false);
  assert.equal(resolveCltCheckAutoReply(null, undefined), false);
  assert.equal(resolveCltCheckAutoReply(false, "true"), false);
  assert.equal(resolveCltCheckAutoReply(true, undefined), true);
});

test("a settings patch can update one field without replacing the other controls", () => {
  assert.deepEqual(parseCompanyAiSettingsUpdate({ checkAutoReplyOverride: false }), { cltCheckAutoReplyEnabled: false });
  assert.deepEqual(parseCompanyAiSettingsUpdate({ checkAutoReplyOverride: null }), { cltCheckAutoReplyEnabled: null });
  for (const mode of ["OFF", "COPILOT", "AUTO", "HYBRID"]) {
    assert.deepEqual(parseCompanyAiSettingsUpdate({ mode, instructions: "  política  " }), { aiMode: mode, aiInstructions: "política" });
  }
  for (const bad of [{}, [], { mode: "invalid" }, { instructions: null }, { checkAutoReplyOverride: "true" }, { companyId: "other", mode: "AUTO" }]) {
    assert.equal(parseCompanyAiSettingsUpdate(bad), null);
  }
});

test("Conferir and Verificar share the fixed reply while Bloquear remains independent", () => {
  for (const body of ["Conferir", "Verificar"]) {
    assert.equal(classifyOpenCreditTemplateButton({ type: "button", body }), "CHECK");
    assert.equal(classifyOpenCreditTemplateButton({ type: "text", body }), "CHECK");
  }
  assert.equal(classifyOpenCreditTemplateButton({ type: "button", body: "Bloquear" }), "BLOCK");
  assert.equal(classifyOpenCreditTemplateButton({ type: "text", body: "Vou conferir depois." }), null);
});
