# Checklist Yntelli

## Status geral

Classificacao atual: **SAAS em estagio inicial/controlado**.

## Obrigatorios

- [x] README
- [x] `.env.example`
- [x] `.env.production.example`
- [x] Dockerfile
- [x] Railway config
- [x] Documentacao de deploy
- [x] Relatorio tecnico
- [x] Auditoria inicial
- [x] ADR inicial
- [x] DATA-MODEL inicial
- [x] LGPD inicial
- [x] Manutencao inicial
- [ ] Migrations versionadas
- [ ] Testes automatizados
- [ ] CI anti-quebra
- [ ] Politica de retencao implementada
- [ ] Opt-out LGPD implementado
- [ ] Criptografia de tokens/credenciais

## 12 Pecados Capitais Yntelli

1. Projeto sem classificacao clara.
   - Status: mitigado inicialmente por ADR 0001.

2. Banco sem modelo documentado.
   - Status: mitigado inicialmente por `docs/DATA-MODEL.md`.

3. Producao sem migrations versionadas.
   - Status: pendente critico.

4. SaaS sem isolamento testado entre tenants.
   - Status: pendente critico.

5. Sistema sem testes anti-quebra.
   - Status: pendente critico.

6. Deploy sem CI/checks obrigatorios.
   - Status: pendente critico.

7. Dados pessoais sem LGPD operacional.
   - Status: pendente critico.

8. Segredos e tokens armazenados sem protecao suficiente.
   - Status: pendente critico.

9. Integracoes externas sem inventario e plano de falha.
   - Status: pendente.

10. Manutencao sem backup/restore testado.
    - Status: pendente.

11. Decisoes arquiteturais sem ADR.
    - Status: parcialmente mitigado; faltam ADRs adicionais.

12. Crescimento sem plano de escala, retencao e observabilidade.
    - Status: pendente.

## Proxima sequencia recomendada

1. Criar script `typecheck`.
2. Ajustar lint para rodar sem cache problemático no ambiente.
3. Criar primeiro teste de isolamento por tenant.
4. Criar migration inicial Postgres.
5. Trocar deploy para `prisma migrate deploy`.
6. Criar CI no GitHub.
7. Implementar opt-out LGPD.
8. Criptografar tokens Meta e credenciais CLT.

