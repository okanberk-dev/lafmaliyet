import { and, eq, isNotNull } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { DeviceAlerts } from "@/components/panel/live/device-alerts";
import { PageHeader } from "@/components/panel/page-header";
import { buttonClass } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { tillBranches } from "@/lib/branches";
import { requireUser } from "@/server/auth/dal";
import { staffBranchLock } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { loadSoldOut } from "@/server/data/menu-status";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret, siteUrl } from "@/server/site-link";

import { OrdersBoard, OrdersRefreshButton } from "./orders-board";
import { SoldOutCard } from "./sold-out-card";

export const metadata: Metadata = { title: "Siparişler" };
// Siparişin aşama düğmesi, masa çağrısının "Gördüm"ü ve Tükenenler'in düğmeleri bu sayfanın sunucu eylemleriyle siteye
// gider (en çok 8 saniye), ardından listeyi siteden yeniden çeker (en çok 8 saniye daha)
export const maxDuration = 30;

const DESCRIPTION = "laffogato.net'ten (uygulama ve web) ödenmiş kafe siparişleri, masa çağrıları ve tükenen ürünler.";

/** Sitenin kendi sipariş paneli (iade, iptal ve geçmiş orada) */
const siteOrdersUrl = () => `${siteUrl()}/admin/siparisler`;

/**
 * Başlık iki rolde: bağlam satırı rolün ağacından (yöneticide "Kafe"; personelde üst düzey ekran, satır yok). Eylemler:
 * sitenin sipariş panelini yeni sekmede açan "laffogato.net'te aç" ve siteyi hemen yeniden çektiren "Yenile"
 */
function SiparislerHeader({ role, refresh }: { role: "admin" | "staff"; refresh?: ReactNode }) {
  return (
    <PageHeader
      title="Siparişler"
      path="/panel/siparisler"
      role={role}
      description={DESCRIPTION}
      actions={
        <>
          <a href={siteOrdersUrl()} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")} title="Sitenin sipariş panelini yeni sekmede aç (iade ve iptal orada)">
            laffogato.net&apos;te aç <ExternalLink size={13} aria-hidden="true" />
          </a>
          {refresh}
        </>
      }
    />
  );
}

export default function SiparislerPage() {
  return (
    <Suspense
      fallback={
        <>
          <SiparislerHeader role="staff" />
          <PageSkeleton rows={6} />
        </>
      }
    >
      <SiparislerContent />
    </Suspense>
  );
}

async function SiparislerContent() {
  const user = await requireUser();
  const configured = Boolean(siteLinkSecret());
  const now = new Date().getTime();
  // Sipariş satırının reçetesi: laffogato.net menüsüne bağlı ürünler (kalem + yuva → ürün adı; reçete defterinde aranır)
  const [linked, soldOut] = await Promise.all([
    getDb()
      .select({ name: s.products.name, siteMenuId: s.products.siteMenuId, siteMenuSlot: s.products.siteMenuSlot })
      .from(s.products)
      .where(and(isNotNull(s.products.siteMenuId), eq(s.products.active, true))),
    // Tükenenler kartı (dalga 10 §2.1; 22 Kasım 2026'da Karaoke ekranından buraya taşındı): site bağlantısı yoksa kart
    // yok; okunamazsa kart çizilmez, ekran açılır
    loadSoldOut().catch((e: unknown) => {
      console.error("[tukendi] kart", e);
      return null;
    }),
  ]);
  // Tükendi bütün şubelerde kapanır (sitede şube başına durum yok): birden çok şube açıkken pencere söyler, şubesine
  // kilitli personel onaylar (şube kapsamı C P1-7)
  const [branchRows, lock] = await Promise.all([listBranches(), staffBranchLock()]);
  const branchNames = tillBranches(branchRows).map((b) => b.name);
  const locked = lock !== null && branchNames.length > 1;
  const recipes = Object.fromEntries(linked.filter((p) => p.siteMenuId && p.siteMenuSlot).map((p) => [`${p.siteMenuId}|${p.siteMenuSlot}`, p.name]));
  return (
    <>
      <SiparislerHeader role={user.role} refresh={<OrdersRefreshButton role={user.role} configured={configured} />} />
      <div className="space-y-6">
        {/* Bağlantı sunucunun ayarı, sayfayla gelir: canlı bölge değil. Kurulum talimatı yalnız yöneticide */}
        {!configured ? (
          user.role === "admin" ? (
            <Notice
              tone="neutral"
              title="Site bağlantısı kurulmadı: uygulama siparişleri ve masa çağrıları gelmiyor"
              action={<NoticeLink href="/panel/ayarlar">Ayarlar</NoticeLink>}
              tech="İki projeye (laffogato.net ve bu panel) aynı KARAOKE_SYNC_SECRET eklenince siparişler ve masa çağrıları buraya kendiliğinden gelir."
            />
          ) : (
            <Notice tone="neutral" title="Site bağlı değil: sipariş ve masa çağrısı buraya gelmez" text="Yöneticiye haber verin." />
          )
        ) : null}
        <OrdersBoard role={user.role} siteBase={siteUrl()} recipes={recipes} serverNow={now} />
        {soldOut?.configured ? <SoldOutCard role={user.role} entries={soldOut.entries} serverNow={now} branches={branchNames} lockedStaff={locked} /> : null}
        <div className="max-w-xl">
          <DeviceAlerts role={user.role} karaoke />
        </div>
      </div>
    </>
  );
}
