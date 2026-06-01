import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { normalizeAiMode, updateConversationAiMode } from "@/lib/ai-attendant.service";

type RouteContext = {
  params: { id: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { mode?: string | null; paused?: boolean }
      | null;

    const conversation = await updateConversationAiMode({
      conversationId: context.params.id,
      companyId: session.companyId,
      mode:
        body?.mode === null || body?.mode === ""
          ? null
          : body?.mode
            ? normalizeAiMode(body.mode)
            : undefined,
      paused: body?.paused
    });

    return NextResponse.json({ conversation });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar modo da IA." },
      { status: 500 }
    );
  }
}
