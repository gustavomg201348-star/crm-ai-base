# UX-006 — Right Sidebar

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral

O UX-006 propõe a evolução da Right Sidebar da tela de Conversas para torná-la uma camada contextual clara, progressiva e útil durante o atendimento.

A Sidebar representa o contexto da conversa. Ela deve ajudar o operador a entender quem é o contato, quais vínculos existem, quais ações são relevantes e quais informações operacionais podem apoiar a resposta, sem competir visualmente com Timeline e Composer.

Esta melhoria tem foco em organização da informação, redução de troca de telas, quick actions contextualizadas e leitura progressiva. Ela não define implementação técnica, não altera regras de negócio e não presume mudanças em backend, banco, APIs ou componentes existentes.

## 2. Problema atual

Durante o atendimento, o operador frequentemente precisa consultar informações além da mensagem atual.

Quando o contexto não está bem organizado, surgem problemas como:

- troca excessiva de telas;
- dificuldade para entender histórico do contato;
- perda de ritmo na resposta;
- informações importantes escondidas ou dispersas;
- competição visual com a timeline;
- excesso de detalhes sem hierarquia;
- dificuldade para encontrar propostas, tarefas, tags ou campanhas relacionadas;
- ações rápidas longe do contexto em que são necessárias.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo de consulta de contexto;
- diminuir troca de telas;
- aumentar qualidade das respostas;
- melhorar continuidade entre atendimento e comercial;
- facilitar ações rápidas relacionadas ao contato;
- aumentar visibilidade de propostas, tarefas e campanhas;
- reduzir carga cognitiva do operador;
- melhorar percepção de organização do CRM.

## 4. Hipótese da melhoria

Se a Right Sidebar apresentar contexto relevante em blocos progressivos, com cards claros e quick actions próximas das informações, então operadores conseguirão tomar decisões melhores sem sair da conversa.

Espera-se que a melhoria reduza o tempo necessário para entender o cliente e executar ações complementares durante o atendimento.

## 5. Escopo

O escopo do UX-006 inclui:

- definir estrutura ideal da Sidebar;
- organizar blocos principais;
- orientar exibição de informações do contato;
- orientar representação de propostas;
- orientar representação de tarefas;
- orientar representação de campanhas;
- orientar uso de tags;
- orientar histórico operacional;
- definir quick actions;
- orientar uso de cards;
- definir painéis recolhíveis;
- orientar atualização em tempo real;
- preservar comportamento funcional existente.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar dados do contato;
- alterar criação ou edição de propostas;
- alterar tarefas;
- alterar campanhas;
- alterar tags;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar permissões;
- alterar regras de atualização em tempo real;
- criar automações;
- alterar Timeline;
- alterar Composer;
- alterar fluxo de envio;
- definir layout final em alta fidelidade.

## 7. Estrutura da Sidebar

A Sidebar deve organizar contexto em blocos independentes.

Pode conter:

- resumo do contato;
- dados de identificação;
- tags;
- propostas relacionadas;
- tarefas;
- campanhas;
- histórico operacional;
- quick actions;
- cards de alerta;
- painéis recolhíveis;
- estados vazios;
- estados de carregamento;
- estados de erro.

Princípio central: informação progressiva. A Sidebar deve mostrar primeiro o que ajuda o operador agora, e permitir aprofundamento quando necessário.

## 8. Blocos principais

Blocos recomendados:

1. Resumo do contato.
2. Quick actions principais.
3. Tags e classificação.
4. Propostas.
5. Tarefas.
6. Campanhas.
7. Histórico operacional.
8. Dados adicionais.

Cada bloco deve ser independente. A falha ou ausência de um bloco não deve comprometer a leitura dos demais.

## 9. Informações do contato

O bloco de contato deve oferecer contexto básico.

Pode incluir:

- nome;
- telefone;
- CPF ou identificador mascarado, quando aplicável;
- origem;
- etapa;
- responsável;
- temperatura;
- data de criação;
- última interação;
- estado arquivado ou ativo.

Regras:

- informações sensíveis devem ser tratadas com cuidado visual;
- dados principais devem aparecer antes de dados complementares;
- valores ausentes devem ter fallback claro;
- quick actions devem ficar próximas das informações relevantes;
- o bloco não deve substituir a página completa do contato.

## 10. Propostas

O bloco de propostas deve contextualizar oportunidades comerciais.

Pode incluir:

- proposta ativa;
- status da proposta;
- valor ou resumo, quando aplicável;
- data de criação;
- etapa;
- última atualização;
- ação para abrir detalhes.

Regras:

