import { type MetaTemplateCategory } from "@/lib/meta-template-client";
import { createValidationError } from "@/lib/meta-template-creation-errors";
import {
  type CreateMetaTemplateHeaderInput,
  type CreateMetaTemplateInput,
  type CreateImageHeaderTemplateInput,
  type CreateTemplateHeaderMediaInput,
  type MetaTemplateButtonInput,
  type NormalizedMetaTemplateButton,
  type ValidatedCreateMetaTemplateInput,
  type ValidatedMetaTemplateHeaderInput,
  type ValidatedImageHeaderTemplateInput
} from "@/lib/meta-template-creation-types";

const TEMPLATE_NAME_MAX_LENGTH = 512;
const TEMPLATE_BODY_MAX_LENGTH = 1024;
const TEMPLATE_FOOTER_MAX_LENGTH = 60;
const TEMPLATE_HEADER_TEXT_MAX_LENGTH = 60;
const TEMPLATE_BUTTON_TEXT_MAX_LENGTH = 25;
const TEMPLATE_URL_MAX_LENGTH = 2000;
const TEMPLATE_PHONE_MAX_LENGTH = 20;
const ALLOWED_CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);
const ALLOWED_HEADER_TYPES = new Set(["NONE", "TEXT", "IMAGE", "DOCUMENT", "VIDEO"]);
const HEADER_MEDIA_MIME_TYPES_BY_TYPE = {
  IMAGE: new Set(["image/jpeg", "image/png"]),
  DOCUMENT: new Set(["application/pdf"]),
  VIDEO: new Set(["video/mp4"])
} satisfies Record<"IMAGE" | "DOCUMENT" | "VIDEO", Set<string>>;

function requiredString(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw createValidationError({
      code: fieldName === "bodyText" ? "EMPTY_BODY" : "INVALID_TEMPLATE_NAME",
      message: `${fieldName} obrigatorio.`
    });
  }

  return normalized;
}

function validateTemplateName(name: string) {
  const normalized = requiredString(name, "name");

  if (
    normalized.length > TEMPLATE_NAME_MAX_LENGTH ||
    !/^[a-z0-9_]+$/.test(normalized)
  ) {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "Nome do template deve usar apenas letras minusculas, numeros e underline."
    });
  }

  return normalized;
}

function validateLanguage(language: string) {
  const normalized = language.trim();

  if (!normalized || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(normalized)) {
    throw createValidationError({
      code: "INVALID_LANGUAGE",
      message: "Idioma do template invalido."
    });
  }

  return normalized;
}

function validateCategory(category: string): MetaTemplateCategory {
  const normalized = category.trim().toUpperCase();

  if (!ALLOWED_CATEGORIES.has(normalized)) {
    throw createValidationError({
      code: "INVALID_CATEGORY",
      message: "Categoria do template invalida."
    });
  }

  return normalized as MetaTemplateCategory;
}

function readBodyPlaceholderNumbers(bodyText: string) {
  const tokens = bodyText.match(/\{\{\s*[^{}]+\s*\}\}/g) ?? [];
  const numbers: number[] = [];
  const seen = new Set<number>();

  for (const token of tokens) {
    const content = token.replace(/[{}]/g, "").trim();

    if (!/^\d+$/.test(content)) {
      throw createValidationError({
        code: "INVALID_PLACEHOLDERS",
        message: "Placeholders do BODY devem usar o formato {{1}}, {{2}}, ..."
      });
    }

    const number = Number(content);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) {
      throw createValidationError({
        code: "INVALID_PLACEHOLDERS",
        message: "Placeholders do BODY devem ser positivos e sem duplicidade."
      });
    }

    seen.add(number);
    numbers.push(number);
  }

  const sorted = [...numbers].sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index + 1) {
      throw createValidationError({
        code: "INVALID_PLACEHOLDERS",
        message: "Placeholders do BODY devem comecar em {{1}} e nao podem ter lacunas."
      });
    }
  }

  return sorted;
}

function validateBodyText(bodyText: string) {
  const normalized = requiredString(bodyText, "bodyText");

  if (normalized.length > TEMPLATE_BODY_MAX_LENGTH) {
    throw createValidationError({
      code: "EMPTY_BODY",
      message: "BODY do template excede o limite permitido."
    });
  }

  return {
    text: normalized,
    placeholderNumbers: readBodyPlaceholderNumbers(normalized)
  };
}

function validateBodyExamples(
  bodyExamples: string[][] | undefined,
  expectedVariables: number
) {
  if (expectedVariables === 0) {
    return undefined;
  }

  if (!Array.isArray(bodyExamples) || bodyExamples.length === 0) {
    throw createValidationError({
      code: "INVALID_BODY_EXAMPLES",
      message: "Exemplos do BODY sao obrigatorios quando ha placeholders."
    });
  }

  const normalizedExamples = bodyExamples.map((row) => {
    if (!Array.isArray(row) || row.length !== expectedVariables) {
      throw createValidationError({
        code: "INVALID_BODY_EXAMPLES",
        message: "Cada linha de exemplo deve corresponder a quantidade de placeholders."
      });
    }

    return row.map((item) => String(item).trim());
  });

  if (normalizedExamples.some((row) => row.some((item) => !item))) {
    throw createValidationError({
      code: "INVALID_BODY_EXAMPLES",
      message: "Exemplos do BODY nao podem conter valores vazios."
    });
  }

  return normalizedExamples;
}

function validateFooterText(footerText?: string) {
  const normalized = footerText?.trim();
  if (!normalized) return null;

  if (normalized.length > TEMPLATE_FOOTER_MAX_LENGTH) {
    throw createValidationError({
      code: "INVALID_FOOTER",
      message: "Rodape do template excede o limite permitido."
    });
  }

  return normalized;
}

