# UX-002 — Conversation Header

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral da melhoria

O UX-002 propõe a evolução do cabeçalho da conversa para transformá-lo em um resumo operacional claro, compacto e confiável.

O cabeçalho deve ajudar o operador a entender rapidamente quem é o contato, qual canal está sendo usado, qual é o estado da conversa, quem é o responsável e quais ações principais estão disponíveis.

Esta melhoria tem foco em leitura, hierarquia visual, redução de carga cognitiva e segurança operacional. Ela não define implementação técnica, não altera backend, não altera regras de negócio e não presume mudanças em APIs, banco ou componentes existentes.

## 2. Problema atual

Na operação diária, o operador precisa tomar decisões rápidas enquanto lê e responde conversas.

Quando o cabeçalho não resume bem o contexto, surgem problemas como:

- dificuldade para identificar o contato atual;
- necessidade de procurar dados em outras áreas da tela;
- incerteza sobre canal, responsável ou status;
- maior risco de responder sem contexto suficiente;
- excesso de leitura antes de agir;
- confusão entre dados do contato, dados da conversa e ações disponíveis;
- perda de produtividade em atendimentos de alto volume.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo para entender uma conversa aberta;
- aumentar segurança antes de responder;
- reduzir troca de telas;
- melhorar continuidade do atendimento;
- tornar ownership e status mais evidentes;
- melhorar consistência visual da tela de Conversas;
- reduzir erros operacionais em ambientes com múltiplos canais;
- aumentar percepção de qualidade e maturidade do CRM.

## 4. Hipótese da melhoria

Se o cabeçalho da conversa apresentar as informações operacionais essenciais com hierarquia clara, então o operador conseguirá entender contexto e tomar decisões com mais rapidez e menos esforço.

Espera-se que a melhoria reduza o tempo entre abrir uma conversa e iniciar uma resposta segura.

## 5. Escopo

O escopo do UX-002 inclui:

- definir a estrutura ideal do cabeçalho da conversa;
- organizar hierarquia de informações;
- definir componentes permanentes e condicionais;
- especificar ações rápidas esperadas;
- definir estados visuais do cabeçalho;
- orientar microinterações;
- preservar comportamento funcional existente;
- criar padrão reutilizável para futuras melhorias da tela de Conversas.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar dados do contato;
- alterar status da conversa;
- alterar responsável automaticamente;
- alterar canal de envio;
- alterar regras de atendimento;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar lifecycle de conversas;
- alterar permissões;
- alterar envio de mensagens;
- alterar templates;
- alterar campanhas;
- criar automações;
- criar novos componentes técnicos obrigatórios;
- definir layout final em alta fidelidade.

## 7. Regras funcionais

As regras abaixo descrevem o comportamento esperado em nível de produto:

1. O cabeçalho deve resumir contexto, não substituir a timeline ou o painel lateral.
2. O cabeçalho deve exibir informações essenciais de forma previsível.
3. O contato atual deve ser o elemento mais reconhecível.
4. Canal, status e responsável devem estar disponíveis sem busca manual.
5. Ações rápidas devem ser claras, mas não competir com a identificação da conversa.
6. Componentes condicionais devem aparecer apenas quando agregarem contexto.
7. O cabeçalho não deve alterar regras funcionais por si só.
8. A melhoria deve preservar ações existentes.
9. A interface deve evitar duplicidade visual desnecessária.
10. O cabeçalho deve permanecer útil em conversas com poucos dados.

## 8. Estrutura completa do cabeçalho

O cabeçalho ideal deve ser composto por blocos lógicos:

### 8.1 Identidade do contato

Elemento principal do cabeçalho.

Pode incluir:

- nome do contato;
- avatar, iniciais ou indicador visual;
- telefone ou identificador mascarável;
- indicação de contato arquivado, quando aplicável;
- link ou ação para abrir detalhes do contato, se existir.

### 8.2 Contexto da conversa

Informações que explicam o estado operacional do atendimento.

Pode incluir:

- status da conversa;
- canal;
- responsável;
- fila ou origem;
- semáforo da janela de atendimento, quando disponível;
- indicador de mensagens não lidas, quando útil.

### 8.3 Ações principais

Ações frequentes ou relevantes para o operador.

Pode incluir:

- assumir conversa;
- transferir responsável;
- alterar status;
- abrir contato;
- criar tarefa ou próximo passo;
- acessar mais ações em menu secundário.

### 8.4 Alertas contextuais

Informações condicionais que exigem atenção.

Pode incluir:

- janela crítica;
- conversa encerrada;
- canal indisponível;
- contato sem telefone válido;
- responsável ausente;
- restrição de resposta.

## 9. Hierarquia das informações

A hierarquia recomendada é:

