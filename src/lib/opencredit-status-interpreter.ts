/** Validated metadata only. Missing terminal must be resolved by the caller, never inferred. */
export type OpenCreditStatusMetadata = Readonly<{
  category: string;
  terminal: boolean;
  hasSignUrl?: boolean;
}>;

/** QEVORA meanings, not an exhaustive enum of provider categories. */
export type OpenCreditStatusMeaning =
  | "IN_PROGRESS"
  | "ACTION_REQUIRED"
  | "SUCCESS"
  | "REJECTED"
  | "CANCELED"
  | "TECHNICAL_ATTENTION"
  | "UNKNOWN";

export type OpenCreditStatusInterpretation = {
  meaning: OpenCreditStatusMeaning;
  terminal: boolean;
  shouldPoll: boolean;
  requiresSignature: boolean;
};

function meaning(category: string): OpenCreditStatusMeaning {
  switch (category) {
    case "EM_ANDAMENTO": return "IN_PROGRESS";
    case "PENDENTE": return "ACTION_REQUIRED";
    case "APROVADA": return "SUCCESS";
    case "REPROVADA": return "REJECTED";
    case "CANCELADA": return "CANCELED";
    case "ERRO": return "TECHNICAL_ATTENTION";
    default: return "UNKNOWN";
  }
}

/**
 * Pure metadata interpretation, not validation or a financial decision.
 * SUCCESS is not permission to grant credit; REJECTED is not a QEVORA decision.
 * Flags describe future actions only: no polling, navigation or sending occurs here.
 */
export function interpretOpenCreditStatus(input: OpenCreditStatusMetadata): OpenCreditStatusInterpretation {
  return {
    meaning: meaning(input.category),
    terminal: input.terminal,
    shouldPoll: !input.terminal,
    requiresSignature: input.hasSignUrl === true
  };
}
