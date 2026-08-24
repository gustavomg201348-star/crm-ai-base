# UX-001 — Semáforo da Janela de Atendimento

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Tipo: especificação oficial de produto
Status: planejado

## 1. Visão geral da melhoria

O UX-001 propõe a criação de um semáforo visual para indicar o estado da janela de atendimento de uma conversa.

A melhoria tem como foco facilitar a leitura operacional da tela de Conversas, ajudando o operador a entender rapidamente se uma conversa ainda está dentro da janela de resposta, se exige atenção, se está próxima de expirar, se já foi encerrada ou se não possui regra aplicável.

Este documento define comportamento esperado, estados, critérios de UX e critérios de aceite em nível de produto. Ele não define implementação técnica, não altera regras de negócio e não presume mudanças em backend, banco ou integrações.

## 2. Problema atual

Em operações de atendimento, o operador precisa decidir rapidamente se pode responder uma conversa, se deve priorizá-la ou se precisa usar outro fluxo de comunicação.

Quando o estado da janela de atendimento não está visualmente evidente, surgem problemas como:

- dificuldade para priorizar conversas urgentes;
- risco de deixar conversas expirarem sem resposta;
- tempo perdido verificando detalhes;
- insegurança antes de responder;
- confusão entre status da conversa e disponibilidade da janela;
- dependência de conhecimento operacional externo;
- maior carga cognitiva em filas com muitas conversas.

## 3. Objetivos de negócio

Esta melhoria busca apoiar objetivos operacionais e comerciais:

- reduzir tempo de triagem;
- aumentar velocidade de resposta;
- diminuir risco de perda de janela de atendimento;
- melhorar previsibilidade do operador;
- aumentar confiança no uso da tela de Conversas;
- reduzir necessidade de treinamento para interpretar estados;
- melhorar percepção de maturidade e qualidade do CRM;
- apoiar times com alto volume de atendimento.

## 4. Hipótese da melhoria

Se o estado da janela de atendimento for exibido por meio de um semáforo visual claro, consistente e contextual, então operadores conseguirão priorizar conversas com mais rapidez e responder com mais segurança.

Espera-se que a melhoria reduza o tempo necessário para identificar conversas críticas e diminua a chance de uma conversa ser tratada tarde demais.

## 5. Escopo

O escopo do UX-001 inclui:

- definir estados visuais da janela de atendimento;
- criar linguagem de semáforo para leitura rápida;
- diferenciar estados normais, de atenção, críticos e encerrados;
- orientar microcopy associada aos estados;
- definir critérios de uso em lista, cabeçalho ou áreas de contexto da conversa;
- preservar comportamento existente da conversa;
- padronizar significado visual para futuras implementações.

## 6. Fora de escopo

Não fazem parte desta melhoria:

- alterar regras de cálculo da janela;
- alterar backend;
- alterar banco de dados;
- alterar APIs;
- alterar integração com WhatsApp ou Meta;
- alterar envio de mensagens;
- criar bloqueios funcionais novos;
- alterar status da conversa;
- alterar lifecycle de atendimento;
- alterar templates;
- alterar permissões;
- criar automações;
- criar notificações novas;
- alterar comportamento de campanhas;
- definir layout final em alta fidelidade.

## 7. Regras funcionais

As regras abaixo descrevem o comportamento esperado em nível de produto:

1. O semáforo deve representar o estado da janela de atendimento, não o status comercial da conversa.
2. O semáforo deve ser informativo e não deve alterar o comportamento funcional da conversa.
3. O estado deve ser compreensível por texto e cor.
4. A cor não deve ser o único meio de comunicação do estado.
5. Quando houver incerteza sobre a janela, o estado deve comunicar ausência de informação com neutralidade.
6. Estados críticos devem ser visualmente distintos de estados normais.
7. A interface deve evitar alarmismo quando a janela estiver saudável.
8. O operador deve conseguir entender o estado sem consultar documentação externa.
9. O semáforo deve ser consistente onde quer que apareça.
10. A melhoria deve preservar todos os fluxos existentes de resposta, leitura e navegação.

## 8. Estados possíveis do componente

### 8.1 Aberta

Representa uma conversa dentro da janela de atendimento, sem urgência imediata.

Uso esperado:

- conversa pode ser respondida normalmente;
- não há sinal visual de risco;
- estado deve transmitir segurança operacional.

