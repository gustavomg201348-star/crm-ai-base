import assert from "node:assert/strict";
import test from "node:test";
import { resolveInboundContextReference } from "./inbound-message-resolution";

function referencedMessage(overrides: {
  direction?: string;
  companyId?: string;
  channelId?: string | null;
} = {}) {
  return {
    direction: overrides.direction ?? "outbound",
    conversation: {
      channelId: overrides.channelId === undefined ? "channel-1" : overrides.channelId,
      contact: {
        companyId: overrides.companyId ?? "company-1"
      }
    }
  };
}

test("context.id aceita somente outbound da mesma empresa e mesmo canal", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-1",
    contextProviderMessageId: "wamid.outbound-1",
    referencedMessage: referencedMessage(),
    phoneMatched: true
  });

  assert.equal(result.reusable, true);
  assert.equal(result.reason, "MATCHED");
});

test("context.id apontando para inbound nao reutiliza conversa", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-1",
    contextProviderMessageId: "wamid.inbound-1",
    referencedMessage: referencedMessage({ direction: "inbound" }),
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "REFERENCED_MESSAGE_NOT_OUTBOUND");
});

test("context.id sem channelId da mensagem inbound cai em fallback seguro", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: null,
    contextProviderMessageId: "wamid.outbound-1",
    referencedMessage: referencedMessage(),
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "MISSING_CHANNEL_ID");
});

test("context.id de outro canal nao reutiliza conversa", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-2",
    contextProviderMessageId: "wamid.outbound-1",
    referencedMessage: referencedMessage(),
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "CHANNEL_MISMATCH");
});

test("context.id com conversa referenciada sem channelId nao reutiliza conversa", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-1",
    contextProviderMessageId: "wamid.outbound-1",
    referencedMessage: referencedMessage({ channelId: null }),
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "REFERENCED_CONVERSATION_WITHOUT_CHANNEL");
});

test("context.id de outra empresa nao reutiliza conversa", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-1",
    contextProviderMessageId: "wamid.outbound-1",
    referencedMessage: referencedMessage({ companyId: "company-2" }),
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "COMPANY_MISMATCH");
});

test("context.id inexistente cai em fallback seguro", () => {
  const result = resolveInboundContextReference({
    companyId: "company-1",
    channelId: "channel-1",
    contextProviderMessageId: "wamid.missing",
    referencedMessage: null,
    phoneMatched: true
  });

  assert.equal(result.reusable, false);
  assert.equal(result.reason, "REFERENCED_MESSAGE_NOT_FOUND");
});
