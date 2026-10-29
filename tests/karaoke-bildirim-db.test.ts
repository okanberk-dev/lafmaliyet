// Karaoke bildirimi ve misafirin adı (senkron planı P0, KVKK), gerçek Postgres'te ve sitenin sahte ucuyla:
// laffogato.net'e hiç gidilmez, imzalı GET /api/panel/karaoke bellekteki bir siteye yönlenir (imza sahte anahtarla
// doğrulanır), bildirim gönderilmez, yalnız yakalanır.
//
// Sitede yeni rezervasyon → pingle eşitleme: Web Push gövdesinde misafirin adı ve notu yok (kilit ekranı); panelin
// kopyasında ve açık ekranın canlı verisinde ad var, ekrandaki zil satırı (alert-center.tsx'in kurduğu metin) adı
// gösterir. Üçten fazla olayın özet bildiriminde de ad yok.
//
// integration_state'teki karaoke satırlarını (eşitleme durumu, sürüm) başta saklar ve sonda geri yazar; yalnız kendi
// açtığı rezervasyonları siler (kimlik `kr-p0-<pid>-…`). Sahte site `complete: false` döner: eşitleme sitede olmayan
// başka kayıtları silmez.
//
// BAGLANTI_TEST_DATABASE_URL verilmezse atlanır (migration'ları uygulanmış bir yerel veritabanı).
// Çalıştırma: BAGLANTI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost/laffogato_baglanti npx tsx --test tests/karaoke-bildirim-db.test.ts

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { inArray, like } from "drizzle-orm";

