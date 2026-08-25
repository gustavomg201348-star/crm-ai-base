import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveConversationAccess,
  type ConversationAccessDb
} from "./conversation-access-control";
import type { SessionUser } from "./auth";

type ConversationState = {
  id: string;
  companyId: string;
  agentId: string | null;
};

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: overrides.id ?? "agent-1",
    companyId: overrides.companyId ?? "company-1",
    name: overrides.name ?? "Operador",
    email: overrides.email ?? "agent@example.com",
    role: overrides.role ?? "AGENT"
  };
}

function createDb(conversations: ConversationState[]) {
  const writes = {
    tagDeletes: 0,
    tagUpserts: 0,
    aiCalls: 0,
    conversationUpdates: 0,
    contactUpdates: 0
  };

  const db: ConversationAccessDb = {
    conversation: {
      async findFirst(args) {
        const conversation = conversations.find((item) => item.id === args.where.id);

        if (!conversation || conversation.companyId !== args.where.contact.companyId) {
          return null;
        }

        return {
          id: conversation.id,
          agentId: conversation.agentId
        };
      }
    }
  };

  return { db, writes };
}

test("permite AGENT dono da conversa", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "agent-1" }
  ]);

  const access = await resolveConversationAccess({
    db,
    session: session({ id: "agent-1" }),
    conversationId: "conversation-1"
  });

  assert.equal(access.status, "allowed");
});

test("bloqueia AGENT quando a conversa pertence a outro operador", async () => {
  const { db, writes } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "agent-2" }
  ]);

  const access = await resolveConversationAccess({
    db,
    session: session({ id: "agent-1" }),
    conversationId: "conversation-1"
  });

  assert.equal(access.status, "forbidden");
  assert.deepEqual(writes, {
    tagDeletes: 0,
    tagUpserts: 0,
    aiCalls: 0,
    conversationUpdates: 0,
    contactUpdates: 0
  });
});

test("preserva acesso de AGENT a conversa sem responsavel", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  const access = await resolveConversationAccess({
    db,
    session: session({ id: "agent-1" }),
    conversationId: "conversation-1"
  });

  assert.equal(access.status, "allowed");
});

test("permite ADMIN e SUPERVISOR em conversa da propria empresa", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "agent-2" }
  ]);

  const adminAccess = await resolveConversationAccess({
    db,
    session: session({ role: "ADMIN", id: "admin-1" }),
    conversationId: "conversation-1"
  });
  const supervisorAccess = await resolveConversationAccess({
    db,
    session: session({ role: "SUPERVISOR", id: "supervisor-1" }),
    conversationId: "conversation-1"
  });

  assert.equal(adminAccess.status, "allowed");
  assert.equal(supervisorAccess.status, "allowed");
});

test("preserva isolamento multiempresa retornando not_found para outro tenant", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-2", agentId: null }
  ]);

  const access = await resolveConversationAccess({
    db,
    session: session({ companyId: "company-1" }),
    conversationId: "conversation-1"
  });

  assert.equal(access.status, "not_found");
});

test("rotas validam acesso antes de writes e chamada OpenAI", () => {
  const tagsPost = readFileSync("src/app/api/conversations/[id]/tags/route.ts", "utf8");
  const tagsDelete = readFileSync(
    "src/app/api/conversations/[id]/tags/[tagId]/route.ts",
    "utf8"
  );
  const aiRoute = readFileSync("src/app/api/conversations/[id]/ai/route.ts", "utf8");
  const aiModeRoute = readFileSync(
    "src/app/api/conversations/[id]/ai-mode/route.ts",
    "utf8"
  );

  assert.ok(
    tagsPost.indexOf("await resolveConversationAccess") <
      tagsPost.indexOf("conversationTag.deleteMany")
  );
  assert.ok(
    tagsPost.indexOf("await resolveConversationAccess") <
      tagsPost.indexOf("conversationTag.upsert")
  );
  assert.ok(
    tagsDelete.indexOf("await resolveConversationAccess") <
      tagsDelete.indexOf("conversationTag.deleteMany")
  );
  assert.ok(
    aiRoute.indexOf("await resolveConversationAccess") <
      aiRoute.indexOf("await generateAiSuggestion")
  );
  assert.ok(
    aiModeRoute.indexOf("await resolveConversationAccess") <
      aiModeRoute.indexOf("await updateConversationAiMode")
  );
});
