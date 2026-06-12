# Investigacao Yntelli - 2026-06-11

## Escopo

Projeto auditado: `C:\Users\Micro\Documents\New project 2`

Modo da auditoria original: somente leitura.

Objetivo: verificar aderencia inicial ao padrao Yntelli para um CRM operacional com IA, WhatsApp/Meta, campanhas, multiempresa e modulos financeiros/CLT.

## Resumo executivo

O projeto e uma base real de CRM com Next.js, Prisma, API routes, deploy Railway/Docker, multiempresa, WhatsApp/Meta, IA e documentacao tecnica. A classificacao recomendada e **SAAS em estagio inicial/controlado**.

Para uso proprio ou primeiras operacoes pequenas, a base esta bem encaminhada. Para um SaaS robusto, ainda faltam pilares de governanca e confiabilidade: ADRs, migrations versionadas, testes automatizados, CI anti-quebra, LGPD operacional e manutencao formal.

## Tabela de conformidade

| Etapa | Status | O que encontrei | O que precisa fazer |
|---|---|---|---|
| 1. Classificacao do projeto | OK | Projeto tem sinais claros de SAAS: multiempresa, tenants, admin master, empresas, usuarios, isolamento por `companyId`, Railway/Postgres e revenda mencionada no relatorio tecnico. | Manter a classificacao formal em ADR e revisar quando o modelo comercial mudar. |
| 2. Arquivos obrigatorios | Falta | Existem `README.md`, `package.json`, `.env.example`, `.env.production.example`, `Dockerfile`, `railway.toml`, `docker-compose.production.yml`. Faltavam documentos formais Yntelli. | Completar checklist oficial, ADRs, DATA-MODEL, LGPD, manutencao e auditorias. |
| 3. Documentacao em `docs/` | OK | Existem docs tecnicas, deploy, sprints e relatorio tecnico detalhado. | Organizar docs por arquitetura, banco, seguranca, operacao, LGPD, ADRs e auditorias. |
| 4. ADRs criados | Falta | Nao havia `docs/adr/`. | Criar ADRs para classificacao SaaS, banco, deploy, auth, LGPD e integracoes. |
| 5. Estrutura de codigo | OK | Estrutura consistente em `src/app`, `src/app/api`, `src/lib`, `prisma` e `scripts`. | Reduzir concentracao em `src/app/page.tsx` conforme o produto crescer. |
| 6. Banco, migrations e DATA-MODEL | Critico | Existem schemas Prisma para SQLite e Postgres, seed e setup local. Nao havia `prisma/migrations/` nem `docs/DATA-MODEL.md`. | Criar migrations reais e usar `prisma migrate deploy` em producao. |
| 7. Seguranca e LGPD | Critico | Ha hash PBKDF2, cookies HTTP-only e roles. O relatorio tecnico aponta tokens/senhas em texto, ausencia de retencao LGPD e sem criptografia de CPF/telefone. | Implementar opt-out, retencao, exclusao/anonymizacao e criptografia de dados sensiveis. |
| 8. Integracoes externas | OK | Meta WhatsApp Cloud API, OpenAI, Railway, PostgreSQL, CLT/bancos e webhooks. | Criar inventario formal de integracoes, variaveis, donos, riscos, limites e contingencias. |
| 9. Testes | Critico | Nao foram encontrados testes ou script `test`. Lint tentou usar cache em `.next/cache/eslint` e falhou com `EPERM` no ambiente. | Criar testes de auth, tenant isolation, importacao, webhook, campanhas e permissoes. |
| 10. Deploy | OK | Ha `docs/DEPLOY.md`, `Dockerfile`, `railway.toml`, Docker Compose, healthcheck e readiness. | Trocar `db push` por migrations e documentar rollback. |
| 11. Regras anti-quebra | Critico | Nao ha CI, GitHub Actions, script de typecheck/test ou politica de merge. | Criar pipeline com install, lint, typecheck, Prisma validate, testes e build. |
| 12. Manutencao configurada | Falta | Ha readiness e scripts auxiliares, mas nao havia runbook de backup, restore, monitoramento, logs e incidentes. | Manter `docs/MAINTENANCE.md` e transformar em rotina operacional. |
| 13. 12 Pecados Capitais Yntelli | Falta | Nao havia documento formal com os pecados/checklist. | Manter checklist e evidencias de mitigacao. |

## Prioridades recomendadas

1. Formalizar docs Yntelli iniciais.
2. Migrar producao de `prisma db push` para `prisma migrate deploy`.
3. Criar testes minimos anti-quebra.
4. Criar CI no GitHub.
5. Implementar LGPD minima: opt-out, retencao, exclusao/anonymizacao e criptografia de segredos.

