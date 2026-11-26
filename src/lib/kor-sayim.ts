import { money } from "./format";
import { clockTR } from "./ozel-gun";

/**
 * Kör sayım (Tuzla; Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Kör sayım). Personel kasa raporunda önce çekmecedeki
 * nakdi sayıp kilitler; olması gereken nakit ve kasa farkı ancak ondan sonra görünür. Kilitli sayım personel tarafından
 * sessizce değiştirilemez: değişiklik nedeniyle yeni bir sayım satırı olur (cash_counts) ve yöneticiye görünür (kasa gün
 * görünümü, rapor penceresinin Kontrol listesi, işlem geçmişi). Sunucu da zorlar: personelin raporundaki sayılan nakit
 * geçerli (en son) sayıma eşit olmalıdır (src/server/cash/blind-count.ts).
 *
 * Şube ayarıdır (kasa.kor, Şube ayarları › Kör sayım); seçilmemişken kasası ModPOS olan şubede açık. LafPOS'un şubesinin
 * LafPOS gününde uygulanmaz: orada sayım zaten LafPOS'ta kördür (src/lib/lafpos/kor-kasa.ts). Yönetici kör değildir;
 * geç rapor ve düzeltme önerisi yöneticinin onayına gittiği için kilit istemez. Saf: tests/kor-sayim.test.ts
 */

/** Sayılan nakdin karşılaştırma toleransı (kuruş yuvarlaması) */
const SAME = 0.005;
const same = (a: number, b: number) => Math.abs(a - b) < SAME;

/** Sayımı değiştirmenin nedeni en az bu kadar karakter */
export const COUNT_REASON_MIN = 5;

/** Bir sayım satırı (cash_counts): ilk satır kör sayım, sonrakiler değişiklik */
export interface CashCountRow {
  amount: number;
  /** Değişikliğin nedeni; ilk sayımda boş */
  reason: string | null;
  userName: string;
  /** Kaydın anı (ISO) */
  at: string;
}

/** Personelin formundaki kilit: geçerli sayım ve değişip değişmediği */
export interface BlindCountLock {
  amount: number;
  at: string;
  by: string;
  /** İlk sayımdan sonra değiştirildi mi */
  changed: boolean;
}

/**
 * Bu kasa gününde kör sayım geçerli mi. `setting`: şube ayarı (null: seçilmedi, varsayılan); varsayılan kasası ModPOS
 * olan şubede açık, LafPOS'un şubesinde kapalı. LafPOS'un şubesinin LafPOS gününde hiçbir zaman (sayım LafPOS'ta kör)
 */
export function blindCountOn(o: { setting: boolean | null; branchId: string; lafposBranch: string | null | undefined; lafposDay: boolean }): boolean {
  if (o.lafposDay && o.branchId === o.lafposBranch) return false;
  return o.setting ?? o.branchId !== o.lafposBranch;
}

/** Ayarın etkin değeri, ekranın anahtarı için (varsayılan çözülmüş) */
export function blindCountSettingOn(setting: boolean | null, branchId: string, lafposBranch: string | null | undefined): boolean {
  return setting ?? branchId !== lafposBranch;
}

/** Sayım satırlarından formun kilidi (geçerli sayım en son satır); sayım yoksa null */
export function lockOf(rows: readonly CashCountRow[]): BlindCountLock | null {
  const last = rows.at(-1);
  if (!last) return null;
  return { amount: last.amount, at: last.at, by: last.userName, changed: rows.length > 1 && rows.some((r) => !same(r.amount, rows[0].amount)) };
}

/**
 * Sayımı kilitlemek için neden gerekir mi: ilk kör sayımda hayır. Önceki bir sayım varsa (değişiklik) ya da rapor zaten
 * girilmişse (personel farkı görmüş olabilir) evet
 */
export function countNeedsReason(o: { counts: number; hasReport: boolean }): boolean {
  return o.counts > 0 || o.hasReport;
}

