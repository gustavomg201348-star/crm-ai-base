import { openCreditManagement } from "@/lib/opencredit-management";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return openCreditManagement.GET(request); }
export function POST(request: NextRequest) { return openCreditManagement.POST(request); }
