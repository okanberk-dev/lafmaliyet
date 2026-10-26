// LafPOS bağlantısı (docs/LAFPOS.md): imza (laffogato.net bağlantısının kuralı ve kodu, ayrı anahtar; vektörleri LafPOS
// deposunun server/lib/signature.ts'i de verir), isteğin denetimi (503 / 413 / 401), gövdenin beyaz listesi ve hata
// alanının yolu, ürünün bulunma sırası, Kasa raporunun "LafPOS'tan doldur"u ve maliyet listesinin beyaz listesi.
// Veritabanı tarafı (idempotent yazım, loadDailyProductSales, uçların bütünü) tests/lafpos-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/lafpos.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createPosMappingIndex } from "../src/lib/calc/pos-paste";
import type { Product } from "../src/lib/calc/types";
import { sign, signedHeaders } from "../src/lib/karaoke/signature";
import { posCostItems } from "../src/lib/lafpos/costs";
import { parsePosDay, POS_DAY_MAX_BYTES, resolvePosLine, siteSlotKey, type PosDayZ } from "../src/lib/lafpos/day";
import { LAFPOS_NO_COUNT_TEXT, lafposPrefill, lafposSummary } from "../src/lib/lafpos/prefill";
import { checkLafposRequest, lafposSecretFrom } from "../src/lib/lafpos/request";
import { prefillPlan } from "../src/lib/photo-read/kasa";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const T = 1760000000;
/** Gövdenin denetlendiği an: 26 Ekim 2026 öğlen (iş günü 26 Ekim) */
const NOW = new Date("2026-10-26T12:00:00+03:00");

