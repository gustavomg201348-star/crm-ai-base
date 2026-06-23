# Backup e Recuperacao

## Objetivo

Documentar o estado atual da infraestrutura Railway e do banco PostgreSQL do CRM, incluindo estrategia de backup, recuperacao e criterios minimos antes de mudancas criticas.

## Infraestrutura Atual

| Item | Valor |
| --- | --- |
| Projeto Railway | `adorable-patience` |
| Ambiente | `production` |
| Aplicacao | `crm-ai-base` |
| Banco | PostgreSQL Railway |
| Volume | `postgres-volume` |
| Plano | Railway Pro |
| Regiao | `sfo` |
| Volume atual aproximado | 232 MB |
| Quantidade aproximada de tabelas | 28 |

## Estrategia de Backup Atual

- Backup automatico diario ativo.
- Retencao atual: 6 dias.
- Snapshots manuais criados em 23/06/2026.
- Backups e snapshots devem ser tratados como ativos criticos da operacao.
- Nenhum backup deve ser compartilhado publicamente ou armazenado em local sem controle de acesso.

## Procedimento Antes de Mudancas Criticas

Antes de qualquer mudanca com risco operacional, como alteracao de schema, migration, sincronizacao Prisma, ajuste manual de dados, alteracao de variaveis sensiveis ou mudanca de deploy:

1. Confirmar que o ambiente alvo e `production`.
2. Confirmar que o banco correto e o PostgreSQL Railway do projeto `adorable-patience`.
3. Criar snapshot manual do volume/banco.
4. Validar que o snapshot foi concluido com sucesso.
5. Registrar data, hora, responsavel e objetivo da mudanca.
6. Executar a alteracao somente apos o backup estar confirmado.
7. Validar a aplicacao apos a mudanca usando `/api/health`, rotas criticas e logs.

## Procedimento de Recuperacao

Em caso de incidente, perda de dados, schema corrompido, deploy incorreto ou erro humano:

1. Nao sobrescrever producao imediatamente.
2. Identificar o snapshot mais adequado para restauracao.
3. Restaurar o snapshot em ambiente separado.
4. Validar integridade dos dados no ambiente restaurado.
5. Conferir tabelas criticas, contatos, conversas, mensagens, propostas, tarefas, canais e usuarios.
6. Confirmar que o ambiente restaurado nao dispara mensagens, webhooks, campanhas ou integracoes reais.
7. Definir estrategia de corte ou recuperacao parcial.
8. Somente considerar substituicao de producao apos validacao tecnica e autorizacao explicita.

## Status do PITR

O Point-in-Time Recovery (PITR) esta atualmente desabilitado.

Pontos para avaliacao futura:

- Custo adicional.
- Janela de retencao necessaria.
- Impacto operacional.
- Processo de restauracao em ambiente separado.
- Necessidade de testes periodicos.

Enquanto o PITR estiver desabilitado, a recuperacao depende dos backups diarios e snapshots manuais disponiveis.

## Historico

### 23/06/2026

- Upgrade para Railway Pro.
- Primeiro backup manual criado.
- Backup diario habilitado.

## Classificacao Operacional

| Area | Status atual |
| --- | --- |
| Backup automatico | Ativo |
| Snapshot manual | Criado em 23/06/2026 |
| Retencao | 6 dias |
| PITR | Desabilitado |
| Restore testado | Pendente de validacao em ambiente separado |

## Regras de Seguranca

- Nunca rodar restore diretamente sobre producao sem validacao previa.
- Nunca executar migration, `db push`, seed ou script de correcao sem snapshot manual recente.
- Nunca compartilhar `DATABASE_URL`, tokens, dumps ou arquivos de backup em chat, email ou repositorio publico.
- Sempre validar ambiente, projeto e banco antes de qualquer acao operacional.
- Sempre registrar evidencias de backup e recuperacao.
