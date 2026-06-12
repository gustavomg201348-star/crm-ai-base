# Manutencao

## Objetivo

Definir rotina minima de operacao, backup, restore, monitoramento e resposta a incidentes do CRM.

## Rotinas diarias

- Verificar healthcheck `/api/health`.
- Verificar readiness autenticado `/api/system/readiness`.
- Conferir erros de deploy e reinicios no Railway.
- Conferir falhas de envio Meta/WhatsApp.
- Conferir filas/campanhas paradas ou com falha.

## Rotinas semanais

- Validar backup do banco.
- Revisar logs de erros.
- Conferir crescimento de mensagens, campanhas e notificacoes.
- Revisar falhas de webhook Meta.
- Conferir contatos importados e possiveis duplicidades.

## Rotinas mensais

- Testar restore em ambiente separado.
- Revisar dependencias e vulnerabilidades.
- Revisar usuarios ativos e permissoes.
- Revisar tokens e integracoes externas.
- Revisar indicadores de volume por tenant.

## Backup

Requisitos minimos:

- Backup automatico do Postgres em producao.
- Retencao definida conforme plano comercial e LGPD.
- Restore testado pelo menos mensalmente.
- Backup nunca deve ser armazenado publicamente.

## Deploy

Antes de publicar:

1. Instalar dependencias com lockfile.
2. Validar Prisma.
3. Rodar lint.
4. Rodar typecheck.
5. Rodar testes.
6. Rodar build.
7. Aplicar migrations com `prisma migrate deploy`.

## Incidentes

Tipos de incidentes:

- Vazamento ou exposicao de token.
- Erro de isolamento entre tenants.
- Disparo indevido para contatos com opt-out.
- Falha de webhook Meta.
- Perda ou corrupcao de dados.
- Deploy quebrado.

Procedimento minimo:

1. Pausar campanhas ou integracao afetada.
2. Registrar horario, impacto e tenants afetados.
3. Preservar logs necessarios.
4. Corrigir causa raiz.
5. Validar em ambiente controlado.
6. Publicar correcao.
7. Documentar pos-incidente.

