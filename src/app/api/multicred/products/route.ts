import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import {
  buildMulticredProductData,
  ensureDefaultMulticredCatalog,
  mapMulticredProduct,
  multicredProductInclude
} from "@/lib/multicred-products";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    await ensureDefaultMulticredCatalog(session.companyId);

    const products = await prisma.multicredProduct.findMany({
      where: {
        companyId: session.companyId,
        isActive: true,
        bank: { isActive: true }
      },
      include: multicredProductInclude,
      orderBy: [
        { bank: { position: "asc" } },
        { position: "asc" },
        { bank: { name: "asc" } },
        { name: "asc" }
      ]
    });

    return NextResponse.json({ products: products.map(mapMulticredProduct) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/products",
      method: "GET",
      publicErrorCode: "MULTICRED_PRODUCT_LIST_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_PRODUCT_LIST_FAILED", status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const data = buildMulticredProductData(body);

    if (!data.bankName) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (!data.agreement) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (!data.product) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const existingBank = await prisma.multicredBank.findFirst({
      where: {
        companyId: session.companyId,
        name: data.bankName
      }
    });
    const bank = existingBank
      ? await prisma.multicredBank.update({
          where: { id: existingBank.id },
          data: {
            code: data.bankCode,
            category: data.bankCategory,
            color: data.bankColor,
            isActive: true
          }
        })
      : await prisma.multicredBank.create({
          data: {
            companyId: session.companyId,
            name: data.bankName,
            code: data.bankCode,
            category: data.bankCategory,
            color: data.bankColor
          }
        });

    const product = await prisma.multicredProduct.upsert({
      where: {
        companyId_bankId_agreement_name: {
          companyId: session.companyId,
          bankId: bank.id,
          agreement: data.agreement,
          name: data.product
        }
      },
      update: {
        description: data.description,
        isActive: data.isActive
      },
      create: {
        companyId: session.companyId,
        bankId: bank.id,
        agreement: data.agreement,
        name: data.product,
        description: data.description,
        isActive: data.isActive
      },
      include: multicredProductInclude
    });

    return NextResponse.json({ product: mapMulticredProduct(product) }, { status: 201 });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/products",
      method: "POST",
      publicErrorCode: "MULTICRED_PRODUCT_SAVE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_PRODUCT_SAVE_FAILED", status: 500 });
  }
}
