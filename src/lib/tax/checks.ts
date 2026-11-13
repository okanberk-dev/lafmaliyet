/**
 * Muhasebeciye sorulacaklar (plan docs/planlar/vergi.md §14; Kurallar › `#sorular`). Sahip her maddeyi muhasebecisiyle
 * konuşunca "Muhasebecimle konuştum" diye işaretler; işaret sahibindir, muhasebecinin tabloyu onayladığı anlamına
 * gelmez (K34). Metinler ekranda olduğu gibi, sahibin dilindedir (tests/vergi-kurallar.test.ts). "Panelin varsaydığı"
 * panelin kuralını söyler, verinin o günkü rakamını değil; ayara bağlı cümleler şimdiki ayarlardan kurulur
 * (`accountantChecksFor`; denetim VG-05). Saf modül.
 */

import { money, num } from "../format";

import { QUARTER_DEPRECIATION_LABELS } from "./assets";
import { minTaxApplies } from "./corporate";
import { rulesFor } from "./rules";
import type { TaxSettings } from "./settings";
import { geciciStamp, kvStamps } from "./stamp";

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
    assumed: "Şirketin ilk kez mi kurulduğu işaretlenmedi; asgari kurumlar vergisi muafiyeti uygulanmıyor.",
    ask: "Şirket ilk kez mi kuruldu, yoksa birleşme, devir ya da tür değişikliğiyle mi? (2026–2028 asgari kurumlar vergisi muafiyeti buna bağlı.) laffogato.net'teki yasal bilgilerde yazan MERSİS numarası levhadaki vergi numarasıyla uyuşmuyor; hangisi doğru?",
  },
  {
    key: "sgk_oran",
    code: "M2",
    priority: "temel",
    title: "SGK oranı",
    assumed: "Vergi ve nakit planı yasal oranı (işveren %19,75 + işsizlik %2) kullanıyor.",
    ask: "Bordroda işveren SGK oranı kaç? Emekli çalışan var mı (oranlar farklı)? 6111, 7103 gibi bir teşvikten yararlanıyor musunuz?",
  },
  {
    key: "bordro",
    code: "M3",
    priority: "temel",
    title: "Bordro",
    assumed: "Personel'deki maaş net sayılıyor (net üzerinden anlaşılmış); brüt, gelir ve damga vergisi yasal oranlarla bulunuyor. İşe giriş günü bilinmediği için aylar tam.",
    ask: "Eylül 2026 bordrosunun brüt, gelir vergisi, damga vergisi ve SGK toplamları; işe giriş günleri; Temmuz tam ay mı? Part-time çalışan bordroda mı?",
  },
  {
    key: "kira",
    code: "M5",
    priority: "temel",
    title: "Kira",
    assumed: "Kira kalemindeki seçime göre: şahsa kirada stopaj muhtasarda, şirkete kirada stopaj yok, faturada KDV. Resmi kira girildiyse stopaj resmi brütten.",
    ask: "Kirayı kime ödüyoruz (şirket mi, şahıs mı), aylık gerçek kira ne, ciro kirası var mı? Kira sözleşmesinin damga vergisi (Faturalar'da 793,80 ₺) ödendi mi?",
  },
  {
    key: "stopaj",
    code: "M6",
    priority: "temel",
    title: "Stopaj",
    assumed: "Vergi kesintisi (stopaj) seçilmemiş kira, reklam ve dışarıdan hizmet kalemlerinin stopajı bilinmiyor; o ayın muhtasarı \"en az\" yazıyor.",
    ask: "Instagram reklamı (30.000 ₺/ay) Türkiye'deki bir ajansa mı, doğrudan Meta'ya mı ödeniyor? Eylül'deki 30.000 ₺'lik reklam faturası (bir şahıs adına kesilmiş) şahıs mı; internet reklamıysa %15 stopaj gerekir mi? Influencer ödemeleri (50.000 ₺/ay) serbest meslek makbuzuyla mı, influencer istisnasıyla (banka kesintisi) mı? Muhasebecilik ücreti şahıs makbuzuyla mı, şirket faturasıyla mı? Eylül muhtasarının tahakkuk fişindeki tutar?",
  },
  {
    key: "demirbas",
    code: "M7",
    priority: "temel",
    title: "Demirbaş",
    assumed:
      "Yalnız Demirbaş listesindekilerin amortismanı sayılıyor; listeye eklenmemiş Kuruluş & Demirbaş faturaları gider de sayılmıyor. \"Demirbaş olabilir\" faturalar seçilene kadar sayılmıyor. Geçici vergide amortisman kalan çeyreklere eşit.",
    ask: "Hangi kısım demirbaş, hangisi kiralanan yere yapılan dekorasyon (özel maliyet, kira süresine göre)? Faydalı ömürler? Geçici vergide amortismanı nasıl dağıtıyorsunuz? ModPOS lisansı ve ışıklı tabela demirbaş mı? 12.000 ₺'ye kadar olanları doğrudan gider yazıyor musunuz?",
  },
  {
    key: "gecici_2026",
    code: "M8",
    priority: "temel",
    title: "Geçici vergi 2026",
    assumed: "Muhasebecinin rakamı girilmeyen çeyrekte kafenin katkısı tahmin; şirketin geçici vergisi muhasebecinin beyannamesinde. Yıllık kurumlar vergisinde yalnız \"Ödendi\" işaretli geçici vergi düşülüyor.",
    ask: "2026/2 geçici vergi beyannamesi (17 Ağustos) verildi mi, matrahı ve vergisi? 2026/3 rakamını Kasım'ın ilk haftası isteyin (son gün 17 Kasım). Ödenen geçici vergileri Ödemeler'de \"Ödendi\" işaretleyin: ödenmeyen yıllık beyannamede mahsup edilemez.",
  },
  {
    key: "kafe_disi",
    code: "M11",
    priority: "temel",
    title: "Kafe dışı işler",
    assumed: "Kafe dışı gelir ve gider, Vergi kârı'na düzeltme olarak girilmedikçe yok sayılıyor; kafe dışı faturalar (Karaoke box, Alp Koç) hesaba katılmıyor.",
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
    assumed: "Devreden KDV, nakit planına muhasebecinin rakamı girildiyse ondan, yoksa panelin kendi hesabından; satış matrahı girilmeyen ayda satışlar kasa ve laffogato.net verisinden.",
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
    ask: "Danıştay kararından sonra asgari kurumlar vergisinde geçmiş yıl zararını düşüyor musunuz? (Devreden zarar olan yılda etkisi var.)",
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
    assumed: "Binek araç, ortaklar cari hesabı, kredi yok sayıldı; Alp Koç faturaları şirketin gideri sayılmıyor.",
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
    assumed: "Çevre temizlik ve ilan-reklam vergisi Ödemeler'deki hatırlatıcılardan; ÇTV hatırlatıcısı yoksa taksitler (Mayıs ve Kasım sonu) tutarsız yazılıyor.",
    ask: "Kafenin adresi: vergi levhasında Atatürk Cad. No: 28, panelde Opera AVM yazıyor; hangisi? ÇTV için belediyeye bildirim yapıldı mı, 2026 tutarı ve taksitleri (ilk yıl)? 2026 tabelası için ilan-reklam beyannamesi tabela asılmadan önce verildi mi, ödendi mi?",
  },
];

