/** Browser-safe local whitelist based on official OpenAPI 2.9.0 (2026-10-28). */
export const simulationCapabilityKeys = ["simulacaoAtiva", "digitacaoAtiva", "suportaParcela", "suportaLiquido", "aceitaChavePixReal", "somentePix", "exigeContatoEmpregador"] as const;
export type SimulationBank = { bankId: string; bankName: string; enabled?: boolean; capabilities: Partial<Record<typeof simulationCapabilityKeys[number], boolean>> };
export type SimulationParameters = Readonly<{ bankId: string; mode: "maximum" | "parcela" | "liberado"; amountBRL: string }>;
export type SimulationOffer = { offerId: string; installments: number; installmentAmount: number; liquidAmount: number | null; interestRate: number | null; totalAmount: number | null; hasInsurance: boolean | null };
export type SimulationResult = { bankId: string; simulationId: string; status: "aprovado" | "recusado" | "pendente" | "waiting_authorization"; simulationType: "margem_maxima" | "valor_parcela" | "valor_liberado" | null; offers: SimulationOffer[] };
const invalid = (): never => { throw Error("INVALID_SIMULATION_CONTRACT"); };
export function simulationId(v: unknown): string { if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v) || /^(?:\d{11}|\d{13})$/.test(v)) return invalid(); return v; }
export function reaisToCents(v: unknown): number {
  if (typeof v !== "string" || !/^(?:0|[1-9]\d{0,11})(?:,\d{2})?(?![\s\S])/.test(v)) return invalid();
  const [reais, centavos = "00"] = v.split(",");
  const result = Number(reais) * 100 + Number(centavos);
  if (!Number.isSafeInteger(result) || result <= 0) return invalid(); return result;
}
export function simulationParameters(p: SimulationParameters): SimulationParameters {
  const bankId = simulationId(p?.bankId);
  if (p.mode !== "maximum" && p.mode !== "parcela" && p.mode !== "liberado") return invalid();
  if (p.mode === "maximum" ? p.amountBRL !== "" : !reaisToCents(p.amountBRL)) return invalid();
  return { bankId, mode: p.mode, amountBRL: p.amountBRL };
}
export function simulationPayload(p: SimulationParameters, cpf: string) {
  const parameters = simulationParameters(p);
  if (!/^\d{11}$/.test(cpf)) return invalid();
  // Product is CLT by this endpoint's official scope; product is NOT a published body property.
  return Object.freeze({ cpf, banks: [parameters.bankId], ...(parameters.mode === "maximum" ? {} : { tipoValorSolicitado: parameters.mode, valorSolicitado: reaisToCents(parameters.amountBRL) }) });
}
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) return invalid(); return v as Record<string, unknown>; }
function finite(v: unknown): number { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) return invalid(); return v; }
function nullableNumber(v: unknown): number | null { return v === null ? null : finite(v); }
function offers(v: unknown): SimulationOffer[] {
  if (!Array.isArray(v) || v.length > 100) return invalid();
  return v.map(value => {
    const o = object(value), installments = finite(o.installments);
    if (!Number.isSafeInteger(installments) || installments < 1 || typeof o.hasInsurance !== "boolean" && o.hasInsurance !== null) return invalid();
    return { offerId: simulationId(o.offerId), installments, installmentAmount: finite(o.installmentAmount), liquidAmount: nullableNumber(o.liquidAmount),
      interestRate: nullableNumber(o.interestRate), totalAmount: nullableNumber(o.totalAmount), hasInsurance: o.hasInsurance };
  });
}
export function parseSimulationPost(v: unknown, bankId: string, cpf: string): SimulationResult {
  const data = object(object(v).data), client = object(data.client);
  if (client.cpf !== cpf || typeof data.fromCache !== "boolean" || data.blocked !== false || !Array.isArray(data.barriers) || data.barriers.length !== 0
    || !Array.isArray(data.banks) || data.banks.length !== 1) return invalid();
  const bank = object(data.banks[0]);
  if (bank.bankId !== bankId || !["aprovado", "recusado", "pendente"].includes(bank.status as string)) return invalid();
  const status = bank.reasonType === "waiting_authorization" ? "waiting_authorization" : bank.status as SimulationResult["status"];
  // Unknown reasonType is explicitly not interpreted as refusal or permission to resend.
  if (bank.reasonType !== null && !["waiting_authorization", "no_offer", "timeout", "unavailable", "business_rule", "pre_validation"].includes(bank.reasonType as string)) return invalid();
  if (![null, "margem_maxima", "valor_parcela", "valor_liberado"].includes(bank.simulationType as never)) return invalid();
  const parsedOffers = offers(bank.offers), id = simulationId(bank.simulationId);
  if (status !== "aprovado" && parsedOffers.length !== 0) return invalid();
  if ([id, ...parsedOffers.map(o => o.offerId)].some(value => value.includes(cpf))) return invalid();
  return { bankId, simulationId: id, status, simulationType: bank.simulationType as SimulationResult["simulationType"], offers: parsedOffers };
}
/** GET response is example/description, not a complete formal schema: local conservative contract. */
export function parseSimulationPoll(v: unknown, expected: { simulationId: string; bankId: string; cpf: string; tenantId: string }): SimulationResult {
  const d = object(object(v).data);
  if (d.id !== expected.simulationId || d.bankId !== expected.bankId || d.cpf !== expected.cpf || d.tenantId !== expected.tenantId || d.product !== "clt") return invalid();
  const statuses = { pending: "pendente", approved: "aprovado", refused: "recusado", waiting_authorization: "waiting_authorization" } as const;
  if (typeof d.status !== "string" || !Object.hasOwn(statuses, d.status)) return invalid();
  if (Object.hasOwn(d, "tipoSimulacao") && ![null, "margem_maxima", "valor_parcela", "valor_liberado"].includes(d.tipoSimulacao as never)) return invalid();
  const parsedOffers = offers(d.offers);
  if (d.status !== "approved" && parsedOffers.length !== 0) return invalid();
  if ([d.id as string, ...parsedOffers.map(o => o.offerId)].some(value => value.includes(expected.cpf))) return invalid();
  return { bankId: expected.bankId, simulationId: simulationId(d.id), status: statuses[d.status as keyof typeof statuses], simulationType: d.tipoSimulacao === undefined ? null : d.tipoSimulacao as SimulationResult["simulationType"], offers: parsedOffers };
}

