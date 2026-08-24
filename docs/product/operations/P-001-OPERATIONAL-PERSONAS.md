# P-001 — Operational Personas

Fase 6: Product Polish & UX
Tipo: documentação oficial de produto e operação
Status: planejado

## 1. Objetivo

Este documento define as personas operacionais do CRM, representando perfis reais de uso do sistema no dia a dia de atendimento, vendas, supervisão e administração.

O objetivo é orientar futuras decisões de produto, UX, priorização e refinamento visual com base nas necessidades concretas de quem opera o CRM. As personas descritas aqui não são personagens de marketing; elas representam papéis operacionais que interagem com o sistema em diferentes níveis de intensidade, autonomia e responsabilidade.

## 2. Escopo

Este documento cobre quatro personas principais:

1. Atendente Júnior.
2. Atendente Experiente.
3. Supervisor.
4. Administrador.

Para cada persona, são descritos:

- objetivos;
- frustrações;
- necessidades;
- fluxo de trabalho típico;
- frequência de uso das áreas do CRM;
- indicadores de produtividade;
- critérios de UX específicos;
- impacto esperado no produto.

## 3. Princípios da modelagem de personas

### Personas operacionais, não demográficas

As personas são definidas por responsabilidades, maturidade no uso do CRM, frequência de operação, nível de decisão e risco operacional.

### Foco em trabalho real

Cada persona deve refletir tarefas concretas:

- responder clientes;
- organizar contatos;
- acompanhar conversas;
- revisar indicadores;
- configurar operação;
- resolver exceções.

### Diferença entre velocidade e controle

Usuários iniciantes precisam de mais orientação. Usuários experientes precisam de menos atrito. Supervisores precisam de visão agregada. Administradores precisam de controle e segurança.

### Produto como suporte operacional

O CRM deve reduzir esforço mental, orientar ações e aumentar previsibilidade. Ele não deve exigir que cada persona memorize regras internas para operar com segurança.

### Consistência entre papéis

O mesmo conceito deve ter o mesmo nome, estado e comportamento para todas as personas, ainda que o nível de detalhe exibido possa variar.

## 4. Persona 1 — Atendente Júnior

### Perfil

O Atendente Júnior é um usuário em fase de adaptação ao CRM ou ao processo comercial da empresa. Atua principalmente em conversas, contatos simples e tarefas operacionais repetitivas.

### Objetivos

- Responder clientes corretamente.
- Entender qual conversa deve priorizar.
- Evitar erros de envio.
- Saber quando pode ou não responder.
- Seguir o processo sem depender o tempo todo de supervisão.
- Encontrar informações básicas do contato rapidamente.

### Frustrações

- Não entender o motivo de uma ação estar bloqueada.
- Não saber se uma mensagem foi enviada.
- Confundir conversa encerrada com conversa ativa.
- Perder-se em listas com muitos indicadores.
- Não saber qual canal está sendo usado.
- Ter medo de alterar status ou responsável errado.

### Necessidades

- Interface clara e orientada.
- Estados visuais explícitos.
- Mensagens de erro com próximo passo.
- Poucos caminhos concorrentes.
- Confirmação em ações sensíveis.
- Empty states educativos.
- Microcopy simples.

### Fluxo de trabalho típico

1. Entra na tela de Conversas.
2. Procura conversas não lidas ou atribuídas.
3. Abre uma conversa.
4. Lê cabeçalho e últimas mensagens.
5. Consulta dados básicos do contato.
6. Responde usando mensagem livre, template ou orientação.
7. Aguarda confirmação de envio.
8. Atualiza status ou sinaliza dúvida ao supervisor.

### Frequência de uso das áreas do CRM

| Área | Frequência | Observação |
| --- | --- | --- |
| Conversas | Muito alta | Principal área de trabalho |
| Contatos | Média | Consulta e pequenos ajustes |
| Kanban | Baixa/Média | Uso orientado por processo |
| Dashboard | Baixa | Consulta ocasional |
| Templates | Média/Alta | Apoio para respostas seguras |
| Importações | Baixa | Normalmente fora de sua rotina |
| Configurações | Muito baixa | Geralmente sem acesso |

### Indicadores de produtividade

- Tempo até primeira resposta.
- Quantidade de conversas respondidas.
- Taxa de mensagens com falha ou retrabalho.
- Conversas esquecidas ou sem retorno.
- Tempo médio para localizar contexto.
- Necessidade de intervenção do supervisor.

### Critérios de UX específicos

