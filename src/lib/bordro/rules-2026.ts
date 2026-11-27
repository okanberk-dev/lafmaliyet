/**
 * 2026 bordro ve stopaj kuralları (eski Vergi bölümünün kural tablosundan; değerler resmî kaynakların ve vergi
 * bültenlerinin özetlerinden 24.10.2026'da derlendi, 28.10.2026'da yeniden karşılaştırıldı). Her kaynak https; resmî olan
 * önce. Yeni yıl: rules-2027.ts, PAYROLL_RULES'a eklenir, tests/bordro.test.ts güncellenir; eklenmezse 2027 bu
 * değerlerle hesaplanır (tahmini).
 */

import type { PayrollYearRules, RuleSource } from "./rules";

const S = {
  gvk: { label: "Mevzuat · GVK (193)", url: "https://www.mevzuat.gov.tr/mevzuatmetin/1.4.193.pdf" },
  dvk: { label: "Mevzuat · Damga Vergisi Kanunu (488)", url: "https://www.mevzuat.gov.tr/mevzuatmetin/1.5.488.pdf" },
  sgkKanun: { label: "Mevzuat · 5510 sayılı Kanun", url: "https://www.mevzuat.gov.tr/MevzuatMetin/1.5.5510.pdf" },
  rgAsgari: { label: "Resmî Gazete · Asgari ücret kararı", url: "https://www.resmigazete.gov.tr/eskiler/2025/12/20251226-6.pdf" },
  csgbAsgari: {
    label: "ÇSGB · 2026 asgari ücret",
    url: "https://www.csgb.gov.tr/haberler/2026-yilinda-gecerli-olacak-yeni-asgari-ucret-28-bin-75-lira-olarak-belirlendi/",
  },
  gibTarife: {
    label: "GİB · Gelir vergisi tarifesi 2026",
    url: "https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Fyardim-kaynaklar%2Fyararli-bilgiler%2Fgelir-vergisi-tarifeleri%2Fgelir-vergisi-tarifesi-2026.pdf",
  },
  rg31Aralik: { label: "Resmî Gazete 31.12.2025 (5. mük.)", url: "https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M5.htm" },
  gibUcret: {
    label: "GİB · Ücret geliri rehberi 2026",
    url: "https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Ffileadmin%2Fbeyannamerehberi%2F2026%2F2026_Ucret_Geliri.pdf",
  },
  sgkPek: {
    label: "SGK · Prime esas kazanç miktarları",
    url: "https://www.sgk.gov.tr/Content/Post/2e0c9e1a-2cfe-4456-af10-49d3de0c58ba/Prime-Esas-Kazanc-Miktarlari-2026-01-14-10-35-39",
  },
  sgkOranlar: {
    label: "SGK · İşveren prim oranları",
    url: "https://www.sgk.gov.tr/Content/Post/c7812ea8-5087-413f-aeb5-d3c1d153e11a/Isveren-Prim-Oranlari-2026-01-13-04-52-38",
  },
  sgkTesvik: {
    label: "SGK · Güncel teşvik, destek ve indirimler",
    url: "https://www.sgk.gov.tr/Content/Post/c52f99f0-da6c-4029-9b9a-a0d6f96a6a42/Guncel-Sigorta-Primi-Tesvik-Destek-ve-Indirimleri-2026-01-12-03-04-11",
  },
  sgkTesvik2026: {
    label: "SGK · Sigorta primi teşvikleri 2026",
    url: "https://sgk.gov.tr/Download/DownloadFile?f=c94c643d-2190-4d85-9b14-a8c7c5d241e8.pdf&d=de85036d-ef64-49f1-834c-916a79f1a923",
  },
  sgkGenelge2026_8: { label: "SGK Genelgesi 2026/8 (kopya)", url: "https://www.alomaliye.com/wp-content/uploads/2026/03/sgk-genelgesi-2026-8.pdf" },
  kpmgDestek: {
    label: "KPMG · Asgari ücret desteği",
    url: "https://kpmgvergi.com/yayinlar/mali-bultenler/sosyal-guvenlik/asgari-ucret-destegi-ve-en-dusuk-emekli-ayligi-hk/3463",
  },
  gibSerbest: {
    label: "GİB · Serbest meslek kazancı rehberi 2026",
    url: "https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=arsiv%2Ffileadmin%2Fbeyannamerehberi%2F2026%2F2026_Serbest_Meslek_Kazanci.pdf",
  },
  cbk476: { label: "Muhasebetr · 476 s. CBK", url: "https://www.muhasebetr.com/yazarlarimiz/alidurmaz/005" },
  turmobReklam: { label: "TÜRMOB · İnternet reklam kesintisi", url: "https://turmob.org.tr/ekutuphane/Read/acf2483b-2ccc-49c1-abe0-7bac62d0cf69" },
} satisfies Record<string, RuleSource>;

