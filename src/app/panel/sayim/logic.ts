/**
 * Sayım sayfasının saf hesapları: sunucu sayfası, istemci formu, sunucu eylemi ve testler aynı kuralı kullanır.
 * Burada veritabanı ya da tarayıcı yok.
 */
import { shiftMonth } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { closingLayers, layersValue, type StockLayer } from "@/lib/calc/fifo";

export { invoiceLayer, layerText } from "@/lib/calc/fifo";
import { businessDate } from "@/lib/cash-report";
import { COUNT_GROUP_VAT_DEFAULT } from "@/lib/constants";
import { dateTimeTR, monthLabel, num, tl } from "@/lib/format";
import { isLastDayOfMonth } from "@/lib/reminders";

// ---------------------------------------------------------------- Hangi ay açılsın?

/** Ay başında bu kadar gün geçen ayın sayımı hâlâ "girilecek sayım" sayılır */
export const COUNT_GRACE_DAYS = 10;

/** Türkiye saatine göre bugün (YYYY-MM-DD) */
export function todayTR(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Sayım sayfası adreste ay yokken hangi ayı açsın: ay sonu sayımı ayın son günü kapanıştan sonra yapılır, çoğu
 * zaman ertesi sabah girilir. Gün kasanın iş günüdür (gece 05:00'te döner: 31 Ekim 23:50'de başlayan sayım 00:10'da
 * da Ekim'dir). Ayın ilk 10 gününde geçen ayın sayımı tamamlanmamışsa (`isComplete`: countComplete; yarım sayım da
 * tamam değildir) geçen ay, yoksa bu ay açılır. Sayfa çözülen ayı adrese yazar: kayıttan sonraki yenileme ayı
 * değiştiremez.
 */
export function defaultCountMonth(now: Date, isComplete: (month: string) => boolean, graceDays = COUNT_GRACE_DAYS): string {
  const today = businessDate(now);
  const month = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const prev = shiftMonth(month, -1);
  return day <= graceDays && !isComplete(prev) ? prev : month;
}

// ---------------------------------------------------------------- Sayım tamam mı (tek kural)

export interface CountStatus {
  /** Sayılan liste kalemi (arşiv satırları hariç) */
  counted: number;
  /** Ayın sayım listesindeki kalem (arşiv satırları hariç; engine.ts stockSheet listesi) */
  total: number;
  /** Listelenen, arşivsiz kalemlerin hepsi sayıldı */
  complete: boolean;
}

/**
 * Ayın sayımı nerede: sayım ekranı, grup kartları, Sayım düzeni şeridi, Genel bakış'ın "Bu ayın işleri" ve sayfanın
 * varsayılan ayı aynı kuralı kullanır (Bugün'ün sunucu sayımı da: src/server/data/today.ts countProgress). Tek satır
 * kaydedilmiş ay "tamam" değildir: sayılmayan kalemler ay sonu stoğunda 0 sayılır.
 */
export function countStatus(sheet: { groups: { lines: { archived: boolean; qty: number | null }[] }[] }): CountStatus {
  let counted = 0;
  let total = 0;
  for (const g of sheet.groups)
    for (const l of g.lines) {
      if (l.archived) continue;
      total++;
      if (l.qty !== null) counted++;
    }
  return { counted, total, complete: total > 0 && counted >= total };
}

/** countStatus(sheet).complete */
export const countComplete = (sheet: Parameters<typeof countStatus>[0]) => countStatus(sheet).complete;

// ---------------------------------------------------------------- Canlı stok toplamı

export interface CountLineValue {
  id: number;
  /** Kayıtlı miktar (sayım biriminde) */
  qty: number | null;
  /** Kayıtlı sayımın birimindeki fiyat (KDV hariç) */
  unitPrice: number;
  /** Bugünkü sayım birimindeki fiyat: yeni ya da değişen miktar bununla kaydedilir */
  unitPriceNow: number;
  vatRate: number;
  /** Malzeme artık sayım listesinde değil (pasif / Sayılmaz): miktarı değiştirilemez, kayıtlı değer kalır */
  archived: boolean;
  /** Kayıtlı sayımın tutarı (sunucunun hesabı; FIFO'da katmanların toplamı). Yoksa miktar × unitPrice */
  amount?: number;
  /**
   * FIFO havuzu (yalnız yönetici; en yeniden eskiye, hammaddenin kendi biriminde). Boş ya da yoksa satır ay sonu
   * fiyatıyla değerlenir. Değişen miktar bu havuzdan, sunucunun kuralıyla (engine.ts fifoLayers) değerlenir
   */
  pool?: StockLayer[];
  /** Havuzun yetmediği kısmın fiyatı (ay sonu fiyatı, hammaddenin kendi biriminde) */
  fallbackUnit?: number;
  /** Kayıtlı sayımın birim çarpanı (KG → 1000) ve bugünkü sayım biriminin çarpanı */
  factor?: number;
  factorNow?: number;
}

/** Satırın miktarı değişmedi (ya da arşivde): kayıtlı değer ve birim geçerli */
const unchanged = (line: CountLineValue, value: number | null) => line.archived || (line.qty !== null && value === line.qty);

/** FIFO satırı mı (yönetici için havuzu gelmiş) */
export const isFifoLine = (line: CountLineValue) => (line.pool?.length ?? 0) > 0;

/**
 * Satırın katmanları, sunucunun kuralıyla: miktar sayım biriminden hammaddenin birimine çevrilir (kayıtlı miktar
 * sayıldığı birimle, yeni ya da değişen miktar bugünkü birimle) ve havuzdan en yeniden geriye alınır. FIFO satırı
 * değilse boş.
 */
export function lineLayers(line: CountLineValue, value: number | null): StockLayer[] {
  if (!isFifoLine(line) || value === null || !Number.isFinite(value) || value <= 0) return [];
  const factor = (unchanged(line, value) ? line.factor : line.factorNow) ?? 1;
  return closingLayers(value * factor, line.pool!, line.fallbackUnit ?? 0).layers;
}

/**
 * Satırın tutarı (KDV hariç), sunucunun kaydetme kuralıyla aynı: miktar aynı kaldıkça (ya da arşivde) kayıtlı tutar;
 * değişen miktar FIFO satırında havuzdan (eski katmanlara taşar, kalan ay sonu fiyatıyla), diğerlerinde × bugünkü
 * birim fiyat. Kaydedilince sunucunun hesapladığı tutar budur.
 */
export function lineAmount(line: CountLineValue, value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0;
  if (unchanged(line, value)) return line.amount ?? value * line.unitPrice;
  if (isFifoLine(line)) return layersValue(lineLayers(line, value));
  return value * line.unitPriceNow;
}

/** Yüzdenin iyelik eki, okunuşuna göre: "%86'sı", "%14'ü", "%100'ü", "%0'ı" (kapsam satırı) */
export function coverageText(share: number): string {
  return percentText(Math.round(Math.max(0, Math.min(1, share)) * 100));
}

/** Payın ve kalanın metni: yüzde bir kez yuvarlanır, kalan 100'e tamamlar (%13 + %87; ayrı yuvarlamada %13 + %88) */
export function coverageSplit(share: number): { covered: string; rest: string } {
  const n = Math.round(Math.max(0, Math.min(1, share)) * 100);
  return { covered: percentText(n), rest: percentText(100 - n) };
}

function percentText(n: number): string {
  const ones = ["ı", "i", "si", "ü", "ü", "i", "sı", "si", "i", "u"];
  const tens = ["", "u", "si", "u", "ı", "si", "ı", "i", "i", "ı"];
  const suffix = n === 100 ? "ü" : n % 10 ? ones[n % 10] : n === 0 ? "ı" : tens[n / 10];
  return `%${n}'${suffix}`;
}

/**
 * Satırın birim fiyatı, sunucunun kaydetme kuralıyla aynı: kayıtlı miktar aynı kaldıkça (ya da satır arşivdeyse)
 * sayıldığı andaki birimle, yeni ya da değişen miktar bugünkü sayım birimiyle.
 */
export function linePrice(line: CountLineValue, value: number | null): number {
  if (isFifoLine(line) && value) return lineAmount(line, value) / value;
  if (line.archived) return line.unitPrice;
  return line.qty !== null && value === line.qty ? line.unitPrice : line.unitPriceNow;
}

export interface GroupTotals {
  name: string;
  /** KDV hariç */
  total: number;
  /** Her malzemenin Hammaddeler'deki Alış KDV'siyle */
  totalVat: number;
  /** Excel Sayım usulü: grubun tek KDV oranıyla (N = L × M + L) */
  totalVatExcel: number;
}

export interface LiveTotals {
  groups: GroupTotals[];
  extrasTotal: number;
  total: number;
  totalVat: number;
  totalVatExcel: number;
}

/**
 * Formda yazılan miktarlarla stok toplamı. Hiçbir şey değişmemişken `model.stockSheet(month)` ile aynı sonucu verir
 * (engine: miktar × birim fiyat, KDV dahil = × (1 + Alış KDV), ek kalemler × 1,01).
 */
export function liveTotals(
  groups: { name: string; excelRate: number; lines: CountLineValue[] }[],
  valueOf: (line: CountLineValue) => number | null,
  extras: { qty: number | null; unitPrice: number | null }[],
  extrasRate = COUNT_GROUP_VAT_DEFAULT,
): LiveTotals {
  const gs = groups.map((g) => {
    let total = 0;
    let totalVat = 0;
    for (const l of g.lines) {
      const v = l.archived ? l.qty : valueOf(l);
      if (v === null || !Number.isFinite(v)) continue;
      const amount = lineAmount(l, v);
      total += amount;
      totalVat += amount * (1 + l.vatRate);
    }
    return { name: g.name, total, totalVat, totalVatExcel: total * (1 + g.excelRate) };
  });
  const extrasTotal = extras.reduce((a, e) => a + (e.qty ?? 0) * (e.unitPrice ?? 0), 0);
  const sumOf = (k: keyof Omit<GroupTotals, "name">) => gs.reduce((a, g) => a + g[k], 0);
  return {
    groups: gs,
    extrasTotal,
    total: sumOf("total") + extrasTotal,
    totalVat: sumOf("totalVat") + extrasTotal * (1 + extrasRate),
    totalVatExcel: sumOf("totalVatExcel") + extrasTotal * (1 + extrasRate),
  };
}

// ---------------------------------------------------------------- Listede olmayanlar (ek kalemler)

/** Ek kalemin kimliği: ad (boşluklar sadeleşir, büyük-küçük harf fark etmez) + birim */
export function extraKey(name: string, unit: string): string {
  const n = name.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
  const u = (unit.trim() || "ADET").toLocaleUpperCase("tr-TR");
  return `${n}|${u}`;
}

export interface SavedExtra {
  id: number;
  month: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
}

export interface StaffExtraInput {
  name: string;
  unit: string;
  qty: number;
}

export interface StaffExtraPlan {
  updates: { id: number; qty: number }[];
  deletes: number[];
  inserts: { name: string; unit: string; qty: number; unitPrice: number }[];
}

/**
 * Personelin "Listede olmayanlar" kaydı. Personel fiyat görmez ve değiştiremez:
 * - Aynı ad + birimle kayıtlı satırın yalnızca miktarı güncellenir (fiyatı kalır).
 * - Yeni satırın fiyatı, aynı kalemin önceki aylardaki en son fiyatından gelir; hiç yoksa 0 (yönetici girer).
 * - Fiyatı girilmemiş satırı personel silebilir; fiyatlı satırı silemez (rafta kalmadıysa miktarı 0 yazılır).
 * `history` önceki ayların ek kalemleri (bu ay hariç).
 */
export function planStaffExtras(
  existing: SavedExtra[],
  incoming: StaffExtraInput[],
  history: SavedExtra[],
): { ok: true; plan: StaffExtraPlan } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const e of incoming) {
    const k = extraKey(e.name, e.unit);
    if (seen.has(k)) return { ok: false, error: `"${e.name.trim()}" iki kez yazılmış; miktarları tek satırda toplayın.` };
    seen.add(k);
  }
  // Aynı kalemin en son (en yeni ay, en son kayıt) fiyatı
  const lastPrice = new Map<string, { month: string; id: number; price: number }>();
  for (const h of history) {
    if (!(h.unitPrice > 0)) continue;
    const k = extraKey(h.name, h.unit);
    const cur = lastPrice.get(k);
    if (!cur || h.month > cur.month || (h.month === cur.month && h.id > cur.id)) lastPrice.set(k, { month: h.month, id: h.id, price: h.unitPrice });
  }
  const pool = [...existing].sort((a, b) => a.id - b.id);
  const used = new Set<number>();
  const plan: StaffExtraPlan = { updates: [], deletes: [], inserts: [] };
  for (const e of incoming) {
    const k = extraKey(e.name, e.unit);
    const match = pool.find((x) => !used.has(x.id) && extraKey(x.name, x.unit) === k);
    if (match) {
      used.add(match.id);
      if (match.qty !== e.qty) plan.updates.push({ id: match.id, qty: e.qty });
    } else {
      plan.inserts.push({
        name: e.name.trim().replace(/\s+/g, " "),
        unit: (e.unit.trim() || "ADET").toLocaleUpperCase("tr-TR"),
        qty: e.qty,
        unitPrice: lastPrice.get(k)?.price ?? 0,
      });
    }
  }
  for (const x of pool) {
    if (used.has(x.id)) continue;
    if (x.unitPrice > 0)
      return { ok: false, error: `"${x.name}" fiyatı girilmiş bir kalem; yalnızca yönetici silebilir. Rafta kalmadıysa miktarını 0 yazın.` };
    plan.deletes.push(x.id);
  }
  return { ok: true, plan };
}

