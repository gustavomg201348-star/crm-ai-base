# UX-006B — Product Architecture Review Conversations

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: auditoria documental de arquitetura de produto
Status: revisão concluída

## 1. Objetivo

Este documento registra a auditoria documental completa da arquitetura de produto da tela Conversations, atuando como um Product Review Board sobre as especificações UX-001 até UX-006A.

A revisão avalia se a experiência planejada cobre adequadamente produtividade do operador, redução de cliques, fluxo mental do atendimento, consistência entre componentes, hierarquia visual, carga cognitiva, informações ausentes, informações redundantes, microinterações desejáveis, oportunidades de automação e riscos operacionais.

Esta auditoria é exclusivamente de produto. Ela não avalia implementação, CSS, React, banco de dados, APIs ou viabilidade técnica.

## 2. Escopo revisado

Documentos revisados:

- UX-001 — Semáforo da Janela de Atendimento;
- UX-002 — Conversation Header;
- UX-003 — Conversation List;
- UX-004 — Conversation Timeline;
- UX-005 — Message Composer;
- UX-006 — Right Sidebar;
- UX-006A — Cross Review Conversations.

## 3. Pontos fortes

### 3.1 Arquitetura de responsabilidades bem separada

Os documentos estabelecem responsabilidades claras:

- a List orienta triagem;
- o Header resume contexto imediato;
- a Timeline preserva narrativa e histórico;
- o Composer concentra ação;
- a Sidebar oferece contexto progressivo;
- o semáforo 24h atravessa a experiência como indicador operacional.

Essa separação reduz risco de componentes competirem pelo mesmo papel.

### 3.2 Forte foco em produtividade operacional

As especificações estão orientadas a reduzir tempo de triagem, leitura e resposta. Há atenção recorrente a:

- menos troca de telas;
- menos cliques;
- ações próximas do contexto;
- leitura rápida;
- feedback imediato;
- estados claros.

### 3.3 Boa maturidade de princípios de UX

Os princípios estão consistentes:

- informação principal não depende de hover;
- mensagens são protagonistas;
- eventos do sistema são discretos;
- Sidebar não compete com Timeline e Composer;
- Composer é consciente do contexto;
- cor não é o único meio de comunicação;
- rollback deve ser visual e isolado.

### 3.4 Tratamento adequado de estados operacionais

Os documentos mapeiam estados críticos da operação:

- janela aberta, atenção, crítica e encerrada;
- conversa ativa, pendente, em bot e resolvida;
- mensagens enviando, enviadas, falhando ou pendentes;
- conversa sem responsável;
- canal indisponível ou sem regra.

Isso cria uma boa base para consistência futura.

### 3.5 Forte preocupação com reversibilidade

Todas as specs reforçam:

- patch isolado;
- rollback visual;
- preservação de comportamento existente;
- auditoria READ ONLY;
- commit individual.

Essa disciplina é especialmente valiosa em uma tela central como Conversations.

### 3.6 Boa leitura do fluxo mental do operador

A jornada descrita segue um fluxo realista:

1. triagem;
2. seleção;
3. confirmação de contexto;
4. leitura do histórico;
5. consulta lateral;
6. resposta;
7. confirmação pós-ação.

Esse fluxo é adequado para operações de atendimento com volume.

## 4. Pontos fracos

### 4.1 Falta de definição explícita de prioridade entre alertas concorrentes

Os documentos citam múltiplos sinais críticos:

- janela crítica;
- unread;
- sem responsável;
- falha de envio;
- conversa pendente;
- tarefa vencida;
- canal indisponível.

Ainda falta uma regra de produto explícita para ordenar esses sinais quando aparecem juntos.

### 4.2 Microcopy ainda está aberta demais

UX-006A já reconhece variações como:

- “Janela aberta” versus “Resposta disponível”;
- “Conversa resolvida” versus “Conversa encerrada”;
- “Sem responsável” versus “Não atribuído”.

Essa abertura é aceitável na fase de especificação, mas pode gerar inconsistência se não for resolvida antes da implementação visual.

### 4.3 Falta de política clara para colapso de informação

List, Header e Sidebar podem acumular muitos sinais. Os documentos dizem para evitar excesso, mas ainda não definem:

- quantos badges são aceitáveis;
- quando agrupar;
- quando esconder em “mais”;
- quando promover um alerta para destaque;
- quando reduzir detalhe para preservar legibilidade.

### 4.4 Pouca definição sobre comportamento responsivo

As specs mencionam telas estreitas e responsividade como caso extremo, mas ainda não definem uma estratégia de produto:

- o que some primeiro;
- o que vira painel;
- o que permanece obrigatório;
- como Composer, Timeline e Sidebar competem por espaço.

### 4.5 Oportunidades de automação estão contidas, mas pouco estruturadas

