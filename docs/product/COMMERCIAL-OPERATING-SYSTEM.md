# Sistema Operacional Comercial

## 1. Missão

“Fazer com que o gestor consiga entender toda a operação em poucos minutos e saiba exatamente onde agir, sem trabalhar no escuro.”

O Sistema Operacional Comercial é a evolução natural do Motor Comercial já existente. Ele não nasce para ser mais uma tela de indicadores; nasce para ser a camada operacional que organiza o trabalho da empresa, interpreta sinais comerciais, identifica riscos e transforma dados do CRM em decisões claras.

## 2. Problema que estamos resolvendo

Operações comerciais de crédito crescem rápido em volume de leads, conversas, campanhas e produtos. O problema não é apenas registrar tudo isso; o problema é saber onde agir antes que dinheiro seja perdido.

Principais dores operacionais:

- dificuldade de saber onde vendas estão sendo perdidas;
- falta de acompanhamento das negociações;
- clientes sem retorno;
- diferenças entre produtos de venda rápida e venda consultiva;
- pouca clareza sobre desempenho de campanhas;
- pouca clareza sobre desempenho da equipe;
- dificuldade de identificar mudanças no mercado;
- crescimento de tráfego/disparos sem capacidade proporcional de gestão;
- supervisores dependendo de busca manual para descobrir gargalos;
- operadores decidindo sozinhos a ordem do dia;
- propostas ativas misturadas com conversas frias;
- ausência de uma leitura executiva simples sobre risco, prioridade e próxima ação.

## 3. Princípios do produto

1. Nenhuma informação entra na Sala de Controle se não ajudar em uma decisão.
2. O CRM não deve apenas mostrar um problema; deve sugerir ação.
3. A informação deve chegar ao gestor, e não exigir que ele procure.
4. A IA recomenda; o gestor continua decidindo.
5. O Motor Comercial existente deve ser evoluído e reutilizado, não substituído.
6. O sistema deve ser desenhado para suportar operação de alta escala.
7. A visão operacional deve explicar o porquê, não apenas mostrar o quê.
8. A experiência deve reduzir ansiedade, não aumentar ruído.
9. A mesma inteligência deve servir gestor, supervisor, operador e automações futuras.
10. O produto deve preservar isolamento por empresa, canal, conversa e responsável.

## 4. Arquitetura conceitual

```text
IA Gestora
↓
Motor Comercial
↓
Agenda Inteligente / Próxima Ação / Classificação / Priorização
↓
Sala de Controle
↓
Gestor
```

### Motor Comercial

Responsável por transformar sinais do CRM em decisões operacionais.

- decisões operacionais;
- regras;
- próxima ação;
- prioridade;
- estágio;
- agenda;
- explicação da oportunidade;
- ordenação do trabalho;
- identificação de oportunidades acionáveis.

### IA Gestora

Responsável por interpretar contexto, detectar padrões e apoiar decisões de gestão.

- entender contexto;
- classificar;
- identificar padrões;
- detectar gargalos;
- recomendar ações;
- explicar mudanças de comportamento;
- destacar riscos que não são óbvios apenas por regra;
- transformar histórico comercial em diagnóstico.

### Sala de Controle

Responsável por consolidar a operação para o gestor.

- consolidar operação;
- mostrar riscos;
- mostrar oportunidades;
- explicar perdas;
- permitir drill-down;
- indicar quem precisa agir;
- mostrar onde o dinheiro está parado;
- separar ruído de prioridade real.

## 5. Perguntas que a Sala de Controle deve responder

- Qual campanha trouxe mais contratos?
- Qual atendente esqueceu mais clientes?
- Quanto tempo um cliente fica sem resposta?
- Qual etapa faz mais clientes desistirem?
- Quanto tempo demora uma negociação de CLT?
- Quantos clientes disseram “vou pensar” e nunca receberam retorno?
- Quantos contratos foram perdidos por falta de acompanhamento?
- Onde estamos perdendo dinheiro?
- Quem precisa agir agora?
- Quais negociações estão em risco?
- Quais oportunidades possuem maior chance de fechamento?
- Qual produto está melhorando ou piorando?
- Houve mudança relevante no comportamento do mercado?
- Estamos no caminho para atingir a meta do dia/mês?
- Quais clientes deveriam voltar para operador humano?
- Quais clientes poderiam voltar para IA?
- Quais campanhas geram volume, mas não geram fechamento?
- Qual canal está trazendo oportunidade de melhor qualidade?
- Onde a equipe está gastando tempo sem retorno comercial?
- Quais clientes estão parados por falha de agenda?

## 6. Visão futura da Sala de Controle

Blocos conceituais previstos:

- Saúde da Operação;
- Resumo Executivo IA;
- Alertas e Prioridades;
- Funil Vivo;
- Agenda Inteligente;
- Próximas Ações;
- Diagnóstico de Perdas;
- Equipe;
- Campanhas;
- Produtos;
- Tendências;
- Metas e Projeções.

