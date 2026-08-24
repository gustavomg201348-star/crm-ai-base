# UX-003 — Conversation List

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral

O UX-003 propõe a evolução da lista de conversas para torná-la mais escaneável, informativa e útil na triagem operacional.

A Conversation List deve ajudar o operador a identificar rapidamente quais conversas precisam de atenção, quem enviou a última mensagem, qual canal está envolvido, quem é o responsável, se há mensagens não lidas e se existe algum sinal de urgência.

Esta melhoria tem foco em escaneabilidade vertical, densidade de informação, hierarquia visual, movimento mínimo e acesso direto às informações principais sem depender de hover. Ela não define implementação técnica, não altera regras de negócio e não presume mudanças em backend, banco, APIs ou componentes existentes.

## 2. Problema atual

Em uma operação com muitas conversas, a lista é o principal ponto de triagem.

Quando a lista não comunica prioridade e contexto de forma clara, surgem problemas como:

- dificuldade para identificar conversas urgentes;
- tempo excessivo procurando mensagens não lidas;
- confusão entre conversas ativas, pendentes, resolvidas ou em bot;
- leitura repetida de itens para entender contexto;
- risco de ignorar conversas sem responsável;
- dificuldade em diferenciar canais;
- excesso de dependência de abertura da conversa para obter informações básicas;
- perda de ritmo em operações de alto volume.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo de triagem;
- aumentar velocidade de atendimento;
- priorizar conversas com maior risco ou urgência;
- reduzir conversas esquecidas;
- melhorar distribuição de responsabilidade;
- tornar a operação multi-canal mais clara;
- reduzir carga cognitiva da equipe;
- aumentar percepção de organização e maturidade do CRM.

## 4. Hipótese da melhoria

Se a lista de conversas apresentar informações principais com hierarquia visual clara, densidade equilibrada e indicadores consistentes, então operadores conseguirão localizar e priorizar atendimentos com mais rapidez e menor esforço.

Espera-se que a melhoria reduza o tempo entre entrar na tela de Conversas e selecionar a próxima conversa relevante.

## 5. Escopo

O escopo do UX-003 inclui:

- definir estrutura ideal de cada item da lista;
- organizar hierarquia visual das informações;
- definir critérios de priorização visual;
- orientar uso de badges e indicadores;
- especificar estados possíveis de cada item;
- definir presença de canal, responsável, tags, propostas e tarefas;
- orientar exibição da mensagem mais recente;
- orientar exibição de horários;
- definir comportamento esperado para mensagens não lidas;
- orientar comportamento em atualizações em tempo real;
- preservar comportamento funcional existente.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar regras de ordenação de conversas;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar realtime ou mecanismo de atualização;
- alterar criação, reuso ou status de conversas;
- alterar lifecycle de atendimento;
- alterar permissões;
- alterar envio de mensagens;
- alterar filtros de forma funcional;
- criar automações;
- criar novas regras de priorização no servidor;
- alterar campanhas;
- alterar propostas;
- definir layout final em alta fidelidade.

## 7. Estrutura completa da lista

A lista deve ser composta por itens repetíveis, cada um representando uma conversa.

Cada item pode conter:

- nome do contato;
- avatar, iniciais ou marcador visual;
- última mensagem;
- horário da última interação;
- indicador de mensagens não lidas;
- canal;
- responsável;
- status da conversa;
- estado da janela de 24h;
- tags relevantes;
- vínculo com proposta;
- vínculo com tarefa;
- indicador de automação ou IA;
- alerta de atraso ou prioridade;
- estado selecionado.

A estrutura deve equilibrar informação suficiente para triagem com densidade adequada para alto volume.

## 8. Hierarquia visual das informações

A hierarquia recomendada é:

1. Estado de atenção do item.
2. Nome do contato.
3. Mensagem mais recente.
4. Horário.
5. Mensagens não lidas.
6. Canal.
7. Responsável.
8. Status.
9. Janela de 24h.
10. Tags, propostas e tarefas.

O operador deve conseguir identificar, sem abrir a conversa:

