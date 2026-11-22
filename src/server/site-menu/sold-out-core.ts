import "server-only";

import { and, count, eq, gte, inArray, sql } from "drizzle-orm";

import type { PushFailure } from "@/lib/site-menu/push";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { linkStatus } from "@/lib/site-menu/slot";
import {
  capRefusal,
  pickRow,
  reopenRefusal,
  siteFailureText,
  SOLD_OUT_ACTIONS,
  SOLD_OUT_TEXT,
  STAFF_TOGGLE_LIMIT,
  staffSoldOutCount,
  toggleRefusal,
  type SoldOutRecord,
  type SoldOutRow,
} from "@/lib/site-menu/sold-out";
import { logActivity } from "@/server/actions/log";
import { toSoldOutItem } from "@/server/data/menu-status";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { UserError } from "@/server/user-error";

import { applyPushed, pushSaleChange, type PushOutcome, type SaleRow } from "./push";
import { lockSoldOut, readMarkers, saveSoldOut } from "./sold-out-store";
import { fetchSiteMenu, linkColumns, readSiteSnapshot, SiteRequestError } from "./sync";

/**
 * Tükendi / Satışa aç / Kapalı tut (dalga 10 §2.1; kurallar src/lib/site-menu/sold-out.ts, docs/SITE-MENU.md ›
 * Personel: Tükendi / Satışa aç). Eylemler src/server/actions/menu-status.ts; bu çekirdek `"use server"` değildir,
 * veritabanı testi (tests/tukendi-db.test.ts) sitenin sahte ucuyla doğrudan çalıştırır.
 *
 * Yazım her zaman panel → site yolundan (pushSaleChange: önce site, site 2xx verince applyPushed). Panelde yalnız
 * `showOnMenu` yazılır; fiyat ve "Menüde aktif" hiç yazılmaz. Kartın kaydı yalnız sitenin bu yazımla kapattığı kaleme
 * yazılır: kapatmadan hemen önce sitenin canlı listesine bakılır ve yanıtın damgası o andakinden farklı, isteğin
 * başından da yeni olmalı. Sitenin "değişmedi" yanıtı eski damgayla döner (sahip sitede ya da yönetici ürün kartından
 * az önce kapatmışsa onunki): o zaman kayıt yazılmaz ve "zaten tükendi" denir. Satışa açma da canlı listeye bakar
 * (kopya eski olabilir). Dönüşte yalnız değişti mi, metin ve ad: fiyat yok.
 *
 * Aynı kalemdeki Tükendi, Satışa aç ve Kapalı tut sırayla koşar (withItemLock): personelin "Satışa aç"ı yöneticinin
 * aynı anda verdiği "Kapalı tut"u ezmesin, ikisi de öbürünün sonucunu görsün.
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };
type Row = SaleRow & SoldOutRow;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface SoldOutResult {
  changed: boolean;
  message: string;
  name: string;
}

const slotFirst = (r: Pick<Row, "siteMenuSlot">) => (r.siteMenuSlot === "M" ? 0 : 1);

/** Kalemin bağlı satırları (yazım için satış alanlarıyla; dışarı çıkmaz) ve bağlantılarının durumu */
async function itemRows(tx: Tx, id: string, item: SiteMenuItem | undefined): Promise<Row[]> {
  const rows = await tx.select(linkColumns).from(s.products).where(eq(s.products.siteMenuId, id));
  return rows
    .flatMap((r): Row[] => (r.siteMenuId && (r.siteMenuSlot === "M" || r.siteMenuSlot === "L") ? [{ ...r, siteMenuId: r.siteMenuId, siteMenuSlot: r.siteMenuSlot, link: linkStatus(item, r.siteMenuSlot) }] : []))
    .sort((a, b) => slotFirst(a) - slotFirst(b));
}

/** "(M, L)" ya da tek boyda boş */
function sizesText(rows: readonly Row[]): string {
  const sizes = rows.filter((r) => r.link === "ok" && r.active && r.size !== "Tek").map((r) => r.size);
  return sizes.length ? ` (${sizes.join(", ")})` : "";
}

/**
 * Siteye yazım; bağlantıyla ilgili hatalarda metnin sonuna "Yöneticiye haber verin." `live`: kalemin az önce okunan
 * canlı hâli (sitenin `expect`'i kopyadan değil ondan kurulur: kopya eski olabilir)
 */
