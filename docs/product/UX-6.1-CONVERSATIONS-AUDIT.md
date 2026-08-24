# UX-6.1 — Auditoria Mestre da Tela de Conversas

Fase 6: Product Polish & UX
Sprint 6.1: Conversas
Status: documentação estratégica de produto
Tipo: auditoria UX, produtividade operacional e consistência visual

Este documento é a fonte de verdade de produto para a evolução da tela de Conversas. Ele não define implementação técnica, não altera arquitetura e não cria obrigação automática de desenvolvimento. Seu papel é alinhar intenção de produto, critérios de qualidade e prioridades de refinamento para futuras sprints.

## 1. Objetivo da Sprint

Documentar oficialmente a auditoria de UX da tela de Conversas, identificando oportunidades de melhoria na experiência do operador, na leitura do contexto, na produtividade do atendimento e na consistência visual do CRM.

A Sprint 6.1 busca responder:

- Como tornar a tela de Conversas mais rápida para operar?
- Como reduzir dúvidas durante o atendimento?
- Como evidenciar prioridade, contexto e próximo passo?
- Como evitar ações inseguras, repetidas ou fora de contexto?
- Como criar uma base sólida para futuras melhorias visuais e funcionais?

## 2. Escopo e fora de escopo

### Escopo

- Auditoria de UX da tela de Conversas.
- Mapeamento da jornada do operador.
- Definição de princípios visuais e operacionais.
- Identificação de problemas de usabilidade.
- Priorização de oportunidades de melhoria.
- Critérios de aceite para futuras implementações.
- Estimativa qualitativa de economia operacional.
- Roadmap das próximas telas da Fase 6.

### Fora de escopo

- Implementação de código.
- Alteração de componentes.
- Alteração de rotas.
- Alteração de banco de dados.
- Alteração de schema.
- Mudança de backend, integrações ou arquitetura.
- Criação de testes automatizados.
- Deploy, push ou commit.
- Definição de layouts finais em alta fidelidade.
- Remoção de comportamentos legados.

## 3. Objetivos operacionais

A tela de Conversas deve permitir que o operador:

1. Entenda rapidamente quem precisa de atenção.
2. Identifique o cliente, canal, status e contexto sem alternar telas.
3. Responda com segurança e velocidade.
4. Diferencie mensagens recebidas, enviadas, automáticas e internas.
5. Perceba se há risco de duplicidade, atraso ou perda de contexto.
6. Mantenha continuidade entre conversa, contato, etapa e histórico.
7. Trabalhe com menos cliques e menos leitura redundante.
8. Saiba quando a conversa está aberta, pendente, em bot, vendida ou resolvida.
9. Evite enviar mensagens pelo canal errado.
10. Receba feedback visual claro após cada ação relevante.

## 4. Princípios de UX adotados

### Clareza antes de densidade

A tela pode conter muitos dados, mas deve priorizar o que ajuda o operador a decidir a próxima ação. Informações secundárias devem existir sem competir com a mensagem e o contexto principal.

### Contexto no lugar certo

O operador não deve precisar abrir várias páginas para entender quem é o cliente, qual foi a última interação e qual é o próximo passo provável.

### Segurança operacional

Toda ação sensível deve deixar claro seu impacto. Enviar mensagem, assumir conversa, alterar responsável, encerrar atendimento ou usar template deve ter feedback adequado.

### Ritmo de atendimento

A experiência deve favorecer fluxo contínuo. Ações frequentes precisam ser rápidas, previsíveis e com mínimo atrito.

### Visibilidade de estado

O usuário deve entender se a mensagem foi enviada, falhou, está pendente, foi recebida ou pertence a uma automação.

### Consistência visual

Status, badges, botões, estados vazios, carregamentos, erros e ações devem seguir padrões reutilizáveis em todo o CRM.

## 5. Jornada completa do operador

### 5.1 Entrada na tela

O operador acessa Conversas esperando encontrar rapidamente:

- conversas que exigem resposta;
- conversas atribuídas a ele;
- conversas sem responsável;
- conversas recentes;
- conversas atrasadas;
- conversas por canal ou status.

Risco UX: se a lista não comunica prioridade, o operador passa tempo procurando o que deveria estar evidente.

### 5.2 Triagem

Na triagem, o operador avalia:

- quem enviou a última mensagem;
- há quanto tempo a conversa aguarda;
- qual canal está em uso;
- se existe responsável;
- se a conversa está em bot, pendente, aberta ou resolvida;
- se há mensagens não lidas.

Risco UX: conversas urgentes podem ficar visualmente iguais a conversas de baixa prioridade.

