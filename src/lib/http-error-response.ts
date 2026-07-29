import { NextResponse } from "next/server";

export type PublicErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "CONFLICT"
  | "META_PROVIDER_ERROR"
  | "MEDIA_FETCH_FAILED"
  | "TEMPLATE_FETCH_FAILED"
  | "MESSAGE_SEND_FAILED"
  | "INTERNAL_ERROR";

const DEFAULT_PUBLIC_MESSAGES: Record<PublicErrorCode, string> = {
  UNAUTHENTICATED: "Autenticacao necessaria.",
  FORBIDDEN: "Voce nao tem permissao para acessar este recurso.",
  NOT_FOUND: "Recurso nao encontrado.",
  INVALID_REQUEST: "Requisicao invalida.",
  CONFLICT: "Nao foi possivel concluir a operacao por conflito de estado.",
  META_PROVIDER_ERROR: "Nao foi possivel concluir a operacao na Meta.",
  MEDIA_FETCH_FAILED: "Nao foi possivel carregar a midia.",
  TEMPLATE_FETCH_FAILED: "Nao foi possivel carregar templates.",
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
