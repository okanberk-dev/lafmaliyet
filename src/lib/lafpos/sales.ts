import type { LafposSalesMonth, SalesLine } from "@/lib/calc/types";
import { monthLabel, pct, tl } from "@/lib/format";
import { coverageFor } from "@/lib/sales-coverage";
import { addDays, dayAblativeTR, dayMonthTR, monthEnd } from "@/lib/reminders";

import { lafposCountFrom, lafposSalesFrom, modposListCounts, monthSource } from "./switch";

/**
 * LafPOS satışlarının aylık maliyet modeline girmesi (docs/LAFPOS.md › Günlük satış; denetim E-08). Model satışı ay ay
 * okur (sales_lines biçimi). Geçiş gününden itibaren LafPOS'un günlük satırları (pos_daily_sales) (ay, POS adı, ürün,
 * hizmet) başına ay toplamına çevrilip ModPOS listesinin yanına konur; motor (engine.ts) değişmez, Satışlar, Tutarlılık,
 * Ürünler, Analiz, Genel bakış ve KDV tahmini aynı satırları okur.
 *
 * Kural: her gün tek kaynak. ModPOS listesi aylık toplamdır, gün gün bölünemez; bu yüzden geçiş ayında listenin son günü
 * (kapsam) belirleyicidir: liste kendi son gününe kadar bütünüyle, LafPOS ondan sonraki günden (geçiş gününden önce
 * değil) sayılır. Ayın tamamı geçiş gününden sonraysa yalnız LafPOS; o aya yüklü ModPOS listesi sayılmaz (silinmez).
 * Geçiş gününden önceki LafPOS günleri denemedir, hiçbir hesaba girmez. Geçiş günü yoksa hiçbir şey değişmez:
 * satırlar bugünkü gibi yalnız sales_lines. Saf modül; testleri tests/lafpos-satis.test.ts.
 */

/** LafPOS'un bir aydaki satırı: sayılan günlerin pos_daily_sales satırlarının (POS adı, ürün, hizmet) başına toplamı */
export interface LafposMonthLine {
  month: string;
  posName: string;
  productId: number | null;
  isService: boolean;
  qty: number;
  /** TL, KDV dahil */
  revenue: number;
  /** Satırın geçtiği gün sayısı */
  days: number;
}

/** Ayın sayılan LafPOS gün sonları (pos_day_reports): kaç gün geldi, son gün */
export interface LafposDaysOfMonth {
  month: string;
  days: number;
  last: string;
}

/** Ayın ModPOS listesinin son günü: kapsam kaydı (süren ayda ya da geçiş ayında yüklenen liste) yoksa ayın sonu */
export function modposThroughOf(month: string, coverage: Readonly<Record<string, string>>): string {
  return coverage[month] ?? monthEnd(`${month}-01`);
}

/**
 * LafPOS günlük satırlarının sayıldığı ilk gün (bütün aylar için tek sınır, docs/LAFPOS.md › Günlük satış): geçiş ayında
 * o ayın ModPOS listesinin son gününden sonra (liste varsa), sonraki aylarda her gün. Geçiş günü yoksa null.
 */
export function lafposSalesCountFrom(switchDay: string | null, salesLines: readonly Pick<SalesLine, "month">[], coverage: Readonly<Record<string, string>>): string | null {
  if (switchDay === null) return null;
  const month = switchDay.slice(0, 7);
  const hasList = salesLines.some((l) => l.month === month);
  return lafposCountFrom(switchDay, hasList ? modposThroughOf(month, coverage) : null);
}

export interface SalesSourcesInput {
  switchDay: string | null;
  /** Satışlar'a yüklenmiş ModPOS listeleri (sales_lines), veritabanındaki sırayla */
  salesLines: SalesLine[];
  /** sales.coverage: ayın listesinin son günü (yalnız ay sonundan önce biten listeler; src/lib/sales-coverage.ts) */
  coverage: Readonly<Record<string, string>>;
  /** LafPOS ay toplamları, yalnız sayılan günlerden (lafposSalesCountFrom'dan itibaren) */
  lafposLines: readonly LafposMonthLine[];
  /** Sayılan LafPOS gün sonları, ay ay */
  lafposDays: readonly LafposDaysOfMonth[];
}

export interface SalesSources {
  /** Modelin satış satırları: sayılan ModPOS satırları, ardından LafPOS ay toplamları (eksi kimlikle) */
  salesLines: SalesLine[];
  /**
   * Satırların kapsadığı son gün, ay ay (engine listPeriod): ModPOS listesinin kaydı; LafPOS satırı olan ayda son gelen
   * LafPOS günü (ayın son günüyse kayıt yok: ayın tamamı). Sayılmayan listenin kaydı düşer.
   */
  coverage: Record<string, string>;
}

