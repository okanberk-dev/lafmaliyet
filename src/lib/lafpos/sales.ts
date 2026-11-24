import type { LafposSalesMonth, SalesLine } from "@/lib/calc/types";
import { missingText } from "@/lib/cash-month";
import { monthLabel, money, pct, tl } from "@/lib/format";
import { coverageFor } from "@/lib/sales-coverage";
import { addDays, dayAblativeTR, dayMonthTR, monthEnd } from "@/lib/reminders";

import { branchSwitchDay, isLafposBranch, lafposCountFrom, lafposSalesFrom, modposListCounts, monthSource } from "./switch";

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
  /** Faz 2: indirimden önceki liste değeri (TL, KDV dahil); bir günü brütsüz (eski LafPOS) gelmişse null */
  gross?: number | null;
  /** Faz 2: ek parçası (EXTRA SHOT, SYRUP, ALTERNATIF SÜT) */
  isAddon?: boolean;
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
export function lafposSalesCountFrom(switchDay: string | null, salesLines: readonly Pick<SalesLine, "month" | "branchId">[], coverage: Readonly<Record<string, string>>): string | null {
  if (switchDay === null) return null;
  const month = switchDay.slice(0, 7);
  // Yalnız LafPOS'un şubesinin listesi: ModPOS'ta kalan şubenin listesi LafPOS'un günlerini kesmez
  const hasList = salesLines.some((l) => l.month === month && isLafposBranch(l.branchId));
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
 * (aynı satırlar, aynı sıra): LafPOS hiçbir hesaba girmez. Geçiş günü yalnız LafPOS'un şubesinindir: ModPOS'ta kalan
 * şubenin (Tuzla) listesi her ay sayılır ("Tümü"de iki şubenin satırları yan yana; denetim 21 Kasım #5).
 */
export function mergeSalesSources(input: SalesSourcesInput): SalesSources {
  const S = input.switchDay;
  if (S === null) return { salesLines: input.salesLines, coverage: { ...input.coverage } };
  const switchMonth = S.slice(0, 7);
  const kept = input.salesLines.filter((l) => modposListCounts(l.month, branchSwitchDay(S, l.branchId)));
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
    ...(l.gross !== undefined ? { gross: l.gross } : {}),
    ...(l.isAddon !== undefined ? { isAddon: l.isAddon } : {}),
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
  /** Listenin günlerinin kasa raporlarındaki indirim toplamı (liste indirimden öncedir; modposOverZText) */
  modposDiscounts?: number | null;
  /** Kasa raporunu bekleyen günler (süren ay) */
  held?: { from: string; to: string } | null;
  /** Ayın kasa raporu olan günleri ve gelen LafPOS gün sonları: raporlu ama gün sonu gelmemiş gün (`missing`) */
  kasaDays?: readonly string[];
  lafposDates?: readonly string[];
  /** Ayın sayılan LafPOS günlerinin ürün satırları toplamı ve Z'si (zCheck: Σ ciro = zTotal); verilmezse denetim yok */
  linesVsZ?: readonly { date: string; lines: number; z: number }[];
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
  // Raporlu ama LafPOS gün sonu gelmemiş günler (bugün hariç: gün sonu kapanışta gelir)
  const got = new Set(i.lafposDates ?? []);
  const missing = from === null ? [] : (i.kasaDays ?? []).filter((d) => d >= from && d < i.today && !got.has(d)).sort();
  // Listenin ilk günü: listenin günlerindeki ilk kasa raporu (Marina 13 Kasım'da açıldı); rapor yoksa ayın 1'i
  const first = list ? ((i.kasaDays ?? []).filter((d) => d.slice(0, 7) === i.month && d <= list.through).sort()[0] ?? null) : null;
  const listFirst = first && first > `${i.month}-01` ? first : null;
  return {
    month: i.month,
    source,
    from,
    lafpos: i.lafpos && i.lafpos.days > 0 ? i.lafpos : null,
    modpos: list ? { ...list, counted, ...(listFirst ? { from: listFirst } : {}) } : null,
    modposZ: source === "gecis" ? (i.modposZ ?? null) : null,
    modposDiscounts: source === "gecis" && i.modposZ != null ? (i.modposDiscounts ?? 0) : null,
    gap,
    overlap,
    ...(i.held ? { held: i.held } : {}),
    ...(missing.length ? { missing } : {}),
    ...(i.linesVsZ ? { zCheck: { days: i.linesVsZ.length, off: i.linesVsZ.filter((d) => Math.abs(d.lines - d.z) >= 0.01) } } : {}),
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
 * Kasa satırlarının `from` → `through` günlerindeki Z toplamı ve indirim toplamı (iki uç dahil; indirimi girilmemiş gün
 * 0); satır yoksa null. Satırlar çağıranın süzdüğü şubenin kasa raporlarıdır (veri kümesi: LafPOS'un şubesi; içe aktarma:
 * listenin şubesi): başka şubenin Z'si listenin Z'sine girmez ("%8 fazla", 23 Kasım 2026)
 */
export function modposZBetween(
  rows: readonly { date: string; zTotal: number; discounts: number | null }[],
  from: string,
  through: string,
): { z: number; discounts: number } | null {
  const inRange = rows.filter((r) => r.date >= from && r.date <= through);
  if (!inRange.length) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { z: r2(inRange.reduce((a, r) => a + r.zTotal, 0)), discounts: r2(inRange.reduce((a, r) => a + (r.discounts ?? 0), 0)) };
}

/**
 * Geçiş ayında liste toplamı indirimden sonra (`revenue − discounts`), listenin günlerinin (`from` → `through`) kasa
 * raporlarındaki Z toplamını %5'ten fazla aşıyorsa uyarı metni; Z yoksa ya da aşmıyorsa null. ModPOS'un ürün listesi
 * indirimden öncedir, Z indirimden sonra: liste − indirim = Z (hesap sözleşmesi §11). `discounts`: listenin günlerinin
 * kasa raporlarındaki indirim (verilmezse 0; eskiden hiç düşülmüyordu, Marina'nın doğru listesi "%8 fazla" görünürdü)
 */
export function modposOverZText(revenue: number, z: number | null, from: string, through: string, discounts = 0): string | null {
  const net = Math.round((revenue - discounts) * 100) / 100;
  if (z === null || !(z > 0) || net <= z * (1 + MODPOS_OVER_Z)) return null;
  const total = discounts > 0 ? `indirimden sonraki toplamı (${money(net)}: liste ${money(revenue)} − indirim ${money(discounts)})` : `toplamı (${tl(revenue)})`;
  const zText = discounts > 0 ? money(z) : tl(z);
  return `ModPOS listesinin ${total} ${dayRangeTR(from, through)} kasa raporlarının Z toplamından (${zText}) ${pct(net / z - 1, 0)} fazla: liste sonraki günlerin satışını da içeriyor olabilir, o günler LafPOS'tan da sayılır. Listeyi yalnız ${dayRangeTR(from, through)} için alıp yeniden yükleyin.`;
}

export interface LafposMonthNotes {
  /** Ayın kaynağını anlatan satır */
  info: string;
  /** Eksik günler, sayılmayan günler, sayılmayan liste, liste ↔ Z farkı, Z'yi tutmayan LafPOS günü */
  warnings: string[];
  /**
   * Tutarlılık denetimleri (hesap sözleşmesi, 23 Kasım 2026): ModPOS listesi − indirim = Z (listenin günleri) ve LafPOS
   * günlerinin ürün satırları = Z. `ok` tutuyor; tutmayan ModPOS satırı bilgi (%5'i aşan fark ayrıca uyarı), tutmayan
   * LafPOS günü uyarılarda
   */
  checks: { ok: boolean; text: string }[];
}

/** Ayın tutarlılık denetimleri (lafposMonthNotes checks) ve Z'yi tutmayan LafPOS günlerinin uyarıları */
function salesZChecks(st: LafposSalesMonth): { checks: LafposMonthNotes["checks"]; warnings: string[] } {
  const checks: LafposMonthNotes["checks"] = [];
  const warnings: string[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  if (st.modpos?.counted && st.modposZ != null) {
    const disc = st.modposDiscounts ?? 0;
    const diff = r2(st.modpos.revenue - disc - st.modposZ);
    const range = dayRangeTR(st.modpos.from ?? `${st.month}-01`, st.modpos.through);
    const head = `ModPOS listesi ${range}: liste ${tl(st.modpos.revenue, 2)} − indirim ${tl(disc, 2)} = ${tl(r2(st.modpos.revenue - disc), 2)}, Z ${tl(st.modposZ, 2)}`;
    checks.push(
      Math.abs(diff) < 1
        ? { ok: true, text: `${head} · tutuyor` }
        : { ok: false, text: `${head}: liste − indirim Z'den ${tl(Math.abs(diff), 2)} ${diff > 0 ? "fazla" : "az"}. Liste indirimden öncedir; fark listede olmayan ya da fazla satırdır.` },
    );
  }
  if (st.zCheck && st.zCheck.days > 0) {
    if (!st.zCheck.off.length) checks.push({ ok: true, text: `LafPOS: her günün ürün satırları Z'yi tutuyor (${st.zCheck.days} gün)` });
    for (const d of st.zCheck.off) {
      const diff = r2(d.lines - d.z);
      warnings.push(
        `${dayMonthTR(d.date)}: LafPOS'un ürün satırlarının toplamı (${tl(d.lines, 2)}) Z'den (${tl(d.z, 2)}) ${tl(Math.abs(diff), 2)} ${diff > 0 ? "fazla" : "az"}. Satır eksik gelmiş olabilir: LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın.`,
      );
    }
  }
  return { checks, warnings };
}

/** Satışlar'ın bandı: ayın kaynağı ve sorunlar (sakin dille; çözümüyle) */
export function lafposMonthNotes(st: LafposSalesMonth, switchDay: string): LafposMonthNotes {
  const name = monthLabel(st.month).split(" ")[0];
  const warnings: string[] = [];
  const held = st.held ? `; ${dayRangeTR(st.held.from, st.held.to)} kasa raporu girilince sayılır` : "";
  const days = st.lafpos ? ` (${st.lafpos.days} gün geldi, son gün ${dayMonthTR(st.lafpos.last)}${held})` : "";
  const missing = st.missing?.length
    ? `${st.missing.length} günün LafPOS gün sonu gelmedi, kasa raporu var: ${missingText(st.missing)}. Bu günlerin satışı hesapta yok; LafPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın.`
    : null;
  const z = salesZChecks(st);
  if (st.source === "lafpos") {
    if (missing) warnings.push(missing);
    if (st.modpos) {
      warnings.push(
        `Bu aya yüklenmiş ModPOS listesi (${st.modpos.lines} satır) sayılmıyor: ${name} LafPOS'tan geliyor. Silmek için "Ayı temizle".`,
      );
    }
    return {
      info: `${name} LafPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir${days}. ModPOS listesi yüklenmez.`,
      warnings: [...warnings, ...z.warnings],
      checks: z.checks,
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
  if (missing) warnings.push(missing);
  if (st.modpos?.counted) {
    // modposZ listenin kendi günlerinin (ayın 1'i → listenin son günü) Z toplamı; liste o günlerin indiriminden sonra
    const over = modposOverZText(st.modpos.revenue, st.modposZ, first, st.modpos.through, st.modposDiscounts ?? 0);
    if (over) warnings.push(over);
  }
  return { info, warnings: [...warnings, ...z.warnings], checks: z.checks };
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
