import assert from "node:assert/strict";
import test from "node:test";
import {
  getBrazilianWhatsappPhoneCandidates,
  normalizeBrazilianPhoneForIdentity
} from "./phone-normalization.service";

test("mantem normalizacao canonica estrita para numeros 8 e 9 digitos", () => {
  assert.equal(
    normalizeBrazilianPhoneForIdentity("557381208676").normalizedPhone,
    "557381208676"
  );
  assert.equal(
    normalizeBrazilianPhoneForIdentity("5573981208676").normalizedPhone,
    "5573981208676"
  );
});

test("gera candidato brasileiro controlado de 8 para 9 digitos locais", () => {
  assert.deepEqual(getBrazilianWhatsappPhoneCandidates("557381208676"), {
    exact: "557381208676",
    alternate: "5573981208676"
  });
});

test("gera candidato brasileiro controlado de 9 para 8 digitos locais", () => {
  assert.deepEqual(getBrazilianWhatsappPhoneCandidates("5573981208676"), {
    exact: "5573981208676",
    alternate: "557381208676"
  });
});

test("nao gera candidato para numero local de 9 digitos que nao comeca com 9", () => {
  assert.deepEqual(getBrazilianWhatsappPhoneCandidates("5511812345678"), {
    exact: "5511812345678",
    alternate: null
  });
});

test("nao gera candidato para numero nao brasileiro ou invalido", () => {
  assert.deepEqual(getBrazilianWhatsappPhoneCandidates("12125550199"), {
    exact: null,
    alternate: null
  });
  assert.deepEqual(getBrazilianWhatsappPhoneCandidates("12345"), {
    exact: null,
    alternate: null
  });
});
