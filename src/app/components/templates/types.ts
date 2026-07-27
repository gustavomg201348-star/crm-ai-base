export type TemplateVisualState = "loading" | "empty" | "error" | "list-empty";

export type TemplateListItem = {
  id: string;
  name: string;
  category: string;
  language: string;
  metaStatus: string;
  operationalStatus: string;
  channelLabel: string;
  updatedAt: string;
};
