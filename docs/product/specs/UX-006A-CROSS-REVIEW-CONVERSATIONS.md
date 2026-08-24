# UX-006A — Cross Review Conversations

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: revisão cruzada oficial de produto
Status: concluída para planejamento

## 1. Objetivo da revisão

Este documento realiza a revisão cruzada oficial das especificações UX-001 até UX-006, validando se elas descrevem uma única experiência consistente para a tela Conversations.

A revisão tem como objetivo garantir que Semáforo da Janela de Atendimento, Conversation Header, Conversation List, Conversation Timeline, Message Composer e Right Sidebar funcionem como partes coordenadas de uma mesma experiência operacional.

Esta revisão não define implementação técnica, não altera escopo funcional e não substitui auditorias individuais antes de cada patch. Seu papel é identificar coerência, responsabilidades, lacunas, redundâncias e prontidão de produto para iniciar desenvolvimento incremental.

## 2. Escopo

Esta revisão cobre as seguintes especificações:

- UX-001 — Semáforo da Janela de Atendimento;
- UX-002 — Conversation Header;
- UX-003 — Conversation List;
- UX-004 — Conversation Timeline;
- UX-005 — Message Composer;
- UX-006 — Right Sidebar.

### Fora de escopo

Não fazem parte desta revisão:

- análise de código;
- validação técnica de componentes;
- mudanças em backend;
- mudanças em banco de dados;
- mudanças em APIs;
- definição de layout final em alta fidelidade;
- criação de tarefas de implementação;
- priorização fora da Sprint 6.1.

## 3. Matriz de responsabilidades entre componentes

| Componente | Responsabilidade principal | Responsabilidade secundária | Não deve assumir |
| --- | --- | --- | --- |
| UX-001 — Semáforo 24h | Comunicar estado da janela de atendimento | Apoiar priorização visual | Definir status da conversa ou bloquear ações por regra própria |
| UX-002 — Header | Resumir contexto operacional da conversa | Exibir contato, canal, status, responsável e alertas | Substituir Sidebar ou Timeline |
| UX-003 — List | Permitir triagem vertical rápida | Exibir sinais mínimos de contexto, prioridade e unread | Mostrar detalhes completos da conversa |
| UX-004 — Timeline | Narrar histórico da comunicação e eventos | Diferenciar mensagens, notas, IA e eventos operacionais | Virar painel de gestão ou lista de ações |
| UX-005 — Composer | Permitir resposta segura e contextual | Exibir restrições, feedback e atalhos | Redefinir regras de envio ou substituir Timeline |
| UX-006 — Sidebar | Representar contexto ampliado da conversa | Dar acesso a quick actions e vínculos operacionais | Competir visualmente com Timeline e Composer |

### Conclusão da matriz

As responsabilidades estão bem separadas. O conjunto descreve uma experiência coesa: a lista orienta escolha, o header resume contexto, a timeline explica histórico, o composer viabiliza ação e a sidebar oferece suporte contextual.

## 4. Fluxo operacional completo do atendente

### 4.1 Entrada na tela

O atendente chega à tela Conversations e usa a Conversation List para identificar prioridades.

Elementos envolvidos:

- UX-003 para escaneabilidade vertical;
- UX-001 para urgência da janela;
- indicadores de unread, canal e responsável.

### 4.2 Seleção da conversa

Após escolher uma conversa, o atendente confirma contexto no Header.

Elementos envolvidos:

- UX-002 para contato, canal, status e responsável;
- UX-001 para estado da janela;
- UX-006 para contexto complementar.

### 4.3 Leitura do histórico

O atendente lê a Timeline para entender sequência, mensagens e eventos.

Elementos envolvidos:

- UX-004 para comunicação como protagonista;
- distinção entre mensagens, notas, IA e eventos do sistema;
- agrupamento por data e por autoria.

### 4.4 Consulta de contexto

