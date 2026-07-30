import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { cltBanks } from "@/lib/clt-integration";
import { publicErrorResponse } from "@/lib/http-error-response";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
  }

  return NextResponse.json({ banks: cltBanks });
}
