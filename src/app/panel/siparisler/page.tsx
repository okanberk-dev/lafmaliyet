import { and, eq, isNotNull } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import { FeatureOff } from "@/components/panel/feature-off";
import { DeviceAlerts } from "@/components/panel/live/device-alerts";
import { PageHeader } from "@/components/panel/page-header";
import { buttonClass } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { featureBranches, featureInScope } from "@/lib/branch-features";
import { tillBranches } from "@/lib/branches";
import { adminActor } from "@/lib/roles";
import { requireCan } from "@/server/auth/dal";
import { branchScope } from "@/server/branch-scope";
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
  const user = adminActor(await requireCan("kayit.yaz"));
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
  const view = await branchScope();
  const branchNames = tillBranches(view.branches).map((b) => b.name);
  const locked = view.locked && branchNames.length > 1;
  // Şube özellikleri (docs/SUBE.md › Şube özellikleri; şube kapsamı C P1-8): uygulama siparişi ve garson çağır seçili
  // şubede kullanılmıyorsa liste gelmez (canlı uç süzer); ikisi de kapalıysa bar ekranı yerine "Bu şubede kullanılmıyor".
  // Tükenenler kartı kalır: Tükendi sitenin menüsünde, bütün şubelerde
  const ordersHere = featureInScope("siparis", view.scope, view.branches);
  const callsHere = featureInScope("garson", view.scope, view.branches);
  const on = [...featureBranches(view.branches, "siparis"), ...featureBranches(view.branches, "garson")].filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
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
        {ordersHere || callsHere ? (
          <OrdersBoard role={user.role} siteBase={siteUrl()} recipes={recipes} serverNow={now} ordersOff={ordersHere ? null : "Uygulama siparişleri bu şubede kullanılmıyor; burada yalnız masa çağrıları görünür."} />
        ) : (
          <FeatureOff title="Siparişler bu şubede kullanılmıyor" path="/panel/siparisler" on={on} locked={view.locked} admin={user.role === "admin"} />
        )}
        {soldOut?.configured ? <SoldOutCard role={user.role} entries={soldOut.entries} serverNow={now} branches={branchNames} lockedStaff={locked} /> : null}
        <div className="max-w-xl">
          {/* Karaoke alarmlarının satırları yalnız karaoke bu kapsamda açıkken (şube özelliği) */}
          <DeviceAlerts role={user.role} karaoke={featureInScope("karaoke", view.scope, view.branches)} />
        </div>
      </div>
    </>
  );
}
