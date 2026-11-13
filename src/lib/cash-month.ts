/**
 * Kasa raporlarından ay bilgisi (saf; sunucu ve tarayıcı birlikte kullanır; tests/kasa-ay-bilgisi.test.ts). Personelin
 * her akşam girdiği Z raporlarından ayın açık günü, POS cirosu, indirimi, ödenmezi ve kartlı satış oranı çıkar.
 *
 * Hiçbir şey months tablosuna yazılmaz: değerler model yüklenirken hesaplanır (src/server/data/dataset.ts), yeni rapor,
 * düzeltme ya da silme sayıyı kendiliğinden değiştirir. Elle yazılan her zaman geçerlidir; boşaltılan alan kasaya döner.
 * Kasa raporları ay ortasında başladıysa (partialFrom) toplamlar ayın yalnız bir kısmını kapsar ve uygulanmaz; oran
 * yine geçerlidir. Ayrıntı: docs/KASA-RAPORU.md › Ay bilgisine aktarım.
 *
 * Şubeler (docs/SUBE.md): satırlar şubelidir. "Tümü"de açık gün günde bir kez sayılır, kaynak önceliği (gün, şube) için
 * uygulanır; elle yazılanlar şube şube çözülüp toplanır (resolveBranchMonths).
 *
 * Raporu olmayan gün yedek satırla gelebilir: LafPOS'un gün sonu (geçiş gününden sonra, G6) ya da ayar açıkken kapanmış
 * ModPOS kasa föyü (geçiş gününden önce; docs/MODPOS-API.md › Ay rakamına yedek). Yedek satır ayın rakamına girer, gün
 * yine "rapor yok" sayılır; raporlar başlamadan önceki föy günleri eksik aranmaz.
 */

import type { FieldSource, Month, MonthField, TillMonth } from "./calc/types";
import { dayRevenue } from "./cash-revenue";
import { MONTH_NAMES } from "./constants";
import { money } from "./format";
import { addDays, dayAblativeTR, dayLocativeTR, monthEnd } from "./reminders";

/** Ay bilgisine giden alanlar (kasa raporundan bunlar okunur) */
export interface TillRow {
  date: string;
  /**
   * Satırın şubesi (yükleyici hep verir: src/server/data/cash-reports.ts tillRows). "Tümü"de aynı günün iki şubesi ayrı
   * satırdır: kaynak önceliği (gün, şube) için uygulanır, açık gün ise günde bir kez sayılır (tillMonths). Şubesi olmayan
   * satır varsa (eski çağıran, test) satırlar tek şubenin sayılır
   */
  branchId?: string;
  zTotal: number;
  card: number;
  mealCard: number;
  discounts: number | null;
  offRevenue: number | null;
  /**
   * Ciroya dahil ödeme türlerinin toplamı (nakit + kart + yemek kartı + online + diğer). Ayın cirosu bununla Z
   * toplamının ödenmez / ikramı içerip içermediğini anlar ve içeriyorsa düşer (src/lib/cash-revenue.ts dayRevenue).
   * Verilmezse (eski kayıt, test) düşülmez: Z toplamı olduğu gibi ciro sayılır
   */
  payments?: number | null;
  /**
   * Yedek satırın kaynağı; yoksa kasa raporu (isReportRow). Yedek satırın rakamları aya girer, gün yine "rapor yok"
   * sayılır; aynı günde rapor > LafPOS > ModPOS (tillMonths; yükleyici zaten tek satır verir):
   * - "lafpos": kasa raporu girilmemiş LafPOS gününün yedek satırı, LafPOS'un Z'sinden (docs/LAFPOS.md › Kasa raporu,
   *   G6; yalnız geçiş gününden sonra, src/server/data/cash-reports.ts tillRows).
   * - "modpos": kasa raporu (ve LafPOS gün sonu) olmayan günün kapanmış ModPOS kasa föyü (docs/MODPOS-API.md › Ay
   *   rakamına yedek; yalnız Ayarlar'daki anahtar açıkken ve LafPOS'a geçiş gününden önce, modposTillRows). Föyde indirim
   *   olmadığı için `discounts` null.
   */
  source?: "lafpos" | "modpos";
  /** Yedek satırda fiş (adisyon) sayısı: satışsız gün sonu kapalı işaretini bozmaz (lafposSold ile aynı kural) */
  receipts?: number | null;
}

