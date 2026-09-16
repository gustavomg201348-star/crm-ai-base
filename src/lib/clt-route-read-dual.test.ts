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
  assert.match(code, /const storedUsername = resolveSensitiveTextUpdate\(current\.username, body\.username\)/);
  assert.match(code, /const storedPassword = resolveSensitivePasswordUpdate\(current\.password, body\.password\)/);
  assert.match(code, /username: storedUsername/);
  assert.match(code, /password: storedPassword/);
});

test("verify-sms route resolve CLT operational secrets before validation and preserves stored value on write", () => {
  const code = source("src/app/api/clt/integrations/verify-sms/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedCurrent = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedCurrent\.newcorbanIdentifier/);
  assert.match(code, /resolvedCurrent\.digitadorCode/);
  assert.match(code, /resolvedCurrent\.certifiedAgentCpf/);
  assert.match(code, /const storedNewcorbanIdentifier = resolveSensitiveTextUpdate/);
  assert.match(code, /const storedDigitadorCode = resolveSensitiveTextUpdate/);
  assert.match(code, /const storedCertifiedAgentCpf = resolveSensitiveTextUpdate/);
  assert.match(code, /newcorbanIdentifier: storedNewcorbanIdentifier/);
  assert.match(code, /digitadorCode: storedDigitadorCode/);
  assert.match(code, /certifiedAgentCpf: storedCertifiedAgentCpf/);
});

test("test route evaluates minimum config from resolved apiKey/username", () => {
  const code = source("src/app/api/clt/integrations/test/route.ts");

  assert.match(code, /resolveCltIntegrationSecrets/);
  assert.match(code, /const resolvedSecrets = resolveCltIntegrationSecrets\(current\)/);
  assert.match(code, /resolvedSecrets\.apiKey/);
  assert.match(code, /resolvedSecrets\.username/);
});

test("integrations PATCH keeps plaintext write behavior and does not call encryption runtime", () => {
  const code = source("src/app/api/clt/integrations/route.ts");

  assert.match(code, /apiKey: resolveSensitiveTextUpdate\(current\.apiKey, body\.apiKey\)/);
  assert.match(code, /username: resolveSensitiveTextUpdate\(current\.username, body\.username\)/);
  assert.match(code, /password: resolveSensitivePasswordUpdate\(current\.password, body\.password\)/);
  assert.equal(code.includes("encryptSecret("), false);
});
