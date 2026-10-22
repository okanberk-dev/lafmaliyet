/**
 * Satış fiyatı geçmişinin saf kısmı (docs/FIYATLAR.md): kaynakların adı, geçmişin güne ve toplu değişikliğe göre
 * gruplanması, toplu değişikliği geri alma planı ve sitenin yazdığı değişikliklerden hangisinin geçmişe girdiği.
 * Sunucu (src/server/prices/*) ve Fiyatlar ekranı paylaşır; tests/fiyatlar.test.ts sınar.
 */

import { MONTH_NAMES } from "../constants";
import { tl } from "../format";
import { addDays, todayTR } from "../reminders";
import { toMinor } from "../site-menu/slot";

export type PriceSource = "manual" | "suggestion" | "bulk" | "undo" | "site" | "create";

/** Geçmişte ve ürün kartında kaynağın adı */
export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  manual: "Elle",
  suggestion: "Zam önerisi",
  bulk: "Toplu",
  undo: "Geri alındı",
  site: "laffogato.net",
  create: "Yeni ürün",
};

/** Geçmişe yazılacak bir fiyat değişikliği (sunucu fiyatla aynı işlemde yazar: src/server/prices/record.ts) */
export interface PriceChange {
  productId: number;
  /** Önceki fiyat (TL, KDV dahil); yeni üründe null */
  before: number | null;
  after: number;
  source: PriceSource;
  changedBy: string;
  /** Panelin değişikliği laffogato.net'e de yazıldı */
  onSite?: boolean;
  batchId?: string | null;
  note?: string | null;
}

/**
 * Sitenin bir panel satırına yazdığı değişikliğin geçmiş kaydı (applyPlan: çekme, bağlama, aynı kalemin öteki boyu).
 * Yalnız fiyat değiştiyse ve satır gerçekten güncellendiyse yazılır: arada bağlantısı değişen satıra yazım düşmez,
 * yalnız menü durumu (Satışta / Tükendi) değiştiyse geçmişe bir şey girmez.
 */
export function sitePriceRecord(
  change: { productId: number; set: { price?: number; active?: boolean; showOnMenu?: boolean }; before: { price: number } },
  updated: boolean,
  changedBy: string,
): PriceChange | null {
  if (!updated || change.set.price === undefined) return null;
  return { productId: change.productId, before: change.before.price, after: change.set.price, source: "site", changedBy };
}

/** Geçmiş ekranının bir satırı (yükleyici ürün adını ve boyunu ekler) */
export interface HistoryRow {
  id: number;
  productId: number;
  name: string;
  size: string;
  priceBefore: number | null;
  price: number;
  source: PriceSource;
  onSite: boolean;
  batchId: string | null;
  note: string | null;
  changedBy: string | null;
  /** ISO zaman */
  changedAt: string;
}

export type HistoryEntry = (
  | { kind: "single"; row: HistoryRow }
  | {
      kind: "batch";
      batchId: string;
      /** Kuralın özeti ("+%10 · 5 ₺'ye yukarı · Espresso Bazlı") */
      note: string | null;
      changedBy: string | null;
      /** En yeni satırın zamanı */
      changedAt: string;
      source: PriceSource;
      rows: HistoryRow[];
      /** Sitede de değişen satır sayısı */
      onSite: number;
    }
) & {
  /** Türkiye saatine göre gün (YYYY-MM-DD) */
  day: string;
};

const newerFirst = (a: Pick<HistoryRow, "changedAt" | "id">, b: Pick<HistoryRow, "changedAt" | "id">) =>
  Date.parse(b.changedAt) - Date.parse(a.changedAt) || b.id - a.id;

/**
 * Geçmişin satırları ekrandaki sırayla: en yeni önce, aynı toplu değişikliğin satırları tek kayıtta (en yeni satırın
 * anında), her kayıt Türkiye saatine göre gününü taşır (23:30 UTC'deki değişiklik ertesi güne düşer). Toplu
 * değişikliğin satırları ürün sırasıyla değil, gelen sırayla (yükleyici kategori ve ürün sırasıyla verir).
 */
