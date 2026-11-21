"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { ALL_BRANCHES, companyPnlKey, MONTH_TOTALS_LOCKED_TEXT, monthTotalsLocked } from "@/lib/branches";
import { daysInMonth } from "@/lib/calc/engine";
import { monthLabel, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope, currentWriteBranch } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth } from "./util";

const zKey = z.string().regex(/^(manual|fixed|stopaj|personnel|commission|stock):[\wçğıöşüÇĞİÖŞÜ:.\- ]{1,80}$/, "Geçersiz satır");
const zNote = z
  .string()
  .trim()
  .max(500, "Not en fazla 500 karakter")
  .nullable()
  .transform((v) => (v ? v : null));

/**
 * Gelir-gider tablosunda bir hücreyi elle girer (amount null = hesaplanan değere dön / boşalt; not da silinir).
 * note: undefined = var olan notu koru, null ya da "" = notu sil, metin = notu yaz (Excel'deki hücre açıklaması).
 */
export async function setPnlCell(month: string, rowKey: string, amount: number | null, note?: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const key = zKey.parse(rowKey);
    // Devir, personel ve POS komisyonu işletmenin toplamıdır (pnl_entries şubesiz): şube seçiliyken yazılan tutar
    // "Tümü"ye girerdi, şubede görünmezdi (docs/SUBE.md › Şube görünümünde maliyet)
    if (companyPnlKey(key) && (await currentBranchScope()) !== ALL_BRANCHES) throw new UserError("Bu satır işletmenin toplamıdır: yazmak için soldan şubeyi Tümü yapın");
    const n = note === undefined ? undefined : zNote.parse(note);
    const db = getDb();
    if (amount === null) {
      await db.delete(s.pnlEntries).where(and(eq(s.pnlEntries.month, m), eq(s.pnlEntries.rowKey, key)));
    } else {
      const v = z.number().finite().parse(amount);
      await db
        .insert(s.pnlEntries)
        .values({ month: m, rowKey: key, amount: v, note: n ?? null })
        .onConflictDoUpdate({
          target: [s.pnlEntries.month, s.pnlEntries.rowKey],
          set: { amount: v, updatedAt: new Date(), ...(n !== undefined ? { note: n } : {}) },
        });
    }
    await logActivity(
      me,
      "Gelir-gider hücresi",
      `${monthLabel(m)} · ${key}: ${amount === null ? "otomatiğe döndü" : tl(amount)}${n ? ` · not: ${n}` : n === null ? " · not silindi" : ""}`,
    );
    refresh();
    return null;
  });
}

/**
 * Ayın notu (ör. "1-16 Ekim, ay bitince güncelleyin"); Satışlar ve Gelir-gider sayfası aynı alanı kullanır. Ay satırı
 * şube başınadır (anahtar ay + şube): not seçili şubenin satırına yazılır, "Tümü"nde Tuzla'nınkine (Satışlar'daki
 * saveMonthInfo ile aynı kural, docs/SUBE.md › Yazarken hangi şube). Şubesiz yazılsaydı sütunun varsayılanı Tuzla'yı
 * ezerdi (denetim 21 Kasım #6)
 */
export async function setMonthNote(month: string, note: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const n = z
      .string()
      .trim()
      .max(1000, "Not en fazla 1000 karakter")
      .nullable()
      .transform((v) => (v ? v : null))
      .parse(note);
    await getDb()
      .insert(s.months)
      .values({ month: m, branchId: await currentWriteBranch(), note: n })
      .onConflictDoUpdate({ target: [s.months.month, s.months.branchId], set: { note: n, updatedAt: new Date() } });
    await logActivity(me, "Ay notu", `${monthLabel(m)}: ${n ?? "silindi"}`);
    refresh();
    return null;
  });
}

/**
 * Ayın cirosu (KDV dahil) ya da açık gün sayısı; boş (null): kasa raporlarından (varsa). Seçili şubenin ay satırına,
 * "Tümü"nde (yalnız tek kasa açıkken) Tuzla'nınkine yazılır (setMonthNote gibi; okuma da şubenin satırını okur,
 * dataset.ts). Birden çok kasa açıkken "Tümü" şubelerin toplamıdır, yazılmaz (monthTotalsLocked; denetim 13 Kasım HM-02)
 */
export async function setMonthField(month: string, field: "posRevenue" | "openDays", value: number | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    // "Tümü" birden çok şubenin toplamını gösterir: yazılan (ya da "kasaya dön") yalnız Tuzla'nın ay satırına inerdi,
    // öteki şubenin cirosu iki kez sayılırdı. Ekran hücreyi kilitler; Satışlar'ın formu "Tümü"de Tuzla'yı adıyla yazar
    if (monthTotalsLocked(await currentBranchScope(), await listBranches())) throw new UserError(MONTH_TOTALS_LOCKED_TEXT);
    const dim = daysInMonth(m);
    const v =
      value === null
        ? null
        : field === "openDays"
          ? z
              .number()
              .int()
              .min(0, "Açık gün negatif olamaz")
              .max(dim, `En fazla ${dim} gün (${monthLabel(m)} ${dim} gün çeker)`)
              .parse(Math.round(value))
          : z.number().finite().min(0).parse(value);
    await getDb()
      .insert(s.months)
      .values({ month: m, branchId: await currentWriteBranch(), [field]: v })
      .onConflictDoUpdate({ target: [s.months.month, s.months.branchId], set: { [field]: v, updatedAt: new Date() } });
    await logActivity(me, field === "openDays" ? "Açık gün" : "Aylık ciro", `${monthLabel(m)}: ${v === null ? "boş (kasa raporu varsa oradan)" : field === "openDays" ? `${v} gün` : tl(v)}`);
    refresh();
    return null;
  });
}
