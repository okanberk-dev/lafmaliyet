"use client";

import { BellRing, Check, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { refreshLive } from "@/components/panel/live/store";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { num } from "@/lib/format";
import { callAgeLabel, callReasonText } from "@/lib/site-orders/calls";
import type { SiteCall } from "@/lib/site-orders/schema";
import { ackTableCall } from "@/server/actions/table-calls";

/**
 * Eylemden sonra canlı veri. refreshLive yolda bir istek varsa onu bekler; o istek eylemden önce gönderildiyse eski
 * listeyle dönebilir, ikinci çağrı yeni hâli alır (yolda istek yoksa ikincisi 304).
 */
async function refreshAfterAck(): Promise<void> {
  await refreshLive();
  await refreshLive();
}

/**
 * "Masa çağrıları" (docs/SITE-SIPARIS.md › Masa çağrıları): masadan "Garson çağır" ile gelen açık çağrılar, en uzun
 * bekleyen önde. Kart: masa (kalın), sebep ("Garson çağırıyor", "Su istiyor", "Peçete istiyor"; bilinmeyen sebep
 * "Çağırıyor"), ne zaman ve büyük "Gördüm" (tek dokunuş, onay yok; sitenin imzalı ucuna gider, ardından liste yeniden
 * çekilir). Çağrının zili kabuktaki uyarı motorunda çalar (alert-center.tsx).
 */
export function TableCalls({ calls, now, siteWide = null }: { calls: SiteCall[]; now: number; /** "Bütün şubeler" (şube ayrımı parça 6) */ siteWide?: string | null }) {
  return (
    <Card>
      <CardHeader
        icon={<BellRing />}
        title="Masa çağrıları"
        description="Masaya gidince Gördüm'e dokunun; çağrı sitede de kapanır."
        meta={
          <>
            <Badge tone="amber" dot>
              {num(calls.length)} masa bekliyor
            </Badge>
            {siteWide ? <Badge tone="gray">{siteWide}</Badge> : null}
          </>
        }
      />
      <div className="px-5 pb-5">
        <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Açık masa çağrıları">
          {calls.map((c) => (
            <CallCard key={c.id} call={c} now={now} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function CallCard({ call: c, now }: { call: SiteCall; now: number }) {
  const [pending, start] = useActionTransition();
  const [tapped, setTapped] = useState(false);
  const busy = useRef(false);
  const ack = () => {
    // Geçiş başlamadan gelen ikinci dokunuş gönderilmez
    if (busy.current) return;
    busy.current = true;
    setTapped(true);
    start(async () => {
      try {
        const res = await ackTableCall({ id: c.id });
        if (res.ok) toast.success(res.data.message, res.data.note ? { description: res.data.note } : undefined);
        else toast.error(res.error);
      } catch {
        toast.error("Panele ulaşılamadı; bağlantıyı kontrol edip tekrar deneyin.");
      } finally {
        await refreshAfterAck();
        busy.current = false;
        setTapped(false);
      }
    });
  };
  const inFlight = pending || tapped;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-3.5 ring-2 ring-brass-500" aria-busy={inFlight || undefined}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xl leading-7 font-semibold tracking-tight break-words text-ink">{c.label}</p>
          <p className="mt-0.5 text-[15px] leading-6 font-medium text-warn">{callReasonText(c.reason)}</p>
        </div>
        <span className="text-[13px] text-ink-mute tabular">{callAgeLabel(c.createdAt, now)}</span>
      </div>
      <Button
        variant="primary"
        size="lg"
        className="h-auto min-h-12 w-full py-2 text-base"
        disabled={inFlight}
        onClick={ack}
        aria-label={`${c.label}: Gördüm`}
      >
        {inFlight ? <LoaderCircle size={18} className="shrink-0 animate-spin" aria-hidden="true" /> : <Check size={18} className="shrink-0" aria-hidden="true" />}
        Gördüm
      </Button>
    </li>
  );
}
