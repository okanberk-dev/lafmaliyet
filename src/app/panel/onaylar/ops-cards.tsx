"use client";

import { Check, ExternalLink, Gift, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { stampTR } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { WASTE_KIND_LABEL } from "@/lib/waste";
import { reviewWasteRequest } from "@/server/actions/waste-requests";
import type { LateWasteCard, WasteDeleteCard, WasteRequestCard } from "@/server/data/waste-requests";

/*
 * Onaylar › Zayi ve ikram (yalnız yönetici; docs/ZAYI-IKRAM.md › Geç kayıt ve silme isteği). Geç kayıtta kalem ve gün,
 * neden ve not, isteyen, malzeme maliyeti (bugünkü fiyatlarla; ikramda menü değeri) ve bağlam: o gün aynı kalemden
 * kayıt, aynı gün ve kalem için başka bekleyen istek, ikramda Z ödenmez karşılaştırması, kasa raporu, ayın sayımı.
 * Silmede önce kaydı kimin ne zaman girdiği, sonra isteyen ve neden; kayıt kasa e-postasına girdiyse uyarı, kayıt
 * yoksa tek düğme "Kapat". Not personele görünür (tutar yazılmaz).
 */

export function WasteRequestCards({ cards }: { cards: WasteRequestCard[] }) {
  return (
    <Card>
      <CardHeader
        icon={<Gift />}
        title="Zayi ve ikram"
        description="Personelin geç kayıt ve silme istekleri, en eski gün önce. Onaylayınca kayıt isteyenin adıyla girer ya da silinir; reddederseniz notunuz personele görünür."
      />
      <div className="divide-y divide-line border-t border-line">
        {cards.map((c) => (c.kind === "zayi-gec" ? <LateWasteItem key={c.id} card={c} /> : <WasteDeleteItem key={c.id} card={c} />))}
      </div>
    </Card>
  );
}

function Head({ title, badges, by, waited, createdAt }: { title: string; badges: ReactNode; by: string; waited: string; createdAt: string }) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="min-w-0 break-words">{title}</span>
        {badges}
      </h3>
      <p className="text-[13px] text-ink-mute tabular">
        {by} istedi · {stampTR(createdAt)} · {waited} bekliyor
      </p>
    </div>
  );
}

