import type { Prisma } from "@prisma/client";

export type TaskStatus = "PENDING" | "DONE";

export const taskInclude = {
  contact: { select: { id: true, name: true, phone: true } },
  assignee: { select: { id: true, name: true, email: true } }
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: typeof taskInclude;
}>;

export function mapTask(task: TaskWithRelations) {
  return {
    id: task.id,
    contactId: task.contactId,
    assigneeId: task.assigneeId,
    title: task.title,
    note: task.note,
    dueAt: task.dueAt,
    status: task.status as TaskStatus,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    contact: task.contact,
    assignee: task.assignee
  };
}
