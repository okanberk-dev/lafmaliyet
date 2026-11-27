import { isCalendarDay, ASILPOS_SWITCH_MIN, readAsilposSwitchDay } from "@/lib/constants";
import { genitive } from "@/lib/recipe-change";
import { addDays, dayMonthTR, daysBetween, shiftMonth } from "@/lib/reminders";

/**
 * "AsilPOS'a geçiş günü" (docs/ASILPOS.md › Geçiş günü; ayar `settings.asilposGecisGunu`): kasada AsilPOS'un kullanılmaya
 * başlandığı ilk iş günü (YYYY-MM-DD, 05:00 kuralı). Boşken (null) her şey bugünkü gibi ModPOS'a göre çalışır: AsilPOS'un
 * gönderdiği günler saklanır ama hiçbir hesaba, ekrana, göreve, e-postaya ya da ön doldurmaya girmez (yalnız Ayarlar'daki
 * AsilPOS kartında "deneme" olarak görünür; sahibin 26 Ekim kararı). Doluyken o günden itibaren kaynak AsilPOS'tur. Ayar
 * değişince hiçbir kayıt yazılmaz ya da silinmez, yalnız okuyanlar değişir. Geçiş günü şubenin kendi kasasınındır (her
 * AsilPOS kasasının kendi günü; src/lib/pos/tills.ts switchDayFor): ModPOS'taki şube etkilenmez. Geçiş gününü okuyan her
 * yer bu dosyanın ve src/lib/pos/tills.ts'in yardımcılarından geçer (saf; testleri tests/asilpos.test.ts).
 */

/** Ayarın anahtarı (settings tablosu; Settings tipinde aynı adla) */
export const ASILPOS_SWITCH_KEY = "asilposGecisGunu";

/** Kaydederken geçiş günü bugünden en çok bu kadar gün ileride olabilir */
export const ASILPOS_SWITCH_MAX_AHEAD = 90;

// Okuma kuralı (takvimde olan gün, ASILPOS_SWITCH_MIN'den önce değil; bozuk değer null = ModPOS) constants.ts'te:
// settingsFromRows da onu kullanır, bu dosya oradan alır (constants.ts başka modül içe aktarmaz, döngü olmasın)
export { isCalendarDay, ASILPOS_SWITCH_MIN, readAsilposSwitchDay as readSwitchDay };

/** Kaydederken: gün geçersizse nedeni (kullanıcıya gösterilir), değilse null. `today` iş günü */
export function switchDayProblem(day: string, today: string): string | null {
  if (!isCalendarDay(day)) return "Geçerli bir gün seçin";
  if (day < ASILPOS_SWITCH_MIN) return `Geçiş günü en erken ${dayMonthYearTR(ASILPOS_SWITCH_MIN)} olabilir`;
  if (day > addDays(today, ASILPOS_SWITCH_MAX_AHEAD)) return `Geçiş günü en çok ${ASILPOS_SWITCH_MAX_AHEAD} gün ileride olabilir`;
  return null;
}

/** Bu iş gününün kaynağı AsilPOS mu: geçiş günü seçili ve gün ondan önce değil */
export function isAsilposDay(day: string, switchDay: string | null): boolean {
  return switchDay !== null && day >= switchDay;
}

/**
 * Şubeler (docs/ASILPOS.md › Şubeler; sahibin kararı, 27 Kasım 2026): her fiziksel şubenin kendi AsilPOS kasası olabilir.
 * Kasanın şubesi kütükten, geçiş günü şubenin kendi ayarından, anahtarı da şubenin kendisinin; kural ve harita
 * src/lib/pos/tills.ts'te (SwitchDays, switchDayFor, isCountedPosDay). Marina 21 Kasım 2026'dan beri AsilPOS'ta, ModPOS'u
 * tamamen bitti (Marina'nın ModPOS dönemi yalnız 13–21 Kasım 2026); Tuzla ModPOS'ta kalır: föyü çekilir, Kasa raporu
 * ModPOS'a göre açılır, ürün listesi ve panelde girilen ürün ikramı sayılır. Şubesi verilmeyen eski kayıtlar Tuzla'nındır.
 */
export { LEGACY_POS_BRANCH_ID, switchDayFor, isCountedPosDay, type SwitchDays } from "@/lib/pos/tills";

/** Günün kasası (metinler için) */
export function kasaName(day: string, switchDay: string | null): "ModPOS" | "AsilPOS" {
  return isAsilposDay(day, switchDay) ? "AsilPOS" : "ModPOS";
}

