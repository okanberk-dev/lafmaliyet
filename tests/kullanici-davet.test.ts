// Kullanıcı daveti ve parola sıfırlama: tek kullanımlık anahtar, durum, sınır, güçlü parola ve giriş bilgileri metni.
// Çalıştırma: npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessEmail,
  accessLink,
  CONFUSABLE_GROUPS,
  credentialsText,
  formatExpiry,
  generatePassword,
  linkAccessInfo,
  PASSWORD_ALPHABET,
  whatsappUrl,
  type AccessInfo,
} from "../src/app/panel/kullanicilar/access";
import { hashPassword, verifyPassword } from "../src/server/auth/password";
import { clientIp, createLimiter } from "../src/server/auth/rate-limit";
import {
  generateToken,
  hashToken,
  INVITE_PASSWORD_HASH,
  isPendingInvite,
  isTokenShaped,
  MAX_TOKEN_ATTEMPTS,
  TOKEN_HOURS,
  tokenExpiry,
  tokenMatches,
  tokenStatus,
} from "../src/server/auth/tokens";

test("anahtar 32 rastgele bayt, base64url (43 karakter) ve her seferinde farklı", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const t = generateToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(t, "base64url").length, 32);
    assert.ok(isTokenShaped(t));
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  for (const bad of [undefined, null, 42, "", "kisa", "a".repeat(42), "a".repeat(44), "a".repeat(42) + "=", "a".repeat(42) + "/"]) {
    assert.equal(isTokenShaped(bad), false, String(bad));
  }
});

test("veritabanında yalnızca sha256 özeti durur; karşılaştırma özetle", () => {
  const t = generateToken();
  const h = hashToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashToken(t), h);
  assert.notEqual(h, t);
  assert.ok(tokenMatches(t, h));
  assert.equal(tokenMatches(generateToken(), h), false);
  assert.equal(tokenMatches(t, ""), false);
  assert.equal(tokenMatches(t, "zz"), false);
});

test("davet 72, sıfırlama 24, 'Parolamı unuttum' 2 saat geçerli", () => {
  assert.deepEqual(TOKEN_HOURS, { invite: 72, reset: 24, forgot: 2 });
  const now = new Date("2026-10-20T09:00:00Z");
  assert.equal(tokenExpiry(TOKEN_HOURS.invite, now).toISOString(), "2026-10-23T09:00:00.000Z");
});

test("bağlantı durumu: kullanılmış, süresi dolmuş, çok deneme, pasif hesap", () => {
  const now = new Date("2026-10-20T09:00:00Z");
  const base = { expiresAt: new Date("2026-10-21T09:00:00Z"), usedAt: null, attempts: 0 };
  const active = { active: true };
  assert.equal(tokenStatus(base, active, now), "ok");
  assert.equal(tokenStatus({ ...base, usedAt: new Date("2026-10-20T08:00:00Z") }, active, now), "used");
  assert.equal(tokenStatus({ ...base, expiresAt: now }, active, now), "expired");
  assert.equal(tokenStatus({ ...base, expiresAt: new Date("2026-10-20T08:59:59Z") }, active, now), "expired");
  assert.equal(tokenStatus({ ...base, attempts: MAX_TOKEN_ATTEMPTS - 1 }, active, now), "ok");
  assert.equal(tokenStatus({ ...base, attempts: MAX_TOKEN_ATTEMPTS }, active, now), "blocked");
  assert.equal(tokenStatus(base, { active: false }, now), "inactive");
  // Kullanılmış bağlantı süresi dolsa da "kullanıldı" der (kişiye doğru yol: giriş yap)
  assert.equal(tokenStatus({ ...base, usedAt: now, expiresAt: new Date(0) }, active, now), "used");
});

test("davet bekleyenin parola alanı hiçbir parolayla eşleşmez", async () => {
  assert.ok(isPendingInvite(INVITE_PASSWORD_HASH));
  assert.equal(isPendingInvite(await hashPassword("deneme-123")), false);
  for (const pw of ["", INVITE_PASSWORD_HASH, "!davet-bekliyor", "davet-bekliyor", "scrypt"]) {
    assert.equal(await verifyPassword(pw, INVITE_PASSWORD_HASH), false, pw);
  }
});

