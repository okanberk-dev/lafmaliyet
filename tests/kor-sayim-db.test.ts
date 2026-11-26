// Kör sayım ve teslim defteri, gerçek Postgres'te (Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Kör sayım, Teslim
// defteri): Tuzla'da (varsayılan açık) personel sayımı kilitlemeden raporu yazamaz, raporun sayılanı kilitli sayıma eşit
// olmalı; değişiklik nedeniyle yeni satır olur ve işlem geçmişine düşer; yönetici kör değildir; şube ayarı kapatılınca kilit
// beklenmez; Marina (LafPOS'un şubesi) varsayılan kapalı. Teslimin "Kime"si (yönetici, banka, ad) zorunlu ve kaydedilir;
// defter iki şubenin raporlarını ve Kasadan çıkanlar'ın teslim satırlarını (LafPOS'unkiler dahil) birlikte okur. Günler
// 2033: yerel verinin raporlarıyla çakışmaz. Kendi kullanıcılarını ve kayıtlarını açar, sonunda siler.
//
// KOR_SAYIM_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/lm_x npm run test:db -- tests/kor-sayim-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { ALL_BRANCHES } from "../src/lib/branches";
import type { CashReportFields } from "../src/lib/cash-report";
import { BLIND_COUNT_TEXT } from "../src/lib/kor-sayim";
import { HANDOVER_TEXT } from "../src/lib/teslim";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const URL = process.env.KOR_SAYIM_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);