function NoteField({ id, note, setNote }: { id: number; note: string; setNote: (v: string) => void }) {
  return (
    <Field label="Not (isteğe bağlı; personele görünür, tutar yazmayın)" htmlFor={`zayi-not-${id}`}>
      <Textarea id={`zayi-not-${id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
    </Field>
  );
}

function useDecide(card: { id: number; version: number; requestedByName: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useActionTransition();
  const who = genitive(card.requestedByName);
  function decide(decision: "approve" | "reject", done: (status: "approved" | "rejected" | "gone") => string) {
    start(async () => {
      const res = await reviewWasteRequest({ id: card.id, seenVersion: card.version, decision, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      toast.success(done(res.data.status));
    });
  }
  return { note, setNote, pending, decide, who };
}

/** Geç kayıt isteği */
function LateWasteItem({ card }: { card: LateWasteCard }) {
  const { note, setNote, pending, decide, who } = useDecide(card);
  const p = card.p;
  const ikram = p.kind === "ikram";
  const z = card.report.offRevenue;
  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <Head
        title={`${card.item} · ${card.dayLong}`}
        by={card.requestedByName}
        waited={card.waited}
        createdAt={card.createdAt}
        badges={
          <>
            <Badge tone={ikram ? "blue" : "red"}>{WASTE_KIND_LABEL[p.kind]}</Badge>
            <Badge tone="amber">Geç kayıt</Badge>
          </>
        }
      />
      <div className="space-y-0.5 text-sm text-ink-soft">
        {p.reason ? <p>Neden: {p.reason}</p> : null}
        {p.note ? <p className="break-words">Not: {p.note}</p> : null}
        {card.message ? <p className="break-words">Açıklama: {card.message}</p> : null}
      </div>
      <p className="text-sm text-ink tabular">
        Malzeme maliyeti {money(card.cost)} (KDV hariç, bugünkü fiyatlarla){card.menuValue !== null ? ` · menü değeri ${money(card.menuValue)}` : ""}
      </p>
      <section aria-label="O gün" className="space-y-1 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5">
        {card.sameDay.length ? (
          <p className="font-medium text-warn">
            O gün aynı kalemden {card.sameDay.length} kayıt var: {card.sameDay.join(", ")}
          </p>
        ) : (
          <p className="text-ink-soft">O gün aynı kalemden kayıt yok.</p>
        )}
        {card.otherPending.length ? <p className="font-medium text-warn">Aynı gün ve kalem için başka bekleyen istek var ({card.otherPending.join(", ")})</p> : null}
        {card.lafposRefusal ? <p className="font-medium text-warn">{card.lafposRefusal} Bu isteği reddedin.</p> : null}
        {ikram && !card.lafposRefusal && z !== null && card.ikramRecorded !== null ? (
          card.ikramFromLafpos ? (
            // LafPOS'un gün sonu gelen gün: ödenmez tutarı ve liste LafPOS'un; bu kayıt (hammadde ikramı) ikisini değiştirmez
            <p className="text-ink tabular">
              Z ödenmez {money(z)} · LafPOS&apos;un ikram ve zayi listesi {money(card.ikramRecorded)}
            </p>
          ) : (
            <p className="text-ink tabular">
              Z ödenmez {money(z)} · kayıtlı ikram menü değeri {money(card.ikramRecorded)} → bu kayıtla {money(card.ikramRecorded + (card.menuValue ?? 0))}
            </p>
          )
        ) : null}
        <p className="text-ink-soft">{card.report.exists ? "O günün kasa raporu gönderilmiş; özetinde bu kayıt yok." : "O günün kasa raporu yok."}</p>
        {card.countDone ? <p className="font-medium text-warn">{card.countDone}</p> : null}
        <Link href={`/panel/zayi?gun=${card.date}`} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
          <ExternalLink size={14} aria-hidden="true" /> Günü aç
        </Link>
      </section>
      <NoteField id={card.id} note={note} setNote={setNote} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject", () => `${who} isteği reddedildi`)} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        {card.lafposRefusal ? null : (
          <Button onClick={() => decide("approve", () => `${card.item} ${card.dayLong} gününe eklendi`)} disabled={pending}>
            <Check size={15} /> Onayla ve ekle
          </Button>
        )}
      </div>
    </article>
  );
}

/** Silme isteği */
function WasteDeleteItem({ card }: { card: WasteDeleteCard }) {
  const { note, setNote, pending, decide, who } = useDecide(card);
  const [confirm, setConfirm] = useState(false);
  const e = card.entry;
  const done = (status: "approved" | "rejected" | "gone") => (status === "gone" ? "İstek kapandı; kayıt zaten silinmişti" : status === "approved" ? "Kayıt silindi" : `${who} isteği reddedildi`);
  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <div className="space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="min-w-0 break-words">
            {card.item} · {card.dayLong}
          </span>
          <Badge tone={e.kind === "ikram" ? "blue" : "red"}>{WASTE_KIND_LABEL[e.kind]}</Badge>
          <Badge tone="red">Silme</Badge>
        </h3>
        <p className="text-sm font-medium text-ink tabular">{card.enteredText}</p>
        <p className="text-[13px] text-ink-mute tabular">
          {card.requestedByName} istedi · {stampTR(card.createdAt)} · {card.waited} bekliyor
        </p>
        {card.message ? <p className="text-sm break-words text-ink-soft">Neden: {card.message}</p> : null}
        {e.reason || e.note ? <p className="text-[13px] break-words text-ink-mute">Kayıtta: {[e.reason, e.note].filter(Boolean).join(" · ")}</p> : null}
      </div>
      {card.gone ? <Notice tone="neutral" size="sm" title="Kayıt zaten silinmiş" /> : null}
      {card.inReportMail ? <Notice tone="warn" size="sm" title="Bu kayıt o günün kasa e-postasında" text="Silinirse e-postadaki özetle tutmaz." /> : null}
      {!card.gone ? <NoteField id={card.id} note={note} setNote={setNote} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {card.gone ? (
          <Button variant="secondary" onClick={() => decide("approve", done)} disabled={pending}>
            Kapat
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => decide("reject", done)} disabled={pending}>
              <X size={15} /> Reddet
            </Button>
            <Button variant="danger" onClick={() => setConfirm(true)} disabled={pending}>
              <Trash2 size={15} /> Onayla ve sil
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          decide("approve", done);
        }}
        pending={pending}
        confirmLabel="Sil"
        title={`${card.item} kaydı silinsin mi?`}
        description="Kayıt silinir, stok tutarlılığından da çıkar."
      />
    </article>
  );
}
