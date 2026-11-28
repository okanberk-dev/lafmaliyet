import { ExternalLink, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageSkeleton } from "@/components/ui/misc";
import { kasaDurumMetni, type KasaDurumu } from "@/lib/asilpos/kasa-durumu";
import { LISANS_ACIKLAMA, merkezUrl } from "@/lib/yonetim-host";
import { loadKasaDurumlari } from "@/server/asilpos/kasa-durumu";
import { requireYonetim } from "@/server/auth/dal";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";

export const metadata: Metadata = { title: "Lisans ve güncelleme" };

const DURUM_TONU: Record<KasaDurumu["durum"], "green" | "blue" | "gray"> = { kurulu: "green", bekliyor: "blue", yok: "gray" };

/**
 * Konsol › Lisans ve güncelleme (docs/planlar/yonetim-konsolu.md › K-A): Merkez'e bağlantı ve kısa açıklama, şubelerin
 * kasa durumu özeti (salt okunur; değişiklikler Şubeler ve kasalar sekmesinde). Merkez'in ekranlarını konsola almak
 * sonraki iş
 */
export default function LisansPage() {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Lisans ve güncelleme</h1>
        <p className="mt-1 max-w-[60ch] text-sm leading-6 text-ink-mute">{LISANS_ACIKLAMA}</p>
      </div>
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Icerik />
      </Suspense>
    </>
  );
}

async function Icerik() {
  await requireYonetim();
  const db = getDb();
  const subeler = (await listBranches(db)).filter((b) => b.kind === "fiziksel").sort((a, b) => Number(b.active) - Number(a.active));
  const durum = await loadKasaDurumlari(
    subeler.map((b) => b.id),
    db,
  );
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title="AsilPOS Merkez"
          description="Lisansı, dükkânları ve kasalara gönderilen güncellemeleri buradan yönetin."
          actions={
            <a href={merkezUrl()} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "sm")}>
              Merkez&apos;i aç
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          }
          actionsClassName="max-sm:w-full"
        />
      </Card>
      <Card>
        <CardHeader title="Şubelerin kasası" description="Salt okunur özet. Kurulum ve serbest bırakma Şubeler ve kasalar sekmesinde." />
        {subeler.length ? (
          <ul className="divide-y divide-line border-t border-line">
            {subeler.map((b) => {
              const d = durum[b.id] ?? { durum: "yok" };
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {b.name}
                      {b.active ? null : <span className="ml-2 text-[13px] font-normal text-ink-mute">(kapalı)</span>}
                    </p>
                    <p className="text-[13px] text-ink-mute">{kasaDurumMetni(d)}</p>
                  </div>
                  <Badge tone={DURUM_TONU[d.durum]}>{d.durum === "kurulu" ? "Kurulu" : d.durum === "bekliyor" ? "Bekliyor" : "Yok"}</Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Henüz fiziksel şube yok" />
        )}
      </Card>
    </div>
  );
}
