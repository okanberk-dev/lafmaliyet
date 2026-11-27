// Muhasebeci paketinin ayarları (docs/MUHASEBE-PAKETI.md): alıcılar, kendiliğinden gönderim, son gönderim. Saf ve hafif
// (exceljs yok): paketin kendisi src/lib/muhasebe/paket.ts'te (buradakileri yeniden dışa verir); bildirim alıcılarının
// kapıları (src/server/notify/recipients.ts: Hesabım, Kullanıcılar, zil) paketin alıcılarını buradan okur.

/** integration_state anahtarı */
export const PACKAGE_SETTINGS_KEY = "muhasebe.paket";
/** Ayarlar'daki bölüm */
export const PACKAGE_HREF = "/panel/ayarlar#muhasebe";
/** Alıcı sınırı (yanlışlıkla bir liste yapıştırılmasın) */
export const PACKAGE_MAX_RECIPIENTS = 5;

export interface PackageSent {
  month: string;
  /** ISO an */
  at: string;
  to: string[];
  /** "Günlük iş" ya da gönderen yöneticinin adı */
  by: string;
}

export interface PackageSettings {
  /** Muhasebeci alıcıları; boşsa e-posta gitmez */
  recipients: string[];
  /** Ay kapanınca (ayın 1'i) kendiliğinden gönderilsin */
  auto: boolean;
  /** Son gönderim (kendiliğinden ya da elle) */
  last: PackageSent | null;
  /** Kendiliğinden gönderilen son ay: aynı ay ikinci kez kendiliğinden gitmez */
  autoMonth: string | null;
}

export const DEFAULT_PACKAGE_SETTINGS: PackageSettings = { recipients: [], auto: true, last: null, autoMonth: null };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kayıtlı ayar; bozuk alan varsayılana döner, geçersiz adres atlanır */
export function parsePackageSettings(v: unknown): PackageSettings {
  const x = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const recipients = Array.isArray(x.recipients) ? [...new Set(x.recipients.filter((e): e is string => typeof e === "string" && EMAIL.test(e.trim())).map((e) => e.trim().toLowerCase()))] : [];
  const l = x.last as Partial<PackageSent> | null | undefined;
  const last =
    l && typeof l === "object" && typeof l.month === "string" && MONTH.test(l.month) && typeof l.at === "string" && Array.isArray(l.to)
      ? { month: l.month, at: l.at, to: l.to.filter((e): e is string => typeof e === "string"), by: typeof l.by === "string" ? l.by : "" }
      : null;
  return {
    recipients: recipients.slice(0, PACKAGE_MAX_RECIPIENTS),
    auto: typeof x.auto === "boolean" ? x.auto : DEFAULT_PACKAGE_SETTINGS.auto,
    last,
    autoMonth: typeof x.autoMonth === "string" && MONTH.test(x.autoMonth) ? x.autoMonth : null,
  };
}

/**
 * Formdaki alıcı metni (virgül, noktalı virgül, boşluk ya da satır sonuyla ayrılmış) → adresler ya da ilk hata.
 * Boş metin geçerlidir (alıcı yok: e-posta gitmez)
 */
export function readRecipients(text: string): { ok: true; emails: string[] } | { ok: false; error: string } {
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const bad = parts.find((p) => !EMAIL.test(p) || p.length > 200);
  if (bad) return { ok: false, error: `"${bad}" geçerli bir e-posta adresi değil` };
  const emails = [...new Set(parts)];
  if (emails.length > PACKAGE_MAX_RECIPIENTS) return { ok: false, error: `En çok ${PACKAGE_MAX_RECIPIENTS} adres yazın` };
  return { ok: true, emails };
}
