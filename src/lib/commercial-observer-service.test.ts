import assert from "node:assert/strict";
import test from "node:test";
import {
  callCommercialObserverModel,
  CommercialObserverError,
  enforceCommercialObserverResultSafety,
  loadCommercialObserverContext,
  normalizeCommercialObserverResult
} from "./commercial-observer-service";

const baseDate = new Date("2026-08-11T12:00:00.000Z");

function createMockDb(overrides: Record<string, unknown> = {}) {
  const messages = Array.from({ length: 45 }, (_, index) => ({
    id: `message-${index}`,
    direction: index % 2 === 0 ? "inbound" : "outbound",
    senderType: index % 2 === 0 ? "customer" : "agent",
    type: "text",
    body: `Mensagem comercial ${index}`,
    createdAt: new Date(baseDate.getTime() + index * 1000)
  })).reverse();

  const db = {
    conversation: {
      findFirst: () =>
        Promise.resolve({
          id: "conversation-1",
          contactId: "contact-1",
          status: "OPEN",
          channel: "whatsapp",
          channelId: "channel-1",
          createdAt: baseDate,
          updatedAt: baseDate,
          contact: {
            id: "contact-1",
            name: "Cliente Teste",
            phone: "+5547999991234",
            cpf: "000.000.000-00",
            temperature: "WARM",
            origin: { name: "Campanha" },
            stage: { name: "Atendimento" },
            tags: [{ tag: { name: "FGTS" } }]
          },
          agent: { name: "Laura Pereira" },
          channelRef: { name: "WhatsApp 8199" },
          messages
        })
    },
    company: {
      findUnique: () =>
        Promise.resolve({
          segment: "Correspondente bancario",
          aiInstructions: "Priorizar evidencias recentes."
        })
    },
    task: {
      findMany: () =>
        Promise.resolve([{ title: "Retornar cliente", status: "PENDING", dueAt: baseDate }])
    },
    proposal: {
      findMany: () =>
        Promise.resolve([
          {
            product: "FGTS",
            status: "FORMALIZING",
            amount: { toString: () => "1200" },
            releasedAmount: null,
            paidAt: null,
            updatedAt: baseDate
          }
        ])
    },
    campaignRecipient: {
      findMany: () =>
        Promise.resolve([
          {
            status: "SENT",
            sentAt: baseDate,
            deliveredAt: null,
            updatedAt: baseDate,
            campaign: {
              name: "Campanha FGTS",
              templateName: "fgts_disponivel",
              channel: { name: "WhatsApp 8199" }
            }
          }
        ])
    },
    ...overrides
  };

  return db as never;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("loadCommercialObserverContext limita mensagens e nao inclui CPF ou telefone completo", async () => {
  const context = await loadCommercialObserverContext({
    conversationId: "conversation-1",
    companyId: "company-1",
    db: createMockDb()
  });

  assert.equal(context.recentMessages.length, 40);
  assert.equal(context.contact.name, "Cliente");
  assert.equal(context.contact.phoneLast4, "1234");
  assert.equal(context.contact.hasPhone, true);
  assert.equal(JSON.stringify(context).includes("000.000.000-00"), false);
  assert.equal(JSON.stringify(context).includes("+5547999991234"), false);
  assert.equal(context.limitations.includes("Analise limitada as ultimas 40 mensagens."), true);
});

test("enforceCommercialObserverResultSafety remove PII do summary e rebaixa contexto artificial", async () => {
  const input = await loadCommercialObserverContext({
    conversationId: "conversation-1",
    companyId: "company-1",
    db: createMockDb({
      conversation: {
        findFirst: () =>
          Promise.resolve({
            id: "conversation-1",
            contactId: "contact-1",
            status: "OPEN",
            channel: "whatsapp",
            channelId: "channel-1",
            createdAt: baseDate,
            updatedAt: baseDate,
            contact: {
              id: "contact-1",
              name: "Cliente Teste",
              phone: "+5547999991234",
              temperature: "WARM",
              origin: null,
              stage: null,
              tags: []
            },
            agent: null,
            channelRef: null,
            messages: [
              {
                id: "message-1",
                direction: "inbound",
                senderType: "customer",
                type: "text",
                body: "mensagem realtime sse",
                createdAt: baseDate
              }
            ]
          })
      }
    })
  });

  const result = enforceCommercialObserverResultSafety({
    input,
    result: {
      version: 1,
      summary: "Cliente Teste pediu retorno pelo telefone +55 47 99999-1234.",
      stage: { value: "INTEREST", confidence: 0.8, evidence: ["mensagem"] },
      interest: { value: "MEDIUM", confidence: 0.7, evidence: ["mensagem"] },
      objection: { value: null, confidence: 0, evidence: [] },
      customerNeed: { value: "credito", confidence: 0.6, evidence: ["mensagem"] },
      risk: { value: "LOW", confidence: 0.6, reasons: ["ativo"] },
      nextBestAction: {
        action: "FOLLOW_UP",
        reason: "Retomar contato.",
        suggestedAt: null,
        confidence: 0.7
      },
      limitations: []
    }
  });

  assert.equal(result.summary.includes("+55"), false);
  assert.equal(result.stage.value, "UNKNOWN");
  assert.equal(result.interest.value, "UNKNOWN");
  assert.equal(result.customerNeed.value, null);
  assert.equal(result.nextBestAction.action, "NO_ACTION");
  assert.equal(
    result.limitations.includes("Contexto insuficiente para classificacao comercial confiavel."),
    true
  );
});

test("loadCommercialObserverContext rejeita conversa inexistente", async () => {
  const db = createMockDb({
    conversation: { findFirst: () => Promise.resolve(null) }
  });

  await assert.rejects(
    () =>
      loadCommercialObserverContext({
        conversationId: "missing",
        companyId: "company-1",
        db
      }),
    (error) => error instanceof CommercialObserverError && error.code === "NOT_FOUND"
  );
});

test("normalizeCommercialObserverResult preserva contrato v1 e normaliza confidence", () => {
  const result = normalizeCommercialObserverResult({
    version: 1,
    summary: "Cliente pediu simulacao.",
    stage: { value: "SIMULATION", confidence: 2, evidence: ["pediu simulacao"] },
    interest: { value: "HIGH", confidence: 0.8, evidence: ["quer simular"] },
    objection: { value: "taxa", confidence: 0.5, evidence: ["perguntou taxa"] },
    customerNeed: { value: "credito FGTS", confidence: 0.7, evidence: ["FGTS"] },
    risk: { value: "LOW", confidence: -1, reasons: ["sem atraso"] },
    nextBestAction: {
      action: "SEND_SIMULATION",
      reason: "Cliente pediu valores.",
      suggestedAt: null,
      confidence: 0.9
    },
    limitations: []
  });

  assert.equal(result?.stage.value, "SIMULATION");
  assert.equal(result?.stage.confidence, 1);
  assert.equal(result?.risk.confidence, 0);
  assert.equal(result?.nextBestAction.action, "SEND_SIMULATION");
});

test("callCommercialObserverModel retorna UNKNOWN quando a saida foge do contrato", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const fetchImpl = async () =>
    Response.json({
      output_text: "texto livre sem JSON"
    });

  const result = await callCommercialObserverModel({
    input: await loadCommercialObserverContext({
      conversationId: "conversation-1",
      companyId: "company-1",
      db: createMockDb()
    }),
    fetchImpl: fetchImpl as typeof fetch
  });

  restoreEnv("OPENAI_API_KEY", originalKey);

  assert.equal(result.version, 1);
  assert.equal(result.stage.value, "UNKNOWN");
  assert.equal(
    result.limitations.includes("A IA retornou uma saida fora do contrato estruturado."),
    true
  );
});

