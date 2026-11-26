// Kör sayım (Tuzla; Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Kör sayım): personel önce çekmecedeki nakdi sayıp
// kilitler, olması gereken ve kasa farkı sonra görünür; kilitli sayımın değişikliği nedeniyle yazılır ve yöneticiye
// görünür. Saf kurallar burada; sunucu yolu (kilit, ret, şube ayarı) tests/kor-sayim-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/kor-sayim.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BLIND_COUNT_GROUP } from "../src/lib/branch-settings/groups";
import {
  blindCountOn,
  blindCountRefusal,
  blindCountSettingOn,
  BLIND_COUNT_TEXT,
  countAttention,
  countLines,
  countNeedsReason,
  countReasonError,
  lockOf,
  type CashCountRow,
} from "../src/lib/kor-sayim";

const plain = (t: string) => t.replace(/ /g, " ");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("ayar: seçilmemişken ModPOS'taki şubede açık, LafPOS'un şubesinde kapalı; LafPOS gününde hiçbir zaman", () => {
  assert.equal(blindCountOn({ setting: null, branchId: "tuzla", lafposBranch: "marina", lafposDay: false }), true, "Tuzla varsayılan açık");
  assert.equal(blindCountOn({ setting: null, branchId: "marina", lafposBranch: "marina", lafposDay: false }), false, "Marina varsayılan kapalı");
  assert.equal(blindCountOn({ setting: false, branchId: "tuzla", lafposBranch: "marina", lafposDay: false }), false, "kapatılan kapalı");
  assert.equal(blindCountOn({ setting: true, branchId: "marina", lafposBranch: "marina", lafposDay: false }), true, "Marina'nın ModPOS günü açılabilir");
  // LafPOS'un şubesinin LafPOS gününde sayım LafPOS'ta kör: panelin kör sayımı yok
  assert.equal(blindCountOn({ setting: true, branchId: "marina", lafposBranch: "marina", lafposDay: true }), false, "LafPOS günü");
  // Başka şubenin günü LafPOS günü sayılmaz (lafposDay yalnız LafPOS'un şubesinde anlamlı)
  assert.equal(blindCountOn({ setting: null, branchId: "tuzla", lafposBranch: "marina", lafposDay: true }), true, "Tuzla");
  assert.equal(blindCountSettingOn(null, "tuzla", "marina"), true);
  assert.equal(blindCountSettingOn(null, "marina", "marina"), false);
  assert.equal(blindCountSettingOn(false, "tuzla", "marina"), false);
  // Şube ayarı grubu: bozuk değer seçilmemiş sayılır
  assert.deepEqual(BLIND_COUNT_GROUP.read({}, {}), { enabled: null });
  assert.deepEqual(BLIND_COUNT_GROUP.read({ enabled: "evet" }, {}), { enabled: null });
  assert.deepEqual(BLIND_COUNT_GROUP.read({ enabled: false }, {}), { enabled: false });
  assert.equal(BLIND_COUNT_GROUP.summary({ enabled: null }), "varsayılan");
});

const row = (amount: number, at: string, reason: string | null = null, userName = "Ayşe"): CashCountRow => ({ amount, reason, userName, at });

test("kilit: geçerli sayım en son satır; değişti mi ilk sayımla karşılaştırılır", () => {
  assert.equal(lockOf([]), null);
  const first = row(6_400, "2031-03-04T17:14:00.000Z");
  assert.deepEqual(lockOf([first]), { amount: 6_400, at: first.at, by: "Ayşe", changed: false });
  const second = row(6_450, "2031-03-04T17:31:00.000Z", "Çekmecenin altında 50 ₺ çıktı", "Mehmet");
  assert.deepEqual(lockOf([first, second]), { amount: 6_450, at: second.at, by: "Mehmet", changed: true });
  // Aynı tutara dönen değişiklik "değişti" sayılır (arada başka tutar yazıldı)
  assert.equal(lockOf([first, second, row(6_400, "2031-03-04T17:40:00.000Z", "yanlış saydım")])!.changed, true);
});

test("neden: ilk kör sayımda yok; önceki sayım ya da kayıtlı rapor varken zorunlu (en az 5 karakter)", () => {
  assert.equal(countNeedsReason({ counts: 0, hasReport: false }), false);
  assert.equal(countNeedsReason({ counts: 1, hasReport: false }), true);
  assert.equal(countNeedsReason({ counts: 0, hasReport: true }), true, "rapor gönderilmişse fark görüldü");
  assert.equal(countReasonError("ok"), BLIND_COUNT_TEXT.reason);
  assert.equal(countReasonError("   abc  "), BLIND_COUNT_TEXT.reason);
  assert.equal(countReasonError(null), BLIND_COUNT_TEXT.reason);
  assert.equal(countReasonError("50 ₺ bulundu"), null);
});

