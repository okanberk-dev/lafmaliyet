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
import { defaultCashRecipients } from "@/lib/cash-report";
import { LAFPOS_BRANCH_ID } from "@/lib/lafpos/switch";

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
  /** Eski genel kaydın anahtarı (integration_state) */
  legacyKey: string;
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

/** Şube başına tutulan gruplar (sıra Şube ayarları ekranının sırası) */
export const BRANCH_SETTING_GROUPS = [CASH_REPORT_GROUP, CASH_STAFF_GROUP, PARASUT_GROUP] as const;

export type BranchSettingGroupId = (typeof BRANCH_SETTING_GROUPS)[number]["id"];

export function branchSettingGroup(id: string): BranchSettingGroup | null {
  return (BRANCH_SETTING_GROUPS as readonly BranchSettingGroup[]).find((g) => g.id === id) ?? null;
}

/**
 * Şube başına geçecek ama henüz bütün şubelerde ortak olan ayarlar (plan B2; sıradaki dilimler). Şube ayarları ekranı
 * bunları "şimdilik ortak" diye adıyla söyler: sahip hangisinin şubeye göre değişmediğini bilir.
 */
export const SHARED_FOR_NOW: readonly { id: string; label: string; linkable: boolean; legacy: LegacyOwner }[] = [
  { id: "pos.lafpos", label: "LafPOS bağlantısı ve geçiş günü", linkable: true, legacy: "lafpos" },
  { id: "isletme.takvim", label: "Çalışma saatleri ve uyarı saatleri", linkable: true, legacy: "default" },
  { id: "komisyon", label: "Komisyon ve yemek kartı kanalları", linkable: true, legacy: "default" },
  { id: "modpos", label: "ModPOS ay yedeği", linkable: true, legacy: "default" },
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
  for (const [k, v] of Object.entries(value)) if (!group.secretFields.includes(k)) out[k] = v;
  return out;
}