- quem é o contato;
- se há nova mensagem;
- se a última interação parece exigir resposta;
- se há risco temporal;
- por qual canal a conversa ocorre;
- quem é responsável.

## 9. Critérios de priorização visual

A lista deve destacar visualmente itens com maior relevância operacional.

Critérios de priorização:

- conversa não lida;
- última mensagem recebida do cliente;
- conversa sem responsável;
- janela de 24h em atenção ou crítica;
- conversa pendente;
- conversa parada há muito tempo;
- conversa em bot que exige intervenção;
- falha ou estado de envio relevante;
- tarefa vencida associada;
- proposta em etapa sensível associada.

O destaque deve ser proporcional. Nem todo indicador deve competir com a mesma intensidade visual.

## 10. Densidade de informação

A lista deve manter densidade suficiente para alto volume sem se tornar ilegível.

Princípios:

- cada item deve exibir apenas informações úteis para triagem;
- informações secundárias devem ser compactas;
- badges devem ser usados com moderação;
- linhas não devem ficar excessivamente altas;
- o operador deve ver várias conversas ao mesmo tempo;
- detalhes avançados devem ficar no painel ou conversa aberta;
- a densidade deve favorecer leitura repetida durante o dia.

## 11. Escaneabilidade

A lista deve seguir o princípio de escaneabilidade vertical.

Regras de produto:

- os elementos principais devem ocupar posições previsíveis;
- nomes devem alinhar visualmente entre itens;
- horários devem ocupar posição consistente;
- unread deve ser reconhecível em varredura rápida;
- canal e status devem usar padrões visuais estáveis;
- itens selecionados devem se diferenciar claramente;
- informações principais nunca devem depender de hover;
- movimento visual deve ser mínimo durante atualizações.

## 12. Estados de cada item

### 12.1 Normal

Conversa sem alerta especial e sem mensagem não lida.

### 12.2 Não lida

Conversa com mensagens ainda não vistas ou pendentes de atenção.

Deve possuir destaque claro, mas não excessivo.

### 12.3 Selecionada

Conversa atualmente aberta no painel principal.

Deve ser visualmente distinta sem parecer alerta.

### 12.4 Pendente

Conversa que exige ação ou decisão operacional.

Deve ter prioridade visual maior que item normal.

### 12.5 Sem responsável

Conversa sem ownership definido.

Deve indicar oportunidade de assumir ou atribuir.

### 12.6 Em bot

Conversa conduzida ou influenciada por automação.

Deve evitar conflito entre operador e automação.

### 12.7 Resolvida

Conversa encerrada ou fora da fila ativa.

Deve ter aparência menos urgente.

### 12.8 Com falha

Conversa com algum erro relevante associado à última interação.

Deve ser diferenciada de alerta comum.

### 12.9 Atualizando

Item recebendo nova mensagem ou atualização.

Deve manter estabilidade visual e evitar saltos.

## 13. Badges e indicadores

Badges e indicadores devem comunicar contexto de forma compacta.

Possíveis indicadores:

- canal;
- status;
- janela de 24h;
- responsável;
- não lida;
- tag prioritária;
- proposta;
- tarefa;
- IA;
- campanha;
- falha;
- anexos ou mídia.

Regras:

- badges devem ter significado consistente;
- badges críticos devem ser mais fortes que badges informativos;
- excesso de badges deve ser evitado;
- texto curto deve ser preferido;
- ícones não devem ser ambíguos;
- informação principal não deve depender apenas de cor.

## 14. Janela de 24h

A lista deve poder refletir o estado da janela de 24h quando essa informação estiver disponível.

Estados esperados:

- aberta;
- atenção;
- crítica;
- encerrada;
- sem janela;
- canal sem regra.

Regras:

- estado crítico deve ajudar priorização;
- estado aberto deve ser discreto;
- estado desconhecido não deve parecer erro;
- janela de 24h não deve ser confundida com status da conversa;
- o indicador deve seguir a especificação UX-001.

## 15. Canal

O canal deve ajudar o operador a entender origem e contexto da conversa.

Regras:

- canal deve ser visível sem abrir a conversa;
- múltiplos canais devem ser diferenciáveis;
- canal não deve competir com o nome do contato;
- canal deve usar nomenclatura consistente;
- canal desconhecido deve ter fallback neutro;
- canal não deve depender apenas de ícone.