/**
 * Personelin raporunun sayılan nakdi kör sayıma uyuyor mu (sunucu ve form aynı kuralla). Red metni ya da null:
 * - geçerli sayıma eşitse geçer;
 * - kayıtlı raporun sayılanı değişmediyse geçer (yönetici düzeltmiş ya da ayar açılmadan önce girilmiş rapor);
 * - sayım yoksa "önce kilitleyin", farklıysa "Sayımı değiştir".
 */
export function blindCountRefusal(o: { lock: number | null; counted: number; prevCounted: number | null }): string | null {
  if (o.lock !== null && same(o.counted, o.lock)) return null;
  if (o.prevCounted !== null && same(o.counted, o.prevCounted)) return null;
  if (o.lock === null) return BLIND_COUNT_TEXT.lockFirst;
  return `Sayılan nakit kilitli sayımdan (${money(o.lock)}) farklı; değiştirmek için “Sayımı değiştir”e basıp nedenini yazın.`;
}

/** Değişikliğin nedeni yeterli mi; değilse metin */
export function countReasonError(reason: string | null | undefined): string | null {
  return (reason ?? "").trim().length >= COUNT_REASON_MIN ? null : BLIND_COUNT_TEXT.reason;
}

/**
 * Yöneticinin "Kör sayım" satırları, sırayla: "Kör sayım 6.400 ₺ · Ayşe · 20:14", "Sayım değişti: 6.450 ₺ · Ayşe ·
 * 20:31 · Çekmecenin altında 50 ₺ çıktı"
 */
export function countLines(rows: readonly CashCountRow[]): string[] {
  return rows.map((r, i) =>
    [i === 0 ? `Kör sayım ${money(r.amount)}` : `Sayım değişti: ${money(r.amount)}`, r.userName, clockTR(r.at), i > 0 && r.reason ? r.reason : null].filter(Boolean).join(" · "),
  );
}

/**
 * Yöneticinin uyarısı: kilitli sayım sonradan değişti ("Sayım kilitlendikten sonra değişti: 6.400 ₺ → 6.450 ₺") ya da
 * rapordaki sayılan geçerli sayımdan farklı (yönetici düzeltti ya da düzeltme onaylandı: "Raporda 6.350 ₺, kilitli sayım
 * 6.400 ₺"). Yoksa null
 */
export function countAttention(rows: readonly CashCountRow[], reportCounted: number | null): string | null {
  const first = rows[0];
  const last = rows.at(-1);
  if (!first || !last) return null;
  if (!same(first.amount, last.amount)) return `Sayım kilitlendikten sonra değişti: ${money(first.amount)} → ${money(last.amount)}`;
  if (reportCounted !== null && !same(reportCounted, last.amount)) return `Raporda sayılan ${money(reportCounted)}, kilitli sayım ${money(last.amount)}`;
  return null;
}

/** Ekran ve sunucu metinleri */
export const BLIND_COUNT_TEXT = {
  /** Sunucunun ve formun reddi: sayım kilitlenmeden rapor gönderilmez */
  lockFirst: "Önce çekmecedeki nakdi sayıp kilitleyin; kasa farkı sonra görünür.",
  /** Değişikliğin nedeni eksik */
  reason: `Sayımı neden değiştirdiğinizi yazın (en az ${COUNT_REASON_MIN} karakter); yönetici görür.`,
  /** Ayar kapalı ya da LafPOS günü */
  off: "Bu kasada kör sayım yok; sayılan nakdi rapora yazın.",
  /** Kasa kartının alt başlığı (kilitlenmeden önce) */
  card: "Önce çekmecedeki bütün nakdi sayıp kilitleyin; olması gereken ve fark sonra görünür.",
  /** Sonuç kartında farkın yerine */
  result: "Kasa farkı, sayım kilitlenince görünür.",
  /** Telefonun sonuç çubuğunda */
  bar: "Fark sayım kilitlenince",
  /** Kilitli alanın altındaki satır */
  locked: "Kilitli sayım",
  /** Ertesi günün raporu girildiyse ya da gün personelin penceresinden çıktıysa */
  closed: "Bu günün sayımını artık yalnız yönetici değiştirir.",
} as const;
