import { CheckCircle2 } from "lucide-react";

export function EmptyState() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-line bg-white p-8 text-center shadow-soft">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink">Nenhuma oportunidade acionável agora</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
        A fila inteligente não encontrou clientes que precisem de ação imediata neste momento.
      </p>
    </div>
  );
}
