/**
 * Stok değerleme: dönemsel ilk giren ilk çıkar (FIFO). Saf hesap: veritabanı yok (yükleyici
 * src/server/data/purchase-lots.ts, motor engine.ts stockSheet, belge docs/STOK-DEGERLEME.md).
 *
 * Ay sonunda sayılan miktar rafta kalan maldır; FIFO'da önce giren önce çıktığı için rafta kalan en son alınanlardır.
 * Sayılan miktar en yeni faturadan geriye doğru faturalara dağıtılır, her parça kendi faturasının birim fiyatıyla
 * (KDV hariç, iskonto düşülmüş) değerlenir. Faturayla karşılanmayan kalan ayın sonunda geçerli fiyatla ("fallback").
 * Katmanlar aydan aya taşınır: geçen ay sayılan malın katmanları bu ayın havuzunun eski ucudur, böylece geçen ay
 * tükenmiş bir parti (daha ucuz eski fatura) yeniden sayılmaz.
 */
import { SEPARATE_CATEGORIES } from "../constants";
import { monthShort, num, tl } from "../format";

/** Faturanın bir hammaddeye düşen alışı: miktar hammaddenin kendi biriminde (gr, ml, adet), tutar KDV hariç */
export interface PurchaseLot {
  ingredientId: number;
  invoiceId: number;
  /** Fatura tarihi (YYYY-MM-DD); eşitleme zamanı değil */
  date: string;
  qty: number;
  cost: number;
}

/** Yükleyicinin okuduğu satır (fatura kalemi ya da fatura + hammadde başına toplanmış satırlar) */
export interface LotSourceRow {
  ingredientId: number;
  invoiceId: number;
  date: string;
  /** Faturadaki miktar (Paraşüt biriminde) */
  quantity: number;
  /** Bağlantı çarpanı: Paraşüt'teki 1 birim kaç hammadde birimi */
  factor: number;
  /** KDV hariç, iskonto düşülmüş tutar */
  netTotal: number;
  /** Faturanın panel kategorisi: kafe dışı (Karaoke box, Alp Koç) faturalar stoğa girmez */
  category?: string | null;
  /** Fiyatı onay bekleyen ya da reddedilen kalem (yanlış çarpan olabilir) */
  held?: boolean;
}

/**
 * Satırlardan partiler: fatura + hammadde başına birleşir (aynı faturadaki ücretli ve bedava satır birim maliyeti
 * düşürür, iade satırı netleşir). Onay bekleyen / reddedilen fiyat ve kafe dışı fatura dışarıda; "Fiyatı güncelle"
 * kapalı bağlantının faturası gerçek alıştır, girer. Miktarı eksi kalan fatura (tedarikçiye iade faturası) partiden
 * düşer: tarihinde ya da öncesinde alınmış en yeni partilerden, her birinin kendi birim maliyetiyle. Miktarı 0 kalan,
 * tutarı eksi parti düşer. Tedarikçiye iade panele yalnız kalemsiz, elle girilmiş eksi fatura olarak geldiyse
 * partiden düşülmez (docs/STOK-DEGERLEME.md §2).
 */
export function buildLots(rows: LotSourceRow[]): PurchaseLot[] {
  const map = new Map<string, PurchaseLot>();
  for (const r of rows) {
    if (r.held) continue;
    if (r.category && SEPARATE_CATEGORIES.includes(r.category)) continue;
    if (!Number.isFinite(r.quantity) || !Number.isFinite(r.factor) || !Number.isFinite(r.netTotal)) continue;
    const key = `${r.invoiceId}:${r.ingredientId}`;
    const lot = map.get(key) ?? { ingredientId: r.ingredientId, invoiceId: r.invoiceId, date: r.date, qty: 0, cost: 0 };
    lot.qty += r.quantity * r.factor;
    lot.cost += r.netTotal;
    map.set(key, lot);
  }
  const all = [...map.values()];
  const lots = all.filter((l) => l.qty > 1e-9 && l.cost >= 0);
  // İade faturaları: eskiden yeniye, her biri tarihinde ya da öncesinde alınmış en yeni partilerden düşer
  const refunds = newestFirst(all.filter((l) => l.qty < -1e-9)).reverse();
  for (const ref of refunds) {
    let left = -ref.qty;
    for (const l of newestFirst(lots.filter((x) => x.ingredientId === ref.ingredientId && x.date <= ref.date && x.qty > 1e-9))) {
      if (left <= 1e-9) break;
      const take = Math.min(left, l.qty);
      l.cost -= (l.cost / l.qty) * take;
      l.qty -= take;
      left -= take;
    }
  }
  return lots.filter((l) => l.qty > 1e-9 && l.cost >= -1e-9).map((l) => (l.cost < 0 ? { ...l, cost: 0 } : l));
}

