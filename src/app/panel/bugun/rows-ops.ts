// Bugün ekranının operasyon satırları (saf; logic.ts'in satır listeleri ADMIN_ROWS / STAFF_ROWS bunları çağırır,
// docs/BUGUN.md). Operasyon grubunun dosyası (plan docs/planlar/personel-yetki.md §4.3): kasadaki fiyatlar (§2.2),
// dünün kontrol listeleri (§2.5), onaylanmış mal siparişi taslağı (§2.4) ve "Bugün kafede"nin Tükendi satırı (§2.1).
// Olguları src/server/data/today-ops.ts toplar (iki rolde); personelin olgusunda tutar ve maliyet yok.
// Testler: tests/bugun.test.ts.

import { isStarted } from "@/lib/checklists";
import { num } from "@/lib/format";
import { staleForText } from "@/lib/prices/pos";

import { clip, type CafeLine, type DayFacts, type DayRow } from "./logic";

/** Operasyonun Bugün olguları (DayFacts.ops); alanları maddeleriyle gelir, hepsi isteğe bağlı */
export interface OpsDayFacts {
  /**
   * Sitede "Tükendi" olan ürünler (§2.1): adlar ve kayıtlar (kim, ne zaman; `staff` personelin kapattığı). Fiyat yok
   */
  soldOut?: { names: string[]; items: { name: string; by: string; at: string; staff: boolean }[] } | null;
}

/**
 * Kasada (ModPOS) elle değiştirilecek fiyatlar (Ürünler › Fiyatlar › Kasaya işle; zil ile aynı metin). Bugün yalnız
 * yönetici; personelin satırı (Kasadaki fiyatlar listesi) §2.2 ile gelir.
 */
export const posRow: DayRow = (f) => {
  const p = f.pos;
  if (f.role !== "admin" || !p || p.count <= 0) return null;
  return {
    key: "modpos",
    title: "Kasadaki fiyatlar",
    status: "todo",
    badge: `${num(p.count)} fiyat`,
    detail: `Kasada değişecek ${num(p.count)} fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin.${p.oldest ? ` En eskisi ${staleForText(p.oldest, f.now)} bekliyor.` : ""}`,
    href: "/panel/urunler/fiyatlar?sekme=kasa",
    action: "Kasaya işle",
  };
};

/**
 * Yönetici: dünün listelerinden tamamlanmayan ya da sorunlu (düzeltilmiş ölçüm dahil) olan varsa tek satır. Dünün kasa
 * raporu da yoksa (kasa kullanılmaya başladıysa) kafe kapalı olabilir: açıklama bunu söyler. Personelin satırı (son 7
 * günün geçmişi) §2.5 ile gelir.
 */
export const checklistYesterday: DayRow = (f, c) => {
  const y = f.checklistsYesterday;
  if (f.role !== "admin" || !y) return null;
  const missing = y.lists.filter((l) => !l.run?.complete);
  const problems = y.lists.flatMap((l) => l.run?.issues ?? []);
  if (!missing.length && !problems.length) return null;
  const parts = [
    ...missing.map((l) => (isStarted(l) && l.run ? `${l.name}: ${num(l.run.required - l.run.done)} madde yapılmadı` : `${l.name}: hiç açılmadı`)),
    ...problems.map((x) => x.text),
  ];
  const cashMissing = f.cash !== null && f.cash.yesterday === null && f.cash.firstDate !== null && f.cash.firstDate <= c.yesterday;
  return {
    key: "liste-dun",
    title: "Dünkü kontrol listeleri",
    status: "warn",
    badge: missing.length ? `${num(missing.length)} eksik` : `${num(problems.length)} sorun`,
    detail: `${clip(parts.join(" · "), 160)}${cashMissing ? " · Kasa raporu da yok; kafe kapalıysa önemsemeyin." : ""}`,
    href: `/panel/kontrol/gecmis?gun=${y.day}`,
    action: "Geçmişe bak",
  };
};

/** Personel: onaylanmış, gönderilmeyi bekleyen mal siparişi taslağı (`mal-taslak`; §2.4). Olgusu maddesiyle gelir */
export const draftRow: DayRow = () => null;

/**
 * "Bugün kafede"nin Tükendi satırı (iki rol; §2.1): "Tükendi: Tiramisu, Cheesecake", bar ekranının Tükenenler
 * kartına götürür. Olgu yoksa satır yok.
 */
export function soldOutLine(f: DayFacts): CafeLine | null {
  const names = f.ops?.soldOut?.names ?? [];
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(", ");
  return { key: "tukendi", text: `Tükendi: ${shown}${names.length > 3 ? "…" : ""}`, tone: "info", href: "/panel/karaoke#tukenenler" };
}
