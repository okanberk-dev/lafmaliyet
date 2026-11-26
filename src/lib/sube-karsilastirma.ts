// Şube karşılaştırma (Raporlar › Şubeler; docs/RAPORLAR.md): seçilen aylar için şubeler yan yana. Saf: rakamları
// yükleyici verir (src/server/data/raporlar.ts), her biri başka bir ekranın rakamıdır (Gelir-gider'in ay hesabı, Zayi &
// ikram'ın ay özeti, kasa raporları); burada yalnız toplanır ve orana çevrilir. Testi tests/sube-karsilastirma.test.ts.

/** Bir şubenin bir ayı. "Bilinmiyor" null'dır, sıfır değildir (ciro girilmemiş ay, fiş sayısı yazılmamış gün) */
export interface BranchMonthFigures {
  /** Kasa cirosu, KDV dahil, ödenmez / ikram hariç (Gelir-gider'in ciro hücresi); girilmediyse null */
  revenue: number | null;
  /** Kârın ve oranların cirosu, KDV hariç (Gelir-gider: kasa + online); yoksa null */
  revenueNet: number | null;
  /** Açık gün (Gelir-gider); bilinmiyorsa null */
  openDays: number | null;
  /** Mal maliyeti (KDV hariç; şubede satışından reçeteye göre) */
  cogs: number;
  /** Personel gideri (işveren maliyeti; Gelir-gider'in personel bölümü) */
  labor: number;
  /** Mal maliyeti ve bütün giderler */
  expenses: number;
  profit: number;
  /** Z'deki ödenmez / ikram tutarı (menü fiyatıyla); girilmediyse null */
  offRevenue: number | null;
  /** Z'deki indirim; girilmediyse null */
  discounts: number | null;
  /** Kayıtlı zayinin ve ikramın malzeme maliyeti (Zayi & ikram'ın ay özeti) */
  zayiCost: number;
  ikramCost: number;
  /** Kasa raporlarının kasa farkı toplamı (eksik eksi, fazla artı) ve rapor girilen gün; rapor yoksa null ve 0 */
  cashDiff: number | null;
  cashDiffDays: number;
  /** Fiş (adisyon) sayısı ve o günlerin cirosu: sepet yalnız fişi bilinen günlerden */
  receipts: number | null;
  receiptRevenue: number;
}

