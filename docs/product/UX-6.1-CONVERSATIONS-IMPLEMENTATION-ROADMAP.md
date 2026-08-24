# UX Sprint 6.1

## Conversations Implementation Roadmap

Este documento transforma a auditoria de UX da Sprint 6.1 em um plano de implementação incremental, seguro e auditável para a evolução da tela de Conversas.

O roadmap organiza prioridades, dependências, sequência oficial de entrega e critérios de aceite. Ele não define implementação técnica, não altera comportamento do sistema e não substitui auditorias específicas de cada melhoria. Sua função é servir como plano executivo da Sprint 6.1, garantindo que cada refinamento seja tratado de forma isolada, reversível e validável.

# Objetivos da Sprint

A Sprint 6.1 busca evoluir a experiência da tela de Conversas com foco em produtividade operacional e refinamento visual.

Os objetivos principais são:

- reduzir carga cognitiva;
- reduzir cliques;
- reduzir tempo de atendimento;
- melhorar leitura;
- aumentar consistência visual;
- aumentar velocidade operacional;
- melhorar percepção de qualidade do produto.

O foco da sprint é tornar a tela de Conversas mais clara, rápida e confiável para operadores, líderes e equipes comerciais, sem transformar melhorias de UX em mudanças funcionais amplas.

# Estratégia de implementação

A evolução da tela de Conversas deverá seguir uma estratégia incremental.

Princípios de execução:

- cada melhoria será implementada isoladamente;
- cada melhoria terá auditoria própria;
- cada melhoria terá commit próprio;
- cada melhoria poderá ser revertida individualmente;
- nenhuma implementação poderá misturar assuntos;
- cada mudança deverá preservar o comportamento existente;
- cada entrega deverá ser validada antes de seguir para a próxima.

Essa estratégia reduz risco, facilita revisão, permite rollback granular e mantém rastreabilidade clara entre problema UX, solução proposta e resultado em produção.

# Roadmap Executivo

| ID | Título | Prioridade | Complexidade | Impacto | Dependências | Status | Observações |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-001 | Semáforo da Janela de 24 horas | P0 | Média | Alto | Auditoria da regra visual da janela | Planejado | Primeira melhoria por orientar urgência operacional |
| UX-002 | Cabeçalho Operacional | P0 | Média | Alto | UX-001 recomendado | Planejado | Deve melhorar leitura de contato, canal e status |
| UX-003 | Lista de Conversas | P0 | Média | Alto | UX-001 | Planejado | Deve melhorar triagem e priorização |
| UX-004 | Timeline | P1 | Média | Alto | UX-002 recomendado | Planejado | Deve melhorar leitura do histórico |
| UX-005 | Composer | P1 | Média | Alto | UX-002 e UX-004 recomendados | Planejado | Deve melhorar segurança de resposta |
| UX-006 | Painel Lateral | P1 | Média | Médio/Alto | UX-002 recomendado | Planejado | Deve reduzir troca de telas |
| UX-007 | Feedback Visual | P1 | Baixa/Média | Alto | Pode evoluir em paralelo após UX-001 | Planejado | Deve padronizar retorno visual de ações |
| UX-008 | Estados Vazios | P2 | Baixa | Médio | Nenhuma crítica | Planejado | Deve reduzir confusão entre vazio, filtro e erro |
| UX-009 | Economia de Cliques | P2 | Média | Médio/Alto | Depende de UX-002 a UX-006 | Planejado | Deve consolidar atalhos e fluxos rápidos |
| UX-010 | Consistência Visual | P2 | Baixa/Média | Alto | Depende das entregas anteriores | Planejado | Deve harmonizar padrões finais |

# Ordem oficial de implementação

## Sprint 6.1.1 — UX-001

### Semáforo da janela de 24h

### Objetivo

Criar uma linguagem visual clara para indicar o estado operacional da janela de atendimento de 24 horas, ajudando o operador a entender urgência, possibilidade de resposta e risco de bloqueio.

### Escopo

- Definir estados visuais da janela.
- Diferenciar janela ativa, próxima do limite, expirada ou desconhecida.
- Garantir que o operador reconheça rapidamente quando uma conversa exige atenção.
- Manter o refinamento limitado ao problema visual da janela.

### Critério de aceite

