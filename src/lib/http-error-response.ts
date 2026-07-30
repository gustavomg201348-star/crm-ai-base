import { NextResponse } from "next/server";

export type PublicErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "CONFLICT"
  | "CAMPAIGN_CREATE_FAILED"
  | "CAMPAIGN_START_FAILED"
  | "CAMPAIGN_RESUME_FAILED"
  | "CAMPAIGN_PAUSE_FAILED"
  | "CAMPAIGN_CANCEL_FAILED"
  | "CAMPAIGN_INVALID_STATE"
  | "CONTACT_NOT_FOUND"
  | "CONTACT_CREATE_FAILED"
  | "CONTACT_UPDATE_FAILED"
  | "CONTACT_DELETE_FAILED"
  | "CONTACT_DUPLICATE"
  | "CONTACT_BULK_UPDATE_FAILED"
  | "CONTACT_IMPORT_FAILED"
  | "CONTACT_IMPORT_INVALID_FILE"
  | "CONTACT_EXPORT_FAILED"
  | "USER_NOT_FOUND"
  | "USER_CREATE_FAILED"
  | "USER_UPDATE_FAILED"
  | "USER_DELETE_FAILED"
  | "USER_DUPLICATE"
  | "USER_INVALID_ROLE"
  | "USER_PERMISSION_DENIED"
  | "USER_SETTINGS_UPDATE_FAILED"
  | "TASK_NOT_FOUND"
  | "TASK_CREATE_FAILED"
  | "TASK_UPDATE_FAILED"
  | "TASK_DELETE_FAILED"
  | "TASK_ASSIGN_FAILED"
  | "TASK_INVALID_STATE"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_CREATE_FAILED"
  | "PROPOSAL_UPDATE_FAILED"
  | "PROPOSAL_DELETE_FAILED"
  | "PROPOSAL_INVALID_STATE"
  | "CLT_INVALID_REQUEST"
  | "CLT_INVALID_CPF"
  | "CLT_SIMULATION_FAILED"
  | "CLT_CUSTOMER_LOOKUP_FAILED"
  | "CLT_PROPOSAL_CREATE_FAILED"
  | "CLT_PROPOSAL_NOT_FOUND"
  | "CLT_PROPOSAL_CONFLICT"
  | "CLT_PROVIDER_UNAVAILABLE"
  | "CLT_PROVIDER_TIMEOUT"
  | "CLT_PROVIDER_RATE_LIMITED"
  | "CLT_PROVIDER_REJECTED"
  | "CLT_CALLBACK_INVALID"
  | "CLT_CALLBACK_PROCESSING_FAILED"
  | "META_PROVIDER_ERROR"
  | "MEDIA_FETCH_FAILED"
  | "TEMPLATE_CREATE_FAILED"
  | "TEMPLATE_FETCH_FAILED"
  | "TEMPLATE_INVALID_INPUT"
  | "MESSAGE_SEND_FAILED"
  | "INTERNAL_ERROR";

