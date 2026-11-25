/*
 * Şube başına ayar grupları (docs/SUBE.md › Şube başına ayarlar). Saf: sunucu (src/server/branch-settings.ts), ekranlar
 * ve testler aynı kütüğü okur.
 *
 * Her grup şube başına bir satırdır (branch_settings). "Diğer şubeyle aynı" sunulan grupta (`linkable`) şube kendi
 * değerini tutmaz, bağlandığı şubenin değerini kullanır; değer tek yerden düzenlenir. Seçenek kapatılınca o anki değer
 * şubeye kopyalanır (gizli alanlar kopyalanmaz, yeniden girilir). Bağ tek adımlıdır: hedef şube başka şubeye bağlı
 * olamaz.
 *
 * Geçiş: veri göçü yok. Satırı olmayan şube eski genel kayıttan okur, ama yalnız kaydın sahibi şube (`legacy`):
 * kasa raporu alıcıları Tuzla'nın (varsayılan şube), çalışanların kısa e-postası LafPOS'un şubesinin (Marina). Öbür
 * şubeler "aynı" sunulan grupta örtük olarak varsayılan şubeye bağlı başlar, bugünkü davranış hiçbir şey yapmadan
 * sürer. Kayıt yoksa ortam değişkeni (CASH_REPORT_RECIPIENTS) ya da grubun varsayılanı.
 */

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { CASH_EVENING_HOUR, defaultCashRecipients } from "@/lib/cash-report";
import type { ChannelKey } from "@/lib/commission/channels";
import { effectiveSettings, parseCommissionSettings, type ChannelSettings } from "@/lib/commission/report";
import { DEFAULT_SETTINGS, readLafposSwitchDay } from "@/lib/constants";
import { LAFPOS_BRANCH_ID } from "@/lib/lafpos/switch";
import { clockSuffixTR } from "@/lib/reminders";

type Env = Record<string, string | undefined>;

/** Eski genel kaydın sahibi: varsayılan şube (Tuzla) ya da LafPOS'un şubesi (Marina) */
export type LegacyOwner = "default" | "lafpos";

export interface BranchSettingGroup<T extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  /** Kart başlığı ("Kasa raporu alıcıları") */
  label: string;
  /** Kartın altındaki tek cümle */
  description: string;
  /** "Diğer şubeyle aynı" sunulur mu (liste doğası gereği şubenin olan grupta hayır) */
  linkable: boolean;
  /** Eski genel kaydın sahibi şube: satırı yokken yalnız o şube eski kayıttan okur */
  legacy: LegacyOwner;
  /** Eski genel kaydın anahtarı (integration_state); yoksa null */
  legacyKey: string | null;
  /**
   * Eski genel kaydın settings tablosundaki alanları (alan → settings anahtarı; ör. geçiş günü `lafposGecisGunu`):
   * satırı yokken sahibi şube bunları da okur
   */
  legacySettings?: Readonly<Record<string, string>>;
  /** Şifreli tutulan alanlar: istemciye yalnız "kayıtlı mı" gider, "aynı" kapatılınca kopyalanmaz, yedeğe girmez */
  secretFields: readonly string[];
  /** Kayıttan (satır ya da eski kayıt; eksik ya da bozuk alan varsayılana düşer) grubun değeri; `raw` boşsa varsayılan */
  read(raw: Record<string, unknown>, env: Env): T;
  /** Kısa özet ("2 alıcı · e-posta açık") */
  summary(v: T): string;
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** Kasa raporu e-postasının alıcıları, açık / kapalı ve WhatsApp numarası */
export interface CashReportSetting extends Record<string, unknown> {
  recipients: string[];
  emailEnabled: boolean;
  /** "WhatsApp ile gönder" bu numaranın sohbetini açar; boşsa sohbet seçici (grup da seçilir) */
  whatsapp: string | null;
}