- O operador consegue identificar o estado da janela sem abrir detalhes técnicos.
- A indicação visual é compreensível por texto e cor.
- O padrão é consistente na lista, cabeçalho ou local definido pela auditoria específica.
- Nenhum comportamento funcional existente é alterado.

### Riscos

- Criar sinal visual ambíguo.
- Exagerar alertas e gerar fadiga.
- Confundir status da conversa com status da janela.

### Rollback

Remover exclusivamente os elementos visuais introduzidos para o semáforo, preservando todos os demais comportamentos da tela.

## Sprint 6.1.2 — UX-002

### Cabeçalho Operacional

### Objetivo

Transformar o cabeçalho da conversa em um resumo operacional de alto valor, permitindo que o operador identifique contato, canal, status, responsável e ações principais rapidamente.

### Escopo

- Reorganizar hierarquia visual do cabeçalho.
- Destacar contato, canal, status e responsável.
- Melhorar legibilidade das ações principais.
- Reduzir ruído visual no topo da conversa.

### Critério de aceite

- O operador entende quem é o contato e qual é o contexto da conversa em poucos segundos.
- Canal e status ficam visualmente evidentes.
- Ações principais permanecem acessíveis e previsíveis.
- Nenhum fluxo funcional é alterado.

### Riscos

- Aumentar altura do cabeçalho e reduzir área útil da timeline.
- Criar excesso de informações concorrentes.
- Duplicar dados já presentes em outro bloco sem ganho real.

### Rollback

Restaurar o cabeçalho visual anterior mantendo intactos os dados e ações existentes.

## Sprint 6.1.3 — UX-003

### Lista de Conversas

### Objetivo

Melhorar a lista de conversas para acelerar triagem, priorização e navegação entre atendimentos.

### Escopo

- Refinar hierarquia de nome, última mensagem, horário e status.
- Destacar não lidas, atrasadas, sem responsável ou com última mensagem do cliente.
- Melhorar escaneabilidade da lista.
- Preservar filtros e seleção existentes.

### Critério de aceite

- Conversas que exigem ação ficam mais fáceis de localizar.
- A lista permanece legível em alto volume.
- O operador entende rapidamente última interação e prioridade.
- Nenhum comportamento de busca, filtro ou seleção é alterado.

### Riscos

- Aumentar densidade visual.
- Criar destaque excessivo para muitos itens ao mesmo tempo.
- Reduzir legibilidade da última mensagem.

### Rollback

Reverter apenas o refinamento visual da lista, preservando dados, filtros e navegação existentes.

## Sprint 6.1.4 — UX-004

### Timeline

### Objetivo

Melhorar a leitura do histórico conversacional, diferenciando mensagens, eventos, automações, IA, sistema e notas internas.

### Escopo

- Refinar diferenciação visual de tipos de item.
- Melhorar separação temporal.
- Evidenciar status de mensagem quando aplicável.
- Tornar eventos de sistema menos confundíveis com mensagens humanas.

### Critério de aceite

- O operador diferencia rapidamente mensagem recebida, enviada, automática e evento.
- A timeline fica mais legível em conversas longas.
- Informações secundárias não competem com o conteúdo principal.
- Nenhuma mensagem, evento ou histórico é removido.

### Riscos

- Criar muitos estilos visuais.
- Reduzir densidade útil da timeline.
- Enfraquecer legibilidade de mensagens longas.

### Rollback

Remover apenas os refinamentos visuais da timeline, mantendo a renderização e os dados existentes.

## Sprint 6.1.5 — UX-005

### Composer

### Objetivo

Tornar a área de resposta mais segura, clara e orientada ao estado da conversa e do canal.

### Escopo

- Melhorar clareza do campo de resposta.
- Indicar canal de envio.
- Exibir estados de envio, bloqueio ou indisponibilidade.
- Melhorar diferenciação entre mensagem livre, template e mídia quando aplicável.

### Critério de aceite

- O operador sabe se pode responder e por qual canal.
- O estado de envio ou bloqueio é compreensível.
- A ação principal de enviar permanece clara.
- Nenhum comportamento de envio é alterado.

### Riscos

- Introduzir bloqueio visual interpretado como bloqueio funcional.
- Confundir mensagem livre com template.
- Aumentar atrito para responder.

### Rollback

Restaurar visual anterior do composer sem alterar fluxo de envio ou persistência.

## Sprint 6.1.6 — UX-006

### Painel Lateral

### Objetivo

