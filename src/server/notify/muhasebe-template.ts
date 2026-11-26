/**
 * Muhasebeciye ay kapanış e-postası (saf; "server-only" yok, tests/muhasebe-paketi.test.ts sınar): sabah e-postasıyla
 * aynı kabuk (emailLayout), ayın özeti satır satır, paket .xlsx olarak ekte. Panel bağlantısı yok: muhasebecinin panel
 * hesabı yoktur, her şey ektedir. Veriyi ve gönderimi src/server/muhasebe/paket.ts yapar.
 */

import { monthTitle } from "@/lib/closed-period";
import { packageFileName, packageMailLines, packageSubject, type PackageData, type PackageSummary } from "@/lib/muhasebe/paket";
import { todayTR } from "@/lib/reminders";

import { emailLayout, esc, FONT } from "./digest-template";

/** E-postanın alt notu */
export const PACKAGE_FOOTER = "Bu e-posta L'Affogato panelinden muhasebeciye gönderildi. Alıcılar: panel › Ayarlar › Muhasebeci paketi.";
const NOTE = "Rakamlar panelin kayıtlarıdır; resmi defter ve beyan sizdedir. Ayrıntı ekteki dosyanın sekmelerinde: Faturalar, Harcamalar, Kasa raporları, Z KDV dökümü, Sabit giderler.";

export function renderPackageMail(d: Pick<PackageData, "month" | "closed" | "createdAt">, s: PackageSummary, o: { auto: boolean }): { subject: string; html: string; text: string } {
  const subject = packageSubject(d.month);
  const title = monthTitle(d.month);
  const lines = packageMailLines(d, s);
  const intro = o.auto ? `${title} kapandı. Ayın paketi ekte.` : `${title} paketi ekte.`;
  const file = packageFileName(d.month);
  const html = emailLayout({
    subject,
    preheader: `${title} · ${s.invoices} fatura, ${s.expenses} harcama`,
    brandSub: "Muhasebe paketi",
    today: todayTR(d.createdAt),
    footer: PACKAGE_FOOTER,
    card: `<div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">Ay kapanışı · ${esc(title)}</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(intro)}</h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:6px">
      ${lines.map((l) => `<tr><td style="padding:8px 0;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:14px;line-height:20px;color:#3f3f46">${esc(l)}</td></tr>`).join("\n      ")}
    </table>
    <p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:#3f3f46">Ek: <strong>${esc(file)}</strong></p>
    <p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa">${esc(NOTE)}</p>`,
  });
  const text = [`L'Affogato · Muhasebe paketi · ${title}`, intro, "", ...lines.map((l) => `- ${l}`), "", `Ek: ${file}`, NOTE, "", PACKAGE_FOOTER].join("\n");
  return { subject, html, text };
}
