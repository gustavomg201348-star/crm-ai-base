# Etapa 07 — Automações e Integrações

## Escopo e fontes

Os novos módulos reorganizam controles existentes. Não criam scheduler, worker,
executor, transporte, schema, migration ou mecanismo de ativação.

| Módulo | Fonte / controle reutilizado | Permissão |
| --- | --- | --- |
| Central de Controle | GET `/api/automations/overview`; agregados do banco | ADMIN da empresa |
| Regras Automáticas | Mesmo snapshot; agenda SEM MARGEM e atalhos aos módulos existentes | ADMIN da empresa |
| Distribuição de Leads | GET `/api/automations/distribution`; `OperationalSettings`; PATCH `/api/settings/lead-assignment` | ADMIN da empresa |
| OpenCredit | GET `/api/integrations/opencredit/monitor`; `OpenCreditSettingsCard` original | ADMIN; operações privilegiadas continuam exigindo Platform Admin |
| Bancos | GET `/api/clt/integrations`, catálogo `/api/clt/banks`; PATCH e ações authenticate/verify-sms/test existentes | ADMIN; contratos existentes preservados |

O servidor deriva `companyId` exclusivamente da sessão. SUPERVISOR e AGENT não
ganham acesso aos novos módulos administrativos. Simulação CLT continua operacional
para seus papéis anteriores, sem o formulário administrativo de bancos. Chatbot e
IA permanecem em Comunicação. Disponibilidade permanece em Equipe.

Configurações mantém origens e atalhos; não duplica OpenCredit ou distribuição.
O GET antigo de distribuição deixa de inicializar configurações por upsert:
retorna defaults em memória quando não há registro. O PATCH e a atribuição real
continuam usando os serviços anteriores.

## Consultas e limites

As três novas leituras usam transação PostgreSQL REPEATABLE READ, READ ONLY,
statement timeout de 5 segundos, timeout de transação de 15 segundos e maxWait
de 2 segundos. SQLite utiliza consultas ORM sem escrita. Navegar/atualizar não
executa claim, recover, expire, materialização, avaliação de identidade ou envio.

- Agregados por estado são contagens persistidas da empresa, não listas de payloads.
- OpenCredit: 50 jobs por página, ordenação `createdAt DESC, id DESC`, filtro por
  estado/integração e até 20 recebimentos recentes. Integrações limitadas a 50.
  Paginação por offset é navegação de monitoramento; novos inbounds podem deslocar
  páginas. Não é mecanismo de processamento nem exportação consistente entre páginas.
- Distribuição: até 500 usuários; totais agregados exatos. Acima desse limite a
  capacidade é marcada incompleta e não se apresenta um saldo falsamente exato.
  O snapshot não reserva vagas; a atribuição transacional original decide.
- Bancos na Central: até 100 registros de metadados. Sem colunas de credenciais.
- SEM MARGEM: até 20 próximas tarefas; estados agregados das tarefas automáticas
  identificadas pelo prefixo original `sem-margem-` e pelo mesmo tenant do contato.
- Logs CLT e operações outbound de origem AI: últimos 7 dias. Histórico restante
  tem escopo explicitado na interface. Atualização manual, sem polling automático.

## Interpretação dos indicadores

Uma flag ON significa configuração habilitada, nunca comprovação de execução.
Sem heartbeat durável, estado atual do worker e da IA é UNKNOWN. Batch, intervalo
e modo são configuração do runtime que respondeu, não prova de saúde do processo.
Uma operação outbound SENT é evidência persistida de envio, não de entrega/leitura
ou disponibilidade atual do provider. Ausência de registros não demonstra falha.

`interlockReady = !enabled && materializationEnabled`, exatamente como no preflight
existente. Paused, passiveInboundEnabled e presença de binding são mostrados
separadamente. PENDING não implica READY: não há decrypt nem readiness no monitor.
COMPLETED é estado persistido; não comprova template enviado ou atendimento entregue.
Inbox passiva e leads legados permanecem separados. Não há contador histórico
confiável de reentregas descartadas; a interface não inventa uma contagem.

AutoStart é `OpenCreditWhatsappConfig.autoStartEnabled`, distinto de
`OpenCreditIntegration.enabled` legado. Card e endpoints originais mantêm seus
interlocks, exportação e permissões; a nova Central não liga nenhum deles.

