import {
  BadgeCheck,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  Gauge,
  Headphones,
  Hourglass,
  KanbanSquare,
  Library,
  Megaphone,
  MessagesSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  TrendingUp,
  UsersRound,
  Webhook,
  Workflow,
  Plug,
  Landmark,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "motor-comercial", label: "Motor Comercial", icon: Sparkles },
  { id: "next-best-action", label: "Próxima Melhor Ação", icon: BadgeCheck },
  { id: "atendimento", label: "Atendimento", icon: Headphones },
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "kanban", label: "Kanban", icon: KanbanSquare },
  { id: "contatos", label: "Contatos", icon: ContactRound },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "simulacao-clt", label: "Simulação CLT", icon: BriefcaseBusiness },
  { id: "multicred", label: "Multicred", icon: CircleDollarSign },
  { id: "canais", label: "Canais", icon: Webhook },
  { id: "templates", label: "Templates", icon: Library },
  { id: "disparos", label: "Disparos", icon: Megaphone },
  { id: "recem-aposentados", label: "Recém-aposentados", icon: Hourglass },
  { id: "empresas", label: "Empresas", icon: Building2 },
  { id: "chatbot", label: "Chatbot", icon: Bot },
  {
    id: "inteligencia-artificial",
    label: "Inteligência Artificial",
    icon: Sparkles,
  },
  { id: "config", label: "Configurações", icon: Settings },
  { id: "equipe", label: "Equipe e Permissões", icon: UsersRound },
  { id: "automacoes", label: "Central de Controle", icon: Workflow },
  {
    id: "regras-automaticas",
    label: "Regras Automáticas",
    icon: SlidersHorizontal,
  },
  {
    id: "distribuicao-leads",
    label: "Distribuição de Leads",
    icon: UsersRound,
  },
  { id: "opencredit", label: "OpenCredit", icon: Plug },
  { id: "bancos", label: "Bancos", icon: Landmark },
] as const;

export type NavigationItem = (typeof navItems)[number];
export type Section = NavigationItem["id"];
type NavigationRole = "ADMIN" | "SUPERVISOR" | "AGENT";
type NavigationSection =
  | { id: string; itemId: Section }
  | {
      id: string;
      label: string;
      icon: LucideIcon;
      itemIds: readonly Section[];
    };

const navigationSections: readonly NavigationSection[] = [
  { id: "dashboard", itemId: "dashboard" },
  {
    id: "operacao-comercial",
    label: "Operação Comercial",
    icon: TrendingUp,
    itemIds: ["motor-comercial", "next-best-action"],
  },
  {
    id: "relacionamento",
    label: "Relacionamento",
    icon: UsersRound,
    itemIds: ["atendimento", "agenda", "kanban", "contatos", "tags"],
  },
  {
    id: "comunicacao",
    label: "Comunicação",
    icon: MessagesSquare,
    itemIds: [
      "canais",
      "templates",
      "disparos",
      "chatbot",
      "inteligencia-artificial",
    ],
  },
  {
    id: "automacoes-grupo",
    label: "Automações",
    icon: Workflow,
    itemIds: ["automacoes", "regras-automaticas", "distribuicao-leads"],
  },
  {
    id: "integracoes-grupo",
    label: "Integrações",
    icon: Plug,
    itemIds: ["opencredit", "bancos"],
  },
  {
    id: "produtos-financeiros",
    label: "Produtos Financeiros",
    icon: CircleDollarSign,
    itemIds: ["simulacao-clt", "multicred", "recem-aposentados"],
  },
  {
    id: "administracao-apoio",
    label: "Administração",
    icon: ShieldCheck,
    itemIds: ["empresas", "equipe", "config"],
  },
];

const agentItems: readonly Section[] = [
  "motor-comercial",
  "next-best-action",
  "atendimento",
  "agenda",
  "contatos",
  "kanban",
  "simulacao-clt",
];
const supervisorItems: readonly Section[] = [
  ...agentItems,
  "dashboard",
  "tags",
  "recem-aposentados",
  "equipe",
];

export type VisibleNavigationSection =
  | { id: string; item: NavigationItem }
  | { id: string; label: string; icon: LucideIcon; items: NavigationItem[] };

export function getVisibleNavigation(
  role: NavigationRole | undefined,
  isPlatformAdmin: boolean,
) {
  const visibleItems = navItems.filter(({ id }) => {
    if (role === "ADMIN") return id !== "empresas" || isPlatformAdmin;
    return (role === "SUPERVISOR" ? supervisorItems : agentItems).includes(id);
  });
  const itemsById = new Map<Section, NavigationItem>(
    visibleItems.map((item) => [item.id, item]),
  );
  const sections = navigationSections.flatMap<VisibleNavigationSection>(
    (section) => {
      if ("itemId" in section) {
        const item = itemsById.get(section.itemId);
        return item ? [{ id: section.id, item }] : [];
      }
      const items = section.itemIds.flatMap((id) => itemsById.get(id) ?? []);
      return items.length
        ? [{ id: section.id, label: section.label, icon: section.icon, items }]
        : [];
    },
  );
  return { visibleItems, sections };
}
