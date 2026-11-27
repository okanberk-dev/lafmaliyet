// AsilPOS bağlantısı (docs/ASILPOS.md): imza (laffogato.net bağlantısının kuralı ve kodu, ayrı anahtar; vektörleri AsilPOS
// deposunun server/lib/signature.ts'i de verir), isteğin denetimi (503 / 413 / 401), gövdenin beyaz listesi ve hata
// alanının yolu, ürünün bulunma sırası, Kasa raporunun "AsilPOS'tan doldur"u ve maliyet listesinin beyaz listesi.
// Veritabanı tarafı (idempotent yazım, loadDailyProductSales, uçların bütünü) tests/asilpos-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/asilpos.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ALL_BRANCHES } from "../src/lib/branches";
import { parseNumberTR } from "../src/lib/calc/expr";
import { DEFAULT_SETTINGS, settingsFromRows } from "../src/lib/constants";
import { createPosMappingIndex } from "../src/lib/calc/pos-paste";
import type { Product } from "../src/lib/calc/types";
import { computeCash } from "../src/lib/cash-report";
import { money } from "../src/lib/format";
import { sign, signedHeaders } from "../src/lib/karaoke/signature";
import { posCostItems } from "../src/lib/asilpos/costs";
import { TEL_KAYNAK, ZIL_ONEKI } from "../src/lib/asilpos/eski-adlar";
import { parsePosDay, POS_DAY_MAX_BYTES, resolvePosLine, siteSlotKey, type PosDayZ } from "../src/lib/asilpos/day";
import { ASILPOS_NO_COUNT_TEXT, asilposPrefill, asilposSummary } from "../src/lib/asilpos/prefill";
import { checkAsilposRequest, asilposSecretFrom, asilposSecretProblem } from "../src/lib/asilpos/request";
import {
  clearedText,
  dayRejectionStatus,
  isDayRejection,
  isFreshRejection,
  isUnverifiedAfterOk,
  ASILPOS_RESEND_HINT,
  asilposCardSummary,
  MAX_DAY_REJECTIONS,
  missingAsilposDays,
  parseAsilposState,
  peekPosDay,
  REJECTION_BELL_DAYS,
  rejectionBells,
  rejectionText,
  unverifiedText,
  withDayRejection,
  type AsilposCardInput,
  type AsilposRejection,
} from "../src/lib/asilpos/status";
import {
  dayMonthYearTR,
  daysUntilText,
  isAsilposDay,
  kasaName,
  ASILPOS_SWITCH_EFFECTS,
  ASILPOS_SWITCH_MIN,
  monthSource,
  readSwitchDay,
  switchAffectedMonths,
  switchDayProblem,
} from "../src/lib/asilpos/switch";
import { isCountedPosDay, LEGACY_POS_BRANCH_ID, scopeSwitchDay, switchDayFor } from "../src/lib/pos/tills";
import { prefillPlan, type CashPrefill } from "../src/lib/photo-read/kasa";
import { addDays } from "../src/lib/reminders";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;
/** Gövdenin denetlendiği an: 26 Ekim 2026 öğlen (iş günü 26 Ekim) */
const NOW = new Date("2026-10-26T12:00:00+03:00");

/** Sözleşmedeki örnek (docs/03-ENTEGRASYON.md §4) */
const sample = () => ({
  version: 1,
  source: "asilpos",
  date: "2026-10-26",
  z: {
    zNo: 128,
    receipts: 214,
    zTotal: 45210.5,
    cash: 12000,
    card: 29110.5,
    mealCard: 3100,
    online: 0,
    other: 1000,
    offRevenue: 640,
    discounts: 380,
    openingCash: 1500,
    cashOut: 450,
    countedCash: 12980,
    handedOver: 0,
    cashDiff: -70,
  },
  lines: [
    { posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", qty: 42, revenue: 8190, isService: false },
    { posName: "KARAOKE ODASI", siteMenuId: null, slot: null, qty: 3, revenue: 3000, isService: true },
  ],
  ikram: [{ posName: "TIRAMISU", siteMenuId: "mnu-0090", slot: "M", qty: 1, menuValue: 260, reason: "Doğum günü" }],
  payments: [{ name: "Pluxee", zField: "meal_card", channel: "pluxee", count: 7, amount: 1850 }],
});

test("imza: AsilPOS uçlarının vektörleri (sitenin bağlantısıyla aynı kod; AsilPOS'un server/lib/signature.ts'i aynısını verir)", () => {
  // Gövde kurulu kasanınki (kaynak eski adla; AsilPOS tests/signature.test.ts aynı vektörü sabitler)
  const body = `{"version":1,"source":"${TEL_KAYNAK}","date":"2026-10-26"}`;
  assert.equal(
    sign(SECRET, { timestamp: T, method: "POST", url: new URL("https://ladmin.laffogato.net/api/pos/gun"), body }),
    "5ab02280859d09c6afb003f9cc62bbfdd46b1738f6a25c9a6cf8a475113639cb",
  );
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler"), body: "" }),
    "4693defb7ef97b132908d552133471db2827261b6468b2ef565effa6fcbf8a3c",
  );
  // ModPOS dönemi: gövdesiz GET, şube sorguda (sorgu imzanın içinde; AsilPOS tests/signature.test.ts aynı değeri sabitler)
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/modpos-gunler?sube=marina"), body: "" }),
    "e653d2f73b92e4fa1f6acc750f6702872e7e3a68204f9adad8f17e5bf6dd9023",
  );
  // Kasa zinciri uçları (Faz 3; AsilPOS tests/signature.test.ts aynı vektörler): devir okuması (sorgu imzaya girer) ve
  // gider kategorileri, ikisi de gövdesiz imzalı GET
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/devir?date=2026-11-22"), body: "" }),
    "d0d42a100852f660d76a81e1f1631684faef9838a67f1788ded57de92640205b",
  );
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/gider-kategorileri"), body: "" }),
    "7309e560164d15d4ccb5c17ecaa6355bde88073a238c1cc5976f1858431c10b1",
  );
  // Personel bağlantısı (LM-4b; AsilPOS tests/signature.test.ts aynı vektör): şube sorguda, gövdesiz imzalı GET
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/personel?sube=marina"), body: "" }),
    "b6933a6b1b6469c8e430564d5f31c9002ca2ed6a2100fd3cc41df4ccc2d77f31",
  );
  // İmza kuralı kopyalanmadı: denetim karaoke bağlantısının verifySignature'ını çağırır
  const src = read("src/lib/asilpos/request.ts");
  assert.match(src, /import \{ verifySignature \} from "@\/lib\/karaoke\/signature";/);
  assert.doesNotMatch(src, /createHmac|createHash|timingSafeEqual/);
});

test("istek: anahtar yoksa 503, gövde 256 KB'tan büyükse 413, imza yok / yanlış / eski / başka uç / başka anahtar 401", () => {
  const url = new URL("https://ladmin.laffogato.net/api/pos/gun");
  const body = JSON.stringify(sample());
  const now = T * 1000;
  const h = signedHeaders(SECRET, "POST", url, body, now);
  const check = (over: Partial<Parameters<typeof checkAsilposRequest>[0]> = {}) =>
    checkAsilposRequest({ secret: SECRET, method: "POST", url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], maxBytes: POS_DAY_MAX_BYTES, now, ...over });
  assert.deepEqual(check(), { ok: true });
  assert.deepEqual(check({ secret: null }), { ok: false, status: 503, error: "not_configured" });
  // Boyut imzadan önce: büyük gövde imzası doğru olsa da 413 (çok baytlı harf baytıyla sayılır)
  const big = JSON.stringify({ ...sample(), pad: "ş".repeat(POS_DAY_MAX_BYTES / 2) });
  const bigHeaders = signedHeaders(SECRET, "POST", url, big, now);
  assert.deepEqual(check({ body: big, timestamp: bigHeaders["x-laf-timestamp"], signature: bigHeaders["x-laf-signature"] }), { ok: false, status: 413, error: "too_large" });
  const unauthorized = { ok: false, status: 401, error: "unauthorized" };
  assert.deepEqual(check({ signature: null }), unauthorized);
  assert.deepEqual(check({ timestamp: null }), unauthorized);
  assert.deepEqual(check({ body: body.replace("45210.5", "45210.6") }), unauthorized, "gövde değişti");
  assert.deepEqual(check({ secret: `${SECRET}x` }), unauthorized, "başka anahtar (sitenin anahtarı burada geçmez)");
  assert.deepEqual(check({ now: now + 301_000 }), unauthorized, "5 dakikadan eski");
  assert.deepEqual(check({ now: now - 301_000 }), unauthorized, "5 dakikadan ileri");
  assert.deepEqual(check({ now: now + 299_000 }), { ok: true });
  assert.deepEqual(check({ method: "GET" }), unauthorized);
  // Bir ucun imzası öteki uçta geçmez (yol imzanın içinde)
  const ping = signedHeaders(SECRET, "POST", new URL("https://ladmin.laffogato.net/api/menu/ping"), body, now);
  assert.deepEqual(check({ timestamp: ping["x-laf-timestamp"], signature: ping["x-laf-signature"] }), unauthorized);
  // Maliyet listesi: GET, gövdesiz
  const get = new URL("https://ladmin.laffogato.net/api/panel/pos/urunler");
  const g = signedHeaders(SECRET, "GET", get, "", now);
  const checkGet = (over: Partial<Parameters<typeof checkAsilposRequest>[0]> = {}) =>
    checkAsilposRequest({ secret: SECRET, method: "GET", url: get, body: "", timestamp: g["x-laf-timestamp"], signature: g["x-laf-signature"], maxBytes: 0, now, ...over });
  assert.deepEqual(checkGet(), { ok: true });
  assert.deepEqual(checkGet({ url: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler?tum=1") }), unauthorized, "sorgu imzanın içinde");
  assert.deepEqual(checkGet({ secret: null }), { ok: false, status: 503, error: "not_configured" });
});

test("anahtar: ASILPOS_SYNC_SECRET en az 32 karakter (kırpılarak); yoksa ya da kısaysa bağlantı kapalı", () => {
  assert.equal(asilposSecretFrom({}), null);
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: "" }), null);
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: "x".repeat(31) }), null);
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: ` ${"x".repeat(31)} ` }), null);
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: ` ${SECRET} ` }), SECRET);
  // Sitenin anahtarı yerine geçmez
  assert.equal(asilposSecretFrom({ KARAOKE_SYNC_SECRET: SECRET }), null);
});