const DEFAULT_PUBLIC_MESSAGES: Record<PublicErrorCode, string> = {
  UNAUTHENTICATED: "Autenticacao necessaria.",
  FORBIDDEN: "Voce nao tem permissao para acessar este recurso.",
  NOT_FOUND: "Recurso nao encontrado.",
  INVALID_REQUEST: "Requisicao invalida.",
  CONFLICT: "Nao foi possivel concluir a operacao por conflito de estado.",
  CAMPAIGN_CREATE_FAILED: "Nao foi possivel criar campanha.",
  CAMPAIGN_START_FAILED: "Nao foi possivel iniciar campanha.",
  CAMPAIGN_RESUME_FAILED: "Nao foi possivel retomar campanha.",
  CAMPAIGN_PAUSE_FAILED: "Nao foi possivel pausar campanha.",
  CAMPAIGN_CANCEL_FAILED: "Nao foi possivel cancelar campanha.",
  CAMPAIGN_INVALID_STATE: "Nao foi possivel alterar campanha neste estado.",
  CONTACT_NOT_FOUND: "Contato nao encontrado.",
  CONTACT_CREATE_FAILED: "Nao foi possivel criar contato.",
  CONTACT_UPDATE_FAILED: "Nao foi possivel atualizar contato.",
  CONTACT_DELETE_FAILED: "Nao foi possivel remover contato.",
  CONTACT_DUPLICATE: "Ja existe um contato com estes dados.",
  CONTACT_BULK_UPDATE_FAILED: "Nao foi possivel aplicar acao em massa.",
  CONTACT_IMPORT_FAILED: "Nao foi possivel importar contatos.",
  CONTACT_IMPORT_INVALID_FILE: "Arquivo de importacao invalido.",
  CONTACT_EXPORT_FAILED: "Nao foi possivel exportar contatos.",
  USER_NOT_FOUND: "Usuario nao encontrado.",
  USER_CREATE_FAILED: "Nao foi possivel criar usuario.",
  USER_UPDATE_FAILED: "Nao foi possivel atualizar usuario.",
  USER_DELETE_FAILED: "Nao foi possivel remover usuario.",
  USER_DUPLICATE: "Ja existe um usuario com estes dados.",
  USER_INVALID_ROLE: "Funcao invalida.",
  USER_PERMISSION_DENIED: "Voce nao tem permissao para alterar este usuario.",
  USER_SETTINGS_UPDATE_FAILED: "Nao foi possivel salvar configuracoes de usuario.",
  TASK_NOT_FOUND: "Tarefa nao encontrada.",
  TASK_CREATE_FAILED: "Nao foi possivel criar tarefa.",
  TASK_UPDATE_FAILED: "Nao foi possivel atualizar tarefa.",
  TASK_DELETE_FAILED: "Nao foi possivel remover tarefa.",
  TASK_ASSIGN_FAILED: "Nao foi possivel atribuir tarefa.",
  TASK_INVALID_STATE: "Nao foi possivel alterar tarefa neste estado.",
  PROPOSAL_NOT_FOUND: "Proposta nao encontrada.",
  PROPOSAL_CREATE_FAILED: "Nao foi possivel criar proposta.",
  PROPOSAL_UPDATE_FAILED: "Nao foi possivel atualizar proposta.",
  PROPOSAL_DELETE_FAILED: "Nao foi possivel remover proposta.",
  PROPOSAL_INVALID_STATE: "Nao foi possivel alterar proposta neste estado.",
  CLT_INVALID_REQUEST: "Requisicao CLT invalida.",
  CLT_INVALID_CPF: "Informe um CPF valido.",
  CLT_SIMULATION_FAILED: "Nao foi possivel simular CLT.",
  CLT_CUSTOMER_LOOKUP_FAILED: "Nao foi possivel consultar dados CLT.",
  CLT_PROPOSAL_CREATE_FAILED: "Nao foi possivel salvar proposta CLT.",
  CLT_PROPOSAL_NOT_FOUND: "Proposta CLT nao encontrada.",
  CLT_PROPOSAL_CONFLICT: "Nao foi possivel concluir a proposta CLT por conflito.",
  CLT_PROVIDER_UNAVAILABLE: "Provider CLT indisponivel no momento.",
  CLT_PROVIDER_TIMEOUT: "Provider CLT demorou para responder.",
  CLT_PROVIDER_RATE_LIMITED: "Provider CLT temporariamente limitado.",
  CLT_PROVIDER_REJECTED: "Operacao CLT recusada pelo provider.",
  CLT_CALLBACK_INVALID: "Callback CLT invalido.",
  CLT_CALLBACK_PROCESSING_FAILED: "Nao foi possivel processar callback CLT.",
  META_PROVIDER_ERROR: "Nao foi possivel concluir a operacao na Meta.",
  MEDIA_FETCH_FAILED: "Nao foi possivel carregar a midia.",
  TEMPLATE_CREATE_FAILED: "Nao foi possivel criar template.",
  TEMPLATE_FETCH_FAILED: "Nao foi possivel carregar templates.",
  TEMPLATE_INVALID_INPUT: "Parametros invalidos.",
  MESSAGE_SEND_FAILED: "Nao foi possivel enviar mensagem.",
  INTERNAL_ERROR: "Erro interno ao processar a requisicao."
};

export function publicErrorResponse({
  code,
  status,
  message
}: {
  code: PublicErrorCode;
  status: number;
  message?: string;
}) {
  return NextResponse.json(
    {
      error: code,
      message: message ?? DEFAULT_PUBLIC_MESSAGES[code]
    },
    { status }
  );
}