SEM MARGEM continua calculando dia 23 do mês seguinte às 08:00 em
America/Sao_Paulo. O monitor não reescreve datas históricas, tarefas manuais,
exceções ou disponibilidade de atendentes. Também não cria backfill.

## Credenciais bancárias

Os adapters, armazenamento criptográfico, mascaramento e endpoints não mudam.
Campos sensíveis são inputs password e não são preenchidos com valores/preview
do backend. Campos vazios são omitidos no PATCH, preservando credenciais existentes.
Valores de diagnóstico livre (`lastTestMessage`) não são mostrados na nova tela.
GET não provisiona bancos nem autentica. Provisionamento continua sendo ação
administrativa explícita no endpoint existente. Não há teste automático ao navegar.

Fallback de leitura não é conexão confirmada: ações ficam bloqueadas até leitura
válida, com botão de atualização disponível. Ações possuem mutex local e não são
repetidas automaticamente se o resultado for incerto. O endpoint `test` existente
valida configuração local; seu resultado não comprova alcance atual da API bancária.

## Riscos, homologação e rollback

Agregações ainda consomem recursos proporcionais aos índices/dados do tenant,
apesar dos limites de linhas e deadlines. Em erro, o monitor retorna indisponível
e permite atualização manual, sem inicializar dados nem executar recuperação.
Uma amostra bounded não substitui auditoria operacional completa de ativação.

Homologar com dados sintéticos: ADMIN, SUPERVISOR e AGENT; empresa sem registros;
empresa com todos os estados; erro/retorno da API; desktop e mobile. Verificar
que navegar não muda estados, attempts, leases, flags ou entidades de domínio.
Somente em ambiente isolado, salvar distribuição e credenciais fictícias para
validar o writer anterior e preservar blanks. Conferir Simulação, Equipe, Agenda,
Atendimento, Disparos, Chatbot e IA sem ativar fluxos reais.

Rollback: reverter o commit da Etapa 07. Não existe migration nem transformação
de dados a desfazer. Configurações salvas pelos endpoints anteriores permanecem
no mesmo formato. Não desligar/ligar workers ou alterar Railway como parte do rollback.

## Validação local

Node 20.20.2, PostgreSQL descartável próprio em 127.0.0.1:55432 (UTC), dois
bancos de testes, e SQLite temporário. Nenhuma credencial, dado ou sessão real.
Transportes externos proibidos na suíte nova e no servidor/browser de homologação.

- 271 testes unitários: monitor, navegação, SEM MARGEM, IA, credenciais CLT,
  onboarding, WhatsApp, worker, preflight, configuração, Agenda e Equipe.
- 380 testes PostgreSQL: monitor 19; inbound 38; queue 30; materializer 62;
  WhatsApp 146; distribuição 23; Agenda 10; Equipe 7; Disparos 28; Chatbot 17.
- 16 verificações de browser: desktop/mobile, filtros/paginação, configuração
  original, roles, navegação sem escrita, formulário bancário mascarado,
  PATCH sintético preservando blanks, distribuição, vazio, loading, erro e recuperação.
- SQLite: 9 leituras reais dos três monitores, sem inicialização/escrita.
- `npm run verify` (Prisma, TypeScript, lint), schema PostgreSQL, build e diff check.

A suíte da fila exigiu banco limpo porque uma contraprova compara resultados de
recover global com a própria fixture. Uma leitura de Dashboard perdeu conexão
durante carga concorrente e Disparos excedeu seu timeout existente de 20s durante
build concorrente. Ambas passaram em repetição sem modificar código ou timeouts.
Essas ocorrências locais não foram usadas para reduzir asserções ou dispensar CI.
O Dashboard legado usa uma expressão SQL incompatível com SQLite e retornou 500
no browser SQLite; seu código não muda neste PR e sua regressão PostgreSQL passou.
As capturas finais usam PostgreSQL isolado. A inspeção visual corrigiu no formulário
extraído o uso da cor inexistente `primary`, substituída pela cor `brand` do tema.
Na CI, o gerador de scope da fixture foi ajustado para separar blocos aleatórios
com letras: a cauda numérica de um UUID podia atingir 11 dígitos e ser corretamente
rejeitada pela constraint anti-CPF. A constraint e as asserções permanecem intactas.
