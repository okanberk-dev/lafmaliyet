import assert from "node:assert/strict";
import { test } from "node:test";

import {
  base32Decode,
  base32Encode,
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "../src/server/auth/totp";

// RFC 6238 ek B: "12345678901234567890" anahtarı, SHA1, 8 hanenin son 6'sı
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 gidiş-dönüş", () => {
  const buf = Buffer.from([0, 1, 2, 250, 255, 7, 99]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("RFC 6238 test vektörleri", () => {
  assert.equal(totpCode(RFC_SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(totpCode(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpCode(RFC_SECRET, Math.floor(1234567890 / 30)), "005924");
  assert.equal(totpCode(RFC_SECRET, Math.floor(2000000000 / 30)), "279037");
});

test("doğrulama: ±1 adım, tekrar kullanım reddi, biçim", () => {
  const now = 1_234_567_890_000;
  const step = Math.floor(now / 30_000);
  const code = totpCode(RFC_SECRET, step);
  assert.equal(verifyTotp(RFC_SECRET, code, null, now), step);
  assert.equal(verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, null, now), step);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now), null);
  assert.equal(verifyTotp(RFC_SECRET, code, step, now), null, "aynı kod ikinci kez geçmez");
  assert.equal(verifyTotp(RFC_SECRET, "12345", null, now), null);
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", null, now), null);
});

test("kurtarma kodları tek kullanımlık", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const c of codes) assert.match(c, /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  const hashes = codes.map(hashRecoveryCode);
  const left = consumeRecoveryCode(hashes, codes[3].toUpperCase().replace("-", " "));
  assert.ok(left);
  assert.equal(left.length, 7);
  assert.equal(consumeRecoveryCode(left, codes[3]), null);
  assert.equal(consumeRecoveryCode(hashes, "kisa"), null);
});

test("otpauth adresi", () => {
  const uri = otpauthUri("ali@laffogato.net", "JBSWY3DPEHPK3PXP");
  assert.ok(uri.startsWith("otpauth://totp/L'Affogato%20Panel%3Aali%40laffogato.net?"));
  assert.ok(uri.includes("secret=JBSWY3DPEHPK3PXP"));
  assert.ok(uri.includes("issuer=L%27Affogato%20Panel"));
});