/**
 * Ek kalem listesinin imzası: ad + birim + miktar (fiyat yok: personel görmez). Form kaydederken gördüğü listenin
 * imzasını gönderir; sunucu kayıtlı listeninkiyle karşılaştırır, arada başkası kaydettiyse yazmaz (sayım satırlarındaki
 * `base` denetiminin ek kalem karşılığı).
 */
export function extrasBase(rows: { name: string; unit: string; qty: number }[]): string {
  return rows
    .map((r) => `${extraKey(r.name, r.unit)}=${Math.round(r.qty * 1000) / 1000}`)
    .sort()
    .join(";");
}

export interface AdminExtraInput {
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
}

/**
 * Yöneticinin "Listede olmayanlar" kaydı: ayı silip yeniden yazmaz, kalemleri ad + birimle eşler. Kayıtlı satır
 * değiştiyse güncellenir (kimliği kalır), yeni satır eklenir, yalnız yöneticinin formdan kaldırdığı satır silinir.
 */
export function planAdminExtras(
  existing: SavedExtra[],
  incoming: AdminExtraInput[],
): { ok: true; plan: { updates: (AdminExtraInput & { id: number })[]; deletes: number[]; inserts: AdminExtraInput[] } } | { ok: false; error: string } {
  const seen = new Set<string>();
  for (const e of incoming) {
    const k = extraKey(e.name, e.unit);
    if (seen.has(k)) return { ok: false, error: `"${e.name.trim()}" iki kez yazılmış; miktarları tek satırda toplayın.` };
    seen.add(k);
  }
  const pool = [...existing].sort((a, b) => a.id - b.id);
  const used = new Set<number>();
  const plan = { updates: [] as (AdminExtraInput & { id: number })[], deletes: [] as number[], inserts: [] as AdminExtraInput[] };
  for (const e of incoming) {
    const row = { name: e.name.trim().replace(/\s+/g, " "), unit: (e.unit.trim() || "ADET").toLocaleUpperCase("tr-TR"), qty: e.qty, unitPrice: e.unitPrice };
    const match = pool.find((x) => !used.has(x.id) && extraKey(x.name, x.unit) === extraKey(e.name, e.unit));
    if (!match) {
      plan.inserts.push(row);
      continue;
    }
    used.add(match.id);
    if (match.name !== row.name || match.unit !== row.unit || match.qty !== row.qty || match.unitPrice !== row.unitPrice) plan.updates.push({ id: match.id, ...row });
  }
  for (const x of pool) if (!used.has(x.id)) plan.deletes.push(x.id);
  return { ok: true, plan };
}

