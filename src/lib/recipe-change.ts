/**
 * Reçete değişiklik önerisinin saf hesapları: öneri anındaki reçete ile önerilen reçetenin farkı (yönetici "ne nasılmış,
 * ne olmuş" diye görsün), işlem geçmişine giden kısa özet ve iki reçetenin aynı olup olmadığı. Hem sunucu hem tarayıcı
 * kullanır; tests/recete-onay.test.ts sınar.
 */

import type { RecipeSnapshot } from "@/server/db/schema";

import { num } from "./format";

export type { RecipeSnapshot };
export type SnapshotLine = RecipeSnapshot["items"][number];

export type DiffRow =
  | { kind: "same"; key: string; name: string; unit: string; before: SnapshotLine; after: SnapshotLine }
  | { kind: "changed"; key: string; name: string; unit: string; before: SnapshotLine; after: SnapshotLine; qty: boolean; note: boolean }
  | { kind: "added"; key: string; name: string; unit: string; after: SnapshotLine }
  | { kind: "removed"; key: string; name: string; unit: string; before: SnapshotLine };

export interface RecipeDiff {
  rows: DiffRow[];
  note: { before: string; after: string; changed: boolean };
  added: number;
  removed: number;
  changed: number;
  /** Hiçbir satır ve not değişmedi */
  empty: boolean;
}

const clean = (v: string | null | undefined) => (v ?? "").trim();
/** Formüller boşluk ve büyük/küçük harf farkı gözetmeden karşılaştırılır ("2 * shotcift" = "2*ShotCift") */
const exprKey = (v: string | null | undefined) => clean(v).replace(/^=/, "").replace(/\s+/g, "").toLocaleLowerCase("tr-TR");

/** İki satırın miktarı aynı mı: formülde formül metni, düz sayıda değer (kayan nokta payıyla) */
export function sameQty(a: Pick<SnapshotLine, "qty" | "qtyExpr">, b: Pick<SnapshotLine, "qty" | "qtyExpr">): boolean {
  if (a.qtyExpr || b.qtyExpr) return exprKey(a.qtyExpr) === exprKey(b.qtyExpr);
  return Math.abs(a.qty - b.qty) < 1e-9;
}

/**
 * Satırlar malzemeye göre eşleşir; aynı malzeme bir reçetede iki kez geçerse sırayla (1., 2. geçiş) eşleşir.
 * Sonuç önerilen reçetenin sırasındadır, çıkarılan satırlar sonda.
 */
export function diffRecipe(before: RecipeSnapshot, after: RecipeSnapshot): RecipeDiff {
  const keyed = (items: SnapshotLine[]) => {
    const seen = new Map<number, number>();
    return items.map((line) => {
      const n = (seen.get(line.ingredientId) ?? 0) + 1;
      seen.set(line.ingredientId, n);
      return { key: `${line.ingredientId}#${n}`, line };
    });
  };
  const prev = new Map(keyed(before.items).map((x) => [x.key, x.line]));
  const rows: DiffRow[] = [];
  const used = new Set<string>();
  for (const { key, line } of keyed(after.items)) {
    const old = prev.get(key);
    if (!old) {
      rows.push({ kind: "added", key, name: line.name, unit: line.unit, after: line });
      continue;
    }
    used.add(key);
    const qty = !sameQty(old, line);
    const note = clean(old.note) !== clean(line.note);
    rows.push(qty || note ? { kind: "changed", key, name: line.name, unit: line.unit, before: old, after: line, qty, note } : { kind: "same", key, name: line.name, unit: line.unit, before: old, after: line });
  }
  for (const [key, line] of prev) {
    if (!used.has(key)) rows.push({ kind: "removed", key, name: line.name, unit: line.unit, before: line });
  }
  const noteBefore = clean(before.note);
  const noteAfter = clean(after.note);
  const count = (k: DiffRow["kind"]) => rows.filter((r) => r.kind === k).length;
  const added = count("added");
  const removed = count("removed");
  const changed = count("changed");
  // Yalnızca sıra değiştiyse de değişiklik sayılır (barista malzemeyi o sırayla koyar)
  const reordered = !added && !removed && before.items.some((l, i) => l.ingredientId !== after.items[i]?.ingredientId);
  return {
    rows,
    note: { before: noteBefore, after: noteAfter, changed: noteBefore !== noteAfter },
    added,
    removed,
    changed,
    empty: !added && !removed && !changed && !reordered && noteBefore === noteAfter,
  };
}

/** İki reçete aynı mı (onayda: öneriden sonra reçete değişti mi) */
export function sameRecipe(a: RecipeSnapshot, b: RecipeSnapshot): boolean {
  return diffRecipe(a, b).empty;
}

/** "18 gr", formülde "2*ShotCift (36 gr)" */
export function qtyLabel(line: Pick<SnapshotLine, "qty" | "qtyExpr" | "unit">): string {
  const value = `${num(line.qty, 3)} ${line.unit}`.trim();
  return line.qtyExpr ? `${line.qtyExpr.replace(/^=/, "")} (${value})` : value;
}

/** İşlem geçmişi ve bildirim için tek satır: "Süt 200 → 220 ml; Karamel eklendi (10 ml); Şeker çıkarıldı; not değişti" */
export function summarizeDiff(diff: RecipeDiff, max = 400): string {
  const parts: string[] = [];
  for (const r of diff.rows) {
    if (r.kind === "added") parts.push(`${r.name} eklendi (${qtyLabel(r.after)})`);
    else if (r.kind === "removed") parts.push(`${r.name} çıkarıldı`);
    else if (r.kind === "changed") parts.push(r.qty ? `${r.name} ${qtyLabel(r.before)} → ${qtyLabel(r.after)}` : `${r.name} satır notu değişti`);
  }
  if (diff.note.changed) parts.push("hazırlama notu değişti");
  if (!parts.length) return diff.empty ? "değişiklik yok" : "malzeme sırası değişti";
  const text = parts.join("; ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Onay bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};
