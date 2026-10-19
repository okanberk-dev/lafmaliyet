import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { LogoMark } from "@/components/brand";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Giriş",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-coffee-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(200,135,62,0.35),transparent_55%),radial-gradient(circle_at_80%_90%,rgba(242,232,220,0.12),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-coffee-50">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <span className="font-display text-2xl font-semibold">L&apos;Affogato</span>
          </Link>
          <div className="max-w-md">
            <p className="font-display text-4xl leading-tight font-semibold">
              Her fincanın maliyetini, her ayın kârını tek yerden görün.
            </p>
            <p className="mt-4 text-coffee-200">
              Reçete kartları, hammaddeler, faturalar, satışlar, stok sayımı ve aylık gelir-gider. Excel&apos;deki bütün
              sistem, telefondan da kullanılabilir hâlde.
            </p>
          </div>
          <p className="text-sm text-coffee-400">laffogato.net</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-10 w-10" />
            <span className="font-display text-2xl font-semibold text-coffee-950">L&apos;Affogato</span>
          </div>
          <h1 className="font-display text-3xl font-semibold text-coffee-950">Yönetim paneli</h1>
          <p className="mt-2 text-sm text-coffee-600">Devam etmek için hesabınızla giriş yapın.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
