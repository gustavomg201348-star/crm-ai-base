# IA Observadora V2 - Camada de Inteligencia Operacional

## Base

- Branch: `feature/commercial-observer-v2`
- Worktree: `C:\Users\Micro\Documents\New project 2-commercial-observer-v2`
- Base: `origin/feature/commercial-operating-system`
- HEAD base auditado: `18721abeb89e365d4e5fa0d16cf7883c621b64b9`
- Escopo desta etapa: auditoria e proposta. Nao ha implementacao.

## 1. Mapa da V1 atual

A V1 esta integrada como analise manual, read-only e sem persistencia.

Arquivos atuais:

- `src/app/api/commercial-observer/analyze/route.ts`
  - Endpoint `POST /api/commercial-observer/analyze`.
  - Usa `getSessionFromRequest`.
  - Protege com `requireAdmin`, mantendo ADMIN/SUPERVISOR.
  - Recebe somente `conversationId`.
  - Usa `session.companyId`; nao aceita `companyId` do frontend.
  - Retorna `{ analysis }`.

- `src/lib/commercial-observer-service.ts`
  - Carrega contexto por `conversationId` e `companyId`.
  - Consulta somente por `findFirst`, `findUnique` e `findMany`.
  - Contexto inclui conversa, contato mascarado, ultimas mensagens, tarefas, propostas e campanhas recentes.
  - Limita mensagens em `MESSAGE_LIMIT`.
  - Nao envia CPF, telefone completo ou credenciais.
  - Usa `OPENAI_MODEL || "gpt-4o-mini"`.
  - Chama Responses API com JSON Schema estrito.
  - Normaliza saida e aplica safety checks.
  - Em saida invalida, retorna resultado `UNKNOWN` conservador.

- `src/lib/commercial-observer-types.ts`
  - Contrato `CommercialObserverResultV1`.
  - Campos: `summary`, `stage`, `interest`, `objection`, `customerNeed`, `risk`, `nextBestAction`, `limitations`.
  - Inclui `UNKNOWN_COMMERCIAL_OBSERVER_RESULT`.

- `src/lib/commercial-observer-prompt.ts`
  - Prompt versionado como `commercial-observer-v1`.
  - Reforca postura observadora.
  - Reforca que a IA nao deve executar acoes.

- `src/app/page.tsx`
  - UI manual no painel direito do Atendimento.
  - Botao `Analisar com IA`.
  - Exibe loading, erro, UNKNOWN e limitations.
  - Reseta resultado ao trocar de conversa.
  - Nao persiste resultado.
  - Nao transforma `nextBestAction` em botao executavel.

Pode ser reaproveitado integralmente:

- contrato estruturado inicial;
- carregamento de contexto;
- prompt base e safety checks;
- chamada ao modelo;
- endpoint manual para teste e fallback operacional;
- UI manual como ferramenta de auditoria/diagnostico.

Nao deve ser duplicado:

- cliente OpenAI;
- normalizacao;
- sanitizacao;
- regras de permissao;
- carregamento de contexto por conversa.

## 2. Eventos relevantes encontrados

Eventos existentes que podem futuramente marcar uma conversa como `needs reanalysis`:

1. Mensagem inbound
   - `src/app/api/webhooks/whatsapp/route.ts`
   - `src/app/api/channels/simulate/route.ts`
   - `src/lib/inbound-message.ts`
   - Efeito atual: cria mensagem inbound, atualiza conversa para `PENDING`, incrementa unread, publica notificacao SSE.

2. Mensagem outbound de texto
   - `src/app/api/conversations/[id]/messages/route.ts`
   - `src/lib/conversation-message.service.ts`
   - Efeito atual: envia Meta e salva outbound.

3. Template outbound unitario
   - `src/app/api/conversations/[id]/messages/template/route.ts`
   - `src/lib/whatsapp-template.service.ts`
   - Efeito atual: envia template e salva outbound.

4. Mudanca de Conversation
   - `src/app/api/conversations/[id]/route.ts`
   - Efeito atual: altera `status` e/ou `summary`.
   - Fechamento/reabertura pode ser inferido por mudanca de `status`.

5. Mudanca de responsavel
   - `src/app/api/conversations/[id]/assign/route.ts`
   - `src/app/api/conversations/[id]/transfer/route.ts`
   - `src/app/api/conversations/[id]/unassign/route.ts`
   - `src/lib/lead-assignment.ts`

6. Mudanca de Contact.stage
   - `src/app/api/contacts/[id]/route.ts`
   - O PATCH registra `CONTACT_UPDATED` e pode alterar `stageId`.

