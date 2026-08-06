import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCampaignRecipientTemplateVariables,
  validateCampaignRecipientTemplateVariables
} from "./campaign-template-recipient-variables";
import { TemplateParameterError } from "./template-parameters";

test("parseia uma variavel por destinatario", () => {
  const recipients = parseCampaignRecipientTemplateVariables(
    JSON.stringify([
      {
        contactId: "contact-a",
        rowNumber: 2,
        resolved: { version: 1, body: ["Joao"] }
      }
    ]),
    1
  );

  assert.deepEqual(recipients, [
    {
      contactId: "contact-a",
      rowNumber: 2,
      resolved: { version: 1, body: ["Joao"] }
    }
  ]);
});

test("parseia duas variaveis por destinatario preservando ordem do body", () => {
  const recipients = parseCampaignRecipientTemplateVariables(
    JSON.stringify([
      {
        contactId: "contact-a",
        rowNumber: 2,
        resolved: { version: 1, body: ["Joao", "R$ 50,00"] }
      }
    ]),
    2
  );

  assert.deepEqual(recipients[0]?.resolved.body, ["Joao", "R$ 50,00"]);
});

test("preserva valores distintos entre clientes", () => {
  const recipients = parseCampaignRecipientTemplateVariables(
    JSON.stringify([
      {
        contactId: "contact-a",
        rowNumber: 2,
        resolved: { version: 1, body: ["Joao", "R$ 50,00"] }
      },
      {
        contactId: "contact-b",
        rowNumber: 3,
        resolved: { version: 1, body: ["Maria", "R$ 237,45"] }
      }
    ]),
    2
  );

  assert.equal(recipients[0]?.resolved.body[1], "R$ 50,00");
  assert.equal(recipients[1]?.resolved.body[1], "R$ 237,45");
});

test("vinculo usa contactId e rowNumber sem depender da ordem de retorno", () => {
  const recipients = parseCampaignRecipientTemplateVariables(
    JSON.stringify([
      {
        contactId: "contact-b",
        rowNumber: 3,
        resolved: { version: 1, body: ["Maria"] }
      },
      {
        contactId: "contact-a",
        rowNumber: 2,
        resolved: { version: 1, body: ["Joao"] }
      }
    ]),
    1
  );
  const validated = validateCampaignRecipientTemplateVariables({
    recipients,
    allowedContactIds: ["contact-a", "contact-b"],
    expectedBodyLength: 1
  });

  assert.equal(validated.byContactId.get("contact-a")?.rowNumber, 2);
  assert.deepEqual(validated.byContactId.get("contact-b")?.resolved.body, ["Maria"]);
});

test("linha invalida ausente do payload nao cria destinatario resolvido", () => {
  const recipients = parseCampaignRecipientTemplateVariables(
    JSON.stringify([
      {
        contactId: "contact-a",
        rowNumber: 2,
        resolved: { version: 1, body: ["Joao"] }
      }
    ]),
    1
  );
  const validated = validateCampaignRecipientTemplateVariables({
    recipients,
    allowedContactIds: ["contact-a", "contact-b"],
    expectedBodyLength: 1
  });

  assert.equal(validated.byContactId.has("contact-b"), false);
});

test("contato fora da campanha e rejeitado", () => {
  assert.throws(
    () =>
      validateCampaignRecipientTemplateVariables({
        recipients: [
          {
            contactId: "contact-x",
            rowNumber: 2,
            resolved: { version: 1, body: ["Joao"] }
          }
        ],
        allowedContactIds: ["contact-a"],
        expectedBodyLength: 1
      }),
    TemplateParameterError
  );
});

test("contato duplicado e rejeitado", () => {
  assert.throws(
    () =>
      validateCampaignRecipientTemplateVariables({
        recipients: [
          {
            contactId: "contact-a",
            rowNumber: 2,
            resolved: { version: 1, body: ["Joao"] }
          },
          {
            contactId: "contact-a",
            rowNumber: 3,
            resolved: { version: 1, body: ["Maria"] }
          }
        ],
        allowedContactIds: ["contact-a"],
        expectedBodyLength: 1
      }),
    TemplateParameterError
  );
});

test("linha duplicada e rejeitada", () => {
  assert.throws(
    () =>
      validateCampaignRecipientTemplateVariables({
        recipients: [
          {
            contactId: "contact-a",
            rowNumber: 2,
            resolved: { version: 1, body: ["Joao"] }
          },
          {
            contactId: "contact-b",
            rowNumber: 2,
            resolved: { version: 1, body: ["Maria"] }
          }
        ],
        allowedContactIds: ["contact-a", "contact-b"],
        expectedBodyLength: 1
      }),
    TemplateParameterError
  );
});

test("JSON invalido falha com erro tipado", () => {
  assert.throws(
    () => parseCampaignRecipientTemplateVariables("{", 1),
    TemplateParameterError
  );
});

test("quantidade incorreta de parametros e rejeitada", () => {
  assert.throws(
    () =>
      parseCampaignRecipientTemplateVariables(
        JSON.stringify([
          {
            contactId: "contact-a",
            rowNumber: 2,
            resolved: { version: 1, body: ["Joao"] }
          }
        ]),
        2
      ),
    TemplateParameterError
  );
});