function validateButtonText(text: string) {
  const normalized = text.trim();

  if (!normalized || normalized.length > TEMPLATE_BUTTON_TEXT_MAX_LENGTH) {
    throw createValidationError({
      code: "INVALID_BUTTONS",
      message: "Texto do botao invalido."
    });
  }

  return normalized;
}

function validateButtons(
  buttons?: MetaTemplateButtonInput[]
): NormalizedMetaTemplateButton[] {
  if (!buttons?.length) return [];

  if (buttons.length > 3) {
    throw createValidationError({
      code: "INVALID_BUTTONS",
      message: "Quantidade de botoes invalida para o template."
    });
  }

  return buttons.map((button) => {
    const text = validateButtonText(button.text);

    if (button.type === "QUICK_REPLY") {
      return { type: "QUICK_REPLY", text };
    }

    if (button.type === "URL") {
      const url = button.url.trim();

      if (
        url.length > TEMPLATE_URL_MAX_LENGTH ||
        !/^https?:\/\/[^\s]+$/i.test(url)
      ) {
        throw createValidationError({
          code: "INVALID_BUTTONS",
          message: "URL do botao invalida."
        });
      }

      return { type: "URL", text, url };
    }

    if (button.type === "PHONE_NUMBER") {
      const phoneNumber = button.phone_number.trim();

      if (
        phoneNumber.length > TEMPLATE_PHONE_MAX_LENGTH ||
        !/^\+?[0-9]{6,20}$/.test(phoneNumber)
      ) {
        throw createValidationError({
          code: "INVALID_BUTTONS",
          message: "Telefone do botao invalido."
        });
      }

      return { type: "PHONE_NUMBER", text, phone_number: phoneNumber };
    }

    throw createValidationError({
      code: "INVALID_BUTTONS",
      message: "Tipo de botao nao suportado."
    });
  });
}

function normalizeHeaderType(type: string) {
  const normalized = type.trim().toUpperCase();

  if (!ALLOWED_HEADER_TYPES.has(normalized)) {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "Tipo de HEADER invalido."
    });
  }

  return normalized as CreateMetaTemplateHeaderInput["type"];
}

function normalizeMediaMimeType(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function validateHeaderMedia(
  type: "IMAGE" | "DOCUMENT" | "VIDEO",
  media: CreateTemplateHeaderMediaInput
) {
  const fileName = media.fileName.trim();
  const mimeType = normalizeMediaMimeType(media.mimeType);

  if (!fileName) {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "Nome do arquivo do HEADER obrigatorio."
    });
  }

  if (!HEADER_MEDIA_MIME_TYPES_BY_TYPE[type].has(mimeType)) {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "MIME do arquivo do HEADER invalido."
    });
  }

  if (!(media.bytes instanceof Uint8Array) || media.bytes.byteLength === 0) {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "Arquivo do HEADER obrigatorio."
    });
  }

  return {
    fileName,
    mimeType,
    bytes: media.bytes
  };
}

function validateHeader(header: CreateMetaTemplateHeaderInput): ValidatedMetaTemplateHeaderInput {
  const type = normalizeHeaderType(header.type);

  if (type === "NONE") {
    return { type };
  }

  if (type === "TEXT") {
    if (header.type !== "TEXT") {
      throw createValidationError({
        code: "INVALID_TEMPLATE_NAME",
        message: "Texto do HEADER obrigatorio."
      });
    }

    const text = requiredString(header.text, "headerText");
    if (text.length > TEMPLATE_HEADER_TEXT_MAX_LENGTH) {
      throw createValidationError({
        code: "INVALID_TEMPLATE_NAME",
        message: "Texto do HEADER excede o limite permitido."
      });
    }

    return { type, text };
  }

  if (header.type !== "IMAGE" && header.type !== "DOCUMENT" && header.type !== "VIDEO") {
    throw createValidationError({
      code: "INVALID_TEMPLATE_NAME",
      message: "Arquivo do HEADER obrigatorio."
    });
  }

  return {
    type,
    media: validateHeaderMedia(type, header.media)
  };
}

export function validateCreateMetaTemplateInput(
  input: CreateMetaTemplateInput
): ValidatedCreateMetaTemplateInput {
  const body = validateBodyText(input.bodyText);
  const examples = validateBodyExamples(
    input.bodyExamples,
    body.placeholderNumbers.length
  );

  return {
    companyId: requiredString(input.companyId, "companyId"),
    channelId: requiredString(input.channelId, "channelId"),
    appId: requiredString(input.appId, "appId"),
    accessToken: requiredString(input.accessToken, "accessToken"),
    wabaId: requiredString(input.wabaId, "wabaId"),
    name: validateTemplateName(input.name),
    language: validateLanguage(input.language),
    category: validateCategory(input.category),
    bodyText: body.text,
    bodyExamples: examples,
    footerText: validateFooterText(input.footerText),
    buttons: validateButtons(input.buttons),
    header: validateHeader(input.header)
  };
}

export function validateImageHeaderTemplateInput(
  input: CreateImageHeaderTemplateInput
): ValidatedImageHeaderTemplateInput {
  const validated = validateCreateMetaTemplateInput({
    ...input,
    header: {
      type: "IMAGE",
      media: input.image
    }
  });

  return {
    companyId: validated.companyId,
    channelId: validated.channelId,
    appId: validated.appId,
    accessToken: validated.accessToken,
    wabaId: validated.wabaId,
    name: validated.name,
    language: validated.language,
    category: validated.category,
    bodyText: validated.bodyText,
    bodyExamples: validated.bodyExamples,
    footerText: validated.footerText,
    buttons: validated.buttons
  };
}
