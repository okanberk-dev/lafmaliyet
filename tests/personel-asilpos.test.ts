// AsilPOS personel bağlantısının lafmaliyet tarafı (LM-4b; CONTRACT §3, sahibin kararı 2: "ladmin'de hesapları var; doğru
// hesabı bağladığından emin ol"): AsilPOS kullanıcısı lafmaliyet'in maaş satırına (`s:<staff.id>`) yalnız elle bağlanır,
// lafmaliyet her kimliği doğrular.
// - İmzalı `GET /api/panel/pos/personel?sube=marina`: şubenin bu ay ya da geçen ay aralıktaki maaş satırları
//   `{ ref, name, active, account }`; hesap başına tek öğe (biten satır ile "Devam ettir"in yeni satırı aynı hesaba bağlı
//   olabilir: o ayın satırı); maaş, e-posta, ay gitmez
// - Gövdenin `workedStaffRefs`'i okunur (bozuksa gün yine yazılır), sınıflanır: sayılan / bilinmeyen / başka şube
// - Yemek kartının günü ayın her sayılan AsilPOS gününde liste geldiyse AsilPOS'ta çalıştığı gün; yoksa Ayarlar'daki gün
// Veritabanı tarafı tests/personel-asilpos-db.test.ts.
// Çalıştırma: npx tsx --test tests/personel-asilpos.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, mealCardText, staffCost } from "../src/lib/calc/engine";
import { staffWarnings } from "../src/lib/calc/personnel";
import type { Dataset, Staff } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { signedHeaders } from "../src/lib/karaoke/signature";
import { parsePosDay, sentWorkedStaffRefs } from "../src/lib/asilpos/day";
import { classifyWorkedStaff, asilposWorkedDays, asilposWorkedUnseen, posStaffItems, type AsilposWorked, type PosStaffRow } from "../src/lib/asilpos/personel";
import { checkPosStaffRequest } from "../src/lib/asilpos/personel-istek";
import { payrollFromModel } from "../src/lib/bordro/payroll";
import { DEFAULT_PAYROLL_SETTINGS } from "../src/lib/bordro/settings";
import { datasetFromSeed, type SeedData } from "./fixtures/baslangic";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const close = (a: number, b: number, msg: string, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
const SECRET = "test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-11-24T12:00:00+03:00");

// ---------------------------------------------------------------- personel listesi

const row = (p: Partial<PosStaffRow> & Pick<PosStaffRow, "id" | "name">): PosStaffRow => ({
  branchId: "marina",
  startMonth: null,
  endMonth: null,
  userId: null,
  personRef: null,
  ...p,
});

test("personel listesi: şubenin bu ay ya da geçen ay aralıktaki satırları; hesap adı bağlı girişten; maaş, e-posta, ay yok", () => {
  const rows = [
    row({ id: 12, name: "Ayşe Yılmaz", userId: 3 }),
    row({ id: 7, name: "Arda", startMonth: "2026-11" }),
    row({ id: 8, name: "Cenk", endMonth: "2026-10", userId: 4 }),
    row({ id: 9, name: "Derya", endMonth: "2026-09" }),
    row({ id: 10, name: "Burak", startMonth: "2026-12" }),
    row({ id: 11, name: "Tuzla Personeli", branchId: "tuzla" }),
  ];
  const items = posStaffItems({ rows, accounts: new Map([[3, "Ayşe Yılmaz (hesap)"], [4, "Cenk K."]]), sube: "marina", month: "2026-11" });
  assert.deepEqual(items, [
    { ref: "s:7", name: "Arda", active: true, account: null },
    { ref: "s:12", name: "Ayşe Yılmaz", active: true, account: "Ayşe Yılmaz (hesap)" },
    { ref: "s:8", name: "Cenk", active: false, account: "Cenk K." },
  ]);
  // Ekim'de biten Cenk geçen ayın satırıdır (etkin değil); Eylül'de biten Derya ve Aralık'ta başlayacak Burak, Tuzla yok
  for (const i of items) assert.deepEqual(Object.keys(i).sort(), ["account", "active", "name", "ref"], "yalnız dört alan");
});

