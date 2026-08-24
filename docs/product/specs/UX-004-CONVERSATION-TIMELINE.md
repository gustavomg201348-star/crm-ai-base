# UX-004 — Conversation Timeline

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral

O UX-004 propõe a evolução da timeline da conversa para melhorar leitura contínua, compreensão do histórico e diferenciação entre comunicação com o cliente e eventos operacionais.

A Conversation Timeline deve funcionar como o registro narrativo do atendimento. Ela deve destacar mensagens como protagonistas, tratar eventos do sistema de forma discreta e permitir que o operador entenda a sequência da conversa sem esforço excessivo.

Esta melhoria tem foco em legibilidade, escaneabilidade, agrupamento inteligente e consistência visual. Ela não define implementação técnica, não altera regras de negócio e não presume mudanças em backend, banco, APIs ou componentes existentes.

## 2. Problema atual

Em conversas longas, a timeline pode se tornar difícil de ler quando mensagens, eventos, notas, automações, templates e atividades operacionais competem visualmente.

Quando todos os elementos têm peso parecido, surgem problemas como:

- dificuldade para encontrar a última mensagem relevante;
- confusão entre mensagem enviada ao cliente e evento interno;
- leitura lenta de históricos longos;
- excesso de repetição visual;
- perda de contexto entre dias ou etapas;
- risco de interpretar eventos do sistema como comunicação real;
- dificuldade para entender atuação da IA;
- menor confiança ao continuar um atendimento iniciado por outra pessoa.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo de leitura do histórico;
- melhorar continuidade entre operadores;
- diminuir erros de interpretação;
- tornar mensagens mais fáceis de localizar;
- separar comunicação real de eventos operacionais;
- aumentar confiança em conversas com automação ou IA;
- melhorar percepção de organização do CRM;
- acelerar retomada de atendimentos antigos.

## 4. Hipótese da melhoria

Se a timeline diferenciar claramente mensagens, eventos operacionais, notas internas, IA, propostas, tarefas e templates, então operadores conseguirão compreender o histórico com mais rapidez e menos risco de erro.

Espera-se que a melhoria reduza o tempo necessário para retomar uma conversa e decidir a próxima resposta.

## 5. Escopo

O escopo do UX-004 inclui:

- definir estrutura ideal da timeline;
- diferenciar tipos de eventos;
- estabelecer hierarquia visual dos eventos;
- orientar agrupamento inteligente de mensagens;
- orientar agrupamento por data;
- separar comunicação e eventos operacionais;
- definir estados visuais das mensagens;
- orientar representação de eventos do sistema, notas, propostas, IA, tarefas e templates;
- preservar comportamento funcional existente;
- criar padrão reutilizável para futuras melhorias de histórico.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar envio ou recebimento de mensagens;
- alterar persistência de mensagens;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar integração com WhatsApp ou Meta;
- alterar status de entrega;
- alterar regras da IA;
- alterar templates;
- alterar propostas;
- alterar tarefas;
- alterar lifecycle de conversa;
- criar automações;
- remover eventos existentes;
- definir layout final em alta fidelidade.

## 7. Estrutura da Timeline

A timeline deve organizar o histórico da conversa em uma sequência legível e contínua.

Ela pode conter:

- mensagens recebidas;
- mensagens enviadas;
- mensagens automáticas;
- mensagens geradas ou sugeridas por IA;
- eventos do sistema;
- notas internas;
- eventos de proposta;
- eventos de tarefa;
- uso de templates;
- eventos de arquivamento;
- eventos de reativação;
- separadores de data;
- estados de envio e entrega;
- marcadores de falha.

Princípio central: mensagens são protagonistas. Eventos operacionais devem apoiar o entendimento, não competir com a comunicação.

## 8. Tipos de eventos

Tipos esperados na timeline:

- mensagem inbound;
- mensagem outbound;
- mensagem de template;
- mensagem com mídia;
- mensagem automática;
- sugestão ou intervenção de IA;
- nota interna;
- evento de status da conversa;
- alteração de responsável;
- criação ou atualização de proposta;
- criação ou conclusão de tarefa;
- entrada ou saída de bot;
- arquivamento;
- reativação;
- falha de envio;
- evento de sistema;
- separador temporal.

