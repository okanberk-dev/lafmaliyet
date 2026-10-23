"use client";

import { ExternalLink, Globe, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { dateTimeTR, monthLabel, money, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { refreshSiteSales } from "@/server/actions/site-sales";

/** Bir ayın online satışı (KDV hariç, TL) ve kaydın bilgisi; sunucu sayfası hazırlar */
export interface SiteSalesMonthView {
  month: string;
  pulledAt: string;
  closed: boolean;
  cafe: number;
  shop: number;
  karaoke: number;
  total: number;
  cafeOrders: number;
  shopOrders: number;
  bookings: number;
  /** Panelden elle girilen siparişler (KDV dahil): ModPOS'ta olduğu için eklenmedi */
  manualOrders: number;
  manualNet: number;
  /** Kasada (nakit / kart cihazı) ödenen uygulama ve web siparişleri (KDV dahil): ModPOS'ta da çalındığı için eklenmedi */
  counterOrders: number;
  counterNet: number;
  /** Karaoke iadesi bekleyen (KDV dahil): iptal edilmiş, parası henüz geri ödenmemiş; karaoke tutarının içinde */
  refundPending: number;
  /** Panel ürününe bağlı olmayan kafe satırı */
  unmapped: number;
}

export interface SiteSalesCardData {
  configured: boolean;
  lastPullAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Yılın çekilmiş ayları, yeniden eskiye */
  months: SiteSalesMonthView[];
  /** Elle çekilebilecek aylar (bu yılın bu aya kadarki ayları), yeniden eskiye */
  choices: string[];
  /** "Siteden yenile"nin çektiği aylar: bu ay ve önceki iki ay (günlük işle aynı) */
  refreshMonths: string[];
  sitePanelUrl: string;
  /** Oranı saklı olmayan siparişlere uygulanan KDV (Ayarlar › Oranlar) */
  kdvRate: number;
  /** Oranı saklı olmayan karaoke rezervasyonlarının oranı (Ayarlar › Hizmet satışı KDV) */
  serviceKdvRate: number;
}

/**
 * Gelir-gider'de laffogato.net online satışlarının kaynağı (docs/SITE-SATIS.md): hangi ayın ne zaman çekildiği, ayın
 * kapanıp kapanmadığı, son hata ve "Siteden yenile". Rakamlar tabloda Maliyet bölümünde ayrı gelir satırlarıdır (KDV
 * hariç); ModPOS cirosuna eklenmez, kâr / zarar ve oranlar ikisinin toplamıyla hesaplanır.
 */
export function SiteSalesCard({ data }: { data: SiteSalesCardData }) {
  const [pending, start] = useTransition();
  const [busyMonth, setBusyMonth] = useState<string | null>(null);
  const [pick, setPick] = useState(data.choices.find((m) => !data.months.some((x) => x.month === m)) ?? data.choices[0] ?? "");

  const health = !data.configured
    ? { tone: "gray" as const, text: "Kurulmadı" }
    : data.lastError
      ? { tone: "red" as const, text: "Son çekme hatalı" }
      : data.lastOkAt
        ? { tone: "green" as const, text: "Bağlı" }
        : { tone: "amber" as const, text: "Henüz çekilmedi" };

  function pull(months: string[]) {
    setBusyMonth(months.length === 1 ? months[0] : "*");
    start(async () => {
      const res = await refreshSiteSales(months);
      setBusyMonth(null);
      if (!res.ok) return void toast.error("Siteden çekilemedi", { description: res.error, duration: 10_000 });
      const { ok, failed } = res.data;
      if (failed.length) toast.warning(`${ok.join(", ")} çekildi`, { description: failed.map((f) => `${monthLabel(f.month)}: ${f.error}`).join(" · "), duration: 10_000 });
      else toast.success("laffogato.net'ten çekildi", { description: ok.join(", ") });
    });
  }

  return (
    <Card>
      <CardHeader
        icon={<Globe />}
        title="laffogato.net online satışları"
        description="Uygulama ve web kafe siparişleri, mağaza kolileri ve ön ödemeli karaoke: tabloda Maliyet bölümünde ayrı gelir satırları (KDV hariç). Kasadan (ModPOS) geçmez; AYLIK CİRO'ya eklenmez, kâr ve oranlar ikisinin toplamıyla hesaplanır."
        meta={
          <Badge tone={health.tone} dot>
            {health.text}
          </Badge>
        }
        actions={
          data.configured ? (
            <Button variant="secondary" size="sm" onClick={() => pull(data.refreshMonths)} disabled={pending}>
              <RefreshCw size={14} className={cn(pending && busyMonth === "*" && "animate-spin")} aria-hidden="true" /> Siteden yenile
            </Button>
          ) : undefined
        }
      />
      <CardContent className="space-y-3 text-sm">
        {!data.configured ? (
          <p className="text-[13px] leading-5 text-ink-mute">
            Bağlantı karaoke ve menüyle aynı anahtarı kullanır: Vercel&apos;de iki projeye de aynı değerle{" "}
            <code className="rounded bg-surface px-1 font-mono text-xs ring-1 ring-line">KARAOKE_SYNC_SECRET</code> ekleyin. Kurulana kadar tabloda online satır
            görünmez.
          </p>
        ) : (
          <>
            {data.lastError ? <p className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad">{data.lastError}</p> : null}
            {data.months.length ? (
              <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                {data.months.map((m) => (
                  <li key={m.month} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1 font-medium text-ink">
                        {monthLabel(m.month)}
                        <Badge tone={m.closed ? "gray" : "blue"}>{m.closed ? "Ay kapandı" : "Ay sürüyor"}</Badge>
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-base font-semibold text-ink tabular">{tl(m.total)}</span>
                        <IconButton label={`${monthLabel(m.month)} online satışlarını siteden yenile`} onClick={() => pull([m.month])} disabled={pending}>
                          <RefreshCw size={14} className={cn(pending && busyMonth === m.month && "animate-spin")} />
                        </IconButton>
                      </div>
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-ink-soft tabular">
                      Kafe {tl(m.cafe)} <span className="text-ink-mute">({num(m.cafeOrders)} sipariş)</span> · Mağaza {tl(m.shop)}{" "}
                      <span className="text-ink-mute">({num(m.shopOrders)})</span> · Karaoke {tl(m.karaoke)} <span className="text-ink-mute">({num(m.bookings)})</span>
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-ink-mute">
                      Çekildi {dateTimeTR(m.pulledAt)}
                      {m.manualOrders ? ` · panelden elle girilen ${num(m.manualOrders)} sipariş (${money(m.manualNet)}, KDV dahil) ModPOS'ta olduğu için eklenmedi` : ""}
                      {m.counterOrders ? ` · kasada ödenen ${num(m.counterOrders)} uygulama siparişi (${money(m.counterNet)}, KDV dahil) ModPOS'ta da çalındığı için eklenmedi` : ""}
                      {m.refundPending ? ` · karaokede iadesi bekleyen ${money(m.refundPending)} (KDV dahil; geri ödenince tutardan düşer)` : ""}
                      {m.unmapped ? ` · ${num(m.unmapped)} kafe satırı panel ürününe bağlı değil (tutarlılıkta sayılmaz)` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute ring-1 ring-line">
                Bu yıl için henüz çekilmedi. Her sabah bu ay ve önceki iki ay (geç gelen iadeler) kendiliğinden çekilir; şimdi çekmek için Siteden yenile.
              </p>
            )}
            {data.choices.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="site-sales-month" className="text-[13px] text-ink-mute">
                  Başka bir ay
                </label>
                <Select id="site-sales-month" value={pick} onChange={(e) => setPick(e.target.value)} className="w-auto">
                  {data.choices.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                      {data.months.some((x) => x.month === m) ? "" : " (çekilmedi)"}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" size="sm" onClick={() => pick && pull([pick])} disabled={pending || !pick}>
                  Siteden çek
                </Button>
              </div>
            ) : null}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-ink-mute">
              <span>
                KDV hariç = net − KDV − oranı saklı olmayan siparişlerin %{num(data.kdvRate * 100, 2)} KDV&apos;si{" "}
                <InfoTip
                  text={`Site her siparişin satıldığı oranı saklar; 17 Ekim 2026 öncesi siparişlerde oran yoktur, panel onları Ayarlar'daki KDV oranıyla (${pct(data.kdvRate, 0)}; karaoke rezervasyonları hizmet oranıyla, ${pct(data.serviceKdvRate, 0)}) ayırır. Ödül kuponuyla bedava verilen içeceğin KDV'si tam fiyattan doğar: o ay KDV hariç gelir eksi çıkabilir.`}
                />
              </span>
              <span>Son çekme {data.lastPullAt ? dateTimeTR(data.lastPullAt) : "—"}</span>
              <a
                href={data.sitePanelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                laffogato.net paneli <ExternalLink size={13} aria-hidden="true" />
              </a>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
