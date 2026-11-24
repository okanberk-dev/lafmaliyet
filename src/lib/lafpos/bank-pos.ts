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
  /**
   * Satırlar: gün sonu tam gövdesinde önce günün karşılaştırması (Pavo'nun günü = Σ batch, LafPOS'un bütün gün kartı,
   * günün farkı), sonra son batch'in ayrıntısı (Pavo kart toplamı, LafPOS kart toplamı, fark, batch no)
   */
  rows: [string, string][];
  /** Günün batch'leri tek tek (eski gövdede boş): "Batch 000278 · elle", tutar */
  batches: [string, string][];
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

/**
 * Günün karşılaştırması (gün sonu tam, 24 Kasım 2026): Pavo'nun bu LafPOS gününe ait bütün başarılı gün sonlarının
 * toplamı ↔ LafPOS'un bütün gün kart tabanı (dayCard). Son batch'in tutarı yalnız ondan sonraki kartı kapsar (gün ortasında
 * elle alınan gün sonu da günündür): "Uyumlu 755 = 755" günün 995'ini görmezdi. Batch listesi ya da dayCard yoksa (eski
 * LafPOS, gün açık) ya da bir batch'in tutarı okunamadıysa null: karşılaştırma son batch'le
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
  // Kartla cari tahsilatı başka bir POS'tan çekildiyse Pavo'da görünmez (LafPOS'un tabanı onu Pavo'da sayar)
  const hint = " Kart slipleri ve LafPOS'taki kart ödemeleri kontrol edilmeli; kartla cari tahsilatı başka bir POS'tan çekildiyse Pavo'da görünmez.";
  const headline =
    state === "uyumlu"
      ? day
        ? `Uyumlu: Pavo'nun günü (${day.count} gün sonu, ${money(day.sum)}) LafPOS'un bütün gün kartıyla aynı.`
        : "Uyumlu: Pavo ile LafPOS'un kart toplamı aynı."
      : state === "fark"
        ? `FARK VAR: ${money(Math.abs(d!))} (${d! > 0 ? "Pavo fazla" : "Pavo eksik"}).${day ? ` Pavo'nun günü ${day.count} gün sonu, ${money(day.sum)}; LafPOS'un bütün gün kartı ${money(day.dayCard)}.` : ""}${hint}`
        : `${STATUS_TEXT[b.status]}${b.status === "ok" ? ": tutar eksik, karşılaştırılamadı" : ""}${detailOf(b)}.`;
  const rows: [string, string][] = day
    ? [
        ["Pavo günün toplamı", money(day.sum)],
        ["LafPOS bütün gün kartı", money(day.dayCard)],
        ["Günün farkı", diffText(day.diff)],
      ]
    : [];
  // Son batch'in ayrıntısı (gün sonu tam gövdesinde ayrıntı; eski gövdede karşılaştırmanın kendisi). Gün sonu alınamadıysa
  // (batch yok) LafPOS'un kart toplamı yine bilinir: bütün gün kartı (dayCard; son denetim, 24 Kasım 2026)
  const lafposCard = b.lafposCard ?? (b.status !== "ok" ? (b.dayCard ?? null) : null);
  rows.push(
    ["Pavo kart toplamı", b.pavoCard === null ? "yok" : money(b.pavoCard)],
    ["LafPOS kart toplamı", lafposCard === null ? "yok" : money(lafposCard)],
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
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr><td colspan="2" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(PAVO_TITLE)}</td></tr><tr><td colspan="2" style="padding:8px 0 4px"><div style="background:${box.bg};border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:${v.state === "fark" ? 15 : 13}px;line-height:20px;font-weight:${v.state === "fark" ? 700 : 600};color:${box.ink}">${esc(v.headline)}</div></td></tr>${v.rows.map((r) => row(r)).join("")}${v.batches.map((r) => row(r, false)).join("")}${v.acquirers.map((r) => row(r, false)).join("")}</table>`;
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
