# Agenda — Etapa 03

A Agenda fica em Relacionamento, após Atendimento. Reutiliza `Task`, atividades,
as APIs `/api/tasks` e a exportação XLSX. Não há schema, migration, fila ou
armazenamento paralelo. A automação SEM MARGEM e as notificações não mudam.

## Contrato e permissões

- ADMIN e SUPERVISOR gerenciam tarefas da própria empresa e exportam.
- AGENT consulta e altera somente tarefas atribuídas a ele. Ao criar, escolhe
  um contato da própria carteira ou de uma conversa atribuída a ele.
- Todos os acessos verificam companyId no servidor, inclusive o acesso à conversa.
- Se houver várias conversas acessíveis, o operador escolhe o canal explicitamente.
- Cancelar grava CANCELLED; não exclui o histórico. Concluir grava DONE.
- Criação aceita Idempotency-Key e confirma a atividade na mesma transação.
  Clientes anteriores sem esse header deduplicam a mesma solicitação exata.
- A interface envia expectedUpdatedAt em alterações. Conflitos retornam 409,
  sem sobrescrever silenciosamente uma versão que o operador não viu.
- Transações Serializable têm recuperação limitada de conflitos; erros públicos
  são sanitizados. Mutações rejeitam origem de outro host e corpo acima de 16 KiB.

## Datas, origem e volume

- Exibição e edição usam horário de Brasília; períodos são semiabertos.
- Indicadores usam todos os registros dos filtros, não apenas a página carregada.
- Cada página tem 50 tarefas, ordenadas por dueAt/id, com cursor opaco ao usuário.
  A tela informa quantos registros faltam carregar, inclusive no calendário.
- O período máximo consultável é 367 dias. XLSX exporta até 5.000 tarefas e pede
  um período menor se exceder o limite, sem truncar silenciosamente.
- A origem automática reconhece a convenção de IDs SEM MARGEM. Novas tarefas
  manuais recebem IDs agenda-. Demais históricos mostram origem não informada;
  nomes de clientes, motivos e observações não são usados para inferir origem.
- Tipo Retorno usa a convenção já existente de título Retorno:. Demais registros
  aparecem como Tarefas. Não há nova classificação persistida.
- Eventos locais, comunicação entre abas, foco e atualização de 30 segundos
  mantêm Agenda, retornos do Atendimento, contato e Dashboard sincronizados.

## Validação isolada

Node 20:

```text
node --unhandled-rejections=strict --import tsx --test src/lib/agenda-policy.test.ts src/lib/sidebar-navigation.test.ts src/lib/sem-margem-return.test.ts src/lib/company-ai-settings.test.ts
node --conditions=react-server --unhandled-rejections=strict --import tsx src/lib/agenda-postgres.integration.ts
npm run verify
npm run build
git diff --check
```

A integração exige o guard já existente de PostgreSQL descartável CI, conexão
loopback e banco qevora_ci. Usa sessões assinadas, tenants sintéticos e transporte
externo bloqueado. Testa permissões, repetição e concorrência, edição, conclusão,
cancelamento, paginação, indicadores, Dashboard, conversas e XLSX.

O ensaio de navegador local cobre as quatro visualizações, pesquisa, criação,
reagendamento, conclusão, cancelamento, exportação, link para Atendimento e
ausência de overflow em desktop/mobile. Não utiliza dados ou canais reais.

## Homologação após aprovação e deploy

1. Conferir a posição da Agenda com ADMIN, SUPERVISOR e AGENT de homologação.
2. Criar uma tarefa para contato sintético pelo Atendimento e conferir na Agenda.
3. Editar na Agenda; conferir o mesmo registro no contato e nos retornos.
4. Concluir/cancelar e conferir a remoção dos pendentes no Dashboard.
5. Conferir filtros, datas, escolha de conversa e XLSX com os mesmos filtros.
6. Usar uma tarefa SEM MARGEM já existente para conferir somente a visualização,
   sem executar backfill nem mudar regras automáticas.

Nenhuma configuração de produção ou ativação é necessária para este patch.
Rollback: reverter o commit da interface/APIs; preservar as tarefas e atividades.
Não executar correção em massa de datas ou exclusão de registros.