const D = "2026-01-01";

/** Asgari ücret istisnası, ay ay (GVK 23/18): asgari GV matrahının kümülatif tarife farkı; payroll.ts aynısını türetir */
const MIN_WAGE_EXEMPTION_2026 = [4211.33, 4211.33, 4211.33, 4211.33, 4211.33, 4211.33, 4537.75, 5615.1, 5615.1, 5615.1, 5615.1, 5615.1];

export const RULES_2026: PayrollYearRules = {
  year: 2026,
  ucret: {
    asgariBrut: {
      key: "ucret.asgariBrut",
      title: "Asgari ücret (brüt, aylık)",
      value: 33030,
      basis: "Asgari Ücret Tespit Komisyonu kararı, RG 26.12.2025 (33119)",
      sources: [S.rgAsgari, S.csgbAsgari],
      confidence: "kesin",
      appliesFrom: D,
      note: "Günlük 1.101,00 ₺. Asgari net 28.075,50 ₺; asgari gelir vergisi matrahı 28.075,50 ₺.",
    },
    tarife: {
      key: "ucret.tarife",
      title: "Gelir vergisi tarifesi (ücret)",
      value: [
        { upTo: 190000, rate: 0.15 },
        { upTo: 400000, rate: 0.2 },
        { upTo: 1500000, rate: 0.27 },
        { upTo: 5300000, rate: 0.35 },
        { upTo: null, rate: 0.4 },
      ],
      basis: "GVK m.103; 332 Seri No GVGT (RG 31.12.2025, 33124 5. mük.)",
      sources: [S.gibTarife, S.rg31Aralik],
      confidence: "kesin",
      appliesFrom: D,
      note: "Kümülatif vergi 28.500 / 70.500 / 367.500 / 1.697.500 ₺.",
    },
    damgaOrani: {
      key: "ucret.damgaOrani",
      title: "Ücretin damga vergisi",
      value: 0.00759,
      basis: "DVK (1) sayılı tablo IV-1-b; (2) sayılı tablo (7349 s. K.)",
      sources: [S.gibUcret, S.dvk],
      confidence: "kesin",
      appliesFrom: D,
      note: "Asgari ücrete isabet eden kısım istisna: 250,70 ₺/ay.",
    },
    asgariIstisna: {
      key: "ucret.asgariIstisna",
      title: "Asgari ücret gelir vergisi istisnası",
      value: MIN_WAGE_EXEMPTION_2026,
      basis: "GVK m.23/18",
      sources: [S.gibUcret, S.gvk],
      confidence: "kesin",
      appliesFrom: D,
      note: "Ay ay türetilir: asgari gelir vergisi matrahının o aya kadarki kümülatif tarife farkı.",
    },
  },
  sgk: {
    pek: {
      key: "sgk.pek",
      title: "Prime esas kazanç alt ve üst sınırı",
      value: { alt: 33030, ust: 297270 },
      basis: "5510 m.82 (7566 s. K.)",
      sources: [S.sgkPek],
      confidence: "kesin",
      appliesFrom: D,
    },
    isciOran: {
      key: "sgk.isciOran",
      title: "SGK işçi payı",
      value: 0.14,
      basis: "5510 m.81",
      sources: [S.sgkOranlar, S.sgkKanun],
      confidence: "kesin",
      appliesFrom: D,
      note: "Malullük, yaşlılık ve ölüm %9 + genel sağlık %5.",
    },
    isciIssizlik: {
      key: "sgk.isciIssizlik",
      title: "İşsizlik sigortası işçi payı",
      value: 0.01,
      basis: "4447 m.49; 5510 m.81",
      sources: [S.sgkOranlar],
      confidence: "kesin",
      appliesFrom: D,
    },
    isverenOran: {
      key: "sgk.isverenOran",
      title: "SGK işveren payı (Hazine indirimiyle)",
      value: 0.1975,
      basis: "5510 m.81 (7566 s. K. m.23: işveren malullük, yaşlılık ve ölüm payı %12); 5510 m.81/1-(ı); SGK Genelgesi 2026/1",
      sources: [S.sgkOranlar, S.sgkTesvik, S.sgkTesvik2026],
      confidence: "kesin",
      appliesFrom: D,
      note: "%21,75 − imalat dışı işyerinde 2 puan Hazine indirimi. İndirim primler süresinde ödenir ve vadesi geçmiş borç yoksa uygulanır; işyerinin ek teşviki bilinmiyor.",
      overridable: true,
      overrideMax: 0.2175,
    },
    isverenIssizlik: {
      key: "sgk.isverenIssizlik",
      title: "İşsizlik sigortası işveren payı",
      value: 0.02,
      basis: "4447 m.49; 5510 m.81",
      sources: [S.sgkOranlar],
      confidence: "kesin",
      appliesFrom: D,
    },
    asgariUcretDestegi: {
      key: "sgk.asgariUcretDestegi",
      title: "Asgari ücret desteği",
      value: 42.33,
      basis: "5510 geç. m.112 (7573 s. K. m.8, RG 29.01.2026, 33152); SGK Genelgesi 2026/8 (05.03.2026)",
      sources: [S.sgkTesvik2026, S.sgkGenelge2026_8, S.kpmgDestek],
      confidence: "muhtemel",
      appliesFrom: D,
      note: "Yalnız saklı bordro ayarında (eski Vergi › Muhasebeci) \"Asgari ücret desteği SGK'dan düşülsün\" açıksa düşülür; emekli çalışanda yok.",
    },
  },
  stopaj: {
    kira: {
      key: "stopaj.kira",
      title: "Kira stopajı (gerçek kişiye işyeri kirası)",
      value: 0.2,
      basis: "GVK m.94/5-a; BKK 2009/14592",
      sources: [S.gvk],
      confidence: "kesin",
      appliesFrom: D,
      note: "Brüt kira üzerinden. Konut kirası ve şirkete ödenen kira kesintisizdir.",
    },
    serbestMeslek: {
      key: "stopaj.serbestMeslek",
      title: "Serbest meslek stopajı",
      value: 0.2,
      basis: "GVK m.94/2-b",
      sources: [S.gibSerbest, S.gvk],
      confidence: "kesin",
      appliesFrom: D,
      note: "Serbest meslek makbuzuyla ödenen tutardan.",
    },
    internetReklam: {
      key: "stopaj.internetReklam",
      title: "İnternet reklamı stopajı",
      value: 0.15,
      basis: "GVK m.94; KVK m.15, m.30; CBK 476 (RG 19.12.2018, 30630)",
      sources: [S.cbk476, S.turmobReklam],
      confidence: "muhtemel",
      appliesFrom: D,
      note: "İnternet reklam hizmeti veren ya da aracılık eden gerçek kişiye ve dar mükellef kuruma (ör. Meta); tam mükellef Türk şirketine kesinti yok. Resmî metin okunmadı.",
    },
  },
};
