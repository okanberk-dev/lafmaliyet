import "server-only";

import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import type { Model } from "@/lib/calc/engine";
import { qtyLabel } from "@/lib/reorder/message";
import {
  DRAFT_KIND,
  DRAFT_NUDGE_MS,
  draftClean,
  draftFlags,
  draftSubject,
  firstCountAt,
  isDraftExpired,
  parseDraftPayload,
  staffDraftView,
  type DraftFlag,
  type StaffDraftView,
} from "@/lib/reorder/draft";
import { isMobile } from "@/lib/reorder/message";
import { addDays } from "@/lib/reminders";
import { businessDate } from "@/lib/cash-report";
import type { CurrentUser } from "@/server/auth/dal";
import { appUrl } from "@/server/auth/tokens";
import { loadCashSettings } from "@/server/data/cash-reports";
import { getDb, schema as s } from "@/server/db";
import type { DraftDeps, DraftPlanLine, SupplierPlan } from "@/server/order-drafts/core";

import { loadReorderData, orderSnapshot, type ReorderData } from "./reorder";

/*
 * Personelin mal siparişi taslağının yükleyicileri (docs/MAL-SIPARISI.md › Personelin sipariş taslağı; plan §2.4):
 *
 * - draftDeps: çekirdeğin (src/server/order-drafts/core.ts) tedarikçi planı ve sipariş kopyası, sipariş listesinin
 *   hesabından (loadReorderData; maliyet modeli sunucuda kalır).
 * - loadDraftSheet: personelin /panel/hizli-sayim/siparis sayfası. Beyaz liste: ad, sipariş adı ve birimi, eldeki,
 *   öneri, durum. Fiyat, tutar, hedef, günlük kullanım, numara, mesaj ve WhatsApp bağlantısı yok
 *   (tests/mal-siparisi-taslak.test.ts, tests/personel-sizinti-ops.test.ts).
 * - loadDraftQueue: yöneticinin Onaylar › Mal siparişi kartları (fiyatlı: tahmini tutar burada).
 * - staffApprovedDrafts, draftBellFacts: Bugün ve zil için hafif, modelsiz sorgular.
 */

const f1 = (base: number, f: number) => Math.round((base / (f > 0 ? f : 1)) * 10) / 10;

/** Kalemlerin son sayımının gününden önceki son hızlı sayımı (beklenen eldeki ve "Geçen" için; son 60 gün) */
async function prevCounts(ids: number[], before: Map<number, string>, today: string): Promise<Map<number, { base: number; day: string }>> {
  const out = new Map<number, { base: number; day: string }>();
  if (!ids.length) return out;
  const q = s.quickCounts;
  const rows = await getDb()
    .select({ id: q.ingredientId, day: q.day, qty: q.qty, factor: q.factor })
    .from(q)
    .where(and(inArray(q.ingredientId, ids), gte(q.day, addDays(today, -60))))
    .orderBy(desc(q.day));
  for (const r of rows) {
    const last = before.get(r.id);
    if (!last || r.day >= last || out.has(r.id)) continue;
    out.set(r.id, { base: r.qty * r.factor, day: r.day });
  }
  return out;
}

/** Sipariş listesinin hesabından tedarikçi planları (anahtar → plan) */
async function plansFrom(d: ReorderData): Promise<Map<string, SupplierPlan>> {
  const live = d.items.filter((x) => x.plan && x.plan.supplierKey);
  const before = new Map(live.flatMap((x) => (x.plan!.onHand ? [[x.ing.id, x.plan!.onHand.day] as [number, string]] : [])));
  const prev = await prevCounts(
    live.map((x) => x.ing.id),
    before,
    d.today,
  );
  const out = new Map<string, SupplierPlan>();
  for (const g of d.groups) {
    if (!g.supplierKey) continue;
    const sup = d.index.byKey.get(g.supplierKey);
    if (!sup) continue;
    const lines: DraftPlanLine[] = g.lines.map((p) => ({
      ingredientId: p.ingredientId,
      name: p.name,
      orderName: p.orderName,
      unit: p.orderUnit,
      unitSize: p.orderUnitSize,
      countUnit: p.countUnit,
      countFactor: p.countFactor,
      suggested: p.status === "sayilmadi" || p.status === "hedef-yok" ? null : p.packs,
      onHand: p.onHand ? { base: p.onHand.base, at: p.onHand.at, day: p.onHand.day } : null,
      prevCount: prev.get(p.ingredientId) ?? null,
      perDay: p.perDay,
    }));
    const lastSentAt =
      d.orders
        .filter((o) => o.status !== "cancelled" && o.supplierKey === g.supplierKey)
        .map((o) => o.sentAt)
        .sort()
        .at(-1) ?? null;
    out.set(g.supplierKey, { supplier: { key: sup.key, name: sup.name, cardId: sup.card?.id ?? null, phone: sup.card?.phone ?? null }, signature: d.settings.signature, lines, lastSentAt });
  }
  return out;
}