/**
 * Sunucudan yeni ek kalem listesi gelince (başkası kaydetti, sayfa yenilendi) formdakini birleştirir, sayım
 * satırlarındaki mergeCounts gibi: kişinin dokunmadığı kalem yeni değeri alır, başkasının eklediği kalem gelir,
 * başkasının sildiği ve kişinin dokunmadığı kalem gider. İki tarafın da değiştirdiği kalemde kişininki kalır ve adı
 * "çakışma" olarak döner (kaydederse başkasınınkinin yerine geçeceğini bilsin). Adı boş satır olduğu gibi kalır.
 */
export function mergeExtras<T extends { name: string; unit: string }>(
  mine: T[],
  before: T[],
  after: T[],
  same: (a: T, b: T) => boolean,
): { extras: T[]; conflicts: string[] } {
  const key = (e: T) => extraKey(e.name, e.unit);
  const was = new Map(before.map((e) => [key(e), e]));
  const now = new Map(after.map((e) => [key(e), e]));
  const out: T[] = [];
  const conflicts: string[] = [];
  const seen = new Set<string>();
  for (const m of mine) {
    if (!m.name.trim()) {
      out.push(m);
      continue;
    }
    const k = key(m);
    seen.add(k);
    const b = was.get(k);
    const a = now.get(k);
    if (!b && !a) out.push(m);
    else if (b && !a) {
      // Başkası sildi: dokunulmadıysa gider
      if (!same(m, b)) {
        conflicts.push(m.name.trim());
        out.push(m);
      }
    } else if (!b && a) {
      // İkisi de ekledi
      if (!same(m, a)) conflicts.push(m.name.trim());
      out.push(m);
    } else if (same(b!, a!)) out.push(m);
    else if (same(m, b!)) out.push(a!);
    else {
      if (!same(m, a!)) conflicts.push(m.name.trim());
      out.push(m);
    }
  }
  for (const [k, a] of now) {
    if (seen.has(k)) continue;
    const b = was.get(k);
    if (!b) out.push(a);
    // Kişi sildi, başkası değiştirdi: silinmiş kalır, söylenir
    else if (!same(b, a)) conflicts.push(a.name.trim());
  }
  return { extras: out, conflicts };
}

// ---------------------------------------------------------------- Bu cihazdaki taslak

/** Taslaktaki ek kalem (formun metin kutuları; fiyat yalnız yöneticide dolu) */
export interface DraftExtra {
  name: string;
  unit: string;
  qty: string;
  unitPrice: string;
}

/**
 * Taslağın localStorage anahtarı: şube ve ay. Sayım şube başınadır (docs/SUBE.md); anahtar yalnız aydan oluşurken
 * Tuzla'nın kaydedilmemiş sayımı aynı cihazda Marina'nın formunda "Geri yükle" diye öneriliyor, kaydedilince Marina'nın
 * sayımına yazılıyor, Marina'da yazmaya başlayınca da Tuzla'nın taslağı eziliyordu (21 Kasım denetimi #8). Şubesiz eski
 * anahtardaki taslak hangi şubenin olduğu bilinmediği için okunmaz.
 */
export function countDraftKey(branch: string, month: string): string {
  return `laf:sayim-taslak:${branch}:${month}`;
}

/**
 * Kaydedilmemiş sayımın taslağı (localStorage): yazılan kutular, "Geçen aydan doldur"la gelip dokunulmamış satırlar
 * (geri yüklenince kayıt öncesi denetim yine sorsun), değişen ek kalemler ve yazanın adı (ortak tablette sonraki kişi
 * kimin sayımı olduğunu görsün).
 */