export type SimulationOperationView = { operationId: string; state: string; revision: number; displayState: string; diagnostic: Record<string, unknown> | null };
export type SimulationReply = { ok: true; banks?: SimulationBank[]; operation?: SimulationOperationView | null; result?: SimulationResult | null; pollUnavailable?: boolean };
/** Shared response whitelist. Never forward a provider object or arbitrary service row. */
export function parseSimulationReply(value: unknown): SimulationReply {
  const r = object(value), result: SimulationReply = { ok: true };
  if (r.ok !== true || Object.keys(r).some(k => !["ok", "banks", "operation", "result", "pollUnavailable"].includes(k))) return invalid();
  if (Object.hasOwn(r, "banks")) {
    if (!Array.isArray(r.banks) || r.banks.length > 1000) return invalid();
    result.banks = r.banks.map(value => {
      const b = object(value), c = object(b.capabilities), capabilities: SimulationBank["capabilities"] = {};
      if (typeof b.bankName !== "string" || !b.bankName.trim() || b.bankName.length > 200 || /[\u0000-\u001f\u007f]/.test(b.bankName) || Object.keys(c).some(k => !(simulationCapabilityKeys as readonly string[]).includes(k))) return invalid();
      for (const key of simulationCapabilityKeys) if (Object.hasOwn(c, key)) { if (typeof c[key] !== "boolean") return invalid(); capabilities[key] = c[key] as boolean; }
      if (Object.hasOwn(b, "enabled") && typeof b.enabled !== "boolean") return invalid();
      return { bankId: simulationId(b.bankId), bankName: b.bankName, capabilities, ...(Object.hasOwn(b, "enabled") ? { enabled: b.enabled as boolean } : {}) };
    });
    if (new Set(result.banks.map(b => b.bankId)).size !== result.banks.length) return invalid();
  }
  if (Object.hasOwn(r, "operation")) {
    if (r.operation === null) result.operation = null;
    else {
      const o = object(r.operation);
      if (!["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(o.state as string) || !Number.isSafeInteger(o.revision) || (o.revision as number) < 0
        || !["PREPARED", "IN_FLIGHT", "PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(o.displayState as string)) return invalid();
      let diagnostic: Record<string, unknown> | null = null;
      if (o.diagnostic !== null) {
        const d = object(o.diagnostic), safe: Record<string, unknown> = {};
        const keys = ["bankId", "requestedMode", "simulationId", "httpStatus", "requestId", "correlationId", "responseReadable", "responseParsed", "dispatchCommittedAt", "respondedAt", "settlement", "stage", "category", "providerStatus"];
        if (Object.keys(d).length !== keys.length || Object.keys(d).some(k => !keys.includes(k))) return invalid();
        safe.bankId = simulationId(d.bankId); safe.simulationId = d.simulationId === null ? null : simulationId(d.simulationId);
        if (!["maximum", "parcela", "liberado"].includes(d.requestedMode as string)) return invalid(); safe.requestedMode = d.requestedMode;
        if (d.httpStatus !== null && (!Number.isInteger(d.httpStatus) || (d.httpStatus as number) < 100 || (d.httpStatus as number) > 599)) return invalid();
        safe.httpStatus = d.httpStatus;
        for (const key of ["requestId", "correlationId"]) {
          const id = d[key]; if (id !== null && (typeof id !== "string" || !/^(?:req_[a-f0-9]{12,32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id) || /\d{11}/.test(id))) return invalid(); safe[key] = id;
        }
        for (const key of ["responseReadable", "responseParsed"]) { if (typeof d[key] !== "boolean") return invalid(); safe[key] = d[key]; }
        for (const key of ["dispatchCommittedAt", "respondedAt"]) { if (d[key] !== null && (typeof d[key] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(d[key]))) return invalid(); safe[key] = d[key]; }
        for (const [key, allowed] of Object.entries({ settlement: ["NOT_CONFIRMED", "CONFIRMED"], stage: ["TRANSPORT", "RESPONSE", "POLL"], category: ["NONE", "PENDING", "TIMEOUT", "NETWORK", "INVALID_RESPONSE"], providerStatus: [null, "aprovado", "recusado", "pendente", "waiting_authorization"] })) {
          if (!(allowed as unknown[]).includes(d[key])) return invalid(); safe[key] = d[key];
        }
        diagnostic = safe;
      }
      if (o.displayState === "PENDING" ? o.state !== "IN_FLIGHT" || !diagnostic?.simulationId || !["pendente", "waiting_authorization"].includes(diagnostic.providerStatus as string) : o.displayState !== o.state) return invalid();
      result.operation = { operationId: simulationId(o.operationId), state: o.state as string, revision: o.revision as number, displayState: o.displayState as string, diagnostic };
    }
  }
  if (Object.hasOwn(r, "result")) {
    if (r.result === null) result.result = null;
    else { const s = object(r.result); if (!["aprovado", "recusado", "pendente", "waiting_authorization"].includes(s.status as string) || ![null, "margem_maxima", "valor_parcela", "valor_liberado"].includes(s.simulationType as never)) return invalid(); result.result = { bankId: simulationId(s.bankId), simulationId: simulationId(s.simulationId), status: s.status as SimulationResult["status"], simulationType: s.simulationType as SimulationResult["simulationType"], offers: offers(s.offers) }; }
  }
  if (Object.hasOwn(r, "pollUnavailable")) { if (typeof r.pollUnavailable !== "boolean") return invalid(); result.pollUnavailable = r.pollUnavailable; }
  return result;
}
