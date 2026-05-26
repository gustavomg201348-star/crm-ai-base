import { NextResponse, type NextRequest } from "next/server";
import { listAttendants } from "@/lib/lead-assignment";
import { getSessionOrUnauthorized } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const attendants = await listAttendants(session.companyId);
    return NextResponse.json({ attendants });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar atendentes." },
      { status: 500 }
    );
  }
}
