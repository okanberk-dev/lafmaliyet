import { ChevronDown, CreditCard, ShoppingBag } from "lucide-react";
import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { InfoTip, KeyValue } from "@/components/ui/misc";
import { channelDef, LINE_LABEL, type ChannelKey, type LineClass } from "@/lib/commission/channels";
import { rowOf, type ChannelMonth, type CommissionReport, type Flag } from "@/lib/commission/report";
import { dateTR, money, monthLabel, monthShort, pct } from "@/lib/format";
import { shiftMonth } from "@/lib/reminders";
import { cn } from "@/lib/utils";

import { PayoutButton } from "./channel-month-dialog";
import { dialogData, overMealLimit, payoutText, ratePartsText, sourceLabel, statusBadge, type TextTone } from "./texts";

/** Kartların çapası mobil üst çubuğun altında dursun (zilin ve e-postanın ?ay=…#kanal bağlantıları) */
export const ANCHOR = "scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4";

const LINE_TONE: Record<LineClass, Tone> = { komisyon: "gray", erken: "amber", yasak: "red", asli: "amber", reklam: "blue", diger: "gray" };
const FLAG_DOT: Record<Flag["level"], string> = { bad: "bg-bad", warn: "bg-brass-500", info: "bg-info" };
export const TEXT_TONE: Record<TextTone, string> = { default: "text-ink", good: "text-good", bad: "text-bad", warn: "text-warn", muted: "text-ink-mute" };

/** Uyarı satırları: renkli nokta (kırmızı, turuncu, mavi; gri: satış bilinmiyor) ve cümle */
export function FlagList({ flags, reason }: { flags: readonly Flag[]; reason?: string | null }) {
  if (!flags.length && !reason) return null;
  return (
    <ul className="space-y-1.5 text-[13px] leading-5">
      {flags.map((f) => (
        <li key={f.key} className="flex items-start gap-2 text-ink">
          <span aria-hidden="true" className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", FLAG_DOT[f.level])} />
          <span className="min-w-0">{f.text}</span>
        </li>
      ))}
      {reason ? (
        <li className="flex items-start gap-2 text-ink-mute">
          <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ink-quiet" />
          <span className="min-w-0">{reason}</span>
        </li>
      ) : null}
    </ul>
  );
}

/**
 * Kanalın kartı (§3.3, docs/KOMISYON.md): gerçek oran ve parçaları, satış ve kaynağı, kesilen; son altı ayın oranı;
 * uyarılar; faturalar ve kalemleri (kalemin kendi adı ve sınıfı); hakediş satırı ve düğmeleri. Seçilen ayda satırı
 * yoksa (önceki aylarda vardı) yalnız şerit ve "Hakediş geldi" (erken gelen havale de işaretlenebilir).
 */
