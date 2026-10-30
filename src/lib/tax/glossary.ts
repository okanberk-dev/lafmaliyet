import { monthName, parseQuarter } from "./calendar";
import type { TaxCalendarRow } from "./view";

/*
 * Vergi ekranlarının sözlüğü (docs/planlar/ux-sade.md §7.11, K17): sade söz önce, resmî terim parantezde. Ekrandaki
 * sözler `calendarTitle`, `PLAIN_LABELS`, `badgeLabel` / `badgeNote` ve `plainBadge`'den; `TERMS` başvuru tablosudur,
 * tanımları ⓘ'de henüz çizilmiyor (ux-sade Ek C). Yalnız çizim: veri (`titleOfKind`, `row.badge`, kartların `rows`
 * etiketleri) ve Excel dışa aktarımı resmî adla kalır, muhasebeciye o gider. Yalnız yöneticinin vergi ekranları içe
 * aktarır (Nakit planı KDV kartı değil); personel dosyaları da değil. Saf.
 */

export interface Term {
  /** Ekranda ilk geçtiği yerde yazılan: "sade söz (resmî terim)" */
  screen: string;
  /** ⓘ tanımı; yoksa null */
  definition: string | null;
}

/** Resmî terim → ekranda ve ⓘ'de */
export const TERMS: Readonly<Record<string, Term>> = {
  "Hesaplanan KDV": { screen: "Satışlarda topladığınız KDV", definition: "Müşteriden alıp devlete ödediğiniz KDV" },
  "İndirilecek KDV": { screen: "Alışlarda ödediğiniz KDV", definition: "Satışların KDV'sinden düşülür" },
  "Devreden KDV": { screen: "Önceki aylardan kalan KDV (devreden)", definition: "Alışların KDV'si satışlarınkini aşınca sonraki aya geçer" },
  Muhtasar: { screen: "Maaş vergileri ve stopaj (muhtasar)", definition: "Maaştan ve bazı ödemelerden kesip devlete ödediğiniz vergiler" },
  Stopaj: { screen: "Vergi kesintisi (stopaj)", definition: "Kira, serbest meslek gibi ödemelerden sizin kesip yatırdığınız vergi" },
  "Tahakkuk fişi": { screen: "Ödeme belgesi (tahakkuk fişi)", definition: "Muhasebecinin beyannameden sonra verdiği, ödenecek tutarı yazan belge" },
  "Beyanname damgası": { screen: "Beyanname ücreti (damga vergisi)", definition: "Her beyannamede ödenen sabit tutar" },
  "Geçici vergi": { screen: "Kâr vergisi peşinatı (geçici vergi)", definition: "3 ayda bir ödenir, yıl sonunda kurumlar vergisinden düşülür" },
  "Kurumlar vergisi": { screen: "Yıllık kâr vergisi (kurumlar vergisi)", definition: "Nisan'da ödenir; peşinatlar düşülür" },
  Mahsup: { screen: "Düşülür (mahsup)", definition: null },
  Matrah: { screen: "Vergi hesabındaki kâr (matrah)", definition: "Verginin hesaplandığı tutar" },
  "Kurum kazancı (kümülatif)": { screen: "Yılbaşından beri kâr (kurum kazancı)", definition: null },
  Amortisman: { screen: "Demirbaş payı (amortisman)", definition: "Demirbaşın bedeli yıllara bölünerek gider yazılır" },
  "Faydalı ömür": { screen: "Kaç yıl kullanılacak (faydalı ömür)", definition: null },
  "Özel maliyet": { screen: "Kiralık yere yapılan tadilat (özel maliyet)", definition: "Kira süresine bölünerek gider yazılır" },
  Tevkifat: { screen: "Faturadaki KDV'nin sizin ödediğiniz kısmı (tevkifat)", definition: null },
  "Sınıflandırılmamış gider": { screen: "Belgesi seçilmemiş gider", definition: null },
  "Yönetim verisi (ModPOS)": { screen: "Kasa programının rakamı ({kasa})", definition: "Resmî belge değil" },
  Taslak: { screen: "Eksik bilgi", definition: "Sebebi yanında yazar" },
};

/** KDV-2 satırı açılınca ilk not: tevkifatın sade anlamı (§7.5) */
export const KDV2_NOTE = "Faturadaki KDV'nin sizin ödediğiniz kısmı (tevkifat) ve yurt dışı hizmetin KDV'si.";