/** LafPOS gün sonunun çalışanlara giden kısa e-postası */
export interface CashStaffSetting extends Record<string, unknown> {
  staffRecipients: string[];
  /** Çalışan e-postasında tutarlar (ciro, ödeme türleri) görünsün mü; kapalıyken yalnız "gün sonu alındı", fiş sayısı */
  staffAmounts: boolean;
}

export const CASH_REPORT_GROUP: BranchSettingGroup<CashReportSetting> = {
  id: "kasa.rapor",
  label: "Kasa raporu alıcıları",
  description: "Personel raporu gönderince bu adreslere e-posta gider; WhatsApp numarası da burada.",
  linkable: true,
  legacy: "default",
  legacyKey: "cash.settings",
  secretFields: [],
  read: (raw, env) => ({
    recipients: strings(raw.recipients) ?? defaultCashRecipients(env),
    emailEnabled: typeof raw.emailEnabled === "boolean" ? raw.emailEnabled : true,
    whatsapp: typeof raw.whatsapp === "string" && raw.whatsapp ? raw.whatsapp : null,
  }),
  summary: (v) => (!v.emailEnabled ? "e-posta kapalı" : v.recipients.length ? `${v.recipients.length} alıcı` : "alıcı yok"),
};

export const CASH_STAFF_GROUP: BranchSettingGroup<CashStaffSetting> = {
  id: "kasa.calisan",
  label: "Çalışanların gün sonu e-postası",
  description: "LafPOS gün sonu alınınca şubenin çalışanlarına kısa özet gider; rapor ayrıntısı gitmez.",
  // Çalışan listesi şubenin kendisinin: Tuzla'nın çalışanları Marina'nın gün sonunu almaz
  linkable: false,
  legacy: "lafpos",
  legacyKey: "cash.settings",
  secretFields: [],
  read: (raw) => ({
    staffRecipients: strings(raw.staffRecipients) ?? [],
    staffAmounts: raw.staffAmounts === true,
  }),
  summary: (v) => (v.staffRecipients.length ? `${v.staffRecipients.length} çalışan${v.staffAmounts ? " · tutarlarla" : ""}` : "kimse yok"),
};

/**
 * Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı). Satır yalnız bağı tutar: "aynı" açıkken şube
 * bağlandığı şubenin hesabını kullanır (tek bağlantı, tek eşitleme). Hesabın kendi ayarları (client_id, şifreli
 * client_secret, firma, başlangıç) ve oturumu Paraşüt ekranında, integration_state'te hesap adıyla durur
 * (src/server/parasut/config.ts). "Aynı" kapatılınca **kopyalanmaz**: aynı firma iki hesaptan iki kez eşitlenirse
 * faturalar çiftlenir; şube boş, yeni bir hesapla başlar ve "Paraşüt hesabını bağla" ister (bilinçli istisna)
 */
export const PARASUT_GROUP: BranchSettingGroup<Record<string, never>> = {
  id: "parasut",
  label: "Paraşüt hesabı",
  description: "Faturaların geldiği Paraşüt firması. Şubeler aynı firmadaysa tek bağlantı, tek eşitleme.",
  linkable: true,
  legacy: "default",
  legacyKey: "parasut.settings",
  secretFields: [],
  read: () => ({}),
  summary: () => "",
};

/** Komisyon ve yemek kartı kanallarının ayarı: kanal başına ödeme süresi (docs/KOMISYON.md) */
export interface CommissionSetting extends Record<string, unknown> {
  /** Kaydedilmiş süreler (eksik kanal varsayılan 30 gün; effectiveSettings) */
  channels: Partial<Record<ChannelKey, ChannelSettings>>;
}

/**
 * Komisyon ve yemek kartı kanalları (docs/KOMISYON.md › Şube). Sözleşme şube başına olabilir: Marina'nın Multinet'i
 * başka ödeme süresiyle çalışabilir. Sahibin varsayılanı "aynı": öbür şubeler örtük olarak Tuzla'ya bağlı başlar, eski
 * kayıt (integration_state › komisyon.ayar) Tuzla'nındır. Hakedişin takibinin başladığı gün (komisyon.since) ve
 * hakediş işaretleri işletme geneli kalır: faturalar ve banka işletmenindir
 */
