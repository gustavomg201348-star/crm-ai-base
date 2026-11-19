CREATE TABLE "QuickReply" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuickReply_companyId_position_idx" ON "QuickReply"("companyId", "position");
CREATE INDEX "QuickReply_companyId_title_idx" ON "QuickReply"("companyId", "title");

ALTER TABLE "QuickReply"
ADD CONSTRAINT "QuickReply_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "QuickReply" ("id", "companyId", "title", "body", "position", "createdAt", "updatedAt")
SELECT
  'qr_' || substr(md5(c."id" || ':' || seed.slug), 1, 24),
  c."id",
  seed.title,
  seed.body,
  seed.position,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Company" c
CROSS JOIN (
  VALUES
    ('cpf', 'Pedir CPF', 'Pode me informar seu CPF para eu consultar sua margem com seguranca?', 0),
    ('authorization', 'Pedir autorizacao', 'Para seguir com a consulta, preciso da sua autorizacao para verificar as opcoes disponiveis para voce.', 1),
    ('document', 'Pedir comprovante', 'Pode me enviar um comprovante ou documento atualizado para eu conferir os dados da proposta?', 2),
    ('simulation', 'Explicar simulacao CLT/INSS', 'Vou fazer uma simulacao sem compromisso para verificar valor liberado, prazo e parcela. Assim que tiver o resultado, te envio as melhores opcoes.', 3),
    ('no-margin', 'Retorno sem margem', 'No momento nao apareceu margem disponivel para essa consulta. Vou deixar seu atendimento salvo e te aviso se surgir uma nova possibilidade.', 4),
    ('approved', 'Proposta aprovada', 'Sua proposta foi aprovada. Vou te orientar nos proximos passos para concluir com seguranca.', 5)
) AS seed(slug, title, body, position);