- cards acima de tabelas;
- proposta mais relevante deve vir primeiro;
- status deve ser visualmente claro;
- excesso de propostas deve ser resumido;
- detalhes extensos devem ficar fora da Sidebar.

## 11. Tarefas

O bloco de tarefas deve apoiar continuidade operacional.

Pode incluir:

- tarefas abertas;
- tarefas vencidas;
- próximas tarefas;
- responsável;
- prazo;
- status;
- ação rápida para criar ou concluir.

Regras:

- tarefas vencidas devem ter destaque;
- tarefas futuras devem ser discretas;
- ações devem estar próximas da tarefa;
- lista deve ser compacta;
- ausência de tarefa deve ser comunicada sem parecer erro.

## 12. Campanhas

O bloco de campanhas deve mostrar vínculos recentes ou relevantes.

Pode incluir:

- campanha de origem;
- campanha recente;
- status do recipient;
- data de envio;
- resposta do contato;
- ação para abrir contexto.

Regras:

- campanha deve explicar origem da conversa quando aplicável;
- status deve ser claro;
- campanhas antigas devem ter menor peso;
- a Sidebar não deve se tornar uma tela de campanhas.

## 13. Tags

Tags ajudam classificação e leitura rápida.

Regras:

- tags relevantes devem aparecer perto do resumo do contato;
- excesso de tags deve ser agrupado;
- tags críticas podem ter destaque moderado;
- tags decorativas devem ter baixo peso visual;
- ação de adicionar ou editar tags deve ser próxima do bloco;
- tags não devem competir com status ou alertas.

## 14. Histórico operacional

O histórico operacional deve complementar a timeline, não duplicá-la.

Pode incluir:

- últimas ações relevantes;
- mudança de etapa;
- proposta criada;
- campanha recebida;
- tarefa concluída;
- responsável alterado;
- contato atualizado.

Regras:

- deve ser resumido;
- deve priorizar eventos relevantes;
- não deve competir com a Timeline;
- eventos de baixa importância podem ser omitidos ou agrupados;
- detalhes podem ser acessados sob demanda.

## 15. Quick Actions

Quick Actions devem ficar próximas das informações que motivam a ação.

Possíveis ações:

- abrir contato completo;
- criar tarefa;
- criar proposta;
- adicionar tag;
- alterar responsável;
- copiar telefone;
- iniciar ação comercial;
- registrar nota;
- abrir campanha relacionada.

Regras:

- ações frequentes devem ser acessíveis;
- ações sensíveis devem manter confirmação quando necessário;
- ações indisponíveis devem explicar motivo;
- quick actions não devem competir com o Composer;
- ações devem estar agrupadas por contexto.

## 16. Cards

Cards devem ser o formato preferencial para informações resumidas.

Princípios:

- cards acima de tabelas;
- cada card deve ter objetivo claro;
- card deve possuir título, estado e ação quando aplicável;
- card não deve conter excesso de linhas;
- cards críticos devem ter destaque proporcional;
- cards vazios devem comunicar ausência de dados.

Cards favorecem leitura rápida e reduzem sensação de planilha dentro da conversa.

## 17. Painéis recolhíveis

Painéis recolhíveis ajudam a manter informação progressiva.

Regras:

- blocos secundários podem ser recolhíveis;
- estado aberto ou fechado deve ser previsível;
- blocos críticos não devem começar escondidos sem motivo;
- recolher painel não deve apagar contexto;
- títulos dos painéis devem indicar conteúdo e contagem quando útil;
- cada painel deve funcionar de forma independente.

## 18. Atualização em tempo real

A Sidebar deve refletir mudanças relevantes sem causar instabilidade.

Regras:

- atualização em tempo real deve ser discreta;
- dados alterados podem ter destaque temporário;
- atualizações não devem mover conteúdo agressivamente;
- quick actions devem continuar acessíveis;
- falha de atualização deve ser comunicada quando relevante;
- Timeline e Composer não devem ser prejudicados por atualização da Sidebar.

## 19. Critérios de UX

A melhoria será considerada adequada em UX quando:

- a Sidebar representar claramente o contexto da conversa;
- não competir visualmente com Timeline e Composer;
- usar informação progressiva;
- priorizar cards acima de tabelas;
- organizar painéis independentes;
- manter quick actions próximas das informações;
- reduzir troca de telas;
- comunicar estados vazios com clareza;
- preservar leitura rápida;
- apoiar decisão sem sobrecarregar o operador.

## 20. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regras de negócio.

Critérios técnicos de produto:

- utilizar apenas informações já disponíveis quando a implementação for planejada;
- não alterar contratos de API;
- não alterar persistência;
- não alterar regras de contato;
- não alterar regras de propostas;
- não alterar tarefas;
- não alterar campanhas;
- não alterar permissões;
- não alterar realtime funcional;
- preservar comportamento atual;
- permitir rollback visual isolado.

