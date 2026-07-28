import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { requireCompanyAdmin } from "@/lib/permissions";
import {
  listAdminTemplateLibrary,
  MetaTemplateServiceError,
  type AdminTemplateListFilters
} from "@/lib/meta-template-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class TemplateListQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateListQueryError";
  }
}

function readOptionalText(searchParams: URLSearchParams, fieldName: string) {
  const value = searchParams.get(fieldName);
  if (value === null) return undefined;

  const normalized = value.trim();
  return normalized || undefined;
}

function readPositiveIntegerParam({
  searchParams,
  fieldName,
  defaultValue,
  maxValue
}: {
  searchParams: URLSearchParams;
  fieldName: string;
  defaultValue: number;
  maxValue?: number;
}) {
  const value = searchParams.get(fieldName);
  if (value === null) return defaultValue;

  if (!/^\d+$/.test(value)) {
    throw new TemplateListQueryError(`${fieldName} invalido.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maxValue && parsed > maxValue)) {
    throw new TemplateListQueryError(`${fieldName} invalido.`);
  }

  return parsed;
}

function readHasImage(searchParams: URLSearchParams) {
  const value = searchParams.get("hasImage");
  if (value === null) return undefined;

  if (value === "true") return true;
  if (value === "false") return false;

  throw new TemplateListQueryError("hasImage invalido.");
}

function readTemplateListFilters(searchParams: URLSearchParams) {
  const filters: AdminTemplateListFilters = {
    q: readOptionalText(searchParams, "q"),
    channelId: readOptionalText(searchParams, "channelId"),
    category: readOptionalText(searchParams, "category"),
    language: readOptionalText(searchParams, "language"),
    metaStatus: readOptionalText(searchParams, "metaStatus"),
    operationalStatus: readOptionalText(searchParams, "operationalStatus"),
    hasImage: readHasImage(searchParams)
  };
  const page = readPositiveIntegerParam({
    searchParams,
    fieldName: "page",
    defaultValue: 1
  });
  const pageSize = readPositiveIntegerParam({
    searchParams,
    fieldName: "pageSize",
    defaultValue: 25,
    maxValue: 100
  });

  return { filters, page, pageSize };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { filters, page, pageSize } = readTemplateListFilters(
      request.nextUrl.searchParams
    );
    const result = await listAdminTemplateLibrary({
      companyId: session.companyId,
      ...filters,
      page,
      pageSize
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TemplateListQueryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof MetaTemplateServiceError) {
      if (error.code === "CHANNEL_NOT_FOUND") {
        return NextResponse.json({ error: "Canal nao encontrado." }, { status: 404 });
      }

      if (error.code === "INVALID_INPUT") {
        return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
      }
    }

    return NextResponse.json(
      { error: "Nao foi possivel carregar os templates." },
      { status: 500 }
    );
  }
}