/** Takvim satırının sade adı (§7.5): "KDV (Ekim satışları)", "SGK primi (Eylül maaşları)" … Veri ve Excel resmî adla kalır */
export function calendarTitle(row: Pick<TaxCalendarRow, "kind" | "period" | "title">): string {
  switch (row.kind) {
    case "kdv1":
      return `KDV (${monthName(row.period)} satışları)`;
    case "kdv2":
      return row.title;
    case "mphb":
      return `Maaş vergileri ve stopaj (muhtasar, ${monthName(row.period)})`;
    case "sgk":
      return `SGK primi (${monthName(row.period)} maaşları)`;
    case "gecici": {
      const q = parseQuarter(row.period);
      return q ? `Kâr vergisi peşinatı: ${q.q}. çeyrek ${q.year} (geçici vergi)` : row.title;
    }
    case "kv":
      return `Yıllık kâr vergisi ${row.period} (kurumlar vergisi)`;
    case "ctv": {
      const [year, part] = row.period.split("-");
      return part ? `Çevre temizlik vergisi (ÇTV) ${year}, ${part}. taksit` : row.title;
    }
    case "yerel":
      return "Tabela vergisi (ilan ve reklam vergisi)";
  }
}

/** Döküm etiketlerinin sade hâli (§7.5, §7.6); bilinmeyen etiket olduğu gibi */
const PLAIN_LABELS: Readonly<Record<string, string>> = {
  "Kümülatif kurum kazancı": "Yılbaşından beri kâr (kurum kazancı)",
  "Önceki dönemler": "Önceki peşinatlar",
  "Kafenin katkısı": "Kafenin payı",
  "Kafenin katkısı (yalnız kafe)": "Kafenin payı (yalnız kafe)",
  "Beyanname damgası": "Beyanname ücreti (damga vergisi)",
  Matrah: "Vergi hesabındaki kâr (matrah)",
  Hesaplanan: "Hesaplanan vergi",
  "Mahsup edilecek geçici vergi (yalnız ödendi işaretli)": "Düşülecek peşinat (mahsup; yalnız ödendi işaretli)",
  "İade / mahsup alacağı": "Fazla ödenen (iade ya da mahsup)",
  "KDV (nakit planı)": "Bu ayın KDV'si (tahmin)",
  // Kartın "Nasıl hesaplandı" dökümü (§7.6)
  "Dönemin sonucu (amortisman öncesi)": "Kâr (demirbaş payı düşülmeden)",
  Amortisman: "Demirbaş payı (amortisman)",
  "Dönem kazancı": "Bu çeyreğin kârı (dönem kazancı)",
};

export function plainLabel(label: string): string {
  return PLAIN_LABELS[label] ?? label;
}

export type BadgeTone = "green" | "amber" | "gray";

/**
 * Takvim satırının rozeti (K16): "Muhasebeciden" (yeşil), "Eksik bilgi" (turuncu, eski "Taslak"), "yalnız damga" (gri,
 * eski "sabit tutar"). "Ödemeler'de" ve "2026 kuralları" rozet değil, satırın alt satırında söz (`badgeNote`). Veri
 * (`row.badge`) aynı
 */
export function badgeLabel(badge: string | null): { label: string; tone: BadgeTone } | null {
  if (badge === "Muhasebeci") return { label: "Muhasebeciden", tone: "green" };
  if (badge === "Taslak") return { label: "Eksik bilgi", tone: "amber" };
  if (badge === "sabit tutar") return { label: "yalnız damga", tone: "gray" };
  return null;
}

/**
 * Rozeti kalkan kaynağın alt satırdaki sözü: "Ödemeler'deki tutar"; "2026 kuralları" o yılın tutarları açıklanmadı
 * demek, SGK'da bordro kuralları, ötekilerde beyanname damgası
 */
export function badgeNote(badge: string | null, kind?: TaxCalendarRow["kind"]): string | null {
  if (badge === "Ödemeler'de") return "Ödemeler'deki tutar";
  if (badge === "2026 kuralları") return kind === "sgk" ? "geçen yılın kurallarıyla" : "geçen yılın damga tutarıyla";
  return null;
}

/**
 * Vergi kârı tablosunun esas rozeti (U17): yönetim verisi uyarı değil, kaynaktır. "Yönetim verisi (ModPOS), mali belge
 * değil" → "Kasa programının rakamı (ModPOS), resmî belge değil"; öteki rozetler aynen
 */
export function plainBadge(badge: string): string {
  const m = /^Yönetim verisi \((.+)\), mali belge değil$/.exec(badge);
  return m ? `Kasa programının rakamı (${m[1]}), resmî belge değil` : badge;
}

/** Esas rozetinin tonu: mali belge yeşil, gerisi gri (yönetim verisi artık turuncu değil, U17) */
export function plainBadgeTone(badge: string): "green" | "gray" {
  return badge.startsWith("mali belge") ? "green" : "gray";
}