Os documentos evitam criar automações, corretamente. Porém, como revisão de produto, há espaço para mapear automações futuras sem comprometer implementação:

- sugestões de próxima ação;
- priorização assistida;
- agrupamento de conversas por risco;
- resumo automático do contexto.

Essas ideias poderiam ficar classificadas como “não implementar agora, mas preservar espaço de UX”.

## 5. Melhorias recomendadas

### 5.1 Criar uma matriz oficial de prioridade visual

Recomendação: antes da implementação de UX-001 ou UX-003, criar uma matriz simples de precedência entre alertas.

Prioridade sugerida:

1. Falha de envio ou erro operacional.
2. Janela crítica ou encerrada.
3. Mensagem não lida do cliente.
4. Conversa sem responsável.
5. Conversa pendente.
6. Tarefa vencida.
7. IA ou bot ativo exigindo atenção.
8. Proposta em etapa sensível.
9. Tags informativas.
10. Indicadores neutros.

Benefício: evita que cada componente decida destaque de forma independente.

### 5.2 Congelar glossário visual antes do primeiro patch

Recomendação: criar uma tabela curta de termos finais para estados compartilhados.

Termos que precisam decisão:

- janela aberta;
- janela em atenção;
- janela crítica;
- janela encerrada;
- conversa resolvida;
- conversa pendente;
- sem responsável;
- em bot;
- canal sem regra;
- mensagem com falha.

Benefício: reduz inconsistência entre List, Header, Timeline e Composer.

### 5.3 Definir regra de limite de badges por área

Recomendação: estabelecer limites conceituais:

- List: no máximo poucos indicadores visíveis por item;
- Header: alertas críticos antes de badges informativos;
- Sidebar: pode ter mais detalhe, mas organizado em cards;
- Timeline: eventos discretos, mensagens protagonistas.

Benefício: reduz sobrecarga cognitiva.

### 5.4 Definir comportamento de “resumo de contexto”

Recomendação: formalizar um pequeno bloco conceitual de resumo do atendimento, que pode viver no Header ou Sidebar.

Conteúdo possível:

- último contato do cliente;
- status atual;
- responsável;
- próxima ação sugerida;
- vínculo comercial mais relevante.

Benefício: reduz leitura repetitiva da timeline.

### 5.5 Definir política de atualização em tempo real por zona da tela

Recomendação: documentar como cada área deve reagir a atualizações:

- List pode destacar item atualizado;
- Timeline pode inserir nova mensagem;
- Header deve evitar layout jump;
- Sidebar deve atualizar discretamente;
- Composer não deve perder foco.

Benefício: preserva concentração do operador.

### 5.6 Adicionar critérios de “não interrupção”

Recomendação: incluir princípio global:

> Nenhuma atualização visual deve interromper digitação, leitura em andamento ou seleção ativa sem necessidade operacional clara.

Benefício: protege fluxo mental do atendente.

### 5.7 Mapear “modo retomada”

Recomendação: adicionar conceito de retomada de conversa para quando operador abre atendimento iniciado por outro agente, bot ou IA.

Elementos úteis:

- resumo da última intenção;
- última ação operacional;
- último responsável;
- mensagem mais recente do cliente;
- pendência atual.

Benefício: acelera continuidade e reduz retrabalho.

## 6. Melhorias opcionais

### 6.1 Modo foco de atendimento

Um modo opcional poderia reduzir elementos secundários e destacar Timeline + Composer para operadores em alto volume.

Status: opcional, não bloqueador.

### 6.2 Indicador de “cliente aguardando”

Além de unread, um indicador textual ou visual poderia sinalizar quando a última mensagem é do cliente e ainda não houve resposta humana.

Status: recomendado como evolução futura.

### 6.3 Sinalização de “contexto novo desde que você abriu”

Quando uma conversa recebe atualização enquanto está aberta, a interface poderia indicar “novo evento” sem mover bruscamente a tela.

Status: opcional, útil para realtime.

### 6.4 Resumo compacto gerado por IA

A Sidebar ou Header poderia futuramente reservar espaço para um resumo assistido da conversa.

Status: opcional, dependente de governança da IA.

### 6.5 Marcadores de handoff

Eventos de troca entre bot, IA e humano poderiam ter tratamento visual especial.

Status: opcional, recomendado para operações com automação intensa.

### 6.6 Indicador de “ação recomendada”

A tela poderia sugerir ações como responder, atribuir, criar tarefa ou revisar proposta.

Status: opcional, não deve bloquear UX-001 a UX-006.

## 7. Conflitos encontrados

### 7.1 Janela 24h aparece em List, Header e Composer

Conflito: a mesma informação pode aparecer em três áreas.

Avaliação: conflito aceitável, desde que cada área use peso diferente.

