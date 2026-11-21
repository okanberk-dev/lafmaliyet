// Şubesine kilitli personel ve kimliğiyle açılan kayıt, gerçek Postgres'te (21 Kasım 2026 denetimi #14; docs/SUBE.md ›
// Personel hesabının şubesi): Tuzla'ya kilitli Ayşe, Marina'nın açık günündeki kasadan çıkan satırını kimliğiyle
// düzeltemez, silemez, isteğe konu edemez, fiş ekleyemez; Marina'nın zayi kaydını silemez, silinmesini isteyemez;
// Marina'nın Z ve fiş fotoğrafını göremez, Z fotoğrafının kaldırılmasını isteyemez. Kendi şubesinde her şey bugünkü
// gibi; şubesiz personel ve yönetici serbest. Kilit oturumdan okunur (src/server/branch-scope.ts lockedBranch): oturum
// taklit edilir (src/server/auth/dal getCurrentUser).
//
// Kendi kullanıcılarını, satırlarını, kayıtlarını, raporunu ve fotoğraflarını açar, sonunda siler. Kasadan çıkan ve
// zayi senaryoları 2099'da (başka testin raporu "sonraki rapor" sayılmasın); fotoğraf kuralı saat almaz, onun raporu
// ve satırları bugünün iş gününde.
//
// SUBE_KILIT_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış, şubeleri tohumlanmış yerel veritabanı).
// Çalıştırma: SUBE_KILIT_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/sube-kilit-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import { DEFAULT_BRANCHES } from "../src/lib/branches";
import { businessDate } from "../src/lib/cash-report";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

const URL = process.env.SUBE_KILIT_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const OTHER = "Bu kayıt Marina şubesinin; hesabınız Tuzla şubesinde";

