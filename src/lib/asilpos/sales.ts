import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import type { AsilposSalesMonth, SalesLine } from "@/lib/calc/types";
import { missingText } from "@/lib/cash-month";
import { monthLabel, money, pct, tl } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { coverageFor } from "@/lib/sales-coverage";
import { addDays, dayAblativeTR, dayMonthTR, monthEnd } from "@/lib/reminders";

import { countedTillIds, earliestSwitchDay, switchDayFor, type PosFroms, type SwitchDays } from "@/lib/pos/tills";

import { asilposCountFrom, asilposSalesFrom, modposListCounts, monthSource } from "./switch";

/**
 * AsilPOS satışlarının aylık maliyet modeline girmesi (docs/ASILPOS.md › Günlük satış; denetim E-08). Model satışı ay ay
 * okur (sales_lines biçimi). Geçiş gününden itibaren AsilPOS'un günlük satırları (pos_daily_sales) (ay, POS adı, ürün,
 * hizmet) başına ay toplamına çevrilip ModPOS listesinin yanına konur; motor (engine.ts) değişmez, Satışlar, Tutarlılık,
 * Ürünler, Analiz, Genel bakış ve KDV tahmini aynı satırları okur.
 *
 * Kural: her gün tek kaynak. ModPOS listesi aylık toplamdır, gün gün bölünemez; bu yüzden geçiş ayında listenin son günü
 * (kapsam) belirleyicidir: liste kendi son gününe kadar bütünüyle, AsilPOS ondan sonraki günden (geçiş gününden önce
 * değil) sayılır. Ayın tamamı geçiş gününden sonraysa yalnız AsilPOS; o aya yüklü ModPOS listesi sayılmaz (silinmez).
 * Geçiş gününden önceki AsilPOS günleri denemedir, hiçbir hesaba girmez. Geçiş günü yoksa hiçbir şey değişmez:
 * satırlar bugünkü gibi yalnız sales_lines. Saf modül; testleri tests/asilpos-satis.test.ts.
 */

/** AsilPOS'un bir aydaki satırı: sayılan günlerin pos_daily_sales satırlarının (POS adı, ürün, hizmet) başına toplamı */
export interface AsilposMonthLine {
  month: string;
  posName: string;
  productId: number | null;
  isService: boolean;
  qty: number;
  /** TL, KDV dahil */
  revenue: number;
  /** Satırın geçtiği gün sayısı */
  days: number;
  /** Faz 2: indirimden önceki liste değeri (TL, KDV dahil); bir günü brütsüz (eski AsilPOS) gelmişse null */
  gross?: number | null;
  /** Faz 2: ek parçası (EXTRA SHOT, SYRUP, ALTERNATIF SÜT) */
  isAddon?: boolean;
}

/** Ayın sayılan AsilPOS gün sonları (pos_day_reports): kaç gün geldi, son gün */
export interface AsilposDaysOfMonth {
  month: string;
  days: number;
  last: string;
}

/** Ayın ModPOS listesinin son günü: kapsam kaydı (süren ayda ya da geçiş ayında yüklenen liste) yoksa ayın sonu */
export function modposThroughOf(month: string, coverage: Readonly<Record<string, string>>): string {
  return coverage[month] ?? monthEnd(`${month}-01`);
}

/**
 * AsilPOS günlük satırlarının sayıldığı ilk gün (bütün aylar için tek sınır, docs/ASILPOS.md › Günlük satış): geçiş ayında
 * o ayın ModPOS listesinin son gününden sonra (liste varsa), sonraki aylarda her gün. Geçiş günü yoksa null. `coverage`
 * AsilPOS'un şubesinin (Marina) kendi kaydıdır (src/lib/sales-coverage.ts readCoverage(…, AsilPOS'un şubesi)), ayın ortak
 * kaydı değil: ortak kayıt son yükleyenindir, Tuzla'nın aynı aya yüklediği liste sınırı kaydırırdı. `tillBranch`: kasanın
 * şubesi (çok şube: her kasanın kendi sınırı)
 */