export const COMMISSION_GROUP: BranchSettingGroup<CommissionSetting> = {
  id: "komisyon",
  label: "Komisyon ve yemek kartı kanalları",
  description: "Kanalların ödeme süresi: hakedişin, ayın son faturasından sonra kaç gün içinde gelmesi gerektiği.",
  linkable: true,
  legacy: "default",
  legacyKey: "komisyon.ayar",
  secretFields: [],
  read: (raw) => ({ channels: parseCommissionSettings(raw) }),
  summary: (v) => {
    const days = [...new Set(Object.values(effectiveSettings(v.channels)).map((c) => c.payDays))].sort((a, b) => a - b);
    return days.length === 1 ? `ödeme süresi ${days[0]} gün` : `ödeme süreleri ${days[0]}–${days[days.length - 1]} gün`;
  },
};

/** LafPOS'un kasası olan şubenin ayarı: geçiş günü ve (isteğe bağlı) panelde saklanan anahtar */
export interface LafposSetting extends Record<string, unknown> {
  /** LafPOS'a geçiş günü (YYYY-MM-DD); boşsa kasa ModPOS sayılır (docs/LAFPOS.md › Geçiş günü) */
  switchDay: string | null;
  /** LafPOS'un imza anahtarı (şifreli; yalnız sunucuda açılır). Yoksa ortamdaki LAFPOS_SYNC_SECRET */
  secret?: string;
}

/**
 * LafPOS bağlantısı ve geçiş günü (docs/LAFPOS.md › Şubeler). Değeri yalnız LafPOS'un şubesinin (kütükte kasa kaynağı
 * LafPOS olan şube, en çok bir) değeri okunur. "Diğer şubeyle aynı" sunulmaz: geçiş günü şubenin kendi kasasının
 * günüdür, LafPOS da en çok bir şubenin kasasıdır; kaynak başka şubeye geçerse o şube kendi gününü ve anahtarını alır.
 * Eski kayıt (settings › lafposGecisGunu) Marina'nın (geçildiği gün LafPOS'un şubesi); anahtar yoksa ortamınki
 */
export const LAFPOS_GROUP: BranchSettingGroup<LafposSetting> = {
  id: "pos.lafpos",
  label: "LafPOS bağlantısı ve geçiş günü",
  description: "Kasası LafPOS olan şubenin geçiş günü ve LafPOS'un imza anahtarı.",
  linkable: false,
  legacy: "lafpos",
  legacyKey: null,
  legacySettings: { switchDay: "lafposGecisGunu" },
  secretFields: ["secret"],
  read: (raw) => ({
    switchDay: readLafposSwitchDay(raw.switchDay),
    ...(typeof raw.secret === "string" && raw.secret.trim() ? { secret: raw.secret.trim() } : {}),
  }),
  summary: (v) => (v.switchDay ? `geçiş günü ${v.switchDay.split("-").reverse().join(".")}` : "geçiş günü yok"),
};

/** ModPOS kasa föyünün şubeye göre ayarı */
export interface ModposSetting extends Record<string, unknown> {
  /** Ay rakamına yedek (docs/MODPOS-API.md › Ay rakamına yedek): raporsuz günün cirosu föyden */
  monthFallback: boolean;
}

/**
 * ModPOS (docs/MODPOS-API.md › Şubeler). Anahtar zaten şube başına ortamda (MODPOS_API_KEY, MODPOS_API_KEY_<ŞUBE>);
 * burada ay rakamına yedek. Eski kayıt (settings › modposAyYedegi) Tuzla'nın, öbür şubeler örtük olarak "aynı" başlar
 * (bugünkü tek anahtar bütün föylere uygulanıyordu)
 */
