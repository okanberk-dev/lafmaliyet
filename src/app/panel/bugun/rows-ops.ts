// Bugün ekranının operasyon satırları (saf; logic.ts'in satır listeleri ADMIN_ROWS / STAFF_ROWS bunları çağırır,
// docs/BUGUN.md). Operasyon grubunun dosyası (plan docs/planlar/personel-yetki.md §4.3): kasadaki fiyatlar (§2.2),
// dünün kontrol listeleri (§2.5), onaylanmış mal siparişi taslağı (§2.4) ve "Bugün kafede"nin Tükendi satırı (§2.1).
// Olguları src/server/data/today-ops.ts toplar (iki rolde); personelin olgusunda tutar ve maliyet yok.
// Testler: tests/bugun.test.ts.

import { isStarted } from "@/lib/checklists";
import { num } from "@/lib/format";
import { posMarksText, staleForText } from "@/lib/prices/pos";
import { soldOutLineText, type SoldOutFact } from "@/lib/site-menu/sold-out";

import { clip, type CafeLine, type DayFacts, type DayRow } from "./logic";

/** Operasyonun Bugün olguları (DayFacts.ops); alanları maddeleriyle gelir, hepsi isteğe bağlı */
export interface OpsDayFacts {
  /**
   * Bar ekranının Tükenenler kartıyla kapatılıp hâlâ geçerli kaydı olan ürünler (§2.1): adlar ve kayıtlar (kalem, kim,
   * ne zaman; `staff` personelin kapattığı), en eskisi önce. Fiyat yok
   */
  soldOut?: { names: string[]; items: SoldOutFact[] } | null;
  /**
   * Yönetici (§2.2): personelin son 48 saatte kasada işaretledikleri, kişi ve gün başına (en yeni önce; `at` o günün
   * son işareti, ISO). Geri alınanlar sayılmaz. Personelin olgusunda yok
   */
  posMarks?: { by: string; count: number; at: string }[] | null;
  /**
   * Personel (§2.4): yöneticinin onayladığı, gönderilmeyi bekleyen mal siparişi taslakları (yalnız tedarikçi adı; tutar
   * yok). Yöneticinin olgusunda yok: bekleyen taslaklar genel Onaylar satırında sayılır
   */
  drafts?: { id: number; supplier: string }[] | null;
}

/**
 * Kasada (ModPOS) elle değiştirilecek fiyatlar (§2.2; zil ile aynı metin). Personel: Kasadaki fiyatlar listesine
 * ("Listeyi aç"). Yönetici: Fiyatlar › Kasaya işle'ye; son 48 saatte personel kasada işaretlediyse açıklamanın sonuna
 * "Ayşe dün 3 fiyatı kasada işaretledi." eklenir, bekleyen fiyat kalmadıysa satır Tamamlananlar'a düşer ve Son
 * işaretlenenler kartına götürür (işaret onaysızdır; yönetici oradan geri alır).
 */
export const posRow: DayRow = (f) => {
  const p = f.pos;
  const pending = p && p.count > 0 ? p : null;
  const oldest = pending?.oldest ? ` En eskisi ${staleForText(pending.oldest, f.now)} bekliyor.` : "";
  if (f.role !== "admin") {
    if (!pending) return null;
    return {
      key: "modpos",
      title: "Kasadaki fiyatlar",
      status: "todo",
      badge: `${num(pending.count)} fiyat`,
      detail: `ModPOS'ta değişecek ${num(pending.count)} fiyat; değiştirdikçe işaretleyin.${oldest}`,
      href: "/panel/kasa/fiyatlar",
      action: "Listeyi aç",
    };
  }
  const marks = posMarksText(f.ops?.posMarks ?? [], f.now);
  if (!pending) {
    if (!marks) return null;
    return { key: "modpos", title: "Kasadaki fiyatlar", status: "done", detail: marks, href: "/panel/urunler/fiyatlar?sekme=kasa#son-isaretlenenler", action: "Son işaretlenenler" };
  }
  return {
    key: "modpos",
    title: "Kasadaki fiyatlar",
    status: "todo",
    badge: `${num(pending.count)} fiyat`,
    detail: `Kasada değişecek ${num(pending.count)} fiyat: ModPOS'ta elle değiştirip Fiyatlar › Kasaya işle'de işaretleyin.${oldest}${marks ? ` ${marks}` : ""}`,
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

/**
 * Personel: onaylanmış, gönderilmeyi bekleyen mal siparişi taslağı (`mal-taslak`; §2.4): "Onaylanan sipariş bekliyor:
 * Kaldi", eylem "Gönder" (taslak sayfasına). Yöneticide yok (Onaylar satırı sayar).
 */
export const draftRow: DayRow = (f) => {
  const list = f.ops?.drafts ?? [];
  if (f.role === "admin" || !list.length) return null;
  const names = list.map((d) => d.supplier);
  return {
    key: "mal-taslak",
    title: `Onaylanan sipariş bekliyor: ${clip(names.join(", "), 60)}`,
    status: "todo",
    ...(list.length > 1 ? { badge: `${num(list.length)} tedarikçi` } : {}),
    detail: "Yönetici onayladı; WhatsApp'tan tek dokunuşla gönderin (önce kayıt, sonra mesaj).",
    href: "/panel/hizli-sayim/siparis",
    action: "Gönder",
  };
};

/**
 * "Bugün kafede"nin Tükendi satırı (iki rol; §2.1): "Tükendi: Tiramisu, Cheesecake", bar ekranının Tükenenler
 * kartına götürür. Personelin kaydı 16 saatten eskiyse uyarı rengi: "Tiramisu 2 gündür tükendi: geldiyse satışa açın"
 * (src/lib/site-menu/sold-out.ts › soldOutLineText). Olgu yoksa satır yok.
 */
export function soldOutLine(f: DayFacts): CafeLine | null {
  const line = soldOutLineText(f.ops?.soldOut?.items ?? [], f.now);
  return line ? { key: "tukendi", ...line, href: "/panel/karaoke#tukenenler" } : null;
}