/**
 * Satır kasa raporu mu (kaynağı yok). Yedek satırlar (LafPOS gün sonu, ModPOS föyü) rapor sayılmaz: günü "girildi"
 * yapmaz, raporlu gün sayısına, son rapor gününe ve LafPOS satışlarının sınırlarına girmez (docs/MODPOS-API.md › Ay
 * rakamına yedek; G6). Raporu ayırmanın tek yolu budur: `source !== "lafpos"` gibi bir sınama üçüncü kaynağı (ModPOS)
 * rapor sanırdı
 */
export function isReportRow(r: Pick<TillRow, "source">): boolean {
  return !r.source;
}

/**
 * Föyün sayılmaya başladığı gün: ilk rapordan (ya da hiç rapor yoksa en yeni föy gününden sonraki günden) geriye,
 * föyü olan günler kesintisiz sürdükçe (satışsız kapalı gün de föydür: cash-reports.ts modposTillRow). Bundan önceki föy
 * satırları sayılmaz; föy yoksa null
 */
export function modposRunStart(modposDays: Iterable<string>, firstReport: string | null): string | null {
  const days = new Set(modposDays);
  if (!days.size) return null;
  let start = firstReport ?? addDays([...days].sort().at(-1)!, 1);
  while (days.has(addDays(start, -1))) start = addDays(start, -1);
  return start;
}

/**
 * Satırlardan, şube şube: şubenin ModPOS olmayan ilk satırı ilk raporudur, föyleri yalnız ona kesintisiz uzanan kısımla
 * sayılır (öteki şubenin raporu bir şubenin eski föylerini saydırmaz). Föyü olmayan şube listede yok
 */
function modposRunStartsOf(rows: readonly TillRow[], branchOf: (r: TillRow) => string): Map<string, string | null> {
  const starts = new Map<string, string | null>();
  for (const b of new Set(rows.filter((r) => r.source === "modpos").map(branchOf))) {
    const own = rows.filter((r) => branchOf(r) === b);
    starts.set(
      b,
      modposRunStart(
        own.filter((r) => r.source === "modpos").map((r) => r.date),
        earliest(own.filter((r) => r.source !== "modpos")),
      ),
    );
  }
  return starts;
}

/** Aynı günün önceliği: kasa raporu (0) > LafPOS gün sonu (1) > ModPOS föyü (2) */
const rankOf = (r: TillRow) => (isReportRow(r) ? 0 : r.source === "lafpos" ? 1 : 2);

/** Satırların en eski günü (boşsa null) */
const earliest = (rows: readonly TillRow[]): string | null => rows.reduce<string | null>((a, r) => (a === null || r.date < a ? r.date : a), null);

/** months tablosunun satırı: elle yazılanlar, boş = yazılmamış */
export interface MonthEntry {
  month: string;
  openDays: number | null;
  posRevenue: number | null;
  discounts: number | null;
  offRevenue: number | null;
  cardShare: number | null;
  note: string | null;
}