/** Çekirdeğin bağımlılıkları: bir eylem boyunca tek hesap (loadReorderData bir kez) */
export function draftDeps(): DraftDeps {
  let data: Promise<ReorderData> | null = null;
  let plans: Promise<Map<string, SupplierPlan>> | null = null;
  const load = () => (data ??= loadReorderData());
  return {
    plan: async (key) => (await (plans ??= load().then(plansFrom))).get(key) ?? null,
    snapshot: (key, wanted) => orderSnapshot(key, wanted),
  };
}

// ---------------------------------------------------------------- Personelin sayfası (/panel/hizli-sayim/siparis)

/** Personelin satırı (fiyatsız): eldeki sayım biriminde, öneri sipariş biriminde */
export interface DraftSheetLine {
  ingredientId: number;
  name: string;
  orderName: string;
  unit: string;
  countUnit: string | null;
  onHand: number | null;
  /** Son sayımın günü */
  countedDay: string | null;
  /** "Az kaldı" */
  low: boolean;
  /** Önerilen birim (0: yeterli, sayılmadı ya da hedef yok) */
  suggested: number;
}

export type DraftCardState = "no-phone" | "stale" | "sent" | "pending" | "approved" | "done" | "form";

export interface DraftSheetCard {
  key: string;
  slug: string;
  name: string;
  /** Teslim süresi (gün) */
  lead: number;
  state: DraftCardState;
  /** Son sayımdan sonra gönderilen siparişin anı (state "sent") */
  sentAt: string | null;
  /** Formun satırları (state "form"); önerisi olanlar önce */
  lines: DraftSheetLine[];
  /** Canlı ya da gönderilmiş taslak (pending, approved, done) ya da formun üstündeki son sonuç (reddedildi, süresi doldu, geri alındı, kapandı) */
  draft: StaffDraftView | null;
  /** "Yöneticiye WhatsApp'tan haber ver" görünsün (onay bekliyor, 30 dakika geçti ya da hiçbir yönetici cihazına ulaşılamadı) */
  nudge: boolean;
}

export interface DraftSheet {
  day: string;
  cards: DraftSheetCard[];
  /** Kasa raporunun WhatsApp numarası ("Yöneticiye haber ver"; boşsa sohbet seçici) ve Onaylar'ın adresi */
  adminWhatsapp: string | null;
  approvalsUrl: string;
}

/** Bir tedarikçinin son taslakları (son 3 gün ve canlılar), en yenisi önce */
async function recentDrafts(subjects: string[], now: Date) {
  if (!subjects.length) return [];
  const r = s.staffRequests;
  return getDb()
    .select({
      id: r.id,
      subject: r.subject,
      status: r.status,
      version: r.version,
      payload: r.payload,
      result: r.result,
      requestedBy: r.requestedBy,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      reviewedByName: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      reviewNote: r.reviewNote,
      resultId: r.resultId,
      expiresAt: r.expiresAt,
    })
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), inArray(r.subject, subjects), or(sql`${r.status} in ('pending', 'approved')`, gte(r.updatedAt, new Date(now.getTime() - 3 * 86_400_000)))))
    .orderBy(desc(r.createdAt), desc(r.id));
}