Quando necessário, o atendente consulta a Sidebar.

Elementos envolvidos:

- UX-006 para contato, propostas, tarefas, campanhas, tags e histórico operacional;
- quick actions próximas das informações;
- painéis independentes e progressivos.

### 4.5 Resposta

O atendente usa o Composer para responder com segurança.

Elementos envolvidos:

- UX-005 para campo, ações, templates, IA, anexos e feedback;
- UX-001 para consciência da janela;
- UX-002 para canal e status.

### 4.6 Pós-ação

Após envio ou ação operacional, a interface deve comunicar resultado.

Elementos envolvidos:

- UX-004 para refletir nova mensagem ou evento;
- UX-005 para feedback imediato;
- UX-003 para atualização da lista;
- UX-006 para atualização contextual quando aplicável.

## 5. Hierarquia visual da tela

### Hierarquia geral recomendada

1. Conversation List: escolha e triagem.
2. Conversation Header: contexto imediato.
3. Timeline: leitura e histórico.
4. Composer: ação principal.
5. Right Sidebar: contexto complementar.

### Regras de hierarquia

- Mensagens são protagonistas dentro da área central.
- Composer é a ação principal da conversa.
- Header deve resumir, não competir com Timeline.
- Sidebar deve apoiar, não dominar.
- List deve facilitar seleção, não explicar tudo.
- Semáforo 24h deve orientar prioridade, não substituir status.

### Conclusão da hierarquia

A hierarquia está consistente. O risco principal é excesso de indicadores simultâneos entre List, Header e Sidebar. Esse risco deve ser controlado por prioridade visual e uso moderado de badges.

## 6. Consistência de nomenclatura

### Termos consistentes

Os documentos usam de forma consistente:

- conversa;
- contato;
- canal;
- responsável;
- status;
- janela de atendimento;
- mensagens não lidas;
- timeline;
- composer;
- sidebar;
- quick actions;
- eventos do sistema;
- notas internas;
- templates;
- IA.

### Termos que exigem padronização futura

Alguns termos devem ser congelados antes de implementação visual:

- “Janela aberta” versus “Resposta disponível”;
- “Crítica” versus “Priorizar resposta”;
- “Conversa resolvida” versus “Conversa encerrada”;
- “Sem responsável” versus “Não atribuído”;
- “Canal sem regra” versus “Sem regra de 24h”;
- “Em bot” versus “Automação ativa”.

### Decisão recomendada

A nomenclatura base está madura, mas cada implementação deve validar microcopy final para evitar variações entre componentes.

## 7. Consistência de badges, cores e ícones

### Badges

Badges aparecem nos documentos como recurso para:

- janela de 24h;
- canal;
- status;
- responsável;
- tags;
- propostas;
- tarefas;
- IA;
- campanhas;
- falhas.

Regra de consistência:

- badges críticos devem ter prioridade visual maior;
- badges informativos devem ser discretos;
- badges não devem substituir texto essencial;
- o mesmo conceito deve usar o mesmo estilo em List, Header e Sidebar.

### Cores

Uso esperado:

- positivo ou estável para janela aberta;
- aviso para atenção;
- alerta forte para crítica;
- neutro para sem informação;
- discreto para eventos do sistema;
- destaque controlado para falhas.

Regra de consistência:

- cor nunca deve ser o único indicador;
- estados iguais devem ter cores equivalentes;
- cores de status não devem competir com cores de canal.

### Ícones

Uso esperado:

- apoiar reconhecimento rápido;
- nunca substituir informação principal quando houver risco de ambiguidade;
- manter padrão visual entre módulos.

### Conclusão visual

As specs são coerentes quanto ao uso de badges, cores e ícones. A implementação deve evitar proliferação de badges na List e na Sidebar.

## 8. Consistência dos estados compartilhados

### Estados compartilhados identificados