test("personel listesi: biten satır ile 'Devam ettir'in yeni satırı aynı hesaba bağlıysa tek öğe (o ayın satırı); bağlantısız satırlar ayrı", () => {
  const rows = [
    row({ id: 20, name: "Ayşe", userId: 3, endMonth: "2026-10" }),
    row({ id: 31, name: "Ayşe", userId: 3, startMonth: "2026-11" }),
    // Hesabı olmayan Vardiya adı da tek kişi
    row({ id: 21, name: "Mert", personRef: "n:mert", endMonth: "2026-10" }),
    row({ id: 32, name: "Mert", personRef: "n:mert", startMonth: "2026-11" }),
    // Bağlantısız aynı ad: iki ayrı satır (kimin kim olduğunu ad söylemez)
    row({ id: 22, name: "Ece", endMonth: "2026-10" }),
    row({ id: 33, name: "Ece", startMonth: "2026-11" }),
  ];
  const items = posStaffItems({ rows, accounts: new Map([[3, "Ayşe"]]), sube: "marina", month: "2026-11" });
  assert.deepEqual(
    items.map((i) => [i.ref, i.active]),
    [
      ["s:31", true],
      ["s:22", false],
      ["s:33", true],
      ["s:32", true],
    ],
  );
  // Bu ayın satırı yoksa (ikisi de geçen ay biter: biri Ekim'in başı, öteki sonu olamaz; aralıklar ayrık) en yeni satır
  const old = posStaffItems({
    rows: [row({ id: 40, name: "Su", userId: 9, startMonth: "2026-01", endMonth: "2026-09" }), row({ id: 41, name: "Su", userId: 9, startMonth: "2026-10", endMonth: "2026-10" })],
    accounts: new Map(),
    sube: "marina",
    month: "2026-11",
  });
  assert.deepEqual(old.map((i) => i.ref), ["s:41"]);
});

test("imza ve şube: anahtar yoksa 503, imzasız 401, şube yoksa 400, başka şube 409 wrong_branch; imza şubeden önce", () => {
  const url = new URL("https://ladmin.laffogato.net/api/panel/pos/personel?sube=marina");
  const h = signedHeaders(SECRET, "GET", url, "", NOW.getTime());
  const ok = { expected: "marina", secret: SECRET, url, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: NOW.getTime() };
  assert.deepEqual(checkPosStaffRequest(ok), { ok: true, sube: "marina" });
  assert.deepEqual(checkPosStaffRequest({ ...ok, secret: null }), { ok: false, status: 503, body: { error: "not_configured" } });
  assert.deepEqual(checkPosStaffRequest({ ...ok, signature: null }), { ok: false, status: 401, body: { error: "unauthorized" } });
  const tuzla = new URL("https://ladmin.laffogato.net/api/panel/pos/personel?sube=tuzla");
  const th = signedHeaders(SECRET, "GET", tuzla, "", NOW.getTime());
  assert.deepEqual(checkPosStaffRequest({ ...ok, url: tuzla, timestamp: th["x-laf-timestamp"], signature: th["x-laf-signature"] }), {
    ok: false,
    status: 409,
    body: { error: "wrong_branch", sube: "tuzla", expected: "marina" },
  });
  // Şube imzanın içinde: imzalanmamış şube 401 (409 değil; ayrıntı sızmaz)
  assert.equal(checkPosStaffRequest({ ...ok, url: tuzla }).ok, false);
  assert.deepEqual(checkPosStaffRequest({ ...ok, url: tuzla }), { ok: false, status: 401, body: { error: "unauthorized" } });
  const none = new URL("https://ladmin.laffogato.net/api/panel/pos/personel");
  const nh = signedHeaders(SECRET, "GET", none, "", NOW.getTime());
  assert.deepEqual(checkPosStaffRequest({ ...ok, url: none, timestamp: nh["x-laf-timestamp"], signature: nh["x-laf-signature"] }), {
    ok: false,
    status: 400,
    body: { error: "invalid", field: "sube" },
  });
});

