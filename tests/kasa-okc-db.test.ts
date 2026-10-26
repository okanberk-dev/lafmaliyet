// Yazarkasanın (banka POS) mali Z'si, gerçek Postgres'te (dalga 13 PR-b adım b4; docs/planlar/okc-z.md §6.1, §3.7,
// §3.8, §5.3, §7, §16 S4): writeCashReport sunucu sütunlarını rapora bağlı yazarkasa Z fotoğrafının okumasından yazar
// (okunan Z no ve toplam kaydedilenle aynı değilse üçü de boş; kümülatif yalnız inandırıcıysa: zincir (a), ilk (b),
// aradaki girilmemiş Z'ler (c); zincir son saklanan kümülatife bağlanır); elle girilen raporda boş; "Kümülatifi
// temizle" yalnız yönetici, işlem geçmişine düşer, sürümü ve gönderim anını değiştirmez, başka bir düzeltme geri
// getirmez; geç rapor onayı sütunları aynı yoldan yazar ("Düzeltip onayla"nın 2. sürümü dahil) ve kartında iki yanlı
// zincir var; previousOkc / nextOkc gerçek sütunlardan, okuma yolu Z no sırasını ve zinciri onlarla denetler ve
// ai_calls.effort'u yazar; personelin DTO'sunda ve okumasında sunucu sütunları yok; tek yazarkasa Z fotoğrafı, bölüm
// yazılmışken kaldırılamaz. Kendi kullanıcılarını, raporlarını, fotoğraflarını, okumalarını ve isteklerini açar,
// sonunda siler (günler 2025: öteki veritabanı testlerinin 2027–2038 günlerinden önce; onların "sonraki rapor"
// kilidine ve kasa-gec testinin 2030 sayımına girmez; admin raporları notlu, açılış notu istenmez).
//
// KASA_OKC_TEST_DATABASE_URL (yoksa KASA_GEC_TEST_DATABASE_URL) verilmezse atlanır (migration'ları uygulanmış yerel
// veritabanı). Çalıştırma: KASA_OKC_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_okczb npx tsx --test tests/kasa-okc-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import type { CashReportFields } from "../src/lib/cash-report";
import { CASH_OUT_REQUEST_TEXT } from "../src/lib/cash-out-requests";
import { linkedUntil, OKC_PHOTOS_TEXT } from "../src/lib/photo-rules";
import { KasaOkcRaw, type AmountRaw } from "../src/lib/photo-read/schemas";
import { todayTR } from "../src/lib/reminders";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const URL = process.env.KASA_OKC_TEST_DATABASE_URL ?? process.env.KASA_GEC_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Tarih ve tutar biçimindeki bölünmez boşluklar düz boşluğa */
const sp = (t: string) => t.replace(/ /g, " ");

/** Türk biçimiyle basılı tutar: 9350 → "*9.350,00" */
function printed(v: number): string {
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  return `*${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${d}`;
}
const A = (v: number): AmountRaw => ({ text: printed(v), value: v, confidence: "high" });
const NONE: AmountRaw = { text: null, value: null, confidence: "low" };

/** Sentetik yazarkasa Z okuması (tek oran %10, nakit 1.000 ve kalan kart) */
function okcRaw(o: { zNo: string; total: number; cum?: number | null; cumVat?: number | null; outside?: number }) {
  const vat = r2((o.total * 10) / 110);
  return KasaOkcRaw.parse({
    documentType: "z_report",
    fiscalMarks: { mfLogo: true, ekuNo: true, cumulativeLines: true, vatBlock: true },
    readable: true,
    title: "Z RAPORU",
    date: null,
    time: null,
    dateConfidence: "low",
    zNo: { text: o.zNo, value: Number(o.zNo), confidence: "high" },
    receiptCount: { text: "40", value: 40, confidence: "high" },
    dailyTotal: A(o.total),
    dailyTotalLabel: "NET SATIŞ",
    kdvGroups: [{ rate: 10, total: A(o.total), vat: A(vat), base: null }],
    totalVat: A(vat),
    payments: [
      { label: "NAKİT", count: null, amount: A(1_000), kind: "cash" },
      { label: "K.KARTI", count: null, amount: A(o.total - 1_000), kind: "card" },
    ],
    outside: o.outside ? [{ label: "FATURALI SATIŞ", amount: A(o.outside) }] : [],
    voids: NONE,
    discounts: NONE,
    cumulativeTotal: o.cum == null ? NONE : A(o.cum),
    cumulativeVat: o.cumVat == null ? NONE : A(o.cumVat),
    batches: [],
    issues: [],
  });
}

