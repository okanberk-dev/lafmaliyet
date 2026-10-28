/**
 * Muhasebeciye sorulacaklar (plan docs/planlar/vergi.md §14; Kurallar › `#sorular`). Sahip her maddeyi muhasebecisiyle
 * konuşunca "Muhasebecimle konuştum" diye işaretler; işaret sahibindir, muhasebecinin tabloyu onayladığı anlamına
 * gelmez (K34). Metinler ekranda olduğu gibi, sahibin dilindedir (tests/vergi-kurallar.test.ts). Saf modül.
 */

import type { TaxSettings } from "./settings";

export type AccountantCheckKey =
  | "sirket"
  | "sgk_oran"
  | "bordro"
  | "kira"
  | "stopaj"
  | "demirbas"
  | "gecici_2026"
  | "kafe_disi"
  | "muhtasar"
  | "kdv"
  | "fis"
  | "ikram"
  | "asgari_zarar"
  | "destek"
  | "damga"
  | "ortak"
  | "alkol_turizm"
  | "yerel";

export interface AccountantCheck {
  key: AccountantCheckKey;
  /** Plandaki numara (M1 … M18): yalnız belgeler ve testler için, ekranda yazmaz */
  code: string;
  /** Temel maddeler işaretlenmedikçe çip "Muhasebeciye sorulacaklar: n / 8" kalır */
  priority: "temel" | "ek";
  title: string;
  /** Panelin şimdi varsaydığı */
  assumed: string;
  /** Muhasebeciye sorulacak */
  ask: string;
}

