"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { ALL_BRANCHES, companyPnlKey, monthWriteLock, zFormBranch } from "@/lib/branches";
import { daysInMonth } from "@/lib/calc/engine";
import { fixedCellRefusal, fixedIdOfKey } from "@/lib/fixed-expense-rules";
import { monthLabel, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { currentBranchScope, formBranch } from "@/server/branch-scope";
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
 * Bitmiş (bitiş ayı geçmiş) ya da silinmiş sabit giderin satırına (`fixed:<id>`, `stopaj:<id>`) o ay kayıtlı değer yoksa
 * yeni tutar yazılmaz (fixed-expense-rules.ts; 23 Kasım 2026): kayıtlı değeri düzeltmek ve silmek serbest.
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
    const fixedId = fixedIdOfKey(key);
    if (fixedId !== null && amount !== null) {
      const [[item], [entry]] = await Promise.all([
        db.select({ name: s.fixedExpenses.name, endMonth: s.fixedExpenses.endMonth }).from(s.fixedExpenses).where(eq(s.fixedExpenses.id, fixedId)).limit(1),
        db
          .select({ month: s.pnlEntries.month })
          .from(s.pnlEntries)
          .where(and(eq(s.pnlEntries.month, m), eq(s.pnlEntries.rowKey, key)))
          .limit(1),
      ]);
      const refusal = fixedCellRefusal({ key, month: m, item: item ?? null, hasEntry: entry !== undefined, amount });
      if (refusal) throw new UserError(refusal);
    }
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
 * Gelir-gider'in ay hücresinin şubesi (ciro, açık gün, ay notu; docs/SUBE.md › Yazarken hangi şube): formun gösterdiği
 * şube (`branchId`; sayfa `monthWriteBranch` ile verir), gönderim anındaki seçime değil. Şubeyi göndermeyen eski sekmede
 * seçim: "Tümü"de birden çok kasa açıkken şubelerin toplamıdır, yazılmaz (monthTotalsLocked; denetim 13 Kasım HM-02);
 * online kanalın kasa satışı yok (formBranch "sales" reddeder)
 */
async function monthCellBranch(raw: unknown): Promise<string> {
  const branchId = zFormBranch.parse(raw);
  if (!branchId) {
    const lock = monthWriteLock(await currentBranchScope(), await listBranches());
    if (lock) throw new UserError(lock);
  }
  return formBranch(branchId, "sales", { requireExplicit: true });
}

/**
 * Ayın notu (ör. "1-16 Ekim, ay bitince güncelleyin"); Satışlar ve Gelir-gider sayfası aynı alanı kullanır. Ay satırı
 * şube başınadır (anahtar ay + şube): not formun şubesinin satırına yazılır (monthCellBranch; Satışlar'daki saveMonthInfo
 * ile aynı kural). Şubesiz yazılsaydı sütunun varsayılanı Tuzla'yı ezerdi (denetim 21 Kasım #6); "Tümü"nde sessizce
 * Tuzla'ya inmesi de kalktı (24 Kasım şube kapsamı)
 */
export async function setMonthNote(month: string, note: string | null, branchId?: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const sube = await monthCellBranch(branchId);
    const n = z
      .string()
      .trim()
      .max(1000, "Not en fazla 1000 karakter")
      .nullable()
      .transform((v) => (v ? v : null))
      .parse(note);
    await getDb()
      .insert(s.months)
      .values({ month: m, branchId: sube, note: n })
      .onConflictDoUpdate({ target: [s.months.month, s.months.branchId], set: { note: n, updatedAt: new Date() } });
    await logActivity(me, "Ay notu", `${monthLabel(m)} · ${await branchName(sube)}: ${n ?? "silindi"}`);
    refresh();
    return null;
  });
}

/**
 * Ayın cirosu (KDV dahil) ya da açık gün sayısı; boş (null): kasa raporlarından (varsa). Formun şubesinin ay satırına
 * yazılır (monthCellBranch; setMonthNote gibi; okuma da şubenin satırını okur, dataset.ts). Birden çok kasa açıkken
 * "Tümü" şubelerin toplamıdır, yazılmaz (monthTotalsLocked; denetim 13 Kasım HM-02): yazılan (ya da "kasaya dön") yalnız
 * Tuzla'nın ay satırına inerdi, öteki şubenin cirosu iki kez sayılırdı. Ekran hücreyi kilitler
 */
export async function setMonthField(month: string, field: "posRevenue" | "openDays", value: number | null, branchId?: string | null) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    const sube = await monthCellBranch(branchId);
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
      .values({ month: m, branchId: sube, [field]: v })
      .onConflictDoUpdate({ target: [s.months.month, s.months.branchId], set: { [field]: v, updatedAt: new Date() } });
    await logActivity(me, field === "openDays" ? "Açık gün" : "Aylık ciro", `${monthLabel(m)} · ${await branchName(sube)}: ${v === null ? "boş (kasa raporu varsa oradan)" : field === "openDays" ? `${v} gün` : tl(v)}`);
    refresh();
    return null;
  });
}

/** İşlem geçmişinde şubenin adı */
async function branchName(id: string): Promise<string> {
  return (await listBranches()).find((b) => b.id === id)?.name ?? id;
}