/**
 * ModPOS listeleriyle LafPOS ay toplamlarını birleştirir (her gün tek kaynak). Geçiş günü yoksa girdi olduğu gibi döner
 * (aynı satırlar, aynı sıra): LafPOS hiçbir hesaba girmez.
 */
export function mergeSalesSources(input: SalesSourcesInput): SalesSources {
  const S = input.switchDay;
  if (S === null) return { salesLines: input.salesLines, coverage: { ...input.coverage } };
  const switchMonth = S.slice(0, 7);
  const kept = input.salesLines.filter((l) => modposListCounts(l.month, S));
  const lafpos = input.lafposLines
    .filter((l) => l.month >= switchMonth)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month) || b.revenue - a.revenue || a.posName.localeCompare(b.posName, "tr") || (a.productId ?? 0) - (b.productId ?? 0));
  const synthetic: SalesLine[] = lafpos.map((l, i) => ({
    id: -(i + 1),
    month: l.month,
    posName: l.posName,
    qty: l.qty,
    revenue: l.revenue,
    productId: l.productId,
    isService: l.isService,
    note: null,
    lafpos: { days: l.days },
  }));
  const coverage: Record<string, string> = {};
  for (const [m, through] of Object.entries(input.coverage)) if (modposListCounts(m, S)) coverage[m] = through;
  for (const d of input.lafposDays) {
    if (d.month < switchMonth) continue;
    if (d.last >= monthEnd(`${d.month}-01`)) delete coverage[d.month];
    else coverage[d.month] = d.last;
  }
  return { salesLines: [...kept, ...synthetic], coverage };
}

/**
 * Bir ayın satış kaynakları (Satışlar ekranının bandı ve uyarıları). Geçiş gününden önceki ayda null. `today`: iş günü;
 * geçiş ayında eksik günler ancak geçiş günü geldikten sonra söylenir (öncesinde ayın ModPOS kısmı sürüyor).
 */
export function lafposMonthStatus(i: {
  month: string;
  switchDay: string;
  today: string;
  modpos: { lines: number; revenue: number; through: string } | null;
  lafpos: { days: number; last: string } | null;
  modposZ?: number | null;
  /** Kasa raporunu bekleyen günler (süren ay) */
  held?: { from: string; to: string } | null;
}): LafposSalesMonth | null {
  const source = monthSource(i.month, i.switchDay);
  if (source === "modpos") return null;
  const list = i.modpos && i.modpos.lines > 0 ? i.modpos : null;
  const counted = source === "gecis" && list !== null;
  const from = lafposSalesFrom(i.month, i.switchDay, counted ? list.through : null);
  let gap: LafposSalesMonth["gap"] = null;
  let overlap: LafposSalesMonth["overlap"] = null;
  if (source === "gecis") {
    const lastModpos = addDays(i.switchDay, -1);
    if (counted && list.through >= i.switchDay) overlap = { from: i.switchDay, to: list.through };
    if (i.today >= i.switchDay) {
      const start = counted ? addDays(list.through, 1) : `${i.month}-01`;
      if (start <= lastModpos) gap = { from: start, to: lastModpos };
    }
  }
  return {
    month: i.month,
    source,
    from,
    lafpos: i.lafpos && i.lafpos.days > 0 ? i.lafpos : null,
    modpos: list ? { ...list, counted } : null,
    modposZ: source === "gecis" ? (i.modposZ ?? null) : null,
    gap,
    overlap,
    ...(i.held ? { held: i.held } : {}),
  };
}

/**
 * Gün aralığı: "5–9 Kasım", tek gün "9 Kasım". Çizgiden sonra sözcük birleştirici (U+2060), gün ile ay arasında bölünmez
 * boşluk: telefonda satır "1–" ile "19 Kasım" arasında kırılmaz
 */
export function dayRangeTR(from: string, to: string): string {
  if (from === to) return dayMonthTR(from);
  return `${Number(from.slice(8, 10))}–\u2060${dayMonthTR(to)}`;
}

/** ModPOS listesi geçiş ayında o günlerin Z toplamını bu oranda aşarsa uyarı (liste geçiş gününden sonrasını da içeriyor olabilir) */
export const MODPOS_OVER_Z = 0.05;

/**
 * Geçiş ayında liste toplamı, listenin günlerinin (`from` → `through`) kasa raporlarındaki Z toplamını %5'ten fazla
 * aşıyorsa uyarı metni; Z yoksa ya da aşmıyorsa null. Liste ürün cirosudur (indirimden önce), Z indirimden sonra:
 * küçük fark olağandır
 */
export function modposOverZText(revenue: number, z: number | null, from: string, through: string): string | null {
  if (z === null || !(z > 0) || revenue <= z * (1 + MODPOS_OVER_Z)) return null;
  return `ModPOS listesinin toplamı (${tl(revenue)}) ${dayRangeTR(from, through)} kasa raporlarının Z toplamından (${tl(z)}) ${pct(revenue / z - 1, 0)} fazla: liste sonraki günlerin satışını da içeriyor olabilir, o günler LafPOS'tan da sayılır. Listeyi yalnız ${dayRangeTR(from, through)} için alıp yeniden yükleyin.`;
}