test("sınırlayıcı: pencere içinde en fazla N deneme, pencere kayınca yeniden açılır", () => {
  const lim = createLimiter({ limit: 3, windowMs: 1000 });
  assert.equal(lim.hit("a", 0), true);
  assert.equal(lim.hit("a", 100), true);
  assert.equal(lim.hit("a", 200), true);
  assert.equal(lim.hit("a", 300), false);
  assert.equal(lim.hit("b", 300), true, "anahtarlar ayrı sayılır");
  assert.equal(lim.hit("a", 999), false);
  assert.equal(lim.hit("a", 1000), true, "ilk deneme pencereden çıktı");
  assert.equal(lim.hit("a", 1050), false);
  lim.reset();
  assert.equal(lim.hit("a", 1050), true);
  // Çok anahtar birikince eskiler temizlenir, sayaç yine doğru çalışır
  const small = createLimiter({ limit: 1, windowMs: 10, maxKeys: 5 });
  for (let i = 0; i < 50; i++) assert.equal(small.hit(`k${i}`, i * 20), true);
  assert.equal(small.hit("k49", 49 * 20 + 1), false);
});

test("istemci adresi x-forwarded-for'un ilk değeri", () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k] ?? null });
  assert.equal(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(h({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(h({})), "?");
});

test("güçlü parola: 4'lü üç grup, karışan karakter yok, küçük + büyük harf + rakam", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const p = generatePassword();
    assert.match(p, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/, p);
    const chars = p.replace(/-/g, "");
    assert.equal(chars.length, 12);
    for (const c of chars) assert.ok(PASSWORD_ALPHABET.includes(c), `${c} alfabede yok`);
    for (const group of CONFUSABLE_GROUPS) for (const c of group) assert.ok(!chars.includes(c), `${p}: ${c} (${group}) karışır`);
    assert.match(chars, /[a-z]/);
    assert.match(chars, /[A-Z]/);
    assert.match(chars, /[0-9]/);
    seen.add(p);
  }
  assert.equal(seen.size, 500);
  assert.equal(generatePassword(4, 4).length, 19);
});

test("parola alfabesi: karışan çiftlerin ikisi de yok, yeterli çeşit kalır", () => {
  // Bulgu: S/5, Z/2, B/8, G/6, g/q/9, u/v ve büyüğü küçüğüne benzeyen harfler (c, k, p, s, u, v, w, x, z)
  for (const c of "S5sZ2zB8G6bgq9uvUVcCkKpPwWxX0Oo1lIi") assert.ok(!PASSWORD_ALPHABET.includes(c), `${c} alfabede olmamalı`);
  // "rn" düz yazıda "m" gibi okunur
  assert.ok(!PASSWORD_ALPHABET.includes("r"));
  assert.equal(new Set(PASSWORD_ALPHABET).size, PASSWORD_ALPHABET.length, "tekrar eden karakter yok");
  assert.match(PASSWORD_ALPHABET, /[a-z]/);
  assert.match(PASSWORD_ALPHABET, /[A-Z]/);
  assert.match(PASSWORD_ALPHABET, /[0-9]/);
  // 12 karakterle en az ~55 bit
  assert.ok(12 * Math.log2(PASSWORD_ALPHABET.length) >= 55, `${PASSWORD_ALPHABET.length} karakter yetmez`);
});

const URL_BASE = "https://ladmin.laffogato.net";
const pwInfo: AccessInfo = { kind: "password", userId: 7, name: "Ayşe Yılmaz", email: "ayse@laffogato.net", loginUrl: `${URL_BASE}/giris`, password: "h7Kp-x3Mq-T9vd" };

