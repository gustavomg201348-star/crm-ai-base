import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { sendConversationTemplate } from "@/lib/whatsapp-template.service";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          templateName?: string;
          language?: string;
          variables?: string[];
        }
      | null;

    if (!body?.templateName || !body.language) {
      return NextResponse.json(
        { error: "Template e idioma sao obrigatorios." },
        { status: 400 }
      );
    }

    const conversation = await sendConversationTemplate({
      conversationId: context.params.id,
      companyId: session.companyId,
      userId: session.id,
      templateName: body.templateName,
      language: body.language,
      variables: body.variables ?? []
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar template."
      },
      { status: 500 }
    );
  }
}
