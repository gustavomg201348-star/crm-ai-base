"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseOpenCreditCreateClientReconciliationContext, reconciliationErrorMessage,
  type OpenCreditCreateClientReconciliationContext } from "@/lib/opencredit-create-client-reconciliation-ui";
type Props = { companyId: string; contactId: string };
const endpoint = "/api/admin/integrations/opencredit/create-client/reconciliation/context";
export function OpenCreditCreateClientReconciliationPanel(props: Props) {
  return <Review key={JSON.stringify([props.companyId, props.contactId])} {...props} />;
}
function Review({ companyId, contactId }: Props) {
  const [context, setContext] = useState<OpenCreditCreateClientReconciliationContext | null>(null);
  const [busy, setBusy] = useState(true), [hidden, setHidden] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const epoch = ++sequence.current; setContext(null); setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); return; }
      const raw: unknown = await response.json(); if (abort.signal.aborted || sequence.current !== epoch) return;
      const parsed = response.ok ? parseOpenCreditCreateClientReconciliationContext(raw) : null;
      if (!parsed) { setError(reconciliationErrorMessage(raw)); return; }
      setContext(parsed);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) setError(reconciliationErrorMessage(null)); }
    finally { if (!abort.signal.aborted && sequence.current === epoch) setBusy(false); }
  }, [companyId, contactId]);
  const invalidate = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  if (hidden) return null;
  const review = context?.review;
  return <section aria-label="Revisão do envio" className="mt-3 rounded border border-line p-3">
    <h5 className="font-bold">Revisão do envio</h5>
    {busy && <p role="status">Atualizando revisão...</p>}
    {error && <p role="alert">{error}</p>}
    {context && !review && <p>Não há revisão pendente no contexto local atual.</p>}
    {review && <>
      <p className="mt-2 font-semibold">{review.state === "IN_FLIGHT" ? "Pendente de confirmação" : "Resultado não confirmado"}</p>
      <p className="mt-2 text-sm">{review.state === "IN_FLIGHT"
        ? "A operação foi comprometida localmente para envio, mas não é possível confirmar se a OpenCredit recebeu ou processou a solicitação. Não faça um novo envio."
        : "O sistema iniciou a tentativa externa, mas o resultado final não pôde ser confirmado. Não reenvie a operação até existir uma forma segura de reconciliação."}</p>
      <dl className="mt-2 text-xs">
        <dt>Preparado em</dt><dd>{new Date(review.preparedAt).toLocaleString("pt-BR")}</dd>
        <dt>{review.state === "IN_FLIGHT" ? "Commit de envio" : "Tentativa comprometida em"}</dt><dd>{new Date(review.dispatchCommittedAt).toLocaleString("pt-BR")}</dd>
        {review.state === "UNKNOWN" && <><dt>Marcado como resultado ambíguo em</dt><dd>{new Date(review.settledAt).toLocaleString("pt-BR")}</dd></>}
        <dt>Autorização vinculada</dt><dd>Sim</dd>
      </dl>
    </>}
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-2 text-xs underline disabled:opacity-50">Atualizar revisão</button>
  </section>;
}