/**
 * Ayın kaynağı: tamamı geçiş gününden önceyse (ya da geçiş günü yoksa) "modpos", tamamı sonraysa (ayın 1'i ≥ geçiş
 * günü) "asilpos", geçiş günü ayın ortasındaysa "gecis" (ayın ilk günleri ModPOS, gerisi AsilPOS)
 */
export function monthSource(month: string, switchDay: string | null): "modpos" | "gecis" | "asilpos" {
  if (switchDay === null) return "modpos";
  const first = `${month}-01`;
  if (first >= switchDay) return "asilpos";
  return switchDay.slice(0, 7) === month ? "gecis" : "modpos";
}

/**
 * Ayın ModPOS ürün listesi (Satışlar'a yüklenen) hesaba girer mi: ayın tamamı geçiş gününden sonraysa hayır (liste
 * silinmez, Satışlar "sayılmıyor" der); geçiş ayında ve öncesinde evet
 */
export function modposListCounts(month: string, switchDay: string | null): boolean {
  return monthSource(month, switchDay) !== "asilpos";
}

/**
 * Ayın AsilPOS satışlarının sayıldığı ilk gün (docs/ASILPOS.md › Günlük satış; her gün için tek kaynak): ay geçiş
 * gününden önceyse (ya da geçiş günü yoksa) null; ayın tamamı geçiş gününden sonraysa ayın 1'i (ModPOS listesi
 * sayılmaz). Geçiş ayında ModPOS listesi yoksa (`modposThrough` null) geçiş günü; varsa listenin son gününden sonraki
 * gün, geçiş gününden önce değil: ModPOS'un aylık listesi gün gün bölünemez, kapsadığı günler AsilPOS'tan yeniden
 * sayılmaz. Liste ayın sonuna kadarsa o ay AsilPOS sayılmaz (null).
 */
export function asilposSalesFrom(month: string, switchDay: string | null, modposThrough: string | null): string | null {
  const src = monthSource(month, switchDay);
  if (src === "modpos" || switchDay === null) return null;
  if (src === "asilpos") return `${month}-01`;
  if (modposThrough === null) return switchDay;
  const next = addDays(modposThrough, 1);
  const from = next > switchDay ? next : switchDay;
  return from.slice(0, 7) === month ? from : null;
}

/**
 * Geçiş gününden itibaren AsilPOS günlük satışlarının sayıldığı ilk gün (bütün aylar için tek sınır): geçiş ayında
 * asilposSalesFrom, o ay hiç sayılmıyorsa sonraki ayın 1'i (sonraki aylarda ModPOS listesi sayılmaz, AsilPOS'un her
 * günü sayılır). Geçiş günü yoksa null: AsilPOS hiçbir hesaba girmez.
 */
