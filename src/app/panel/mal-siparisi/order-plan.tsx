"use client";

import { Copy, MessageCircle, Minus, PackageCheck, Phone, Plus, ShoppingBasket, Truck } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, NumberInput, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, num, tl } from "@/lib/format";
import { countAmount, dayName, orderLink, orderMessage, restLabel } from "@/lib/reorder/message";
import { addDays } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { cancelOrder, markOrderReceived, recordOrderSent } from "@/server/actions/reorder";
import type { OrderPlanView, PlanGroupView, PlanLineView } from "@/server/data/reorder";

import { copyText } from "../kullanicilar/password-field";
import { formatPhone, telHref } from "../tedarikciler/logic";

/** "09:42" (Türkiye) */
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

type Payload = { requestId: string; lines: { ingredientId: number; qty: number }[]; note: string | null; message: string; channel: "whatsapp" | "kopya" };

/**
 * Sipariş listesi: tedarikçi başına bir kart, önerilen kalemler (az kalan önce) ve "Yeterli olanlar". Miktar
 * değiştirilir, WhatsApp'ta açılır ya da metin kopyalanır; açılan mesaj sipariş olarak kaydedilir (aynı istek kimliği
 * ikinci kayıt açmaz). Gönderilen tedarikçinin düzenlemeleri yeni öneriyle düşer, ötekiler kalır; başka sayfaya geçip
 * dönünce (Activity) düzenlemeler durur, açık pencere kapanır.
 */
/** Tedarikçinin personel taslağı (Onaylar'da; docs/MAL-SIPARISI.md › Personelin sipariş taslağı) */
export type DraftBadge = { status: "pending" | "approved"; by: string; id: number };

