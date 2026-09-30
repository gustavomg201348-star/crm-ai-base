import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  REPLY_PREVIEW_BODY_MAX_GRAPHEMES,
  buildInboundReplyFields,
  buildReplySnapshot,
  mapQuotedReply,
  truncateReplyPreviewBody,
  type ReplySourceMessage
} from "./message-reply";

function sourceMessage(
  overrides: Partial<ReplySourceMessage> = {}
): ReplySourceMessage {
  return {
    id: overrides.id ?? "message-original",
    conversationId: overrides.conversationId ?? "conversation-a",
    direction: overrides.direction ?? "outbound",
    providerMessageId: overrides.providerMessageId ?? "wamid-original",
    type: overrides.type ?? "text",
    body: overrides.body ?? "Qual o valor da parcela?",
    fileName: overrides.fileName ?? null,
    conversation: overrides.conversation ?? {
      channelId: "channel-a",
      contact: { companyId: "company-a" }
    }
  };
}

function resolve(overrides: {
  contextProviderMessageId?: string | null;
  referencedMessage?: ReplySourceMessage | null;
  companyId?: string;
  conversationId?: string;
  channelId?: string | null;
} = {}) {
  return buildInboundReplyFields({
    contextProviderMessageId:
      overrides.contextProviderMessageId === undefined
        ? "wamid-original"
        : overrides.contextProviderMessageId,
    referencedMessage:
      overrides.referencedMessage === undefined
        ? sourceMessage()
        : overrides.referencedMessage,
    companyId: overrides.companyId ?? "company-a",
    conversationId: overrides.conversationId ?? "conversation-a",
    channelId: overrides.channelId === undefined ? "channel-a" : overrides.channelId
  });
}

test("persiste relacao, id externo e snapshot para contexto inbound valido", () => {
  assert.deepEqual(resolve(), {
    replyToMessageId: "message-original",
    replyToProviderMessageId: "wamid-original",
    replyPreviewType: "text",
    replyPreviewBody: "Qual o valor da parcela?",
    replyPreviewFileName: null
  });
});

test("nao cria relacao local entre empresas", () => {
  assert.equal(resolve({ companyId: "company-b" }).replyToMessageId, null);
});

test("nao cria relacao local entre conversas", () => {
  assert.equal(resolve({ conversationId: "conversation-b" }).replyToMessageId, null);
});

test("nao cria relacao local entre canais", () => {
  assert.equal(resolve({ channelId: "channel-b" }).replyToMessageId, null);
  assert.equal(resolve({ channelId: null }).replyToMessageId, null);
});

test("contexto desconhecido preserva somente a referencia externa", () => {
  assert.deepEqual(resolve({ referencedMessage: null }), {
    replyToMessageId: null,
    replyToProviderMessageId: "wamid-original",
    replyPreviewType: null,
    replyPreviewBody: null,
    replyPreviewFileName: null
  });
});

test("mensagem original inbound nao cria relacao local", () => {
  const result = resolve({ referencedMessage: sourceMessage({ direction: "inbound" }) });

  assert.equal(result.replyToMessageId, null);
  assert.equal(result.replyToProviderMessageId, "wamid-original");
});

test("contexto ausente mantem mensagem como legado sem reply", () => {
  assert.deepEqual(resolve({ contextProviderMessageId: null, referencedMessage: null }), {
    replyToMessageId: null,
    replyToProviderMessageId: null,
    replyPreviewType: null,
    replyPreviewBody: null,
    replyPreviewFileName: null
  });
  assert.equal(mapQuotedReply({}), null);
});

test("trunca preview de texto sem quebrar caracteres Unicode", () => {
  const value = "🙂".repeat(REPLY_PREVIEW_BODY_MAX_GRAPHEMES + 1);
  const preview = truncateReplyPreviewBody(value);

  assert.ok(preview);
  assert.equal(Array.from(new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(preview)).length, REPLY_PREVIEW_BODY_MAX_GRAPHEMES);
  assert.equal(preview.endsWith("…"), true);
  assert.equal(value.length > preview.length, true);
});