export interface LafposMonthNotes {
  /** Ayın kaynağını anlatan satır */
  info: string;
  /** Eksik günler, sayılmayan günler, sayılmayan liste, liste ↔ Z farkı */
  warnings: string[];
}

/** Satışlar'ın bandı: ayın kaynağı ve sorunlar (sakin dille; çözümüyle) */
export function lafposMonthNotes(st: LafposSalesMonth, switchDay: string): LafposMonthNotes {
  const name = monthLabel(st.month).split(" ")[0];
  const warnings: string[] = [];
  const held = st.held ? `; ${dayRangeTR(st.held.from, st.held.to)} kasa raporu girilince sayılır` : "";
  const days = st.lafpos ? ` (${st.lafpos.days} gün geldi, son gün ${dayMonthTR(st.lafpos.last)}${held})` : "";
  if (st.source === "lafpos") {
    if (st.modpos) {
      warnings.push(
        `Bu aya yüklenmiş ModPOS listesi (${st.modpos.lines} satır) sayılmıyor: ${name} LafPOS'tan geliyor. Silmek için "Ayı temizle".`,
      );
    }
    return {
      info: `${name} LafPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir${days}. ModPOS listesi yüklenmez.`,
      warnings,
    };
  }
  const first = `${st.month}-01`;
  const lastModpos = addDays(switchDay, -1);
  const info = `${name} geçiş ayı: ModPOS listesi ${dayRangeTR(first, lastModpos)}, LafPOS ${dayAblativeTR(switchDay)} itibaren${days}.`;
  if (st.overlap) {
    const whole = st.modpos && st.modpos.through >= monthEnd(first);
    warnings.push(
      `${whole ? `${name} listesi ayın tamamını kapsıyor` : `${name} listesi ${dayMonthTR(st.modpos!.through)} gününe kadar`}: LafPOS'un ${dayRangeTR(st.overlap.from, st.overlap.to)} günleri aynı satışları iki kez saymamak için sayılmıyor. LafPOS'u saymak için yalnız ${dayRangeTR(first, lastModpos)} listesini yükleyin.`,
    );
  }
  if (st.gap) {
    warnings.push(
      st.modpos
        ? `${dayRangeTR(st.gap.from, st.gap.to)} satışı hiçbir kaynakta yok: ModPOS listesi ${dayMonthTR(st.modpos.through)} gününe kadar, LafPOS ${dayAblativeTR(switchDay)} itibaren. ${dayRangeTR(first, lastModpos)} listesini yükleyin.`
        : `${dayRangeTR(st.gap.from, st.gap.to)} ModPOS satışı yüklenmedi: LafPOS ${dayAblativeTR(switchDay)} itibaren sayılıyor. ${dayRangeTR(first, lastModpos)} listesini yükleyin.`,
    );
  }
  if (st.modpos?.counted) {
    // modposZ listenin kendi günlerinin (ayın 1'i → listenin son günü) Z toplamı
    const over = modposOverZText(st.modpos.revenue, st.modposZ, first, st.modpos.through);
    if (over) warnings.push(over);
  }
  return { info, warnings };
}

/**
 * Satışlar'a ModPOS listesi yüklemenin kuralı (importSales): ayın tamamı geçiş gününden sonraysa reddedilir; geçiş
 * ayında liste en çok geçiş gününden önceki güne kadardır (süren ayda verilen ya da dün, en çok o gün; ay bittiyse
 * verilen gün ya da o gün): ay sonrası yüklenen liste kapsam kaydını silip LafPOS günlerini saymaz yapmasın. Öteki aylarda
 * bugünkü kural (src/lib/sales-coverage.ts coverageFor). `through`: listenin son günü (null: ayın tamamı).
 */
export function modposImportRule(month: string, switchDay: string | null, today: string, given?: string | null): { ok: true; through: string | null } | { ok: false; error: string } {
  const src = monthSource(month, switchDay);
  if (src === "lafpos") return { ok: false, error: `${monthLabel(month)} LafPOS'tan geliyor; ModPOS listesi yüklenmez. Satışlar her gün sonunda LafPOS'tan kendiliğinden gelir.` };
  if (src === "modpos" || switchDay === null) return { ok: true, through: coverageFor(month, today, given) };
  const max = addDays(switchDay, -1);
  const running = coverageFor(month, today, given);
  const picked = running ?? (given && /^\d{4}-\d{2}-\d{2}$/.test(given) && given.slice(0, 7) === month ? given : max);
  return { ok: true, through: picked < max ? picked : max };
}