export function ChannelCard({ channel, month, report }: { channel: ChannelKey; month: string; report: CommissionReport }) {
  const def = channelDef(channel);
  const meal = def.kind === "meal";
  const row = rowOf(report, channel, month);
  const badge = statusBadge(row);
  const three = !meal && row?.rate3 != null;
  const headline = three ? row!.rate3 : (row?.rate ?? null);
  const parts = row ? ratePartsText(row) : null;
  const history = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).map((m) => {
    const r = rowOf(report, channel, m);
    return { month: m, rate: r?.rate ?? null };
  });
  const payout = payoutText(row);
  const data = dialogData(def, month, row);
  const received = row?.payout.received != null;

  return (
    <Card id={channel} className={ANCHOR}>
      <CardHeader
        icon={meal ? <CreditCard /> : <ShoppingBag />}
        title={def.label}
        description={meal ? "Yemek kartı" : "Sipariş platformu"}
        meta={
          <Badge tone={badge.tone} dot>
            {badge.text}
          </Badge>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {row ? (
          <div className="grid gap-x-6 gap-y-3 rounded-2xl bg-surface p-4 ring-1 ring-line sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[13px] text-ink-mute">{three ? "Gerçek oran (3 ay)" : "Gerçek oran"}</p>
              <p className={cn("text-2xl font-semibold tracking-tight tabular", meal && overMealLimit(headline) ? "text-bad" : "text-ink")}>{headline !== null ? pct(headline) : "–"}</p>
              {parts ? <p className="mt-0.5 text-[13px] leading-5 text-ink-mute">{parts}</p> : null}
            </div>
            <dl className="min-w-0 divide-y divide-line self-start sm:-my-2">
              <KeyValue
                label="Satış"
                value={
                  row.sales ? (
                    <span className="flex flex-col items-end">
                      <span>{money(row.sales.amount)}</span>
                      <span className="text-xs text-ink-mute">{sourceLabel(row.sales.source, def.kind)}</span>
                    </span>
                  ) : (
                    <span className="text-ink-mute">bilinmiyor</span>
                  )
                }
              />
              <KeyValue
                label="Kesilen"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {money(row.feesTotal)} + KDV
                    <InfoTip text={`KDV dahil ${money(row.payable)}`} />
                  </span>
                }
              />
              {three ? <KeyValue label="Bu ay" value={row.rate !== null ? pct(row.rate) : "–"} /> : null}
            </dl>
          </div>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-ink-mute ring-1 ring-line">{monthLabel(month)} için bu kanalın faturası ya da işareti yok.</p>
        )}

        <ol className="grid grid-cols-6 gap-1 text-center text-xs" aria-label="Son altı ayın oranı">
          {history.map((h) => (
            <li key={h.month} className={cn("rounded-lg px-0.5 py-1.5", h.month === month ? "bg-surface font-semibold text-ink ring-1 ring-line" : "text-ink-mute")}>
              <span className="block">{monthShort(h.month)}</span>
              <span className={cn("block tabular", meal && overMealLimit(h.rate) && "text-bad")}>{h.rate !== null ? pct(h.rate) : "–"}</span>
            </li>
          ))}
        </ol>

        {row ? <FlagList flags={row.flags} reason={row.salesReason} /> : null}

        {row?.invoices.length ? <InvoiceDetails row={row} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
          <div className="min-w-0 flex-[1_1_14rem] text-[13px] leading-5">
            <p className={cn("font-medium", TEXT_TONE[payout.tone])}>{payout.text}</p>
            {payout.sub ? <p className="text-ink-mute">{payout.sub}</p> : null}
            {row?.mark?.note ? <p className="break-words text-ink-mute">Not: {row.mark.note}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
            <PayoutButton
              data={data}
              mode="satis"
              label={row?.mark?.sales != null ? "Satışı düzelt" : "Satışı yaz"}
              variant="ghost"
              className="max-sm:flex-1"
            />
            <PayoutButton
              data={data}
              mode={received ? "duzenle" : "geldi"}
              label={received ? "Düzenle" : "Hakediş geldi"}
              variant={received ? "ghost" : row?.invoices.length ? "primary" : "secondary"}
              className="max-sm:flex-1"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Faturalar ve kalemleri (kapalı başlar): tarih, numara, KDV hariç tutar; kalemin adı, açıklaması, sınıfı ve tutarı */
function InvoiceDetails({ row }: { row: ChannelMonth }) {
  return (
    <details className="group/inv rounded-2xl bg-surface ring-1 ring-line">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm font-medium text-ink outline-none select-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        Faturalar ({row.invoices.length}) ve kalemler
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/inv:rotate-180" />
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {row.invoices.map((inv) => (
          <li key={inv.id} className="space-y-2 px-4 py-3 text-[13px] leading-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium text-ink tabular">
                {dateTR(inv.date)} · {inv.invoiceNo ?? "numarasız"} · {money(inv.net)} + KDV
              </span>
              {inv.lineless ? (
                <Badge tone="gray" title="Faturanın kalemleri okunmadı; tutarın tamamı komisyon sayıldı">
                  Kalemsiz
                </Badge>
              ) : null}
              {inv.needsReview ? <Badge tone="amber">Kontrol bekliyor</Badge> : null}
            </div>
            {inv.coverNote ? <p className="text-ink-mute">{inv.coverNote}</p> : null}
            {inv.lines.length ? (
              <ul className="space-y-1.5">
                {inv.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    {/* Uyarılar "olabilir" der, kalemin kendi metni tam okunmalı: kesilmez, satır kırılır (dokunmatikte title görünmez) */}
                    <span className="min-w-0 flex-[1_1_10rem]">
                      <span className="block break-words text-ink">{l.name}</span>
                      {l.description ? <span className="block break-words text-xs text-ink-mute">{l.description}</span> : null}
                    </span>
                    {/* Alt satıra inince de sağda: tutarlar alt alta hizalı kalır */}
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <Badge tone={LINE_TONE[l.cls]}>{LINE_LABEL[l.cls]}</Badge>
                      <span className="text-ink tabular">{money(l.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href={`/panel/faturalar?ara=${encodeURIComponent(inv.invoiceNo ?? inv.supplier)}&ay=${inv.date.slice(0, 7)}#fatura-listesi`}
              className="inline-flex min-h-8 items-center text-ink-mute underline-offset-2 hover:text-ink hover:underline pointer-coarse:min-h-11"
            >
              Faturada aç →
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