test("snapshot de documento preserva nome do arquivo", () => {
  assert.deepEqual(
    buildReplySnapshot({
      type: "document",
      body: "Contrato para assinatura",
      fileName: "contrato.pdf"
    }),
    {
      replyPreviewType: "document",
      replyPreviewBody: "Contrato para assinatura",
      replyPreviewFileName: "contrato.pdf"
    }
  );
});

test("snapshot de audio nao inventa texto", () => {
  assert.deepEqual(buildReplySnapshot({ type: "audio", body: "[Audio recebido]" }), {
    replyPreviewType: "audio",
    replyPreviewBody: null,
    replyPreviewFileName: null
  });
});

test("DTO prioriza a relacao local e limita o corpo original", () => {
  const mapped = mapQuotedReply({
    conversationId: "conversation-a",
    replyToProviderMessageId: "wamid-snapshot",
    replyPreviewType: "document",
    replyPreviewBody: "Snapshot",
    replyPreviewFileName: "snapshot.pdf",
    replyTo: {
      id: "message-original",
      conversationId: "conversation-a",
      providerMessageId: "wamid-original",
      type: "text",
      body: "Original",
      fileName: null
    }
  });

  assert.deepEqual(mapped, {
    id: "message-original",
    providerMessageId: "wamid-original",
    type: "text",
    body: "Original",
    fileName: null
  });
});

test("DTO nao expoe relacao local de outra conversa", () => {
  assert.deepEqual(
    mapQuotedReply({
      conversationId: "conversation-a",
      replyToProviderMessageId: "wamid-snapshot",
      replyPreviewType: "text",
      replyPreviewBody: "Snapshot seguro",
      replyPreviewFileName: null,
      replyTo: {
        id: "message-other",
        conversationId: "conversation-b",
        providerMessageId: "wamid-other",
        type: "text",
        body: "Conteudo de outra conversa",
        fileName: null
      }
    }),
    {
      id: null,
      providerMessageId: "wamid-snapshot",
      type: "text",
      body: "Snapshot seguro",
      fileName: null
    }
  );
});

test("DTO usa snapshot quando a relacao local nao existe", () => {
  assert.deepEqual(
    mapQuotedReply({
      replyToProviderMessageId: "wamid-original",
      replyPreviewType: "document",
      replyPreviewBody: "Contrato",
      replyPreviewFileName: "contrato.pdf",
      replyTo: null
    }),
    {
      id: null,
      providerMessageId: "wamid-original",
      type: "document",
      body: "Contrato",
      fileName: "contrato.pdf"
    }
  );
});

test("idempotencia continua antes da resolucao de contexto", () => {
  const source = readFileSync("src/lib/inbound-message.ts", "utf8");

  assert.ok(source.indexOf("if (providerMessageId)") < source.indexOf("const referencedMessage"));
  assert.ok(source.indexOf("const referencedMessage") < source.indexOf("prisma.message.create"));
});

test("status continua correlacionado pelo providerMessageId da propria mensagem", () => {
  const source = readFileSync("src/lib/message-delivery.ts", "utf8");

  assert.match(source, /buildMessageDeliveryScope\(\{ companyId, channelId, providerMessageId \}\)/);
  assert.doesNotMatch(source, /replyToProviderMessageId/);
});

test("schema usa SET NULL e preserva snapshots sem alterar indice provider existente", () => {
  const migration = readFileSync(
    "prisma/migrations/20260925180000_add_message_reply_foundation/migration.sql",
    "utf8"
  );

  assert.match(migration, /ON DELETE SET NULL/);
  assert.match(migration, /replyPreviewBody/);
  assert.doesNotMatch(migration, /DROP INDEX/);
  assert.doesNotMatch(migration, /Message_providerMessageId/);
});
