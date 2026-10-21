// Web Push: içerik şifrelemesi (RFC 8291'in kendi örneğiyle bayt bayt), VAPID başlığı (RFC 8292) ve yalnız bilinen
// push servislerine gönderim (src/server/push/webpush.ts).
// Çalıştırma: npx tsx --test tests/web-push.test.ts

import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { test } from "node:test";

import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";

import { b64u, encryptPayload, generateVapidKeys, isPushEndpoint, publicKeyOf, vapidAuthorization } from "../src/server/push/webpush";

// RFC 8291, Appendix A
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** Tarayıcının yaptığını yapar: gövdeyi aboneliğin özel anahtarıyla açar (sınama için) */
function decrypt(body: Buffer, uaPrivate: string, auth: string): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(b64u.decode(uaPrivate));
  const shared = ua.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, b64u.decode(auth), info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "son kayıt ayracı");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("şifreleme RFC 8291 örneğinin çıktısını bayt bayt üretir", () => {
  const body = encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth, payload: RFC.plaintext, salt: b64u.decode(RFC.salt), senderPrivateKey: b64u.decode(RFC.asPrivate) });
  assert.equal(b64u.encode(body), RFC.body);
  assert.equal(decrypt(body, RFC.uaPrivate, RFC.auth), RFC.plaintext);
});

test("her gönderimde yeni tuz ve anahtar; Türkçe içerik açılır; çok uzun içerik reddedilir", () => {
  const msg = JSON.stringify({ title: "Yeni karaoke rezervasyonu", body: "Bugün 20:00–22:00 · 4 kişi · Ayşe" });
  const a = encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth, payload: msg });
  const b = encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth, payload: msg });
  assert.notEqual(b64u.encode(a), b64u.encode(b));
  assert.equal(decrypt(a, RFC.uaPrivate, RFC.auth), msg);
  assert.throws(() => encryptPayload({ p256dh: RFC.uaPublic, auth: RFC.auth, payload: "x".repeat(3001) }), /çok uzun/);
  assert.throws(() => encryptPayload({ p256dh: "kisa", auth: RFC.auth, payload: "x" }), /geçersiz/);
});

test("VAPID: hedef push servisinin kökü, 12 saat geçerli, ES256 imzası genel anahtarla doğrulanır", async () => {
  const keys = generateVapidKeys();
  assert.equal(publicKeyOf(keys.privateKey), keys.publicKey);
  assert.equal(b64u.decode(keys.publicKey).length, 65);
  const now = Date.parse("2026-10-21T10:00:00Z");
  const header = await vapidAuthorization({ endpoint: "https://fcm.googleapis.com/fcm/send/abc:def", keys, subject: "https://ladmin.laffogato.net", now });
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[2], keys.publicKey);
  assert.deepEqual(decodeProtectedHeader(m[1]), { typ: "JWT", alg: "ES256" });
  const pub = b64u.decode(keys.publicKey);
  const key = await importJWK({ kty: "EC", crv: "P-256", x: b64u.encode(pub.subarray(1, 33)), y: b64u.encode(pub.subarray(33)) }, "ES256");
  const { payload } = await jwtVerify(m[1], key, { currentDate: new Date(now) });
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.sub, "https://ladmin.laffogato.net");
  assert.equal(payload.exp, now / 1000 + 12 * 3600);
});

test("yalnız bilinen push servislerine gönderilir", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/x",
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/QK2a",
    "https://wns2-par02p.notify.windows.com/w/?token=x",
  ]) {
    assert.equal(isPushEndpoint(ok), true, ok);
  }
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evil.example/fcm.googleapis.com",
    "https://user:pass@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://169.254.169.254/latest",
    "javascript:alert(1)",
    "yok",
  ]) {
    assert.equal(isPushEndpoint(bad), false, bad);
  }
});
