/**
 * Ödemeler listesi cari hesapla (saf; tests/cari-odemeler.test.ts, cari-sabit.test.ts): hatırlatıcılar, ödenmemiş
 * faturalar ve faturasız borçlar (elle girilen cari kayıtlar) aynı listede; tedarikçinin hesabındaki sayılmamış ödeme
 * okuma anında vade sırasıyla düşülür (netCredit). Tamamen karşılanan kalem listeden çıkar ("Hesaptaki ödemeyle
 * karşılananlar"), kısmen karşılananın tutarı azalır (`credited`). Veritabanına hiçbir şey yazılmaz.
 *
 * Hiç cari kaydı yokken (hesapta para yok, borç yok, ipucu yok) sonuç upcomingItems + laterInvoiceItems ile birebir
 * aynıdır.
 */
import {
  byDueThenTitle,
  cariItem,
  invoiceItem,
  upcomingItems,
  type CariDebtRow,
  type ReminderRow,
  type UnpaidInvoiceRow,
  type UpcomingHint,
  type UpcomingItem,
} from "../reminders";
import { netCredit, type NetItem } from "./account";
import { coveredByAllocations, EPS } from "./balance";

export interface UpcomingCariInput {
  reminders: ReminderRow[];
  /** Ödenmemiş faturalar; `cardId` faturanın cari kartı (kartsızda null) */
  invoices: (UnpaidInvoiceRow & { cardId?: number | null })[];
  /** Kalanı olan bağsız faturasız borçlar */
  debts?: (CariDebtRow & { cardId: number })[];
  /** Kart → hesaptaki sayılmamış ödeme */
  credit?: ReadonlyMap<number, number>;
  /** Kalemin (ref) ipucu ve sessizliği */
  hints?: ReadonlyMap<string, { quiet: "link" | "kasa"; hint: UpcomingHint }>;
  /** Kartın sayfası (faturasız borcun "Düzenle"si) */
  hrefOf?: (cardId: number) => string | undefined;
}

export interface UpcomingCari {
  /** Listenin kalemleri (gecikenler ve ufuk içindekiler), vade sırasıyla */
  items: UpcomingItem[];
  /** Vadesi ufuktan sonra olan faturalar ve faturasız borçlar (takvim) */
  later: UpcomingItem[];
  /** Hesaptaki ödemeyle tamamen karşılananlar (tutar mahsuptan önceki kalan; `credited` aynı) */
  covered: UpcomingItem[];
}

const netKind = (i: UpcomingItem): NetItem["kind"] => {
  switch (i.source) {
    case "invoice":
      return "invoice";
    case "cari":
      return "debt";
    case "reminder":
      throw new Error("Hatırlatıcı mahsup edilmez");
  }
};

export function upcomingWithCari(
  input: UpcomingCariInput,
  today: string,
  opts: {
    horizonDays?: number;
    invoiceDaysBefore?: number;
    invoiceTermDays?: number;
  } = {},
): UpcomingCari {
  const horizonDays = opts.horizonDays ?? 45;
  const invoiceDaysBefore = opts.invoiceDaysBefore ?? 3;
  const invoiceTermDays = opts.invoiceTermDays ?? 30;
  const reminders = upcomingItems(input.reminders, [], today, {
    horizonDays,
    invoiceDaysBefore,
    invoiceTermDays,
  });
  const dates = new Map<string, string>();
  const payables: UpcomingItem[] = [];
  for (const inv of input.invoices) {
    // Takip öncesi kısım ve panelde sayılanlar tamamen karşılıyorsa (kalan 0) kalem yok; ödendi işareti yeniden
    // dengelemede yazılır (Genel bakış'ın açık fatura kuralıyla aynı)
    if (coveredByAllocations({ ...inv, unpaid: true })) continue;
    const item = invoiceItem(inv, today, invoiceDaysBefore, invoiceTermDays);
    if (inv.cardId !== null && inv.cardId !== undefined)
      item.supplierId = inv.cardId;
    dates.set(item.ref, inv.date);
    payables.push(item);
  }
  for (const d of input.debts ?? []) {
    const item = cariItem(d, today, invoiceDaysBefore, invoiceTermDays);
    item.supplierId = d.cardId;
    const href = input.hrefOf?.(d.cardId);
    if (href) item.href = href;
    dates.set(item.ref, d.date);
    payables.push(item);
  }
  for (const item of payables) {
    const h = input.hints?.get(item.ref);
    if (h) {
      item.quiet = h.quiet;
      item.hint = h.hint;
    }
  }

  // Okuma anında mahsup: kartın hesabındaki para kartın kalemlerinden vade sırasıyla düşülür
  const covered: UpcomingItem[] = [];
  const drop = new Set<string>();
  for (const [cardId, credit] of input.credit ?? []) {
    if (!(credit > EPS)) continue;
    const own = payables.filter((i) => i.supplierId === cardId);
    if (!own.length) continue;
    const byRef = new Map(own.map((i) => [i.ref, i]));
    const net = netCredit(
      own.map((i) => ({
        kind: netKind(i),
        id: i.sourceId,
        date: dates.get(i.ref) ?? i.dueDate,
        due: i.dueDate,
        balance: i.amount ?? 0,
        quiet: i.quiet,
        ref: i.ref,
      })),
      credit,
    );
    for (const n of net.items) {
      if (!(n.credited > 0)) continue;
      const item = byRef.get(n.ref)!;
      item.amount = n.net;
      item.credited = n.credited;
    }
    for (const n of net.covered) {
      const item = byRef.get(n.ref)!;
      drop.add(n.ref);
      covered.push({ ...item, credited: n.credited });
    }
  }

  const live = payables.filter((i) => !drop.has(i.ref));
  const items = [
    ...reminders,
    ...live.filter((i) => i.daysLeft <= horizonDays),
  ].sort(byDueThenTitle);
  const later = live
    .filter((i) => i.daysLeft > horizonDays)
    .sort(byDueThenTitle);
  return { items, later, covered: covered.sort(byDueThenTitle) };
}

/** Kalemin mahsup notu: "hesaptaki 99,50 ₺ düşüldü" (ayrıntının sonuna) */
export const creditedNote = (
  credited: number | undefined,
  fmt: (v: number) => string,
) => (credited && credited > EPS ? `hesaptaki ${fmt(credited)} düşüldü` : null);