## 21. Critérios de performance

A Sidebar deve ser leve e estável.

Critérios:

- carregamento de blocos deve ser progressivo quando apropriado;
- falha de um bloco não deve comprometer todos;
- scroll deve permanecer fluido;
- atualizações não devem causar saltos excessivos;
- cards devem manter altura previsível;
- painéis recolhíveis devem responder rapidamente;
- dados secundários não devem atrasar o contexto principal;
- estados de loading devem ser proporcionais.

## 22. Critérios de acessibilidade

A Sidebar deve ser compreensível e navegável.

Critérios:

- títulos de blocos devem ser claros;
- informações críticas não devem depender apenas de cor;
- ações devem ter rótulos compreensíveis;
- painéis recolhíveis devem indicar estado;
- contraste deve ser adequado;
- foco deve ser previsível;
- textos devem ser legíveis em área estreita;
- dados sensíveis devem ser exibidos com cautela.

## 23. Critérios de aceite

A entrega futura do UX-006 deverá atender aos seguintes critérios:

- a Sidebar organiza contexto em blocos claros;
- informações do contato aparecem de forma objetiva;
- propostas, tarefas e campanhas são representadas sem poluir;
- tags são úteis e compactas;
- quick actions ficam próximas das informações relacionadas;
- cards são priorizados em vez de tabelas densas;
- painéis recolhíveis funcionam como informação progressiva;
- atualizações em tempo real não quebram leitura;
- Timeline e Composer continuam protagonistas da operação;
- comportamento funcional existente é preservado;
- a melhoria pode ser revertida isoladamente.

## 24. Casos extremos

Casos que devem ser considerados em futuras implementações:

- contato sem dados completos;
- contato arquivado;
- contato com muitas tags;
- contato com muitas propostas;
- contato sem proposta;
- tarefas vencidas múltiplas;
- ausência de tarefas;
- campanhas antigas;
- campanha sem status claro;
- falha ao carregar bloco específico;
- atualização em tempo real durante leitura;
- usuário sem permissão para ação rápida;
- Sidebar em tela estreita;
- painéis recolhidos com alerta interno;
- histórico operacional muito longo;
- dados sensíveis ausentes ou mascarados.

## 25. Estratégia de rollback

O rollback deve ser visual e isolado.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- nova organização em blocos;
- novos cards;
- novos painéis recolhíveis;
- novas quick actions contextuais;
- refinamentos visuais de tags, propostas, tarefas ou campanhas;
- microinterações de atualização.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de contato;
- alteração de propostas;
- alteração de tarefas;
- alteração de campanhas;
- alteração de permissões;
- correção de dados.

## 26. Dependências

Dependências de produto:

- alinhamento com UX-002 para cabeçalho;
- alinhamento com UX-004 para evitar duplicidade com Timeline;
- definição de blocos prioritários;
- definição de quick actions relevantes;
- consistência com padrões de cards do CRM;
- revisão de microcopy;
- alinhamento com o roadmap UX-6.1.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- confirmação das informações já disponíveis na interface;
- validação visual em contatos com muitos vínculos;
- validação de estados vazios;
- commit isolado;
- rollback granular.

## 27. Riscos

### Risco alto

- Sidebar competir visualmente com Timeline e Composer.
- Exibir informação sensível de forma inadequada.
- Criar ação rápida ambígua ou perigosa.

### Risco médio

- Sobrecarregar a Sidebar com muitos blocos.
- Painéis recolhíveis esconderem informação crítica.
- Atualização em tempo real causar movimento excessivo.
- Cards virarem tabelas compactadas demais.

### Risco baixo

- Microcopy pouco clara.
- Espaçamento inconsistente.
- Necessidade de ajustar ordem dos blocos.
- Ícones ou badges ambíguos.

## 28. Impacto esperado na operação

Impactos esperados:

- menor troca de telas;
- atendimento mais contextual;
- resposta mais precisa;
- melhor uso de propostas, tarefas e campanhas;
- maior velocidade para ações complementares;
- redução de carga cognitiva;
- melhor continuidade entre operadores;
- percepção de produto mais organizado e profissional.

O ganho mais relevante esperado é transformar a Sidebar em apoio contextual real. O operador deve conseguir entender o cliente e executar ações relacionadas sem abandonar a conversa, mantendo Timeline e Composer como áreas principais da operação.

## Encerramento

O UX-006 define o padrão de produto para a Right Sidebar da tela de Conversas. A melhoria deve ser tratada como refinamento de contexto, organização progressiva e produtividade operacional, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
