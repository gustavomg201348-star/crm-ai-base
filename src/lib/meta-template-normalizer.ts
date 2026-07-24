export type MetaTemplateComponentType =
  | "HEADER"
  | "BODY"
  | "FOOTER"
  | "BUTTONS"
  | (string & {});

export type MetaTemplateHeaderFormat =
  | "TEXT"
  | "IMAGE"
  | "VIDEO"
  | "DOCUMENT"
  | "LOCATION"
  | (string & {});

export type MetaTemplateButtonType =
  | "QUICK_REPLY"
  | "URL"
  | "PHONE_NUMBER"
  | "COPY_CODE"
  | "FLOW"
  | "OTP"
  | (string & {});

export type MetaTemplateExample = {
  header_handle?: string[];
  header_text?: string[];
  body_text?: string[][];
  [key: string]: unknown;
};

export type MetaTemplateButton = {
  type?: MetaTemplateButtonType;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: string[];
  [key: string]: unknown;
};

export type MetaTemplateComponent = {
  type?: MetaTemplateComponentType;
  format?: MetaTemplateHeaderFormat;
  text?: string;
  example?: MetaTemplateExample;
  buttons?: MetaTemplateButton[];
  [key: string]: unknown;
};

export type MetaTemplate = {
  id?: string;
  name: string;
  status: string;
  category?: string;
  language: string;
  components?: MetaTemplateComponent[];
  [key: string]: unknown;
};

export type NormalizedMetaTemplateButton = {
  type: string;
  text: string;
  url: string | null;
  phoneNumber: string | null;
  variables: number[];
  exampleValues: string[];
  isDynamicUrl: boolean;
};

export type NormalizedMetaTemplate = {
  metaId: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  rawComponents: MetaTemplateComponent[];
  header: {
    present: boolean;
    format: string | null;
    text: string;
    variables: number[];
    exampleText: string[];
    exampleHandles: string[];
    requiresMedia: boolean;
  };
  body: {
    text: string;
    variables: number[];
    exampleValues: string[][];
  };
  footer: {
    text: string;
  };
  buttons: NormalizedMetaTemplateButton[];
  totalVariables: number;
  bodyVariableCount: number;
  headerVariableCount: number;
  requiresHeaderMedia: boolean;
  headerMediaType: "image" | "video" | "document" | "location" | null;
  compatibility: {
    canSendWithCurrentBuilder: boolean;
    requiresHeaderMediaConfiguration: boolean;
    hasUnsupportedDynamicHeader: boolean;
    hasUnsupportedDynamicButtons: boolean;
    unsupportedReasons: string[];
  };
  unknownComponents: string[];
  unknownButtonTypes: string[];
};

