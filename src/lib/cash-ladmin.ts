import { carryCheck, carryDiffText, CASH_TOLERANCE, changesText, computeCash, diffKind, diffText, lastRevision, stampTR, type CashReportFields, type CashRevisionRow } from "@/lib/cash-report";
import { money, num, pct } from "@/lib/format";

/**
 * Yöneticinin Kasa gün görünümündeki "ladmin" bölümü (saf; docs/MODPOS-API.md › Nerede görünür; tests/modpos-kasa.test.ts):
 * panelde yazılan kasa raporunun ayrıntısı, ModPOS bölümünün yanında aynı düzenle okunsun diye. Yalnız raporun
 * kendisinden okur (föyü bilmez); ModPOS bölümü aynı satır türlerini kullanır (src/lib/cash-modpos.ts).
 */

export type DayTone = "warn" | "good";

/** Bölümün üstündeki karo: ad, değer, altında soluk ayrıntı */
export interface DayFact {
  label: string;
  value: string;
  sub?: string | null;
  tone?: DayTone | null;
}

/** Listenin satırı: solda ad (altında ayrıntı), sağda değer; `strong` ara toplam, `wrap` değer metindir (kişi adı: kırılır) */
export interface DayLine {
  label: string;
  value: string;
  sub?: string | null;
  tone?: DayTone | null;
  strong?: boolean;
  wrap?: boolean;
}

/** Bölümün okuduğu rapor alanları (kayıtlı raporun yöneticideki DTO'su) */
export type LadminReport = CashReportFields & {
  revision: number;
  cashDiff: number;
  submittedByName: string;
  countedByName: string | null;
  createdAt: string;
  updatedAt: string;
  emailStatus: "sent" | "failed" | "off" | null;
  emailedAt: string | null;
};

