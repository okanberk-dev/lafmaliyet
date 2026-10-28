/*
 * urun_karliligi: ürünlerin birim maliyeti, kârı, satış adedi, toplam kârı ve menü sınıfı (Ürünler ve Analiz'deki
 * hesap: ProductCalc, menuEngineering, MENU_CLASS_INFO). Adetler salesFor'dan: ayın satış listesi yoksa önceki son ay.
 * Saf; tests/claude-araclar.test.ts.
 */

import type { Model, ProductCalc, ProductStatus } from "../../calc/engine";
import { MENU_CLASS_INFO, menuEngineering, type MenuClass } from "../../calc/insights";
import type { UrunKarliligiInput } from "../schemas";
import { cleanName, costIncomplete, foldName, monthLabel, nameMatches, num, panelUrl, pct, pctNum, r2, salesFor, tl, ToolInputError, unpricedInRecipes, unpricedWarnings } from "./common";

export interface ProductRow {
  ad: string;
  boy: string;
  kategori: string | null;
  fiyatKdvDahil: number;
  /** Reçetesi boş üründe (durum "Reçete yok") null: maliyeti bilinmiyor, kâr ve marj da hesaplanmaz (denetim E-47) */
  birimMaliyet: number | null;
  birimKar: number | null;
  marjYuzde: number | null;
  maliyetOraniYuzde: number | null;
  /** Reçetede fiyatı girilmemiş hammadde var: maliyet eksik, kâr ve marj olduğundan yüksek */
  maliyetEksik: boolean;
  durum: ProductStatus;
  adet: number;
  toplamKar: number | null;
  menuSinifi: "Yıldız" | "Beygir" | "Bilmece" | "Zayıf" | null;
  oneri: string | null;
  panelAdresi: string;
}

export interface ProductProfitability {
  ay: string;
  satisAyi: string | null;
  satisAyiNotu: string | null;
  urunler: ProductRow[];
  toplam: { urunSayisi: number; satilanAdet: number; ortalamaKatkiPayi: number; hedefMaliyetOraniYuzde: number | null };
  uyarilar: string[];
  hesap: string[];
  kaynak: string[];
  panelAdresi: string;
}

const tl2 = (v: number) => tl(v, 2);

/** Kategori adı: önce birebir (büyük/küçük harf farkı yok), sonra tek bir parça eşleşmesi */
function findCategory(model: Model, q: string): { id: number; name: string } {
  const exact = model.categories.find((c) => foldName(c.name) === foldName(q));
  if (exact) return exact;
  const partial = model.categories.filter((c) => nameMatches(c.name, q));
  if (partial.length === 1) return partial[0];
  const names = model.categories.map((c) => cleanName(c.name, 40)).join(", ");
  throw new ToolInputError(partial.length ? `“${cleanName(q, 40)}” birden çok kategoriye uyuyor; tam adını yazın. Kategoriler: ${names}` : `“${cleanName(q, 40)}” adında kategori yok. Kategoriler: ${names}`);
}

/** Reçetesiz ürünün kârı neredeyse fiyatı kadar görünür: kâr sıralamalarına girmez (Genel bakış'taki kural) */
const ranked = (p: ProductCalc) => p.status !== "Reçete yok";

