import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_RESPONSE_CONTEXT_LIMITS,
  buildAiResponseContext,
  InvalidAiResponseReplyError
} from "./ai-response-context";
import type { OpportunitySummary } from "./opportunity-summary-types";

type ContextDependencies = NonNullable<Parameters<typeof buildAiResponseContext>[1]>;

function message(
  overrides: Partial<{
    id: string;
    conversationId: string;
    direction: string;
    type: string;
    body: string;
    fileName: string | null;
    replyTo: {
      id: string;
      conversationId: string;
      direction: string;
      providerMessageId: string | null;
      type: string;
      body: string;
      fileName: string | null;
    } | null;
  }> = {}
) {
  return {
    id: overrides.id ?? "message-1",
    conversationId: overrides.conversationId ?? "conversation-1",
    direction: overrides.direction ?? "inbound",
    type: overrides.type ?? "text",
    body: overrides.body ?? "Quero entender as opcoes.",
    fileName: overrides.fileName ?? null,
    replyToProviderMessageId: null,
    replyPreviewType: null,
    replyPreviewBody: null,
    replyPreviewFileName: null,
    replyTo: overrides.replyTo ?? null
  };
}

function selectedReply(
  overrides: Partial<{
    id: string;
    conversationId: string;
    direction: string;
    type: string;
    body: string;
    fileName: string | null;
    companyId: string;
    channelId: string | null;
  }> = {}
) {
  return {
    id: overrides.id ?? "reply-1",
    conversationId: overrides.conversationId ?? "conversation-1",
    direction: overrides.direction ?? "inbound",
    type: overrides.type ?? "text",
    body: overrides.body ?? "Qual e a taxa?",
    fileName: overrides.fileName ?? null,
    conversation: {
      channelId: Object.prototype.hasOwnProperty.call(overrides, "channelId")
        ? overrides.channelId ?? null
        : "channel-1",
      contact: { companyId: overrides.companyId ?? "company-1" }
    }
  };
}

function dependencies(
  overrides: Partial<ContextDependencies> = {}
): ContextDependencies {
  return {
    async loadConversation() {
      return {
        id: "conversation-1",
        channelId: "channel-1",
        contact: {
          name: "Maria da Silva",
          stage: { name: "Qualificacao" },
          origin: { name: "WhatsApp" },
          owner: { name: "Ana" },
          tags: [{ tag: { name: "CLT" } }]
        },
        agent: { name: "Ana" },
        messages: [message()]
      };
    },
    async loadCompany() {
      return {
        name: "QEVORA",
        segment: "Credito",
        aiInstructions: "Atenda de forma objetiva."
      };
    },
    async loadSelectedReply() {
      return selectedReply();
    },
    async loadOpportunity() {
      return null;
    },
    ...overrides
  };
}

test("constroi contexto tenant-scoped e resolve reply interno sem exigir providerMessageId", async () => {
  let receivedReplyScope: unknown = null;
  const context = await buildAiResponseContext(
    {
      companyId: "company-1",
      conversationId: "conversation-1",
      replyToMessageId: "reply-1"
    },
    dependencies({
      async loadSelectedReply(scope) {
        receivedReplyScope = scope;
        return selectedReply();
      }
    })
  );

  assert.deepEqual(receivedReplyScope, {
    companyId: "company-1",
    conversationId: "conversation-1",
    channelId: "channel-1",
    messageId: "reply-1"
  });
  assert.deepEqual(context.selectedReply, {
    id: null,
    providerMessageId: null,
    direction: "inbound",
    type: "text",
    body: "Qual e a taxa?",
    fileName: null
  });
});

test("aceita reply outbound e preserva filename sem aceitar snapshot do navegador", async () => {
  const context = await buildAiResponseContext(
    {
      companyId: "company-1",
      conversationId: "conversation-1",
      replyToMessageId: "reply-1"
    },
    dependencies({
      async loadSelectedReply() {
        return selectedReply({
          direction: "outbound",
          type: "document",
          body: "Documento enviado",
          fileName: "proposta.pdf"
        });
      }
    })
  );

  assert.deepEqual(context.selectedReply, {
    id: null,
    providerMessageId: null,
    direction: "outbound",
    type: "document",
    body: "Documento enviado",
    fileName: "proposta.pdf"
  });
});

test("reply de audio selecionado nao vira falsa transcricao", async () => {
  const context = await buildAiResponseContext(
    {
      companyId: "company-1",
      conversationId: "conversation-1",
      replyToMessageId: "reply-1"
    },
    dependencies({
      async loadSelectedReply() {
        return selectedReply({
          type: "audio",
          body: "texto que nao e uma transcricao autorizada",
          fileName: "audio.ogg"
        });
      }
    })
  );

  assert.equal(context.selectedReply?.body, null);
  assert.equal(context.selectedReply?.fileName, "audio.ogg");
});

