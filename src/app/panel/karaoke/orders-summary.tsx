"use client";

import { ArrowRight, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { buttonClass } from "@/components/ui/button";
import type { Role } from "@/lib/constants";
import { num } from "@/lib/format";

import { useOrdersFeed } from "../siparisler/orders-board";

/**
 * Karaoke ekranında uygulama siparişlerinin tek satırı (siparişler 6 Kas 2026'da kendi ekranına taşındı:
 * /panel/siparisler). "3 açık uygulama siparişi · 1 masa çağrısı" ve "Siparişler'e git"; açık sipariş ya da çağrı
 * yoksa ve son çekme başarılıysa satır yok. Bağlantı kurulu değilse de yok (karaoke ekranının başındaki kutu söylüyor).
 * Veri Siparişler ekranının kancasından: bar bu ekranda dursa da site ekran açılınca ve yoğunken yeniden sorulur, zil
 * kabukta çalar.
 */
export function OrdersSummary({ role, serverNow }: { role: Role; serverNow: number }) {
  const { data, list, calls } = useOrdersFeed(role, serverNow);
  if (!data?.configured) return null;
  const failing = Boolean(data.error);
  if (!list.length && !calls.length && !failing) return null;
  const parts = [
    list.length ? `${num(list.length)} açık uygulama siparişi` : null,
    calls.length ? `${num(calls.length)} masa çağrısı` : null,
    failing ? "siparişler şu an siteden alınamıyor" : null,
  ].filter(Boolean);
  const text = parts.join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      <ShoppingBag size={18} className="shrink-0 text-ink-mute" aria-hidden="true" />
      <p className="min-w-0 flex-1 basis-48 text-sm font-medium text-ink first-letter:uppercase">{text}</p>
      <Link href="/panel/siparisler" className={buttonClass("secondary", "sm")}>
        Siparişler&apos;e git <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
