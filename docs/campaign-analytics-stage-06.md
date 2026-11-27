# Disparos — contrato analítico V1

## Auditoria e fontes

O painel anterior carregava destinatários e mensagens em memória, misturava datas de criação/envio com datas de entrega/leitura/interação e usava identificadores de provedor sem conferir toda a cadeia de escopo. Isso podia produzir denominadores incompatíveis, nomes de botão inferidos do corpo e contagem de envios apresentada como clientes únicos.

As fontes continuam sendo Campaign, CampaignRecipient, Contact, Channel, Conversation, Message e ConversationInboundEvent. ChatbotReplyCorrelation só exclui conflitos conhecidos; ativação do chatbot não é requisito para reconhecer evidência autenticada. Nenhum schema, migration, backfill ou contador paralelo foi criado. O webhook, message-delivery, disparador de campanhas, IA, respostas fixas e chatbot não foram modificados.

## Coorte e unidades

Hoje/7 dias/30 dias selecionam a coorte por COALESCE(CampaignRecipient.sentAt, createdAt), entre meia-noite de São Paulo e o instante da consulta. Leituras e interações desses envios são acumuladas até o snapshot. Não é uma série de eventos ocorridos no período: uma resposta recente a envio fora da coorte não entra nela.

Uma linha representa o destinatário/envio **atualmente referenciado** pelo CampaignRecipient. Não representa todas as tentativas históricas. Em reenvio que substitui providerMessageId, não se atribui o ID antigo à nova tentativa. O modelo existente não oferece histórico completo da associação tentativa → campanha; essa limitação fica explícita, sem inventar vínculos por telefone, horário ou template.

| Indicador | Unidade / regra |
|---|---|
| Selecionados | Linhas da coorte filtrada |
| Enviados elegíveis | Linhas com sentAt, mensagem template vinculada ou deliveredAt |
| Entrega Meta confirmada | deliveredAt do destinatário, readAt oficial ou status delivered da mensagem de origem |
| Leitura oficial | Somente Message.readAt não nulo da origem única |
| Adicional por interação | Envio sem leitura oficial, com clique ou texto explicitamente vinculado |
| Total identificado | União por envio: leitura oficial OU clique OU texto vinculado |
| Falhas/pendentes/cancelados | Estado operacional atual exclusivo do destinatário; não soma dos cumulativos |
| Cliques/textos | Eventos inbound distintos comprovados, separados por tipo |
| Destinatários que clicaram/responderam/interagiram | Contact distinto na coorte; interação é união, não soma |
| Interação sem entrega Meta | Evidência separada; não grava entrega/readAt nem altera estado |

Taxas de entrega/leitura oficial/leitura identificada = linhas correspondentes ÷ envios elegíveis. Taxas de clique/interação = contatos distintos correspondentes ÷ contatos distintos com envio elegível. Zero denominador retorna 0; percentuais são finitos, limitados a 0–100 e arredondados a uma casa. O alias legado clickRateFromRead acompanha clickRate; a interface agora explicita o denominador correto, sem usar leituras como população dos cliques.

Entrega/leitura/interação são cumulativos sobrepostos. Uma confirmação oficial tardia troca evidência adicional por oficial sem aumentar a união. readAt é preservado mesmo se um status operacional tardio regredir; analytics nunca altera o escritor de recibos.

## Atribuição e deduplicação

Exige cadeia exata company → campanha → canal → contato → conversa → mensagem template outbound → contextProviderMessageId inbound. Mensagem e destinatário de origem precisam ser únicos no escopo. Os índices parciais PostgreSQL existentes também impedem reutilização de providerMessageId.

O inbound deve ter ConversationInboundEvent imutável com proveniência META_WEBHOOK_HMAC_SHA256_VERIFIED v1, todos os vínculos coincidentes e snapshot v1 consistente. TEMPLATE_BUTTON só conta como clique se o tipo da mensagem também for button. Texto só conta como resposta se for TEXT e trouxer contexto explícito. Snapshot em conflito ou correlação CONFLICT/AMBIGUOUS não conta. Quando existe catálogo histórico de botões, exige QUICK_REPLY com rótulo compatível. Não há lista fixa de rótulos. URL externa não é clique observável pelo webhook. Catálogo ausente não impede evidência TEMPLATE_BUTTON autenticada e explicitamente vinculada, mas não permite distinguir botão histórico ausente de catálogo incompleto.