Cada tipo deve ter linguagem visual própria e peso proporcional à sua importância operacional.

## 9. Hierarquia visual dos eventos

A hierarquia recomendada é:

1. Mensagens do cliente.
2. Mensagens enviadas ao cliente.
3. Falhas de envio ou estados críticos.
4. Notas internas relevantes.
5. Intervenções ou resumos de IA.
6. Eventos comerciais importantes, como proposta.
7. Tarefas.
8. Alterações de status e responsável.
9. Eventos de sistema de baixa criticidade.
10. Separadores temporais.

Comunicação e operação possuem linguagens visuais diferentes. Mensagens devem ter maior presença visual que eventos do sistema.

## 10. Agrupamento inteligente de mensagens

Agrupamento inteligente reduz repetição e melhora leitura.

Regras de produto:

- mensagens consecutivas do mesmo autor podem ser agrupadas visualmente;
- metadados repetidos podem ser reduzidos;
- agrupamento não deve esconder status importante;
- falhas devem quebrar agrupamento quando necessário;
- mudança de autor deve ser evidente;
- mudança relevante de horário pode quebrar grupo;
- mensagens de tipos diferentes não devem ser agrupadas de forma ambígua;
- notas internas não devem ser agrupadas como mensagens ao cliente.

O objetivo é reduzir ruído, não esconder informação.

## 11. Agrupamento por data

A timeline deve permitir orientação temporal clara.

Regras:

- dias diferentes devem ter separador visual;
- separadores devem ser discretos;
- datas recentes podem usar linguagem contextual;
- datas antigas devem ser claras;
- mudança de dia deve ajudar leitura, não interromper excessivamente;
- eventos muito próximos devem preservar sequência compreensível.

Agrupamento por data deve apoiar retomada de histórico e auditoria visual.

## 12. Separação entre comunicação e eventos operacionais

A timeline deve separar claramente:

- mensagens reais trocadas com o cliente;
- notas internas;
- eventos do sistema;
- eventos comerciais;
- eventos de automação.

Princípios:

- comunicação com o cliente deve ser dominante;
- eventos do sistema devem ser discretos;
- notas internas devem ser claramente privadas;
- eventos comerciais devem contextualizar sem parecer mensagem;
- IA deve ser identificada como IA;
- operação não deve poluir a leitura da conversa.

## 13. Estados das mensagens

Estados possíveis:

- enviando;
- enviada;
- entregue;
- lida;
- recebida;
- falhou;
- pendente;
- cancelada ou indisponível, se aplicável;
- sem status conhecido.

Regras:

- estado crítico deve ser evidente;
- estado normal deve ser discreto;
- falha deve indicar possibilidade de ação ou revisão;
- estados não devem competir com o conteúdo da mensagem;
- ausência de status não deve parecer erro fatal.

## 14. Eventos do sistema

Eventos do sistema devem ser discretos e informativos.

Exemplos:

- conversa criada;
- status alterado;
- responsável alterado;
- conversa arquivada;
- conversa reativada;
- automação iniciada;
- automação encerrada;
- integração registrou evento.

Regras:

- eventos do sistema não devem parecer mensagem enviada ao cliente;
- eventos repetitivos devem ter baixo peso visual;
- eventos críticos podem ter maior destaque;
- texto deve ser curto e objetivo;
- detalhes avançados podem ficar em contexto secundário.

## 15. Notas internas

Notas internas devem ser claramente diferenciadas de mensagens ao cliente.

Regras:

- nota interna deve ter linguagem visual própria;
- deve indicar privacidade ou uso interno;
- não deve ser confundida com mensagem enviada;
- deve preservar autoria e horário;
- deve ser legível sem ocupar peso excessivo;
- notas relevantes podem ter destaque moderado.

## 16. Propostas

Eventos de proposta devem contextualizar o atendimento comercial.

Podem indicar:

- proposta criada;
- proposta atualizada;
- proposta aprovada;
- proposta recusada;
- mudança de etapa;
- vínculo com contato ou conversa.

