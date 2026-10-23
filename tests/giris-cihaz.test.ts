// Giriş ve rol sağlamlaştırması: bilinen cihazın hata payı veritabanında, IP sınırı ona da işler, kilidi işlem
// geçmişine yazılır; iki adımlı kod ve kurtarma kodu tek yazımda tüketilir; işlem geçmişi hesabı da tutar (başkasının
// adını alan sahibi gibi görünmez); kasadan çıkanı geri alma yalnız sunucunun mühürlü kopyasıyla; yöneticinin
// fotoğrafları ve belgeleri ortak cihazda tarayıcı önbelleğinden açılmaz.
// Veritabanıyla eşzamanlılık: tests/baglanti-db.test.ts.
// Çalıştırma: npx tsx --test tests/giris-cihaz.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import { logPerson, nameTakenBy, sameName } from "../src/lib/activity-person";
import { TABLE_RULES } from "../src/lib/backup/format";
import { CASH_OUT_UNDO_MS, cashOutUndoJson, readCashOutUndo, type CashOutSnapshot } from "../src/lib/cash-outs";
import * as schema from "../src/server/db/schema";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const AUTH = read("src/server/actions/auth.ts");
const fn = (name: string) => AUTH.slice(AUTH.indexOf(`export async function ${name}`), AUTH.indexOf("\nexport ", AUTH.indexOf(`export async function ${name}`) + 1));

// ---------------------------------------------------------------- Bilinen cihaz

test("bilinen cihaz: hata payı veritabanında (bellekte değil), IP sınırı ona da işler, kilidi işlem geçmişine yazılır", () => {
  assert.doesNotMatch(AUTH, /deviceLock/, "bellekteki cihaz payı kalktı");
  assert.match(AUTH, /deviceId \? reserveDeviceAttempt\(getDb\(\), userId, deviceId\) : reserveAttempt\(userId\)/);
  assert.match(AUTH, /if \(deviceId\) await refundDeviceAttempt\(getDb\(\), userId, deviceId\);/);
  const login = fn("loginAction");
  assert.match(login, /if \(!loginIp\.hit\(ip\)\) return fail\(TOO_MANY\);/, "IP sınırında bilinen cihaz ayrıcalığı yok");
  assert.doesNotMatch(login, /!deviceKey|!deviceId &&/);
  assert.match(login, /if \(r\.locked\) await logLock\(user, "parola", deviceId\);/);
  assert.match(fn("verifyLoginCodeAction"), /if \(r\.locked\) await logLock\(user, "iki adımlı kod", deviceId\);/);
  // Başarılı girişte cihazın sayacı silinir
  assert.match(AUTH, /await clearDeviceAttempts\(getDb\(\), user\.id, did\);/);
  // Kilidin işlem geçmişi satırı bilinen cihazı söyler; hesabın kendisiyle yazılır
  assert.match(AUTH, /bilinen bir cihazdan \$\{DEVICE_MAX_FAILED\} hatalı deneme · o cihaz \$\{LOCK_MINUTES\} dakika/);
  assert.match(AUTH, /await logActivity\(\{ id: user\.id, name: user\.name \}, "Hesap kilitlendi", detail\);/);
});