7. Criacao/alteracao de Proposal
   - `src/app/api/proposals/route.ts`
   - `src/app/api/proposals/[id]/route.ts`
   - Criacao ja define `paidAt` quando status inicial e `PAID`.
   - Update define `paidAt` na primeira transicao para `PAID`.
   - Historico registra mudanca de status, responsavel, banco e produto.

8. Criacao/conclusao/reagendamento de Task
   - `src/app/api/tasks/route.ts`
   - `src/app/api/tasks/[id]/route.ts`
   - Criacao registra `TASK_CREATED`.
   - Conclusao registra `TASK_DONE`.
   - Reagendamento altera `dueAt`.

9. Campanha/respondente
   - `src/lib/campaigns.ts`
   - `src/app/api/webhooks/whatsapp/route.ts`
   - `CampaignRecipient` guarda `conversationId`, `providerMessageId`, `sentAt`, `deliveredAt`, `failedAt`.
   - Resposta inbound com `context.id` ja pode preservar conversa correta.

## 3. Quando reanalisar

Nao chamar OpenAI a cada evento. A V2 deve separar:

1. Marcacao barata de sujeira/freshness.
2. Processamento posterior consolidado.
3. Leitura pela Sala/Motor apenas do ultimo resultado persistido.

Eventos recomendados para marcar reanalise:

- Alta prioridade:
  - nova mensagem inbound;
  - resposta outbound do atendente/template;
  - mudanca de proposta relevante: status, valor, produto, banco ou responsavel;
  - mudanca de etapa do contato;
  - fechamento/reabertura de conversa.

- Media prioridade:
  - criacao de tarefa;
  - conclusao/reagendamento de tarefa;
  - transferencia/devolucao/assuncao de responsavel.

- Baixa prioridade ou nao dispara IA por si so:
  - status de entrega/leitura de mensagem;
  - mudanca de tag;
  - edicao cadastral sem impacto comercial;
  - abertura da Sala de Controle;
  - troca de conversa na UI.

## 4. Estrategia de debounce/consolidacao

O projeto nao possui worker/queue dedicado. Existe SSE em memoria para notificacoes, mas ele nao e uma fila confiavel e nao deve ser usado para processamento persistente de IA.

MVP recomendado:

1. Persistir uma linha por conversa com estado da observacao.
2. Ao ocorrer evento relevante, atualizar essa linha:
   - `status = "STALE"` ou `status = "PENDING"`;
   - `sourceUpdatedAt = now`;
   - `nextEligibleAt = now + debounceWindow`.
3. Nao chamar OpenAI dentro do fluxo critico do webhook/envio se puder evitar.
4. Criar endpoint operacional protegido, por exemplo:
   - `POST /api/commercial-observer/process-pending`
   - ADMIN/SUPERVISOR ou job interno futuro.
5. Esse endpoint processa poucos itens por chamada:
   - `status in ("PENDING", "STALE", "ERROR_RETRYABLE")`;
   - `nextEligibleAt <= now`;
   - limite pequeno, por exemplo 5 a 20.
6. Se nao houver cron/worker no deploy atual, o primeiro bloco pode manter:
   - processamento manual/admin;
   - ou processamento oportunista controlado ao abrir Sala de Controle, sem bloquear a tela e com limite pequeno.

Debounce sugerido:

- inbound/outbound: 90 a 180 segundos;
- proposta/status/etapa: 15 a 60 segundos;
- tarefas: 5 a 15 minutos quando for apenas mudanca de prazo;
- fechamento/reabertura: imediato ou ate 30 segundos.

## 5. Persistencia recomendada

A V2 precisa persistir a ultima interpretacao para que Sala de Controle e Motor Comercial consultem sem chamar OpenAI.

Modelo minimo recomendado: `CommercialObservation`.

Campos essenciais:

```prisma
model CommercialObservation {
  id                       String   @id @default(cuid())
  companyId                String
  conversationId           String
  version                  Int      @default(1)
  status                   String
  analyzedAt               DateTime?
  sourceUpdatedAt          DateTime?
  nextEligibleAt           DateTime?
  model                    String?
  promptVersion            String?
  summary                  String?
  stage                    String?
  stageConfidence          Float?
  interest                 String?
  interestConfidence       Float?
  objection                String?
  customerNeed             String?
  risk                     String?
  riskConfidence           Float?
  nextBestAction           String?
  nextBestActionReason     String?
  nextBestActionConfidence Float?
  limitationsJson          String?
  rawStructuredResultJson  String?
  errorCode                String?
  errorMessage             String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  company                  Company @relation(fields: [companyId], references: [id])
  conversation             Conversation @relation(fields: [conversationId], references: [id])

  @@unique([companyId, conversationId])
  @@index([companyId, status, nextEligibleAt])
  @@index([companyId, analyzedAt])
  @@index([conversationId])
}
```

