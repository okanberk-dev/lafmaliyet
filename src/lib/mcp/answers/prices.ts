/*
 * zam_etkisi: bir tarihten bu yana fiyatı artan hammaddeler ve ürünlerden ayda götürdükleri kâr. Hesap insight'ın
 * (src/lib/calc/price-loss.ts: priceLoss, salesBasis); burada yalnız okunur biçime çevrilir. Saf;
 * tests/claude-araclar.test.ts.
 */

import type { Model, ProductCalc } from "../../calc/engine";
import type { IngredientChange, ProductImpact } from "../../calc/price-impact";
import { basisText, type PriceLoss } from "../../calc/price-loss";
import { dayTR } from "../../format";
import { cleanName, costIncomplete, num, panelUrl, pct, pctNum, r2, tl, unpricedInRecipes, unpricedWarnings } from "./common";

/** loadPriceAlerts'in bu araca gereken parçası */
export interface PriceAlertsLike {
  changes: IngredientChange[];
  impacts: (ProductImpact & { acknowledged: boolean })[];
  loss: PriceLoss;
}

export interface PriceRiseImpact {
  donem: { baslangic: string; bitis: string };
  dayanak: { satisAyi: string | null; acikGun: number | null; olcek: number | null };
  toplamAylikKayip: number | null;
  toplamAylikKazanc: number | null;
  brutKarPayiYuzde: number | null;
  hammaddeler: {
    ad: string;
    birim: string;
    eskiBirimFiyat: number;
    yeniBirimFiyat: number;
    artisYuzde: number | null;
    tarih: string;
    aylikKullanim: number | null;
    aylikKayip: number | null;
    urunSayisi: number;
  }[];
  urunler: {
    ad: string;
    boy: string;
    birimMaliyetArtisi: number;
    aylikAdet: number | null;
    aylikKayip: number | null;
    birimKarOnce: number;
    birimKarSonra: number;
    onerilenFiyat: number | null;
    fiyatinaBakin: boolean;
    /** Reçetede fiyatı girilmemiş hammadde var: birim kâr ve önerilen fiyat eksik maliyetle */
    maliyetEksik: boolean;
    panelAdresi: string;
  }[];
  uyarilar: string[];
  hesap: string[];
  kaynak: string[];
  panelAdresi: string;
}

