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
 * Dünün kontrol listeleri (`liste-dun`). Yönetici: tamamlanmayan ya da sorunlu (düzeltilmiş ölçüm dahil) liste varsa
 * sorunlu satır; dünün kasa raporu da yoksa (kasa kullanılmaya başladıysa) kafe kapalı olabilir, açıklama bunu söyler.
 * Personel (dalga 10 §2.5): yapılacak satır (sorun değil), yalnız açık sorunlar ve başlamış listelerin eksik maddeleri;
 * hiç açılmamış liste yalnız dünün kasa raporu varken (kafe açıktı) yazılır. İkisi de son günlerin geçmişine götürür
 * ("Geçmişe bak"; personelde son 7 gün). Dün onaylı kapalıysa (§2.9) ve liste açılmadıysa satır yok; kapalı bildirimi
 * beklerken açıklamanın sonunda not, yöneticiyi Onaylar'a götürür.
 */
export const checklistYesterday: DayRow = (f, c) => {
  const y = f.checklistsYesterday;
  if (!y) return null;
  const admin = f.role === "admin";
  // Dün kafe kapalıydı (dalga 10 §2.9; kasa grubunun olgusu): onaylıysa açılmamış listeler eksik sayılmaz
  const closed = f.closed?.yesterday ?? null;
  if (closed?.state === "approved" && !y.lists.some((l) => l.run)) return null;
  const cashMissing = f.cash !== null && f.cash.yesterday === null && f.cash.firstDate !== null && f.cash.firstDate <= c.yesterday;
  // Personel: açılmamış liste yalnız kafe açıkken (dünün raporu var) yazılır; düzeltilmiş sorun yazılmaz
  const cashThere = f.cash !== null && f.cash.yesterday !== null;
  const missing = y.lists.filter((l) => !l.run?.complete && (admin || isStarted(l) || cashThere));
  const problems = y.lists.flatMap((l) => l.run?.issues ?? []).filter((x) => admin || x.open);
  if (!missing.length && !problems.length) return null;
  const parts = [
    ...missing.map((l) => (isStarted(l) && l.run ? `${l.name}: ${num(l.run.required - l.run.done)} madde yapılmadı` : `${l.name}: hiç açılmadı`)),
    ...problems.map((x) => x.text),
  ];
  const pending = closed?.state === "pending";
  const note = pending ? " · Personel kapalıydık dedi (onay bekliyor)" : admin && cashMissing ? " · Kasa raporu da yok; kafe kapalıysa önemsemeyin." : "";
  return {
    key: "liste-dun",
    title: "Dünkü kontrol listeleri",
    status: admin ? "warn" : "todo",
    badge: missing.length ? `${num(missing.length)} eksik` : `${num(problems.length)} sorun`,
    detail: `${clip(parts.join(" · "), 160)}${note}`,
    ...(pending && admin
      ? { href: closed.requestId ? `/panel/onaylar#istek-${closed.requestId}` : "/panel/onaylar", action: "Onaya bak" }
      : { href: `/panel/kontrol/gecmis?gun=${y.day}`, action: "Geçmişe bak" }),
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