export const ACCOUNTANT_CHECKS: readonly AccountantCheck[] = [
  {
    key: "sirket",
    code: "M1",
    priority: "temel",
    title: "Şirketin kuruluşu",
    assumed:
      "Hesap dönemi 25.06.2026'da başlıyor; şirketin ilk kez mi kurulduğu bilinmiyor, bu yüzden asgari kurumlar vergisi muafiyeti uygulanmıyor.",
    ask: "Şirket ilk kez mi kuruldu, yoksa birleşme, devir ya da tür değişikliğiyle mi? (2026–2028 asgari kurumlar vergisi muafiyeti buna bağlı.) laffogato.net'teki yasal bilgilerde yazan MERSİS numarası levhadaki vergi numarasıyla uyuşmuyor; hangisi doğru?",
  },
  {
    key: "sgk_oran",
    code: "M2",
    priority: "temel",
    title: "SGK oranı",
    assumed: "Vergi ve nakit planı 2026 standart oranını (işveren %19,75 + %2) kullanıyor; Ayarlar'da %15,75 yazıyor.",
    ask: "Bordroda işveren SGK oranı kaç? Emekli çalışan var mı (oranlar farklı)? 6111, 7103 gibi bir teşvikten yararlanıyor musunuz?",
  },
  {
    key: "bordro",
    code: "M3",
    priority: "temel",
    title: "Bordro",
    assumed: "2 kişi, net 30.000 ₺, net üzerinden anlaşılmış; brüt 35.314,52, gelir vergisi 0, damga 17,34; aylar tam.",
    ask: "Eylül 2026 bordrosunun brüt, gelir vergisi, damga vergisi ve SGK toplamları; işe giriş günleri; Temmuz tam ay mı? Part-time çalışan bordroda mı?",
  },
  {
    key: "kira",
    code: "M5",
    priority: "temel",
    title: "Kira",
    assumed: "Kiraya veren şirket (stopaj yok, %20 KDV). Giderler'deki 160.000 ₺ ile faturalardaki 35.000 ₺ + KDV farklı.",
    ask: "Kirayı kime ödüyoruz (şirket mi, şahıs mı), aylık gerçek kira ne, ciro kirası var mı? Kira sözleşmesinin damga vergisi (Faturalar'da 793,80 ₺) ödendi mi?",
  },
  {
    key: "stopaj",
    code: "M6",
    priority: "temel",
    title: "Stopaj",
    assumed: "Reklam, influencer ve muhasebecilik ödemelerinin stopajı bilinmiyor; muhtasar \"en az\" yazıyor.",
    ask: "Instagram reklamı (30.000 ₺/ay) Türkiye'deki bir ajansa mı, doğrudan Meta'ya mı ödeniyor? Eylül'deki 30.000 ₺'lik reklam faturası (bir şahıs adına kesilmiş) şahıs mı; internet reklamıysa %15 stopaj gerekir mi? Influencer ödemeleri (50.000 ₺/ay) serbest meslek makbuzuyla mı, influencer istisnasıyla (banka kesintisi) mı? Muhasebecilik ücreti şahıs makbuzuyla mı, şirket faturasıyla mı? Eylül muhtasarının tahakkuk fişindeki tutar?",
  },
  {
    key: "demirbas",
    code: "M7",
    priority: "temel",
    title: "Demirbaş",
    assumed:
      "XND faturaları (948.680 ₺) ve öteki demirbaşlar listede yok, amortisman 0; ModPOS lisansı (39.780 ₺) \"demirbaş olabilir\"; amortisman kalan çeyreklere eşit dağıtılıyor.",
    ask: "Hangi kısım demirbaş, hangisi kiralanan yere yapılan dekorasyon (özel maliyet, kira süresine göre)? Faydalı ömürler? Geçici vergide amortismanı nasıl dağıtıyorsunuz? ModPOS lisansı ve ışıklı tabela demirbaş mı? 12.000 ₺ altı doğrudan gider",
  },
  {
    key: "gecici_2026",
    code: "M8",
    priority: "temel",
    title: "Geçici vergi 2026",
    assumed: "2026/2 kaydı yok; 2026/3 için şirketin rakamı bilinmiyor (kafenin katkısı en çok ≈ 68.900 ₺, taslak).",
    ask: "2026/2 geçici vergi beyannamesi (17 Ağustos) verildi mi, matrahı ve vergisi? 2026/3 rakamını Kasım'ın ilk haftası isteyin (son gün 17 Kasım). Ödenen geçici vergileri Ödemeler'de \"Ödendi\" işaretleyin: ödenmeyen yıllık beyannamede mahsup edilemez.",
  },
  {
    key: "kafe_disi",
    code: "M11",
    priority: "temel",
    title: "Kafe dışı işler",
    assumed: "Kafe dışı gelir ve gider yok sayıldı.",
    ask: "Şirketin kafe dışı işleri (yazılım, karaoke box MaviBahçe, ortağın işleri) var mı, gelir ve giderleri nasıl? Eylül KDV beyannamesindeki %20'lik 335.000 ₺ satış nedir? Aylık KDV beyannamelerindeki satışların kafe dışı kısmı ne kadar?",
  },
  {
    key: "muhtasar",
    code: "M4",
    priority: "ek",
    title: "Muhtasarın dönemi",
    assumed: "Muhtasarın vergi kısmı aylık.",
    ask: "Muhtasarı 3 ayda bir mi veriyorsunuz (10 ve daha az çalışan)?",
  },
  {
    key: "kdv",
    code: "M9",
    priority: "ek",
    title: "KDV beyannameleri",
    assumed: "Devreden KDV Eylül 2026: 121.204,69 (nakit planına girildiyse); satış matrahları girilmedi.",
    ask: "Her ayın KDV beyannamesindeki devreden KDV ve satış matrahları (oran oran). Temmuz'da panelde olmayan ≈ 31.700 ₺ indirilecek KDV hangi faturalar?",
  },
  {
    key: "fis",
    code: "M10",
    priority: "ek",
    title: "Fişle yapılan alımlar",
    assumed: "Fişle yapılan alımlar KDV hariç tahminle gider sayılıyor.",
    ask: "Fişle (market, yazarkasa) yapılan alımların KDV'si indiriliyor mu? Satılan ürünün hammaddesi market fişiyle mi alınıyor; 12.000 ₺'yi aşan alımlarda fatura alınıyor mu?",
  },
  {
    key: "ikram",
    code: "M12",
    priority: "ek",
    title: "İkram ve zayi",
    assumed: "İkram, zayi ve personel tüketiminin vergi karşılığı hesaplanmıyor.",
    ask: "Bunlar vergide nasıl işleniyor?",
  },
  {
    key: "asgari_zarar",
    code: "M13",
    priority: "ek",
    title: "Asgari vergide geçmiş yıl zararı",
    assumed: "Asgari kurumlar vergisinde geçmiş yıl zararı düşülmüyor; Danıştay kararı kesinleşmedi.",
    ask: "Durum (2029'dan önce etkisi yok)",
  },
  {
    key: "destek",
    code: "M14",
    priority: "ek",
    title: "Asgari ücret desteği",
    assumed: "Asgari ücret desteği (1.269,90 ₺/kişi/ay) SGK'dan düşülmüyor.",
    ask: "SGK tahakkukunda düşülüyor mu?",
  },
  {
    key: "damga",
    code: "M15",
    priority: "ek",
    title: "Beyanname damgaları",
    assumed: "Geçici vergi beyannamesinin damgası 791 ₺; kurumlar vergisiyle bilanço ve gelir tablosu damgası 616,30 + 294,20 ₺.",
    ask: "Tutarlar doğru mu, ödeniyor mu?",
  },
  {
    key: "ortak",
    code: "M16",
    priority: "ek",
    title: "Ortaklar",
    assumed: "Binek araç, ortaklar cari hesabı, kredi yok; Alp Koç faturaları şirketin gideri sayılmıyor.",
    ask: "Alp Koç adına gelen Pruva faturaları şirkette nasıl kaydedildi (gider, KDV indirimi)? Ortaklar cari hesabı, kredi, binek araç var mı? Ortakların Bağ-Kur primi şirketten mi ödeniyor?",
  },
  {
    key: "alkol_turizm",
    code: "M17",
    priority: "ek",
    title: "Alkol ve turizm belgesi",
    assumed: "Alkollü içecek yok; turizm belgesi yok.",
    ask: "İkisi de doğru mu?",
  },
  {
    key: "yerel",
    code: "M18",
    priority: "ek",
    title: "Yerel vergiler",
    assumed: "Çevre temizlik ve ilan-reklam vergisi girilmedi; ÇTV 2. taksit 30 Kasım varsayıldı.",
    ask: "Kafenin adresi: vergi levhasında Atatürk Cad. No: 28, panelde Opera AVM yazıyor; hangisi? ÇTV için belediyeye bildirim yapıldı mı, 2026 tutarı ve taksitleri (ilk yıl)? 2026 tabelası için ilan-reklam beyannamesi tabela asılmadan önce verildi mi, ödendi mi?",
  },
];

