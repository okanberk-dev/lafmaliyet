import type { Metadata } from "next";
import { Suspense } from "react";

import { LafMark } from "@/components/brand";
import { num } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/dal";
import { loadPublicMenu } from "@/server/data/menu";

import { CategoryNav } from "./category-nav";

export const metadata: Metadata = {
  title: "Menü",
  description: "L'Affogato menüsü: affogato, espresso bazlı kahveler, buzlu kahveler, frozen, smoothie ve tatlılar.",
};

export default function MenuPage({ searchParams }: PageProps<"/menu">) {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="bg-[radial-gradient(120%_100%_at_20%_0%,#23876a_0%,#1d6d56_50%,#0c3b2d_100%)] text-[#fbf8f4]">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-10 pb-8 text-center">
          <LafMark tone="cream" className="h-14 w-auto" />
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight">L&apos;Affogato</h1>
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
            <span key={i} className="h-10 shrink-0 animate-pulse rounded-full bg-panel" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-3xl space-y-3 px-5 py-8">
        <span className="block h-8 w-48 animate-pulse rounded-lg bg-panel" />
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="block h-6 animate-pulse rounded-md bg-panel/70" />
        ))}
      </div>
    </div>
  );
}

const price = (v: number) => `${num(v)}\u00a0₺`;

async function MenuContent({ searchParams }: { searchParams: PageProps<"/menu">["searchParams"] }) {
  const sp = await searchParams;
  const menu = await loadPublicMenu();
  const preview = !!sp.onizleme && (await getCurrentUser())?.role === "admin";

  if (!menu.published && !preview) {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="font-display text-2xl font-bold text-ink">Menümüz çok yakında burada</p>
        <p className="mt-2 text-ink-mute">Şimdilik bizi kafede ziyaret edin.</p>
        <a href="https://laffogato.net" className="mt-4 inline-flex min-h-10 items-center px-2 text-sm font-medium text-brand-600 underline underline-offset-2">
          laffogato.net
        </a>
      </main>
    );
  }

  return (
    <>
      {preview && !menu.published ? (
        <p className="bg-warn-soft px-4 py-2 text-center text-sm text-warn">Önizleme: menü henüz yayında değil (Ayarlar › QR menü).</p>
      ) : null}
      {menu.categories.length ? <CategoryNav categories={menu.categories.map((c) => ({ id: c.id, name: c.name }))} /> : null}
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-8">
        {menu.categories.length === 0 ? (
          <p className="py-12 text-center text-ink-mute">
            {preview ? "Menüde gösterilecek ürün yok. Ürün kartında \u201cQR menüde göster\u201d açık ve ürün aktif olmalı." : "Menümüz hazırlanıyor; bizi kafede ziyaret edin."}
          </p>
        ) : null}
        {menu.categories.map((c) => {
          const hasSizes = c.items.some((i) => i.sizes.some((s) => s.size !== "Tek"));
          return (
            <section key={c.id} id={`k${c.id}`} className="scroll-mt-20">
              <div className="mb-2 flex items-end justify-between border-b border-line-strong pb-2">
                <h2 className="font-display text-2xl font-bold tracking-tight text-ink">{c.name}</h2>
                {hasSizes ? (
                  <div className="flex gap-6 pr-1 text-xs font-semibold text-ink-mute">
                    <span className="w-16 text-right">Medium</span>
                    <span className="w-16 text-right">Large</span>
                  </div>
                ) : null}
              </div>
              <ul className="divide-y divide-line">
                {c.items.map((i) => {
                  const m = i.sizes.find((s) => s.size === "M");
                  const l = i.sizes.find((s) => s.size === "L");
                  const t = i.sizes.find((s) => s.size === "Tek");
                  return (
                    <li key={i.name} className="flex items-baseline justify-between gap-4 py-2.5">
                      <span className="min-w-0 text-[15px] font-medium text-pretty text-ink">{i.name}</span>
                      {hasSizes ? (
                        <span className="flex shrink-0 gap-6 pr-1 font-semibold text-brand-700 tabular">
                          <span className="w-16 text-right">{m ? price(m.price) : t ? price(t.price) : <span aria-label="yok">–</span>}</span>
                          <span className="w-16 text-right">{l ? price(l.price) : <span aria-label="yok">–</span>}</span>
                        </span>
                      ) : (
                        <span className="shrink-0 font-semibold text-brand-700 tabular">{t ? price(t.price) : m ? price(m.price) : ""}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="pt-4 text-center text-xs text-ink-mute">Fiyatlarımıza KDV dahildir. · laffogato.net</p>
      </main>
    </>
  );
}
