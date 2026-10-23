import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LafMark } from "@/components/brand";
import { num } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/dal";
import { loadPublicMenu } from "@/server/data/menu";
import { siteUrl } from "@/server/site-link";

import { CategoryNav } from "./category-nav";
import { hasSizeColumns, menuPrices } from "./menu-rows";

export const metadata: Metadata = {
  title: "Menü",
  description: "L'Affogato menüsü: affogato, espresso bazlı kahveler, buzlu kahveler, frozen, smoothie ve tatlılar.",
  // Müşteri menüyü ana ekrana eklerse panelin uygulama bildirimi (start_url /panel) ve adı gelmesin
  manifest: null,
  appleWebApp: { capable: false, title: "L'Affogato Menü" },
  applicationName: "L'Affogato Menü",
  other: { "apple-mobile-web-app-capable": "no", "mobile-web-app-capable": "no" },
};

// Telefonun üst çubuğu menünün yeşil başlığıyla aynı renkte
export const viewport: Viewport = { themeColor: "#1d6d56" };

/** Çentikli telefonlarda yatay tutulunca içerik ekran kenarına yapışmasın */
const GUTTER = "pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))]";

export default function MenuPage({ searchParams }: PageProps<"/menu">) {
  return (
    <div id="ust" className="min-h-dvh bg-canvas">
      <header className="bg-[radial-gradient(120%_100%_at_20%_0%,#23876a_0%,#1d6d56_50%,#0c3b2d_100%)] text-[#fbf8f4]">
        <div className={`mx-auto flex max-w-3xl flex-col items-center pt-[calc(env(safe-area-inset-top)+2rem)] pb-7 text-center sm:pt-10 sm:pb-8 ${GUTTER}`}>
          <LafMark tone="cream" className="h-12 w-auto sm:h-14" />
          <h1 className="mt-3 font-display text-[2rem] leading-10 font-bold tracking-tight sm:text-4xl">L&apos;Affogato</h1>
          {/* "Fiyatlara KDV dahildir" notu fiyatlarla birlikte (menü yayında değilken fiyat yok) */}
          <p className="mt-1 text-sm text-[#d3e2d9]">Menü</p>
        </div>
      </header>
      <Suspense fallback={<MenuSkeleton />}>
        <MenuContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/** Yüklenirken kategori şeridi ve satırların yeri tutulur (sayfa zıplamasın) */
function MenuSkeleton() {
  return (
    <div aria-busy="true" aria-label="Menü yükleniyor">
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-3xl gap-2 overflow-hidden px-4 py-2.5">
          {[112, 72, 88, 72, 96].map((w, i) => (
            <span key={i} className="h-11 shrink-0 animate-pulse rounded-full bg-panel" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className={`mx-auto max-w-3xl space-y-3 py-8 ${GUTTER}`}>
        <span className="block h-8 w-48 animate-pulse rounded-lg bg-panel" />
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="block h-7 animate-pulse rounded-md bg-panel/70" />
        ))}
      </div>
    </div>
  );
}

async function MenuContent({ searchParams }: { searchParams: PageProps<"/menu">["searchParams"] }) {
  const sp = await searchParams;
  const menu = await loadPublicMenu();
  const preview = !!sp.onizleme && (await getCurrentUser())?.role === "admin";
  // Müşterinin tam menüsü laffogato.net'tedir: alerjenler, fiyat listesinin tarihi ve satış durumu orada (bu sayfada
  // yok). Yayında değilken ya da gösterilecek ürün yokken müşteri oraya gider, "çok yakında" çıkmazında kalmaz;
  // yöneticinin önizlemesi (?onizleme) burada kalır. Yönlendirme akışın içinde olduğu için tarayıcıda yapılır.
  const siteMenu = `${siteUrl()}/menu`;
  if (!preview && (!menu.published || menu.categories.length === 0)) redirect(siteMenu);

  return (
    <>
      {preview && !menu.published ? (
        <p className="bg-warn-soft px-4 py-2 text-center text-sm text-pretty text-warn">
          Önizleme: menü henüz yayında değil (Ayarlar › QR menü). Müşteri şimdilik laffogato.net menüsüne yönlenir.
        </p>
      ) : null}
      {menu.categories.length ? <CategoryNav categories={menu.categories.map((c) => ({ id: c.id, name: c.name }))} /> : null}
      {/* Altta "Başa dön" (44px, ana ekran çubuğunun üstünde) için boşluk: sayfa sonundaki laffogato.net bağlantısı onun altında kalmaz */}
      <main className={`mx-auto max-w-3xl space-y-10 pt-7 pb-[calc(max(1rem,env(safe-area-inset-bottom)+0.5rem)+4.5rem)] sm:pt-8 ${GUTTER}`}>
        {menu.categories.length ? (
          // space-y alttan boşluk verir (Tailwind 4): mb-4 ilk bölüme 1rem bırakır; eksi boşluk bölümü notun üstüne çekiyordu
          <div className="mb-4 text-center text-xs text-ink-mute">
            <p>Fiyatlara KDV dahildir.</p>
            <p>
              Alerjen bilgisi ve fiyat listesinin tarihi:{" "}
              <a href={siteMenu} className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2">
                {siteMenu.replace(/^https?:\/\//, "")}
              </a>
            </p>
          </div>
        ) : null}
        {menu.categories.length === 0 ? (
          <p className="py-12 text-center text-ink-mute">
            Menüde gösterilecek ürün yok. Ürün kartındaki anahtar “QR menüde görünür” olmalı ve ürün aktif olmalı (müşteri bu durumda laffogato.net menüsüne gider).
          </p>
        ) : null}
        {menu.categories.map((c) => {
          const sized = hasSizeColumns(c.items);
          return (
            // Başlık (sütun adlarıyla) kategori şeridinin (64px) altında yapışık kalır; çapayla gelince bölüm şeridin hemen altında başlar
            <section key={c.id} id={`k${c.id}`} className="scroll-mt-16" aria-labelledby={`k${c.id}-ad`}>
              <div className="sticky top-16 z-[5] -mx-1 mb-1 flex items-end justify-between gap-3 border-b border-line-strong bg-canvas/95 px-1 pt-2 pb-2 backdrop-blur-md">
                <h2 id={`k${c.id}-ad`} className="min-w-0 font-display text-[1.375rem] leading-7 font-bold tracking-tight text-pretty text-ink sm:text-2xl">
                  {c.name}
                  <span className="sr-only"> · {num(c.items.length)} ürün</span>
                </h2>
                {sized ? (
                  <div className="flex shrink-0 gap-4 pr-1 text-xs font-semibold text-ink-mute sm:gap-6" aria-hidden="true">
                    <span className="w-16 text-right">Medium</span>
                    <span className="w-16 text-right">Large</span>
                  </div>
                ) : null}
              </div>
              <ul className="divide-y divide-line">
                {c.items.map((i) => {
                  const prices = menuPrices(i, sized);
                  return (
                    <li key={i.name} className="flex min-h-12 items-center justify-between gap-4 py-2.5">
                      <span className="min-w-0 text-[15px] leading-5 font-medium text-pretty text-ink">{i.name}</span>
                      <span className={`flex shrink-0 pr-1 text-[15px] font-semibold text-brand-700 tabular ${sized ? "gap-4 sm:gap-6" : ""}`}>
                        {prices.map((p, j) => (
                          <span key={j} className={sized ? "w-16 text-right" : "text-right"}>
                            {sized ? <span className="sr-only">{j === 0 ? "Medium: " : "Large: "}</span> : null}
                            {p ?? (
                              <>
                                <span className="text-ink-quiet" aria-hidden="true">
                                  –
                                </span>
                                <span className="sr-only">yok</span>
                              </>
                            )}
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {menu.categories.length ? (
          <footer className="space-y-1 pt-2 text-center text-xs text-ink-mute">
            <p>Fiyatlarımıza KDV dahildir.</p>
            <p>
              <a href="https://laffogato.net" className="inline-flex min-h-11 items-center px-2 font-medium text-ink-soft underline-offset-2 hover:underline">
                laffogato.net
              </a>
            </p>
          </footer>
        ) : null}
      </main>
    </>
  );
}
