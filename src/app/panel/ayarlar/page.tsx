import { desc } from "drizzle-orm";
import { ChevronRight, ExternalLink, FileSpreadsheet, Globe, HardDriveDownload, Users } from "lucide-react";
import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass, ButtonLink } from "@/components/ui/button";
import { CardContent } from "@/components/ui/card";
import { InfoTip, Skeleton } from "@/components/ui/misc";
import { logPerson } from "@/lib/activity-person";
import { backupCardSummary, backupDue, lastBackupText, sizeText } from "@/lib/backup/format";
import { dateTimeTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { appUrl } from "@/server/auth/tokens";
import { loadBackupInfo } from "@/server/backup/state";
import { loadModel } from "@/server/data/dataset";
import { getDb, schema as s } from "@/server/db";
import { readSyncState, syncKaraoke } from "@/server/karaoke/sync";
import { siteLinkSecret, siteUrl } from "@/server/site-link";
import { readMenuSyncState, syncSiteMenu } from "@/server/site-menu/sync";
import { readOrdersState, syncSiteOrders } from "@/server/site-orders/sync";
import { readSalesState, syncSiteSales } from "@/server/site-sales/sync";

import { BackupDownload } from "./backup-client";
import { impactData } from "./impact";
import { JobsCard } from "./jobs-card";
import { PhotoReadingCard } from "./photo-card";
import { SectionCard } from "./section-card";
import { SettingsNav } from "./section-nav";
import { SiteLinksTest } from "./site-links-test";
import { SETTINGS_SECTIONS } from "./sections";
import { ActivityLog, CategoriesEditor, SettingsForm } from "./settings-client";

export const metadata: Metadata = { title: "Ayarlar" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Ayarlar"
        eyebrow="Sistem"
        excel="Ayarlar"
        description="Bir değeri değiştirince etkisi altta hemen görünür (durumu değişen ürünler, maliyet oranı, başabaş); Kaydet'e basınca bütün hesaplar güncellenir."
      />
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

/**
 * Geniş ekranda solda bölüm gezinmesi, sağda kartlar; tablette gezinme üstte şerit olur; telefonda şerit yok,
 * bölümler akordeon (section-card.tsx).
 * Kaydedilmemiş değişiklik varken (form `data-dirty`) alttaki yüzen kaydet çubuğu son kartı örtmesin diye boşluk bırakılır.
 */
function SettingsLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div className="xl:grid xl:grid-cols-[13.5rem_minmax(0,1fr)] xl:gap-8">
      {nav}
      <div className="@container min-w-0 space-y-4 has-[[data-dirty]]:pb-28">{children}</div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <SettingsLayout
      nav={
        <>
          <div className="mb-4 flex gap-1 overflow-hidden max-sm:hidden xl:hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-28 shrink-0" />
            ))}
          </div>
          <div className="hidden space-y-2 rounded-3xl bg-panel p-3 xl:block" aria-hidden="true">
            {SETTINGS_SECTIONS.map((sec) => (
              <div key={sec.id} className="h-11 animate-pulse rounded-lg bg-surface/70" />
            ))}
          </div>
        </>
      }
    >
      {/* Telefonda bölümler kapalı akordeon satırları olarak gelir: iskelet de o yükseklikte */}
      <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-28 rounded-3xl max-sm:h-20" />
        {["h-64", "h-72", "h-56", "h-72"].map((h, i) => (
          <Skeleton key={i} className={`${h} rounded-3xl max-sm:h-20`} />
        ))}
      </div>
    </SettingsLayout>
  );
}

/**
 * Kullanıcı yönetimi ayrı sayfada; Ayarlar'da en üstte görünür bir giriş kartı (sahibi orada arıyor). Telefonda
 * öteki bölümlerle aynı satır, dokununca doğrudan Kullanıcılar ekranı açılır.
 */
