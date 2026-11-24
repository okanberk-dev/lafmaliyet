// LafPOS personel bağlantısının lafmaliyet tarafı (LM-4b; CONTRACT §3, sahibin kararı 2: "ladmin'de hesapları var; doğru
// hesabı bağladığından emin ol"): LafPOS kullanıcısı lafmaliyet'in maaş satırına (`s:<staff.id>`) yalnız elle bağlanır,
// lafmaliyet her kimliği doğrular.
// - İmzalı `GET /api/panel/pos/personel?sube=marina`: şubenin bu ay ya da geçen ay aralıktaki maaş satırları
//   `{ ref, name, active, account }`; hesap başına tek öğe (biten satır ile "Devam ettir"in yeni satırı aynı hesaba bağlı
//   olabilir: o ayın satırı); maaş, e-posta, ay gitmez
// - Gövdenin `workedStaffRefs`'i okunur (bozuksa gün yine yazılır), sınıflanır: sayılan / bilinmeyen / başka şube
// - Yemek kartının günü ayın her sayılan LafPOS gününde liste geldiyse LafPOS'ta çalıştığı gün; yoksa Ayarlar'daki gün
// Veritabanı tarafı tests/personel-lafpos-db.test.ts.
// Çalıştırma: npx tsx --test tests/personel-lafpos.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createModel, staffCost } from "../src/lib/calc/engine";
import type { Dataset, Staff } from "../src/lib/calc/types";
import { DEFAULT_SETTINGS } from "../src/lib/constants";
import { signedHeaders } from "../src/lib/karaoke/signature";
import { parsePosDay, sentWorkedStaffRefs } from "../src/lib/lafpos/day";
import { checkPosStaffRequest, classifyWorkedStaff, lafposWorkedDays, posStaffItems, type LafposWorked, type PosStaffRow } from "../src/lib/lafpos/personel";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

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
    row({ id: 7, name: "Alper", startMonth: "2026-11" }),
    row({ id: 8, name: "Cem", endMonth: "2026-10", userId: 4 }),
    row({ id: 9, name: "Damla", endMonth: "2026-09" }),
    row({ id: 10, name: "Berkan", startMonth: "2026-12" }),
    row({ id: 11, name: "Tuzla Personeli", branchId: "tuzla" }),
  ];
  const items = posStaffItems({ rows, accounts: new Map([[3, "Ayşe Yılmaz (hesap)"], [4, "Cem K."]]), sube: "marina", month: "2026-11" });
  assert.deepEqual(items, [
    { ref: "s:7", name: "Alper", active: true, account: null },
    { ref: "s:12", name: "Ayşe Yılmaz", active: true, account: "Ayşe Yılmaz (hesap)" },
    { ref: "s:8", name: "Cem", active: false, account: "Cem K." },
  ]);
  // Ekim'de biten Cem geçen ayın satırıdır (etkin değil); Eylül'de biten Damla ve Aralık'ta başlayacak Berkan, Tuzla yok
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
  const ok = { secret: SECRET, url, timestamp: h["x-laf-timestamp"], signature: h["x-laf-signature"], now: NOW.getTime() };
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
  assert.match(route, /servePosStaff\(\{\s*secret: lafposSecret\(\),/);
  assert.doesNotMatch(route, /getCurrentUser|requireUser|requireAdmin/, "oturumla açılmaz");
  const serve = read("src/server/lafpos/personel.ts");
  const handler = serve.slice(serve.indexOf("export async function servePosStaff"));
  assert.ok(handler.indexOf("checkPosStaffRequest(") > 0 && handler.indexOf("checkPosStaffRequest(") < handler.indexOf("await load("), "imza ve şube okumadan önce");
  // Maaş, e-posta ve ay okunmaz (sütun beyaz listesi)
  const loader = serve.slice(serve.indexOf("export async function loadPosStaff"), serve.indexOf("export async function servePosStaff"));
  assert.doesNotMatch(loader, /netSalary|extras|email|dailyWage|mealCard/);
});