export interface CountDraft {
  values: Record<string, string>;
  /** Doldurulmuş, dokunulmamış satırlar; eski düz biçimde null (bilinmiyor) */
  prefilled: number[] | null;
  extras: DraftExtra[] | null;
  by: string | null;
  /**
   * Taslak yazılırken satırların kayıtlı değeri (taban): geri yüklerken arada başkasının kaydettiği satır bulunur
   * (draftConflicts). Eski taslakta null.
   */
  base?: Record<string, number | null> | null;
  /**
   * Taslaktaki ek kalemlerin dayandığı kayıtlı liste: geri yükleme listeyi topluca değiştirmez, bununla birleştirir
   * (restoreDraftExtras). Eski taslakta null (boş listeye dayanmış sayılır: yalnız ekler).
   */
  extrasBase?: DraftExtra[] | null;
  /**
   * Taslağın yazıldığı sayımın şubesi (anahtarda da var: countDraftKey). Başka şubenin formu bu taslağı okumaz
   * (parseCountDraft); yoksa null.
   */
  branch?: string | null;
}

export function countDraftJson(d: CountDraft): string {
  return JSON.stringify({ v: d.values, p: d.prefilled ?? [], e: d.extras, eb: d.extrasBase ?? null, b: d.base ?? null, by: d.by, s: d.branch ?? null });
}

/**
 * Taslağı okur; eski düz biçimi ({ "12": "3,5" }) de. Okunamazsa boş. `branch` verilirse başka şubeye yazılmış taslak
 * da boş döner: bir şubenin sayımı öbür şubenin formunda önerilmez (21 Kasım denetimi #8)
 */
export function parseCountDraft(json: string | null, branch?: string): CountDraft {
  const empty: CountDraft = { values: {}, prefilled: null, extras: null, by: null };
  if (!json) return empty;
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") return empty;
    const o = raw as Record<string, unknown>;
    const draftBranch = typeof o.s === "string" && o.s ? o.s : null;
    if (branch !== undefined && draftBranch !== null && draftBranch !== branch) return empty;
    const pickValues = (v: unknown) =>
      Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && /^\d+$/.test(e[0])));
    if (!("v" in o)) return { ...empty, values: pickValues(o) };
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const pickExtras = (v: unknown) =>
      Array.isArray(v)
        ? v
            .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
            .map((x) => ({ name: str(x.name), unit: str(x.unit), qty: str(x.qty), unitPrice: str(x.unitPrice) }))
        : null;
    const base =
      o.b && typeof o.b === "object" && !Array.isArray(o.b)
        ? Object.fromEntries(
            Object.entries(o.b as Record<string, unknown>).filter(
              (e): e is [string, number | null] => /^\d+$/.test(e[0]) && (e[1] === null || (typeof e[1] === "number" && Number.isFinite(e[1]))),
            ),
          )
        : null;
    return {
      values: o.v && typeof o.v === "object" ? pickValues(o.v) : {},
      prefilled: Array.isArray(o.p) ? o.p.filter((x): x is number => Number.isInteger(x)) : [],
      extras: pickExtras(o.e),
      by: typeof o.by === "string" && o.by.trim() ? o.by.trim() : null,
      base,
      extrasBase: pickExtras(o.eb),
      branch: draftBranch,
    };
  } catch {
    return empty;
  }
}

/**
 * Geri yüklenen taslakta hangi satırlar "Geçen aydan doldur"la gelmiş sayılır: taslak bunu yazmışsa o liste (geri
 * yüklenen satırlarla kesişimi); eski düz taslakta yedek kural: geri yüklenen değer aynı birimde geçen ayın
 * miktarına eşitse (kayıt öncesi denetim bir kez fazla sorsun, hiç sormamaktan iyidir).
 */
export function restoredPrefilled(
  draft: CountDraft,
  restored: { id: number; qty: number | null; prevQty: number | null; sameUnit: boolean }[],
): number[] {
  const ids = new Set(restored.map((r) => r.id));
  if (draft.prefilled) return draft.prefilled.filter((id) => ids.has(id));
  return restored.filter((r) => r.sameUnit && r.prevQty !== null && r.qty !== null && r.qty === r.prevQty).map((r) => r.id);
}

/**
 * Geri yüklenen taslak satırlarından, taslak yazıldıktan sonra başkasının kaydettikleri: kayıtlı değer taslağın
 * tabanından farklı. Bunlar da geri yüklenir ama "çakışma" diye işaretlenir (kaydedilirse onunkinin yerine geçeceği
 * satırda söylenir); sessizce ezilmez. Tabanı olmayan eski taslakta kayıtlı değeri olan her satır çakışma sayılır
 * (bilinmiyor; bir kez fazla sormak sessizce ezmekten iyidir).
 */
export function draftConflicts(draft: CountDraft, ids: number[], saved: (id: number) => number | null): number[] {
  return ids.filter((id) => {
    const now = saved(id);
    const base = draft.base?.[String(id)];
    return base === undefined ? now !== null : base !== now;
  });
}

/**
 * Taslağın ek kalemi ile kayıtlı kalem aynı mı: ad + birim, miktar sayı olarak; fiyat yalnız iki tarafta da yazılıysa
 * (personelin taslağında ve formunda fiyat yok, yöneticinin taslağını personel açarsa fiyat düşer).
 */
export function sameDraftExtra(a: DraftExtra, b: DraftExtra): boolean {
  if (extraKey(a.name, a.unit) !== extraKey(b.name, b.unit) || parseNumberTR(a.qty) !== parseNumberTR(b.qty)) return false;
  return !a.unitPrice.trim() || !b.unitPrice.trim() || (parseNumberTR(a.unitPrice) ?? 0) === (parseNumberTR(b.unitPrice) ?? 0);
}

/**
 * Taslaktaki ek kalemleri geri yükler: listeyi topluca değiştirmez, taslağın tabanına (yazıldığı andaki kayıtlı liste)
 * göre bugünkü kayıtlı listeyle birleştirir (mergeExtras). Taslak yazıldıktan sonra başkasının kaydettiği kalem kalır,
 * taslakta değişen kalem taslaktaki gibi gelir, iki tarafın da değiştirdiği kalem "çakışma" olur. Tabanı olmayan eski
 * taslak boş listeye dayanmış sayılır: yalnız ekler, kayıtlı bir kalemi asla kaldırmaz. `withPrices` false (personel):
 * fiyatlar düşer. Fiyatı boş kalan satır kayıtlı fiyatını alır. `changed`: kayıtlı listeden farklı kalem sayısı;
 * taslak kayıtlı listeye bir şey katmıyorsa null.
 */