export const ACCOUNTANT_CHECK_KEYS: readonly AccountantCheckKey[] = ACCOUNTANT_CHECKS.map((c) => c.key);

/** "Panelin varsaydığı"nın ayara bağlı cümlelerinin girdisi */
export interface CheckContext {
  settings: Pick<TaxSettings, "periodStart" | "firstActivity" | "quarterDepreciation" | "muhtasarQuarterly" | "minWageSupport" | "includeSeparate" | "overrides">;
  /** Kuralların yılı bugünden */
  today: string;
  /** Gelir-gider'in Ayarlar'daki işveren SGK oranı; okunmadıysa yok (cümle yazmaz) */
  settingsEmployerRate?: number;
}

const pct = (x: number) => `%${num(Math.round(x * 10_000) / 100, 0, 2)}`;
const dmy = (d: string) => d.split("-").reverse().join(".");

/**
 * Maddeler, ayara bağlı cümleleri şimdiki ayarlardan kurulmuş (VG-05): şirketin kuruluşu ve hesap dönemi, SGK oranları
 * (elle değerle; Ayarlar'daki oran farklıysa söyler), amortismanın dağıtımı, kafe dışı faturalar, muhtasarın dönemi,
 * asgari ücret desteği ve beyanname damgaları (yılın kural tablosundan). Sorusu da ayara göre olan madde: asgari vergide
 * geçmiş yıl zararı (muaf yıllarda etkisi yok)
 */
