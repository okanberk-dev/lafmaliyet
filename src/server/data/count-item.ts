import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { staffCountMonths, todayTR } from "@/app/panel/sayim/logic";
import { countUnitsFor, currentMonthTR } from "@/lib/calc/engine";
import {
  BASE_UNIT,
  cleanName,
  COUNT_ITEM_NAME_MAX,
  COUNT_ITEM_NAME_MIN,
  COUNT_ITEM_PRICE_MAX,
  countFromMonth,
  countItemMonthIssue,
  countItemNote,
  countItemPriceRow,
  duplicateMessage,
  findDuplicate,
  formulaStartMessage,
  laterCountItem,
  newCountItemValues,
  startsLikeFormula,
  type CountItemDuplicate,
  type CountItemSource,
} from "@/lib/count-item";
import { dateTR } from "@/lib/format";
import { UserError, zMonth, zOptText, zText } from "@/server/actions/util";
import type { CurrentUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

/**
 * Sayım listesine yeni kalem açmanın tek yeri: Stok sayımı › "Listeye ekle" (src/app/panel/sayim/actions.ts
 * addCountItem) ve reçete önerisindeki "Yeni malzeme" (src/server/actions/recipe-requests.ts addProposalIngredient)
 * aynı şemayla doğrular, aynı işlevi çağırır: personelin ay kuralı, aynı ad denetimi, danışma kilidi, listeye girdiği
 * ay (count_from), Tahmini. Sunucu eylemi değil (dışarıdan çağrılamaz); yetki ve işlem geçmişi eylemlerde.
 */

/** "Paket fiyatı (₺, biliyorsanız)": kuruşa yuvarlanır, sonra 0'dan büyük ve sınırın altında olmalı */
const zPackagePrice = z
  .number({ message: "Paket fiyatını sayıyla yazın" })
  .finite("Paket fiyatını sayıyla yazın")
  .transform((v) => Math.round(v * 100) / 100)
  .pipe(z.number().positive("Paket fiyatı 0'dan büyük olmalı").max(COUNT_ITEM_PRICE_MAX, "Paket fiyatı çok büyük"));

/** İki eylemin ortak girdisi */
export const countItemSchema = z.object({
  month: zMonth,
  name: z
    .string({ message: "Kalemin adını yazın" })
    .transform(cleanName)
    .pipe(
      z
        .string()
        .min(COUNT_ITEM_NAME_MIN, `Ad en az ${COUNT_ITEM_NAME_MIN} harf olmalı`)
        .max(COUNT_ITEM_NAME_MAX, "Ad çok uzun")
        // Ad ve paket Hammaddeler'in CSV'sine olduğu gibi gider: Excel'de formül diye çalışmasın
        .refine((v) => !startsLikeFormula(v), formulaStartMessage("Ad")),
    ),
  group: zText("Grup", 80),
  countUnit: z.enum(["KG", "LT", "ADET", "DİLİM"], { message: "Sayım birimini seçin" }),
  packageDesc: zOptText(160).refine((v) => !v || !startsLikeFormula(v), formulaStartMessage("Paket")),
  packageSize: z.number({ message: "Paket içeriğini yazın" }).finite("Paket içeriğini yazın").positive("Paket içeriği 0'dan büyük olmalı").max(1_000_000, "Paket içeriği çok büyük"),
  // Eski istemci alanı göndermez: yazılmamış sayılır
  packagePrice: zPackagePrice.nullish().transform((v) => v ?? null),
});

export type CountItemInput = z.output<typeof countItemSchema>;

/** Kalemin malzeme seçiminde gereken alanları (reçete önerisi listesine eklenir; fiyat yok) */
export interface CountItemRef {
  id: number;
  name: string;
  unit: string;
  category: string;
}

/**
 * Aynı adlı hammadde var (pasif ya da "Sayılmaz" olanlar dahil). Metni sayımdaki gibidir; reçete önerisi aktif olanı
 * "Onu seç" diye sunar.
 */
export class CountItemExists extends UserError {
  constructor(
    message: string,
    readonly existing: CountItemRef & { active: boolean; kind: CountItemDuplicate["kind"] },
  ) {
    super(message);
  }
}

export interface CreatedCountItem extends CountItemRef {
  /** Sayım grubu (kalem zaten vardıysa onunki) */
  group: string;
  /** Kalem zaten vardı, daha sonraki bir aydan itibaren listedeydi; artık `from` ayından itibaren de */
  existed: boolean;
  /** Listeye girdiği ay */
  from: string;
  /** Yazılan paket fiyatı (kalem yeni açıldıysa); yoksa null */
  packagePrice: number | null;
}

/**
 * Kalemi hemen hammadde olarak açar, onay beklemez; gösterilen aydan itibaren her ay sayım listesinde çıkar (count_from:
 * sayımı bitmiş eski aylar "kalem kaldı" demesin). Paket fiyatı yazıldıysa o, yazılmadıysa 0 (zilde "Fiyatı girilmemiş
 * N hammadde"); iki durumda da "Tahmini", yönetici Hammaddeler'den doğrular. Yazılan fiyat aynı işlemde fiyat geçmişinin
 * başlangıcı olur (countItemPriceRow): kapanmış ay o fiyatla değerlenir, sonraki zam onu değiştirmez; zam uyarısı bu
 * satırı taban saymaz (personelin tahmini taban olsaydı ilk fatura zam ya da indirim gibi görünürdü). Kalem Tahmini
 * iken Hammaddeler'deki düzeltme bu satırın yerine geçer (src/server/data/ingredient-prices.ts). Fiyatsız kalem
 * satır yazmaz. Personel yalnız sayımını değiştirebildiği ayda ekler. Aynı ad
 * (Türkçe büyük/küçük harf ve boşluk farkı gözetmeden; pasif ya da "Sayılmaz" olanlar dahil) varsa eklenmez
 * (CountItemExists); kalem listede ama daha sonraki bir aydan itibaren çıkıyorsa gösterilen aydan itibaren de listeye
 * alınır.
 */
export async function createCountItem(me: CurrentUser, data: CountItemInput, source: CountItemSource = "sayim"): Promise<CreatedCountItem> {
  const m = data.month;
  const monthIssue = countItemMonthIssue(me.role, m, staffCountMonths());
  if (monthIssue) throw new UserError(monthIssue);
  const unit = BASE_UNIT[data.countUnit];
  if (!countUnitsFor(unit).includes(data.countUnit)) throw new UserError("Sayım birimini seçin");
  const from = countFromMonth(m, currentMonthTR());
  return getDb().transaction(async (tx) => {
    // Aynı adı iki kişi aynı anda eklemesin (büyük/küçük harf farkı ad sütununun benzersiz dizininden kaçar)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sayim-listeye-ekle'))`);
    const rows = await tx
      .select({
        id: s.ingredients.id,
        name: s.ingredients.name,
        unit: s.ingredients.unit,
        category: s.ingredients.category,
        vatRate: s.ingredients.vatRate,
        active: s.ingredients.active,
        countUnit: s.ingredients.countUnit,
        countGroup: s.ingredients.countGroup,
        countFrom: s.ingredients.countFrom,
        sortOrder: s.ingredients.sortOrder,
      })
      .from(s.ingredients)
      .orderBy(asc(s.ingredients.sortOrder), asc(s.ingredients.id));
    const later = laterCountItem(data.name, rows, from);
    if (later) {
      await tx.update(s.ingredients).set({ countFrom: from }).where(eq(s.ingredients.id, later.id));
      return { id: later.id, name: later.name, unit: later.unit, category: later.category, group: later.countGroup ?? "DİĞER", existed: true, from, packagePrice: null };
    }
    const dup = findDuplicate(data.name, rows);
    if (dup) {
      // Adlar benzersiz (ad sütununun dizini): eşleşen kayıt tektir
      const row = rows.find((r) => r.name === dup.name);
      throw new CountItemExists(duplicateMessage(dup, me.role), {
        id: row?.id ?? 0,
        name: dup.name,
        unit: row?.unit ?? "",
        category: row?.category ?? "",
        active: row?.active ?? false,
        kind: dup.kind,
      });
    }
    if (!rows.some((r) => r.countGroup === data.group)) throw new UserError("Bu sayım grubu bulunamadı; sayfayı yenileyin");
    const note = countItemNote(me.name, dateTR(todayTR()), { pricedBy: data.packagePrice !== null ? me.role : null, source });
    // Personelin yazdığı fiş fiyatı KDV dahil: hammaddeye KDV hariç yazılır (netPackagePrice)
    const values = newCountItemValues(data, rows, from, note, { priceIncludesVat: me.role !== "admin" });
    const [row] = await tx
      .insert(s.ingredients)
      .values(values)
      .returning({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, category: s.ingredients.category });
    // Başlangıç satırı hammaddeye yazılan (KDV hariç) fiyatla
    const start = countItemPriceRow(row.id, values, me.name);
    if (start) await tx.insert(s.ingredientPrices).values(start);
    return { ...row, group: data.group, existed: false, from, packagePrice: data.packagePrice !== null ? values.packagePrice : null };
  });
}
