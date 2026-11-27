"use client";
import { ReferenceManager } from "./ReferenceManager";
import type { Section } from "@/lib/sidebar-navigation";
export function SettingsWorkspace({
  companyName,
  reference,
  onRefresh,
  onNavigate,
}: {
  companyName: string;
  reference: { origins: { id: string; name: string }[] };
  onRefresh: () => Promise<void>;
  onNavigate: (section: Section) => void;
}) {
  return (
    <div className="space-y-4">
      <header className="rounded-2xl bg-[#0b2445] p-5 text-white">
        <h1 className="text-xl font-bold">Configurações</h1>
        <p className="mt-1 text-sm text-blue-100">
          {companyName} · Configurações gerais e comerciais
        </p>
      </header>
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="font-semibold">Gerenciamento por módulo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Cada configuração tem um único local principal.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["equipe", "Equipe e Permissões"],
              ["tags", "Tags"],
              ["kanban", "Etapas no Kanban"],
              ["automacoes", "Automações"],
              ["distribuicao-leads", "Distribuição de Leads"],
              ["opencredit", "OpenCredit"],
              ["bancos", "Bancos"],
              ["inteligencia-artificial", "Inteligência Artificial"],
              ["chatbot", "Chatbot"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              className="rounded-xl border px-4 py-2 text-sm font-medium text-blue-700"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <ReferenceManager
        kind="origins"
        items={reference.origins}
        onChanged={onRefresh}
      />
    </div>
  );
}
