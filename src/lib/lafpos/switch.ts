import { isCalendarDay, LAFPOS_SWITCH_MIN, readLafposSwitchDay } from "@/lib/constants";
import { addDays, dayMonthTR, daysBetween, shiftMonth } from "@/lib/reminders";

/**
 * "LafPOS'a geçiş günü" (docs/LAFPOS.md › Geçiş günü; ayar `settings.lafposGecisGunu`): kasada LafPOS'un kullanılmaya
 * başlandığı ilk iş günü (YYYY-MM-DD, 05:00 kuralı). Boşken (null) her şey bugünkü gibi ModPOS'a göre çalışır: LafPOS'un
 * gönderdiği günler saklanır ama hiçbir hesaba, ekrana, göreve, e-postaya ya da ön doldurmaya girmez (yalnız Ayarlar'daki
 * LafPOS kartında "deneme" olarak görünür; sahibin 26 Ekim kararı). Doluyken o günden itibaren kaynak LafPOS'tur. Ayar
 * değişince hiçbir kayıt yazılmaz ya da silinmez, yalnız okuyanlar değişir. Geçiş gününü okuyan her yer bu dosyanın
 * yardımcılarından geçer (saf; testleri tests/lafpos.test.ts).
 */

/** Ayarın anahtarı (settings tablosu; Settings tipinde aynı adla) */
export const LAFPOS_SWITCH_KEY = "lafposGecisGunu";

/** Kaydederken geçiş günü bugünden en çok bu kadar gün ileride olabilir */
export const LAFPOS_SWITCH_MAX_AHEAD = 90;

// Okuma kuralı (takvimde olan gün, LAFPOS_SWITCH_MIN'den önce değil; bozuk değer null = ModPOS) constants.ts'te:
// settingsFromRows da onu kullanır, bu dosya oradan alır (constants.ts başka modül içe aktarmaz, döngü olmasın)
export { isCalendarDay, LAFPOS_SWITCH_MIN, readLafposSwitchDay as readSwitchDay };

/** Kaydederken: gün geçersizse nedeni (kullanıcıya gösterilir), değilse null. `today` iş günü */
export function switchDayProblem(day: string, today: string): string | null {
  if (!isCalendarDay(day)) return "Geçerli bir gün seçin";
  if (day < LAFPOS_SWITCH_MIN) return `Geçiş günü en erken ${dayMonthYearTR(LAFPOS_SWITCH_MIN)} olabilir`;
  if (day > addDays(today, LAFPOS_SWITCH_MAX_AHEAD)) return `Geçiş günü en çok ${LAFPOS_SWITCH_MAX_AHEAD} gün ileride olabilir`;
  return null;
}

/** Bu iş gününün kaynağı LafPOS mu: geçiş günü seçili ve gün ondan önce değil */
export function isLafposDay(day: string, switchDay: string | null): boolean {
  return switchDay !== null && day >= switchDay;
}

/** Günün kasası (metinler için) */
export function kasaName(day: string, switchDay: string | null): "ModPOS" | "LafPOS" {
  return isLafposDay(day, switchDay) ? "LafPOS" : "ModPOS";
}

/**
 * Ayın kaynağı: tamamı geçiş gününden önceyse (ya da geçiş günü yoksa) "modpos", tamamı sonraysa (ayın 1'i ≥ geçiş
 * günü) "lafpos", geçiş günü ayın ortasındaysa "gecis" (ayın ilk günleri ModPOS, gerisi LafPOS)
 */
export function monthSource(month: string, switchDay: string | null): "modpos" | "gecis" | "lafpos" {
  if (switchDay === null) return "modpos";
  const first = `${month}-01`;
  if (first >= switchDay) return "lafpos";
  return switchDay.slice(0, 7) === month ? "gecis" : "modpos";
}

/**
 * Ayın ModPOS ürün listesi (Satışlar'a yüklenen) hesaba girer mi: ayın tamamı geçiş gününden sonraysa hayır (liste
 * silinmez, Satışlar "sayılmıyor" der); geçiş ayında ve öncesinde evet
 */
export function modposListCounts(month: string, switchDay: string | null): boolean {
  return monthSource(month, switchDay) !== "lafpos";
}

/**
 * Ayın LafPOS satışlarının sayıldığı ilk gün (docs/LAFPOS.md › Günlük satış; her gün için tek kaynak): ay geçiş
 * gününden önceyse (ya da geçiş günü yoksa) null; ayın tamamı geçiş gününden sonraysa ayın 1'i (ModPOS listesi
 * sayılmaz). Geçiş ayında ModPOS listesi yoksa (`modposThrough` null) geçiş günü; varsa listenin son gününden sonraki
 * gün, geçiş gününden önce değil: ModPOS'un aylık listesi gün gün bölünemez, kapsadığı günler LafPOS'tan yeniden
 * sayılmaz. Liste ayın sonuna kadarsa o ay LafPOS sayılmaz (null).
 */