Reduzir troca de telas oferecendo contexto útil do contato e do relacionamento dentro da própria conversa.

### Escopo

- Organizar dados principais do contato.
- Evidenciar etapa, tags, origem e histórico resumido.
- Mostrar vínculos úteis como propostas, campanhas ou tarefas quando aplicável.
- Manter o painel como apoio contextual, não como tela completa de contato.

### Critério de aceite

- O operador obtém contexto suficiente sem sair da conversa.
- Informações são agrupadas por relevância.
- O painel não compete com a timeline.
- Nenhum dado cadastral ou vínculo é alterado.

### Riscos

- Sobrecarregar o painel com excesso de informação.
- Criar duplicidade visual com a página de contato.
- Aumentar necessidade de scroll lateral.

### Rollback

Reverter apenas a organização visual do painel, preservando dados e navegação existentes.

## Sprint 6.1.7 — UX-007

### Feedback Visual

### Objetivo

Padronizar retornos visuais para ações importantes na tela de Conversas, aumentando confiança do operador.

### Escopo

- Refinar feedback de envio, salvamento, falha, atribuição e mudança de status.
- Padronizar mensagens visuais de sucesso, erro e aviso.
- Diferenciar falha recuperável de falha crítica.
- Evitar feedback redundante ou excessivo.

### Critério de aceite

- Cada ação relevante possui retorno visual compreensível.
- Falhas não parecem sucesso.
- Sucessos não exigem conferência manual.
- Mensagens seguem tom e padrão visual consistentes.

### Riscos

- Excesso de toasts ou banners.
- Feedback visual que desaparece rápido demais.
- Mensagens genéricas que não orientam o operador.

### Rollback

Remover somente os novos padrões de feedback introduzidos, mantendo ações e respostas existentes.

## Sprint 6.1.8 — UX-008

### Estados Vazios

### Objetivo

Melhorar estados sem conteúdo para que o operador entenda se não há dados, se há filtros aplicados ou se ocorreu algum erro.

### Escopo

- Criar estados para nenhuma conversa selecionada.
- Criar estado para lista vazia.
- Criar estado para filtro sem resultado.
- Criar estado para erro de carregamento, se aplicável.

### Critério de aceite

- Cada estado vazio explica a causa provável.
- Cada estado sugere próximo passo quando fizer sentido.
- O operador não confunde vazio com erro.
- Nenhum dado ou filtro é alterado.

### Riscos

- Textos longos demais.
- Estados vazios decorativos sem orientação.
- Falta de diferenciação entre filtro vazio e base vazia.

### Rollback

Restaurar estados vazios anteriores sem impacto em dados, filtros ou navegação.

## Sprint 6.1.9 — UX-009

### Economia de Cliques

### Objetivo

Reduzir ações repetitivas e deslocamentos desnecessários na operação diária da tela de Conversas.

### Escopo

- Identificar ações frequentes com excesso de cliques.
- Priorizar atalhos visuais ou reorganização de ações.
- Reduzir ida e volta entre conversa, contato e lista.
- Preservar segurança em ações sensíveis.

### Critério de aceite

- Pelo menos um fluxo frequente exige menos passos.
- A redução de cliques não remove confirmação necessária.
- A ação principal permanece mais evidente que ações secundárias.
- Nenhum comportamento funcional é modificado de forma ampla.

### Riscos

- Tornar ações sensíveis fáceis demais.
- Esconder ações importantes em menus.
- Otimizar fluxo raro em vez de fluxo frequente.

### Rollback

Restaurar organização anterior das ações, preservando componentes e comportamentos existentes.

## Sprint 6.1.10 — UX-010

### Consistência Visual

### Objetivo

Consolidar padrões visuais da tela de Conversas para alinhar a experiência com as demais áreas do CRM.

### Escopo

- Revisar badges, cores, espaçamentos, estados e hierarquia.
- Alinhar nomenclatura visual com Dashboard, Contatos e Kanban.
- Reduzir inconsistências introduzidas por melhorias anteriores.
- Garantir acabamento final da Sprint 6.1.

### Critério de aceite

- Status iguais usam linguagem visual equivalente.
- A tela apresenta hierarquia coerente.
- Refinamentos anteriores parecem parte de um mesmo sistema.
- Não há regressão visual crítica.

### Riscos