export function restoreDraftExtras(
  draft: CountDraft,
  saved: DraftExtra[],
  withPrices: boolean,
): { extras: DraftExtra[]; conflicts: string[]; changed: number } | null {
  if (!draft.extras) return null;
  const strip = (rows: DraftExtra[]) => (withPrices ? rows : rows.map((e) => ({ ...e, unitPrice: "" })));
  const key = (e: DraftExtra) => extraKey(e.name, e.unit);
  const savedByKey = new Map(saved.map((e) => [key(e), e]));
  const merged = mergeExtras(strip(draft.extras), strip(draft.extrasBase ?? []), strip(saved), sameDraftExtra);
  const extras = merged.extras.map((e) => (e.unitPrice.trim() || !withPrices ? e : { ...e, unitPrice: savedByKey.get(key(e))?.unitPrice ?? "" }));
  const exact = (a: DraftExtra, b: DraftExtra) => sameDraftExtra(a, b) && (parseNumberTR(a.unitPrice) ?? 0) === (parseNumberTR(b.unitPrice) ?? 0);
  const mine = new Map(extras.map((e) => [key(e), e]));
  const keys = new Set([...mine.keys(), ...savedByKey.keys()]);
  const changed = [...keys].filter((k) => {
    const a = mine.get(k);
    const b = savedByKey.get(k);
    return !a || !b || !exact(a, withPrices ? b : { ...b, unitPrice: "" });
  }).length;
  return changed || merged.conflicts.length ? { extras, conflicts: merged.conflicts, changed } : null;
}

// ---------------------------------------------------------------- Telefonda sayım: grup çipleri, sıradaki boş satır

export interface GroupProgress {
  name: string;
  /** Miktarı yazılmış (ya da kayıtlı) sayılabilir kalem */
  counted: number;
  /** Bugünkü sayım listesindeki kalem (arşiv satırları hariç) */
  total: number;
  done: boolean;
}

/** Her grubun ilerlemesi (grup çipleri ve kart başlığı aynı sayıyı gösterir); arşiv satırları sayılmaz */
export function groupProgress<L extends { archived: boolean }>(groups: { name: string; lines: L[] }[], isCounted: (line: L) => boolean): GroupProgress[] {
  return groups.map((g) => {
    const live = g.lines.filter((l) => !l.archived);
    const counted = live.filter(isCounted).length;
    return { name: g.name, counted, total: live.length, done: live.length > 0 && counted === live.length };
  });
}

// ---------------------------------------------------------------- Formdaki miktarlar (denetim E-21: yazım hızı)

/** Formun bir satırı için gereken alanlar (FormLine'ın alt kümesi) */
export interface FormQtyLine {
  id: number;
  archived: boolean;
  /** Kayıtlı miktar */
  qty: number | null;
  /** Bugünkü sayım birimi; null = Sayılmaz */
  unitNow: string | null;
  /** Kayıtlı sayımın birimi */
  countUnit: string;
}

/**
 * Formdaki satırın miktarı (sayım biriminde): arşiv satırı kayıtlı miktarıyla; boş kutu null (sayılmadı); yazılan
 * değer bugünkü sayım birimiyle okunur (KG / LT'de "1.500" = 1,5). Okunamayan yazı null.
 */
export function formQty(line: FormQtyLine, raw: string | undefined): number | null {
  if (line.archived) return line.qty;
  return raw === undefined || raw.trim() === "" ? null : parseCount(raw, line.unitNow ?? line.countUnit, parseNumberTR);
}

/** Kutuda yazı var ama sayı değil ya da eksi (arşiv satırı hiçbir zaman geçersiz değil) */
export function invalidCount(line: FormQtyLine, raw: string | undefined): boolean {
  if (line.archived || !raw?.trim()) return false;
  const v = formQty(line, raw);
  return v === null || v < 0;
}

/**
 * Kümeden bir satırı çıkarır; satır kümede yoksa aynı küme döner: durum değişmez, React satırları yeniden çizmez
 * (her tuşta "Geçen aydan doldur" ve çakışma işaretleri yeni bir kümeyle kurulmasın).
 */
export function withoutId<T>(set: Set<T>, id: T): Set<T> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

export interface FormProgress {
  /** Grup grup sayılan / toplam (çipler ve kart başlıkları) */
  groups: GroupProgress[];
  /** Sayılan kalem: miktarı yazılmış, "Geçen aydan doldur"la gelip dokunulmamışlar hariç; arşiv satırları sayılmaz */
  counted: number;
  /** Bugünkü sayım listesindeki kalem */
  total: number;
  remaining: number;
  /** Sayılan payı (0-1) */
  share: number;
  complete: boolean;
}

/**
 * Sayılmış satırların kimlikleri, listenin sırasıyla: miktarı yazılmış; "Geçen aydan doldur"la gelip dokunulmamış ve
 * arşiv satırları hariç. Form ilerlemeyi yalnız bu liste değişince yeniden kurar: sayılmış bir satırın miktarını
 * düzeltmek (12 → 12,5) sayaçları, çipleri ve araç çubuğunu yeniden çizdirmez.
 */
export function countedLineIds(lines: FormQtyLine[], values: Record<number, string>, prefilled: ReadonlySet<number>): number[] {
  return lines.filter((l) => !l.archived && formQty(l, values[l.id]) !== null && !prefilled.has(l.id)).map((l) => l.id);
}

/**
 * Formun ilerlemesi: üstteki sayaç, ince çubuk, grup çipleri, kart başlıkları ve alttaki çubuk aynı sayıyı gösterir.
 * `countedIds`: sayılmış satırlar (countedLineIds). Form bunu ertelenmiş değerlerle (useDeferredValue) kurar.
 */
export function formProgress<L extends FormQtyLine>(groups: { name: string; lines: L[] }[], countedIds: ReadonlySet<number>): FormProgress {
  const byGroup = groupProgress(groups, (l) => countedIds.has(l.id));
  const counted = byGroup.reduce((a, g) => a + g.counted, 0);
  const total = byGroup.reduce((a, g) => a + g.total, 0);
  return { groups: byGroup, counted, total, remaining: total - counted, share: total ? counted / total : 0, complete: total > 0 && counted === total };
}

/**
 * Kaydırma izleyici: ekrandaki grup kartlarının üst kenarları (`tops`, sayfa sırasıyla) ve yapışık çubuğun alt
 * çizgisi (`line`) verilir; çizgiyi geçmiş son grup etkindir, hiçbiri geçmediyse ilki. Sayfanın sonuna gelindiyse
 * (`atEnd`) son grup: kısa son grup hiçbir zaman çizgiye ulaşamazdı. Grup yoksa -1.
 */
export function activeGroupIndex(tops: number[], line: number, atEnd = false): number {
  if (!tops.length) return -1;
  if (atEnd) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= line) active = i;
  return active;
}

/**
 * "Sıradaki boş kalem": `start` sırasından (dahil) başlayıp ilk boş satırı bulur, listenin sonuna gelince baştan
 * devam eder. Boş satır yoksa -1. `start` liste dışındaysa başa / sona sarılır.
 */