describe("Yazarkasa Z'si: veritabanında sunucu sütunları, kümülatif, geç rapor ve fotoğraflar", { skip: !URL && "KASA_OKC_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let late: typeof import("../src/server/cash/late");
  let requests: typeof import("../src/server/cash/requests");
  let cards: typeof import("../src/server/data/cash-late");
  let reports: typeof import("../src/server/data/cash-reports");
  let photoData: typeof import("../src/server/data/cash-photos");
  let outReqs: typeof import("../src/server/cash-outs/requests");
  let read: typeof import("../src/server/photo-read/read");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse", Who> = { ali: { id: 0, name: "Ali", role: "admin" }, ayse: { id: 0, name: "Ayşe", role: "staff" } };
  const dates: string[] = [];
  const photoIds: number[] = [];

  /** Raporun alanları; yazarkasa bölümü `okc` verilirse (Z no, toplam; nakit 1.000, kalan kart, tek oran %10) */
  const fields = (date: string, okc?: { zNo: string; total: number }, o: Partial<CashReportFields> = {}): CashReportFields => {
    const vat = okc ? r2((okc.total * 10) / 110) : null;
    return {
      date,
      zNo: "1204",
      receipts: null,
      zTotal: 10_000,
      cash: 3_000,
      card: 7_000,
      mealCard: 0,
      online: 0,
      other: 0,
      // Devir 3.500 − 2.400 = 1.100 (öteki testlerin raporlarıyla aynı); not dolu
      openingCash: 1_100,
      cashOut: 0,
      cashOutNote: null,
      countedCash: 3_500,
      handedOver: 2_400,
      bankPos: null,
      offRevenue: null,
      discounts: null,
      note: "deneme",
      ...(okc
        ? {
            okcZNo: okc.zNo,
            okcReceipts: 40,
            okcTotal: okc.total,
            okcVatTotal: vat,
            okcVat: [{ rate: 10, total: okc.total, vat: vat! }],
            okcCash: 1_000,
            okcCard: okc.total - 1_000,
            okcMealCard: null,
            okcOther: null,
          }
        : {}),
      ...o,
    };
  };
  /** Bağlanmamış, süresi dolmamış fotoğraf; `raw` verilirse başarılı yazarkasa okuması (günlük sınıra sayılmasın: eski an) */
  async function photo(by: Who, kind: "kasa-z" | "kasa-okc", raw?: unknown) {
    const [p] = await db
      .insert(s.photos)
      .values({ kind, storageKey: `kasa/2025/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by.id, createdByName: by.name, expiresAt: new Date("2100-01-01T00:00:00Z") })
      .returning({ id: s.photos.id });
    photoIds.push(p.id);
    if (raw) {
      await db.insert(s.aiCalls).values({ at: new Date("2020-01-01T00:00:00Z"), feature: kind, model: "claude-opus-5-5", status: "ok", userId: by.id, photoId: p.id, result: raw as object });
    }
    return p.id;
  }
  /** Yöneticinin doğrudan raporu (yeni ya da yeni sürüm) */
  async function save(f: CashReportFields, photos: number[] = [], revision = 0) {
    if (!dates.includes(f.date)) dates.push(f.date);
    const r = await store.saveCashReport(db, users.ali, { ...f, discounts: f.discounts ?? null, countedBy: null, revision, photos }, tr(`${f.date}T22:00`));
    assert.equal(r.kind, "saved");
    return r.kind === "saved" ? r.row : (null as never);
  }
  const reportOf = async (date: string) => (await db.select().from(s.cashReports).where(eq(s.cashReports.date, date)))[0];
  const server = (r: { okcCumTotal: number | null; okcCumVat: number | null; okcOutside: number | null }) => [r.okcCumTotal, r.okcCumVat, r.okcOutside];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };

  before(async () => {
    process.env.DATABASE_URL = URL;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const marker = require.resolve("server-only");
    require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    store = await import("../src/server/cash/report-store");
    late = await import("../src/server/cash/late");
    requests = await import("../src/server/cash/requests");
    cards = await import("../src/server/data/cash-late");
    reports = await import("../src/server/data/cash-reports");
    photoData = await import("../src/server/data/cash-photos");
    outReqs = await import("../src/server/cash-outs/requests");
    read = await import("../src/server/photo-read/read");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kasa-okc-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    if (dates.length) await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    if (photoIds.length) {
      await db.delete(s.aiCalls).where(inArray(s.aiCalls.photoId, photoIds));
      await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    }
    await db.delete(s.activityLog).where(inArray(s.activityLog.userId, ids));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("sunucu sütunları: okuma kaydedilenle aynı → yazılır (ilk kümülatif, b); farklı → üçü de boş; aralık (c), zincir (a), tutmayan saklanmaz", async () => {
    // D1: ilk kümülatif (önceki saklanan yok, kümülatif ≥ günlük toplam), yazarkasa dışı tahsilat 1.250
    const p1 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0101", total: 9_350, cum: 1_259_350, cumVat: 118_943.94, outside: 1_250 }));
    const d1 = await save(fields("2025-10-02", { zNo: "0101", total: 9_350 }), [p1]);
    assert.deepEqual(server(d1), [1_259_350, 118_943.94, 1_250]);
    assert.equal(d1.okcZNo, "0101");
    assert.deepEqual(d1.okcVat, [{ rate: 10, total: 9_350, vat: 850 }]);
    // D2: yazılan toplam okunanla farklı (personel elle düzeltti): üçü de boş, tahsilat da
    const p2 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0102", total: 8_100, cum: 1_267_450, outside: 300 }));
    const d2 = await save(fields("2025-10-03", { zNo: "0102", total: 8_000 }), [p2]);
    assert.deepEqual(server(d2), [null, null, null]);
    // D3: Z no aralığı 2 (D2'nin kümülatifi saklanmadı), kümülatif son saklanandan (D1) en az günlük toplam kadar büyümüş: saklanır (c)
    const p3 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0103", total: 10_000, cum: 1_277_350 }));
    const d3 = await save(fields("2025-10-04", { zNo: "0103", total: 10_000 }), [p3]);
    assert.deepEqual(server(d3), [1_277_350, null, null]);
    // D4: zincir tutuyor (a)
    const p4 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0104", total: 8_000, cum: 1_285_350 }));
    const d4 = await save(fields("2025-10-05", { zNo: "0104", total: 8_000 }), [p4]);
    assert.deepEqual(server(d4), [1_285_350, null, null]);
    // D5: kümülatif yanlış okunmuş (+5.500, toplam 5.000): saklanmaz
    const p5 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0105", total: 5_000, cum: 1_290_850 }));
    const d5 = await save(fields("2025-10-06", { zNo: "0105", total: 5_000 }), [p5]);
    assert.deepEqual(server(d5), [null, null, null]);
    // D6: doğru okunmuş ertesi gün son SAKLANAN kümülatife (D4) bağlanır: D5'in yanlışı onu "tutmadı" yapmaz
    const p6 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0106", total: 6_000, cum: 1_296_350 }));
    const d6 = await save(fields("2025-10-07", { zNo: "0106", total: 6_000 }), [p6]);
    assert.deepEqual(server(d6), [1_296_350, null, null]);
    // Z no ya da toplam değişince yeniden hesaplanır: okunanla farklı → boş, geri dönünce yeniden yazılır
    const off = await save(fields("2025-10-07", { zNo: "0106", total: 6_100 }), [], d6.revision);
    assert.deepEqual(server(off), [null, null, null]);
    const back = await save(fields("2025-10-07", { zNo: "0106", total: 6_000 }), [], off.revision);
    assert.deepEqual(server(back), [1_296_350, null, null]);
    // Elle girilen rapor (fotoğraf yok): boş
    const d7 = await save(fields("2025-10-08", { zNo: "0107", total: 7_000 }));
    assert.deepEqual(server(d7), [null, null, null]);
    // Yazarkasa bölümünün kuralı sunucuda da: tutar yazıldıysa nakit gerekli
    await refused(save(fields("2025-10-09", { zNo: "0108", total: 7_000 }, { okcCash: null })), "Nakit gerekli (yoksa 0 yazın)");
  });

  test("gönderilmeyen yazarkasa alanı (eski sayfa) kayıtlıyı korur; previousOkc ve nextOkc gerçek sütunlardan", async () => {
    const d6 = await reportOf("2025-10-07");
    // Eski sayfanın gönderimi: yazarkasa anahtarı yok
    const legacy: CashReportFields = { ...fields("2025-10-07"), note: "eski sayfadan" };
    const kept = await save(legacy, [], d6.revision);
    assert.equal(kept.okcZNo, "0106");
    assert.equal(kept.okcTotal, 6_000);
    assert.equal(kept.okcCumTotal, 1_296_350, "sunucu sütunları yeniden hesaplanmadı (Z no ve toplam aynı)");
    const prev = await reports.previousOkc("2025-10-08", db);
    assert.deepEqual(prev.z, { date: "2025-10-07", zNo: "0106" });
    assert.deepEqual(prev.cum, { date: "2025-10-07", zNo: "0106", cumTotal: 1_296_350, cumVat: null });
    // D8 (10-08, elle) Z'si var ama kümülatifi yok: z ondan, zincir son saklanandan
    const prev9 = await reports.previousOkc("2025-10-09", db);
    assert.equal(prev9.z?.zNo, "0107");
    assert.equal(prev9.cum?.zNo, "0106");
    assert.deepEqual(await reports.nextOkc("2025-10-05", db), { date: "2025-10-06", zNo: "0105", total: 5_000, cumTotal: null, cumVat: null });
    assert.equal((await reports.okcRows("2025-10-01", "2025-10-31")).filter((r) => r.okcTotal !== null).length, 7);
    // Personelin yazarkasa bölümü olmayan sayfadan düzeltme önerisi: yazarkasa alanları değişmiş sayılmaz, öneride kayıtlı hâli
    const d1 = await reportOf("2025-10-02");
    const { date: _d, ...legacyFields } = fields("2025-10-02", undefined, { handedOver: 2_300 });
    void _d;
    const proposal = await requests.proposeCashCorrection(
      db,
      users.ayse,
      { date: "2025-10-02", baseRevision: d1.revision, fields: legacyFields, countedBy: null, message: "Teslim yanlış yazıldı", clientKey: null },
      tr("2025-10-02T23:30"),
    );
    assert.deepEqual(
      proposal.changes.map((c) => c.key),
      ["handedOver"],
    );
    const payload = (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, proposal.row.id)))[0].payload as { proposed: CashReportFields };
    assert.equal(payload.proposed.okcTotal, 9_350);
    assert.deepEqual(payload.proposed.okcVat, [{ rate: 10, total: 9_350, vat: 850 }]);
  });

  test("Kümülatifi temizle: yalnız yönetici; işlem geçmişine düşer; sürüm ve gönderim anı değişmez; başka düzeltme geri getirmez, yeni okuma getirir", async () => {
    const d4 = await reportOf("2025-10-05");
    await refused(store.clearOkcCumulativeCore(db, users.ayse, d4.id), "Kümülatifi yalnız yönetici temizler");
    const out = await store.clearOkcCumulativeCore(db, users.ali, d4.id);
    assert.deepEqual(out, { date: "2025-10-05", cumTotal: 1_285_350, cumVat: null });
    const cleared = await reportOf("2025-10-05");
    assert.deepEqual(server(cleared), [null, null, null]);
    assert.equal(cleared.revision, d4.revision);
    assert.equal(cleared.updatedAt.getTime(), d4.updatedAt.getTime());
    const [log] = await db
      .select()
      .from(s.activityLog)
      .where(and(eq(s.activityLog.userId, users.ali.id), eq(s.activityLog.action, "Yazarkasa kümülatifi temizlendi")));
    assert.ok(log, "işlem geçmişinde");
    assert.match(sp(log.detail ?? ""), /Banka POS Z no 0104 · kümülatif 1\.285\.350 ₺/);
    await refused(store.clearOkcCumulativeCore(db, users.ali, d4.id), "Bu raporda saklanmış kümülatif yok");
    // Notu değiştiren düzeltme temizlenen kümülatifi geri getirmez
    const noted = await save(fields("2025-10-05", { zNo: "0104", total: 8_000 }, { note: "not değişti" }), [], cleared.revision);
    assert.equal(noted.okcCumTotal, null);
    // Yeni bir yazarkasa fotoğrafı bağlanınca yeniden okunur (son saklanan D3'e zincir tutuyor)
    const again = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0104", total: 8_000, cum: 1_285_350 }));
    const reread = await save(fields("2025-10-05", { zNo: "0104", total: 8_000 }, { note: "not değişti" }), [again], noted.revision);
    assert.equal(reread.okcCumTotal, 1_285_350);
  });

  test("geç rapor: kasa-okc fotoğrafı kabul, Z fotoğrafı hâlâ zorunlu; kartta iki yanlı zincir; onay sunucu sütunlarını yazar, 2. sürüm yeniden hesaplar", async () => {
    const NOW = tr("2025-11-15T10:00");
    const L = "2025-11-10";
    dates.push(L);
    const lateFields = (date: string, okc: { zNo: string; total: number }) => fields(date, okc);
    const propose = (date: string, photoIds: number[], okc: { zNo: string; total: number }) =>
      late.proposeLateReport(db, users.ayse, { fields: lateFields(date, okc), reason: "Akşam sistem kapalıydı", requestVersion: 0, photoIds, handedTo: { kind: "banka" }, clientKey: null }, NOW);
    // Yazarkasa fotoğrafı tek başına yetmez (ModPOS Z fotoğrafı zorunlu)
    const okcOnly = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0108", total: 9_000, cum: 1_312_350, outside: 500 }));
    await refused(propose(L, [okcOnly], { zNo: "0108", total: 9_000 }), "Z raporunun fotoğrafını ekleyin");
    const zPhoto = await photo(users.ayse, "kasa-z");
    const req = await propose(L, [zPhoto, okcOnly], { zNo: "0108", total: 9_000 });
    assert.equal(req.row.status, "pending");
    // Yöneticinin kartı: önceki yazarkasa Z'si 0107 (8 Ekim, elle) ✓; kümülatif son saklanan 0106'dan bu yana büyümüş (aralık)
    const card = (await cards.lateCards(NOW)).find((c) => c.id === req.row.id)!;
    assert.equal(card.okcChain?.ok, true);
    assert.equal(sp(card.okcChain?.text ?? ""), "Banka POS Z no 0108: önceki 0107 (8 Ekim) ✓");
    assert.equal(card.readings.find((r) => r.kind === "kasa-okc")?.okcAdmin?.cumTotal, 1_312_350, "yöneticinin kartı tam okumayı alır");
    // Onay: rapor isteyenin adıyla, sunucu sütunları writeCashReport'tan (aralık kuralı, c), fotoğraflar bağlı, yazarkasa Z'si 400 gün
    const out = await requests.reviewCashRequestCore(
      db,
      users.ali,
      { id: req.row.id, seenVersion: req.row.version, seenRevision: null, decision: "approve", note: null, fields: null, handoverSeen: true },
      NOW,
    );
    assert.equal(out.status, "approved");
    const row = await reportOf(L);
    assert.equal(row.submittedByName, "Ayşe");
    assert.equal(row.okcZNo, "0108");
    assert.deepEqual(server(row), [1_312_350, null, 500]);
    const links = await db.select().from(s.cashReportPhotos).where(eq(s.cashReportPhotos.reportId, row.id));
    assert.deepEqual(links.map((l) => l.kind).sort(), ["kasa-okc", "kasa-z"]);
    const [okcPhoto] = await db.select().from(s.photos).where(eq(s.photos.id, okcOnly));
    assert.equal(okcPhoto.expiresAt?.getTime(), linkedUntil("kasa-okc", L, todayTR()).getTime());

    // "Düzeltip onayla": isteyenin hâli (okunanla aynı) 1. sürümde yazılır, yöneticinin toplamı okunandan farklı → 2. sürümde boş
    const L2 = "2025-11-12";
    dates.push(L2);
    const z2 = await photo(users.ayse, "kasa-z");
    const okc2 = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0109", total: 4_000, cum: 1_316_350 }));
    const req2 = await propose(L2, [z2, okc2], { zNo: "0109", total: 4_000 });
    const card2 = (await cards.lateCards(NOW)).find((c) => c.id === req2.row.id)!;
    assert.equal(sp(card2.okcChain?.text ?? ""), "Banka POS Z no 0109: önceki 0108 (10 Kasım) ✓ · kümülatif önceki Z'yle tutuyor");
    const { date: _d, ...corrected } = fields(L2, { zNo: "0109", total: 4_100 });
    void _d;
    await requests.reviewCashRequestCore(
      db,
      users.ali,
      { id: req2.row.id, seenVersion: req2.row.version, seenRevision: null, decision: "approve", note: null, fields: corrected, handoverSeen: true },
      NOW,
    );
    const row2 = await reportOf(L2);
    assert.equal(row2.revision, 2);
    assert.equal(row2.okcTotal, 4_100);
    assert.deepEqual(server(row2), [null, null, null]);
    const [v1] = await db.select().from(s.cashReportRevisions).where(and(eq(s.cashReportRevisions.reportId, row2.id), eq(s.cashReportRevisions.revision, 1)));
    assert.equal((v1.data as CashReportFields).okcTotal, 4_000, "isteyenin hâli 1. sürümde");
  });

  test("fotoğraf kaldırma: yazarkasa bölümü yazılmışken tek Banka POS Z fotoğrafı kaldırılamaz; ikincisi ya da bölüm boşken kaldırılabilir", async () => {
    const R1 = "2025-11-20";
    const AT1 = tr(`${R1}T22:30`);
    const only = await photo(users.ayse, "kasa-okc");
    const r1 = await save(fields(R1, { zNo: "0110", total: 5_000 }), [only]);
    await refused(outReqs.proposePhotoRemoval(db, users.ayse, { photoId: only, message: null, clientKey: null }, AT1), CASH_OUT_REQUEST_TEXT.photoOnlyOkc);
    // İkinci yazarkasa fotoğrafı: biri kaldırılabilir (okuması yok, fark yok)
    const second = await photo(users.ayse, "kasa-okc");
    const r1b = await save(fields(R1, { zNo: "0110", total: 5_000 }), [second], r1.revision);
    // Bölüme en çok 3 fotoğraf (uzun fişin parçaları)
    await refused(save(fields(R1, { zNo: "0110", total: 5_000 }), [await photo(users.ayse, "kasa-okc"), await photo(users.ayse, "kasa-okc")], r1b.revision), OKC_PHOTOS_TEXT);
    const ok = await outReqs.proposePhotoRemoval(db, users.ayse, { photoId: second, message: null, clientKey: null }, AT1);
    assert.equal(ok.payload.photoKind, "kasa-okc");
    assert.equal(ok.row.status, "pending");
    // Bölüm boş (yazarkasa rakamı yok): tek fotoğraf hiçbir rakamın kanıtı değil, kaldırılabilir
    const R2 = "2025-11-21";
    const lone = await photo(users.ayse, "kasa-okc");
    await save(fields(R2), [lone]);
    const ok2 = await outReqs.proposePhotoRemoval(db, users.ayse, { photoId: lone, message: null, clientKey: null }, tr(`${R2}T22:30`));
    assert.equal(ok2.row.status, "pending");
    // Onaylanan kaldırma sunucu sütunlarını kalan fotoğrafların okumasından yeniden yazar: KÜM. satırını okuyan alt parça
    // çıkınca kümülatif boşalır (son saklanan 0108'den bu yana aralık kuralıyla saklanmıştı)
    const R3 = "2025-11-22";
    const AT3 = tr(`${R3}T22:30`);
    const top = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0111", total: 6_000 }));
    const bottom = await photo(users.ayse, "kasa-okc", okcRaw({ zNo: "0111", total: 6_000, cum: 1_330_000 }));
    const r3 = await save(fields(R3, { zNo: "0111", total: 6_000 }), [top, bottom]);
    assert.equal(r3.okcCumTotal, 1_330_000);
    const req = await outReqs.proposePhotoRemoval(db, users.ayse, { photoId: bottom, message: "yanlış kâğıt", clientKey: null }, AT3);
    await outReqs.reviewPhotoRemovalCore(db, users.ali, { id: req.row.id, seenVersion: req.row.version, decision: "approve", note: null }, AT3);
    assert.deepEqual(server(await reportOf(R3)), [null, null, null]);
  });

  test("personelin DTO'su ve okuması sunucu sütunlarını ve yöneticinin satırlarını taşımaz; yöneticininki taşır", async () => {
    const staff = await reports.getCashReport("2025-10-02");
    const admin = await reports.getCashReport("2025-10-02", "admin");
    assert.ok(staff && admin);
    for (const k of ["okcCumTotal", "okcCumVat", "okcOutside"]) assert.equal(k in staff, false, `${k} personelde yok`);
    assert.doesNotMatch(JSON.stringify(staff), /okcCum|okcOutside|1259350/);
    assert.equal(staff.okcTotal, 9_350, "formun yazarkasa alanları herkese");
    assert.equal(admin.okcCumTotal, 1_259_350);
    assert.equal(admin.okcOutside, 1_250);
    assert.equal((await reports.cashReportsBetween("2025-10-02", "2025-10-02"))[0].okcCumTotal, undefined);
    // Fotoğrafın okuması: personele kümülatif ve yöneticinin satırları gitmez
    const ref = { id: admin.id, date: admin.date };
    const staffInfo = (await photoData.cashReportPhotoInfo([ref])).get(admin.id)!;
    const adminInfo = (await photoData.cashReportPhotoInfo([ref], "admin")).get(admin.id)!;
    assert.equal(staffInfo.readings[0].okcAdmin, undefined);
    assert.equal(staffInfo.readings[0].checks.some((c) => c.admin), false);
    assert.doesNotMatch(JSON.stringify(staffInfo), /cumTotal|cumVat|outside|1259350/);
    assert.equal(adminInfo.readings[0].okcAdmin?.cumTotal, 1_259_350);
  });

  test("okuma yolu: önceki yazarkasa Z'si gerçek sütunlardan (Z no +1 ve zincir doğrular), ai_calls.effort yazılır; personel kümülatifi almaz", async () => {
    // 2 Aralık: Z 0187, saklanan kümülatif (kayıtlı yanıtın 0188'inden 12.300 ve KDV 1.212,12 eksik)
    const R = "2025-12-02";
    const r = await save(fields(R, { zNo: "0187", total: 11_000 }));
    await db.update(s.cashReports).set({ okcCumTotal: 1_247_050, okcCumVat: 117_731.82 }).where(eq(s.cashReports.id, r.id));
    // Kayıtlı yanıt (tests/fixtures/foto/okc.json: Z 0188, 12.300, KÜM. 1.259.350 / 118.943,94); görsel tanınmasa da türün yanıtı döner
    const env = process.env as Record<string, string | undefined>;
    const before = { NODE_ENV: env.NODE_ENV, AI_REPLAY: env.AI_REPLAY };
    Object.assign(env, { NODE_ENV: "development", AI_REPLAY: "1" });
    try {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      const p = await photo(users.ayse, "kasa-okc");
      const asAdmin = await read.readPhotoFor("kasa-okc", { photoId: p, bytes, contentType: "image/jpeg", day: "2025-12-03", me: { ...users.ali, email: "ali@ornek.com" } });
      assert.equal(asAdmin.readError, null);
      const reading = asAdmin.reading as import("../src/lib/photo-read/kasa").CashReading;
      assert.equal(reading.values.okcZNo?.status, "confirmed", "Z no önceki + 1");
      assert.equal(reading.values.okcTotal?.status, "confirmed", "kümülatif zinciri günlük toplamı doğrular");
      assert.ok(reading.checks.some((c) => sp(c.text) === "Önceki Z'yle (0187, 2 Aralık) kümülatif zinciri tutuyor."));
      const [call] = await db.select().from(s.aiCalls).where(eq(s.aiCalls.photoId, p));
      assert.equal(call.feature, "kasa-okc");
      assert.equal(call.effort, "low");
      assert.equal(call.status, "ok");
      // Personel: aynı alan durumları, yöneticinin satırları ve kümülatif yok
      const p2 = await photo(users.ayse, "kasa-okc");
      const asStaff = await read.readPhotoFor("kasa-okc", { photoId: p2, bytes, contentType: "image/jpeg", day: "2025-12-03", me: { ...users.ayse, email: "ayse@ornek.com" } });
      const staffReading = asStaff.reading as import("../src/lib/photo-read/kasa").CashReading;
      assert.equal(staffReading.values.okcZNo?.status, "confirmed");
      assert.equal(staffReading.okcAdmin, undefined);
      assert.doesNotMatch(JSON.stringify(staffReading), /kümülatif|1259350|cumTotal/);
    } finally {
      Object.assign(env, before);
    }
  });
});
