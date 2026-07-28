# Meta Templates — Mapa Arquitetural

## Fluxo principal

```text
Meta API
↓
Template Sync Service
↓
Local Template Library
↓
Template + Components + Default Media
↓
Campaigns / Conversations
↓
WhatsApp Send Service
↓
Meta API
```

## Responsabilidades por camada

- Meta API: fonte externa dos templates, status da Meta e aprovação.
- Normalizador central: interpreta componentes, exemplos, variáveis e compatibilidade técnica.
- Serviço de sincronização: busca templates na Meta, normaliza, faz upsert e preserva configurações locais.
- Biblioteca local: guarda templates por empresa/WABA, componentes, mídia padrão, status operacional e readiness.
- Gerenciamento interno da mídia: resolve URL, storage, media id ou estratégia futura sem expor detalhes ao operador.
- Campanhas: escolhem templates prontos e herdam a mídia padrão do template.
- Conversas: usam a mesma biblioteca para envio individual de templates.
- Serviço final de envio: monta o payload WhatsApp com dados resolvidos pela biblioteca.

## Regras arquiteturais

- Template pertence à empresa e à WABA.
- Canais/números da mesma WABA podem compartilhar templates.
- Mídia padrão pertence ao template.
- Campanhas e conversas apenas consomem essa configuração.
- Mídia configurada não pode ser apagada por sincronização.
- Sincronização não pode alterar o fluxo atual de envio até a migração estar pronta.
- Fallback atual por env/hardcoded deve permanecer temporariamente.
- `companyId` deve estar presente em todas as consultas e alterações.
- `header_handle` e `media_id` não são equivalentes.
- Detalhes técnicos de mídia permanecem internos.

## Etapas seguintes

- T2.1 — auditoria final e desenho exato do schema.
- T2.2 — implementação do schema local.
- T2.3 — repository/service.
- T2.4 — sincronização.
- T2.5 — API e tela.
- T2.6 — configuração única da mídia.
- T2.7 — campanhas e conversas.
- T2.8 — criação e aprovação pelo CRM.