Regras:

- proposta não deve parecer mensagem;
- status comercial deve ser legível;
- eventos de proposta devem ter peso maior que eventos triviais;
- detalhes extensos devem permanecer fora da timeline principal.

## 17. IA

Eventos e mensagens relacionados à IA devem ser identificáveis.

Podem incluir:

- resposta automática;
- sugestão de resposta;
- resumo gerado;
- intervenção do copiloto;
- handoff para humano;
- mensagem enviada por automação.

Regras:

- IA deve ser claramente identificada;
- sugestão não deve parecer ação executada;
- mensagem enviada por IA deve se diferenciar de mensagem manual;
- eventos de IA devem preservar confiança e rastreabilidade;
- a timeline deve evitar ambiguidade sobre autoria.

## 18. Tarefas

Eventos de tarefa devem apoiar continuidade operacional.

Podem indicar:

- tarefa criada;
- tarefa concluída;
- tarefa vencida;
- tarefa reagendada;
- tarefa atribuída.

Regras:

- tarefa vencida pode ter destaque maior;
- tarefa concluída deve ser discreta;
- tarefa não deve competir com mensagem;
- informações extensas devem ficar em contexto secundário;
- vínculo com conversa deve ser compreensível.

## 19. Templates

Templates devem ser reconhecidos quando usados na conversa.

Regras:

- template enviado deve parecer comunicação ao cliente;
- nome ou tipo do template pode aparecer como metadado;
- variáveis não devem poluir a leitura final;
- falha de template deve ser destacada;
- template não deve ser confundido com mensagem livre quando isso for operacionalmente relevante.

## 20. Arquivamento e reativação

Eventos de arquivamento e reativação ajudam a explicar mudanças de estado.

Regras:

- arquivamento deve ser discreto, mas rastreável;
- reativação deve indicar retomada operacional;
- esses eventos não devem parecer mensagens;
- quando uma conversa reativada receber nova mensagem, a comunicação deve voltar a ser protagonista;
- histórico anterior deve permanecer legível.

## 21. Critérios de legibilidade

A timeline deve favorecer leitura prolongada.

Critérios:

- contraste adequado;
- largura de linha confortável;
- espaçamento entre grupos;
- diferenciação clara entre autores;
- metadados discretos;
- conteúdo da mensagem como elemento principal;
- datas reconhecíveis;
- falhas legíveis;
- notas internas identificáveis;
- ausência de ruído visual excessivo.

## 22. Critérios de escaneabilidade

A timeline deve permitir varredura rápida.

Critérios:

- mensagens devem se destacar de eventos;
- separadores de data devem orientar;
- eventos críticos devem ser fáceis de localizar;
- mensagens recentes devem ser rapidamente identificáveis;
- autoria deve ser reconhecível;
- agrupamentos devem reduzir repetição;
- estados de falha devem ser visíveis;
- IA e notas internas devem ter marcadores claros.

## 23. Critérios de UX

A melhoria será considerada adequada em UX quando:

- mensagens forem protagonistas;
- eventos do sistema forem discretos;
- comunicação e operação tiverem linguagens visuais diferentes;
- agrupamento inteligente reduzir repetição;
- a timeline priorizar leitura contínua e não aparência de chat tradicional;
- o operador entender autoria, sequência e estado das mensagens;
- notas internas não forem confundidas com mensagens ao cliente;
- IA for identificável;
- falhas forem compreensíveis;
- conversas longas forem menos cansativas de ler.

## 24. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regras de negócio.

Critérios técnicos de produto:

- utilizar apenas informações já disponíveis quando a implementação for planejada;
- não alterar persistência;
- não alterar contratos de API;
- não alterar envio ou recebimento;
- não alterar estados reais de mensagem;
- não alterar regras de IA;
- não alterar templates;
- não alterar propostas ou tarefas;
- não remover eventos existentes;
- preservar ordem cronológica;
- permitir rollback visual isolado.

## 25. Critérios de performance

A timeline deve preservar fluidez e estabilidade.

Critérios:

