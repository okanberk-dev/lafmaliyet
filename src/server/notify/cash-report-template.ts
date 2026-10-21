/**
 * Gün sonu kasa raporu e-postası (saf; "server-only" yok, tests/kasa-raporu.test.ts sınar). Sabah e-postasıyla aynı
 * görünüm: üstte L'Af başlığı, büyük kasa sonucu (eksik kırmızı, fazla turuncu, tutuyor yeşil), Z raporu, kasa ve
 * kart bölümleri, en altta "Panelde aç". Metin sürümü WhatsApp metninin yıldızsız hâli.
 */

import { CASH_TOLERANCE, computeCash, paymentLines, reportSubject, whatsappText, type CashReportFields, type DayWaste } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { longDateTR } from "@/lib/reminders";

import { APP_URL } from "./digest-template";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

const TONE = {
  short: { bg: "#fef2f2", fg: "#dc2626", label: "eksik" },
  over: { bg: "#fff7ed", fg: "#c2410c", label: "fazla" },
  even: { bg: "#f0fdf4", fg: "#15803d", label: "tutuyor" },
} as const;

function row(label: string, value: string, opts: { strong?: boolean; color?: string; sub?: string } = {}) {
  return `<tr>
  <td style="padding:7px 0;font-family:${FONT};font-size:14px;line-height:19px;color:#3f3f46">${esc(label)}${opts.sub ? `<div style="font-size:12px;line-height:16px;color:#71717a">${esc(opts.sub)}</div>` : ""}</td>
  <td align="right" style="padding:7px 0 7px 12px;font-family:${FONT};font-size:${opts.strong ? 16 : 14}px;line-height:19px;font-weight:${opts.strong ? 700 : 600};color:${opts.color ?? "#171717"};white-space:nowrap;vertical-align:top">${esc(value)}</td>
</tr>`;
}

/** Uzun metin satırı (kalem listesi): sarılır, sağa yaslanmaz */
function textRow(label: string, text: string) {
  return `<tr><td colspan="2" style="padding:7px 0;font-family:${FONT};font-size:14px;line-height:20px;color:#171717"><span style="color:#3f3f46">${esc(label)}:</span> ${esc(text)}</td></tr>`;
}

