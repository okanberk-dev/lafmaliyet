"use client";

import { BarChart3, ExternalLink, History, Plug, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { refreshLive } from "@/components/panel/live/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { KeyValue, Stat } from "@/components/ui/misc";
import { dateTimeTR, num, tl } from "@/lib/format";
import { dayLabel, isHold, isLive, sessionEnd, sessionStart, timeRange, type KaraokeSessionDTO } from "@/lib/karaoke/session";
import { cn } from "@/lib/utils";
import type { SyncState } from "@/server/karaoke/sync";
import { syncKaraokeNow } from "@/server/actions/karaoke";

export interface MonthStats {
  reservations: number;
  hours: number;
  revenueMinor: number;
  cancelled: number;
  walkIns: number;
  walkInHours: number;
}

/**
 * Yöneticinin karaoke takibi: bu ayın özeti (rezervasyon, saat, ciro, iptal, rezervasyonsuz oturum), son 30 günün
 * oturumları ve laffogato.net bağlantısının durumu. Rezervasyonu onaylama, iptal ve iade sitenin panelinde kalır.
 */
export function KaraokeAdmin({
  history,
  stats,
  monthLabel,
  sync,
  configured,
  devices,
  siteAdminBase,
  nowMs,
}: {
  history: KaraokeSessionDTO[];
  stats: MonthStats;
  monthLabel: string;
  sync: SyncState | null;
  configured: boolean;
  devices: number;
  siteAdminBase: string;
  /** Sayfanın çizildiği an ("Bugün", "Dün" etiketleri için) */
  nowMs: number;
}) {
  const [pending, start] = useTransition();
  const now = nowMs;

  function syncNow() {
    start(async () => {
      const res = await syncKaraokeNow();
      if (!res.ok) return void toast.error(res.error);
      toast.success("laffogato.net ile eşitlendi");
      await refreshLive();
    });
  }

  const health = !configured
    ? { tone: "gray" as const, text: "Kurulmadı" }
    : sync?.lastError && (!sync.lastOkAt || Date.parse(sync.lastTryAt ?? "") > Date.parse(sync.lastOkAt))
      ? { tone: "red" as const, text: "Hata" }
      : sync?.lastOkAt
        ? { tone: "green" as const, text: "Bağlı" }
        : { tone: "amber" as const, text: "Henüz eşitlenmedi" };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader icon={<BarChart3 />} title={`Bu ay · ${monthLabel}`} description="Sitedeki rezervasyonlar (iptaller hariç) ve panelden açılan sayaçlar" />
          <div className="grid grid-cols-2 gap-2 px-5 pb-5 lg:grid-cols-3">
            <Stat compact label="Rezervasyon" value={num(stats.reservations)} sub={`${num(stats.hours, 1)} saat`} />
            <Stat compact label="Ciro (sitede)" value={tl(stats.revenueMinor / 100)} sub="Ödenen ve kasada ödenecek" />
            <Stat compact label="İptal" value={num(stats.cancelled)} tone={stats.cancelled ? "warn" : "default"} />
            <Stat compact label="Rezervasyonsuz oturum" value={num(stats.walkIns)} sub={`${num(stats.walkInHours, 1)} saat`} />
          </div>
        </Card>
        <Card>
          <CardHeader icon={<History />} title="Son 30 gün" description="Biten ve iptal edilen oturumlar, yeniden eskiye" />
          {history.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {history.slice(0, 60).map((s) => (
                <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm", !isLive(s) && s.source === "site" && "opacity-60")}>
                  <span className="w-[8.5rem] shrink-0 text-ink-mute tabular">
                    {dayLabel(s.date, now)} {timeRange(sessionStart(s), sessionEnd(s))}
                  </span>
                  <span className={cn("min-w-0 flex-1 break-words text-ink", s.status === "cancelled" && "line-through")}>
                    {s.customerName || (s.source === "panel" ? "Rezervasyonsuz" : "İsimsiz")}
                    {s.guests ? <span className="text-ink-mute"> · {s.guests} kişi</span> : null}
                  </span>
                  <Badge tone={s.source === "panel" ? "gray" : s.status === "cancelled" ? "red" : isHold(s) ? "gray" : "green"}>
                    {s.source === "panel" ? "Panelden" : s.status === "cancelled" ? "İptal" : isHold(s) ? "Ödenmedi" : "Rezervasyon"}
                  </Badge>
                  {s.extraMinutes ? <span className="text-xs text-ink-mute">+{s.extraMinutes} dk</span> : null}
                  {s.totalMinor ? <span className="text-xs text-ink-mute tabular">{tl(s.totalMinor / 100)}</span> : null}
                  {s.externalId ? (
                    <a
                      href={`${siteAdminBase}/${encodeURIComponent(s.externalId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink-mute hover:text-ink"
                      aria-label="Sitenin panelinde aç"
                      title="Sitenin panelinde aç"
                    >
                      <ExternalLink size={14} />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-5 text-sm text-ink-mute">Son 30 günde oturum yok.</p>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader
          icon={<Plug />}
          title="laffogato.net bağlantısı"
          meta={
            <Badge tone={health.tone} dot>
              {health.text}
            </Badge>
          }
          actions={
            configured ? (
              <Button variant="secondary" size="sm" onClick={syncNow} disabled={pending}>
                <RefreshCw size={14} className={cn(pending && "animate-spin")} /> Şimdi eşitle
              </Button>
            ) : undefined
          }
        />
        <div className="space-y-3 px-5 pb-5 text-sm">
          {configured ? (
            <>
              <div className="divide-y divide-line rounded-2xl bg-surface px-4 ring-1 ring-line">
                <KeyValue className="py-2.5" label="Son eşitleme" value={sync?.lastOkAt ? dateTimeTR(sync.lastOkAt) : "—"} />
                <KeyValue className="py-2.5" label="Sitenin son pingi" value={sync?.lastPingAt ? dateTimeTR(sync.lastPingAt) : "—"} />
                <KeyValue className="py-2.5" label="Penceredeki rezervasyon" value={sync?.count !== null && sync?.count !== undefined ? num(sync.count) : "—"} />
                <KeyValue className="py-2.5" label="Bildirim alan cihaz" value={num(devices)} />
              </div>
              {health.tone === "red" && sync?.lastError ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">{sync.lastError}</p> : null}
              <p className="text-[13px] leading-5 text-ink-mute">
                Site her rezervasyon değişikliğinde panele imzalı bir ping atar; panel değişenleri hemen çeker ve cihazlara bildirir. Ayrıca bu sayfa açılınca en
                çok beş dakikada bir kontrol edilir. Sürekli sorgu yapılmaz.
              </p>
            </>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-5 text-ink-soft">
              <li>
                Güçlü bir anahtar üretin (ör. <code className="rounded bg-surface px-1 font-mono text-xs ring-1 ring-line">openssl rand -hex 32</code>).
              </li>
              <li>
                Vercel&apos;de iki projeye de (laffogato.net ve bu panel) aynı değerle <code className="rounded bg-surface px-1 font-mono text-xs ring-1 ring-line">KARAOKE_SYNC_SECRET</code>{" "}
                ekleyin, ikisini yeniden yayınlayın.
              </li>
              <li>Bu sayfayı yenileyin: “Şimdi eşitle” görünür, rezervasyonlar gelir. Ayrıntı: docs/KARAOKE.md.</li>
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}