Notas:

- Para MVP, manter somente a ultima observacao por conversa.
- Historico de analises pode vir depois, se houver uso real para auditoria.
- Campos tipados ajudam filtros e ranking futuro.
- JSON completo preserva auditabilidade e evita perda de contrato.
- `limitationsJson` evita schema complexo antes de necessidade real.
- `errorMessage` deve ser sanitizado e nao conter prompt, telefone, CPF ou resposta bruta sensivel.

## 6. Freshness

Estados recomendados:

- `CURRENT`: observacao representa a conversa ate `sourceUpdatedAt`.
- `STALE`: houve evento relevante apos `analyzedAt`.
- `PENDING`: aguardando janela de debounce/processamento.
- `PROCESSING`: item em processamento.
- `ERROR`: falha nao bloqueante; CRM continua operando.

Regra basica:

- Se `sourceUpdatedAt > analyzedAt`, a observacao esta desatualizada.
- Se nao existe observacao, a conversa esta `NOT_ANALYZED`.
- Sala de Controle nunca deve tratar observacao desatualizada como verdade atual sem sinalizar.

Campos auxiliares:

- `sourceUpdatedAt`: timestamp do ultimo evento relevante consolidado.
- `analyzedAt`: timestamp da analise concluida.
- `nextEligibleAt`: quando pode rodar apos debounce.
- `contextHash` pode ser adicionado depois para evitar reanalise sem mudanca real.

## 7. Sala de Controle

Regras objetivas atuais devem continuar deterministicas:

- tarefas vencidas;
- retornos vencidos;
- conversas pendentes/paradas;
- propostas ativas;
- contratos pagos hoje;
- campanhas ativas/enviadas;
- meta e ritmo do dia;
- funil por etapa.

Interpretacao IA pode enriquecer, nao substituir:

- interesse contextual;
- objecao;
- necessidade do cliente;
- risco comercial contextual;
- estagio inferido;
- proxima melhor acao sugerida.

Integracao futura recomendada:

- adicionar bloco "Sinais da IA" ou enriquecer "Controle operacional" com badge:
  - observacao atual;
  - observacao desatualizada;
  - risco IA alto;
  - objecao detectada.
- manter limitacoes visiveis.
- quando observacao estiver `STALE` ou `ERROR`, mostrar essa condicao.

## 8. Motor Comercial / Opportunity Queue / Next Best Action

Hoje o Motor Comercial usa `OpportunitySummary` e `OpportunityQueue` com regras objetivas:

- mensagens recentes;
- unread;
- tarefas pendentes;
- proposta ativa;
- campanha recente;
- simulacoes/logs CLT;
- produto provavel;
- retorno pendente;
- prioridade por regra.

Uso futuro recomendado:

- `CommercialObservation` entra como insumo adicional do `OpportunitySummary`.
- Nao substituir `buildOpportunitySummary`.
- Enriquecer:
  - `priority.reason`;
  - `queueReason`;
  - `contextExplanation`;
  - sinal de risco contextual.
- Exemplo:
  - regra objetiva: "cliente parado ha 40 min";
  - IA: "negociacao em andamento com objecao sobre parcela";
  - Motor: "prioridade alta, tratar objecao antes de perder timing".

Nao implementar ranking IA na V2 inicial.

## 9. Cliente esquecido e negociacao em risco

Continuam deterministicos:

- prometeu retornar/simular e tarefa venceu;
- pergunta do cliente sem resposta;
- agendamento venceu;
- conversa `PENDING` parada;
- proposta ativa com tarefa vencida.

Podem receber enriquecimento IA:

- cliente realmente demonstra intencao de compra;
- objecao concreta identificada;
- necessidade declarada;
- risco de perda por demora;
- diferenca entre curiosidade fraca e negociacao real.

Nao deixar IA sozinha classificar "cliente esquecido"; ela deve explicar contexto, nao substituir prazo/tarefa/status.

## 10. Custos

Controles recomendados:

- analisar somente conversas com eventos relevantes;
- debounce por conversa;
- nao reanalisar sem `sourceUpdatedAt` novo;
- persistir ultima analise;
- limitar contexto a ultimas mensagens e dados comerciais recentes;
- processar em lotes pequenos;
- limitar reprocessamento de erro;
- futuro `contextHash` para impedir chamadas com contexto identico;
- manter V1 manual para diagnostico sem rodar automaticamente.

Nao estimar preco sem telemetria real de tokens/chamadas.

## 11. Falhas