1. Nome do contato.
2. Estado operacional da conversa.
3. Canal de atendimento.
4. Responsável.
5. Alertas contextuais.
6. Ações rápidas.
7. Informações secundárias.

O cabeçalho deve favorecer leitura da esquerda para a direita ou de cima para baixo, conforme o layout final, mantendo o contato e o estado da conversa como informações dominantes.

Informações críticas devem ser visíveis sem abrir menus. Informações secundárias podem ser agrupadas ou reduzidas para evitar poluição visual.

## 10. Componentes permanentes

Componentes que devem estar sempre disponíveis quando houver conversa selecionada:

- identificação do contato;
- status da conversa;
- canal ou origem principal;
- área de ações;
- indicação de responsável ou ausência de responsável;
- acesso ao detalhe do contato ou painel contextual;
- estado básico da conversa.

Esses componentes formam o núcleo operacional do cabeçalho e devem manter posição consistente.

## 11. Componentes condicionais

Componentes que devem aparecer apenas quando houver contexto:

- alerta de janela de atendimento;
- aviso de conversa encerrada;
- indicador de canal indisponível;
- aviso de contato arquivado;
- alerta de dados incompletos;
- badge de IA ou automação ativa;
- indicador de campanha relacionada;
- aviso de responsável ausente;
- informação de atendimento em bot;
- restrição de envio ou resposta.

Componentes condicionais devem evitar ruído. Se muitos alertas estiverem ativos, a interface deve priorizar os mais importantes.

## 12. Ações rápidas

As ações rápidas devem apoiar tarefas frequentes sem sobrecarregar o cabeçalho.

Possíveis ações:

- assumir atendimento;
- trocar responsável;
- alterar status;
- abrir contato;
- adicionar nota;
- criar tarefa;
- acessar templates;
- encerrar conversa;
- reabrir conversa;
- abrir menu de ações adicionais.

Regras de produto:

- ações destrutivas ou sensíveis não devem competir com ações comuns;
- ações indisponíveis devem explicar o motivo quando possível;
- ações frequentes devem ter acesso direto;
- ações raras podem ficar em menu secundário;
- feedback visual deve aparecer após ação.

## 13. Estados possíveis

### 13.1 Conversa ativa

Estado padrão de atendimento em andamento.

O cabeçalho deve transmitir disponibilidade operacional e destacar ações principais.

### 13.2 Conversa pendente

Estado em que a conversa exige decisão, resposta ou ação do operador.

O cabeçalho deve sinalizar necessidade de atenção sem criar alarme excessivo.

### 13.3 Conversa em bot

Estado em que a automação pode estar conduzindo parte do atendimento.

O cabeçalho deve indicar a presença de automação para evitar conflito entre operador e bot.

### 13.4 Conversa resolvida

Estado em que o atendimento foi encerrado.

O cabeçalho deve indicar encerramento e evitar que o operador confunda a conversa com uma fila ativa.

### 13.5 Conversa sem responsável

Estado em que não há ownership claro.

O cabeçalho deve destacar a ausência de responsável e facilitar ação de assumir ou atribuir.

### 13.6 Canal indisponível ou indefinido

Estado em que o canal não está claro, indisponível ou não aplicável.

O cabeçalho deve comunicar a limitação com neutralidade e evitar falsa segurança.

### 13.7 Dados insuficientes

Estado em que alguma informação essencial não está disponível.

O cabeçalho deve continuar funcional, usando fallback visual e textual.

## 14. Microinterações

Microinterações esperadas:

- destaque suave ao alterar responsável;
- feedback breve ao copiar telefone ou identificador;
- indicação visual após mudar status;
- tooltip ou texto auxiliar para alertas condicionais;
- hover ou foco acessível em ações rápidas;
- estado de carregamento em ações assíncronas;
- confirmação visual para ações sensíveis;
- diferenciação de ação indisponível;
- preservação visual do contexto durante atualização;
- feedback quando o cabeçalho receber dados novos.

As microinterações devem ser discretas, rápidas e funcionais. Elas devem reforçar confiança, não distrair.

## 15. Especificação visual

Esta seção define intenção visual, não implementação.

### Layout

O cabeçalho deve ser compacto, legível e estável.

Deve evitar:

- altura excessiva;
- excesso de badges;
- ações espalhadas;
- duplicidade de informações;
- mudanças bruscas de layout.

### Tipografia

- Nome do contato com maior peso visual.
- Informações secundárias com menor peso.
- Alertas com destaque proporcional à gravidade.
- Ações com rótulos ou ícones compreensíveis.

### Cores

- Cores devem seguir significado operacional.
- Status e alertas devem usar paleta consistente.
- Cor não deve ser o único indicador.
- Estados neutros devem permanecer discretos.

### Ícones

Ícones podem apoiar reconhecimento rápido, mas não devem substituir texto quando houver risco de ambiguidade.

