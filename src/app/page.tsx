import { ArrowRight, Coffee, IceCreamCone, Lock } from "lucide-react";
import Link from "next/link";

import { LogoMark } from "@/components/brand";

export default function HomePage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-coffee-950 text-coffee-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(200,135,62,0.35),transparent_50%),radial-gradient(circle_at_85%_85%,rgba(242,232,220,0.10),transparent_45%)]" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <span className="font-display text-xl font-semibold">L&apos;Affogato</span>
        </span>
        <Link href="/giris" className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-coffee-200 hover:bg-white/5">
          <Lock size={12} /> Yönetim
        </Link>
      </header>
      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 pb-20">
        <p className="text-sm font-medium tracking-[0.2em] text-crema uppercase">Tuzla</p>
        <h1 className="mt-3 max-w-2xl font-display text-5xl leading-[1.05] font-semibold tracking-tight sm:text-7xl">
          Bir top vanilya, üzerine sıcak espresso.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-coffee-200">
          Affogato, espresso bazlı kahveler, buzlu kahveler, frozen ve smoothie&apos;ler, günlük tatlılar.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/menu" className="inline-flex items-center gap-2 rounded-full bg-coffee-50 px-6 py-3 font-semibold text-coffee-950 transition hover:bg-white">
            Menüyü gör <ArrowRight size={18} />
          </Link>
        </div>
        <div className="mt-16 grid max-w-2xl gap-6 text-sm text-coffee-300 sm:grid-cols-2">
          <div className="flex gap-3">
            <IceCreamCone className="mt-0.5 shrink-0 text-crema" size={20} />
            <p>Adını aldığımız L&apos;Affogato: vanilya dondurmanın üzerine sıcak espresso, yenilebilir bardakta.</p>
          </div>
          <div className="flex gap-3">
            <Coffee className="mt-0.5 shrink-0 text-crema" size={20} />
            <p>Sıcak ve buzlu kahveler, matcha, frozen ve smoothie&apos;ler; San Sebastian&apos;dan tiramisuya tatlılar.</p>
          </div>
        </div>
      </main>
      <footer className="relative mx-auto w-full max-w-5xl px-6 py-6 text-xs text-coffee-400">© L&apos;Affogato · laffogato.net</footer>
    </div>
  );
}