export const MODPOS_GROUP: BranchSettingGroup<ModposSetting> = {
  id: "modpos",
  label: "ModPOS ay yedeği",
  description: "Kasa raporu olmayan günün cirosu kapanmış ModPOS föyünden aya girsin mi.",
  linkable: true,
  legacy: "default",
  legacyKey: null,
  legacySettings: { monthFallback: "modposAyYedegi" },
  secretFields: [],
  read: (raw) => ({ monthFallback: raw.monthFallback === true }),
  summary: (v) => (v.monthFallback ? "ay yedeği açık" : "ay yedeği kapalı"),
};

/** Kasa raporunun beklendiği saatin sınırları (Türkiye saati; 05:00'ten önce gün döner) */
export const EVENING_HOUR_MIN = 12;
export const EVENING_HOUR_MAX = 23;

/** Şubenin çalışma takvimi */
export interface CalendarSetting extends Record<string, unknown> {
  /** Ayda kaç gün açık: başabaş ve günlük giderler (motorun acikGun'u) */
  openDays: number;
  /** Kasa raporunun beklendiği saat: bundan sonra zil ve Bugün bugünün raporunu sorar */
  eveningHour: number;
}

const intIn = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * Çalışma takvimi (docs/SUBE.md › Şube başına ayarlar): ayda açık gün ve kasa raporunun beklendiği saat. Eski kayıt
 * (settings › acikGun) Tuzla'nın; öbür şubeler örtük olarak "aynı" başlar. Saat bugün sabitti (20:00)
 */
export const CALENDAR_GROUP: BranchSettingGroup<CalendarSetting> = {
  id: "isletme.takvim",
  label: "Çalışma takvimi",
  description: "Ayda kaç gün açık (başabaş ve günlük giderler) ve kasa raporunun hangi saatten sonra beklendiği.",
  linkable: true,
  legacy: "default",
  legacyKey: null,
  legacySettings: { openDays: "acikGun" },
  secretFields: [],
  read: (raw) => ({
    openDays: intIn(raw.openDays, 1, 31) ?? DEFAULT_SETTINGS.acikGun,
    eveningHour: intIn(raw.eveningHour, EVENING_HOUR_MIN, EVENING_HOUR_MAX) ?? CASH_EVENING_HOUR,
  }),
  summary: (v) => `ayda ${v.openDays} gün · rapor ${clockSuffixTR(`${String(v.eveningHour).padStart(2, "0")}:00`, "abl")} sonra`,
};

/** Banka POS'unun (yazarkasa) türü */
export const TILL_DEVICES = [
  { id: "pavo", label: "Pavo" },
  { id: "tokenx", label: "TokenX" },
  { id: "diger", label: "Başka bir cihaz" },
] as const;

export type TillDevice = (typeof TILL_DEVICES)[number]["id"];