export function asilposSalesCountFrom(
  switchDay: string | null,
  salesLines: readonly Pick<SalesLine, "month" | "branchId">[],
  coverage: Readonly<Record<string, string>>,
  tillBranch: string,
): string | null {
  if (switchDay === null) return null;
  const month = switchDay.slice(0, 7);
  // Yalnız kasanın şubesinin listesi: öteki şubenin listesi bu kasanın günlerini kesmez
  const hasList = salesLines.some((l) => l.month === month && (l.branchId ?? DEFAULT_BRANCH_ID) === tillBranch);
  return asilposCountFrom(switchDay, hasList ? modposThroughOf(month, coverage) : null);
}

/**
 * Kasa başına AsilPOS satışlarının sayıldığı ilk gün (çok şube; asilposSalesCountFrom her kasanın kendi geçiş günü ve
 * kendi listesinin kaydıyla, `coverageOf`). Hiç sayılmayan kasa sonuçta yoktur
 */
export function posCountFroms(
  switchDays: SwitchDays,
  salesLines: readonly Pick<SalesLine, "month" | "branchId">[],
  coverageOf: (branchId: string) => Readonly<Record<string, string>>,
): PosFroms {
  const out: Record<string, string> = {};
  for (const id of countedTillIds(switchDays)) {
    const from = asilposSalesCountFrom(switchDayFor(switchDays, id), salesLines, coverageOf(id), id);
    if (from !== null) out[id] = from;
  }
  return out;
}

/**
 * "Tümü"de ModPOS'ta kalan bir şubenin (Tuzla) bir aydaki satış listesi (bulgu 62): son günü (şubenin kendi kaydı, yoksa
 * ayın son günü); o ay kasa raporu var ama listesi yoksa null
 */
export interface OtherBranchList {
  branchId: string;
  month: string;
  through: string | null;
}

/**
 * "Tümü"nün ortak döneminin girdisi (bulgu 62): ilk geçiş ayından itibaren o ay ModPOS'ta olan her şubenin (o ay geçiş
 * ayında ya da sonrasında olan AsilPOS kasaları dışındakiler; şubesiz satır ve rapor Tuzla'nın) listesi ya da kasa
 * raporu olan her ayı. Listesi olan ayda son günü şubenin kendi kaydından (`coverageOf`: readCoverage(…, şube); kayıt
 * yoksa ayın tamamı), listesi olmayıp kasa raporu olan ayda null. Geçiş günü yoksa boş: ortak dönem AsilPOS'la birlikte
 * gelir (ModPOS listeleri öncesi bugünkü gibi). Çok şube: geçiş günü sonra olan kasa, o güne kadar ModPOS şubesi sayılır
 */
export function otherBranchLists(i: {
  switchDays: SwitchDays;
  salesLines: readonly Pick<SalesLine, "month" | "branchId">[];
  /** Kasa raporu olan günler, şubesiyle (yalnız rapor satırları: yedek ay satırları ve föy değil) */
  reportDays: readonly { branchId?: string | null; date: string }[];
  coverageOf: (branchId: string) => Readonly<Record<string, string>>;
}): OtherBranchList[] {
  const first = earliestSwitchDay(i.switchDays);
  if (first === null) return [];
  const from = first.slice(0, 7);
  const onPos = (branchId: string, month: string) => {
    const sd = switchDayFor(i.switchDays, branchId);
    return sd !== null && month >= sd.slice(0, 7);
  };
  const withList = new Set<string>();
  const keys = new Map<string, { branchId: string; month: string }>();
  const add = (branchId: string, month: string) => {
    if (month < from || onPos(branchId, month)) return false;
    keys.set(`${month}|${branchId}`, { branchId, month });
    return true;
  };
  for (const l of i.salesLines) {
    const b = l.branchId ?? DEFAULT_BRANCH_ID;
    if (add(b, l.month)) withList.add(`${l.month}|${b}`);
  }
  for (const r of i.reportDays) add(r.branchId ?? DEFAULT_BRANCH_ID, r.date.slice(0, 7));
  return [...keys.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { branchId, month }]) => ({
      branchId,
      month,
      through: withList.has(key) ? (i.coverageOf(branchId)[month] ?? monthEnd(`${month}-01`)) : null,
    }));
}