| Estado | UX-001 | UX-002 | UX-003 | UX-004 | UX-005 | UX-006 |
| --- | --- | --- | --- | --- | --- | --- |
| Janela aberta | Principal | Contexto | Indicador | Não central | Contexto de envio | Não central |
| Janela crítica | Principal | Alerta | Priorização | Não central | Restrição/contexto | Não central |
| Conversa ativa | Não central | Principal | Item normal | Histórico ativo | Composer pronto | Contexto |
| Conversa pendente | Não central | Principal | Priorização | Contexto | Pode orientar resposta | Contexto |
| Conversa resolvida | Não central | Principal | Item menos urgente | Evento possível | Composer restrito | Contexto |
| Sem responsável | Não central | Alerta | Priorização | Evento possível | Não central | Contexto/ação |
| IA ativa | Não central | Condicional | Badge | Evento/mensagem | Sugestão | Contexto |
| Falha | Não central | Alerta | Badge | Estado de mensagem | Estado de erro | Alerta contextual |

### Conclusão de estados

Os estados são compatíveis. A única atenção é diferenciar claramente:

- status da conversa;
- estado da janela;
- status de envio da mensagem;
- status de automação;
- status comercial.

Esses estados não devem ser visualmente fundidos.

## 9. Avaliação de redundâncias

### Redundâncias aceitáveis

Algumas informações aparecem em mais de um componente por necessidade operacional:

- canal na List, Header e Composer;
- janela 24h na List, Header e Composer;
- responsável na List, Header e Sidebar;
- status na List e Header;
- propostas na Sidebar e eventos da Timeline;
- tarefas na Sidebar e eventos da Timeline.

Essas redundâncias são aceitáveis porque cada componente usa a informação com finalidade diferente.

### Redundâncias que exigem cuidado

- Exibir muitas tags na List e repetir todas na Sidebar.
- Exibir detalhes completos de proposta na Timeline e Sidebar.
- Repetir alertas de janela em excesso.
- Mostrar quick actions duplicadas no Header e Sidebar sem hierarquia.
- Exibir eventos operacionais demais na Timeline quando a Sidebar já resume contexto.

### Decisão

Não há redundância bloqueadora. A recomendação é controlar peso visual e evitar que a mesma informação tenha o mesmo destaque em múltiplas áreas.

## 10. Avaliação de lacunas

### Lacunas não bloqueadoras

1. Microcopy final ainda precisa ser congelada por implementação.
2. A ordem exata dos blocos da Sidebar precisa ser validada em uso.
3. O nível de detalhe de propostas e tarefas na Timeline precisa de calibração visual.
4. A relação entre atalhos do Composer e ações rápidas da Sidebar precisará de cuidado.
5. O comportamento visual em telas estreitas ainda precisa de especificação futura.

### Lacunas potenciais

1. Definição final do que aparece na List quando há muitos indicadores simultâneos.
2. Critério de prioridade entre janela crítica, unread, sem responsável e falha.
3. Estratégia visual para múltiplos alertas no Header.
4. Limite de cards na Sidebar antes de exigir agrupamento.

### Decisão

As lacunas identificadas não impedem o início da implementação incremental. Elas devem ser resolvidas dentro das auditorias READ ONLY de cada UX antes do respectivo patch.

## 11. Critérios de escaneabilidade

Critérios comuns para toda a tela:

- informação principal nunca deve depender de hover;
- List deve favorecer escaneabilidade vertical;
- Header deve favorecer leitura horizontal ou por blocos;
- Timeline deve favorecer leitura contínua;
- Composer deve favorecer ação imediata;
- Sidebar deve favorecer consulta progressiva;
- estados críticos devem ser localizáveis sem esforço;
- excesso de badges deve ser evitado;
- movimento visual deve ser mínimo;
- atualizações em tempo real não devem quebrar foco.

### Avaliação

As specs estão alinhadas aos critérios de escaneabilidade. O ponto mais sensível será a List, por concentrar muitos sinais operacionais em pouco espaço.