- Tentar resolver problemas fora da tela de Conversas.
- Misturar polish visual com mudança funcional.
- Introduzir ajustes amplos demais no encerramento.

### Rollback

Reverter apenas os ajustes de consistência aplicados nesta sprint, sem desfazer entregas anteriores já validadas.

# Regras obrigatórias da Sprint

- Nenhum patch altera mais de um problema UX.
- Nenhum patch mistura frontend com backend.
- Todo patch deve possuir auditoria READ ONLY.
- Todo patch deve possuir validação.
- Todo patch deve possuir commit isolado.
- Todo patch deverá ser reversível.
- Todo patch deverá preservar comportamento existente.
- Nenhum patch deve alterar banco de dados.
- Nenhum patch deve alterar schema.
- Nenhum patch deve introduzir mudança funcional sem autorização explícita.
- Nenhum patch deve alterar múltiplas telas sem aprovação específica.
- Toda melhoria deve estar vinculada a um ID UX.
- Todo commit deve mencionar claramente o escopo da melhoria.

# Fluxo Oficial

```text
Auditoria
↓
Planejamento
↓
Implementação
↓
Validação
↓
Auditoria READ ONLY
↓
Commit
↓
Push
↓
Deploy
↓
Auditoria pós-deploy
↓
Produção
```

# Dashboard da Sprint

| Métrica | Quantidade |
| --- | ---: |
| Total de melhorias | 10 |
| Planejadas | 10 |
| Em implementação | 0 |
| Em auditoria | 0 |
| Validadas | 0 |
| Em produção | 0 |

# Indicadores de Produto

| Indicador | Objetivo de observação | Status |
| --- | --- | --- |
| Tempo médio para localizar informações | Medir rapidez para entender uma conversa | A medir |
| Quantidade média de cliques | Avaliar atrito dos fluxos principais | A medir |
| Quantidade de scroll | Avaliar densidade e organização da tela | A medir |
| Tempo para iniciar resposta | Medir velocidade entre abrir conversa e começar atendimento | A medir |
| Consistência visual | Avaliar alinhamento entre status, badges e ações | A medir |
| Carga cognitiva | Avaliar esforço mental para entender prioridade e contexto | A medir |
| Feedback visual | Avaliar clareza de sucesso, erro, envio e atualização | A medir |
| Organização da informação | Avaliar hierarquia entre lista, cabeçalho, timeline e painel | A medir |
| Confiança operacional | Avaliar se o operador entende consequência das ações | A medir |
| Velocidade de triagem | Avaliar rapidez para identificar conversas prioritárias | A medir |

# Definition of Done

A Sprint 6.1 somente poderá ser considerada concluída quando:

- todos os UX-001 até UX-010 estiverem implementados;
- todos os UX-001 até UX-010 estiverem auditados;
- todos os UX-001 até UX-010 estiverem validados;
- todos os UX-001 até UX-010 estiverem em produção;
- nenhum comportamento funcional tiver sido alterado indevidamente;
- nenhuma regressão crítica existir;
- consistência visual estiver aprovada;
- a tela de Conversas estiver coerente com os princípios de UX definidos na auditoria;
- o roadmap tiver sido atualizado com status final;
- riscos residuais estiverem documentados.

# Próximas Sprints

## Sprint 6.2 — Dashboard

Evoluir o dashboard para uma visão de decisão diária, com métricas acionáveis, prioridades operacionais e navegação para listas filtradas.

## Sprint 6.3 — Contato

Refinar a página de contato para melhorar histórico, identidade, qualidade cadastral, vínculos e próximos passos.

## Sprint 6.4 — Kanban

Melhorar gestão visual do funil, cards, etapas, responsáveis, alertas de parada e consistência com conversas.

## Sprint 6.5 — Templates

Evoluir organização, prévia, variáveis, status e segurança de uso dos templates.

## Sprint 6.6 — Importações

Refinar prévia, validação, conflitos, erros, contadores e resultado final de importações.

## Sprint 6.7 — Configurações

Organizar configurações por impacto operacional, com clareza de estado, conexão, permissões e consequências.

# Encerramento

Este roadmap estabelece a ordem oficial de execução da Sprint 6.1. Ele deve ser usado como referência para planejar auditorias, implementações, validações e revisões futuras da tela de Conversas. Qualquer alteração de prioridade, escopo ou ordem deve ser registrada antes da implementação correspondente.