/** Sözleşmedeki örnek (docs/03-ENTEGRASYON.md §4) */
const sample = () => ({
  version: 1,
  source: "lafpos",
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

test("imza: LafPOS uçlarının vektörleri (sitenin bağlantısıyla aynı kod; LafPOS'un server/lib/signature.ts'i aynısını verir)", () => {
  const body = '{"version":1,"source":"lafpos","date":"2026-10-26"}';
  assert.equal(
    sign(SECRET, { timestamp: T, method: "POST", url: new URL("https://ladmin.laffogato.net/api/pos/gun"), body }),
    "5ab02280859d09c6afb003f9cc62bbfdd46b1738f6a25c9a6cf8a475113639cb",
  );
  assert.equal(
    sign(SECRET, { timestamp: T, method: "GET", url: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler"), body: "" }),
    "4693defb7ef97b132908d552133471db2827261b6468b2ef565effa6fcbf8a3c",
  );
  // İmza kuralı kopyalanmadı: denetim karaoke bağlantısının verifySignature'ını çağırır
  const src = read("src/lib/lafpos/request.ts");
  assert.match(src, /import \{ verifySignature \} from "@\/lib\/karaoke\/signature";/);
  assert.doesNotMatch(src, /createHmac|createHash|timingSafeEqual/);
});

test("istek: anahtar yoksa 503, gövde 256 KB'tan büyükse 413, imza yok / yanlış / eski / başka uç / başka anahtar 401", () => {
  const url = new URL("https://ladmin.laffogato.net/api/pos/gun");
  const body = JSON.stringify(sample());
  const now = T * 1000;
  const h = signedHeaders(SECRET, "POST", url, body, now);
  const check = (over: Partial<Parameters<typeof checkLafposRequest>[0]> = {}) =>
    checkLafposRequest({ secret: SECRET, method: "POST", url, body, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], maxBytes: POS_DAY_MAX_BYTES, now, ...over });
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
  const checkGet = (over: Partial<Parameters<typeof checkLafposRequest>[0]> = {}) =>
    checkLafposRequest({ secret: SECRET, method: "GET", url: get, body: "", timestamp: g["x-laf-timestamp"], signature: g["x-laf-signature"], maxBytes: 0, now, ...over });
  assert.deepEqual(checkGet(), { ok: true });
  assert.deepEqual(checkGet({ url: new URL("https://ladmin.laffogato.net/api/panel/pos/urunler?tum=1") }), unauthorized, "sorgu imzanın içinde");
  assert.deepEqual(checkGet({ secret: null }), { ok: false, status: 503, error: "not_configured" });
});

test("anahtar: LAFPOS_SYNC_SECRET en az 32 karakter (kırpılarak); yoksa ya da kısaysa bağlantı kapalı", () => {
  assert.equal(lafposSecretFrom({}), null);
  assert.equal(lafposSecretFrom({ LAFPOS_SYNC_SECRET: "" }), null);
  assert.equal(lafposSecretFrom({ LAFPOS_SYNC_SECRET: "x".repeat(31) }), null);
  assert.equal(lafposSecretFrom({ LAFPOS_SYNC_SECRET: ` ${"x".repeat(31)} ` }), null);
  assert.equal(lafposSecretFrom({ LAFPOS_SYNC_SECRET: ` ${SECRET} ` }), SECRET);
  // Sitenin anahtarı yerine geçmez
  assert.equal(lafposSecretFrom({ KARAOKE_SYNC_SECRET: SECRET }), null);
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
  // HİZMET eşleştirmesi ve LafPOS'un hizmet işareti
  assert.deepEqual(line({ posName: "Karaoke Odası" }), { productId: null, isService: true, via: "eslestirme" });
  assert.deepEqual(line({ posName: "LATTE MEDIUM", siteMenuId: "mnu-0003", slot: "M", isService: true }), { productId: null, isService: true, via: "hizmet" });
  // Hiçbiri: ürünsüz satır (Satışlar'daki gibi sonra eşlenir)
  assert.deepEqual(line({ posName: "YENİ ÜRÜN", siteMenuId: "mnu-0500", slot: "M" }), { productId: null, isService: false, via: null });
});

const Z = (over: Partial<PosDayZ> = {}): PosDayZ => ({ ...sample().z, ...over });

test("Kasa raporu: LafPOS'un Z'si formun alanlarına (CashPrefill, lafpos); yalnız boş alanlar dolar, farklı olan öneri", () => {
  const p = lafposPrefill(Z());
  assert.equal(p.source, "lafpos");
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
    cashOut: 450,
    countedCash: 12980,
    handedOver: 0,
  });
  assert.ok(Object.values(p.values).every((v) => v!.confidence === "high"), "LafPOS'un rakamı tahmin değil");
  assert.ok(!("cashDiff" in p.values), "kasa farkını form kendisi hesaplar");
  const fields = ["zNo", "receipts", "zTotal", "cash", "card", "mealCard", "online", "other", "offRevenue", "discounts", "openingCash", "cashOut", "countedCash", "handedOver", "bankPos"] as const;
  const empty = Object.fromEntries(fields.map((f) => [f, ""]));
  const all = prefillPlan(p, empty);
  assert.equal(all.fill.length, 14);
  assert.deepEqual(all.fill.find((f) => f.field === "card"), { field: "card", text: "29110,5", warn: null });
  assert.deepEqual(all.fill.find((f) => f.field === "zNo"), { field: "zNo", text: "128", warn: null });
  assert.ok(!all.fill.some((f) => f.field === "bankPos"), "banka POS LafPOS'tan gelmez");
  assert.equal(lafposSummary(all), "LafPOS'tan 14 alan dolduruldu. Kontrol edip gönderin.");
  // Yazılmış alan değişmez: açılış devirden (1.450), kasadan çıkan fişlerden (450) dolmuştu
  const typed = prefillPlan(p, { ...empty, openingCash: "1.450", cashOut: "450", card: "29110,50" });
  assert.deepEqual(typed.differs, [{ field: "openingCash", photo: 1500, text: "1500" }]);
  assert.equal(typed.fill.length, 11);
  assert.equal(lafposSummary(typed), "LafPOS'tan 11 alan dolduruldu; 1 alan yazdığınızdan farklı, turuncu olanlara bakın.");
  const filled = Object.fromEntries(all.fill.map((f) => [f.field, f.text]));
  assert.equal(lafposSummary(prefillPlan(p, { ...empty, ...filled })), "Yazdıklarınız LafPOS'takiyle aynı.");
  assert.equal(lafposSummary(prefillPlan(p, { ...empty, ...filled, cash: "11.000" })), "LafPOS'ta 1 alan yazdığınızdan farklı; turuncu olanlara bakın.");
  // Sayılmadan kapanan gün: sayılan nakit boş kalır ve turuncu
  const noCount = lafposPrefill(Z({ countedCash: null, cashDiff: null }));
  assert.deepEqual(noCount.missing, ["countedCash"]);
  const plan = prefillPlan(noCount, empty);
  assert.deepEqual(plan.missing, ["countedCash"]);
  assert.ok(!plan.fill.some((f) => f.field === "countedCash"));
  assert.equal(lafposSummary(prefillPlan(noCount, { ...empty, ...filled, countedCash: "" })), LAFPOS_NO_COUNT_TEXT);
});

test("Kasa formu: LafPOS düğmesi aynı uygulama kuralından (prefillPlan) geçer, kaydetmez; işaret kaynağıyla", () => {
  const form = read("src/app/panel/kasa/cash-form.tsx");
  const fill = form.slice(form.indexOf("function fillFromLafpos()"), form.indexOf("/** Yükleme ya da yeniden okumanın sonucu"));
  assert.match(fill, /prefillPlan\(lafpos\.prefill, /);
  assert.match(fill, /setMarks\(\(m\) => planMarks\(m, plan, "lafpos"\)\)/);
  assert.doesNotMatch(fill, /submitCashReport|start\(/, "düğme kaydetmez");
  assert.match(form, /LafPOS&apos;tan doldur/);
  assert.match(form, /lafpos: \{ badge: "LafPOS'tan", at: "LafPOS'ta", take: "LafPOS'takini yaz" \}/);
  // Sayfa: yalnız formun günü için, okunamazsa form yine açılır
  const page = read("src/app/panel/kasa/page.tsx");
  assert.match(page, /showForm \? loadLafposDay\(date\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
  assert.match(page, /lafpos=\{lafposDay\}/);
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
  const order = ["await connection()", "lafposSecret()", "content-length", "request.text()", "receivePosDay("];
  const at = order.map((s) => gun.indexOf(s));
  assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), `sıra: ${order.join(" → ")}`);
  assert.match(gun, /"Cache-Control": "no-store"/);
  const ingest = read("src/server/lafpos/ingest.ts");
  const receive = ingest.slice(ingest.indexOf("export async function receivePosDay"));
  assert.ok(receive.indexOf("checkLafposRequest(") < receive.indexOf("parsePosDay(") && receive.indexOf("parsePosDay(") < receive.indexOf("storePosDay("));
  // Tek işlem, günün danışma kilidi, önce özet sonra satırlar (sil + yaz)
  const store = ingest.slice(ingest.indexOf("export async function storePosDay"), ingest.indexOf("export async function receivePosDay"));
  assert.match(store, /db\.transaction\(async \(tx\) => \{\s*await tx\.execute\(sql`select pg_advisory_xact_lock\(hashtext\(\$\{`lafpos-gun:\$\{day\.date\}`\}\)\)`\);/);
  assert.ok(store.indexOf("insert(s.posDayReports)") < store.indexOf("delete(s.posDailySales)") && store.indexOf("delete(s.posDailySales)") < store.indexOf("insert(s.posDailySales)"));
  const urunler = read("src/app/api/panel/pos/urunler/route.ts");
  assert.match(urunler, /export async function GET\(request: NextRequest\) \{\s*await connection\(\);/);
  assert.match(urunler, /"Cache-Control": "no-store"/);
  assert.match(urunler, /servePosProducts\(\{\s*secret: lafposSecret\(\),/);
  assert.doesNotMatch(urunler, /getCurrentUser|requireUser|requireAdmin/, "oturumla açılmaz");
  // Oturum ara katmanı bu uçlara dokunmaz (imza tek kapı)
  assert.doesNotMatch(read("src/proxy.ts"), /\/api\/pos|\/api\/panel/);
});

test("kurulum: .env.example'da LAFPOS_SYNC_SECRET, belgeler bağlantılı", () => {
  assert.match(read(".env.example"), /^LAFPOS_SYNC_SECRET=$/m);
  const doc = read("docs/LAFPOS.md");
  for (const s of ["/api/pos/gun", "/api/panel/pos/urunler", "LAFPOS_SYNC_SECRET", "pos_daily_sales", "pos_day_reports", "loadDailyProductSales", "LafPOS'tan doldur"]) assert.ok(doc.includes(s), s);
  assert.match(read("docs/KASA-RAPORU.md"), /\[LAFPOS\.md\]\(LAFPOS\.md\)/);
  assert.match(read("docs/planlar/CRITIQUE2.md"), /docs\/LAFPOS\.md/);
});