### 5.3 Abertura da conversa

Ao abrir uma conversa, o operador precisa reconhecer:

- identidade do contato;
- histórico recente;
- canal;
- etapa ou status comercial;
- última mensagem;
- contexto operacional relevante;
- possíveis alertas.

Risco UX: se o cabeçalho e painel lateral não sintetizam contexto, o operador lê a timeline inteira antes de agir.

### 5.4 Leitura da timeline

Na timeline, o operador busca:

- sequência da conversa;
- origem das mensagens;
- diferença entre mensagem do cliente, agente, IA e sistema;
- eventos importantes;
- status de entrega;
- anexos ou templates enviados.

Risco UX: timeline visualmente homogênea aumenta erro de interpretação.

### 5.5 Resposta

Ao responder, o operador precisa:

- saber se pode responder;
- saber por qual canal responderá;
- ver se há template ou mensagem livre;
- identificar se a conversa está encerrada;
- receber confirmação de envio ou falha.

Risco UX: ausência de feedback pode gerar clique duplicado ou insegurança.

### 5.6 Pós-ação

Após agir, o operador precisa entender:

- se a mensagem foi salva;
- se foi enviada;
- se a conversa mudou de status;
- se o unread foi resolvido;
- se o cliente ficou aguardando;
- se alguma automação continuará o fluxo.

Risco UX: ações bem-sucedidas sem confirmação clara parecem incompletas.

## 6. Mapa da tela por blocos

### 6.1 Lista de conversas

Função: permitir triagem e navegação entre atendimentos.

Deve comunicar:

- nome do contato;
- última mensagem;
- horário;
- canal;
- status;
- responsável;
- indicador de não lida;
- prioridade ou atraso;
- origem da última interação.

### 6.2 Cabeçalho da conversa

Função: resumir identidade, estado e ações principais.

Deve comunicar:

- contato atual;
- telefone ou identificador mascarável;
- status da conversa;
- canal;
- responsável;
- ações principais;
- risco ou bloqueio operacional.

### 6.3 Timeline

Função: apresentar o histórico conversacional e eventos relevantes.

Deve diferenciar:

- mensagens recebidas;
- mensagens enviadas;
- mensagens automáticas;
- mensagens da IA;
- eventos de sistema;
- notas internas;
- falhas de envio;
- templates e mídia.

### 6.4 Composer

Função: permitir resposta rápida e segura.

Deve indicar:

- canal de envio;
- tipo de mensagem;
- disponibilidade de resposta;
- estado de envio;
- anexos;
- templates;
- bloqueios ou restrições.

### 6.5 Painel lateral

Função: oferecer contexto sem retirar o operador da conversa.

Pode conter:

- dados do contato;
- etapa comercial;
- tags;
- origem;
- resumo da última atividade;
- propostas relacionadas;
- campanhas relacionadas;
- tarefas;
- notas internas;
- histórico resumido.

### 6.6 Estados da interface

Devem existir estados claros para:

- carregando lista;
- carregando conversa;
- nenhuma conversa selecionada;
- lista vazia;
- filtro sem resultado;
- erro de carregamento;
- conversa resolvida;
- sem permissão;
- envio em andamento;
- envio com falha;
- reconexão ou atualização.

## 7. Auditoria estruturada

### UX-001 — Priorização visual da lista de conversas

Problema: conversas urgentes, não lidas ou aguardando resposta podem competir visualmente com conversas comuns.

Impacto: o operador perde tempo triando manualmente e pode deixar clientes aguardando.

Prioridade: P0

Complexidade: Média

Solução proposta: criar hierarquia visual clara para conversas não lidas, atrasadas, sem responsável e com última mensagem do cliente.

Critério de aceite: ao olhar a lista, o operador deve identificar em poucos segundos quais conversas exigem ação imediata.

### UX-002 — Clareza do canal e origem da conversa

Problema: o canal de atendimento pode não estar suficientemente evidente durante leitura e resposta.

Impacto: risco de confusão operacional, especialmente em empresas com múltiplos canais WhatsApp.

Prioridade: P0

Complexidade: Baixa

Solução proposta: exibir canal, provedor ou origem em posição consistente na lista, cabeçalho e composer.

Critério de aceite: antes de responder, o operador consegue confirmar visualmente por qual canal a mensagem será enviada.

### UX-003 — Diferenciação da timeline

Problema: mensagens, eventos, notas internas e automações podem parecer parte do mesmo fluxo visual.

Impacto: aumenta o risco de interpretação errada do histórico.

Prioridade: P1

Complexidade: Média