export function accountantChecksFor(ctx: CheckContext): AccountantCheck[] {
  const { settings: st } = ctx;
  const year = Number(ctx.today.slice(0, 4));
  const { rules } = rulesFor(year, st.overrides);
  const start = Number(st.periodStart.slice(0, 4));
  const muafTo = start + rules.kv.asgariMuafDonem.value - 1;
  const muaf = !minTaxApplies(year, st, rules.kv.asgariMuafDonem.value);
  const derived: Partial<Record<AccountantCheckKey, Partial<Pick<AccountantCheck, "assumed" | "ask">>>> = {
    sirket: {
      assumed: `Hesap döneminin başı ${dmy(st.periodStart)}; ${
        st.firstActivity === "ilk"
          ? `şirket ilk kez kuruldu diye işaretli: asgari kurumlar vergisi ${start}–${muafTo} uygulanmıyor.`
          : st.firstActivity === "devir"
            ? "şirket birleşme, devir ya da tür değişikliğiyle kuruldu diye işaretli: asgari kurumlar vergisi muafiyeti yok."
            : "şirketin ilk kez mi kurulduğu işaretlenmedi, bu yüzden asgari kurumlar vergisi muafiyeti uygulanmıyor."
      }`,
    },
    sgk_oran: (() => {
      const rate = rules.sgk.isverenOran.value;
      const own = ctx.settingsEmployerRate;
      const tail = own === undefined ? "" : Math.abs(own - rate) > 1e-9 ? ` Gelir-gider ise Ayarlar'daki oranı kullanıyor (${pct(own)}).` : " Ayarlar'daki oran da aynı.";
      return { assumed: `Vergi ve nakit planı işveren SGK ${pct(rate)} + işsizlik ${pct(rules.sgk.isverenIssizlik.value)} kullanıyor.${tail}` };
    })(),
    demirbas: {
      assumed: `Yalnız Demirbaş listesindekilerin amortismanı sayılıyor; listeye eklenmemiş Kuruluş & Demirbaş faturaları gider de sayılmıyor. "Demirbaş olabilir" faturalar seçilene kadar sayılmıyor. Geçici vergide amortisman: ${QUARTER_DEPRECIATION_LABELS[st.quarterDepreciation].toLocaleLowerCase("tr-TR")}.`,
      ask: `Hangi kısım demirbaş, hangisi kiralanan yere yapılan dekorasyon (özel maliyet, kira süresine göre)? Faydalı ömürler? Geçici vergide amortismanı nasıl dağıtıyorsunuz? ModPOS lisansı ve ışıklı tabela demirbaş mı? ${money(rules.vuk.dogrudanGider.value)}'ye kadar olanları doğrudan gider yazıyor musunuz?`,
    },
    kafe_disi: {
      assumed: `Kafe dışı gelir ve gider, Vergi kârı'na düzeltme olarak girilmedikçe yok sayılıyor; kafe dışı faturalar (Karaoke box, Alp Koç) hesaba ${st.includeSeparate ? "katılıyor" : "katılmıyor"}.`,
    },
    muhtasar: { assumed: st.muhtasarQuarterly ? "Muhtasarın vergi kısmı üç ayda bir (Mart, Haziran, Eylül ve Aralık'ın beyannamesiyle)." : "Muhtasarın vergi kısmı aylık." },
    asgari_zarar: {
      ask: `Danıştay kararından sonra asgari kurumlar vergisinde geçmiş yıl zararını düşüyor musunuz? (${muaf && st.firstActivity === "ilk" ? `${muafTo + 1}'dan önce etkisi yok: ${start}–${muafTo} asgari vergi uygulanmıyor.` : "Devreden zarar olan yılda etkisi var."})`,
    },
    destek: {
      assumed: `Asgari ücret desteği (kişi başı ayda ${money(Math.round(rules.sgk.asgariUcretDestegi.value * 30 * 100) / 100)}) ${st.minWageSupport ? "SGK'dan düşülüyor; vergi kârındaki personel giderinden de." : "SGK'dan düşülmüyor."}`,
    },
    ortak: {
      assumed: `Binek araç, ortaklar cari hesabı, kredi yok sayıldı; Alp Koç faturaları şirketin gideri ${st.includeSeparate ? "sayılıyor (kafe dışı faturalar hesapta)" : "sayılmıyor"}.`,
    },
    damga: (() => {
      const g = geciciStamp(`${year}-Q1`, st.overrides).amount;
      const k = kvStamps(year - 1, st.overrides);
      return { assumed: `Geçici vergi beyannamesinin damgası ${money(g)}; kurumlar vergisi beyannamesininki ${money(k.beyanname)}, bilanço ve gelir tablosununki ${money(k.bilanco)} + ${money(k.gelirTablosu)}.` };
    })(),
  };
  return ACCOUNTANT_CHECKS.map((c) => ({ ...c, ...derived[c.key] }));
}

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