async function sitePush(
  tx: Tx,
  me: Actor,
  before: SaleRow,
  desired: { price: number; active: boolean; showOnMenu: boolean },
  consequence: string,
  live?: SiteMenuItem,
): Promise<PushOutcome> {
  try {
    return await pushSaleChange(me, before, desired, consequence, tx, { live });
  } catch (e) {
    if (e instanceof UserError) throw new UserError(siteFailureText(e.message, e.cause as PushFailure | undefined, me.role, { consequence }));
    throw e;
  }
}

/**
 * Kalemin sitedeki canlı hâli (kopya eski olabilir); sitede yoksa undefined. Okuma hatasının ayrıntısı (anahtar adı,
 * imza) yalnız yöneticiye; personel sabit metni görür (E-64)
 */
async function liveItem(me: Actor, secret: string, id: string, consequence: string): Promise<SiteMenuItem | undefined> {
  try {
    return (await fetchSiteMenu(secret)).items.find((i) => i.id === id);
  } catch (e) {
    if (e instanceof SiteRequestError) throw new UserError(siteFailureText(`${e.message}; ${consequence}.`, e.failure, me.role, { consequence, read: true }));
    throw e;
  }
}

/** Postgres'in hata kodu (drizzle `cause`'a sarar) */
const pgCode = (e: unknown) => (e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

/** Kalemin kilidini en çok bu kadar bekler; aşan "Az önce değişti" der (kilidi tutan siteye en çok iki istek atar) */
const ITEM_LOCK_WAIT = "10s";

/**
 * Aynı kalemde tek işlem: kalem başına danışma kilidi, işlem boyunca (siteye istek de kilit altında). Bütün okuma ve
 * yazımlar bu işlemin bağlantısından: kilidi tutan istek havuzdan ikinci bir bağlantı beklemez. Kilit hep ilk alınır,
 * menü kilidi ve Tükenenler kaydı ondan sonra; bu kilidi başka yol almaz, kilitlenme döngüsü olmaz.
 */
async function withItemLock<T>(id: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${ITEM_LOCK_WAIT}'`));
    try {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tukendi:${id}`}))`);
    } catch (e) {
      if (pgCode(e) === "55P03") throw new UserError(SOLD_OUT_TEXT.tooSoon);
      throw e;
    }
    // Menü ve kayıt kilitleri eskisi gibi süresiz beklenir
    await tx.execute(sql`set local lock_timeout to default`);
    return fn(tx);
  });
}

/** Personelin son 10 dakikadaki Tükendi / Satışa açıldı işlemleri (İşlem geçmişinden) */
async function recentCalls(tx: Tx, userId: number, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(s.activityLog)
    .where(
      and(
        eq(s.activityLog.userId, userId),
        inArray(s.activityLog.action, [SOLD_OUT_ACTIONS.close, SOLD_OUT_ACTIONS.open]),
        gte(s.activityLog.at, new Date(now.getTime() - STAFF_TOGGLE_LIMIT.windowMs)),
      ),
    );
  return row?.n ?? 0;
}

interface Context {
  id: string;
  name: string;
  rows: Row[];
  /** Son listenin kopyasındaki kalem */
  snap: SiteMenuItem;
  snapshotItems: SiteMenuItem[];
  record: SoldOutRecord;
}

async function context(tx: Tx, id: string): Promise<Context> {
  // Kalemin kilidi altında: aynı kalemdeki önceki işlemin kaydı ve kopyası (ikisi aynı işlemde yazılır) görülür
  const record = await readMarkers(tx);
  const snapshot = await readSiteSnapshot(tx);
  const snap = snapshot.items.find((i) => i.id === id);
  const rows = await itemRows(tx, id, snap);
  if (!snap || !rows.length) throw new UserError(SOLD_OUT_TEXT.missing);
  const name = rows.find((r) => r.active)?.name ?? rows[0].name;
  return { id, name, rows, snap, snapshotItems: snapshot.items, record };
}

/** Personelin hız sınırı; yalnız siteye gidecek bir işlemden önce ("zaten tükendi" gibi yanıtlar sayılmaz) */
async function assertPace(tx: Tx, me: Actor, c: Context, now: Date): Promise<void> {
  if (me.role === "admin") return;
  const refusal = toggleRefusal({ calls: await recentCalls(tx, me.id, now), lastAt: c.record.toggles[c.id], now: now.getTime() });
  if (refusal) throw new UserError(refusal);
}

/**
 * Sitede "Tükendi" yapar (M ve L birlikte). `marker`: kartın kaydı yazılsın mı (Kapalı tut yazmaz); yazılacaksa
 * `liveBefore` kalemin istekten hemen önceki canlı hâli. Dönüş: kayıt yazıldı mı, aynı damgayla kaydı başka biri az
 * önce yazdı mı ve tavan yüzünden kayıt yazılamadı mı.
 */
