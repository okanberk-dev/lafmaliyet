/**
 * Giriş bilgileri: yeni kullanıcıya ya da parolasını unutana iletilen mesaj (WhatsApp / kopyala) ve hoş geldin
 * e-postası. Saf modül: hem "Giriş bilgileri" penceresi (istemci) hem e-posta eylemi (sunucu) aynı metni üretir.
 */

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

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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

/**
 * AkmanOS açık temasında, satır içi stilli e-posta (hatırlatma e-postasıyla aynı dil): beyaz zemin, zinc-100 kart,
 * siyah düğme. Bütün değişken metinler kaçışlıdır.
 */
export function accessEmail(info: AccessInfo): { subject: string; html: string; text: string } {
  const name = esc(firstName(info.name));
  const until = info.expiresAt ? esc(formatExpiry(info.expiresAt)) : null;
  const button = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:12px">${label}</a>`;
  const row = (label: string, value: string, mono = false) =>
    `<tr><td style="padding:8px 0;color:#71717a;font-size:13px;width:92px;vertical-align:top">${label}</td><td style="padding:8px 0;color:#171717;font-size:15px;font-weight:600;word-break:break-all;${mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.02em" : ""}">${value}</td></tr>`;

  let lead: string;
  let body: string;
  if (info.kind === "password") {
    lead = info.reason === "changed" ? "L'Affogato yönetim paneli parolanız değiştirildi. Yeni giriş bilgileriniz:" : "L'Affogato yönetim paneline hesabınız açıldı. Giriş bilgileriniz:";
    body = `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:16px;padding:6px 16px;margin:0 0 20px">
        ${row("Panel", `<a href="${esc(info.loginUrl)}" style="color:#171717">${esc(info.loginUrl)}</a>`)}
        ${row("E-posta", esc(info.email))}
        ${row("Parola", esc(info.password ?? ""), true)}
      </table>
      ${button(info.loginUrl, "Panele giriş yap")}
      <p style="margin:20px 0 0;color:#71717a;font-size:13px;line-height:20px">Giriş yaptıktan sonra Hesabım'dan parolanızı değiştirebilir, iki adımlı doğrulamayı açabilirsiniz.</p>`;
  } else {
    const link = info.link ?? "";
    const again = info.reason === "renewed" ? " Daha önce gönderilen bağlantı artık çalışmaz." : "";
    lead =
      info.kind === "invite"
        ? info.reason === "renewed"
          ? `L'Affogato yönetim paneli için yeni davet bağlantınız hazır.${again} Aşağıdaki düğmeyle parolanızı kendiniz belirleyin.`
          : "L'Affogato yönetim paneline davet edildiniz. Aşağıdaki düğmeyle parolanızı kendiniz belirleyin."
        : `Panel parolanızı sıfırlamak için bir bağlantı istendi.${again} Aşağıdaki düğmeyle yeni parolanızı belirleyin.`;
    body = `
      ${button(link, info.kind === "invite" ? "Parolamı belirle" : "Yeni parola belirle")}
      <p style="margin:16px 0 20px;color:#71717a;font-size:13px;line-height:20px">Bağlantı tek kullanımlıktır${until ? `; son geçerlilik: <strong style="color:#3f3f46">${until}</strong>` : ""}. Düğme çalışmazsa bu adresi tarayıcıya yapıştırın:<br><span style="word-break:break-all;color:#3f3f46">${esc(link)}</span></p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:16px;padding:6px 16px">
        ${row("Panel", `<a href="${esc(info.loginUrl)}" style="color:#171717">${esc(info.loginUrl)}</a>`)}
        ${row("E-posta", esc(info.email))}
      </table>
      ${info.kind === "reset" ? `<p style="margin:16px 0 0;color:#71717a;font-size:13px;line-height:20px">Bu isteği siz yapmadıysanız e-postayı yok sayın; parolanız değişmez.</p>` : ""}`;
  }

  const subject = accessSubject(info);
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171717">
  <div style="max-width:520px;margin:0 auto;padding:28px 16px">
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#71717a">L'Affogato · Yönetim paneli</p>
    <div style="background:#f4f4f5;border-radius:24px;padding:24px 20px">
      <h1 style="margin:0 0 8px;font-size:22px;line-height:28px;letter-spacing:-0.01em">Merhaba ${name}</h1>
      <p style="margin:0 0 20px;color:#3f3f46;font-size:15px;line-height:22px">${lead}</p>
      ${body}
    </div>
    <p style="margin:16px 4px 0;color:#a1a1aa;font-size:12px;line-height:18px">Bu e-posta L'Affogato yönetim panelinden gönderildi. Bilgileri kimseyle paylaşmayın.</p>
  </div>
</body></html>`;

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
