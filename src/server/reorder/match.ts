import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";

import { dateTR } from "@/lib/format";
import { LINKABLE_CATEGORIES } from "@/lib/invoice-linking";
import {
  checkSummary,
  deliveryCheck,
  isCandidate,
  MATCH_DAYS,
  needsAutoExpire,
  OPEN_ORDER_DAYS,
  pickInvoice,
  sameCheck,
  shouldAutoClose,
  type InvoiceCandidate,
  type InvoiceLineLite,
  type LinkLite,
} from "@/lib/reorder/delivery";
import type { OrderLite } from "@/lib/reorder/types";
import { addDays, todayTR } from "@/lib/reminders";
import { logActivity } from "@/server/actions/log";
import { loadSupplierIndex, toOrderLite } from "@/server/data/reorder";
import { getDb, schema as s } from "@/server/db";

export interface ReorderMatchResult {
  /** Bu çalışmada faturası bulunan sipariş */
  matched: number;
  /** Karşılaştırması yazılan (yeni ya da değişen) sipariş */
  checked: number;
  /** "Faturayla tuttu" ile kendiliğinden kapanan */
  closed: number;
  /** 45 günde faturası gelmediği için kapanan */
  expired: number;
}

const ZERO: ReorderMatchResult = { matched: 0, checked: 0, closed: 0, expired: 0 };

