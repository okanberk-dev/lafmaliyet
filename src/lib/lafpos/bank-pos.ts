import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";

import type { BankPos } from "./day";

/**
 * Pavo – LafPOS kart karşılaştırması (saf; şema src/lib/lafpos/day.ts bankPosSchema): gün sonu e-postası, kısa Pavo
 * e-postası ve panelin Kasa gün görünümü aynı satırları buradan okur. Banka POS Z (yazarkasa) fotoğrafının eksik uyarısı
 * bununla ilgili değildir (o yazarkasanın Z'si içindir, src/lib/lafpos/gun-sonu.ts MISSING_LABEL).
 */

export const PAVO_TITLE = "Pavo – LafPOS kart karşılaştırması";

/** "uyumlu": fark 0; "fark": FARK VAR; "yok": Pavo sonucu alınamadı ya da tutar eksik (karşılaştırılamadı) */
export type PavoState = "uyumlu" | "fark" | "yok";

export interface PavoView {
  state: PavoState;
  /** Uyarı satırı: "Uyumlu" / "FARK VAR: 120,00 ₺ (Pavo fazla)" / "Pavo sonucu alınamadı: …" */
  headline: string;
  rows: [string, string][];
  /** Banka (acquirer) dökümü: ad, adet ve tutar */
  acquirers: [string, string][];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Fark: LafPOS'un gönderdiği, yoksa iki tutardan (Pavo − LafPOS); biri eksikse null */
export function pavoDiff(b: BankPos): number | null {
  if (b.diff !== null) return b.diff;
  if (b.pavoCard === null || b.lafposCard === null) return null;
  return round2(b.pavoCard - b.lafposCard);
}

export function pavoState(b: BankPos): PavoState {
  if (b.status !== "ok") return "yok";
  const d = pavoDiff(b);
  if (d === null) return "yok";
  return Math.abs(d) < 0.005 ? "uyumlu" : "fark";
}

const STATUS_TEXT: Record<BankPos["status"], string> = {
  ok: "Pavo sonucu geldi",
  failed: "Pavo sonucu alınamadı",
  unknown: "Pavo sonucu belli değil",
};

export function pavoView(b: BankPos): PavoView {
  const state = pavoState(b);
  const d = pavoDiff(b);
  const headline =
    state === "uyumlu"
      ? "Uyumlu: Pavo ile LafPOS'un kart toplamı aynı."
      : state === "fark"
        ? `FARK VAR: ${money(Math.abs(d!))} (${d! > 0 ? "Pavo fazla" : "Pavo eksik"}). Kart slipleri ve LafPOS'taki kart ödemeleri kontrol edilmeli.`
        : `${STATUS_TEXT[b.status]}${b.status === "ok" ? ": tutar eksik, karşılaştırılamadı" : ""}${b.message ? ` (${b.message})` : ""}.`;
  const rows: [string, string][] = [
    ["Pavo kart toplamı", b.pavoCard === null ? "yok" : money(b.pavoCard)],
    ["LafPOS kart toplamı", b.lafposCard === null ? "yok" : money(b.lafposCard)],
    ["Fark", d === null ? "yok" : Math.abs(d) < 0.005 ? `${money(0)} · Uyumlu` : `${money(Math.abs(d))} ${d > 0 ? "fazla" : "eksik"} · FARK VAR`],
  ];
  if (b.batchNo) rows.push(["Batch no", b.batchNo]);
  const acquirers: [string, string][] = b.acquirers.map((a) => [`· ${a.name}${a.count !== null ? ` (${a.count})` : ""}`, a.total === null ? "yok" : money(a.total)]);
  return { state, headline, rows, acquirers };
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

/** Kısa Pavo e-postasının konusu: "Marina · Pavo karşılaştırması · 22 Kasım Pazar" (farkta sonda "· FARK VAR") */
export function pavoSubject(branchName: string, date: string, b: BankPos): string {
  const state = pavoState(b);
  return `${branchName} · Pavo karşılaştırması · ${longDateTR(date)}${state === "fark" ? " · FARK VAR" : state === "yok" ? " · alınamadı" : ""}`;
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Uyarı kutusunun renkleri: fark tehlike (kırmızı), alınamadı uyarı (turuncu), uyumlu iyi (yeşil) */
const BOX: Record<PavoState, { bg: string; ink: string }> = {
  fark: { bg: "#fef2f2", ink: "#b91c1c" },
  yok: { bg: "#fff7ed", ink: "#9a3412" },
  uyumlu: { bg: "#f0fdf4", ink: "#166534" },
};

/** E-postadaki bölüm (HTML): başlık, uyarı kutusu, satırlar ve banka dökümü */
export function pavoSectionHtml(b: BankPos): string {
  const v = pavoView(b);
  const box = BOX[v.state];
  const row = ([label, value]: [string, string], strong = true) =>
    `<tr><td style="padding:6px 0;font-family:${FONT};font-size:14px;color:#3f3f46">${esc(label)}</td><td align="right" style="padding:6px 0 6px 12px;font-family:${FONT};font-size:14px;font-weight:${strong ? 600 : 400};color:#171717;white-space:nowrap">${esc(value)}</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td colspan="2" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(PAVO_TITLE)}</td></tr><tr><td colspan="2" style="padding:8px 0 4px"><div style="background:${box.bg};border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:${v.state === "fark" ? 15 : 13}px;line-height:20px;font-weight:${v.state === "fark" ? 700 : 600};color:${box.ink}">${esc(v.headline)}</div></td></tr>${v.rows.map((r) => row(r)).join("")}${v.acquirers.map((r) => row(r, false)).join("")}</table>`;
}

/** E-postadaki bölüm (düz metin) */
export function pavoSectionText(b: BankPos): string[] {
  const v = pavoView(b);
  return [PAVO_TITLE, v.headline, ...v.rows.map(([l, x]) => `${l}: ${x}`), ...v.acquirers.map(([l, x]) => `${l}: ${x}`)];
}

/**
 * Kısa Pavo e-postası: gün sonu e-postası Pavo sonucundan önce gittiyse, sonuç gelince yalnız karşılaştırma gider (gün
 * sonu yeniden gönderilmez)
 */
export function renderPavoMail(m: { branchName: string; date: string; bankPos: BankPos; link: string }): { subject: string; html: string; text: string } {
  const subject = pavoSubject(m.branchName, m.date, m.bankPos);
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px;font-family:${FONT}"><div style="font-size:16px;font-weight:600;color:#171717">L'Affogato ${esc(m.branchName)}</div><div style="font-size:12px;color:#71717a">Pavo karşılaştırması · ${esc(longDateTR(m.date))} ${m.date.slice(0, 4)} · gün sonu e-postası daha önce gitti</div></td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:4px 20px 22px">
    ${pavoSectionHtml(m.bankPos)}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px"><tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717"><a href="${esc(m.link)}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a></td></tr></table>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [subject, "", ...pavoSectionText(m.bankPos), "", `Panelde aç: ${m.link}`].join("\n");
  return { subject, html, text };
}