export const MONTH_FIELDS: readonly MonthField[] = ["openDays", "posRevenue", "discounts", "offRevenue", "cardShare"];

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Raporları aylara toplar. `through`: eksik günler bu güne kadar aranır (süren ayda dün: bugünün raporu akşam girilir;
 * girildiyse o da sayılır). `firstEver`: ilk satırın günü, kaynağı ne olursa olsun (verilmezse satırların en eskisi);
 * yalnız bir ayın satırları verilince ay ortasında başlayan ilk ay (partialFrom) buna göre tanınır.
 *
 * `firstReport`: eksik (ve kapalı işaretli) günlerin arandığı ilk gün, yani ilk kasa raporu ya da LafPOS gün sonu
 * (docs/MODPOS-API.md › Ay rakamına yedek): ModPOS föyleri raporlar başlamadan önceye uzanınca o günler "eksik rapor"
 * sayılmaz; null: hiç rapor yok, eksik gün aranmaz. Verilmezse `firstEver`, o da yoksa satırların ModPOS olmayan en
 * eskisi; ModPOS satırı yokken bu ilk satırla aynıdır, sonuç bugünküyle birebir aynı kalır. Yalnız bir ayın satırlarını
 * ModPOS'la birlikte veren çağıran bunu da vermelidir.
 *
 * `modposFrom`: raporlar başlamadan önceki föy satırları yalnız ilk rapora **kesintisiz** uzanan kısımla sayılır
 * (modposRunStart): arada föyü olmayan gün varsa ondan öncesi sayılmaz, ay ortasında başlayan ilk ay (partialFrom)
 * kesintisiz kısmın ilk günüdür. Tek tek elle çekilmiş eski bir gün ya da alınamayan bir gün ayı yanlış "tam" yapmasın;
 * eksik gün gelince öncesi kendiliğinden sayılır. Verilmezse satırlardan bulunur; yalnız bir ayın satırlarını veren
 * çağıran (Kasa'nın ay satırı) bunu bütün föylerden bulup verir (cash-reports.ts firstModposTillDay).
 *
 * Şubeler ("Tümü"; satırlar şubeliyse): kaynak önceliği (gün, şube) için, yani bir şubenin raporu öteki şubenin aynı
 * günkü föyünü ya da LafPOS gün sonunu düşürmez. Açık gün ve raporlu gün **günde bir kez** sayılır (iki şube aynı gün
 * açıkken bir gün): personel ve sabit gider bu günle oranlanır, günlük ortalama ve ay sonu öngörüsü bununla bölünür
 * (denetim HM-01, KP-03, KP-X1). Ciro, indirim ve ödenmez şubelerin toplamıdır.
 *
 * `openedOn`: şubenin açılış günü (branches.opened_on; yalnız tek şubenin satırları verilince). İlk satır bu gün ya da
 * öncesindeyse ay ortasında başlayan ilk ay yarım sayılmaz: raporlar şube açıldığından beri tam, açılış ayının ciro ve
 * açık günü kasadan gelir (denetim HM-04). Boşsa (Tuzla, "başından beri") bugünkü kural.
 */
export function tillMonths(
  rows: TillRow[],
  through: string,
  firstEver?: string | null,
  pendingLate?: Iterable<string>,
  closedDays?: Iterable<string>,
  firstReport?: string | null,
  modposFrom?: string | null,
  openedOn?: string | null,
): TillMonth[] {
  const waiting = pendingLate ? new Set(pendingLate) : null;
  // Kapalı işaretli günler eksik sayılmaz, ayrı yazılır (raporu olan gün zaten eksik değil)
  const shut = closedDays ? new Set(closedDays) : null;
  if (!rows.length) return [];
  // Şube: satırların hepsi şubeliyse kaynak önceliği ve föyün başı şube şube; değilse hepsi tek şubenin
  const branched = rows.every((r) => r.branchId !== undefined);
  const branchOf = (r: TillRow) => (branched ? r.branchId! : "");
  const slot = (r: TillRow) => `${r.date}|${branchOf(r)}`;
  // Yedek satırlar (LafPOS G6, ModPOS föyü) yalnız aynı şubenin daha öncelikli kaynağı olmayan gününde sayılır: rapor >
  // LafPOS > ModPOS (yükleyici zaten böyle verir). Aynı kaynağın aynı günkü satırları olduğu gibi kalır
  const best = new Map<string, number>();
  for (const r of rows) best.set(slot(r), Math.min(best.get(slot(r)) ?? 2, rankOf(r)));
  rows = rows.filter((r) => rankOf(r) === best.get(slot(r)));
  // Raporlar başlamadan önceki föyler: yalnız ilk rapora kesintisiz uzanan kısım (modposRunStart), şube şube. Satırlardan
  // yalnız bütün satırlar verilince bulunur; yalnız bir ayın satırlarını veren çağıran (firstReport'u veren) başını
  // kendisi verir
  if (modposFrom !== undefined) {
    if (modposFrom !== null) rows = rows.filter((r) => r.source !== "modpos" || r.date >= modposFrom);
  } else if (firstReport === undefined) {
    const starts = modposRunStartsOf(rows, branchOf);
    rows = rows.filter((r) => r.source !== "modpos" || r.date >= (starts.get(branchOf(r)) ?? ""));
  }
  if (!rows.length) return [];
  const first = firstEver ?? earliest(rows)!;
  // Şube açılış gününden beri raporluysa açılış ayı yarım değil
  const sinceOpening = openedOn != null && first <= openedOn;
  // Eksik gün araması ilk kasa raporundan (ya da LafPOS gün sonundan); hiçbiri yoksa (yalnız ModPOS föyü) aranmaz
  const searchFrom = firstReport !== undefined ? firstReport : (firstEver ?? earliest(rows.filter((r) => r.source !== "modpos")));
  const byMonth = new Map<string, TillRow[]>();
  for (const r of rows) {
    const key = r.date.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }
  return [...byMonth.keys()].sort().map((month) => {
    const list = byMonth.get(month)!.sort((a, b) => a.date.localeCompare(b.date));
    const start = `${month}-01`;
    const end = monthEnd(start);
    const reports = list.filter(isReportRow);
    const lastDate = list[list.length - 1].date;
    const from = first > start ? first : start;
    const upto = through > lastDate ? through : lastDate;
    const to = upto < end ? upto : end;
    // Gün yalnız kasa raporuyla "girildi" sayılır; yedek satırı olan gün eksik kalır (yanına "LafPOS'tan" ya da "ModPOS
    // föyünden")
    const have = new Set(reports.map((r) => r.date));
    const fromLafpos = list.filter((r) => r.source === "lafpos").map((r) => r.date);
    const fromModpos = list.filter((r) => r.source === "modpos").map((r) => r.date);
    // Kapalı işaretli günü yalnız satışlı yedek satır açar (src/lib/closed-days.ts lafposSold ile aynı kural; LafPOS gün
    // sonu da ModPOS föyü de): satışsız Z kafenin açık olduğunu göstermez, gün kapalı sayılmaya devam eder
    const sold = new Set(list.filter((r) => !isReportRow(r) && (r.zTotal > 0 || (r.receipts ?? 0) > 0)).map((r) => r.date));
    const missing: string[] = [];
    const closed: string[] = [];
    const missFrom = searchFrom === null ? null : searchFrom > from ? searchFrom : from;
    if (missFrom !== null) for (let d = missFrom; d <= to; d = addDays(d, 1)) if (!have.has(d)) (shut?.has(d) && !sold.has(d) ? closed : missing).push(d);
    const sum = (xs: TillRow[], f: (r: TillRow) => number) => r2(xs.reduce((a, r) => a + f(r), 0));
    // Ciro = Z toplamı − Z toplamının içindeki ödenmez / ikram (src/lib/cash-revenue.ts; ödenmez ciroya girmez:
    // docs/KASA-RAPORU.md › Ciro ve ödenmez). Ödeme dökümü kanıtlamayan günde Z toplamı olduğu gibi kalır
    const revenues = list.map((r) => dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }));
    const zTotalSum = sum(list, (r) => r.zTotal);
    const offInPos = r2(revenues.reduce((a, d) => a + d.offInZTotal, 0));
    const posRevenue = r2(zTotalSum - offInPos);
    const disc = list.filter((r) => r.discounts != null);
    const off = list.filter((r) => r.offRevenue != null);
    // Kart + yemek kartı (kartlı satış oranı: satış raporunun tahmini komisyonu); online ve diğer komisyonsuz. Banka POS
    // komisyonu yalnız banka kartından (yemek kartının komisyonu kendi faturasıyla; denetim E-43). Yanlış yazılmış bir
    // ödeme türü oranı %100'ün üstüne taşımasın
    const card = sum(list, (r) => r.card + r.mealCard);
    const bank = sum(list, (r) => r.card);
    const share = (v: number) => (posRevenue > 0 ? Math.min(1, Math.round((v / posRevenue) * 10_000) / 10_000) : null);
    // Gün başına bir kez: iki şubenin aynı günü bir açık gün, bir raporlu gün
    const days = (xs: TillRow[]) => new Set(xs.map((r) => r.date)).size;
    return {
      month,
      from,
      to,
      reported: days(reports),
      openDays: days(list.filter((r) => r.zTotal > 0)),
      posRevenue,
      zTotalSum,
      offInPos,
      discounts: disc.length ? sum(disc, (r) => r.discounts!) : null,
      discountDays: disc.length,
      offRevenue: off.length ? sum(off, (r) => r.offRevenue!) : null,
      offDays: off.length,
      cardShare: share(card),
      bankShare: share(bank),
      missing,
      ...(waiting ? { pending: missing.filter((d) => waiting.has(d)) } : {}),
      ...(shut ? { closed } : {}),
      partialFrom: !sinceOpening && first > start && first.slice(0, 7) === month ? first : null,
      lastDate,
      ...(fromLafpos.length ? { lafpos: fromLafpos } : {}),
      ...(fromModpos.length ? { modpos: fromModpos } : {}),
    };
  });
}