Deduplica por canal + ID inbound do provedor, com verificações de consistência de origem, tipo, opção e digest. Webhook idêntico não aumenta eventos. Dois cliques reais distintos podem aumentar eventos sem aumentar contatos únicos. Contatos de duas campanhas ou canais não misturam envios nem evidências; no consolidado o contato único permanece único.

Textos sem contexto ficam em contagem separada por janela de recebimento/canal. Não são atribuídos a uma campanha/template selecionado. Históricos sem proveniência/snapshot não são promovidos a evidência por heurística. Mensagens de origem ambígua/ausente aparecem no aviso de cobertura. Não se lê corpo inbound para criar rótulos e não se retorna payload, snapshot, tokens ou variáveis do template.

## APIs, limites e segurança

GET /api/campaigns/analytics e GET /api/campaigns/analytics/export permanecem restritos a ADMIN da empresa autenticada. Campanha/canal de outra empresa retorna 404; filtros inválidos retornam 400; erros internos retornam 503 sem exceção bruta. Cache no-store. Não expande permissões.

Agregações SQL com parâmetros, sem N+1 e sem carregar toda a população no Node. Logs de 50 linhas; grupos/botões de 50; atividade recente de 20; seletores de até 100 incluindo a seleção atual. Paginação limitada e estável por data/ID; crescimento concorrente entre páginas pode deslocar offsets. Cada resposta usa snapshot transacional consistente. PostgreSQL usa REPEATABLE READ, READ ONLY, statement_timeout de 10s e transação de até 20s. O JSON seguro usa pg_input_is_valid, portanto requer PostgreSQL 16+. SQLite usa JSON1, CASE json_valid e agregações equivalentes.

CSV analítico novo e versionado campaign-analytics-v1.csv, BOM UTF-8, delimitador ponto-e-vírgula, proteção de fórmula via serializeCsvCell, mesmos filtros/atribuição. Até 10.000 linhas; acima disso retorna EXPORT_LIMIT e exige refinar filtros. Campos de contato só ficam disponíveis aos administradores já autorizados, no contexto operacional/exportação. O relatório CSV operacional antigo e seu formato permanecem intactos.

## Homologação e rollback

1. Em ambiente isolado, autenticar ADMIN e abrir Disparos; conferir seleção consolidada/campanha, período, canal, template, status, interação e pesquisa.
2. Comparar totais com acompanhamento individual, grupos por botão e CSV v1. Clique sem readAt deve aparecer como adicional; confirmação tardia conserva o total identificado. Texto genérico não altera campanha.
3. Confirmar estados de carregamento/erro/vazio, paginação e legibilidade desktop/mobile. Nunca provocar disparo real para validar métricas.
4. Validar PostgreSQL 16+ e latência sob volume representativo antes de promover. Consultas possuem limites; campanhas muito grandes podem atingir timeout e apresentar erro recuperável, sem dado parcial.
5. Rollback por revert do commit do PR e deploy pelo processo habitual autorizado em outra etapa. Não há migration, escrita analítica ou backfill a desfazer. Não é necessário alterar flags de chatbot/IA/campanha.

Esta implementação não faz consultas ou mutações em produção e não depende de ativar chatbot, IA ou workers.

## Evidência local desta entrega

Node 20: 102 testes unitários/regressões de analytics, campanhas e Meta; 28 testes de analytics PostgreSQL; 4 testes SQLite; 17 testes existentes de runtime CLT com Meta simulado. O teste de volume inclui 3.000 envios com origem persistida e 1.000 leituras, agregação exata e página de 50 linhas. O cenário completo passou em aproximadamente 3,5s na rodada final local (incluindo a construção da fixture). Um ensaio concorrente com outras validações atingiu statement_timeout; os limites foram mantidos, e tanto fixture nova isolada quanto a suíte completa posterior passaram. Isso não substitui homologação de carga no ambiente de destino.

Prisma validate SQLite/PostgreSQL, TypeScript, lint, build e diff-check passaram. Navegador isolado validou dados reais sintéticos via API autenticada, filtro de cliques, CSV, desktop/mobile sem overflow da página e carregamento/vazio/erro/recuperação. Nenhum transporte real ou ambiente de produção foi utilizado.

Refresh automático do mesmo recorte preserva o painel e a posição da operação enquanto atualiza. Mudança de filtro só apresenta números após a resposta correspondente; requisições antigas são abortadas e não substituem o recorte atual. Erro retira a evidência anterior e apresenta mensagem recuperável.

Agregados SQLite aceitam epoch numérico/textual e datetime UTC sem timezone explícito; a serialização normaliza esses formatos sem mudar o caminho Date do PostgreSQL.