/**
 * Personelin taslak sayfası: tedarikçi başına bir kart, durumuyla. Maliyet modeli sunucuda kurulur (öneri sipariş
 * listesindekiyle aynı), sayfaya yalnız beyaz listedeki alanlar gider.
 */
export async function loadDraftSheet(user: Pick<CurrentUser, "id">): Promise<DraftSheet> {
  const now = new Date();
  const [d, cash] = await Promise.all([loadReorderData(), loadCashSettings()]);
  const day = businessDate(now);
  const yesterday = addDays(day, -1);
  const groups = d.groups.filter((g) => g.supplierKey && d.index.byKey.has(g.supplierKey));
  const drafts = await recentDrafts(
    groups.map((g) => draftSubject(g.supplierKey!)),
    now,
  );
  const orderIds = drafts.flatMap((x) => (x.resultId !== null && (x.status === "done" || x.status === "cancelled") ? [x.resultId] : []));
  const orders = orderIds.length
    ? await getDb()
        .select({ id: s.supplierOrders.id, sentAt: s.supplierOrders.sentAt, sentBy: s.supplierOrders.sentBy, sentByName: s.supplierOrders.sentByName, status: s.supplierOrders.status, receivedAt: s.supplierOrders.receivedAt, invoiceId: s.supplierOrders.invoiceId })
        .from(s.supplierOrders)
        .where(inArray(s.supplierOrders.id, orderIds))
    : [];
  const orderBy = new Map(orders.map((o) => [o.id, o]));
  const cards: DraftSheetCard[] = groups.map((g) => {
    const sup = d.index.byKey.get(g.supplierKey!)!;
    const latest = drafts.find((x) => x.subject === draftSubject(g.supplierKey!)) ?? null;
    const sent = latest?.resultId != null ? (orderBy.get(latest.resultId) ?? null) : null;
    const view = latest
      ? staffDraftView(latest, user, now, sent ? { sentAt: sent.sentAt, sentBy: sent.sentBy, sentByName: sent.sentByName, open: sent.status === "open" && sent.receivedAt === null && sent.invoiceId === null } : null)
      : null;
    const lastCount = g.lines.map((l) => l.onHand?.at ?? "").sort().at(-1) || null;
    const sentAt =
      d.orders
        .filter((o) => o.status !== "cancelled" && o.supplierKey === g.supplierKey && lastCount !== null && Date.parse(o.sentAt) > Date.parse(lastCount))
        .map((o) => o.sentAt)
        .sort()
        .at(-1) ?? null;
    const stale = !g.lines.some((l) => l.onHand && l.onHand.day >= yesterday) || g.lines.some((l) => l.packs > 0 && (!l.onHand || l.onHand.day < yesterday));
    let state: DraftCardState;
    if (!isMobile(sup.card?.phone)) state = "no-phone";
    else if (view?.status === "pending") state = "pending";
    else if (view?.status === "approved") state = "approved";
    else if (view?.status === "done" && sentAt) state = "done";
    else if (sentAt) state = "sent";
    else if (stale) state = "stale";
    else state = "form";
    const lines: DraftSheetLine[] =
      state === "form"
        ? [...g.lines]
            .sort((a, b) => Number(b.packs > 0) - Number(a.packs > 0))
            .map((l) => ({
              ingredientId: l.ingredientId,
              name: l.name,
              orderName: l.orderName,
              unit: l.orderUnit,
              countUnit: l.countUnit,
              onHand: l.onHand ? f1(l.onHand.base, l.countFactor) : null,
              countedDay: l.onHand?.day ?? null,
              low: l.critical,
              suggested: l.packs,
            }))
        : [];
    // Formun üstünde yalnız son sonucun notu (yeniden hazırlamaya götürür); geri çekilen gösterilmez
    const shownDraft = state === "no-phone" ? null : view && (state !== "form" || ["rejected", "expired", "cancelled", "superseded"].includes(view.status)) ? view : null;
    const nudge = state === "pending" && view !== null && view.mine && (!view.notified || now.getTime() - Date.parse(view.createdAt) >= DRAFT_NUDGE_MS);
    return { key: sup.key, slug: sup.slug, name: sup.name, lead: g.lead, state, sentAt, lines, draft: shownDraft, nudge };
  });
  // Önerisi olan ve işi süren kartlar önce
  const rank = (c: DraftSheetCard) => (["approved", "pending", "done"].includes(c.state) ? 0 : c.state === "form" && c.lines.some((l) => l.suggested > 0) ? 1 : c.state === "form" ? 2 : 3);
  cards.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "tr"));
  return { day, cards, adminWhatsapp: cash.whatsapp, approvalsUrl: `${appUrl()}/panel/onaylar` };
}