/** Şubenin banka POS'u ve yazarkasası */
export interface TillDeviceSetting extends Record<string, unknown> {
  /** Cihazın türü; boşsa bilinmiyor (LafPOS'lu şubede LafPOS'un gönderdiği) */
  device: TillDevice | null;
  /** Yazarkasanın sicil (seri) numarası: e-postada ve Kasa'da hangi cihazın Z'si olduğu */
  registerNo: string | null;
  /** Banka POS'unun bankası */
  bank: string | null;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Banka POS ve yazarkasa (docs/SUBE.md › Şube başına ayarlar): cihaz şubenin kendisinin, "aynı" sunulmaz. Eski kayıt
 * yok: boşken her şey bugünkü gibi (LafPOS'lu şubede cihaz LafPOS'un gönderdiğinden, yoksa Pavo)
 */
export const TILL_DEVICE_GROUP: BranchSettingGroup<TillDeviceSetting> = {
  id: "kasa.cihaz",
  label: "Banka POS ve yazarkasa",
  description: "Şubenin banka POS'u (Pavo, TokenX…), yazarkasanın sicil numarası ve bankası.",
  linkable: false,
  legacy: "default",
  legacyKey: null,
  secretFields: [],
  read: (raw) => ({
    device: TILL_DEVICES.some((d) => d.id === raw.device) ? (raw.device as TillDevice) : null,
    registerNo: text(raw.registerNo, 40),
    bank: text(raw.bank, 60),
  }),
  summary: (v) => [v.device ? tillDeviceLabel(v.device) : "cihaz belirtilmedi", v.registerNo ? `sicil ${v.registerNo}` : null].filter(Boolean).join(" · "),
};

/** Cihazın adı ("Pavo") */
export function tillDeviceLabel(device: TillDevice): string {
  return TILL_DEVICES.find((d) => d.id === device)?.label ?? device;
}

/**
 * Gün sonu fişinin sahibi, ilgi ekiyle ("Pavo'nun", "TokenX'in", "banka POS'unun"): akşam hatırlatmasının metni. Cihaz
 * belirtilmediyse bugünkü metin (LafPOS'lu şubenin cihazı Pavo)
 */
export function tillDeviceGenitive(device: TillDevice | null): string {
  if (device === "tokenx") return "TokenX'in";
  if (device === "diger") return "banka POS'unun";
  return "Pavo'nun";
}

/** Şube başına tutulan gruplar (sıra Şube ayarları ekranının sırası) */
export const BRANCH_SETTING_GROUPS = [
  CASH_REPORT_GROUP,
  CASH_STAFF_GROUP,
  PARASUT_GROUP,
  COMMISSION_GROUP,
  LAFPOS_GROUP,
  MODPOS_GROUP,
  CALENDAR_GROUP,
  TILL_DEVICE_GROUP,
] as const;

export type BranchSettingGroupId = (typeof BRANCH_SETTING_GROUPS)[number]["id"];

export function branchSettingGroup(id: string): BranchSettingGroup | null {
  return (BRANCH_SETTING_GROUPS as readonly BranchSettingGroup[]).find((g) => g.id === id) ?? null;
}

/**
 * Henüz bütün şubelerde ortak olan ama şubeye göre değişebilecek ayarlar. Şube ayarları ekranı bunları "şimdilik ortak"
 * diye adıyla söyler: sahip hangisinin şubeye göre değişmediğini bilir. Uyarı sesi saatleri tarayıcıda ve bildirim
 * işçisinde (public/sw.js) sabit, kontrol listesi hatırlatmaları tek bir dilim takvimiyle gider; hazır vardiya saatleri
 * vardiya PR'ı (#120) birleştikten sonra
 */
export const SHARED_FOR_NOW: readonly { id: string; label: string }[] = [
  { id: "uyari.saatleri", label: "Uyarı sesi saatleri (10:00–01:00)" },
  { id: "kontrol.saatleri", label: "Kontrol listesi hatırlatma saatleri" },
  { id: "vardiya.hazir", label: "Hazır vardiya saatleri" },
];

/**
 * Eski genel kaydın sahibi şubenin kimliği. Tarihsel bir gerçek: eski kayıt şube başına ayarlara geçildiği gün LafPOS'un
 * şubesinindi (Marina, `LAFPOS_BRANCH_ID`). Bu yüzden kütükten türetilen LafPOS şubesine (lafposBranchOf) bağlanmaz;
 * kasa kaynağı sonradan değişse de eski kaydı okuyan şube değişmez
 */
export function legacyOwnerId(group: Pick<BranchSettingGroup, "legacy">): string {
  return group.legacy === "lafpos" ? LAFPOS_BRANCH_ID : DEFAULT_BRANCH_ID;
}

/** Değerin şifresiz alanları (satırın `value`'su; gizli alanlar `secrets`'ta) */
export function plainFields<T extends Record<string, unknown>>(group: Pick<BranchSettingGroup, "secretFields">, value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype" || group.secretFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}
