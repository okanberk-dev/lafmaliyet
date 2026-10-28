import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import type { WaterCost } from "@/lib/calc/engine";
import type { Ingredient } from "@/lib/calc/types";
import { money, monthLabel, num } from "@/lib/format";
import { activeUses } from "@/lib/ingredient-usage";

import { sortCategories } from "./categories";

export { activeUses };

/**
 * Hammaddeler'deki özet kartlarının dökümü (karta dokununca açılan pencere). Saf fonksiyonlar: sayfa sunucuda
 * zaten yüklediği satırlardan ve modelden kurar. Sayılar kartla aynı kuraldan: aktif malzemeler; tahmini =
 * `isEstimate`, reçetede yok = hiçbir aktif ürünün reçetesinde geçmiyor (activeUses 0; yalnız pasif ürünlerin
 * kullandığı malzeme de "reçetede yok", denetim E-58).
 */

/** Liste kartının çapası: dökümdeki bağlantı süzülmüş listeye kayar (telefonda liste kartların çok altında) */
export const LIST_ID = "hammadde-listesi";

/** Hammadde listesine inen bağlantı; süzgeçler adreste (liste istemcide okur) */
export function listHref(filters: { durum?: "tahmini" | "kullanilmayan" | "pasif"; kategori?: string; ara?: string }): string {
  const q = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  return `/panel/hammaddeler?${q}#${LIST_ID}`;
}

/** Dökümün kullandığı malzeme alanları (sayfadaki `IngredientRow` bunu karşılar) */
export type DokumIngredient = Pick<Ingredient, "id" | "name" | "category" | "active" | "isEstimate" | "note" | "packagePrice" | "packageSize" | "unit" | "priceSource"> & {
  /** Reçetesinde geçtiği ürün kartları, pasif ürünler dahil (`active` false) */
  usedIn: readonly { active: boolean }[];
};

export interface IngredientBreakdowns {
  /** Hammadde kartı: aktif malzemeler kategori kategori; pasifler ayrı, toplama girmez */
  all: BreakdownGroup[];
  /** Tahmini değer kartı: kategori altında tek tek malzemeler (paket fiyatı, not) */
  estimates: BreakdownGroup[];
  /** Hiçbir reçetede yok kartı: kategori altında tek tek malzemeler */
  unused: BreakdownGroup[];
}