/** "Tümü"nün ortak döneminin bir ayı: listesi en kısa (ya da hiç olmayan) şube ve son günü */
export interface CommonListCut {
  month: string;
  branchId: string;
  /** Listenin son günü; null: listesi yok (ayın hiçbir günü ortak dönemde değil) */
  through: string | null;
  /** AsilPOS'un bu günden sonraki günleri bu ayda sayılmaz (listesi yoksa ayın başından önceki gün) */
  after: string;
}

/**
 * "Tümü"de AsilPOS'un günlerinin kesildiği gün, ay ay (bulgu 62): ModPOS'ta kalan şubelerin o ayki en kısa listesinin son
 * günü (listesi olmayan şube en kısasıdır). Bütün listeler ayın sonuna kadarsa ay yok. AsilPOS gün gün okunur, kesilir;
 * ModPOS listesi aylık toplamdır, kesilemez: "Tümü"nün dönemi en kısa listeyle biter, sabit gider ve kasa o günlerle.
 */
export function commonListCuts(others: readonly OtherBranchList[]): CommonListCut[] {
  const byMonth = new Map<string, OtherBranchList>();
  for (const o of others) {
    const cur = byMonth.get(o.month);
    const end = (x: OtherBranchList) => x.through ?? "";
    if (!cur || end(o) < end(cur)) byMonth.set(o.month, o);
  }
  const out: CommonListCut[] = [];
  for (const o of [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))) {
    if (o.through !== null && o.through >= monthEnd(`${o.month}-01`)) continue;
    out.push({ month: o.month, branchId: o.branchId, through: o.through, after: o.through ?? addDays(`${o.month}-01`, -1) });
  }
  return out;
}

export interface SalesSourcesInput {
  /** Görünümün kasaları ve geçiş günleri (çok şube; tek şube seçiliyken yalnız onunki, ModPOS şubesinde boş) */
  switchDays: SwitchDays;
  /** Satışlar'a yüklenmiş ModPOS listeleri (sales_lines), veritabanındaki sırayla */
  salesLines: SalesLine[];
  /**
   * Görünümün listelerinin son günü (yalnız ay sonundan önce biten listeler; src/lib/sales-coverage.ts readCoverage):
   * şube seçiliyken şubenin kendi kaydı, "Tümü"de ayın ortak kaydı
   */
  coverage: Readonly<Record<string, string>>;
  /** AsilPOS ay toplamları, yalnız sayılan günlerden (asilposSalesCountFrom'dan itibaren) */
  asilposLines: readonly AsilposMonthLine[];
  /** Sayılan AsilPOS gün sonları, ay ay */
  asilposDays: readonly AsilposDaysOfMonth[];
  /**
   * Yalnız "Tümü": ModPOS'ta kalan şubelerin listeleri (otherBranchLists; bulgu 62). Verilince ayın dönemi şubelerin en
   * kısasıdır; AsilPOS satırları o güne kadar kesilmiş gelmelidir (mergeWithAsilpos, commonListCuts)
   */
  others?: readonly OtherBranchList[];
}

export interface SalesSources {
  /** Modelin satış satırları: sayılan ModPOS satırları, ardından AsilPOS ay toplamları (eksi kimlikle) */
  salesLines: SalesLine[];
  /**
   * Satırların kapsadığı son gün, ay ay (engine listPeriod): ModPOS listesinin kaydı; AsilPOS satırı olan ayda son gelen
   * AsilPOS günü (ayın son günüyse kayıt yok: ayın tamamı). Sayılmayan listenin kaydı düşer. "Tümü"de (`others`) en kısa
   * liste.
   */
  coverage: Record<string, string>;
  /**
   * "Tümü"de dönemi kısaltan şube, ay ay (bulgu 62): listesi ayın öteki satırlarından önce biten (`through`) ya da hiç
   * olmayan (`through` null: ayın satırları sayılmaz) ModPOS şubesi. Yalnız `others` verilince; yoksa boş
   */
  short: Record<string, { branchId: string; through: string | null }>;
}