test("davet bağlantısı ve 'Giriş bilgileri' verisi", () => {
  const raw = generateToken();
  assert.equal(accessLink(`${URL_BASE}/`, raw), `${URL_BASE}/davet?t=${raw}`);
  const info = linkAccessInfo(`${URL_BASE}/`, { id: 3, name: "Can", email: "can@x.com" }, "invite", raw, new Date("2026-10-23T11:30:00Z"));
  assert.deepEqual(info, {
    kind: "invite",
    userId: 3,
    name: "Can",
    email: "can@x.com",
    loginUrl: `${URL_BASE}/giris`,
    link: `${URL_BASE}/davet?t=${raw}`,
    token: raw,
    expiresAt: "2026-10-23T11:30:00.000Z",
  });
});

test("son geçerlilik kafenin saatiyle yazılır", () => {
  // 11:30 UTC = 14:30 İstanbul
  assert.equal(formatExpiry("2026-10-23T11:30:00Z"), "23 Ekim 2026 Cuma 14:30");
});

test("WhatsApp / kopyala mesajı: adres, e-posta ve parola ya da bağlantı tek parça", () => {
  const text = credentialsText(pwInfo);
  assert.match(text, /^Merhaba Ayşe,/);
  assert.ok(text.includes(`Panel: ${URL_BASE}/giris`));
  assert.ok(text.includes("E-posta: ayse@laffogato.net"));
  assert.ok(text.includes("Parola: h7Kp-x3Mq-T9vd"));

  const raw = generateToken();
  const invite = linkAccessInfo(URL_BASE, { id: 7, name: "Ayşe Yılmaz", email: "ayse@laffogato.net" }, "invite", raw, new Date("2026-10-23T11:30:00Z"));
  const inv = credentialsText(invite);
  assert.ok(inv.includes("davet edildiniz"));
  assert.ok(inv.includes(`${URL_BASE}/davet?t=${raw}`));
  assert.ok(inv.includes("Son geçerlilik: 23 Ekim 2026 Cuma 14:30"));
  assert.ok(!inv.includes("Parola:"), "davet mesajında parola yok");

  const reset = credentialsText({ ...invite, kind: "reset" });
  assert.ok(reset.includes("parola sıfırlama bağlantınız"));

  const wa = whatsappUrl(text);
  assert.ok(wa.startsWith("https://wa.me/?text="));
  assert.equal(decodeURIComponent(wa.slice("https://wa.me/?text=".length)), text);
  assert.ok(!wa.includes(" ") && !wa.includes("\n"));
});

test("hoş geldin e-postası: Türkçe konu, bağlantı ve kaçışlı metin", () => {
  const mail = accessEmail(pwInfo);
  assert.equal(mail.subject, "L'Affogato paneline hoş geldiniz");
  assert.ok(mail.html.includes('lang="tr"'));
  assert.ok(mail.html.includes("h7Kp-x3Mq-T9vd"));
  assert.ok(mail.html.includes(`href="${URL_BASE}/giris"`));
  assert.equal(mail.text, credentialsText(pwInfo));

  const evil = accessEmail({ ...pwInfo, name: `<script>alert(1)</script> "x"`, email: "a&b@x.com", password: "<b>p</b>" });
  assert.ok(!evil.html.includes("<script>"));
  assert.ok(evil.html.includes("&lt;script&gt;"));
  assert.ok(evil.html.includes("a&amp;b@x.com"));
  assert.ok(evil.html.includes("&lt;b&gt;p&lt;/b&gt;"));

  const raw = generateToken();
  const inv = accessEmail(linkAccessInfo(URL_BASE, { id: 1, name: "Can", email: "can@x.com" }, "invite", raw, new Date("2026-10-23T11:30:00Z")));
  assert.equal(inv.subject, "L'Affogato paneline davetlisiniz");
  assert.ok(inv.html.includes(`href="${URL_BASE}/davet?t=${raw}"`));
  assert.ok(inv.html.includes("Parolamı belirle"));
  const rs = accessEmail(linkAccessInfo(URL_BASE, { id: 1, name: "Can", email: "can@x.com" }, "reset", raw, new Date("2026-10-23T11:30:00Z")));
  assert.equal(rs.subject, "L'Affogato paneli: parola sıfırlama");
  assert.ok(rs.html.includes("yok sayın"));
});