export const EMPTY_FIGURES: BranchMonthFigures = {
  revenue: null,
  revenueNet: null,
  openDays: null,
  cogs: 0,
  labor: 0,
  expenses: 0,
  profit: 0,
  offRevenue: null,
  discounts: null,
  zayiCost: 0,
  ikramCost: 0,
  cashDiff: null,
  cashDiffDays: 0,
  receipts: null,
  receiptRevenue: 0,
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** null'lar atlanarak toplam; hepsi null ise null (bilinmeyen sıfır sayılmaz) */
function sumKnown(xs: readonly (number | null)[]): number | null {
  const known = xs.filter((x): x is number => x !== null);
  return known.length ? r2(known.reduce((a, b) => a + b, 0)) : null;
}

/** Ayların toplamı (dönem sütunu) ya da şubelerin toplamı */
export function sumFigures(list: readonly BranchMonthFigures[]): BranchMonthFigures {
  const of = (k: keyof BranchMonthFigures) => list.map((f) => f[k] as number | null);
  const total = (k: keyof BranchMonthFigures) => r2(list.reduce((a, f) => a + ((f[k] as number | null) ?? 0), 0));
  return {
    revenue: sumKnown(of("revenue")),
    revenueNet: sumKnown(of("revenueNet")),
    openDays: sumKnown(of("openDays")),
    cogs: total("cogs"),
    labor: total("labor"),
    expenses: total("expenses"),
    profit: total("profit"),
    offRevenue: sumKnown(of("offRevenue")),
    discounts: sumKnown(of("discounts")),
    zayiCost: total("zayiCost"),
    ikramCost: total("ikramCost"),
    cashDiff: sumKnown(of("cashDiff")),
    cashDiffDays: total("cashDiffDays"),
    receipts: sumKnown(of("receipts")),
    receiptRevenue: total("receiptRevenue"),
  };
}

export type CompareFormat = "tl" | "pct" | "int";

export interface CompareRowDef {
  key: string;
  label: string;
  format: CompareFormat;
  /** Satırın açıklaması (⚠ değil, bilgi): rakam hangi ekranın rakamı */
  hint: string;
  /** Küçük olan mı iyi (gider, oran, fark); "en iyi" işareti buna göre. Yönü olmayan satırda undefined */
  better?: "high" | "low" | "zero";
  value: (f: BranchMonthFigures) => number | null;
}

const share = (num: number | null, den: number | null): number | null => (num === null || !den || den <= 0 ? null : num / den);

/** Karşılaştırmanın satırları, ekranda bu sırayla */
export const COMPARE_ROWS: readonly CompareRowDef[] = [
  { key: "ciro", label: "Ciro (KDV dahil)", format: "tl", better: "high", hint: "Gelir-gider'in kasa cirosu: KDV dahil, ödenmez / ikram hariç", value: (f) => f.revenue },
  { key: "acik-gun", label: "Açık gün", format: "int", hint: "Gelir-gider'in açık günü", value: (f) => f.openDays },
  { key: "gunluk", label: "Açık gün başına ciro", format: "tl", better: "high", hint: "Ciro ÷ açık gün", value: (f) => share(f.revenue, f.openDays) },
  { key: "fis", label: "Fiş sayısı", format: "int", better: "high", hint: "Kasa satırlarındaki fiş (adisyon) sayısı; yazılmayan gün sayılmaz", value: (f) => f.receipts },
  {
    key: "sepet",
    label: "Ortalama sepet",
    format: "tl",
    better: "high",
    hint: "Fişi bilinen günlerin cirosu ÷ fiş sayısı",
    value: (f) => (f.receipts ? r2(f.receiptRevenue / f.receipts) : null),
  },
  { key: "kasa-farki", label: "Kasa farkı", format: "tl", better: "zero", hint: "Kasa raporlarının kasa farkı toplamı (eksik eksi, fazla artı)", value: (f) => f.cashDiff },
  { key: "ikram", label: "Ödenmez / ikram (Z)", format: "tl", better: "low", hint: "Z'deki ödenmez / ikram tutarı, menü fiyatıyla", value: (f) => f.offRevenue },
  { key: "ikram-oran", label: "Ödenmez / ciro", format: "pct", better: "low", hint: "Ödenmez / ikram ÷ ciro (KDV dahil)", value: (f) => share(f.offRevenue, f.revenue) },
  { key: "indirim", label: "İndirim (Z)", format: "tl", better: "low", hint: "Z'deki indirim toplamı; girilmeyen gün sayılmaz", value: (f) => f.discounts },
  { key: "zayi", label: "Zayi (malzeme maliyeti)", format: "tl", better: "low", hint: "Zayi & ikram'ın ay özeti: kayıtlı zayinin malzeme maliyeti, KDV hariç", value: (f) => f.zayiCost },
  { key: "ikram-maliyet", label: "İkram (malzeme maliyeti)", format: "tl", better: "low", hint: "Zayi & ikram'ın ay özeti: ikramın malzeme maliyeti, KDV hariç", value: (f) => f.ikramCost },
  { key: "ciro-net", label: "Ciro (KDV hariç)", format: "tl", better: "high", hint: "Gelir-gider'in kâra giren cirosu", value: (f) => f.revenueNet },
  { key: "mal", label: "Mal maliyeti", format: "tl", better: "low", hint: "Gelir-gider: şubenin satışından reçeteye göre", value: (f) => f.cogs },
  { key: "mal-oran", label: "Mal maliyeti / ciro", format: "pct", better: "low", hint: "Mal maliyeti ÷ ciro (KDV hariç)", value: (f) => share(f.cogs, f.revenueNet) },
  { key: "iscilik", label: "İşçilik", format: "tl", better: "low", hint: "Gelir-gider'in personel giderleri (işveren maliyeti)", value: (f) => f.labor },
  { key: "iscilik-oran", label: "İşçilik / ciro", format: "pct", better: "low", hint: "İşçilik ÷ ciro (KDV hariç)", value: (f) => share(f.labor, f.revenueNet) },
  { key: "gider", label: "Giderler (mal dahil)", format: "tl", better: "low", hint: "Gelir-gider'in toplam gideri; işletme geneli giderler şubeye bölünmez", value: (f) => f.expenses },
  { key: "kar", label: "Kâr / zarar", format: "tl", better: "high", hint: "Gelir-gider: ciro (KDV hariç) − giderler", value: (f) => (f.revenueNet === null ? null : f.profit) },
  { key: "kar-oran", label: "Kâr / ciro", format: "pct", better: "high", hint: "Kâr ÷ ciro (KDV hariç)", value: (f) => (f.revenueNet === null ? null : share(f.profit, f.revenueNet)) },
];

export interface CompareBranchInput {
  id: string;
  name: string;
  /** Ay (YYYY-MM) → rakamlar; ayı olmayan şube o ay boş (EMPTY_FIGURES) */
  months: Readonly<Record<string, BranchMonthFigures>>;
}

export interface CompareCell {
  value: number | null;
  /** Yönü olan satırda en iyi şube (en az iki şubenin rakamı biliniyorsa ve eşit değillerse) */
  best: boolean;
}

export interface CompareRow {
  def: CompareRowDef;
  /** Şubelerin sırasıyla */
  cells: CompareCell[];
}

export interface ComparePeriod {
  /** "YYYY-MM" ya da dönem toplamı için "toplam" */
  key: string;
  rows: CompareRow[];
}

function bestIndex(def: CompareRowDef, values: readonly (number | null)[]): number {
  if (!def.better) return -1;
  const known = values.flatMap((v, i) => (v === null ? [] : [{ v, i }]));
  if (known.length < 2) return -1;
  const score = (v: number) => (def.better === "high" ? v : def.better === "low" ? -v : -Math.abs(v));
  const sorted = [...known].sort((a, b) => score(b.v) - score(a.v));
  return Math.abs(score(sorted[0].v) - score(sorted[1].v)) < 0.005 ? -1 : sorted[0].i;
}

function periodRows(figures: readonly BranchMonthFigures[]): CompareRow[] {
  return COMPARE_ROWS.map((def) => {
    const values = figures.map((f) => def.value(f));
    const best = bestIndex(def, values);
    return { def, cells: values.map((value, i) => ({ value, best: i === best })) };
  });
}

/**
 * Karşılaştırma: önce dönemin toplamı (birden çok ay seçiliyse), sonra aylar yeniden eskiye. Oranlar toplamların
 * oranıdır (ayların oranlarının ortalaması değil)
 */
export function branchCompare(branches: readonly CompareBranchInput[], months: readonly string[]): ComparePeriod[] {
  const at = (b: CompareBranchInput, m: string) => b.months[m] ?? EMPTY_FIGURES;
  const out: ComparePeriod[] = [];
  if (months.length > 1) out.push({ key: "toplam", rows: periodRows(branches.map((b) => sumFigures(months.map((m) => at(b, m))))) });
  for (const m of [...months].sort().reverse()) out.push({ key: m, rows: periodRows(branches.map((b) => at(b, m))) });
  return out;
}

/** Seçilebilen dönem uzunlukları (ay) */
export const COMPARE_SPANS = [1, 3, 6, 12] as const;

/** `last` ayında biten `span` ay, eskiden yeniye ("2026-11", 3 → Eylül, Ekim, Kasım) */
export function monthsEnding(last: string, span: number): string[] {
  const [y, m] = last.split("-").map(Number);
  const out: string[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** URL'deki ?sure= değeri (1, 3, 6, 12); geçersizse 3 */
export function spanParam(raw: string | string[] | undefined): (typeof COMPARE_SPANS)[number] {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (COMPARE_SPANS as readonly number[]).includes(v) ? (v as (typeof COMPARE_SPANS)[number]) : 3;
}
