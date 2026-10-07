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
          id: "contact-1", cpf: null, phone: "", email: null,
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
    async loadProposals() { return []; },
    async loadCurrentMessage() { return selectedReply({ id: "message-1", body: "Quero entender as opcoes." }); },
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
      async loadCurrentMessage() { return selectedReply({ id: "current-outside-history" }); },
      async loadConversation() {
        return {
          id: "conversation-1",
          channelId: "channel-1",
          contact: {
            id: "contact-1", cpf: null, phone: "", email: null,
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
            id: "contact-1", cpf: null, phone: "", email: null,
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
            id: "contact-1", cpf: null, phone: "", email: null,
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
  assert.equal(context.financialFacts.proposal, null);
  assert.deepEqual(context.financialFacts.proposalAmounts, []);
  assert.deepEqual(context.financialFacts.proposalStatuses, []);
  assert.deepEqual(context.financialFacts.proposalProducts, []);
  assert.deepEqual(context.financialFacts.proposalBanks, []);
  assert.deepEqual(context.financialFacts.rates, []);
  assert.deepEqual(context.financialFacts.margins, []);
});

test("disponibilidade cadastral nao expoe CPF, telefone ou email", async () => {
  const deps = dependencies();
  const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
  conversation.contact.cpf = "529.982.247-25";
  conversation.contact.phone = "11999998888";
  conversation.contact.email = "smoke@example.invalid";
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" },
    dependencies({ async loadConversation() { return conversation; } }));
  assert.deepEqual(context.customerFacts, { hasCpf: true, hasLocallyValidCpf: true, hasPhone: true, hasEmail: true, hasResponsibleAgent: true });
  assert.doesNotMatch(JSON.stringify(context), /529|11999998888|smoke@example/);
});

test("current inbound e independente da janela de historico e preserva trigger", async () => {
  let receivedScope: unknown;
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1", triggerMessageId: "trigger" },
    dependencies({ async loadCurrentMessage(scope) {
      receivedScope = scope;
      return selectedReply({ id: "trigger", body: "Quanto libera? Meu CPF e 529.982.247-25, email smoke@example.invalid" });
    } }));
  assert.deepEqual(receivedScope, { companyId: "company-1", conversationId: "conversation-1", channelId: "channel-1", messageId: "trigger" });
  assert.match(context.currentCustomerMessage!.body!, /Quanto libera/);
  assert.doesNotMatch(context.currentCustomerMessage!.body!, /529|smoke@example/);
  assert.doesNotMatch(JSON.stringify(context), /"trigger"/);
});

for (const [name, current] of [
  ["tenant", selectedReply({ id: "trigger", companyId: "company-2" })],
  ["conversa", selectedReply({ id: "trigger", conversationId: "conversation-2" })],
  ["canal", selectedReply({ id: "trigger", channelId: "channel-2" })],
  ["outbound", selectedReply({ id: "trigger", direction: "outbound" })],
  ["id", selectedReply({ id: "outro" })], ["ausente", null]
] as const) {
  test(`current trigger ${name} invalido e rejeitado antes do provider`, async () => {
    await assert.rejects(buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1", triggerMessageId: "trigger" },
      dependencies({ async loadCurrentMessage() { return current; } })), InvalidAiResponseReplyError);
  });
}

test("proposal reads recebem company/contact e projeção nao usa amount da Observadora", async () => {
  let scope: unknown;
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" }, dependencies({
    async loadProposals(input) { scope = input; return []; },
    async loadOpportunity() { return { probableProduct: { label: "CLT" }, commercialState: { label: "Proposta" },
      priority: { label: "Alta" }, recommendedAction: { label: "Revisar" },
      activeProposal: { product: "CLT", status: "APPROVED", amount: "99999" } } as OpportunitySummary; }
  }));
  assert.deepEqual(scope, { companyId: "company-1", contactId: "contact-1" });
  assert.equal(context.proposalFacts, null); assert.equal(context.financialFacts.proposal, null);
  assert.doesNotMatch(JSON.stringify(context), /99999/);
});