for (const [name, reply] of [
  ["outra empresa", selectedReply({ companyId: "company-2" })],
  ["outra conversa", selectedReply({ conversationId: "conversation-2" })],
  ["outro canal", selectedReply({ channelId: "channel-2" })],
  ["inexistente", null]
] as const) {
  test(`rejeita reply de ${name}`, async () => {
    await assert.rejects(
      buildAiResponseContext(
        {
          companyId: "company-1",
          conversationId: "conversation-1",
          replyToMessageId: "reply-1"
        },
        dependencies({ async loadSelectedReply() { return reply; } })
      ),
      InvalidAiResponseReplyError
    );
  });
}

test("mantem quoted reply historico limitado e nao trata audio como transcricao", async () => {
  const longBody = "x".repeat(1_500);
  const context = await buildAiResponseContext(
    { companyId: "company-1", conversationId: "conversation-1" },
    dependencies({
      async loadConversation() {
        return {
          id: "conversation-1",
          channelId: "channel-1",
          contact: {
            name: "Maria",
            stage: null,
            origin: null,
            owner: null,
            tags: []
          },
          agent: null,
          messages: [
            message({
              id: "message-2",
              direction: "outbound",
              body: "Resposta",
              replyTo: {
                id: "message-audio",
                conversationId: "conversation-1",
                direction: "inbound",
                providerMessageId: "wamid-audio",
                type: "audio",
                body: "transcricao que nao deve aparecer",
                fileName: "audio.ogg"
              }
            }),
            message({ id: "message-1", body: longBody })
          ]
        };
      }
    })
  );

  assert.equal(context.messages[0]?.body?.endsWith("…"), true);
  assert.deepEqual(context.messages[1]?.quotedReply, {
    id: null,
    providerMessageId: null,
    direction: "inbound",
    type: "audio",
    body: null,
    fileName: "audio.ogg"
  });
});

test("remove telefone, CPF e credenciais de todos os textos enviados ao prompt", async () => {
  const context = await buildAiResponseContext(
    { companyId: "company-1", conversationId: "conversation-1" },
    dependencies({
      async loadConversation() {
        return {
          id: "conversation-1",
          channelId: "channel-1",
          contact: {
            name: "Maria 529.982.247-25",
            stage: { name: "Telefone 11999998888" },
            origin: null,
            owner: null,
            tags: []
          },
          agent: null,
          messages: [
            message({
              body:
                "Meu CPF e 529.982.247-25 e telefone 11 99999-8888. accessToken=segredo"
            })
          ]
        };
      },
      async loadCompany() {
        return {
          name: "Empresa",
          segment: null,
          aiInstructions: "verifyToken=nao-expor appSecret=nao-expor"
        };
      }
    })
  );
  const serialized = JSON.stringify(context);

  assert.doesNotMatch(serialized, /529\.982\.247-25/);
  assert.doesNotMatch(serialized, /11999998888|11 99999-8888/);
  assert.doesNotMatch(serialized, /nao-expor|accessToken=segredo/);
  assert.match(serialized, /OMITIDO/);
});

test("aplica limite simultaneo de quantidade e caracteres ao historico", async () => {
  const context = await buildAiResponseContext(
    { companyId: "company-1", conversationId: "conversation-1" },
    dependencies({
      async loadConversation() {
        return {
          id: "conversation-1",
          channelId: "channel-1",
          contact: {
            name: "Maria",
            stage: null,
            origin: null,
            owner: null,
            tags: []
          },
          agent: null,
          messages: Array.from({ length: 30 }, (_, index) =>
            message({ id: `message-${index}`, body: "x".repeat(1_100) })
          )
        };
      }
    })
  );

  assert.ok(context.messages.length <= AI_RESPONSE_CONTEXT_LIMITS.messages);
  assert.ok(
    context.messages.reduce((total, item) => total + JSON.stringify(item).length, 0) <=
      AI_RESPONSE_CONTEXT_LIMITS.totalMessageCharacters
  );
});

test("projeta Observer como sinal e mantem somente fatos financeiros explicitos", async () => {
  const opportunity = {
    probableProduct: { label: "Credito CLT" },
    commercialState: { label: "Proposta" },
    priority: { label: "Alta" },
    recommendedAction: { label: "Revisar proposta" },
    pendingReturn: { title: "Retornar ao cliente" },
    activeProposal: {
      product: "Credito CLT",
      status: "APPROVED",
      amount: "15000.00"
    }
  } as OpportunitySummary;
  const context = await buildAiResponseContext(
    { companyId: "company-1", conversationId: "conversation-1" },
    dependencies({ async loadOpportunity() { return opportunity; } })
  );

  assert.equal(context.opportunity.probableProductIsInference, true);
  assert.deepEqual(context.financialFacts.proposalAmounts, ["15000.00"]);
  assert.deepEqual(context.financialFacts.proposalStatuses, ["APPROVED"]);
  assert.deepEqual(context.financialFacts.proposalProducts, ["Credito CLT"]);
  assert.deepEqual(context.financialFacts.proposalBanks, []);
  assert.deepEqual(context.financialFacts.rates, []);
  assert.deepEqual(context.financialFacts.margins, []);
});
