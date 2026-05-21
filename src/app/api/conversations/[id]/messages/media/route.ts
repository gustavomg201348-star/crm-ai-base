import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { maxMediaSize, sendConversationMedia } from "@/lib/whatsapp-media.service";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const caption = formData.get("caption");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo obrigatorio." }, { status: 400 });
    }

    if (file.size > maxMediaSize) {
      return NextResponse.json(
        { error: "Arquivo acima do limite de 16 MB." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const conversation = await sendConversationMedia({
      conversationId: context.params.id,
      companyId: session.companyId,
      userId: session.id,
      fileName: file.name || "arquivo",
      mimeType: file.type || "application/octet-stream",
      bytes,
      caption: typeof caption === "string" ? caption : undefined
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar midia."
      },
      { status: 500 }
    );
  }
}
