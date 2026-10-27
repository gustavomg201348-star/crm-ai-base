"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseClientValidationResponse, validationPendingLabels, type ClientValidationResponse } from "@/lib/opencredit-client-validation";

type Props = { enabled: boolean; authorizationActive: boolean; companyId: string; contactId: string };
const endpoint = "/api/admin/integrations/opencredit/client-validation/context";
export function OpenCreditClientValidationPanel(props: Props) {
  if (!props.enabled) return null;
  return <Read key={JSON.stringify([props.companyId, props.contactId])} {...props} />;
}
function Read({ companyId, contactId, authorizationActive }: Props) {
  const [result, setResult] = useState<ClientValidationResponse | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false), [hidden, setHidden] = useState(false);
  const sequence = useRef(0), working = useRef(false), controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    invalidate(); working.current = false;
    setResult(null); setError(false); setBusy(false);
    return invalidate;
  }, [authorizationActive, invalidate]);
  async function read() {
    if (working.current || busy || hidden || !authorizationActive) return;
    working.current = true; setBusy(true); setError(false); setResult(null);
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const epoch = ++sequence.current;
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if ([401, 403].includes(response.status)) { setHidden(true); return; }
      const raw: unknown = await response.json(); if (abort.signal.aborted || sequence.current !== epoch) return;
      const parsed = parseClientValidationResponse(raw);
      if (!parsed || parsed.ok !== response.ok) { setError(true); return; }
      setResult(parsed);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) setError(true); }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }
  if (hidden) return null;
  const value = result?.ok ? result.validation : null;
  const flag = (v: boolean | undefined) => v === undefined ? "não informado" : v ? "true" : "false";
  return <section aria-label="Validação pré-simulação OpenCredit" className="mt-4 rounded border border-line p-3">
    <h4 className="font-bold">Validar dados para simulação</h4>
    <p className="mt-2 text-xs">Somente leitura (READ-ONLY). NÃO executa simulação, consulta de margem paga ou proposta. Não autoriza operação de crédito.</p>
    <button type="button" disabled={busy || !authorizationActive} onClick={() => void read()} className="mt-3 w-full rounded border border-line p-2 text-sm disabled:opacity-50">Validar dados para simulação</button>
    {busy && <p role="status">Consultando validação...</p>}
    {!authorizationActive && <p className="mt-2 text-xs">Autorização operacional ativa é necessária para esta leitura.</p>}
    {(error || result && !result.ok) && <p role="alert">Não foi possível concluir a validação. Nenhuma simulação foi executada.</p>}
    {value && <div role="status" className="mt-2 text-xs">
      <p>found: {flag(value.found)} / valid: {flag(value.valid)}</p>
      {!Object.hasOwn(value, "pending") ? <p>Pendências não informadas; resultado incompleto.</p>
        : value.pending?.length ? <ul>{value.pending.map((item, index) => <li key={index}>{validationPendingLabels[item.field]}{item.scope === "bank" ? " (banco)" : item.scope === "client" ? " (cadastro)" : ""}</li>)}</ul>
          : <p>Nenhuma pendência retornada. Isto não comprova elegibilidade nem autoriza simulação.</p>}
    </div>}
    {result && <p className="mt-2 text-xs">Diagnóstico: {result.diagnostic.category}; HTTP: {result.diagnostic.httpStatus ?? "não disponível"}; readable: {String(result.diagnostic.responseReadable)}; parsed: {String(result.diagnostic.responseParsed)}</p>}
  </section>;
}