async function closeOnSite(
  tx: Tx,
  me: Actor,
  c: Context,
  now: Date,
  opts: { marker: false } | { marker: true; liveBefore: SiteMenuItem | undefined },
): Promise<{ written: boolean; already: boolean; capHit: boolean }> {
  const row = pickRow(c.rows, c.snap);
  if (!row) throw new UserError(SOLD_OUT_TEXT.noRow);
  if (opts.marker) {
    const refusal = capRefusal(me.role, staffSoldOutCount(c.record.items, c.snapshotItems));
    if (refusal) throw new UserError(refusal);
  }
  const startedAt = Date.now();
  // Kopya "Satışta" diyor: panel satırı geride kalmış olsa da yazım gitsin (önceki durum sitedeki gibi)
  const before: SaleRow = { ...row, showOnMenu: true };
  const desired = { price: row.price, active: row.active, showOnMenu: false };
  const push = await sitePush(tx, me, before, desired, "ürün tükendi yapılmadı", opts.marker ? opts.liveBefore : undefined);
  // Site bu yazımla kapattı: az önce canlı listede satıştaydı, yanıtın damgası o andakinden farklı ve isteğin
  // başından yeni ("değişmedi" yanıtı eski damgayla, başkasının az önceki kapatmasınınkiyle döner)
  const ours = opts.marker && !!opts.liveBefore?.isActive && push.kind === "pushed" && push.item?.updatedAt !== opts.liveBefore.updatedAt;
  const siteStamp = ours && push.kind === "pushed" && push.visibility && push.item && !push.item.isActive && Date.parse(push.item.updatedAt) >= startedAt - 5000 ? push.item.updatedAt : null;
  let written = false;
  let already = false;
  let capHit = false;
  try {
    const sale = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : desired;
    await tx.update(s.products).set({ showOnMenu: sale.showOnMenu, updatedAt: now }).where(eq(s.products.id, row.id));
    const record = await lockSoldOut(tx);
    record.toggles[c.id] = now.toISOString();
    if (!opts.marker) delete record.items[c.id];
    else if (siteStamp && record.items[c.id]?.siteUpdatedAt === siteStamp) {
      // Kaydı aynı damgayla başkası yazmış (sitenin ikinci yanıtı ilkinin damgasıyla döner): kayıt onunki kalır
      already = true;
    } else if (siteStamp) {
      // Ortak tavan kilit altında yeniden: kopya bu yazımla yenilendi
      const items = (await readSiteSnapshot(tx)).items.map(toSoldOutItem);
      if (capRefusal(me.role, staffSoldOutCount(record.items, items))) capHit = true;
      else {
        record.items[c.id] = { byId: me.id, by: me.name, byRole: me.role, at: now.toISOString(), siteUpdatedAt: siteStamp };
        written = true;
      }
    }
    await saveSoldOut(tx, record, now);
  } catch (e) {
    console.error("[tukendi] panel yazımı", e);
    throw new UserError(SOLD_OUT_TEXT.closedNotSaved);
  }
  return { written, already, capHit };
}

/** İşlem geçmişine yazılacak satır: kalemin kilidi bırakıldıktan sonra yazılır */
type Logged = { action: string; detail: string } | null;

/** Siparişler ekranının "Tükendi" / "Satışa aç" dokunuşu */
export async function setSoldOutCore(me: Actor, input: { siteMenuId: string; soldOut: boolean }, now: Date = new Date()): Promise<SoldOutResult> {
  const secret = siteLinkSecret();
  if (!secret) throw new UserError(SOLD_OUT_TEXT.off);
  const { result, log } = await withItemLock(input.siteMenuId, (tx) => (input.soldOut ? closeLocked(tx, me, input.siteMenuId, secret, now) : openLocked(tx, me, input.siteMenuId, secret, now)));
  if (log) await logActivity(me, log.action, log.detail);
  return result;
}

const WHERE = "laffogato.net, uygulama ve QR menü";