Mensagem sugerida:

- “Janela aberta”
- “Resposta disponível”

Prioridade visual: baixa.

### 8.2 Atenção

Representa uma conversa dentro da janela, mas aproximando-se de uma condição que merece cuidado.

Uso esperado:

- conversa ainda pode ser respondida;
- operador deve perceber que o tempo importa;
- estado deve incentivar priorização moderada.

Mensagem sugerida:

- “Janela em atenção”
- “Responder em breve”

Prioridade visual: média.

### 8.3 Crítica

Representa uma conversa próxima de expirar ou em condição operacional urgente.

Uso esperado:

- conversa deve ser priorizada;
- estado deve chamar atenção sem impedir leitura;
- operador deve entender que há risco temporal.

Mensagem sugerida:

- “Janela crítica”
- “Priorizar resposta”

Prioridade visual: alta.

### 8.4 Encerrada

Representa uma janela encerrada, expirada ou indisponível para resposta direta dentro da regra aplicável.

Uso esperado:

- operador entende que a condição normal de resposta pode não estar disponível;
- estado deve ser claro, mas não destrutivo;
- se houver ação alternativa, ela deve ser tratada em outro refinamento.

Mensagem sugerida:

- “Janela encerrada”
- “Resposta livre indisponível”

Prioridade visual: alta, com tom de bloqueio ou encerramento.

### 8.5 Sem janela

Representa ausência de informação suficiente para determinar o estado da janela.

Uso esperado:

- não deve parecer erro crítico;
- deve comunicar que o sistema não tem dado suficiente para classificar;
- deve evitar falsa segurança.

Mensagem sugerida:

- “Janela não identificada”
- “Sem informação de janela”

Prioridade visual: neutra.

### 8.6 Canal sem regra

Representa canais ou contextos onde a regra de janela de atendimento não se aplica.

Uso esperado:

- deve evitar confundir o operador com alertas desnecessários;
- deve comunicar que aquele canal segue outra lógica operacional;
- deve ser visualmente discreto.

Mensagem sugerida:

- “Canal sem regra de janela”
- “Sem regra de 24h”

Prioridade visual: neutra ou baixa.

## 9. Comportamento esperado

O semáforo deve:

- aparecer em local de alta utilidade operacional;
- ser legível em varredura rápida;
- não competir com a mensagem mais recente;
- não substituir status da conversa;
- não substituir status de entrega da mensagem;
- não bloquear ações por si só;
- não criar novas regras funcionais;
- manter coerência visual entre lista e detalhe;
- comunicar estado com label textual;
- ser consistente em desktop e layouts responsivos.

Quando o estado for crítico ou encerrado, o componente deve chamar atenção suficiente para orientar prioridade, sem transformar a tela inteira em alerta.

Quando o estado for aberto ou sem regra, o componente deve ser discreto, evitando ruído visual.

## 10. Especificação visual

Esta seção define intenção visual, não implementação.

### Linguagem de cor

- Aberta: cor positiva ou estável.
- Atenção: cor de aviso moderado.
- Crítica: cor de alerta forte.
- Encerrada: cor de bloqueio, encerramento ou indisponibilidade.
- Sem janela: cor neutra.
- Canal sem regra: cor neutra discreta.

### Forma

O estado pode ser representado por:

- badge;
- chip;
- pequeno indicador com texto;
- ícone acompanhado de label;
- combinação de ponto colorido e descrição.

A escolha final deve priorizar legibilidade, densidade e consistência com o restante do CRM.

### Texto

O texto deve ser curto, direto e operacional.

Exemplos adequados:

- “Janela aberta”
- “Em atenção”
- “Crítica”
- “Encerrada”
- “Sem janela”

Evitar textos longos na lista de conversas. Detalhes adicionais, se necessários, devem aparecer em contexto secundário.

### Hierarquia

Na lista, o semáforo deve ajudar triagem. No detalhe da conversa, deve ajudar decisão antes de responder.

O componente não deve competir com:

- nome do contato;
- última mensagem;
- unread;
- canal;
- ação de responder.

## 11. Critérios de UX

A melhoria será considerada adequada em UX quando:

- o operador entende o estado em até poucos segundos;
- o componente não exige conhecimento técnico;
- o estado é reconhecível por texto e cor;
- estados críticos são facilmente diferenciados;
- estados neutros não geram ruído;
- a lista continua escaneável;
- a timeline não perde foco;
- o semáforo não cria ambiguidade com status da conversa;
- a linguagem visual é consistente com o CRM;
- a melhoria reduz esforço de triagem.