// ---------------------------------------------------------------- Yöneticinin kuyruğu (Onaylar › Mal siparişi)

export interface DraftQueueLine {
  ingredientId: number;
  name: string;
  orderName: string;
  qty: number;
  unit: string;
  countUnit: string | null;
  suggested: number | null;
  onHand: number | null;
  prevCount: number | null;
  prevCountDay: string | null;
  expectedOnHand: number | null;
  flags: DraftFlag[];
  /** 1 sipariş biriminin tahmini tutarı (KDV hariç, son fatura fiyatıyla); bilinmiyorsa null */
  packPrice: number | null;
  priceEstimated: boolean;
  /** Kalem hâlâ bu tedarikçinin listesinde (değilse onaylanamaz) */
  inPlan: boolean;
}

export interface DraftQueueCard {
  id: number;
  version: number;
  title: string;
  supplier: string;
  requestedByName: string;
  createdAt: string;
  /** Satırların son sayımı: an ve kişi */
  countAt: string | null;
  countBy: string | null;
  lines: DraftQueueLine[];
  /** Yoldaki (açık, gelmemiş) siparişler: "26.10 siparişi: Süt 2 koli" */
  onOrder: string[];
  /** Taslaktan sonra bu kalemlerden biri yeniden sayıldı */
  newerCount: boolean;
  supplierNote: string | null;
  signature: string;
  /** Hiç işaret yok ve her satır önerinin aynısı ("İşaretsizleri onayla") */
  clean: boolean;
  /** Mesajın onay numarası satırı için */
  ref: number;
}

/** Bekleyen taslaklar, en eskisi önce; fiyatlar ve işaretlerle (yönetici). Model isteğin bir kez yüklediğinden */
export async function loadDraftQueue(model: Model, now = new Date()): Promise<DraftQueueCard[]> {
  const r = s.staffRequests;
  const rows = await getDb()
    .select()
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), eq(r.status, "pending")))
    .orderBy(asc(r.createdAt), asc(r.id));
  const live = rows.filter((x) => !isDraftExpired(x, now));
  if (!live.length) return [];
  const d = await loadReorderData(model);
  const byIng = new Map(d.items.map((x) => [x.ing.id, x]));
  return live.flatMap((row) => {
    const p = parseDraftPayload(row.payload);
    if (!p) return [];
    const first = firstCountAt(p.lines);
    const lines: DraftQueueLine[] = p.lines.map((l) => {
      const it = byIng.get(l.ingredientId);
      const plan = it?.plan ?? null;
      return {
        ingredientId: l.ingredientId,
        name: l.name,
        orderName: l.orderName,
        qty: l.qty,
        unit: l.unit,
        countUnit: l.countUnit,
        suggested: l.suggested,
        onHand: l.onHand,
        prevCount: l.prevCount,
        prevCountDay: l.prevCountDay,
        expectedOnHand: l.expectedOnHand,
        flags: draftFlags(l, { draftAt: row.createdAt, firstCountAt: first }),
        packPrice: plan?.expectedUnitPrice != null ? plan.expectedUnitPrice * l.unitSize : null,
        priceEstimated: plan?.priceEstimated ?? false,
        inPlan: plan?.supplierKey === p.supplierKey,
      };
    });
    const counts = p.lines.flatMap((l) => (l.countedAt ? [l.countedAt] : [])).sort();
    const newest = byIng.size ? p.lines.map((l) => byIng.get(l.ingredientId)?.plan?.onHand ?? null).filter((x) => x !== null) : [];
    const lastOnHand = [...newest].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
    const newerCount = p.lines.some((l) => {
      const oh = byIng.get(l.ingredientId)?.plan?.onHand;
      return oh && l.countedAt && Date.parse(oh.at) > Date.parse(l.countedAt);
    });
    const onOrder = d.orders
      .filter((o) => o.status === "open" && o.receivedAt === null && o.supplierKey === p.supplierKey)
      .map((o) => `${o.sentDay.slice(8, 10)}.${o.sentDay.slice(5, 7)} siparişi: ${o.lines.map((l) => `${l.orderName} ${qtyLabel(l.qty, l.unit)}`).join(", ")}`);
    return [
      {
        id: row.id,
        version: row.version,
        title: row.title,
        supplier: p.supplier,
        requestedByName: row.requestedByName,
        createdAt: row.createdAt.toISOString(),
        countAt: counts.at(-1) ?? null,
        countBy: lastOnHand?.by ?? null,
        lines,
        onOrder,
        newerCount,
        supplierNote: p.supplierNote,
        signature: d.settings.signature,
        clean: draftClean(p, row.createdAt),
        ref: row.id,
      },
    ];
  });
}