export function productProfitability(model: Model, input: UrunKarliligiInput & { ay: string }, ctx: { base: string }): ProductProfitability {
  const st = model.settings;
  const basis = salesFor(model, input.ay);
  const category = input.kategori ? findCategory(model, input.kategori) : undefined;
  const me = menuEngineering(model, basis.salesMonth ?? input.ay, category?.id);
  const hasSales = me.totalQty > 0;
  // Reçetesi boş ürün menü sınıfına girmez (menuEngineering.noRecipe); adet sıralamasında ve uyarıda yine görünür
  const unclassified = me.noRecipe.map((x) => ({ p: x.p, qty: x.qty, cm: x.p.unitProfit, totalCm: x.p.unitProfit * x.qty, cls: null }));
  let items: { p: ProductCalc; qty: number; cm: number; totalCm: number; cls: MenuClass | null }[] = [...me.items, ...unclassified];
  if (input.urun) items = items.filter((x) => nameMatches(`${x.p.product.name} ${x.p.product.size}`, input.urun!));

  const byTotal = (a: (typeof items)[number], b: (typeof items)[number]) => b.totalCm - a.totalCm || b.cm - a.cm;
  let sorted: typeof items;
  switch (input.siralama) {
    case "birim_kar":
      sorted = items.filter((x) => ranked(x.p)).sort((a, b) => b.cm - a.cm);
      break;
    case "marj":
      sorted = items.filter((x) => ranked(x.p)).sort((a, b) => b.p.margin - a.p.margin);
      break;
    case "adet":
      sorted = [...items].sort((a, b) => b.qty - a.qty || b.totalCm - a.totalCm);
      break;
    case "zarar": {
      // En az kâr bırakan satılmış ürünler önce (toplam kâr küçükten büyüğe), sonra satılmamış ama zararına olanlar
      const sold = items.filter((x) => ranked(x.p) && x.qty > 0).sort((a, b) => a.totalCm - b.totalCm || a.cm - b.cm);
      const loss = items.filter((x) => ranked(x.p) && x.qty === 0 && x.cm < 0).sort((a, b) => a.cm - b.cm);
      sorted = [...sold, ...loss];
      break;
    }
    default:
      sorted = items.filter((x) => ranked(x.p)).sort(byTotal);
  }
  const salesMonthParam = basis.salesMonth ?? input.ay;
  const rows: ProductRow[] = sorted.slice(0, input.limit).map((x) => {
    const p = x.p;
    const cls = hasSales && x.cls ? MENU_CLASS_INFO[x.cls] : null;
    // Reçetesi boş ürünün maliyeti 0 görünür, kârı neredeyse fiyatı kadar: rakam verilmez (panelde de "–")
    const known = ranked(p);
    return {
      ad: cleanName(p.product.name),
      boy: p.product.size,
      kategori: p.category ? cleanName(p.category.name) : null,
      fiyatKdvDahil: r2(p.price),
      birimMaliyet: known ? r2(p.cost) : null,
      birimKar: known ? r2(p.unitProfit) : null,
      marjYuzde: known ? pctNum(p.margin) : null,
      maliyetOraniYuzde: known ? pctNum(p.costRatio) : null,
      maliyetEksik: costIncomplete(p),
      durum: p.status,
      adet: x.qty,
      toplamKar: known ? r2(x.totalCm) : null,
      menuSinifi: cls ? (cls.label as ProductRow["menuSinifi"]) : null,
      oneri: cls ? cls.advice : null,
      panelAdresi: panelUrl(ctx.base, `/panel/urunler/${p.product.id}?ay=${salesMonthParam}`),
    };
  });

  const salesLabel = basis.salesMonth ? monthLabel(basis.salesMonth) : null;
  const hesap = [
    `Birim kâr = fiyat ÷ ${num(1 + st.kdv, 2, 2)} (KDV) − maliyet − komisyon (fiyat × ${pct(st.komisyon)} × kartlı oran ${pct(st.kartOrani)})`,
    `Maliyet = reçete malzemeleri (KDV hariç) + fire ${pct(st.fire)}${st.fireExcludesPackaging ? " (ambalaj hariç)" : ""}; ürüne özel fire varsa o`,
    salesLabel ? `Toplam kâr = birim kâr × ${salesLabel} satış adedi` : "Toplam kâr hesaplanamadı: satış listesi yok",
  ];
  const first = sorted[0]?.p;
  if (first && ranked(first)) {
    hesap.push(
      `Örnek, ${cleanName(first.product.name)} ${first.product.size}: ${tl2(first.price)} ÷ ${num(1 + st.kdv, 2, 2)} = ${tl2(first.net)} − maliyet ${tl2(first.cost)} − komisyon ${tl2(first.commission)} = ${tl2(first.unitProfit)} birim kâr`,
    );
  }
  if (hasSales) {
    hesap.push(
      `Menü sınıfı (Kasavana-Smith): satış payı ≥ ${pct(me.popThreshold, 2)} (= 1 ÷ ${num(me.items.length)} ürün × 0,7) ise çok satan; birim kâr ≥ ${tl2(me.avgCm)} (satış ağırlıklı ortalama) ise çok kazandıran. Reçetesi boş ürün sınıflanmaz ve eşiklere girmez.`,
    );
  }

  const noRecipe = items.filter((x) => !ranked(x.p)).length;
  // Kapsam süzülmüş liste (kategori, ürün adı), limitten önce: eksik maliyet ürünün sıradaki yerini de değiştirir
  // ("zarar" sırasında hiç görünmeyebilir), uyarı yine verilir
  const uyarilar = [...(basis.note ? [basis.note] : []), ...unpricedWarnings(unpricedInRecipes(items.map((x) => x.p)))];
  if (noRecipe) {
    uyarilar.push(
      input.siralama === "adet"
        ? `Reçetesi boş ${num(noRecipe)} ürünün maliyeti ve kârı hesaplanmadı (maliyeti bilinmiyor; birim kâr, marj ve toplam kâr boş).`
        : `Reçetesi olmayan ${num(noRecipe)} ürün kâr sıralamasına girmedi (maliyeti bilinmiyor).`,
    );
  }

  return {
    ay: input.ay,
    satisAyi: basis.salesMonth,
    satisAyiNotu: basis.note,
    urunler: rows,
    toplam: {
      urunSayisi: sorted.length,
      satilanAdet: items.reduce((a, x) => a + x.qty, 0),
      ortalamaKatkiPayi: r2(me.avgCm),
      hedefMaliyetOraniYuzde: pctNum(st.hedefMaliyet),
    },
    uyarilar,
    hesap,
    kaynak: [
      salesLabel ? `Adetler ${salesLabel} ModPOS ürün satış listesinden (Satışlar); laffogato.net online siparişleri dahil değil` : "Satış listesi yok: adetler 0",
      "Fiyat ve maliyet bugünkü reçete ve hammadde fiyatlarıyla (Ürünler ekranıyla aynı)",
      ...(category ? [`Yalnız “${cleanName(category.name)}” kategorisi; menü sınıfı kategori içinde`] : []),
    ],
    panelAdresi: panelUrl(ctx.base, `/panel/urunler?ay=${salesMonthParam}`),
  };
}
