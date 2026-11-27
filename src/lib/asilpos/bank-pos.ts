import { reportNo } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { button, callout, emailShell, esc, heading, rows, sectionTitle, textRowHtml, type Row, type Tone } from "@/lib/email-kit";
import { longDateTR } from "@/lib/reminders";

import type { BankPos } from "./day";
import { TEL_KART_ALANI } from "./eski-adlar";

/**
 * Pavo – AsilPOS kart karşılaştırması (saf; şema src/lib/asilpos/day.ts bankPosSchema): gün sonu e-postası, kısa Pavo
 * e-postası ve panelin Kasa gün görünümü aynı satırları buradan okur. Banka POS Z (yazarkasa) fotoğrafının eksik uyarısı
 * bununla ilgili değildir (o yazarkasanın Z'si içindir, src/lib/asilpos/gun-sonu.ts MISSING_LABEL).
 */

export const PAVO_TITLE = "Pavo – AsilPOS kart karşılaştırması";

/** "uyumlu": fark 0; "fark": FARK VAR; "yok": Pavo sonucu alınamadı ya da tutar eksik (karşılaştırılamadı) */
export type PavoState = "uyumlu" | "fark" | "yok";

export interface PavoView {
  state: PavoState;
  /** Uyarı satırı: "Uyumlu" / "FARK VAR: 120,00 ₺ (Pavo fazla)" / "Pavo sonucu alınamadı: …" */
  headline: string;
  /**
   * Satırlar: gün sonu tam gövdesinde önce günün karşılaştırması (Pavo'nun günü = Σ batch, AsilPOS'un bütün gün kartı,
   * günün farkı), sonra son batch'in ayrıntısı (Pavo kart toplamı, AsilPOS kart toplamı, fark, batch no)
   */
  rows: [string, string][];
  /** Günün batch'leri tek tek (eski gövdede boş): "Batch 000278 · elle", tutar */
  batches: [string, string][];
  /** Banka (acquirer) dökümü: ad, adet ve tutar */
  acquirers: [string, string][];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Fark: AsilPOS'un gönderdiği, yoksa iki tutardan (Pavo − AsilPOS); biri eksikse null */
export function pavoDiff(b: BankPos): number | null {
  if (b.diff !== null) return b.diff;
  const kart = b[TEL_KART_ALANI];
  if (b.pavoCard === null || kart === null) return null;
  return round2(b.pavoCard - kart);
}

/**
 * Günün karşılaştırması (gün sonu tam, 24 Kasım 2026): Pavo'nun bu AsilPOS gününe ait bütün başarılı gün sonlarının
 * toplamı ↔ AsilPOS'un bütün gün kart tabanı (dayCard). Son batch'in tutarı yalnız ondan sonraki kartı kapsar (gün ortasında
 * elle alınan gün sonu da günündür): "Uyumlu 755 = 755" günün 995'ini görmezdi. Batch listesi ya da dayCard yoksa (eski
 * AsilPOS, gün açık) ya da bir batch'in tutarı okunamadıysa null: karşılaştırma son batch'le
 */
export function pavoDay(b: BankPos): { count: number; sum: number; dayCard: number; diff: number } | null {
  if (!b.batches?.length || b.dayCard === undefined || b.dayCard === null || b.batches.some((x) => x.total === null)) return null;
  const sum = round2(b.batches.reduce((a, x) => a + (x.total ?? 0), 0));
  return { count: b.batches.length, sum, dayCard: b.dayCard, diff: round2(sum - b.dayCard) };
}

export function pavoState(b: BankPos): PavoState {
  if (b.status !== "ok") return "yok";
  const day = pavoDay(b);
  const d = day ? day.diff : pavoDiff(b);
  if (d === null) return "yok";
  return Math.abs(d) < 0.005 ? "uyumlu" : "fark";
}

const STATUS_TEXT: Record<BankPos["status"], string> = {
  ok: "Pavo sonucu geldi",
  failed: "Pavo sonucu alınamadı",
  unknown: "Pavo sonucu belli değil",
};

/** Başlığın parantezi: cihazın açıklaması ve hata kodu ("(Gün sonu alınamadı; hata kodu 5085)"); ikisi de yoksa boş */
function detailOf(b: BankPos): string {
  const parts = [b.message, b.errorCode ? `hata kodu ${b.errorCode}` : null].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
}

const diffText = (d: number | null) => (d === null ? "yok" : Math.abs(d) < 0.005 ? `${money(0)} · Uyumlu` : `${money(Math.abs(d))} ${d > 0 ? "fazla" : "eksik"} · FARK VAR`);

export function pavoView(b: BankPos): PavoView {
  const state = pavoState(b);
  const day = b.status === "ok" ? pavoDay(b) : null;
  const d = day ? day.diff : pavoDiff(b);
  // Kartla cari tahsilatı başka bir POS'tan çekildiyse Pavo'da görünmez (AsilPOS'un tabanı onu Pavo'da sayar)
  const hint = " Kart slipleri ve AsilPOS'taki kart ödemeleri kontrol edilmeli; kartla cari tahsilatı başka bir POS'tan çekildiyse Pavo'da görünmez.";
  const headline =
    state === "uyumlu"
      ? day
        ? `Uyumlu: Pavo'nun günü (${day.count} gün sonu, ${money(day.sum)}) AsilPOS'un bütün gün kartıyla aynı.`
        : "Uyumlu: Pavo ile AsilPOS'un kart toplamı aynı."
      : state === "fark"
        ? `FARK VAR: ${money(Math.abs(d!))} (${d! > 0 ? "Pavo fazla" : "Pavo eksik"}).${day ? ` Pavo'nun günü ${day.count} gün sonu, ${money(day.sum)}; AsilPOS'un bütün gün kartı ${money(day.dayCard)}.` : ""}${hint}`
        : `${STATUS_TEXT[b.status]}${b.status === "ok" ? ": tutar eksik, karşılaştırılamadı" : ""}${detailOf(b)}.`;
  const rows: [string, string][] = day
    ? [
        ["Pavo günün toplamı", money(day.sum)],
        ["AsilPOS bütün gün kartı", money(day.dayCard)],
        ["Günün farkı", diffText(day.diff)],
      ]
    : [];
  // Son batch'in ayrıntısı (gün sonu tam gövdesinde ayrıntı; eski gövdede karşılaştırmanın kendisi). Gün sonu alınamadıysa
  // (batch yok) AsilPOS'un kart toplamı yine bilinir: bütün gün kartı (dayCard; son denetim, 24 Kasım 2026)
  const posCard = b[TEL_KART_ALANI] ?? (b.status !== "ok" ? (b.dayCard ?? null) : null);
  rows.push(
    ["Pavo kart toplamı", b.pavoCard === null ? "yok" : money(b.pavoCard)],
    ["AsilPOS kart toplamı", posCard === null ? "yok" : money(posCard)],
    [day ? "Son gün sonunun farkı" : "Fark", diffText(pavoDiff(b))],
  );
  if (b.batchNo) rows.push(["Batch no", b.batchNo]);
  // Cihazın hata kodu (Faz 2; alınamayan gün sonu, ör. 5085): bankaya ya da Pavo'ya sorulurken söylenir
  if (b.errorCode) rows.push(["Hata kodu", b.errorCode]);
  const acquirers: [string, string][] = b.acquirers.map((a) => [`· ${a.name}${a.count !== null ? ` (${a.count})` : ""}`, a.total === null ? "yok" : money(a.total)]);
  const batches: [string, string][] = (b.batches ?? []).map((x) => [
    `Batch ${x.batchNo ?? "(no yok)"} · ${x.trigger}${x.dayClosed ? " · kapanış" : ""}`,
    x.total === null ? "okunamadı" : money(x.total),
  ]);
  return { state, headline, rows, batches, acquirers };
}

/** Karşılaştırmanın içerik özeti (FNV-1a, 32 bit): aynı sonuç ikinci kez e-postayla gitmez */
export function bankPosHash(b: BankPos): string {
  const text = JSON.stringify(b);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Kısa Pavo e-postasının konusu, gün sonu e-postasıyla aynı baş: "Kasa raporu KR-20261122 · Marina · 22 Kasım Pazar ·
 * Pavo karşılaştırması" (farkta sonda "· FARK VAR")
 */
export function pavoSubject(branchName: string, date: string, b: BankPos): string {
  const state = pavoState(b);
  return `Kasa raporu ${reportNo(date)} · ${branchName} · ${longDateTR(date)} · Pavo karşılaştırması${state === "fark" ? " · FARK VAR" : state === "yok" ? " · alınamadı" : ""}`;
}

/** Uyarı kutusunun tonu: fark sorun (kırmızı), alınamadı uyarı (turuncu), uyumlu iyi (yeşil) */
const BOX: Record<PavoState, Tone> = { fark: "bad", yok: "warn", uyumlu: "good" };

/** Satırın kit karşılığı: "· banka" satırları küçük ve içeride, "FARK" ve eksik kırmızı */
const pavoRow = ([label, value]: [string, string]): Row | string =>
  label.startsWith("· ") ? textRowHtml(null, `${label.slice(2)}: ${value}`, false, { muted: true, indent: true }) : { label, value, tone: /FARK|eksik/.test(value) ? "bad" : null };

/** E-postadaki bölüm (HTML): başlık, uyarı kutusu, satırlar ve banka dökümü */
export function pavoSectionHtml(b: BankPos, o: { top?: number } = {}): string {
  const v = pavoView(b);
  return `${sectionTitle(PAVO_TITLE, { top: o.top, dot: BOX[v.state] })}${callout(BOX[v.state], [v.headline], { top: 12 })}${rows([
    ...v.rows.map(pavoRow),
    ...v.batches.map(pavoRow),
    ...v.acquirers.map(pavoRow),
  ])}`;
}

/** E-postadaki bölüm (düz metin) */
export function pavoSectionText(b: BankPos): string[] {
  const v = pavoView(b);
  return [PAVO_TITLE, v.headline, ...v.rows.map(([l, x]) => `${l}: ${x}`), ...v.batches.map(([l, x]) => `${l}: ${x}`), ...v.acquirers.map(([l, x]) => `${l}: ${x}`)];
}

/**
 * Kısa Pavo e-postası: gün sonu e-postası Pavo sonucundan önce gittiyse, sonuç gelince yalnız karşılaştırma gider (gün
 * sonu yeniden gönderilmez)
 */
export function renderPavoMail(m: { branchName: string; date: string; bankPos: BankPos; link: string }): { subject: string; html: string; text: string } {
  const subject = pavoSubject(m.branchName, m.date, m.bankPos);
  const v = pavoView(m.bankPos);
  const html = emailShell({
    subject,
    preheader: v.headline,
    brandSubHtml: `Pavo karşılaştırması · ${esc(m.branchName)}`,
    dateLabel: `${longDateTR(m.date)} ${m.date.slice(0, 4)}`,
    cardHtml: `${heading("Pavo – AsilPOS kart karşılaştırması", { eyebrow: "Gün sonu e-postası daha önce gitti" })}
${pavoSectionHtml(m.bankPos, { top: 24 })}
${button(m.link, "Panelde aç")}`,
    footer: "Bu e-posta kasa raporu alıcılarına gönderildi.",
  });
  const text = [subject, "", ...pavoSectionText(m.bankPos), "", `Panelde aç: ${m.link}`].join("\n");
  return { subject, html, text };
}