/** "Tükendi" (kalemin kilidi altında) */
async function closeLocked(tx: Tx, me: Actor, id: string, secret: string, now: Date): Promise<{ result: SoldOutResult; log: Logged }> {
  const c = await context(tx, id);
  // Kopyada zaten kapalı: siteye gidilmez (kartla kapatıldıysa "zaten tükendi", değilse yönetici açar)
  if (!c.snap.isActive) {
    const card = c.record.items[c.id]?.siteUpdatedAt === c.snap.updatedAt;
    return { log: null, result: { changed: false, name: c.name, message: card ? `${c.name} zaten tükendi` : `${c.name} zaten tükendi (sitede kapatılmış; yönetici açar)` } };
  }
  await assertPace(tx, me, c, now);
  // Kopya eski olabilir (sahip sitede, yönetici ürün kartından az önce kapatmış): kaydın koşulu canlı hâle bakar
  const liveBefore = await liveItem(me, secret, c.id, "ürün tükendi yapılmadı");
  const r = await closeOnSite(tx, me, c, now, { marker: true, liveBefore });
  const log = r.written || r.capHit ? { action: SOLD_OUT_ACTIONS.close, detail: `${c.name}${sizesText(c.rows)} · ${WHERE}${r.capHit ? " (Tükenenler listesi dolu)" : ""}` } : null;
  if (r.written) return { log, result: { changed: true, name: c.name, message: `${c.name} tükendi` } };
  if (r.already) return { log, result: { changed: false, name: c.name, message: `${c.name} zaten tükendi` } };
  if (r.capHit) return { log, result: { changed: false, name: c.name, message: `${c.name} sitede tükendi oldu ama Tükenenler listesi dolu; satışa yönetici açar.` } };
  return { log, result: { changed: false, name: c.name, message: `${c.name} zaten tükendi (sitede kapatılmış; yönetici açar)` } };
}

/** "Satışa aç" (kalemin kilidi altında: yöneticinin aynı anda verdiği "Kapalı tut" ya önce biter ve kaydı düşürür, ya sonra gelir ve yeniden kapatır) */
async function openLocked(tx: Tx, me: Actor, id: string, secret: string, now: Date): Promise<{ result: SoldOutResult; log: Logged }> {
  const c = await context(tx, id);
  // Satışa aç: sitenin canlı listesi (kopya eski olabilir; sahibin sitede yaptığı değişiklik damgayı değiştirir)
  await assertPace(tx, me, c, now);
  const live = await liveItem(me, secret, c.id, "ürün satışa açılmadı");
  if (live?.isActive) {
    const record = await lockSoldOut(tx);
    delete record.items[c.id];
    await saveSoldOut(tx, record, now);
    return { log: null, result: { changed: false, name: c.name, message: `${c.name} zaten satışta` } };
  }
  const refusal = reopenRefusal({ role: me.role, rows: c.rows, marker: c.record.items[c.id] ?? null, live: live ? toSoldOutItem(live) : null });
  if (refusal) throw new UserError(refusal);
  const row = pickRow(c.rows, c.snap);
  if (!row) throw new UserError(SOLD_OUT_TEXT.noRow);
  const before: SaleRow = { ...row, showOnMenu: false };
  const desired = { price: row.price, active: true, showOnMenu: true };
  const push = await sitePush(tx, me, before, desired, "ürün satışa açılmadı", live);
  try {
    const sale = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : desired;
    await tx.update(s.products).set({ showOnMenu: sale.showOnMenu, updatedAt: now }).where(eq(s.products.id, row.id));
    const record = await lockSoldOut(tx);
    delete record.items[c.id];
    record.toggles[c.id] = now.toISOString();
    await saveSoldOut(tx, record, now);
  } catch (e) {
    console.error("[tukendi] panel yazımı", e);
    throw new UserError(SOLD_OUT_TEXT.openedNotSaved);
  }
  return { log: { action: SOLD_OUT_ACTIONS.open, detail: `${c.name}${sizesText(c.rows)} · ${WHERE}` }, result: { changed: true, name: c.name, message: `${c.name} satışta` } };
}

/**
 * Yönetici: "Kapalı tut". Kalem satıştaysa önce kapatır (kayıtsız), ardından kartın kaydını düşürür: artık yalnız
 * yönetici açar. Kalemin kilidi altında: personelin aynı anda açtığı kalem önce açılır, sonra burada yeniden kapanır.
 */
export async function holdSoldOutCore(me: Actor, input: { siteMenuId: string }, now: Date = new Date()): Promise<SoldOutResult> {
  if (!siteLinkSecret()) throw new UserError(SOLD_OUT_TEXT.off);
  const c = await withItemLock(input.siteMenuId, async (tx) => {
    const c = await context(tx, input.siteMenuId);
    if (c.snap.isActive) await closeOnSite(tx, me, c, now, { marker: false });
    else {
      const record = await lockSoldOut(tx);
      delete record.items[c.id];
      await saveSoldOut(tx, record, now);
    }
    return c;
  });
  await logActivity(me, SOLD_OUT_ACTIONS.hold, `${c.name}${sizesText(c.rows)} · satışa yalnız yönetici açar`);
  return { changed: true, name: c.name, message: `${c.name} kapalı tutuluyor; satışa yalnız yönetici açar` };
}