/**
 * Kasadan uygulanacak değerler (uygulanmayan null). Toplamlar (açık gün, ciro, indirim, ödenmez) ay ortasında başlayan
 * ayda ya da hiç satış yokken uygulanmaz; indirim ve ödenmez hiçbir günde girilmediyse uygulanmaz. Oran her zaman.
 */
export function kasaValues(t: TillMonth): Record<MonthField, number | null> {
  const sums = t.partialFrom === null && t.openDays > 0;
  return {
    openDays: sums ? t.openDays : null,
    posRevenue: sums ? t.posRevenue : null,
    discounts: sums ? t.discounts : null,
    offRevenue: sums ? t.offRevenue : null,
    cardShare: t.cardShare,
  };
}

/**
 * Ayın etkin bilgisi. Alan alan: elle yazılan (boş değil) → o; yoksa kasa raporlarından (uygulanıyorsa); yoksa
 * varsayılan (açık gün, ciro ve oran boş; indirim ve ödenmez 0). Kaynaklar ve kasanın değerleri ekranlar için taşınır.
 */
export function resolveMonth(month: string, entry: MonthEntry | undefined, till: TillMonth | undefined): Month {
  const values = till ? kasaValues(till) : null;
  const sources = {} as Record<MonthField, FieldSource>;
  const pick = (f: MonthField): number | null => {
    const typed = entry?.[f] ?? null;
    if (typed !== null) {
      sources[f] = "manual";
      return typed;
    }
    const fromTill = values?.[f] ?? null;
    sources[f] = fromTill !== null ? "kasa" : "none";
    return fromTill;
  };
  return {
    month,
    openDays: pick("openDays"),
    posRevenue: pick("posRevenue"),
    discounts: pick("discounts") ?? 0,
    offRevenue: pick("offRevenue") ?? 0,
    cardShare: pick("cardShare"),
    note: entry?.note ?? null,
    sources,
    kasa: till && values ? { values, till } : null,
  };
}