Recomendação:

- List: triagem;
- Header: contexto;
- Composer: capacidade ou restrição de envio.

### 7.2 Responsável aparece em List, Header e Sidebar

Conflito: risco de redundância.

Avaliação: aceitável, pois ownership é central.

Recomendação:

- List: indicador compacto;
- Header: estado operacional;
- Sidebar: contexto e ações relacionadas.

### 7.3 Propostas aparecem na Timeline e Sidebar

Conflito: risco de duplicação de detalhe.

Avaliação: exige cuidado.

Recomendação:

- Timeline: evento narrativo;
- Sidebar: card contextual;
- detalhes completos fora da conversa.

### 7.4 Quick actions podem aparecer no Header e Sidebar

Conflito: ações duplicadas podem confundir.

Avaliação: precisa hierarquia clara.

Recomendação:

- Header: ações de conversa;
- Sidebar: ações relacionadas ao contato, proposta, tarefa ou campanha.

### 7.5 IA aparece em Timeline, Composer, List, Header e Sidebar

Conflito: risco de excesso de sinalização.

Avaliação: aceitável se IA tiver linguagem única.

Recomendação:

- Timeline: autoria ou evento;
- Composer: sugestão;
- Sidebar: contexto resumido;
- Header/List: apenas quando operacionalmente relevante.

## 8. Lacunas

### 8.1 Falta de regra de desempate visual

Não há decisão final para quando múltiplos estados críticos ocorrem simultaneamente.

Exemplo: conversa não lida, janela crítica, sem responsável e tarefa vencida.

### 8.2 Falta de especificação de compactação

Ainda falta definir quando uma informação deve:

- aparecer explicitamente;
- virar ícone;
- virar badge;
- ser agrupada;
- ir para menu;
- ficar apenas na Sidebar.

### 8.3 Falta de política de tempo relativo

Horários aparecem em várias specs, mas falta padronizar:

- “agora”;
- minutos;
- horas;
- ontem;
- data absoluta;
- conversas antigas.

### 8.4 Falta de estado de “atendimento em risco”

Há sinais individuais de risco, mas não um conceito agregado de atendimento em risco.

Possíveis critérios futuros:

- janela crítica;
- cliente aguardando;
- sem responsável;
- tarefa vencida;
- falha de envio.

### 8.5 Falta de critério de sucesso mensurável por UX

Os objetivos são bons, mas poderiam ser mais mensuráveis.

Exemplos:

- reduzir tempo de triagem;
- reduzir cliques para abrir contexto;
- reduzir tempo para iniciar resposta;
- reduzir necessidade de abrir perfil do contato.

### 8.6 Falta de política para dados sensíveis na Sidebar e Header

A Sidebar menciona cautela, mas ainda falta diretriz mais objetiva:

- quando mascarar;
- quando revelar;
- quando copiar;
- quando exibir CPF ou telefone completo.

## 9. Priorização das melhorias

### P0 — Antes ou junto do início da implementação

1. Criar matriz de prioridade visual entre alertas.
2. Congelar glossário mínimo de estados compartilhados.
3. Definir regra de peso da janela 24h em List, Header e Composer.
4. Definir separação entre ações do Header e ações da Sidebar.

### P1 — Durante UX-001 a UX-003

5. Definir limite de badges por item da Conversation List.
6. Definir comportamento visual de unread versus janela crítica.
7. Definir política de horários relativos.
8. Definir comportamento de atualização em tempo real sem interrupção.

### P2 — Durante UX-004 a UX-006

9. Definir linguagem única para IA em Timeline, Composer e Sidebar.
10. Definir regra de proposta como evento versus card.
11. Definir regra de tarefa como evento versus card.
12. Definir estados vazios específicos por bloco da Sidebar.

### P3 — Backlog de evolução

13. Modo foco de atendimento.
14. Resumo contextual assistido por IA.
15. Indicador agregado de atendimento em risco.
16. Sugestão de próxima ação.
17. Marcadores avançados de handoff.

## 10. Avaliação por critério

### 10.1 Produtividade do operador

Avaliação: forte.

As specs reduzem troca de telas, leitura repetitiva e incerteza no envio. A produtividade deve melhorar principalmente com UX-003, UX-005 e UX-006.

Ponto de atenção: sem limite de badges e priorização visual, a produtividade pode cair por excesso de informação.

### 10.2 Redução de cliques

Avaliação: boa, mas ainda abstrata.

Há intenção clara de reduzir cliques com quick actions, Composer e Sidebar. Ainda falta especificar quais fluxos terão redução objetiva.

Recomendação: cada implementação deve declarar “fluxo antes/depois” em termos de passos esperados.

### 10.3 Fluxo mental do atendimento

Avaliação: muito forte.

