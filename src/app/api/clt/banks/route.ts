import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { cltBanks } from "@/lib/clt-integration";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  return NextResponse.json({ banks: cltBanks });
}
