"use server";

import { refresh } from "next/cache";

import { currentMonthTR } from "@/lib/calc/engine";
import { requireAdmin } from "@/server/auth/dal";
import { syncKaraoke } from "@/server/karaoke/sync";
import { siteLinkSecret } from "@/server/site-link";
import { syncSiteMenu } from "@/server/site-menu/sync";
import { syncSiteOrders } from "@/server/site-orders/sync";
import { syncSiteSales } from "@/server/site-sales/sync";

import { logActivity } from "./log";
import { attempt, UserError } from "./util";

// Ayarlar › laffogato.net: dört bağlantıyı şimdi sınar (docs/SITE-SIPARIS.md "Bağlantıyı sınama"). Kartın "Hata"sı son
// denemenin hatasıdır ve bir sonraki başarılı çekmeye kadar kalır: bir bağlantı uzun süre çekilmediyse (sitenin ucu
// henüz yayında değilken alınmış bir 404, sabah soğuk açılışta bir zaman aşımı) eski bir hata kırmızı görünür. Bu
// düğme her birini hemen çeker; hata gerçekse kart onu yeni zamanıyla gösterir. Yalnız yönetici.

export interface SiteLinkCheck {
  key: "karaoke" | "menu" | "orders" | "sales";
  ok: boolean;
  /** Hata açıklaması (Türkçe); başarılıysa null */
  error: string | null;
}

function fromResult(key: SiteLinkCheck["key"], r: PromiseSettledResult<{ status: string; error?: string }>): SiteLinkCheck {
  if (r.status === "rejected") return { key, ok: false, error: r.reason instanceof Error ? r.reason.message.slice(0, 300) : "Bilinmeyen hata" };
  if (r.value.status === "error") return { key, ok: false, error: r.value.error ?? "Bilinmeyen hata" };
  return { key, ok: true, error: null };
}

export async function testSiteLinks() {
  return attempt<SiteLinkCheck[]>(async () => {
    const me = await requireAdmin();
    if (!siteLinkSecret()) throw new UserError("laffogato.net bağlantısı kurulmamış (iki projede de aynı KARAOKE_SYNC_SECRET)");
    const [karaoke, menu, orders, sales] = await Promise.allSettled([
      syncKaraoke("manual"),
      syncSiteMenu("manual"),
      syncSiteOrders("manual"),
      // Bu ayın satışı: geçmiş aylar her sabah ve Gelir-gider'deki "Siteden yenile" ile gelir
      syncSiteSales([currentMonthTR()]).then((r) =>
        r.status === "error" ? { status: "error", error: r.results.find((x) => x.status === "error")?.error } : r,
      ),
    ]);
    const checks = [fromResult("karaoke", karaoke), fromResult("menu", menu), fromResult("orders", orders), fromResult("sales", sales)];
    const ok = checks.filter((c) => c.ok).length;
    // Müşteri verisi yok: yalnız kaç bağlantının çalıştığı
    await logActivity(me, "laffogato.net bağlantıları sınandı", `${ok}/${checks.length} bağlı`);
    refresh();
    return checks;
  });
}
