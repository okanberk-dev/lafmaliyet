import { connection } from "next/server";

import { todayTR } from "@/lib/reminders";
import { getCurrentUser } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { loadSupplierPrices } from "@/server/data/supplier-prices";

/**
 * Hammaddenin tedarikçilere göre fiyatı (yalnız yönetici): bağlı Paraşüt ürünlerinin faturalarından tedarikçi
 * tedarikçi birim fiyat (src/lib/supplier-prices.ts). Hammadde penceresi açılınca istenir.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return Response.json({ error: "Bu işlem için yönetici girişi gerekli" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Geçersiz hammadde" }, { status: 400 });
  // Panelin seçimiyle: şube seçiliyken şubenin ve işletme genelinin faturaları (şube ayrımı parça 5)
  const body = await loadSupplierPrices(id, todayTR(), await currentBranchScope());
  if (!body) return Response.json({ error: "Hammadde bulunamadı" }, { status: 404 });
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