export function nextEmptyIndex(empty: boolean[], start: number): number {
  const n = empty.length;
  if (!n) return -1;
  const s = ((Math.trunc(start) % n) + n) % n;
  for (let k = 0; k < n; k++) {
    const i = (s + k) % n;
    if (empty[i]) return i;
  }
  return -1;
}

/**
 * Süzgeç değişince (grup, "Kalan", arama) liste kısalır, tarayıcı kaydırmayı sayfanın sonuna sıkıştırır ve süzülen
 * satırlar ekranın üstünde kalır. Araç çubuğunun yapışmadan önceki yeri (`naturalTop`, sayfa başından) ekranın
 * üstünü geçtiyse çubuğun yapıştığı yere (`stickyTop`, üst çubuğun altı) gelecek kaydırma konumu döner: çubuk yerinde,
 * hemen altında listenin başı. Çubuk zaten yerindeyse ya da aşağıdaysa null (kaydırılmaz).
 */
export function listTopScroll(naturalTop: number, stickyTop: number, scrollY: number): number | null {
  const target = Math.max(0, Math.round(naturalTop - stickyTop));
  return scrollY > target + 1 ? target : null;
}

// ---------------------------------------------------------------- Kim saydı, ne zaman

/** "Sayan: Ayşe, Mehmet · son kayıt 01.10.2026 09:12" (kimse yoksa null) */
export function counterLine(rows: { by: string | null; last: Date | string | null }[]): string | null {
  const valid = rows.filter((r) => r.last !== null);
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => new Date(b.last!).getTime() - new Date(a.last!).getTime());
  const names = [...new Set(sorted.map((r) => r.by?.trim()).filter((n): n is string => !!n))];
  const last = sorted[0].last!;
  const who = names.length ? `${names.length > 1 ? "Sayanlar" : "Sayan"}: ${names.join(", ")} · ` : "";
  return `${who}son kayıt ${dateTimeTR(last)}`;
}

// ---------------------------------------------------------------- Sayım kutusu: yazım, olağan dışı değer, birleştirme

/**
 * Sayım kutusundaki sayı. KG ve LT'de tek nokta ondalıktır ("1.500" = 1,5 KG): telefonların ondalık klavyesi çoğu
 * zaman yalnız nokta verir, tartıdan okunan değer de öyle yazılır. ADET ve DİLİM'de Türkçe yazım geçerli (1.500 = bin
 * beş yüz adet). Okunamazsa null.
 */
export function parseCount(raw: string, unit: string, parse: (s: string) => number | null): number | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  if ((unit === "KG" || unit === "LT") && /^\d+\.\d+$/.test(s)) return Number(s);
  return parse(s);
}

/** Kutunun yazımı: binlik ayırıcısız, ondalık virgüllü ("1500", "1,5"); kutudan yeniden okununca aynı sayı */
export function countText(qty: number | null): string {
  if (qty === null) return "";
  return String(Math.round(qty * 1000) / 1000).replace(".", ",");
}

/**
 * Geçen aya göre olağan dışı miktar (yazım hatası olabilir, ör. 1,5 yerine 15): en az beş katı ve 2 birimden fazla
 * artış ya da beşte birinin altına düşüş. Sıfır (bitti) ve geçen ay sayılmayan kalem uyarılmaz.
 */
export function unusualCount(qty: number | null, prev: number | null): "high" | "low" | null {
  if (qty === null || prev === null || prev <= 0 || qty <= 0) return null;
  if (qty >= prev * 5 && qty - prev > 2) return "high";
  if (qty * 5 <= prev && prev >= 1) return "low";
  return null;
}

/**
 * Sunucudan yeni sayım gelince (başkası kaydetti, sayfa yenilendi) kutuları birleştirir: kişinin dokunmadığı satır
 * yeni değeri alır; ikisinin de değiştirdiği satırda kişinin yazdığı kalır ve "çakışma" olarak döner (kaydederse
 * başkasınınkinin yerine geçeceğini bilsin).
 */
export function mergeCounts(
  values: Record<number, string>,
  before: Map<number, number | null>,
  after: Map<number, number | null>,
  read: (id: number, raw: string) => number | null,
): { values: Record<number, string>; conflicts: number[] } {
  const next = { ...values };
  const conflicts: number[] = [];
  for (const [id, now] of after) {
    const was = before.get(id) ?? null;
    if (was === now) continue;
    const mine = read(id, values[id] ?? "");
    if (mine === was) next[id] = countText(now);
    else if (mine !== now) conflicts.push(id);
  }
  return { values: next, conflicts };
}

/**
 * Personelin sayım girebildiği aylar: bu ay; geçen ay yalnız ayın ilk 10 gününde (COUNT_GRACE_DAYS, Bugün'ün geçen ay
 * sayımı satırının penceresi). Sonrasında geçen ayın kapanışı (mal maliyeti, kâr, sonraki ayın açılışı ve FIFO) yalnız
 * yöneticiyle değişir. Gün hem takvim günü hem kasanın iş günü (05:00) için bakılır: gece yarısını geçen sayım da
 * sürer.
 */
export function staffCountMonths(now: Date = new Date()): string[] {
  const out = new Set<string>();
  for (const day of [todayTR(now), businessDate(now)]) {
    const month = day.slice(0, 7);
    out.add(month);
    if (Number(day.slice(8, 10)) <= COUNT_GRACE_DAYS) out.add(shiftMonth(month, -1));
  }
  return [...out];
}

/** Personel geçen ayın sayımını pencere dışında değiştirmek isteyince */
export const STAFF_LATE_FIX_MESSAGE = "Geçen ayın sayımı ayın 10'undan sonra yalnız yönetici tarafından düzeltilebilir; yöneticiye haber verin.";
/** Personel daha eski (ya da ileri) bir ayın sayımını değiştirmek isteyince */
export const STAFF_OLD_MONTH_MESSAGE = "Personel yalnız bu ayın sayımını (ayın ilk 10 gününde geçen ayınkini de) değiştirebilir; başka bir ay için yöneticiye yazın.";

/**
 * Personelin bu ayın sayımına yazamamasının sebebi (yazabiliyorsa ya da yöneticiyse null). Sayım kaydı, ek kalemler
 * ve "Listeye ekle" aynı kapıdan geçer.
 */
export function staffCountIssue(role: "admin" | "staff", month: string, now: Date = new Date()): string | null {
  if (role === "admin" || staffCountMonths(now).includes(month)) return null;
  return month === shiftMonth(todayTR(now).slice(0, 7), -1) ? STAFF_LATE_FIX_MESSAGE : STAFF_OLD_MONTH_MESSAGE;
}

