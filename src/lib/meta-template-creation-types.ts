import {
  type MetaTemplateApiComponent,
  type MetaTemplateCategory,
  type createMetaMessageTemplate,
  type createTemplateUploadSession,
  type uploadTemplateFile
} from "@/lib/meta-template-client";
import {
  type persistCreatedMetaTemplate,
  type persistTemplateHeaderMediaAsset,
  type updateTemplateHeaderMediaHandle
} from "@/lib/meta-template-service";
import {
  type saveTemplateImage
} from "@/lib/template-media-storage";

export type MetaTemplateButtonInput =
  | {
      type: "QUICK_REPLY";
      text: string;
    }
  | {
      type: "URL";
      text: string;
      url: string;
    }
  | {
      type: "PHONE_NUMBER";
      text: string;
      phone_number: string;
    };

export type NormalizedMetaTemplateButton =
  | {
      type: "QUICK_REPLY";
      text: string;
    }
  | {
      type: "URL";
      text: string;
      url: string;
    }
  | {
      type: "PHONE_NUMBER";
      text: string;
      phone_number: string;
    };

export type MetaTemplateHeaderType = "NONE" | "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";

export type CreateTemplateHeaderMediaInput = {
  fileName: string;
  mimeType: string;
  bytes: Buffer | Uint8Array;
};

export type CreateMetaTemplateHeaderInput =
  | {
      type: "NONE";
    }
  | {
      type: "TEXT";
      text: string;
    }
  | {
      type: "IMAGE" | "DOCUMENT" | "VIDEO";
      media: CreateTemplateHeaderMediaInput;
    };

export type CreateMetaTemplateInput = {
  companyId: string;
  channelId: string;
  appId: string;
  accessToken: string;
  wabaId: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  bodyText: string;
  bodyExamples?: string[][];
  footerText?: string;
  buttons?: MetaTemplateButtonInput[];
  header: CreateMetaTemplateHeaderInput;
  storageNamespace?: string;
};

export type CreateImageHeaderTemplateInput = {
  companyId: string;
  channelId: string;
  appId: string;
  accessToken: string;
  wabaId: string;
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  bodyText: string;
  bodyExamples?: string[][];
  footerText?: string;
  buttons?: MetaTemplateButtonInput[];
  image: CreateTemplateHeaderMediaInput;
  storageNamespace?: string;
};

export type CreateImageHeaderTemplateResult = {
  mediaAssetId: string;
  metaTemplateLocalId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string | null;
  metaStatus: string | null;
  operationalStatus: string;
  defaultHeaderMediaAssetId: string;
  storageKey: string;
  checksum: string;
  headerHandle: string;
  metaTemplate: {
    id: string | null;
    localId: string;
    name: string;
    language: string;
    category: string | null;
    status: string | null;
    operationalStatus: string;
    defaultHeaderMediaAssetId: string;
  };
  media: {
    id: string;
    storageProvider: string;
    storageKey: string;
    publicUrl: string;
    checksum: string;
    checksumAlgorithm: "sha256";
    mimeType: "image/jpeg" | "image/png";
    sizeBytes: number;
    originalFileName: string;
    storedFileName: string;
    headerHandle: string;
  };
  components: MetaTemplateApiComponent[];
};

export type ValidatedImageHeaderTemplateInput = {
  companyId: string;
  channelId: string;
  appId: string;
  accessToken: string;
  wabaId: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  bodyText: string;
  bodyExamples?: string[][];
  footerText: string | null;
  buttons: NormalizedMetaTemplateButton[];
};

export type ValidatedMetaTemplateHeaderInput =
  | {
      type: "NONE";
    }
  | {
      type: "TEXT";
      text: string;
    }
  | {
      type: "IMAGE" | "DOCUMENT" | "VIDEO";
      media: CreateTemplateHeaderMediaInput;
    };

export type ValidatedCreateMetaTemplateInput = {
  companyId: string;
  channelId: string;
  appId: string;
  accessToken: string;
  wabaId: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  bodyText: string;
  bodyExamples?: string[][];
  footerText: string | null;
  buttons: NormalizedMetaTemplateButton[];
  header: ValidatedMetaTemplateHeaderInput;
};

export type MetaTemplateCreationDependencies = {
  saveTemplateImage?: typeof saveTemplateImage;
  persistTemplateHeaderMediaAsset?: typeof persistTemplateHeaderMediaAsset;
  createTemplateUploadSession?: typeof createTemplateUploadSession;
  uploadTemplateFile?: typeof uploadTemplateFile;
  updateTemplateHeaderMediaHandle?: typeof updateTemplateHeaderMediaHandle;
  createMetaMessageTemplate?: typeof createMetaMessageTemplate;
  persistCreatedMetaTemplate?: typeof persistCreatedMetaTemplate;
  now?: () => Date;
};
