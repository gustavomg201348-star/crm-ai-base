import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMetaTemplate, type MetaTemplate } from "./meta-template-normalizer";
import {
  calculateMetaTemplateOperationalStatus,
  supportFlagsIndicateSupportedComponents
} from "./meta-template-status";

test("classifica template IMAGE aprovado e ativo sem midia padrao como NEEDS_MEDIA", () => {
  assert.equal(
    calculateMetaTemplateOperationalStatus({
      metaStatus: "APPROVED",
      requiresHeaderMedia: true,
      defaultHeaderMediaAssetId: null,
      componentsSupported: true,
      syncError: null,
      isActive: true
    }),
    "NEEDS_MEDIA"
  );
});

test("classifica template IMAGE aprovado e ativo com midia padrao como READY", () => {
  assert.equal(
    calculateMetaTemplateOperationalStatus({
      metaStatus: "APPROVED",
      requiresHeaderMedia: true,
      defaultHeaderMediaAssetId: "media-asset-id",
      componentsSupported: true,
      syncError: null,
      isActive: true
    }),
    "READY"
  );
});

test("preserva UNSUPPORTED para componentes realmente nao suportados", () => {
  assert.equal(
    calculateMetaTemplateOperationalStatus({
      metaStatus: "APPROVED",
      requiresHeaderMedia: true,
      defaultHeaderMediaAssetId: null,
      componentsSupported: false,
      syncError: null,
      isActive: true
    }),
    "UNSUPPORTED"
  );
});

test("template nao aprovado nao vira NEEDS_MEDIA", () => {
  assert.equal(
    calculateMetaTemplateOperationalStatus({
      metaStatus: "PENDING",
      requiresHeaderMedia: true,
      defaultHeaderMediaAssetId: null,
      componentsSupported: true,
      syncError: null,
      isActive: true
    }),
    "SYNCED"
  );
});

test("syncError impede READY e NEEDS_MEDIA", () => {
  assert.equal(
    calculateMetaTemplateOperationalStatus({
      metaStatus: "APPROVED",
      requiresHeaderMedia: true,
      defaultHeaderMediaAssetId: "media-asset-id",
      componentsSupported: true,
      syncError: "Falha de sincronizacao",
      isActive: true
    }),
    "SYNC_ERROR"
  );
});

test("normalizador trata HEADER IMAGE sem midia configurada como suportado e pendente de configuracao", () => {
  const normalized = normalizeMetaTemplate({
    id: "meta-template-id",
    name: "image_template",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "IMAGE",
        example: {
          header_handle: ["header-handle"]
        }
      },
      {
        type: "BODY",
        text: "Mensagem aprovada"
      }
    ]
  } satisfies MetaTemplate);

  assert.equal(normalized.requiresHeaderMedia, true);
  assert.equal(normalized.header.format, "IMAGE");
  assert.equal(normalized.compatibility.requiresHeaderMediaConfiguration, true);
  assert.deepEqual(normalized.compatibility.unsupportedReasons, []);
  assert.equal(supportFlagsIndicateSupportedComponents(normalized.compatibility), true);
});

test("normalizador preserva UNSUPPORTED para header de midia nao suportado", () => {
  const normalized = normalizeMetaTemplate({
    id: "meta-template-id",
    name: "video_template",
    language: "pt_BR",
    status: "APPROVED",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "VIDEO",
        example: {
          header_handle: ["header-handle"]
        }
      },
      {
        type: "BODY",
        text: "Mensagem aprovada"
      }
    ]
  } satisfies MetaTemplate);

  assert.equal(normalized.requiresHeaderMedia, true);
  assert.equal(normalized.header.format, "VIDEO");
  assert.deepEqual(normalized.compatibility.unsupportedReasons, [
    "HEADER_VIDEO_UNSUPPORTED"
  ]);
  assert.equal(supportFlagsIndicateSupportedComponents(normalized.compatibility), false);
});
