# LGPD

## Objetivo

Definir a base minima de privacidade e protecao de dados para o CRM.

## Classificacao de dados

### Dados pessoais

- Nome
- Telefone
- CPF
- E-mail
- Cidade/UF
- Historico de atendimento
- Tags, origem, etapa de funil e status comercial

### Dados sensiveis operacionais

- Tokens Meta/WhatsApp
- Credenciais de integracoes CLT/bancos
- Segredos de autenticacao
- Logs de simulacao e resposta de integracoes

## Regras minimas

1. Todo contato importado deve possuir origem rastreavel.
2. Todo disparo em massa deve respeitar opt-out.
3. Deve existir forma de marcar contato como bloqueado para campanhas.
4. Deve existir processo de exclusao ou anonimimizacao mediante solicitacao.
5. Dados pessoais nao devem ser expostos em logs desnecessarios.
6. Tokens e credenciais devem ser criptografados em repouso.
7. Ambientes de producao nao devem usar senhas seed padrao.

## Lacunas atuais

### Atestacao operacional OpenCredit

Existe uma fundacao tecnica passiva e auditavel para um Platform Admin atestar
que revisou uma mensagem inbound autenticada Meta HMAC e que ela expressa
autorizacao operacional especificamente para CLIENT_PROFILE_UPSERT. O registro
referencia a ConversationInboundEvent existente; nao copia o conteudo nem CPF.
O software valida autenticidade e escopo, mas nao interpreta o significado do texto.
A revogacao preserva evidencia e historico. Nenhuma mensagem gera grant automatico.

Isso NAO substitui determinacao de base legal, consentimento juridico ou revisao
de adequacao LGPD. A revisao juridica/politica externa continua pendente.
Nao ha endpoint/UI nem habilitacao de operacao OpenCredit por esta fundacao.
O ledger comercial ainda nao consome a autorizacao.

- Nao ha tabela formal de opt-out.
- Nao ha politica de retencao implementada.
- Nao ha criptografia de CPF/telefone.
- Tokens Meta e senhas CLT ainda precisam de criptografia.
- Nao ha fluxo documentado de atendimento a solicitacoes de titulares.

## Implementacao recomendada

### Fase 1

- Criar campos/tabela de opt-out.
- Bloquear campanhas para contatos com opt-out.
- Registrar origem e data de importacao.
- Criar documentacao de atendimento a solicitacoes LGPD.

### Fase 2

- Implementar anonimimizacao/exclusao.
- Criptografar tokens Meta e credenciais CLT.
- Criar logs de auditoria para operacoes sensiveis.

### Fase 3

- Definir retencao automatica para mensagens, notificacoes e logs.
- Criar rotina de limpeza/arquivamento.
- Revisar termos, bases legais e consentimentos com apoio juridico.

