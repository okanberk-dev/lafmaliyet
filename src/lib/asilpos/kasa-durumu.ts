// Şubenin AsilPOS kasası kurulu mu (konsolun Şubeler ve kasalar sayfası, kasa açılışı; docs/ASILPOS.md › Şube
// kurulumu, › Kasa açılışı).
// Önce açık kayıt (integration_state `asilpos.kasa:<şube>`; kasa açılışı, kurulum kodu ve "Kasayı serbest bırak" yazar):
// varsa o geçerli. Yoksa eldeki veriden: şubenin kullanılabilen anahtarı, kurulum kodları ve son kabul edilen gün sonu.
// Tek bir eski deneme günü "kurulu" saymaya yetmez (Tuzla'nın eski deneme günü onu kilitlemesin; sahibin kararı, 28 Kasım
// 2026): kurulu = kullanılabilen anahtar VE (kullanılmış kurulum kodu ya da son 45 günde kabul edilmiş gün). Kayıtsız
// Marina (ortamdaki anahtar, yakın tarihli gün) kurulu çıkar. Bu dosya saf (tests/asil-yonetici.test.ts).

import { dayMonthYearTR } from "./switch";

/** Kabul edilmiş gün sonu bu kadar gün içinde geldiyse kasa kullanılıyor sayılır */
export const KASA_KURULU_GUN = 45;

export interface KasaKaniti {
  /** Şubenin kullanılabilen AsilPOS anahtarı var (panelde saklı ya da Marina'da ortamdaki) */
  anahtar: boolean;
  /** Şubenin kullanılmış (kasanın verdiği) kurulum kodu var */
  kodKullanildi: boolean;
  /** Bekleyen kurulum kodunun (kullanılmamış, iptal edilmemiş, süresi geçmemiş) son geçerliliği (ISO); yoksa null */
  bekleyen: string | null;
  /** Son kabul edilen gün sonu: en yeni gün (YYYY-MM-DD) ve en son geldiği an (ISO); hiç yoksa null */
  sonGun: { date: string; receivedAt: string } | null;
  /** Açık kayıt (`asilpos.kasa:<şube>`): varsa ölçütün yerine geçer; yoksa ya da bozuksa null */
  kayit?: { durum: "kurulu" | "bos" } | null;
}

export type KasaDurumu =
  | { durum: "kurulu"; sonGun: string | null; bekleyen: string | null }
  | { durum: "bekliyor"; sonGecerlilik: string }
  | { durum: "yok" };

export function kasaDurumu(k: KasaKaniti, now: Date = new Date()): KasaDurumu {
  if (k.kayit?.durum === "kurulu") return { durum: "kurulu", sonGun: k.sonGun?.date ?? null, bekleyen: k.bekleyen };
  if (k.kayit?.durum === "bos") return k.bekleyen ? { durum: "bekliyor", sonGecerlilik: k.bekleyen } : { durum: "yok" };
  const yakin = !!k.sonGun && now.getTime() - Date.parse(k.sonGun.receivedAt) <= KASA_KURULU_GUN * 86_400_000;
  if (k.anahtar && (k.kodKullanildi || yakin)) return { durum: "kurulu", sonGun: k.sonGun?.date ?? null, bekleyen: k.bekleyen };
  if (k.bekleyen) return { durum: "bekliyor", sonGecerlilik: k.bekleyen };
  return { durum: "yok" };
}

/** "12 Aralık 2026" (İstanbul saatiyle) */
export function gunMetni(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
}

/** Listede durum: "Kasa kurulu değil", "Kurulum bekliyor · son geçerlilik 12 Aralık 2026", "Kasa kurulu · son gün 27 Kasım 2026" */
export function kasaDurumMetni(d: KasaDurumu): string {
  if (d.durum === "yok") return "Kasa kurulu değil";
  if (d.durum === "bekliyor") return `Kurulum bekliyor · son geçerlilik ${gunMetni(d.sonGecerlilik)}`;
  return d.sonGun ? `Kasa kurulu · son gün ${dayMonthYearTR(d.sonGun)}` : "Kasa kurulu · henüz gün sonu gelmedi";
}

/** "Bilgisayara kur" önce bunu sorar (kurulu kasa varken); kasa kurulu değilse null */
export function yeniKurulumOnayi(d: KasaDurumu): string | null {
  if (d.durum !== "kurulu") return null;
  const gun = d.sonGun ? `son gün ${dayMonthYearTR(d.sonGun)}` : "henüz gün sonu gelmedi";
  return `Bu şubede kurulu bir kasa var (${gun}). Yeni kurulum eski kasanın yerine geçer.`;
}

/** Sunucunun onay istediğini söyleyen önek (sendBranchInstall; ekran bunu görünce onay penceresini açar) */
export const YENI_KURULUM_ONEKI = "Kurulu kasa:";
