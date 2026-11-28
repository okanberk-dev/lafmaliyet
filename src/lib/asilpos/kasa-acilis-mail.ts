// Kasa açılışının asıl yöneticiye giden e-postaları (docs/ASILPOS.md › Kasa açılışı): şubenin kasası yeni bir
// bilgisayara bağlandı ya da ladmin'den serbest bırakıldı. Parola, PIN, belirteç ve anahtar içermez. Saf
// (tests/kasa-acilis.test.ts).

import { emailShell, heading, para } from "@/lib/email-kit";

import { baglandiKonusu } from "./kasa-acilis";

export interface KasaMailBilgisi {
  sube: string;
  /** İşlemi yapan hesap (e-posta) */
  kim: string;
  /** Gösterim metni ("28 Kasım 2026 14:05") */
  zaman: string;
  /** Kasanın kimliği (bağlanmada) */
  kasa?: string | null;
}

function mail(subject: string, lead: string, detay: string, uyari: string) {
  const html = emailShell({
    subject,
    preheader: lead,
    brandSubHtml: "Kasa açılışı",
    cardHtml: `${heading(subject, { sub: lead })}
${para(detay, { top: 16, muted: true, size: 14 })}
${para(uyari, { top: 16 })}`,
    footer: "Bu e-posta L'Affogato yönetim panelinden gönderildi.",
  });
  return { subject, html, text: [subject, "", lead, "", detay, "", uyari].join("\n") };
}

/** "<şube> kasası yeni bir bilgisayara bağlandı" */
export function baglandiMail(m: KasaMailBilgisi): { subject: string; html: string; text: string } {
  return mail(
    baglandiKonusu(m.sube),
    `${m.sube} şubesinin kasası ${m.zaman} tarihinde ${m.kim} hesabıyla ladmin'e bağlandı.`,
    m.kasa ? `Kasa kimliği: ${m.kasa}` : "Kasa kimliği bildirilmedi.",
    "Bunu siz yapmadıysanız ladmin › Ayarlar › Şube ekleme'de şubenin kasasını serbest bırakın ve parolanızı değiştirin.",
  );
}

/** "<şube> kasası serbest bırakıldı" */
export function serbestMail(m: KasaMailBilgisi): { subject: string; html: string; text: string } {
  return mail(
    `${m.sube} kasası serbest bırakıldı`,
    `${m.sube} şubesinin kasası ${m.zaman} tarihinde ${m.kim} hesabıyla serbest bırakıldı: eski kasa ladmin bağlantısını kaybetti.`,
    "Şubenin kasa anahtarı yenilendi, bekleyen kurulum bağlantıları iptal edildi. Yeni bilgisayar şubeyi kasa açılışında seçebilir.",
    "Bunu siz yapmadıysanız hemen parolanızı değiştirin.",
  );
}