describe("Şube kilidi: kimliğiyle açılan kayıt veritabanında", { skip: !URL && "SUBE_KILIT_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let guard: typeof import("../src/server/cash-outs/guard");
  let reqs: typeof import("../src/server/cash-outs/requests");
  let waste: typeof import("../src/server/waste/core");
  let rules: typeof import("../src/server/photo-read/rules");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; email: string; role: "admin" | "staff"; branchId: string | null };
  const users: Record<"ali" | "ayse" | "serbest", Who> = {
    ali: { id: 0, name: "Ali", email: "", role: "admin", branchId: null },
    ayse: { id: 0, name: "Ayşe", email: "", role: "staff", branchId: "tuzla" },
    serbest: { id: 0, name: "Serbest", email: "", role: "staff", branchId: null },
  };
  /** Oturumdaki kişi: staffBranchRefusal kilidi buradan okur (getCurrentUser taklidi) */
  let session: Who | null = null;
  const as = (who: Who) => {
    session = who;
    return who;
  };
  const DAY = "2099-06-15";
  const NOW = tr("2099-06-15T12:00");
  const TODAY = businessDate();
  const outIds: number[] = [];
  const wasteIds: number[] = [];
  const photoIds: number[] = [];
  const reportIds: number[] = [];
  /** Testin etkinleştirdiği şubeler (sonunda eski hâline) */
  const reactivated: string[] = [];
  const photo = { marinaZ: 0, marinaFis: 0, tuzlaFis: 0 };

  const refused = async (p: Promise<unknown>, text: string) => {
    await assert.rejects(p, (e: unknown) => e instanceof UserError && e.message === text);
  };
  async function cashOut(branchId: string, date = DAY, photoId: number | null = null) {
    const [o] = await db
      .insert(s.cashOuts)
      .values({ branchId, date, kind: "harcama", amount: 100, store: "Bim", docType: photoId ? "fis" : "yok", photoId, createdBy: users.ali.id, createdByName: users.ali.name })
      .returning();
    outIds.push(o.id);
    return o;
  }
  async function wasteEntry(branchId: string, by: Who) {
    const [w] = await db
      .insert(s.wasteEntries)
      .values({ date: DAY, branchId, kind: "zayi", name: `Süt ${tag}`, qty: 1, unit: "adet", createdBy: by.id, createdByName: by.name })
      .returning({ id: s.wasteEntries.id });
    wasteIds.push(w.id);
    return w.id;
  }
  async function newPhoto(kind: "kasa-z" | "fis") {
    const [p] = await db
      .insert(s.photos)
      .values({ kind, storageKey: `test/sube-kilit/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: users.ali.id, createdByName: users.ali.name, linkedAt: new Date() })
      .returning();
    photoIds.push(p.id);
    return p.id;
  }
  const photoRow = async (id: number) => (await db.select().from(s.photos).where(eq(s.photos.id, id)))[0];
  const exists = async (id: number) => (await db.select({ id: s.wasteEntries.id }).from(s.wasteEntries).where(eq(s.wasteEntries.id, id))).length === 1;

  before(async () => {
    process.env.DATABASE_URL = URL;
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır; oturum taklit edilir
    stub("server-only", {});
    const current = async () => (session ? { ...session } : null);
    stub("../src/server/auth/dal", { getCurrentUser: current, requireUser: current, requireAdmin: current });
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL!, 4);
    guard = await import("../src/server/cash-outs/guard");
    reqs = await import("../src/server/cash-outs/requests");
    waste = await import("../src/server/waste/core");
    rules = await import("../src/server/photo-read/rules");
    // Tuzla ve Marina etkin olmalı (kilit pasif şubede kalkar)
    for (const b of DEFAULT_BRANCHES.filter((x) => x.id === "tuzla" || x.id === "marina")) {
      await db.insert(s.branches).values({ ...b, active: true }).onConflictDoNothing();
      const [row] = await db.select({ active: s.branches.active }).from(s.branches).where(eq(s.branches.id, b.id));
      if (!row.active) {
        await db.update(s.branches).set({ active: true }).where(eq(s.branches.id, b.id));
        reactivated.push(b.id);
      }
    }
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      users[k].email = `sube-kilit-${k}-${tag}@ornek.com`;
      const [u] = await db
        .insert(s.users)
        .values({ email: users[k].email, name: users[k].name, passwordHash: "x", role: users[k].role, branchId: users[k].branchId })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    // Fotoğraf kuralı: Marina'nın bugünkü raporu ve Z fotoğrafı, Marina'nın ve Tuzla'nın bugünkü fişli satırı
    const [have] = await db.select({ id: s.cashReports.id }).from(s.cashReports).where(and(eq(s.cashReports.date, TODAY), eq(s.cashReports.branchId, "marina")));
    const reportId =
      have?.id ??
      (await db.insert(s.cashReports).values({ date: TODAY, branchId: "marina", submittedBy: users.ali.id, submittedByName: users.ali.name }).returning({ id: s.cashReports.id }))[0].id;
    if (!have) reportIds.push(reportId);
    photo.marinaZ = await newPhoto("kasa-z");
    await db.insert(s.cashReportPhotos).values({ reportId, photoId: photo.marinaZ, kind: "kasa-z" });
    photo.marinaFis = await newPhoto("fis");
    await cashOut("marina", TODAY, photo.marinaFis);
    photo.tuzlaFis = await newPhoto("fis");
    await cashOut("tuzla", TODAY, photo.tuzlaFis);
  });

  after(async () => {
    session = null;
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, ids));
    if (outIds.length) await db.delete(s.cashOuts).where(inArray(s.cashOuts.id, outIds));
    if (wasteIds.length) await db.delete(s.wasteEntries).where(inArray(s.wasteEntries.id, wasteIds));
    if (photoIds.length) await db.delete(s.cashReportPhotos).where(inArray(s.cashReportPhotos.photoId, photoIds));
    if (reportIds.length) await db.delete(s.cashReports).where(inArray(s.cashReports.id, reportIds));
    if (photoIds.length) await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    await db.delete(s.users).where(inArray(s.users.id, ids));
    for (const id of reactivated) await db.update(s.branches).set({ active: false }).where(eq(s.branches.id, id));
    await db.$client.end();
    const { getDb } = await import("../src/server/db");
    await getDb().$client.end();
  });

  test("kasadan çıkan: kilitli personel başka şubenin satırına kimliğiyle dokunamaz; kendi şubesinde, şubesizde ve yöneticide bugünkü gibi", async () => {
    const marina = await cashOut("marina");
    const tuzla = await cashOut("tuzla");
    const gate = (who: Who, op: "duzelt" | "sil" | "fis", row: typeof marina) => db.transaction((tx) => guard.staffCashOutGate(tx, as(who), { op, row }, NOW));
    for (const op of ["duzelt", "sil", "fis"] as const) await refused(gate(users.ayse, op, marina), OTHER);
    assert.equal(await gate(users.ayse, "duzelt", tuzla), "direct");
    assert.equal(await gate(users.serbest, "duzelt", marina), "direct");
    assert.equal(await gate(users.ali, "sil", marina), "direct");
    // Yeni satır (ekle) satır kimliği taşımaz: kasası formun kasası (formTillBranch), kapı yalnız günü sorar
    assert.equal(await db.transaction((tx) => guard.staffCashOutGate(tx, as(users.ayse), { op: "ekle", date: DAY }, NOW)), "direct");
    // İstek ve fiş yolları da aynı kapıdan
    await refused(reqs.proposeCashOutChange(db, as(users.ayse), { op: "sil", date: null, cashOutId: marina.id, line: null, message: null, clientKey: null }, NOW), OTHER);
    await refused(reqs.attachCashOutReceiptCore(db, as(users.ayse), { cashOutId: marina.id, photoId: await newPhoto("fis") }, NOW), OTHER);
    assert.equal((await db.select().from(s.cashOuts).where(eq(s.cashOuts.id, marina.id)))[0].photoId, null, "fiş bağlanmadı");
  });

  test("zayi: kilitli personel başka şubenin kaydını silemez, silinmesini isteyemez; kendi şubesinde ve şubesiz personelde silinir", async () => {
    const own = await wasteEntry("marina", users.ayse);
    await refused(waste.removeWaste(db, as(users.ayse), own, NOW), OTHER);
    assert.ok(await exists(own), "kayıt duruyor");
    const others = await wasteEntry("marina", users.ali);
    await refused(waste.proposeWasteDelete(db, as(users.ayse), { id: others, message: "Yanlış girildi", clientKey: null }, NOW), OTHER);
    const asked = await db.select().from(s.staffRequests).where(and(eq(s.staffRequests.requestedBy, users.ayse.id), eq(s.staffRequests.subject, `zayi:${others}`)));
    assert.equal(asked.length, 0, "istek açılmadı");
    const tuzla = await wasteEntry("tuzla", users.ayse);
    await waste.removeWaste(db, as(users.ayse), tuzla, NOW);
    assert.ok(!(await exists(tuzla)));
    const free = await wasteEntry("marina", users.serbest);
    await waste.removeWaste(db, as(users.serbest), free, NOW);
    assert.ok(!(await exists(free)));
  });

  test("fotoğraf: kilitli personel başka şubenin Z ve fiş fotoğrafını görmez (gün açıkken bile); kendi şubesininkini ve şubesiz personel görür", async () => {
    const view = async (who: Who, id: number, kind: "z" | "fis") => (kind === "z" ? rules.cashPhotoRules : rules.receiptPhotoRules).canView(as(who), await photoRow(id));
    assert.equal(await view(users.ayse, photo.marinaZ, "z"), false);
    assert.equal(await view(users.ayse, photo.marinaFis, "fis"), false);
    assert.equal(await view(users.ayse, photo.tuzlaFis, "fis"), true);
    // Gün açık: şubesiz personel aynı fotoğrafları görür (red günden değil, şubeden)
    assert.equal(await view(users.serbest, photo.marinaZ, "z"), true);
    assert.equal(await view(users.serbest, photo.marinaFis, "fis"), true);
    // Yazarkasa Z'si kasanın kuralını paylaşır
    assert.equal(await rules.okcPhotoRules.canView(as(users.ayse), await photoRow(photo.marinaZ)), false);
  });

  test("fotoğraf kaldırma isteği: kilitli personel başka şubenin raporundaki fotoğrafı isteyemez", async () => {
    await refused(reqs.proposePhotoRemoval(db, as(users.ayse), { photoId: photo.marinaZ, message: null, clientKey: null }), OTHER);
    const asked = await db.select().from(s.staffRequests).where(eq(s.staffRequests.subject, `foto:${photo.marinaZ}`));
    assert.equal(asked.length, 0);
  });
});
