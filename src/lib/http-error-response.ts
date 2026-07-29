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
