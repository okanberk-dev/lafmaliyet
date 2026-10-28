// Karaoke sayacının silinmesi ve oturumun bitirilmesi, gerçek Postgres'te (denetim E-15, E-65; docs/KARAOKE.md ›
// Sayacı silmek, bitirmek, geri açmak): personel 5. dakikada siler, 11. dakikada silemez ve istek açar (sayaç durur);
// yönetici her zaman siler ve bekleyen istekleri kapatır; onay sayacı siler, ret dokunmaz, arada silinen sayaçta istek
// kapanır; ekranda görülmeyen sürüm onaylanmaz; onay ile personelin güncellemesi yarışta kilitlenmez. Bitir ve geri aç
// işlem geçmişine yazılır (kim bitirmişti dahil); iptal edilmiş ve süresi dolmuş oturum geri açılmaz. Okuyucular
// (bar ekranının satırı, zil, Onaylar kartı) yük ve neden sızdırmaz.
//
// Kendi kullanıcılarını, oturumlarını ve isteklerini açar, sonunda siler. Oturumlar 2031'de (öteki testlerin günleriyle
// çakışmaz).
//
// ONAY_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı; onay kuyruğunun testiyle
// aynı değişken).
// Çalıştırma: ONAY_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_yetki npx tsx --test tests/karaoke-istek-db.test.ts

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";

import { and, desc, eq, inArray } from "drizzle-orm";

import { KARAOKE_REQUEST_TEXT } from "../src/lib/karaoke/timer-requests";
import { REQUEST_TEXT } from "../src/lib/staff-requests";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { UserError } from "../src/server/user-error";

import { assertNoCostKeys } from "./helpers/leak-scan";
import { raceOnRequest } from "./helpers/lock-race";

const URL = process.env.ONAY_TEST_DATABASE_URL;
/** Türkiye saatiyle an */
const tr = (local: string) => new Date(`${local}:00+03:00`);
const MIN = 60_000;

