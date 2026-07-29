import { type MetaTemplateApiComponent } from "@/lib/meta-template-client";
import {
  type NormalizedMetaTemplateButton,
  type ValidatedCreateMetaTemplateInput,
  type ValidatedImageHeaderTemplateInput
} from "@/lib/meta-template-creation-types";

type BuildMetaTemplateComponentsInput = Pick<
  ValidatedCreateMetaTemplateInput,
  "bodyText" | "bodyExamples" | "footerText" | "buttons" | "header"
> & {
  headerHandle?: string;
};

function buildBodyComponent({
  bodyText,
  bodyExamples
}: {
  bodyText: string;
  bodyExamples?: string[][];
}) {
  return {
    type: "BODY",
    text: bodyText,
    ...(bodyExamples
      ? {
          example: {
            body_text: bodyExamples
          }
        }
      : {})
  } satisfies MetaTemplateApiComponent;
}

function appendFooterComponent(components: MetaTemplateApiComponent[], footerText: string | null) {
  if (!footerText) return;

  components.push({
    type: "FOOTER",
    text: footerText
  });
}

function appendButtonsComponent(
  components: MetaTemplateApiComponent[],
  buttons: NormalizedMetaTemplateButton[]
) {
  if (!buttons.length) return;

  components.push({
    type: "BUTTONS",
    buttons
  });
}

export function buildMetaTemplateComponents({
  bodyText,
  bodyExamples,
  footerText,
  buttons,
  header,
  headerHandle
}: BuildMetaTemplateComponentsInput) {
  const components: MetaTemplateApiComponent[] = [];

  if (header.type === "TEXT") {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: header.text
    });
  }

  if (header.type === "IMAGE" || header.type === "DOCUMENT" || header.type === "VIDEO") {
    if (!headerHandle) {
      throw new Error("headerHandle obrigatorio para HEADER de midia.");
    }

    components.push({
      type: "HEADER",
      format: header.type,
      example: {
        header_handle: [headerHandle]
      }
    });
  }

  components.push(buildBodyComponent({ bodyText, bodyExamples }));
  appendFooterComponent(components, footerText);
  appendButtonsComponent(components, buttons);

  return components;
}

export function buildImageHeaderTemplateComponents({
  bodyText,
  bodyExamples,
  footerText,
  buttons,
  headerHandle
}: Pick<
  ValidatedImageHeaderTemplateInput,
  "bodyText" | "bodyExamples" | "footerText" | "buttons"
> & {
  headerHandle: string;
}) {
  return buildMetaTemplateComponents({
    bodyText,
    bodyExamples,
    footerText,
    buttons,
    header: {
      type: "IMAGE",
      media: {
        fileName: "",
        mimeType: "",
        bytes: new Uint8Array()
      }
    },
    headerHandle
  });
}
