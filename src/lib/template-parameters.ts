import type {
  SpreadsheetImportColumn,
  SpreadsheetImportRawValues
} from "./spreadsheet-import-columns";

export type TemplateVariableMapping = Record<string, string>;

export type TemplateVariableMappingV1 = {
  version: 1;
  mode: "COLUMN_MAPPING";
  body: TemplateVariableMapping;
  columns: SpreadsheetImportColumn[];
};

export type ResolvedTemplateVariablesV1 = {
  version: 1;
  body: string[];
};

export type ResolveTemplateColumnParametersInput = {
  templateBody: string;
  mapping: TemplateVariableMapping;
  columns: SpreadsheetImportColumn[];
  rawValues: SpreadsheetImportRawValues;
};

export type ResolvedTemplateColumnParameters = {
  variables: string[];
  renderedBody: string;
};

export type TemplateParameterErrorCode =
  | "TEMPLATE_VARIABLE_SEQUENCE_INVALID"
  | "TEMPLATE_VARIABLE_MAPPING_INCOMPLETE"
  | "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND"
  | "TEMPLATE_VARIABLE_VALUE_EMPTY"
  | "TEMPLATE_VARIABLE_JSON_INVALID"
  | "TEMPLATE_VARIABLE_VERSION_UNSUPPORTED"
  | "TEMPLATE_VARIABLE_MODE_INVALID"
  | "TEMPLATE_VARIABLE_BODY_INVALID"
  | "TEMPLATE_VARIABLE_COLUMNS_INVALID"
  | "TEMPLATE_VARIABLE_COUNT_INVALID";

export class TemplateParameterError extends Error {
  code: TemplateParameterErrorCode;
  variableIndex?: number;
  columnKey?: string;

  constructor({
    code,
    message,
    variableIndex,
    columnKey
  }: {
    code: TemplateParameterErrorCode;
    message: string;
    variableIndex?: number;
    columnKey?: string;
  }) {
    super(message);
    this.name = "TemplateParameterError";
    this.code = code;
    this.variableIndex = variableIndex;
    this.columnKey = columnKey;
  }
}

function readTemplatePlaceholderTokens(templateBody: string) {
  return String(templateBody ?? "").match(/\{\{\s*[^{}]+\s*\}\}/g) ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonField(value: string, context: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_JSON_INVALID",
      message: `${context} possui JSON invalido.`
    });
  }
}

function assertVersion(value: unknown, context: string) {
  if (value !== 1) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_VERSION_UNSUPPORTED",
      message: `${context} possui versao nao suportada.`
    });
  }
}

function validateBodyMapping(body: unknown) {
  if (!isRecord(body)) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: "Mapeamento do BODY invalido."
    });
  }

  const mapping: TemplateVariableMapping = {};
  for (const [key, value] of Object.entries(body)) {
    if (!/^\d+$/.test(key) || typeof value !== "string" || !value.trim()) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_BODY_INVALID",
        message: "Mapeamento do BODY invalido."
      });
    }

    mapping[key] = value.trim();
  }

  const indexes = Object.keys(mapping)
    .map((key) => Number(key))
    .sort((left, right) => left - right);

  for (let index = 0; index < indexes.length; index += 1) {
    if (indexes[index] !== index + 1) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_SEQUENCE_INVALID",
        message: "Mapeamento do BODY nao pode ter lacunas."
      });
    }
  }

  return mapping;
}

function validateSerializedColumns(columns: unknown) {
  if (!Array.isArray(columns)) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_COLUMNS_INVALID",
      message: "Colunas do mapeamento invalidas."
    });
  }

  return columns.map((column) => {
    const index = column.index;

    if (
      !isRecord(column) ||
      typeof column.key !== "string" ||
      typeof column.label !== "string" ||
      typeof column.normalized !== "string" ||
      typeof index !== "number" ||
      !Number.isInteger(index)
    ) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_COLUMNS_INVALID",
        message: "Colunas do mapeamento invalidas."
      });
    }

    return {
      key: column.key.trim(),
      label: column.label,
      normalized: column.normalized,
      index
    };
  });
}

function assertMappedColumnsExist(mapping: TemplateVariableMapping, columns: SpreadsheetImportColumn[]) {
  const columnKeys = new Set(columns.map((column) => column.key));

  for (const [key, columnKey] of Object.entries(mapping)) {
    if (!columnKeys.has(columnKey)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND",
        message: `Coluna mapeada para {{${key}}} nao foi encontrada.`,
        variableIndex: Number(key),
        columnKey
      });
    }
  }
}

export function extractTemplateBodyVariableIndexes(templateBody: string) {
  const tokens = readTemplatePlaceholderTokens(templateBody);
  const indexes = new Set<number>();

  for (const token of tokens) {
    const content = token.replace(/[{}]/g, "").trim();
    if (!/^\d+$/.test(content)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_SEQUENCE_INVALID",
        message: "As variaveis do template devem usar o formato {{1}}, {{2}}, ..."
      });
    }

    const value = Number(content);
    if (!Number.isInteger(value) || value <= 0) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_SEQUENCE_INVALID",
        message: "As variaveis do template devem comecar em {{1}}."
      });
    }
    indexes.add(value);
  }

  const sorted = Array.from(indexes).sort((left, right) => left - right);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index + 1) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_SEQUENCE_INVALID",
        message: "As variaveis do template nao podem ter lacunas."
      });
    }
  }

  return sorted;
}

