import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LogoMark } from "@/components/brand";
import { num } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/dal";
import { loadPublicMenu } from "@/server/data/menu";

export const metadata: Metadata = {
  title: "Menü",
  description: "L'Affogato menüsü: affogato, espresso bazlı kahveler, buzlu kahveler, frozen, smoothie ve tatlılar.",
};

export default function MenuPage({ searchParams }: PageProps<"/menu">) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="bg-coffee-950 text-coffee-50">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-6 pt-10 pb-8 text-center">
          <LogoMark className="h-14 w-14" />
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">L&apos;Affogato</h1>
          <p className="mt-1 text-sm text-coffee-300">Menü</p>
        </div>
      </header>
      <Suspense fallback={<p className="py-16 text-center text-coffee-500">Menü yükleniyor…</p>}>
        <MenuContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function MenuContent({ searchParams }: { searchParams: PageProps<"/menu">["searchParams"] }) {
  const sp = await searchParams;
  const menu = await loadPublicMenu();
  const preview = !!sp.onizleme && (await getCurrentUser())?.role === "admin";

  if (!menu.published && !preview) {
    return (
      <main className="mx-auto max-w-xl px-6 py-20 text-center">
        <p className="font-display text-2xl font-semibold text-coffee-950">Menümüz çok yakında burada</p>
        <p className="mt-2 text-coffee-600">Şimdilik bizi kafede ziyaret edin.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-coffee-700 underline">
          Ana sayfa
        </Link>
      </main>
    );
  }

  return (
    <>
      {preview && !menu.published ? (
        <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">Önizleme: menü henüz yayında değil (Ayarlar &gt; QR menü).</p>
      ) : null}
      <nav className="sticky top-0 z-10 border-b border-coffee-100 bg-paper/95 backdrop-blur" aria-label="Kategoriler">
        <div className="scroll-thin mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-3">
          {menu.categories.map((c) => (
            <a key={c.id} href={`#k${c.id}`} className="shrink-0 rounded-full bg-coffee-100 px-3 py-1.5 text-sm font-medium text-coffee-800 hover:bg-coffee-200">
              {c.name}
            </a>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-8">
        {menu.categories.map((c) => {
          const hasSizes = c.items.some((i) => i.sizes.some((s) => s.size !== "Tek"));
          return (
            <section key={c.id} id={`k${c.id}`} className="scroll-mt-20">
              <div className="mb-3 flex items-end justify-between border-b border-coffee-200 pb-2">
                <h2 className="font-display text-2xl font-semibold text-coffee-950">{c.name}</h2>
                {hasSizes ? (
                  <div className="flex gap-6 pr-1 text-xs font-semibold text-coffee-500">
                    <span className="w-16 text-right">Medium</span>
                    <span className="w-16 text-right">Large</span>
                  </div>
                ) : null}
              </div>
              <ul className="divide-y divide-coffee-100/70">
                {c.items.map((i) => {
                  const m = i.sizes.find((s) => s.size === "M");
                  const l = i.sizes.find((s) => s.size === "L");
                  const t = i.sizes.find((s) => s.size === "Tek");
                  return (
                    <li key={i.name} className="flex items-baseline justify-between gap-4 py-2.5">
                      <span className="text-[15px] font-medium text-coffee-950">{i.name}</span>
                      {hasSizes ? (
                        <span className="flex gap-6 pr-1 font-semibold text-coffee-900 tabular">
                          <span className="w-16 text-right">{m ? `${num(m.price)} ₺` : t ? `${num(t.price)} ₺` : "–"}</span>
                          <span className="w-16 text-right">{l ? `${num(l.price)} ₺` : "–"}</span>
                        </span>
                      ) : (
                        <span className="font-semibold text-coffee-900 tabular">{t ? `${num(t.price)} ₺` : m ? `${num(m.price)} ₺` : ""}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="pt-4 text-center text-xs text-coffee-500">Fiyatlarımıza KDV dahildir. · laffogato.net</p>
      </main>
    </>
  );
}