function section(title: string, rows: string, warning?: string | null) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:20px">
  <tr><td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;font-weight:600;color:#3f3f46">${esc(title)}</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${rows}</table>${
    warning
      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:6px"><tr><td style="background:#fff7ed;border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:13px;line-height:18px;color:#9a3412">${esc(warning)}</td></tr></table>`
      : ""
  }`;
}

export function renderCashReport(
  f: CashReportFields,
  meta: { by: string; revision: number; submittedAt: Date; waste?: DayWaste | null; /** Panelde kayıtlı ikramın menü fiyatıyla değeri */ ikramValue?: number | null },
) {
  const c = computeCash(f);
  const tone = TONE[c.kind];
  const subject = reportSubject(f, meta.revision);
  const headline = c.kind === "even" ? "Kasa tutuyor" : `${money(Math.abs(c.cashDiff))} ${tone.label}`;
  const time = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(meta.submittedAt);
  const zMeta = [f.zNo ? `Z no ${f.zNo}` : null, f.receipts ? `${f.receipts} fiş` : null].filter(Boolean).join(" · ");
  const paymentsWarning =
    Math.abs(c.paymentsDiff) >= CASH_TOLERANCE
      ? `Ödeme türlerinin toplamı (${money(c.paymentsTotal)}) Z toplamından ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}: bir tutar yanlış yazılmış olabilir.`
      : null;
  const cardWarning =
    c.cardDiff !== null && Math.abs(c.cardDiff) >= CASH_TOLERANCE
      ? `Banka POS gün sonu ModPOS'taki karttan ${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}.`
      : null;

  const zRows = [
    row("Toplam satış", money(f.zTotal), { strong: true }),
    ...paymentLines(f).map((p) => row(p.label, money(p.amount))),
    ...(f.offRevenue ? [row("Ödenmez / ikram (ciro dışı)", money(f.offRevenue))] : []),
    ...(meta.ikramValue ? [row("Panelde kayıtlı ikram", money(meta.ikramValue), { sub: "menü fiyatıyla" })] : []),
  ].join("\n");
  const ikramWarning =
    f.offRevenue !== null && meta.ikramValue != null && Math.abs(f.offRevenue - meta.ikramValue) >= CASH_TOLERANCE
      ? `ModPOS'un ödenmez tutarı panelde kayıtlı ikramdan ${money(Math.abs(f.offRevenue - meta.ikramValue))} ${f.offRevenue > meta.ikramValue ? "fazla" : "az"}: kaydı eksik ikram olabilir.`
      : null;
  const wasteRows = [
    ...(meta.waste?.ikram ? [textRow("İkram", meta.waste.ikram)] : []),
    ...(meta.waste?.zayi ? [textRow("Zayi", meta.waste.zayi)] : []),
  ].join("\n");
  const cashRows = [
    row("Açılış (dünden devir)", money(f.openingCash)),
    row("+ Nakit satış", money(f.cash)),
    ...(f.cashOut ? [row("− Gün içinde çıkan", money(f.cashOut), { sub: f.cashOutNote ?? undefined })] : []),
    row("= Olması gereken", money(c.expectedCash), { strong: true }),
    row("Sayılan", money(f.countedCash), { strong: true }),
    row("Fark", c.kind === "even" ? "Tutuyor" : `${money(Math.abs(c.cashDiff))} ${tone.label}`, { strong: true, color: tone.fg }),
    ...(f.handedOver ? [row("Teslim edilen", money(f.handedOver))] : []),
    row("Ertesi güne devir", money(c.carryOver)),
  ].join("\n");
  const cardRows =
    c.cardDiff === null
      ? ""
      : [
          row("ModPOS kart", money(f.card)),
          row("Banka POS gün sonu", money(f.bankPos)),
          row("Fark", Math.abs(c.cardDiff) < CASH_TOLERANCE ? "Yok" : `${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}`, {
            strong: true,
            color: Math.abs(c.cardDiff) < CASH_TOLERANCE ? "#15803d" : "#c2410c",
          }),
        ].join("\n");
  const link = `${APP_URL}/panel/kasa?gun=${f.date}`;

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(`${headline} · Z ${money(f.zTotal)} · ${meta.by}`)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td style="vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="38" height="38" align="center" style="width:38px;height:38px;background:#171717;border-radius:11px;color:#c0f21e;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:-0.02em">L'Af</td>
          <td style="padding-left:10px;font-family:${FONT}">
            <div style="font-size:16px;line-height:20px;font-weight:600;color:#171717">L'Affogato</div>
            <div style="font-size:12px;line-height:16px;color:#71717a">Gün sonu kasa raporu</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(longDateTR(f.date))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:24px 20px 22px">
    <div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">${esc(`${meta.by} · ${time}${meta.revision > 1 ? " · güncellendi" : ""}${zMeta ? ` · ${zMeta}` : ""}`)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px"><tr><td style="background:${tone.bg};border-radius:16px;padding:14px 16px;font-family:${FONT}">
      <div style="font-size:13px;line-height:18px;color:${tone.fg};font-weight:600">Kasa</div>
      <div style="font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.02em;color:${tone.fg}">${esc(headline)}</div>
      <div style="font-size:13px;line-height:18px;color:#3f3f46;margin-top:2px">Olması gereken ${esc(money(c.expectedCash))} · sayılan ${esc(money(f.countedCash))}</div>
    </td></tr></table>
    ${section("Z raporu (ModPOS)", zRows, paymentsWarning ?? ikramWarning)}
    ${section("Kasa (nakit)", cashRows)}
    ${cardRows ? section("Kart", cardRows, cardWarning) : ""}
    ${wasteRows ? section("Zayi & ikram", wasteRows) : ""}
    ${f.note ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px"><tr><td style="background:#f4f4f5;border-radius:12px;padding:10px 12px;font-family:${FONT};font-size:14px;line-height:20px;color:#3f3f46"><strong>Not:</strong> ${esc(f.note)}</td></tr></table>` : ""}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${link}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa;text-align:center">Bu e-posta kasa raporu alıcılarına gönderildi. Adresleri panelde Kasa raporu sayfasından değiştirebilirsiniz.</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = `${whatsappText(f, meta).replace(/\*/g, "")}\n\nPanelde aç: ${link}`;
  return { subject, html, text };
}
