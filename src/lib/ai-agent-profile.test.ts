import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidAiAgentProfileError,
  parseAiAgentProfile
} from "./ai-agent-profile";

test("ai-agent-profile aceita CLT", () => {
  assert.equal(parseAiAgentProfile("CLT"), "CLT");
});

test("ai-agent-profile aceita ausencia como null", () => {
  assert.equal(parseAiAgentProfile(null), null);
  assert.equal(parseAiAgentProfile(undefined), null);
  assert.equal(parseAiAgentProfile(""), null);
  assert.equal(parseAiAgentProfile("   "), null);
});

test("ai-agent-profile rejeita perfis desconhecidos", () => {
  for (const value of [
    "FGTS",
    "INSS",
    "clt",
    "clt-invalido",
    "AUTO"
  ]) {
    assert.throws(
      () => parseAiAgentProfile(value),
      InvalidAiAgentProfileError
    );
  }
});

test("ai-agent-profile rejeita valores nao textuais", () => {
  assert.throws(
    () => parseAiAgentProfile(123),
    InvalidAiAgentProfileError
  );
});