const KNOWN_COMPONENT_TYPES = new Set(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
const KNOWN_BUTTON_TYPES = new Set([
  "QUICK_REPLY",
  "URL",
  "PHONE_NUMBER",
  "COPY_CODE",
  "FLOW",
  "OTP"
]);

function normalizeUpper(value?: string | null) {
  return value?.trim().toUpperCase() ?? "";
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readStringMatrix(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter(Array.isArray)
        .map((row) => row.filter((item): item is string => typeof item === "string"))
    : [];
}

export function extractMetaTemplateVariables(text?: string | null) {
  const matches = text?.match(/\{\{\d+\}\}/g) ?? [];
  return uniqueSorted(
    matches
      .map((match) => Number(match.replace(/[{}]/g, "")))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
}

export function normalizeMetaTemplate(template: MetaTemplate): NormalizedMetaTemplate {
  const rawComponents = Array.isArray(template.components) ? template.components : [];
  const header =
    rawComponents.find((component) => normalizeUpper(component.type) === "HEADER") ?? null;
  const body =
    rawComponents.find((component) => normalizeUpper(component.type) === "BODY") ?? null;
  const footer =
    rawComponents.find((component) => normalizeUpper(component.type) === "FOOTER") ?? null;
  const buttonsComponent =
    rawComponents.find((component) => normalizeUpper(component.type) === "BUTTONS") ?? null;

  const headerFormat = header ? normalizeUpper(header.format) || null : null;
  const headerText = header?.text ?? "";
  const bodyText = body?.text ?? "";
  const headerVariables = extractMetaTemplateVariables(headerText);
  const bodyVariables = extractMetaTemplateVariables(bodyText);
  const requiresHeaderMedia = ["IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(
    headerFormat ?? ""
  );
  const headerMediaType =
    headerFormat === "IMAGE"
      ? "image"
      : headerFormat === "VIDEO"
        ? "video"
        : headerFormat === "DOCUMENT"
          ? "document"
          : headerFormat === "LOCATION"
            ? "location"
            : null;

  const buttons = (buttonsComponent?.buttons ?? []).map((button) => {
    const type = normalizeUpper(button.type) || "UNKNOWN";
    const url = button.url ?? null;
    const variables = extractMetaTemplateVariables(url);

    return {
      type,
      text: button.text ?? "",
      url,
      phoneNumber: button.phone_number ?? null,
      variables,
      exampleValues: readStringArray(button.example),
      isDynamicUrl: type === "URL" && variables.length > 0
    };
  });

  const unknownComponents = rawComponents
    .map((component) => normalizeUpper(component.type) || "UNKNOWN")
    .filter((type) => !KNOWN_COMPONENT_TYPES.has(type));
  const unknownButtonTypes = buttons
    .map((button) => button.type)
    .filter((type) => !KNOWN_BUTTON_TYPES.has(type));
  const unsupportedReasons: string[] = [];

  if (headerVariables.length > 0) {
    unsupportedReasons.push("HEADER_TEXT_VARIABLES_UNSUPPORTED");
  }
  if (headerFormat === "VIDEO") {
    unsupportedReasons.push("HEADER_VIDEO_UNSUPPORTED");
  }
  if (headerFormat === "DOCUMENT") {
    unsupportedReasons.push("HEADER_DOCUMENT_UNSUPPORTED");
  }
  if (headerFormat === "LOCATION") {
    unsupportedReasons.push("HEADER_LOCATION_UNSUPPORTED");
  }
  if (headerFormat && !["TEXT", "IMAGE", "VIDEO", "DOCUMENT", "LOCATION"].includes(headerFormat)) {
    unsupportedReasons.push("HEADER_FORMAT_UNKNOWN");
  }
  if (buttons.some((button) => button.isDynamicUrl)) {
    unsupportedReasons.push("DYNAMIC_URL_BUTTON_UNSUPPORTED");
  }
  if (unknownComponents.length > 0) {
    unsupportedReasons.push("UNKNOWN_COMPONENT_TYPE");
  }
  if (unknownButtonTypes.length > 0) {
    unsupportedReasons.push("UNKNOWN_BUTTON_TYPE");
  }

  const uniqueUnsupportedReasons = Array.from(new Set(unsupportedReasons));
  const requiresHeaderMediaConfiguration = headerFormat === "IMAGE";

  return {
    metaId: template.id ?? null,
    name: template.name,
    language: template.language,
    category: template.category ?? "UTILITY",
    status: template.status,
    rawComponents,
    header: {
      present: Boolean(header),
      format: headerFormat,
      text: headerText,
      variables: headerVariables,
      exampleText: readStringArray(header?.example?.header_text),
      exampleHandles: readStringArray(header?.example?.header_handle),
      requiresMedia: requiresHeaderMedia
    },
    body: {
      text: bodyText,
      variables: bodyVariables,
      exampleValues: readStringMatrix(body?.example?.body_text)
    },
    footer: {
      text: footer?.text ?? ""
    },
    buttons,
    totalVariables: uniqueSorted([...headerVariables, ...bodyVariables]).length,
    bodyVariableCount: bodyVariables.length,
    headerVariableCount: headerVariables.length,
    requiresHeaderMedia,
    headerMediaType,
    compatibility: {
      canSendWithCurrentBuilder:
        uniqueUnsupportedReasons.length === 0 && !requiresHeaderMediaConfiguration,
      requiresHeaderMediaConfiguration,
      hasUnsupportedDynamicHeader: headerVariables.length > 0,
      hasUnsupportedDynamicButtons: buttons.some((button) => button.isDynamicUrl),
      unsupportedReasons: uniqueUnsupportedReasons
    },
    unknownComponents,
    unknownButtonTypes
  };
}
