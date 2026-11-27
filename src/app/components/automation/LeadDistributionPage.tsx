"use client";
import type { DistributionMonitor } from "@/lib/automation-monitor.service";
import { OperationalSettings } from "../settings/OperationalSettings";
import type { AssignmentSettings, Attendant } from "../settings/settings-types";
import {
  action,
  Fact,
  MonitorHeader,
  MonitorState,
  panel,
  useMonitor,
  type Navigate,
} from "./monitor-ui";
export function LeadDistributionPage({
  onSave,
  onNavigate,
}: {
  onSave: (s: AssignmentSettings) => Promise<void>;
  onNavigate: Navigate;
}) {
  const { data, loading, error, refresh } = useMonitor<DistributionMonitor>(
    "/api/automations/distribution",
  );
  return (
    <section className="space-y-4">
      <MonitorHeader
        title="Distribuição de Leads"
        description="Configuração existente e capacidade observada. A leitura não atribui, redistribui ou assume conversas."
        updatedAt={data?.updatedAt}
        loading={loading}
        onRefresh={refresh}
      />
      <MonitorState error={error} loading={loading} hasData={!!data} />
      {data && (
        <>
          <dl className={panel}>
            <Fact label="ONLINE persistidos" value={data.metrics.online} />
            <Fact label="Conversas atribuídas" value={data.metrics.assigned} />
            <Fact
              label="Conversas sem responsável"
              value={data.metrics.unassigned}
            />
            <Fact
              label="Capacidade livre observada · ONLINE"
              value={
                !data.capacity.complete
                  ? "Indeterminada: mais de 500 atendentes"
                  : data.capacity.unlimited
                    ? "Sem teto configurado"
                    : data.capacity.remaining
              }
            />
          </dl>
          <OperationalSettings
            attendants={data.attendants.map(
              (a) =>
                ({
                  ...a,
                  email: "",
                  role: a.role,
                  availabilityStatus: a.availabilityStatus,
                }) as Attendant,
            )}
            leadAssignmentSettings={data.settings}
            onSaveLeadAssignmentSettings={async (settings) => {
              await onSave(settings);
              await refresh();
            }}
          />
          <button className={action} onClick={() => onNavigate("equipe")}>
            Gerenciar disponibilidade em Equipe e Permissões
          </button>
          <p className="text-xs text-slate-500">
            Capacidade é um snapshot, não uma reserva. A decisão final continua
            na transação de atribuição. Lista limitada a 500 atendentes;
            contagens globais permanecem exatas.
          </p>
        </>
      )}
    </section>
  );
}
