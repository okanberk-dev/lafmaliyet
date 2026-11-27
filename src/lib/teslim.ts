/**
 * Teslim defteri (Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Teslim defteri): kasadan teslim edilen nakdi kimin aldığı.
 * İki kaynak tek listede:
 * - Kasa raporunun **Sayımdan sonra teslim**'i (`cash_reports.handed_over`) ve "Kime"si (`handed_to`): yönetici
 *   kullanıcı, Banka ya da elle yazılan ad. Panelde girilen kasa (Tuzla) burada yazar.
 * - **Gün içinde** "Teslim · ödeme" satırları (`cash_outs`, tür teslim) ve "Kime"si (`store`): Marina'nın AsilPOS'tan
 *   gelen teslimleri de buradadır (AsilPOS'un `cashMoves[].recipient`'i satırın Kime'si olur; docs/ASILPOS.md).
 * Saf: tests/teslim-defteri.test.ts
 */

import { money } from "./format";

/** "Kime" en çok bu kadar karakter (Kasadan çıkanlar'ın Kime alanı ve AsilPOS'un alıcısıyla aynı sınır) */
export const HANDED_TO_MAX = 60;

/** Bankaya yatırılan teslimin "Kime"si */
export const HANDED_TO_BANK = "Banka";

/** Formdan gelen "Kime": yönetici kullanıcı, banka ya da elle yazılan ad */
export type HandedToInput = { kind: "user"; id: number } | { kind: "banka" } | { kind: "ad"; name: string };

/** Elle yazılan adın kayıtlı biçimi: boşluklar teke iner, en çok 60 karakter; boşsa null */
export function handedToName(raw: string | null | undefined): string | null {
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, HANDED_TO_MAX) || null;
}

/** Formun seçicisinin değeri ("user:3", "banka", "ad") ↔ kayıt */
export type HandedToChoice = `user:${number}` | "banka" | "ad" | "";

/** Kayıtlı Kime'den formun ilk seçimi ve adı: hesaplı alıcı "user:3", "Banka" banka, başka ad "ad" */
export function handedToChoiceOf(saved: { name: string | null; userId: number | null }): { choice: HandedToChoice; name: string } {
  if (saved.userId !== null) return { choice: `user:${saved.userId}`, name: "" };
  if (saved.name === HANDED_TO_BANK) return { choice: "banka", name: "" };
  if (saved.name) return { choice: "ad", name: saved.name };
  return { choice: "", name: "" };
}

/** Formun seçiminden sunucuya giden değer; eksikse null (seçilmedi ya da ad boş) */
export function handedToInputOf(choice: HandedToChoice, name: string): HandedToInput | null {
  if (choice === "banka") return { kind: "banka" };
  if (choice === "ad") {
    const n = handedToName(name);
    return n ? { kind: "ad", name: n } : null;
  }
  if (choice.startsWith("user:")) {
    const id = Number(choice.slice(5));
    return Number.isInteger(id) && id > 0 ? { kind: "user", id } : null;
  }
  return null;
}

/**
 * Teslim var ama "Kime" yok: raporu reddetmeli mi. Yeni raporda ve teslim tutarı değiştiyse evet; tutarı aynı kalan
 * eski raporun (alan gelmeden önce girilmiş) boş Kime'si yeniden sorulmaz
 */
export function handedToMissing(o: { handedOver: number; to: string | null; prev: { handedOver: number; handedTo: string | null } | null }): boolean {
  if (o.handedOver <= 0 || o.to) return false;
  if (o.prev && Math.abs(o.prev.handedOver - o.handedOver) < 0.005 && !o.prev.handedTo) return false;
  return true;
}

/** Defterin bir satırı */
export interface HandoverRow {
  date: string;
  branchId: string;
  amount: number;
  /** Alan ("Kime"); yazılmamışsa null */
  to: string | null;
  /** Kaydeden: raporu gönderen ya da satırı ekleyen ("AsilPOS") */
  by: string;
  /** Sayımdan sonra (kasa raporunun teslim alanı) ya da gün içinde (Kasadan çıkanlar'ın teslim satırı) */
  kind: "sayim" | "gun-ici";
  /** Satır AsilPOS'un kasa hareketinden geldi */
  asilpos: boolean;
  /** Kayıt: rapor ya da kasadan çıkan satırı */
  ref: { report: number } | { cashOut: number };
}

/** Defterin sırası: yeni gün üstte; aynı günde şube, sonra gün içi önce, sonra tutar */
export function sortLedger(rows: readonly HandoverRow[]): HandoverRow[] {
  const kindOrder = { "gun-ici": 0, sayim: 1 } as const;
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.branchId.localeCompare(b.branchId) || kindOrder[a.kind] - kindOrder[b.kind] || b.amount - a.amount);
}

/** Alıcıların özeti: alana göre toplam ve adet, büyükten küçüğe; Kime'si yazılmamışlar en sonda tek satır */
export function ledgerByRecipient(rows: readonly HandoverRow[]): { to: string | null; amount: number; count: number }[] {
  const map = new Map<string, { to: string | null; amount: number; count: number }>();
  for (const r of rows) {
    // Büyük / küçük harf ve boşluk farkı aynı kişi sayılır ("patron", "Patron ")
    const key = r.to ? r.to.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim() : "";
    const cur = map.get(key) ?? { to: r.to, amount: 0, count: 0 };
    cur.amount = Math.round((cur.amount + r.amount) * 100) / 100;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (a.to === null ? 1 : 0) - (b.to === null ? 1 : 0) || b.amount - a.amount);
}

/** Defterin toplamı */
export function ledgerTotal(rows: readonly HandoverRow[]): number {
  return Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
}

/** Kayıtlı raporun döküm satırı: "Sayımdan sonra teslim 2.000 ₺ · Kime: Okan" */
export function handedOverLine(amount: number, to: string | null): string {
  return `${money(amount)}${to ? ` · Kime: ${to}` : ""}`;
}

/** Ekran ve sunucu metinleri */
export const HANDOVER_TEXT = {
  required: "Sayımdan sonra teslim edileni kimin aldığını seçin (yönetici, banka ya da adını yazın).",
  userMissing: "Teslim alan yönetici bulunamadı; listeden seçin ya da adını yazın.",
  nameMissing: "Teslim alanın adını yazın.",
  noRecipient: "Kime yazılmamış",
} as const;