/**
 * Aynı ayın iki satırını birleştirir: her alanda İLK DOLU değer kazanır.
 *
 * Ay satırının anahtarı (ay, şube) olduğu için aynı ay şubesiz okumada birden çok satırla gelebilir: silme engellerinin
 * okuması (costs.ts dataMonths) yalnız "hangi ayın verisi var" diye bakar. Şube başına açılan BOŞ ay satırı (stock.ts,
 * sales.ts ensureMonth) ötekinin elle girilmiş cirosunu, açık gününü ya da notunu ezmemeli. "Tümü"nün rakamı buradan
 * değil, şube şube çözülüp toplanarak gelir (resolveBranchMonths; denetim HM-02).
 */
function mergeMonthEntries(a: MonthEntry, b: MonthEntry): MonthEntry {
  const note = a.note?.trim() ? a.note : b.note;
  return {
    month: a.month,
    // 0 gerçek bir elle girilmiş değerdir ("bu ay ödenmez yok"), bu yüzden `??` ile yalnız null atlanır
    openDays: a.openDays ?? b.openDays,
    posRevenue: a.posRevenue ?? b.posRevenue,
    discounts: a.discounts ?? b.discounts,
    offRevenue: a.offRevenue ?? b.offRevenue,
    cardShare: a.cardShare ?? b.cardShare,
    note,
  };
}

/** Ay satırları ve kasa ayları birleşir: yalnız kasa raporu olan ay da (satırı yoksa) ay seçicilerde görünür */
export function resolveMonths(entries: MonthEntry[], tills: TillMonth[]): Month[] {
  const byEntry = new Map<string, MonthEntry>();
  for (const e of entries) {
    const prev = byEntry.get(e.month);
    byEntry.set(e.month, prev ? mergeMonthEntries(prev, e) : e);
  }
  const byTill = new Map(tills.map((t) => [t.month, t]));
  return [...new Set([...byEntry.keys(), ...byTill.keys()])].sort().map((m) => resolveMonth(m, byEntry.get(m), byTill.get(m)));
}