Esta seção ainda não define UI definitiva. A intenção é documentar os blocos de decisão que provavelmente formarão a experiência executiva do gestor.

## 7. Estado da Negociação

Seção em aberto para definição futura. Não há schema ou implementação nesta etapa.

Campos conceituais a discutir:

- produto;
- estágio;
- interesse;
- prioridade;
- probabilidade;
- última interação;
- próxima ação;
- responsável;
- tempo sem movimentação;
- objeção;
- dor;
- resultado.

Esta camada provavelmente será o elo entre Atendimento, propostas, campanhas, retornos e Motor Comercial. A decisão importante para as próximas fases será definir se “estado da negociação” deve ser apenas calculado, persistido, ou híbrido.

## 8. Dados já existentes

Auditoria inicial feita sobre a `origin/main` atual (`efc1ca0b4b1519258b8c32b16731f568f1d77655`).

### Dados e capacidades já disponíveis

- Conversas, contatos, mensagens, responsável e status de atendimento.
- Canal de origem/conversa e integração Meta/WhatsApp.
- Propostas e histórico de propostas.
- Pipeline stages/funil.
- Tarefas/agendamentos.
- Campanhas e destinatários.
- Templates e envio unitário/campanhas.
- Recém-aposentados e sinais de INSS.
- Simulação CLT e propostas CLT.
- Tags, temperatura e dados cadastrais do contato.
- Dashboard atual.
- Kanban atual.
- Opportunity Summary.
- Opportunity Card.
- Opportunity Queue.
- Motor Comercial.
- Próxima Melhor Ação.

### Indicadores que já podem ser calculados sem IA

- conversas sem resposta;
- mensagens não lidas;
- conversas por responsável;
- conversas sem responsável;
- tempo desde última interação;
- retorno vencido ou próximo, quando há tarefa/retorno;
- propostas ativas por produto/status;
- oportunidades por prioridade calculada;
- contatos arquivados ou ativos;
- campanhas por status;
- quantidade de destinatários por campanha;
- templates prontos/pendentes;
- fila priorizada por empresa;
- distribuição de oportunidades por operador.

### Dados incompletos ou ainda pouco estruturados

- motivo real de perda;
- objeção principal do cliente;
- intenção comercial detectada no texto;
- qualidade da campanha além de volume;
- estágio consultivo detalhado por produto;
- motivo do cliente parar de responder;
- probabilidade comercial calibrada por histórico;
- meta diária/mensal formal;
- SLA operacional por produto/equipe;
- agenda inteligente persistente;
- resultado estruturado de cada ação do operador;
- vínculo explícito entre oportunidade, ação executada e resultado.

### Análises que provavelmente exigirão IA

- resumo executivo da operação;
- diagnóstico de gargalos não triviais;
- identificação de mudança no comportamento do mercado;
- classificação de objeções;
- leitura de intenção em conversas;
- explicação de perdas;
- sugestão de ação baseada em contexto textual;
- detecção de padrões por produto/campanha;
- recomendação de prioridade quando regras simples forem insuficientes.

## 9. Roadmap inicial

Hipótese inicial, ainda a ser refinada:

### Fase 0 — Arquitetura e definição

- Consolidar linguagem do Sistema Operacional Comercial.
- Definir fronteiras entre Motor Comercial, Sala de Controle e IA Gestora.
- Mapear dados confiáveis e lacunas.
- Definir quais decisões o gestor precisa tomar diariamente.

### Fase 1 — Instrumentação e dados

- Estruturar eventos, resultados e sinais operacionais.
- Melhorar rastreabilidade do que aconteceu com cada oportunidade.
- Consolidar dados de retorno, proposta, campanha e atendimento.

### Fase 2 — Sala de Controle MVP

- Criar primeira visão executiva acionável.
- Mostrar riscos e oportunidades do dia.
- Permitir drill-down para Motor Comercial/Atendimento.

### Fase 3 — IA Gestora

- Gerar resumo executivo.
- Detectar gargalos.
- Classificar padrões.
- Recomendar foco operacional.

### Fase 4 — Motor Comercial assistido por IA

- Combinar regras existentes com interpretação contextual.
- Melhorar explicabilidade.
- Priorizar oportunidades com maior precisão.

### Fase 5 — Copiloto

- Ajudar gestor e supervisor a decidir ações.
- Sugerir campanhas, retornos, redistribuição e abordagens.

### Fase 6 — IA Autônoma

- Executar rotinas operacionais com autorização.
- Monitorar exceções.
- Acionar humanos quando necessário.

## 10. Auditoria do Motor Comercial existente

### O que já existe

Arquivos centrais encontrados:

