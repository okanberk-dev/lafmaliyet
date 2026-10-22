"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { currentMonthTR } from "@/lib/calc/engine";
import { monthLabel } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { SITE_SALES_FIRST_MONTH, syncSiteSales } from "@/server/site-sales/sync";

import { logActivity } from "./log";
import { attempt, UserError, zMonth } from "./util";

// laffogato.net'in online satışları (docs/SITE-SATIS.md): Gelir-gider'deki "Siteden yenile". Yalnız yönetici.

/**
 * Verilen ayları siteden yeniden çeker (en çok 3 ay; bu aydan ileri ve sitenin online siparişlerinden önceki ay
 * olmaz). Çekilemeyen ayın önceki kaydı olduğu gibi kalır; hata Türkçe döner.
 */
export async function refreshSiteSales(months: string[]) {
  return attempt(async () => {
    const me = await requireAdmin();
    const list = [...new Set(z.array(zMonth).min(1).max(3).parse(months))];
    const current = currentMonthTR();
    if (list.some((m) => m > current)) throw new UserError("İleri bir ayın satışı çekilemez");
    if (list.some((m) => m < SITE_SALES_FIRST_MONTH)) throw new UserError(`${monthLabel(SITE_SALES_FIRST_MONTH)} öncesinde sitede online satış yok`);
    const r = await syncSiteSales(list);
    if (r.status === "off") throw new UserError("laffogato.net bağlantısı kurulmamış (KARAOKE_SYNC_SECRET)");
    const ok = r.results.filter((x) => x.status === "ok").map((x) => monthLabel(x.month));
    if (ok.length) await logActivity(me, "laffogato.net online satışları çekildi", ok.join(", "));
    refresh();
    const failed = r.results.filter((x): x is Extract<typeof x, { status: "error" }> => x.status === "error");
    if (failed.length && !ok.length) throw new UserError(failed.map((x) => `${monthLabel(x.month)}: ${x.error}`).join(" · "));
    return { ok, failed: failed.map((x) => ({ month: x.month, error: x.error })) };
  });
}
