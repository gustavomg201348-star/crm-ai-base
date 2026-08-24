# UX-005 — Message Composer

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral

O UX-005 propõe a evolução do Message Composer da tela de Conversas para torná-lo mais claro, seguro, rápido e consciente do contexto da conversa.

O Composer é o ponto de ação principal do operador. Ele deve indicar quando uma mensagem pode ser enviada, por qual canal será enviada, quais alternativas estão disponíveis e por que uma ação pode estar bloqueada ou indisponível.

Esta melhoria tem foco em produtividade, confiança operacional, feedback imediato e redução de cliques. Ela não define implementação técnica, não altera regras de negócio e não presume mudanças em backend, banco, APIs ou componentes existentes.

## 2. Problema atual

Em operações de atendimento, o operador precisa responder rapidamente sem perder segurança.

Quando o Composer não comunica contexto e estado com clareza, surgem problemas como:

- dúvida sobre possibilidade de envio;
- insegurança sobre o canal usado;
- tentativa de envio em conversa encerrada ou indisponível;
- cliques repetidos por falta de feedback;
- dificuldade para acessar templates ou respostas rápidas;
- excesso de esforço para anexar arquivos ou usar recursos auxiliares;
- baixa eficiência para operadores experientes;
- confusão entre mensagem livre, template, IA e anexo.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo para iniciar resposta;
- aumentar segurança antes do envio;
- reduzir cliques em ações frequentes;
- diminuir erros de envio;
- melhorar uso de templates e respostas rápidas;
- apoiar operadores iniciantes com clareza;
- acelerar operadores experientes com atalhos;
- aumentar percepção de qualidade e fluidez do CRM.

## 4. Hipótese da melhoria

Se o Composer for consciente do contexto da conversa e comunicar claramente estados, bloqueios, ações e feedback, então operadores conseguirão responder com mais rapidez, menos dúvidas e menos erros.

Espera-se que a melhoria reduza o tempo entre decidir responder e concluir o envio.

## 5. Escopo

O escopo do UX-005 inclui:

- definir estrutura ideal do Composer;
- orientar estados do Composer;
- especificar barra de ações;
- orientar campo de mensagem;
- definir placeholders inteligentes;
- orientar uso de templates;
- orientar respostas rápidas;
- definir relação com IA;
- orientar envio de arquivos;
- orientar relação com janela de 24 horas;
- definir feedback de envio;
- orientar estados de erro;
- definir atalhos de teclado;
- preservar comportamento funcional existente.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar envio de mensagens;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar integração com WhatsApp ou Meta;
- alterar regras da janela de 24 horas;
- alterar templates;
- alterar regras da IA;
- alterar permissões;
- alterar anexos ou armazenamento;
- alterar validações funcionais;
- criar automações;
- criar novos tipos de mensagem;
- alterar lifecycle da conversa;
- definir layout final em alta fidelidade.

## 7. Estrutura do Composer

O Composer deve ser estruturado como área de ação primária da conversa.

Pode conter:

- campo de mensagem;
- barra de ações;
- botão de envio;
- seletor ou atalho de template;
- acesso a respostas rápidas;
- acesso a anexos;
- entrada ou sugestão de IA;
- indicação de canal;
- indicação de janela de 24 horas;
- feedback de estado;
- mensagem de bloqueio ou restrição;
- contador ou limite quando aplicável;
- atalhos de teclado.

O Composer deve ser consciente do contexto da conversa. Seu estado visual deve refletir se o operador pode responder, se há restrições e qual ação é esperada.

## 8. Estados do Composer

### 8.1 Pronto para envio

Estado padrão quando o operador pode digitar e enviar mensagem.

Deve transmitir disponibilidade e clareza.

### 8.2 Digitando

Estado em que há conteúdo em edição.

Deve preservar foco, ações disponíveis e indicação de envio.

### 8.3 Enviando

Estado após acionamento de envio.

Deve impedir ambiguidade e reduzir clique repetido.

### 8.4 Enviado

