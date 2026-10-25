/**
 * Ödemeler listesi cari hesapla (saf; tests/cari-odemeler.test.ts, cari-sabit.test.ts): hatırlatıcılar, ödenmemiş
 * faturalar ve faturasız borçlar (elle girilen cari kayıtlar) aynı listede; tedarikçinin hesabındaki sayılmamış ödeme
 * okuma anında vade sırasıyla düşülür (netCredit). Tamamen karşılanan kalem listeden çıkar ("Hesaptaki ödemeyle
 * karşılananlar"), kısmen karşılananın tutarı azalır (`credited`). Veritabanına hiçbir şey yazılmaz.
 *
 * Hiç cari kaydı yokken (hesapta para yok, borç yok, ipucu yok) sonuç upcomingItems + laterInvoiceItems ile birebir
 * aynıdır; kalemin kalanını tutmayan işlenmemiş Kasa satırı yalnız ipucu ekler, sabah e-postası aynı kalır (cariHints).
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
import { dateTR, tl } from "../format";
import { netCredit, type NetItem } from "./account";
import { coveredByAllocations, EPS, openBalance, type BalanceInvoice } from "./balance";
import { linkTolerance, type KasaLine } from "./match";

export interface UpcomingCariInput {
  reminders: ReminderRow[];
  /** Ödenmemiş faturalar; `cardId` faturanın cari kartı (kartsızda null) */
  invoices: (UnpaidInvoiceRow & { cardId?: number | null })[];
  /** Kalanı olan bağsız faturasız borçlar */
  debts?: (CariDebtRow & { cardId: number })[];
  /** Kart → hesaptaki sayılmamış ödeme */
  credit?: ReadonlyMap<number, number>;
  /** Kalemin (ref) ipucu ve sessizliği */
  hints?: ReadonlyMap<string, { quiet?: "link" | "kasa"; hint: UpcomingHint }>;
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
      if (h.quiet) item.quiet = h.quiet;
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

/** Kalemlerin ipuçlarının kaynağı (src/server/data/cari.ts loadCariIndex'in alanları) */
export interface CariHintIndex {
  /** Güçlü fatura adayları (K17), alımların günü ve ne alındığı */
  strong: readonly { cardId: number; invoiceId: number; debtIds: number[]; debts: readonly { date: string; description: string | null }[] }[];
  /** Son 60 günün işlenmemiş, bir kartın adıyla eşleşen Kasa satırları (gün sırasıyla) */
  kasaPending: readonly (KasaLine & { cardId: number })[];
  /** Fatura → faturaya bağlı borçlarda "Ayrı alım" denmiş Teslim satırları */
  kasaApartByInvoice: ReadonlyMap<number, readonly number[]>;
  hrefOf: (cardId: number) => string | undefined;
}

/**
 * Kalemlerin ipuçları: faturasız alımın faturası olabilir (güçlü aday, K17; sessiz) ve kasadan ödenmiş olabilir (K16).
 * Kasa satırı en çok bir kalemi sessize alır (sabah e-postası hatırlatmaz): satırın gününe kadarki, kalanı satırın
 * tutarını max(1 ₺, %2) içinde tutan kalemlerden gününe en yakını (satırlar eskiden yeniye). Hiçbir kalemi tutmayan
 * satır (ör. 300 ₺ fişsiz Metro alışverişi) gününe kadarki kalemlerde yalnız ipucudur: hiçbir şeyi sessize almaz,
 * elle kayıt yokken sabah e-postası bugünküyle aynı kalır. Tutan satırın ipucu yalnız sessize aldığı kalemde durur.
 */
export function cariHints(
  index: CariHintIndex,
  invoices: readonly (Omit<BalanceInvoice, "unpaid"> & { id: number; date: string; cardId: number | null })[],
  debts: readonly { id: number; date: string; cardId: number; remaining: number; dismissedCashOutIds?: readonly number[] }[],
): Map<string, { quiet?: "link" | "kasa"; hint: UpcomingHint }> {
  const out = new Map<string, { quiet?: "link" | "kasa"; hint: UpcomingHint }>();
  if (!index.strong.length && !index.kasaPending.length) return out;
  for (const c of index.strong) {
    const href = index.hrefOf(c.cardId);
    if (!href || out.has(`invoice:${c.invoiceId}`)) continue;
    const what = c.debts.map((d) => `${dateTR(d.date).slice(0, 5)} · ${d.description?.trim() || "alım"}`);
    out.set(`invoice:${c.invoiceId}`, {
      quiet: "link",
      hint: { kind: "link", text: `Faturasız alımın faturası olabilir${what.length ? ` (${what.join(", ")})` : ""}`, href: `${href}?bagla=${c.invoiceId}`, invoiceId: c.invoiceId, debtIds: c.debtIds },
    });
  }
  if (!index.kasaPending.length) return out;
  const none: readonly number[] = [];
  const items = [
    // Borç ekle'de "Ayrı alım" denen Teslim satırı o borcun ödemesi değil (satır başka kalem için işlenmemiş kalır);
    // borç faturasına bağlanınca faturanın da (faturaya bağlı borçların satırları)
    ...invoices.flatMap((i) =>
      i.cardId !== null ? [{ ref: `invoice:${i.id}`, date: i.date, cardId: i.cardId, amount: openBalance({ ...i, unpaid: true }), apart: index.kasaApartByInvoice.get(i.id) ?? none }] : [],
    ),
    ...debts.map((d) => ({ ref: `cari:${d.id}`, date: d.date, cardId: d.cardId, amount: d.remaining, apart: d.dismissedCashOutIds ?? none })),
  ].filter((it) => !out.has(it.ref));
  // Kalemin gününden (aynı gün dahil: teslimatta şoföre ödenen) sonraki işlenmemiş satır
  const fits = (l: CariHintIndex["kasaPending"][number], it: (typeof items)[number]) => l.cardId === it.cardId && l.date >= it.date && !it.apart.includes(l.id);
  const lines = [...index.kasaPending].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const quietBy = new Map<string, (typeof lines)[number]>();
  const used = new Set<number>();
  for (const l of lines) {
    const match = items
      .filter((it) => !quietBy.has(it.ref) && it.amount > EPS && fits(l, it) && Math.abs(it.amount - l.amount) <= linkTolerance(it.amount))
      .sort((a, b) => b.date.localeCompare(a.date) || Math.abs(a.amount - l.amount) - Math.abs(b.amount - l.amount) || a.ref.localeCompare(b.ref))[0];
    if (!match) continue;
    quietBy.set(match.ref, l);
    used.add(l.id);
  }
  for (const it of items) {
    const own = quietBy.get(it.ref);
    // Sessize aldığı kalemi olmayan en eski satır yalnız ipucu
    const line = own ?? lines.find((l) => !used.has(l.id) && fits(l, it));
    const href = line ? index.hrefOf(it.cardId) : undefined;
    if (!line || !href) continue;
    out.set(it.ref, {
      ...(own ? { quiet: "kasa" as const } : {}),
      hint: {
        kind: "kasa",
        text: `Kasadan ödenmiş olabilir: ${dateTR(line.date).slice(0, 5)} ${line.kind === "teslim" ? "Teslim" : "Alışveriş"} · ${line.store ?? ""} ${tl(line.amount, 2)}`,
        href: `${href}?kasa=${line.id}`,
        cashOutId: line.id,
      },
    });
  }
  return out;
}
