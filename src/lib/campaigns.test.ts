import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildCampaignChannelSnapshot,
  buildCampaignChannelWhere,
  buildCampaignPreparationFailureMessage,
  mapCampaign,
  markCampaignPreparationFailed,
  resolveCampaignTemplateHeaderMedia,
  type CampaignWithRelations
} from "./campaigns";
import { MetaMediaUploadError, type MetaTemplate } from "./meta-whatsapp";
import { TemplateMediaStorageError } from "./template-media-storage";

type ResolveCampaignTemplateHeaderMediaInput =
  Parameters<typeof resolveCampaignTemplateHeaderMedia>[0];

function createCampaignFixture({
  channelNameSnapshot,
  channelDisplayPhoneSnapshot,
  channelName = "Canal atual",
  channelDisplayPhone = "+55 11 99999-0000"
}: {
  channelNameSnapshot: string | null;
  channelDisplayPhoneSnapshot: string | null;
  channelName?: string;
  channelDisplayPhone?: string | null;
}) {
  const now = new Date("2026-09-25T12:00:00.000Z");

  return {
    id: "campaign-1",
    companyId: "company-1",
    channelId: "channel-1",
    channelNameSnapshot,
    channelDisplayPhoneSnapshot,
    createdById: "user-1",
    name: "Disparo",
    message: "Mensagem",
    messageType: "TEXT",
    templateName: null,
    templateLanguage: null,
    templateVariables: null,
    templateVariableMapping: null,
    imagePath: null,
    imageName: null,
    imageMime: null,
    imageSize: null,
    status: "COMPLETED",
    total: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    channel: {
      id: "channel-1",
      companyId: "company-1",
      name: channelName,
      type: "whatsapp",
      provider: "meta",
      externalId: null,
      phoneNumberId: "phone-number-1",
      wabaId: "waba-1",
      displayPhone: channelDisplayPhone,
      accessToken: "encrypted-token",
      verifyToken: null,
      appSecret: null,
      status: "ACTIVE",
      lastWebhookSubscribedAt: null,
      lastWebhookReceivedAt: null,
      createdAt: now,
      updatedAt: now
    },
    recipients: []
  } as CampaignWithRelations;
}

test("buildCampaignChannelSnapshot captures the validated channel identity", () => {
  assert.deepEqual(
    buildCampaignChannelSnapshot({
      name: "Viva Consultoria - WhatsApp 8199",
      displayPhone: "+55 33 8468-8199"
    }),
    {
      channelNameSnapshot: "Viva Consultoria - WhatsApp 8199",
      channelDisplayPhoneSnapshot: "+55 33 8468-8199"
    }
  );
});

test("buildCampaignChannelWhere keeps channel lookup inside the session company", () => {
  assert.deepEqual(
    buildCampaignChannelWhere({ channelId: "channel-b", companyId: "company-a" }),
    {
      id: "channel-b",
      companyId: "company-a",
      type: "whatsapp",
      provider: "meta",
      status: { in: ["ACTIVE", "CONNECTED"] }
    }
  );
});

test("mapCampaign preserves snapshot after the related channel changes", () => {
  const mapped = mapCampaign(
    createCampaignFixture({
      channelNameSnapshot: "Canal original",
      channelDisplayPhoneSnapshot: "+55 33 8000-1000",
      channelName: "Canal renomeado",
      channelDisplayPhone: "+55 33 9000-2000"
    })
  );

  assert.deepEqual(mapped.channel, {
    id: "channel-1",
    name: "Canal original",
    provider: "meta",
    displayPhone: "+55 33 8000-1000"
  });
});

test("mapCampaign falls back to the current channel for legacy campaigns", () => {
  const mapped = mapCampaign(
    createCampaignFixture({
      channelNameSnapshot: null,
      channelDisplayPhoneSnapshot: null
    })
  );

  assert.equal(mapped.channel.name, "Canal atual");
  assert.equal(mapped.channel.displayPhone, "+55 11 99999-0000");
});

test("mapCampaign supports a nullable channel display phone", () => {
  const mapped = mapCampaign(
    createCampaignFixture({
      channelNameSnapshot: "Canal sem numero",
      channelDisplayPhoneSnapshot: null,
      channelDisplayPhone: "+55 11 98888-7777"
    })
  );

  assert.equal(mapped.channel.name, "Canal sem numero");
  assert.equal(mapped.channel.displayPhone, null);
});

test("normal campaign creation persists the validated channel snapshot", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src", "app", "api", "campaigns", "route.ts"),
    "utf8"
  );

  assert.match(source, /\.\.\.buildCampaignChannelSnapshot\(channel\)/);
});

test("import campaign creation persists the validated channel snapshot", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src", "app", "api", "campaigns", "from-import", "route.ts"),
    "utf8"
  );

  assert.match(source, /\.\.\.buildCampaignChannelSnapshot\(channel\)/);
});

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
