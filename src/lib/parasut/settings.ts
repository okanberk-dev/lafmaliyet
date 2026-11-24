import { z } from "zod";

import { dateTR } from "@/lib/format";
import { isCalendarDate, todayTR } from "@/lib/reminders";

/**
 * Paraşüt bağlantı ayarlarının saf kuralları (docs/PARASUT.md § 1): hangi değerin kullanılacağı, paneldeki formun
 * denetimi, kaydın sonuçları ve ekrana giden (gizli değersiz) görünüm. Veritabanına ve ortama dokunmaz; okuma ve yazma
 * src/server/parasut/config.ts'te, kayıt eylemi src/server/actions/parasut.ts'te.
 *
 * Dört ayar panelden (Paraşüt entegrasyonu › Bağlantı) girilebilir: client_id, client_secret, firma numarası ve ilk
 * eşitlemenin başlangıcı. Her alanda **paneldeki değer önce gelir**; panelde yoksa ortam değişkeni (Vercel) kullanılır.
 * Böylece yalnız ortam değişkenleriyle kurulmuş panel hiçbir şey yapmadan çalışmaya devam eder, yeni kurulum ise kod
 * ya da yeniden deploy olmadan panelden yapılır. Seyrek değişen adres ve izin ayarları (PARASUT_ISSUER,
 * PARASUT_AUTHORIZE_URL, PARASUT_TOKEN_URL, PARASUT_SCOPE, PARASUT_BASE_URL, PARASUT_REDIRECT_URI) yalnız ortamda kalır.
 */

export const PARASUT_SETTINGS = {
  clientId: { env: "PARASUT_CLIENT_ID", label: "Client ID" },
  clientSecret: { env: "PARASUT_CLIENT_SECRET", label: "Client Secret" },
  companyId: { env: "PARASUT_COMPANY_ID", label: "Firma numarası" },
  syncFrom: { env: "PARASUT_SYNC_FROM", label: "İlk eşitleme başlangıcı" },
} as const;

export type ParasutSettingKey = keyof typeof PARASUT_SETTINGS;
export const PARASUT_SETTING_KEYS = Object.keys(PARASUT_SETTINGS) as ParasutSettingKey[];
/** Bağlantının çalışması için gerekenler (ilk eşitleme başlangıcı boşsa yıl başı) */
export const REQUIRED_SETTINGS = ["clientId", "clientSecret", "companyId"] as const satisfies readonly ParasutSettingKey[];

/** Değerin nereden geldiği: panelde kayıtlı, ortam değişkeni (Vercel) ya da hiçbiri */
export type SettingSource = "panel" | "env" | null;

/** Panelde kayıtlı değerler (client_secret açılmış hâliyle; yalnız sunucuda) */
export type PanelValues = Partial<Record<ParasutSettingKey, string>>;
export interface ResolvedSetting {
  value: string | null;
  source: SettingSource;
}
export type ResolvedSettings = Record<ParasutSettingKey, ResolvedSetting>;

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isCalendarDate(v);

/** Alanın kullanılabilir hâli: kırpılır; takvimde olmayan başlangıç tarihi yok sayılır */
function usable(key: ParasutSettingKey, raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (key === "syncFrom" && !isDay(v)) return null;
  return v;
}

/** Her alan için kullanılacak değer: önce panel, yoksa ortam değişkeni */
export function resolveParasutSettings(panel: PanelValues, env: Record<string, string | undefined>): ResolvedSettings {
  const out = {} as ResolvedSettings;
  for (const key of PARASUT_SETTING_KEYS) {
    const p = usable(key, panel[key]);
    const e = usable(key, env[PARASUT_SETTINGS[key].env]);
    out[key] = p !== null ? { value: p, source: "panel" } : e !== null ? { value: e, source: "env" } : { value: null, source: null };
  }
  return out;
}

/** Eksik zorunlu ayarlar (boşsa bağlantı kurulabilir) */
export const missingSettings = (r: ResolvedSettings): ParasutSettingKey[] => REQUIRED_SETTINGS.filter((k) => !r[k].value);

/** Boşluksuz tek parça metin (client_id, client_secret); boş bırakılabilir */
const token = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} çok uzun`)
    .refine((v) => !/\s/.test(v), `${label} boşluk içeremez; DevHub'daki değeri olduğu gibi yapıştırın`);

/** Bağlantı kartındaki form. Boş alan: client_secret'ta "değiştirme", ötekilerde "panelden sil" */
export const parasutSettingsInput = z.object({
  clientId: token("Client ID", 200),
  clientSecret: token("Client Secret", 500),
  companyId: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,12}$/.test(v), "Firma numarası yalnız rakamdan oluşur (Paraşüt adresindeki sayı)"),
  syncFrom: z
    .string()
    .trim()
    .refine((v) => v === "" || isDay(v), "İlk eşitleme başlangıcı geçerli bir tarih olmalı")
    .refine((v) => v === "" || v <= todayTR(), "İlk eşitleme başlangıcı ileri bir tarih olamaz"),
});
export type ParasutSettingsInput = z.output<typeof parasutSettingsInput>;

/** Firma numarası panelden değiştirilemez: Paraşüt'ten fatura gelmiş */
export const COMPANY_LOCKED_TEXT =
  "Paraşüt'ten fatura geldiği için firma numarası panelden değiştirilemez: başka bir firmaya geçilirse eşitleme eski firmanın faturalarını Paraşüt'te silinmiş sayıp panelden kaldırır. Firma gerçekten değişecekse yazılımcıya başvurun.";