/**
 * Ay sonu sayımı hatırlatması (günlük işin sabah bildirimi, src/server/notify/count-push.ts): ayın son iş günü,
 * sayım listesi doluysa ve ayın sayımı tamamlanmadıysa (countStatus kuralı, sunucuda today.ts countProgress) tek
 * bildirim. Tutar yok.
 */
export function monthEndCountPush(day: string, progress: { counted: number; total: number }): { title: string; body: string; url: string; tag: string } | null {
  if (!isLastDayOfMonth(day) || progress.total <= 0 || progress.counted >= progress.total) return null;
  const month = day.slice(0, 7);
  const left = progress.total - progress.counted;
  return {
    title: "Bugün ay sonu stok sayımı",
    body: progress.counted
      ? `Kapanıştan sonra kalan ${num(left)} kalemi sayın (${num(progress.counted)} / ${num(progress.total)} sayıldı); sayılmayanın stoğu 0 sayılır`
      : `Kapanıştan sonra ${num(progress.total)} kalem; sayılmayanın stoğu 0 sayılır`,
    url: `/panel/sayim?ay=${month}`,
    tag: `sayim-son-${month}`,
  };
}

/**
 * Yöneticinin zil satırı ve sabah e-postası satırı (src/server/bell/ops.ts): ayın ilk 10 gününde (kasanın iş günü,
 * 05:00'te döner) geçen ayın sayımı tamamlanmadıysa. Sayılmayan kalem ay sonu stoğunda 0 sayılır, mal maliyeti şişer.
 * Tamamsa ya da pencere geçtiyse null. Tutar yok.
 */
export function pastCountReminder(day: string, prev: { counted: number; total: number }): { id: string; title: string; body: string; href: string } | null {
  if (Number(day.slice(8, 10)) > COUNT_GRACE_DAYS || prev.total <= 0 || prev.counted >= prev.total) return null;
  const month = shiftMonth(day.slice(0, 7), -1);
  const label = monthLabel(month);
  return {
    id: `sayim-gecen-${month}`,
    title: prev.counted ? `${label} sayımı yarım: ${num(prev.counted)} / ${num(prev.total)}` : `${label} sayımı girilmedi`,
    body: `Kalanların stoğu 0 sayılır; ${label} mal maliyeti yüksek çıkar. Ayın 10'una kadar personel de girebilir.`,
    href: `/panel/sayim?ay=${month}`,
  };
}

// ---------------------------------------------------------------- Yöneticiye sayım uyarıları (denetim B02)

/** Bir ayın fiyatı girilmemiş ek kalemleri ("Listede olmayanlar"; miktarı > 0, birim fiyatı 0) */
export interface UnpricedExtras {
  month: string;
  /**
   * Kalemlerin şubesi ("Listede olmayanlar" şube başına), birden çok şube açıkken: başlıkta adı, adreste `&sube=` (sayım
   * sayfası o şubenin listesini açsın). Tek şubede null
   */
  branch?: { id: string; name: string } | null;
  count: number;
  /** İlk birkaç ad, eklenme sırasıyla */
  names: string[];
  /** En yeni kalemin kimliği: yeni kalem gelince zil satırı yeniden okunmamış olur */
  newestId: number;
}

/** Ek kalemlerin bölümü sayım formunda (stock-form.tsx "Listede olmayanlar" kartı) */
export const EXTRAS_ANCHOR = "listede-olmayanlar";

/**
 * Yöneticinin zil ve Bugün satırı (E-22): personelin eklediği ek kalemin fiyatı yoksa kapanış stoğuna 0 ₺ girer, mal
 * maliyeti o kadar yüksek çıkar. "Ekim 2026: 2 ek kalemin fiyatı yok" → o ayın sayımının ek kalemler bölümü. Kimlik
 * sayı ve en yeni kalemden; fiyat girilince satır kalkar. Personele gösterilmez (tutar konusu).
 */
export function unpricedExtrasNotice(u: UnpricedExtras): { id: string; title: string; body: string; href: string } | null {
  if (u.count <= 0) return null;
  const shown = u.names.slice(0, 3);
  const rest = u.count - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} ve ${num(rest)} kalem daha` : shown.join(", ");
  // Kimlik şubeyi taşımaz: en yeni kalemin kimliği şubeler arasında zaten tektir
  return {
    id: `sayim-ek-fiyatsiz-${u.month}-${u.count}-${u.newestId}`,
    title: `${monthLabel(u.month)}${u.branch ? ` (${u.branch.name})` : ""}: ${num(u.count)} ek kalemin fiyatı yok`,
    body: `${list} · Birim fiyatı girilmezse kapanış stoğuna 0 ₺ girer, ayın mal maliyeti o kadar yüksek çıkar.`,
    href: `/panel/sayim?ay=${u.month}${u.branch ? `&sube=${encodeURIComponent(u.branch.id)}` : ""}#${EXTRAS_ANCHOR}`,
  };
}

/** Personelin, ay bittikten sonra (kasanın iş günüyle) geçen ayın sayımına yaptığı kayıtlar, kişi başına */
export interface StaffLateEdit {
  name: string;
  /** Kayıt sayısı (her Kaydet bir kayıt) */
  saves: number;
  /** Kayıtlardaki kalem sayılarının toplamı ("3 kalem"; aynı kalem iki kez kaydedildiyse iki kez sayılır) */
  items: number;
  /** En son kaydın anı (ISO) ve işlem geçmişi kimliği */
  lastAt: string;
  lastId: number;
}

/** İşlem geçmişinin ayrıntısından kalem sayısı: "Ekim 2026: 3 kalem, 1 sayım silindi" → 4 */
export function loggedItems(detail: string | null): number {
  if (!detail) return 0;
  const n = (re: RegExp) => Number(detail.match(re)?.[1] ?? 0);
  return n(/(\d+) kalem/) + n(/(\d+) sayım silindi/);
}

/**
 * Yöneticinin zil ve Bugün satırı: personel geçen ayın sayımını ay bittikten sonra (ayın ilk 10 gününde, E-19'un
 * penceresi) değiştirdi. Geçen ayın kapanışı mal maliyetini, kârı, bu ayın açılışını ve FIFO'yu belirler; yönetici
 * bakmalı. "Ayşe, Ekim 2026 sayımını değiştirdi" · "Ay bittikten sonra 2 kayıt, 5 kalem". Kimlik en son kayıttan.
 */
