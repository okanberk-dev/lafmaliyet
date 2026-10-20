/**
 * Günlük hatırlatma e-postasının şablonu (saf; "server-only" yok, tests/hatirlaticilar-digest.test.ts sınar).
 * Veriyi okuyup gönderen kısım digest.ts'te.
 */

import { dateTR, money } from "@/lib/format";
import { daysLeftLabel, longDateTR, monthShortTR, type NotifyStage, type UpcomingItem } from "@/lib/reminders";

export const APP_URL = (process.env.APP_URL?.trim() || "https://ladmin.laffogato.net").replace(/\/+$/, "");

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAGE: Record<NotifyStage, { label: string; title: string; bg: string; fg: string; tile: string; tileFg: string }> = {
  overdue: { label: "Gecikti", title: "Gecikenler", bg: "#fef2f2", fg: "#dc2626", tile: "#dc2626", tileFg: "#ffffff" },
  due: { label: "Bugün", title: "Son günü bugün", bg: "#fff7ed", fg: "#c2410c", tile: "#e8590c", tileFg: "#ffffff" },
  before: { label: "Yaklaşıyor", title: "Yaklaşanlar", bg: "#f4f4f5", fg: "#3f3f46", tile: "#e4e4e7", tileFg: "#3f3f46" },
};
const STAGE_ORDER: NotifyStage[] = ["overdue", "due", "before"];
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,Roboto,Helvetica,Arial,sans-serif";

/**
 * Günlük hatırlatma e-postası: AkmanOS açık teması, satır içi stiller ve tablolarla (e-posta istemcileri flex ve
 * dış CSS tanımaz). Telefonda tek sütun: üstte L'Af başlığı, aşamalara göre gruplar, sağa hizalı tutarlar, en
 * altta tam genişlikte "Panelde aç" düğmesi.
 */
