# IA Observadora / Próxima Melhor Ação

Esta documentação descreve o estado real da IA Observadora do CRM QEVORA na `main`
após os PRs #50, #51 e #52.

O sistema atual é um motor assistido de priorização operacional. Ele encontra
oportunidades comerciais relevantes, apresenta uma próxima ação ao operador e
registra o lifecycle operacional dessa ação. Ele ainda não é uma IA autônoma
com aprendizado de conversão, decisão automática de contato ou envio automático.

## Componentes principais

- **Opportunity Queue**: lista e ordena oportunidades acionáveis para a operação.
- **Opportunity Summary**: resume uma conversa/contato com sinais comerciais,
  produto provável, estado comercial e ação recomendada.
- **Próxima Melhor Ação (NBA)**: apresenta uma oportunidade por vez e separa
  visualização (`PEEK`) de assunção real (`CLAIM`).
- **Lifecycle da NBA**: persiste `CLAIMED`, `SKIPPED`, `COMPLETED` e `RETURNED`
  em `NextBestActionEvent`.
- **LeadAssignmentHistory**: registra histórico de atribuição de conversa, mas
  não é o lifecycle completo da NBA.

## Arquivos centrais

- `src/lib/opportunity-summary-rules.ts`
- `src/lib/opportunity-summary-service.ts`
- `src/lib/opportunity-queue-rules.ts`
- `src/lib/opportunity-queue-service.ts`
- `src/lib/opportunity-next-service.ts`
- `src/lib/next-best-action-lifecycle-service.ts`
- `src/app/api/opportunities/queue/route.ts`
- `src/app/api/opportunities/next/route.ts`
- `src/app/api/opportunities/action/route.ts`
- `src/app/api/conversations/[id]/opportunity-summary/route.ts`
- `src/app/components/opportunities/NextBestActionPage.tsx`
- `src/app/components/opportunities/MotorCommercialPage.tsx`

## Modelos de banco envolvidos

- `NextBestActionEvent`
- `LeadAssignmentHistory`
- `Conversation`
- `Contact`
- `User`
- `Company`
- `Task`
- `Proposal`
- `CampaignRecipient`
- `RetirementLead`
- `CltSimulationLog`

## Contexto de migrations

Baseline histórica:

- `00000000000000_baseline`
- checksum canônico:
  `98b347952845afd583e670642a1d2a83ac65b4975c95e34682df5bb7c55e0a8e`

Primeira migration incremental pós-baseline:

- `20260820120000_add_next_best_action_events`

Production usa `prisma migrate deploy` via `scripts/railway-start.mjs`; o fluxo
atual não depende mais de `prisma db push` em production.

## Documentos

- [Arquitetura](./architecture.md)
- [Lifecycle](./lifecycle.md)
- [Validação em production](./production-validation.md)
- [Riscos conhecidos e roadmap](./known-risks-and-roadmap.md)
