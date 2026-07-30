export type TemplateListItem = {
  id: string;
  name: string;
  category: string | null;
  language: string;
  metaStatus: string | null;
  operationalStatus: string;
  channelLabel: string;
  hasImage: boolean;
  requiresHeaderMedia: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplatePagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type TemplateListResponse = {
  templates: TemplateListItem[];
  pagination: TemplatePagination;
};

export type TemplateHeaderContent = {
  present: boolean;
  format: string | null;
  text: string;
  variables: number[];
  exampleText: string[];
  requiresMedia: boolean;
  mediaType: "image" | "video" | "document" | "location" | null;
};

export type TemplateBodyContent = {
  text: string;
  variables: number[];
  exampleValues: string[][];
};

export type TemplateFooterContent = {
  text: string;
};

export type TemplateButtonContent = {
  type: string;
  text: string;
  url: string | null;
  phoneNumber: string | null;
  variables: number[];
  exampleValues: string[];
  isDynamicUrl: boolean;
};

export type TemplateCompatibility = {
  canSendWithCurrentBuilder: boolean;
  requiresHeaderMediaConfiguration: boolean;
  hasUnsupportedDynamicHeader: boolean;
  hasUnsupportedDynamicButtons: boolean;
  unsupportedReasons: string[];
};

export type TemplateDetail = TemplateListItem & {
  headerFormat: string | null;
  content: {
    header: TemplateHeaderContent;
    body: TemplateBodyContent;
    footer: TemplateFooterContent;
    buttons: TemplateButtonContent[];
    totalVariables: number;
    unknownComponents: string[];
    unknownButtonTypes: string[];
    compatibility: TemplateCompatibility;
  };
};

export type TemplateDetailResponse = {
  template: TemplateDetail;
};

export type TemplateHeaderImageMediaAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateHeaderImageMediaAssetsResponse = {
  mediaAssets: TemplateHeaderImageMediaAsset[];
};

export type TemplateHeaderImageAssociationResponse = {
  template: TemplateDetail;
  mediaAsset: TemplateHeaderImageMediaAsset;
};

export type TemplateChannelOption = {
  id: string;
  name: string;
  type: string;
  provider: string;
  wabaId: string | null;
  displayPhone: string | null;
  hasAccessToken: boolean;
  status: string;
};

export type TemplateChannelsResponse = {
  channels: TemplateChannelOption[];
};

export type TemplateSyncError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type TemplateSyncResult = {
  complete: boolean;
  totalFetched: number;
  totalDeduplicated: number;
  totalNormalized: number;
  created: number;
  updated: number;
  reactivated: number;
  markedNotReturned: number;
  skipped: number;
  failed: number;
  warnings: string[];
  errors: TemplateSyncError[];
};

export type TemplateLibraryFilters = {
  q: string;
  category: string;
  language: string;
  metaStatus: string;
  operationalStatus: string;
  hasImage: "" | "true" | "false";
};
