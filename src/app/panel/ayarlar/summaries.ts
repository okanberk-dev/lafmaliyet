// Ayarlar · telefonda kapalı bölümlerin başlık altındaki tek satırlık özeti (saf; istemci ve testler kullanır).
// Bölümü açmadan şu anki (kayıtlı) değerler okunur: "KDV %10 / hizmet %20 · POS %2,5 · Kartlı %85,6 · Hedef %30 · Fire %5".

import type { WaterCost } from "@/lib/calc/engine";
import type { Settings } from "@/lib/calc/types";
import { num, tl } from "@/lib/format";

import { MEASURE_FIELDS, RATE_FIELDS, shown, type FieldDef, type NumericKey } from "./fields";
import { waterSource } from "./water-text";

const field = (key: NumericKey): FieldDef => [...RATE_FIELDS, ...MEASURE_FIELDS].find((f) => f.key === key)!;
const value = (s: Settings, key: NumericKey) => shown(Number(s[key]), field(key));

/** Oranlar: altı oranın kısa adlarıyla kayıtlı değerleri */
export function ratesSummary(s: Settings): string {
  return [
    `KDV ${value(s, "kdv")} / hizmet ${value(s, "kdvHizmet")}`,
    `POS ${value(s, "komisyon")}`,
    `Kartlı ${value(s, "kartOrani")}`,
    `Hedef ${value(s, "hedefMaliyet")}`,
    `Fire ${value(s, "fire")}`,
  ].join(" · ");
}

/** Reçete ölçüleri: en çok bakılan ölçüler (shot, şurup ve püre pompası) + açık gün; ölçülmemiş (varsayım) değer sayısı */
export function measuresSummary(s: Settings): string {
  const assumptions = MEASURE_FIELDS.filter((f) => f.assumption).length;
  return [
    `Shot ${value(s, "shotTek")} / ${value(s, "shotCift")} gr`,
    `Pompa ${value(s, "pompa")} ml · püre ${value(s, "pompaPure")} ml`,
    `${num(Number(s.acikGun))} açık gün`,
    ...(assumptions ? [`${num(assumptions)} varsayım`] : []),
  ].join(" · ");
}

/**
 * Su + buz: litre maliyeti ve kaynağı ("Eylül 2026 su faturasından", "Ayarlar'dan elle"). Hesaplanamıyorsa (fatura
 * yok, satış listesi yok) "0,0000 ₺/L" gürültüsü yerine yalnızca neden yazılır.
 */
export function waterSummary(water: WaterCost): string {
  const source = waterSource(water, true);
  if (water.reason === "no-bill" || water.reason === "no-usage") return source;
  return `${tl(water.perLiter, 4)}/L · ${source}`;
}

/** Kategoriler: kaç kategori, kaç ürün */
export function categoriesSummary(categories: { count: number }[]): string {
  if (!categories.length) return "Kategori yok";
  const products = categories.reduce((n, c) => n + c.count, 0);
  return `${num(categories.length)} kategori · ${num(products)} ürün`;
}

/** İşlem geçmişi: son işlemin günü, saati ve kişisi */
export function logSummary(entries: { dayLabel: string; time: string; userName: string | null }[]): string {
  const last = entries[0];
  if (!last) return "Henüz işlem yok";
  return `Son işlem: ${last.dayLabel} ${last.time} · ${last.userName ?? "Sistem"}`;
}