test("rapor: sayılan kilitli sayıma eşit olmalı; değişmeyen kayıtlı sayılan da geçer", () => {
  // Kilit yok, yeni rapor: önce kilitlenir
  assert.equal(blindCountRefusal({ lock: null, counted: 6_400, prevCounted: null }), BLIND_COUNT_TEXT.lockFirst);
  // Kilitli sayımla aynı (kuruş yuvarlaması tolere)
  assert.equal(blindCountRefusal({ lock: 6_400, counted: 6_400.004, prevCounted: null }), null);
  // Farklı: "Sayımı değiştir"e yönlendirir, kilitli sayımı söyler
  assert.match(plain(blindCountRefusal({ lock: 6_400, counted: 6_350, prevCounted: null })!), /kilitli sayımdan \(6\.400 ₺\) farklı; değiştirmek için “Sayımı değiştir”e basıp nedenini yazın/);
  // Kayıtlı raporun sayılanı değişmediyse geçer (yönetici düzeltmiş ya da ayar açılmadan önce girilmiş rapor)
  assert.equal(blindCountRefusal({ lock: 6_400, counted: 6_350, prevCounted: 6_350 }), null);
  assert.equal(blindCountRefusal({ lock: null, counted: 6_350, prevCounted: 6_350 }), null);
  // Kilitsiz eski rapor değişirse önce kilit (nedeniyle)
  assert.equal(blindCountRefusal({ lock: null, counted: 6_300, prevCounted: 6_350 }), BLIND_COUNT_TEXT.lockFirst);
});

test("yönetici: sayım geçmişi satır satır, değişiklik ve raporla tutmama uyarısı", () => {
  const first = row(6_400, "2031-03-04T17:14:00.000Z");
  const second = row(6_450, "2031-03-04T17:31:00.000Z", "Çekmecenin altında 50 ₺ çıktı", "Mehmet");
  assert.deepEqual(countLines([first, second]).map(plain), ["Kör sayım 6.400 ₺ · Ayşe · 20:14", "Sayım değişti: 6.450 ₺ · Mehmet · 20:31 · Çekmecenin altında 50 ₺ çıktı"]);
  assert.equal(countAttention([], 6_400), null);
  assert.equal(countAttention([first], 6_400), null, "tutuyor");
  assert.equal(plain(countAttention([first, second], 6_450)!), "Sayım kilitlendikten sonra değişti: 6.400 ₺ → 6.450 ₺");
  assert.equal(plain(countAttention([first], 6_350)!), "Raporda sayılan 6.350 ₺, kilitli sayım 6.400 ₺");
  assert.equal(countAttention([first], null), null, "rapor yok");
});

test("form ve sunucu: kilitlenmeden fark çizilmez, rapor gönderilmez; sunucu personelin doğrudan yazımında zorlar", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  // Kilit beklenirken Sonuç farkı değil metni, çubuk farkı değil "sayım kilitlenince" der; gönderim durur
  assert.match(form, /awaitingLock \? \(\s*<p className="text-sm text-ink-mute">\{BLIND_COUNT_TEXT\.result\}<\/p>/);
  assert.match(form, /if \(awaitingLock\) \{[\s\S]{0,200}BLIND_COUNT_TEXT\.lockFirst/);
  assert.match(form, /const kind = diffLive \? diffLive\.kind : null;/);
  // Kilitli sayılan salt okunur
  assert.match(form, /value=\{values\.countedCash\} readOnly/);
  const store = read("src/server/cash/report-store.ts");
  // Onaya giden değişiklik (needsApproval) kapıdan önce döner; kör sayım yalnız doğrudan yazımda
  const save = store.slice(store.indexOf("export async function saveCashReport"));
  assert.ok(save.indexOf("assertBlindCount") > save.indexOf('return { kind: "needsApproval" as const, request: "kasa-duzeltme"'), "kör sayım kapıdan sonra");
  assert.match(save, /if \(me\.role !== "admin"\) await assertBlindCount\(tx, data\.date, branchId, data\.countedCash, prev\?\.countedCash \?\? null\);/);
  // Kasa sayfası personele yalnız kilidi verir (sayım geçmişi ve uyarı yöneticinin)
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /blindCount=\{!admin && countState\?\.on \? \{ lock: lockOf\(countState\.rows\) \} : null\}/);
  assert.match(page, /const countCard =\s*admin && countState\?\.rows\.length/);
});
