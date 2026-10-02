import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMetaTextMessagePayload } from "./meta-whatsapp";
import {
  InvalidMessageReplyError,
  resolveOutboundReplyContext
} from "./outbound-message-reply";
import type { ReplySourceMessage } from "./message-reply";

function sourceMessage(
  overrides: Partial<ReplySourceMessage> = {}
): ReplySourceMessage {
  return {
    id: overrides.id ?? "message-original",
    conversationId: overrides.conversationId ?? "conversation-a",
    direction: overrides.direction ?? "inbound",
    providerMessageId: Object.prototype.hasOwnProperty.call(
      overrides,
      "providerMessageId"
    )
      ? overrides.providerMessageId
      : "wamid-original",
    type: overrides.type ?? "text",
    body: overrides.body ?? "Qual o valor da parcela?",
    fileName: overrides.fileName ?? null,
    conversation: overrides.conversation ?? {
      channelId: "channel-a",
      contact: { companyId: "company-a" }
    }
  };
}

const validScope = {
  replyToMessageId: "message-original",
  companyId: "company-a",
  conversationId: "conversation-a",
  channelId: "channel-a"
};

test("reply valido resolve wamid e snapshot usando escopo interno", async () => {
  let receivedScope: Record<string, string> | null = null;
  const result = await resolveOutboundReplyContext({
    ...validScope,
    findSource: async (scope) => {
      receivedScope = scope;
      return sourceMessage();
    }
  });

  assert.deepEqual(receivedScope, {
    messageId: "message-original",
    companyId: "company-a",
    conversationId: "conversation-a",
    channelId: "channel-a"
  });
  assert.deepEqual(result, {
    contextMessageId: "wamid-original",
    fields: {
      replyToMessageId: "message-original",
      replyToProviderMessageId: "wamid-original",
      replyPreviewType: "text",
      replyPreviewBody: "Qual o valor da parcela?",
      replyPreviewFileName: null
    }
  });
});

for (const [name, overrides] of [
  ["outra empresa", { conversation: { channelId: "channel-a", contact: { companyId: "company-b" } } }],
  ["outra conversa", { conversationId: "conversation-b" }],
  ["outro canal", { conversation: { channelId: "channel-b", contact: { companyId: "company-a" } } }],
  ["sem providerMessageId", { providerMessageId: null }]
] satisfies Array<[string, Partial<ReplySourceMessage>]>) {
  test(`reply ${name} e rejeitado sem fallback silencioso`, async () => {
    await assert.rejects(
      resolveOutboundReplyContext({
        ...validScope,
        findSource: async () => sourceMessage(overrides)
      }),
      InvalidMessageReplyError
    );
  });
}

test("mensagem inexistente e channel ausente sao rejeitados com o mesmo erro seguro", async () => {
  await assert.rejects(
    resolveOutboundReplyContext({
      ...validScope,
      findSource: async () => null
    }),
    InvalidMessageReplyError
  );
  await assert.rejects(
    resolveOutboundReplyContext({
      ...validScope,
      channelId: null,
      findSource: async () => {
        throw new Error("lookup nao deveria ocorrer");
      }
    }),
    InvalidMessageReplyError
  );
});

test("envio normal nao cria context e reply cria somente context.message_id validado", () => {
  assert.deepEqual(
    buildMetaTextMessagePayload({ to: "5511999999999", body: "Normal" }),
    {
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "text",
      text: { body: "Normal" }
    }
  );
  assert.deepEqual(
    buildMetaTextMessagePayload({
      to: "5511999999999",
      body: "Resposta",
      contextMessageId: "wamid-original"
    }),
    {
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "text",
      text: { body: "Resposta" },
      context: { message_id: "wamid-original" }
    }
  );
});

test("browser fornece somente ID interno e rotas persistem o novo wamid com o reply validado", () => {
  const page = readFileSync("src/app/page.tsx", "utf8");
  const channelRoute = readFileSync(
    "src/app/api/channels/[id]/messages/route.ts",
    "utf8"
  );
  const conversationRoute = readFileSync(
    "src/app/api/conversations/[id]/messages/route.ts",
    "utf8"
  );

  assert.match(page, /replyToMessageId/);
  assert.doesNotMatch(page, /replyToProviderMessageId\s*:/);
  for (const route of [channelRoute, conversationRoute]) {
    assert.match(route, /resolveOutboundReplyContext/);
    assert.match(route, /contextMessageId: reply\?\.contextMessageId/);
    assert.match(route, /providerMessageId/);
  }
  assert.ok(
    conversationRoute.indexOf("const sent = await sendMetaTextMessage") <
      conversationRoute.indexOf("const updated = await saveOutboundMessage")
  );
});