import { cancelledBadgeText, eventMessage, sessionEnd, sessionStart, type SiteReservation } from "../src/lib/karaoke/session";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "../src/lib/karaoke/signature";
import type { DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const URL_ = process.env.BAGLANTI_TEST_DATABASE_URL;
const SECRET = "karaoke-bildirim-test-anahtari-gercek-degil-01";
const SITE = "http://site.test";
const PREFIX = `kr-p0-${process.pid}-`;

describe("Karaoke bildirimi: Web Push'ta ad yok, ekranda var (sitenin sahte ucuyla)", { skip: !URL_ && "BAGLANTI_TEST_DATABASE_URL yok" }, () => {
  let db: DB;
  let sync: typeof import("../src/server/karaoke/sync");
  let board: typeof import("../src/server/karaoke/board");
  let closeDb: () => Promise<void>;
  let keys: string[] = [];
  const saved: { key: string; value: unknown }[] = [];
  const realFetch = globalThis.fetch;
  const pushes: { topic: string; msg: { title: string; body: string; kind: string; requireInteraction?: boolean; ring?: boolean } }[] = [];

  // ------------------------------------------------ Sahte site
  const site: { reservations: SiteReservation[] } = { reservations: [] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  async function fakeSite(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== SITE) return realFetch(input, init);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const ok = verifySignature(SECRET, { method: init?.method ?? "GET", url, body: "", timestamp: headers[TIMESTAMP_HEADER] ?? null, signature: headers[SIGNATURE_HEADER] ?? null });
    if (!ok) return json(401, { error: "unauthorized" });
    if (url.pathname !== "/api/panel/karaoke") return json(404, { error: "not_found" });
    return json(200, {
      now: new Date().toISOString(),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      complete: false,
      reservations: site.reservations,
    });
  }

  /** İki saat sonra başlayan, iki saatlik, ödemesiz talep (Türkiye günü ve saatiyle) */
  function reservation(n: number, firstName: string): SiteReservation {
    const start = Math.ceil((Date.now() + 2 * 3_600_000) / 3_600_000) * 3_600_000;
    const tr = new Date(start + 3 * 3_600_000);
    return {
      id: `${PREFIX}${n}`,
      date: tr.toISOString().slice(0, 10),
      startHour: tr.getUTCHours(),
      hours: 2,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 3_600_000).toISOString(),
      guests: 4,
      status: "requested",
      paymentStatus: "none",
      firstName,
      note: "Doğum günü sürprizi",
      totalMinor: 120_000,
      channel: "web",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Sitenin pingi: ping ucunun yaptığı gibi önce kayıt, sonra çekme */
  async function ping() {
    await sync.notePing();
    return sync.syncKaraoke("ping");
  }

  before(async () => {
    process.env.DATABASE_URL = URL_;
    process.env.KARAOKE_SYNC_SECRET = SECRET;
    process.env.LAFFOGATO_URL = SITE;
    globalThis.fetch = fakeSite as typeof fetch;
    // "server-only" Next'in sunucu derlemesi dışında hata fırlatır: test aynı modülleri doğrudan çalıştırır
    const require = createRequire(import.meta.url);
    const stub = (id: string, exports: unknown) => {
      const p = require.resolve(id);
      require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
    };
    stub("server-only", {});
    // Bildirim gönderilmez, yalnız yakalanır (paylaşılan veritabanında gerçek abonelik olabilir)
    stub(require.resolve("../src/server/push/send"), {
      sendPush: async (topic: string, msg: (typeof pushes)[number]["msg"]) => {
        pushes.push({ topic, msg });
        return { sent: 0, failed: 0, removed: 0 };
      },
      vapidPublicKey: async () => null,
    });
    const dbModule = await import("../src/server/db");
    db = dbModule.createDb(URL_!, 4);
    closeDb = () => dbModule.getDb().$client.end();
    sync = await import("../src/server/karaoke/sync");
    board = await import("../src/server/karaoke/board");
    keys = ["karaoke_sync", board.KARAOKE_VERSION_KEY];
    for (const row of await db.select().from(s.integrationState).where(inArray(s.integrationState.key, keys))) saved.push({ key: row.key, value: row.value });
  });

  beforeEach(async () => {
    await db.delete(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}%`));
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, keys));
    site.reservations = [];
    pushes.length = 0;
    // İlk eşitleme geçmişi sessizce alır: bildirim ancak ondan sonra gider
    assert.equal((await sync.syncKaraoke("manual")).status, "ok");
    assert.equal(pushes.length, 0);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    if (!db) return;
    await db.delete(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}%`));
    await db.delete(s.integrationState).where(inArray(s.integrationState.key, keys));
    for (const r of saved) await db.insert(s.integrationState).values({ key: r.key, value: r.value });
    await db.$client.end();
    await closeDb();
  });

  test("yeni rezervasyon: bildirimde ad ve not yok; kopyada, canlı veride ve ekrandaki zil satırında ad var", async () => {
    site.reservations = [reservation(1, "Ayşe")];
    const res = await ping();
    assert.equal(res.status, "ok");
    assert.equal(res.status === "ok" && res.events, 1);

    assert.equal(pushes.length, 1);
    const [push] = pushes;
    assert.equal(push.topic, "karaoke");
    assert.equal(push.msg.title, "Yeni karaoke rezervasyonu");
    assert.match(push.msg.body, /· 4 kişi · onay bekliyor$/);
    assert.doesNotMatch(JSON.stringify(push), /Ayşe|Doğum günü/);
    assert.equal(push.msg.requireInteraction, true);
    assert.equal(push.msg.ring, true);

    // Panelin kopyası adı ve notu tutar (bar ekranı ve liste için)
    const [row] = await db.select().from(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}1`));
    assert.equal(row.customerName, "Ayşe");
    assert.equal(row.note, "Doğum günü sürprizi");
    assert.equal(row.lastEvent, "created");

    // Açık ekranın canlı verisi (personel de) adı taşır; zil satırı alert-center.tsx'in kurduğu metinle adı gösterir
    const { from, to } = board.liveWindow();
    const dto = (await board.loadSessions(from, to, { admin: false })).find((x) => x.externalId === `${PREFIX}1`);
    assert.ok(dto, "canlı pencerede");
    assert.equal(dto.customerName, "Ayşe");
    const ring = eventMessage(dto.lastEvent!, { startsAt: sessionStart(dto), endsAt: sessionEnd(dto), guests: dto.guests, name: dto.customerName, status: dto.status, paymentStatus: dto.paymentStatus }, Date.now());
    assert.equal(ring.title, push.msg.title);
    assert.equal(ring.body, push.msg.body.replace(" · onay bekliyor", " · Ayşe · onay bekliyor"));
  });

  test("üçten fazla olay tek özet bildirim; özette de ad yok", async () => {
    const names = ["Ayşe", "Deniz", "Mert", "Zeynep"];
    site.reservations = names.map((n, i) => reservation(i + 1, n));
    const res = await ping();
    assert.equal(res.status === "ok" && res.events, 4);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].msg.title, "4 karaoke güncellemesi");
    assert.doesNotMatch(JSON.stringify(pushes), /Ayşe|Deniz|Mert|Zeynep|Doğum günü/);
    const rows = await db.select().from(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}%`));
    assert.deepEqual(rows.map((r) => r.customerName).sort(), [...names].sort());
  });

  test("iptal ve saat değişikliği bildiriminde de ad yok", async () => {
    site.reservations = [reservation(1, "Ayşe"), reservation(2, "Deniz")];
    await ping();
    pushes.length = 0;
    const [a, b] = site.reservations;
    const later = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString();
    site.reservations = [
      { ...a, status: "cancelled", updatedAt: new Date().toISOString() },
      { ...b, startsAt: later(b.startsAt), endsAt: later(b.endsAt), updatedAt: new Date().toISOString() },
    ];
    const res = await ping();
    assert.equal(res.status === "ok" && res.events, 2);
    assert.deepEqual(pushes.map((p) => p.msg.title).sort(), ["Karaoke rezervasyonu iptal edildi", "Karaoke rezervasyonunun saati değişti"]);
    assert.doesNotMatch(JSON.stringify(pushes), /Ayşe|Deniz|Doğum günü/);
  });

  test("iptalin iadesi (site 29 Ekim 2026): 'iade yok' yazılır, yeniden satışın iadesi yalnız tutarı değiştirse de eşitlenir; tutar yalnız yöneticiye", async () => {
    const paid = { ...reservation(1, "Ayşe"), status: "confirmed" as const, paymentStatus: "paid" as const };
    site.reservations = [paid];
    await ping();
    // %0 kuralında geç istekle saat satışa açıldı: "refunded" ama hiçbir şey geri gitmedi
    site.reservations = [{ ...paid, status: "cancelled", paymentStatus: "refunded", refundMinor: 0, updatedAt: new Date().toISOString() }];
    await ping();
    const read = async () => (await db.select().from(s.karaokeSessions).where(like(s.karaokeSessions.externalId, `${PREFIX}1`)))[0];
    assert.equal((await read()).refundMinor, 0);
    const { from, to } = board.liveWindow();
    const dto = async (admin: boolean) => (await board.loadSessions(from, to, { admin })).find((x) => x.externalId === `${PREFIX}1`)!;
    const staff = await dto(false);
    assert.equal(staff.refund, "none");
    assert.equal(staff.refundMinor, null, "personel tutarı görmez");
    assert.equal(cancelledBadgeText(staff.paymentStatus, staff.refund), "İptal · iade yok");
    assert.equal((await dto(true)).refundMinor, 0);

    // Saatin biri yeniden satıldı: sitede yalnız tutar ve ödeme durumu değişir, updatedAt aynı kalabilir
    const before = (await read()).updatedAt.getTime();
    site.reservations = [{ ...site.reservations[0], paymentStatus: "refunding", refundMinor: 60_000 }];
    await ping();
    assert.equal((await read()).refundMinor, 60_000);
    assert.ok((await read()).updatedAt.getTime() >= before);
    assert.equal(cancelledBadgeText("refunding", (await dto(false)).refund), "İptal · kısmi iade sürüyor");
    // Yalnız tutar değişse de (ödeme durumu aynı) yazılır
    site.reservations = [{ ...site.reservations[0], refundMinor: 120_000 }];
    await ping();
    assert.equal((await read()).refundMinor, 120_000);
    assert.equal((await dto(false)).refund, "full");

    // Alanı göndermeyen eski site: boş, eski söz
    const { refundMinor: _omit, ...old } = site.reservations[0];
    void _omit;
    site.reservations = [{ ...old, paymentStatus: "refunded" }];
    await ping();
    assert.equal((await read()).refundMinor, null);
    assert.equal(cancelledBadgeText("refunded", (await dto(false)).refund), "İptal · iade edildi");
  });
});
