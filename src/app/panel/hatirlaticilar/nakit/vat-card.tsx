"use client";

import { ChevronDown, Receipt } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CashPlanState, CashPlanVat, Vat2Row, VatRow } from "@/lib/cash-plan";
import { MONTH_NAMES } from "@/lib/constants";
import { monthLabel, money, num, tl } from "@/lib/format";
import { monthKasa } from "@/lib/lafpos/kasa";
import { round100, VAT2_DUE_DAY, VAT_DISCLAIMER, vatForgetText, vatKeptCarryText, vatPeriodTitle, vatProgressText, vatSourceText, vatSubText, type VatEstimate } from "@/lib/kdv";
import { daysBetween, monthGenitiveTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { forgetVatPayment } from "@/server/actions/cash-plan";

import { DateTile } from "../payment-ui";
import { VatCarryDialog } from "./vat-carry-dialog";

const monthName = (period: string) => MONTH_NAMES[Number(period.slice(5, 7)) - 1];
const pctText = (rate: number) => `%${num(rate * 100, 1)}`;

/**
 * Nakit planı › KDV tahmini (src/lib/kdv.ts): her ödeme günü bir satır ("Ekim KDV'si ≈ 42.100 ₺"); satıra dokununca
 * satışların KDV'si, alışların KDV'si ve devreden açılır. Muhasebecinin devreden KDV'si buradan girilir. Haftalardaki
 * "KDV (Ekim)" satırı buraya getirir (#kdv). Alış faturalarında tevkifat varsa dönemin 2 No.lu KDV'si ayrı satırdır
 * (izleyen ayın 25'i): 1 No.lu beyannamede indirilir, devreden olsa da ödenir.
 */
export function VatCard({ vat, carry, today }: { vat: CashPlanVat; carry: CashPlanState["vatCarry"]; today: string }) {
  const [carryOpen, setCarryOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const muted = vat.mode === "excluded";
  // Satır yoksa ya dönem ödendi (Ödendi) ya da KDV hatırlatıcısının sıradaki günü 6 haftanın dışındadır (varsayılan
  // kipte her 42 günde bir 28'i var)
  const noRows = !vat.rows.length;
  const paidText = vat.paid.map((p) => `${monthName(p.period)}${p.amount ? ` (${money(p.amount)})` : ""}`).join(", ");
  const noData = !noRows && vat.rows.every((r) => r.amount === null);
  const anchorAmount = vat.anchor?.amount ?? null;
  const carries = vat.rows.some((r) => (r.estimate?.carryIn ?? 0) > 0);
  return (
    <Card id="kdv" className="scroll-mt-20">
      <CardHeader icon={<Receipt />} title="KDV tahmini" description="Satışların KDV'si eksi alışların KDV'si" meta={muted ? <Badge tone="gray">Plana katılmıyor</Badge> : null} />
      <CardContent className="space-y-3">
        {noRows ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-ink-soft">
            {vat.paid.length
              ? `${paidText} KDV'si ödendi (Ödemeler'de Ödendi); önümüzdeki 6 haftada başka 1 No.lu KDV ödemesi yok.`
              : "KDV hatırlatıcısının sıradaki günü önümüzdeki 6 haftanın dışında; bu dönemde KDV ödemesi yok."}
          </p>
        ) : noData ? (
          <div className="space-y-3 rounded-2xl bg-surface p-4 text-sm text-ink-soft">
            <p>Satış verisi yok; KDV tahmin edilemedi. Satışlar&apos;a ayın cirosunu ya da kasa raporu girin.</p>
            <ButtonLink href="/panel/satislar" variant="secondary" size="sm" className="pointer-coarse:h-11">
              Satışlara git
            </ButtonLink>
          </div>
        ) : (
          <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
            {vat.rows.map((r) => (
              <VatRowItem key={r.key} row={r} vat={vat} today={today} anchorAmount={anchorAmount} muted={muted} open={open === r.key} onToggle={() => setOpen((k) => (k === r.key ? null : r.key))} />
            ))}
          </ul>
        )}
        {vat.vat2.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface px-3">
            {vat.vat2.map((r) => (
              <Vat2RowItem key={r.key} row={r} today={today} muted={muted} />
            ))}
          </ul>
        ) : null}
        <div className="space-y-2 border-t border-line pt-3 text-xs leading-5 text-ink-mute">
          {vat.paid.length && !noRows ? <p>{paidText} KDV&apos;si ödendi (Ödemeler&apos;de Ödendi); plana girmez.</p> : null}
          <PaidRecords vat={vat} today={today} />
          <p>{VAT_DISCLAIMER}</p>
          {vat.baseMode === "reminder" ? (
            <p>Muhasebeciniz tutarı söyleyince Ödemeler&apos;deki KDV hatırlatıcısına yazın; plan onu kullanır.</p>
          ) : muted ? (
            // Hatırlatıcı yok ve tahmin kapalı: ayın 28'ine bir şey yazılmadı
            <p>KDV tahmini plana katılmıyor; Tahmine katılanlar&apos;dan açabilirsiniz.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1">Ödemeler&apos;de KDV hatırlatıcısı yok; tahmin ayın 28&apos;ine yazıldı.</p>
              <ButtonLink href="/panel/hatirlaticilar" variant="secondary" size="sm" className="pointer-coarse:h-11">
                Ödemeler&apos;e ekle
              </ButtonLink>
            </div>
          )}
          {carry ? (
            <p>
              Devreden KDV: {monthLabel(carry.month)} beyannamesinden {money(carry.amount)}.
            </p>
          ) : carries && vat.chainFrom ? (
            <p>Devreden KDV panelin verisiyle hesaplandı (başlangıç: {monthLabel(vat.chainFrom)}).</p>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setCarryOpen(true)} className="-ml-3 pointer-coarse:h-11">
            {carry ? "Devreden KDV'yi düzelt" : "Devreden KDV'yi gir"}
          </Button>
        </div>
      </CardContent>
      {carryOpen ? <VatCarryDialog carry={carry} today={today} onClose={() => setCarryOpen(false)} /> : null}
    </Card>
  );
}

/** 2 No.lu KDV (tevkifat) satırı: döküm yok, alt yazı ne olduğunu söyler */
function Vat2RowItem({ row: r, today, muted }: { row: Vat2Row; today: string; muted: boolean }) {
  return (
    <li className="flex min-h-11 items-start gap-3 py-3">
      <DateTile date={r.date} daysLeft={daysBetween(today, r.date)} size="sm" muted={muted} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm leading-5 font-semibold text-ink">{monthName(r.period)} KDV-2 (tevkifat)</span>
          <span className={cn("shrink-0 text-sm font-semibold tabular", muted ? "text-ink-mute" : "text-ink")}>≈ {tl(r.amount)}</span>
        </span>
        <span className="mt-0.5 block text-xs leading-[18px] text-ink-mute">
          {r.covered ? "Plana Ödemeler'deki KDV-2 hatırlatıcısı girer: bu dönemin tutarı yazılıysa o, yoksa bu tahmin" : `Faturalardaki tevkifat, ayın ${VAT2_DUE_DAY}'inde; 1 No.lu beyannamede indirilir`}
        </span>
      </span>
    </li>
  );
}

/** Sağdaki tutar: tahmin, Ödemeler'deki kesin tutar ya da hesaplanamadı */
function AmountText({ row, muted }: { row: VatRow; muted: boolean }) {
  const tone = muted ? "text-ink-mute" : null;
  if (row.amount === null) return <span className="text-sm text-ink-mute">Hesaplanamadı</span>;
  if (row.source === "reminder") {
    return row.amount > 0 ? (
      <span className="flex flex-col items-end gap-0.5">
        <span className={cn("text-sm font-semibold tabular", tone ?? "text-ink")}>{money(row.amount)}</span>
        <Badge tone="gray">Ödemeler&apos;de</Badge>
      </span>
    ) : (
      <span className={cn("text-sm", tone ?? "text-ink-soft")}>Ödeme yok</span>
    );
  }
  return row.amount > 0 ? (
    <span className={cn("text-sm font-semibold tabular", tone ?? "text-ink")}>≈ {tl(row.amount)}</span>
  ) : (
    <span className={cn("text-sm font-medium", tone ?? "text-good")}>Ödeme beklenmez</span>
  );
}

function VatRowItem({
  row: r,
  vat,
  today,
  anchorAmount,
  muted,
  open,
  onToggle,
}: {
  row: VatRow;
  vat: CashPlanVat;
  today: string;
  anchorAmount: number | null;
  muted: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  const e = r.estimate;
  const tileDate = r.overdue ? r.due : r.date;
  const sub = e ? vatSubText(e, anchorAmount) : "Ödemeler'deki tutar";
  const progress = e ? vatProgressText(e) : null;
  // Kasa KDV'sinin kaynağı (yalnız tahminde): "12 gün yazarkasa Z'sinden, 3 gün tahmin"
  const source = e && e.status === "ok" && r.source === "estimate" ? vatSourceText(e.basis.posSource) : null;
  return (
    <li>
      {/* Telefonda da üç sütun: tarih karosu · başlık ve alt yazı · tutar; alt yazı tutarın altına da uzanır */}
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="flex min-h-11 w-full cursor-pointer items-start gap-3 py-3 text-left focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none">
        <DateTile date={tileDate} daysLeft={daysBetween(today, tileDate)} size="sm" muted={muted} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 font-semibold text-ink">
              {vatPeriodTitle(r.period)}
              {/* Tutarı 0 olan gecikmiş satırda geciken yalnız beyanname ücreti (damga): "Ödeme beklenmez" ile çelişmesin (§7.10) */}
              {r.overdue && r.amount === 0 ? (
                <Badge tone="amber" dot>
                  Damga ödendi mi?
                </Badge>
              ) : r.overdue ? (
                <Badge tone="red" dot>
                  Gecikmiş
                </Badge>
              ) : null}
            </span>
            <span className="flex shrink-0 items-start gap-1 text-right">
              <AmountText row={r} muted={muted} />
              <ChevronDown size={16} className={cn("mt-0.5 shrink-0 text-ink-mute transition-transform", open && "rotate-180")} aria-hidden="true" />
            </span>
          </span>
          <span className="mt-0.5 block text-xs leading-[18px] text-ink-mute">{sub}</span>
          {progress ? <span className="block text-xs leading-[18px] text-ink-mute">{progress}</span> : null}
          {source ? <span className="block text-xs leading-[18px] text-ink-mute">Kasa KDV&apos;si: {source}</span> : null}
        </span>
      </button>
      {open ? (
        <div id={panelId} className="pb-3">
          {e ? <Breakdown e={e} row={r} vat={vat} /> : <p className="text-xs text-ink-mute">Ödemeler&apos;deki tutar.</p>}
        </div>
      ) : null}
    </li>
  );
}

/** Döküm: satışların KDV'si, alışların KDV'si, devreden ve sonuç (kesin tutarlı satırda alt açıklamalar yok) */
function Breakdown({ e, row, vat }: { e: VatEstimate; row: VatRow; vat: CashPlanVat }) {
  if (e.status === "noData") return <p className="rounded-xl bg-panel px-3 py-2 text-xs text-ink-mute">Bu ayın satış verisi yok{row.source === "reminder" ? "; plana Ödemeler'deki tutar girdi" : ""}.</p>;
  const estimate = row.source === "estimate";
  const m = monthName(e.period);
  const b = e.basis;
  const service = b.serviceRevenue > 0 && vat.rates.kdvHizmet !== vat.rates.kdv ? `, karaoke ${tl(b.serviceRevenue)} ${pctText(vat.rates.kdvHizmet)}` : "";
  // Dönemin kasası (geçiş günü boşken ve öncesinde ModPOS; denetim E-39)
  const kasa = monthKasa(e.period, vat.switchDay).both;
  const posText = b.posFrom
    ? `${m} cirosu yok: ${monthGenitiveTR(b.posFrom)} günlük ortalamasıyla`
    : b.posRevenue === null
      ? null
      : e.projected
        ? `Kasa (${kasa}) cirosu ≈ ${tl(round100(b.posRevenue))} (${b.openDays ? `${num(b.openDays)} günden ` : ""}ay sonuna) · ${pctText(vat.rates.kdv)}${service}`
        : `Kasa (${kasa}) cirosu ${tl(b.posRevenue)} · ${pctText(vat.rates.kdv)}${service}`;
  const posSource = vatSourceText(b.posSource);
  const onlineText = b.online === "ok" ? `laffogato.net online ≈ ${tl(e.online)}` : b.online === "missing" ? "laffogato.net: bu ay çekilmedi" : null;
  const invoiceText = `${num(b.invoices)} fatura${b.inProgress ? ", bugüne kadar gelenler" : ""}${b.separate ? " · Karaoke box ve Alp Koç faturaları sayılmadı" : ""}`;
  // Sonuç: Ödemeler'deki tutar; beyannamedeki devreden (o ay ödeme yok); ödenecek ya da sonraki aya devreden
  const result =
    e.known !== null
      ? { label: "Ödemeler'deki tutar", value: money(e.known) }
      : e.anchored && vat.anchor
        ? { label: "Beyannamede devreden", value: money(vat.anchor.amount) }
        : e.payable > 0 || e.carryOut === 0
          ? { label: "Ödenecek", value: `≈ ${tl(e.payable)}` }
          : { label: "Sonraki aya devreden", value: `≈ ${tl(e.carryOut)}` };
  const kept = vatKeptCarryText(e);
  return (
    <dl className="space-y-2 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-soft">Satışların KDV&apos;si</dt>
          <dd className="font-medium text-ink tabular">≈ {tl(e.sales)}</dd>
        </div>
        {estimate ? (
          <>
            {posText ? <p className="text-xs text-ink-mute">{posText}</p> : null}
            {posSource ? <p className="text-xs text-ink-mute">Kaynak: {posSource}</p> : null}
            {onlineText ? <p className="text-xs text-ink-mute">{onlineText}</p> : null}
          </>
        ) : null}
      </div>
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-soft">Alış faturalarının KDV&apos;si</dt>
          <dd className="font-medium text-ink tabular">− ≈ {tl(e.purchases)}</dd>
        </div>
        {estimate ? <p className="text-xs text-ink-mute">{invoiceText}</p> : null}
        {estimate && e.withheld > 0 ? <p className="text-xs text-ink-mute">İçinde tevkifat ≈ {tl(e.withheld)}: 2 No.lu beyannameyle ayın {VAT2_DUE_DAY}&apos;inde ödenir</p> : null}
        {estimate && e.hizmet > 0 ? <p className="text-xs text-ink-mute">İçinde yurt dışı hizmetin KDV&apos;si ≈ {tl(e.hizmet)}: 2 No.lu beyannameyle ödenir, burada indirilir</p> : null}
      </div>
      {e.carryIn > 0 ? (
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-soft">Önceki aylardan devreden</dt>
          <dd className="font-medium text-ink tabular">− ≈ {tl(e.carryIn)}</dd>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 font-semibold">
        <dt className="text-ink">{result.label}</dt>
        <dd className="text-ink tabular">{result.value}</dd>
      </div>
      {e.anchored && e.known === null ? <p className="text-xs text-ink-mute">Beyannamede devreden var: bu dönem ödeme yok.</p> : null}
      {kept ? <p className="text-xs text-ink-mute">{kept}</p> : null}
    </dl>
  );
}

/**
 * Ödendi kaydı yanlışsa (Ödendi'den sonra hatırlatıcı silindi, Geri al artık yok) kaydı kaldırır: dönem yeniden
 * beklenir. Hatırlatıcıya dokunmaz.
 */
function PaidRecords({ vat, today }: { vat: CashPlanVat; today: string }) {
  const [pending, start] = useActionTransition();
  const [ask, setAsk] = useState<{ kind: "kdv" | "kdv2"; period: string } | null>(null);
  const items = [...vat.paid.map((p) => ({ kind: "kdv" as const, ...p })), ...vat.paid2.map((p) => ({ kind: "kdv2" as const, ...p }))];
  if (!items.length) return null;
  const label = (i: { kind: "kdv" | "kdv2"; period: string }) => `${monthName(i.period)} ${i.kind === "kdv2" ? "KDV-2" : "KDV"}`;
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Ödendi kaydı yanlışsa:</span>
        {items.map((i) => (
          <Button key={`${i.kind}:${i.period}`} variant="ghost" size="sm" className="pointer-coarse:h-11" onClick={() => setAsk(i)}>
            {label(i)} kaydını kaldır
          </Button>
        ))}
      </p>
      <ConfirmDialog
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask ? `${label(ask)} Ödendi kaydı kaldırılsın mı?` : ""}
        // Dönem nereden döner: kipe ve ödeme gününe göre (KDV'nin varsayılan kipi ayın 28'i, KDV-2 25'i; o gün tahmin yok)
        description={ask ? vatForgetText(ask, vat.mode, today) : ""}
        confirmLabel="Kaldır"
        pending={pending}
        onConfirm={() =>
          start(async () => {
            if (!ask) return;
            const r = await forgetVatPayment(ask.kind, ask.period);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${label(ask)} Ödendi kaydı kaldırıldı`);
            setAsk(null);
          })
        }
      />
    </>
  );
}