- Informação principal sempre visível.
- Nada essencial deve depender de hover.
- Erros devem explicar causa e solução.
- Ações sensíveis devem ter confirmação.
- A interface deve diferenciar claramente estados.
- Templates e respostas rápidas devem ser fáceis de encontrar.
- O sistema deve evitar jargão técnico.

## 5. Persona 2 — Atendente Experiente

### Perfil

O Atendente Experiente domina o processo, atende volume maior e busca velocidade. Ele conhece atalhos, entende status e precisa de fluidez para operar sem fricção.

### Objetivos

- Atender alto volume com rapidez.
- Alternar conversas sem perder contexto.
- Usar atalhos e respostas rápidas.
- Identificar exceções rapidamente.
- Resolver atendimentos sem depender de supervisor.
- Manter histórico organizado.

### Frustrações

- Muitos cliques para ações frequentes.
- Modais ou confirmações excessivas.
- Interface lenta ou com movimento inesperado.
- Falta de atalhos.
- Ter que abrir contato completo para ver dado básico.
- Filtros que não preservam estado.

### Necessidades

- Densidade visual equilibrada.
- Atalhos de teclado.
- Ações rápidas próximas do contexto.
- Filtros úteis.
- Feedback visual rápido.
- Menos interrupções.
- Timeline legível em conversas longas.

### Fluxo de trabalho típico

1. Filtra conversas prioritárias.
2. Percorre a lista rapidamente.
3. Abre conversa e identifica contexto pelo cabeçalho.
4. Lê apenas pontos relevantes da timeline.
5. Usa resposta rápida, template ou mensagem manual.
6. Atualiza status, responsável ou tarefa.
7. Avança para a próxima conversa com mínimo atrito.

### Frequência de uso das áreas do CRM

| Área | Frequência | Observação |
| --- | --- | --- |
| Conversas | Muito alta | Operação principal |
| Contatos | Alta | Consulta contextual e atualização |
| Kanban | Média | Acompanha oportunidades |
| Dashboard | Média | Consulta performance própria ou fila |
| Templates | Alta | Ganho de velocidade |
| Importações | Baixa | Uso eventual |
| Configurações | Baixa | Pouco uso |

### Indicadores de produtividade

- Conversas atendidas por período.
- Tempo médio de resposta.
- Taxa de resolução.
- Quantidade de cliques por atendimento.
- Tempo entre abrir conversa e responder.
- Uso de templates e respostas rápidas.

### Critérios de UX específicos

- Ações frequentes devem exigir poucos cliques.
- Atalhos devem ser descobríveis e previsíveis.
- Interface deve preservar foco durante atualizações.
- Listas devem ser escaneáveis.
- Composer deve ser rápido e contextual.
- Sidebar deve reduzir abertura de novas telas.
- Confirmações devem ser proporcionais ao risco.

## 6. Persona 3 — Supervisor

### Perfil

O Supervisor acompanha a operação, distribui demanda, identifica gargalos e garante qualidade do atendimento. Alterna entre visão agregada e análise de casos específicos.

### Objetivos

- Identificar filas críticas.
- Ver conversas sem responsável.
- Acompanhar produtividade da equipe.
- Detectar atrasos e gargalos.
- Corrigir desvios operacionais.
- Apoiar atendentes em casos sensíveis.
- Garantir que conversas importantes não fiquem paradas.

### Frustrações

- Falta de visão clara de prioridade.
- Indicadores sem ação correspondente.
- Dificuldade para entender carga por atendente.
- Necessidade de abrir muitas conversas para encontrar problema.
- Status inconsistentes entre telas.
- Falta de contexto para intervir.

### Necessidades

- Dashboard acionável.
- Filtros por responsável, status, canal e atraso.
- Indicadores de conversas em risco.
- Visão de conversas sem ownership.
- Histórico claro para auditoria.
- Ações de redistribuição.
- Consistência entre Conversas, Kanban e Dashboard.

### Fluxo de trabalho típico

1. Consulta dashboard ou lista filtrada.
2. Identifica filas, atrasos ou conversas sem responsável.
3. Abre conversas críticas.
4. Verifica histórico e contexto.
5. Redistribui responsável ou orienta atendente.
6. Acompanha retorno da operação.
7. Revisa indicadores ao longo do dia.

### Frequência de uso das áreas do CRM

| Área | Frequência | Observação |
| --- | --- | --- |
| Dashboard | Alta | Visão gerencial e priorização |
| Conversas | Alta | Auditoria e intervenção |
| Kanban | Alta | Gestão de funil e gargalos |
| Contatos | Média | Consulta de casos específicos |
| Templates | Média | Revisão e padronização |
| Importações | Média | Acompanhamento de qualidade |
| Configurações | Baixa/Média | Ajustes limitados |

