# Piloto do chatbot comercial CLT

## Preparação

Use uma instância de homologação com a migration do PR aplicada, inicializada por `npm run start`. O processo inicia o consumidor CLT pelo preload do servidor. O vínculo de cada campanha começa desativado.

Separe um canal WhatsApp Meta válido, um destinatário de teste autorizado e um template aprovado com um botão `QUICK_REPLY` intitulado `Conferir` ou `Verificar`. Use um destinatário com conversa sem atendente, sem sessão de IA em andamento e sem bootstrap ou pré-qualificação OpenCredit pendente. Faça a ativação em uma janela sem envios concorrentes para esse contato.

## Configuração administrativa

As chamadas exigem uma sessão de administrador da empresa da campanha.

| Operação | Método e caminho | Corpo |
|---|---|---|
| Configurar e publicar | `POST /api/campaigns/clt-chatbot` | `{"campaignId":"ID","buttonTitle":"Conferir"}` |
| Ativar | `PATCH /api/campaigns/clt-chatbot` | `{"campaignId":"ID","enabled":true}` |
| Consultar | `GET /api/campaigns/clt-chatbot?campaignId=ID` | |
| Pausar | `PATCH /api/campaigns/clt-chatbot` | `{"campaignId":"ID","enabled":false}` |

Ative antes de enviar o template. O bot só aceita o clique de um envio registrado a partir da ativação atual. Após uma pausa, use uma nova campanha ou um novo destinatário para testar a ativação novamente. Uma campanha com vínculo ativo reserva seu destinatário no canal para esse percurso. A distribuição automática volta a atuar quando a sessão é encaminhada à fila humana.

## Aceitação e rollback

1. Envie o template pelo fluxo de campanha para o único destinatário de teste. Confirme no CRM que a mensagem e o destinatário registraram o mesmo ID da Meta.
2. Clique no botão do template. Confira que aparece um único primeiro menu. Escolha um caminho e digite a resposta diretamente no WhatsApp. Para testar a escolha de prioridade, selecione **Já recebi** e digite **não lembro**.
3. Confira a mensagem final, a conversa na fila humana e o histórico com os botões e textos enviados e recebidos. Em outro teste, assuma a conversa enquanto o bot aguarda uma resposta. Confirme que o bot encerrou a sessão e que o atendente consegue responder.
4. Pause o vínculo para retirar o piloto da operação. O consumidor devolve as sessões ativas para a fila e cancela envios ainda não autorizados. Um envio com permissão concedida pode terminar. Para interromper também os templates da campanha, pause os disparos no controle da campanha.

Se um envio ficar com resultado `UNKNOWN`, a operação retém o slot sem reenvio automático. Consulte `GET /api/campaigns/clt-chatbot/reconcile?campaignId=ID`. Após confirmar o encerramento do executor e verificar o resultado junto ao provedor, um administrador pode registrar a decisão em `POST /api/campaigns/clt-chatbot/reconcile`. Envie `campaignId`, `operationId`, uma `logicalKey` estável, `evidenceReference` com a referência da verificação, `executorTerminated: true` e `resolution: "SENT"` ou `"FAILED"`. Para `SENT` inclua `providerMessageId`. A reconciliação libera o slot e grava um evento de auditoria. Ela não repete a mensagem nem reabre a sessão.