/** Benzersizlik ihlali (aynı fatura iki siparişe): aynı anda çalışan başka bir eşleştirme önce davrandı */
const isUnique = (e: unknown) => ((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505";

/**
 * Teslim kontrolü (docs/MAL-SIPARISI.md › Teslim kontrolü): son 60 günün açık mal siparişleri tedarikçinin Paraşüt
 * faturasıyla eşleşir (pickInvoice) ve kalem kalem karşılaştırılır (deliveryCheck). Eşitlemenin içinde, ürün
 * bağlantılarından sonra çalışır; ürün bağlantısı değişince de (yeni bağlantı "bağlı değil"i gerçek karşılaştırmaya
 * çevirir). Açık sipariş yoksa tek sorgu.
 *
 * - Fatura elle seçildiyse ya da eşleşme elle kaldırıldıysa (manualMatch) sipariş yalnız yeniden karşılaştırılır; elle
 *   seçilen fatura silinirse (Paraşüt'te iptal) eşleşme yeniden aranır.
 * - Bağlı fatura artık aday değilse (kategorisi kafe dışına ya da mal dışına geçti, kalemleri okununca siparişle hiç
 *   örtüşmedi) eşleşme kalkar, sonraki çalışma yeniden arar; silinen fatura yabancı anahtarla zaten boşalır.
 * - Karşılaştırma yalnız değişince yazılır; kalemler okunup her şey tuttuysa sipariş "Faturayla tuttu" ile kapanır.
 * - Faturası 45 günde gelmeyen açık sipariş kapanır.
 * Her yazım `status = 'open'` koşuluyla: aynı anda elle kapatılan siparişe dokunulmaz. `until` (epoch ms) geçince
 * kalan siparişler sonraki çalışmaya kalır.
 */
export async function matchSupplierOrders(opts: { orderIds?: number[]; until?: number } = {}): Promise<ReorderMatchResult> {
  const db = getDb();
  const o = s.supplierOrders;
  const since = new Date(Date.now() - OPEN_ORDER_DAYS * 86_400_000);
  const rows = await db
    .select()
    .from(o)
    .where(and(eq(o.status, "open"), opts.orderIds ? inArray(o.id, opts.orderIds.length ? opts.orderIds : [-1]) : gte(o.sentAt, since)))
    .orderBy(asc(o.sentAt), asc(o.id));
  if (!rows.length) return { ...ZERO };
  const orders = rows.map(toOrderLite);
  const now = new Date();
  const today = todayTR(now);
  const timeUp = () => opts.until !== undefined && Date.now() > opts.until;

  const index = await loadSupplierIndex();
  const supplierOf = (name: string, tax?: string | null) => index.resolve(name, tax)?.key ?? `ad:${name}`;
  const firstDay = orders.reduce((a, x) => (x.sentDay < a ? x.sentDay : a), orders[0].sentDay);
  const lastDay = orders.reduce((a, x) => (x.sentDay > a ? x.sentDay : a), orders[0].sentDay);
  const linkedIds = orders.map((x) => x.invoiceId).filter((id): id is number => id !== null);
  const inv = s.invoices;
  const invoiceCols = { id: inv.id, date: inv.date, supplier: inv.supplier, supplierTaxNumber: inv.supplierTaxNumber, invoiceNo: inv.invoiceNo, payable: inv.payable, category: inv.category };
  const [windowInvoices, linkedInvoices, takenRows, linkRows] = await Promise.all([
    db
      .select(invoiceCols)
      .from(inv)
      .where(and(gte(inv.date, firstDay), lte(inv.date, addDays(lastDay, MATCH_DAYS)), inArray(inv.category, LINKABLE_CATEGORIES))),
    linkedIds.length ? db.select(invoiceCols).from(inv).where(inArray(inv.id, linkedIds)) : Promise.resolve([]),
    db.select({ id: o.id, invoiceId: o.invoiceId }).from(o).where(isNotNull(o.invoiceId)),
    db
      .select({ productKey: s.parasutProductLinks.productKey, ingredientId: s.parasutProductLinks.ingredientId, factor: s.parasutProductLinks.factor, name: s.ingredients.name, unit: s.ingredients.unit })
      .from(s.parasutProductLinks)
      .innerJoin(s.ingredients, eq(s.ingredients.id, s.parasutProductLinks.ingredientId)),
  ]);
  const invoices = new Map([...windowInvoices, ...linkedInvoices].map((x) => [x.id, x]));
  const lineRows = invoices.size
    ? await db
        .select({
          invoiceId: s.parasutBillLines.invoiceId,
          productKey: s.parasutBillLines.productKey,
          productName: s.parasutBillLines.productName,
          quantity: s.parasutBillLines.quantity,
          unit: s.parasutBillLines.unit,
          netTotal: s.parasutBillLines.netTotal,
        })
        .from(s.parasutBillLines)
        .where(inArray(s.parasutBillLines.invoiceId, [...invoices.keys()]))
    : [];
  const links = new Map<string, LinkLite>(linkRows.map((l) => [l.productKey, { ingredientId: l.ingredientId, factor: l.factor, name: l.name, baseUnit: l.unit }]));
  const linesOf = new Map<number, InvoiceLineLite[]>();
  for (const l of lineRows) linesOf.set(l.invoiceId, [...(linesOf.get(l.invoiceId) ?? []), l]);
  const candidate = (id: number): InvoiceCandidate | null => {
    const x = invoices.get(id);
    if (!x) return null;
    const lines = linesOf.get(id) ?? [];
    return {
      id,
      date: x.date,
      supplierId: supplierOf(x.supplier, x.supplierTaxNumber),
      invoiceNo: x.invoiceNo,
      payable: x.payable,
      hasLines: lines.length > 0,
      ingredientIds: new Set(lines.flatMap((l) => (links.has(l.productKey) ? [links.get(l.productKey)!.ingredientId] : []))),
    };
  };
  const candidates = windowInvoices.map((x) => candidate(x.id)!);
  const taken = new Set(takenRows.map((r) => r.invoiceId!));
  const orderKey = (x: OrderLite) => ({ sentDay: x.sentDay, expectedOn: x.expectedOn, supplierId: supplierOf(x.supplier), ingredientIds: new Set(x.lines.map((l) => l.ingredientId)) });
  const result = { ...ZERO };
  const where = (id: number) => and(eq(o.id, id), eq(o.status, "open"));

  for (const order of orders) {
    if (timeUp()) break;
    let fresh = false;
    // Faturası silinen (Paraşüt'te iptal; yabancı anahtar boşalttı) siparişin eski karşılaştırması da kalkar, faturanın
    // yazdığı "geldi" de. Elle seçilen fatura silindiyse eşitleme yeniden arar ("Fatura yok" seçiminde karşılaştırma
    // zaten boştur, ona dokunulmaz)
    if (order.invoiceId === null && order.check !== null) {
      await db
        .update(o)
        .set({ deliveryCheck: null, checkedAt: null, manualMatch: false, ...(order.receivedByName === "Fatura" ? { receivedAt: null, receivedByName: null } : {}), updatedAt: now })
        .where(where(order.id));
      if (order.receivedByName === "Fatura") order.receivedAt = null;
      order.check = null;
      order.manualMatch = false;
    }
    // Eşleşme: faturası yoksa ve elle dokunulmadıysa
    if (order.invoiceId === null && !order.manualMatch) {
      const pick = pickInvoice(orderKey(order), candidates, taken, today);
      if (pick) {
        try {
          const [set] = await db
            .update(o)
            .set({ invoiceId: pick.id, updatedAt: now })
            .where(and(where(order.id), isNull(o.invoiceId)))
            .returning({ id: o.id });
          if (set) {
            order.invoiceId = pick.id;
            taken.add(pick.id);
            result.matched++;
            fresh = true;
          }
        } catch (e) {
          if (!isUnique(e)) throw e;
          taken.add(pick.id);
        }
      }
    } else if (order.invoiceId !== null && !order.manualMatch) {
      // Bağlı fatura hâlâ aday mı (kategori değişti, kalemleri siparişle örtüşmedi)
      const c = candidate(order.invoiceId);
      if (!c || !isCandidate(orderKey(order), c, today) || !LINKABLE_CATEGORIES.includes(invoices.get(order.invoiceId)?.category ?? "")) {
        // Faturanın yazdığı "geldi" de geri alınır (elle "Geldi" kalır)
        await db
          .update(o)
          .set({ invoiceId: null, deliveryCheck: null, checkedAt: null, ...(order.receivedByName === "Fatura" ? { receivedAt: null, receivedByName: null } : {}), updatedAt: now })
          .where(where(order.id));
        taken.delete(order.invoiceId);
        order.invoiceId = null;
        order.check = null;
        continue;
      }
    }

    if (order.invoiceId !== null) {
      const x = invoices.get(order.invoiceId);
      if (!x) continue;
      const check = deliveryCheck(order, { id: x.id, invoiceNo: x.invoiceNo, date: x.date, payable: x.payable, lines: linesOf.get(x.id) ?? [] }, links, now);
      if (sameCheck(order.check, check)) continue;
      const close = shouldAutoClose(check);
      await db
        .update(o)
        .set({
          deliveryCheck: check,
          checkedAt: now,
          // Mal geldi: faturanın günü (öğlen, Türkiye); elle işaretlendiyse o kalır
          ...(order.receivedAt ? {} : { receivedAt: new Date(`${x.date}T12:00:00+03:00`), receivedByName: "Fatura" }),
          ...(close ? { status: "closed" as const, closedAt: now, closedByName: "Sistem", closeNote: "Faturayla tuttu" } : {}),
          updatedAt: now,
        })
        .where(where(order.id));
      result.checked++;
      if (close) result.closed++;
      if (fresh) await logActivity(null, "Teslim kontrolü", `${order.supplier} ${dateTR(order.sentDay).slice(0, 5)} siparişi ↔ ${x.invoiceNo ?? "numarasız fatura"}: ${checkSummary(check)}`);
      continue;
    }

    if (needsAutoExpire(order, today)) {
      const [done] = await db
        .update(o)
        .set({ status: "closed", closedAt: now, closedByName: "Sistem", closeNote: "45 günde fatura gelmedi", updatedAt: now })
        .where(and(where(order.id), isNull(o.invoiceId)))
        .returning({ id: o.id });
      if (done) result.expired++;
    }
  }
  return result;
}

/** Eşitleme özetindeki parça: "2 mal siparişi faturayla karşılaştırıldı · 1 kendiliğinden kapandı" (yoksa boş) */
export function matchSummary(r: ReorderMatchResult | null): string {
  if (!r || !r.checked) return "";
  return `${r.checked} mal siparişi faturayla karşılaştırıldı${r.closed ? ` · ${r.closed} kendiliğinden kapandı` : ""}`;
}