export function asilposCountFrom(switchDay: string | null, modposThroughOfSwitchMonth: string | null): string | null {
  if (switchDay === null) return null;
  const month = switchDay.slice(0, 7);
  return asilposSalesFrom(month, switchDay, modposThroughOfSwitchMonth) ?? `${shiftMonth(month, 1)}-01`;
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
 * Geçiş gününün bugün etkilediği yerler (onay penceresi ve belge bunu yazar). Her AsilPOS partisi kendi okuyucusunu
 * buraya ekler: liste kodun yaptığından fazlasını söylemez. Çok şube: geçiş günü bir kasanındır (`branchName`), son madde
 * hangi kasaların ModPOS'ta kaldığını söyler (`modposNames`); tahmini stok yalnız Marina'nın (`stockEstimate`)
 */
export function switchEffects(o: { branchName: string; modposNames: readonly string[]; stockEstimate: boolean }): string[] {
  const own = genitive(o.branchName);
  const others = o.modposNames.length
    ? `${o.modposNames.map(genitive).join(" ve ")} kasası ModPOS'ta kalır; ModPOS föyü çekilmeye ve Kasa raporuyla karşılaştırılmaya devam eder, Kasa raporu, geç rapor, ürün satış listesi, ürün ikramı ve kasadaki fiyatlar orada bugünkü gibidir; Komisyon & hakediş o kasaların raporlarını kasa raporu kuralıyla ekler.`
    : "Başka şubenin kasası bundan etkilenmez: her AsilPOS kasasının kendi geçiş günü vardır.";
  return [
    ...ASILPOS_SWITCH_COMMON,
    ...(o.stockEstimate ? [STOCK_EFFECT.replace("Marina'nın", own)] : []),
    `Bunların hepsi yalnız ${own} kasası içindir (her AsilPOS kasasının kendi geçiş günü vardır): ${others}`,
  ];
}

/** Her kasada aynı olan etkiler */
const ASILPOS_SWITCH_COMMON: readonly string[] = [
  "Kasa raporu bu günden itibaren AsilPOS'un gün sonuyla açılır: o günün gönderimi geldiyse form kendiliğinden dolar (kaydetmez), Z bölümü \"AsilPOS gün sonu (Z)\" olur ve ModPOS Z fotoğrafı istenmez; kayıtlı rapor, günden güne görünüm, e-posta ve WhatsApp AsilPOS'tan farklı yazılanları gösterir.",
  "Geç kasa raporu bu günden itibaren AsilPOS'un gün sonuyla girilir (gelmediyse yazarkasa Z fotoğrafıyla); kasa raporu girilmemiş günün ciro ve açık günü AsilPOS'un Z'sinden sayılır, gün yine \"rapor yok\" görünür.",
  "\"Kafe kapalıydı\" için bu günden itibaren AsilPOS'un satışlı gün sonu kanıttır: o gün kapalı onaylanamaz, işaretliyse kalkar.",
  "Ürün satışları bu günden itibaren AsilPOS'un gün sonlarından gelir: Satışlar, Tutarlılık, Ürünler, Analiz ve Genel bakış onları ay toplamı olarak sayar. Bu günden sonraki aylara yüklenen ModPOS listesi sayılmaz (silinmez); geçiş ayında ModPOS listesi geçiş gününden önceki günler içindir.",
  "Satış tahmini bu günden itibaren kasa raporu girilmemiş günde AsilPOS'un Z toplamını, tatlı payı AsilPOS satışlarını da okur.",
  "Komisyon & hakediş bu günden itibaren her yemek kartının ve platformun satışını AsilPOS'un ödeme türlerinden kart kart alır (ödeme türünün kanalı AsilPOS'ta seçili olmalı); yazdığınız ekstre yine önce gelir.",
  "Ürün ikramı bu günden itibaren AsilPOS'ta işaretlenir: AsilPOS'un ikramları Tutarlılık'ın kayıtlı tüketimine, Zayi & ikram'a ve kasa e-postasına girer; gün sonu gelen günde panele girilmiş ürün ikramı sayılmaz, yenisi girilmez. Hammadde ikramı ve zayi panelde kalır.",
  "AsilPOS'tan gelen bu günden önceki günler deneme sayılır: Ayarlar'da görünür, hiçbir hesaba girmez.",
  "Kasadaki fiyatlar bu günden itibaren yalnız siteye bağlı olmayan ve fiyatı bu günden sonra panelde değişen ürünler içindir ve yalnız yöneticinin işidir (AsilPOS'ta ürün fiyatını kasiyer değiştiremez; personele görev düşmez): siteye bağlı ürünün yeni fiyatını AsilPOS siteden kendisi alır, Kasaya işle'de, zilde ve Bugün'de görünmez. ModPOS'ta değişecek fiyatlar kaydedilmeye devam eder, yalnız gizlenir: geçiş günü kaldırılır ya da ileri alınırsa eksiksiz geri gelir.",
  "Metinler bu günden itibaren ModPOS yerine AsilPOS der: Bugün'ün ve zilin akşam kasa satırı (AsilPOS'ta Günü kapat), Kasa raporu, e-posta ve WhatsApp karşılaştırmaları, kapalı gün kartı; aylık rapor etiketleri (Genel bakış, Gelir-gider, Tutarlılık, Ürünler, Analiz, dışa aktarım, Claude) ayın kasasıyla, geçiş ayında \"Kasa (ModPOS 1–9 · AsilPOS 10–30)\".",
];

/** Tahmini stok (yalnız Marina'nın; src/lib/stock-estimate.ts) */
const STOCK_EFFECT =
  "Marina'nın tahmini stoğu (Stok sayımı › Tahmini stok) bu günden itibaren AsilPOS'un satışlarını, ikram ve zayisini son ay sonu sayımından düşer; kritik eşiğe inen malzeme Genel bakış ve Bugün'de söylenir.";

/** Eski tek kasalı kurulumun metni (Marina AsilPOS'ta, Tuzla ModPOS'ta; belge ve testler) */
export const ASILPOS_SWITCH_EFFECTS: readonly string[] = switchEffects({ branchName: "Marina", modposNames: ["Tuzla"], stockEstimate: true });