/** Değerlenmiş bir parça: faturadan (invoiceId, tarih) ya da faturası bulunamayan kalan (fallback, ay sonu fiyatı) */
export interface StockLayer {
  qty: number;
  /** Hammaddenin kendi birimindeki fiyat (₺/gr, ₺/ml, ₺/adet), KDV hariç */
  unitCost: number;
  invoiceId: number | null;
  date: string | null;
  fallback: boolean;
}

/** Havuzu en yeniden eskiye sıralar: tarih, aynı günde fatura kimliği (sonra girilen daha yeni) */
export function newestFirst(lots: PurchaseLot[]): PurchaseLot[] {
  return [...lots].sort((a, b) => (a.date === b.date ? b.invoiceId - a.invoiceId : a.date < b.date ? 1 : -1));
}

const lotLayer = (l: PurchaseLot): StockLayer => ({ qty: l.qty, unitCost: l.cost / l.qty, invoiceId: l.invoiceId, date: l.date, fallback: false });

/**
 * `qty` kadar malı havuzun başından (en yeni) alır. Havuz katman ya da parti olabilir; sırası korunur.
 * Yetmeyen kısım `uncovered`.
 */
export function takeNewestFirst(qty: number, pool: StockLayer[]): { layers: StockLayer[]; uncovered: number } {
  const layers: StockLayer[] = [];
  let left = Math.max(0, qty);
  for (const p of pool) {
    if (left <= 1e-9) break;
    if (p.fallback || p.qty <= 0) continue;
    const take = Math.min(left, p.qty);
    layers.push({ ...p, qty: take });
    left -= take;
  }
  return { layers, uncovered: left > 1e-9 ? left : 0 };
}

/**
 * Ayın havuzu: bu ayın partileri en yeniden eskiye, ardından geçen aydan taşınan katmanlar (onlar da en yeniden
 * eskiye; fallback katmanı taşınmaz).
 */
export function monthPool(ownLots: PurchaseLot[], carried: StockLayer[]): StockLayer[] {
  return [...newestFirst(ownLots).map(lotLayer), ...carried.filter((c) => !c.fallback && c.qty > 0)];
}

/** Ham partilerden havuz (geçen ay sayılmadıysa: son 12 ayın partileri) */
export function lotPool(lots: PurchaseLot[]): StockLayer[] {
  return newestFirst(lots).map(lotLayer);
}

/**
 * Sayılan miktarın katmanları: havuzdan en yeniden geriye, karşılanmayan kalan `fallbackUnit` (ay sonu fiyatı,
 * hammaddenin kendi biriminde) ile tek bir fallback katmanı.
 */
export function closingLayers(qty: number, pool: StockLayer[], fallbackUnit: number): { layers: StockLayer[]; uncovered: number } {
  const { layers, uncovered } = takeNewestFirst(qty, pool);
  if (uncovered > 0) layers.push({ qty: uncovered, unitCost: fallbackUnit, invoiceId: null, date: null, fallback: true });
  return { layers, uncovered };
}

export const layersValue = (layers: StockLayer[]) => layers.reduce((a, l) => a + l.qty * l.unitCost, 0);

/** Ay FIFO ile mi değerlenir: başlangıç ayı ayarlıysa ve ay ondan önce değilse */
export function valuationFor(month: string, from: string | null | undefined): "fifo" | "son-fiyat" {
  return from && month >= from ? "fifo" : "son-fiyat";
}

/** "YYYY-MM" + delta ay */
export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Geçen ay sayılmamışsa havuza bu kadar ay geriye kadar fatura girer */
export const FIFO_LOOKBACK_MONTHS = 12;

/** "18 Eki" (fatura tarihi) */
const dayShort = (date: string) => `${Number(date.slice(8, 10))} ${monthShort(date.slice(0, 7))}`;

/**
 * Satır ipucu: "2 KG · 18 Eki faturası 412,00 ₺/KG + 0,5 KG · 29 Eyl faturası 380,00 ₺/KG · 0,3 KG faturası
 * bulunamadı: ay sonu fiyatıyla." Katmanlar hammaddenin biriminde; `factor` sayım biriminin çarpanı.
 */
export function layerText(layers: StockLayer[], factor: number, unit: string): string {
  const f = factor || 1;
  const parts = layers.filter((l) => !l.fallback).map((l) => `${num(l.qty / f, 3)} ${unit} · ${dayShort(l.date!)} faturası ${tl(l.unitCost * f, 2)}/${unit}`);
  const rest = layers.filter((l) => l.fallback).reduce((a, l) => a + l.qty, 0);
  const tail = rest > 0 ? `${num(rest / f, 3)} ${unit} faturası bulunamadı: ay sonu fiyatıyla (${tl((layers.find((l) => l.fallback)?.unitCost ?? 0) * f, 2)}/${unit}).` : "";
  if (!parts.length) return tail;
  return `${parts.join(" + ")}${tail ? ` · ${tail}` : "."}`;
}
