import { AlertTriangle, Library } from "lucide-react";
import { TemplateEmptyState } from "./TemplateEmptyState";
import { TemplateLoading } from "./TemplateLoading";
import { TemplateTable } from "./TemplateTable";
import { TemplateToolbar } from "./TemplateToolbar";
import type { TemplateVisualState } from "./types";

export function TemplateLibraryPage({
  visualState = "empty"
}: {
  visualState?: TemplateVisualState;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand">
              <Library aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-950">Templates</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Gerencie os templates aprovados da Meta utilizados em campanhas e conversas.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
            Módulo em preparação
          </div>
        </div>
      </section>

      <TemplateToolbar />

      {visualState === "loading" && <TemplateLoading />}
      {visualState === "error" && (
        <section
          className="rounded border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            Não foi possível carregar os templates. Tente novamente mais tarde.
          </div>
        </section>
      )}
      {visualState === "list-empty" && <TemplateTable templates={[]} />}
      {visualState === "empty" && <TemplateEmptyState />}
    </div>
  );
}
