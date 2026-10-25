// Kontrol listelerinin veritabanı tarafı (src/server/checklists/store.ts), gerçek Postgres'te: ilk yanıt günün kaydını
// anlık görüntüyle açar (iki telefon aynı anda: tek kayıt), aralık dışı değer not ister, değişen yanıtın önceki hâli
// sürümlere geçer, sorunlu yanıt geri alınmaz, tamamlanma bir kez yazılır ve eksilince geri alınır, fotoğraf yükleyenin
// bağlanmamış fotoğrafıysa aynı işlemde bağlanır (yeniden çekilenin eskisi döner), personel yönetici listesine yazamaz,
// pasif liste ve geçmiş gün kapalı (açılmış kayıt 05:30'a kadar), şablon değişse de başlamış kayıt aynı kalır; günün
// listeleri, doldurma ekranı, geçmiş ve fotoğrafın kaydı. Kendi kullanıcılarını, listesini ve fotoğraflarını açar,
// sonunda siler.
//
// KONTROL_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: KONTROL_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_kontrol npx tsx --test tests/kontrol-listeleri-db.test.ts

import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { DAY_CLOSED_TEXT } from "../src/lib/checklists";
import {
  ChecklistError,
  checkPhotoTarget,
  firstChecklistDay,
  loadChecklistDay,
  loadChecklistDays,
  loadHistory,
  loadRunView,
  photoRun,
  writeAnswer,
  type AnswerInput,
  type WriteDeps,
} from "../src/server/checklists/store";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL = process.env.KONTROL_TEST_DATABASE_URL;
/** Birleşim türünün her kolunda `K` alanları isteğe bağlı (Omit birleşimi tek türe indirger, işlemlerin alanları kaybolur) */
type Loose<T, K extends keyof T> = T extends unknown ? Omit<T, K> & Partial<Pick<T, K>> : never;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const NOW = tr("2026-10-22T14:00");
const DAY = "2026-10-22";