describe("Karaoke sayacı: silme isteği ve bitirme izi (veritabanında)", { skip: !URL && "ONAY_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let core: typeof import("../src/server/karaoke/timer");
  let reads: typeof import("../src/server/data/karaoke-requests");
  const tag = `${process.pid}-${randomBytes(3).toString("hex")}`;
  type Who = { id: number; name: string; role: "admin" | "staff" };
  const users: Record<"ali" | "veli" | "ayse" | "mehmet", Who> = {
    ali: { id: 0, name: "Ali", role: "admin" },
    veli: { id: 0, name: "Veli", role: "admin" },
    ayse: { id: 0, name: "Ayşe", role: "staff" },
    mehmet: { id: 0, name: "Mehmet", role: "staff" },
  };
  const sessionIds: number[] = [];
  /** Sayaçların açıldığı an (21:00); 5. ve 11. dakika bundan */
  const START = tr("2031-03-14T21:00");
  const at = (minutes: number) => new Date(START.getTime() + minutes * MIN);

  /** Panelden açılmış 2 saatlik sayaç (ya da sitenin rezervasyonu) */
  async function timer(o: Partial<typeof s.karaokeSessions.$inferInsert> = {}): Promise<number> {
    const [row] = await db
      .insert(s.karaokeSessions)
      .values({
        source: "panel",
        date: "2031-03-14",
        startsAt: START,
        endsAt: new Date(START.getTime() + 120 * MIN),
        customerName: `Deniz ${tag}`,
        guests: 4,
        status: "confirmed",
        paymentStatus: "none",
        createdBy: "Ayşe",
        ...o,
      })
      .returning({ id: s.karaokeSessions.id });
    sessionIds.push(row.id);
    return row.id;
  }
  const sessionOf = async (id: number) => (await db.select().from(s.karaokeSessions).where(eq(s.karaokeSessions.id, id)))[0];
  const requestOf = async (id: number) => (await db.select().from(s.staffRequests).where(eq(s.staffRequests.id, id)))[0];
  const key = () => `k-${randomBytes(6).toString("hex")}`;
  const ask = (who: Who, id: number, now = at(11), clientKey = key()) => core.proposeKaraokeDelete(db, who, { id, message: "Yanlışlıkla iki kez açıldı", clientKey }, now);
  const review = (who: Who, id: number, seenVersion: number, decision: "approve" | "reject", note: string | null = null) =>
    core.reviewKaraokeDeleteCore(db, who, { id, seenVersion, decision, note }, at(40));
  /** Kullanıcının işlem geçmişi satırları, yeniden eskiye */
  const logsOf = (who: Who) =>
    db
      .select({ action: s.activityLog.action, detail: s.activityLog.detail, userName: s.activityLog.userName })
      .from(s.activityLog)
      .where(eq(s.activityLog.userId, who.id))
      .orderBy(desc(s.activityLog.id));
  /** Karaoke sayacı (canlı ucun ETag'i); öteki testler de yalnız artırır */
  const karaokeV = async () => {
    const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, "karaoke_version"));
    return Number((row?.value as { v?: number } | undefined)?.v ?? 0);
  };
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
    core = await import("../src/server/karaoke/timer");
    reads = await import("../src/server/data/karaoke-requests");
    for (const k of Object.keys(users) as (keyof typeof users)[]) {
      const [u] = await db.insert(s.users).values({ email: `karaoke-istek-${k}-${tag}@ornek.com`, name: users[k].name, passwordHash: "x", role: users[k].role }).returning({ id: s.users.id });
      users[k].id = u.id;
    }
  });

  after(async () => {
    if (!db) return;
    const uids = Object.values(users)
      .map((u) => u.id)
      .filter(Boolean);
    if (uids.length) {
      await db.delete(s.staffRequests).where(inArray(s.staffRequests.requestedBy, uids));
      await db.delete(s.activityLog).where(inArray(s.activityLog.userId, uids));
    }
    if (sessionIds.length) await db.delete(s.karaokeSessions).where(inArray(s.karaokeSessions.id, sessionIds));
    if (uids.length) await db.delete(s.users).where(inArray(s.users.id, uids));
    await db.$client.end();
  });

  test("personel 5. dakikada siler (işlem geçmişine yazılır); 11. dakikada silemez, sayaç durur", async () => {
    const early = await timer();
    const out = await core.removeKaraokeTimerCore(db, users.ayse, early, at(5));
    assert.equal(out.status, "deleted");
    assert.equal(await sessionOf(early), undefined);
    const [log] = await logsOf(users.ayse);
    assert.equal(log.action, "Karaoke sayacı silindi");
    assert.equal(log.userName, "Ayşe");
    assert.match(log.detail ?? "", new RegExp(`^Deniz ${tag} · 14 Mar 21:00–23:00 · Ayşe açmıştı$`));

    const late = await timer();
    assert.deepEqual(await core.removeKaraokeTimerCore(db, users.ayse, late, at(11)), { status: "ask" });
    assert.ok(await sessionOf(late), "sayaç durur");
    // Sınır: tam 10. dakikada istek
    assert.deepEqual(await core.removeKaraokeTimerCore(db, users.mehmet, late, at(10)), { status: "ask" });
    // Sitenin rezervasyonu panelden silinmez (iki rol)
    const site = await timer({ source: "site", externalId: `krk-${tag}`, createdBy: null });
    await refused(core.removeKaraokeTimerCore(db, users.ali, site, at(1)), KARAOKE_REQUEST_TEXT.siteOnly);
    await refused(core.removeKaraokeTimerCore(db, users.ayse, site, at(1)), KARAOKE_REQUEST_TEXT.siteOnly);
    await refused(core.removeKaraokeTimerCore(db, users.ayse, 2_000_000_000, at(1)), KARAOKE_REQUEST_TEXT.gone);
  });

  test("11. dakikada istek açılır: sayaç durur, başlıkta ad yok, yükte etiket yok; aynı anahtar ikinci istek açmaz", async () => {
    const id = await timer();
    const k = key();
    const out = await ask(users.ayse, id, at(11), k);
    assert.equal(out.created, true);
    assert.equal(out.wrote, true);
    assert.equal(out.row.kind, "karaoke-sil");
    assert.equal(out.row.subject, `karaoke:${id}`);
    assert.equal(out.row.day, "2031-03-14");
    assert.equal(out.row.status, "pending");
    assert.equal(out.row.title, "Karaoke sayacı silme · 14 Mar 21:00–23:00");
    assert.doesNotMatch(JSON.stringify(out.row.payload), new RegExp(`Deniz|${tag}`), "etiket (misafirin adı olabilir) yüke yazılmaz");
    assert.ok(await sessionOf(id), "sayaç onaya kadar durur");
    const [log] = await logsOf(users.ayse);
    assert.equal(log.action, "Karaoke sayacının silinmesi istendi");
    assert.match(log.detail ?? "", /· Yanlışlıkla iki kez açıldı$/);
    // Çift dokunuş: aynı anahtar var olanı döner, yazmaz
    const again = await ask(users.ayse, id, at(12), k);
    assert.equal(again.row.id, out.row.id);
    assert.equal(again.wrote, false);
    assert.equal((await logsOf(users.ayse)).filter((l) => l.action === "Karaoke sayacının silinmesi istendi").length, 1);
    // Yeni nedenle yeniden: aynı istek güncellenir (sürüm artar)
    const updated = await core.proposeKaraokeDelete(db, users.ayse, { id, message: "Grup gelmedi", clientKey: key() }, at(13));
    assert.equal(updated.row.id, out.row.id);
    assert.equal(updated.row.version, 2);
    assert.equal(updated.row.message, "Grup gelmedi");
    // Kurallar: yönetici istek açmaz; ilk 10 dakikada istek gerekmez; sitenin rezervasyonu ve kısa neden
    await refused(ask(users.ali, id), REQUEST_TEXT.adminDirect);
    await refused(ask(users.mehmet, id, at(5)), KARAOKE_REQUEST_TEXT.useDirect);
    const site = await timer({ source: "site", externalId: `krk2-${tag}`, createdBy: null });
    await refused(ask(users.mehmet, site), KARAOKE_REQUEST_TEXT.siteOnly);
    await refused(core.proposeKaraokeDelete(db, users.mehmet, { id, message: " a ", clientKey: key() }, at(11)), KARAOKE_REQUEST_TEXT.messageShort);
  });

  test("yönetici her zaman siler; aynı sayacın bekleyen istekleri 'Sayaç silindi' diye kapanır", async () => {
    const id = await timer();
    const a = await ask(users.ayse, id);
    const b = await ask(users.mehmet, id);
    const out = await core.removeKaraokeTimerCore(db, users.ali, id, at(180));
    assert.equal(out.status, "deleted");
    assert.equal(await sessionOf(id), undefined);
    for (const r of [a.row.id, b.row.id]) {
      const req = await requestOf(r);
      assert.equal(req.status, "superseded");
      assert.equal(req.reviewNote, KARAOKE_REQUEST_TEXT.deleted);
    }
    const [log] = await logsOf(users.ali);
    assert.equal(log.action, "Karaoke sayacı silindi");
  });

  test("onay sayacı siler, öteki bekleyen isteği kapatır; ret dokunmaz; arada silinen sayaçta istek kapanır", async () => {
    const id = await timer();
    const a = await ask(users.ayse, id);
    const b = await ask(users.mehmet, id);
    // Personel karar veremez; ekranda görülmeyen sürüm onaylanmaz
    await refused(review(users.ayse, a.row.id, a.row.version, "approve"), REQUEST_TEXT.adminOnly);
    await refused(review(users.ali, a.row.id, a.row.version + 1, "approve"), REQUEST_TEXT.changed);
    const out = await review(users.ali, a.row.id, a.row.version, "approve", "Tamam");
    assert.equal(out.status, "approved");
    assert.equal(await sessionOf(id), undefined);
    const req = await requestOf(a.row.id);
    assert.equal(req.status, "approved");
    assert.equal(req.resultId, id);
    assert.equal(req.reviewNote, "Tamam");
    assert.equal((await requestOf(b.row.id)).status, "superseded");
    const [log] = await logsOf(users.ali);
    assert.equal(log.action, "Karaoke sayacının silinmesi onaylandı");
    assert.match(log.detail ?? "", /\(Ayşe istedi · not: Tamam\)$/);
    await refused(review(users.veli, a.row.id, a.row.version, "approve"), REQUEST_TEXT.decided);

    // Ret: sayaç durur
    const kept = await timer();
    const c = await ask(users.ayse, kept);
    assert.equal((await review(users.ali, c.row.id, c.row.version, "reject", "Oda kullanıldı")).status, "rejected");
    assert.ok(await sessionOf(kept));
    assert.equal((await requestOf(c.row.id)).reviewNote, "Oda kullanıldı");
    assert.equal((await logsOf(users.ali))[0].action, "Karaoke sayacının silinmesi reddedildi");

    // Sayaç arada (doğrudan yazımla) silindi: istek "Sayaç zaten silinmişti" diye kapanır
    const lost = await timer();
    const d = await ask(users.ayse, lost);
    await db.delete(s.karaokeSessions).where(eq(s.karaokeSessions.id, lost));
    const gone = await review(users.ali, d.row.id, d.row.version, "approve");
    assert.equal(gone.status, "gone");
    const closed = await requestOf(d.row.id);
    assert.equal(closed.status, "superseded");
    assert.equal(closed.reviewNote, KARAOKE_REQUEST_TEXT.alreadyGone);

    // Personel kendi isteğini geri çeker: iz ve karaoke sayacı geri çekmeyle aynı işlemde (inceleme D1)
    const w = await ask(users.mehmet, kept, at(50));
    const before = await karaokeV();
    const pulled = await core.withdrawRequestCore(db, users.mehmet, w.row.id, at(51));
    assert.equal(pulled.row.status, "withdrawn");
    assert.equal(pulled.traced, true);
    assert.equal((await requestOf(w.row.id)).status, "withdrawn");
    const [trace] = await logsOf(users.mehmet);
    assert.equal(trace.action, "Karaoke sayacı silme isteği geri çekildi");
    assert.equal(trace.detail, w.row.title);
    assert.ok((await karaokeV()) > before, "karaoke sayacı arttı (açık sekmeler satırı bırakır)");
    // İkinci basış: istek artık beklemede değil; iz ve sayaç yeniden yazılmaz
    const again = await karaokeV();
    const traces = (await logsOf(users.mehmet)).length;
    await refused(core.withdrawRequestCore(db, users.mehmet, w.row.id, at(52)), REQUEST_TEXT.notPending);
    assert.equal((await logsOf(users.mehmet)).length, traces);
    assert.equal(await karaokeV(), again);
  });

  test("kilit sırası: onay ile personelin güncellemesi ve yöneticinin doğrudan silmesi aynı anda kilitlenmez", async () => {
    const id = await timer();
    const a = await ask(users.ayse, id);
    const [approve, edit] = await raceOnRequest(
      URL!,
      a.row.id,
      () => review(users.ali, a.row.id, a.row.version, "approve"),
      () => core.proposeKaraokeDelete(db, users.ayse, { id, message: "Yine de silinsin", clientKey: key() }, at(12)),
    );
    assert.equal(approve.status, "fulfilled");
    // Sayaç onayla silindi: güncelleme temiz bir hatayla düşer
    assert.equal(edit.status, "rejected");
    assert.equal(await sessionOf(id), undefined);

    const id2 = await timer();
    const b = await ask(users.ayse, id2);
    const [approve2, removed] = await raceOnRequest(
      URL!,
      b.row.id,
      () => review(users.ali, b.row.id, b.row.version, "approve"),
      () => core.removeKaraokeTimerCore(db, users.veli, id2, at(40)),
    );
    assert.equal(approve2.status, "fulfilled");
    assert.equal(removed.status, "rejected", "sayaç onayla silinmişti");
    assert.equal((await requestOf(b.row.id)).status, "approved");
  });

  test("bitir ve geri aç işlem geçmişine yazılır; geri aç kimin bitirdiğini yazar; iptal ve süresi dolmuş oturum açılmaz", async () => {
    const id = await timer({ source: "site", externalId: `krk3-${tag}`, customerName: "Selin", createdBy: null, paymentStatus: "paid" });
    // 30. dakikada erken bitirme
    const ended = await core.endKaraokeCore(db, users.ayse, id, at(30));
    assert.ok(ended);
    const row = await sessionOf(id);
    assert.equal(row.endedBy, "Ayşe");
    assert.equal(row.endedAt?.getTime(), at(30).getTime());
    let [log] = await logsOf(users.ayse);
    assert.equal(log.action, "Karaoke oturumu bitirildi");
    assert.equal(log.detail, "Selin · 14 Mar 21:00–23:00 · bitirildi 21:30 (1 saat 30 dk erken)");
    // Başka cihazda ikinci basış bir şey yapmaz (iz de yazmaz)
    const endsOf = async (who: Who) => (await logsOf(who)).filter((l) => l.action === "Karaoke oturumu bitirildi").length;
    const endsBefore = await endsOf(users.mehmet);
    assert.equal(await core.endKaraokeCore(db, users.mehmet, id, at(31)), null);
    assert.equal(await endsOf(users.mehmet), endsBefore);

    // Geri aç: önce kimin bitirdiği okunur ve yazılır, sonra temizlenir
    assert.ok(await core.reopenKaraokeCore(db, users.mehmet, id, at(35)));
    const open = await sessionOf(id);
    assert.equal(open.endedAt, null);
    assert.equal(open.endedBy, null);
    [log] = await logsOf(users.mehmet);
    assert.equal(log.action, "Karaoke oturumu yeniden açıldı");
    assert.equal(log.detail, "Selin · 14 Mar 21:00–23:00 · Ayşe bitirmişti (21:30)");
    // Açık oturumu yeniden açmak bir şey yapmaz
    assert.equal(await core.reopenKaraokeCore(db, users.mehmet, id, at(36)), null);

    // Süre dolunca "Haber verdim"
    await core.endKaraokeCore(db, users.ayse, id, at(127));
    [log] = await logsOf(users.ayse);
    assert.equal(log.detail, "Selin · 14 Mar 21:00–23:00 · süre dolunca haber verildi 23:07");
    // Süresi dolmuş oturum geri açılmaz (alarm çalardı)
    await refused(core.reopenKaraokeCore(db, users.ayse, id, at(130)), KARAOKE_REQUEST_TEXT.pastReopen);
    assert.ok((await sessionOf(id)).endedAt, "bitti işareti kalır");

    // İptal edilmiş rezervasyon geri açılmaz (bitti işareti ve kimin bitirdiği kalır)
    const cancelled = await timer({ source: "site", externalId: `krk4-${tag}`, status: "cancelled", endedAt: at(10), endedBy: "Ayşe" });
    await refused(core.reopenKaraokeCore(db, users.mehmet, cancelled, at(20)), KARAOKE_REQUEST_TEXT.cancelledReopen);
    assert.equal((await sessionOf(cancelled)).endedBy, "Ayşe");
    const refunded = await timer({ source: "site", externalId: `krk5-${tag}`, paymentStatus: "refunded", endedAt: at(10), endedBy: "Ayşe" });
    await refused(core.reopenKaraokeCore(db, users.mehmet, refunded, at(20)), KARAOKE_REQUEST_TEXT.cancelledReopen);
    await refused(core.reopenKaraokeCore(db, users.mehmet, 2_000_000_000, at(20)), "Oturum bulunamadı");
  });

  test("okuyucular: bar ekranının satırı ve personelin zili yük, neden ve tutar taşımaz; Onaylar kartı sayacın bugünkü hâliyle", async () => {
    const id = await timer();
    const a = await ask(users.ayse, id);
    // Bar ekranı: kim istedi, hangi sayaç
    const asks = (await reads.pendingKaraokeAsks()).filter((x) => x.requestId === a.row.id);
    assert.deepEqual(asks, [{ sessionId: id, requestId: a.row.id, by: "Ayşe", byId: users.ayse.id }]);
    // Onaylar kartı: istekten sonra uzatıldı ve bitirildi
    await db.update(s.karaokeSessions).set({ extraMinutes: 30 }).where(eq(s.karaokeSessions.id, id));
    await core.endKaraokeCore(db, users.mehmet, id, at(60));
    const card = (await reads.loadKaraokeRequestQueue(at(70))).find((c) => c.id === a.row.id);
    assert.ok(card);
    assert.equal(card.gone, false);
    assert.equal(card.name, `Deniz ${tag}`);
    assert.equal(card.when, "14 Mar 21:00–23:30");
    assert.equal(card.openedText, "Ayşe açtı · 21:00");
    assert.equal(card.stateText, "Bitti 22:00 (Mehmet)");
    assert.deepEqual(card.changed, ["İstekten sonra 30 dk uzatıldı", "İstekten sonra bitirildi (Mehmet)"]);
    assert.equal(card.message, "Yanlışlıkla iki kez açıldı");
    const summary = await reads.pendingKaraokeSummary();
    assert.ok(summary.count >= 1);
    // Personelin zili: sonuç ve not, yalnız zamanlar
    await review(users.ali, a.row.id, a.row.version, "reject", "Oda kullanıldı");
    const mine = (await reads.myKaraokeRequests(users.ayse.id, at(70))).find((r) => r.id === a.row.id);
    assert.deepEqual(mine && { status: mine.status, when: mine.when, note: mine.reviewNote }, { status: "rejected", when: "14 Mar 21:00–23:00", note: "Oda kullanıldı" });
    const staffSurface = JSON.stringify({ asks: await reads.pendingKaraokeAsks(), mine: await reads.myKaraokeRequests(users.ayse.id, at(70)) });
    assertNoCostKeys(staffSurface, "karaoke istekleri");
    assert.doesNotMatch(staffSurface, /payload|message|totalMinor|₺/);
    // Kartı kapanan istek kuyruktan çıkar
    assert.equal((await reads.loadKaraokeRequestQueue(at(70))).some((c) => c.id === a.row.id), false);
    assert.equal((await db.select().from(s.staffRequests).where(and(eq(s.staffRequests.id, a.row.id), eq(s.staffRequests.status, "pending")))).length, 0);
  });
});
