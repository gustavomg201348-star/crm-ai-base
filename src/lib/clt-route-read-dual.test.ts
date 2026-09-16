import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("authenticate route resolve username/password before validation and preserves stored value on write", () => {
  const code = source("src/app/api/clt/integrations/authenticate/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedCurrent = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolveSensitiveTextUpdate\(resolvedCurrent\.username, body\.username\)/);
  assert.match(code, /resolveSensitivePasswordUpdate\(resolvedCurrent\.password, body\.password\)/);
  assert.match(code, /const storedUsername = prepareCltSecretTextUpdate\(current\.username, body\.username, "username"\)/);
  assert.match(code, /const storedPassword = prepareCltSecretPasswordUpdate\(current\.password, body\.password\)/);
  assert.match(code, /username: storedUsername/);
  assert.match(code, /password: storedPassword/);
  assert.ok(code.indexOf("const updated = await prisma.cltIntegration.update") > code.indexOf("const storedPassword"));
  assert.equal(code.includes("encryptSecret("), false);
});

test("verify-sms route resolve CLT operational secrets before validation and preserves stored value on write", () => {
  const code = source("src/app/api/clt/integrations/verify-sms/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedCurrent = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedCurrent\.newcorbanIdentifier/);
  assert.match(code, /resolvedCurrent\.digitadorCode/);
  assert.match(code, /resolvedCurrent\.certifiedAgentCpf/);
  assert.match(code, /const storedNewcorbanIdentifier = prepareCltSecretTextUpdate/);
  assert.match(code, /const storedDigitadorCode = prepareCltSecretTextUpdate/);
  assert.match(code, /const storedCertifiedAgentCpf = prepareCltSecretTextUpdate/);
  assert.match(code, /newcorbanIdentifier: storedNewcorbanIdentifier/);
  assert.match(code, /digitadorCode: storedDigitadorCode/);
  assert.match(code, /certifiedAgentCpf: storedCertifiedAgentCpf/);
  assert.ok(
    code.indexOf("const updated = await prisma.cltIntegration.update") >
      code.indexOf("const storedCertifiedAgentCpf")
  );
  assert.equal(code.includes("encryptSecret("), false);
});

test("test route evaluates minimum config from resolved apiKey/username", () => {
  const code = source("src/app/api/clt/integrations/test/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedSecrets = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedSecrets\.apiKey/);
  assert.match(code, /resolvedSecrets\.username/);
});

test("integrations PATCH prepara os seis secrets CLT antes do Prisma update sem encrypt direto na rota", () => {
  const code = source("src/app/api/clt/integrations/route.ts");

  assert.match(code, /const preparedSecrets = \{/);
  assert.match(code, /apiKey: prepareCltSecretTextUpdate\(current\.apiKey, body\.apiKey, "apiKey"\)/);
  assert.match(code, /username: prepareCltSecretTextUpdate\(current\.username, body\.username, "username"\)/);
  assert.match(code, /password: prepareCltSecretPasswordUpdate\(current\.password, body\.password\)/);
  assert.match(code, /newcorbanIdentifier: prepareCltSecretTextUpdate/);
  assert.match(code, /digitadorCode: prepareCltSecretTextUpdate/);
  assert.match(code, /certifiedAgentCpf: prepareCltSecretTextUpdate/);
  assert.ok(code.indexOf("const updated = await prisma.cltIntegration.update") > code.indexOf("const preparedSecrets"));
  assert.match(code, /\.\.\.preparedSecrets/);
  assert.equal(code.includes("encryptSecret("), false);
});
