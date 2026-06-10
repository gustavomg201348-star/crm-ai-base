import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function preview(body) {
  return String(body || "").trim().slice(0, 500);
}

async function main() {
  const conversations = await prisma.conversation.findMany({
    select: {
      id: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      contactId: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          body: true,
          createdAt: true
        }
      }
    }
  });

  let checked = 0;
  let updated = 0;

  for (const conversation of conversations) {
    checked += 1;
    const lastMessage = conversation.messages[0];
    if (!lastMessage) continue;

    const isStale =
      !conversation.lastMessageAt ||
      lastMessage.createdAt.getTime() > conversation.lastMessageAt.getTime() ||
      preview(conversation.lastMessagePreview) !== preview(lastMessage.body);

    if (!isStale) continue;

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: lastMessage.createdAt,
        lastMessagePreview: preview(lastMessage.body),
        updatedAt: lastMessage.createdAt,
        contact: {
          update: {
            lastMessage: preview(lastMessage.body)
          }
        }
      }
    });

    updated += 1;
    console.log(
      `[conversation-activity-backfill] ${conversation.id} -> ${lastMessage.createdAt.toISOString()} (${lastMessage.id})`
    );
  }

  console.log(
    `[conversation-activity-backfill] checked=${checked} updated=${updated}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
