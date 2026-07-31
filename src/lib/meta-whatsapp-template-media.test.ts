import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaMediaUploadError,
  sendMetaTemplateMessage,
  uploadMetaMedia,
  type MetaTemplate
} from "./meta-whatsapp";

function imageTemplate(): MetaTemplate {
  return {
    id: "template-id",
    name: "image_template",
    status: "APPROVED",
    category: "UTILITY",
    language: "pt_BR",
    components: [
      {
        type: "HEADER",
        format: "IMAGE"
      },
      {
        type: "BODY",
        text: "Ola, {{1}}."
      }
    ]
  };
}

function installFetchMock(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function readJsonBody(init?: RequestInit) {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new TypeError("Expected JSON request body.");
  }

  return JSON.parse(body) as {
    template?: {
      components?: Array<{
        type?: string;
        parameters?: Array<{
          type?: string;
          image?: {
            id?: string;
            link?: string;
          };
        }>;
      }>;
    };
  };
}

test("uploadMetaMedia envia multipart com bytes e retorna mediaId normalizado", async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
  const restoreFetch = installFetchMock(async (input, init) => {
    assert.match(String(input), /\/phone-number-id\/media$/);
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers instanceof Headers, false);
    assert.ok(init?.body instanceof FormData);

    const formData = init.body;
    assert.equal(formData.get("messaging_product"), "whatsapp");
    assert.equal(formData.get("type"), "image/jpeg");

    const file = formData.get("file");
    assert.ok(file instanceof Blob);
    assert.equal(file.type, "image/jpeg");
    assert.equal(file.size, bytes.byteLength);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);

    return Response.json({ id: "meta-media-id" });
  });

  try {
    const uploaded = await uploadMetaMedia({
      phoneNumberId: "phone-number-id",
      accessToken: "access-token",
      fileName: "header.jpg",
      mimeType: "image/jpeg",
      bytes
    });

    assert.deepEqual(uploaded, {
      id: "meta-media-id",
      mediaId: "meta-media-id"
    });
  } finally {
    restoreFetch();
  }
});

test("uploadMetaMedia falha de forma tipada quando a Meta nao retorna media_id", async () => {
  const restoreFetch = installFetchMock(() => Response.json({ ok: true }));

  try {
    await assert.rejects(
      uploadMetaMedia({
        phoneNumberId: "phone-number-id",
        accessToken: "access-token",
        fileName: "header.jpg",
        mimeType: "image/jpeg",
        bytes: Buffer.from([0xff, 0xd8, 0xff])
      }),
      (error: unknown) =>
        error instanceof MetaMediaUploadError &&
        error.stage === "meta_media_upload" &&
        error.status === 200
    );
  } finally {
    restoreFetch();
  }
});

test("sendMetaTemplateMessage envia HEADER IMAGE com image.id quando mediaId e informado", async () => {
  const payloads: ReturnType<typeof readJsonBody>[] = [];
  const restoreFetch = installFetchMock((input, init) => {
    assert.match(String(input), /\/phone-number-id\/messages$/);
    payloads.push(readJsonBody(init));
    return Response.json({ messages: [{ id: "wamid-id" }] });
  });

  try {
    await sendMetaTemplateMessage({
      phoneNumberId: "phone-number-id",
      accessToken: "access-token",
      to: "5533999999999",
      name: "image_template",
      language: "pt_BR",
      variables: ["Gustavo"],
      template: imageTemplate(),
      headerMedia: {
        type: "image",
        mediaId: "meta-media-id"
      }
    });
  } finally {
    restoreFetch();
  }

  const payload = payloads[0];
  assert.ok(payload);
  const headerComponent = payload.template?.components?.find(
    (component) => component.type === "header"
  );
  const image = headerComponent?.parameters?.[0]?.image;
  assert.deepEqual(image, { id: "meta-media-id" });
  assert.equal("link" in (image ?? {}), false);
});

test("sendMetaTemplateMessage preserva fallback legado por image.link", async () => {
  const payloads: ReturnType<typeof readJsonBody>[] = [];
  const restoreFetch = installFetchMock((_, init) => {
    payloads.push(readJsonBody(init));
    return Response.json({ messages: [{ id: "wamid-id" }] });
  });

  try {
    await sendMetaTemplateMessage({
      phoneNumberId: "phone-number-id",
      accessToken: "access-token",
      to: "5533999999999",
      name: "image_template",
      language: "pt_BR",
      variables: ["Gustavo"],
      template: imageTemplate(),
      headerImageUrl: "https://example.com/header.jpg"
    });
  } finally {
    restoreFetch();
  }

  const payload = payloads[0];
  assert.ok(payload);
  const headerComponent = payload.template?.components?.find(
    (component) => component.type === "header"
  );
  const image = headerComponent?.parameters?.[0]?.image;
  assert.deepEqual(image, { link: "https://example.com/header.jpg" });
  assert.equal("id" in (image ?? {}), false);
});
