# Checklist Antes de Alterar Producao

Use este checklist antes de qualquer alteracao em producao, incluindo deploy, ajuste de schema, comando operacional, alteracao de variavel, script manual ou mudanca com impacto em dados.

## 1. Banco

- [ ] Banco online.
- [ ] Backup manual criado.
- [ ] Snapshot validado.

## 2. Codigo

- [ ] Diff auditado.
- [ ] Escopo confirmado.
- [ ] `npm run verify` OK.

## 3. Git

- [ ] Commit isolado.
- [ ] Arquivos corretos no commit.
- [ ] Hash registrado.

## 4. Deploy

- [ ] Railway saudavel.
- [ ] Build concluido.
- [ ] Healthcheck OK.

## 5. Pos Deploy

- [ ] Funcionalidade testada.
- [ ] Logs sem erros.
- [ ] Dashboard OK.
- [ ] Atendimento OK.
- [ ] Banco OK.
