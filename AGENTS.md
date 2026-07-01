# AGENTS.md

Guia operacional para Codex e demais agentes que trabalhem neste projeto.

## Objetivo do CRM

Este projeto e um CRM SaaS multiempresa para operacao comercial, atendimento,
gestao de contatos, funil, campanhas e integracoes Meta/WhatsApp. O sistema
deve priorizar confiabilidade operacional, isolamento por empresa, rastreabilidade
de mudancas e cuidado com dados sensiveis.

## Regras obrigatorias para agentes

- Respeitar literalmente o escopo solicitado pelo usuario.
- Antes de alterar arquivos, entender o estado atual do repositorio.
- Nao alterar logica, API, Prisma/schema, banco, telas ou infraestrutura quando
  a tarefa pedir apenas auditoria, documentacao ou validacao.
- Nao fazer commit, push ou deploy sem autorizacao explicita.
- Nao rodar migration, `prisma db push`, seed ou comandos que alterem banco sem
  autorizacao explicita.
- Preservar alteracoes existentes no working tree que nao facam parte da tarefa.
- Manter cada patch pequeno, reversivel e limitado aos arquivos aprovados.
- Em caso de duvida sobre impacto em producao, parar e pedir confirmacao.

## Padrao de implementacao

Fluxo padrao para qualquer mudanca:

1. Auditoria: identificar estado atual, arquivos envolvidos e riscos.
2. Patch minimo: alterar somente o necessario para cumprir o objetivo.
3. Validacao: executar os comandos combinados para o tipo de mudanca.
4. Diff: mostrar o diff completo antes de commit quando solicitado.
5. Commit isolado: um commit por funcionalidade ou etapa aprovada.

## Commits

- Usar um commit por funcionalidade.
- Nao misturar refatoracao, correcao, UX e documentacao no mesmo commit, salvo
  se o usuario autorizar explicitamente.
- Antes de commitar, conferir `git status --short` e garantir que apenas os
  arquivos aprovados serao incluidos.

## Validacao obrigatoria

Para mudancas em codigo, rodar:

```powershell
npm.cmd run verify
npx.cmd prisma validate --schema prisma/schema.prisma
npm.cmd run typecheck
npm.cmd run lint:ci
```

Para mudancas apenas em Markdown/documentacao, nao e necessario rodar build por
padrao. Ainda assim, deve ser executado pelo menos:

```powershell
git diff
git status --short
```

## Banco, Prisma e migrations

- Nao alterar `prisma/schema.prisma`, migrations, seed ou scripts de banco sem
  autorizacao explicita.
- Nao rodar migrations em ambiente local ou producao sem plano aprovado.
- Qualquer alteracao de schema deve ter auditoria previa, plano de rollback e
  validacao separada.
- Ajustes de dados de producao devem ser tratados como operacao sensivel.

## Multiempresa e companyId

O CRM e multiempresa. Toda alteracao que leia, escreva ou liste dados deve
preservar isolamento por `companyId`.

Cuidados obrigatorios:

- Conferir se consultas filtram por `companyId` quando manipulam dados de uma
  empresa.
- Evitar fallback global que possa misturar empresas.
- Garantir que a tela e a API nao exponham dados de outra empresa.
- Considerar admins, operadores e permissoes antes de alterar endpoints.

## Canais Meta/WhatsApp

Integracoes Meta/WhatsApp sao areas sensiveis do sistema.

Cuidados obrigatorios:

- Nao alterar webhook, envio outbound, templates, campanhas ou canais sem
  auditoria previa.
- Validar impacto em `provider`, `phoneNumberId`, `wabaId`, `accessToken`,
  `verifyToken`, `appSecret` e `companyId`.
- Evitar mudancas que possam misturar conversas entre canais.
- Evitar fallback que escolha canal errado para envio.
- Nunca selecionar automaticamente um canal Meta quando existir mais de um canal
  elegivel; a escolha deve respeitar a estrategia de roteamento da empresa.
- Nunca utilizar valores hardcoded para `companyId`, `phoneNumberId`, `wabaId`,
  `provider` ou `accessToken`.
- Toda alteracao envolvendo Conversas, Campanhas, Canais Meta ou Disparos deve
  informar impacto esperado, riscos e plano de rollback.
- Antes de escalar disparos, considerar reputacao, opt-in, qualidade do numero,
  limites da Meta e risco de bloqueio.

## Dados sensiveis e LGPD

- Tratar tokens, telefones, CPFs, mensagens, propostas e dados financeiros como
  dados sensiveis.
- Nao imprimir segredos em logs, diffs ou respostas.
- Evitar expor corpo de mensagens, telefones completos e tokens em diagnosticos
  quando nao for indispensavel.
- Preferir mascaramento, minimo acesso e rastreabilidade.
- Qualquer mudanca que envolva credenciais deve considerar criptografia,
  rotacao e acesso restrito.