### Espaçamento

O cabeçalho deve separar visualmente:

- identidade;
- contexto;
- alertas;
- ações.

A separação deve ser clara sem parecer fragmentada.

## 16. Critérios de UX

A melhoria será considerada adequada em UX quando:

- o operador identifica rapidamente o contato atual;
- canal e status ficam evidentes;
- responsável ou ausência de responsável é claro;
- alertas importantes não passam despercebidos;
- ações rápidas são compreensíveis;
- ações sensíveis não ficam perigosamente próximas de ações comuns;
- o cabeçalho não sobrecarrega a tela;
- o operador não precisa sair da conversa para obter contexto básico;
- estados condicionais são úteis e não ruidosos;
- a experiência permanece consistente com o restante do CRM.

## 17. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regras de negócio.

Critérios técnicos de produto:

- utilizar apenas informações já disponíveis quando a implementação for planejada;
- não alterar contratos de API;
- não alterar persistência;
- não alterar regras de status;
- não alterar regras de responsável;
- não alterar canal de envio;
- não introduzir automação nova;
- não criar dependência com mudança de banco;
- preservar comportamento atual de ações existentes;
- permitir rollback visual isolado.

## 18. Critérios de aceite

A entrega futura do UX-002 deverá atender aos seguintes critérios:

- o cabeçalho apresenta contato, canal, status e responsável de forma clara;
- ações principais ficam acessíveis sem competir com a identificação;
- componentes condicionais aparecem apenas quando úteis;
- estados de conversa são visualmente compreensíveis;
- alertas não se confundem com status comuns;
- a hierarquia visual favorece leitura rápida;
- o cabeçalho permanece estável e compacto;
- nenhuma regra funcional é alterada;
- nenhum fluxo existente é removido;
- a melhoria pode ser revertida isoladamente;
- a documentação permanece alinhada ao comportamento entregue.

## 19. Casos extremos

Casos que devem ser considerados em futuras implementações:

- conversa sem contato associado;
- contato sem nome;
- contato com telefone ausente;
- conversa sem responsável;
- conversa com canal desconhecido;
- conversa resolvida com nova mensagem;
- conversa em bot com operador visualizando;
- múltiplos alertas condicionais ao mesmo tempo;
- usuário sem permissão para alterar responsável;
- usuário sem permissão para encerrar conversa;
- dados carregando parcialmente;
- falha ao carregar painel de contexto;
- tela estreita ou responsiva;
- nome do contato muito longo;
- múltiplos canais na mesma empresa;
- conversa histórica ou importada.

## 20. Estratégia de rollback

O rollback deve ser visual e isolado.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- nova organização visual do cabeçalho;
- novos agrupamentos de informação;
- novos badges condicionais;
- microinterações adicionadas;
- ajustes visuais das ações rápidas.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de regras de conversa;
- alteração de permissões;
- alteração de status;
- correção de dados.

## 21. Dependências

Dependências de produto:

- alinhamento com o roadmap UX-6.1;
- definição dos elementos prioritários do cabeçalho;
- consistência com UX-001 quando o semáforo estiver presente;
- revisão de microcopy;
- validação de hierarquia visual;
- alinhamento com padrões de status do CRM.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- confirmação do local exato do cabeçalho;
- confirmação das informações já disponíveis na interface;
- validação visual;
- commit isolado;
- rollback granular.

## 22. Riscos

### Risco alto

- Destacar informação incorreta e induzir ação operacional errada.
- Confundir status da conversa com status de canal ou janela.
- Ocultar ação crítica em nome de simplificação visual.

### Risco médio

- Sobrecarregar o cabeçalho com muitos badges.
- Aumentar altura do cabeçalho e reduzir área útil da timeline.
- Criar inconsistência com outras páginas do CRM.
- Exibir alertas condicionais demais ao mesmo tempo.

### Risco baixo

- Microcopy pouco clara.
- Ícone ambíguo.
- Espaçamento visual levemente desalinhado.
- Necessidade de ajuste fino após uso real.

## 23. Impacto esperado na operação

Impactos esperados:

- leitura mais rápida do contexto da conversa;
- menor tempo entre abrir conversa e iniciar resposta;
- menos troca de telas;
- maior segurança sobre canal, status e responsável;
- melhor continuidade entre operadores;
- redução de dúvidas operacionais;
- maior consistência visual da tela de Conversas;
- percepção de produto mais maduro e organizado.

O ganho mais relevante esperado é a redução da carga cognitiva no início do atendimento. O operador deve entender o contexto principal da conversa sem investigar manualmente múltiplas áreas da interface.

## Encerramento

O UX-002 define o padrão de produto para o cabeçalho operacional da tela de Conversas. A melhoria deve ser tratada como refinamento de experiência, hierarquia e comunicação visual, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