test("callCommercialObserverModel usa JSON Schema e aceita fechamento claro estruturado", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  let requestBody: Record<string, unknown> = {};

  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}"));
    return Response.json({
      output_text: JSON.stringify({
        version: 1,
        summary: "Cliente confirmou fechamento com evidencia explicita.",
        stage: {
          value: "CLOSED_WON",
          confidence: 0.95,
          evidence: ["Cliente confirmou que quer formalizar."]
        },
        interest: {
          value: "HIGH",
          confidence: 0.9,
          evidence: ["Aceitou seguir com a proposta."]
        },
        objection: { value: null, confidence: 0, evidence: [] },
        customerNeed: {
          value: "Formalizar credito aprovado",
          confidence: 0.8,
          evidence: ["Pediu proxima etapa."]
        },
        risk: { value: "LOW", confidence: 0.6, reasons: ["Sem objecao recente."] },
        nextBestAction: {
          action: "FORMALIZE",
          reason: "Ha confirmacao explicita de fechamento.",
          suggestedAt: null,
          confidence: 0.9
        },
        limitations: []
      })
    });
  };

  const result = await callCommercialObserverModel({
    input: await loadCommercialObserverContext({
      conversationId: "conversation-1",
      companyId: "company-1",
      db: createMockDb()
    }),
    fetchImpl: fetchImpl as typeof fetch
  });

  restoreEnv("OPENAI_API_KEY", originalKey);

  const text = requestBody.text as { format?: { type?: string; name?: string } } | undefined;
  assert.equal(text?.format?.type, "json_schema");
  assert.equal(text?.format?.name, "commercial_observer_result_v1");
  assert.equal(result.stage.value, "CLOSED_WON");
  assert.equal(result.nextBestAction.action, "FORMALIZE");
});

test("callCommercialObserverModel falha sem OPENAI_API_KEY", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  await assert.rejects(
    () =>
      callCommercialObserverModel({
        input: {
          version: 1,
          company: { segment: null, aiInstructions: null },
          conversation: {
            id: "conversation-1",
            status: "OPEN",
            channel: "whatsapp",
            channelName: null,
            responsible: null,
            stage: null,
            createdAt: baseDate.toISOString(),
            updatedAt: baseDate.toISOString()
          },
          contact: {
            name: "Cliente",
            hasPhone: false,
            phoneLast4: null,
            temperature: null,
            origin: null,
            tags: []
          },
          recentMessages: [],
          tasks: [],
          proposals: [],
          campaigns: [],
          limitations: []
        }
      }),
    (error) => error instanceof CommercialObserverError && error.code === "NOT_CONFIGURED"
  );

  restoreEnv("OPENAI_API_KEY", originalKey);
});
