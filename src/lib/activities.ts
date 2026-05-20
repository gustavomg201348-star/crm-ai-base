import type { Prisma } from "@prisma/client";

export const activityInclude = {
  user: { select: { id: true, name: true, email: true } }
} satisfies Prisma.ContactActivityInclude;

export type ActivityWithRelations = Prisma.ContactActivityGetPayload<{
  include: typeof activityInclude;
}>;

export function mapActivity(activity: ActivityWithRelations) {
  return {
    id: activity.id,
    contactId: activity.contactId,
    type: activity.type,
    title: activity.title,
    detail: activity.detail,
    createdAt: activity.createdAt,
    user: activity.user
      ? {
          id: activity.user.id,
          name: activity.user.name,
          email: activity.user.email
        }
      : null
  };
}

export async function createActivity(
  prisma: Prisma.TransactionClient,
  data: {
    contactId: string;
    userId?: string | null;
    type: string;
    title: string;
    detail?: string | null;
  }
) {
  return prisma.contactActivity.create({
    data: {
      contactId: data.contactId,
      userId: data.userId ?? null,
      type: data.type,
      title: data.title,
      detail: data.detail?.trim() || null
    }
  });
}
