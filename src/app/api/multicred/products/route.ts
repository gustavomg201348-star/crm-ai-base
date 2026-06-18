import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildMulticredProductData,
  ensureDefaultMulticredCatalog,
  mapMulticredProduct,
  multicredProductInclude
} from "@/lib/multicred-products";
import { requireCompanyAdmin } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar produtos Multicred." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });
    }

    const data = buildMulticredProductData(body);

    if (!data.bankName) {
      return NextResponse.json({ error: "Nome do banco e obrigatorio." }, { status: 400 });
    }

    if (!data.agreement) {
      return NextResponse.json({ error: "Convenio e obrigatorio." }, { status: 400 });
    }

    if (!data.product) {
      return NextResponse.json({ error: "Produto e obrigatorio." }, { status: 400 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel salvar produto Multicred." },
      { status: 500 }
    );
  }
}