/**
 * ModPOS listeleriyle AsilPOS ay toplamlarını birleştirir (her gün tek kaynak). Geçiş günü yoksa girdi olduğu gibi döner
 * (aynı satırlar, aynı sıra): AsilPOS hiçbir hesaba girmez. Geçiş günü şubenin kendi kasasınındır (çok şube): her
 * şubenin ModPOS listesi kendi geçiş gününe göre sayılır, ModPOS'ta kalan şubenin (Tuzla) listesi her ay ("Tümü"de
 * şubelerin satırları yan yana; denetim 21 Kasım #5). Görünümün kapsamı ve ilk ayı en erken geçiş gününe göre.
 */
export function mergeSalesSources(input: SalesSourcesInput): SalesSources {
  const S = earliestSwitchDay(input.switchDays);
  if (S === null) return { salesLines: input.salesLines, coverage: { ...input.coverage }, short: {} };
  const switchMonth = S.slice(0, 7);
  const kept = input.salesLines.filter((l) => modposListCounts(l.month, switchDayFor(input.switchDays, l.branchId)));
  const asilpos = input.asilposLines
    .filter((l) => l.month >= switchMonth)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month) || b.revenue - a.revenue || a.posName.localeCompare(b.posName, "tr") || (a.productId ?? 0) - (b.productId ?? 0));
  const synthetic: SalesLine[] = asilpos.map((l, i) => ({
    id: -(i + 1),
    month: l.month,
    posName: l.posName,
    qty: l.qty,
    revenue: l.revenue,
    productId: l.productId,
    isService: l.isService,
    note: null,
    asilpos: { days: l.days },
    ...(l.gross !== undefined ? { gross: l.gross } : {}),
    ...(l.isAddon !== undefined ? { isAddon: l.isAddon } : {}),
  }));
  const coverage: Record<string, string> = {};
  for (const [m, through] of Object.entries(input.coverage)) if (modposListCounts(m, S)) coverage[m] = through;
  for (const d of input.asilposDays) {
    if (d.month < switchMonth) continue;
    if (d.last >= monthEnd(`${d.month}-01`)) delete coverage[d.month];
    else coverage[d.month] = d.last;
  }
  // "Tümü": ayın dönemi şubelerin en kısa listesiyle biter (bulgu 62). ModPOS'ta kalan şubenin listesi AsilPOS'un son
  // gününden önce bitiyorsa dönem onun son günü; listesi hiç yoksa ayın satırları sayılmaz (ortak dönem yok). Önceden
  // dönem Marina'nın son AsilPOS günüydü: Tuzla'nın 15 günlük listesi iki şubenin 24 günlük sabit gideriyle düşülüyordu
  let salesLines = [...kept, ...synthetic];
  const short: SalesSources["short"] = {};
  for (const cut of commonListCuts(input.others ?? [])) {
    if (cut.through === null) {
      salesLines = salesLines.filter((l) => l.month !== cut.month);
      delete coverage[cut.month];
      short[cut.month] = { branchId: cut.branchId, through: null };
      continue;
    }
    const current = coverage[cut.month] ?? monthEnd(`${cut.month}-01`);
    if (cut.through > current) continue;
    coverage[cut.month] = cut.through;
    short[cut.month] = { branchId: cut.branchId, through: cut.through };
  }
  return { salesLines, coverage, short };
}

/**
 * "Tümü"nün kısa dönemi metni (bulgu 62), cümle (sonda nokta): "Tuzla'nın satış listesinin son günü 15 Aralık: öteki
 * şubelerin satışı da o güne kadar sayılır." Listesi yoksa: "Tuzla'nın Aralık 2026 satış listesi yok: öteki şubelerin bu
 * ayki satışı da sayılmaz (şubeyi seçince görünür)."
 */