Estado de confirmação imediata ou transição para a timeline.

Deve comunicar sucesso sem interromper fluxo.

### 8.5 Falha no envio

Estado em que a mensagem não foi enviada ou não pôde ser concluída.

Deve informar causa provável e próximo passo.

### 8.6 Bloqueado

Estado em que o envio não está disponível.

Deve explicar claramente por que o operador não pode enviar.

### 8.7 Conversa encerrada

Estado em que a conversa está resolvida, arquivada ou indisponível para resposta comum.

Deve indicar restrição sem parecer falha técnica.

### 8.8 Janela expirada

Estado em que a regra da janela de atendimento limita resposta livre.

Deve orientar alternativa quando aplicável, sem definir nova regra funcional.

### 8.9 Carregando recursos

Estado temporário enquanto templates, anexos ou contexto auxiliar estão sendo preparados.

Deve manter estabilidade visual.

## 9. Barra de ações

A barra de ações deve reunir recursos complementares ao envio.

Possíveis ações:

- selecionar template;
- abrir respostas rápidas;
- anexar arquivo;
- usar IA;
- inserir emoji, se aplicável;
- adicionar nota interna, se o fluxo permitir;
- alternar tipo de mensagem, se aplicável;
- acessar ações adicionais.

Regras:

- ações frequentes devem exigir o menor número possível de cliques;
- ações secundárias podem ficar agrupadas;
- ações indisponíveis devem explicar motivo;
- ações não devem competir com o botão de envio;
- ícones devem ser compreensíveis;
- informações principais não devem depender de hover.

## 10. Campo de mensagem

O campo de mensagem deve favorecer digitação rápida e segura.

Regras:

- deve ter foco claro;
- deve suportar mensagens curtas e longas;
- deve indicar quando está desabilitado;
- deve preservar rascunho quando apropriado;
- deve evitar perda acidental de texto;
- deve diferenciar mensagem livre de template ou sugestão;
- deve manter legibilidade em múltiplas linhas;
- deve preservar clareza do botão de envio.

## 11. Placeholders inteligentes

Placeholders devem orientar sem substituir rótulos ou regras.

Exemplos de intenção:

- “Escreva uma mensagem...”
- “Use um template para continuar...”
- “Conversa encerrada”
- “Janela expirada: use um template aprovado”
- “Selecione uma conversa para responder”

Regras:

- placeholder deve refletir estado do Composer;
- texto deve ser curto;
- não deve prometer ação indisponível;
- não deve esconder motivo de bloqueio;
- deve ajudar usuários iniciantes.

## 12. Templates

Templates devem estar disponíveis quando forem relevantes ao contexto.

Regras:

- acesso a templates deve ser rápido;
- template selecionado deve ter prévia clara;
- variáveis obrigatórias devem ser evidentes;
- placeholders não preenchidos não devem passar despercebidos;
- template não deve ser confundido com mensagem livre;
- estado de janela de 24 horas pode orientar necessidade de template;
- falhas relacionadas a template devem ter feedback claro.

## 13. Respostas rápidas

Respostas rápidas devem reduzir esforço em mensagens recorrentes.

Regras:

- devem ser acessíveis com poucos cliques;
- devem permitir busca ou organização quando houver muitas opções;
- inserção deve ser previsível;
- operador deve poder revisar antes de enviar;
- respostas rápidas não devem enviar automaticamente sem clareza;
- devem apoiar, não substituir, o julgamento do operador.

## 14. Integração com IA

O Composer pode se beneficiar de IA desde que mantenha controle humano.

Regras:

- sugestão de IA deve ser identificada como IA;
- sugestão não deve ser enviada automaticamente sem ação clara;
- operador deve poder editar antes de enviar;
- IA não deve ocultar o campo manual;
- estado de carregamento da IA deve ser visível;
- falha da IA não deve bloquear envio manual;
- o operador deve entender se está usando sugestão, template ou texto próprio.

## 15. Envio de arquivos

Envio de arquivos deve ser claro e seguro.

Regras:

