import type { SessionUser } from "@/lib/auth";
import { canAccessConversation } from "@/lib/permissions";

export type ConversationAccessDb = {
  conversation: {
    findFirst(args: {
      where: {
        id: string;
        contact: { companyId: string };
      };
      select: { id: true; agentId: true };
    }): Promise<{ id: string; agentId: string | null } | null>;
  };
};

export type ConversationAccessResult =
  | { status: "allowed"; conversation: { id: string; agentId: string | null } }
  | { status: "forbidden"; conversation: { id: string; agentId: string | null } }
  | { status: "not_found" };

export async function resolveConversationAccess({
  db,
  session,
  conversationId
}: {
  db: ConversationAccessDb;
  session: SessionUser;
  conversationId: string;
}): Promise<ConversationAccessResult> {
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId: session.companyId }
    },
    select: { id: true, agentId: true }
  });

  if (!conversation) {
    return { status: "not_found" };
  }

  if (!canAccessConversation({ session, agentId: conversation.agentId })) {
    return { status: "forbidden", conversation };
  }

  return { status: "allowed", conversation };
}
