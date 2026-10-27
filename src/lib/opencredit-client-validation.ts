// Browser-safe LOCAL contract based on the provider example, not formal required/nullability.
export const validationPendingLabels = {
  cpf: "CPF", nome: "Nome", nome_mae: "Nome da mãe", data_nascimento: "Data de nascimento",
  celular: "Celular", email: "E-mail", genero: "Gênero", estado_civil: "Estado civil",
  rg: "Documento de identidade", orgao_emissor: "Órgão emissor", uf_emissor: "UF emissora", data_expedicao: "Data de expedição",
  endereco_cep: "CEP", endereco_rua: "Logradouro", endereco_numero: "Número do endereço",
  endereco_complemento: "Complemento", endereco_bairro: "Bairro", endereco_cidade: "Cidade", endereco_uf: "UF do endereço",
  bank_account: "Conta bancária ou chave Pix", empregador_email: "E-mail do empregador", empregador_telefone: "Telefone do empregador",
  OTHER: "Pendência não reconhecida: revisão manual necessária",
} as const;
export type ValidationPending = { field: keyof typeof validationPendingLabels; scope?: "client" | "bank" };
export type ClientValidation = { found?: boolean; valid?: boolean; pending?: ValidationPending[] };
export const validationCategories = ["VALID", "PENDING", "NOT_FOUND", "INCOMPLETE", "INVALID_RESPONSE", "AUTHENTICATION",
  "PROVIDER_UNAVAILABLE", "PROVIDER_FAILED", "TIMEOUT", "NETWORK", "CONFIGURATION"] as const;
export type ValidationDiagnostic = {
  httpStatus: number | null; requestId: string | null; correlationId: string | null;
  responseReadable: boolean; responseParsed: boolean; found: boolean | null; valid: boolean | null;
  pendingPresent: boolean | null; category: typeof validationCategories[number];
};
export type ClientValidationResponse = { ok: true; validation: ClientValidation; diagnostic: ValidationDiagnostic }
  | { ok: false; error: "OPENCREDIT_CLIENT_VALIDATION_FAILED"; diagnostic: ValidationDiagnostic };
export function clientValidationCategory(v: ClientValidation): ValidationDiagnostic["category"] {
  return v.found === false ? "NOT_FOUND" : v.pending?.length || v.valid === false ? "PENDING"
    : v.found === true && v.valid === true && Object.hasOwn(v, "pending") ? "VALID" : "INCOMPLETE";
}
export function validationObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error("INVALID_RESPONSE");
  const r: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !("value" in d)) throw Error("INVALID_RESPONSE");
    r[key] = d.value;
  }
  return r;
}
export function parseProviderClientValidation(raw: unknown): ClientValidation {
  const data = validationObject(validationObject(raw).data), result: ClientValidation = {};
  for (const key of ["found", "valid"] as const) if (Object.hasOwn(data, key)) {
    if (typeof data[key] !== "boolean") throw Error("INVALID_RESPONSE");
    result[key] = data[key];
  }
  if (Object.hasOwn(data, "pending")) {
    if (!Array.isArray(data.pending) || data.pending.length > 50) throw Error("INVALID_RESPONSE");
    result.pending = data.pending.map(value => {
      const item = validationObject(value);
      if (typeof item.field !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}(?![\s\S])/.test(item.field)) throw Error("INVALID_RESPONSE");
      const field: ValidationPending["field"] = Object.hasOwn(validationPendingLabels, item.field) ? item.field as ValidationPending["field"] : "OTHER";
      if (Object.hasOwn(item, "scope") && item.scope !== "client" && item.scope !== "bank") throw Error("INVALID_RESPONSE");
      // NEVER copy provider label, regex, resolveWith, values, URLs or unknown field names.
      return { field, ...(Object.hasOwn(item, "scope") ? { scope: item.scope as "client" | "bank" } : {}) };
    });
  }
  if (!Object.keys(result).length || result.valid === true && (result.found === false || !!result.pending?.length)) throw Error("INVALID_RESPONSE");
  return result;
}
const diagnosticKeys = ["httpStatus", "requestId", "correlationId", "responseReadable", "responseParsed", "found", "valid", "pendingPresent", "category"];
const safeId = (v: unknown) => v === null || typeof v === "string" && !/\d{11}/.test(v)
  && /^(?:req_[0-9a-f]{12,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\s\S])/i.test(v);
/** Browser also validates the closed administrative DTO; it never renders arbitrary labels/errors. */
export function parseClientValidationResponse(raw: unknown): ClientValidationResponse | null {
  try {
    const r = validationObject(raw), d = validationObject(r.diagnostic);
    if (typeof r.ok !== "boolean" || Object.keys(r).length !== 3 || Object.keys(r).some(k => !["ok", r.ok ? "validation" : "error", "diagnostic"].includes(k))
      || Object.keys(d).length !== diagnosticKeys.length || Object.keys(d).some(k => !diagnosticKeys.includes(k))
      || d.httpStatus !== null && (typeof d.httpStatus !== "number" || !Number.isInteger(d.httpStatus) || d.httpStatus < 100 || d.httpStatus > 599)
      || !safeId(d.requestId) || !safeId(d.correlationId) || typeof d.responseReadable !== "boolean" || typeof d.responseParsed !== "boolean"
      || ![true, false, null].includes(d.found as boolean | null) || ![true, false, null].includes(d.valid as boolean | null)
      || ![true, false, null].includes(d.pendingPresent as boolean | null) || !validationCategories.includes(d.category as ValidationDiagnostic["category"])
      || d.responseParsed && !d.responseReadable) return null;
    const diagnostic = d as ValidationDiagnostic;
    if (!r.ok) return r.error === "OPENCREDIT_CLIENT_VALIDATION_FAILED" && !["VALID", "PENDING", "NOT_FOUND", "INCOMPLETE"].includes(diagnostic.category)
      ? { ok: false, error: r.error, diagnostic } : null;
    const v = validationObject(r.validation), validation = parseProviderClientValidation({ data: v });
    if (Object.keys(v).some(k => !["found", "valid", "pending"].includes(k)) || diagnostic.httpStatus !== 200 || !diagnostic.responseParsed
      || diagnostic.found !== (validation.found ?? null) || diagnostic.valid !== (validation.valid ?? null)
      || diagnostic.pendingPresent !== Object.hasOwn(validation, "pending") || diagnostic.category !== clientValidationCategory(validation)) return null;
    if (validation.pending?.some((p, i) => {
      const item = validationObject((v.pending as unknown[])[i]);
      return item.field !== p.field || Object.keys(item).some(k => k !== "field" && k !== "scope");
    })) return null;
    return { ok: true, validation, diagnostic };
  } catch { return null; }
}
