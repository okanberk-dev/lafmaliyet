/**
 * Tedarikçiye giden WhatsApp mesajı (docs/MAL-SIPARISI.md › Mesaj) ve bağlantısı. Mesajda fiyat yok; miktarlar
 * sipariş biriminde. Telefon kuralları Tedarikçiler'inkiyle aynı (whatsappHref: Türkiye'de yalnız cep numarası).
 * Saf modül: sipariş ekranı mesajı burada kurar, sunucu açılan metni saklar. tests/mal-siparisi.test.ts.
 */

import { phoneE164, whatsappHref, whatsappShareHref } from "@/app/panel/tedarikciler/logic";

import { num } from "../format";
import { longDateTR } from "../reminders";
import { unitWord, type PlanStatus } from "./levels";
import { DEFAULT_REORDER } from "./types";

/** "2 koli", "2,5 kg": tam sayı ondalıksız, küsurlu en çok iki ondalık; birim Türkçe küçük harf */
export function qtyLabel(qty: number, unit: string): string {
  const rounded = Math.round(qty * 1000) / 1000;
  return `${Number.isInteger(rounded) ? num(rounded, 0) : num(rounded, 2)} ${unitWord(unit) ?? ""}`.trim();
}

/** Satırdaki ad tek satır (alt satıra geçen ad mesajın madde düzenini bozmasın) */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Mesaj metni: kalın imza, madde madde kalemler (yalnız miktarı 0'dan büyük olanlar, verilen sırayla), varsa not.
 *
 *     Merhaba, *L'Affogato* siparişimiz:
 *
 *     • SÜT %2,5 YAĞLI 1 L: 2 koli
 *
 *     Not: Perşembe sabah 10'dan önce
 *     Teşekkürler.
 *
 * Personelin taslağında (`ref`, docs/MAL-SIPARISI.md › Personelin sipariş taslağı) "Teşekkürler."den önce "Onay no:
 * #42" satırı.
 */
export function orderMessage(o: { signature: string; lines: readonly { orderName: string; qty: number; unit: string }[]; note?: string | null; ref?: number | null }): string {
  // İmzadaki WhatsApp biçim işaretleri kalınlığı bozmasın
  const sig = oneLine(o.signature.replace(/[*_~`]/g, "")) || DEFAULT_REORDER.signature;
  const items = o.lines.filter((l) => l.qty > 0).map((l) => `• ${oneLine(l.orderName)}: ${qtyLabel(l.qty, l.unit)}`);
  const note = o.note?.trim().replace(/\n{3,}/g, "\n\n");
  // Personelin gönderdiği (yöneticinin onayladığı) taslakta onay numarası: tedarikçi siparişin onaylı olduğunu görür
  const ref = o.ref ? [`Onay no: #${o.ref}`] : [];
  return [`Merhaba, *${sig}* siparişimiz:`, "", ...items, "", ...(note ? [`Not: ${note}`] : []), ...ref, "Teşekkürler."].join("\n");
}

/**
 * WhatsApp bağlantısı: cep numarası varsa doğrudan o kişiye (`numara`); numara yoksa (`yok`) ya da cep değilse
 * (`sabit`: sabit hat, okunamayan numara) kişi WhatsApp'ta seçilir (`sec`).
 */
export function orderLink(phone: string | null | undefined, text: string): { href: string; target: "numara" | "sec"; reason: null | "yok" | "sabit" } {
  const direct = whatsappHref(phone, text);
  if (direct) return { href: direct, target: "numara", reason: null };
  return { href: whatsappShareHref(text), target: "sec", reason: phone?.trim() ? "sabit" : "yok" };
}

/** Numara cep telefonu mu (WhatsApp'a doğrudan gider) */
export function isMobile(phone: string | null | undefined): boolean {
  return whatsappHref(phone) !== null;
}

/** Saklanacak numara: cep telefonuysa E.164, değilse null */
export function mobileE164(phone: string | null | undefined): string | null {
  return isMobile(phone) ? phoneE164(phone) : null;
}

/** Kendi birimindeki miktar sayım biriminde, en çok bir ondalık: 26000 ml → "26 LT", 3227 ml → "3,2 LT" */
export function countAmount(base: number | null, countFactor: number, countUnit: string | null): string {
  if (base === null || !Number.isFinite(base)) return "–";
  return `${num(base / (countFactor > 0 ? countFactor : 1), 1)} ${countUnit ?? ""}`.trim();
}

/** Günün adı: "2026-10-22" → "Perşembe" */
export function dayName(day: string): string {
  return longDateTR(day).split(" ").at(-1) ?? "";
}

/**
 * Sipariş listesinde önerisi olmayan kalemlerin (kapalı bölüm) başlığı, her biri kendi sayısıyla: "Yeterli olanlar (2) ·
 * Sayılmayanlar (1) · Hedefi olmayanlar (1)". Sayılmamış ya da hedefi olmayan kalem "yeterli" diye sayılmaz.
 */
export function restLabel(statuses: readonly PlanStatus[]): string {
  const count = (s: PlanStatus) => statuses.filter((x) => x === s).length;
  const parts: [string, number][] = [
    ["Yeterli olanlar", count("yeterli")],
    ["Sayılmayanlar", count("sayilmadi")],
    ["Hedefi olmayanlar", count("hedef-yok")],
  ];
  return parts
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} (${num(n)})`)
    .join(" · ");
}
