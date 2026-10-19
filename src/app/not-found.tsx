import Link from "next/link";

import { LogoMark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <LogoMark className="h-12 w-12" />
      <h1 className="font-display text-3xl font-semibold text-coffee-950">Sayfa bulunamadı</h1>
      <p className="max-w-sm text-coffee-600">Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.</p>
      <div className="flex gap-3">
        <Link href="/" className="rounded-lg border border-coffee-200 px-4 py-2 text-sm font-medium text-coffee-900 hover:bg-coffee-50">
          Ana sayfa
        </Link>
        <Link href="/panel" className="rounded-lg bg-coffee-800 px-4 py-2 text-sm font-medium text-white hover:bg-coffee-900">
          Panel
        </Link>
      </div>
    </div>
  );
}
