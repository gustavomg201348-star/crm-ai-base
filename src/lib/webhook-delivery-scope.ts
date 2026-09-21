export function buildMessageDeliveryScope({
  companyId,
  channelId,
  providerMessageId
}: {
  companyId: string;
  channelId: string;
  providerMessageId: string;
}) {
  return {
    providerMessageId,
    conversation: {
      channelId,
      contact: { companyId }
    }
  };
}

export function buildCampaignDeliveryScope({
  companyId,
  channelId,
  providerMessageId
}: {
  companyId: string;
  channelId: string;
  providerMessageId: string;
}) {
  return {
    providerMessageId,
    campaign: { companyId, channelId }
  };
}

export async function applyWebhookDeliveryUpdates({
  updateCampaign,
  updateMessage,
  touchChannel
}: {
  updateCampaign: () => Promise<unknown>;
  updateMessage: () => Promise<unknown>;
  touchChannel: () => Promise<unknown>;
}) {
  const [campaignUpdated, messageUpdated] = await Promise.all([
    updateCampaign(),
    updateMessage()
  ]);
  const updated = Boolean(campaignUpdated) || Boolean(messageUpdated);

  if (updated) {
    await touchChannel();
  }

  return updated;
}
