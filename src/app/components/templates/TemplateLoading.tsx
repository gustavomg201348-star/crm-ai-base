import { Loader2 } from "lucide-react";

export function TemplateLoading() {
  return (
    <section className="rounded border border-line bg-white p-6 shadow-soft">
      <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-brand" />
        Carregando templates...
      </div>
      <div className="mt-5 grid gap-3">
        {["template-loading-1", "template-loading-2", "template-loading-3"].map((item) => (
          <div key={item} className="h-16 rounded-2xl bg-slate-100" />
        ))}
      </div>
    </section>
  );
}