export function validateTemplateVariableMapping({
  templateBody,
  mapping,
  columns
}: Pick<
  ResolveTemplateColumnParametersInput,
  "templateBody" | "mapping" | "columns"
>) {
  const requiredIndexes = extractTemplateBodyVariableIndexes(templateBody);
  const columnKeys = new Set(columns.map((column) => column.key));

  for (const variableIndex of requiredIndexes) {
    const columnKey = mapping[String(variableIndex)]?.trim();

    if (!columnKey) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_MAPPING_INCOMPLETE",
        message: `Mapeamento ausente para {{${variableIndex}}}.`,
        variableIndex
      });
    }

    if (!columnKeys.has(columnKey)) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_COLUMN_NOT_FOUND",
        message: `Coluna mapeada para {{${variableIndex}}} nao foi encontrada.`,
        variableIndex,
        columnKey
      });
    }
  }

  return requiredIndexes;
}

export function renderTemplateBodyWithVariables(
  templateBody: string,
  variables: string[]
) {
  return String(templateBody ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index) => {
    return variables[Number(index) - 1] ?? "";
  });
}

export function resolveTemplateColumnParameters({
  templateBody,
  mapping,
  columns,
  rawValues
}: ResolveTemplateColumnParametersInput): ResolvedTemplateColumnParameters {
  const requiredIndexes = validateTemplateVariableMapping({
    templateBody,
    mapping,
    columns
  });

  if (requiredIndexes.length === 0) {
    return {
      variables: [],
      renderedBody: templateBody
    };
  }

  const variables = requiredIndexes.map((variableIndex) => {
    const columnKey = mapping[String(variableIndex)].trim();
    const value = String(rawValues[columnKey] ?? "").trim();

    if (!value) {
      throw new TemplateParameterError({
        code: "TEMPLATE_VARIABLE_VALUE_EMPTY",
        message: `Valor vazio para {{${variableIndex}}}.`,
        variableIndex,
        columnKey
      });
    }

    return value;
  });

  return {
    variables,
    renderedBody: renderTemplateBodyWithVariables(templateBody, variables)
  };
}

export function serializeTemplateVariableMappingV1(
  mapping: TemplateVariableMappingV1
) {
  const body = validateBodyMapping(mapping.body);
  const columns = validateSerializedColumns(mapping.columns);

  if (mapping.version !== 1) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_VERSION_UNSUPPORTED",
      message: "Mapeamento possui versao nao suportada."
    });
  }

  if (mapping.mode !== "COLUMN_MAPPING") {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_MODE_INVALID",
      message: "Modo de mapeamento invalido."
    });
  }

  assertMappedColumnsExist(body, columns);

  return JSON.stringify({
    version: 1,
    mode: "COLUMN_MAPPING",
    body,
    columns: columns.filter((column) =>
      Object.values(body).includes(column.key)
    )
  } satisfies TemplateVariableMappingV1);
}

export function deserializeTemplateVariableMappingV1(
  value?: string | null
): TemplateVariableMappingV1 | null {
  if (!value) return null;

  const parsed = parseJsonField(value, "Mapeamento de variaveis");
  if (!isRecord(parsed)) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_JSON_INVALID",
      message: "Mapeamento de variaveis invalido."
    });
  }

  assertVersion(parsed.version, "Mapeamento de variaveis");

  if (parsed.mode !== "COLUMN_MAPPING") {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_MODE_INVALID",
      message: "Modo de mapeamento invalido."
    });
  }

  const body = validateBodyMapping(parsed.body);
  const columns = validateSerializedColumns(parsed.columns);
  assertMappedColumnsExist(body, columns);

  return {
    version: 1,
    mode: "COLUMN_MAPPING",
    body,
    columns
  };
}

export function serializeResolvedTemplateVariablesV1(
  variables: ResolvedTemplateVariablesV1
) {
  if (variables.version !== 1) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_VERSION_UNSUPPORTED",
      message: "Variaveis resolvidas possuem versao nao suportada."
    });
  }

  if (
    !Array.isArray(variables.body) ||
    variables.body.some((value) => typeof value !== "string")
  ) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: "Variaveis resolvidas invalidas."
    });
  }

  return JSON.stringify({
    version: 1,
    body: variables.body
  } satisfies ResolvedTemplateVariablesV1);
}

export function deserializeResolvedTemplateVariablesV1(
  value?: string | null,
  expectedBodyLength?: number
): ResolvedTemplateVariablesV1 | null {
  if (!value) return null;

  const parsed = parseJsonField(value, "Variaveis resolvidas");
  if (!isRecord(parsed)) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_JSON_INVALID",
      message: "Variaveis resolvidas invalidas."
    });
  }

  assertVersion(parsed.version, "Variaveis resolvidas");

  if (
    !Array.isArray(parsed.body) ||
    parsed.body.some((item) => typeof item !== "string")
  ) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_BODY_INVALID",
      message: "Variaveis resolvidas invalidas."
    });
  }

  if (
    expectedBodyLength !== undefined &&
    parsed.body.length !== expectedBodyLength
  ) {
    throw new TemplateParameterError({
      code: "TEMPLATE_VARIABLE_COUNT_INVALID",
      message: "Quantidade de variaveis resolvidas invalida."
    });
  }

  return {
    version: 1,
    body: parsed.body
  };
}