### Indicadores de produtividade

- Conversas sem responsável.
- Tempo médio de primeira resposta.
- Tempo médio de resolução.
- Conversas paradas por status.
- Volume por atendente.
- Taxa de reabertura.
- SLA por fila ou canal.
- Gargalos por etapa.

### Critérios de UX específicos

- Métricas devem ser acionáveis.
- Indicadores devem levar a listas filtradas.
- Visões agregadas devem permitir drill-down.
- Status devem ser consistentes entre telas.
- Alertas devem diferenciar urgência real de informação.
- Ações de redistribuição devem ser seguras.
- Histórico deve facilitar auditoria.

## 7. Persona 4 — Administrador

### Perfil

O Administrador configura a operação, gerencia usuários, canais, permissões, padrões e ajustes sensíveis. Atua menos no atendimento diário e mais na estrutura que sustenta a operação.

### Objetivos

- Configurar o CRM com segurança.
- Gerenciar usuários e permissões.
- Controlar canais e integrações.
- Garantir consistência de templates e processos.
- Evitar erros operacionais por configuração incorreta.
- Auditar mudanças sensíveis.
- Manter a operação escalável.

### Frustrações

- Configurações sem explicação de impacto.
- Falta de confirmação em ações sensíveis.
- Dificuldade para entender estado de integrações.
- Erros técnicos pouco claros.
- Permissões difíceis de validar.
- Falta de rastreabilidade.

### Necessidades

- Linguagem clara sobre consequências.
- Confirmações para ações críticas.
- Estados de integração visíveis.
- Permissões compreensíveis.
- Feedback de salvamento.
- Histórico ou evidência de alterações sensíveis.
- Separação clara entre operação e configuração.

### Fluxo de trabalho típico

1. Acessa configurações ou áreas administrativas.
2. Verifica canais, usuários ou permissões.
3. Ajusta parâmetros operacionais.
4. Revisa templates, campanhas ou integrações.
5. Confirma impacto de mudanças.
6. Monitora se a operação segue funcionando.
7. Atua em exceções reportadas por supervisores.

### Frequência de uso das áreas do CRM

| Área | Frequência | Observação |
| --- | --- | --- |
| Configurações | Alta | Área principal |
| Dashboard | Média | Monitoramento geral |
| Conversas | Baixa/Média | Auditoria e diagnóstico |
| Contatos | Média | Qualidade da base |
| Kanban | Média | Estrutura de processo |
| Templates | Alta | Padronização de comunicação |
| Importações | Alta | Operações sensíveis de base |

### Indicadores de produtividade

- Tempo para configurar canal ou usuário.
- Taxa de erros de configuração.
- Incidentes por permissão incorreta.
- Qualidade da base de contatos.
- Consistência de templates.
- Tempo para diagnosticar falha operacional.
- Quantidade de solicitações de suporte interno.

### Critérios de UX específicos

- Configurações devem explicar impacto antes da ação.
- Estados de integração devem ser inequívocos.
- Ações destrutivas devem ter confirmação forte.
- Permissões devem ser legíveis.
- Erros devem separar causa operacional de causa técnica.
- O sistema deve preservar rastreabilidade visual.
- Fluxos sensíveis devem evitar ambiguidade.

## 8. Objetivos de cada persona

| Persona | Objetivo principal | Objetivo secundário |
| --- | --- | --- |
| Atendente Júnior | Responder corretamente com segurança | Aprender processo sem depender sempre do supervisor |
| Atendente Experiente | Atender alto volume com velocidade | Resolver exceções com baixo atrito |
| Supervisor | Controlar operação e gargalos | Apoiar qualidade e redistribuição |
| Administrador | Configurar e proteger a operação | Manter consistência e rastreabilidade |

## 9. Frustrações

| Persona | Frustrações principais |
| --- | --- |
| Atendente Júnior | Falta de clareza, medo de errar, bloqueios sem explicação |
| Atendente Experiente | Cliques excessivos, lentidão, interrupções, pouca densidade |
| Supervisor | Falta de visão acionável, status inconsistentes, gargalos escondidos |
| Administrador | Configurações ambíguas, risco sem confirmação, erros técnicos pouco claros |

## 10. Necessidades

| Persona | Necessidades principais |
| --- | --- |
| Atendente Júnior | Orientação, feedback, estados claros, segurança |
| Atendente Experiente | Velocidade, atalhos, densidade, foco |
| Supervisor | Visão agregada, filtros, alertas, drill-down |
| Administrador | Controle, explicação de impacto, permissões, rastreabilidade |