test("bilinen cihazın sayacı: tek yazımda say ve kilitle (kilitliyken satır değişmez), geri ver, sil; yedeğe girmez", () => {
  const locks = read("src/server/auth/login-locks.ts");
  assert.doesNotMatch(locks, /^import "server-only"/m, "veritabanı testi doğrudan çalıştırır");
  assert.match(locks, /export const DEVICE_MAX_FAILED = 10;/);
  assert.match(locks, /onConflictDoUpdate\(\{\s*target: \[t\.userId, t\.deviceId\],/);
  assert.match(locks, /setWhere: or\(isNull\(t\.lockedUntil\), lte\(t\.lockedUntil, sql`now\(\)`\)\)/);
  const table = getTableConfig(schema.loginDeviceLocks);
  assert.equal(table.name, "login_device_locks");
  assert.deepEqual(
    table.columns.map((c) => c.name).sort(),
    ["device_id", "failed_logins", "locked_until", "updated_at", "user_id"],
  );
  assert.equal(table.primaryKeys[0]?.columns.map((c) => c.name).join(","), "user_id,device_id");
  assert.ok(TABLE_RULES.login_device_locks?.skip, "giriş sayaçları yedeğe girmez (kullanıcının giriş bilgileri gibi)");
});

test("iki adımlı kod ve kurtarma kodu: oturum açılmadan önce tek yazımda tüketilir; yarışı kaybeden geçmez", () => {
  const code = fn("verifyLoginCodeAction");
  assert.match(code, /if \(step !== null && \(await consumeTotpStep\(getDb\(\), user\.id, step\)\)\) \{\s*await completeLogin\(user, pending\.next\);/);
  assert.match(code, /if \(remaining && \(await consumeRecoveryList\(getDb\(\), user\.id, codes, remaining\)\)\) \{/);
  assert.doesNotMatch(AUTH, /completeLogin\(user, pending\.next, \{/, "kod artık completeLogin'in koşulsuz yazımıyla tüketilmez");
  const locks = read("src/server/auth/login-locks.ts");
  assert.match(locks, /or\(isNull\(s\.users\.totpLastStep\), lt\(s\.users\.totpLastStep, step\)\)/);
  assert.match(locks, /sql`\$\{s\.users\.recoveryCodes\} = \$\{JSON\.stringify\(previous\)\}::jsonb`/);
});

// ---------------------------------------------------------------- İşlem geçmişi

test("işlem geçmişi: hesap kimliği yazılır; ad yanıltabiliyorsa hesabın e-postası görünür", () => {
  assert.match(read("src/server/actions/log.ts"), /userId: typeof user\?\.id === "number" \? user\.id : null/);
  const cols = getTableConfig(schema.activityLog).columns.map((c) => c.name);
  assert.ok(cols.includes("user_id"));
  const okan = { id: 1, name: "Okan", email: "okan@laffogato.net" };
  const ayse = { id: 2, name: "Ayşe", email: "ayse@laffogato.net" };
  // Kendine sahibinin adını veren personel: iki hesap aynı adı taşıyor, ikisinin kaydı da e-postasıyla
  const fake = { id: 3, name: "okan ", email: "personel@laffogato.net" };
  const all = [okan, ayse, fake];
  assert.deepEqual(logPerson("Okan", fake, all), { name: "Okan", email: "personel@laffogato.net", label: "Okan (personel@laffogato.net)" });
  assert.deepEqual(logPerson("Okan", okan, all), { name: "Okan", email: "okan@laffogato.net", label: "Okan (okan@laffogato.net)" });
  // Tek ve değişmemiş ad: e-posta gerekmez
  assert.deepEqual(logPerson("Ayşe", ayse, all), { name: "Ayşe", email: null, label: "Ayşe" });
  // Hesap sonradan adını değiştirmiş
  assert.equal(logPerson("Ayşe", { ...ayse, name: "Ayşe K." }, [okan, { ...ayse, name: "Ayşe K." }]).email, "ayse@laffogato.net");
  // Hesabı olmayan kayıt: eski kayıt, sistem, site
  assert.deepEqual(logPerson(null, null, all), { name: "Sistem", email: null, label: "Sistem" });
  assert.deepEqual(logPerson("laffogato.net", null, all), { name: "laffogato.net", email: null, label: "laffogato.net" });
});

test("ad değişikliği: başkasının adı alınamaz (Türkçe büyük-küçük harf ve boşluk gözetilmez); değişmeyen ad serbest", () => {
  assert.equal(sameName("  okan   akman", "OKAN Akman"), true);
  assert.equal(sameName("İlker", "ilker"), true);
  assert.equal(sameName("Işıl", "ışıl"), true);
  assert.equal(sameName("Ali", "Ali Veli"), false);
  const accounts = [
    { id: 1, name: "Okan" },
    { id: 2, name: "Ayşe" },
  ];
  assert.equal(nameTakenBy("okan", 2, accounts), true);
  assert.equal(nameTakenBy("Okan", 1, accounts), false, "kendi adı");
  assert.equal(nameTakenBy("Mehmet", 2, accounts), false);
  const profile = fn("updateProfile");
  assert.match(profile, /if \(!sameName\(data\.name, u\.name\) && nameTakenBy\(data\.name, me\.id,/);
  assert.match(profile, /Bu ad başka bir kullanıcıda kayıtlı/);
  // Ayarlar › İşlem geçmişi hesabı birleştirir
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /person: logPerson\(l\.userName, \(l\.userId !== null && accountById\.get\(l\.userId\)\) \|\| null, accounts\),/);
});

// ---------------------------------------------------------------- Kasadan çıkanı geri alma

const snap: CashOutSnapshot = {
  date: "2026-10-22",
  kind: "harcama",
  amount: 412.5,
  store: "Migros",
  description: "süt",
  receiptDate: "2026-10-22",
  receiptNo: null,
  vat: null,
  docType: "fis",
  photoId: 12,
  expense: { categoryId: 3, note: "Kasadan · 22 Ekim", description: "Migros · süt", paymentMethod: "nakit" },
};

test("geri alma: yalnız silen kişi, 15 dakika içinde, silinenin aynısı; bozuk ya da başkasının kopyası geçmez", () => {
  const now = Date.parse("2026-10-22T18:00:00Z");
  const json = cashOutUndoJson(5, snap, now);
  assert.deepEqual(readCashOutUndo(json, 5, now + 60_000), snap);
  assert.equal(readCashOutUndo(json, 6, now), null, "başka kişi");
  assert.equal(readCashOutUndo(json, 5, now + CASH_OUT_UNDO_MS), null, "süresi doldu");
  assert.equal(readCashOutUndo(null, 5, now), null, "mühür açılmadı");
  assert.equal(readCashOutUndo("{bozuk", 5, now), null);
  const forged = JSON.parse(json) as { snap: Record<string, unknown> };
  forged.snap.docType = "faturalı";
  assert.equal(readCashOutUndo(JSON.stringify(forged), 5, now), null);
});

test("geri alma: istemci kopyayı değil mühürlü metni verir; sunucu açar, kişiyi ve süreyi denetler", () => {
  const src = read("src/server/actions/cash-outs.ts");
  assert.match(src, /return \{ undo: seal\(cashOutUndoJson\(me\.id, snap, Date\.now\(\)\), "cashout-undo"\) \};/);
  assert.match(src, /export async function restoreCashOut\(undo: string\)/);
  assert.match(src, /readCashOutUndo\(open\(sealed\.data, "cashout-undo"\), me\.id, Date\.now\(\)\)/);
  assert.match(src, /if \(!snap\) throw new UserError\("Geri alma süresi doldu; satırı yeniden ekleyin"\);/);
  assert.doesNotMatch(src, /export async function restoreCashOut\(snap: CashOutSnapshot\)/);
  assert.match(read("src/server/secret-box.ts"), /export type SealPurpose = [^;]*"cashout-undo"/);
  assert.match(read("src/app/panel/kasa/cash-out-dialog.tsx"), /restoreCashOut\(res\.data\.undo\)/);
});

// ---------------------------------------------------------------- Önbellek

test("yöneticinin fotoğrafları ve belgeleri: ortak cihazda çıkıştan sonra tarayıcı önbelleğinden açılmaz", () => {
  const foto = read("src/app/api/foto/[id]/route.ts");
  assert.match(foto, /const PHOTO_CACHE = "private, no-cache";/);
  assert.doesNotMatch(foto, /max-age/);
  // Her gösteriş yetkiyi yeniden denetler; değişmeyen dosya 304 ile inmez
  const etag = foto.indexOf("if-none-match");
  assert.ok(foto.indexOf("canViewPhoto(me, photo)") < etag && etag < foto.indexOf("readPhoto(id)"), "304 yetkiden sonra, dosyadan önce");
  assert.match(foto, /const etag = `"foto-\$\{id\}-\$\{photo\.createdAt\.getTime\(\)\.toString\(36\)\}-\$\{photo\.sizeBytes\}"`;/);
  const belge = read("src/app/api/faturalar/[id]/belge/route.ts");
  assert.match(belge, /"Cache-Control": "private, no-store",/);
  assert.doesNotMatch(belge, /max-age/);
});
