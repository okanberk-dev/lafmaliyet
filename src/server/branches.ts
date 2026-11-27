import "server-only";

import { asc, count, eq } from "drizzle-orm";

import { type BranchFeature, featureAudience, featureInScope, karaokeBranchOf } from "@/lib/branch-features";
import { type BranchRow, type BranchScope, sortBranches } from "@/lib/branches";

import { getDb, schema as s, type DB } from "./db";

/**
 * Şube ve kanal kütüğünün okunması (docs/SUBE.md). Kurallar saf dosyada (src/lib/branches.ts); burada yalnız
 * veritabanı var. Liste her istekte okunur: üç-dört satırdır, önbelleğe alınmaz ki yeni açılan şube her ekranda
 * hemen görünsün.
 */
export async function listBranches(db: DB = getDb()): Promise<BranchRow[]> {
  const rows = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      kind: s.branches.kind,
      posSource: s.branches.posSource,
      active: s.branches.active,
      openedOn: s.branches.openedOn,
      sortOrder: s.branches.sortOrder,
      posRate: s.branches.posRate,
      features: s.branches.features,
    })
    .from(s.branches)
    .orderBy(asc(s.branches.sortOrder), asc(s.branches.name));
  return sortBranches(rows);
}

export async function getBranch(db: DB, id: string): Promise<BranchRow | null> {
  const [row] = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      kind: s.branches.kind,
      posSource: s.branches.posSource,
      active: s.branches.active,
      openedOn: s.branches.openedOn,
      sortOrder: s.branches.sortOrder,
      posRate: s.branches.posRate,
      features: s.branches.features,
    })
    .from(s.branches)
    .where(eq(s.branches.id, id))
    .limit(1);
  return row ?? null;
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/**
 * Karaoke odasının şubesi (şube özelliği; src/lib/branch-features.ts › karaokeBranchOf): karaokesi açık etkin şube,
 * yoksa null (karaoke hiçbir şubede gösterilmez). İşlemin içinden de okunur (kapalı günün kanıtı)
 */
export async function karaokeBranchId(db: DB | Tx = getDb()): Promise<string | null> {
  const rows = await db
    .select({ id: s.branches.id, kind: s.branches.kind, active: s.branches.active, sortOrder: s.branches.sortOrder, name: s.branches.name, features: s.branches.features })
    .from(s.branches);
  return karaokeBranchOf(sortBranches(rows));
}

/** Seçili kapsamda özellik açık mı (tek şubede o şubede, "Tümü"de herhangi birinde; `featureInScope`) */
export async function featureHere(feature: BranchFeature, scope: BranchScope, db: DB = getDb()): Promise<boolean> {
  return featureInScope(feature, scope, await listBranches(db));
}

/**
 * Özelliğin bildirim kitlesinin kullanıcı kimlikleri (Web Push `userIds`; `featureAudience`): yönetici, şubesiz personel
 * ve özelliğin açık olduğu şubenin personeli. Özellik hiçbir şubede açık değilse boş (bildirim gitmez)
 */
export async function featureAudienceIds(feature: BranchFeature, db: DB = getDb()): Promise<number[]> {
  const [branches, users] = await Promise.all([
    listBranches(db),
    db.select({ id: s.users.id, role: s.users.role, branchId: s.users.branchId }).from(s.users).where(eq(s.users.active, true)),
  ]);
  return featureAudience(users, branches, feature).map((u) => u.id);
}

/**
 * Şubeye yazılmış kayıt sayısı: silmeden önce sorulur (src/lib/branches.ts branchDeleteError).
 *
 * Şube sütunu taşıyan her tablo sayılır (migration 0056). Giderin şubesi boş olabilir ("işletme geneli", sahibin
 * kararı): boş satır hiçbir şubeye sayılmaz, zaten `eq` onu dışarıda bırakır. Tek sorguda toplanır ki şube listesi
 * ekranı tablo başına bir gidiş dönüş yapmasın.
 */
export async function branchUsageCount(db: DB, id: string): Promise<number> {
  const tables = [
    s.cashReports,
    s.posDayReports,
    s.posDailySales,
    // AsilPOS gün sonlarının sürüm geçmişi (docs/ASILPOS.md › Sürüm geçmişi)
    s.posDayRevisions,
    s.asilposDayEnds,
    s.modposCashSheets,
    s.months,
    s.salesLines,
    s.stockCounts,
    s.stockExtras,
    s.wasteEntries,
    s.cashOuts,
    // Kör sayımın sayım geçmişi (docs/KASA-RAPORU.md › Kör sayım)
    s.cashCounts,
    s.staff,
    s.expenseEntries,
    s.fixedExpenses,
    // Şubeye bağlı kontrol listesi, ödeme ve personel hesabı: şube silinirse yabancı anahtar düşerdi
    s.reminders,
    s.checklistTemplates,
    s.users,
    // Şubenin kapalı günü (denetim 13 Kasım KP-05)
    s.specialDays,
    // Tahmini stoğun kritik eşikleri (docs/STOK-TAHMINI.md)
    s.stockThresholds,
    // Vardiya planı (docs/VARDIYA.md)
    s.shifts,
    // Kasaya işle işaretleri (şube kapsamı A3). Kasada bekleyen fiyat (pos_stale) sayılmaz: durumdur, şubeyle silinir
    s.posMarks,
    // Faturanın şubesi (docs/SUBE.md › Faturanın şubesi) ve tedarikçinin varsayılan şubesi
    s.invoices,
  ];
  const counts = await Promise.all(
    tables.map(async (table) => {
      const [row] = await db.select({ n: count() }).from(table).where(eq(table.branchId, id));
      return Number(row?.n ?? 0);
    }),
  );
  // Şubenin Paraşüt hesabından gelmiş faturalar (hesap şubenin kimliğiyle adlanır)
  const [acc] = await db.select({ n: count() }).from(s.invoices).where(eq(s.invoices.parasutAccount, id));
  // Varsayılan şubesi bu şube olan tedarikçi kartı (yabancı anahtar)
  const [card] = await db.select({ n: count() }).from(s.suppliers).where(eq(s.suppliers.defaultBranchId, id));
  return counts.reduce((a, b) => a + b, 0) + Number(acc?.n ?? 0) + Number(card?.n ?? 0);
}