Solução proposta: diferenciar tipos de item por alinhamento, cor, badge, ícone e microcopy.

Critério de aceite: cliente, agente, IA, sistema e nota interna devem ser reconhecidos sem leitura detalhada.

### UX-004 — Contexto do contato sem troca de página

Problema: o operador pode precisar sair da conversa para entender dados relevantes do cliente.

Impacto: perda de ritmo, mais cliques e maior chance de esquecer o contexto da resposta.

Prioridade: P1

Complexidade: Média

Solução proposta: fortalecer painel lateral com dados cadastrais, etapa, tags, histórico e vínculos principais.

Critério de aceite: o operador consegue responder com contexto suficiente sem abrir a página completa do contato.

### UX-005 — Feedback de envio de mensagem

Problema: após enviar uma mensagem, o retorno visual pode não ser suficiente para distinguir salvamento local, envio externo e falha.

Impacto: cliques repetidos, ansiedade operacional e dúvidas sobre entrega.

Prioridade: P0

Complexidade: Média

Solução proposta: padronizar estados de mensagem: enviando, enviada, entregue, lida, falhou e pendente.

Critério de aceite: cada mensagem enviada deve ter estado visual compreensível após a ação.

### UX-006 — Composer orientado ao estado da conversa

Problema: o campo de resposta pode não comunicar claramente se a conversa aceita resposta, template, mídia ou está encerrada.

Impacto: o operador tenta ações indisponíveis ou fica inseguro sobre o que pode fazer.

Prioridade: P1

Complexidade: Média

Solução proposta: adaptar visualmente o composer ao status da conversa e ao canal disponível.

Critério de aceite: o composer deve indicar quando responder é permitido, bloqueado ou exige outro tipo de ação.

### UX-007 — Estados vazios e de filtro

Problema: lista vazia, filtro sem resultado e ausência de conversa selecionada podem parecer erro ou falha.

Impacto: o operador perde confiança e pode tentar recarregar ou abandonar a tela.

Prioridade: P2

Complexidade: Baixa

Solução proposta: criar empty states específicos para lista vazia, filtro sem resultado e nenhuma conversa selecionada.

Critério de aceite: cada estado vazio deve explicar a causa provável e sugerir próximo passo.

### UX-008 — Ações de responsabilidade e status

Problema: assumir conversa, transferir responsável ou alterar status pode não ter consequência visual imediata.

Impacto: risco de duplicidade de atendimento ou incerteza sobre ownership.

Prioridade: P1

Complexidade: Média

Solução proposta: destacar responsável e status no cabeçalho, com feedback claro após mudança.

Critério de aceite: após alterar responsável ou status, a tela deve refletir a mudança imediatamente e de forma inequívoca.

### UX-009 — Busca e filtros operacionais

Problema: filtros podem não refletir os recortes reais do trabalho diário.

Impacto: operadores gastam tempo procurando conversas por tentativa.

Prioridade: P2

Complexidade: Média

Solução proposta: organizar filtros por uso operacional: minhas, não lidas, sem responsável, atrasadas, por canal, por status e por período.

Critério de aceite: o operador deve conseguir chegar a uma fila relevante em poucos cliques.

### UX-010 — Consistência com demais módulos

Problema: status, badges, ações e textos da tela de Conversas podem divergir de Contatos, Kanban e Dashboard.

Impacto: aumenta curva de aprendizado e gera expectativa quebrada entre páginas.

Prioridade: P2

Complexidade: Baixa

Solução proposta: alinhar nomenclatura, cores, badges, ações principais e estados com o sistema visual global do CRM.

Critério de aceite: o mesmo conceito deve ter o mesmo nome, cor e comportamento nas principais telas.

## 8. Economia Operacional

As estimativas abaixo são conceituais e servem apenas para orientar priorização futura. Devem ser validadas com uso real antes de qualquer conclusão definitiva.

| Melhoria | Economia estimada | Base operacional |
| --- | ---: | --- |
| Priorização visual da lista | 5–15 segundos por triagem | Menos tempo procurando conversas urgentes |
| Canal evidente no cabeçalho/composer | 3–8 segundos por resposta | Menos conferência manual antes de enviar |
| Timeline diferenciada | 10–25 segundos por conversa longa | Leitura mais rápida do histórico |
| Painel lateral contextual | 15–40 segundos por atendimento | Menos troca de tela para entender o contato |
| Feedback claro de envio | 5–20 segundos por envio com dúvida | Menos clique repetido e menos verificação manual |
| Composer orientado ao estado | 5–15 segundos por conversa bloqueada | Menos tentativa de ação indisponível |
| Estados vazios claros | 10–30 segundos por ocorrência | Menos confusão entre vazio, filtro e erro |
| Feedback de responsável/status | 5–15 segundos por mudança | Menos necessidade de confirmar ownership |
| Filtros operacionais | 20–60 segundos por sessão | Menos navegação e busca manual |
| Consistência visual | ganho contínuo | Menor curva de aprendizado e menos erro |