export function groupHistory(rows: readonly HistoryRow[]): HistoryEntry[] {
  const batches = new Map<string, HistoryRow[]>();
  const entries: HistoryEntry[] = [];
  for (const row of rows) {
    if (!row.batchId) {
      entries.push({ kind: "single", row, day: todayTR(new Date(row.changedAt)) });
      continue;
    }
    const list = batches.get(row.batchId);
    if (list) list.push(row);
    else batches.set(row.batchId, [row]);
  }
  for (const [batchId, list] of batches) {
    const newest = [...list].sort(newerFirst)[0];
    entries.push({
      kind: "batch",
      batchId,
      note: newest.note,
      changedBy: newest.changedBy,
      changedAt: newest.changedAt,
      source: newest.source,
      rows: list,
      onSite: list.filter((r) => r.onSite).length,
      day: todayTR(new Date(newest.changedAt)),
    });
  }
  const at = (e: HistoryEntry) => (e.kind === "single" ? e.row : { changedAt: e.changedAt, id: Math.max(...e.rows.map((r) => r.id)) });
  return entries.sort((a, b) => newerFirst(at(a), at(b)));
}

/** Günün başlığı: "Bugün", "Dün", "22 Eki 2026" */
export function historyDayLabel(day: string, today: string = todayTR()): string {
  if (day === today) return "Bugün";
  if (day === addDays(today, -1)) return "Dün";
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

/** Türkiye saatiyle "14:05" */
export function timeTR(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Ürün kartındaki an: "Bugün 14:05", "Dün 09:30", "22 Eki 14:05" (başka yılsa yılıyla) */
export function historyWhen(iso: string, today: string = todayTR()): string {
  const day = todayTR(new Date(iso));
  const label = historyDayLabel(day, today);
  return `${day.slice(0, 4) === today.slice(0, 4) ? label.replace(/ \d{4}$/, "") : label} ${timeTR(iso)}`;
}

/** Geri almada dokunulmayan ürünün nedeni: sonradan değişti, zaten eski fiyatında, önceki fiyatı yok, silinmiş */
export type UndoSkip = "changed" | "reverted" | "noBefore" | "deleted";

export interface UndoPlan {
  /** Eski fiyatına dönecekler: from = bugünkü fiyat (toplu değişikliğin yazdığı), to = toplu değişiklikten önceki */
  revert: { productId: number; label: string; from: number; to: number }[];
  /** Dokunulmayacaklar ve nedeni (`reason` gösterilen metin) */
  skipped: { productId: number; label: string; kind: UndoSkip; reason: string }[];
}

/**
 * Toplu değişikliği geri alma planı. Ürün başına toplu değişikliğin son satırı esas: ürünün bugünkü fiyatı o satırın
 * yazdığı fiyatsa (kuruşuyla) değişiklikten önceki fiyata (ürünün bu değişikliğe giren ilk satırının önceki fiyatı)
 * döner. Sonradan değişen ürüne dokunulmaz; zaten eski fiyatında olan (geri alınmış) ve silinmiş ürün atlanır. Süre
 * sınırı yok (sahibin kararı D9).
 */
export function undoPlan(
  rows: readonly { id: number; productId: number; label: string; priceBefore: number | null; price: number; changedAt: string }[],
  current: ReadonlyMap<number, number>,
): UndoPlan {
  const byProduct = new Map<number, (typeof rows)[number][]>();
  for (const r of rows) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  const plan: UndoPlan = { revert: [], skipped: [] };
  for (const [productId, list] of byProduct) {
    const sorted = [...list].sort(newerFirst);
    const last = sorted[0];
    const first = sorted[sorted.length - 1];
    const now = current.get(productId);
    const label = last.label;
    if (now === undefined) plan.skipped.push({ productId, label, kind: "deleted", reason: "Ürün silinmiş" });
    else if (first.priceBefore === null) plan.skipped.push({ productId, label, kind: "noBefore", reason: "Önceki fiyatı yok" });
    else if (toMinor(now) === toMinor(first.priceBefore)) plan.skipped.push({ productId, label, kind: "reverted", reason: "Zaten eski fiyatında" });
    else if (toMinor(now) !== toMinor(last.price)) {
      plan.skipped.push({ productId, label, kind: "changed", reason: `Sonradan değişti (şimdi ${tl(now, toMinor(now) % 100 ? 2 : 0)})` });
    } else plan.revert.push({ productId, label, from: now, to: first.priceBefore });
  }
  return plan;
}

/** Plan hiçbir şeyi geri almıyorsa nedeni: hepsi zaten eski fiyatındaysa "geri alınmış", yoksa "sonradan değişmiş" */
export function nothingToUndoText(plan: UndoPlan): string {
  return plan.skipped.length && plan.skipped.every((s) => s.kind === "reverted")
    ? "Bu değişiklik zaten geri alınmış"
    : "Bu değişiklikteki fiyatların hepsi sonradan değişmiş; geri alınacak bir şey yok";
}