## 16. Responsável

O responsável indica ownership operacional.

Regras:

- quando houver responsável, deve ser reconhecível;
- quando não houver responsável, a ausência deve ser clara;
- responsável não deve competir com contato;
- ausência de responsável pode ter destaque moderado;
- mudanças de responsável devem refletir visualmente no item;
- responsável deve ser consistente com o cabeçalho da conversa.

## 17. Tags

Tags devem enriquecer contexto, mas não poluir a lista.

Regras:

- mostrar apenas tags mais relevantes;
- evitar excesso de tags por item;
- usar truncamento ou agrupamento quando necessário;
- tags críticas ou operacionais podem ter prioridade;
- tags decorativas devem ter baixo peso visual;
- tags não devem substituir status.

## 18. Propostas

Vínculos com propostas devem indicar oportunidade comercial relevante.

Regras:

- proposta associada pode aparecer como indicador compacto;
- status de proposta sensível pode ter destaque moderado;
- a lista não deve virar tela de propostas;
- detalhes devem permanecer em contexto secundário;
- indicador deve ser claro para usuários comerciais.

## 19. Tarefas

Tarefas associadas podem ajudar priorização.

Regras:

- tarefa vencida deve ter destaque maior que tarefa futura;
- tarefa futura deve ser discreta;
- indicador deve evitar confusão com mensagem não lida;
- a lista deve comunicar existência de tarefa sem exibir todos os detalhes;
- tarefas não devem sobrecarregar itens com pouca atividade.

## 20. Mensagem mais recente

A mensagem mais recente é elemento essencial para triagem.

Regras:

- deve ser legível;
- deve indicar origem quando necessário;
- deve truncar sem perder sentido básico;
- deve diferenciar texto, mídia, template ou evento;
- mensagens internas não devem ser confundidas com mensagens ao cliente;
- eventos de sistema devem ter linguagem própria;
- falhas de envio devem ser reconhecíveis.

## 21. Horários

Horários ajudam a avaliar urgência e recência.

Regras:

- horário deve ter posição consistente;
- datas recentes podem usar linguagem relativa;
- datas antigas devem ser claras;
- formato deve ser consistente;
- horários não devem competir com unread;
- conversas atrasadas podem usar destaque contextual.

## 22. Indicadores de mensagens não lidas

Unread é um dos sinais mais importantes da lista.

Regras:

- deve ser visualmente forte o suficiente;
- deve diferenciar contagem e simples presença, se aplicável;
- deve indicar prioridade sem poluir;
- deve desaparecer ou mudar após leitura conforme comportamento existente;
- não deve ser confundido com badge de status;
- deve funcionar bem em itens selecionados.

## 23. Comportamento em atualizações em tempo real

Atualizações devem preservar estabilidade visual.

Regras:

- nova mensagem deve atualizar item sem salto excessivo;
- item selecionado não deve perder foco;
- movimento automático deve ser mínimo;
- se a lista reordenar, isso deve ser previsível;
- alterações de unread devem ser visíveis;
- atualizações não devem apagar contexto de leitura;
- feedback de item recém-atualizado pode ser temporário e discreto.

## 24. Critérios de UX

A melhoria será considerada adequada em UX quando:

- a lista for escaneável verticalmente;
- a informação principal não depender de hover;
- o operador identificar prioridade rapidamente;
- densidade e legibilidade estiverem equilibradas;
- badges forem úteis e consistentes;
- canal, responsável e unread forem reconhecíveis;
- mensagem mais recente for legível;
- itens selecionados forem claros;
- atualizações em tempo real não causarem confusão;
- a lista não exigir abertura de conversa para contexto básico.

## 25. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regras de negócio.

Critérios técnicos de produto:

- utilizar apenas informações já disponíveis quando a implementação for planejada;
- não alterar contratos de API;
- não alterar ordenação funcional sem aprovação específica;
- não alterar filtros;
- não alterar realtime;
- não alterar persistência;
- não alterar status da conversa;
- não alterar unread funcional;
- preservar comportamento atual de seleção;
- permitir rollback visual isolado.