export const ACCOUNTANT_CHECK_KEYS: readonly AccountantCheckKey[] = ACCOUNTANT_CHECKS.map((c) => c.key);

export function isAccountantCheckKey(k: string): k is AccountantCheckKey {
  return (ACCOUNTANT_CHECK_KEYS as readonly string[]).includes(k);
}

export function accountantCheck(key: AccountantCheckKey): AccountantCheck {
  return ACCOUNTANT_CHECKS.find((c) => c.key === key)!;
}

export interface CheckStatus {
  /** Temel maddelerden işaretlenen ve toplam */
  p0Done: number;
  p0Total: number;
  /** Bütün maddelerden işaretlenen ve toplam */
  done: number;
  total: number;
  /** Temel maddelerin hepsi işaretli */
  allDone: boolean;
}

export function checkStatus(settings: Pick<TaxSettings, "checks">): CheckStatus {
  const marked = (c: AccountantCheck) => Boolean(settings.checks[c.key]);
  const p0 = ACCOUNTANT_CHECKS.filter((c) => c.priority === "temel");
  const p0Done = p0.filter(marked).length;
  return { p0Done, p0Total: p0.length, done: ACCOUNTANT_CHECKS.filter(marked).length, total: ACCOUNTANT_CHECKS.length, allDone: p0Done === p0.length };
}

/** Başlıktaki çip: "Muhasebeciye sorulacaklar: 0 / 8"; temel maddeler işaretlenince sahibin işareti olduğunu söyler */
export function checksChipText(s: CheckStatus): string {
  return s.allDone ? "Muhasebecinizle gözden geçirildi (sahibin işareti)" : `Muhasebeciye sorulacaklar: ${s.p0Done} / ${s.p0Total}`;
}

/** İşaretlenen maddenin satırı: "Konuşuldu · Ayşe · 24.10.2026 · not" */
export function checkDoneText(mark: { by: string; date: string; note: string | null }): string {
  return ["Konuşuldu", mark.by, mark.date.split("-").reverse().join("."), mark.note].filter(Boolean).join(" · ");
}
