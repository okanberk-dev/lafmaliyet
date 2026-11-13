// İki şubeli kasa, gerçek Postgres'te (denetim 13 Kasım 2026, P03): "Tümü"de Kasa formu yazdığı şubeyi (Tuzla) okur,
// kaydetmek öteki şubenin raporunu ezmez (KP-01); günün kasadan çıkanları şubeye süzülür (KP-04); personelin düzeltme ve
// geç raporu, onaylayan yöneticinin seçimine değil isteğin şubesine yazılır (KP-02); bir şubenin onayı ya da silmesi
// öteki şubenin isteklerini kapatmaz (KP-X2); gün kilidi ve geç rapor zinciri şube içinde (KP-06); kapalı gün şube başına
// (KP-05); e-postanın konusu şubeyi yazar (KP-07); zil iki şubenin zincirini ayrı kurar (HM-X1); Kasa'nın ay satırı
// "Tümü"de şubelerin toplamı (HM-X2).
//
// SUBE_TEST_DATABASE_URL (yoksa KASA_ISTEK_TEST_DATABASE_URL) verilmezse atlanır. Test kendi geçici veritabanını açar,
// migration'ları uygular, sonunda siler.
// Çalıştırma: SUBE_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx tsx --test tests/sube-kasa-ekrani-db.test.ts

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate, type CashReportFields } from "../src/lib/cash-report";
import { CASH_REQUEST_TEXT, CorrectionPayload } from "../src/lib/cash-requests";
import { addDays } from "../src/lib/reminders";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const SERVER_URL = process.env.SUBE_TEST_DATABASE_URL ?? process.env.KASA_ISTEK_TEST_DATABASE_URL;
const DB_NAME = `laffogato_sube_kasa_ekrani_${process.pid}`;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("iki şubeli kasa ekranı ve istekler: veritabanında", { skip: !SERVER_URL && "SUBE_TEST_DATABASE_URL yok" }, () => {
  let admin: postgres.Sql;
  let db: import("../src/server/db").DB;
  let withBranchScope: typeof import("../src/server/branch-scope").withBranchScope;
  let store: typeof import("../src/server/cash/report-store");
  let requests: typeof import("../src/server/cash/requests");
  let late: typeof import("../src/server/cash/late");
  let chain: typeof import("../src/server/cash/late-chain");
  let cash: typeof import("../src/server/data/cash-reports");
  let outs: typeof import("../src/server/data/cash-outs");
  let photos: typeof import("../src/server/data/cash-photos");
  let rules: typeof import("../src/server/photo-read/rules");
  let closed: typeof import("../src/server/closed-days");
  let closedReq: typeof import("../src/server/closed-day-requests");
  let bell: typeof import("../src/server/bell/kasa");
  let template: typeof import("../src/server/notify/cash-report-template");
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse" | "deniz", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    deniz: { id: 0, name: "Deniz", role: "staff" },
  };

  /** Tuzla her akşam 1.000 ₺ bırakır (açılış 1.000), Marina 500 ₺; ikisi de kendi içinde tutarlı */
  const fields = (date: string, branch: "tuzla" | "marina", o: Partial<CashReportFields> = {}): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: branch === "tuzla" ? "1200" : "50",
    receipts: 10,
    zTotal: branch === "tuzla" ? 20_000 : 6_000,
    cash: branch === "tuzla" ? 8_000 : 2_400,
    card: branch === "tuzla" ? 12_000 : 3_600,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: branch === "tuzla" ? 1_000 : 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: branch === "tuzla" ? 9_000 : 2_900,
    handedOver: branch === "tuzla" ? 8_000 : 2_400,
    bankPos: null,
    offRevenue: 0,
    note: "deneme",
    ...o,
    discounts: o.discounts ?? 0,
  });
  /** Şubenin raporu, yöneticinin elinden (seçili şube o şube) */
  async function report(date: string, branch: "tuzla" | "marina", o: Partial<CashReportFields> = {}, who: Who = users.ali, now = tr(`${date}T22:00`)) {
    const out = await withBranchScope(branch, () => store.saveCashReport(db, who, { ...fields(date, branch, o), countedBy: null, revision: 0, photos: [] }, now));
    assert.equal(out.kind, "saved");
    return out.kind === "saved" ? out.row : (undefined as never);
  }
  const rowOf = async (date: string, branch: string) => (await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branch))))[0];
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const refused = async (p: Promise<unknown>, text: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && e.message === text);
  };
  /** Personelin düzeltme önerisi: sayılan nakit değişir (iş günü kapandıktan sonra: onaya gider) */
  const propose = (who: Who, branch: "tuzla" | "marina", date: string, baseRevision: number, countedCash: number, now: Date) => {
    const { date: _d, ...rest } = fields(date, branch, { countedCash });
    void _d;
    return withBranchScope(branch, () => requests.proposeCashCorrection(db, who, { date, baseRevision, fields: rest, countedBy: null, message: "Sayım yanlış yazıldı", clientKey: null }, now));
  };
  const approve = (scope: string, id: number, seenVersion: number, seenRevision: number | null, now: Date) =>
    withBranchScope(scope, () => requests.reviewCashRequestCore(db, users.ali, { id, seenVersion, seenRevision, decision: "approve", note: null, fields: null, handoverSeen: true }, now));

  before(async () => {
    admin = postgres(SERVER_URL!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(SERVER_URL!);
    url.pathname = `/${DB_NAME}`;
    Object.assign(process.env, { DATABASE_URL: url.href, AUTH_SECRET: "sube-kasa-ekrani-testi-icin-en-az-otuz-iki-karakterlik-anahtar" });
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; sayfa yenileme taklit edilir
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
    const dbModule = await import("../src/server/db");
    db = dbModule.getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    await db
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
      .onConflictDoNothing();
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${k}@laffogato.net`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    withBranchScope = (await import("../src/server/branch-scope")).withBranchScope;
    store = await import("../src/server/cash/report-store");
    requests = await import("../src/server/cash/requests");
    late = await import("../src/server/cash/late");
    chain = await import("../src/server/cash/late-chain");
    cash = await import("../src/server/data/cash-reports");
    outs = await import("../src/server/data/cash-outs");
    photos = await import("../src/server/data/cash-photos");
    rules = await import("../src/server/photo-read/rules");
    closed = await import("../src/server/closed-days");
    closedReq = await import("../src/server/closed-day-requests");
    bell = await import("../src/server/bell/kasa");
    template = await import("../src/server/notify/cash-report-template");
  });

  after(async () => {
    await db?.$client.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE cash_reports, cash_outs, staff_requests, special_days, activity_log, photos RESTART IDENTITY CASCADE`);
  });

  test("Tümü'de form yazdığı şubeyi (Tuzla) okur; kaydetmek Marina'nın raporunu Tuzla'ya yazmaz; yalnız Marina girdiyse Tuzla'nınki girilir (KP-01)", async () => {
    const D = "2026-11-12";
    // Marina önce girer, sonra Tuzla (ikisi de 1. sürüm)
    await report("2026-11-11", "marina");
    await report("2026-11-11", "tuzla");
    await report(D, "marina");
    await report(D, "tuzla");
    const shown = await withBranchScope("hepsi", () => cash.getCashReport(D, "admin"));
    assert.equal(shown?.branchId, "tuzla");
    assert.equal(shown?.zNo, "1200");
    assert.deepEqual(await withBranchScope("hepsi", () => cash.previousCarryOver(D)), { date: "2026-11-11", amount: 1_000 });
    assert.equal((await withBranchScope("marina", () => cash.getCashReport(D)))?.zNo, "50");
    // Tümü'de kaydet: formun gösterdiği Tuzla'nın raporuna yeni sürüm; Marina'nınki olduğu gibi
    const saved = await withBranchScope("hepsi", () =>
      store.saveCashReport(db, users.ali, { ...fields(D, "tuzla", { note: "not düzeltildi" }), countedBy: null, revision: shown!.revision, photos: [], branchId: "tuzla" }, tr(`${D}T23:00`)),
    );
    assert.equal(saved.kind, "saved");
    assert.deepEqual(
      [await rowOf(D, "tuzla"), await rowOf(D, "marina")].map((r) => [r.zNo, r.zTotal, r.revision]),
      [
        ["1200", 20_000, 2],
        ["50", 6_000, 1],
      ],
    );
    // Form açıldıktan sonra başka sekmede şube değiştiyse yazılmaz
    await refused(
      withBranchScope("hepsi", () => store.saveCashReport(db, users.ali, { ...fields(D, "marina"), countedBy: null, revision: 1, photos: [], branchId: "marina" }, tr(`${D}T23:00`))),
      CASH_REQUEST_TEXT.branchChanged,
    );
    // Yalnız Marina'nın raporu olan gün: Tümü'deki personel boş form görür ve Tuzla'nın raporunu girer
    const E = "2026-11-13";
    await report(E, "marina");
    assert.equal(await withBranchScope("hepsi", () => cash.getCashReport(E)), null);
    const staff = await withBranchScope("hepsi", () => store.saveCashReport(db, users.ayse, { ...fields(E, "tuzla"), countedBy: null, revision: 0, photos: [] }, tr(`${E}T22:30`)));
    assert.equal(staff.kind === "saved" && staff.row.branchId, "tuzla");
  });

  test("günün kasadan çıkanları şubenin; e-posta ve WhatsApp ekleri raporun şubesinden, konu şubeyi yazar (KP-04, KP-07)", async () => {
    const D = "2026-11-12";
    const marina = await report(D, "marina");
    await db.insert(s.cashOuts).values([
      { date: D, kind: "harcama", amount: 250, store: "Tuzla market", docType: "fis", branchId: "tuzla", createdBy: users.ali.id, createdByName: "Ali" },
      { date: D, kind: "harcama", amount: 400, store: "Marina market", docType: "fis", branchId: "marina", createdBy: users.ali.id, createdByName: "Ali" },
    ]);
    const amounts = async (scope: string) => (await withBranchScope(scope, () => outs.cashOutsOn(D))).map((o) => o.amount);
    assert.deepEqual(await amounts("tuzla"), [250]);
    assert.deepEqual(await amounts("marina"), [400]);
    assert.deepEqual(await amounts("hepsi"), [250], "Tümü'de formun şubesi (Tuzla)");
    assert.deepEqual((await withBranchScope("hepsi", () => outs.cashOutsBetween(D, D))).map((o) => o.amount).sort(), [250, 400], "ay listesi bütün şubelerin");
    // Marina'nın raporunun ekleri yöneticinin seçimi Tuzla iken de Marina'nın fişleriyle; birden çok şube açık: ad yazılır
    const dto = cash.toCashDTO(marina, "admin");
    const extras = await withBranchScope("tuzla", () => photos.cashReportExtras(dto));
    assert.deepEqual(
      extras.cashOuts?.map((o) => o.amount),
      [400],
    );
    assert.equal(extras.branch, "Marina");
    const mail = template.renderCashReport(dto, { by: "Deniz", revision: 1, submittedAt: new Date(), ...extras });
    assert.match(mail.subject.replace(/ /g, " "), /^Kasa raporu KR-20261112 · Marina · 12 Kasım/);
    assert.match(mail.html, /Gün sonu kasa raporu · KR-20261112 · Marina/);
    // Marina kapalıyken tek şube: konu bugünkü gibi
    await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, "marina"));
    try {
      assert.equal((await photos.cashReportExtras(dto)).branch, undefined);
    } finally {
      await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, "marina"));
    }
  });

  test("düzeltme önerisi isteğin şubesine yazılır; bir şubenin onayı ya da silmesi öteki şubenin isteğini kapatmaz (KP-02, KP-X2)", async () => {
    const D = "2026-11-12";
    const now = tr("2026-11-13T10:00");
    const tuzla = await report(D, "tuzla");
    const marina = await report(D, "marina");
    const t = await propose(users.ayse, "tuzla", D, 1, 8_900, now);
    const m = await propose(users.deniz, "marina", D, 1, 2_800, now);
    assert.equal(t.row.subject, `gun:${D}`);
    assert.equal(m.row.subject, `gun:${D}:marina`);
    assert.equal(CorrectionPayload.parse(m.row.payload).branchId, "marina");
    // Yönetici Tümü'de Tuzla'nın önerisini onaylar: Marina'nın önerisi bekler, Marina'nın raporu değişmez
    const ok = await approve("hepsi", t.row.id, t.row.version, 1, now);
    assert.equal(ok.status, "approved");
    assert.equal((await requestOf(m.row.id)).status, "pending");
    assert.equal((await rowOf(D, "marina")).countedCash, 2_900);
    // Yönetici Tuzla seçiliyken Marina'nın önerisini onaylar: Marina'nın raporuna yazılır
    await approve("tuzla", m.row.id, m.row.version, 1, now);
    assert.deepEqual(
      [await rowOf(D, "tuzla"), await rowOf(D, "marina")].map((r) => [r.countedCash, r.revision]),
      [
        [8_900, 2],
        [2_800, 2],
      ],
    );
    // Şubeden önce açılmış öneri (yükte şube yok, konu eski biçimde): şube önerinin dayandığı rapordan (Marina)
    const legacy = { ...CorrectionPayload.parse(m.row.payload), baseRevision: 2, branchId: undefined };
    legacy.base = { ...legacy.base, countedCash: 2_800 };
    legacy.proposed = { ...legacy.proposed, countedCash: 2_700 };
    const [old] = await db
      .insert(s.staffRequests)
      .values({ kind: "kasa-duzeltme", subject: `gun:${D}`, day: D, title: "eski öneri", payload: JSON.parse(JSON.stringify(legacy)), requestedBy: users.deniz.id, requestedByName: "Deniz" })
      .returning();
    await approve("hepsi", old.id, old.version, 2, now);
    assert.equal((await rowOf(D, "marina")).countedCash, 2_700);
    assert.equal((await rowOf(D, "tuzla")).countedCash, 8_900);
    // Tuzla'nın raporu silinir: Marina'nın bekleyen önerisi açık kalır
    const again = await propose(users.deniz, "marina", D, 3, 2_600, now);
    const removed = await db.transaction((tx) => store.removeCashReport(tx, tuzla.id));
    assert.deepEqual(removed.superseded, []);
    assert.equal((await requestOf(again.row.id)).status, "pending");
    void marina;
  });

  test("geç rapor isteğin şubesine yazılır; öteki şubenin raporu geç raporu, gün kilidini ve zinciri etkilemez (KP-02, KP-06)", async () => {
    // Marina'nın taban raporu 1 Kasım; 5 Kasım'da yalnız Tuzla'nın raporu var; "bugün" 10 Kasım
    const now = tr("2026-11-10T12:00");
    await report("2026-11-01", "marina");
    await report("2026-11-01", "tuzla");
    await report("2026-11-05", "tuzla", { openingCash: 1_000 });
    const [z] = await db
      .insert(s.photos)
      .values({ kind: "kasa-z", storageKey: `kasa/2026/11/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.deniz.id, createdByName: "Deniz", expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    // Marina'nın 5 Kasım zinciri Marina'nın 1 Kasım raporundan (Tuzla'nın 5 Kasım raporu halka değil)
    const n = await chain.chainNeighbours(db, "2026-11-04", { branchId: "marina" });
    assert.equal(n.prev?.date, "2026-11-01");
    assert.equal(n.next, null, "Tuzla'nın 5 Kasım raporu Marina'nın sonraki halkası değil");
    const sent = await withBranchScope("marina", () =>
      late.proposeLateReport(db, users.deniz, { fields: fields("2026-11-05", "marina"), reason: "Akşam sistem kapalıydı", requestVersion: 0, photoIds: [z.id], handedTo: { kind: "banka" }, clientKey: null }, now),
    );
    assert.equal(sent.row.subject, "gun:2026-11-05:marina");
    // Yönetici Tümü'de onaylar: Marina'ya yazılır, Tuzla'nın raporu olduğu gibi
    const out = await approve("hepsi", sent.row.id, sent.row.version, null, now);
    assert.equal(out.status, "approved");
    assert.equal((await rowOf("2026-11-05", "marina")).zNo, "50");
    assert.equal((await rowOf("2026-11-05", "tuzla")).zNo, "1200");
    // Gün kilidi şube içinde: Marina'nın bugünkü raporu Tuzla'nın dünkü raporunu personele kapatmaz
    const D = "2026-11-12";
    await report("2026-11-11", "tuzla");
    const evening = tr(`${D}T21:00`);
    assert.equal(await rules.staffDayOpen("2026-11-11", db, evening, "tuzla"), true);
    await report(D, "marina");
    assert.equal(await rules.staffDayOpen("2026-11-11", db, evening, "tuzla"), true, "Marina'nın raporu Tuzla'nın gününü kapatmaz");
    await report(D, "tuzla");
    assert.equal(await rules.staffDayOpen("2026-11-11", db, evening, "tuzla"), false, "Tuzla'nın ertesi gün raporu kapatır");
  });

  test("kapalı gün şube başına: Marina'nın raporu Tuzla'nın işaretini kaldırmaz; Tuzla personeli Marina raporu olan günü bildirebilir (KP-05)", async () => {
    const C = "2026-11-09";
    await db.transaction((tx) => closed.writeClosedDay(tx, users.ali, C, "Tuzla tadilat", "tuzla"));
    await report(C, "marina");
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), true);
    assert.equal(await closed.isClosedDay(C, db, "marina"), false);
    const log = await db.select({ action: s.activityLog.action }).from(s.activityLog);
    assert.ok(!log.some((l) => l.action.startsWith("Kapalı gün işareti kaldırıldı")), "kanıt sayılmadı");
    // Tuzla'nın kendi raporu işareti kaldırır (kanıt)
    await report(C, "tuzla");
    assert.equal(await closed.isClosedDay(C, db, "tuzla"), false);
    // Dün (11 Kasım) yalnız Marina açıktı: Tuzla personeli Tümü'de kapalı gün bildirir
    const Y = "2026-11-11";
    await report(Y, "marina");
    const ev = await closed.closedDayEvidence(db, Y, "tuzla");
    assert.equal(ev.report, false);
    assert.equal((await closed.closedDayEvidence(db, Y, "marina")).report, true);
    const sent = await withBranchScope("hepsi", () => closedReq.proposeClosedDay(db, users.ayse, { date: Y, reason: "Elektrik yok", clientKey: null }, tr("2026-11-12T12:00")));
    assert.equal(sent.row.subject, `gun:${Y}`);
    assert.equal(sent.payload.branchId, "tuzla");
    // Onay Tuzla'nın işaretini yazar (yöneticinin seçimi Marina iken de)
    const ok = await withBranchScope("marina", () => closedReq.reviewClosedDayCore(db, users.ali, { id: sent.row.id, seenVersion: sent.row.version, decision: "approve", note: null }, tr("2026-11-12T13:00")));
    assert.equal(ok.status, "approved");
    const [mark] = await db.select().from(s.specialDays).where(eq(s.specialDays.id, ok.specialId!));
    assert.equal(mark.branchId, "tuzla");
    assert.equal(await closed.isClosedDay(Y, db, "marina"), false);
  });

  test("zil ve Kasa'nın ay satırı: Tümü'de iki şubenin zinciri ayrı; ay satırı şubelerin toplamı (HM-X1, HM-X2)", async () => {
    const T = businessDate();
    const Y = addDays(T, -1);
    // Tuzla'nın raporları önceki aydan beri (ay ortasında başlayan ilk ay yarım sayılırdı; HM-04)
    const prevEnd = addDays(`${T.slice(0, 7)}-01`, -1);
    if (prevEnd !== Y) await report(prevEnd, "tuzla", {}, users.ali, new Date());
    for (const d of [Y, T]) {
      await report(d, "tuzla", {}, users.ali, new Date());
      await report(d, "marina", {}, users.ali, new Date());
    }
    const acilis = async () => (await withBranchScope("hepsi", () => bell.kasaBell({ ...users.ali, email: "ali@laffogato.net", role: "admin" } as never))).filter((n) => n.id.startsWith("kasa-acilis"));
    assert.deepEqual(await acilis(), [], "kendi içinde tutarlı iki şube: uyarı yok");
    // Marina bugün 450 ile açtı: yalnız Marina'nın satırı, kimliğinde ve gövdesinde şube
    await db.update(s.cashReports).set({ openingCash: 450 }).where(and(eq(s.cashReports.date, T), eq(s.cashReports.branchId, "marina")));
    const lines = await acilis();
    assert.deepEqual(
      lines.map((n) => n.id),
      [`kasa-acilis-${T}-marina-r1`],
    );
    assert.match(lines[0].body ?? "", /^Marina · /);
    // Ay satırı: Tümü iki şubenin cirosu, şube görünümü yalnız kendisininki
    const month = T.slice(0, 7);
    const info = (scope: string) =>
      withBranchScope(scope, async () => {
        const rows = await cash.cashReportsBetween(`${month}-01`, `${month}-31`, "admin");
        return cash.kasaMonthInfo(month, T, rows, await cash.loadMonthEntry(month), await cash.firstCashReportDate());
      });
    const inMonth = [Y, T].filter((d) => d.startsWith(month)).length;
    assert.equal((await info("hepsi")).posRevenue, inMonth * 26_000, "Tuzla 20.000 + Marina 6.000 her gün");
    assert.equal((await info("tuzla")).posRevenue, inMonth * 20_000);
  });
});