- carregamento deve evitar saltos visuais;
- mensagens novas devem aparecer de forma previsível;
- conversas longas devem permanecer navegáveis;
- agrupamentos não devem causar instabilidade;
- mídia ou anexos não devem bloquear leitura do restante;
- estados de envio não devem provocar reflow excessivo;
- atualizações devem preservar posição do operador quando apropriado;
- eventos discretos não devem aumentar peso visual desnecessário.

## 26. Critérios de aceite

A entrega futura do UX-004 deverá atender aos seguintes critérios:

- mensagens inbound e outbound são claramente diferenciadas;
- eventos do sistema não parecem mensagens;
- notas internas são claramente privadas;
- IA é identificável;
- templates são reconhecíveis quando relevante;
- falhas de envio são visíveis;
- agrupamento por data é claro;
- agrupamento inteligente reduz repetição;
- mensagens permanecem protagonistas;
- a timeline favorece leitura contínua;
- comportamento funcional existente é preservado;
- a melhoria pode ser revertida isoladamente.

## 27. Casos extremos

Casos que devem ser considerados em futuras implementações:

- conversa sem mensagens;
- conversa com apenas eventos de sistema;
- conversa muito longa;
- muitas mensagens consecutivas do mesmo autor;
- mensagens com mídia;
- mensagens com template;
- mensagens com falha;
- evento de proposta entre mensagens;
- tarefa vencida no meio da timeline;
- nota interna próxima de mensagem outbound;
- IA respondendo antes do operador;
- conversa arquivada e reativada;
- mensagens antigas migradas;
- ausência de status de entrega;
- mudança de dia com poucos eventos;
- dados parcialmente carregados;
- atualização em tempo real enquanto o operador lê histórico antigo.

## 28. Estratégia de rollback

O rollback deve ser visual e isolado.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- nova diferenciação visual de eventos;
- agrupamento inteligente;
- novos separadores de data;
- novos estilos de notas internas;
- novos marcadores de IA;
- refinamentos de estados de mensagem;
- ajustes visuais de eventos de proposta, tarefa ou sistema.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de mensagens;
- alteração de eventos persistidos;
- alteração de templates;
- alteração de propostas;
- correção de dados.

## 29. Dependências

Dependências de produto:

- alinhamento com UX-002 para cabeçalho;
- alinhamento com UX-003 para lista;
- definição de linguagem visual para tipos de evento;
- revisão de microcopy;
- consistência com padrões de status do CRM;
- validação de legibilidade em conversas longas;
- alinhamento com o roadmap UX-6.1.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- confirmação dos tipos de evento disponíveis na interface;
- validação visual com múltiplos cenários;
- validação de conversas longas;
- commit isolado;
- rollback granular.

## 30. Riscos

### Risco alto

- Confundir evento operacional com mensagem enviada ao cliente.
- Esconder falha de envio por excesso de discrição.
- Alterar percepção cronológica da conversa.

### Risco médio

- Agrupamento excessivo escondendo metadados úteis.
- Eventos do sistema discretos demais para auditoria operacional.
- IA visualmente ambígua.
- Timeline menos compacta em conversas longas.

### Risco baixo

- Microcopy pouco clara.
- Separadores de data excessivos.
- Ajustes finos de espaçamento.
- Necessidade de calibrar peso visual dos eventos.

## 31. Impacto esperado na operação

Impactos esperados:

- leitura mais rápida do histórico;
- retomada mais segura de atendimentos antigos;
- menor risco de confundir evento com mensagem;
- melhor identificação de IA, notas internas e falhas;
- redução de repetição visual;
- melhor compreensão de conversas longas;
- maior confiança em operações com múltiplos agentes;
- percepção de produto mais organizado e profissional.

O ganho mais relevante esperado é a melhoria da leitura contínua. A timeline deve se comportar como uma narrativa operacional clara, onde mensagens são protagonistas e eventos ajudam a entender contexto sem competir com a conversa.

## Encerramento

O UX-004 define o padrão de produto para a timeline da tela de Conversas. A melhoria deve ser tratada como refinamento de leitura, agrupamento, hierarquia e comunicação visual, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