export function OrderPlanClient({ view, drafts = {} }: { view: OrderPlanView; drafts?: Record<string, DraftBadge> }) {
  /** Elle değiştirilen miktarlar (sipariş biriminde); yoksa öneri */
  const [edits, setEdits] = useState<Record<number, number>>({});
  const [synced, setSynced] = useState(view);
  if (synced !== view) {
    const sentChanged = new Set(view.groups.filter((g) => (synced.groups.find((x) => x.key === g.key)?.sentAt ?? null) !== g.sentAt).map((g) => g.key));
    const keep = new Set(view.groups.filter((g) => !sentChanged.has(g.key)).flatMap((g) => g.lines.map((l) => l.ingredientId)));
    setSynced(view);
    setEdits((e) => Object.fromEntries(Object.entries(e).filter(([id]) => keep.has(Number(id)))));
  }
  const [sending, setSending] = useState<PlanGroupView | null>(null);
  const [editing, setEditing] = useState<PlanLineView | null>(null);
  // Sayfadan çıkılınca (Activity sayfayı gizler) açık pencere kapanır; dönünce kendiliğinden açık durmasın
  useLayoutEffect(
    () => () => {
      setSending(null);
      setEditing(null);
    },
    [],
  );

  const qtyOf = (l: PlanLineView) => edits[l.ingredientId] ?? l.packs;
  const setQty = (l: PlanLineView, q: number) => setEdits((e) => ({ ...e, [l.ingredientId]: Math.max(0, Math.round(q * 100) / 100) }));
  const chosenOf = (g: PlanGroupView) => g.lines.filter((l) => qtyOf(l) > 0);
  const messageOf = (g: PlanGroupView, note: string | null) =>
    orderMessage({ signature: view.signature, lines: chosenOf(g).map((l) => ({ orderName: l.orderName, qty: qtyOf(l), unit: l.unit })), note });

  async function record(g: PlanGroupView, p: Payload) {
    // Bağlantı yoksa istek reddedilir (yanıt gelmez): mesaj WhatsApp'ta açılmış olabilir, kayıt kaybolmasın
    const res = await recordOrderSent({ ...p, supplierKey: g.key! }).catch(() => null);
    if (!res?.ok) {
      // Aynı istek kimliğiyle yeniden: ilk istek kaydettiyse ikinci sipariş açılmaz. Bildirim kendiliğinden kapanmaz
      // (WhatsApp'tan dönünce de dursun); ✕ ile kapanır
      return void toast.error(res ? res.error : `${g.name} siparişi kaydedilemedi: bağlantı yok gibi`, {
        description: res ? undefined : "Mesajı gönderdiyseniz bağlantı gelince yeniden deneyin; sipariş iki kez kaydedilmez.",
        duration: Infinity,
        action: { label: "Yeniden dene", onClick: () => void record(g, p) },
      });
    }
    const cancel = async () => {
      const r = await cancelOrder(res.data.id).catch(() => null);
      if (!r) return void toast.error("İptal edilemedi: bağlantı yok gibi", { duration: 15_000, action: { label: "Tekrar dene", onClick: () => void cancel() } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Mal siparişi iptal edildi");
    };
    toast.success(`${g.name} siparişi kaydedildi`, {
      description: "Fatura gelince teslim kontrolü yapılır.",
      duration: 10_000,
      action: { label: "Geri al", onClick: () => void cancel() },
    });
  }

  const payloadOf = (g: PlanGroupView, note: string | null, channel: Payload["channel"]): Payload => ({
    // İstek kimliği dokunuşta üretilir: yeniden deneme aynı kimlikle gider, ikinci sipariş açılmaz
    requestId: crypto.randomUUID(),
    lines: chosenOf(g).map((l) => ({ ingredientId: l.ingredientId, qty: qtyOf(l) })),
    note,
    message: messageOf(g, note),
    channel,
  });

  async function copyAndOffer(g: PlanGroupView, note: string | null, after?: () => void) {
    const payload = payloadOf(g, note, "kopya");
    if (!(await copyText(payload.message))) return void toast.error("Kopyalanamadı; metni basılı tutup elle kopyalayın");
    toast.success("Sipariş metni kopyalandı", {
      description: "Gönderdiyseniz kaydedin: fatura gelince teslim kontrolü yapılır.",
      action: {
        label: "Gönderildi say",
        onClick: () => {
          after?.();
          void record(g, payload);
        },
      },
    });
  }

  /** Geldi ya da geri alma (Yoldaki siparişler); bağlantı yoksa söyler, yeniden denenir */
  async function markReceived(id: number, supplier: string, received: boolean) {
    const res = await markOrderReceived({ id, received }).catch(() => null);
    if (!res) return void toast.error("Kaydedilemedi: bağlantı yok gibi", { duration: 15_000, action: { label: "Tekrar dene", onClick: () => void markReceived(id, supplier, received) } });
    if (!res.ok) return void toast.error(res.error);
    if (!received) return void toast.success("Geldi işareti kaldırıldı");
    toast.success(`${supplier} siparişi geldi`, { duration: 10_000, action: { label: "Geri al", onClick: () => void markReceived(id, supplier, false) } });
  }

  if (!view.total) {
    return (
      <Card>
        <EmptyState
          icon={<ShoppingBasket />}
          title="Takip edilen kalem yok"
          description="Sipariş önerisi için önce 10–15 kritik kalem seçin: çabuk biten, pahalı ya da geç gelen. Önerilen kalemler satışlara göre hazır."
          action={
            <ButtonLink href="/panel/mal-siparisi/kalemler" variant="primary">
              Kalemleri seç
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {view.groups.map((g) => (
        <SupplierCard
          key={g.key ?? "atanmamis"}
          g={g}
          today={view.today}
          draft={g.key ? (drafts[g.key] ?? null) : null}
          qtyOf={qtyOf}
          setQty={setQty}
          onEdit={setEditing}
          onSend={() => setSending(g)}
          onCopy={() => void copyAndOffer(g, null)}
        />
      ))}

      {view.openOrders.length ? (
        <Card>
          <CardHeader icon={<PackageCheck />} title={`Yoldaki siparişler (${num(view.openOrders.length)})`} description="Gönderilen, henüz kapanmamış mal siparişleri. Mal geldiyse işaretleyin." />
          <ul className="divide-y divide-line border-t border-line">
            {view.openOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
                <p className="min-w-0 flex-1 text-sm break-words text-ink">
                  <Link href={`/panel/mal-siparisi/gonderilen#siparis-${o.id}`} className="font-medium underline-offset-2 hover:underline">
                    {o.supplier} · {dateTR(o.sentDay)}
                  </Link>
                  <span className="text-ink-mute"> · {o.state.label}</span>
                </p>
                {!o.received && !o.hasInvoice ? (
                  <Button variant="secondary" size="sm" onClick={() => void markReceived(o.id, o.supplier, true)} className="text-ink">
                    Geldi
                  </Button>
                ) : null}
                {/* Yanlış dokunulan Geldi bildirim kapandıktan sonra da geri alınır (faturası bağlanmadıysa) */}
                {o.received && !o.hasInvoice ? (
                  <Button variant="ghost" size="sm" onClick={() => void markReceived(o.id, o.supplier, false)} aria-label={`${o.supplier} siparişinin Geldi işaretini geri al`}>
                    Geldi&apos;yi geri al
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <CardFooter>
            <Link href="/panel/mal-siparisi/gonderilen" className="font-medium text-ink underline-offset-2 hover:underline pointer-coarse:py-3">
              Gönderilenler →
            </Link>
          </CardFooter>
        </Card>
      ) : null}

      {sending ? (
        <SendDialog
          g={sending}
          today={view.today}
          chosen={chosenOf(sending)}
          qtyOf={qtyOf}
          message={(note) => messageOf(sending, note)}
          onClose={() => setSending(null)}
          onOpen={(note) => {
            const g = sending;
            const payload = payloadOf(g, note, "whatsapp");
            setSending(null);
            void record(g, payload);
          }}
          onCopy={(note) => {
            const g = sending;
            void copyAndOffer(g, note, () => setSending(null));
          }}
        />
      ) : null}

      {editing ? <QtyDialog line={editing} value={qtyOf(editing)} onClose={() => setEditing(null)} onSave={(q) => setQty(editing, q)} /> : null}
    </div>
  );
}

/** Kartın açıklaması: kime gider ve teslimin günü */
function contactLine(g: PlanGroupView, today: string): string {
  const when = ` · teslim ~${dayName(addDays(today, g.lead))}`;
  const link = orderLink(g.phone, "");
  if (link.target === "numara") return `WhatsApp: ${formatPhone(g.phone)}${g.contactName ? ` · ${g.contactName}` : ""}${when}`;
  return `${link.reason === "sabit" ? "Kayıtlı numara cep telefonu değil" : "Telefon kayıtlı değil"}${when}`;
}

function SupplierCard({
  g,
  today,
  draft,
  qtyOf,
  setQty,
  onEdit,
  onSend,
  onCopy,
}: {
  g: PlanGroupView;
  today: string;
  draft: DraftBadge | null;
  qtyOf: (l: PlanLineView) => number;
  setQty: (l: PlanLineView, q: number) => void;
  onEdit: (l: PlanLineView) => void;
  onSend: () => void;
  onCopy: () => void;
}) {
  const suggested = g.lines.filter((l) => l.packs > 0);
  const enough = g.lines.filter((l) => l.packs === 0);
  const chosen = g.lines.filter((l) => qtyOf(l) > 0);
  const priced = chosen.filter((l) => l.packPrice !== null);
  const estimate = priced.reduce((a, l) => a + (l.packPrice ?? 0) * qtyOf(l), 0);
  const row = (l: PlanLineView) => <PlanRow key={l.ingredientId} l={l} qty={qtyOf(l)} onQty={(q) => setQty(l, q)} onEdit={() => onEdit(l)} />;
  const assigned = g.key !== null;
  return (
    <Card id={g.slug ? `tedarikci-${g.slug}` : "tedarikcisi-secilmemis"} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-6">
      <CardHeader
        icon={<Truck />}
        title={
          assigned && g.slug ? (
            <Link href={`/panel/tedarikciler/${g.slug}`} className="underline-offset-2 hover:underline">
              {g.name}
            </Link>
          ) : (
            "Tedarikçisi seçilmemiş"
          )
        }
        description={assigned ? contactLine(g, today) : "Kalemler'den tedarikçi seçin; seçilince bu kalemler o tedarikçinin listesine geçer."}
        meta={
          assigned ? (
            <>
              <span className="tabular">
                {num(chosen.length)} kalem{priced.length ? ` · ~${tl(estimate)}` : ""}
              </span>
              {priced.length ? <InfoTip text="Son alış fiyatlarıyla, KDV hariç; faturadaki tutar farklı olabilir." /> : null}
            </>
          ) : undefined
        }
        actions={
          g.sentAt || draft ? (
            <>
              {draft ? (
                <Link href={`/panel/onaylar#istek-${draft.id}`} className="pointer-coarse:py-2">
                  <Badge tone={draft.status === "pending" ? "amber" : "blue"}>{`Taslak ${draft.status === "pending" ? "onayda" : "onaylandı"} · ${draft.by}`}</Badge>
                </Link>
              ) : null}
              {g.sentAt ? <Badge tone="green">Gönderildi {hhmm(g.sentAt)}</Badge> : null}
            </>
          ) : undefined
        }
      />
      {suggested.length ? <ul className="divide-y divide-line border-t border-line">{suggested.map(row)}</ul> : null}
      {enough.length ? (
        <details className="group border-t border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-5 text-[13px] font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
              ›
            </span>
            {restLabel(enough.map((l) => l.status))}
          </summary>
          <ul className="divide-y divide-line border-t border-line">{enough.map(row)}</ul>
        </details>
      ) : null}
      {assigned ? (
        <div className="border-t border-line px-5 py-3.5">
          {!chosen.length ? <p className="mb-2 text-xs text-ink-mute">Gönderilecek kalem yok.</p> : null}
          {/* Telefonda alt alta, tam genişlikte, asıl düğme üstte (yan yana iki sütunda ikon kayboluyor, yazı taşıyordu) */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onCopy} disabled={!chosen.length} className="text-ink">
              <Copy size={16} aria-hidden="true" className="shrink-0" /> Metni kopyala
            </Button>
            <Button onClick={onSend} disabled={!chosen.length}>
              <MessageCircle size={16} aria-hidden="true" className="shrink-0" /> WhatsApp ile gönder
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/** Kalem satırı: ad ve rozetler, eldeki / hedef / siparişte, az kaldıysa en az; sağda miktar */
function PlanRow({ l, qty, onQty, onEdit }: { l: PlanLineView; qty: number; onQty: (q: number) => void; onEdit: () => void }) {
  const amount = (v: number | null) => countAmount(v, l.countFactor, l.countUnit);
  const onOrder = l.onOrder > 0 ? ` · siparişte ${amount(l.onOrder)}` : "";
  const cost = l.packPrice !== null && qty > 0 ? ` · ~${tl(l.packPrice * qty)}` : "";
  let detail: ReactNode;
  if (l.status === "sayilmadi") detail = `Sayılmadı${onOrder}`;
  else if (l.status === "hedef-yok")
    detail = (
      <>
        Hedef yok:{" "}
        <Link href="/panel/mal-siparisi/kalemler" className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
          Kalemler&apos;den girin
        </Link>
      </>
    );
  else if (l.packs === 0) detail = `Yeterli · eldeki ${amount(l.onHand)} / hedef ${amount(l.par)}${onOrder}${cost}`;
  else detail = `Eldeki ${amount(l.onHand)} · hedef ${amount(l.par)}${onOrder}${cost}`;
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium break-words text-ink">
          <span>{l.name}</span>
          {l.critical ? <Badge tone="red">Az kaldı</Badge> : null}
          {l.stale ? <Badge tone="gray">Sayım eski</Badge> : null}
          {qty !== l.packs ? <Badge tone="blue">Düzenlendi</Badge> : null}
        </p>
        <p className="mt-0.5 text-xs break-words text-ink-mute tabular">{detail}</p>
        {l.critical ? <p className="mt-0.5 text-xs text-bad">En az {amount(l.min)}: yeni sipariş gelmeden bitebilir.</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${l.name} miktarı`}>
        <button
          type="button"
          onClick={() => onQty(Math.max(0, Math.ceil(qty) - 1))}
          disabled={qty <= 0}
          aria-label="Bir azalt"
          className="flex size-9 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink disabled:cursor-default disabled:opacity-40 pointer-coarse:size-11"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Miktarı yaz"
          className={cn(
            "flex h-9 min-w-[4.5rem] cursor-pointer flex-col items-center justify-center rounded-xl px-2 leading-tight ring-1 ring-inset pointer-coarse:h-11",
            qty > 0 ? "bg-surface text-ink ring-line-strong" : "bg-panel text-ink-mute ring-line",
          )}
        >
          <span className="text-sm font-semibold tabular">{num(qty, 2)}</span>
          <span className="text-[11px] text-ink-mute">{l.unit}</span>
        </button>
        <button
          type="button"
          onClick={() => onQty(Math.floor(qty) + 1)}
          aria-label="Bir artır"
          className="flex size-9 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink pointer-coarse:size-11"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/** Ortadaki sayıya dokununca: miktarı yazma (küsurlu da olur, 0 kalemi siparişten çıkarır) */
function QtyDialog({ line, value, onClose, onSave }: { line: PlanLineView; value: number; onClose: () => void; onSave: (q: number) => void }) {
  const [raw, setRaw] = useState(num(value, 2));
  const parsed = parseNumberTR(raw);
  const bad = raw.trim() !== "" && (parsed === null || parsed < 0 || parsed > 9999);
  const save = () => {
    if (bad) return;
    onSave(parsed ?? 0);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={line.name}
      description={`1 ${line.unit} = ${countAmount(line.unitSize, line.countFactor, line.countUnit)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={bad}>
            Tamam
          </Button>
        </>
      }
    >
      <Field label={`Miktar (${line.unit})`} htmlFor="mp-qty" error={bad ? "0 ile 9.999 arasında bir sayı yazın" : undefined} hint="0 yazarsanız kalem siparişe girmez.">
        <NumberInput
          id="mp-qty"
          data-autofocus="always"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-invalid={bad || undefined}
        />
      </Field>
    </Dialog>
  );
}

/** Gönderme penceresi: kime, not, mesajın önizlemesi; WhatsApp'ta aç ya da metni kopyala */
function SendDialog({
  g,
  today,
  chosen,
  qtyOf,
  message,
  onClose,
  onOpen,
  onCopy,
}: {
  g: PlanGroupView;
  today: string;
  chosen: PlanLineView[];
  qtyOf: (l: PlanLineView) => number;
  message: (note: string | null) => string;
  onClose: () => void;
  onOpen: (note: string | null) => void;
  onCopy: (note: string | null) => void;
}) {
  const [note, setNote] = useState("");
  const clean = note.trim() || null;
  const text = message(clean);
  const link = orderLink(g.phone, text);
  const priced = chosen.filter((l) => l.packPrice !== null);
  const estimate = priced.reduce((a, l) => a + (l.packPrice ?? 0) * qtyOf(l), 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${g.name} siparişi`}
      description={`${num(chosen.length)} kalem${priced.length ? ` · ~${tl(estimate)} (son fiyatlarla, KDV hariç)` : ""} · teslim ~${dayName(addDays(today, g.lead))}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="max-sm:hidden">
            Vazgeç
          </Button>
          <Button variant="secondary" onClick={() => onCopy(clean)} disabled={!chosen.length} className="text-ink">
            <Copy size={16} aria-hidden="true" /> Metni kopyala
          </Button>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpen(clean)}
            aria-disabled={!chosen.length || undefined}
            className={cn(buttonClass("primary"), !chosen.length && "pointer-events-none opacity-45")}
          >
            <MessageCircle size={16} aria-hidden="true" /> WhatsApp&apos;ta aç
          </a>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="rounded-2xl bg-panel px-3.5 py-2.5 text-[13px] leading-5">
          <p className="text-xs font-medium text-ink-mute">Kime</p>
          {link.target === "numara" ? (
            <p className="mt-0.5 text-ink">
              WhatsApp: {formatPhone(g.phone)}
              {g.contactName ? ` · ${g.contactName}` : ""}
            </p>
          ) : link.reason === "sabit" ? (
            <p className="mt-0.5 text-warn">
              Kayıtlı numara ({formatPhone(g.phone)}) cep telefonu değil; WhatsApp&apos;ta kişiyi siz seçersiniz.{" "}
              {telHref(g.phone) ? (
                <a href={telHref(g.phone)!} className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline pointer-coarse:py-2">
                  <Phone size={13} aria-hidden="true" /> Ara
                </a>
              ) : null}
            </p>
          ) : (
            <p className="mt-0.5 text-warn">
              Tedarikçinin telefonu kayıtlı değil. WhatsApp açılınca kişiyi siz seçersiniz.{" "}
              {g.slug ? (
                <Link href={`/panel/tedarikciler/${g.slug}`} onNavigate={onClose} className="font-semibold text-ink underline-offset-2 hover:underline">
                  Telefonu ekle →
                </Link>
              ) : null}
            </p>
          )}
        </div>
        <Field label="Not (isteğe bağlı)" htmlFor="mp-note" hint="Mesajın sonuna eklenir, ör. “Perşembe sabah 10'dan önce”">
          <Textarea id="mp-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} maxLength={300} rows={1} className="max-h-28 min-h-11 [field-sizing:content]" />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Mesaj</p>
          <pre className="max-h-56 overflow-y-auto overscroll-contain rounded-2xl bg-panel p-3.5 font-sans text-[13px] leading-5 whitespace-pre-wrap text-ink">{text}</pre>
          <p className="mt-1.5 text-xs text-ink-mute">WhatsApp&apos;ta açınca sipariş kaydedilir; fatura gelince teslim kontrolü yapılır.</p>
        </div>
      </div>
    </Dialog>
  );
}