test("uç: imzalı, önbelleksiz, oturumsuz GET; çekirdek imza ve şubeyi okumadan önce denetler", () => {
  const route = read("src/app/api/panel/pos/personel/route.ts");
  assert.match(route, /export async function GET\(request: NextRequest\) \{\s*await connection\(\);/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /servePosStaff\(\{\s*(?:\/\/[^\n]*\n\s*)?\.\.\.\(await posRequestCaller\(request\)\),/);
  assert.doesNotMatch(route, /getCurrentUser|requireUser|requireAdmin/, "oturumla açılmaz");
  const serve = read("src/server/asilpos/personel.ts");
  const handler = serve.slice(serve.indexOf("export async function servePosStaff"));
  assert.ok(handler.indexOf("checkPosStaffRequest(") > 0 && handler.indexOf("checkPosStaffRequest(") < handler.indexOf("await load("), "imza ve şube okumadan önce");
  // Maaş, e-posta ve ay okunmaz (sütun beyaz listesi)
  const loader = serve.slice(serve.indexOf("export async function loadPosStaff"), serve.indexOf("export async function servePosStaff"));
  assert.doesNotMatch(loader, /netSalary|extras|email|dailyWage|mealCard/);
});

// ---------------------------------------------------------------- gövde: workedStaffRefs

test("gövde: workedStaffRefs okunur (tekil, sayı sırasıyla); bozuksa gün yine yazılır, alan yok sayılır", () => {
  const golden = JSON.parse(read("tests/fixtures/asilpos-gun.golden.json")) as Record<string, unknown>;
  const now = new Date("2026-10-26T12:00:00+03:00");
  const withRefs = (refs: unknown) => JSON.stringify({ ...golden, workedStaffRefs: refs });
  const r = parsePosDay(withRefs(["s:12", "s:7", "s:12"]), now);
  assert.ok(r.ok, r.ok ? "" : r.field);
  assert.deepEqual(r.data.workedStaffRefs, ["s:7", "s:12"]);
  // Alan yoksa bilinmiyor (eski AsilPOS ya da bağlı kullanıcı yok): undefined; boş liste "bağlı var, kimse çalışmadı"
  const plain = parsePosDay(JSON.stringify(golden), now);
  assert.ok(plain.ok && plain.data.workedStaffRefs === undefined, "alan yok");
  const empty = parsePosDay(withRefs([]), now);
  assert.ok(empty.ok && Array.isArray(empty.data.workedStaffRefs) && empty.data.workedStaffRefs.length === 0, "boş liste");
  // Bozuk liste (ad, u:, 0, çok uzun) günü reddetmez
  for (const bad of [["Ayşe"], ["u:3"], ["s:0"], "s:7", [7], Array.from({ length: 501 }, (_, i) => `s:${i + 1}`)]) {
    const b = parsePosDay(withRefs(bad), now);
    assert.ok(b.ok, `gün yazılır: ${JSON.stringify(bad).slice(0, 30)}`);
    assert.equal(b.data.workedStaffRefs, undefined, "alan yok sayılır");
  }
  // Uç 200 yanıtı için gönderilip gönderilmediği (gövdeden; okunamayan alan gönderilmemiş sayılır)
  assert.deepEqual(sentWorkedStaffRefs(withRefs(["s:12", "s:7"])), ["s:7", "s:12"]);
  assert.equal(sentWorkedStaffRefs(JSON.stringify(golden)), undefined);
  assert.equal(sentWorkedStaffRefs(withRefs(["Ayşe"])), undefined);
  assert.equal(sentWorkedStaffRefs("{"), undefined);
});

test("ikinci altın gövde (AsilPOS tests/fixtures/lafmaliyet-gun-personel.golden.json'ın bayt bayt kopyası): ilki + yalnız workedStaffRefs", () => {
  const raw = read("tests/fixtures/asilpos-gun-personel.golden.json");
  const golden = JSON.parse(read("tests/fixtures/asilpos-gun.golden.json")) as Record<string, unknown>;
  assert.deepEqual(JSON.parse(raw), { ...golden, workedStaffRefs: ["s:7", "s:12"] });
  const r = parsePosDay(raw, new Date("2026-10-26T12:00:00+03:00"));
  assert.ok(r.ok, r.ok ? "" : r.field);
  assert.deepEqual(r.data.workedStaffRefs, ["s:7", "s:12"]);
  // Ad gitmez: gövdede kişi adı ya da kullanıcı kimliği yok, yalnız s:<id>
  for (const ref of (JSON.parse(raw) as { workedStaffRefs: unknown[] }).workedStaffRefs) assert.match(String(ref), /^s:[1-9]\d*$/);
});

test("sınıflama: sayılan = şubenin o ay aralıktaki satırı; başka şubenin satırı otherBranch; yok, silinmiş ya da aralık dışı unknown", () => {
  const rows = new Map(
    [
      { id: 7, branchId: "marina", startMonth: "2026-11", endMonth: null },
      { id: 12, branchId: "marina", startMonth: null, endMonth: null },
      { id: 13, branchId: "tuzla", startMonth: null, endMonth: null },
      { id: 14, branchId: "marina", startMonth: null, endMonth: "2026-10" },
    ].map((r) => [r.id, r]),
  );
  assert.deepEqual(classifyWorkedStaff(["s:7", "s:12", "s:13", "s:14", "s:99"], rows, "2026-11-22", "marina"), {
    counted: ["s:7", "s:12"],
    unknown: ["s:14", "s:99"],
    otherBranch: ["s:13"],
  });
  // Satırın aralığı günün ayına göre: Ekim'de 7 henüz yok, 14 var
  assert.deepEqual(classifyWorkedStaff(["s:7", "s:14"], rows, "2026-10-31", "marina"), { counted: ["s:14"], unknown: ["s:7"], otherBranch: [] });
  assert.deepEqual(classifyWorkedStaff([], rows, "2026-11-22", "marina"), { counted: [], unknown: [], otherBranch: [] });
});

// ---------------------------------------------------------------- yemek kartının günü

const data: SeedData = JSON.parse(read("tests/fixtures/baslangic/veri.json"));
const excel: Dataset = datasetFromSeed(data);
const person = (p: Partial<Staff> & Pick<Staff, "id" | "name" | "netSalary">): Staff => ({ extras: 0, active: true, startMonth: null, endMonth: null, branchId: "marina", ...p });
const ARDA = person({ id: 7, name: "Arda", netSalary: 35_000, mealCard: true });
const CENK = person({ id: 12, name: "Cenk", netSalary: 32_000, mealCard: true });
const DERYA = person({ id: 13, name: "Derya", netSalary: 30_000 });
const TUZLA = person({ id: 14, name: "Tuzla", netSalary: 30_000, mealCard: true, branchId: "tuzla" });

const decDay = (d: number) => `2026-12-${String(d).padStart(2, "0")}`;
/** Aralık 2026: 1–31 her gün AsilPOS gün sonu; Arda 20 gün, Cenk 18 gün, Derya (işaretsiz) 25 gün */
const decWorked = (patch: (date: string, refs: string[]) => string[] | null = (_d, r) => r): AsilposWorked => ({
  switchDays: { marina: "2026-11-22" },
  days: Array.from({ length: 31 }, (_, i) => {
    const d = i + 1;
    const refs = [...(d <= 20 ? ["s:7"] : []), ...(d > 13 ? ["s:12"] : []), ...(d <= 25 ? ["s:13"] : []), "s:99"];
    return { branchId: "marina", date: decDay(d), refs: patch(decDay(d), refs) };
  }),
});
const nov = { month: "2026-11", openDays: 30, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const dec = { month: "2026-12", openDays: 31, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const ds = (staff: Staff[], patch: Partial<Dataset> = {}): Dataset => ({ ...excel, currentMonth: "2027-01", months: [...excel.months, nov, dec], staff, ...patch });

test("çalışılan gün: ayın her sayılan AsilPOS günü liste taşıyorsa kişinin listede geçtiği gün; değilse null (Ayarlar'daki gün)", () => {
  const w = decWorked();
  assert.equal(asilposWorkedDays(w, ARDA, "2026-12"), 20);
  assert.equal(asilposWorkedDays(w, CENK, "2026-12"), 18);
  assert.equal(asilposWorkedDays(w, DERYA, "2026-12"), 25);
  // Bir gün listesiz (o gün bağlı kimse yoktu ya da eski AsilPOS): ay eksik, varsayılan
  assert.equal(asilposWorkedDays(decWorked((d, r) => (d === decDay(5) ? null : r)), ARDA, "2026-12"), null);
  // Başka şubenin kişisi (Tuzla ModPOS'ta): her zaman varsayılan
  assert.equal(asilposWorkedDays(w, TUZLA, "2026-12"), null);
  // Ayın AsilPOS günü yok ya da veri yok: varsayılan
  assert.equal(asilposWorkedDays(w, ARDA, "2027-01"), null);
  assert.equal(asilposWorkedDays(undefined, ARDA, "2026-12"), null);
  // Geçiş ayı (Kasım: 13–21 ModPOS, 22'den AsilPOS): ayın ModPOS günlerinde çalışılan gün bilinmez, 22–30 her gün liste
  // taşısa da ay eksik sayılır (§6: Arda'in Kasım yemek kartı 330 × 26 = 8.580)
  const novFull: AsilposWorked = { switchDays: { marina: "2026-11-22" }, days: [22, 23, 24, 25, 26, 27, 28, 29, 30].map((d) => ({ branchId: "marina", date: `2026-11-${d}`, refs: ["s:7"] })) };
  assert.equal(asilposWorkedDays(novFull, ARDA, "2026-11"), null);
  // Ayın hiçbir gününde geçmeyen kimlik (AsilPOS'ta bağlı değil ya da "Devam ettir"den önceki satıra bağlı): 0 gün
  // sayılmaz, bilinmiyor (varsayılan 26) ve "görünmüyor" diye işaretlenir (Maaşlar ve Genel bakış uyarır)
  const ege = { id: 50, branchId: "marina" };
  assert.equal(asilposWorkedDays(w, ege, "2026-12"), null);
  assert.equal(asilposWorkedUnseen(w, ege, "2026-12"), true);
  assert.equal(asilposWorkedUnseen(w, ARDA, "2026-12"), false);
  assert.equal(asilposWorkedUnseen(w, TUZLA, "2026-12"), false, "başka şube");
  assert.equal(asilposWorkedUnseen(decWorked((d, r) => (d === decDay(5) ? null : r)), ege, "2026-12"), false, "eksik ay bilinmiyor");
  assert.equal(asilposWorkedUnseen(novFull, ege, "2026-11"), false, "geçiş ayı");
});

test("yemek kartı: AsilPOS'un çalışılan günüyle (Arda 20 × 330, Cenk 18 × 330); işaretsiz kişide yine 0; Kasım ve eksik ay varsayılan 26", () => {
  const m = createModel(ds([ARDA, CENK, DERYA, TUZLA], { asilposWorked: decWorked() }));
  const rows = new Map(m.personnelFor("2026-12").rows.map((r) => [r.staff.name, r]));
  close(rows.get("Arda")!.mealCard, 330 * 20, "Arda 20 gün");
  assert.equal(rows.get("Arda")!.mealDays, 20);
  assert.equal(rows.get("Arda")!.asilposDays, 20);
  close(rows.get("Cenk")!.mealCard, 330 * 18, "Cenk 18 gün");
  assert.equal(rows.get("Derya")!.mealCard, 0, "işaretsiz");
  assert.equal(rows.get("Derya")!.asilposDays, 25, "çalıştığı gün yine bilinir (Maaşlar gösterir)");
  close(rows.get("Tuzla")!.mealCard, 8_580, "Tuzla varsayılan");
  assert.equal(rows.get("Tuzla")!.asilposDays, null);
  // Maaş ve SGK değişmez: yalnız yemek kartı
  close(rows.get("Arda")!.total - rows.get("Arda")!.mealCard, staffCost(ARDA, DEFAULT_SETTINGS).total - 8_580, "maaş tarafı aynı");
  // Kasım (geçiş ayı) varsayılan
  const novRows = new Map(m.personnelFor("2026-11").rows.map((r) => [r.staff.name, r]));
  close(novRows.get("Arda")!.mealCard, 8_580, "Kasım 330 × 26");
  assert.equal(novRows.get("Arda")!.asilposDays, null);
  // Aralık'ın bir günü listesiz: ay varsayılan
  const gap = createModel(ds([ARDA], { asilposWorked: decWorked((d, r) => (d === decDay(30) ? null : r)) }));
  close(gap.personnelFor("2026-12").rows[0].mealCard, 8_580, "eksik ay 330 × 26");
  assert.equal(gap.personnelFor("2026-12").rows[0].asilposDays, null);
  // AsilPOS'ta bağlı olmayan (ortak kasa) işaretli kişi: listede hiç geçmiyor, yemek kartı 0 değil varsayılan 26; uyarılır
  const EGE = person({ id: 50, name: "Ege", netSalary: 30_000, mealCard: true });
  const un = createModel(ds([ARDA, EGE], { asilposWorked: decWorked() }));
  const ege = un.personnelFor("2026-12").rows.find((r) => r.staff.id === 50)!;
  close(ege.mealCard, 8_580, "bağlantısız kişi 330 × 26 (0 değil)");
  assert.equal(ege.asilposDays, null);
  const warn = staffWarnings(un, "2026-12").find((x) => x.kind === "meal-asilpos-unseen");
  assert.ok(warn, "uyarı var");
  assert.deepEqual(warn.staffIds, [50]);
  assert.match(warn.detail, /Ege/);
  assert.equal(staffWarnings(createModel(ds([ARDA], { asilposWorked: decWorked() })), "2026-12").find((x) => x.kind === "meal-asilpos-unseen"), undefined);
});

test("Gelir-gider: biten ayda AsilPOS günüyle yemek kartı gün oranıyla bir daha oranlanmaz; süren ay Ayarlar'daki günle; metin AsilPOS'u söyler", () => {
  // Biten Aralık: 20 + 18 gün
  const m = createModel(ds([ARDA, CENK], { asilposWorked: decWorked() }));
  const pm = m.pnlMonth("2026-12");
  close(pm.cells.get("personnel:meal")!.value!, 330 * 38, "Arda 20 + Cenk 18 gün");
  assert.match(pm.cells.get("personnel:meal")!.info!, /AsilPOS/);
  // Kişi kişi (ad ve AsilPOS günü) yalnız maaşı görende (personal: true); varsayılan kişi sayısıyla (muhasebeci; docs/ROLLER.md)
  assert.match(pm.cells.get("personnel:meal")!.info!.replace(/\u00a0/g, " "), /AsilPOS'ta çalıştığı günle \(oranlanmaz\): 2 kişi = 12\.540 ₺/);
  assert.doesNotMatch(pm.cells.get("personnel:meal")!.info!, /Arda|Cenk/);
  const named = createModel(ds([ARDA, CENK], { asilposWorked: decWorked() }), { personal: true }).pnlMonth("2026-12");
  assert.match(named.cells.get("personnel:meal")!.info!, /Arda 20 gün, Cenk 18 gün/);
  assert.equal(named.cells.get("personnel:meal")!.value, pm.cells.get("personnel:meal")!.value);
  const arda = staffCost(ARDA, DEFAULT_SETTINGS, { asilposDays: 20 });
  const cenk = staffCost(CENK, DEFAULT_SETTINGS, { asilposDays: 18 });
  close(pm.cells.get("personnel:employer")!.value!, arda.total + cenk.total - 67_000 - 330 * 38, "maliyet − net − yemek kartı");
  // Süren ay (Aralık'ın 10'u, 10 açık gün): ay bitmedi, yemek kartı Ayarlar'daki günle ve maaş gibi 10/31 oranlanır
  const upTo10 = decWorked();
  upTo10.days = upTo10.days.filter((d) => d.date <= decDay(10));
  const run = createModel(ds([ARDA], { currentMonth: "2026-12", months: [...excel.months, nov, { ...dec, openDays: 10 }], asilposWorked: upTo10 })).pnlMonth("2026-12");
  close(run.cells.get("personnel:meal")!.value!, (8_580 * 10) / 31, "süren ay 330 × 26 × 10/31");
  close(run.cells.get("personnel:net")!.value!, (35_000 * 10) / 31, "maaş gün oranıyla");
  assert.doesNotMatch(run.cells.get("personnel:meal")!.info!, /AsilPOS/);
  // Biten ayda kapalı günler (28 açık gün): AsilPOS'lu kişi oranlanmaz, varsayılanlı kişi oranlanır
  const mixed = createModel(ds([ARDA, TUZLA], { months: [...excel.months, nov, { ...dec, openDays: 28 }], asilposWorked: decWorked() })).pnlMonth("2026-12");
  close(mixed.cells.get("personnel:meal")!.value!, 330 * 20 + (8_580 * 28) / 31, "AsilPOS'lu kişi oranlanmaz, varsayılanlı oranlanır");
});

test("yemek kartı hücresinin notu: AsilPOS'lu ve varsayılanlı kişiler karışıkken oran yalnız varsayılanlılara yazılır", () => {
  const st = { mealCardDaily: 330 };
  const arda = { mealCard: 6_600, mealDays: 20, asilposDays: 20, staff: { name: "Arda", kind: "full_time" as const } };
  const tuzla = { mealCard: 8_580, mealDays: 26, asilposDays: null, staff: { name: "Tuzla", kind: "full_time" as const } };
  // tl() tutar ile ₺ arasına bölünmez boşluk koyar
  const text = mealCardText([arda, tuzla], st, 28 / 31, 28, 31).replace(/\u00a0/g, " ");
  assert.ok(text.includes("1 kişi × 330 ₺ × 26 gün = 8.580 ₺ × 28 / 31 gün"), text);
  assert.ok(text.includes("AsilPOS'ta çalıştığı günle (oranlanmaz): Arda 20 gün = 6.600 ₺"), text);
  assert.doesNotMatch(text, /2 kişi/);
  // Hepsi AsilPOS'lu: oran yok
  assert.equal(mealCardText([arda], st, 1, 31, 31).replace(/\u00a0/g, " "), "Yemek kartı AsilPOS'ta çalıştığı günle (oranlanmaz): Arda 20 gün = 6.600 ₺; brütleştirilmez.");
  // AsilPOS'suz: eski metin aynen
  assert.equal(mealCardText([tuzla], st, 28 / 31, 28, 31).replace(/\u00a0/g, " "), "Yemek kartı 1 kişi × 330 ₺ × 26 gün = 8.580 ₺ × 28 / 31 gün; brütleştirilmez.");
});

test("süren ay: aylık / standart rakamlar bugüne kadar gelen AsilPOS günüyle küçülmez (yemek kartı ay bitene dek 330 × 26)", () => {
  const two = decWorked();
  two.days = two.days.filter((d) => d.date <= decDay(2)).map((d) => ({ ...d, refs: ["s:7", "s:12"] }));
  const base = { currentMonth: "2026-12", months: [...excel.months, nov, { ...dec, openDays: 2 }] };
  const without = createModel(ds([ARDA, CENK], base));
  const withDays = createModel(ds([ARDA, CENK], { ...base, asilposWorked: two }));
  close(withDays.fixedStandardTotal, without.fixedStandardTotal, "standart sabit gider aynı");
  close(withDays.personnel.total, without.personnel.total, "aylık personel aynı");
  close(withDays.personnelFor("2026-12").mealCard, 2 * 8_580, "yemek kartı 2 × 330 × 26");
  const arda = withDays.staffList.find((x) => x.id === 7)!;
  close(arda.cost.mealCard, 8_580, "Maaşlar'daki maliyet aylık");
  assert.equal(arda.cost.asilposDays, null);
  // Gösterilen gün yine bugüne kadarki gün (bilgi)
  assert.equal(arda.asilposDays, 2);
  assert.equal(withDays.asilposDaysOf(ARDA, "2026-12"), 2);
  assert.equal(withDays.asilposMealDaysOf(ARDA, "2026-12"), null);
});

test("yasal bordro: biten ayın yemek kartı Gelir-gider'le aynı AsilPOS günüyle; geçiş ayı ve süren ay 330 × 26", () => {
  const m = createModel(ds([ARDA], { asilposWorked: decWorked() }));
  const pay = payrollFromModel(m, 2026, DEFAULT_PAYROLL_SETTINGS);
  const alperIn = (month: string) => pay.get(month)!.people.find((p) => p.staffId === 7)!;
  close(alperIn("2026-12").extras, 330 * 20, "Aralık 20 gün");
  close(alperIn("2026-11").extras, 8_580, "Kasım 330 × 26");
  close(m.personnelFor("2026-12").mealCard, alperIn("2026-12").extras, "Gelir-gider ile bordro aynı");
});

test("Maaşlar: kişi başına 'AsilPOS'ta çalıştığı gün' (veri varsa); yemek kartı sütunu günü AsilPOS'tan yazar", () => {
  // Aralık'ta biten satır (Ocak'ta bakılıyor): gösterilen ay biten Aralık, yemek kartı AsilPOS günüyle
  const m = createModel(ds([{ ...ARDA, endMonth: "2026-12" }, { ...DERYA, endMonth: "2026-12" }, { ...TUZLA, endMonth: "2026-12" }], { asilposWorked: decWorked() }));
  const views = new Map(m.staffList.map((x) => [x.name, x]));
  assert.equal(views.get("Arda")!.cost.asilposDays, 20);
  assert.equal(views.get("Arda")!.asilposDays, 20);
  close(views.get("Arda")!.cost.mealCard, 330 * 20, "Maaşlar'daki yemek kartı AsilPOS günüyle");
  assert.equal(views.get("Derya")!.asilposDays, 25);
  assert.equal(views.get("Tuzla")!.cost.asilposDays, null);
  assert.equal(views.get("Tuzla")!.asilposDays, null);
  // Bağlantısız işaretli kişi Maaşlar'da "görünmüyor" diye işaretlenir
  const un = createModel(ds([person({ id: 50, name: "Ege", netSalary: 30_000, mealCard: true, endMonth: "2026-12" })], { asilposWorked: decWorked() }));
  assert.equal(un.staffList[0].asilposUnseen, true);
  assert.equal(views.get("Arda")!.asilposUnseen, false);
  const page = read("src/app/panel/personel/page.tsx");
  assert.match(page, /asilposDays: x\.asilposDays/);
  assert.match(page, /asilposMealDays: x\.cost\.asilposDays/);
  assert.match(page, /asilposUnseen: x\.asilposUnseen/);
  const editor = read("src/app/panel/personel/staff-editor.tsx");
  assert.match(editor, /AsilPOS'ta çalıştığı gün/);
  assert.match(editor, /AsilPOS'ta bu ay görünmüyor/);
  // İstemcinin yeniden hesabı sunucunun yemek kartı günüyle (önizleme ve toplamlar sunucuyla aynı)
  assert.match(editor, /asilposDays: x\.asilposMealDays/);
});

test("motor istemci paketine node modülü çekmez: src/lib/calc/engine.ts'in değer içe aktarımları node:* / crypto'ya ulaşmaz", () => {
  // engine.ts "use client" bileşenlerinden içe aktarılır (Maaşlar, Gelir-gider, ...): imza modülü (node:crypto) bu
  // ağaçta olamaz. checkPosStaffRequest bu yüzden src/lib/asilpos/personel-istek.ts'te
  const seen = new Set<string>();
  const bad: string[] = [];
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null;
    if (!base) return null;
    for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      try {
        readFileSync(c);
        return c;
      } catch {
        // sonraki aday
      }
    }
    return null;
  };
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    const specs = [...src.matchAll(/^(?:import|export)\s+(?!type\b)(?:[^;]*?\s+from\s+)?"([^"]+)";/gm)].map((x) => x[1]);
    for (const spec of specs) {
      if (/^node:|^(crypto|fs|path|os|child_process)$|^server-only$/.test(spec)) bad.push([...chain, file.slice(root.length + 1), spec].join(" ← "));
      const next = resolve(file, spec);
      if (next) walk(next, [...chain, file.slice(root.length + 1)]);
    }
  };
  walk(join(root, "src/lib/calc/engine.ts"), []);
  assert.deepEqual(bad, []);
  assert.ok(seen.has(join(root, "src/lib/asilpos/personel.ts")), "motor personel kurallarını okur");
});

test("belge: KVKK cümlesi (ad gitmez; yalnız personel kimliği), uç ve yemek kartı kuralı docs/ASILPOS.md'de", () => {
  const doc = read("docs/ASILPOS.md");
  for (const s of ["/api/panel/pos/personel", "workedStaffRefs", "worked_staff", "ad gitmez; yalnız personel kimliği", "AsilPOS'ta çalıştığı gün"]) assert.ok(doc.includes(s), s);
  assert.doesNotMatch(read("docs/VARDIYA.md"), /hazır kancadır/, "kanca artık bağlı");
});
