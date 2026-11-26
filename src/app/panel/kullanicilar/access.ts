/**
 * Giriş bilgileri: yeni kullanıcıya ya da parolasını unutana iletilen mesaj (WhatsApp / kopyala) ve hoş geldin
 * e-postası. Saf modül: hem "Giriş bilgileri" penceresi (istemci) hem e-posta eylemi (sunucu) aynı metni üretir.
 */

import { button, C, divider, emailShell, esc, FONT, heading, para, TABLE } from "@/lib/email-kit";

export type AccessKind = "password" | "invite" | "reset";

/**
 * Pencerenin neden açıldığı: yeni kullanıcı ("new"), davet bekleyen kişiye yönetici parola belirledi ("set"),
 * parolası olan kişiye yönetici yeni parola verdi ("changed") ya da davet / sıfırlama bağlantısı yeniden
 * oluşturuldu ("renewed", önceki bağlantı artık çalışmaz). Metinler buna göre değişir: var olan kişiye
 * "hesabınız açıldı" denmez, yönetici yeni bir kullanıcı eklendiğini sanmaz.
 */
export const ACCESS_REASONS = ["new", "set", "changed", "renewed"] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];

export interface AccessInfo {
  kind: AccessKind;
  /** Yoksa "new" */
  reason?: AccessReason;
  userId: number;
  name: string;
  email: string;
  /** https://ladmin.laffogato.net/giris */
  loginUrl: string;
  /** Yalnızca "password": yöneticinin belirlediği parola (sunucu geri göndermez, pencere bellekte tutar) */
  password?: string;
  /** Yalnızca "password": e-posta düğmesinin geri yolladığı mühürlü kopya (15 dakika; sunucu parolayı bundan okur) */
  handle?: string;
  /** "invite" / "reset": tek kullanımlık bağlantı ve ham anahtarı (e-posta düğmesi anahtarı geri yollar) */
  link?: string;
  token?: string;
  /** Bağlantının son geçerlilik anı (ISO) */
  expiresAt?: string;
  /** Yeni hesap e-posta almıyor (personel ya da pasif) ve adresi bir bildirim listesinde (E-53): yöneticiye uyarı */
  notice?: string;
}

