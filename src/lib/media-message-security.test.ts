import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  saveFailedOutboundMessage,
  type FailedOutboundMessageDb
} from "./message-delivery";
import {
  resolveConversationAccess,
  type ConversationAccessDb
} from "./conversation-access-control";
import type { SessionUser } from "./auth";

type ConversationFixture = {
  id: string;
  companyId: string;
  contactId: string;
  agentId: string | null;
};

function session(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: overrides.id ?? "user-a",
    companyId: overrides.companyId ?? "company-a",
    name: overrides.name ?? "User A",
    email: overrides.email ?? "user-a@example.test",
    role: overrides.role ?? "AGENT"
  };
}

function createFixtureDb(conversations: ConversationFixture[]) {
  const writes = { messages: 0, conversations: 0, contacts: 0 };

  const accessDb: ConversationAccessDb = {
    conversation: {
      async findFirst(args) {
        const item = conversations.find(
          (conversation) =>
            conversation.id === args.where.id &&
            conversation.companyId === args.where.contact.companyId
        );
        return item ? { id: item.id, agentId: item.agentId } : null;
      }
    }
  };

  const deliveryDb: FailedOutboundMessageDb = {
    conversation: {
      async findFirst(args) {
        const item = conversations.find(
          (conversation) =>
            conversation.id === args.where.id &&
            conversation.companyId === args.where.contact.companyId
        );
        return item ? { id: item.id, contactId: item.contactId } : null;
      }
    },
    async $transaction(callback) {
      return callback({
        message: {
          async create() {
            writes.messages += 1;
            return { id: "failed-message" } as never;
          }
        },
        conversation: {
          async update() {
            writes.conversations += 1;
            writes.contacts += 1;
            return {};
          }
        }
      });
    }
  };

  return { accessDb, deliveryDb, writes };
}

const conversations: ConversationFixture[] = [
  {
    id: "conversation-a",
    companyId: "company-a",
    contactId: "contact-a",
    agentId: "user-a"
  },
  {
    id: "conversation-b",
    companyId: "company-b",
    contactId: "contact-b",
    agentId: "user-b"
  },
  {
    id: "conversation-a-other-agent",
    companyId: "company-a",
    contactId: "contact-a-other-agent",
    agentId: "user-a-2"
  }
];

async function saveFailure(db: FailedOutboundMessageDb, conversationId: string) {
  return saveFailedOutboundMessage(
    {
      companyId: "company-a",
      conversationId,
      body: "Falha ao enviar midia.",
      type: "document",
      errorMessage: "Falha ao enviar midia."
    },
    db
  );
}

test("multipart invalido apos autorizacao pode registrar falha na conversa autorizada", async () => {
  const { accessDb, deliveryDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "conversation-a"
  });
  assert.equal(access.status, "allowed");
  await saveFailure(deliveryDb, "conversation-a");
  assert.deepEqual(writes, { messages: 1, conversations: 1, contacts: 1 });
});

test("multipart invalido cross-tenant produz zero Message writes", async () => {
  const { accessDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "conversation-b"
  });
  assert.equal(access.status, "not_found");
  assert.equal(writes.messages, 0);
});

test("multipart invalido cross-tenant produz zero Conversation updates", async () => {
  const { accessDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "conversation-b"
  });
  assert.equal(access.status, "not_found");
  assert.equal(writes.conversations, 0);
});

test("multipart invalido cross-tenant produz zero Contact updates", async () => {
  const { accessDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "conversation-b"
  });
  assert.equal(access.status, "not_found");
  assert.equal(writes.contacts, 0);
});

test("conversation id inexistente produz zero writes", async () => {
  const { accessDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "missing"
  });
  assert.equal(access.status, "not_found");
  assert.deepEqual(writes, { messages: 0, conversations: 0, contacts: 0 });
});

test("usuario sem acesso no mesmo tenant produz zero writes", async () => {
  const { accessDb, writes } = createFixtureDb(conversations);
  const access = await resolveConversationAccess({
    db: accessDb,
    session: session(),
    conversationId: "conversation-a-other-agent"
  });
  assert.equal(access.status, "forbidden");
  assert.deepEqual(writes, { messages: 0, conversations: 0, contacts: 0 });
});

test("helper recusa conversation de outro tenant e nao inicia transaction", async () => {
  const { deliveryDb, writes } = createFixtureDb(conversations);
  const result = await saveFailure(deliveryDb, "conversation-b");
  assert.equal(result, null);
  assert.deepEqual(writes, { messages: 0, conversations: 0, contacts: 0 });
});

test("rota resolve acesso antes de interpretar multipart", () => {
  const source = readFileSync(
    "src/app/api/conversations/[id]/messages/media/route.ts",
    "utf8"
  );
  assert.ok(source.indexOf("await resolveConversationAccess") < source.indexOf("request.formData()"));
});

test("catch da rota de media nao usa id bruto para persistir falha", () => {
  const source = readFileSync(
    "src/app/api/conversations/[id]/messages/media/route.ts",
    "utf8"
  );
  const catchSource = source.slice(source.indexOf("} catch (error)"));
  const failedWriteSource = catchSource.slice(0, catchSource.indexOf("safeLogError"));
  assert.ok(catchSource.includes("if (authorizedConversation)"));
  assert.ok(failedWriteSource.includes("conversationId: authorizedConversation.id"));
  assert.ok(!failedWriteSource.includes("conversationId: context.params.id"));
});

test("fluxo autorizado preserva envio e falha de provider scoped", () => {
  const source = readFileSync(
    "src/app/api/conversations/[id]/messages/media/route.ts",
    "utf8"
  );
  assert.ok(source.includes("await sendConversationMedia"));
  assert.ok(source.includes("conversationId: authorizedConversation.id"));
  assert.ok(source.includes("companyId: authorizedConversation.companyId"));
  assert.ok(source.includes("await saveFailedOutboundMessage"));
});
