import { type MetaTemplateApiComponent } from "@/lib/meta-template-client";
import { type ValidatedImageHeaderTemplateInput } from "@/lib/meta-template-creation-types";

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
  const components: MetaTemplateApiComponent[] = [
    {
      type: "HEADER",
      format: "IMAGE",
      example: {
        header_handle: [headerHandle]
      }
    },
    {
      type: "BODY",
      text: bodyText,
      ...(bodyExamples
        ? {
            example: {
              body_text: bodyExamples
            }
          }
        : {})
    }
  ];

  if (footerText) {
    components.push({
      type: "FOOTER",
      text: footerText
    });
  }

  if (buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons
    });
  }

  return components;
}
