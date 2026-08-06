import {
  deserializeResolvedTemplateVariablesV1,
  serializeResolvedTemplateVariablesV1,
  TemplateParameterError,
  type ResolvedTemplateVariablesV1
} from "./template-parameters";

export type CampaignRecipientTemplateVariablesInput = {
  contactId: string;
  rowNumber: number;
  resolved: ResolvedTemplateVariablesV1;
};

export type CampaignRecipientTemplateVariablesValidation = {
  recipients: CampaignRecipientTemplateVariablesInput[];
  byContactId: Map<string, CampaignRecipientTemplateVariablesInput>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: `${field} invalido.`
    });
  }

  return value.trim();
}

function assertPositiveRowNumber(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: "rowNumber invalido."
    });
  }

  return value;
}

export function parseCampaignRecipientTemplateVariables(
  value?: string | null,
  expectedBodyLength?: number
): CampaignRecipientTemplateVariablesInput[] {
  if (!value) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_JSON_INVALID",
      message: "Variaveis por destinatario possuem JSON invalido."
    });
  }

  if (!Array.isArray(parsed)) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: "Variaveis por destinatario devem ser uma lista."
    });
  }

  return parsed.map((item) => {
    if (!isRecord(item)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Destinatario de template invalido."
      });
    }

    const contactId = assertNonEmptyString(item.contactId, "contactId");
    const rowNumber = assertPositiveRowNumber(item.rowNumber);
    const resolved = deserializeResolvedTemplateVariablesV1(
      JSON.stringify(item.resolved ?? null),
      expectedBodyLength
    );

    if (!resolved) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Variaveis resolvidas ausentes."
      });
    }

    return {
      contactId,
      rowNumber,
      resolved
    };
  });
}

export function validateCampaignRecipientTemplateVariables({
  recipients,
  allowedContactIds,
  expectedBodyLength
}: {
  recipients: CampaignRecipientTemplateVariablesInput[];
  allowedContactIds: string[];
  expectedBodyLength: number;
}): CampaignRecipientTemplateVariablesValidation {
  const allowed = new Set(allowedContactIds);
  const seenContacts = new Set<string>();
  const seenRows = new Set<number>();
  const byContactId = new Map<string, CampaignRecipientTemplateVariablesInput>();

  for (const recipient of recipients) {
    if (!allowed.has(recipient.contactId)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Contato das variaveis nao pertence a campanha."
      });
    }

    if (seenContacts.has(recipient.contactId)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Contato duplicado nas variaveis por destinatario."
      });
    }

    if (seenRows.has(recipient.rowNumber)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Linha duplicada nas variaveis por destinatario."
      });
    }

    if (recipient.resolved.body.length !== expectedBodyLength) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_COUNT_INVALID",
        message: "Quantidade de variaveis do destinatario invalida."
      });
    }

    seenContacts.add(recipient.contactId);
    seenRows.add(recipient.rowNumber);
    byContactId.set(recipient.contactId, recipient);
  }

  return {
    recipients,
    byContactId
  };
}

export function serializeCampaignRecipientResolvedVariables(
  resolved: ResolvedTemplateVariablesV1
) {
  return serializeResolvedTemplateVariablesV1(resolved);
}
