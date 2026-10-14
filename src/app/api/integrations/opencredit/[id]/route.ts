import { openCreditManagement } from "@/lib/opencredit-management";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return openCreditManagement.PATCH(request, context);
}