describe("Kontrol listeleri: veritabanında yanıt yazımı", { skip: !URL && "KONTROL_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  const users = { admin: { id: 0, name: "Yönetici", role: "admin" as const }, staff: { id: 0, name: "Ayşe", role: "staff" as const }, other: { id: 0, name: "Mehmet", role: "staff" as const } };
  let tid = 0;
  let adminOnly = 0;
  const item = { check: 0, fridge: 0, photo: 0, text: 0 };
  const photoIds: number[] = [];
  const linked: number[] = [];

  const deps: WriteDeps = {
    photos: true,
    linkPhoto: async (id, until, tx) => {
      linked.push(id);
      await tx.update(s.photos).set({ linkedAt: new Date(), expiresAt: until }).where(eq(s.photos.id, id));
    },
  };
  const write = (who: keyof typeof users, input: Loose<AnswerInput, "templateId" | "date">, now = NOW) =>
    writeAnswer(db, users[who], { templateId: tid, date: DAY, ...input } as AnswerInput, now, deps);
  const refused = async (p: Promise<unknown>, re: RegExp) => {
    await assert.rejects(p, (e: unknown) => e instanceof ChecklistError && re.test(e.message));
  };
  async function photo(by: number): Promise<number> {
    const [row] = await db
      .insert(s.photos)
      .values({ kind: "kontrol", storageKey: `kontrol/2026/10/${randomUUID()}.jpg`, contentType: "image/jpeg", sizeBytes: 100, createdBy: by, expiresAt: new Date(NOW.getTime() + 2 * 86_400_000) })
      .returning({ id: s.photos.id });
    photoIds.push(row.id);
    return row.id;
  }

  before(async () => {
    db = createDb(URL!, 4);
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `kontrol-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role })
        .returning({ id: s.users.id });
      users[k].id = u.id;
    }
    const activeFrom = tr("2026-10-01T09:00");
    const [t] = await db
      .insert(s.checklistTemplates)
      .values({ name: `Deneme ${tag}`, schedule: "daily", opensAt: "08:00", dueAt: "11:00", activeFrom, sortOrder: 900 })
      .returning({ id: s.checklistTemplates.id });
    tid = t.id;
    const rows = await db
      .insert(s.checklistItems)
      .values([
        { templateId: tid, label: "Tezgâh dezenfekte edildi", type: "check", sortOrder: 1 },
        { templateId: tid, label: "Bar buzdolabı sıcaklığı", type: "number", unit: "°C", min: 0, max: 4, sortOrder: 2 },
        { templateId: tid, label: "Bar tezgâhı hazır", type: "photo", sortOrder: 3 },
        { templateId: tid, label: "Eksik malzeme", type: "text", required: false, sortOrder: 4 },
      ])
      .returning({ id: s.checklistItems.id, type: s.checklistItems.type });
    item.check = rows.find((r) => r.type === "check")!.id;
    item.fridge = rows.find((r) => r.type === "number")!.id;
    item.photo = rows.find((r) => r.type === "photo")!.id;
    item.text = rows.find((r) => r.type === "text")!.id;
    const [a] = await db
      .insert(s.checklistTemplates)
      .values({ name: `Yönetici ${tag}`, schedule: "daily", opensAt: "08:00", dueAt: "20:00", staffAllowed: false, activeFrom, sortOrder: 901 })
      .returning({ id: s.checklistTemplates.id });
    adminOnly = a.id;
    await db.insert(s.checklistItems).values({ templateId: adminOnly, label: "Kasa sayıldı", type: "check" });
  });

  after(async () => {
    if (!db) return;
    const ids = [tid, adminOnly].filter(Boolean);
    if (ids.length) {
      const runs = await db.select({ id: s.checklistRuns.id }).from(s.checklistRuns).where(inArray(s.checklistRuns.templateId, ids));
      if (runs.length) await db.delete(s.checklistRuns).where(inArray(s.checklistRuns.id, runs.map((r) => r.id)));
      await db.delete(s.checklistTemplates).where(inArray(s.checklistTemplates.id, ids));
    }
    if (photoIds.length) await db.delete(s.photos).where(inArray(s.photos.id, photoIds));
    const uids = Object.values(users).map((u) => u.id).filter(Boolean);
    if (uids.length) await db.delete(s.users).where(inArray(s.users.id, uids));
    await db.$client.end();
  });

  test("ilk yanıt kaydı anlık görüntüyle açar; iki telefon aynı anda: tek kayıt, iki yanıt", async () => {
    const [a, b] = await Promise.all([write("staff", { op: "ok", itemId: item.check }), write("other", { op: "text", itemId: item.text, text: "Süt azaldı" })]);
    assert.equal(a.run.id, b.run.id);
    const runs = await db.select().from(s.checklistRuns).where(eq(s.checklistRuns.templateId, tid));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].date, DAY);
    assert.deepEqual(
      runs[0].items.map((i) => i.label),
      ["Tezgâh dezenfekte edildi", "Bar buzdolabı sıcaklığı", "Bar tezgâhı hazır", "Eksik malzeme"],
    );
    const view = await loadRunView(db, tid, DAY, { today: DAY, photos: true });
    assert.equal(view?.answers.length, 2);
    assert.deepEqual(view?.summary.contributors.sort(), ["Ayşe", "Mehmet"]);
    // Aynı yanıt ikinci kez yazılmaz
    const same = await write("staff", { op: "ok", itemId: item.check });
    assert.equal(same.changed, false);
  });

  test("aralık dışı değer not ister; değişen ölçümün önceki hâli kalır; sorunlu yanıt geri alınmaz", async () => {
    await refused(write("staff", { op: "value", itemId: item.fridge, value: 6, note: null }), /aralık dışında \(0–4 °C\)/);
    const bad = await write("staff", { op: "value", itemId: item.fridge, value: 6, note: "kapı açık kalmış" });
    assert.equal(bad.answer?.status, "issue");
    const ok = await write("other", { op: "value", itemId: item.fridge, value: 3.5, note: null });
    assert.equal(ok.answer?.status, "ok");
    assert.equal(ok.answer?.by, "Mehmet");
    assert.deepEqual(
      ok.answer?.history.map((v) => [v.status, v.value, v.note, v.by]),
      [["issue", 6, "kapı açık kalmış", "Ayşe"]],
    );
    assert.equal(ok.summary.issues[0].text, "Bar buzdolabı sıcaklığı: 6 °C → 3,5 °C");
    await refused(write("staff", { op: "clear", itemId: item.fridge }), /geri alınamaz/);
    // Türüne uymayan işlem
    await refused(write("staff", { op: "ok", itemId: item.fridge }), /bu şekilde işaretlenemez/);
    await refused(write("staff", { op: "photo", itemId: item.check, photoId: 1 }), /bu şekilde işaretlenemez/);
  });

  test("fotoğraf: yükleyenin bağlanmamış fotoğrafı bağlanır, tamamlanma bir kez yazılır; yeniden çekince eskisi döner; geri alınca tamam bozulur", async () => {
    // Başkasının fotoğrafı ya da bağlanmış fotoğraf olmaz
    const foreign = await photo(users.other.id);
    await refused(write("staff", { op: "photo", itemId: item.photo, photoId: foreign }), /Fotoğraf bulunamadı/);
    const first = await photo(users.staff.id);
    const r = await write("staff", { op: "photo", itemId: item.photo, photoId: first });
    assert.equal(r.completedNow, true);
    assert.equal(r.summary.complete, true);
    assert.ok(linked.includes(first));
    const [p] = await db.select().from(s.photos).where(eq(s.photos.id, first));
    assert.ok(p.linkedAt);
    assert.equal(p.expiresAt?.toISOString(), tr("2026-12-21T00:00").toISOString());
    await refused(write("staff", { op: "photo", itemId: item.photo, photoId: first }), /Fotoğraf bulunamadı/);
    const [run] = await db.select().from(s.checklistRuns).where(eq(s.checklistRuns.templateId, tid));
    assert.equal(run.completedByName, "Ayşe");
    // Yeniden çekme: eski fotoğraf silinmek üzere döner, tamamlanma yeniden yazılmaz
    const second = await photo(users.staff.id);
    const again = await write("staff", { op: "photo", itemId: item.photo, photoId: second });
    assert.equal(again.previousPhotoId, first);
    assert.equal(again.completedNow, false);
    assert.equal(again.answer?.history.length, 1);
    // Fotoğrafın notu
    const noted = await write("staff", { op: "note", itemId: item.photo, note: "sağ köşe ıslak" });
    assert.equal(noted.answer?.note, "sağ köşe ıslak");
    assert.equal(noted.answer?.photoId, second);
    assert.deepEqual(await photoRun(db, second), { date: DAY, staffAllowed: true, staffSince: null });
    assert.equal(await photoRun(db, foreign), null);
    // Tamam geri alınınca liste eksilir, yeniden işaretlenince tamamlanır
    const undo = await write("staff", { op: "clear", itemId: item.check });
    assert.equal(undo.reopened, true);
    assert.equal(undo.summary.complete, false);
    assert.equal((await db.select().from(s.checklistRuns).where(eq(s.checklistRuns.templateId, tid)))[0].completedAt, null);
    const redo = await write("other", { op: "ok", itemId: item.check });
    assert.equal(redo.completedNow, true);
    assert.equal((await db.select().from(s.checklistRuns).where(eq(s.checklistRuns.templateId, tid)))[0].completedByName, "Mehmet");
  });

  test("yetki ve gün: personel yönetici listesine yazamaz; pasif liste; geçmiş gün kapalı, açılmış kayıt 05:30'a kadar; ileri gün yok", async () => {
    await refused(writeAnswer(db, users.staff, { templateId: adminOnly, date: DAY, itemId: 1, op: "ok" }, NOW, deps), /yalnız yönetici/);
    // Dünün kaydı yok: kapalı. Bugünkü kayıt yarın 05:20'de bitirilebilir, 05:40'ta kapalı
    await refused(write("staff", { op: "ok", itemId: item.check, date: "2026-10-21" }), new RegExp(DAY_CLOSED_TEXT.slice(0, 20)));
    const graceText = await write("staff", { op: "text", itemId: item.text, text: "Gece geç kapandı" }, tr("2026-10-23T05:20"));
    assert.equal(graceText.answer?.textValue, "Gece geç kapandı");
    await refused(write("staff", { op: "text", itemId: item.text, text: "Çok geç" }, tr("2026-10-23T05:40")), /kapandı/);
    await refused(write("staff", { op: "ok", itemId: item.check, date: "2026-10-23" }), /doldurulamaz/);
    // Fotoğraf hedefi: yazmadan aynı kurallar
    await checkPhotoTarget(db, users.staff, { templateId: tid, date: DAY, itemId: item.photo }, NOW, true);
    await refused(checkPhotoTarget(db, users.staff, { templateId: tid, date: DAY, itemId: item.check }, NOW, true), /bu şekilde işaretlenemez/);
    await refused(checkPhotoTarget(db, users.staff, { templateId: tid, date: DAY, itemId: item.photo }, NOW, false), /Fotoğraf deposu/);
    await refused(checkPhotoTarget(db, users.staff, { templateId: adminOnly, date: DAY, itemId: 1 }, NOW, true), /yalnız yönetici/);
    // Pasif liste
    await db.update(s.checklistTemplates).set({ active: false, inactiveFrom: tr("2026-10-22T13:00") }).where(eq(s.checklistTemplates.id, tid));
    await refused(write("staff", { op: "ok", itemId: item.check }), /kapalı/);
    // Pasif liste günün listelerinde yok (Bugün, zil, e-posta), kaydı geçmişte kalır
    assert.ok(!(await loadChecklistDay(db, DAY, "admin", { today: DAY, photos: true })).some((l) => l.templateId === tid));
    assert.ok((await loadHistory(db, DAY, DAY, "admin", { today: DAY, photos: true }))[0].lists.some((l) => l.template.id === tid && l.run !== null));
    await db.update(s.checklistTemplates).set({ active: true, inactiveFrom: null }).where(eq(s.checklistTemplates.id, tid));
  });

  test("başlamış kayıt şablon değişse de aynı; günün listeleri personelde yalnız kendi doldurabildikleri; geçmiş", async () => {
    await db.insert(s.checklistItems).values({ templateId: tid, label: "Sonradan eklenen", type: "check", sortOrder: 9 });
    const view = await loadRunView(db, tid, DAY, { today: DAY, photos: true });
    assert.ok(!view?.items.some((i) => i.label === "Sonradan eklenen"));
    // Ertesi gün (kayıt yok): şablonun bugünkü maddeleri; depo yoksa fotoğraflı madde çıkar
    const next = await loadRunView(db, tid, "2026-10-23", { today: "2026-10-23", photos: false });
    assert.ok(next?.items.some((i) => i.label === "Sonradan eklenen"));
    assert.ok(!next?.items.some((i) => i.type === "photo"));
    assert.equal(next?.run, null);

    const staffDay = await loadChecklistDay(db, DAY, "staff", { today: DAY, photos: true });
    assert.ok(staffDay.some((l) => l.templateId === tid));
    assert.ok(!staffDay.some((l) => l.templateId === adminOnly));
    const adminDay = await loadChecklistDay(db, DAY, "admin", { today: DAY, photos: true });
    const mine = adminDay.find((l) => l.templateId === tid)!;
    assert.equal(mine.run?.complete, true);
    assert.equal(mine.required, 3);
    assert.ok(adminDay.some((l) => l.templateId === adminOnly && l.run === null));
    // Zil iki günü tek okumada alır: günler tek tek okunanla aynı
    const both = await loadChecklistDays(db, [DAY, "2026-10-21"], "admin", { today: DAY, photos: true });
    assert.deepEqual(both.get(DAY), adminDay);
    assert.deepEqual(both.get("2026-10-21"), await loadChecklistDay(db, "2026-10-21", "admin", { today: DAY, photos: true }));

    const history = await loadHistory(db, "2026-10-21", DAY, "admin", { today: DAY, photos: true });
    assert.deepEqual(
      history.map((h) => h.day),
      [DAY, "2026-10-21"],
    );
    const today = history[0].lists.find((l) => l.template.id === tid)!;
    assert.equal(today.answers.length, 4);
    assert.equal(today.run?.completedAt !== null, true);
    // Dün beklenen ama açılmamış liste geçmişte kayıtsız görünür
    assert.equal(history[1].lists.find((l) => l.template.id === tid)?.run, null);
    assert.ok((await firstChecklistDay(db))! <= DAY);
  });
  test("personelin geçmişi (dalga 10 §2.5): yalnız personel listeleri; bugün personele açılan listenin eski kaydı görünmez; pasif personel listesinin geçmişi görünür", async () => {
    const ctx = { today: DAY, photos: true };
    const [adminItem] = await db.select({ id: s.checklistItems.id }).from(s.checklistItems).where(eq(s.checklistItems.templateId, adminOnly)).limit(1);
    // Yönetici listesine dün kayıt
    await writeAnswer(db, users.admin, { templateId: adminOnly, date: "2026-10-21", itemId: adminItem.id, op: "ok" }, tr("2026-10-21T14:00"), deps);
    const adminHistory = await loadHistory(db, "2026-10-21", DAY, "admin", ctx);
    assert.ok(adminHistory[1].lists.some((l) => l.template.id === adminOnly && l.run !== null));
    const staffHistory = await loadHistory(db, "2026-10-21", DAY, "staff", ctx);
    assert.ok(staffHistory.every((d) => !d.lists.some((l) => l.template.id === adminOnly)));
    assert.ok(staffHistory[0].lists.some((l) => l.template.id === tid && l.run !== null));

    // Bugün 10:00'da personele açıldı: bugünün listesi görünür, dünkü kaydı görünmez (ne geçmişte ne günün listelerinde)
    await db.update(s.checklistTemplates).set({ staffAllowed: true, staffSince: tr("2026-10-22T10:00") }).where(eq(s.checklistTemplates.id, adminOnly));
    const opened = await loadHistory(db, "2026-10-21", DAY, "staff", ctx);
    assert.ok(opened[0].lists.some((l) => l.template.id === adminOnly));
    assert.ok(!opened[1].lists.some((l) => l.template.id === adminOnly));
    const days = await loadChecklistDays(db, [DAY, "2026-10-21"], "staff", ctx);
    assert.ok(days.get(DAY)!.some((l) => l.templateId === adminOnly));
    assert.ok(!days.get("2026-10-21")!.some((l) => l.templateId === adminOnly));
    // Yönetici yine hepsini görür
    assert.ok((await loadHistory(db, "2026-10-21", DAY, "admin", ctx))[1].lists.some((l) => l.template.id === adminOnly && l.run !== null));

    // Pasif personel listesinin geçmişi görünür (günün listelerinde değil)
    await db.update(s.checklistTemplates).set({ active: false, inactiveFrom: tr("2026-10-22T13:00") }).where(eq(s.checklistTemplates.id, tid));
    const inactive = await loadHistory(db, DAY, DAY, "staff", ctx);
    assert.ok(inactive[0].lists.some((l) => l.template.id === tid && l.run !== null));
    assert.ok(!(await loadChecklistDay(db, DAY, "staff", ctx)).some((l) => l.templateId === tid));
    await db.update(s.checklistTemplates).set({ active: true, inactiveFrom: null }).where(eq(s.checklistTemplates.id, tid));
    await db.update(s.checklistTemplates).set({ staffAllowed: false, staffSince: null }).where(eq(s.checklistTemplates.id, adminOnly));
  });
});