/** Tek kullanımlık bağlantının adresi: https://ladmin.laffogato.net/davet?t=… */
export function accessLink(baseUrl: string, raw: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/davet?t=${encodeURIComponent(raw)}`;
}

/** Bağlantı için "Giriş bilgileri" verisi (ham anahtar yalnızca oluşturulduğu yanıtta bir kez döner) */
export function linkAccessInfo(
  baseUrl: string,
  user: { id: number; name: string; email: string },
  kind: "invite" | "reset",
  raw: string,
  expiresAt: Date,
): AccessInfo {
  const base = baseUrl.replace(/\/+$/, "");
  return { kind, userId: user.id, name: user.name, email: user.email, loginUrl: `${base}/giris`, link: accessLink(base, raw), token: raw, expiresAt: expiresAt.toISOString() };
}

const TZ = "Europe/Istanbul";

/** "23 Ekim 2026 Cuma 14:30" (kafenin saatiyle) */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: TZ });
  const time = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return `${day} ${time}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name.trim();

/** WhatsApp'a ya da panoya giden tek parça mesaj */
export function credentialsText(info: AccessInfo): string {
  const hi = `Merhaba ${firstName(info.name)},`;
  const until = info.expiresAt ? formatExpiry(info.expiresAt) : null;
  const renewed = info.reason === "renewed";
  if (info.kind === "password") {
    return [
      info.reason === "changed" ? `${hi} L'Affogato yönetim paneli parolanız değiştirildi. Yeni giriş bilgileriniz:` : `${hi} L'Affogato yönetim paneline hesabınız açıldı.`,
      "",
      `Panel: ${info.loginUrl}`,
      `E-posta: ${info.email}`,
      `Parola: ${info.password ?? ""}`,
      "",
      "Giriş yaptıktan sonra Hesabım'dan parolanızı değiştirebilir, iki adımlı doğrulamayı açabilirsiniz.",
    ].join("\n");
  }
  if (info.kind === "invite") {
    return [
      renewed
        ? `${hi} L'Affogato yönetim paneli için yeni davet bağlantınız aşağıda. Daha önce gönderilen bağlantı artık çalışmaz.`
        : `${hi} L'Affogato yönetim paneline davet edildiniz.`,
      "",
      "Parolanızı belirlemek için bu bağlantıyı açın:",
      info.link ?? "",
      until ? `(Tek kullanımlık. Son geçerlilik: ${until})` : "(Tek kullanımlık.)",
      "",
      "Sonra panele bu bilgilerle girersiniz:",
      `Panel: ${info.loginUrl}`,
      `E-posta: ${info.email}`,
    ].join("\n");
  }
  return [
    renewed
      ? `${hi} L'Affogato yönetim paneli için yeni parola sıfırlama bağlantınız (daha önce gönderilen bağlantı artık çalışmaz):`
      : `${hi} L'Affogato yönetim paneli için parola sıfırlama bağlantınız:`,
    "",
    info.link ?? "",
    until ? `(Tek kullanımlık. Son geçerlilik: ${until})` : "(Tek kullanımlık.)",
    "",
    "Yeni parolanızı belirledikten sonra giriş yapın:",
    `Panel: ${info.loginUrl}`,
    `E-posta: ${info.email}`,
  ].join("\n");
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- E-posta

const SUBJECT: Record<AccessKind, string> = {
  password: "L'Affogato paneline hoş geldiniz",
  invite: "L'Affogato paneline davetlisiniz",
  reset: "L'Affogato paneli: parola sıfırlama",
};

const CHANGED_SUBJECT = "L'Affogato paneli: yeni parolanız";

export function accessSubject(info: Pick<AccessInfo, "kind" | "reason">): string {
  return info.kind === "password" && info.reason === "changed" ? CHANGED_SUBJECT : SUBJECT[info.kind];
}

/** "Giriş bilgileri" penceresinin başlığı ve açıklaması */
export function accessSheetText(info: Pick<AccessInfo, "kind" | "reason" | "name">): { title: string; description: string } {
  const name = info.name;
  if (info.kind === "password") {
    if (info.reason === "changed") return { title: "Yeni giriş bilgileri", description: `${name} için yeni parola kaydedildi. Bu bilgileri kendisine iletin.` };
    if (info.reason === "set")
      return { title: "Giriş bilgileri", description: `${name} için parola belirlendi; davet bağlantısı artık çalışmaz. Bu bilgileri kendisine iletin.` };
    return { title: "Giriş bilgileri", description: `${name} eklendi. Bu bilgileri kendisine iletin.` };
  }
  if (info.kind === "invite") {
    return info.reason === "renewed"
      ? { title: "Yeni davet bağlantısı", description: `${name} için yeni bağlantı oluşturuldu; önceki bağlantı artık çalışmaz. Bunu iletin, kişi parolasını kendisi belirler.` }
      : { title: "Davet bağlantısı hazır", description: `${name} eklendi. Bağlantıyı iletin; kişi parolasını kendisi belirler.` };
  }
  return info.reason === "renewed"
    ? {
        title: "Yeni sıfırlama bağlantısı",
        description: `${name} için yeni bağlantı oluşturuldu; önceki bağlantı artık çalışmaz. Mevcut parolası yenisini belirleyene kadar çalışır.`,
      }
    : {
        title: "Parola sıfırlama bağlantısı",
        description: `${name} bu bağlantıyla yeni parolasını belirler. Mevcut parolası o zamana kadar çalışmaya devam eder.`,
      };
}

/**
 * Yönetici var olan kişiye bağlantı oluşturdu: davetliye giden her bağlantı öncekinin yerine geçer ("renewed");
 * sıfırlama bağlantısı yalnızca daha önce gönderilmiş geçerli bir bağlantı varsa "renewed".
 */
export function linkReason(kind: "invite" | "reset", hadLiveLink: boolean): AccessReason {
  return kind === "invite" || hadLiveLink ? "renewed" : "new";
}

/**
 * Geçerli bağlantısı olan kişiye yenisini oluşturmadan önceki soru: eskisi hemen çalışmaz olur. Yönetici bunu
 * çoğu zaman "yeniden gönder" sanır; hatırlatmak için eski mesajı iletmesi yeter.
 */
export function relinkText(u: {
  name: string;
  invite: "none" | "pending" | "expired";
  liveLink: { kind: "invite" | "reset"; until: string } | null;
}): { title: string; description: string } {
  const until = u.liveLink ? ` (son geçerlilik ${u.liveLink.until})` : "";
  return u.invite === "none"
    ? {
        title: `${u.name} için yeni sıfırlama bağlantısı oluşturulsun mu?`,
        description: `Daha önce oluşturulan sıfırlama bağlantısı${until} hemen çalışmaz olur; kişiye yenisini iletmeniz gerekir. Kişinin mevcut parolası değişmez.`,
      }
    : {
        title: `${u.name} için yeni davet bağlantısı oluşturulsun mu?`,
        description: `Gönderdiğiniz davet bağlantısı${until} hemen çalışmaz olur; kişiye yenisini iletmeniz gerekir. Yalnızca hatırlatmak istiyorsanız daha önce gönderdiğiniz mesajı yeniden iletin.`,
      };
}

/** Parola gibi elle yazılacak değerin yazı tipi: her karakter ayrı genişlikte, karışmaz */
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

/**
 * Giriş bilgilerinin kutusu (kitte karşılığı yok: email-kit'in satırı değeri sağa yaslar, uzun adres ve parola
 * telefonda sıkışırdı). Her alan alt alta: üstte küçük gri etiket, altta büyük değer; uzun adres sarılır.
 * `valueHtml` hazır (kaçışlı) HTML'dir.
 */
function fieldsBox(fields: readonly { label: string; valueHtml: string; mono?: boolean }[], top: number): string {
  const cells = fields.map((f, i) => {
    const border = i ? `border-top:1px solid ${C.line};` : "";
    const value = f.mono
      ? `font-family:${MONO};font-size:20px;line-height:28px;font-weight:700;letter-spacing:0.06em`
      : `font-family:${FONT};font-size:16px;line-height:23px;font-weight:600`;
    return `<tr><td style="${border}padding:14px 0">
  <div style="font-family:${FONT};font-size:13px;line-height:18px;color:${C.mute}">${esc(f.label)}</div>
  <div style="${value};color:${C.ink};margin-top:3px;word-break:break-word;overflow-wrap:anywhere">${f.valueHtml}</div>
</td></tr>`;
  });
  return `<table ${TABLE} style="margin-top:${top}px"><tr><td style="background:${C.note};border-radius:16px;padding:4px 20px">
<table ${TABLE}>${cells.join("")}</table>
</td></tr></table>`;
}

/** Küçük not (hazır HTML; `<strong>` taşıyabilir): düğmenin altında ortalı ya da kartın sonunda sola yaslı */
function noteHtml(html: string, o: { top: number; center?: boolean }): string {
  return `<p style="margin:${o.top}px 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:${C.mute};word-break:break-word${o.center ? ";text-align:center" : ""}">${html}</p>`;
}

/** Düğme çalışmazsa kopyalanacak adres: gri kutuda, her yerinden sarılır (anahtar uzun, telefonda taşmasın) */
function linkBox(link: string, top: number): string {
  return `<table ${TABLE} style="margin-top:${top}px"><tr><td style="background:${C.note};border-radius:12px;padding:12px 14px;font-family:${MONO};font-size:13px;line-height:20px;color:${C.soft};word-break:break-all">${esc(link)}</td></tr></table>`;
}

/**
 * Davet, parola sıfırlama ve hoş geldin e-postası (ortak tasarım: src/lib/email-kit.ts). Karttaki sıra: selam ve ne
 * olduğu, ana eylem düğmesi, giriş bilgileri; düğme çalışmazsa kopyalanacak adres en altta. Bütün değişken metinler
 * kaçışlıdır; parola ön izleme satırına girmez (telefonun kilit ekranında görünür).
 */
export function accessEmail(info: AccessInfo): { subject: string; html: string; text: string } {
  const until = info.expiresAt ? esc(formatExpiry(info.expiresAt)) : null;
  const panelLink = `<a href="${esc(info.loginUrl)}" style="color:${C.ink};text-decoration:underline">${esc(info.loginUrl)}</a>`;

  let lead: string;
  let body: string;
  if (info.kind === "password") {
    lead = info.reason === "changed" ? "L'Affogato yönetim paneli parolanız değiştirildi. Yeni giriş bilgileriniz:" : "L'Affogato yönetim paneline hesabınız açıldı. Giriş bilgileriniz:";
    body = `${fieldsBox(
      [
        { label: "Panel", valueHtml: panelLink },
        { label: "E-posta", valueHtml: esc(info.email) },
        { label: "Parola", valueHtml: esc(info.password ?? ""), mono: true },
      ],
      24,
    )}
${button(info.loginUrl, "Panele giriş yap", { top: 24 })}
${para("Giriş yaptıktan sonra Hesabım'dan parolanızı değiştirebilir, iki adımlı doğrulamayı açabilirsiniz.", { top: 20, muted: true, size: 14 })}`;
  } else {
    const link = info.link ?? "";
    const again = info.reason === "renewed" ? " Daha önce gönderilen bağlantı artık çalışmaz." : "";
    lead =
      info.kind === "invite"
        ? info.reason === "renewed"
          ? `L'Affogato yönetim paneli için yeni davet bağlantınız hazır.${again} Aşağıdaki düğmeyle parolanızı kendiniz belirleyin.`
          : "L'Affogato yönetim paneline davet edildiniz. Aşağıdaki düğmeyle parolanızı kendiniz belirleyin."
        : `Panel parolanızı sıfırlamak için bir bağlantı istendi.${again} Aşağıdaki düğmeyle yeni parolanızı belirleyin.`;
    body = `${button(link, info.kind === "invite" ? "Parolamı belirle" : "Yeni parola belirle", { top: 24 })}
${noteHtml(`Bağlantı tek kullanımlıktır${until ? `; son geçerlilik: <strong style="color:${C.soft};font-weight:600;white-space:nowrap">${until}</strong>` : ""}.`, { top: 12, center: true })}
${fieldsBox(
  [
    { label: "Panel", valueHtml: panelLink },
    { label: "E-posta", valueHtml: esc(info.email) },
  ],
  28,
)}${info.kind === "reset" ? `\n${para("Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.", { top: 20, muted: true, size: 14 })}` : ""}
${divider(28)}
${noteHtml("Düğme çalışmazsa bu adresi tarayıcıya yapıştırın:", { top: 20 })}
${linkBox(link, 10)}`;
  }

  const subject = accessSubject(info);
  const html = emailShell({
    subject,
    preheader: lead,
    brandSubHtml: "Yönetim paneli",
    cardHtml: `${heading(`Merhaba ${firstName(info.name)}`, { sub: lead })}
${body}`,
    footer: "Bu e-posta L'Affogato yönetim panelinden gönderildi. Bilgileri kimseyle paylaşmayın.",
  });

  return { subject, html, text: credentialsText(info) };
}

// ---------------------------------------------------------------- Güçlü parola

/*
 * Telefondan okunup elle yazılırken ya da WhatsApp'ın düz yazı tipinde karışan karakterlerin İKİSİ de yok (kişi
 * alfabeyi bilmez; "5" görünce "S" de yazabilir):
 * - 0/O/o, 1/l/I/i, 5/S/s, 2/Z/z, 8/B, 6/G/b, 9/g/q, u/v/U/V
 * - büyüğü ve küçüğü aynı görünen harfler (c/C, k/K, p/P, w/W, x/X, s/S, z/Z, u/U, v/V)
 * - küçük r ("rn" düz yazıda "m" gibi okunur)
 * Kalan 25 karakter (10 küçük, 12 büyük harf, 3 rakam): 12 karakterlik parola ~55 bit. Girişte deneme sınırı,
 * kilit ve scrypt var; çevrimiçi tahmin için fazlasıyla yeterli.
 */
const LOWER = "adefhjmnty";
const UPPER = "ADEFHJLMNRTY";
const DIGITS = "347";
const ALL = LOWER + UPPER + DIGITS;

/** Okurken karışan karakter grupları: hiçbir grubun hiçbir karakteri alfabede yok (testler için) */
export const CONFUSABLE_GROUPS = ["0Oo", "1lIi", "5Ss", "2Zz", "8B", "6Gb", "9gq", "uvUV", "cC", "kK", "pP", "wW", "xX", "r"] as const;

function randomIndex(n: number): number {
  // Reddetmeli örnekleme: her karakter eşit olasılıklı (modulo sapması yok)
  const limit = Math.floor(256 / n) * n;
  const buf = new Uint8Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Okunur güçlü parola: 4'lü üç grup, tireyle ("hT7a-Ln3e-R4dy"). En az bir küçük, bir büyük harf ve bir rakam
 * içerir; telefondan okurken ya da yazarken karışan harf ve rakam yoktur.
 */
export function generatePassword(groups = 3, size = 4): string {
  for (;;) {
    const chars = Array.from({ length: groups * size }, () => ALL[randomIndex(ALL.length)]);
    const s = chars.join("");
    if (/[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s)) {
      return Array.from({ length: groups }, (_, i) => s.slice(i * size, (i + 1) * size)).join("-");
    }
  }
}

export const PASSWORD_ALPHABET = ALL;
