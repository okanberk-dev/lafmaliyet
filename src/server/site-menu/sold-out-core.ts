import "server-only";

import { and, count, eq, gte, inArray } from "drizzle-orm";

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
 * Yazım her zaman panel → site yolundan (pushSaleChange: önce site, site 2xx verince tek işlemde applyPushed). Panelde
 * yalnız `showOnMenu` yazılır; fiyat ve "Menüde aktif" hiç yazılmaz. Kartın kaydı yalnız sitenin bu yazımla
 * kapattığı kaleme yazılır (yanıtın damgası isteğin başından yeni): sitenin "değişmedi" yanıtı eski damgayla döner,
 * o zaman kayıt yazılmaz ve "zaten tükendi" denir. Satışa açma sitenin canlı listesine bakar (kopya eski olabilir).
 * Dönüşte yalnız değişti mi, metin ve ad: fiyat yok.
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };
type Row = SaleRow & SoldOutRow;

export interface SoldOutResult {
  changed: boolean;
  message: string;
  name: string;
}

const slotFirst = (r: Pick<Row, "siteMenuSlot">) => (r.siteMenuSlot === "M" ? 0 : 1);

/** Kalemin bağlı satırları (yazım için satış alanlarıyla; dışarı çıkmaz) ve bağlantılarının durumu */
async function itemRows(id: string, item: SiteMenuItem | undefined): Promise<Row[]> {
  const rows = await getDb().select(linkColumns).from(s.products).where(eq(s.products.siteMenuId, id));
  return rows
    .flatMap((r): Row[] => (r.siteMenuId && (r.siteMenuSlot === "M" || r.siteMenuSlot === "L") ? [{ ...r, siteMenuId: r.siteMenuId, siteMenuSlot: r.siteMenuSlot, link: linkStatus(item, r.siteMenuSlot) }] : []))
    .sort((a, b) => slotFirst(a) - slotFirst(b));
}

/** "(M, L)" ya da tek boyda boş */
function sizesText(rows: readonly Row[]): string {
  const sizes = rows.filter((r) => r.link === "ok" && r.active && r.size !== "Tek").map((r) => r.size);
  return sizes.length ? ` (${sizes.join(", ")})` : "";
}

/** Siteye yazım; bağlantıyla ilgili hatalarda metnin sonuna "Yöneticiye haber verin." */
async function sitePush(me: Actor, before: SaleRow, desired: { price: number; active: boolean; showOnMenu: boolean }, consequence: string): Promise<PushOutcome> {
  try {
    return await pushSaleChange(me, before, desired, consequence);
  } catch (e) {
    if (e instanceof UserError) throw new UserError(siteFailureText(e.message, e.cause as PushFailure | undefined));
    throw e;
  }
}

