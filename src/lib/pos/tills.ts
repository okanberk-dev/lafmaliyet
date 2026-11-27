import { ALL_BRANCHES, DEFAULT_BRANCH_ID, type BranchRow } from "@/lib/branches";

/**
 * Çok şubeli AsilPOS kasaları (docs/ASILPOS.md › Şubeler; sahibin kararı, 27 Kasım 2026): her fiziksel şubenin kendi
 * AsilPOS kasası olabilir. Kasanın şubesi kütükten (branches.pos_source = AsilPOS), geçiş günü şubenin kendi ayarından
 * (branch_settings, AsilPOS grubu), imza anahtarı da şubenin kendisinin. Sayma kuralı tek: bir şubenin günü yalnız şube
 * AsilPOS kasasıysa ve gün o şubenin geçiş gününden önce değilse sayılır. ModPOS'taki şubenin AsilPOS'tan gelen günü
 * (deneme) hiçbir hesaba girmez.
 *
 * Saf: veritabanına bağlı değil (sunucu okuyucusu src/server/pos/tills.ts loadPosTills). Testleri tests/pos-cok-sube.test.ts.
 */

/**
 * Eski tek kasalı kurulumun şubesi: Marina (21 Kasım 2026'dan beri AsilPOS'ta). Yalnız tarihsel iki şey için okunur: eski
 * genel geçiş günü kaydının (settings) ve ortamdaki anahtarın (ASILPOS_SYNC_SECRET, eski adı da) sahibi bu şubedir. Kütükte
 * hiçbir şubenin kasası AsilPOS değilse (göç 0099 öncesi, eski test verisi) AsilPOS kasası bu şube sayılır
 */
export const LEGACY_POS_BRANCH_ID = "marina";

/** Şube → o şubenin AsilPOS'a geçiş günü (kasası AsilPOS olmayan şube ya da geçiş günü yoksa null ya da yok) */
export type SwitchDays = Readonly<Record<string, string | null>>;

/** Kütüğün AsilPOS kasalarını bulmak için gereken alanları */
export type PosTillRow = Pick<BranchRow, "id" | "kind" | "posSource" | "active">;

/** AsilPOS kasaları ve geçiş günleri (src/server/pos/tills.ts loadPosTills) */
export interface PosTills {
  /** Kasası AsilPOS olan fiziksel şubeler (kapalı şube dahil: geçmiş günleri sayılmaya devam eder), kütüğün sırasıyla */
  ids: readonly string[];
  /** Bunlardan açık olanlar (gün sonu otomasyonu, zil, Ayarlar kartı) */
  active: readonly string[];
  /** Kasa başına geçiş günü; kasası AsilPOS olmayan şube burada yoktur */
  switchDays: SwitchDays;
}

/** Kasa kaynağı AsilPOS mu (veritabanındaki eski değer okunurken yenisine çevrilir; src/server/db/schema.ts) */
export function isPosSource(source: string | null | undefined): boolean {
  return source === "asilpos";
}

/**
 * Kasası AsilPOS olan fiziksel şubeler, verilen sırayla (kapalı şube dahil). Kütükte hiçbiri yoksa eski tek kasalı
 * kurulumun şubesi (LEGACY_POS_BRANCH_ID): göç 0099'dan önce Marina'nın kaydı ModPOS görünse de kasası AsilPOS'tu
 */
export function posTillIds(branches: readonly PosTillRow[]): string[] {
  const ids = branches.filter((b) => b.kind === "fiziksel" && isPosSource(b.posSource)).map((b) => b.id);
  return ids.length ? ids : [LEGACY_POS_BRANCH_ID];
}

/** Açık AsilPOS kasaları (posTillIds'in açık olanları; geri düşüş şubesi kütükte yoksa da açık sayılır) */
export function activePosTillIds(branches: readonly PosTillRow[]): string[] {
  return posTillIds(branches).filter((id) => branches.find((b) => b.id === id)?.active ?? true);
}

/**
 * Şubenin kasasının geçiş günü: kasası AsilPOS değilse (ModPOS şubesi, online kanal) null, yani her günü ModPOS günü.
 * Şubesi verilmeyen kayıt Tuzla'nındır (şubeler öncesi)
 */
