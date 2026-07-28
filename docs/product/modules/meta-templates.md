# Meta Templates

Este módulo representa a Biblioteca Local de Templates Meta do CRM AI Base. Ele deve centralizar:

- templates;
- componentes;
- mídia padrão;
- status operacional;
- compatibilidade;
- sincronização;
- uso em campanhas e conversas.

## Problema atual

O CRM já entende internamente os componentes de templates da Meta por meio do normalizador central criado em `811d319`, mas ainda não possui uma biblioteca local persistida de templates.

Hoje, um template aprovado com imagem pode exigir ajuste técnico manual porque a mídia do header ainda não pertence ao template dentro do CRM. Isso força soluções como URL pública configurada fora da rotina do operador, mapeamento por código ou imagem associada manualmente em outro ponto do fluxo.

## Experiência desejada

Na criação de uma campanha, o operador deve informar apenas:

- canal;
- template;
- planilha;
- configurações normais da campanha.

O operador não deve informar URL de imagem, repetir upload por campanha, escolher media id ou entender detalhes como `header_handle`, URL pública, storage ou renovação.

Cada template poderá ter sua própria mídia padrão. A campanha deve herdar automaticamente a mídia vinculada ao template.

## O que não pertence ao operador

O operador nunca deve:

- informar URL pública;
- conhecer ou preencher `media_id`;
- conhecer ou preencher `header_handle`;
- renovar mídia manualmente;
- repetir upload por campanha;
- configurar detalhes técnicos da API da Meta;
- depender do Codex para vincular imagens a templates.

## Templates antigos

Para templates já existentes e sincronizados da Meta:

1. O CRM sincroniza o template.
2. O CRM identifica se o template exige mídia de header.
3. Um usuário autorizado faz a associação inicial da imagem uma única vez.
4. A partir daí, campanhas e conversas usam essa mídia automaticamente.

## Templates novos

Fluxo futuro desejado:

1. O operador cria o template no CRM.
2. O operador adiciona a imagem no próprio CRM.
3. O CRM envia o template para aprovação da Meta.
4. Após aprovação, o template fica pronto para campanhas e conversas.

Esse fluxo ainda não será implementado agora, mas a arquitetura deve permitir essa evolução.

## Ciclo de vida

O módulo deve separar dois conceitos:

- status da Meta: estado retornado pela Meta, como `APPROVED`, `REJECTED`, `PAUSED` ou `DISABLED`;
- estado operacional do CRM: estado calculado pelo CRM, como `NEEDS_MEDIA`, `READY`, `UNSUPPORTED` ou `SYNC_ERROR`.

Esses conceitos não devem ser misturados em um único campo lógico na arquitetura futura.

Estados operacionais sugeridos:

- `SYNCED`: sincronizado da Meta.
- `NEEDS_MEDIA`: exige mídia e ainda não foi configurado.
- `READY`: pronto para uso.
- `UNSUPPORTED`: possui componente ainda não suportado pelo CRM.
- `NOT_RETURNED`: não retornou na última sincronização.
- `SYNC_ERROR`: houve erro ao sincronizar.

## Estado READY

`READY` não é o mesmo que `APPROVED` na Meta. `READY` é um estado operacional calculado pelo CRM.

Um template só pode estar `READY` quando:

- estiver sincronizado ou cadastrado corretamente;
- estiver aprovado e disponível para envio na Meta;
- possuir todos os componentes necessários;
- utilizar apenas componentes suportados pelo CRM;
- possuir mídia padrão configurada quando o header exigir mídia;
- possuir dados suficientes para o serviço de envio resolver automaticamente o payload.

## Regras da mídia

- A mídia padrão pertence ao template, não à campanha.
- A campanha herda a mídia do template.
- Upload por campanha não faz parte do fluxo atual de templates.
- O operador não informa URL manualmente.
- O sistema não deve assumir que `header_handle` e `media_id` são equivalentes.
- Decisões sobre expiração, renovação e validade de mídia devem ser confirmadas contra a API da Meta antes da implementação.
- A arquitetura deve permitir override de mídia por campanha no futuro, mas isso fica fora do escopo inicial.

## Responsabilidades do CRM

- Sincronizar templates por empresa e canal/WABA.
- Normalizar componentes com o normalizador central.
- Guardar estrutura suficiente para preview, compatibilidade e envio futuro.
- Indicar se o template está pronto ou exige configuração.
- Esconder URL, storage, `media_id`, `header_handle` e detalhes técnicos.
- Reutilizar automaticamente a mídia configurada.
- Preservar isolamento por `companyId`.

## Responsabilidades do operador

- Escolher canal.
- Escolher template.
- Preencher variáveis necessárias.
- Associar mídia ao template apenas uma vez quando o CRM indicar necessidade.
- Criar campanhas sem repetir configuração técnica.

## Limites e pontos não confirmados

- Não assumir equivalência entre `header_handle` e `media_id`.
- Não assumir reuso, validade ou expiração de media id sem confirmação.
- Não decidir storage definitivo sem etapa técnica própria.
- Não alterar o fluxo atual de envio até a biblioteca local estar pronta.
- Não remover env/hardcoded existentes antes de migração segura.

## Roadmap técnico inicial

### T2.1 — Schema local de templates

Criar model local para templates por empresa e WABA/canal, com campos estruturados e JSON serializado para payload bruto.

### T2.2 — Repository/service

Criar camada de leitura, upsert e consulta da biblioteca local, sempre filtrando por `companyId`.

### T2.3 — Sincronização com a Meta

Buscar templates aprovados, normalizar com `normalizeMetaTemplate()`, fazer upsert e preservar mídia já configurada.

### T2.4 — API interna

Criar endpoints internos para listar templates, consultar detalhe e disparar sincronização.

### T2.5 — Configuração única da mídia

Permitir associar a mídia padrão ao template uma única vez, escondendo detalhes técnicos do operador.

### T2.6 — Integração com campanhas

Fazer campanhas usarem a biblioteca local e herdarem automaticamente a mídia do template.

### T2.7 — Integração com conversas

Fazer o envio individual de templates usar a mesma biblioteca local.

### T2.8 — Criação e aprovação de templates pelo CRM

Permitir criar templates no CRM, anexar mídia e enviar para aprovação da Meta.
