"use client";

import { FileText, Lock, PackageX, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { dateTimeTR, dateTR, num, tl } from "@/lib/format";
import { checkSummary, priceNote, rowText } from "@/lib/reorder/delivery";
import { countAmount, qtyLabel } from "@/lib/reorder/message";
import type { CheckRow, ReorderLine } from "@/lib/reorder/types";
import { bulkUnit } from "@/lib/supplier-prices";
import { cn } from "@/lib/utils";
import { cancelOrder, closeOrder, markOrderReceived, reopenOrder, setOrderInvoice } from "@/server/actions/reorder";
import type { OrderView } from "@/server/data/reorder";

const STATUS_TONE: Record<CheckRow["status"], string> = {
  tamam: "text-good-ink",
  eksik: "text-bad",
  gelmedi: "text-bad",
  fazla: "text-warn",
  "siparis-disi": "text-warn",
  "bagli-degil": "text-ink-mute",
};

/** Sipariş birimi ve sayım birimiyle: "2 koli (24 LT)" */
function lineQty(l: Pick<ReorderLine, "qty" | "unit" | "unitSize" | "countUnit">): string {
  const f = l.countUnit === "KG" || l.countUnit === "LT" ? 1000 : 1;
  return `${qtyLabel(l.qty, l.unit)}${l.countUnit ? ` (${countAmount(l.qty * l.unitSize, f, l.countUnit)})` : ""}`;
}

/** Satırdaki miktar sipariş biriminde ("2 koli"); birimi bilinmeyende malzemenin okunur biriminde ("24 L") */
function rowAmount(r: CheckRow, v: number | null): string {
  if (v === null) return "–";
  if (r.status === "bagli-degil") return num(v, 2);
  if (r.ordered === null && r.baseUnit) {
    const b = bulkUnit(r.baseUnit);
    return `${num(v / b.scale, 2)} ${b.per}`;
  }
  return qtyLabel(v / (r.unitSize > 0 ? r.unitSize : 1), r.unit);
}

/** "Fiyat +%6 (51,85 → 54,90 ₺/L)" */
function priceText(r: CheckRow): string | null {
  const head = priceNote(r);
  if (!head || r.unitPrice === null || r.expectedUnitPrice === null || !r.baseUnit) return head;
  const b = bulkUnit(r.baseUnit);
  return `${head} (${num(r.expectedUnitPrice * b.scale, 2, 2)} → ${num(r.unitPrice * b.scale, 2, 2)} ₺/${b.per})`;
}

interface OrderCardProps {
  view: OrderView;
  /** Gönderilenler'i bu tedarikçiye süzen adres (liste süzülmemişken) */
  filterHref?: string;
  /** Personelin onaylı taslağından gönderildiyse onaylayan yönetici (docs/MAL-SIPARISI.md › Personelin sipariş taslağı) */
  approvedBy?: string | null;
}

/**
 * Gönderilen bir mal siparişi (Gönderilenler): durum, kalemler ya da faturayla karşılaştırma, gönderilen mesaj ve
 * eylemler (Geldi, Kapat, Faturayı değiştir, İptal, Yeniden aç). Adresteki çapa (#siparis-12) zilden gelir.
 */
export function OrderCard({ view, filterHref, approvedBy = null }: OrderCardProps) {
  const o = view.order;
  const c = o.check;
  const [pending, start] = useActionTransition();
  const [dialog, setDialog] = useState<"kapat" | "fatura" | "iptal" | null>(null);
  // Sayfadan çıkılınca (Activity sayfayı gizler) açık pencere kapanır
  useLayoutEffect(() => () => setDialog(null), []);
  // Zilden gelen çapa: liste sunucudan sonradan aktığı için tarayıcının kaydırması ulaşamayabilir
  useEffect(() => {
    if (window.location.hash !== `#siparis-${o.id}`) return;
    const id = requestAnimationFrame(() =>
      [...document.querySelectorAll<HTMLElement>(`#siparis-${o.id}`)].find((el) => el.getClientRects().length > 0)?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(id);
  }, [o.id]);

  const open = o.status === "open";
  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      // Bağlantı yoksa istek reddedilir: sayfa hata ekranına düşmesin, pencere açık kalsın
      const res = await fn().catch(() => null);
      if (!res) return void toast.error("Kaydedilemedi: bağlantı yok gibi", { description: "Bağlantı gelince yeniden deneyin." });
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
      setDialog(null);
    });

  const estimate = (l: ReorderLine) => (l.expectedUnitPrice !== null ? l.expectedUnitPrice * l.qty * l.unitSize : null);
  const total = o.lines.reduce((a, l) => a + (estimate(l) ?? 0), 0);

  return (
    <Card id={`siparis-${o.id}`} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold tracking-tight break-words text-ink">
            {view.slug ? (
              <Link href={`/panel/tedarikciler/${view.slug}`} className="underline-offset-2 hover:underline">
                {o.supplier}
              </Link>
            ) : (
              o.supplier
            )}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-mute tabular">
            {dateTimeTR(o.sentAt)} · {o.sentByName} · {o.channel === "whatsapp" ? "WhatsApp" : "Kopyalandı"}
            {o.draftId ? ` · onaylayan ${approvedBy ?? "yönetici"} · personel gönderdi` : ""}
            {filterHref ? (
              <>
                <span className="max-sm:hidden"> · </span>
                {/* Telefonda kendi satırında (satır ortasında bölünmesin) */}
                <Link href={filterHref} className="font-medium text-ink-soft underline-offset-2 hover:underline max-sm:mt-0.5 max-sm:block max-sm:w-fit pointer-coarse:py-2">
                  Bu tedarikçinin siparişleri
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {o.draftId ? <Badge tone="blue">Personel gönderdi</Badge> : null}
          <Badge tone={view.state.tone} dot className="max-w-full whitespace-normal">
            {view.state.label}
          </Badge>
        </div>
      </div>

      {c ? (
        <div className="border-t border-line">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-2.5 text-[13px] text-ink-soft tabular">
            <span>
              Fatura: {c.invoiceNo ?? "numarasız"} · {dateTR(c.invoiceDate)} · {tl(c.payable)}
            </span>
            <Link
              href={`/panel/faturalar?ara=${encodeURIComponent(c.invoiceNo ?? o.supplier)}#fatura-listesi`}
              className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline pointer-coarse:py-2"
            >
              <FileText size={13} aria-hidden="true" /> Faturayı aç
            </Link>
          </p>
          {c.linesRead ? (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem_10rem] gap-3 border-t border-line px-5 py-2 text-xs font-medium text-ink-mute sm:grid">
                <span>Kalem</span>
                <span>Sipariş</span>
                <span>Faturada</span>
                <span>Durum</span>
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {c.rows.map((r, k) => {
                  const price = priceText(r);
                  return (
                    <li key={`${r.ingredientId ?? "x"}-${k}`} className="px-5 py-2.5 text-sm">
                      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_8rem_10rem] sm:gap-3">
                        <p className="font-medium break-words text-ink">{r.name}</p>
                        <p className="hidden text-ink-soft tabular sm:block">{rowAmount(r, r.ordered)}</p>
                        <p className="hidden text-ink-soft tabular sm:block">{rowAmount(r, r.delivered)}</p>
                        <p className={cn("hidden sm:block", STATUS_TONE[r.status])}>{rowText(r)}</p>
                        {/* Telefonda: "2 koli → 1 koli · 1 koli eksik"; siparişte olmayan satırda "Faturada 1 · …" */}
                        <p className="mt-0.5 text-[13px] text-ink-soft tabular sm:hidden">
                          {r.ordered === null ? `Faturada ${rowAmount(r, r.delivered)}` : `${rowAmount(r, r.ordered)} → ${rowAmount(r, r.delivered)}`} ·{" "}
                          <span className={STATUS_TONE[r.status]}>{rowText(r)}</span>
                        </p>
                      </div>
                      {price ? <p className={cn("mt-0.5 text-xs tabular", (r.priceDiff ?? 0) > 0 ? "text-bad" : "text-good-ink")}>{price}</p> : null}
                      {r.ratioHint ? (
                        <p className="mt-0.5 text-xs text-warn">
                          {r.ratioHint >= 1
                            ? `Faturadaki miktar siparişin yaklaşık ${num(r.ratioHint)} katı: ürün bağlantısının çarpanı yanlış olabilir.`
                            : `Faturadaki miktar siparişten yaklaşık ${num(1 / r.ratioHint)} kat az: ürün bağlantısının çarpanı yanlış olabilir.`}
                        </p>
                      ) : null}
                      {r.status === "bagli-degil" ? (
                        <Link
                          href={`/panel/parasut?durum=bekleyen&ara=${encodeURIComponent(r.name)}#urun-baglantilari`}
                          className="mt-0.5 inline-block text-xs font-medium text-ink underline-offset-2 hover:underline pointer-coarse:py-2"
                        >
                          Bağla →
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {c.consolidated ? (
                <p className="border-t border-line px-5 py-2.5 text-xs text-warn">Fatura birden çok siparişi kapsıyor gibi (toplu fatura); farkları buna göre değerlendirin.</p>
              ) : null}
            </>
          ) : (
            <p className="border-t border-line px-5 py-2.5 text-[13px] text-ink-mute">
              Faturanın kalemleri okunmadı (kâğıt ya da elle girilen fatura, e-faturası henüz okunmamış): kalemleri elle karşılaştırıp kapatın.
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {o.lines.map((l) => {
            const e = estimate(l);
            return (
              <li key={l.ingredientId} className="px-5 py-2.5 text-sm sm:flex sm:items-baseline sm:gap-3">
                <p className="min-w-0 font-medium break-words text-ink sm:flex-1">{l.name}</p>
                {/* Telefonda ad tek başına, miktar ve tutar altında (ad sütuna sıkışıp bölünmesin) */}
                <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[13px] sm:contents sm:text-sm">
                  <span className="text-ink-soft tabular">{lineQty(l)}</span>
                  {e !== null ? <span className="text-ink-mute tabular sm:w-24 sm:text-right">~{tl(e)}</span> : null}
                </div>
              </li>
            );
          })}
          {total > 0 ? (
            <li className="flex justify-end px-5 py-2 text-[13px] text-ink-mute tabular">Tahmini ~{tl(total)} (son fiyatlarla, KDV hariç)</li>
          ) : null}
        </ul>
      )}

      <details className="group border-t border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center px-5 text-[13px] font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
            ›
          </span>
          Gönderilen mesaj · {o.channel === "whatsapp" ? "WhatsApp" : "Kopyalandı"}
        </summary>
        <pre className="mx-5 mb-4 max-h-56 overflow-y-auto overscroll-contain rounded-2xl bg-surface p-3.5 font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink">{o.message}</pre>
      </details>

      {open || view.reopenable ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3.5">
          {open && !o.receivedAt && o.invoiceId === null ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => markOrderReceived({ id: o.id, received: true }), `${o.supplier} siparişi geldi`)} className="text-ink">
              Geldi
            </Button>
          ) : null}
          {/* Yanlışlıkla denen Geldi (personelin bildirimdeki Geri al'ı kaçtıysa): faturası bağlanmadıkça kalkar */}
          {open && o.receivedAt && o.invoiceId === null ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markOrderReceived({ id: o.id, received: false }), "Geldi işareti kaldırıldı")}>
              <PackageX size={14} aria-hidden="true" /> Geldi&apos;yi geri al
            </Button>
          ) : null}
          {open ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setDialog("kapat")} className="text-ink">
              <Lock size={14} aria-hidden="true" /> Kapat
            </Button>
          ) : null}
          {open ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("fatura")}>
              <FileText size={14} aria-hidden="true" /> Faturayı değiştir
            </Button>
          ) : null}
          {open && !o.receivedAt && o.invoiceId === null ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDialog("iptal")}>
              <Undo2 size={14} aria-hidden="true" /> İptal
            </Button>
          ) : null}
          {view.reopenable ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reopenOrder(o.id), "Mal siparişi yeniden açıldı")}>
              <RotateCcw size={14} aria-hidden="true" /> Yeniden aç
            </Button>
          ) : null}
        </div>
      ) : null}

      {dialog === "kapat" ? (
        <CloseDialog
          text={`${o.supplier} · ${dateTR(o.sentDay)}: ${c ? checkSummary(c) : view.state.label}. Kapatılınca açık listeden ve bildirimden kalkar; Kapananlar'da durur.`}
          pending={pending}
          onClose={() => setDialog(null)}
          onConfirm={(note) => run(() => closeOrder({ id: o.id, note }), "Mal siparişi kapatıldı")}
        />
      ) : null}
      {dialog === "fatura" ? (
        <InvoiceDialog
          view={view}
          pending={pending}
          onClose={() => setDialog(null)}
          onSave={(invoiceId) =>
            run(() => setOrderInvoice({ id: o.id, invoiceId }), invoiceId === null ? "Fatura eşleşmesi kaldırıldı" : "Fatura değişti; teslim kontrolü yenilendi")
          }
        />
      ) : null}
      <ConfirmDialog
        open={dialog === "iptal"}
        onClose={() => setDialog(null)}
        title="Sipariş iptal edilsin mi?"
        description="Tedarikçiye ayrıca haber verin; panel yalnız kaydı iptal eder."
        confirmLabel="İptal et"
        pending={pending}
        onConfirm={() => run(() => cancelOrder(o.id), "Mal siparişi iptal edildi")}
      />
    </Card>
  );
}