/** Personelin son 10 dakikadaki Tükendi / Satışa açıldı işlemleri (İşlem geçmişinden) */
async function recentCalls(userId: number, now: Date): Promise<number> {
  const [row] = await getDb()
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

async function context(id: string): Promise<Context> {
  // Önce kayıt, sonra kopya (ikisi aynı işlemde yazılır): öteki baristanın yazımı arada biterse kopya onu gösterir ve
  // "zaten tükendi" denir; kayıt yeni, kopya eski kalıp "Az önce değişti" denmez
  const record = await readMarkers();
  const snapshot = await readSiteSnapshot();
  const snap = snapshot.items.find((i) => i.id === id);
  const rows = await itemRows(id, snap);
  if (!snap || !rows.length) throw new UserError(SOLD_OUT_TEXT.missing);
  const name = rows.find((r) => r.active)?.name ?? rows[0].name;
  return { id, name, rows, snap, snapshotItems: snapshot.items, record };
}

/** Personelin hız sınırı; yalnız siteye gidecek bir işlemden önce ("zaten tükendi" gibi yanıtlar sayılmaz) */
async function assertPace(me: Actor, c: Context, now: Date): Promise<void> {
  if (me.role === "admin") return;
  const refusal = toggleRefusal({ calls: await recentCalls(me.id, now), lastAt: c.record.toggles[c.id], now: now.getTime() });
  if (refusal) throw new UserError(refusal);
}

/**
 * Sitede "Tükendi" yapar (M ve L birlikte). `marker`: kartın kaydı yazılsın mı (Kapalı tut yazmaz). Dönüş: kayıt
 * yazıldı mı, aynı damgayla kaydı başka biri az önce yazdı mı (iki barista aynı anda: ikincisi "zaten tükendi" der)
 * ve tavan yüzünden kayıt yazılamadı mı.
 */
async function closeOnSite(me: Actor, c: Context, now: Date, marker: boolean): Promise<{ written: boolean; already: boolean; capHit: boolean }> {
  const row = pickRow(c.rows, c.snap);
  if (!row) throw new UserError(SOLD_OUT_TEXT.noRow);
  if (marker) {
    const refusal = capRefusal(me.role, staffSoldOutCount(c.record.items, c.snapshotItems));
    if (refusal) throw new UserError(refusal);
  }
  const startedAt = Date.now();
  // Kopya "Satışta" diyor: panel satırı geride kalmış olsa da yazım gitsin (önceki durum sitedeki gibi)
  const before: SaleRow = { ...row, showOnMenu: true };
  const desired = { price: row.price, active: row.active, showOnMenu: false };
  const push = await sitePush(me, before, desired, "ürün tükendi yapılmadı");
  // Site bu yazımla kapattı: yanıtın damgası isteğin başından yeni ("değişmedi" yanıtı eski damgayla döner)
  const siteStamp = push.kind === "pushed" && push.visibility && push.item && !push.item.isActive && Date.parse(push.item.updatedAt) >= startedAt - 5000 ? push.item.updatedAt : null;
  let written = false;
  let already = false;
  let capHit = false;
  try {
    await getDb().transaction(async (tx) => {
      const sale = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : desired;
      await tx.update(s.products).set({ showOnMenu: sale.showOnMenu, updatedAt: now }).where(eq(s.products.id, row.id));
      const record = await lockSoldOut(tx);
      record.toggles[c.id] = now.toISOString();
      if (!marker) delete record.items[c.id];
      else if (siteStamp && record.items[c.id]?.siteUpdatedAt === siteStamp) {
        // Öteki barista aynı anda kapattı (sitenin ikinci yanıtı ilkinin damgasıyla döner): kayıt onunki kalır
        already = true;
      } else if (siteStamp) {
        // Ortak tavan kilit altında yeniden (iki barista aynı anda): kopya bu yazımla yenilendi
        const items = (await readSiteSnapshot(tx)).items.map(toSoldOutItem);
        if (capRefusal(me.role, staffSoldOutCount(record.items, items))) capHit = true;
        else {
          record.items[c.id] = { byId: me.id, by: me.name, byRole: me.role, at: now.toISOString(), siteUpdatedAt: siteStamp };
          written = true;
        }
      }
      await saveSoldOut(tx, record, now);
    });
  } catch (e) {
    console.error("[tukendi] panel yazımı", e);
    throw new UserError(SOLD_OUT_TEXT.closedNotSaved);
  }
  return { written, already, capHit };
}

/** Bar ekranının "Tükendi" / "Satışa aç" dokunuşu */
export async function setSoldOutCore(me: Actor, input: { siteMenuId: string; soldOut: boolean }, now: Date = new Date()): Promise<SoldOutResult> {
  const secret = siteLinkSecret();
  if (!secret) throw new UserError(SOLD_OUT_TEXT.off);
  const c = await context(input.siteMenuId);
  const where = "laffogato.net, uygulama ve QR menü";
  if (input.soldOut) {
    // Kopyada zaten kapalı: siteye gidilmez (kartla kapatıldıysa "zaten tükendi", değilse yönetici açar)
    if (!c.snap.isActive) {
      const card = c.record.items[c.id]?.siteUpdatedAt === c.snap.updatedAt;
      return { changed: false, name: c.name, message: card ? `${c.name} zaten tükendi` : `${c.name} zaten tükendi (sitede kapatılmış; yönetici açar)` };
    }
    await assertPace(me, c, now);
    const r = await closeOnSite(me, c, now, true);
    if (r.written || r.capHit) await logActivity(me, SOLD_OUT_ACTIONS.close, `${c.name}${sizesText(c.rows)} · ${where}${r.capHit ? " (Tükenenler listesi dolu)" : ""}`);
    if (r.written) return { changed: true, name: c.name, message: `${c.name} tükendi` };
    if (r.already) return { changed: false, name: c.name, message: `${c.name} zaten tükendi` };
    if (r.capHit) return { changed: false, name: c.name, message: `${c.name} sitede tükendi oldu ama Tükenenler listesi dolu; satışa yönetici açar.` };
    return { changed: false, name: c.name, message: `${c.name} zaten tükendi (sitede kapatılmış; yönetici açar)` };
  }

  // Satışa aç: sitenin canlı listesi (kopya eski olabilir; sahibin sitede yaptığı değişiklik damgayı değiştirir)
  await assertPace(me, c, now);
  let live: SiteMenuItem | undefined;
  try {
    live = (await fetchSiteMenu(secret)).items.find((i) => i.id === c.id);
  } catch (e) {
    if (e instanceof SiteRequestError) throw new UserError(siteFailureText(`${e.message}; ürün satışa açılmadı.`, e.failure));
    throw e;
  }
  if (live?.isActive) {
    await getDb().transaction(async (tx) => {
      const record = await lockSoldOut(tx);
      delete record.items[c.id];
      await saveSoldOut(tx, record, now);
    });
    return { changed: false, name: c.name, message: `${c.name} zaten satışta` };
  }
  const refusal = reopenRefusal({ role: me.role, rows: c.rows, marker: c.record.items[c.id] ?? null, live: live ? toSoldOutItem(live) : null });
  if (refusal) throw new UserError(refusal);
  const row = pickRow(c.rows, c.snap);
  if (!row) throw new UserError(SOLD_OUT_TEXT.noRow);
  const before: SaleRow = { ...row, showOnMenu: false };
  const desired = { price: row.price, active: true, showOnMenu: true };
  const push = await sitePush(me, before, desired, "ürün satışa açılmadı");
  try {
    await getDb().transaction(async (tx) => {
      const sale = push.kind === "pushed" ? await applyPushed(tx, push, before, desired, now) : desired;
      await tx.update(s.products).set({ showOnMenu: sale.showOnMenu, updatedAt: now }).where(eq(s.products.id, row.id));
      const record = await lockSoldOut(tx);
      delete record.items[c.id];
      record.toggles[c.id] = now.toISOString();
      await saveSoldOut(tx, record, now);
    });
  } catch (e) {
    console.error("[tukendi] panel yazımı", e);
    throw new UserError(SOLD_OUT_TEXT.openedNotSaved);
  }
  await logActivity(me, SOLD_OUT_ACTIONS.open, `${c.name}${sizesText(c.rows)} · ${where}`);
  return { changed: true, name: c.name, message: `${c.name} satışta` };
}

/**
 * Yönetici: "Kapalı tut". Kalem satıştaysa önce kapatır (kayıtsız), ardından kartın kaydını düşürür: artık yalnız
 * yönetici açar.
 */
export async function holdSoldOutCore(me: Actor, input: { siteMenuId: string }, now: Date = new Date()): Promise<SoldOutResult> {
  if (!siteLinkSecret()) throw new UserError(SOLD_OUT_TEXT.off);
  const c = await context(input.siteMenuId);
  if (c.snap.isActive) {
    await closeOnSite(me, c, now, false);
  } else {
    await getDb().transaction(async (tx) => {
      const record = await lockSoldOut(tx);
      delete record.items[c.id];
      await saveSoldOut(tx, record, now);
    });
  }
  await logActivity(me, SOLD_OUT_ACTIONS.hold, `${c.name}${sizesText(c.rows)} · satışa yalnız yönetici açar`);
  return { changed: true, name: c.name, message: `${c.name} kapalı tutuluyor; satışa yalnız yönetici açar` };
}