export function renderDigest(rows: { item: UpcomingItem; stage: NotifyStage }[], today: string) {
  const counts = { overdue: 0, due: 0, before: 0 };
  for (const r of rows) counts[r.stage]++;
  const parts = [counts.overdue ? `${counts.overdue} gecikmiş` : null, counts.due ? `${counts.due} bugün` : null, counts.before ? `${counts.before} yaklaşan` : null].filter(Boolean);
  const subject = `Ödeme hatırlatması: ${parts.join(", ")}`;
  const total = rows.reduce((a, r) => a + (r.item.amount ?? 0), 0);
  const link = `${APP_URL}/panel/hatirlaticilar`;
  const headline = rows.length === 1 ? "1 ödeme sizi bekliyor" : `${rows.length} ödeme sizi bekliyor`;
  const preheader = `${parts.join(", ")} · toplam ${money(total)}`;

  const pills = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => {
      const c = STAGE[st];
      return `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;font-size:12px;line-height:16px;font-weight:600;background:${c.bg};color:${c.fg}">${counts[st]} ${esc(st === "overdue" ? "gecikmiş" : st === "due" ? "bugün" : "yaklaşan")}</span>`;
    })
    .join("");

  const row = ({ item, stage }: { item: UpcomingItem; stage: NotifyStage }) => {
    const c = STAGE[stage];
    const day = Number(item.dueDate.slice(8, 10));
    const meta = [dateTR(item.dueDate), daysLeftLabel(item.daysLeft), item.detail].filter(Boolean).map((v) => esc(String(v))).join(" · ");
    return `<tr>
  <td width="44" style="width:44px;padding:12px 12px 12px 0;vertical-align:top">
    <table role="presentation" width="44" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;width:44px;border-radius:10px;overflow:hidden;border:1px solid #e4e4e7">
      <tr><td align="center" style="background:${c.tile};color:${c.tileFg};font-size:10px;line-height:14px;font-weight:600;font-family:${FONT}">${esc(monthShortTR(item.dueDate))}</td></tr>
      <tr><td align="center" style="background:#ffffff;color:#171717;font-size:18px;line-height:26px;font-weight:600;font-family:${FONT}">${day}</td></tr>
    </table>
  </td>
  <td style="padding:12px 0;vertical-align:top;font-family:${FONT}">
    <div style="font-size:15px;line-height:20px;font-weight:600;color:#171717">${esc(item.title)}</div>
    <div style="font-size:13px;line-height:18px;color:#71717a;margin-top:2px">${meta}</div>
  </td>
  <td align="right" style="padding:12px 0 12px 12px;vertical-align:top;white-space:nowrap;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:#171717">${item.amount !== null ? esc(money(item.amount)) : '<span style="color:#a1a1aa">–</span>'}</td>
</tr>`;
  };

  const sections = STAGE_ORDER.filter((st) => counts[st])
    .map((st) => {
      const c = STAGE[st];
      const group = rows.filter((r) => r.stage === st);
      const sum = group.reduce((a, r) => a + (r.item.amount ?? 0), 0);
      return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:20px">
  <tr>
    <td style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT}">
      <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${c.fg};margin-right:6px;vertical-align:middle"></span><span style="font-size:13px;font-weight:600;color:${c.fg};vertical-align:middle">${esc(c.title)} · ${group.length}</span>
    </td>
    <td align="right" style="padding:0 0 4px;border-bottom:1px solid #e4e4e7;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(money(sum))}</td>
  </tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">${group.map(row).join("\n")}</table>`;
    })
    .join("\n");

  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;-webkit-text-size-adjust:100%;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f4f5"><tr><td align="center" style="padding:20px 12px 28px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 4px 14px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td style="vertical-align:middle">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
          <td width="38" height="38" align="center" style="width:38px;height:38px;background:#171717;border-radius:11px;color:#c0f21e;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:-0.02em">L'Af</td>
          <td style="padding-left:10px;font-family:${FONT}">
            <div style="font-size:16px;line-height:20px;font-weight:600;color:#171717">L'Affogato</div>
            <div style="font-size:12px;line-height:16px;color:#71717a">Ödemeler &amp; hatırlatıcılar</div>
          </td>
        </tr></table>
      </td>
      <td align="right" style="vertical-align:middle;font-family:${FONT};font-size:13px;color:#71717a;white-space:nowrap">${esc(longDateTR(today))}</td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:24px 20px 22px">
    <div style="font-family:${FONT};font-size:13px;line-height:18px;color:#71717a">Günlük ödeme hatırlatması</div>
    <h1 style="margin:4px 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:600;letter-spacing:-0.02em;color:#171717">${esc(headline)}</h1>
    <div>${pills}</div>
    ${sections}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:4px">
      <tr>
        <td style="padding:14px 0 0;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:14px;color:#3f3f46">Toplam</td>
        <td align="right" style="padding:14px 0 0;border-top:1px solid #e4e4e7;font-family:${FONT};font-size:18px;font-weight:600;color:#171717;white-space:nowrap">${esc(money(total))}</td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px">
      <tr><td align="center" bgcolor="#171717" style="border-radius:14px;background:#171717">
        <a href="${link}" style="display:block;padding:15px 20px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:14px">Panelde aç</a>
      </td></tr>
    </table>
    <p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:19px;color:#71717a;text-align:center">Ödediklerinizi panelde “Ödendi” olarak işaretleyin; tekrar edenler sıradaki tarihe geçer.</p>
  </td></tr>
  <tr><td style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:17px;color:#a1a1aa;text-align:center">Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler &amp; hatırlatıcılar sayfasından değiştirebilirsiniz.</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `L'Affogato · ${dateTR(today)}`,
    subject,
    `Toplam ${money(total)}`,
    ...STAGE_ORDER.filter((st) => counts[st]).flatMap((st) => [
      "",
      `${STAGE[st].title} (${counts[st]})`,
      ...rows
        .filter((r) => r.stage === st)
        .map(({ item }) => `- ${item.title} · ${dateTR(item.dueDate)} (${daysLeftLabel(item.daysLeft)}) · ${item.amount !== null ? money(item.amount) : "–"} · ${STAGE[st].label}`),
    ]),
    "",
    `Panelde aç: ${link}`,
  ].join("\n");

  return { subject, html, text };
}