## 11. Fluxo de trabalho típico

### Atendente Júnior

Trabalha de forma orientada, seguindo fila e status visíveis. Precisa de suporte contextual para entender o que fazer.

### Atendente Experiente

Opera por varredura rápida, atalhos e ações repetitivas. Precisa de velocidade e baixa fricção.

### Supervisor

Alterna entre visão macro e casos específicos. Precisa transformar indicadores em intervenção.

### Administrador

Atua em configurações e exceções estruturais. Precisa de clareza de impacto e segurança.

## 12. Frequência de uso das áreas do CRM

| Área | Atendente Júnior | Atendente Experiente | Supervisor | Administrador |
| --- | --- | --- | --- | --- |
| Conversas | Muito alta | Muito alta | Alta | Baixa/Média |
| Contatos | Média | Alta | Média | Média |
| Dashboard | Baixa | Média | Alta | Média |
| Kanban | Baixa/Média | Média | Alta | Média |
| Templates | Média/Alta | Alta | Média | Alta |
| Importações | Baixa | Baixa | Média | Alta |
| Configurações | Muito baixa | Baixa | Baixa/Média | Alta |

## 13. Indicadores de produtividade

### Indicadores comuns

- Tempo para localizar informação.
- Tempo para iniciar ação.
- Quantidade de cliques por fluxo.
- Taxa de erro ou retrabalho.
- Tempo de resposta.
- Clareza de status.
- Uso de filtros.
- Ações concluídas sem suporte externo.

### Indicadores por persona

| Persona | Indicadores prioritários |
| --- | --- |
| Atendente Júnior | tempo até primeira resposta, erros evitáveis, necessidade de ajuda |
| Atendente Experiente | volume atendido, cliques por atendimento, uso de atalhos |
| Supervisor | conversas em risco, filas paradas, distribuição por atendente |
| Administrador | incidentes de configuração, tempo de diagnóstico, consistência operacional |

## 14. Critérios de UX específicos para cada persona

### Atendente Júnior

- Clareza antes de densidade.
- Mensagens de erro educativas.
- Estados explícitos.
- Confirmação em ações sensíveis.
- Ajuda contextual.

### Atendente Experiente

- Densidade equilibrada.
- Atalhos e quick actions.
- Foco preservado.
- Baixo número de cliques.
- Feedback imediato.

### Supervisor

- Indicadores acionáveis.
- Filtros persistentes.
- Drill-down rápido.
- Alertas priorizados.
- Visão por responsável e fila.

### Administrador

- Explicação de impacto.
- Confirmações fortes.
- Estados de integração.
- Permissões compreensíveis.
- Rastreabilidade visual.

## 15. Impacto esperado no produto

A documentação de personas deve orientar decisões futuras em:

- priorização de melhorias;
- desenho de estados;
- organização de telas;
- linguagem de microcopy;
- densidade de informação;
- exposição de ações;
- permissões e segurança;
- onboarding;
- dashboard e relatórios;
- atalhos e produtividade.

Impactos esperados:

- menos decisões de UX baseadas em suposição;
- melhor equilíbrio entre simplicidade e velocidade;
- experiência mais adequada por nível de maturidade operacional;
- menor curva de aprendizado;
- maior eficiência para usuários avançados;
- melhor suporte a supervisão e administração.

## 16. Conclusões para orientar futuras implementações

1. A tela de Conversas deve priorizar Atendente Júnior e Atendente Experiente, pois são os usuários de maior frequência.
2. Dashboard, Kanban e filtros devem priorizar necessidades do Supervisor.
3. Configurações, templates e importações devem priorizar segurança para o Administrador.
4. O produto deve equilibrar orientação e velocidade.
5. Estados visuais devem ser claros para iniciantes e eficientes para experientes.
6. Quick actions devem existir, mas com segurança proporcional ao impacto.
7. Métricas precisam ser acionáveis, especialmente para supervisão.
8. Configurações sensíveis devem explicar consequências.
9. A linguagem do CRM deve reduzir ambiguidade operacional.
10. Futuras sprints de UX devem declarar explicitamente qual persona é primária e quais são secundárias.

## Encerramento

As personas operacionais definidas neste documento devem funcionar como referência permanente para evolução do CRM. Toda melhoria futura de produto deve considerar quem usa a funcionalidade, com que frequência, sob qual pressão operacional e com qual nível de autonomia.
