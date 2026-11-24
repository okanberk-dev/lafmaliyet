import { and, count, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { after } from "next/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { DEFAULT_ROOM_HOURS } from "@/lib/karaoke/occupancy";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { KARAOKE_BRANCH_ID, KARAOKE_ELSEWHERE } from "@/lib/branches";
import { monthStats } from "@/lib/karaoke/month";
import { isBlock, sessionEnd, trClock } from "@/lib/karaoke/session";
import { requireUser } from "@/server/auth/dal";
import { staffBranchRefusal } from "@/server/branch-scope";
import { getDb, schema as s } from "@/server/db";
import { loadSessions } from "@/server/karaoke/board";
import { readKaraokeHours } from "@/server/karaoke/occupancy";
import { karaokeSecret, readSyncState, siteUrl, syncKaraoke } from "@/server/karaoke/sync";

import { KaraokeAdmin } from "./karaoke-admin";
import { KaraokeBoard } from "./karaoke-board";
import { OrdersSummary } from "./orders-summary";

export const metadata: Metadata = { title: "Karaoke" };
// "Şimdi eşitle" ve "Elle ekle" bu sayfanın sunucu eylemleriyle siteye gider (en çok 8 saniye), ardından siteden
// yeniden çeker
export const maxDuration = 30;

const DESCRIPTION = "Barın ekranı: karaoke rezervasyonları ve oda sayacı.";
// Eski uzun açıklama: başlıktaki ⓘ "Nasıl çalışır?" (docs/planlar/ux-sade.md §8)
const MORE =
  "Barın ekranı: karaoke rezervasyonları ve oda sayacı. Yeni rezervasyonda zil çalar, bitime az kala uyarır, süre dolunca “Haber verdim” denene kadar alarm çalar. Rezervasyonsuz gelenler için hızlı sayaç açın. Uygulama siparişleri, masa çağrıları ve tükenen ürünler Siparişler ekranında; açık sipariş ve çağrıların sayısı burada tek satırda.";

/**
 * Başlık iki rolde: bağlam satırı rolün ağacından (yöneticide "Kafe"; personelde üst düzey ekran, satır yok); "Nasıl
 * çalışır?" yalnız yöneticide
 */
function KaraokeHeader({ role }: { role: "admin" | "staff" }) {
  return <PageHeader title="Karaoke" path="/panel/karaoke" role={role} description={DESCRIPTION} more={role === "admin" ? MORE : undefined} />;
}

export default function KaraokePage() {
  return (
    <Suspense
      fallback={
        <>
          <KaraokeHeader role="staff" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <KaraokeContent />
    </Suspense>
  );
}

const DAY_MS = 86_400_000;

async function KaraokeContent() {
  const user = await requireUser();
  const admin = user.role === "admin";
  // Karaoke yalnız karaokenin şubesinde (docs/SUBE.md › Karaoke): başka şubeye kilitli personel rezervasyonları ve misafir
  // adlarını görmez, eşitleme de tetiklemez. Siparişlerin satırı kalır (Siparişler ekranının kısayolu)
  if (await staffBranchRefusal(user, KARAOKE_BRANCH_ID)) {
    const at = new Date().getTime();
    return (
      <>
        <KaraokeHeader role={user.role} />
        <div className="space-y-6">
          <OrdersSummary role={user.role} serverNow={at} />
          <EmptyState title={KARAOKE_ELSEWHERE} description="Karaoke odası başka şubede. Rezervasyonlar ve oda sayacı orada görünür." />
        </div>
      </>
    );
  }
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
  const [upcoming, month, history, sync, devices, room] = await Promise.all([
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
    // "Elle ekle"nin saat seçenekleri: Doluluk › Oda saatleri (kaydedilmediyse sitenin 12:00–24:00'ı)
    readKaraokeHours().catch(() => null),
  ]);
  return (
    <>
      <KaraokeHeader role={user.role} />
      <div className="space-y-6">
        {/* Uygulama siparişleri ve masa çağrıları Siparişler ekranında (/panel/siparisler): burada açık olanların tek satırı */}
        <OrdersSummary role={user.role} serverNow={now} />
        <KaraokeBoard
          role={user.role}
          upcoming={upcoming}
          siteAdminBase={admin ? `${siteUrl()}/admin/mobil/karaoke` : null}
          configured={Boolean(karaokeSecret())}
          serverNow={now}
          roomHours={room?.hours ?? DEFAULT_ROOM_HOURS}
        />
        {admin ? (
          <KaraokeAdmin
            // Kapatılan saatler oturum değil: son 30 günün listesine girmez
            history={history.filter((r) => sessionEnd(r) < now && !isBlock(r)).reverse()}
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
    </>
  );
}
