import assert from "node:assert/strict";
import test from "node:test";
import {
  phonesMatch,
  resolveReferencedInboundMessage,
  resolveReferencedInboundConversation
} from "./inbound-message-resolution";

test("reutiliza conversa referenciada do mesmo canal mesmo com telefone em formato diferente", () => {
  const result = resolveReferencedInboundMessage({
    message: {
      direction: "outbound",
      conversation: {
        channelId: "channel-a",
        contact: { phone: "+55 (47) 98421-7011" }
      }
    },
    channelId: "channel-a",
    incomingPhone: "5547984217011"
  });

  assert.equal(result.shouldUseReferencedConversation, true);
  assert.equal(result.channelMatched, true);
  assert.equal(result.phoneMatched, true);
});

test("nao reutiliza contexto quando mensagem referenciada nao e outbound", () => {
  const result = resolveReferencedInboundMessage({
    message: {
      direction: "inbound",
      conversation: {
        channelId: "channel-a",
        contact: { phone: "5547984217011" }
      }
    },
    channelId: "channel-a",
    incomingPhone: "5547984217011"
  });

  assert.equal(result.shouldUseReferencedConversation, false);
  assert.equal(result.channelMatched, false);
  assert.equal(result.phoneMatched, false);
});

test("prioriza conversa referenciada do mesmo canal mesmo quando telefone nao bate", () => {
  const result = resolveReferencedInboundConversation({
    conversation: {
      channelId: "channel-a",
      contact: { phone: "47984217011" }
    },
    channelId: "channel-a",
    incomingPhone: "5511999999999"
  });

  assert.equal(result.shouldUseReferencedConversation, true);
  assert.equal(result.channelMatched, true);
  assert.equal(result.phoneMatched, false);
});

test("nao reutiliza conversa referenciada quando channelId esta ausente", () => {
  const result = resolveReferencedInboundConversation({
    conversation: {
      channelId: "channel-a",
      contact: { phone: "5547984217011" }
    },
    channelId: null,
    incomingPhone: "5547984217011"
  });

  assert.equal(result.shouldUseReferencedConversation, false);
  assert.equal(result.channelMatched, false);
  assert.equal(result.phoneMatched, true);
});

test("nao reutiliza contexto de outro canal", () => {
  const result = resolveReferencedInboundConversation({
    conversation: {
      channelId: "channel-a",
      contact: { phone: "5547984217011" }
    },
    channelId: "channel-b",
    incomingPhone: "5547984217011"
  });

  assert.equal(result.shouldUseReferencedConversation, false);
  assert.equal(result.channelMatched, false);
  assert.equal(result.phoneMatched, true);
});

test("nao reutiliza conversa quando nao ha mensagem referenciada", () => {
  const result = resolveReferencedInboundConversation({
    conversation: null,
    channelId: "channel-a",
    incomingPhone: "5547984217011"
  });

  assert.equal(result.shouldUseReferencedConversation, false);
  assert.equal(result.channelMatched, false);
  assert.equal(result.phoneMatched, false);
});

test("compara telefone com DDI e formato legado ja suportado", () => {
  assert.equal(phonesMatch("+55 (47) 98421-7011", "47984217011"), true);
  assert.equal(phonesMatch("5547984217011", "+55 47 98421-7011"), true);
  assert.equal(phonesMatch("5547984217011", "5511999999999"), false);
});