test("produto informado no historico evita perguntar novamente sem autorizar valor", async () => {
  const deps = dependencies();
  const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
  conversation.messages = [message({ id: "historical", body: "Quero consultar CLT." })];
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" }, dependencies({
    async loadConversation() { return conversation; },
    async loadCurrentMessage() { return selectedReply({ body: "Quanto libera?" }); }
  }));
  assert.equal(context.productFacts.requestedProduct, "CLT");
  assert.equal(context.responseGoal.action, "HUMAN_VALIDATION");
  assert.equal(context.responseGoal.nextRequiredInformation, null);
  assert.equal(context.financialFacts.proposal, null);
});

test("sem CPF/telefone/email cadastrado todos os booleanos refletem ausencia", async () => {
  const deps = dependencies();
  const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
  conversation.contact.owner = null; conversation.agent = null;
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" },
    dependencies({ async loadConversation() { return conversation; } }));
  assert.deepEqual(context.customerFacts, { hasCpf: false, hasLocallyValidCpf: false, hasPhone: false, hasEmail: false, hasResponsibleAgent: false });
});

for (const text of ["CLT ou FGTS", "Nao quero CLT", "sem CLT"]) {
  test(`contexto nao usa historico para escolher produto: ${text}`, async () => {
    const deps = dependencies();
    const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
    conversation.messages = [message({ id: "old", body: "Quero CLT" })];
    const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" }, dependencies({
      async loadConversation() { return conversation; },
      async loadCurrentMessage() { return selectedReply({ id: "current", body: text }); },
      async loadProposals() { return [{ companyId: "company-1", contactId: "contact-1", product: "CLT", bank: "Teste",
        status: "DRAFT", amount: "1000", financedAmount: null, releasedAmount: null, installmentAmount: null, term: null,
        createdAt: new Date(), updatedAt: new Date() }]; }
    }));
    assert.equal(context.productFacts.requestedProduct, null);
    assert.equal(context.proposalFacts, null); assert.equal(context.financialFacts.proposal, null);
    assert.equal(context.responseGoal.shouldTransferToHuman, true);
  });
}
test("dedupe current por id preserva outras mensagens com texto igual e ordem", async () => {
  const deps = dependencies();
  const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
  conversation.messages = [message({ id: "outbound", direction: "outbound", body: "Resposta anterior" }),
    message({ id: "current", body: "Texto igual" }), message({ id: "other", body: "Texto igual" })];
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" }, dependencies({
    async loadConversation() { return conversation; },
    async loadCurrentMessage() { return selectedReply({ id: "current", body: "Texto igual" }); }
  }));
  assert.deepEqual(context.messages.map((item) => item.body), ["Texto igual", "Resposta anterior"]);
  assert.equal(context.currentCustomerMessage?.body, "Texto igual");
});
test("CPF cadastrado invalido indica presenca sem validade nem pedido de documento", async () => {
  const deps = dependencies();
  const conversation = (await deps.loadConversation({ companyId: "company-1", conversationId: "conversation-1" }))!;
  conversation.contact.cpf = "invalido";
  const context = await buildAiResponseContext({ companyId: "company-1", conversationId: "conversation-1" }, dependencies({
    async loadConversation() { return conversation; },
    async loadCurrentMessage() { return selectedReply({ body: "Meu CPF esta cadastrado?" }); }
  }));
  assert.equal(context.customerFacts.hasCpf, true); assert.equal(context.customerFacts.hasLocallyValidCpf, false);
  assert.match(context.responseGoal.safeReply, /ja esta cadastrado/);
  assert.doesNotMatch(context.responseGoal.safeReply, /envie|nao tem CPF|invalido/i);
  assert.doesNotMatch(JSON.stringify(context.customerFacts), /invalido/);
});