/** Bir şubenin ay satırları (elle yazılanlar) ve kasa ayları (yalnız o şubenin satırlarıyla tillMonths) */
export interface BranchMonthInput {
  branchId: string;
  entries: MonthEntry[];
  tills: TillMonth[];
}

/**
 * "Tümü"nün ay bilgisi: her şube kendi elle yazılanı ve kasasıyla ayrı çözülür (resolveMonths), sonra toplanır. Bir
 * şubenin elle yazdığı öteki şubenin kasa cirosunu ezmez (denetim HM-02); Tümü şubelerin toplamıdır.
 *
 * - Ciro, indirim ve ödenmez: şubelerin toplamı.
 * - Açık gün: günde bir kez. Kasadan gelen şubelerin günleri birleşir (`combined`: bütün şubelerin satırlarıyla
 *   tillMonths); elle yazılan şubenin hangi günler açık olduğu bilinmediği için en büyüğü alınır.
 * - Kartlı oran: ciro ağırlıklı.
 * - Kaynak: şubelerden biri elle yazdıysa "manual", değilse biri kasadansa "kasa". Kasa bilgisi (`kasa`) `combined`'dan.
 *
 * Şube şube sonuç `byBranch`'te: "Tümü"de yazan ekran (Satışlar'ın ay formu) yazdığı şubenin ay satırını gösterir.
 */
export function resolveBranchMonths(branches: readonly BranchMonthInput[], combined: TillMonth[]): Month[] {
  const tillOf = new Map(combined.map((t) => [t.month, t]));
  const perBranch = branches.map((b) => ({ id: b.branchId, months: new Map(resolveMonths(b.entries, b.tills).map((m) => [m.month, m])) }));
  const keys = new Set([...tillOf.keys(), ...perBranch.flatMap((b) => [...b.months.keys()])]);
  return [...keys].sort().map((month) => {
    const parts = perBranch.flatMap((b): [string, Month][] => {
      const m = b.months.get(month);
      return m ? [[b.id, m]] : [];
    });
    return parts.length ? combineMonths(month, parts, tillOf.get(month)) : resolveMonth(month, undefined, tillOf.get(month));
  });
}

/** Şubelerin aynı ayı tek ay bilgisi (resolveBranchMonths) */
function combineMonths(month: string, parts: readonly [string, Month][], till: TillMonth | undefined): Month {
  const ms = parts.map(([, m]) => m);
  // Tek şubede değer olduğu gibi kalır; toplamda kuruşa yuvarlanır
  const total = (xs: number[]) => (xs.length === 1 ? xs[0] : r2(xs.reduce((a, v) => a + v, 0)));
  const sources = {} as Record<MonthField, FieldSource>;
  for (const f of MONTH_FIELDS) {
    const of = ms.map((m) => m.sources?.[f] ?? "none");
    sources[f] = of.includes("manual") ? "manual" : of.includes("kasa") ? "kasa" : "none";
  }
  const revenues = ms.flatMap((m) => (m.posRevenue === null ? [] : [m.posRevenue]));
  // Kasadan gelen açık gün bütün şubelerin günlerinin birleşimi (combined ⊇ her şubenin günleri)
  const days = ms.flatMap((m) => (m.openDays === null ? [] : [m.sources?.openDays === "kasa" && till ? Math.max(m.openDays, till.openDays) : m.openDays]));
  const weighted = ms.filter((m) => m.cardShare != null && (m.posRevenue ?? 0) > 0);
  const weight = weighted.reduce((a, m) => a + m.posRevenue!, 0);
  const cardShare =
    weighted.length > 1 && weight > 0
      ? Math.round((weighted.reduce((a, m) => a + m.cardShare! * m.posRevenue!, 0) / weight) * 10_000) / 10_000
      : (weighted[0]?.cardShare ?? ms.find((m) => m.cardShare != null)?.cardShare ?? null);
  const values = till ? kasaValues(till) : null;
  return {
    month,
    openDays: days.length ? Math.max(...days) : null,
    posRevenue: revenues.length ? total(revenues) : null,
    discounts: total(ms.map((m) => m.discounts)),
    offRevenue: total(ms.map((m) => m.offRevenue)),
    cardShare,
    note: ms.find((m) => m.note?.trim())?.note ?? null,
    sources,
    kasa: till && values ? { values, till } : null,
    byBranch: Object.fromEntries(parts),
  };
}