const parts = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" · ") || undefined;
/** Uzun not pencereyi uzatmasın (listede de iki satırla kesilir) */
const clip = (s: string | null, max = 140) => {
  const t = s?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const packageText = (i: DokumIngredient) => (i.priceSource === "water" ? null : `Paket ${num(i.packageSize, 3)} ${i.unit}`);
/** Kalemin değeri: paket fiyatı (KDV hariç); su ve buzun fiyatı su faturasından gelir */
const priceDisplay = (i: DokumIngredient) => (i.priceSource === "water" ? "Su faturasından" : money(i.packagePrice));

/** Kategori kategori, kategoride malzeme malzeme; her malzeme 1 sayılır (bölüm başlığında kategorideki sayı) */
function perIngredient(items: DokumIngredient[], durum: "tahmini" | "kullanilmayan", sub: (i: DokumIngredient) => string | undefined): BreakdownGroup[] {
  return sortCategories(items.map((i) => i.category)).map((c) => ({
    key: c,
    label: c,
    rows: items
      .filter((i) => i.category === c)
      .map((i): BreakdownRow => ({ key: String(i.id), label: i.name, sub: sub(i), amount: 1, display: priceDisplay(i), href: listHref({ durum, ara: i.name }) })),
  }));
}

export function ingredientBreakdowns(items: DokumIngredient[]): IngredientBreakdowns {
  const active = items.filter((i) => i.active);
  const inactive = items.filter((i) => !i.active);
  const categoryRow = (c: string): BreakdownRow => {
    const xs = active.filter((i) => i.category === c);
    const estimates = xs.filter((i) => i.isEstimate).length;
    const unused = xs.filter((i) => !activeUses(i)).length;
    return {
      key: c,
      label: c,
      sub: parts([estimates ? `${num(estimates)} tahmini` : null, unused ? `${num(unused)} reçetede yok` : null]),
      amount: xs.length,
      href: listHref({ kategori: c }),
    };
  };
  return {
    all: [
      { key: "aktif", rows: sortCategories(active.map((i) => i.category)).map(categoryRow) },
      {
        key: "pasif",
        label: "Pasif malzemeler",
        apart: true,
        rows: sortCategories(inactive.map((i) => i.category)).map((c) => ({
          key: `pasif:${c}`,
          label: c,
          amount: inactive.filter((i) => i.category === c).length,
          href: listHref({ durum: "pasif", kategori: c }),
        })),
      },
    ],
    estimates: perIngredient(
      active.filter((i) => i.isEstimate),
      "tahmini",
      (i) => parts([packageText(i), activeUses(i) ? `${num(activeUses(i))} üründe` : "Reçetede yok", clip(i.note)]),
    ),
    unused: perIngredient(
      active.filter((i) => !activeUses(i)),
      "kullanilmayan",
      (i) => parts([packageText(i), i.usedIn.length ? `yalnız ${num(i.usedIn.length)} pasif üründe` : null, i.isEstimate ? "Tahmini fiyat" : null, clip(i.note)]),
    ),
  };
}

/** Su + buz kartının dökümü: StatBreakdown'a olduğu gibi verilir */
export interface WaterBreakdown {
  description: string;
  groups: BreakdownGroup[];
  totalLabel: string;
  totalDisplay: string;
  hideTotal: boolean;
}

/** Kartta yazanla aynı: 4 ondalık, ₺/L */
export const perLiterText = (v: number) => `${num(v, 4, 4)} ₺/L`;

const SETTINGS_ROW: BreakdownRow = {
  key: "override",
  label: "Ayarlar'da elle birim maliyet",
  sub: "Yazılırsa su faturası yerine kullanılır",
  amount: 0,
  display: "Yazılmadı",
  href: "/panel/ayarlar#su",
};

/**
 * Su + buz birim maliyeti nasıl çıktı (`model.water`, motorun hesabıyla aynı kalemler): SU GİDERİ ÷ o ay reçeteye
 * göre harcanan su + buz litresi; elle girilmişse Ayarlar'daki değer; hesaplanamıyorsa neyin eksik olduğu.
 * `usage`: hesabın ayında (water.month) satış listesine göre harcanan malzeme (`model.ingredientUsage`), `online`: aynı
 * ayın laffogato.net siparişlerininki (`model.onlineUsage`; denetim E-57), malzemenin biriminde.
 */
export function waterBreakdown(
  water: WaterCost,
  items: Pick<Ingredient, "id" | "name" | "priceSource">[],
  usage: ReadonlyMap<number, number>,
  online: ReadonlyMap<number, number> = new Map(),
): WaterBreakdown {
  const perLiter = perLiterText(water.perLiter);
  switch (water.reason) {
    case "override":
      return {
        description: "Birim maliyet Ayarlar'da elle yazıldı; su faturası ve satılan litre kullanılmıyor. Elle değer silinirse Gelir-gider'deki SU GİDERİ'nden hesaplanır.",
        groups: [
          {
            key: "elle",
            noSubtotal: true,
            rows: [{ key: "override", label: "Ayarlar'da elle girilen", sub: "Su + buz, litre başına", amount: water.perLiter, display: perLiter, href: "/panel/ayarlar#su" }],
          },
        ],
        totalLabel: "Birim maliyet",
        totalDisplay: perLiter,
        hideTotal: true,
      };
    case "ok": {
      const month = water.month!;
      const m = monthLabel(month);
      const liters = items
        .filter((i) => i.priceSource === "water")
        .map((i): BreakdownRow => {
          const list = (usage.get(i.id) ?? 0) / 1000;
          const web = (online.get(i.id) ?? 0) / 1000;
          const l = list + web;
          // Bağlantı yok: "?ara=Su" adı "su" geçen başka malzemeleri de süzerdi
          const sub = web > 0 ? `Satış listesi ${num(list, 1)} L + laffogato.net ${num(web, 1)} L` : "Satış adedi × reçetedeki miktar";
          return { key: `litre:${i.id}`, label: i.name, sub, amount: l, display: `${num(l, 1)} L` };
        })
        .filter((r) => r.amount > 0)
        .sort((a, b) => b.amount - a.amount);
      const skipped = water.latestBillMonth && water.latestBillMonth !== month ? water.latestBillMonth : null;
      return {
        description: `Reçetelerdeki su ve buzun litre maliyeti: ${m} SU GİDERİ (KDV hariç) ÷ o ay satılan ürünlerin (satış listesi ve laffogato.net online siparişleri) reçetesine göre harcanan su + buz. SU GİDERİ girilmiş ve ürün satış listesi olan en son ay kullanılır.`,
        groups: [
          {
            key: "fatura",
            label: "Su faturası",
            noSubtotal: true,
            rows: [{ key: "bill", label: `${m} SU GİDERİ`, sub: "Gelir-gider tablosu, KDV hariç", amount: water.bill, display: money(water.bill), href: `/panel/gelir-gider?yil=${month.slice(0, 4)}&ay=${month}` }],
          },
          { key: "litre", label: `Harcanan su + buz (${m})`, display: `${num(water.liters, 1)} L`, rows: liters },
          ...(skipped
            ? [
                {
                  key: "atlanan",
                  label: "Kullanılmayan fatura",
                  apart: true,
                  noSubtotal: true,
                  rows: [
                    {
                      key: "skipped",
                      label: `${monthLabel(skipped)} SU GİDERİ`,
                      sub: "O ayın ürün satış listesi yok, litre hesaplanamadı; önceki ayın faturası kullanıldı",
                      amount: 0,
                      display: "Kullanılmadı",
                      tone: "warn" as const,
                      href: `/panel/satislar?ay=${skipped}`,
                    },
                  ],
                },
              ]
            : []),
        ],
        totalLabel: "Birim maliyet (fatura ÷ litre)",
        totalDisplay: perLiter,
        hideTotal: false,
      };
    }
    case "no-usage": {
      const month = water.latestBillMonth!;
      const m = monthLabel(month);
      return {
        description: `${m} su faturası girildi ama o ayın ürün satış listesi yok; litre hesaplanamadığı için su ve buz şimdilik 0 ₺ sayılıyor. Satış listesini yükleyin ya da birim maliyeti Ayarlar'da elle yazın.`,
        groups: [
          {
            key: "durum",
            noSubtotal: true,
            rows: [
              { key: "bill", label: `${m} SU GİDERİ`, sub: "Gelir-gider tablosu", amount: 0, display: "Girildi", tone: "good", href: `/panel/gelir-gider?yil=${month.slice(0, 4)}&ay=${month}` },
              { key: "sales", label: `${m} ürün satış listesi`, sub: "Harcanan litre satış listesinden hesaplanır", amount: 0, display: "Yok", tone: "warn", href: `/panel/satislar?ay=${month}` },
              SETTINGS_ROW,
            ],
          },
        ],
        totalLabel: "Birim maliyet",
        totalDisplay: perLiter,
        hideTotal: false,
      };
    }
    case "no-bill":
      return {
        description: "Gelir-gider tablosunda hiçbir ay SU GİDERİ girilmedi; su ve buz şimdilik maliyetsiz sayılıyor. Su faturasını SU GİDERİ satırına KDV hariç yazın ya da birim maliyeti Ayarlar'da elle yazın.",
        groups: [
          {
            key: "durum",
            noSubtotal: true,
            rows: [
              { key: "bill", label: "SU GİDERİ", sub: "Gelir-gider tablosunda hiçbir ay girilmedi", amount: 0, display: "Girilmedi", tone: "warn", href: "/panel/gelir-gider" },
              SETTINGS_ROW,
            ],
          },
        ],
        totalLabel: "Birim maliyet",
        totalDisplay: perLiter,
        hideTotal: false,
      };
  }
}