## 12. Critérios técnicos

Esta especificação não autoriza mudanças técnicas de backend, banco ou regra de negócio.

Critérios técnicos de produto:

- utilizar apenas dados já disponíveis para a interface, quando a implementação for planejada;
- não alterar cálculo de janela;
- não alterar persistência;
- não alterar contratos de API;
- não alterar envio de mensagens;
- não alterar status de conversa;
- não introduzir bloqueio funcional novo;
- manter compatibilidade visual com estados existentes;
- preservar comportamento atual em caso de dado ausente;
- permitir rollback visual isolado.

## 13. Critérios de aceite

A entrega futura do UX-001 deverá atender aos seguintes critérios:

- existe indicação visual para a janela de atendimento;
- os estados aberta, atenção, crítica, encerrada, sem janela e canal sem regra estão definidos;
- cada estado possui texto compreensível;
- cada estado possui distinção visual suficiente;
- cor não é o único meio de interpretação;
- o componente não altera comportamento funcional;
- o componente não bloqueia ações por si só;
- a lista de conversas permanece legível;
- o detalhe da conversa permanece organizado;
- a melhoria pode ser revertida isoladamente;
- a documentação permanece alinhada ao comportamento entregue.

## 14. Casos extremos

Casos que devem ser considerados em futuras implementações:

- conversa sem timestamp suficiente para calcular janela;
- conversa com canal não WhatsApp;
- conversa importada ou histórica;
- conversa encerrada, mas com mensagem recente;
- conversa aberta em bot;
- conversa com status comercial diferente do estado da janela;
- múltiplos canais disponíveis para a empresa;
- falha temporária ao obter dado necessário;
- usuário com permissão limitada;
- lista com alto volume de conversas críticas;
- conversa sem mensagens;
- mensagens antigas migradas;
- horário do cliente e horário do sistema visualmente divergentes.

## 15. Estratégia de rollback

O rollback deve ser simples e visual.

Em caso de problema, a melhoria deve poder ser revertida removendo:

- o indicador visual;
- os labels associados;
- a diferenciação de estados;
- qualquer microcopy adicionada exclusivamente para o semáforo.

O rollback não deve exigir:

- alteração de banco;
- alteração de backend;
- alteração de APIs;
- alteração de regras de envio;
- alteração de status da conversa;
- correção de dados.

## 16. Dependências

Dependências de produto:

- definição oficial dos estados visuais;
- alinhamento com linguagem visual do CRM;
- validação de posicionamento na lista e no detalhe;
- consistência com o roadmap UX-6.1;
- revisão de microcopy.

Dependências de implementação futura:

- auditoria READ ONLY antes de qualquer patch;
- definição do local exato do componente;
- confirmação dos dados já disponíveis na interface;
- validação visual;
- commit isolado.

## 17. Riscos

### Risco alto

- Indicar janela incorreta e induzir decisão operacional errada.
- Confundir janela de atendimento com status da conversa.
- Criar senso falso de bloqueio funcional.

### Risco médio

- Gerar excesso de alertas na lista.
- Reduzir legibilidade em telas densas.
- Criar inconsistência visual com outros status.

### Risco baixo

- Microcopy pouco clara.
- Cores levemente desalinhadas com o sistema visual.
- Necessidade de ajuste fino após uso real.

## 18. Impacto esperado na operação

Impactos esperados:

- triagem mais rápida;
- melhor priorização de conversas;
- menor risco de perder janela de atendimento;
- mais segurança antes de responder;
- redução de dúvidas operacionais;
- menor necessidade de treinamento;
- maior percepção de produto maduro;
- base visual para futuras melhorias da tela de Conversas.

O ganho mais relevante esperado é a redução da carga cognitiva na lista e no detalhe da conversa. O operador deve conseguir entender urgência e disponibilidade sem investigar manualmente cada atendimento.

## Encerramento

O UX-001 inaugura o padrão de especificação da Sprint 6.1. A melhoria deve ser tratada como refinamento de experiência e comunicação visual, sem alteração de regras de negócio. Qualquer implementação futura deve seguir auditoria própria, patch isolado, validação, auditoria READ ONLY, commit individual e rollback granular.