/**
 * Elle yazılan değer (kasadan gelen ya da boş alan null). Kaynak bilinmiyorsa (testler, Excel verisi): açık gün, ciro ve
 * oran boş değilse, indirim ve ödenmez 0 değilse elle yazılmış sayılır.
 */
export function manualOf(info: Month | undefined, f: MonthField): number | null {
  if (!info) return null;
  const v = f === "cardShare" ? (info.cardShare ?? null) : info[f];
  if (info.sources) return info.sources[f] === "manual" ? v : null;
  if (f === "discounts" || f === "offRevenue") return v ? v : null;
  return v;
}

/**
 * Ay satırında elle yazılmış bir şey kalmadı mı (boş satır silinir; ay seçicide deneme ayı kalmasın). İndirim ve
 * ödenmezin 0'ı, ayın kasa raporu yoksa boş sayılır (eski satırların varsayılan sıfırı; etkin değer zaten 0); kasa
 * raporu varsa elle yazılmış 0 kasanın toplamının yerine geçer ve satırla birlikte kaybolmamalıdır.
 */
export function monthRowEmpty(row: Omit<MonthEntry, "month">, hasTill: boolean): boolean {
  const zeroIsEmpty = (v: number | null) => v === null || (v === 0 && !hasTill);
  return row.openDays === null && row.posRevenue === null && row.cardShare === null && !row.note && zeroIsEmpty(row.discounts) && zeroIsEmpty(row.offRevenue);
}

/**
 * Eksik günler: "5, 12, 20 Kasım"; fazlası "… ve 2 gün daha" (ay değişirse her gün kendi ayıyla). `pending`: geç raporu
 * onay bekleyen günler, "12 (onay bekliyor)"
 */
export function missingText(days: string[], max = 5, pending: readonly string[] = []): string {
  if (!days.length) return "";
  const shown = days.slice(0, max);
  const sameMonth = shown.every((d) => d.slice(0, 7) === shown[0].slice(0, 7));
  const name = (d: string) => MONTH_NAMES[Number(d.slice(5, 7)) - 1];
  const mark = (d: string) => (pending.includes(d) ? " (onay bekliyor)" : "");
  const list = sameMonth
    ? `${shown.map((d) => `${Number(d.slice(8, 10))}${mark(d)}`).join(", ")} ${name(shown[0])}`
    : shown.map((d) => `${Number(d.slice(8, 10))} ${name(d)}${mark(d)}`).join(", ");
  return days.length > max ? `${list} ve ${days.length - max} gün daha` : list;
}

/**
 * "3 gün rapor yok: 5, 12, 20 Kasım. O günler açıksanız ciro ve açık gün eksik kalır." Kapalı işaretli günler ayrı
 * cümle: "2 gün kapalı işaretli: 3, 4 Kasım." (eksik gün yoksa yalnız o). Eksik günlerin yedekten sayılanları
 * söylenir: "… LafPOS'un gün sonundan sayıldı", "… ModPOS föyünden sayıldı" (docs/MODPOS-API.md › Ay rakamına yedek)
 */
export function missingSentence(t: Pick<TillMonth, "missing" | "pending" | "closed" | "lafpos" | "modpos">): string {
  const parts: string[] = [];
  const lafpos = t.lafpos ?? [];
  const modpos = t.modpos ?? [];
  // Yalnız eksik günlerin yedekten sayılanları (kapalı işaretli satışsız yedek gün burada sayılmaz)
  const fromLafpos = t.missing.filter((d) => lafpos.includes(d)).length;
  const fromModpos = t.missing.filter((d) => modpos.includes(d)).length;
  const covered = fromLafpos + fromModpos;
  if (t.missing.length) {
    const src = fromLafpos && fromModpos ? "LafPOS'un gün sonundan ve ModPOS API'den" : fromModpos ? "ModPOS API'den" : "LafPOS'un gün sonundan";
    const counted =
      fromLafpos && fromModpos ? `${fromLafpos} günün cirosu LafPOS'un gün sonundan, ${fromModpos} günün cirosu ModPOS API'den` : `${covered} günün cirosu ${src}`;
    const tail =
      covered === t.missing.length
        ? `Ciro ve açık gün bu günlerde ${src} sayıldı.`
        : covered
          ? `${counted} sayıldı; ötekiler açıksanız ciro ve açık gün eksik kalır.`
          : "O günler açıksanız ciro ve açık gün eksik kalır.";
    parts.push(`${t.missing.length} gün rapor yok: ${missingText(t.missing, 5, t.pending)}. ${tail}`);
  }
  if (t.closed?.length) parts.push(closedSentence(t.closed));
  return parts.join(" ");
}