Se OpenAI estiver indisponivel, lenta, retornar invalido ou rate limit:

- manter CRM operando normalmente;
- marcar observacao como `ERROR`;
- armazenar `errorCode` seguro;
- nao salvar prompt/resposta completa em erro;
- aplicar retry posterior com backoff simples;
- Sala/Atendimento exibem estado "analise indisponivel/desatualizada";
- nao bloquear webhook, envio de mensagem, proposta, tarefa ou atendimento.

Timeout recomendado:

- chamada IA com limite curto e abortavel;
- lote encerra parcialmente se um item falhar.

## 12. Privacidade

Preservar protecoes da V1:

- sem CPF completo;
- sem telefone completo;
- sem tokens Meta;
- sem secrets;
- minimo contexto necessario;
- contact name pode continuar como "Cliente" no prompt.

Risco novo da V2:

- resultado persistido pode conter PII indireta em `summary`, `evidence`, `objection` ou `customerNeed`.

Mitigacoes:

- sanitizar resultado antes de salvar;
- remover padroes de CPF/telefone;
- limitar tamanho de texto;
- nao persistir evidencias textuais longas no MVP ou persistir apenas em JSON sanitizado;
- nao salvar prompt completo;
- nao salvar raw de OpenAI sem sanitizacao.

## 13. Fora da V2 agora

Explicitamente fora:

- IA respondendo cliente;
- mudanca automatica de etapa;
- criacao automatica de Task;
- transferencia automatica;
- alteracao automatica de responsavel;
- execucao de `nextBestAction`;
- cross-sell FGTS -> CLT;
- identificacao automatica de oferta esquecida;
- calculo de dinheiro deixado na mesa;
- entidade `Negotiation`, salvo bloqueio absoluto futuro;
- aprendizado automatico;
- analise de todas as conversas historicas;
- scoring complexo de fechamento.

## 14. Riscos

- Sem worker/queue confiavel hoje, processamento automatico real precisa ser desenhado com cuidado.
- Rodar IA dentro de webhook/envio pode aumentar latencia e fragilidade operacional.
- Persistir interpretacao desatualizada sem freshness clara pode induzir gestor ao erro.
- Summary/limitations podem conter PII indireta se sanitizacao nao for aplicada antes da persistencia.
- JSON grande sem campos tipados dificultaria filtros futuros.
- Campos tipados demais podem gerar migration maior que o necessario se o contrato ainda mudar.

## 15. Sequencia recomendada de implementacao

Bloco 1 - Persistencia e freshness, sem OpenAI automatico

- Criar `CommercialObservation`.
- Criar service para:
  - `markCommercialObservationStale`;
  - `getCommercialObservationForConversation`;
  - `upsertCommercialObservationResult`.
- Criar testes de freshness e multiempresa.
- Nenhum trigger automatico ainda.

Bloco 2 - Marcar eventos relevantes

- Integrar marcacao barata nos pontos:
  - inbound;
  - outbound texto/template;
  - proposta create/update;
  - task create/update;
  - contact stage update;
  - conversation status update.
- Nao chamar OpenAI nesses pontos.
- Testar que falha da marcacao nao quebra fluxo principal.

Bloco 3 - Processamento manual/lote pequeno

- Criar endpoint protegido para processar pendentes.
- Reusar `analyzeConversationWithCommercialObserver`.
- Salvar resultado sanitizado.
- Tratar erro/rate limit como estado.

Bloco 4 - UI de leitura

- Mostrar ultima observacao persistida no Atendimento.
- Exibir freshness: atual/desatualizada/pendente/erro.
- Manter botao manual V1 para reprocessamento sob demanda.

Bloco 5 - Sala de Controle/Motor

- Ler observacao persistida como insumo adicional.
- Exibir sinais IA sem substituir regras objetivas.
- Nenhum ranking automatico complexo na primeira versao.

## 16. Arquivos provaveis do primeiro bloco

Primeiro bloco deve provavelmente alterar/criar:

- `prisma/schema.prisma`
- `prisma/schema.postgres.prisma`
- `src/lib/commercial-observer-persistence.ts`
- `src/lib/commercial-observer-persistence.test.ts`
- `src/lib/commercial-observer-types.ts`
- `src/lib/commercial-observer-service.ts`
- possivelmente `src/app/api/commercial-observer/analyze/route.ts`

Arquivos que nao devem entrar no primeiro bloco:

- Atendimento UI, exceto se for apenas leitura de freshness;
- Sala de Controle;
- Opportunity Queue;
- Motor Comercial;
- webhook Meta com chamada IA direta;
- templates/campanhas fora da marcacao posterior.