describe("Kör sayım ve teslim defteri: veritabanında", { skip: !URL && "KOR_SAYIM_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let store: typeof import("../src/server/cash/report-store");
  let blind: typeof import("../src/server/cash/blind-count");
  let ledger: typeof import("../src/server/data/handover-ledger");
  let scope: typeof import("../src/server/branch-scope");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "ayse", Who> = { ali: { id: 0, name: `Ali ${tag}`, role: "admin" }, ayse: { id: 0, name: "Ayşe", role: "staff" } };
  const dates = ["2033-03-04", "2033-03-05", "2033-03-06", "2033-03-07"];
  /** Testten önceki kör sayım ayarı satırları (sonunda geri yazılır) */
  let savedSettings: (typeof s.branchSettings.$inferSelect)[] = [];

  const fields = (date: string, o: Partial<CashReportFields> = {}): CashReportFields & { discounts: number | null } => ({
    date,
    zNo: null,
    receipts: null,
    zTotal: 10_000,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 0,
    bankPos: null,
    offRevenue: null,
    note: "deneme",
    ...o,
    discounts: o.discounts ?? null,
  });
  type Extra = { revision?: number; handedTo?: import("../src/lib/teslim").HandedToInput | null };
  const save = (who: Who, date: string, o: Partial<CashReportFields>, x: Extra = {}, now = tr(`${date}T22:00`)) =>
    store.saveCashReport(db, who, { ...fields(date, o), countedBy: null, revision: x.revision ?? 0, photos: [], ...("handedTo" in x ? { handedTo: x.handedTo } : {}) }, now);
  const reportOf = async (date: string, branchId = "tuzla") => (await db.select().from(s.cashReports).where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId))))[0];
  const refused = async (p: Promise<unknown>, text: string | RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && (typeof text === "string" ? e.message === text : text.test(e.message)));
  };
  const setBlind = async (branchId: string, enabled: boolean | null) => {
    await db.delete(s.branchSettings).where(and(eq(s.branchSettings.branchId, branchId), eq(s.branchSettings.grp, "kasa.kor")));
    if (enabled !== null) await db.insert(s.branchSettings).values({ branchId, grp: "kasa.kor", value: { enabled }, secrets: null, sameAs: null, updatedBy: "test" });
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
    blind = await import("../src/server/cash/blind-count");
    ledger = await import("../src/server/data/handover-ledger");
    scope = await import("../src/server/branch-scope");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kor-sayim-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    savedSettings = await db.select().from(s.branchSettings).where(eq(s.branchSettings.grp, "kasa.kor"));
    // Varsayılan: Tuzla'da açık, Marina'da (LafPOS'un şubesi) kapalı
    await setBlind("tuzla", null);
    await setBlind("marina", null);
  });

  after(async () => {
    if (!db) return;
    await db.delete(s.cashCounts).where(inArray(s.cashCounts.date, dates));
    await db.delete(s.cashOuts).where(inArray(s.cashOuts.date, dates));
    await db.delete(s.cashReports).where(inArray(s.cashReports.date, dates));
    await db.delete(s.branchSettings).where(eq(s.branchSettings.grp, "kasa.kor"));
    if (savedSettings.length) await db.insert(s.branchSettings).values(savedSettings);
    await db.delete(s.activityLog).where(inArray(s.activityLog.userId, Object.values(users).map((u) => u.id)));
    await db.delete(s.users).where(inArray(s.users.id, Object.values(users).map((u) => u.id)));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("Tuzla: kilitlemeden rapor yok; sayılan kilitli sayıma eşit; değişiklik nedeniyle yeni satır, yöneticiye görünür", async () => {
    const day = dates[0];
    const now = tr(`${day}T22:00`);
    assert.equal(await blind.blindCountApplies(db, day, "tuzla"), true, "Tuzla varsayılan açık");
    await refused(save(users.ayse, day, {}), BLIND_COUNT_TEXT.lockFirst);
    assert.equal(await reportOf(day), undefined, "hiçbir şey yazılmadı");
    // İlk kör sayım nedensiz
    const lock = await blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 3_500 }, now);
    assert.deepEqual({ amount: lock.amount, by: lock.by, changed: lock.changed }, { amount: 3_500, by: "Ayşe", changed: false });
    // Aynı tutar yeniden kilitlenmez (satır eklenmez)
    await blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 3_500 }, now);
    assert.equal((await blind.cashCountsOn(db, day, "tuzla")).length, 1);
    // Farklı sayılan reddedilir, kilitli sayımı söyler
    await refused(save(users.ayse, day, { countedCash: 3_400 }), /kilitli sayımdan \(3\.500\s₺\) farklı/);
    const ok = await save(users.ayse, day, {});
    assert.equal(ok.kind, "saved");
    // Değişiklik nedensiz olmaz; nedeniyle yeni satır, kilit "değişti"
    await refused(blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 3_550 }, now), BLIND_COUNT_TEXT.reason);
    const changed = await blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 3_550, reason: "Çekmecenin altında 50 ₺ çıktı" }, tr(`${day}T22:10`));
    assert.equal(changed.changed, true);
    const rows = await blind.cashCountsOn(db, day, "tuzla");
    assert.deepEqual(
      rows.map((r) => [r.amount, r.reason]),
      [
        [3_500, null],
        [3_550, "Çekmecenin altında 50 ₺ çıktı"],
      ],
    );
    // Raporun eski sayılanı (değişmeden) geçer; yeni sayım da geçer
    assert.equal((await save(users.ayse, day, { note: "yazım" }, { revision: 1 })).kind, "saved");
    assert.equal((await save(users.ayse, day, { countedCash: 3_550 }, { revision: 2 })).kind, "saved");
    assert.equal((await reportOf(day)).countedCash, 3_550);
    // İşlem geçmişi: kilit ve değişiklik
    const log = await db.select({ action: s.activityLog.action, detail: s.activityLog.detail }).from(s.activityLog).where(eq(s.activityLog.userId, users.ayse.id));
    assert.ok(log.some((l) => l.action === "Kasa sayımı kilitlendi"), "kilit işlem geçmişinde");
    assert.ok(log.some((l) => l.action === "Kasa sayımı değişti" && /önceki 3\.500/.test((l.detail ?? "").replace(/ /g, " "))), "değişiklik işlem geçmişinde");
    // Ertesi günün raporu girilince personel sayımı değiştiremez
    await setBlind("tuzla", false);
    assert.equal((await save(users.ali, dates[1], { openingCash: 3_550 })).kind, "saved");
    await setBlind("tuzla", null);
    await refused(blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 3_600, reason: "yeniden saydım" }, tr(`${day}T23:00`)), BLIND_COUNT_TEXT.closed);
  });

  test("yönetici kör değil; ayar kapatılınca kilit beklenmez; Marina varsayılan kapalı", async () => {
    const day = dates[2];
    // Yönetici kilitsiz yazar
    assert.equal((await save(users.ali, day, { openingCash: 0 })).kind, "saved");
    await db.delete(s.cashReports).where(eq(s.cashReports.date, day));
    // Ayar kapalı: personel kilitsiz yazar; kilitlemek istenirse "kör sayım yok"
    await setBlind("tuzla", false);
    assert.equal(await blind.blindCountApplies(db, day, "tuzla"), false);
    await refused(blind.lockCashCountCore(db, users.ayse, { date: day, branchId: "tuzla", amount: 1 }, tr(`${day}T22:00`)), BLIND_COUNT_TEXT.off);
    assert.equal((await save(users.ayse, day, { openingCash: 0 })).kind, "saved");
    await setBlind("tuzla", null);
    // Marina (LafPOS'un şubesi): varsayılan kapalı
    assert.equal(await blind.blindCountApplies(db, day, "marina"), false);
    const marina = await scope.withBranchScope("marina", () => save(users.ayse, day, { openingCash: 0 }));
    assert.equal(marina.kind, "saved");
  });

  test("Kime: teslim varken zorunlu; yönetici hesabı, banka, ad; personel hesabı seçilemez", async () => {
    const day = dates[3];
    await setBlind("tuzla", false);
    await refused(save(users.ayse, day, { handedOver: 2_000, openingCash: 0 }, { handedTo: null }), HANDOVER_TEXT.required);
    await refused(save(users.ayse, day, { handedOver: 2_000, openingCash: 0 }, { handedTo: { kind: "user", id: users.ayse.id } }), HANDOVER_TEXT.userMissing);
    assert.equal((await save(users.ayse, day, { handedOver: 2_000, openingCash: 0 }, { handedTo: { kind: "user", id: users.ali.id } })).kind, "saved");
    let r = await reportOf(day);
    assert.deepEqual([r.handedTo, r.handedToUserId], [users.ali.name, users.ali.id]);
    // Gönderilmeyen Kime (eski sayfa) kalır
    assert.equal((await save(users.ayse, day, { handedOver: 2_000, openingCash: 0, note: "yazım" }, { revision: 1 })).kind, "saved");
    r = await reportOf(day);
    assert.equal(r.handedTo, users.ali.name);
    // Banka ve elle yazılan ad
    await save(users.ayse, day, { handedOver: 2_000, openingCash: 0 }, { revision: 2, handedTo: { kind: "banka" } });
    assert.deepEqual([(await reportOf(day)).handedTo, (await reportOf(day)).handedToUserId], ["Banka", null]);
    await save(users.ayse, day, { handedOver: 1_500, openingCash: 0 }, { revision: 3, handedTo: { kind: "ad", name: "  Okan   Bey " } });
    assert.equal((await reportOf(day)).handedTo, "Okan Bey");
    // Teslim sıfırlanınca Kime de temizlenir
    await save(users.ayse, day, { handedOver: 0, openingCash: 0 }, { revision: 4, handedTo: null });
    assert.equal((await reportOf(day)).handedTo, null);
    await save(users.ayse, day, { handedOver: 1_500, openingCash: 0 }, { revision: 5, handedTo: { kind: "ad", name: "Okan Bey" } });
    await setBlind("tuzla", null);
  });

  test("defter: iki şubenin sayımdan sonra teslimi ve gün içindeki teslim satırları (LafPOS'unkiler dahil)", async () => {
    const day = dates[3];
    // Marina'nın LafPOS'tan gelen teslimi (Kime'si LafPOS'un alıcısı) ve Tuzla'nın elle girilen teslim satırı
    await db.insert(s.cashOuts).values([
      { branchId: "marina", date: day, kind: "teslim", amount: 4_000, store: "Patron", description: null, docType: "yok", createdBy: null, createdByName: "LafPOS", lafposId: `01KORSAYIM${tag.replace(/[^0-9A-Z]/gi, "").toUpperCase().slice(0, 16).padEnd(16, "0")}` },
      { branchId: "tuzla", date: day, kind: "teslim", amount: 300, store: "Sütaş şoförü", description: null, docType: "yok", createdBy: users.ayse.id, createdByName: "Ayşe" },
      { branchId: "tuzla", date: day, kind: "harcama", amount: 90, store: "Migros", description: "süt", docType: "fis", createdBy: users.ayse.id, createdByName: "Ayşe" },
    ]);
    const all = (await scope.withBranchScope(ALL_BRANCHES, () => ledger.handoverLedger(day.slice(0, 7)))).filter((r) => r.date === day);
    assert.deepEqual(
      all.map((r) => [r.branchId, r.kind, r.amount, r.to, r.lafpos]),
      [
        ["marina", "gun-ici", 4_000, "Patron", true],
        ["tuzla", "gun-ici", 300, "Sütaş şoförü", false],
        ["tuzla", "sayim", 1_500, "Okan Bey", false],
      ],
    );
    // Şube seçiliyken yalnız o şubenin
    const tuzla = (await scope.withBranchScope("tuzla", () => ledger.handoverLedger(day.slice(0, 7)))).filter((r) => r.date === day);
    assert.deepEqual(tuzla.map((r) => r.branchId), ["tuzla", "tuzla"]);
  });
});