A sequência List → Header → Timeline → Sidebar → Composer está bem alinhada ao raciocínio real do operador.

Ponto de atenção: Sidebar e Composer podem competir por atenção se quick actions forem excessivas.

### 10.4 Consistência entre componentes

Avaliação: boa.

UX-006A já mapeia responsabilidades e estados compartilhados. O ponto frágil é microcopy final e peso visual de badges.

### 10.5 Hierarquia visual

Avaliação: boa.

As specs protegem mensagens, Composer e contexto. Falta apenas definir uma política global de prioridade entre alertas concorrentes.

### 10.6 Sobrecarga cognitiva

Avaliação: risco médio.

As specs reconhecem o problema, mas a quantidade de indicadores possíveis é grande. O design de produto deve preservar compactação e revelar detalhe progressivamente.

### 10.7 Informações ausentes

Avaliação: lacunas moderadas.

Faltam definições mais explícitas para:

- atendimento em risco;
- tempo relativo;
- dados sensíveis;
- resumo de retomada;
- prioridade entre alertas.

### 10.8 Informações redundantes

Avaliação: controlável.

Há redundância saudável para canal, responsável e janela. O risco está em repetir com mesmo peso visual.

### 10.9 Microinterações desejáveis

Avaliação: boa, com espaço para reforço.

As specs citam feedback, atualização e foco. Poderiam reforçar:

- preservar digitação;
- destacar mudança sem mover conteúdo;
- confirmar cópia de dados;
- indicar atualização silenciosa.

### 10.10 Oportunidades de automação

Avaliação: embrionária.

A IA é bem tratada com cautela, mas ainda há oportunidade futura para:

- resumo de retomada;
- próxima ação sugerida;
- detecção de atendimento em risco;
- agrupamento inteligente de contexto;
- priorização assistida.

### 10.11 Riscos operacionais

Avaliação: bem reconhecidos.

Riscos principais:

- status visual errado;
- canal ambíguo;
- janela mal interpretada;
- envio com falsa segurança;
- eventos confundidos com mensagens;
- excesso de informação.

As specs reconhecem esses riscos e propõem rollback visual.

## 11. Recomendações consolidadas

### Recomendação 1 — Criar um mini “Interaction Priority Model”

Antes dos primeiros patches visuais, definir uma ordem oficial de sinais.

Objetivo: impedir disputa visual entre unread, janela, falha, responsável e tarefa.

### Recomendação 2 — Criar um glossário congelado da Sprint 6.1

Objetivo: evitar que cada UX implemente nomes diferentes para estados iguais.

### Recomendação 3 — Definir “zonas de ação”

Separar:

- Header: ações da conversa;
- Composer: ações de mensagem;
- Sidebar: ações do contato e objetos relacionados;
- Timeline: ações de leitura e contexto histórico;
- List: ações de triagem e seleção.

### Recomendação 4 — Definir política de interrupção zero

Nenhuma atualização deve interromper:

- digitação;
- leitura em histórico;
- seleção ativa;
- foco do operador.

### Recomendação 5 — Criar regra de progressive disclosure

Informação deve seguir esta ordem:

1. essencial visível;
2. útil compacta;
3. detalhe em Sidebar;
4. histórico na Timeline;
5. ação avançada em menu.

## 12. Decisão GO / NO GO da arquitetura de produto

### Decisão

GO com recomendações obrigatórias antes dos primeiros patches visuais.

### Justificativa

A arquitetura de produto da tela Conversations está sólida, coerente e pronta para implementação incremental. Os documentos UX-001 a UX-006A descrevem uma experiência com responsabilidades claras, boa hierarquia, foco operacional e baixo acoplamento conceitual entre componentes.

Não há conflito bloqueador. As lacunas encontradas não invalidam a arquitetura, mas algumas devem ser resolvidas antes ou durante os primeiros patches para evitar inconsistência visual.

### Condições para manter o GO

Antes de iniciar UX-001/UX-003:

- definir matriz de prioridade visual;
- congelar glossário mínimo;
- definir regra de limite de badges;
- definir peso da janela 24h em List, Header e Composer.

Durante UX-004/UX-006:

- definir linguagem única para IA;
- diferenciar claramente eventos versus cards;
- preservar Timeline e Composer como áreas principais;
- evitar competição visual da Sidebar.

## 13. Conclusão

A arquitetura da experiência da tela Conversations está pronta para implementação incremental.

O Product Review Board recomenda GO, com atenção obrigatória a quatro pontos antes do início prático das melhorias visuais: prioridade entre alertas, glossário de estados, limite de badges e política de atualização sem interrupção.

Com esses cuidados, a Sprint 6.1 tem boa base para evoluir a tela de Conversas de forma consistente, reversível e orientada à produtividade real do operador.
