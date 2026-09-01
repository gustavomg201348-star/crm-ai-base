import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("POST /api/channels prepara secrets antes do Prisma create", () => {
  const source = readFileSync("src/app/api/channels/route.ts", "utf8");

  assert.match(source, /prepareChannelSecretsForCreateStorage\(rawSecrets\)/);
  assert.ok(source.indexOf("const preparedSecrets") < source.indexOf("await prisma.channel.create"));
  assert.ok(
    source.indexOf("const preparedSecrets") <
      source.indexOf("const diagnostics = await validateMetaWhatsAppCredentials")
  );
  assert.ok(source.indexOf("...preparedSecrets") < source.indexOf("status: \"ACTIVE\""));
});

test("PATCH /api/channels/[id] prepara somente novos secrets antes do Prisma update", () => {
  const source = readFileSync("src/app/api/channels/[id]/route.ts", "utf8");

  assert.match(source, /prepareChannelSecretsForUpdateStorage\(body \?\? \{\}\)/);
  assert.ok(source.indexOf("const preparedSecrets") < source.indexOf("await prisma.channel.update"));
  assert.ok(source.indexOf("...preparedSecrets") < source.indexOf("...(status !== undefined"));
});

test("rotas mantem DTO seguro e tratam erro de storage sem expor segredo", () => {
  const postSource = readFileSync("src/app/api/channels/route.ts", "utf8");
  const patchSource = readFileSync("src/app/api/channels/[id]/route.ts", "utf8");

  for (const source of [postSource, patchSource]) {
    assert.match(source, /hasAccessToken: Boolean\(channel\.accessToken\)/);
    assert.match(source, /hasVerifyToken: Boolean\(channel\.verifyToken\)/);
    assert.match(source, /hasAppSecret: Boolean\(channel\.appSecret\)/);
    assert.match(source, /error instanceof ChannelSecretStorageError/);
    assert.match(source, /CHANNEL_INVALID_INPUT/);
  }

  assert.match(postSource, /CHANNEL_CREATE_FAILED/);
  assert.match(patchSource, /CHANNEL_UPDATE_FAILED/);
});
