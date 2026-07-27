import {
  BadgeCheck,
  BarChart3,
  Bot,
  Building2,
  BriefcaseBusiness,
  CircleDollarSign,
  ContactRound,
  Gauge,
  Headphones,
  Hourglass,
  KanbanSquare,
  Library,
  Megaphone,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Webhook
} from "lucide-react";

export const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "atendimento", label: "Atendimento", icon: Headphones, count: 23 },
  { id: "kanban", label: "Kanban", icon: KanbanSquare },
  { id: "contatos", label: "Contatos", icon: ContactRound },
  { id: "tags", label: "Tags", icon: Tags },
  { id: "simulacao-clt", label: "Simulacao CLT", icon: BriefcaseBusiness },
  { id: "multicred", label: "Multicred", icon: CircleDollarSign },
  { id: "canais", label: "Canais", icon: Webhook },
  { id: "templates", label: "Templates", icon: Library },
  { id: "disparos", label: "Disparos", icon: Megaphone },
  { id: "recem-aposentados", label: "Recem-Aposentados", icon: Hourglass },
  { id: "empresas", label: "Empresas", icon: Building2 },
  { id: "chatbot", label: "Chatbot", icon: Bot },
  { id: "config", label: "Configurações", icon: Settings }
] as const;

export const conversations = [
  {
    name: "Mariana Alves",
    phone: "(11) 98840-1201",
    status: "Aberto",
    tag: "FGTS",
    preview: "Cliente perguntou sobre liberacao e prazo.",
    score: 91
  },
  {
    name: "Carlos Mendes",
    phone: "(31) 97718-8840",
    status: "Pendente",
    tag: "CLT",
    preview: "Aguardando envio de documento.",
    score: 68
  },
  {
    name: "Sueli Barbosa",
    phone: "(61) 99630-0021",
    status: "Robo",
    tag: "INSS",
    preview: "Fluxo de qualificacao em andamento.",
    score: 44
  }
];

export const contacts = [
  {
    name: "Mariana Alves",
    phone: "(11) 98840-1201",
    origin: "Trafego pago",
    owner: "Aline",
    temperature: "Quente",
    updatedAt: "ha 12 min"
  },
  {
    name: "Carlos Mendes",
    phone: "(31) 97718-8840",
    origin: "WhatsApp",
    owner: "Bruno",
    temperature: "Morno",
    updatedAt: "ha 1 h"
  },
  {
    name: "Sueli Barbosa",
    phone: "(61) 99630-0021",
    origin: "Carteira",
    owner: "Robo",
    temperature: "Frio",
    updatedAt: "ontem"
  }
];

export const pipeline = [
  {
    name: "Novo lead",
    color: "bg-sky-600",
    cards: ["Mariana Alves", "Paulo Henrique"]
  },
  {
    name: "Qualificando",
    color: "bg-amber-600",
    cards: ["Carlos Mendes"]
  },
  {
    name: "Proposta",
    color: "bg-teal-700",
    cards: ["Sueli Barbosa", "Renato Lima"]
  },
  {
    name: "Ganho",
    color: "bg-emerald-700",
    cards: ["Ana Clara"]
  }
];

export const multicredStats = [
  { label: "Producao total", value: "R$ 84.250", icon: BarChart3 },
  { label: "A formalizar", value: "R$ 18.900", icon: BriefcaseBusiness },
  { label: "Comissao prevista", value: "R$ 7.420", icon: BadgeCheck },
  { label: "Oportunidades IA", value: "16", icon: Sparkles }
];

export const settings = [
  { title: "Empresa", detail: "Dados, segmento e contexto para IA." },
  { title: "Tags", detail: "Classificacao de contatos e conversas." },
  { title: "Kanban", detail: "Etapas por produto e regra comercial." },
  { title: "Permissoes", detail: "Perfis de admin, supervisor e agente." },
  { title: "Seguranca", detail: "Senha, 2FA e sessoes." },
  { title: "APIs", detail: "OpenAI, WhatsApp, higienizacao e webhooks." }
];

export const aiActions = [
  "Responder com simulacao simples e pedir confirmacao do CPF.",
  "Mover lead para Proposta se enviar documento hoje.",
  "Criar follow-up em 2 horas para leads quentes sem resposta.",
  "Priorizar contatos de trafego pago com score acima de 80."
];

export { MessageSquareText, ShieldCheck, Sparkles, Tags };
