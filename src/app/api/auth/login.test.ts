import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { isSeedPasswordResetAllowed } from "@/lib/seed-admin-login";

test("senha normal valida continua funcionando via passwordHash", () => {
  const passwordHash = hashPassword("senha-correta");

  assert.equal(verifyPassword("senha-correta", passwordHash), true);
});

test("senha normal invalida continua falhando via passwordHash", () => {
  const passwordHash = hashPassword("senha-correta");

  assert.equal(verifyPassword("senha-errada", passwordHash), false);
});

test("production bloqueia fallback por SEED_ADMIN_PASSWORD mesmo quando configurada", () => {
  assert.equal(
    isSeedPasswordResetAllowed("admin@example.com", "senha-seed", {
      nodeEnv: "production",
      seedAdminPassword: "senha-seed",
      platformAdminEmails: "admin@example.com"
    }),
    false
  );
});

test("production nao permite atualizar passwordHash via senha seed", () => {
  const passwordHash = hashPassword("senha-correta");
  const seedPassword = "senha-seed";

  const shouldUpdatePasswordHash =
    !verifyPassword(seedPassword, passwordHash) &&
    isSeedPasswordResetAllowed("admin@example.com", seedPassword, {
      nodeEnv: "production",
      seedAdminPassword: seedPassword,
      platformAdminEmails: "admin@example.com"
    });

  assert.equal(shouldUpdatePasswordHash, false);
  assert.equal(verifyPassword("senha-correta", passwordHash), true);
});

test("production sem SEED_ADMIN_PASSWORD preserva comportamento normal", () => {
  const passwordHash = hashPassword("senha-correta");

  assert.equal(verifyPassword("senha-correta", passwordHash), true);
  assert.equal(
    isSeedPasswordResetAllowed("admin@example.com", "senha-correta", {
      nodeEnv: "production",
      seedAdminPassword: undefined,
      platformAdminEmails: "admin@example.com"
    }),
    false
  );
});

test("development preserva fallback seed para bootstrap local", () => {
  assert.equal(
    isSeedPasswordResetAllowed("admin@example.com", "senha-seed", {
      nodeEnv: "development",
      seedAdminPassword: "senha-seed",
      platformAdminEmails: "admin@example.com"
    }),
    true
  );
});