Potencial agregado: em operações com alto volume, pequenas economias por conversa podem representar horas semanais de produtividade recuperada, especialmente em equipes com múltiplos operadores.

## 9. Critérios de Qualidade

Futuras implementações na tela de Conversas devem respeitar as regras abaixo.

### Clareza

- Toda ação principal deve ser identificável sem leitura longa.
- Todo status deve ter nome, cor e posição consistentes.
- Todo erro deve informar consequência e próximo passo.

### Segurança

- Ações de envio devem ter feedback imediato.
- Estados de falha não devem parecer sucesso.
- Mudanças de responsável ou status devem ser rastreáveis visualmente.

### Produtividade

- Fluxos frequentes devem exigir poucos cliques.
- O operador não deve trocar de tela para obter contexto básico.
- Filtros devem refletir filas reais de trabalho.

### Consistência

- Conversas, Contatos, Kanban e Dashboard devem compartilhar linguagem visual.
- Badges de status devem ter significado único.
- Botões e ações devem manter hierarquia previsível.

### Acessibilidade visual

- Informações críticas não devem depender apenas de cor.
- Contraste deve ser suficiente para leitura prolongada.
- Ícones devem ser acompanhados de texto quando houver risco de ambiguidade.

### Robustez perceptiva

- Carregamentos devem ser claros.
- Estados vazios devem ser educativos.
- A tela não deve piscar ou parecer instável durante atualização.

## 10. Checklist final de aceite da Sprint

- [x] Objetivo da Sprint documentado.
- [x] Escopo e fora de escopo definidos.
- [x] Objetivos operacionais descritos.
- [x] Princípios de UX estabelecidos.
- [x] Jornada completa do operador mapeada.
- [x] Tela dividida em blocos funcionais.
- [x] Auditoria UX-001 até UX-010 criada.
- [x] Cada item contém problema, impacto, prioridade, complexidade, solução e critério de aceite.
- [x] Economia operacional estimada.
- [x] Critérios de qualidade definidos.
- [x] Roadmap das próximas telas incluído.
- [x] Documento mantido em nível de produto, sem implementação técnica.

## 11. Roadmap da evolução das próximas telas

### 11.1 Dashboard

Objetivo: transformar o dashboard em uma central de decisão diária.

Foco futuro:

- indicadores acionáveis;
- gargalos operacionais;
- campanhas com atenção;
- conversas paradas;
- variação por período;
- navegação de métrica para lista filtrada.

### 11.2 Contato

Objetivo: tornar o perfil do contato uma visão confiável de histórico, identidade e próximos passos.

Foco futuro:

- linha do tempo;
- dados cadastrais claros;
- vínculos com conversas, campanhas e propostas;
- qualidade cadastral;
- alertas de inconsistência;
- ações rápidas.

### 11.3 Kanban

Objetivo: melhorar gestão visual de oportunidades e estágios.

Foco futuro:

- cards mais informativos;
- tempo parado por etapa;
- responsáveis;
- próximos passos;
- filtros salvos;
- consistência entre etapa e conversa.

### 11.4 Templates

Objetivo: facilitar uso seguro e consistente de mensagens prontas.

Foco futuro:

- prévia realista;
- variáveis obrigatórias;
- status de aprovação;
- organização por finalidade;
- favoritos;
- mensagens de orientação.

### 11.5 Importações

Objetivo: tornar importações previsíveis e auditáveis.

Foco futuro:

- prévia por linha;
- separação entre novos, atualizados, duplicados e inválidos;
- relatório de erros;
- confirmação antes de execução;
- estados de processamento;
- resultado final claro.

### 11.6 Configurações

Objetivo: tornar configurações mais compreensíveis, seguras e orientadas por impacto.

Foco futuro:

- organização por categoria;
- explicação de consequências;
- estados de conexão;
- permissões;
- canais;
- preferências operacionais;
- feedback de salvamento.

## Encerramento

A Sprint UX-6.1 estabelece a base de produto para evoluir a tela de Conversas com foco em clareza, velocidade, segurança e consistência. Este documento deve guiar futuras discussões, priorizações e implementações, sem substituir validação com usuários e sem assumir qualquer mudança técnica automática.
