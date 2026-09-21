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