## 26. Critérios de performance

A lista deve preservar sensação de velocidade.

Critérios:

- itens não devem piscar durante atualização;
- carregamento deve ter estado visual adequado;
- scroll deve permanecer fluido;
- indicadores não devem causar layout instável;
- imagens ou avatares não devem atrasar leitura do item;
- atualizações frequentes devem evitar movimento excessivo;
- o item deve manter altura previsível;
- estados visuais devem ser leves e consistentes.

## 27. Critérios de aceite

A entrega futura do UX-003 deverá atender aos seguintes critérios:

- cada item da lista apresenta hierarquia clara;
- conversas não lidas são facilmente identificáveis;
- canal fica visível sem abrir a conversa;
- responsável ou ausência de responsável é compreensível;
- mensagem mais recente é legível;
- horário tem posição consistente;
- badges não poluem a lista;
- janela de 24h segue padrão do UX-001 quando exibida;
- item selecionado é visualmente distinto;
- atualizações em tempo real não quebram leitura;
- informação principal não depende de hover;
- comportamento funcional existente é preservado;
- a melhoria pode ser revertida isoladamente.

## 28. Casos extremos

Casos que devem ser considerados em futuras implementações:

- contato sem nome;
- contato com nome muito longo;
- conversa sem última mensagem;
- última mensagem com mídia;
- última mensagem com template;
- última mensagem com erro;
- conversa sem canal identificado;
- conversa sem responsável;
- item com muitas tags;
- item com proposta e tarefa ao mesmo tempo;
- conversa com unread alto;
- conversa selecionada recebendo nova mensagem;
- lista atualizando enquanto o operador lê;
- conversa resolvida com nova interação;
- conversa histórica;
- canal sem regra de janela;
- dados parciais durante carregamento;
- tela estreita;
- alto volume de conversas críticas.

## 29. Estratégia de rollback

O rollback deve ser visual e isolado.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- nova hierarquia visual dos itens;
- novos badges ou indicadores;
- novos destaques de prioridade;
- ajustes de densidade;
- microinterações de atualização;
- refinamentos de unread, canal ou responsável.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de filtros;
- alteração de ordenação funcional;
- alteração de realtime;
- correção de dados.

## 30. Dependências

Dependências de produto:

- alinhamento com UX-001 para janela de 24h;
- alinhamento com UX-002 para cabeçalho;
- definição de prioridade visual dos estados;
- consistência de badges do CRM;
- revisão de microcopy;
- validação de densidade visual;
- alinhamento com o roadmap UX-6.1.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- confirmação das informações já disponíveis na interface;
- validação visual em alto volume;
- validação de estados de atualização;
- commit isolado;
- rollback granular.

## 31. Riscos

### Risco alto

- Destacar prioridade errada e induzir ordem de atendimento inadequada.
- Confundir unread com status ou alerta.
- Tornar a lista densa demais para uso contínuo.

### Risco médio

- Excesso de badges por item.
- Movimento visual excessivo em atualizações.
- Canal ou responsável pouco legíveis.
- Inconsistência com cabeçalho ou painel lateral.

### Risco baixo

- Microcopy pouco clara.
- Ícones ambíguos.
- Ajustes finos de espaçamento.
- Necessidade de calibrar truncamento de mensagem.

## 32. Impacto esperado na operação

Impactos esperados:

- triagem mais rápida;
- menor tempo para escolher próxima conversa;
- melhor identificação de conversas não lidas;
- melhor leitura de canal e responsável;
- menor risco de esquecer conversas sem ownership;
- redução de abertura desnecessária de conversas;
- maior fluidez em operações de alto volume;
- percepção de produto mais organizado e profissional.

O ganho mais relevante esperado é a redução do esforço de varredura vertical. O operador deve conseguir percorrer a lista rapidamente e identificar prioridade, contexto e ação provável sem depender de hover ou abertura de cada conversa.

## Encerramento

O UX-003 define o padrão de produto para a lista de conversas. A melhoria deve ser tratada como refinamento de escaneabilidade, densidade, hierarquia e comunicação visual, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