/** Okunur birim: gr → kg, ml → L (fiyat ve kullanım 1000 ile çarpılır); adet ve dilim olduğu gibi */
export function readableUnit(unit: string): { factor: number; label: string } {
  if (unit === "gr") return { factor: 1000, label: "kg" };
  if (unit === "ml") return { factor: 1000, label: "L" };
  return { factor: 1, label: unit };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function priceRiseImpact(model: Model, alerts: PriceAlertsLike, input: { baslangic: string; bitis: string; limit: number }, ctx: { base: string }): PriceRiseImpact {
  const loss = alerts.loss;
  const basis = loss.basis;
  const impactOf = new Map(alerts.impacts.map((i) => [i.productId, i]));
  const calcOf = new Map(model.activeProducts.map((p) => [p.product.id, p]));
  const ups = loss.ingredients.filter((i) => i.pct > 0);
  const downs = loss.ingredients.filter((i) => i.pct <= 0);

  const hammaddeler = [...ups, ...downs].slice(0, input.limit).map((i) => {
    const u = readableUnit(i.unit);
    return {
      ad: cleanName(i.name),
      birim: u.label,
      eskiBirimFiyat: r2(i.before * u.factor),
      yeniBirimFiyat: r2(i.after * u.factor),
      artisYuzde: pctNum(i.pct),
      tarih: dayTR(i.changedAt),
      aylikKullanim: basis ? r1(i.monthlyUsage / u.factor) : null,
      aylikKayip: basis ? r2(i.monthly) : null,
      urunSayisi: i.productCount,
    };
  });
  const urunler = loss.products.slice(0, input.limit).map((p) => {
    const imp = impactOf.get(p.productId);
    const calc = calcOf.get(p.productId);
    return {
      ad: cleanName(p.name),
      boy: p.size,
      birimMaliyetArtisi: r2(p.unitDelta),
      aylikAdet: basis ? r1(p.monthlyQty) : null,
      aylikKayip: basis ? r2(p.monthly) : null,
      birimKarOnce: r2(p.profitBefore),
      birimKarSonra: r2(p.profitAfter),
      onerilenFiyat: imp?.needsPrice ? imp.suggestedPrice : null,
      fiyatinaBakin: Boolean(imp?.needsPrice && !imp.acknowledged),
      maliyetEksik: calc ? costIncomplete(calc) : false,
      panelAdresi: panelUrl(ctx.base, `/panel/urunler/${p.productId}`),
    };
  });

  const hesap = ["Ayda kâr kaybı = (yeni − eski birim fiyat) × reçetedeki miktar × (1 + fire) × ayda satılan adet"];
  for (const i of ups.slice(0, 3)) {
    const u = readableUnit(i.unit);
    const usage = basis ? `, ayda ${num(i.monthlyUsage / u.factor, 1)} ${u.label} kullanım → ayda ≈ ${tl(i.monthly)}` : "";
    hesap.push(`${cleanName(i.name)}: ${tl(i.before * u.factor, 2)} → ${tl(i.after * u.factor, 2)}/${u.label} (+${pct(i.pct, 0)})${usage}`);
  }
  if (basis) {
    // Yüzde eksiz: iyelik eki sayının okunuşuna göre değişir ("%3,2'si", "%16'sı", "%3,4'ü")
    const share = loss.grossProfit ? ` (brüt kâra oranı ${pct(loss.totalLoss / loss.grossProfit)})` : "";
    if (ups.length) hesap.push(`Toplam ≈ ${tl(loss.totalLoss)}/ay${share}`);
    if (loss.totalGain >= 1) hesap.push(`Ucuzlayan hammaddelerin aylık kazancı ≈ ${tl(loss.totalGain)}`);
  }

  // Kapsam zamdan etkilenen ürünler (limitten önce): birim kârları ve önerilen fiyatları eksik maliyetle hesaplandı
  const affected = loss.products.map((p) => calcOf.get(p.productId)).filter((p): p is ProductCalc => p !== undefined);
  const uyarilar = unpricedWarnings(unpricedInRecipes(affected));
  if (!ups.length) uyarilar.push("Bu dönemde fiyatı %5'ten fazla artan hammadde yok.");
  const actionable = urunler.filter((u) => u.fiyatinaBakin).length;
  if (actionable) uyarilar.push(`${num(actionable)} ürünün maliyet oranı hedefin üstünde: önerilen fiyat hazır (Ürünler › Hammadde zamları).`);

  return {
    donem: { baslangic: input.baslangic, bitis: input.bitis },
    dayanak: { satisAyi: basis?.month ?? null, acikGun: basis?.openDays ?? null, olcek: basis ? r2(basis.scale) : null },
    toplamAylikKayip: basis ? r2(loss.totalLoss) : null,
    toplamAylikKazanc: basis ? r2(loss.totalGain) : null,
    brutKarPayiYuzde: basis && loss.grossProfit ? pctNum(loss.totalLoss / loss.grossProfit) : null,
    hammaddeler,
    urunler,
    uyarilar,
    hesap,
    kaynak: [
      "Hammadde fiyat geçmişi (elle, Excel ve Paraşüt faturalarından); %5'ten küçük değişiklik zam sayılmaz, onay bekleyen fiyatlar dahil değil",
      basis ? basisText(basis) : "Satış listesi yok: aylık tutar hesaplanamadı, yalnız birim maliyet farkı var.",
      "Zayi ve ikram tüketimi ile ürüne eşleşmeyen satışlar sayılmaz",
    ].map((s) => s.replace(/\u00a0/g, " ")),
    panelAdresi: panelUrl(ctx.base, "/panel/urunler#zamlar"),
  };
}