export function commonListText(month: string, branchName: string, through: string | null): string {
  const owner = genitive(branchName);
  return through === null
    ? `${owner} ${monthLabel(month)} satış listesi yok: öteki şubelerin bu ayki satışı da sayılmaz (şubeyi seçince görünür).`
    : `${owner} satış listesinin son günü ${dayMonthTR(through)}: öteki şubelerin satışı da o güne kadar sayılır.`;
}

/**
 * "Tümü"de ortak dönemi olmayan ay (bir ModPOS şubesinin listesi yok; bulgu 62 inceleme): Genel bakış'ın "Satış raporu" işi
 * ve başlığın kaynak satırı "AsilPOS … sayılıyor" demez, satırların liste gelince sayıldığını söyler (bant da öyle).
 * `running`: süren ay (liste ay sonunda yüklenir) ya da bitmiş ay (yüklenmedi). Cümle, sonda nokta
 */
export function commonListWaitText(month: string, branchName: string, running: boolean): string {
  const owner = genitive(branchName);
  return running
    ? `Tümü'de bu ayın satışları ${owner} listesi gelince sayılır; şubeyi seçince gün gün görünür.`
    : `${owner} ${monthLabel(month)} satış listesi yüklenmedi: Tümü'de bu ayın satışları sayılmıyor (şubeyi seçince görünür).`;
}

/** Başlığın altındaki kaynak satırı, ortak dönemi olmayan ayda ("Tümü"; commonListWaitText) */
export function commonListSourceLine(branchName: string): string {
  return `Satışlar: Tümü'de ${genitive(branchName)} listesi gelince (şube seçiliyken gün gün)`;
}

/**
 * Bir ayın satış kaynakları (Satışlar ekranının bandı ve uyarıları). Geçiş gününden önceki ayda null. `today`: iş günü;
 * geçiş ayında eksik günler ancak geçiş günü geldikten sonra söylenir (öncesinde ayın ModPOS kısmı sürüyor).
 */