test("gövde: sözleşmedeki örnek geçer; tutar iki ondalığa yuvarlanır, ad boşlukları sadeleşir, bilinmeyen alan atılır", () => {
  const raw = sample() as ReturnType<typeof sample> & Record<string, unknown>;
  raw.customer = "Ayşe Yılmaz";
  (raw.z as Record<string, unknown>).cashier = "Selin";
  (raw.lines[0] as Record<string, unknown>).waiter = "Ali";
  raw.lines[0].posName = "  LATTE   MEDIUM ";
  raw.lines[0].revenue = 8190.004;
  raw.ikram[0].reason = `  ${"x".repeat(300)}`;
  const r = parsePosDay(JSON.stringify(raw), NOW);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(Object.keys(r.data).sort(), ["date", "ikram", "lines", "payments", "source", "version", "z"]);
  assert.deepEqual(Object.keys(r.data.z).sort(), Object.keys(sample().z).sort());
  assert.deepEqual(r.data.lines[0], { posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", qty: 42, revenue: 8190, isService: false });
  assert.equal(r.data.ikram[0].reason, "x".repeat(200));
  assert.deepEqual(r.data.payments, [{ name: "Pluxee", zField: "meal_card", channel: "pluxee", count: 7, amount: 1850 }]);
  assert.doesNotMatch(JSON.stringify(r.data), /Ayşe|Selin|Ali|customer|cashier|waiter/);
  // Boş listeler ve sayımsız gün geçer
  const empty = { ...sample(), lines: [], ikram: [], payments: [], z: { ...sample().z, countedCash: null, cashDiff: null } };
  assert.ok(parsePosDay(JSON.stringify(empty), NOW).ok);
  // Gece yarısından sonra (05:00'ten önce) dünün iş günü gelir
  assert.ok(parsePosDay(JSON.stringify({ ...sample(), date: "2026-10-25" }), new Date("2026-10-26T03:30:00+03:00")).ok);
});

test("gövde: bozuk alan 400'ün yoluyla döner (ilk sorun)", () => {
  type Raw = Record<string, unknown> & { z: Record<string, unknown>; lines: Record<string, unknown>[]; ikram: Record<string, unknown>[]; payments: Record<string, unknown>[] };
  const field = (mutate: (b: Raw) => void, now = NOW) => {
    const b = sample() as unknown as Raw;
    mutate(b);
    const r = parsePosDay(JSON.stringify(b), now);
    return r.ok ? null : r.field;
  };
  assert.deepEqual(parsePosDay("{", NOW), { ok: false, field: "body" });
  assert.deepEqual(parsePosDay('{"version":1,}', NOW), { ok: false, field: "body" }, "katı JSON: sondaki virgül");
  assert.deepEqual(parsePosDay("[]", NOW), { ok: false, field: "body" });
  assert.deepEqual(parsePosDay("", NOW), { ok: false, field: "body" });
  assert.equal(field((b) => (b.version = 2)), "version");
  assert.equal(field((b) => (b.source = "modpos")), "source");
  assert.equal(field((b) => (b.date = "26.10.2026")), "date");
  assert.equal(field((b) => (b.date = "2026-02-30")), "date");
  assert.equal(field((b) => (b.date = "2026-10-27")), "date", "bugünün iş gününden sonrası");
  assert.equal(field((b) => (b.date = "2026-10-26"), new Date("2026-10-26T04:59:00+03:00")), "date", "05:00'ten önce iş günü hâlâ dün");
  assert.equal(field((b) => Object.assign(b, { z: undefined })), "z", "eksik alan (JSON'da yok)");
  assert.equal(field((b) => (b.z.cash = -1)), "z.cash");
  assert.equal(field((b) => (b.z.zTotal = "45210,50")), "z.zTotal");
  assert.equal(field((b) => delete b.z.countedCash), "z.countedCash", "boş olabilen alan da yazılmalı (null)");
  assert.equal(field((b) => (b.z.zNo = 12.5)), "z.zNo");
  assert.equal(field((b) => (b.lines[1].slot = "XL")), "lines.1.slot");
  assert.equal(field((b) => (b.lines[0].qty = "42")), "lines.0.qty");
  assert.equal(field((b) => (b.lines[0].posName = "   ")), "lines.0.posName");
  assert.equal(field((b) => (b.lines[0].siteMenuId = "MNU 3")), "lines.0.siteMenuId");
  assert.equal(field((b) => (b.lines[1].posName = "LATTE  MEDIUM")), "lines.1.posName", "aynı POS adı günde bir kez");
  assert.equal(field((b) => (b.lines = Array.from({ length: 3001 }, (_, i) => ({ ...b.lines[0], posName: `U${i}` })))), "lines");
  assert.equal(field((b) => (b.ikram[0].menuValue = -5)), "ikram.0.menuValue");
  assert.equal(field((b) => (b.payments[0].zField = "nakit")), "payments.0.zField");
  assert.equal(field((b) => (b.payments[0].count = 1.5)), "payments.0.count");
});

test("ürün: hizmet ürüne bağlanmaz; önce sitenin kalemi ve boyu, yoksa POS eşleştirmesi (posMatchKey), yoksa boş", () => {
  const bySite = new Map([
    [siteSlotKey("mnu-0003", "M"), 11],
    [siteSlotKey("mnu-0003", "L"), 12],
  ]);
  const index = createPosMappingIndex([
    { posName: "LATTE MEDİUM", productId: 99, isService: false, updatedAt: new Date("2026-10-01") },
    { posName: "MOCHA", productId: 21, isService: false, updatedAt: new Date("2026-10-01") },
    { posName: "KARAOKE ODASI", productId: null, isService: true, updatedAt: new Date("2026-10-01") },
  ]);
  const map = (n: string) => index.get(n);
  const line = (o: Partial<Parameters<typeof resolvePosLine>[0]>) => resolvePosLine({ posName: "X", siteMenuId: null, slot: null, isService: false, ...o }, bySite, map);
  // Site kalemi eşleştirmeyi yener (eşleştirme başka ürüne gösterse de)
  assert.deepEqual(line({ posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M" }), { productId: 11, isService: false, via: "site" });
  assert.deepEqual(line({ posName: "LATTE LARGE", siteMenuId: "mnu-0003", slot: "L" }), { productId: 12, isService: false, via: "site" });
  // Panelde bağlı olmayan kalem ya da boysuz satır: POS adıyla; I / İ ve büyük / küçük harf farkı yok
  assert.deepEqual(line({ posName: "Latte Medium", siteMenuId: "mnu-0999", slot: "M" }), { productId: 99, isService: false, via: "eslestirme" });
  assert.deepEqual(line({ posName: "latte medium", siteMenuId: "mnu-0003", slot: null }), { productId: 99, isService: false, via: "eslestirme" });
  assert.deepEqual(line({ posName: "Mocha" }), { productId: 21, isService: false, via: "eslestirme" });
  // HİZMET eşleştirmesi ve AsilPOS'un hizmet işareti
  assert.deepEqual(line({ posName: "Karaoke Odası" }), { productId: null, isService: true, via: "eslestirme" });
  assert.deepEqual(line({ posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", isService: true }), { productId: null, isService: true, via: "hizmet" });
  // Hiçbiri: ürünsüz satır (Satışlar'daki gibi sonra eşlenir)
  assert.deepEqual(line({ posName: "YENİ ÜRÜN", siteMenuId: "mnu-0500", slot: "M" }), { productId: null, isService: false, via: null });
});

const Z = (over: Partial<PosDayZ> = {}): PosDayZ => ({ ...sample().z, ...over });

test("Kasa raporu: AsilPOS'un Z'si formun alanlarına (CashPrefill, asilpos); yalnız boş alanlar dolar, farklı olan öneri", () => {
  const p = asilposPrefill(Z());
  assert.equal(p.source, "asilpos");
  assert.deepEqual(p.checks, []);
  assert.deepEqual(p.missing, []);
  assert.deepEqual(Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, v!.value])), {
    zNo: "128",
    receipts: 214,
    zTotal: 45210.5,
    cash: 12000,
    card: 29110.5,
    mealCard: 3100,
    online: 0,
    other: 1000,
    offRevenue: 640,
    discounts: 380,
    openingCash: 1500,
    cashIn: 0,
    cashOut: 450,
    countedCash: 12980,
    handedOver: 0,
  });
  assert.ok(Object.values(p.values).every((v) => v!.confidence === "high"), "AsilPOS'un rakamı tahmin değil");
  assert.ok(!("cashDiff" in p.values), "kasa farkını form kendisi hesaplar");
  const fields = ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash", "cashIn", "cashOut", "countedCash", "handedOver", "bankPos"] as const;
  const empty = Object.fromEntries(fields.map((f) => [f, ""]));
  const all = prefillPlan(p, empty);
  assert.equal(all.fill.length, 15);
  assert.deepEqual(all.fill.find((f) => f.field === "card"), { field: "card", text: "29110,5", warn: null });
  assert.deepEqual(all.fill.find((f) => f.field === "zNo"), { field: "zNo", text: "128", warn: null });
  assert.deepEqual(all.fill.find((f) => f.field === "cashIn"), { field: "cashIn", text: "0", warn: null }, "giren yoksa 0 yazılır (form alanı açılır)");
  assert.ok(!all.fill.some((f) => f.field === "bankPos"), "banka POS AsilPOS'tan gelmez");
  assert.equal(asilposSummary(all), "AsilPOS'tan 15 alan dolduruldu. Kontrol edip gönderin.");
  // Yazılmış alan değişmez: açılış devirden (1.450), kasadan çıkan fişlerden (450) dolmuştu
  const typed = prefillPlan(p, { ...empty, openingCash: "1.450", cashOut: "450", card: "29110,50" });
  assert.deepEqual(typed.differs, [{ field: "openingCash", photo: 1500, text: "1500" }]);
  assert.equal(typed.fill.length, 12);
  assert.equal(asilposSummary(typed), "AsilPOS'tan 12 alan dolduruldu; 1 alan yazdığınızdan farklı, turuncu olanlara bakın.");
  const filled = Object.fromEntries(all.fill.map((f) => [f.field, f.text]));
  assert.equal(asilposSummary(prefillPlan(p, { ...empty, ...filled })), "Yazdıklarınız AsilPOS'takiyle aynı.");
  assert.equal(asilposSummary(prefillPlan(p, { ...empty, ...filled, cash: "11.000" })), "AsilPOS'ta 1 alan yazdığınızdan farklı; turuncu olanlara bakın.");
  // Elle yazılan giren AsilPOS'unkinden farklıysa öneri: "AsilPOS'ta 0 ₺" ve "AsilPOS'takini yaz"
  assert.deepEqual(prefillPlan(p, { ...empty, ...filled, cashIn: "250" }).differs, [{ field: "cashIn", photo: 0, text: "0" }]);
  // Sayılmadan kapanan gün: sayılan nakit boş kalır ve turuncu
  const noCount = asilposPrefill(Z({ countedCash: null, cashDiff: null }));
  assert.deepEqual(noCount.missing, ["countedCash"]);
  const plan = prefillPlan(noCount, empty);
  assert.deepEqual(plan.missing, ["countedCash"]);
  assert.ok(!plan.fill.some((f) => f.field === "countedCash"));
  assert.equal(asilposSummary(prefillPlan(noCount, { ...empty, ...filled, countedCash: "" })), ASILPOS_NO_COUNT_TEXT);
  // Sayım panelde değil AsilPOS'un kasa föyünde (form Z'nin rakamlarını gösterir, sayım kör olmazdı)
  assert.match(ASILPOS_NO_COUNT_TEXT, /AsilPOS'ta Kasa › Geçmiş günler › Kasa föyü'nden sayın; AsilPOS günü yeniden gönderir\.$/);
  assert.doesNotMatch(ASILPOS_NO_COUNT_TEXT, /sayıp yazın/);
});

const FORM_FIELDS = ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash", "cashIn", "cashOut", "countedCash", "handedOver", "bankPos"] as const;

/** "AsilPOS'tan doldur" boş forma: formun hesabına (computeCash) giden rakamlar, formdaki gibi yazılan metinden okunur */
function filledForm(p: CashPrefill) {
  const plan = prefillPlan(p, Object.fromEntries(FORM_FIELDS.map((f) => [f, ""])));
  const text: Record<string, string> = Object.fromEntries(plan.fill.map((f) => [f.field, f.text]));
  const n = (k: string) => (text[k] ? (parseNumberTR(text[k]) ?? Number.NaN) : 0);
  return {
    zTotal: n("zTotal"),
    cash: n("cash"),
    card: n("card"),
    mealCard: n("mealCard"),
    online: n("online"),
    other: n("other"),
    openingCash: n("openingCash"),
    cashIn: n("cashIn"),
    cashOut: n("cashOut"),
    countedCash: n("countedCash"),
    handedOver: n("handedOver"),
    bankPos: null,
  };
}

test("Kasa raporu: AsilPOS'ta gün içinde yapılan teslim gün içinde çıkana yazılır; olması gereken AsilPOS'unkiyle aynı, fark 0, devir sayılan", () => {
  // 1.500 açılış, 12.000 nakit satış, 450 harcama, gün ortasında patrona 5.000 teslim; akşam 8.050 sayıldı.
  // AsilPOS'un olması gerekeni: açılış + nakit + giren − harcama − teslim = 1.500 + 12.000 + 0 − 450 − 5.000 = 8.050
  const z = Z({ openingCash: 1500, cash: 12000, cashOut: 450, handedOver: 5000, countedCash: 8050, cashDiff: 0 });
  const asilposExpected = 1500 + 12000 + 0 - 450 - 5000;
  const p = asilposPrefill(z);
  assert.equal(p.values.cashOut?.value, 5450, "teslim sayımdan önce çekmeceden çıktı: gün içinde çıkan");
  assert.equal(p.values.cashIn?.value, 0);
  assert.equal(p.values.handedOver?.value, 0, "panelin Teslim edilen'i sayımdan sonra verilendir");
  const c = computeCash(filledForm(p));
  assert.equal(c.expectedCash, asilposExpected);
  assert.equal(c.cashDiff, 0);
  assert.equal(c.kind, "even");
  assert.equal(c.carryOver, 8050, "ertesi güne devir sayılan nakit");
  assert.deepEqual(p.checks, []);
});

test("Kasa raporu: çekmeceye giren nakit (cashIn) Gün içinde kasaya giren'e yazılır, çıkandan düşülmez; olması gereken AsilPOS'unkiyle aynı", () => {
  // 450 harcama, 5.000 teslim, 700 giren (giriş, nakit tahsilat, nakit bahşiş): AsilPOS 1.500 + 12.000 + 700 − 450 − 5.000 = 8.750 bekler
  const p = asilposPrefill(Z({ openingCash: 1500, cash: 12000, cashOut: 450, handedOver: 5000, cashIn: 700, expectedCash: 8750, countedCash: 8750, cashDiff: 0 }));
  assert.equal(p.values.cashOut?.value, 5450, "harcama + teslim");
  assert.equal(p.values.cashIn?.value, 700);
  assert.equal(p.values.handedOver?.value, 0);
  const c = computeCash(filledForm(p));
  assert.equal(c.expectedCash, 8750);
  assert.equal(c.cashDiff, 0);
  assert.equal(c.carryOver, 8750);
  assert.deepEqual(p.checks, [], "AsilPOS'un olması gerekeni panelinkiyle aynı: bilgi satırı yok");
});

test("Kasa raporu (incelemenin örneği): 1.500 açılış, 12.000 nakit, 300 nakit bahşiş, 1.000 nakit tahsilat, 450 harcama; teslimli de teslimsiz de fark 0, devir sayılan", () => {
  // Giren 1.300 (bahşiş + tahsilat); AsilPOS bunu beklenen − açılış − nakit + harcama + teslim diye gönderir
  const day = { openingCash: 1500, cash: 12000, cashOut: 450, cashIn: 1300 };
  const cases = [
    // Gün ortasında 5.000 teslim: AsilPOS 1.500 + 12.000 + 1.300 − 450 − 5.000 = 9.350 bekler, 9.350 sayıldı
    { handedOver: 5000, expected: 9350, cashOut: 5450 },
    // Teslim yok: 1.500 + 12.000 + 1.300 − 450 = 14.350; giren çıkandan 850 fazla. Eski eşleme çıkanı 0'da kırpıp
    // 13.500 bekliyor ve "850 ₺ fazla" kaydediyordu
    { handedOver: 0, expected: 14350, cashOut: 450 },
  ];
  for (const k of cases) {
    const p = asilposPrefill(Z({ ...day, handedOver: k.handedOver, expectedCash: k.expected, countedCash: k.expected, cashDiff: 0 }));
    assert.equal(p.values.cashOut?.value, k.cashOut, "gün içinde çıkan = harcama + teslim");
    assert.equal(p.values.cashIn?.value, 1300, "gün içinde giren = AsilPOS'un cashIn'i");
    assert.equal(p.values.handedOver?.value, 0);
    const c = computeCash(filledForm(p));
    assert.equal(c.expectedCash, k.expected, "panelin olması gerekeni AsilPOS'unki");
    assert.equal(c.cashDiff, 0);
    assert.equal(c.kind, "even");
    assert.equal(c.carryOver, k.expected, "ertesi güne devir sayılan nakit");
    assert.deepEqual(p.checks, [], "kırpma yok, bilgi satırı yok");
  }
});

test("Kasa raporu: AsilPOS'un olması gerekeni (expectedCash) panelin hesabından 0,01 TL'den fazla ayrılırsa bilgi satırı; yoksa ya da tutuyorsa yok", () => {
  // Panel aynı rakamlarla: 1.500 + 12.000 − 450 = 13.050
  const checks = (expectedCash: number | null | undefined) => asilposPrefill(Z({ expectedCash })).checks;
  assert.deepEqual(checks(undefined), []);
  assert.deepEqual(checks(null), []);
  assert.deepEqual(checks(13050), []);
  assert.deepEqual(checks(13050.01), [], "1 kuruş 0,01 TL'den fazla değil");
  assert.deepEqual(checks(13049.99), []);
  assert.deepEqual(checks(13050.02), [
    { fields: [], level: "info", text: `AsilPOS'ta olması gereken nakit ${money(13050.02)}; panel aynı rakamlarla ${money(13050)} hesaplıyor (${money(0.02)} az).` },
  ]);
  assert.deepEqual(checks(12900), [
    { fields: [], level: "info", text: `AsilPOS'ta olması gereken nakit ${money(12900)}; panel aynı rakamlarla ${money(13050)} hesaplıyor (${money(150)} fazla).` },
  ]);
  // Bilgi satırı rakamları değiştirmez
  assert.equal(asilposPrefill(Z({ expectedCash: 12900 })).values.cashOut?.value, 450);
  // Giren de hesaba girer: 1.500 + 12.000 + 1.650 − 450 = 14.700 tutuyor; AsilPOS 14.000 derse satır panelin rakamını söyler
  assert.deepEqual(asilposPrefill(Z({ cashIn: 1650, expectedCash: 14700 })).checks, []);
  assert.deepEqual(asilposPrefill(Z({ cashIn: 1650, expectedCash: 14000 })).checks, [
    { fields: [], level: "info", text: `AsilPOS'ta olması gereken nakit ${money(14000)}; panel aynı rakamlarla ${money(14700)} hesaplıyor (${money(700)} fazla).` },
  ]);
});

test("gövde: z.cashIn ve z.expectedCash isteğe bağlı (eski AsilPOS göndermez, giren 0 sayılır); gelince iki ondalık, giren eksi olamaz", () => {
  // Eski gövde: alanlar yok, geçer, anahtar eklenmez
  const old = parsePosDay(JSON.stringify(sample()), NOW);
  assert.ok(old.ok);
  assert.ok(!("cashIn" in old.data.z) && !("expectedCash" in old.data.z));
  assert.equal(asilposPrefill(old.data.z).values.cashOut?.value, 450);
  assert.equal(asilposPrefill(old.data.z).values.cashIn?.value, 0, "giren gelmediyse 0");
  assert.deepEqual(asilposPrefill(old.data.z).checks, []);
  // Eski gövdede teslim de gün içinde çıkana gider (giren 0)
  const oldHandover = parsePosDay(JSON.stringify({ ...sample(), z: { ...sample().z, handedOver: 5000 } }), NOW);
  assert.ok(oldHandover.ok);
  assert.equal(asilposPrefill(oldHandover.data.z).values.cashOut?.value, 5450);
  // null da geçer
  const nul = parsePosDay(JSON.stringify({ ...sample(), z: { ...sample().z, cashIn: null, expectedCash: null } }), NOW);
  assert.ok(nul.ok);
  assert.equal(asilposPrefill(nul.data.z).values.cashIn?.value, 0);
  assert.deepEqual(asilposPrefill(nul.data.z).checks, []);
  // Yeni gövde: iki ondalığa yuvarlanır, saklanır; olması gereken eksi olabilir (AsilPOS'un hesabı, gün reddedilmez)
  const fresh = parsePosDay(JSON.stringify({ ...sample(), z: { ...sample().z, cashIn: 700.004, expectedCash: 13049.996 } }), NOW);
  assert.ok(fresh.ok);
  assert.equal(fresh.data.z.cashIn, 700);
  assert.equal(fresh.data.z.expectedCash, 13050);
  assert.ok(parsePosDay(JSON.stringify({ ...sample(), z: { ...sample().z, expectedCash: -50 } }), NOW).ok);
  const bad = (z: Record<string, unknown>) => {
    const r = parsePosDay(JSON.stringify({ ...sample(), z: { ...sample().z, ...z } }), NOW);
    return r.ok ? null : r.field;
  };
  assert.equal(bad({ cashIn: -1 }), "z.cashIn");
  assert.equal(bad({ cashIn: "700" }), "z.cashIn");
  assert.equal(bad({ expectedCash: "8750" }), "z.expectedCash");
});

test("Kasa formu: AsilPOS düğmesi aynı uygulama kuralından (prefillPlan) geçer, kaydetmez; işaret kaynağıyla", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  const fill = form.slice(form.indexOf("function fillFromAsilpos()"), form.indexOf("/** Yükleme ya da yeniden okumanın sonucu"));
  assert.match(fill, /prefillPlan\(asilpos\.prefill, /);
  assert.match(fill, /setMarks\(\(m\) => planMarks\(m, plan, "asilpos"\)\)/);
  assert.doesNotMatch(fill, /submitCashReport|start\(/, "düğme kaydetmez");
  assert.match(form, /AsilPOS&apos;tan doldur/);
  assert.match(form, /asilpos: \{ badge: "AsilPOS'tan", at: "AsilPOS'ta", take: "AsilPOS'takini yaz" \}/);
  // Kasa eşlemesinin bilgi satırları doldurunca bandın altında
  assert.match(form, /\{asilposNote !== null \? <ReadChecks checks=\{asilpos\.prefill\.checks\} \/> : null\}/);
  // Gün içinde kasaya giren: AsilPOS da doldurur (işaretli alan); tutarı varken, AsilPOS'tan dolunca ya da "Kasaya giren
  // ekle"yle görünür, yoksa sakin kalır
  assert.match(form, /const MARK_FIELDS = \[\.\.\.READ_FIELDS, \.\.\.\(\["openingCash", "cashIn", "cashOut", "countedCash", "handedOver"\]/);
  assert.match(form, /const showCashIn = cashInOpen \|\| Boolean\(values\.cashIn\.trim\(\)\) \|\| Boolean\(marks\.cashIn\);/);
  assert.match(form, /field\("cashIn", "Gün içinde kasaya giren", \{ hint: "Satış dışı: bozuk para, tahsilat, nakit bahşiş"/);
  assert.match(form, /Kasaya giren ekle/);
  assert.match(form, /cashIn: report\.cashIn \? input\(report\.cashIn\) : ""/, "kayıtlı raporun gireni alanı açar");
  // Sayfa: yalnız formun günü için ve yalnız geçiş gününden sonraki günlerde (loadKasaAsilpos); okunamazsa form ModPOS'a
  // göre açılır. Geçiş gününe bakmayan okuyucu sayfada çağrılmaz
  const page = read("src/app/panel/kasa/page.tsx");
  // Okunamazsa null: form ModPOS'a göre açılır, kör kasa kapalı kalır (staffBlindView)
  assert.match(page, /showForm \? loadKasaAsilpos\(date\)\.catch\(\(\) => null\) : Promise\.resolve\(NO_ASILPOS\)/);
  assert.match(page, /const asilposState = asilposRead \?\? NO_ASILPOS;/);
  assert.match(page, /const NO_ASILPOS = \{ asilpos: false, day: null \} as const;/);
  assert.doesNotMatch(page, /\bloadAsilposDay\(/);
  assert.match(page, /asilpos=\{asilposState\.day\}/);
  assert.match(page, /asilposMode=\{asilposState\.asilpos\}/);
});

test("maliyet listesi: yalnız siteye bağlı ürünler, yalnız altı alan; maliyet kuruş, KDV hariç, sıralı", () => {
  const product = (o: Partial<Product>): Product => ({
    id: 1,
    categoryId: 1,
    name: "Latte",
    size: "M",
    price: 195,
    fireOverride: null,
    note: "gizli not",
    active: true,
    showOnMenu: true,
    sortOrder: 0,
    siteMenuId: null,
    siteMenuSlot: null,
    ...o,
  });
  // Modelin ürün satırı: fiyat, kâr, marj, komisyon ve reçete de taşır; hiçbiri gitmez
  const calc = (p: Product, cost: number) => ({ product: p, cost, price: p.price, unitProfit: 100, margin: 0.5, commission: 3, costRatio: 0.3, lines: [{ total: cost }] });
  const items = posCostItems([
    calc(product({ id: 1, name: "Latte", size: "L", siteMenuId: "mnu-0003", siteMenuSlot: "L" }), 48.004),
    calc(product({ id: 2, name: "Latte", size: "M", siteMenuId: "mnu-0003", siteMenuSlot: "M" }), 42.1),
    calc(product({ id: 3, name: "Mocha", size: "Tek" }), 30),
    calc(product({ id: 4, name: "Çay", size: "Tek", siteMenuId: "mnu-0001", siteMenuSlot: "M", active: false }), 0),
    calc(product({ id: 5, name: "Bozuk", size: "Tek", siteMenuId: "mnu-0002", siteMenuSlot: "M" }), Number.NaN),
  ]);
  assert.deepEqual(items, [
    { siteMenuId: "mnu-0001", slot: "M", name: "Çay", size: "Tek", costMinor: 0, active: false },
    { siteMenuId: "mnu-0002", slot: "M", name: "Bozuk", size: "Tek", costMinor: 0, active: true },
    { siteMenuId: "mnu-0003", slot: "L", name: "Latte", size: "L", costMinor: 4800, active: true },
    { siteMenuId: "mnu-0003", slot: "M", name: "Latte", size: "M", costMinor: 4210, active: true },
  ]);
  for (const i of items) assert.deepEqual(Object.keys(i), ["siteMenuId", "slot", "name", "size", "costMinor", "active"]);
});

test("uçlar: önce bağlantı, sonra imza, sonra gövde; önbelleğe alınmaz; maliyet ucu yalnız imzayla", () => {
  const gun = read("src/app/api/pos/gun/route.ts");
  const order = ["await connection()", "await posKeysConfigured()", "content-length", "request.text()", "await posRequestCaller(request, body)", "handlePosDay("];
  const at = order.map((s) => gun.indexOf(s));
  assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), `sıra: ${order.join(" → ")}`);
  assert.match(gun, /"Cache-Control": "no-store"/);
  // Uç gün sonunu durum kaydından geçirir (src/server/asilpos/status.ts): o da denetimi ve yazımı receivePosDay'e bırakır;
  // anahtar yokken (503) durum satırına hiçbir şey yazılmaz
  assert.ok(gun.indexOf("if (!(await posKeysConfigured())) return") < gun.indexOf("noteUnverified("), "anahtar yokken sayaç da yazılmaz");
  const status = read("src/server/asilpos/status.ts");
  const handle = status.slice(status.indexOf("export async function handlePosDay"));
  assert.match(handle, /r = await receivePosDay\(db, input, now\);/);
  assert.match(handle, /if \(r\.status === 503\) return r;/);
  const ingest = read("src/server/asilpos/ingest.ts");
  const receive = ingest.slice(ingest.indexOf("export async function receivePosDay"));
  assert.ok(receive.indexOf("checkAsilposRequest(") < receive.indexOf("parsePosDay(") && receive.indexOf("parsePosDay(") < receive.indexOf("storePosDay("));
  // Tek işlem, (şube, gün) danışma kilidi ilk iş (önünde yalnız yorum), önce özet sonra satırlar (sil + yaz)
  const store = ingest.slice(ingest.indexOf("export async function storePosDay"), ingest.indexOf("export async function receivePosDay"));
  assert.match(store, /db\.transaction\(async \(tx\) => \{\s*(?:\/\/[^\n]*\n\s*)*await tx\.execute\(sql`select pg_advisory_xact_lock\(hashtext\(\$\{`\$\{GUN_KILIDI_ONEKI\}\$\{branchId\}:\$\{day\.date\}`\}\)\)`\);/);
  assert.ok(store.indexOf("insert(s.posDayReports)") < store.indexOf("delete(s.posDailySales)") && store.indexOf("delete(s.posDailySales)") < store.indexOf("insert(s.posDailySales)"));
  // Z çakışması: kilidin altında kayıtlı Z no'ya bakılır, farklıysa hiçbir şey yazılmadan döner (uç 409)
  const conflict = store.indexOf("stored.z.zNo !== day.z.zNo");
  assert.ok(store.indexOf("pg_advisory_xact_lock") < conflict && conflict < store.indexOf("insert(s.posDayReports)"));
  assert.match(receive, /if \(!r\.ok\) return \{ status: 409, body: \{ error: "z_conflict", date: parsed\.data\.date, zNo: r\.zNo \} \};/);
  const urunler = read("src/app/api/panel/pos/urunler/route.ts");
  assert.match(urunler, /export async function GET\(request: NextRequest\) \{\s*await connection\(\);/);
  assert.match(urunler, /"Cache-Control": "no-store"/);
  // Kasanın şubesi ve anahtarı isteğe göre okunur (posRequestCaller): imza önbellekteki anahtarla tutarsa veritabanından yeniden
  assert.match(urunler, /servePosProducts\(\{\s*(?:\/\/[^\n]*\n\s*)?\.\.\.\(await posRequestCaller\(request\)\),/);
  assert.doesNotMatch(urunler, /getCurrentUser|requireUser|requireAdmin/, "oturumla açılmaz");
  // ModPOS dönemi ucu: aynı kalıp (bağlantı, imza, önbelleksiz, oturumsuz); denetim sırası imza → şube → okuma
  const modpos = read("src/app/api/panel/pos/modpos-gunler/route.ts");
  assert.match(modpos, /export async function GET\(request: NextRequest\) \{\s*await connection\(\);/);
  assert.match(modpos, /"Cache-Control": "no-store"/);
  assert.match(modpos, /serveModposDays\(\{\s*(?:\/\/[^\n]*\n\s*)?\.\.\.\(await posRequestCaller\(request\)\),/);
  assert.doesNotMatch(modpos, /getCurrentUser|requireUser|requireAdmin/, "oturumla açılmaz");
  const serve = read("src/server/asilpos/modpos-gunler.ts");
  const handler = serve.slice(serve.indexOf("export async function serveModposDays"));
  assert.ok(handler.indexOf("checkModposDaysRequest(") > 0 && handler.indexOf("checkModposDaysRequest(") < handler.indexOf("await load("), "imza ve şube okumadan önce");
  const check = read("src/lib/asilpos/modpos-gunler.ts");
  const checkFn = check.slice(check.indexOf("export function checkModposDaysRequest"));
  assert.ok(checkFn.indexOf("checkAsilposRequest(") > 0 && checkFn.indexOf("checkAsilposRequest(") < checkFn.indexOf("modposSube("), "imza şubeden önce");
  // Kasa zinciri (Faz 3): devir ve gider kategorileri de yalnız imzayla, önbelleğe alınmadan
  for (const [file, fn] of [
    ["src/app/api/panel/pos/devir/route.ts", "servePosDevir"],
    ["src/app/api/panel/pos/gider-kategorileri/route.ts", "servePosExpenseCategories"],
  ] as const) {
    const route = read(file);
    assert.match(route, /export async function GET\(request: NextRequest\) \{\s*await connection\(\);/, file);
    assert.match(route, /"Cache-Control": "no-store"/, file);
    assert.match(route, new RegExp(`${fn}\\(getDb\\(\\), \\{\\s*(?:\\/\\/[^\\n]*\\n\\s*)?\\.\\.\\.\\(await posRequestCaller\\(request\\)\\),`), file);
    assert.doesNotMatch(route, /getCurrentUser|requireUser|requireAdmin/, `${file}: oturumla açılmaz`);
  }
  // Oturum ara katmanı bu uçlara dokunmaz (imza tek kapı)
  assert.doesNotMatch(read("src/proxy.ts"), /\/api\/pos|\/api\/panel/);
});

test("kurulum: .env.example'da ASILPOS_SYNC_SECRET, belgeler bağlantılı", () => {
  assert.match(read(".env.example"), /^ASILPOS_SYNC_SECRET=$/m);
  const doc = read("docs/ASILPOS.md");
  for (const s of ["/api/pos/gun", "/api/panel/pos/urunler", "/api/panel/pos/modpos-gunler", "ASILPOS_SYNC_SECRET", "pos_daily_sales", "pos_day_reports", "loadDailyProductSales", "AsilPOS'tan doldur"]) assert.ok(doc.includes(s), s);
  assert.match(read("docs/KASA-RAPORU.md"), /\[ASILPOS\.md\]\(ASILPOS\.md\)/);
  assert.match(read("docs/planlar/CRITIQUE2.md"), /docs\/ASILPOS\.md/);
});

// ---------------------------------------------------------------- Geçiş günü, durum ve onarım (denetim B07)

test("geçiş günü: kayıtlı değerin okunması (settingsFromRows); boş, bozuk ya da 1 Ekim 2026'dan önce null = ModPOS", () => {
  assert.equal(DEFAULT_SETTINGS.asilposGecisGunu, null, "varsayılan kapalı: kasa ModPOS");
  assert.equal(settingsFromRows([]).asilposGecisGunu, null);
  const read1 = (value: unknown) => settingsFromRows([{ key: "asilposGecisGunu", value }]).asilposGecisGunu;
  assert.equal(read1("2026-11-10"), "2026-11-10");
  assert.equal(read1(ASILPOS_SWITCH_MIN), ASILPOS_SWITCH_MIN);
  for (const bad of ["2026-09-30", "2026-02-30", "2026-11", "10.11.2026", "", 20261110, null, true, { day: "2026-11-10" }]) assert.equal(read1(bad), null, String(bad));
  // Öteki ayarlar etkilenmez
  assert.equal(settingsFromRows([{ key: "asilposGecisGunu", value: "bozuk" }]).stokFifoBaslangic, DEFAULT_SETTINGS.stokFifoBaslangic);
  assert.equal(readSwitchDay("2026-11-10"), "2026-11-10");
});

test("geçiş günü: kaydederken takvimde olan gün, 1 Ekim 2026'dan önce değil, en çok 90 gün ileride", () => {
  const today = "2026-10-26";
  assert.equal(switchDayProblem("2026-11-01", today), null);
  assert.equal(switchDayProblem("2026-10-01", today), null, "geçmiş gün olabilir (ModPOS'la girilmiş günler yeniden okunur)");
  assert.equal(switchDayProblem("2027-01-24", today), null, "tam 90 gün");
  assert.match(switchDayProblem("2027-01-25", today) ?? "", /en çok 90 gün ileride/);
  assert.match(switchDayProblem("2026-09-30", today) ?? "", /en erken 1\u00a0Ekim 2026/);
  assert.match(switchDayProblem("2026-02-30", today) ?? "", /Geçerli bir gün/);
  assert.match(switchDayProblem("kasım", today) ?? "", /Geçerli bir gün/);
});

test("geçiş günü: gün ve ayın kaynağı; boşken her gün ModPOS", () => {
  const S = "2026-11-10";
  assert.equal(isAsilposDay("2026-11-10", S), true);
  assert.equal(isAsilposDay("2026-11-09", S), false);
  assert.equal(isAsilposDay("2026-12-01", S), true);
  assert.equal(isAsilposDay("2030-01-01", null), false, "geçiş günü yokken hiçbir gün AsilPOS değil");
  assert.equal(kasaName("2026-11-09", S), "ModPOS");
  assert.equal(kasaName("2026-11-10", S), "AsilPOS");
  assert.equal(kasaName("2026-11-10", null), "ModPOS");
  assert.equal(monthSource("2026-10", S), "modpos");
  assert.equal(monthSource("2026-11", S), "gecis");
  assert.equal(monthSource("2026-12", S), "asilpos");
  assert.equal(monthSource("2026-11", "2026-11-01"), "asilpos", "ayın 1'i: ay bölünmez");
  assert.equal(monthSource("2026-10", "2026-11-01"), "modpos");
  assert.equal(monthSource("2027-05", null), "modpos");
  // Ayın kaynağı günlerinkiyle tutarlı: "modpos" hiç AsilPOS günü yok, "asilpos" hepsi, "gecis" ikisi de var
  for (const S2 of ["2026-10-01", "2026-11-10", "2026-12-31", null]) {
    for (const m of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
      const days: string[] = [];
      for (let d = `${m}-01`; d.startsWith(m); d = addDays(d, 1)) days.push(d);
      const laf = days.filter((d) => isAsilposDay(d, S2)).length;
      const expected = laf === 0 ? "modpos" : laf === days.length ? "asilpos" : "gecis";
      assert.equal(monthSource(m, S2), expected, `${S2} ${m}`);
    }
  }
});

test("geçiş günü şubenin kendi kasasınındır (çok şube, 27 Kasım kararı): kasası ModPOS olan şube ve online kanal ModPOS'ta kalır", () => {
  const S = "2026-12-01";
  const days = { marina: S };
  assert.equal(LEGACY_POS_BRANCH_ID, "marina");
  assert.equal(switchDayFor(days, "marina"), S);
  assert.equal(switchDayFor(days, "tuzla"), null);
  assert.equal(switchDayFor(days, null), null, "şubesiz kayıt Tuzla'nın");
  assert.equal(switchDayFor({ marina: null }, "marina"), null);
  assert.equal(isAsilposDay("2026-12-02", switchDayFor(days, "tuzla")), false, "Tuzla'nın her günü ModPOS günü");
  assert.equal(kasaName("2026-12-02", switchDayFor(days, "tuzla")), "ModPOS");
  assert.equal(kasaName("2026-12-02", switchDayFor(days, "marina")), "AsilPOS");
  assert.equal(kasaName("2026-11-30", switchDayFor(days, "marina")), "ModPOS", "geçişten önce Marina da ModPOS");
  // İki kasa: her biri kendi günüyle
  const two = { marina: S, tuzla: "2027-01-10" };
  assert.deepEqual([isCountedPosDay(two, "tuzla", "2027-01-09"), isCountedPosDay(two, "tuzla", "2027-01-10"), isCountedPosDay(two, "marina", "2027-01-09")], [false, true, true]);
  // Görünüm: "Tümü"de kasaların en erkeni (metinler), şube ya da kanal seçiliyken o kasanınki
  assert.equal(scopeSwitchDay(two, ALL_BRANCHES), S);
  assert.equal(scopeSwitchDay(days, "marina"), S);
  assert.equal(scopeSwitchDay(days, "tuzla"), null);
  assert.equal(scopeSwitchDay(days, "online"), null);
  // Gün sonu anahtarın şubesine yazılır; kilit ve Z denetimi şube başına; başka şubeye ayarlı kasanın günü reddedilir
  const ingest = read("src/server/asilpos/ingest.ts");
  assert.match(ingest, /eq\(s\.posDayReports\.branchId, branchId\)/);
  assert.match(ingest, /\$\{GUN_KILIDI_ONEKI\}\$\{branchId\}:\$\{day\.date\}/);
  assert.match(ingest, /const expected = input\.branchId;/);
  assert.match(ingest, /if \(parsed\.data\.sube && parsed\.data\.sube !== expected\) return \{ status: 409, body: \{ error: "wrong_branch"/);
  assert.match(ingest, /storePosDay\(db, parsed\.data, now, expected\)/, "kabul eden ve yazan aynı şube");
  assert.doesNotMatch(ingest, /LEGACY_POS_BRANCH_ID/, "eski kurulumun şubesi yalnız anahtar ve eski kayıt için");
});

test("kaynak: tek kasanın gününe bakan okuyucular geçiş gününü kasanın kendi şubesinden alır (çok şube)", () => {
  const day = read("src/server/data/asilpos-day.ts");
  // Kasa raporunun AsilPOS bandı, geç raporun kanıtı ve günden güne liste
  assert.match(day, /if \(!isAsilposDay\(date, await loadBranchSwitchDay\(sube, db\)\)\) return \{ asilpos: false, day: null \};/);
  assert.match(day, /if \(!isAsilposDay\(date, await loadBranchSwitchDay\(sube, db\)\)\) return "modpos-z";/);
  assert.ok(day.indexOf("const sube = branchId ?? (await currentTillBranch());") < day.indexOf('return "modpos-z"'), "kanıtın şubesi önce");
  assert.match(day, /return isAsilposDay\(date, switchDayFor\(switchDays, b\)\) \?/);
  // Geç rapor kartı, zayi reddi, günün AsilPOS ikramı, kasadaki fiyatlar, föy yedeği, fotoğraf okuma, metinler
  assert.match(read("src/server/data/cash-late.ts"), /const switchDay = await loadBranchSwitchDay\(branchId, db\);/);
  assert.match(read("src/server/waste/core.ts"), /const switchDay = await loadBranchSwitchDay\(branchId, tx\);/);
  assert.match(read("src/server/waste/core.ts"), /eq\(s\.posDayReports\.date, data\.date\), eq\(s\.posDayReports\.branchId, branchId\)/);
  assert.match(read("src/server/data/asilpos-ikram.ts"), /const switchDay = switchDayFor\(await asilposSwitchDaysOf\(db\), sube\);/);
  assert.match(read("src/server/data/till-scope.ts"), /\.\.\.tillScope\(businessDate\(now\), switchDayFor\(switchDays, branchId\)\)/);
  assert.match(read("src/server/data/cash-reports.ts"), /isAsilposDay\(sh\.day, switchDayFor\(fallback\.switchDays, sh\.branchId\)\)/);
  assert.match(read("src/server/photo-read/read.ts"), /const switchDay = await switchDayOf\(b\);/);
  assert.match(read("src/server/data/today.ts"), /\.then\(\(\[d, b\]\) => switchDayFor\(d, b\)\)/);
  assert.match(read("src/server/bell/kasa.ts"), /kasaName\(day, switchDayFor\(/);
  assert.match(read("src/server/modpos/status.ts"), /loadBranchSwitchDay\(branchId, db\),/);
  // Onaylar'ın zayi kartı isteğin şubesiyle
  assert.match(read("src/server/data/waste-requests.ts"), /productIkramRefusal\(p, switchDayFor\(switchDays, p\.branchId\)/);
});

test("geçiş günü: kaynağı değişen günlerin ayları (onay penceresi), bugüne kadar", () => {
  const today = "2026-12-05";
  assert.deepEqual(switchAffectedMonths(null, "2026-11-10", today), ["2026-11", "2026-12"]);
  assert.deepEqual(switchAffectedMonths("2026-11-10", null, today), ["2026-11", "2026-12"]);
  assert.deepEqual(switchAffectedMonths("2026-11-10", "2026-11-20", today), ["2026-11"], "10-19 Kasım değişir");
  assert.deepEqual(switchAffectedMonths("2026-12-01", "2026-10-15", today), ["2026-10", "2026-11"]);
  assert.deepEqual(switchAffectedMonths(null, "2026-12-20", today), [], "gün ileride: geçmiş değişmez");
  assert.deepEqual(switchAffectedMonths("2026-11-10", "2026-11-10", today), []);
  assert.deepEqual(switchAffectedMonths(null, null, today), []);
  assert.equal(daysUntilText("2026-12-06", today), "yarın");
  assert.equal(daysUntilText("2026-12-09", today), "4 gün sonra");
  assert.equal(daysUntilText(today, today), null);
  assert.equal(dayMonthYearTR("2026-11-10"), "10 Kasım 2026");
  // Onay penceresi kodun bugün yaptığından fazlasını söylemez: B07/B09 Kasa raporu, geç rapor ve ay rakamı, kapalı gün,
  // B08 ürün satışları ve satış tahmini, B10 komisyon ve ikram, deneme günleri
  assert.equal(ASILPOS_SWITCH_EFFECTS.length, 12);
  assert.match(ASILPOS_SWITCH_EFFECTS[0], /Kasa raporu bu günden itibaren AsilPOS'un gün sonuyla açılır/);
  assert.match(ASILPOS_SWITCH_EFFECTS[1], /Geç kasa raporu bu günden itibaren AsilPOS'un gün sonuyla girilir/);
  assert.match(ASILPOS_SWITCH_EFFECTS[2], /Kafe kapalıydı/);
  assert.match(ASILPOS_SWITCH_EFFECTS[3], /Ürün satışları bu günden itibaren AsilPOS'un gün sonlarından gelir/);
  assert.match(ASILPOS_SWITCH_EFFECTS[4], /Satış tahmini/);
  assert.match(ASILPOS_SWITCH_EFFECTS[5], /Komisyon & hakediş bu günden itibaren/);
  assert.match(ASILPOS_SWITCH_EFFECTS[6], /Ürün ikramı bu günden itibaren AsilPOS'ta işaretlenir/);
  assert.match(ASILPOS_SWITCH_EFFECTS[7], /deneme sayılır/);
  // Denetim B11 (E-39): kasadaki fiyatlar ve metinler
  assert.match(ASILPOS_SWITCH_EFFECTS[8], /siteye bağlı ürünün yeni fiyatını AsilPOS siteden kendisi alır/);
  assert.match(ASILPOS_SWITCH_EFFECTS[9], /ModPOS yerine AsilPOS der/);
  // Marina'nın tahmini stoğu AsilPOS'un günlerini okur (docs/STOK-TAHMINI.md)
  assert.match(ASILPOS_SWITCH_EFFECTS[10], /Marina'nın tahmini stoğu .* bu günden itibaren AsilPOS'un satışlarını/);
  // 21 Kasım kararı: geçiş günü yalnız Marina'nın kasasınındır, Tuzla ModPOS'ta kalır
  assert.match(ASILPOS_SWITCH_EFFECTS[11], /yalnız Marina'nın kasası içindir/);
  assert.match(ASILPOS_SWITCH_EFFECTS[11], /Tuzla'nın kasası ModPOS'ta kalır/);
});

test("anahtar: sitenin anahtarıyla (KARAOKE_SYNC_SECRET) aynı ASILPOS_SYNC_SECRET bağlantıyı açmaz; nedeni söylenir", () => {
  assert.equal(asilposSecretProblem({}), "missing");
  assert.equal(asilposSecretProblem({ ASILPOS_SYNC_SECRET: "x".repeat(31) }), "short");
  assert.equal(asilposSecretProblem({ ASILPOS_SYNC_SECRET: SECRET, KARAOKE_SYNC_SECRET: SECRET }), "same_as_site");
  assert.equal(asilposSecretProblem({ ASILPOS_SYNC_SECRET: ` ${SECRET} `, KARAOKE_SYNC_SECRET: SECRET }), "same_as_site", "boşluk farkı ayrı anahtar sayılmaz");
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: SECRET, KARAOKE_SYNC_SECRET: SECRET }), null);
  assert.equal(asilposSecretProblem({ ASILPOS_SYNC_SECRET: SECRET, KARAOKE_SYNC_SECRET: `${SECRET}-site` }), null);
  assert.equal(asilposSecretFrom({ ASILPOS_SYNC_SECRET: SECRET, KARAOKE_SYNC_SECRET: `${SECRET}-site` }), SECRET);
});

test("altın gövde: AsilPOS'un buildDayPayload biçimi (şube, iki boy, ekler, hizmet, ikram, ödeme kanalları, kartla bahşiş ve tahsilat) sözleşmeye uyar", () => {
  // 23 Kasım 2026'dan altın gövde Faz 2 alanlarını da taşır (indirim, iptaller, kişili ödenmez, zayi, iadeler, yazarkasadan
  // geçmeyen ödeme, yeniden açılış, alınamayan banka gün sonu): yeni alanların okunuşu tests/asilpos-gun-alanlari.test.ts
  // tests/fixtures/asilpos-gun.golden.json: AsilPOS tests/fixtures/lafmaliyet-gun.golden.json'ın bayt bayt kopyası
  // (AsilPOS tests/lafmaliyet-gun.test.ts tohumlanmış günden üretir). AsilPOS'ta yeniden üretilince buraya kopyalanır; şema
  // kayması üretimde kalıcı 400 olurdu, burada test kırılır.
  const raw = read("tests/fixtures/asilpos-gun.golden.json");
  const r = parsePosDay(raw, NOW);
  assert.ok(r.ok, r.ok ? "" : r.field);
  assert.equal(r.data.date, "2026-10-26");
  assert.equal(r.data.sube, LEGACY_POS_BRANCH_ID, "AsilPOS kasası şubesini yazar (Marina)");
  assert.deepEqual(
    r.data.lines.map((l) => [l.posName, l.siteMenuId, l.slot, l.isService]),
    [
      ["KARAOKE ODASI", null, null, true],
      ["LATTE MEDIUM", "mnu-0007", "M", false],
      ["SAN SEBASTİAN", "mnu-0058", "M", false],
      ["TİRAMİSU", "mnu-0072", "M", false],
      ["LATTE LARGE", "mnu-0007", "L", false],
      ["AMERİCANO LARGE", "mnu-0006", "L", false],
      ["CAPPUCCİNO MEDIUM", "mnu-0010", "M", false],
      ["FİLTRE KAHVE MEDIUM", "mnu-0020", "M", false],
      ["ESPRESSO LARGE", "mnu-0005", "L", false],
      ["TÜRK KAHVESİ MEDIUM", "mnu-0019", "M", false],
      ["SYRUP", "mnu-0080", "M", false],
      ["YENİLEBİLİR BARDAK", null, null, false],
      ["ÇAY MEDIUM", "mnu-0042", "M", false],
      ["SU", "mnu-0036", "M", false],
      ["ALTERNATIF SÜT", "mnu-0082", "M", false],
      ["EXTRA SHOT", "mnu-0081", "M", false],
    ],
  );
  // 23 Kasım 2026'dan (AsilPOS kasa zinciri, Faz 3): günde teslim (200) ve giriş (50) var; sayılan teslimden sonradır
  // 24 Kasım 2026'dan (gün sonu tam): günde 5 ₺ nakit bahşiş da var (z.cashIn'in içinde: giriş 50 + bahşiş 5)
  assert.deepEqual([r.data.z.countedCash, r.data.z.handedOver, r.data.z.cashIn, r.data.z.expectedCash, r.data.z.cashTips], [1690, 200, 55, 1700, 5]);
  assert.equal(r.data.z.cardTips, 25);
  assert.equal(r.data.z.cardCollections, 400);
  // Faz 3: açılışın beklenen tutarı, farkı ve nedeni; kasa hareketleri satır satır (Σ harcama = cashOut, Σ teslim =
  // handedOver, Σ giriş ≤ cashIn)
  assert.deepEqual([r.data.z.expectedOpening, r.data.z.openingDiff, r.data.z.openingReason], [1400, 100, "Sabah bozuk para eklendi"]);
  const moves = r.data.cashMoves ?? [];
  assert.deepEqual(
    moves.map((m) => [m.kind, m.amount, m.description, m.categoryId]),
    [
      ["harcama", 120, "Buz", 1],
      ["teslim", 200, "Patrona teslim", null],
      ["giris", 50, "Bozuk para", null],
    ],
  );
  const moved = (k: string) => Math.round(moves.filter((m) => m.kind === k).reduce((a, m) => a + m.amount, 0) * 100) / 100;
  assert.deepEqual([moved("harcama"), moved("teslim")], [r.data.z.cashOut, r.data.z.handedOver]);
  assert.ok(moved("giris") <= (r.data.z.cashIn ?? 0), "giriş cashIn'in içinde");
  assert.deepEqual(r.data.payments.map((p) => p.channel), [null, null, null, "pluxee"]);
  // Z toplamı ödeme alanlarının toplamı, beklenen nakit AsilPOS'un formülüyle (kasa eşlemesi aynısını hesaplar)
  const z = r.data.z;
  assert.equal(Math.round((z.cash + z.card + z.mealCard + z.online + z.other) * 100) / 100, z.zTotal);
  const prefill = asilposPrefill(z);
  assert.deepEqual(prefill.checks, [], "panelin olması gerekeni AsilPOS'unkiyle aynı");

  // Aynı gövdenin kenarları: boş ikram nedeni null, kasaya giren nakit beklenen nakde girer
  const body = JSON.parse(raw) as { z: Record<string, number>; ikram: { reason: string | null }[] };
  body.ikram[1].reason = "";
  body.z.cashIn = 1050;
  body.z.expectedCash = 2695;
  const edge = parsePosDay(JSON.stringify(body), NOW);
  assert.ok(edge.ok, edge.ok ? "" : edge.field);
  assert.equal(edge.data.ikram[1].reason, null, "boş neden null");
  assert.deepEqual(asilposPrefill(edge.data.z).checks, [], "kasaya giren nakit de aynı formülle");
});

test("durum: kayıtlı değer parça parça okunur (bozuk parça yok sayılır); gövdeden gün ve Z", () => {
  assert.deepEqual(parseAsilposState(undefined), { lastOk: null, lastError: null, rejections: {}, unverified: null });
  assert.deepEqual(parseAsilposState("bozuk"), { lastOk: null, lastError: null, rejections: {}, unverified: null });
  const conflict = { at: "2026-10-26T00:20:00.000Z", status: 409, error: "z_conflict", date: "2026-10-25", zNo: 14 };
  const s = parseAsilposState({
    lastOk: { at: "2026-10-26T00:10:00.000Z", date: "2026-10-25", zNo: 14, lines: 42, counted: false },
    lastError: conflict,
    rejections: { "2026-10-25": conflict, "25.10.2026": conflict, "2026-10-24": { status: "?" } },
    unverified: { count: "çok" },
  });
  assert.equal(s.lastOk?.zNo, 14);
  assert.deepEqual(s.lastError, { at: "2026-10-26T00:20:00.000Z", status: 409, error: "z_conflict", field: null, date: "2026-10-25", zNo: 14, sentZNo: null, clearedAt: null });
  assert.deepEqual(Object.keys(s.rejections), ["2026-10-25"], "bozuk anahtar ve bozuk kayıt düşer");
  assert.deepEqual(s.rejections["2026-10-25"], s.lastError);
  assert.equal(s.unverified, null);
  assert.deepEqual(peekPosDay(JSON.stringify(sample())), { date: "2026-10-26", zNo: 128 });
  assert.deepEqual(peekPosDay("{bozuk"), { date: null, zNo: null });
  assert.deepEqual(peekPosDay(JSON.stringify({ date: "26.10.2026", z: { zNo: "128" } })), { date: null, zNo: null });
});

test("durum: son retin metni (409'da iki Z ve çözüm, 400'de alan, 500'de yeniden deneme); imzası tutmayanlar", () => {
  const base = { at: "2026-10-26T00:20:00.000Z", field: null, date: "2026-10-25", zNo: null, sentZNo: null, clearedAt: null };
  const conflict = rejectionText({ ...base, status: 409, error: "z_conflict", zNo: 127, sentZNo: 128 }, "2026-10-26");
  assert.match(conflict, /25\u00a0Ekim için panelde Z 127 kayıtlı; AsilPOS Z 128 gönderdi, hiçbir şey yazılmadı/);
  // AsilPOS 409 ve 400'ü kendisi yeniden denemez: metin elle gönderimin yolunu söyler, "yeniden gönderince yazılır" demez
  assert.match(conflict, /bu günün kaydını silin, sonra AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın \(AsilPOS reddedilen günü kendisi yeniden denemez\)/);
  assert.doesNotMatch(conflict, /yeniden gönderince yazılır/);
  const invalid = rejectionText({ ...base, status: 400, error: "invalid", field: "lines.3.qty" }, "2026-10-26");
  assert.match(invalid, /ilk sorunlu alan lines\.3\.qty/);
  assert.match(invalid, /Düzeltilince AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın/);
  assert.match(rejectionText({ ...base, status: 500, error: "server_error" }, "2026-10-26"), /AsilPOS kendisi yeniden dener/);
  assert.match(rejectionText({ ...base, date: "2025-12-31", status: 409, error: "z_conflict", zNo: 1 }, "2026-10-26"), /31 Aralık 2025/, "başka yılın günü yılıyla");
  assert.match(ASILPOS_RESEND_HINT, /kendisi yeniden göndermez: AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın\.$/);
  const cleared = clearedText({ ...base, status: 409, error: "z_conflict", zNo: 127, clearedAt: "2026-10-26T09:00:00.000Z" }, "2026-10-26");
  assert.match(cleared, /^25\u00a0Ekim kaydı 26\.10\.2026 12:00 silindi\. AsilPOS reddedilen ya da silinen günü kendisi yeniden göndermez/);
  assert.match(clearedText({ ...base, status: 409, error: "z_conflict", zNo: 127 }, "2026-10-26"), /^25\u00a0Ekim kaydı panelde yok\./);
  // İmzası doğrulanamayan istek suçlamaz (yabancı bir istek de olabilir)
  const unsigned = unverifiedText({ count: 3, lastAt: "2026-10-26T00:20:00.000Z", lastStatus: 401 });
  assert.match(unsigned, /^İmzası doğrulanamayan istek geldi; AsilPOS'tansa anahtarı ve kafedeki saati \(±5 dk\) denetleyin\. Son .*en az 3 kez\.$/);
  assert.match(unverifiedText({ count: 1, lastAt: "2026-10-26T00:20:00.000Z", lastStatus: 413 }), /256 KB/);
});

test("durum: günlü retler güne göre (en çok MAX_DAY_REJECTIONS, en eskisi düşer); günün kaydına göre açık / silindi / çözüldü", () => {
  const rej = (date: string, at: string, o: Partial<AsilposRejection> = {}) =>
    ({ at, status: 409, error: "z_conflict", field: null, date, zNo: 127, sentZNo: 128, clearedAt: null, ...o }) as AsilposRejection & { date: string };
  assert.equal(isDayRejection(rej("2026-11-07", "2026-11-07T22:00:00.000Z")), true);
  assert.equal(isDayRejection(rej("2026-11-07", "2026-11-07T22:00:00.000Z", { status: 400, error: "invalid" })), true);
  assert.equal(isDayRejection({ ...rej("2026-11-07", "2026-11-07T22:00:00.000Z"), date: null }), false, "gövdesi okunamayan 400");
  assert.equal(isDayRejection(rej("2026-11-07", "2026-11-07T22:00:00.000Z", { status: 500, error: "server_error" })), false, "500 AsilPOS'un kendi yeniden denemesi");

  // Aynı günün yenisi eskisinin yerine; tavanı aşınca en eski anlı düşer
  let map = withDayRejection({}, rej("2026-11-07", "2026-11-07T22:00:00.000Z"));
  map = withDayRejection(map, rej("2026-11-07", "2026-11-07T23:00:00.000Z", { status: 400, error: "invalid", field: "lines.0.qty" }));
  assert.deepEqual(Object.keys(map), ["2026-11-07"]);
  assert.equal(map["2026-11-07"].field, "lines.0.qty");
  for (let i = 1; i <= MAX_DAY_REJECTIONS; i++) map = withDayRejection(map, rej(`2026-10-${String(i).padStart(2, "0")}`, `2026-11-08T00:${String(i).padStart(2, "0")}:00.000Z`));
  assert.equal(Object.keys(map).length, MAX_DAY_REJECTIONS);
  assert.equal(map["2026-11-07"], undefined, "en eski anlı ret düştü");
  assert.ok(map["2026-10-10"]);

  // Günün paneldeki kaydına göre
  const e = rej("2026-11-07", "2026-11-07T22:00:00.000Z");
  const old = { zNo: 127, lines: 40, receivedAt: "2026-11-07T21:00:00.000Z" };
  assert.equal(dayRejectionStatus(e, old), "open", "panelde eski Z duruyor");
  assert.equal(dayRejectionStatus(e, { ...old, receivedAt: "2026-11-08T09:00:00.000Z" }), "resolved", "gün retten sonra yeniden yazıldı");
  assert.equal(dayRejectionStatus({ ...e, clearedAt: "2026-11-08T10:00:00.000Z" }, null), "cleared", "silindi, Gönder bekleniyor");
  assert.equal(dayRejectionStatus(e, null), "cleared", "409'un günü panelde yok: gönderilince yazılır");
  assert.equal(dayRejectionStatus({ ...e, clearedAt: "2026-11-08T10:00:00.000Z" }, { ...old, receivedAt: "2026-11-08T11:00:00.000Z" }), "resolved", "silindikten sonra geldi");
  const bad = rej("2026-11-09", "2026-11-09T22:00:00.000Z", { status: 400, error: "invalid", zNo: null, sentZNo: null });
  assert.equal(dayRejectionStatus(bad, null), "open", "400'ün günü hiç gelmedi: açık");
});

test("Zil: sayılan AsilPOS gününün açık reddi bir satır (gün ve neden başına); deneme günü, çözülen, silinen ve eski ret düşmez", () => {
  const rej = (date: string, at: string, o: Partial<AsilposRejection> = {}) =>
    ({ at, status: 409, error: "z_conflict", field: null, date, zNo: 127, sentZNo: 128, clearedAt: null, ...o }) as AsilposRejection & { date: string };
  const now = new Date("2026-11-26T09:00:00+03:00");
  const rejections = {
    // Sayılan gün, panelde eski Z duruyor: açık
    "2026-11-25": rej("2026-11-25", "2026-11-25T20:10:00.000Z"),
    // Sözleşmeye uymayan gün: kaydı yok, açık
    "2026-11-24": rej("2026-11-24", "2026-11-24T20:00:00.000Z", { status: 400, error: "invalid", field: "lines.0.qty", zNo: null, sentZNo: null }),
    // Kasa başka şubeye ayarlı
    "2026-11-23": rej("2026-11-23", "2026-11-23T20:00:00.000Z", { error: "wrong_branch", zNo: null, sentZNo: null, sube: "tuzla", expected: "marina" }),
    // Retten sonra yeniden yazıldı: çözüldü
    "2026-11-22": rej("2026-11-22", "2026-11-22T20:00:00.000Z"),
    // Yönetici kaydı sildi, AsilPOS'tan Gönder bekleniyor (kart söyler)
    "2026-11-21": rej("2026-11-21", "2026-11-21T20:00:00.000Z", { clearedAt: "2026-11-21T21:00:00.000Z" }),
    // Deneme günü (geçişten önce)
    "2026-11-10": rej("2026-11-10", "2026-11-25T08:00:00.000Z"),
    // Sayılan ama ret REJECTION_BELL_DAYS'ten eski
    "2026-11-18": rej("2026-11-18", "2026-11-18T20:00:00.000Z", { status: 400, error: "invalid", field: "z", zNo: null, sentZNo: null }),
  };
  const received = {
    "2026-11-25": "2026-11-25T19:50:00.000Z",
    "2026-11-22": "2026-11-23T07:00:00.000Z",
    "2026-11-18": "2026-11-17T20:00:00.000Z",
  };
  assert.equal(REJECTION_BELL_DAYS, 7);
  const rows = rejectionBells({ rejections, switchDay: "2026-11-15", received, branchName: "Marina", today: "2026-11-26", now });
  assert.deepEqual(
    rows.map((r) => [r.id, r.title]),
    [
      [`${ZIL_ONEKI}-ret-2026-11-25-z_conflict`, "Marina gün sonu alınamadı: Z numarası çakıştı"],
      [`${ZIL_ONEKI}-ret-2026-11-24-invalid`, "Marina gün sonu alınamadı: gönderim sözleşmeye uymadı"],
      [`${ZIL_ONEKI}-ret-2026-11-23-wrong_branch`, "Marina gün sonu alınamadı: kasa başka şubeye ayarlı"],
    ],
  );
  // Gövde: gün, ne oldu, ne yapılacağı (AsilPOS'tan elle Gönder)
  assert.equal(rows[0].body.replace(/\s/g, " "), "25 Kasım: panelde Z 127 kayıtlı, AsilPOS Z 128 gönderdi. AsilPOS'taki doğruysa Ayarlar › AsilPOS'ta bu günün kaydını silin, sonra AsilPOS'tan o günü Gönder'e basın.");
  assert.match(rows[1].body, /^24\sKasım: ilk sorunlu alan lines\.0\.qty\. .*Gönder'e basın\.$/);
  assert.match(rows[2].body, /^23\sKasım: AsilPOS "tuzla" için gönderdi, panel "marina" bekliyor\. AsilPOS'ta Yönetim › Ayarlar ve yedek › Şube'yi düzeltin/);
  // Aynı gün aynı nedenle yeniden reddedilince (yeni an) kimlik aynı: satır yinelenmez; başka neden yeni satır
  const again = rejectionBells({ rejections: { ...rejections, "2026-11-25": rej("2026-11-25", "2026-11-26T05:00:00.000Z", { sentZNo: 129 }) }, switchDay: "2026-11-15", received, branchName: "Marina", today: "2026-11-26", now });
  assert.equal(again[0].id, rows[0].id);
  const other = rejectionBells({ rejections: { "2026-11-25": rej("2026-11-25", "2026-11-26T05:00:00.000Z", { status: 400, error: "invalid", field: "z", zNo: null, sentZNo: null }) }, switchDay: "2026-11-15", received, branchName: "Marina", today: "2026-11-26", now });
  assert.equal(other[0].id, `${ZIL_ONEKI}-ret-2026-11-25-invalid`);
  // Geçiş günü yokken (kasa ModPOS) hiçbiri sayılmaz
  assert.deepEqual(rejectionBells({ rejections, switchDay: null, received, branchName: "Marina", today: "2026-11-26", now }), []);
});

test("kaynak: AsilPOS retlerinin zil satırı yalnız yönetici dalında, Sistem başlığında; okunamazsa Sistem'in 'yüklenemedi' satırı", () => {
  const src = read("src/server/actions/notifications.ts");
  const load = src.slice(src.indexOf("export async function loadPanelNotifications"));
  const staffReturn = load.indexOf('if (user.role !== "admin") return');
  assert.ok(staffReturn > 0);
  assert.ok(load.indexOf('safe("asilpos", asilposRejectionBell())') > staffReturn, "personel dalında yok");
  assert.match(load, /\.\.\.modpos, \.\.\.asilpos, /);
  const srv = read("src/server/bell/asilpos.ts");
  assert.match(srv, /href: asilposSettingsHref\(branchId\),\s+group: "sistem",/);
  assert.match(read("src/lib/bell-failed.ts"), /asilpos: \{ group: "sistem",/);
});

test("Ayarlar kartı: sakin durumlar (kurulmadı / bağlı, deneme / geçiş bekliyor / kasa AsilPOS); kırmızı yalnız iki durumda", () => {
  const today = "2026-11-12";
  const none = { lastOk: null, lastError: null, rejections: {}, unverified: null };
  const base: AsilposCardInput = { secretProblem: null, switchDay: null, today, state: none, lastDay: null, totalDays: 0, trialDays: 0, missing: [], rejectionDays: {} };
  const lastDay = { date: "2026-11-11", zNo: 22, receivedAt: "2026-11-11T22:40:00.000Z" };

  // Bugünkü canlı: anahtar yok, geçiş günü yok → hata değil
  const off = asilposCardSummary({ ...base, secretProblem: "missing" });
  assert.deepEqual([off.tone, off.badge, off.headline, off.alerts], ["gray", "Kurulmadı", "Henüz kurulmadı · kasada ModPOS kullanılıyor.", 0]);
  assert.deepEqual(off.lines, []);
  assert.equal(off.short, off.headline);
  const same = asilposCardSummary({ ...base, secretProblem: "same_as_site", totalDays: 2 });
  assert.equal(same.tone, "amber");
  assert.match(same.lines.join(" "), /sitenin anahtarıyla \(KARAOKE_SYNC_SECRET\) aynı: bağlantı kapalı/);
  assert.match(same.lines.join(" "), /Daha önce gelen 2 gün saklanıyor, hiçbir hesaba girmiyor/);
  // Geçiş günü seçili ama anahtar yok: kırmızı
  const broken = asilposCardSummary({ ...base, secretProblem: "missing", switchDay: "2026-11-10" });
  assert.deepEqual([broken.tone, broken.badge], ["red", "Bağlantı kapalı"]);
  assert.match(broken.headline, /Geçiş günü seçili \(10 Kasım 2026\) ama ASILPOS_SYNC_SECRET yok: AsilPOS günleri gelemez/);

  // Bağlı, geçiş günü yok
  const fresh = asilposCardSummary(base);
  assert.deepEqual([fresh.tone, fresh.badge], ["green", "Bağlı"]);
  assert.match(fresh.headline, /henüz gün sonu gelmedi\. Kasa ModPOS/);
  const trial = asilposCardSummary({ ...base, lastDay, totalDays: 3, trialDays: 3 });
  assert.match(trial.headline, /AsilPOS günleri saklanıyor, hesaplara girmiyor/);
  assert.match(trial.lines[0], /^Son gün sonu 11 Kasım \(Z 22\), alındı 12\.11\.2026 01:40\.$/);
  assert.equal(trial.lines[1], "3 deneme günü (sayılmıyor).");

  // Geçiş günü ileride
  const soon = asilposCardSummary({ ...base, switchDay: "2026-11-16", lastDay, totalDays: 3, trialDays: 3 });
  assert.deepEqual([soon.tone, soon.badge], ["blue", "Geçiş bekliyor"]);
  assert.equal(soon.headline, "Geçiş günü 16 Kasım 2026 (4 gün sonra). O güne kadar kasa ModPOS.");

  // Kasa AsilPOS
  const live = asilposCardSummary({ ...base, switchDay: "2026-11-10", lastDay, totalDays: 4, trialDays: 2 });
  assert.deepEqual([live.tone, live.badge, live.headline], ["green", "AsilPOS", "Kasa AsilPOS (10 Kasım'dan beri)."]);
  assert.match(live.lines.join(" "), /Son gün sonu 11 Kasım \(Z 22\)/);
  assert.match(live.lines.join(" "), /Geçiş gününden önceki 2 gün deneme/);
  // Geçişten beri hiç gün gelmedi (son gün denemeydi): turuncu
  const silent = asilposCardSummary({ ...base, switchDay: "2026-11-10", lastDay: { ...lastDay, date: "2026-11-05" }, totalDays: 1, trialDays: 1 });
  assert.equal(silent.tone, "amber");
  assert.match(silent.lines.join(" "), /Geçiş gününden beri henüz gün sonu gelmedi/);
  assert.doesNotMatch(silent.lines.join(" "), /Son gün sonu/, "deneme günü son gün sonu diye gösterilmez");
  // Gelmeyen günler: turuncu, en çok altısı yazılır
  const gaps = asilposCardSummary({ ...base, switchDay: "2026-11-01", lastDay, missing: ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"] });
  assert.equal(gaps.tone, "amber");
  assert.match(
    gaps.lines.join(" "),
    /Gün sonu gelmeyen 7 gün: 3 Kasım, .* 8 Kasım ve 1 gün daha\. AsilPOS'ta Yönetim › Entegrasyon'daki giden kutusuna bakın; reddedilen gün Kasa › Geçmiş günler › Z raporu › Gönder ile yeniden gider\./,
  );

  // Güne bağlanamayan ret (500): son başarılı gönderimden sonraysa kırmızı; rozet bağlantıyı söylemeye devam eder,
  // telefonda kapalı özetin başına yazılır
  const ok = { at: "2026-11-11T22:40:00.000Z", date: "2026-11-11", zNo: 22, lines: 40, counted: true };
  const server = { at: "2026-11-11T23:00:00.000Z", status: 500, error: "server_error", field: null, date: "2026-11-11", zNo: null, sentZNo: 22, clearedAt: null };
  const failed = asilposCardSummary({ ...base, switchDay: "2026-11-10", lastDay, state: { ...none, lastOk: ok, lastError: server } });
  assert.deepEqual([failed.badge, failed.alerts, failed.undated?.fresh, failed.dayRejections], ["AsilPOS", 1, true, []]);
  assert.match(failed.short, /^Son gönderim reddedildi · Kasa AsilPOS/);
  assert.equal(isFreshRejection(server, { ...ok, at: "2026-11-11T23:30:00.000Z" }), false, "sonra başarılı gönderim geldi (AsilPOS 500'ü kendisi yeniden dener)");
  assert.equal(isFreshRejection(server, null), true);
  const recovered = asilposCardSummary({ ...base, state: { ...none, lastOk: { ...ok, at: "2026-11-11T23:30:00.000Z" }, lastError: server } });
  assert.deepEqual([recovered.alerts, recovered.undated?.fresh, recovered.short], [0, false, recovered.headline], "önceki ret gri, özet sakin");

  // Günlü 409: sonraki günün başarılı gönderimi ve başka bir günün reddi onu örtmez; açık kalır, silme düğmesinin günü
  // (paneldeki eski Z) kartta; en yeni gün önce
  const c409 = { at: "2026-11-07T23:00:00.000Z", status: 409, error: "z_conflict", field: null, date: "2026-11-07", zNo: 127, sentZNo: 128, clearedAt: null };
  const e400 = { at: "2026-11-09T23:00:00.000Z", status: 400, error: "invalid", field: "lines.0.qty", date: "2026-11-09", zNo: null, sentZNo: 129, clearedAt: null };
  const panel7 = { zNo: 127, lines: 40, receivedAt: "2026-11-07T22:00:00.000Z" };
  const later200 = { ...ok, at: "2026-11-08T23:00:00.000Z", date: "2026-11-08" };
  const one = asilposCardSummary({ ...base, lastDay, state: { ...none, lastOk: later200, lastError: c409, rejections: { "2026-11-07": c409 } }, rejectionDays: { "2026-11-07": panel7 } });
  assert.deepEqual(
    one.dayRejections.map((x) => [x.rejection.date, x.status, x.day?.zNo]),
    [["2026-11-07", "open", 127]],
  );
  assert.equal(one.undated, null, "günlü ret güne bağlanamayan ret kutusunda tekrar edilmez");
  assert.equal(one.alerts, 1);
  assert.match(one.short, /^7\u00a0Kasım gönderimi reddedildi · Bağlı/);
  const two = asilposCardSummary({
    ...base,
    state: { ...none, lastOk: later200, lastError: e400, rejections: { "2026-11-07": c409, "2026-11-09": e400 } },
    rejectionDays: { "2026-11-07": panel7 },
  });
  assert.deepEqual(
    two.dayRejections.map((x) => [x.rejection.date, x.status]),
    [
      ["2026-11-09", "open"],
      ["2026-11-07", "open"],
    ],
  );
  assert.match(two.short, /^2 gönderim reddedildi · /);
  // AsilPOS panelin Z'sini yeniden gönderdi (200, gün retten sonra yazıldı): çözüldü, kartta yok
  const fixed = asilposCardSummary({ ...base, state: { ...none, lastOk: later200, rejections: { "2026-11-07": c409 } }, rejectionDays: { "2026-11-07": { ...panel7, receivedAt: "2026-11-08T08:00:00.000Z" } } });
  assert.deepEqual([fixed.dayRejections, fixed.alerts, fixed.short], [[], 0, fixed.headline]);
  // Yönetici sildi: kırmızı değil, AsilPOS'tan Gönder bekleniyor (turuncu, özette)
  const waiting = asilposCardSummary({ ...base, state: { ...none, rejections: { "2026-11-07": { ...c409, clearedAt: "2026-11-08T09:00:00.000Z" } } } });
  assert.deepEqual(
    waiting.dayRejections.map((x) => [x.rejection.date, x.status]),
    [["2026-11-07", "cleared"]],
  );
  assert.equal(waiting.alerts, 0);
  assert.match(waiting.short, /^7\u00a0Kasım için AsilPOS'tan Gönder bekleniyor · Bağlı/);
  // Anahtar yokken retler kırmızı yapmaz, özete girmez
  const closed = asilposCardSummary({ ...base, secretProblem: "missing", state: { ...none, lastError: server, rejections: { "2026-11-07": c409 } }, rejectionDays: { "2026-11-07": panel7 } });
  assert.deepEqual([closed.alerts, closed.short], [0, closed.headline]);
});

test("Ayarlar kartı: imzası doğrulanamayan istek, sonra başarılı gönderim geldiyse uyarı değil", () => {
  const ok = { at: "2026-11-11T22:40:00.000Z", date: "2026-11-11", zNo: 22, lines: 40, counted: true };
  const u = { count: 1, lastAt: "2026-11-11T22:30:00.000Z", lastStatus: 401 };
  assert.equal(isUnverifiedAfterOk({ lastOk: ok, lastError: null, rejections: {}, unverified: u }), false);
  assert.equal(isUnverifiedAfterOk({ lastOk: ok, lastError: null, rejections: {}, unverified: { ...u, lastAt: "2026-11-11T22:50:00.000Z" } }), true);
  assert.equal(isUnverifiedAfterOk({ lastOk: null, lastError: null, rejections: {}, unverified: u }), true, "hiç başarılı gönderim yok");
  assert.equal(isUnverifiedAfterOk({ lastOk: ok, lastError: null, rejections: {}, unverified: null }), false);
});

test("Ayarlar kartı: gelmeyen günler geçiş gününden düne, onaylı kapalı günler hariç, en çok son 60 gün", () => {
  assert.deepEqual(missingAsilposDays(null, "2026-11-12", [], []), []);
  assert.deepEqual(missingAsilposDays("2026-11-12", "2026-11-12", [], []), [], "bugün sayılmaz (gün sonu henüz alınmamış olabilir)");
  assert.deepEqual(missingAsilposDays("2026-11-20", "2026-11-12", [], []), [], "geçiş günü ileride");
  assert.deepEqual(missingAsilposDays("2026-11-08", "2026-11-12", ["2026-11-08", "2026-11-10"], ["2026-11-09"]), ["2026-11-11"]);
  const long = missingAsilposDays("2026-01-01", "2026-11-12", [], []);
  assert.equal(long.length, 60);
  assert.equal(long[long.length - 1], "2026-11-11");
});

test("eylemler ve çekirdekler: yalnız yönetici; günü silme parolayla ve gün sonunun kilidi altında; ayar FIFO gibi", () => {
  const actions = read("src/server/actions/asilpos.ts");
  assert.match(actions, /^"use server";/);
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["saveAsilposSwitchDay", "deleteAsilposDay"], "dosyada yardımcı dışa aktarım yok (her biri bir POST ucu)");
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`)).split(/\nexport /)[0];
    assert.match(body, /return attempt\(async \(\) => \{\s*const me = adminActor\(await requireAdmin\(\)\);/, `${name}: önce yönetici oturumu`);
  }
  const del = actions.slice(actions.indexOf("export async function deleteAsilposDay"));
  assert.ok(del.indexOf('requireStepUp(me, confirm, `AsilPOS günü silme: ${data.date}`, "AsilPOS")') > 0, "parola onayı, yeri AsilPOS");
  assert.ok(del.indexOf("requireStepUp(") < del.indexOf("removeAsilposDay("), "parola yazımdan önce");
  assert.ok(del.indexOf("if (!rep) throw") < del.indexOf("requireStepUp("), "olmayan gün için parola sorulmaz");
  // Ön denetim çekirdekle aynı satıra bakar: yalnız AsilPOS'un şubesinin günü (öteki şubenin eski satırı "kayıtlı" sayılmaz)
  assert.match(del.slice(0, del.indexOf("if (!rep) throw")), /\.where\(and\(eq\(s\.posDayReports\.date, data\.date\), eq\(s\.posDayReports\.branchId, data\.branchId\)\)\)/);
  const admin = read("src/server/asilpos/admin.ts");
  assert.match(admin, /^import "server-only";/m);
  for (const fn of ["writeAsilposSwitchDay", "removeAsilposDay"]) {
    const body = admin.slice(admin.indexOf(`export async function ${fn}`)).split(/\nexport /)[0];
    assert.match(body, /if \(me\.role !== "admin"\) throw new UserError\(ADMIN_ONLY\);/, `${fn}: rol çekirdekte de`);
  }
  // Günü silme, gün sonunun yazımıyla aynı danışma kilidi altında (ingest.ts)
  assert.match(admin, /export async function removeAsilposDay\(db: DB, me: Actor, branchId: string, date: string, zNo: number/);
  assert.match(admin, /pg_advisory_xact_lock\(hashtext\(\$\{`\$\{GUN_KILIDI_ONEKI\}\$\{branchId\}:\$\{date\}`\}\)\)/);
  assert.match(read("src/server/asilpos/ingest.ts"), /pg_advisory_xact_lock\(hashtext\(\$\{`\$\{GUN_KILIDI_ONEKI\}\$\{branchId\}:\$\{day\.date\}`\}\)\)/);
  // Ayar ekranı: yalnız yöneticinin Ayarlar sayfasında
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.ok(page.indexOf("await requireAdmin();") > 0 && page.includes("<AsilposCard"));
});
