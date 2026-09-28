import type { NextRequest } from "next/server";
import { handleContactImportPreview } from "@/lib/contact-import-preview-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleContactImportPreview(request);
}
