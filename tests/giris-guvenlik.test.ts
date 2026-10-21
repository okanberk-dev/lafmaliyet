// Giriş güvenliği ve dosya yükleme sınırı: hata sayan sınırlayıcı, bellekteki hesap kilidi, bilinen cihaz çerezi,
// satış raporu dosyasının boyutu. Çalıştırma: npx tsx --test tests/giris-guvenlik.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { SALES_FILE_MAX_BYTES, SALES_FILE_MAX_MB, salesFileProblem } from "../src/app/panel/satislar/sales-logic";
import { SignJWT } from "jose";

import { passwordProblem } from "../src/lib/password-rules";
import { createLimiter, createLockout } from "../src/server/auth/rate-limit";
import {
  addDeviceUser,
  DEVICE_MAX_USERS,
  isKnownDevice,
  signDevice,
  signPending,
  signSession,
  verifyDevice,
  verifyPending,
  verifySession,
} from "../src/server/auth/session";

/** session.ts'nin geliştirme anahtarı (AUTH_SECRET yokken) */
const DEV_KEY = new TextEncoder().encode(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? process.env.AUTH_SECRET : "gelistirme-icin-guvensiz-anahtar-degistirin-lutfen");

test("sınırlayıcı: blocked() sormak denemeyi saymaz, yalnız hit() sayar", () => {
  const lim = createLimiter({ limit: 2, windowMs: 1000 });
  for (let i = 0; i < 10; i++) assert.equal(lim.blocked("ip", 0), false, "başarılı girişler sayılmaz");
  lim.hit("ip", 0);
  assert.equal(lim.blocked("ip", 10), false);
  lim.hit("ip", 20);
  assert.equal(lim.blocked("ip", 30), true, "iki hatadan sonra kapalı");
  assert.equal(lim.blocked("başka", 30), false, "anahtarlar ayrı");
  assert.equal(lim.blocked("ip", 1000), false, "ilk hata pencereden çıktı");
});

test("bellekteki kilit: veritabanı kilidiyle aynı kural (5. hatada 15 dk, kilitlenince sayaç sıfır)", () => {
  const LOCK = 15 * 60_000;
  const lock = createLockout({ max: 5, lockMs: LOCK });
  for (let i = 0; i < 4; i++) assert.equal(lock.fail("x@ornek.com", i), null, `${i + 1}. hata kilitlemez`);
  assert.equal(lock.lockedUntil("x@ornek.com", 4), null);
  const until = lock.fail("x@ornek.com", 5);
  assert.equal(until?.getTime(), 5 + LOCK, "5. hata kilitler");
  assert.equal(lock.lockedUntil("x@ornek.com", 6)?.getTime(), 5 + LOCK);
  assert.equal(lock.lockedUntil("y@ornek.com", 6), null, "anahtarlar ayrı");
  assert.equal(lock.lockedUntil("x@ornek.com", 5 + LOCK), null, "kilit süresi bitti");
  // Kilit bitince yeniden 5 hak
  for (let i = 0; i < 4; i++) assert.equal(lock.fail("x@ornek.com", 5 + LOCK + i), null);
  assert.ok(lock.fail("x@ornek.com", 5 + LOCK + 10));
  lock.clear("x@ornek.com");
  assert.equal(lock.lockedUntil("x@ornek.com", 5 + LOCK + 11), null, "başarılı giriş kilidi kaldırır");
});

test("bellekteki kilit: çok anahtar birikince temizlenir, yeni kilit ve sayaç doğru çalışır", () => {
  const lock = createLockout({ max: 2, lockMs: 1000, maxKeys: 5 });
  for (let i = 0; i < 50; i++) {
    const t = i * 2000;
    assert.equal(lock.fail(`k${i}`, t), null, "ilk hata kilitlemez");
    assert.ok(lock.fail(`k${i}`, t + 1), "ikinci hata kilitler");
  }
  assert.ok(lock.lockedUntil("k49", 49 * 2000 + 2), "son kilit duruyor");
  assert.equal(lock.lockedUntil("k0", 49 * 2000 + 2), null);
});

test("bilinen cihaz: en son giren başta, tekrar yok, en fazla 10 kişi; oturum sürümü güncellenir", () => {
  const u = (id: number, sv = 1) => ({ id, sv });
  assert.deepEqual(addDeviceUser([], u(3)), [u(3)]);
  assert.deepEqual(addDeviceUser([u(1), u(2), u(3)], u(3, 2)), [u(3, 2), u(1), u(2)], "yeniden giren yeni sürümüyle başa geçer");
  const many = Array.from({ length: DEVICE_MAX_USERS }, (_, i) => u(i + 1));
  const next = addDeviceUser(many, u(99));
  assert.equal(next.length, DEVICE_MAX_USERS);
  assert.deepEqual(next[0], u(99));
  assert.ok(!next.some((x) => x.id === DEVICE_MAX_USERS), "en eski düşer");
});

test("bilinen cihaz: yalnız güncel oturum sürümüyle tanınır (parola değişince / oturumlar kapanınca geçmez)", async () => {
  const device = await verifyDevice(await signDevice({ did: "d", users: [{ id: 4, sv: 2 }] }));
  assert.equal(isKnownDevice(device, { id: 4, sessionVersion: 2 }), true);
  assert.equal(isKnownDevice(device, { id: 4, sessionVersion: 3 }), false, "oturum sürümü arttı");
  assert.equal(isKnownDevice(device, { id: 5, sessionVersion: 2 }), false, "başka kişi");
  assert.equal(isKnownDevice(null, { id: 4, sessionVersion: 2 }), false);
});

