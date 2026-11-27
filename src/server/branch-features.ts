import "server-only";

import { eq, sql } from "drizzle-orm";

import { type BranchFeature, branchFeatures, featureChangeError, featureLabel, staffFeatureError, withFeature } from "@/lib/branch-features";
import { sortBranches } from "@/lib/branches";
import { staffBranchLock } from "@/server/branch-scope";
import { logSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { UserError } from "@/server/user-error";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Şubenin bir özelliğini açar ya da kapatır (şube kapsamı B6; docs/SUBE.md › Şube özellikleri). Çağıranın işleminde:
 * özellik kilidi alınır, kütük işlemin içinden okunur, kural (`featureChangeError`: online kanalın özelliği yok, karaoke
 * tek şubede) denetlenir, satır yazılır ve işlem geçmişine "Şube özelliği" düşer. İki sekme aynı anda karaokeyi iki
 * şubede açamaz: ikincisi kilidi bekler, kütüğü yeniden okur ve reddedilir. Değişiklik yoksa yazmaz.
 */
export async function setBranchFeatureTx(
  tx: Tx,
  d: { branchId: string; feature: BranchFeature; on: boolean },
  me: { id?: number; name: string },
): Promise<{ features: BranchFeature[]; changed: boolean }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('branch-features'))`);
  const rows = sortBranches(
    await tx
      .select({ id: s.branches.id, name: s.branches.name, kind: s.branches.kind, active: s.branches.active, sortOrder: s.branches.sortOrder, features: s.branches.features })
      .from(s.branches),
  );
  const branch = rows.find((b) => b.id === d.branchId);
  if (!branch) throw new UserError("Şube bulunamadı");
  const error = featureChangeError(branch, d.feature, d.on, rows);
  if (error) throw new UserError(error);
  const current = branchFeatures(branch);
  const next = withFeature(current, d.feature, d.on);
  if (next.length === current.length && next.every((f, i) => f === current[i])) return { features: next, changed: false };
  await tx.update(s.branches).set({ features: next, updatedAt: new Date() }).where(eq(s.branches.id, d.branchId));
  await logSetting(tx, me, "Şube özelliği", `${branch.name} · ${featureLabel(d.feature)}: ${d.on ? "açıldı" : "kapatıldı"}`, d.branchId);
  return { features: next, changed: true };
}

/**
 * Özelliğin eylemi personel için kapalıysa reddeder (`staffFeatureError`): uygulama siparişi kapalı şubeye kilitli
 * personel sipariş aşaması işaretleyemez, garson çağır kapalıysa masa çağrısını "Gördüm" diye kapatamaz
 */
export async function assertStaffFeature(me: { role: string }, feature: BranchFeature): Promise<void> {
  if (me.role === "admin") return;
  const [branches, lock] = await Promise.all([listBranches(), staffBranchLock()]);
  const error = staffFeatureError(me, lock, branches, feature);
  if (error) throw new UserError(error);
}
