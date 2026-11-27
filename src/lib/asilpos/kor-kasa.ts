import { staffAsilposEntryClosed } from "./cash-moves";
import type { AsilposDay } from "./prefill";

/**
 * Kör kasa (Marina; denetim 25 Kasım 2026, bulgu 0; docs/ASILPOS.md › Kör kasa). AsilPOS'ta kasiyer çekmeceyi kör sayar
 * (`kasa.rakam` yetkisi yok): olması gereken nakdi ve farkı görmez, fark bu panelin Kasa raporuna gelir. Panel de
 * personele göstermez: AsilPOS'un şubesinde geçiş gününden itibaren (staffAsilposEntryClosed'ın şube ve gün kuralı)
 * personelin gördüğü raporda açılış, sayılan nakit, teslim ve kasa farkı yoktur (kayıtlı rapor kartı, döküm, Bugün,
 * Son 7 gün, eski AsilPOS günü, RSC yükü). Olması gereken ve ertesi güne devir bunlardan hesaplandığı için onlar da
 * yok. Personel o günün raporunu formdan yazamaz, düzeltme öneremez, WhatsApp metnini alamaz (sunucu reddeder). Yönetici
 * (rakam yetkisi) her şeyi görür. Teslim (patrona verilen) kasiyerin AsilPOS'a kendi girdiği kasa hareketidir: "gün içinde
 * çıkan"ın ve AsilPOS'un "harcama + teslim" bilgi satırının parçası olarak personelde kalır; açılış ve sayılan olmadan
 * olması gereken ve fark çıkmaz. Raporun ayrı teslim alanı sıfırdır. Saf: tests/kor-kasa.test.ts
 */

/** Personelin yükünde sıfırlanan alanlar (sayımın rakamları) */
export const BLIND_FIELDS = ["openingCash", "countedCash", "handedOver", "cashDiff"] as const;

/** Bu kasa günü personele kör mü: AsilPOS'un şubesinde AsilPOS günü, okuyan personel */
export function staffBlindDay(o: { admin: boolean; branchId: string | null | undefined; asilposDay: boolean; asilposBranch?: string }): boolean {
  return staffAsilposEntryClosed(o);
}

/**
 * Kasa sayfasının kör kararı, okuma düşse de kapalı (inceleme, 25 Kasım 2026): `asilposDay` null ise günün AsilPOS günü
 * olup olmadığı okunamadı; AsilPOS'un şubesinin kasasında personele kör sayılır (geçici bir okuma hatası sayımı açmaz).
 * Yönetici ve öteki şube değişmez
 */
export function staffBlindView(o: { admin: boolean; branchId: string | null | undefined; asilposDay: boolean | null; asilposBranch?: string }): boolean {
  return staffBlindDay({ ...o, asilposDay: o.asilposDay ?? true });
}

/** Personelin gördüğü metinler */
export const BLIND_TEXT = {
  /** Kayıtlı raporun büyük satırı (fark yerine) */
  headline: "Gün sonu alındı",
  /** Altındaki satır ("AsilPOS'ta düzeltin" değil: düzeltmeyi istemek farkı ima ederdi) */
  line: "Rakamlar AsilPOS'tan geldi; kasayı yönetici kontrol eder.",
  /** Elle girilmiş (otomatik olmayan) raporda aynı satır: rakamlar AsilPOS'tan gelmedi */
  manualLine: "Rapor elle girildi; kasayı yönetici kontrol eder.",
  /** Raporu girilmiş AsilPOS gününde sayfanın alt başlığı ("kasadaki nakdi sayın ve buraya girin" değil) */
  description: "Gün sonu AsilPOS'ta alınır; bu günün kasa raporu girildi, kasayı yönetici kontrol eder.",
  /** Dökümün kasa bölümünde açılış, sayılan ve farkın yerine */
  breakdown: "Kör sayım: açılış, sayılan nakit ve kasa farkı yalnız yöneticide.",
  /** Son 7 gün listesinde farkın rozeti yerine */
  badge: "Sayım AsilPOS'ta",
  /** Personel WhatsApp metnini isterse (sunucunun reddi): metin farkı ve sayılanı taşır */
  whatsapp: "AsilPOS gününün kasa raporu personelden WhatsApp'la paylaşılmaz; yönetici e-postadan görür.",
} as const;

/**
 * Otomatik notun sayımı ele veren cümleleri (src/lib/asilpos/gun-sonu.ts autoNote): açılışın önceki devirden farkı ve
 * AsilPOS'un açılışta beklediği (beklenen + fark = açılış). Kapanış notu ve cihaz boşlukları kalır
 */
const OPENING_SENTENCES = [
  /Açılış önceki raporun devrinden [^;]*; AsilPOS'taki açılış yazıldı\.(?:\s|$)/g,
  /(?:Neden \(AsilPOS\):|Açılış notu \(AsilPOS\):|Açılış AsilPOS'ta beklenenden) .*?\.(?=\s(?:Kapanış notu \(AsilPOS\):|Eksik:)|\s*$)\s?/g,
];

/** Raporun notu personele: otomatik notun açılış cümleleri çıkar; geriye bir şey kalmazsa null */
export function blindNote(note: string | null): string | null {
  if (note === null) return null;
  const out = OPENING_SENTENCES.reduce((t, re) => t.replace(re, ""), note).trim();
  return out || null;
}

/**
 * Raporun personele giden hâli: sayımın rakamları sıfır, `blind` işaretli (ekran farkı, sayılanı, açılışı, olması
 * gerekeni ve devri hiç çizmez; sıfırlar yalnız tür için). Notun açılış cümleleri çıkar
 */
export function blindReport<T extends { openingCash: number; countedCash: number; handedOver: number; cashDiff: number; note: string | null }>(r: T): T & { blind: true } {
  return { ...r, openingCash: 0, countedCash: 0, handedOver: 0, cashDiff: 0, note: blindNote(r.note), blind: true };
}

/**
 * AsilPOS'un gün sonunun personele giden hâli: açılış, sayılan ve teslim alanları ve kasa eşlemesinin bilgi satırları
 * (AsilPOS'un olması gerekeni) çıkar; Z, ödemeler, kart ekleri ve kasa hareketleri kalır
 */
export function blindAsilposDay(d: AsilposDay): AsilposDay {
  const values = { ...d.prefill.values };
  delete values.openingCash;
  delete values.countedCash;
  delete values.handedOver;
  return { ...d, prefill: { ...d.prefill, values, checks: [], missing: [] } };
}
