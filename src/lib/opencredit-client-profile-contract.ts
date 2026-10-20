import "server-only";

export type OpenCreditClientProfilePayload = {
  cpf: string;
  nome?: string;
  data_nascimento?: string;
  celular?: string;
  nome_mae?: string;
  email?: string;
  rg?: string;
  orgao_emissor?: string;
  uf_emissor?: string;
  data_expedicao?: string;
  genero?: "M" | "F";
  estado_civil?: string;
  endereco_cep?: string;
  endereco_rua?: string;
  endereco_numero?: string;
  endereco_complemento?: string;
  endereco_bairro?: string;
  endereco_cidade?: string;
  endereco_uf?: string;
};

export type OpenCreditClientProfileResult = { success: boolean; created: boolean };

export class OpenCreditClientProfileContractError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_RESPONSE") {
    super(`OPENCREDIT_CLIENT_PROFILE_${code}`);
    this.name = "OpenCreditClientProfileContractError";
  }
}

const FIELDS = [
  "cpf", "nome", "data_nascimento", "celular", "nome_mae", "email", "rg",
  "orgao_emissor", "uf_emissor", "data_expedicao", "genero", "estado_civil",
  "endereco_cep", "endereco_rua", "endereco_numero", "endereco_complemento",
  "endereco_bairro", "endereco_cidade", "endereco_uf"
] as const;
const allowed = new Set<string>(FIELDS);
// LOCAL QEVORA SAFETY LIMIT — NOT PROVIDER CONTRACT. UTF-16 code units, not bytes.
const CPF_MAX = 32;
const STRING_MAX = 1024;

function record(value: unknown): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw Error();
  return value;
}

/** Read only own enumerable data properties; never execute a caller's getter. */
function ownValue(source: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw Error();
  return descriptor.value;
}

/**
 * Technical DTO only: NOT permission to operate a Company or CPF.
 * No Company binding, consent, commercial enablement or remote identity policy here.
 * A future raw JSON boundary must reject duplicate keys BEFORE conversion to object;
 * duplicates already collapsed by JSON.parse cannot be detected by this builder.
 */
export function buildOpenCreditClientProfilePayload(input: unknown): OpenCreditClientProfilePayload {
  try {
    const source = record(input);
    for (const key of Reflect.ownKeys(source)) {
      if (typeof key !== "string" || !allowed.has(key)) throw Error();
    }
    if (!Object.hasOwn(source, "cpf")) throw Error();
    const result: Record<string, string> = {};
    for (const key of FIELDS) {
      if (!Object.hasOwn(source, key)) continue;
      const value = ownValue(source, key);
      if (typeof value !== "string" || !value.trim() || value.length > (key === "cpf" ? CPF_MAX : STRING_MAX)
        || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw Error();
      // Structural check only: NOT calendar, age or timezone validation.
      if (key === "data_nascimento" && !/^\d{2}\/\d{2}\/\d{4}$/.test(value)) throw Error();
      if (key === "genero" && value !== "M" && value !== "F") throw Error();
      // LOCAL QEVORA ALLOWLIST BASED ON PROVIDER DESCRIPTION, NOT A FORMAL OPENAPI ENUM.
      if (key === "estado_civil" && !["1", "2", "3", "4"].includes(value)) throw Error();
      result[key] = value;
    }
    return result as OpenCreditClientProfilePayload;
  } catch {
    // Never retain the submitted value, field name, original exception or PII.
    throw new OpenCreditClientProfileContractError("INVALID_INPUT");
  }
}

/** Closed copy in fixed field order, before any commit-to-dispatch. Memory only. */
export function serializeOpenCreditClientProfilePayload(input: unknown): string {
  try { return JSON.stringify(buildOpenCreditClientProfilePayload(input)); }
  catch { throw new OpenCreditClientProfileContractError("INVALID_INPUT"); }
}

/** Local conservative policy for a success response documented only by example. */
export function parseOpenCreditClientProfileResult(payload: unknown): OpenCreditClientProfileResult {
  try {
    const data = record(ownValue(record(payload), "data"));
    const success = ownValue(data, "success");
    const created = ownValue(data, "created");
    if (typeof success !== "boolean" || typeof created !== "boolean") throw Error();
    return { success, created };
  } catch {
    throw new OpenCreditClientProfileContractError("INVALID_RESPONSE");
  }
}
