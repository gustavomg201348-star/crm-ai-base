import { openCreditManagement } from "@/lib/opencredit-management";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return openCreditManagement.ROTATE(request, context);
}
