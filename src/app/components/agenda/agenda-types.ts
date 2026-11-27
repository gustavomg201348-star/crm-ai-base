export type AgendaTask = {
  id: string; contactId: string; assigneeId: string | null; title: string; note: string | null;
  dueAt: string; status: "PENDING" | "DONE" | "CANCELLED"; updatedAt: string;
  origin: "MANUAL" | "AUTOMATIC" | "UNKNOWN";
  contact: { id: string; name: string; phone: string }; assignee: { id: string; name: string } | null;
};
export type AgendaData = {
  tasks: AgendaTask[]; total: number; nextCursor: string | null; canManage: boolean; canExport: boolean;
  attendants: { id: string; name: string }[]; counters: { today: number; overdue: number; upcoming: number; completed: number };
};
export const taskError = (code?: string) => ({
  CONFLICT: "O registro mudou ou a solicitação já foi utilizada. Atualize antes de tentar novamente.",
  NOT_FOUND: "Agendamento ou cliente indisponível para seu perfil.",
  FORBIDDEN: "Você não tem permissão para esta operação.",
  INVALID_REQUEST: "Confira cliente, responsável, título e data.",
  EXPORT_LIMIT: "Reduza o período para até 5.000 agendamentos.",
}[code ?? ""] ?? "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.");