function UsersLinkCard() {
  return (
    <SectionCard
      id="kullanicilar"
      href="/panel/kullanicilar"
      icon={<Users />}
      title="Kullanıcılar & roller"
      summary="Kullanıcı ekle, parola, iki adımlı doğrulama"
      description="Kullanıcı ekle, parola, iki adımlı doğrulama. Giriş e-postasını ve parolayı siz belirleyin ya da davet bağlantısı gönderin."
      actions={
        <ButtonLink href="/panel/kullanicilar" variant="primary">
          Kullanıcıları yönet <ChevronRight size={16} />
        </ButtonLink>
      }
    />
  );
}

/**
 * Yedek: paneldeki bütün verinin geri yüklenebilir tek dosyası (parolayla; /api/yedek, docs/YEDEK.md) ve okunabilir
 * Excel kopyası (/api/export; geri yüklenmez). Son yedek 30 günden eskiyse rozet çıkar, canlıda zil de hatırlatır
 * (src/lib/job-health.ts › systemAlerts). Geri yükleme panelde yok: bilgisayardan bir komutla yapılır.
 */
async function BackupCard() {
  const info = await loadBackupInfo().catch((e) => {
    console.error("Yedek bilgisi okunamadı", e);
    return null;
  });
  const now = new Date();
  const last = info?.last ?? null;
  return (
    <SectionCard
      id="yedek"
      icon={<HardDriveDownload />}
      title="Yedek"
      summary={info ? backupCardSummary(last, now) : "Durum okunamadı"}
      description={
        <>
          Paneldeki bütün veri tek dosyada iner ve gerekirse geri yüklenir. Ayda bir indirip bilgisayarınızda ya da Google Drive&apos;da saklayın. Parolalar
          dosyaya yazılmaz; dosyada ciro, maaş ve IBAN&apos;lar var, kimseyle paylaşmayın.{" "}
          <InfoTip text="Veritabanı Neon'da da kendiliğinden yedeklenir ama yalnız kısa bir süre geriye gidilebilir; bu dosya sizde kalan uzun süreli kopyadır. Geri yükleme panelden yapılmaz (tek dokunuşla bütün veri değişmesin); bilgisayardan bir komutla yapılır, adımlar docs/YEDEK.md'de. Excel kopyası okunmak içindir, geri yüklenmez." />
        </>
      }
      actionsClassName="max-sm:w-full"
      actions={
        <>
          <BackupDownload uploads={info?.uploads ?? { count: 0, bytes: 0 }} last={last ? { dataBytes: last.dataBytes } : null} />
          {/* Dosya indiren rota: düz bağlantı (istemci yönlendirmesi önce sayfa isteği yapıp ikinci kez indirmesin) */}
          <a href="/api/export" download className={buttonClass("secondary", "md", "max-sm:w-full")}>
            <FileSpreadsheet size={16} aria-hidden="true" /> Excel kopyası
          </a>
        </>
      }
    >
      <CardContent>
        {info ? (
          <div className="space-y-1 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {last ? (
                <>
                  <span className="text-ink">
                    <span className="text-ink-mute">Son yedek:</span> {lastBackupText(last)}
                  </span>
                  {backupDue(last.at, now) ? (
                    <Badge tone="amber" dot>
                      30 günü geçti
                    </Badge>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="text-ink">Henüz yedek indirilmedi.</span>
                  <Badge tone="amber" dot>
                    Yedek yok
                  </Badge>
                </>
              )}
            </p>
            {info.uploads.count > 0 ? (
              <p className="text-[13px] text-ink-mute">
                Yüklenen fatura belgeleri: {info.uploads.count} dosya · {sizeText(info.uploads.bytes)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="rounded-2xl bg-bad-soft px-4 py-3 text-[13px] text-bad">Son yedeğin bilgisi okunamadı; sayfayı yenileyin. İndirme yine çalışır.</p>
        )}
      </CardContent>
    </SectionCard>
  );
}

/** Bir bağlantının son çekme durumu: son deneme hatalıysa "Hata", başarılı çekme varsa "Bağlı" */
function linkHealth(configured: boolean, okAt: string | null, tryAt: string | null, error: string | null) {
  if (!configured) return { tone: "gray" as const, text: "Kurulmadı" };
  if (error && (!okAt || Date.parse(tryAt ?? "") >= Date.parse(okAt))) return { tone: "red" as const, text: "Hata" };
  if (okAt) return { tone: "green" as const, text: "Bağlı" };
  return { tone: "amber" as const, text: "Henüz çekilmedi" };
}

/**
 * laffogato.net bağlantılarının tek yerden durumu (karaoke, menü, uygulama siparişleri, online satışlar): son başarılı
 * çekme, son ping, hata ve her birinin ekranı; sitenin yönetim paneline bağlantı. Dört bağlantı aynı anahtarı
 * (KARAOKE_SYNC_SECRET) ve imzayı kullanır (docs/KARAOKE.md, SITE-MENU.md, SITE-SIPARIS.md, SITE-SATIS.md).
 */
async function SiteLinksCard() {
  const configured = Boolean(siteLinkSecret());
  const [karaoke, menu, orders, sales] = await Promise.all([readSyncState(), readMenuSyncState(), readOrdersState(), readSalesState()]);
  const rows = [
    {
      key: "karaoke",
      title: "Karaoke rezervasyonları",
      href: "/panel/karaoke",
      health: linkHealth(configured, karaoke.lastOkAt, karaoke.lastTryAt, karaoke.lastError),
      okAt: karaoke.lastOkAt,
      tryAt: karaoke.lastTryAt,
      pingAt: karaoke.lastPingAt,
      error: karaoke.lastError,
    },
    {
      key: "menu",
      title: "Menü: fiyat ve Satışta / Tükendi",
      href: "/panel/urunler/site",
      health: linkHealth(configured, menu.lastOkAt, menu.lastPullAt, menu.lastError),
      okAt: menu.lastOkAt,
      tryAt: menu.lastPullAt,
      pingAt: menu.lastPingAt,
      error: menu.lastError,
    },
    {
      key: "orders",
      title: "Uygulama siparişleri (bar ekranı)",
      href: "/panel/karaoke",
      health: linkHealth(configured, orders.lastOkAt, orders.lastPullAt, orders.lastError),
      okAt: orders.lastOkAt,
      tryAt: orders.lastPullAt,
      pingAt: orders.lastPingAt,
      error: orders.lastError,
    },
    {
      key: "sales",
      title: "Online satışlar (gelir-gider, tutarlılık, kasa)",
      href: "/panel/gelir-gider",
      health: linkHealth(configured, sales.lastOkAt, sales.lastPullAt, sales.lastError),
      okAt: sales.lastOkAt,
      tryAt: sales.lastPullAt,
      pingAt: null,
      error: sales.lastError,
    },
  ];
  const errors = rows.filter((r) => r.health.tone === "red").length;
  // Eski bir hata (son deneme yarım saatten eski) kendiliğinden yeniden denenir: sayfa beklemez, bir sonraki açılışta
  // kart yeni durumu gösterir. Hata gerçekse yeni zamanıyla geri gelir; "Bağlantıları sına" hepsini hemen dener.
  const nowMs = new Date().getTime();
  const staleRed = configured
    ? rows.filter((r) => r.health.tone === "red" && (!r.tryAt || nowMs - Date.parse(r.tryAt) > 30 * 60_000)).map((r) => r.key)
    : [];
  if (staleRed.length) {
    after(async () => {
      const run: Record<string, () => Promise<unknown>> = {
        karaoke: () => syncKaraoke("manual"),
        menu: () => syncSiteMenu("manual"),
        orders: () => syncSiteOrders("manual"),
        sales: () => syncSiteSales(),
      };
      for (const key of staleRed) {
        try {
          await run[key]?.();
        } catch (e) {
          console.error("[ayarlar] bağlantı yeniden denemesi", key, e instanceof Error ? e.message : e);
        }
      }
    });
  }
  return (
    <SectionCard
      id="site"
      icon={<Globe />}
      title="laffogato.net"
      summary={!configured ? "Bağlantı kurulmadı" : errors ? `${errors} bağlantıda hata` : "Karaoke, menü, siparişler, online satışlar"}
      description={
        configured
          ? "Kafenin sitesiyle dört bağlantı: aynı anahtar (KARAOKE_SYNC_SECRET) ve imza. Site her değişiklikte panele imzalı ping atar, panel imzalı tek okumayla çeker."
          : "Bağlantı kurulmadı: Vercel'de iki projeye de (laffogato.net ve bu panel) aynı değerle KARAOKE_SYNC_SECRET ekleyin (en az 32 karakter), ikisini yeniden yayınlayın."
      }
      actionsClassName="max-sm:w-full"
      actions={
        <>
          {configured ? <SiteLinksTest /> : null}
          <a href={`${siteUrl()}/admin`} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md", "max-sm:w-full")}>
            laffogato.net paneli <ExternalLink size={15} aria-hidden="true" />
          </a>
        </>
      }
    >
      <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={r.href} className="font-medium text-ink underline decoration-transparent underline-offset-2 hover:decoration-ink">
                  {r.title}
                </Link>
                <Badge tone={r.health.tone} dot>
                  {r.health.text}
                </Badge>
              </p>
              {configured ? (
                <p className="mt-0.5 text-[13px] text-ink-mute">
                  Son çekme {r.okAt ? dateTimeTR(r.okAt) : "—"}
                  {r.key !== "sales" ? ` · sitenin son pingi ${r.pingAt ? dateTimeTR(r.pingAt) : "—"}` : " · her sabah ve Siteden yenile"}
                </p>
              ) : null}
              {r.health.tone === "red" && r.error ? (
                <p className="mt-1 rounded-lg bg-bad-soft px-2.5 py-1.5 text-[13px] text-bad">
                  {r.tryAt ? `${dateTimeTR(r.tryAt)}: ` : null}
                  {r.error}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

const TZ = "Europe/Istanbul";
/** Kafenin saatine göre gün anahtarı (YYYY-MM-DD) */
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** İşlem geçmişi gün başlıkları: "Bugün", "Dün", "17 Ekim 2026 Cumartesi" */
function dayLabeler(now: Date) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  return (d: Date) => {
    const k = dayKey(d);
    if (k === today) return "Bugün";
    if (k === yesterday) return "Dün";
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: TZ });
  };
}

async function SettingsContent() {
  await requireAdmin();
  const db = getDb();
  const [model, log, accounts] = await Promise.all([
    loadModel(),
    db.select().from(s.activityLog).orderBy(desc(s.activityLog.at), desc(s.activityLog.id)).limit(60),
    // Kaydın hesabı: ad tek başına yanıltabiliyorsa (sonradan değişti ya da başka hesap aynı adı taşıyor) e-postası da
    db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const productCount = new Map<number, number>();
  for (const p of model.ds.products) productCount.set(p.categoryId, (productCount.get(p.categoryId) ?? 0) + 1);
  const dayLabel = dayLabeler(new Date());

  return (
    <SettingsLayout nav={<SettingsNav />}>
      <UsersLinkCard />
      <SettingsForm settings={model.settings} water={model.water} data={impactData(model)} menuUrls={{ panel: `${appUrl()}/menu`, site: `${siteUrl()}/menu` }} />
      <div className="grid gap-4 @5xl:grid-cols-2">
        <CategoriesEditor categories={model.categories.map((c) => ({ id: c.id, name: c.name, count: productCount.get(c.id) ?? 0 }))} />
        <ActivityLog
          entries={log.map((l) => ({
            id: l.id,
            at: dateTimeTR(l.at),
            iso: l.at.toISOString(),
            day: dayKey(l.at),
            dayLabel: dayLabel(l.at),
            time: l.at.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }),
            userName: l.userName,
            person: logPerson(l.userName, (l.userId !== null && accountById.get(l.userId)) || null, accounts),
            action: l.action,
            detail: l.detail,
          }))}
        />
      </div>
      <JobsCard />
      <SiteLinksCard />
      <PhotoReadingCard />
      <BackupCard />
    </SettingsLayout>
  );
}