export function asilposMonthStatus(i: {
  month: string;
  switchDay: string;
  today: string;
  modpos: { lines: number; revenue: number; through: string } | null;
  asilpos: { days: number; last: string } | null;
  modposZ?: number | null;
  /** Listenin günlerinin kasa raporlarındaki indirim toplamı (liste indirimden öncedir; modposOverZText) */
  modposDiscounts?: number | null;
  /** Kasa raporunu bekleyen günler (süren ay; birden çok kasa bekliyorsa `tills` kasa kasa) */
  held?: AsilposSalesMonth["held"];
  /** Ayın kasa raporu olan günleri ve gelen AsilPOS gün sonları: raporlu ama gün sonu gelmemiş gün (`missing`) */
  kasaDays?: readonly string[];
  asilposDates?: readonly string[];
  /** Ayın sayılan AsilPOS günlerinin ürün satırları toplamı ve Z'si (zCheck: Σ ciro = zTotal); verilmezse denetim yok */
  linesVsZ?: readonly { date: string; lines: number; z: number }[];
}): AsilposSalesMonth | null {
  const source = monthSource(i.month, i.switchDay);
  if (source === "modpos") return null;
  const list = i.modpos && i.modpos.lines > 0 ? i.modpos : null;
  const counted = source === "gecis" && list !== null;
  const from = asilposSalesFrom(i.month, i.switchDay, counted ? list.through : null);
  let gap: AsilposSalesMonth["gap"] = null;
  let overlap: AsilposSalesMonth["overlap"] = null;
  if (source === "gecis") {
    const lastModpos = addDays(i.switchDay, -1);
    if (counted && list.through >= i.switchDay) overlap = { from: i.switchDay, to: list.through };
    if (i.today >= i.switchDay) {
      const start = counted ? addDays(list.through, 1) : `${i.month}-01`;
      if (start <= lastModpos) gap = { from: start, to: lastModpos };
    }
  }
  // Raporlu ama AsilPOS gün sonu gelmemiş günler (bugün hariç: gün sonu kapanışta gelir)
  const got = new Set(i.asilposDates ?? []);
  const missing = from === null ? [] : (i.kasaDays ?? []).filter((d) => d >= from && d < i.today && !got.has(d)).sort();
  // Listenin ilk günü: listenin günlerindeki ilk kasa raporu (Marina 13 Kasım'da açıldı); rapor yoksa ayın 1'i
  const first = list ? ((i.kasaDays ?? []).filter((d) => d.slice(0, 7) === i.month && d <= list.through).sort()[0] ?? null) : null;
  const listFirst = first && first > `${i.month}-01` ? first : null;
  return {
    month: i.month,
    source,
    from,
    asilpos: i.asilpos && i.asilpos.days > 0 ? i.asilpos : null,
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
 * 0); satır yoksa null. Satırlar çağıranın süzdüğü şubenin kasa raporlarıdır (veri kümesi: AsilPOS'un şubesi; içe aktarma:
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
  return `ModPOS listesinin ${total} ${dayRangeTR(from, through)} kasa raporlarının Z toplamından (${zText}) ${pct(net / z - 1, 0)} fazla: liste sonraki günlerin satışını da içeriyor olabilir, o günler AsilPOS'tan da sayılır. Listeyi yalnız ${dayRangeTR(from, through)} için alıp yeniden yükleyin.`;
}

export interface AsilposMonthNotes {
  /** Ayın kaynağını anlatan satır */
  info: string;
  /** Eksik günler, sayılmayan günler, sayılmayan liste, liste ↔ Z farkı, Z'yi tutmayan AsilPOS günü */
  warnings: string[];
  /**
   * Tutarlılık denetimleri (hesap sözleşmesi, 23 Kasım 2026): ModPOS listesi − indirim = Z (listenin günleri) ve AsilPOS
   * günlerinin ürün satırları = Z. `ok` tutuyor; tutmayan ModPOS satırı bilgi (%5'i aşan fark ayrıca uyarı), tutmayan
   * AsilPOS günü uyarılarda
   */
  checks: { ok: boolean; text: string }[];
}

/** Ayın tutarlılık denetimleri (asilposMonthNotes checks) ve Z'yi tutmayan AsilPOS günlerinin uyarıları */
function salesZChecks(st: AsilposSalesMonth): { checks: AsilposMonthNotes["checks"]; warnings: string[] } {
  const checks: AsilposMonthNotes["checks"] = [];
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
    if (!st.zCheck.off.length) checks.push({ ok: true, text: `AsilPOS: her günün ürün satırları Z'yi tutuyor (${st.zCheck.days} gün)` });
    for (const d of st.zCheck.off) {
      const diff = r2(d.lines - d.z);
      warnings.push(
        `${dayMonthTR(d.date)}: AsilPOS'un ürün satırlarının toplamı (${tl(d.lines, 2)}) Z'den (${tl(d.z, 2)}) ${tl(Math.abs(diff), 2)} ${diff > 0 ? "fazla" : "az"}. Satır eksik gelmiş olabilir: AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın.`,
      );
    }
  }
  return { checks, warnings };
}

/**
 * Kasa raporunu bekleyen günlerin metni: "; 11–15 Aralık kasa raporu girilince sayılır". Birden çok kasa bekliyorsa
 * ("Tümü"; `held.tills`) ve şube adı verildiyse kasa kasa: "; Kadıköy 11–15 Aralık, Marina 16–19 Aralık kasa raporu
 * girilince sayılır" (bir kasanın raporu öbürünün gününü saydırmaz)
 */
export function heldText(held: AsilposSalesMonth["held"], nameOf?: (branchId: string) => string): string {
  if (!held) return "";
  const range = held.tills?.length && nameOf ? held.tills.map((h) => `${nameOf(h.branchId)} ${dayRangeTR(h.from, h.to)}`).join(", ") : dayRangeTR(held.from, held.to);
  return `; ${range} kasa raporu girilince sayılır`;
}