function CloseDialog({ text, pending, onClose, onConfirm }: { text: string; pending: boolean; onClose: () => void; onConfirm: (note: string | null) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Sipariş kapatılsın mı?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={() => onConfirm(note.trim() || null)} disabled={pending}>
            {/* Pencerenin kapatma düğmesi de "Kapat": bu, siparişi kapatır */}
            {pending ? "Bekleyin…" : "Siparişi kapat"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-mute">{text}</p>
      <Field label="Not (isteğe bağlı)" htmlFor="mp-close-note" className="mt-4 pb-2">
        <Input id="mp-close-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} maxLength={300} placeholder="ör. eksik kalan cuma gelecek" />
      </Field>
    </Dialog>
  );
}

function InvoiceDialog({ view, pending, onClose, onSave }: { view: OrderView; pending: boolean; onClose: () => void; onSave: (invoiceId: number | null) => void }) {
  const [value, setValue] = useState(view.order.invoiceId === null ? "yok" : String(view.order.invoiceId));
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Faturayı değiştir"
      description={`${view.order.supplier} · ${dateTR(view.order.sentDay)} siparişi. Seçtiğiniz faturayla kalem kalem karşılaştırılır; eşitleme bu siparişe artık fatura aramaz.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={() => onSave(value === "yok" ? null : Number(value))} disabled={pending}>
            {pending ? "Bekleyin…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <Field
        label="Fatura"
        htmlFor="mp-invoice"
        className="pb-2"
        hint={view.invoices.length ? "Tedarikçinin sipariş gününden 3 gün önce ile 30 gün sonrası arasındaki faturaları." : "Bu aralıkta tedarikçinin başka faturası yok."}
      >
        <Select id="mp-invoice" value={value} onChange={(e) => setValue(e.target.value)}>
          {view.invoices.map((i) => (
            <option key={i.id} value={String(i.id)}>
              {dateTR(i.date)} · {i.invoiceNo ?? "numarasız"} · {tl(i.payable)}
            </option>
          ))}
          <option value="yok">Fatura yok (eşleşmeyi kaldır)</option>
        </Select>
      </Field>
    </Dialog>
  );
}
