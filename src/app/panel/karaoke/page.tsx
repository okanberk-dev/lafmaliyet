import { and, count, eq, isNotNull } from "drizzle-orm";
import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { isLive, sessionEnd, sessionStart, trClock, type KaraokeSessionDTO } from "@/lib/karaoke/session";
import { requireUser } from "@/server/auth/dal";
import { loadSoldOut } from "@/server/data/menu-status";
import { getDb, schema as s } from "@/server/db";
import { loadSessions } from "@/server/karaoke/board";
import { karaokeSecret, readSyncState, siteUrl, syncKaraoke } from "@/server/karaoke/sync";

import { KaraokeAdmin, type MonthStats } from "./karaoke-admin";
import { KaraokeBoard } from "./karaoke-board";
import { OrdersBoard } from "./orders-board";
import { SoldOutCard } from "./sold-out-card";

export const metadata: Metadata = { title: "Karaoke" };
// Siparişin aşama düğmesi bu sayfanın sunucu eylemiyle siteye gider (en çok 8 saniye), ardından listeyi siteden
// yeniden çeker (en çok 8 saniye daha); "Şimdi eşitle" de siteye gider
export const maxDuration = 30;

export default function KaraokePage() {
  return (
    <>
      <PageHeader
        title="Karaoke"
        eyebrow="Kafe"
        description="Barın ekranı: laffogato.net'ten gelen uygulama siparişleri, karaoke rezervasyonları ve oda sayacı. Yeni sipariş ve rezervasyonda zil çalar, bitime az kala uyarır, süre dolunca “Haber verdim” denene kadar alarm çalar. Rezervasyonsuz gelenler için hızlı sayaç açın."
      />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <KaraokeContent />
      </Suspense>
    </>
  );
}

const DAY_MS = 86_400_000;

/** Bu ayın özeti: sitenin rezervasyonları (saat, ciro, iptal) ve panelden açılan sayaçlar */
function monthStats(rows: KaraokeSessionDTO[]): MonthStats {
  const site = rows.filter((r) => r.source === "site");
  const live = site.filter(isLive);
  const hours = (r: KaraokeSessionDTO) => (sessionEnd(r) - sessionStart(r)) / 3_600_000;
  const timers = rows.filter((r) => r.source === "panel");
  return {
    reservations: live.length,
    hours: live.reduce((a, r) => a + hours(r), 0),
    revenueMinor: live.filter((r) => r.paymentStatus === "paid" || r.paymentStatus === "none").reduce((a, r) => a + (r.totalMinor ?? 0), 0),
    cancelled: site.filter((r) => r.status === "cancelled" && r.paymentStatus !== "expired").length,
    walkIns: timers.length,
    walkInHours: timers.reduce((a, r) => a + hours(r), 0),
  };
}

async function KaraokeContent() {
  const user = await requireUser();
  const admin = user.role === "admin";
  // Ping kaçtıysa diye site en çok beş dakikada bir sorulur; sayfa beklemez, yeni bir şey gelirse sekme alır
  after(async () => {
    try {
      await syncKaraoke("page");
    } catch (e) {
      console.error("[karaoke] sayfa eşitlemesi", e);
    }
  });
  const now = new Date().getTime();
  const monthStart = `${trClock(now).date.slice(0, 7)}-01`;
  const [y, m] = monthStart.split("-").map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const trMidnight = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 3 * 3_600_000);
  const [upcoming, month, history, sync, devices, linked, soldOut] = await Promise.all([
    loadSessions(new Date(now - 12 * 3_600_000), new Date(now + (admin ? 45 : 8) * DAY_MS), { admin }),
    admin ? loadSessions(trMidnight(monthStart), trMidnight(nextMonth), { admin }) : Promise.resolve([]),
    admin ? loadSessions(new Date(now - 30 * DAY_MS), new Date(now), { admin }) : Promise.resolve([]),
    admin ? readSyncState() : Promise.resolve(null),
    admin
      ? getDb()
          .select({ n: count() })
          .from(s.pushSubscriptions)
          .innerJoin(s.users, eq(s.users.id, s.pushSubscriptions.userId))
          .where(and(eq(s.users.active, true), eq(s.users.sessionVersion, s.pushSubscriptions.sessionVersion), eq(s.pushSubscriptions.karaoke, true)))
      : Promise.resolve(null),
    // Sipariş satırının reçetesi: laffogato.net menüsüne bağlı ürünler (kalem + yuva → ürün adı; reçete defterinde aranır)
    getDb()
      .select({ name: s.products.name, siteMenuId: s.products.siteMenuId, siteMenuSlot: s.products.siteMenuSlot })
      .from(s.products)
      .where(and(isNotNull(s.products.siteMenuId), eq(s.products.active, true))),
    // Tükenenler kartı (dalga 10 §2.1): site bağlantısı yoksa kart yok; okunamazsa kart çizilmez, ekran açılır
    loadSoldOut().catch((e: unknown) => {
      console.error("[tukendi] kart", e);
      return null;
    }),
  ]);
  const recipes = Object.fromEntries(linked.filter((p) => p.siteMenuId && p.siteMenuSlot).map((p) => [`${p.siteMenuId}|${p.siteMenuSlot}`, p.name]));
  return (
    <div className="space-y-6">
      <OrdersBoard role={user.role} siteBase={siteUrl()} recipes={recipes} serverNow={now} />
      {soldOut?.configured ? <SoldOutCard role={user.role} entries={soldOut.entries} serverNow={now} /> : null}
      <KaraokeBoard role={user.role} upcoming={upcoming} siteAdminBase={admin ? `${siteUrl()}/admin/mobil/karaoke` : null} configured={Boolean(karaokeSecret())} serverNow={now} />
      {admin ? (
        <KaraokeAdmin
          history={history.filter((r) => sessionEnd(r) < now).reverse()}
          stats={monthStats(month.filter((r) => r.date >= monthStart && r.date < nextMonth))}
          monthLabel={new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(now))}
          sync={sync}
          configured={Boolean(karaokeSecret())}
          devices={devices?.[0]?.n ?? 0}
          siteAdminBase={`${siteUrl()}/admin/mobil/karaoke`}
          sitePanelUrl={`${siteUrl()}/admin`}
          nowMs={now}
        />
      ) : null}
    </div>
  );
}
