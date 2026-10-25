"use client";

import { ClipboardPen, MessageCircle, Minus, Plus, Send, Truck, Undo2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useClock } from "@/components/panel/live/clock";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { stampTR, whatsappLink } from "@/lib/cash-report";
import { num } from "@/lib/format";
import { DRAFT_NOTE_MAX, draftNudge, nudgeText, type StaffDraftView } from "@/lib/reorder/draft";
import { qtyLabel } from "@/lib/reorder/message";
import { clockSuffixTR, todayTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { sendApprovedDraft, submitOrderDraft, undoDraftSend } from "@/server/actions/order-drafts";
import { withdrawStaffRequest } from "@/server/actions/staff-requests";
import type { DraftSheet, DraftSheetCard, DraftSheetLine } from "@/server/data/order-drafts";

/*
 * Personelin mal siparişi taslağı (docs/MAL-SIPARISI.md › Personelin sipariş taslağı). Tedarikçi başına bir kart:
 * öneriyle dolu − / + adımlayıcılar, tedarikçiye not, "Onaya gönder"; onay bekleyen, onaylanan (WhatsApp'ta aç),
 * gönderilen (10 dakika yeniden aç ve geri al) ve sonuçlanan taslaklar. Fiyat, tutar, hedef ve mesaj metni yok; WhatsApp
 * bağlantısı yalnız gönderimde sunucudan gelir (önce kayıt, sonra bağlantı).
 */

/** "09:42"; bugün değilse "24 Eki 09:42" */
const when = (iso: string) => (todayTR(new Date(iso)) === todayTR() ? new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : stampTR(iso));

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function DraftSheetClient({ sheet }: { sheet: DraftSheet }) {
  // #tedarikci-<slug> ile gelinince kart (Suspense yerleşince) görünür alana
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  if (!sheet.cards.length) {
    return (
      <EmptyState
        title="Sipariş listesi boş"
        description="Takipteki kalemlerin tedarikçisi seçilmemiş. Yönetici Mal siparişi › Kalemler'den seçer."
        action={
          <ButtonLink href="/panel/hizli-sayim" variant="secondary">
            Hızlı sayım
          </ButtonLink>
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      {sheet.cards.map((c) => (
        <SupplierDraftCard key={c.key} card={c} sheet={sheet} />
      ))}
    </div>
  );
}

function SupplierDraftCard({ card, sheet }: { card: DraftSheetCard; sheet: DraftSheet }) {
  const d = card.draft;
  return (
    <Card id={`tedarikci-${card.slug}`} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-6">
      <CardHeader icon={<Truck />} title={card.name} description={`Teslim ${num(card.lead)} gün`} actions={stateBadge(card)} />
      <div className="border-t border-line">
        {card.state === "no-phone" ? <Note>Bu tedarikçiye yönetici gönderir.</Note> : null}
        {card.state === "stale" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <p className="text-sm text-ink-soft">Önce hızlı sayım yapın: öneri dünden eski sayıma göre olurdu.</p>
            <ButtonLink href="/panel/hizli-sayim" variant="secondary" size="sm" className="pointer-coarse:h-11">
              <ClipboardPen size={14} aria-hidden="true" /> Sayıma git
            </ButtonLink>
          </div>
        ) : null}
        {card.state === "sent" ? (
          <Note>
            Bu tedarikçiye {card.sentAt && todayTR(new Date(card.sentAt)) === todayTR() ? "bugün" : "son sayımdan sonra"} {card.sentAt ? clockSuffixTR(when(card.sentAt)) : ""} sipariş gönderildi.
            {d?.status === "superseded" && d.reviewedByName && d.reviewedAt ? ` Yönetici kendisi gönderdi · ${d.reviewedByName} ${when(d.reviewedAt)}` : ""}
          </Note>
        ) : null}
        {card.state === "pending" && d ? <PendingDraft draft={d} card={card} sheet={sheet} /> : null}
        {card.state === "approved" && d ? <ApprovedDraft draft={d} /> : null}
        {card.state === "done" && d ? <SentDraft draft={d} /> : null}
        {card.state === "form" ? <DraftForm card={card} /> : null}
      </div>
    </Card>
  );
}

function stateBadge(c: DraftSheetCard) {
  if (c.state === "pending") return <Badge tone="amber">Onay bekliyor</Badge>;
  if (c.state === "approved") return <Badge tone="green">Onaylandı</Badge>;
  if (c.state === "done" || c.state === "sent") return <Badge tone="gray">Gönderildi</Badge>;
  return undefined;
}

function Note({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "warn" | "bad" }) {
  return <p className={cn("px-5 py-3.5 text-sm", tone === "warn" ? "bg-warn-soft text-warn" : tone === "bad" ? "bg-bad-soft text-bad" : "text-ink-soft")}>{children}</p>;
}

/** Salt okunur satırlar: sipariş adı ve miktar */
function ReadLines({ lines }: { lines: { ingredientId: number; orderName: string; qty: number; unit: string }[] }) {
  return (
    <ul className="divide-y divide-line">
      {lines
        .filter((l) => l.qty > 0)
        .map((l) => (
          <li key={l.ingredientId} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-0 break-words text-ink">{l.orderName}</span>
            <span className="shrink-0 text-ink-soft tabular">{qtyLabel(l.qty, l.unit)}</span>
          </li>
        ))}
    </ul>
  );
}

function PendingDraft({ draft, card, sheet }: { draft: StaffDraftView; card: DraftSheetCard; sheet: DraftSheet }) {
  const [pending, run] = useActionTransition();
  // Açık kalan sayfada da 30 dakika dolunca çıkar (sunucunun çizimi o anı bilmez)
  const clock = useClock(60_000);
  const showNudge = card.nudge || draftNudge(draft, clock);
  const n = draft.lines.filter((l) => l.qty > 0).length;
  const nudge = whatsappLink(nudgeText(card.name, n, `${sheet.approvalsUrl}#istek-${draft.id}`), sheet.adminWhatsapp);
  return (
    <>
      <p className="px-5 pt-3.5 text-[13px] text-ink-mute">
        {draft.requestedByName} · {when(draft.createdAt)}
        {draft.mine ? "" : " · yönetici onaylayınca gönderilebilir"}
      </p>
      <ReadLines lines={draft.lines} />
      {draft.supplierNote ? <p className="border-t border-line px-5 py-2.5 text-[13px] text-ink-soft">Tedarikçiye not: {draft.supplierNote}</p> : null}
      {draft.mine ? (
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await withdrawStaffRequest(draft.id);
                if (!res.ok) return void toast.error(res.error);
                toast.success("Taslak geri çekildi");
              })
            }
          >
            Geri çek
          </Button>
          {showNudge ? (
            <a href={nudge} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-ink ring-1 ring-line-strong ring-inset hover:bg-panel">
              <MessageCircle size={16} aria-hidden="true" className="shrink-0" /> Yöneticiye WhatsApp&apos;tan haber ver
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function ApprovedDraft({ draft }: { draft: StaffDraftView }) {
  const [pending, run] = useActionTransition();
  return (
    <>
      <div className="space-y-1 px-5 pt-3.5 text-[13px]">
        <p className="text-ink-mute">
          {draft.reviewedByName ?? "Yönetici"} onayladı · {draft.reviewedAt ? when(draft.reviewedAt) : ""} · {draft.requestedByName} hazırladı
        </p>
        {draft.edited ? <p className="font-medium text-warn">Yönetici miktarları değiştirdi</p> : null}
        {draft.reviewNote ? <p className="text-ink-soft">Yönetici: {draft.reviewNote}</p> : null}
      </div>
      <ReadLines lines={draft.approvedLines ?? []} />
      {draft.supplierNote ? <p className="border-t border-line px-5 py-2.5 text-[13px] text-ink-soft">Tedarikçiye not: {draft.supplierNote}</p> : null}
      <div className="flex justify-end border-t border-line px-5 py-3.5">
        <Button className="w-full sm:w-auto" disabled={pending} onClick={() => run(() => openWhatsapp(draft.id))}>
          <MessageCircle size={16} aria-hidden="true" className="shrink-0" /> {pending ? "Kaydediliyor…" : "WhatsApp'ta aç"}
        </Button>
      </div>
    </>
  );
}

/** Önce kayıt (sunucu), sonra WhatsApp: bağlantı yalnız kayıttan sonra gelir */
async function openWhatsapp(id: number) {
  const res = await sendApprovedDraft({ id });
  if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
  window.location.assign(res.data.href);
}

function SentDraft({ draft }: { draft: StaffDraftView }) {
  const [pending, run] = useActionTransition();
  return (
    <>
      <p className="px-5 pt-3.5 text-[13px] text-ink-mute">
        {draft.sentByName ?? draft.requestedByName} · {draft.sentAt ? when(draft.sentAt) : ""}
        {draft.reviewedByName ? ` · ${draft.reviewedByName} onayladı` : ""}
      </p>
      <ReadLines lines={draft.approvedLines ?? []} />
      {draft.undoable ? (
        <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await undoDraftSend({ id: draft.id });
                if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
                toast.success("Sipariş geri alındı", { description: "Tedarikçiye WhatsApp'tan iptal yazın.", duration: 15_000 });
              })
            }
          >
            <Undo2 size={16} aria-hidden="true" className="shrink-0" /> Geri al
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => run(() => openWhatsapp(draft.id))}>
            <MessageCircle size={16} aria-hidden="true" className="shrink-0" /> WhatsApp&apos;ta yeniden aç
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Son sonucun notu (formun üstünde): reddedildi, süresi doldu, geri alındı, yönetici kendisi gönderdi */
function resultNote(d: StaffDraftView): { text: string; tone: "warn" | "bad" | "mute" } | null {
  if (d.status === "rejected") return { text: `Reddedildi${d.reviewedByName ? ` (${d.reviewedByName})` : ""}. Yönetici: ${d.reviewNote ?? "not yok"}`, tone: "bad" };
  if (d.status === "expired") return { text: d.reviewNote ? `${d.reviewNote}.` : "Süresi doldu; yeniden hazırlayın.", tone: "warn" };
  if (d.status === "cancelled") return { text: "Geri alındı: tedarikçiye iptal yazın. Yeniden sipariş için yeni taslak ve yeni onay gerekir.", tone: "warn" };
  if (d.status === "superseded") return { text: `Yönetici kendisi gönderdi${d.reviewedByName && d.reviewedAt ? ` · ${d.reviewedByName} ${when(d.reviewedAt)}` : ""}.`, tone: "mute" };
  return null;
}

function DraftForm({ card }: { card: DraftSheetCard }) {
  const note = card.draft ? resultNote(card.draft) : null;
  const [open, setOpen] = useState(note === null);
  const [qty, setQty] = useState<Record<number, number>>(() => Object.fromEntries(card.lines.map((l) => [l.ingredientId, l.suggested])));
  const [supplierNote, setSupplierNote] = useState("");
  const [key, setKey] = useState(newKey);
  const [pending, run] = useActionTransition();
  const suggested = card.lines.filter((l) => l.suggested > 0);
  const rest = card.lines.filter((l) => l.suggested === 0);
  const chosen = card.lines.filter((l) => (qty[l.ingredientId] ?? 0) > 0);
  const row = (l: DraftSheetLine) => <DraftRow key={l.ingredientId} l={l} qty={qty[l.ingredientId] ?? 0} onQty={(q) => setQty((x) => ({ ...x, [l.ingredientId]: Math.max(0, Math.min(9999, q)) }))} />;

  function submit() {
    run(async () => {
      const res = await submitOrderDraft({
        clientKey: key,
        supplierKey: card.key,
        lines: card.lines.map((l) => ({ ingredientId: l.ingredientId, qty: qty[l.ingredientId] ?? 0 })),
        supplierNote: supplierNote.trim() || null,
      });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      setKey(newKey());
      toast.success(`${card.name} taslağı onaya gönderildi`, {
        description: res.data.notified ? "Yöneticinin telefonuna bildirim gitti." : "Yöneticinin cihazına bildirim gitmedi; WhatsApp'tan haber verebilirsiniz.",
      });
    });
  }

  return (
    <>
      {note ? <Note tone={note.tone}>{note.text}</Note> : null}
      {!open ? (
        <div className="flex justify-end border-t border-line px-5 py-3.5">
          <Button variant="secondary" onClick={() => setOpen(true)} className="pointer-coarse:h-11">
            Yeniden hazırla
          </Button>
        </div>
      ) : (
        <>
          {suggested.length ? (
            <ul className={cn("divide-y divide-line", note && "border-t border-line")}>{suggested.map(row)}</ul>
          ) : (
            <p className="px-5 py-3.5 text-sm text-ink-mute">Sayıma göre sipariş önerisi yok. Gerekirse aşağıdan kalem ekleyin.</p>
          )}
          {rest.length ? (
            <details className="group border-t border-line">
              <summary className="flex min-h-11 cursor-pointer list-none items-center px-5 text-[13px] font-medium text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
                <span className="mr-2 inline-block transition-transform group-open:rotate-90" aria-hidden="true">
                  ›
                </span>
                Yeterli olanlar ({num(rest.length)})
              </summary>
              <ul className="divide-y divide-line border-t border-line">{rest.map(row)}</ul>
            </details>
          ) : null}
          <div className="space-y-3 border-t border-line px-5 py-3.5">
            <Field label="Tedarikçiye not (isteğe bağlı)" htmlFor={`taslak-not-${card.slug}`} hint="Yönetici onaylarsa mesaja girer.">
              <Textarea id={`taslak-not-${card.slug}`} rows={2} maxLength={DRAFT_NOTE_MAX} value={supplierNote} onChange={(e) => setSupplierNote(e.target.value)} placeholder="ör. Perşembe sabah 10'dan önce" />
            </Field>
            <div className="flex justify-end">
              <Button className="w-full sm:w-auto" disabled={pending || !chosen.length} onClick={submit}>
                <Send size={16} aria-hidden="true" className="shrink-0" /> {pending ? "Gönderiliyor…" : `Onaya gönder (${num(chosen.length)} kalem)`}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Satır: sipariş adı, eldeki, Az kaldı; − / + adımlayıcı (sipariş biriminde) */
function DraftRow({ l, qty, onQty }: { l: DraftSheetLine; qty: number; onQty: (q: number) => void }) {
  const amount = l.onHand === null ? "sayılmadı" : `Eldeki ${num(l.onHand, 1)} ${l.countUnit ?? ""}`.trim();
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium break-words text-ink">
          <span>{l.orderName}</span>
          {l.low ? <Badge tone="red">Az kaldı</Badge> : null}
        </p>
        <p className="mt-0.5 text-xs break-words text-ink-mute tabular">
          {amount}
          {l.orderName !== l.name ? ` · ${l.name}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`${l.orderName} miktarı`}>
        <button
          type="button"
          onClick={() => onQty(Math.max(0, Math.ceil(qty) - 1))}
          disabled={qty <= 0}
          aria-label="Bir azalt"
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink disabled:cursor-default disabled:opacity-40"
        >
          <Minus size={16} aria-hidden="true" />
        </button>
        <span className={cn("flex h-11 min-w-[4.5rem] flex-col items-center justify-center rounded-xl px-2 leading-tight ring-1 ring-inset", qty > 0 ? "bg-surface text-ink ring-line-strong" : "bg-panel text-ink-mute ring-line")} aria-live="polite">
          <span className="text-sm font-semibold tabular">{num(qty, 2)}</span>
          <span className="text-[11px] text-ink-mute">{l.unit}</span>
        </span>
        <button
          type="button"
          onClick={() => onQty(Math.floor(qty) + 1)}
          aria-label="Bir artır"
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong ring-inset hover:text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

