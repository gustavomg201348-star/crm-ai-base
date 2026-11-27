export type TeamRole = "ADMIN" | "SUPERVISOR" | "AGENT";
export type Availability = "ONLINE" | "BUSY" | "PAUSED" | "OFFLINE";
export const availabilityLabels: Record<Availability, string> = {
  ONLINE: "Disponível",
  BUSY: "Ocupado",
  PAUSED: "Pausado",
  OFFLINE: "Indisponível",
};
export type Attendant = {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  availabilityStatus: Availability;
  lastSeenAt?: string | null;
  openConversations: number;
};
export type TeamUser = Attendant & {
  platformAdmin: boolean;
  canManage: boolean;
};
export type AssignmentSettings = {
  mode: "CLAIM_FIRST" | "ROUND_ROBIN" | "ADMIN_MANUAL";
  onlineOnly: boolean;
  maxOpenPerAttendant: number | null;
  allowAttendantClaim: boolean;
  redistributeWhenOffline: boolean;
  fallback?: boolean;
};
export type SettingsTagRow = {
  id: string;
  name: string;
  color: string;
  textColor?: string | null;
  category?: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
  conversationCount: number;
  protectedAutomation?: boolean;
};

export async function settingsRequest(
  url: string,
  method: string,
  body?: unknown,
) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(
      (
        {
          USER_DUPLICATE: "E-mail já cadastrado.",
          USER_PERMISSION_DENIED:
            "Esta conta não pode ser alterada pelo seu perfil.",
          FORBIDDEN: "Você não tem permissão para esta operação.",
          INVALID_REQUEST: "Confira os campos informados.",
          USER_NOT_FOUND: "Usuário indisponível.",
          USER_DELETE_FAILED:
            "Não foi possível excluir. A conta pode possuir vínculos que precisam ser preservados.",
        } as Record<string, string>
      )[result?.error] ??
        "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.",
    );
  return result;
}