## 12. Critérios de produtividade

Critérios comuns:

- reduzir cliques para ações frequentes;
- reduzir troca de telas;
- reduzir leitura repetitiva;
- acelerar seleção da próxima conversa;
- acelerar início de resposta;
- facilitar retomada de histórico;
- manter quick actions próximas do contexto;
- evitar confirmação desnecessária em ações simples;
- manter confirmação em ações sensíveis;
- preservar atalhos para operadores experientes sem prejudicar iniciantes.

### Avaliação

As specs estão coerentes com produtividade operacional. O maior ganho esperado vem da combinação entre List mais escaneável, Header mais contextual e Sidebar mais útil.

## 13. Critérios de consistência

Critérios comuns:

- status iguais devem ter nomes iguais;
- badges iguais devem ter aparência equivalente;
- ações semelhantes devem ter posição e linguagem semelhantes;
- erros devem usar tom consistente;
- estados vazios devem seguir padrão comum;
- IA deve ser sempre identificada;
- notas internas devem ser sempre privadas visualmente;
- eventos do sistema devem ser discretos;
- canal deve ser reconhecível em todos os pontos em que aparecer;
- janela 24h deve seguir UX-001.

### Avaliação

As specs descrevem uma experiência consistente. A implementação deve garantir que cada patch preserve os padrões já definidos nas specs anteriores.

## 14. Checklist final

- [x] UX-001 possui responsabilidade clara.
- [x] UX-002 possui responsabilidade clara.
- [x] UX-003 possui responsabilidade clara.
- [x] UX-004 possui responsabilidade clara.
- [x] UX-005 possui responsabilidade clara.
- [x] UX-006 possui responsabilidade clara.
- [x] A tela possui fluxo operacional coerente.
- [x] A hierarquia visual está definida.
- [x] Nomenclatura geral está consistente.
- [x] Badges, cores e ícones possuem diretrizes compatíveis.
- [x] Estados compartilhados foram mapeados.
- [x] Redundâncias foram identificadas e classificadas.
- [x] Lacunas foram identificadas e não são bloqueadoras.
- [x] Critérios de escaneabilidade estão alinhados.
- [x] Critérios de produtividade estão alinhados.
- [x] Critérios de consistência estão alinhados.
- [x] A experiência está pronta para implementação incremental.

## 15. Decisão GO / NO GO para implementação

### Decisão

GO para implementação incremental.

### Justificativa

As especificações UX-001 até UX-006 descrevem uma experiência coerente, com responsabilidades bem separadas entre componentes e princípios consistentes de escaneabilidade, produtividade e hierarquia visual.

Não foram identificadas lacunas bloqueadoras antes do início da implementação. Os riscos encontrados são controláveis por meio do fluxo oficial da Sprint 6.1:

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
```

### Condições obrigatórias para manter o GO

- Cada UX deve ser implementado em patch isolado.
- Cada UX deve ter auditoria READ ONLY antes da implementação.
- Nenhum patch deve misturar componentes.
- Nenhum patch deve alterar comportamento funcional sem autorização explícita.
- A nomenclatura final deve ser validada por UX antes do patch.
- A consistência visual deve ser revisada após cada entrega.

## Conclusão técnica

A arquitetura da experiência da tela Conversations está pronta para implementação incremental.

UX-001 até UX-006 formam uma base consistente: a Conversation List orienta triagem, o Conversation Header resume contexto, a Conversation Timeline preserva leitura histórica, o Message Composer viabiliza ação segura, a Right Sidebar oferece contexto progressivo e o Semáforo da Janela de Atendimento atravessa a experiência como indicador operacional controlado.

Não existem ajustes obrigatórios bloqueadores antes do início do desenvolvimento. As lacunas restantes devem ser tratadas dentro das auditorias específicas de cada melhoria, mantendo o processo incremental, reversível e auditável.
