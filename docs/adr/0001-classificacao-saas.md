# ADR 0001 - Classificacao do projeto como SaaS

## Status

Aceita.

## Contexto

O CRM possui recursos de multiempresa/tenant, usuarios por empresa, roles, isolamento por `companyId`, cadastro de empresas, canais Meta por tenant, campanhas, contatos, funil, tarefas, IA e deploy em ambiente de producao com Postgres/Railway.

Essas caracteristicas indicam que o projeto nao e apenas de uso proprio. Mesmo que seja usado inicialmente por uma operacao controlada, sua arquitetura aponta para revenda, operacao com multiplos clientes ou fornecimento como plataforma.

## Decisao

Classificar o projeto como **SAAS em estagio inicial/controlado**.

## Consequencias

- O isolamento entre tenants passa a ser requisito critico.
- Toda nova API deve filtrar dados por `companyId` quando aplicavel.
- Recursos administrativos globais devem exigir administrador de plataforma.
- Dados pessoais devem seguir LGPD desde a fase inicial.
- Banco de producao deve usar migrations versionadas.
- Deploy deve ter checks anti-quebra antes de publicar.
- Testes de permissao e isolamento deixam de ser opcionais.

## Riscos conhecidos

- Ausencia atual de testes automatizados de isolamento.
- Ausencia atual de migrations versionadas.
- Tokens Meta e credenciais CLT ainda precisam de criptografia em repouso.
- Politicas LGPD de retencao, opt-out e exclusao ainda precisam ser implementadas no produto.

