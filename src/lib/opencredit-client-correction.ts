/** Browser-safe validation only; no target, credentials or provider access. */
export type CorrectionFields = Readonly<{ dataNascimento: string; nomeMae: string; email: string }>;
export type CorrectionPayload = Readonly<{ data_nascimento: string; nome_mae: string; email: string; celular: string }>;
export function correctionFields(value: CorrectionFields): CorrectionFields {
  if (!value || typeof value !== "object") throw Error("INVALID_CORRECTION");
  const { dataNascimento, nomeMae, email } = value;
  if (typeof dataNascimento !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(dataNascimento)) throw Error("INVALID_CORRECTION");
  const [d, m, y] = dataNascimento.split("/").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw Error("INVALID_CORRECTION");
  if (typeof nomeMae !== "string" || typeof email !== "string") throw Error("INVALID_CORRECTION");
  const mother = nomeMae.trim(), mail = email.trim();
  if (!mother || mother.length > 160 || /[\u0000-\u001f\u007f]/.test(nomeMae)
    || mail.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(mail)) throw Error("INVALID_CORRECTION");
  return { dataNascimento, nomeMae: mother, email: mail };
}
export function correctionPhone(value: unknown): string {
  if (typeof value !== "string" || !/^55[0-9]{11}$/.test(value)) throw Error("INVALID_CORRECTION_PHONE");
  return value.slice(2); // Exactly DDI 55, never trim, strip punctuation, or update Contact.
}
export function correctionPayload(fields: CorrectionFields, contactPhone: unknown): CorrectionPayload {
  const f = correctionFields(fields);
  return { data_nascimento: f.dataNascimento, nome_mae: f.nomeMae, email: f.email, celular: correctionPhone(contactPhone) };
}
