import type { SessionUser } from "@/lib/auth";
import type { mapNotification } from "@/lib/notifications";

type NotificationPayload = ReturnType<typeof mapNotification>;

type Client = {
  id: string;
  companyId: string;
  userId: string;
  send: (event: string, payload: unknown) => void;
};

const globalForNotifications = globalThis as typeof globalThis & {
  crmNotificationClients?: Map<string, Client>;
};

const clients =
  globalForNotifications.crmNotificationClients ?? new Map<string, Client>();

globalForNotifications.crmNotificationClients = clients;

function clientCanReceive(
  client: Client,
  companyId: string,
  targetUserId?: string | null
) {
  return (
    client.companyId === companyId &&
    (!targetUserId || targetUserId === client.userId)
  );
}

export function registerNotificationClient({
  session,
  send
}: {
  session: SessionUser;
  send: Client["send"];
}) {
  const id = crypto.randomUUID();
  clients.set(id, {
    id,
    companyId: session.companyId,
    userId: session.id,
    send
  });

  return () => {
    clients.delete(id);
  };
}

export function publishInboundNotification({
  companyId,
  userId,
  notification
}: {
  companyId: string;
  userId?: string | null;
  notification: NotificationPayload;
}) {
  Array.from(clients.values()).forEach((client) => {
    if (clientCanReceive(client, companyId, userId)) {
      client.send("new_inbound_message", notification);
    }
  });
}
