import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  createImageHeaderTemplate,
  MetaTemplateCreationServiceError,
  type MetaTemplateButtonInput,
  type MetaTemplateCreationRecoveryContext,
  type MetaTemplateCreationServiceErrorCode
} from "@/lib/meta-template-creation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CHANNEL_NOT_FOUND"
  | "MISSING_META_CREDENTIALS"
  | "INVALID_MULTIPART"
  | "INVALID_UPLOAD"
  | "INVALID_BODY_EXAMPLES"
  | "INVALID_BUTTONS"
  | "META_TEMPLATE_CONFLICT"
  | "META_RATE_LIMIT"
  | "LOCAL_PERSISTENCE_FAILED"
  | "INTERNAL_ERROR"
  | MetaTemplateCreationServiceErrorCode;

type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

type SafeRecoveryContext = Pick<
  MetaTemplateCreationRecoveryContext,
  "mediaAssetId" | "metaTemplateId" | "name" | "language" | "wabaId"
>;

function errorResponse({
  code,
  message,
  status,
  requiresManualReconciliation,
  recoveryContext
}: {
  code: ErrorCode;
  message: string;
  status: number;
  requiresManualReconciliation?: boolean;
  recoveryContext?: SafeRecoveryContext;
}) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(requiresManualReconciliation ? { requiresManualReconciliation } : {}),
        ...(recoveryContext ? { recoveryContext } : {})
      }
    },
    { status }
  );
}

function readRequiredText(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalText(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  return normalized || undefined;
}

function readCategory(formData: FormData): TemplateCategory | null {
  const category = readRequiredText(formData, "category").toUpperCase();

  if (
    category === "UTILITY" ||
    category === "MARKETING" ||
    category === "AUTHENTICATION"
  ) {
    return category;
  }

  return null;
}

function readOptionalJsonField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(fieldName);
  }

  const normalized = value.trim();
  if (!normalized) return undefined;

  return JSON.parse(normalized) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBodyExamples(formData: FormData) {
  try {
    const parsed = readOptionalJsonField(formData, "bodyExamples");
    if (parsed === undefined) return undefined;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (row) => !Array.isArray(row) || row.some((item) => typeof item !== "string")
      )
    ) {
      throw new Error("bodyExamples");
    }

    return parsed as string[][];
  } catch {
    throw new Error("bodyExamples");
  }
}

function readButtonItem(value: unknown): MetaTemplateButtonInput {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.text !== "string") {
    throw new Error("buttons");
  }

  if (value.type === "QUICK_REPLY") {
    return {
      type: "QUICK_REPLY",
      text: value.text
    };
  }

  if (value.type === "URL" && typeof value.url === "string") {
    return {
      type: "URL",
      text: value.text,
      url: value.url
    };
  }

  if (value.type === "PHONE_NUMBER" && typeof value.phone_number === "string") {
    return {
      type: "PHONE_NUMBER",
      text: value.text,
      phone_number: value.phone_number
    };
  }

  throw new Error("buttons");
}

function readButtons(formData: FormData) {
  try {
    const parsed = readOptionalJsonField(formData, "buttons");
    if (parsed === undefined) return undefined;
    if (!Array.isArray(parsed)) {
      throw new Error("buttons");
    }

    return parsed.map(readButtonItem);
  } catch {
    throw new Error("buttons");
  }
}

function sanitizeRecoveryContext(
  recoveryContext?: MetaTemplateCreationRecoveryContext
): SafeRecoveryContext | undefined {
  if (!recoveryContext) return undefined;

  const safe: SafeRecoveryContext = {};

  if (recoveryContext.mediaAssetId) safe.mediaAssetId = recoveryContext.mediaAssetId;
  if (recoveryContext.metaTemplateId) safe.metaTemplateId = recoveryContext.metaTemplateId;
  if (recoveryContext.name) safe.name = recoveryContext.name;
  if (recoveryContext.language) safe.language = recoveryContext.language;
  if (recoveryContext.wabaId) safe.wabaId = recoveryContext.wabaId;

  return Object.keys(safe).length ? safe : undefined;
}

function readCauseCode(error: MetaTemplateCreationServiceError) {
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;

  const code = cause.code;
  return typeof code === "string" ? code : null;
}