/** Satışlar'ın bandı: ayın kaynağı ve sorunlar (sakin dille; çözümüyle). `nameOf`: şube adı (kasa kasa metinler) */
export function asilposMonthNotes(st: AsilposSalesMonth, switchDay: string, nameOf?: (branchId: string) => string): AsilposMonthNotes {
  const name = monthLabel(st.month).split(" ")[0];
  const warnings: string[] = [];
  const held = heldText(st.held, nameOf);
  const days = st.asilpos ? ` (${st.asilpos.days} gün geldi, son gün ${dayMonthTR(st.asilpos.last)}${held})` : "";
  const missing = st.missing?.length
    ? `${st.missing.length} günün AsilPOS gün sonu gelmedi, kasa raporu var: ${missingText(st.missing)}. Bu günlerin satışı hesapta yok; AsilPOS'ta Kasa › Geçmiş günler › o günün Z raporu › Gönder'e basın.`
    : null;
  const z = salesZChecks(st);
  if (st.source === "asilpos") {
    if (missing) warnings.push(missing);
    if (st.modpos) {
      warnings.push(
        `Bu aya yüklenmiş ModPOS listesi (${st.modpos.lines} satır) sayılmıyor: ${name} AsilPOS'tan geliyor. Silmek için "Ayı temizle".`,
      );
    }
    return {
      info: `${name} AsilPOS'tan geliyor: satışlar her gün sonunda kendiliğinden gelir${days}. ModPOS listesi yüklenmez.`,
      warnings: [...warnings, ...z.warnings],
      checks: z.checks,
    };
  }
  const first = `${st.month}-01`;
  const lastModpos = addDays(switchDay, -1);
  const info = `${name} geçiş ayı: ModPOS listesi ${dayRangeTR(first, lastModpos)}, AsilPOS ${dayAblativeTR(switchDay)} itibaren${days}.`;
  if (st.overlap) {
    const whole = st.modpos && st.modpos.through >= monthEnd(first);
    warnings.push(
      `${whole ? `${name} listesi ayın tamamını kapsıyor` : `${name} listesi ${dayMonthTR(st.modpos!.through)} gününe kadar`}: AsilPOS'un ${dayRangeTR(st.overlap.from, st.overlap.to)} günleri aynı satışları iki kez saymamak için sayılmıyor. AsilPOS'u saymak için yalnız ${dayRangeTR(first, lastModpos)} listesini yükleyin.`,
    );
  }
  if (st.gap) {
    warnings.push(
      st.modpos
        ? `${dayRangeTR(st.gap.from, st.gap.to)} satışı hiçbir kaynakta yok: ModPOS listesi ${dayMonthTR(st.modpos.through)} gününe kadar, AsilPOS ${dayAblativeTR(switchDay)} itibaren. ${dayRangeTR(first, lastModpos)} listesini yükleyin.`
        : `${dayRangeTR(st.gap.from, st.gap.to)} ModPOS satışı yüklenmedi: AsilPOS ${dayAblativeTR(switchDay)} itibaren sayılıyor. ${dayRangeTR(first, lastModpos)} listesini yükleyin.`,
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
 * verilen gün ya da o gün): ay sonrası yüklenen liste kapsam kaydını silip AsilPOS günlerini saymaz yapmasın. Öteki aylarda
 * bugünkü kural (src/lib/sales-coverage.ts coverageFor). `through`: listenin son günü (null: ayın tamamı).
 */
export function modposImportRule(month: string, switchDay: string | null, today: string, given?: string | null): { ok: true; through: string | null } | { ok: false; error: string } {
  const src = monthSource(month, switchDay);
  if (src === "asilpos") return { ok: false, error: `${monthLabel(month)} AsilPOS'tan geliyor; ModPOS listesi yüklenmez. Satışlar her gün sonunda AsilPOS'tan kendiliğinden gelir.` };
  if (src === "modpos" || switchDay === null) return { ok: true, through: coverageFor(month, today, given) };
  const max = addDays(switchDay, -1);
  const running = coverageFor(month, today, given);
  const picked = running ?? (given && /^\d{4}-\d{2}-\d{2}$/.test(given) && given.slice(0, 7) === month ? given : max);
  return { ok: true, through: picked < max ? picked : max };
}