- `src/lib/opportunity-summary-types.ts`
- `src/lib/opportunity-summary-rules.ts`
- `src/lib/opportunity-summary-service.ts`
- `src/lib/opportunity-summary-rules.test.ts`
- `src/app/api/conversations/[id]/opportunity-summary/route.ts`
- `src/lib/opportunity-queue-types.ts`
- `src/lib/opportunity-queue-rules.ts`
- `src/lib/opportunity-queue-service.ts`
- `src/lib/opportunity-queue-query.ts`
- `src/lib/opportunity-queue-rules.test.ts`
- `src/app/api/opportunities/queue/route.ts`
- `src/app/components/opportunities/MotorCommercialPage.tsx`
- `src/app/components/opportunities/NextBestActionPage.tsx`
- `src/app/components/opportunities/MissionCard.tsx`
- `src/app/components/opportunities/OpportunityGroup.tsx`
- `src/app/components/opportunities/OpportunityItem.tsx`
- `src/app/components/opportunities/opportunity-presentation.ts`
- `src/app/components/opportunities/types.ts`
- `src/app/page.tsx`

Peças relacionadas:

- `src/lib/tasks.ts`
- `src/lib/proposals.ts`
- `src/lib/campaigns.ts`
- `src/lib/conversations.ts`
- `src/lib/lead-assignment.ts`
- `src/lib/retirement-leads.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/proposals/route.ts`
- `src/app/api/campaigns/route.ts`
- `src/app/api/kanban/route.ts`
- `src/app/api/dashboard/route.ts`
- `prisma/schema.prisma`

### Capacidades reaproveitáveis

- Cálculo de resumo de oportunidade por conversa.
- Explicação comercial da oportunidade.
- Produto provável.
- Próxima ação recomendada.
- Priorização de oportunidades.
- Fila inteligente acionável.
- Deduplicação por contato.
- Respeito a responsável/conversa/empresa.
- Endpoint único para fila priorizada.
- Interface inicial do Motor Comercial.
- MVP de Próxima Melhor Ação com fila local.
- Base de testes de regras comerciais.

### O que está incompleto

- A Sala de Controle ainda não existe como experiência executiva.
- A IA Gestora ainda não existe.
- Resultado estruturado da ação do operador ainda não é persistido.
- Agenda Inteligente ainda não está consolidada como produto.
- Métricas de perda, gargalo e campanha ainda não estão amarradas ao Motor Comercial.
- O estado da negociação ainda não está definido como contrato de produto.
- Ainda falta decidir quais dados serão calculados em tempo real e quais serão materializados.

### Duplicidade de lógica

Há uma separação positiva entre:

- regras de summary;
- regras de queue;
- apresentação visual;
- páginas operacionais.

Risco futuro: se a Sala de Controle recalcular prioridades, categorias ou estados por conta própria, pode nascer uma segunda fonte de verdade. O princípio para este épico deve ser reaproveitar `Opportunity Summary` e `Opportunity Queue` como base, extraindo regras compartilhadas quando necessário.

### Arquivos provavelmente centrais neste épico

- `src/lib/opportunity-summary-*`
- `src/lib/opportunity-queue-*`
- `src/app/api/opportunities/queue/route.ts`
- `src/app/components/opportunities/*`
- `src/app/page.tsx`
- `src/lib/tasks.ts`
- `src/lib/proposals.ts`
- `src/lib/campaigns.ts`
- `src/lib/conversations.ts`
- `src/app/api/dashboard/route.ts`
- `src/app/api/kanban/route.ts`
- `prisma/schema.prisma`, apenas em fases futuras com autorização explícita.

### Riscos de conflito com trabalhos atuais

- Existem várias worktrees ativas relacionadas a campanhas, templates, atendimento e composer.
- A branch principal usada antes deste épico estava em `feature/opportunity-priority-queue`, com working tree sujo.
- O novo épico foi isolado em worktree própria para evitar misturar documentação estratégica com entregas funcionais.
- Como `origin/main` já recebeu várias fases do Motor Comercial, qualquer implementação futura deve começar sempre de `feature/commercial-operating-system` atualizada ou de branches-filhas curtas.

## 11. Próximos pontos para definição

Antes de qualquer implementação, precisamos definir com o usuário:

1. Qual é o primeiro público da Sala de Controle: gestor, supervisor ou dono da operação?
2. Quais decisões devem aparecer às 8h da manhã?
3. Quais indicadores são proibidos por serem “vaidade”?
4. O que caracteriza uma negociação em risco?
5. O que caracteriza esquecimento operacional?
6. Quais produtos exigem leitura consultiva versus ação rápida?
7. Como representar retorno: tarefa, agenda, estado da oportunidade ou todos?
8. O resultado da ação do operador deve ser obrigatório?
9. A IA Gestora deve apenas explicar ou também sugerir redistribuição de trabalho?
10. O que precisa ser auditável para comercialização SaaS?