/** Günün kasadan çıkan satırı (cash_outs; yöneticinin görünümü) */
export interface LadminCashOut {
  kind: "harcama" | "teslim";
  amount: number;
  store: string | null;
  description: string | null;
  categoryName: string | null;
  createdByName: string | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const share = (v: number, total: number) => (total > 0.004 && Math.abs(v) >= 0.01 ? pct(v / total, 0) : null);

/** Ödeme satırları (tutar ve ciroya göre payı); boş kanal yazılmaz, nakit ve kart her zaman */
export function paymentLines(p: { cash: number; card: number; mealCard: number; online: number; other: number }, total: number): DayLine[] {
  const rows: [string, number, boolean][] = [
    ["Nakit", p.cash, true],
    ["Kredi / banka kartı", p.card, true],
    ["Yemek kartı", p.mealCard, false],
    ["Online", p.online, false],
    ["Diğer", p.other, false],
  ];
  return rows.filter(([, v, always]) => always || Math.abs(v) >= 0.01).map(([label, v]) => ({ label, value: money(v), sub: share(v, total) }));
}

/**
 * "Ödemelerin toplamı" satırı: toplamla tutuyorsa `words.same` ("Z toplamıyla aynı"), tutmuyorsa farkı turuncu
 * (`words.from`: "Z toplamından 120 ₺ eksik")
 */
export function paymentsTotalLine(paymentsTotal: number, total: number, words: { same: string; from: string }, tolerance = 0.01): DayLine {
  const gap = r2(paymentsTotal - total);
  const even = Math.abs(gap) < tolerance;
  return {
    label: "Ödemelerin toplamı",
    value: money(paymentsTotal),
    sub: even ? words.same : `${words.from} ${money(Math.abs(gap))} ${gap > 0 ? "fazla" : "eksik"}`,
    tone: even ? null : "warn",
    strong: true,
  };
}

/** Ortalama: toplam / adet (adet yoksa ya da 0'sa null) */
export function perUnit(total: number, count: number | null): string | null {
  return count && count > 0 ? money(r2(total / count)) : null;
}

/** Üstteki karolar: Z toplamı, fiş sayısı (ortalamasıyla), ödenmez / ikram, indirim, kasa farkı, ertesi güne devreden */
export function ladminFacts(r: LadminReport): DayFact[] {
  const c = computeCash(r);
  const avg = perUnit(r.zTotal, r.receipts);
  const kind = diffKind(r.cashDiff);
  return [
    { label: "Toplam satış (Z)", value: money(r.zTotal), sub: r.zNo ? `Z no ${r.zNo}` : "Z no yazılmadı" },
    { label: "Fiş sayısı", value: r.receipts !== null ? num(r.receipts) : "–", sub: avg ? `ortalama fiş ${avg}` : null },
    // Ödenmez Z toplamının içindeyse ayın cirosuna girmeyen tutar burada söylenir (docs/KASA-RAPORU.md › Ciro ve ödenmez)
    {
      label: "Ödenmez / ikram",
      value: r.offRevenue !== null ? money(r.offRevenue) : "–",
      sub: r.offRevenue === null ? "girilmedi" : c.offInZTotal ? `ciroya girmez: ciro ${money(c.revenue)}` : "ciroya girmez",
    },
    { label: "İndirim", value: r.discounts !== null && r.discounts !== undefined ? money(r.discounts) : "–", sub: r.discounts !== null && r.discounts !== undefined ? null : "girilmedi" },
    { label: "Kasa farkı", value: diffText(r.cashDiff), sub: "sayılan − olması gereken", tone: kind === "even" ? "good" : "warn" },
    { label: "Ertesi güne devreden", value: money(c.carryOver), sub: r.handedOver ? `sayımdan sonra ${money(r.handedOver)} teslim` : null },
  ];
}

/** Ödeme satırları ve toplamı (Z'ye göre pay) */
export function ladminPayments(r: LadminReport): DayLine[] {
  const c = computeCash(r);
  // Paylar ve toplam ciroya göre: ödenmez / ikram ödeme türü değil, Z toplamının içindeyse cirodan çıkar
  const words = c.offInZTotal ? { same: "ciroyla aynı", from: "cirodan" } : { same: "Z toplamıyla aynı", from: "Z toplamından" };
  // Formun, dökümün ve e-postanın kuralı: 1 ₺'tan küçük fark (bozuk para) tutuyor sayılır
  return [...paymentLines(r, c.revenue), paymentsTotalLine(c.paymentsTotal, c.revenue, words, CASH_TOLERANCE)];
}

/**
 * Nakit kasanın hesabı: açılış (dünkü devirle tutuyor mu) + nakit satış + gün içinde giren − kasadan çıkan = olması
 * gereken; sayılan, fark, teslim ve devreden; ertesi günün açılışı bu devirle tutuyor mu
 */
export function ladminCash(r: LadminReport, prev: { date: string; amount: number } | null, next: { date: string; openingCash: number } | null): DayLine[] {
  const c = computeCash(r);
  const carry = carryCheck(r.date, r.openingCash, prev);
  const after = next ? carryCheck(next.date, next.openingCash, { date: r.date, amount: c.carryOver }) : null;
  const lines: DayLine[] = [
    {
      label: "Açılış (devir)",
      value: money(r.openingCash),
      sub: carry ? `önceki raporun devri ${money(carry.carry)}: açılış ${carryDiffText(carry)}` : prev ? "önceki raporun devriyle aynı" : null,
      tone: carry ? "warn" : null,
    },
    { label: "+ Nakit satış", value: money(r.cash) },
    { label: "+ Gün içinde giren", value: money(r.cashIn ?? 0), sub: "bozuk para, nakit tahsilat, nakit bahşiş" },
    { label: "− Kasadan çıkan", value: money(r.cashOut), sub: r.cashOutNote },
    { label: "= Olması gereken", value: money(c.expectedCash), strong: true },
    { label: "Sayılan", value: money(r.countedCash), sub: `sayan ${r.countedByName ?? r.submittedByName}` },
    { label: "Fark", value: diffText(c.cashDiff), tone: c.kind === "even" ? "good" : "warn", strong: true },
  ];
  if (r.handedOver) lines.push({ label: "Sayımdan sonra teslim", value: money(r.handedOver) });
  lines.push({
    label: "Ertesi güne devreden",
    value: money(c.carryOver),
    sub: after ? `ertesi raporun açılışı ${money(after.opening)}: ${carryDiffText(after)}` : next ? "ertesi raporun açılışıyla aynı" : null,
    tone: after ? "warn" : null,
  });
  return lines;
}

/** Kartın kanıtı: Z'nin kartı, banka POS gün sonu, yazarkasanın kartı ve kart farkı */
export function ladminCard(r: LadminReport): DayLine[] {
  const c = computeCash(r);
  const lines: DayLine[] = [{ label: "Kart (Z raporu)", value: money(r.card) }];
  lines.push({ label: "Banka POS gün sonu", value: r.bankPos !== null ? money(r.bankPos) : "–", sub: r.bankPos !== null ? null : "girilmedi" });
  if (r.okcCard !== null && r.okcCard !== undefined) lines.push({ label: "Yazarkasa kartı", value: money(r.okcCard) });
  if (c.cardDiff !== null) {
    const off = Math.abs(c.cardDiff) >= 1;
    lines.push({
      label: "Kart farkı",
      value: off ? `${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "eksik"}` : "Tutuyor",
      sub: c.cardSource === "okc" ? "yazarkasa kartı − Z kartı" : "banka POS − Z kartı",
      tone: off ? "warn" : "good",
      strong: true,
    });
  }
  return lines;
}

/** Yazarkasanın (banka POS) mali Z'si; bölüm girilmediyse boş */
export function ladminOkc(r: LadminReport): DayLine[] {
  if (!r.okcZNo && r.okcTotal == null && r.okcReceipts == null) return [];
  const m = (label: string, v: number | null | undefined): DayLine | null => (v === null || v === undefined ? null : { label, value: money(v) });
  return [
    { label: "Yazarkasa Z no", value: r.okcZNo ?? "–", sub: r.okcReceipts != null ? `${num(r.okcReceipts)} fiş` : null },
    m("Toplam", r.okcTotal),
    m("KDV", r.okcVatTotal),
    m("Nakit", r.okcCash),
    m("Kart", r.okcCard),
    m("Yemek kartı", r.okcMealCard),
    m("Diğer", r.okcOther),
  ].filter((l): l is DayLine => l !== null);
}

/** Günün kasadan çıkan satırları (tutar, kategori, yeri, giren) ve toplamı; satır yoksa boş */
export function ladminOuts(outs: readonly LadminCashOut[]): DayLine[] {
  if (!outs.length) return [];
  const lines: DayLine[] = outs.map((o) => ({
    label: o.description || o.store || o.categoryName || (o.kind === "teslim" ? "Teslim" : "Harcama"),
    value: money(o.amount),
    sub: [o.kind === "teslim" ? "teslim" : (o.categoryName ?? "kategorisiz"), o.description ? o.store : null, o.createdByName].filter(Boolean).join(" · ") || null,
  }));
  lines.push({ label: `Toplam (${outs.length} satır)`, value: money(r2(outs.reduce((a, o) => a + o.amount, 0))), strong: true });
  return lines;
}

const EMAIL_TEXT = { sent: "E-posta gönderildi", failed: "E-posta gönderilemedi", off: "E-posta kapalı" } as const;

/**
 * Raporun künyesi (bölümün altında): kasayı sayan (gönderenden farklıysa), sürüm (son değişiklik ve değişen alanlar),
 * fotoğraf sayısı ve e-postanın durumu. Gönderen ve anı başlık satırındadır (ladminHeadline)
 */
export function ladminMeta(r: LadminReport, o: { photos: number; revisions: CashRevisionRow[] }): string[] {
  const lines: string[] = [];
  if (r.countedByName && r.countedByName !== r.submittedByName) lines.push(`Kasayı sayan ${r.countedByName}`);
  if (r.revision > 1) {
    const last = lastRevision(r, o.revisions);
    lines.push(`${r.revision}. sürüm · son değişiklik ${stampTR(r.updatedAt)}${last?.changes.length ? `: ${changesText(last.changes)}` : ""}`);
  }
  const extras = [o.photos ? `${o.photos} fotoğraf` : "fotoğraf yok", r.emailStatus ? `${EMAIL_TEXT[r.emailStatus]}${r.emailStatus === "sent" && r.emailedAt ? ` (${stampTR(r.emailedAt)})` : ""}` : null].filter(Boolean);
  lines.push(extras.join(" · ").replace(/^./, (ch) => ch.toLocaleUpperCase("tr")));
  return lines;
}

/** Kartın başlık satırı: "Z 0312 · Gönderen Ayşe · 2 Kasım 00:41" (sürüm 1'den büyükse eklenir) */
export function ladminHeadline(r: Pick<LadminReport, "zNo" | "submittedByName" | "createdAt" | "revision">): string {
  return [r.zNo ? `Z ${r.zNo}` : null, `Gönderen ${r.submittedByName}`, stampTR(r.createdAt), r.revision > 1 ? `${r.revision}. sürüm` : null].filter(Boolean).join(" · ");
}
