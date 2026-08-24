# Riscos conhecidos e roadmap

## Riscos técnicos restantes

### MÉDIO — duplicidade histórica de contatos

A fila deduplica por `contact.id`. Se a mesma pessoa existir em dois contatos
distintos por fragmentação histórica, ela ainda pode aparecer como oportunidades
separadas.

Status: parcialmente resolvido em novos fluxos de normalização, mas pendente
para saneamento histórico e merge assistido.

### MÉDIO — claim sem expiração automática sofisticada

O ownership real fica em `Conversation.agentId`. O sistema protege stale
ownership, mas não há expiração automática avançada de claims.

Impacto: oportunidades podem permanecer com operador até ação humana ou outro
fluxo de atribuição.

### MÉDIO — volume/performance

`listOpportunityQueue()` busca até 600 conversas candidatas e depois consulta
fontes relacionadas por conjuntos de `contactId`. O desenho evita N+1 grosseiro,
mas ainda carrega e calcula bastante em memória.

Impacto esperado: aceitável para MVP/volume atual, mas merece observabilidade e
otimização antes de escala maior.

### MÉDIO — smoke de ALREADY_OWNED + COMPLETED ainda pendente em production

O cenário está coberto por testes automatizados, mas o smoke controlado em
production não ocorreu porque não havia pré-condição natural.

Impacto: não bloqueia uso atual, mas deve ser validado quando o cenário surgir
naturalmente.

### BAIXO — suppression simples

Regras atuais são fixas:

- `COMPLETED`: 24h global por conversa/empresa;
- `SKIPPED`: 4h por usuário/conversa/empresa;
- `RETURNED`: 4h por usuário/conversa/empresa.

Não há política configurável por empresa, perfil, prioridade ou produto.

### BAIXO — stale queue

A oportunidade apresentada por PEEK pode ficar desatualizada antes do claim.

Mitigação atual: claim e lifecycle revalidam elegibilidade/ownership no backend.

### BAIXO — lifecycle órfão por deletes futuros

`NextBestActionEvent.assignmentHistoryId` usa `ON DELETE SET NULL`. Se alguém
remover histórico de atribuição no futuro, o evento permanece, mas perde a prova
do assignment.

Não há fluxo normal auditado que delete `LeadAssignmentHistory`.

### INFORMATIVO — status de conversa não é filtro exclusivo

A Opportunity Queue usa sinais comerciais e não limita a documentação a um único
status de conversa. Isso permite oportunidades em estados operacionais variados,
desde que os sinais existam.

### INFORMATIVO — sistema atual não aprende sozinho

A implementação persiste outcomes, mas ainda não usa esses outcomes para
treinamento, re-ranking automático ou aprendizado de conversão.

## O que a IA Observadora ainda não é

O sistema atual não implementa:

- aprendizado automático com resultado comercial;
- re-ranking baseado em conversões históricas;
- treinamento automático;
- decisão autônoma de contato;
- envio automático sem operador;
- expiração automática sofisticada de claims;
- resolução completa de identidade;
- analytics avançado do lifecycle;
- previsão sofisticada de venda;
- política configurável de suppression por empresa.

O valor atual está em priorização assistida, explicabilidade operacional,
separação entre visualizar e assumir, concorrência segura e lifecycle persistente.

## Roadmap recomendado

### P0 — necessário antes de considerar esta fase encerrada

- Executar smoke production de `ALREADY_OWNED -> CLAIMED -> COMPLETED` quando
  surgir pré-condição natural.
- Revisar o teste antigo de `opportunity-summary-rules` que espera uma
  propriedade `id` inexistente no contrato atual de `OpportunitySummary`.
- Garantir que documentação operacional de smoke test fique acessível para o
  time antes de novos testes em production.

### P1 — robustez operacional

- Criar observabilidade para latência e volume de `/api/opportunities/queue`,
  `/api/opportunities/next` e `/api/opportunities/action`.
- Adicionar painéis/relatórios para lifecycle NBA por usuário, ação e outcome.
- Avaliar expiração operacional de claims ou alertas de claim parado.
- Ampliar testes de integração para endpoints reais com sessão fake.
- Planejar saneamento histórico de contatos duplicados antes de evoluir IA.

### P2 — evolução da inteligência

- Usar outcomes de `COMPLETED` como sinal analítico.
- Medir conversão por tipo de evidência, produto provável e ação recomendada.
- Ajustar ranking com base em dados históricos validados.
- Permitir políticas configuráveis de suppression por empresa.
- Melhorar identidade com sinais adicionais, sem merge automático inseguro.

### P3 — escala, analytics e autonomia

- Criar dashboard de performance da IA Observadora.
- Implementar ranking adaptativo com trilha de auditoria.
- Adicionar experimentos controlados de recomendação.
- Avaliar automações assistidas, mantendo aprovação humana onde houver risco.
- Planejar sharding/otimizações se a fila crescer muito.