test("bilinen cihaz çerezi: imzalı, oturum ya da iki adım çerezi yerine geçmez; eski biçim kişi tanıtmaz", async () => {
  const token = await signDevice({ did: "cihaz-1", users: [{ id: 4, sv: 1 }, { id: 7, sv: 3 }] });
  assert.deepEqual(await verifyDevice(token), { did: "cihaz-1", users: [{ id: 4, sv: 1 }, { id: 7, sv: 3 }] });
  assert.equal(await verifyDevice(undefined), null);
  assert.equal(await verifyDevice("bozuk"), null);
  const cut = token.lastIndexOf(".") + 1;
  const forged = token.slice(0, cut) + (token[cut] === "A" ? "B" : "A") + token.slice(cut + 1);
  assert.equal(await verifyDevice(forged), null, "imza tutmazsa geçersiz");
  // Tür karışmaz: cihaz çerezi oturum açmaz, oturum çerezi cihaz sayılmaz
  assert.equal(await verifySession(token), null);
  assert.equal(await verifyPending(token), null);
  const session = await signSession({ sub: "4", name: "Okan", role: "admin", sv: 1 });
  assert.equal(await verifyDevice(session), null);
  assert.equal(await verifyDevice(await signPending({ sub: "4", sv: 1, next: "" })), null);
  // Önceki sürümün çerezi ({did, ids}): cihaz kimliği kalır, kişiler yeniden girince eklenir
  const legacy = await new SignJWT({ did: "eski", ids: [4, 7], typ: "device" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(DEV_KEY);
  assert.deepEqual(await verifyDevice(legacy), { did: "eski", users: [] });
});

test("sınırlayıcı: önce say, başarıda geri ver (eşzamanlı denemeler sınırı aşamaz, ortak IP başarılarla dolmaz)", () => {
  const lim = createLimiter({ limit: 3, windowMs: 1000 });
  // Aynı anda 10 deneme: yalnız ilk 3'ü değerlendirilir
  const allowed = Array.from({ length: 10 }, () => lim.hit("ip", 0)).filter(Boolean).length;
  assert.equal(allowed, 3);
  lim.reset();
  for (let i = 0; i < 10; i++) {
    assert.equal(lim.hit("kafe", i), true, "başarılı giriş geri verilir");
    lim.undo("kafe");
  }
  assert.equal(lim.blocked("kafe", 20), false);
  lim.undo("yok");
});

test("bellekteki kilit: attempt() kilitliyken değerlendirmez; refund() bu denemenin kilidini kaldırır", () => {
  const LOCK = 15 * 60_000;
  const lock = createLockout({ max: 5, lockMs: LOCK });
  const results = Array.from({ length: 20 }, () => lock.attempt("k", 0));
  assert.equal(results.filter((r) => r.ok).length, 5, "20 eşzamanlı denemeden 5'i değerlendirilir");
  assert.ok(results[4].ok && results[4].locked, "5. deneme kilidi başlatır (kendisi yine değerlendirilir)");
  assert.equal(results[5].ok, false);
  // Parolası doğru çıkan 5. deneme (kod adımına geçiliyor): kilit kalkar, sayaç 4'te kalır
  lock.refund("k", 1);
  assert.equal(lock.lockedUntil("k", 2), null);
  const next = lock.attempt("k", 3);
  assert.ok(next.ok && next.locked, "geri verilen hak tek; ardından yeniden kilit");
  // Kilitlemeyen deneme geri verilince sayaç bir azalır
  const other = createLockout({ max: 5, lockMs: LOCK });
  other.attempt("x", 0);
  other.attempt("x", 0);
  other.refund("x", 0);
  for (let i = 0; i < 3; i++) assert.deepEqual(other.attempt("x", 0), { ok: true, locked: null });
  assert.ok((other.attempt("x", 0) as { locked: Date | null }).locked);
});

test("parola kuralı: kısa, yaygın, kafenin adı, e-posta ve düz diziler reddedilir", () => {
  for (const weak of ["12345678", "1234567890", "87654321", "abcdefgh", "qwertyui", "aaaaaaaa", "Parola123!", "şifre2024", "Galatasaray1905", "password1"])
    assert.ok(passwordProblem(weak), `${weak} reddedilmeli`);
  assert.match(passwordProblem("kısa") ?? "", /en az 8/);
  assert.match(passwordProblem("Laffogato2026!") ?? "", /kafenin adı/);
  assert.match(passwordProblem("L'Affogato-kasa") ?? "", /kafenin adı/);
  assert.match(passwordProblem("ayse.yilmaz99", "ayse.yilmaz@gmail.com") ?? "", /e-posta/);
  for (const ok of ["Kedi-Masa-47-Yesil", "yerel-deneme-parola-123", "sütaş çay 2026", "Mavi.Fincan.Kasım"]) assert.equal(passwordProblem(ok, "admin@laffogato.net"), null, ok);
});

test("satış raporu dosyası: 4 MB'a kadar gider, büyüğü göndermeden açık bir mesajla durur", () => {
  assert.equal(salesFileProblem(0), "Dosya boş");
  assert.equal(salesFileProblem(1), null);
  assert.equal(salesFileProblem(1.5 * 1024 * 1024), null, "1 MB üstü (Next varsayılanı) de kabul");
  assert.equal(salesFileProblem(SALES_FILE_MAX_BYTES), null);
  const msg = salesFileProblem(SALES_FILE_MAX_BYTES + 1);
  assert.ok(msg?.includes(`${SALES_FILE_MAX_MB} MB`), msg ?? "");
  // Vercel işlev isteği 4,5 MB; çok parçalı form payı (10–20 KB) sığmalı
  assert.ok(SALES_FILE_MAX_BYTES + 64 * 1024 <= 4.5 * 1024 * 1024);
});
