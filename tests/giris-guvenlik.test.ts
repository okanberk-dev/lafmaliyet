// Giriş güvenliği ve dosya yükleme sınırı: hata sayan sınırlayıcı, bellekteki hesap kilidi, bilinen cihaz çerezi,
// satış raporu dosyasının boyutu. Çalıştırma: npx tsx --test tests/giris-guvenlik.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { SALES_FILE_MAX_BYTES, SALES_FILE_MAX_MB, salesFileProblem } from "../src/app/panel/satislar/sales-logic";
import { createLimiter, createLockout } from "../src/server/auth/rate-limit";
import {
  addDeviceUser,
  DEVICE_MAX_USERS,
  signDevice,
  signPending,
  signSession,
  verifyDevice,
  verifyPending,
  verifySession,
} from "../src/server/auth/session";

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

test("bilinen cihaz: en son giren başta, tekrar yok, en fazla 10 kişi", () => {
  assert.deepEqual(addDeviceUser([], 3), [3]);
  assert.deepEqual(addDeviceUser([1, 2, 3], 3), [3, 1, 2]);
  const many = Array.from({ length: DEVICE_MAX_USERS }, (_, i) => i + 1);
  const next = addDeviceUser(many, 99);
  assert.equal(next.length, DEVICE_MAX_USERS);
  assert.equal(next[0], 99);
  assert.ok(!next.includes(DEVICE_MAX_USERS), "en eski düşer");
});

test("bilinen cihaz çerezi: imzalı, oturum ya da iki adım çerezi yerine geçmez", async () => {
  const token = await signDevice({ did: "cihaz-1", ids: [4, 7] });
  assert.deepEqual(await verifyDevice(token), { did: "cihaz-1", ids: [4, 7] });
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
