import { Notice } from "@/components/ui/notice";
import { branchCariNote, type SharedCari } from "@/lib/cari/branch-account";
import { num, tl } from "@/lib/format";

/** Şube kipinde tedarikçilerin İşletme geneli satırlarının toplamı (Tedarikçiler listesi) */
export interface SharedTotals {
  debt: number;
  debtCount: number;
  credit: number;
  /** Faturasız borcu ya da hesabında parası olan tedarikçi sayısı */
  suppliers: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Tedarikçilerin İşletme geneli satırları toplanır (şube kipi; "Tümü"de satırlar null) */
export function sharedTotals(rows: readonly (SharedCari | null)[]): SharedTotals {
  const list = rows.filter((r): r is SharedCari => r !== null && (r.debtOpen > 0.005 || r.credit > 0.005));
  return {
    debt: r2(list.reduce((a, r) => a + r.debtOpen, 0)),
    debtCount: list.reduce((a, r) => a + r.debtOpenCount, 0),
    credit: r2(list.reduce((a, r) => a + r.credit, 0)),
    suppliers: list.length,
  };
}

/** "Faturasız borç 1.200,00 ₺ (2 alım) · hesaptaki para 300,00 ₺"; ikisi de yoksa "Faturasız borç ve hesaptaki para yok" */
export function sharedCariLine(s: { debt: number; debtCount: number; credit: number }): string {
  const parts = [s.debt > 0.005 ? `Faturasız borç ${tl(s.debt, 2)} (${num(s.debtCount)} alım)` : null, s.credit > 0.005 ? `hesaptaki para ${tl(s.credit, 2)}` : null].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(" · ") : "Faturasız borç ve hesaptaki para yok";
}

/**
 * Tedarikçi bakiyelerinin şube kipi (şube ayrımı parça 4; src/lib/cari/branch-account.ts): bakiyelerin neyi saydığı ve
 * firmanın İşletme geneli satırı. Sunucu bileşeni; Tedarikçiler listesi ve tedarikçinin sayfası çizer
 */
export function SharedCariNotice({ name, shared, className = "mb-4" }: { name: string; shared: { debt: number; debtCount: number; credit: number; suppliers?: number }; className?: string }) {
  const note = branchCariNote(name);
  const who = shared.suppliers !== undefined && shared.suppliers > 0 ? ` (${num(shared.suppliers)} tedarikçi)` : "";
  return (
    <Notice tone="neutral" size="sm" className={className} title={note.title} text={`İşletme geneli: ${sharedCariLine(shared)}${who}.`}>
      {note.text}
    </Notice>
  );
}
