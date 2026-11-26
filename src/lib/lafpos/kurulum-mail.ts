// Şube kurulumu e-postası (docs/LAFPOS.md › Şube kurulumu): şubenin panel hesabının davet bağlantısı ve şubeye özel
// LafPOS kurucusunun indirme bağlantısı tek e-postada. Saf (tests/lafpos-kurulum.test.ts).

import { button, divider, emailShell, heading, para } from "@/lib/email-kit";

export interface KurulumMail {
  branchName: string;
  /** Şubeye özel kurucunun indirme bağlantısı */
  downloadUrl: string;
  /** Şube hesabının davet bağlantısı (parolayı belirler); hesap zaten varsa null */
  inviteUrl: string | null;
  /** Panelin giriş adresi */
  loginUrl: string;
  /** Bağlantının son günü (gösterim metni) */
  until: string;
}

export function kurulumMail(m: KurulumMail): { subject: string; html: string; text: string } {
  const subject = `${m.branchName} şubesi: LafPOS kurulumu`;
  const lead = `${m.branchName} şubesi L'Affogato'ya eklendi. Kasa bilgisayarına LafPOS'u aşağıdaki bağlantıyla kurun; kasa şubeye kendiliğinden bağlanır.`;
  const html = emailShell({
    subject,
    preheader: lead,
    brandSubHtml: "Şube kurulumu",
    cardHtml: `${heading(`${m.branchName} şubesi`, { sub: lead })}
${button(m.downloadUrl, "LafPOS'u indir", { top: 24 })}
${para(`Bağlantı kasa bilgisayarında açılmalı. İnen dosyaya (LafPOS-Kur) çift tıklayın, Windows izin sorunca Evet deyin. Kurulum bitince kasa şubesini, gün sonu bağlantısını ve uzaktan yönetimi kendiliğinden alır. Bağlantı tek kurulumluktur, son geçerlilik: ${m.until}.`, { top: 16, muted: true, size: 14 })}
${m.inviteUrl ? `${divider(28)}
${para("Şubenin yönetim paneli hesabı da açıldı. Parolanızı belirleyin; LafPOS indirme bağlantısı Hesabım sayfasında da durur.", { top: 20 })}
${button(m.inviteUrl, "Parolamı belirle", { top: 16, secondary: true })}` : `${divider(28)}
${para(`İndirme bağlantısı panelde Hesabım sayfasında da durur: ${m.loginUrl}`, { top: 20, muted: true, size: 14 })}`}`,
    footer: "Bu e-posta L'Affogato yönetim panelinden gönderildi. Bağlantıyı kimseyle paylaşmayın.",
  });
  const text = [
    `${m.branchName} şubesi: LafPOS kurulumu`,
    "",
    lead,
    "",
    `LafPOS'u indir (kasa bilgisayarında açın): ${m.downloadUrl}`,
    `Son geçerlilik: ${m.until}. Bağlantı tek kurulumluktur.`,
    "",
    m.inviteUrl ? `Panel hesabınızın parolasını belirleyin: ${m.inviteUrl}` : `Panel: ${m.loginUrl}`,
  ].join("\n");
  return { subject, html, text };
}
