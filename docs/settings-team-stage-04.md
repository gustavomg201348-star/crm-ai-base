# Etapa 04 — Configurações e Equipe

## Organização e reaproveitamento

- Administração → Equipe e Permissões: cadastro, edição, perfis, exclusão
  conforme vínculos existentes, disponibilidade e carga operacional.
- Relacionamento → Tags: único cadastro administrativo de tags, com cores,
  texto, categoria, ativação/desativação e aplicação existente preservados.
- Kanban → Etapas do funil: configuração contextual de nome, cor e posição.
- Configurações: empresa, origens, distribuição e OpenCredit. Distribuição,
  AutoStart e integração mantêm as regras atuais, sem antecipar a Etapa 07.
- O atalho de presença do próprio atendente no cabeçalho continua disponível.
  A administração da disponibilidade dos demais usuários fica na Equipe.

Os componentes foram extraídos de page.tsx. Reutilizamos User,
UserAvailability, Tag, Origin, PipelineStage, listAttendants,
setAttendantStatus e as APIs existentes. Não há schema, migration ou
armazenamento paralelo.

## Permissões e integridade

ADMIN cadastra e edita usuários da própria empresa. SUPERVISOR consulta a
equipe e gerencia disponibilidade, conforme as permissões já existentes,
mas não recebe permissões para gerenciar contas ou funções. AGENT não
acessa a página administrativa; mantém a própria presença operacional.

As APIs verificam autenticação e companyId. O novo GET de usuários retorna
somente os campos operacionais da listagem existente, sem senha ou hash.
Identidades reservadas à plataforma são protegidas no backend; atribuir
ADMIN na empresa não permite fabricar uma identidade da plataforma. Escritas
condicionam email/role para impedir bypass por alteração concorrente.

O modelo não possui desativação reversível de login. Por isso não existe
botão de falso bloqueio: OFFLINE e PAUSED são disponibilidade, não bloqueio
de conta. A exclusão existente pode ser impedida por vínculos históricos.
Alterações reais de senha/perfil continuam seguindo a validação de sessão
existente; a reorganização não invalida as demais sessões.

A tag SEM MARGEM mantém nome, identificador e ativação. Gerenciamento comum
não a renomeia, desativa ou exclui; cores continuam editáveis. O servidor
impõe a proteção e condiciona a escrita ao nome conferido. Não mudamos
critérios, horários, filas, regras de aplicação ou datas de agendamentos.

## Validação isolada

- team-policy.test.ts: entradas, privilégio da plataforma e local único dos controles.
- settings-team-postgres.integration.ts: APIs autenticadas, tenants, perfis,
  credenciais não retornadas, disponibilidade persistida, tags protegidas,
  vínculos de etapas/contatos, origens e preservação da sessão do administrador.
- Regressões existentes de navegação, Agenda, SEM MARGEM, distribuição/AutoStart,
  OpenCredit e configurações de IA.
- Navegador local com dados sintéticos: cadastro/edição de usuário, perfis,
  filtros, estados de disponibilidade, tags, etapas, origens, ausência de
  controles duplicados e desktop/mobile.

Os testes PostgreSQL usam o guard de banco descartável CI e transporte
externo bloqueado. Nenhum dado ou ambiente de produção é utilizado.

## Homologação após aprovação

1. Conferir Equipe e Permissões com ADMIN e SUPERVISOR de homologação; AGENT
   não deve receber o menu nem acesso às APIs administrativas.
2. Cadastrar e editar usuário sintético. Conferir nome/e-mail/perfil e ausência
   de ações de edição de conta para SUPERVISOR.
3. Alterar a disponibilidade e conferir o mesmo estado no cabeçalho do usuário
   e na distribuição. Não gerar disparos para validar presença.
4. Criar/editar/desativar/reativar tag comum. SEM MARGEM deve manter nome e
   ativação, com cores editáveis e agendamentos preservados.
5. Criar/editar/ordenar etapa de homologação no Kanban e conferir os mesmos
   registros em contatos/propostas/Dashboard. A regra de última etapa permanece.
6. Conferir origens em Configurações e ausência dos cadastros duplicados.
7. Conferir as telas OpenCredit e distribuição sem alterar flags ou credenciais.

Rollback: reverter o commit da Etapa 04 após aprovação operacional. Não há
migration a reverter nem necessidade de remover dados. Preservar contas,
tags, etapas, origens, atribuições e histórico. A reversão também remove as
proteções adicionais de identidade da plataforma e SEM MARGEM introduzidas
neste patch; esse efeito deve ser avaliado antes de reverter.