export function staffLateEditNotice(month: string, edits: StaffLateEdit[]): { id: string; title: string; body: string; href: string; lastAt: string } | null {
  if (!edits.length) return null;
  const sorted = [...edits].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  const names = sorted.map((e) => e.name);
  const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} ve ${num(names.length - 2)} kişi` : names.join(" ve ");
  const saves = edits.reduce((a, e) => a + e.saves, 0);
  const items = edits.reduce((a, e) => a + e.items, 0);
  return {
    id: `sayim-personel-${month}-${Math.max(...edits.map((e) => e.lastId))}`,
    title: `${who}, ${monthLabel(month)} sayımını değiştirdi`,
    body: `Ay bittikten sonra ${num(saves)} kayıt${items ? `, ${num(items)} kalem` : ""}. Geçen ayın kapanışı mal maliyetini, kârı ve bu ayın açılışını değiştirir: kontrol edin.`,
    href: `/panel/sayim?ay=${month}`,
    lastAt: sorted[0].lastAt,
  };
}

// ---------------------------------------------------------------- Açılış stoğu

/**
 * Yönetici kartındaki "Açılış (… devri)": Gelir-gider'in bu ayki açılışı (pnlMonth, `stock:opening` hücresi), kâr-zarar
 * hangisini kullanıyorsa o (denetim E-30). Kaynağı:
 * - "sayim": geçen ayın sayımı (sonraki aya devreden mal);
 * - "devreden": geçen ayın devreden malı Gelir-giderde elle girildi;
 * - "acilis": bu ayın "Önceki aydan devir"i Gelir-giderde elle girildi (geçen ayın sayımından ayrı).
 * `counted`: geçen ayın sayımının değeri (elle girilmişse karşılaştırma için); geçen ay sayılmadıysa (`prevCounted`
 * false, stockSheet().hasData) null: ipucu "0 ₺" değil "sayımı yok" der
 */
export interface CountOpening {
  value: number;
  source: "sayim" | "devreden" | "acilis";
  counted: number | null;
}

export function countOpening(
  opening: { value: number | null; overridden: boolean },
  prevClosing: { value: number; computed: number; overridden: boolean },
  prevCounted = true,
): CountOpening {
  const counted = prevCounted ? prevClosing.computed : null;
  if (opening.overridden) return { value: opening.value ?? 0, source: "acilis", counted };
  return { value: prevClosing.value, source: prevClosing.overridden ? "devreden" : "sayim", counted };
}

/**
 * Açılış elle girildiyse kartta ipucu: kâr-zarar hangi tutarı kullanıyor, sayım neydi; sayımdan geliyorsa null.
 * `branch`: birden çok şube açıkken sayılan şubenin adı. Elle yazılan devir işletme genelidir, sayım şubenin: metin
 * ikisini ayırır ("işletme geneli", "Ekim 2026 sayımı (Tuzla)")
 */
export function countOpeningNote(o: CountOpening, month: string, branch: string | null = null): string | null {
  const prev = monthLabel(shiftMonth(month, -1));
  const own = branch ? ` (${branch})` : "";
  const counted = o.counted === null ? `${prev} sayımı${own} yok.` : `${prev} sayımı${own}: ${tl(o.counted)}.`;
  const company = branch ? " (işletme geneli)" : "";
  const pnl = branch ? "işletmenin kâr-zararı" : "kâr-zarar";
  if (o.source === "acilis") {
    return `Gelir-giderde ${monthLabel(month)} için "Önceki aydan devir"${company} elle ${tl(o.value)} girildi; ${pnl} bu tutarı kullanır. ${counted}`;
  }
  if (o.source === "devreden") {
    return `${prev} stoğu${company} Gelir-giderde elle ${tl(o.value)} girildi; ${branch ? "işletmenin açılışı" : "açılış"} o tutardır. ${counted}`;
  }
  return null;
}

/**
 * Gelir-giderde elle yazılan stok devirleri (pnl_entries `stock:closing` / `stock:opening`). İşletme genelidir: hücre
 * şubesizdir, "Tümü"nün kâr-zararı kullanır, tek şube seçiliyken yazılamaz (src/lib/branches.ts companyPnlKey). Sayım
 * sayfası şubenin modeliyle açılır ve o model bu hücreleri görmez (branchPnlEntry); sayfa onları ayrıca okur ki elle
 * girilen devrin "elle girildi" ipucu ve "kâr-zarar bu sayımı kullanmaz" uyarısı kaybolmasın (denetim E-30; 21 Kasım
 * denetimi #20). Yazılmamış olan null.
 */
export interface StockOverrides {
  /** Bu ayın "SONRAKİ AYA DEVREDEN MAL"ı */
  closing: number | null;
  /** Geçen ayın "SONRAKİ AYA DEVREDEN MAL"ı (bu ayın açılışı) */
  prevClosing: number | null;
  /** Bu ayın "ÖNCEKİ AYDAN DEVİR"i */
  opening: number | null;
}

export function stockOverrides(rows: readonly { month: string; rowKey: string; amount: number }[], month: string): StockOverrides {
  const find = (m: string, key: string) => rows.find((r) => r.month === m && r.rowKey === key)?.amount ?? null;
  return { closing: find(month, "stock:closing"), prevClosing: find(shiftMonth(month, -1), "stock:closing"), opening: find(month, "stock:opening") };
}

/**
 * Sayım kartının açılışı (countOpening), işletme genelinin elle yazılan devirleriyle (`ov`) ve sayılan şubenin geçen
 * ayki sayım toplamıyla (`prevCount`): devir elle yazılmamışsa açılış şubenin sayımıdır; yazıldıysa kâr-zararın
 * kullandığı tutar, ipucunda şubenin sayımı. Şubesiz modelde `pnlMonth` açılışıyla aynı sonuç (tests/sayim-sube.test.ts)
 */
export function countOpeningOf(ov: StockOverrides, prevCount: number, prevCounted = true): CountOpening {
  return countOpening(
    ov.opening !== null ? { value: ov.opening, overridden: true } : { value: null, overridden: false },
    { value: ov.prevClosing ?? prevCount, computed: prevCount, overridden: ov.prevClosing !== null },
    prevCounted,
  );
}

/**
 * Gelir-giderde bu ayın stoğu elle yazıldıysa sayım kartının uyarısı: kâr-zarar sayımı değil o tutarı kullanır.
 * `branch` birden çok şube açıkken sayılan şubenin adı (elle yazılan tutar işletme genelinin, sayım şubenin)
 */
export function closingOverrideText(month: string, amount: number, total: number, branch: string | null = null): { title: string; text: string; sentence: string } {
  const company = branch ? " (işletme geneli)" : "";
  return {
    title: `Gelir-giderde ${monthLabel(month)} stoğu${company} elle ${tl(amount)}: kâr-zarar bu sayımı kullanmaz`,
    text: branch
      ? `Bu sayım (${branch}) ${tl(total)}; işletmenin kâr-zararı elle girilen tutarı kullanır.`
      : `Bu sayım ${tl(total)}; kâr-zarar elle girilen tutarı kullanır.`,
    sentence: `Gelir-giderde bu ayın stoğu${company} elle ${tl(amount)} girildi; kâr-zarar o tutarı kullanır.`,
  };
}