export type SettingsPlan =
  | {
      ok: true;
      /** Panelde saklanacak değerler (client_secret açık; sunucu şifreler) */
      next: PanelValues;
      before: ResolvedSettings;
      after: ResolvedSettings;
      /** Kullanılan değeri değişen alanlar */
      changed: ParasutSettingKey[];
      /** Yalnız kaynağı değişen alanlar (aynı değer panele yazıldı ya da panelden silindi) */
      moved: ParasutSettingKey[];
      /** İstemci (client_id ya da client_secret) değişti: kayıtlı oturum eski istemcinin, silinir */
      forgetSession: boolean;
      /** Firma değişti: eşitleme imleci sıfırlanır ("Oturumu sıfırla" gibi) */
      resetCursor: boolean;
    }
  | { ok: false; error: string };

/**
 * Formdan gelenle neyin değişeceği. Ekrandaki alanlar kullanılan değerle dolu gelir: aynı kalan alana dokunulmaz
 * (kaynağı da değişmez), boşaltılan alan panelden silinir (varsa ortam değişkenine döner), yeni değer panele yazılır.
 * client_secret ekrana hiç gelmez: boşsa kayıtlı olan kalır.
 *
 * Reddedilen: client_id değişip yeni client_secret girilmemesi (kalan secret eski istemcinin) ve Paraşüt'ten fatura
 * gelmişken firma numarasının değişmesi (`hasParasutInvoices`; ilk kez yazılması serbest: yedekten dönen kurulumda
 * ayar panelde değil, yeniden girilir).
 */
export function planParasutSettings(
  panel: PanelValues,
  env: Record<string, string | undefined>,
  input: ParasutSettingsInput,
  opts: { hasParasutInvoices: boolean },
): SettingsPlan {
  const before = resolveParasutSettings(panel, env);
  const next: PanelValues = { ...panel };
  for (const key of ["clientId", "companyId", "syncFrom"] as const) {
    const v = input[key];
    if (v === (before[key].value ?? "")) continue;
    if (v) next[key] = v;
    else delete next[key];
  }
  if (input.clientSecret) next.clientSecret = input.clientSecret;
  const after = resolveParasutSettings(next, env);
  const changed = PARASUT_SETTING_KEYS.filter((k) => before[k].value !== after[k].value);
  const moved = PARASUT_SETTING_KEYS.filter((k) => !changed.includes(k) && before[k].source !== after[k].source);
  if (changed.includes("clientId") && !input.clientSecret && after.clientSecret.value) {
    return { ok: false, error: "Client ID değişince o istemcinin Client Secret'ını da girin; kayıtlı olan önceki istemcinin." };
  }
  if (changed.includes("companyId") && before.companyId.value && opts.hasParasutInvoices) return { ok: false, error: COMPANY_LOCKED_TEXT };
  return {
    ok: true,
    next,
    before,
    after,
    changed,
    moved,
    forgetSession: changed.includes("clientId") || changed.includes("clientSecret"),
    resetCursor: changed.includes("companyId"),
  };
}

/** İşlem geçmişine yazılan özet: hangi ayar değişti ve sonucu. client_secret'ın değeri hiçbir zaman yazılmaz */
export function settingsLogText(plan: Extract<SettingsPlan, { ok: true }>): string {
  const { before, after } = plan;
  const parts: string[] = [];
  for (const k of plan.changed) {
    if (k === "clientId") parts.push(after.clientId.value ? "Client ID değişti" : "Client ID silindi");
    else if (k === "clientSecret") parts.push(after.clientSecret.value ? "Client Secret değişti" : "Client Secret silindi");
    else if (k === "companyId") parts.push(`Firma numarası ${before.companyId.value ?? "yok"} → ${after.companyId.value ?? "yok"}`);
    else parts.push(`İlk eşitleme başlangıcı ${after.syncFrom.value ? dateTR(after.syncFrom.value) : "yıl başı"}`);
  }
  for (const k of plan.moved) parts.push(`${PARASUT_SETTINGS[k].label} ${after[k].source === "panel" ? "panele kaydedildi" : "panelden silindi"}`);
  if (plan.forgetSession) parts.push("kayıtlı Paraşüt oturumu silindi, hesap yeniden bağlanmalı");
  if (plan.resetCursor) parts.push("eşitleme imleci sıfırlandı");
  return parts.join(" · ");
}

/** Ekrana giden ayar görünümü: client_secret'ın yalnız var olup olmadığı ve kaynağı, değeri asla */
export interface ParasutSettingsView {
  clientId: ResolvedSetting;
  clientSecret: { source: SettingSource };
  companyId: ResolvedSetting;
  syncFrom: ResolvedSetting;
  /** Panelde kayıtlı client_secret açılamadı (AUTH_SECRET değişmiş): yeniden girilmeli */
  secretUnreadable: boolean;
  /** Paraşüt'ten fatura geldi: firma numarası panelden değiştirilemez (ilk kez yazılması hariç) */
  companyLocked: boolean;
}

export function settingsView(r: ResolvedSettings, x: { secretUnreadable: boolean; hasParasutInvoices: boolean }): ParasutSettingsView {
  return {
    clientId: { ...r.clientId },
    clientSecret: { source: r.clientSecret.source },
    companyId: { ...r.companyId },
    syncFrom: { ...r.syncFrom },
    secretUnreadable: x.secretUnreadable,
    companyLocked: x.hasParasutInvoices && Boolean(r.companyId.value),
  };
}

/** Alanın altındaki kaynak notu */
export function sourceText(source: SettingSource): string {
  return source === "panel" ? "panelde kayıtlı" : source === "env" ? "Vercel'den" : "eksik";
}