function mapServiceError(error: MetaTemplateCreationServiceError) {
  const causeCode = readCauseCode(error);

  if (causeCode === "META_CONFLICT") {
    return errorResponse({
      code: "META_TEMPLATE_CONFLICT",
      message: "Ja existe um template Meta com estes dados.",
      status: 409
    });
  }

  if (causeCode === "META_RATE_LIMIT") {
    return errorResponse({
      code: "META_RATE_LIMIT",
      message: "A Meta limitou temporariamente esta operacao. Tente novamente mais tarde.",
      status: 429
    });
  }

  if (error.stage === "VALIDATION" || error.stage === "STORAGE") {
    return errorResponse({
      code: error.code,
      message: error.message,
      status: 400
    });
  }

  if (
    error.stage === "MEDIA_ASSET_PERSIST" ||
    error.stage === "MEDIA_ASSET_UPDATE" ||
    error.stage === "META_TEMPLATE_PERSIST"
  ) {
    return errorResponse({
      code: "LOCAL_PERSISTENCE_FAILED",
      message: "O template pode ter sido criado na Meta, mas nao foi concluido localmente.",
      status: 500,
      requiresManualReconciliation: true,
      recoveryContext: sanitizeRecoveryContext(error.recoveryContext)
    });
  }

  return errorResponse({
    code: error.code,
    message: error.retryable
      ? "Falha temporaria ao comunicar com a Meta."
      : "Nao foi possivel criar o template na Meta.",
    status: error.retryable ? 503 : 502
  });
}

function mapSuccess(result: Awaited<ReturnType<typeof createImageHeaderTemplate>>) {
  return {
    template: {
      id: result.metaTemplateLocalId,
      metaTemplateId: result.metaTemplateId,
      name: result.name,
      language: result.language,
      category: result.category,
      metaStatus: result.metaStatus,
      operationalStatus: result.operationalStatus,
      defaultHeaderMediaAssetId: result.defaultHeaderMediaAssetId
    },
    media: {
      id: result.mediaAssetId,
      fileName: result.media.originalFileName,
      mimeType: result.media.mimeType,
      sizeBytes: result.media.sizeBytes
    }
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return errorResponse({
        code: "UNAUTHENTICATED",
        message: "Nao autenticado.",
        status: 401
      });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) {
      return errorResponse({
        code: "FORBIDDEN",
        message: "Voce nao tem permissao para acessar este recurso.",
        status: 403
      });
    }

    const { id } = await params;
    const channel = await prisma.channel.findFirst({
      where: {
        id,
        companyId: session.companyId,
        type: "whatsapp",
        provider: "meta"
      },
      select: {
        id: true,
        wabaId: true,
        accessToken: true
      }
    });

    if (!channel) {
      return errorResponse({
        code: "CHANNEL_NOT_FOUND",
        message: "Canal nao encontrado.",
        status: 404
      });
    }

    const accessToken = channel.accessToken?.trim();
    const wabaId = channel.wabaId?.trim();
    const appId = process.env.META_APP_ID?.trim();

    if (!accessToken || !wabaId || !appId) {
      return errorResponse({
        code: "MISSING_META_CREDENTIALS",
        message: "As credenciais da integracao Meta estao incompletas.",
        status: 400
      });
    }

    let formData: FormData;

    try {
      formData = await request.formData();
    } catch {
      return errorResponse({
        code: "INVALID_MULTIPART",
        message: "Envie os dados como multipart/form-data.",
        status: 400
      });
    }

    const image = formData.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return errorResponse({
        code: "INVALID_UPLOAD",
        message: "Imagem obrigatoria.",
        status: 400
      });
    }

    let bodyExamples: string[][] | undefined;
    let buttons: MetaTemplateButtonInput[] | undefined;

    try {
      bodyExamples = readBodyExamples(formData);
    } catch {
      return errorResponse({
        code: "INVALID_BODY_EXAMPLES",
        message: "bodyExamples deve ser um JSON valido no formato string[][].",
        status: 400
      });
    }

    try {
      buttons = readButtons(formData);
    } catch {
      return errorResponse({
        code: "INVALID_BUTTONS",
        message: "buttons deve ser um JSON valido no formato esperado.",
        status: 400
      });
    }

    const category = readCategory(formData);
    if (!category) {
      return errorResponse({
        code: "INVALID_CATEGORY",
        message: "Categoria do template invalida.",
        status: 400
      });
    }

    const bytes = Buffer.from(await image.arrayBuffer());
    const result = await createImageHeaderTemplate({
      companyId: session.companyId,
      channelId: channel.id,
      appId,
      accessToken,
      wabaId,
      name: readRequiredText(formData, "name"),
      language: readRequiredText(formData, "language"),
      category,
      bodyText: readRequiredText(formData, "bodyText"),
      footerText: readOptionalText(formData, "footerText"),
      bodyExamples,
      buttons,
      image: {
        fileName: image.name,
        mimeType: image.type,
        bytes
      }
    });

    return NextResponse.json(mapSuccess(result), { status: 201 });
  } catch (error) {
    if (error instanceof MetaTemplateCreationServiceError) {
      return mapServiceError(error);
    }

    return errorResponse({
      code: "INTERNAL_ERROR",
      message: "Nao foi possivel criar o template Meta.",
      status: 500
    });
  }
}
