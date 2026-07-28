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

export type TemplateLibraryFilters = {
  q: string;
  category: string;
  language: string;
  metaStatus: string;
  operationalStatus: string;
  hasImage: "" | "true" | "false";
};