- ação de anexar deve ser visível, mas secundária ao envio de texto;
- arquivo selecionado deve ter prévia ou nome identificável;
- remoção de anexo deve ser fácil;
- erro de arquivo deve informar causa provável;
- tipo ou tamanho inválido deve ser comunicado antes do envio quando possível;
- anexo não deve ser enviado sem intenção clara do operador.

## 16. Janela de 24 horas

O Composer deve refletir o estado da janela quando isso afetar a experiência de resposta.

Regras:

- operador nunca deve ter dúvidas sobre por que pode ou não enviar uma mensagem;
- janela aberta deve permitir Composer em estado normal;
- janela em atenção ou crítica pode ter indicação discreta;
- janela encerrada deve explicar restrição;
- canal sem regra não deve gerar bloqueio visual indevido;
- estado da janela deve seguir a especificação UX-001;
- o Composer não deve redefinir regras da janela.

## 17. Feedback de envio

Feedback deve ser imediato.

Regras:

- clique em enviar deve gerar resposta visual instantânea;
- envio em andamento deve ser reconhecível;
- sucesso deve ser percebido sem confirmação manual;
- falha deve ser clara;
- erro deve indicar próximo passo;
- clique duplicado deve ser desencorajado;
- mensagem enviada deve aparecer ou ser refletida na timeline conforme comportamento existente.

## 18. Estados de erro

Estados de erro devem ser úteis e acionáveis.

Possíveis erros:

- envio indisponível;
- canal indisponível;
- janela expirada;
- mensagem vazia;
- anexo inválido;
- falha temporária;
- falta de permissão;
- template inválido;
- IA indisponível.

Regras:

- erro deve explicar causa provável;
- erro não deve apagar texto digitado;
- erro recuperável deve orientar tentativa;
- erro irreversível deve indicar alternativa;
- erro técnico não deve ser genérico demais quando houver contexto operacional.

## 19. Atalhos de teclado

O Composer deve favorecer operadores experientes por meio de atalhos, sem prejudicar usuários iniciantes.

Possíveis atalhos:

- enviar mensagem;
- quebrar linha;
- abrir respostas rápidas;
- abrir templates;
- anexar arquivo;
- cancelar sugestão;
- focar campo de mensagem.

Regras:

- atalhos não devem conflitar com digitação;
- comportamento deve ser previsível;
- atalhos devem ser descobríveis;
- usuários iniciantes devem conseguir operar sem conhecê-los;
- ações sensíveis não devem depender apenas de atalho.

## 20. Critérios de UX

A melhoria será considerada adequada em UX quando:

- o Composer refletir o contexto da conversa;
- o operador souber por que pode ou não enviar;
- feedback de envio for imediato;
- ações frequentes exigirem poucos cliques;
- templates e respostas rápidas forem acessíveis;
- IA for claramente identificada;
- erros forem compreensíveis;
- o campo de mensagem permanecer protagonista;
- usuários iniciantes entenderem o fluxo;
- operadores experientes ganharem velocidade com atalhos.

## 21. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regras de negócio.

Critérios técnicos de produto:

- utilizar apenas informações já disponíveis quando a implementação for planejada;
- não alterar contratos de API;
- não alterar envio de mensagens;
- não alterar persistência;
- não alterar regras da janela de 24 horas;
- não alterar templates;
- não alterar IA;
- não alterar permissões;
- não alterar anexos;
- preservar comportamento atual;
- permitir rollback visual isolado.

## 22. Critérios de performance

O Composer deve responder rapidamente a interações.

Critérios:

- digitação deve permanecer fluida;
- ações da barra não devem travar o campo;
- feedback de envio deve ser imediato;
- carregamento de templates ou IA não deve bloquear digitação manual quando não necessário;
- anexos não devem causar instabilidade visual;
- estados de erro não devem provocar perda de texto;
- mudanças de estado devem evitar saltos de layout;
- o botão de envio deve refletir estado sem atraso perceptível.

## 23. Critérios de acessibilidade

