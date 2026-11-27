"use client";
import { useEffect, useState } from "react";
import {
  availabilityLabels,
  type Attendant,
  type AssignmentSettings,
} from "./settings-types";
export function OperationalSettings({
  attendants,
  leadAssignmentSettings,
  onSaveLeadAssignmentSettings,
}: {
  attendants: Attendant[];
  leadAssignmentSettings: AssignmentSettings;
  onSaveLeadAssignmentSettings: (settings: AssignmentSettings) => Promise<void>;
}) {
  const [assignmentForm, setAssignmentForm] = useState(leadAssignmentSettings);
  useEffect(
    () => setAssignmentForm(leadAssignmentSettings),
    [leadAssignmentSettings],
  );
  const assignmentModeLabel = (mode: string) =>
    ({
      CLAIM_FIRST: "Quem clicar primeiro pega",
      ROUND_ROBIN: "Automático igualitário",
      ADMIN_MANUAL: "Manual pelo administrador",
    })[mode] ?? mode;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
        >
          {error}
        </p>
      )}
      <section className="rounded-[1.5rem] border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Atendimento
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              Distribuicao de leads
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Defina se novos leads ficam em fila para o primeiro atendente
              assumir ou se o sistema distribui automaticamente entre vendedores
              disponiveis.
            </p>
          </div>
          <button
            className="h-10 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError("");
              void onSaveLeadAssignmentSettings(assignmentForm)
                .catch(() =>
                  setError("Não foi possível salvar a distribuição."),
                )
                .finally(() => setBusy(false));
            }}
            type="button"
          >
            Salvar distribuicao
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Modo de distribuicao
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                value={assignmentForm.mode}
                onChange={(event) =>
                  setAssignmentForm((current) => ({
                    ...current,
                    mode: event.target.value as AssignmentSettings["mode"],
                  }))
                }
              >
                <option value="CLAIM_FIRST">Quem clicar primeiro pega</option>
                <option value="ROUND_ROBIN">Automatico igualitario</option>
                <option value="ADMIN_MANUAL">Manual pelo administrador</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Maximo aberto por atendente
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-3 text-sm outline-none"
                min={0}
                placeholder="Sem limite"
                type="number"
                value={assignmentForm.maxOpenPerAttendant ?? ""}
                onChange={(event) =>
                  setAssignmentForm((current) => ({
                    ...current,
                    maxOpenPerAttendant: event.target.value
                      ? Number(event.target.value)
                      : null,
                  }))
                }
              />
            </label>
            {[
              ["onlineOnly", "Distribuir apenas para online"],
              [
                "allowAttendantClaim",
                "Permitir atendente assumir sem responsavel",
              ],
              ["redistributeWhenOffline", "Redistribuir quando ficar offline"],
            ].map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between rounded-2xl border border-line px-3 py-3 text-sm font-semibold text-slate-700"
              >
                {label}
                <input
                  checked={Boolean(
                    assignmentForm[key as keyof AssignmentSettings],
                  )}
                  type="checkbox"
                  onChange={(event) =>
                    setAssignmentForm((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-950">Atendentes</p>
                <p className="text-xs text-slate-500">
                  {assignmentModeLabel(assignmentForm.mode)}
                </p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-500 ring-1 ring-line">
                {attendants.length} usuario(s)
              </span>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {attendants.map((attendant) => (
                <div
                  key={attendant.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 ring-1 ring-line/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {attendant.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {attendant.openConversations} atendimento(s) aberto(s)
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {availabilityLabels[attendant.availabilityStatus]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Gerencie a disponibilidade em Equipe e Permissões. AutoStart e
        distribuição mantêm suas regras atuais.
      </p>
    </>
  );
}