// ---------------------------------------------------------------- Bugün, zil, Mal siparişi rozetleri (modelsiz)

/** Personel (Bugün `mal-taslak`): onaylanmış, süresi dolmamış, gönderilmeyi bekleyen taslaklar; yalnız tedarikçi adı */
export async function staffApprovedDrafts(now = new Date()): Promise<{ id: number; supplier: string }[]> {
  const r = s.staffRequests;
  const rows = await getDb()
    .select({ id: r.id, payload: r.payload, status: r.status, expiresAt: r.expiresAt })
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), eq(r.status, "approved")))
    .orderBy(asc(r.reviewedAt), asc(r.id));
  return rows.flatMap((x) => {
    const p = parseDraftPayload(x.payload);
    return p && !isDraftExpired(x, now) ? [{ id: x.id, supplier: p.supplier }] : [];
  });
}

/** Zilin taslak satırlarının olguları (yük okunmaz; başlık, isteyen, durum, karar veren) */
export async function draftBellRows(o: { userId?: number; since: Date }) {
  const r = s.staffRequests;
  return getDb()
    .select({
      id: r.id,
      title: r.title,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: r.requestedByName,
      reviewedByName: r.reviewedByName,
      reviewNote: r.reviewNote,
      bumpedAt: r.bumpedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      expiresAt: r.expiresAt,
      subject: r.subject,
    })
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), o.userId !== undefined ? eq(r.requestedBy, o.userId) : undefined, or(eq(r.status, "pending"), eq(r.status, "approved"), gte(r.updatedAt, o.since))))
    .orderBy(desc(r.updatedAt), desc(r.id))
    .limit(30);
}

/** Mal siparişi listesi: tedarikçinin canlı taslağı ("Taslak onayda · Ayşe" / "Taslak onaylandı · Ayşe") */
export async function liveDraftBadges(now = new Date()): Promise<Map<string, { status: "pending" | "approved"; by: string; id: number }>> {
  const r = s.staffRequests;
  const rows = await getDb()
    .select({ id: r.id, subject: r.subject, status: r.status, requestedByName: r.requestedByName, expiresAt: r.expiresAt })
    .from(r)
    .where(and(eq(r.kind, DRAFT_KIND), sql`${r.status} in ('pending', 'approved')`));
  const out = new Map<string, { status: "pending" | "approved"; by: string; id: number }>();
  for (const x of rows) {
    if (isDraftExpired(x, now) || (x.status !== "pending" && x.status !== "approved")) continue;
    out.set(x.subject.replace(/^tedarikci:/, ""), { status: x.status, by: x.requestedByName, id: x.id });
  }
  return out;
}

/** Gönderilenler: personelin gönderdiği siparişlerin onaylayanı (istek kimliği `taslak:<id>`) */
export async function draftApprovers(requestIds: number[]): Promise<Map<number, string | null>> {
  if (!requestIds.length) return new Map();
  const rows = await getDb().select({ id: s.staffRequests.id, by: s.staffRequests.reviewedByName }).from(s.staffRequests).where(inArray(s.staffRequests.id, requestIds));
  return new Map(rows.map((r) => [r.id, r.by]));
}