export function switchDayFor(days: SwitchDays, branchId: string | null | undefined): string | null {
  return days[branchId ?? DEFAULT_BRANCH_ID] ?? null;
}

/** Şubenin bu günü sayılan AsilPOS günü mü: kasası AsilPOS ve gün geçiş gününden önce değil */
export function isCountedPosDay(days: SwitchDays, branchId: string | null | undefined, date: string): boolean {
  const day = switchDayFor(days, branchId);
  return day !== null && date >= day;
}

/** Geçiş günü olan kasalar (gün sonu otomasyonu, sayılan günlerin okunması) */
export function countedTillIds(days: SwitchDays): string[] {
  return Object.entries(days)
    .filter(([, d]) => d !== null)
    .map(([id]) => id);
}

/** Kasaların en erken geçiş günü (yoksa null): "Tümü"nün metinleri ve okumaların alt sınırı */
export function earliestSwitchDay(days: SwitchDays): string | null {
  return Object.values(days).reduce<string | null>((a, d) => (d !== null && (a === null || d < a) ? d : a), null);
}

/** Görünümün kasaları: "Tümü"de hepsi, tek şube seçiliyken yalnız o şubeninki (kasası AsilPOS değilse boş) */
export function scopeSwitchDays(days: SwitchDays, scope: string): SwitchDays {
  if (scope === ALL_BRANCHES) return days;
  const day = switchDayFor(days, scope);
  return scope in days ? { [scope]: day } : {};
}

/**
 * Görünümün tek geçiş günü (ay ekranlarının metinleri, Settings.asilposGecisGunu): tek şube seçiliyken o şubenin kasasınınki
 * (ModPOS şubesinde null), "Tümü"de kasaların en erkeni. Para hesapları "Tümü"de bunu değil şube şube `SwitchDays`'i okur
 */
export function scopeSwitchDay(days: SwitchDays, scope: string): string | null {
  return scope === ALL_BRANCHES ? earliestSwitchDay(days) : switchDayFor(days, scope);
}

/** Tek kasalı eski çağrılar için harita: yalnız `branchId`'nin geçiş günü */
export function singleTill(branchId: string, switchDay: string | null): SwitchDays {
  return { [branchId]: switchDay };
}

/**
 * Şube → o şubenin AsilPOS satışlarının sayıldığı ilk gün (Dataset.asilposSales; geçiş ayında ModPOS listesinin son
 * gününden sonra). Kasası AsilPOS olmayan ya da hiç sayılmayan şube burada yoktur
 */
export type PosFroms = Readonly<Record<string, string>>;

/** Şubenin AsilPOS satışlarının sayıldığı ilk gün; yoksa null */
export function posFromOf(froms: PosFroms | null | undefined, branchId: string | null | undefined): string | null {
  return froms?.[branchId ?? DEFAULT_BRANCH_ID] ?? null;
}

/** (şube, gün) anahtarı: aynı güne iki kasanın satırı düşer, gün tek başına anahtar olamaz */
export function tillDayKey(branchId: string | null | undefined, date: string): string {
  return `${branchId ?? DEFAULT_BRANCH_ID}|${date}`;
}

/** Kasası AsilPOS olan şube ModPOS'a dönerken istenen onayın metninin başı (eylem bununla reddeder, ekran onay sorar) */
export const POS_OFF_CONFIRM_PREFIX = "AsilPOS'tan ModPOS'a dönüş:";

/**
 * Onayın metni: şubenin geçiş günü ya da kayıtlı AsilPOS günü var (asilposInUse). Onaylanınca şubenin geçiş günü silinir
 * (AsilPOS günleri saklanır, deneme sayılır), föyü yeniden çekilir
 */
export function posOffConfirmText(branchName: string): string {
  return `${POS_OFF_CONFIRM_PREFIX} ${branchName} şubesinin AsilPOS günleri ya da geçiş günü var. Kaydedince şubenin geçiş günü silinir, AsilPOS'tan gelen günleri saklanır ama hiçbir hesaba girmez (deneme), kasa raporu ve föy yeniden ModPOS'a göre çalışır. Kapanmış ayların rakamı değişebilir.`;
}