// ---------------------------------------------------------------- gövde: workedStaffRefs

test("gövde: workedStaffRefs okunur (tekil, sayı sırasıyla); bozuksa gün yine yazılır, alan yok sayılır", () => {
  const golden = JSON.parse(read("tests/fixtures/lafpos-gun.golden.json")) as Record<string, unknown>;
  const now = new Date("2026-10-26T12:00:00+03:00");
  const withRefs = (refs: unknown) => JSON.stringify({ ...golden, workedStaffRefs: refs });
  const r = parsePosDay(withRefs(["s:12", "s:7", "s:12"]), now);
  assert.ok(r.ok, r.ok ? "" : r.field);
  assert.deepEqual(r.data.workedStaffRefs, ["s:7", "s:12"]);
  // Alan yoksa bilinmiyor (eski LafPOS ya da bağlı kullanıcı yok): undefined; boş liste "bağlı var, kimse çalışmadı"
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

test("ikinci altın gövde (LafPOS tests/fixtures/lafmaliyet-gun-personel.golden.json'ın bayt bayt kopyası): ilki + yalnız workedStaffRefs", () => {
  const raw = read("tests/fixtures/lafpos-gun-personel.golden.json");
  const golden = JSON.parse(read("tests/fixtures/lafpos-gun.golden.json")) as Record<string, unknown>;
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
  assert.deepEqual(classifyWorkedStaff(["s:7", "s:12", "s:13", "s:14", "s:99"], rows, "2026-11-22"), {
    counted: ["s:7", "s:12"],
    unknown: ["s:14", "s:99"],
    otherBranch: ["s:13"],
  });
  // Satırın aralığı günün ayına göre: Ekim'de 7 henüz yok, 14 var
  assert.deepEqual(classifyWorkedStaff(["s:7", "s:14"], rows, "2026-10-31"), { counted: ["s:14"], unknown: ["s:7"], otherBranch: [] });
  assert.deepEqual(classifyWorkedStaff([], rows, "2026-11-22"), { counted: [], unknown: [], otherBranch: [] });
});

// ---------------------------------------------------------------- yemek kartının günü

const data: ExcelData = JSON.parse(read("src/server/db/seed/excel-data.json"));
const excel: Dataset = excelToDataset(data);
const person = (p: Partial<Staff> & Pick<Staff, "id" | "name" | "netSalary">): Staff => ({ extras: 0, active: true, startMonth: null, endMonth: null, branchId: "marina", ...p });
const ALPER = person({ id: 7, name: "Alper", netSalary: 35_000, mealCard: true });
const CEM = person({ id: 12, name: "Cem", netSalary: 32_000, mealCard: true });
const DAMLA = person({ id: 13, name: "Damla", netSalary: 30_000 });
const TUZLA = person({ id: 14, name: "Tuzla", netSalary: 30_000, mealCard: true, branchId: "tuzla" });

const decDay = (d: number) => `2026-12-${String(d).padStart(2, "0")}`;
/** Aralık 2026: 1–31 her gün LafPOS gün sonu; Alper 20 gün, Cem 18 gün, Damla (işaretsiz) 25 gün */
const decWorked = (patch: (date: string, refs: string[]) => string[] | null = (_d, r) => r): LafposWorked => ({
  switchDay: "2026-11-22",
  days: Array.from({ length: 31 }, (_, i) => {
    const d = i + 1;
    const refs = [...(d <= 20 ? ["s:7"] : []), ...(d > 13 ? ["s:12"] : []), ...(d <= 25 ? ["s:13"] : []), "s:99"];
    return { date: decDay(d), refs: patch(decDay(d), refs) };
  }),
});
const nov = { month: "2026-11", openDays: 30, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const dec = { month: "2026-12", openDays: 31, posRevenue: 300_000, discounts: 0, offRevenue: 0, note: null };
const ds = (staff: Staff[], patch: Partial<Dataset> = {}): Dataset => ({ ...excel, currentMonth: "2027-01", months: [...excel.months, nov, dec], staff, ...patch });

test("çalışılan gün: ayın her sayılan LafPOS günü liste taşıyorsa kişinin listede geçtiği gün; değilse null (Ayarlar'daki gün)", () => {
  const w = decWorked();
  assert.equal(lafposWorkedDays(w, ALPER, "2026-12"), 20);
  assert.equal(lafposWorkedDays(w, CEM, "2026-12"), 18);
  assert.equal(lafposWorkedDays(w, DAMLA, "2026-12"), 25);
  // Bir gün listesiz (o gün bağlı kimse yoktu ya da eski LafPOS): ay eksik, varsayılan
  assert.equal(lafposWorkedDays(decWorked((d, r) => (d === decDay(5) ? null : r)), ALPER, "2026-12"), null);
  // Başka şubenin kişisi (Tuzla ModPOS'ta): her zaman varsayılan
  assert.equal(lafposWorkedDays(w, TUZLA, "2026-12"), null);
  // Ayın LafPOS günü yok ya da veri yok: varsayılan
  assert.equal(lafposWorkedDays(w, ALPER, "2027-01"), null);
  assert.equal(lafposWorkedDays(undefined, ALPER, "2026-12"), null);
  // Geçiş ayı (Kasım: 13–21 ModPOS, 22'den LafPOS): ayın ModPOS günlerinde çalışılan gün bilinmez, 22–30 her gün liste
  // taşısa da ay eksik sayılır (§6: Alper'in Kasım yemek kartı 330 × 26 = 8.580)
  const novFull: LafposWorked = { switchDay: "2026-11-22", days: [22, 23, 24, 25, 26, 27, 28, 29, 30].map((d) => ({ date: `2026-11-${d}`, refs: ["s:7"] })) };
  assert.equal(lafposWorkedDays(novFull, ALPER, "2026-11"), null);
});

test("yemek kartı: LafPOS'un çalışılan günüyle (Alper 20 × 330, Cem 18 × 330); işaretsiz kişide yine 0; Kasım ve eksik ay varsayılan 26", () => {
  const m = createModel(ds([ALPER, CEM, DAMLA, TUZLA], { lafposWorked: decWorked() }));
  const rows = new Map(m.personnelFor("2026-12").rows.map((r) => [r.staff.name, r]));
  close(rows.get("Alper")!.mealCard, 330 * 20, "Alper 20 gün");
  assert.equal(rows.get("Alper")!.mealDays, 20);
  assert.equal(rows.get("Alper")!.lafposDays, 20);
  close(rows.get("Cem")!.mealCard, 330 * 18, "Cem 18 gün");
  assert.equal(rows.get("Damla")!.mealCard, 0, "işaretsiz");
  assert.equal(rows.get("Damla")!.lafposDays, 25, "çalıştığı gün yine bilinir (Maaşlar gösterir)");
  close(rows.get("Tuzla")!.mealCard, 8_580, "Tuzla varsayılan");
  assert.equal(rows.get("Tuzla")!.lafposDays, null);
  // Maaş ve SGK değişmez: yalnız yemek kartı
  close(rows.get("Alper")!.total - rows.get("Alper")!.mealCard, staffCost(ALPER, DEFAULT_SETTINGS).total - 8_580, "maaş tarafı aynı");
  // Kasım (geçiş ayı) varsayılan
  const novRows = new Map(m.personnelFor("2026-11").rows.map((r) => [r.staff.name, r]));
  close(novRows.get("Alper")!.mealCard, 8_580, "Kasım 330 × 26");
  assert.equal(novRows.get("Alper")!.lafposDays, null);
  // Aralık'ın bir günü listesiz: ay varsayılan
  const gap = createModel(ds([ALPER], { lafposWorked: decWorked((d, r) => (d === decDay(30) ? null : r)) }));
  close(gap.personnelFor("2026-12").rows[0].mealCard, 8_580, "eksik ay 330 × 26");
  assert.equal(gap.personnelFor("2026-12").rows[0].lafposDays, null);
});

test("Gelir-gider: LafPOS günüyle yemek kartı gün oranıyla bir daha oranlanmaz (süren ayda da gerçek gün); metin LafPOS'u söyler", () => {
  // Biten Aralık: 20 + 18 gün
  const m = createModel(ds([ALPER, CEM], { lafposWorked: decWorked() }));
  const pm = m.pnlMonth("2026-12");
  close(pm.cells.get("personnel:meal")!.value!, 330 * 38, "Alper 20 + Cem 18 gün");
  assert.match(pm.cells.get("personnel:meal")!.info!, /LafPOS/);
  const alper = staffCost(ALPER, DEFAULT_SETTINGS, { lafposDays: 20 });
  const cem = staffCost(CEM, DEFAULT_SETTINGS, { lafposDays: 18 });
  close(pm.cells.get("personnel:employer")!.value!, alper.total + cem.total - 67_000 - 330 * 38, "maliyet − net − yemek kartı");
  // Süren ay (Aralık'ın 10'u, 10 açık gün): maaş 10/31 oranlanır, LafPOS'un bugüne kadarki günü oranlanmaz
  const upTo10 = decWorked();
  upTo10.days = upTo10.days.filter((d) => d.date <= decDay(10));
  const run = createModel(ds([ALPER], { currentMonth: "2026-12", months: [...excel.months, nov, { ...dec, openDays: 10 }], lafposWorked: upTo10 })).pnlMonth("2026-12");
  close(run.cells.get("personnel:meal")!.value!, 330 * 10, "Alper 10 gün, oranlanmadan");
  close(run.cells.get("personnel:net")!.value!, (35_000 * 10) / 31, "maaş gün oranıyla");
  // Varsayılanlı kişi yanında: o kişinin payı yine oranlanır
  const mixed = createModel(ds([ALPER, TUZLA], { currentMonth: "2026-12", months: [...excel.months, nov, { ...dec, openDays: 10 }], lafposWorked: upTo10 })).pnlMonth("2026-12");
  close(mixed.cells.get("personnel:meal")!.value!, 330 * 10 + (8_580 * 10) / 31, "LafPOS'lu kişi oranlanmaz, varsayılanlı oranlanır");
});

test("Maaşlar: kişi başına 'LafPOS'ta çalıştığı gün' (veri varsa); yemek kartı sütunu günü LafPOS'tan yazar", () => {
  const m = createModel(ds([ALPER, DAMLA, TUZLA], { currentMonth: "2026-12", lafposWorked: decWorked() }));
  const views = new Map(m.staffList.map((x) => [x.name, x]));
  assert.equal(views.get("Alper")!.cost.lafposDays, 20);
  close(views.get("Alper")!.cost.mealCard, 330 * 20, "Maaşlar'daki yemek kartı LafPOS günüyle");
  assert.equal(views.get("Damla")!.cost.lafposDays, 25);
  assert.equal(views.get("Tuzla")!.cost.lafposDays, null);
  const page = read("src/app/panel/personel/page.tsx");
  assert.match(page, /lafposDays: x\.cost\.lafposDays/);
  const editor = read("src/app/panel/personel/staff-editor.tsx");
  assert.match(editor, /LafPOS'ta çalıştığı gün/);
  // İstemcinin yeniden hesabı aynı günle (önizleme ve toplamlar sunucuyla aynı)
  assert.match(editor, /lafposDays: x\.lafposDays/);
});

test("belge: KVKK cümlesi (ad gitmez; yalnız personel kimliği), uç ve yemek kartı kuralı docs/LAFPOS.md'de", () => {
  const doc = read("docs/LAFPOS.md");
  for (const s of ["/api/panel/pos/personel", "workedStaffRefs", "worked_staff", "ad gitmez; yalnız personel kimliği", "LafPOS'ta çalıştığı gün"]) assert.ok(doc.includes(s), s);
  assert.doesNotMatch(read("docs/VARDIYA.md"), /hazır kancadır/, "kanca artık bağlı");
});
