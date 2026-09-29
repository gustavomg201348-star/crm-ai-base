import type { NextRequest } from "next/server";
import { handleContactImportConfirm } from "@/lib/contact-import-confirm-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleContactImportConfirm(request);
}