O Composer deve ser utilizável com clareza visual e navegação previsível.

Critérios:

- estados não devem depender apenas de cor;
- campo de mensagem deve ter foco visível;
- ações devem ter rótulo compreensível;
- ícones ambíguos devem ter apoio textual;
- mensagens de erro devem ser legíveis;
- atalhos devem ser opcionais;
- contraste deve ser adequado;
- estados desabilitados devem explicar motivo quando possível.

## 24. Critérios de aceite

A entrega futura do UX-005 deverá atender aos seguintes critérios:

- o Composer indica se o operador pode enviar;
- bloqueios possuem explicação clara;
- canal ou contexto de envio é compreensível;
- feedback de envio é imediato;
- falhas são visualmente distintas de sucesso;
- ações frequentes ficam acessíveis;
- templates e respostas rápidas não confundem o operador;
- IA é identificada como IA;
- texto digitado não é perdido em erro comum;
- atalhos não prejudicam usuários iniciantes;
- comportamento funcional existente é preservado;
- a melhoria pode ser revertida isoladamente.

## 25. Casos extremos

Casos que devem ser considerados em futuras implementações:

- conversa sem canal;
- conversa encerrada;
- janela de 24 horas expirada;
- canal sem regra de janela;
- usuário sem permissão para responder;
- mensagem vazia;
- mensagem muito longa;
- anexo inválido;
- falha de envio após clique;
- IA indisponível;
- template com variável pendente;
- conversa recebendo nova mensagem enquanto operador digita;
- troca de conversa com rascunho em andamento;
- conexão instável;
- envio duplicado por clique repetido;
- operador usando atalho sem querer;
- mobile ou tela estreita.

## 26. Estratégia de rollback

O rollback deve ser visual e isolado.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- novos estados visuais do Composer;
- novos placeholders;
- refinamentos da barra de ações;
- microinterações de envio;
- novos indicadores de janela;
- ajustes visuais de templates, IA ou anexos;
- atalhos adicionados exclusivamente nesta melhoria.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de envio;
- alteração de templates;
- alteração de IA;
- alteração de anexos;
- correção de dados.

## 27. Dependências

Dependências de produto:

- alinhamento com UX-001 para janela de 24 horas;
- alinhamento com UX-002 para cabeçalho;
- alinhamento com UX-004 para feedback na timeline;
- definição de microcopy de bloqueio e erro;
- definição de ações frequentes;
- consistência com padrões visuais do CRM;
- alinhamento com o roadmap UX-6.1.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- confirmação dos estados disponíveis na interface;
- validação visual dos estados;
- validação de atalhos;
- commit isolado;
- rollback granular.

## 28. Riscos

### Risco alto

- Induzir operador a acreditar que envio está disponível quando não está.
- Ocultar motivo de bloqueio.
- Criar feedback de sucesso para envio que falhou.

### Risco médio

- Aumentar complexidade visual do Composer.
- Expor muitas ações secundárias.
- Atalhos causarem envio acidental.
- IA ou template serem confundidos com texto manual.

### Risco baixo

- Placeholder pouco claro.
- Ícone ambíguo.
- Ajuste fino de espaçamento.
- Necessidade de calibrar microcopy após uso real.

## 29. Impacto esperado na operação

Impactos esperados:

- menor tempo para iniciar resposta;
- menos cliques em ações frequentes;
- maior segurança antes do envio;
- menor risco de envio duplicado;
- melhor entendimento de bloqueios;
- uso mais eficiente de templates e respostas rápidas;
- melhor experiência para operadores iniciantes;
- maior velocidade para operadores experientes;
- percepção de produto mais fluido e confiável.

O ganho mais relevante esperado é a redução de incerteza no momento da resposta. O operador deve sempre entender o que pode fazer, por que pode fazer e qual será o resultado esperado da ação.

## Encerramento

O UX-005 define o padrão de produto para o Message Composer da tela de Conversas. A melhoria deve ser tratada como refinamento de contexto, segurança, feedback e produtividade, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
