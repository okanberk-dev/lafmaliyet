import { Suspense } from "react";

import { closedEvidenceText } from "@/lib/closed-days";
import { requireCan } from "@/server/auth/dal";
import { currentBranchScope } from "@/server/branch-scope";
import { cashOutCategories } from "@/server/data/cash-outs";
import { cashCounters } from "@/server/data/cash-reports";
import { loadCashRequestQueue } from "@/server/data/cash-requests";
import { fetchSiteDayCounts } from "@/server/site-sales/sync";

import { KasaRequestCards } from "./kasa-cards";

/**
 * Onaylar › Kasa (docs/ONAYLAR.md; plan docs/planlar/personel-yetki.md §2.3, §2.6, §2.7, §2.9): kasa düzeltmesi ve
 * silmesi, geç kasa raporu, kasadan çıkan, fotoğraf kaldırma ve kapalı gün kartları, `#istek-<id>`, en eski gün önce.
 * Kapalı gün kartının site sayıları kart başına ayrı bir Suspense'te sorulur (site yavaşsa sayfa beklemez). Bekleyen
 * kasa isteği yoksa bölüm çizilmez. Tek şube seçiliyken yalnız o şubenin istekleri (şube kapsamı C P1-1; "Tümü"de kart
 * şubesini adıyla söyler).
 */
export async function KasaRequests() {
  // Yönetici ve müdür (docs/ROLLER.md): müdürün kapsamı şubesine kilitli; şubesi bilinmeyen kart da müdüre gösterilmez
  const me = await requireCan("onay");
  const [cards, counters, categories] = await Promise.all([loadCashRequestQueue(undefined, await currentBranchScope(), me.role !== "admin"), cashCounters(), cashOutCategories("admin")]);
  if (!cards.length) return null;
  const siteSlots = Object.fromEntries(
    cards.flatMap((c) =>
      c.kind === "kapali-gun"
        ? [
            [
              c.id,
              <Suspense key={c.id} fallback={<p className="text-ink-mute">Sitenin o günkü siparişleri soruluyor…</p>}>
                <ClosedDaySite day={c.date} branchId={c.branchId} />
              </Suspense>,
            ],
          ]
        : [],
    ),
  );
  return <KasaRequestCards cards={cards} counters={counters} categories={categories.map((c) => ({ id: c.id, name: c.name }))} siteSlots={siteSlots} />;
}

/** Sitenin o günkü, bildirilen şubenin sipariş sayıları (tutar yok); site okunamazsa bilgi satırı */
async function ClosedDaySite({ day, branchId }: { day: string; branchId: string }) {
  await requireCan("onay");
  const site = await fetchSiteDayCounts(day, branchId);
  if (!site) return <p className="text-ink-mute">Sitenin o günkü siparişleri okunamadı (bağlantı kapalı ya da site yanıt vermedi).</p>;
  const lines = closedEvidenceText({ report: false, cashOuts: 0, waste: 0, checklists: 0, karaoke: 0, staffWrites: 0, zGap: null, opening: null, site });
  if (!lines.red.length && !lines.info.length) return <p className="text-ink-soft">Sitede o gün kafe siparişi yok.</p>;
  return (
    <ul className="space-y-1">
      {lines.red.map((x) => (
        <li key={x} className="font-medium text-bad">
          {x}
        </li>
      ))}
      {lines.info.map((x) => (
        <li key={x} className="text-ink-soft">
          {x}
        </li>
      ))}
    </ul>
  );
}