/** "2 gün kapalı işaretli: 3, 4 Kasım." */
export function closedSentence(days: readonly string[]): string {
  return `${days.length} gün kapalı işaretli: ${missingText([...days])}.`;
}

/**
 * "Kasa raporları 20 Ekim'de başladı; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan."
 * İlk satır ModPOS föyüyse (ay rakamına yedek; föyler dünden geriye doğru tamamlanırken, docs/MODPOS-API.md › Kota ve
 * çekme sırası): "ModPOS föyleri 12 Eylül'den itibaren var; …"
 */
export function partialSentence(t: Pick<TillMonth, "partialFrom" | "modpos">): string {
  return `${partialHead(t)}; bu ayın ciro, açık gün, indirim ve ödenmezi elle girilir. Kartlı oran kasadan.`;
}

/** Ay ortasında başlayan ilk ayın başı: kasa raporları ya da (ilk satır föyse) ModPOS föyleri */
function partialHead(t: Pick<TillMonth, "partialFrom" | "modpos">): string {
  const p = t.partialFrom!;
  return t.modpos?.includes(p) ? `ModPOS API verileri ${dayAblativeTR(p)} itibaren var` : `Kasa raporları ${dayLocativeTR(p)} başladı`;
}

/**
 * Kasa sayfasındaki tek satır: ayın açık günü ve cirosu nereden geliyor (Satışlar'a bağlantının metni). Ayın kasa
 * raporu yoksa null. Ayda ModPOS föyünden sayılan gün varsa söylenir: "… kasa raporlarından (15 gün ModPOS föyünden
 * sayıldı)"; ayın bütün satırları föyse "… ModPOS föyünden" (docs/MODPOS-API.md › Ay rakamına yedek).
 */
export function kasaMonthLine(info: Month | undefined): string | null {
  const t = info?.kasa?.till;
  if (!info || !t) return null;
  if (t.partialFrom) return `${partialHead(t)}; bu ayın açık gün ve cirosu elle girilir`;
  const foy = t.modpos?.length ?? 0;
  const onlyFoy = foy > 0 && !t.reported && !t.lafpos?.length;
  const fromTill = onlyFoy ? "ModPOS API'den" : foy ? `kasa raporlarından (${foy} gün ModPOS API'den sayıldı)` : "kasa raporlarından";
  const inTill = onlyFoy ? "ModPOS API'de" : "kasa raporlarında";
  const days = info.sources?.openDays;
  const pos = info.sources?.posRevenue;
  // Ciro kasadan geliyorsa ve Z toplamlarının içinden ödenmez düştüyse söylenir (docs/KASA-RAPORU.md › Ciro ve ödenmez)
  const off = pos === "kasa" && t.offInPos ? ` (ödenmez / ikram ${money(t.offInPos)} düşüldü)` : "";
  if (days === "kasa" && pos === "kasa") return `Bu ayın açık gün ve cirosu ${fromTill}${off}`;
  const k = info.kasa!.values;
  if (days === "manual" && pos === "manual") {
    return k.openDays !== null && k.posRevenue !== null
      ? `Bu ayın açık gün ve cirosu elle girildi (${inTill} ${k.openDays} gün, ${money(k.posRevenue)}${foy && !onlyFoy ? `; ${foy} günü ModPOS API'den` : ""})`
      : "Bu ayın açık gün ve cirosu elle girildi";
  }
  if (days === "kasa") return `Bu ayın açık günü ${fromTill}, cirosu elle girildi`;
  if (pos === "kasa") return `Bu ayın cirosu ${fromTill}${off}, açık günü elle girildi`;
  return `Bu ay ${inTill} satış yok; açık gün ve ciro elle girilir`;
}
