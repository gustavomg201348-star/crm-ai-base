import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCampaignPreparationFailureMessage,
  markCampaignPreparationFailed,
  resolveCampaignTemplateHeaderMedia
} from "./campaigns";
import { MetaMediaUploadError, type MetaTemplate } from "./meta-whatsapp";
import { TemplateMediaStorageError } from "./template-media-storage";

type ResolveCampaignTemplateHeaderMediaInput =
  Parameters<typeof resolveCampaignTemplateHeaderMedia>[0];

function createResolveInput(template: MetaTemplate): ResolveCampaignTemplateHeaderMediaInput {
  return {
    companyId: "company-1",
    phoneNumberId: "phone-number-1",
    accessToken: "access-token",
    localTemplate: {
      id: "local-template-1",
      companyId: "company-1",
      defaultHeaderMediaAssetId: "media-asset-1"
    } as ResolveCampaignTemplateHeaderMediaInput["localTemplate"],
    template
  };
}

test("buildCampaignPreparationFailureMessage identifies storage failures safely", () => {
  const message = buildCampaignPreparationFailureMessage(
    new TemplateMediaStorageError("STORAGE_FILE_NOT_FOUND", "Arquivo ausente.")
  );

  assert.equal(
    message,
    "Falha antes do processamento dos destinatarios: leitura da midia do template falhou (STORAGE_FILE_NOT_FOUND)."
  );
});

test("buildCampaignPreparationFailureMessage identifies Meta media upload failures safely", () => {
  const message = buildCampaignPreparationFailureMessage(
    new MetaMediaUploadError("Upload recusado pela Meta.", {
      status: 400,
      metaErrorCode: "100"
    })
  );

  assert.equal(
    message,
    "Falha antes do processamento dos destinatarios: upload da midia para a Meta falhou."
  );
});

test("markCampaignPreparationFailed fails pending recipients and refreshes counters", async () => {
  const calls: string[] = [];
  const result = await markCampaignPreparationFailed("campaign-1", new Error("Template ausente."), {
    markPendingRecipientsFailed: async (input) => {
      calls.push("mark");
      assert.equal(input.campaignId, "campaign-1");
      assert.ok(input.failedAt instanceof Date);
      assert.equal(input.errorCode, "CAMPAIGN_PREPARATION_FAILED");
      assert.equal(
        input.errorMessage,
        "Falha antes do processamento dos destinatarios: Template ausente."
      );
    },
    refreshCounters: async (campaignId) => {
      calls.push("refresh");
      assert.equal(campaignId, "campaign-1");
    }
  });

  assert.deepEqual(calls, ["mark", "refresh"]);
  assert.equal(
    result.errorMessage,
    "Falha antes do processamento dos destinatarios: Template ausente."
  );
});

test("resolveCampaignTemplateHeaderMedia uploads IMAGE header once and returns image.id media", async () => {
  const imageTemplate: MetaTemplate = {
    name: "template_image",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "IMAGE"
      },
      {
        type: "BODY",
        text: "Ola"
      }
    ]
  };

  let uploadCalls = 0;
  const resolved = await resolveCampaignTemplateHeaderMedia(createResolveInput(imageTemplate), {
    resolveAndUploadHeaderImageMedia: async (input) => {
      uploadCalls += 1;
      assert.equal(input.companyId, "company-1");
      assert.equal(input.phoneNumberId, "phone-number-1");
      assert.equal(input.localTemplate.defaultHeaderMediaAssetId, "media-asset-1");

      return {
        headerMedia: {
          type: "image",
          mediaId: "meta-media-id-1"
        },
        historyMediaUrl: null,
        mimeType: "image/png"
      };
    }
  });

  assert.equal(uploadCalls, 1);
  assert.deepEqual(resolved, {
    headerMedia: {
      type: "image",
      mediaId: "meta-media-id-1"
    },
    historyMediaUrl: null,
    mimeType: "image/png"
  });
});

test("resolveCampaignTemplateHeaderMedia does not upload media for templates without IMAGE header", async () => {
  const textTemplate: MetaTemplate = {
    name: "template_text",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Titulo"
      },
      {
        type: "BODY",
        text: "Ola"
      }
    ]
  };

  const resolved = await resolveCampaignTemplateHeaderMedia(createResolveInput(textTemplate), {
    resolveAndUploadHeaderImageMedia: async () => {
      throw new Error("Nao deveria tentar upload para HEADER TEXT.");
    }
  });

  assert.deepEqual(resolved, {
    headerMedia: null,
    historyMediaUrl: null,
    mimeType: null
  });
});
