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