export function lafposSalesFrom(month: string, switchDay: string | null, modposThrough: string | null): string | null {
  const src = monthSource(month, switchDay);
  if (src === "modpos" || switchDay === null) return null;
  if (src === "lafpos") return `${month}-01`;
  if (modposThrough === null) return switchDay;
  const next = addDays(modposThrough, 1);
  const from = next > switchDay ? next : switchDay;
  return from.slice(0, 7) === month ? from : null;
}

/**
 * Geçiş gününden itibaren LafPOS günlük satışlarının sayıldığı ilk gün (bütün aylar için tek sınır): geçiş ayında
 * lafposSalesFrom, o ay hiç sayılmıyorsa sonraki ayın 1'i (sonraki aylarda ModPOS listesi sayılmaz, LafPOS'un her
 * günü sayılır). Geçiş günü yoksa null: LafPOS hiçbir hesaba girmez.
 */
export function lafposCountFrom(switchDay: string | null, modposThroughOfSwitchMonth: string | null): string | null {
  if (switchDay === null) return null;
  const month = switchDay.slice(0, 7);
  return lafposSalesFrom(month, switchDay, modposThroughOfSwitchMonth) ?? `${shiftMonth(month, 1)}-01`;
}

/**
 * Geçiş günü `prev`'den `next`'e değişince kaynağı değişen günlerin ayları, bugüne (iş günü) kadar: ikisi arasındaki
 * günler (biri boşsa öteki günden bugüne). İleri günler henüz hiçbir hesapta yok; ay listesi onay penceresinde
 * gösterilir (FIFO başlangıcı gibi: kapanmış ayların rakamı değişebilir).
 */
export function switchAffectedMonths(prev: string | null, next: string | null, today: string): string[] {
  if (prev === next) return [];
  const from = prev === null ? next! : next === null ? prev : prev < next ? prev : next;
  const until = prev === null || next === null ? today : addDays(prev < next ? next : prev, -1);
  const to = until < today ? until : today;
  if (from > to) return [];
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** "2026-11-10" → "10 Kasım 2026" */
export function dayMonthYearTR(day: string): string {
  return `${dayMonthTR(day)} ${day.slice(0, 4)}`;
}

/** Geçiş gününe kalan gün: "yarın", "4 gün sonra"; bugün ya da geçmişse null */
export function daysUntilText(day: string, today: string): string | null {
  const n = daysBetween(today, day);
  if (n <= 0) return null;
  return n === 1 ? "yarın" : `${n} gün sonra`;
}

/**
 * Geçiş gününün bugün etkilediği yerler (onay penceresi ve belge bunu yazar). Her LafPOS partisi kendi okuyucusunu
 * buraya ekler: liste kodun yaptığından fazlasını söylemez.
 */
export const LAFPOS_SWITCH_EFFECTS: readonly string[] = [
  "Kasa raporu bu günden itibaren LafPOS'un gün sonuyla açılır: o günün gönderimi geldiyse form kendiliğinden dolar (kaydetmez), Z bölümü \"LafPOS gün sonu (Z)\" olur ve ModPOS Z fotoğrafı istenmez; kayıtlı rapor, günden güne görünüm, e-posta ve WhatsApp LafPOS'tan farklı yazılanları gösterir.",
  "Geç kasa raporu bu günden itibaren LafPOS'un gün sonuyla girilir (gelmediyse yazarkasa Z fotoğrafıyla); kasa raporu girilmemiş günün ciro ve açık günü LafPOS'un Z'sinden sayılır, gün yine \"rapor yok\" görünür.",
  "\"Kafe kapalıydı\" için bu günden itibaren LafPOS'un satışlı gün sonu kanıttır: o gün kapalı onaylanamaz, işaretliyse kalkar.",
  "Ürün satışları bu günden itibaren LafPOS'un gün sonlarından gelir: Satışlar, Tutarlılık, Ürünler, Analiz, Genel bakış ve KDV tahmini onları ay toplamı olarak sayar. Bu günden sonraki aylara yüklenen ModPOS listesi sayılmaz (silinmez); geçiş ayında ModPOS listesi geçiş gününden önceki günler içindir.",
  "Satış tahmini bu günden itibaren kasa raporu girilmemiş günde LafPOS'un Z toplamını, tatlı payı LafPOS satışlarını da okur.",
  "Komisyon & hakediş bu günden itibaren her yemek kartının ve platformun satışını LafPOS'un ödeme türlerinden kart kart alır (ödeme türünün kanalı LafPOS'ta seçili olmalı); yazdığınız ekstre yine önce gelir.",
  "Ürün ikramı bu günden itibaren LafPOS'ta işaretlenir: LafPOS'un ikramları Tutarlılık'ın kayıtlı tüketimine, Zayi & ikram'a ve kasa e-postasına girer; gün sonu gelen günde panele girilmiş ürün ikramı sayılmaz, yenisi girilmez. Hammadde ikramı ve zayi panelde kalır.",
  "LafPOS'tan gelen bu günden önceki günler deneme sayılır: Ayarlar'da görünür, hiçbir hesaba girmez.",
];
