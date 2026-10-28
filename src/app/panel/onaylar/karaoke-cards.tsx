"use client";

import { ExternalLink, MicVocal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { stampTR } from "@/lib/cash-report";
import { genitive } from "@/lib/recipe-change";
import { reviewKaraokeDeleteRequest } from "@/server/actions/karaoke";
import type { KaraokeDeleteCard } from "@/server/data/karaoke-requests";

/*
 * Onaylar › Karaoke (yalnız yönetici; denetim E-15, docs/KARAOKE.md › Sayacı silmek): personelin açılışından 10 dakika
 * sonra silinmesini istediği panel sayacı. Önce sayacın kendisi (ad, saat, kişi, kimin açtığı, bugünkü durumu ve
 * istekten sonra ne değiştiği), sonra isteyen ve neden. Sayaç arada silindiyse tek düğme "Kapat". Not personele
 * görünür (tutar yazılmaz).
 */

export function KaraokeRequestCards({ cards }: { cards: KaraokeDeleteCard[] }) {
  return (
    <Card>
      <CardHeader
        icon={<MicVocal />}
        title="Karaoke"
        description="Personelin silinmesini istediği karaoke sayaçları. Onaylarsanız sayaç karaoke geçmişinden ve doluluktan çıkar; oda kullanıldıysa reddedin."
      />
      <div className="divide-y divide-line border-t border-line">
        {cards.map((c) => (
          <KaraokeDeleteItem key={c.id} card={c} />
        ))}
      </div>
    </Card>
  );
}

function KaraokeDeleteItem({ card }: { card: KaraokeDeleteCard }) {
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useActionTransition();
  const who = genitive(card.requestedByName);
  function decide(decision: "approve" | "reject") {
    start(async () => {
      const res = await reviewKaraokeDeleteRequest({ id: card.id, seenVersion: card.version, decision, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      const status = res.data.status;
      toast.success(status === "gone" ? "İstek kapandı; sayaç zaten silinmişti" : status === "approved" ? "Sayaç silindi" : `${who} isteği reddedildi`);
    });
  }
  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <div className="space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="min-w-0 break-words">
            {card.name} · <span className="tabular">{card.when}</span>
          </span>
          <Badge tone="gray">Karaoke sayacı</Badge>
          <Badge tone="red">Silme</Badge>
        </h3>
        <p className="text-sm font-medium text-ink tabular">
          {card.openedText}
          {card.guests ? ` · ${card.guests} kişi` : ""} · {card.stateText}
        </p>
        <p className="text-[13px] text-ink-mute tabular">
          {card.requestedByName} istedi · {stampTR(card.createdAt)} · {card.waited} bekliyor
        </p>
        {card.message ? <p className="text-sm break-words text-ink-soft">Neden: {card.message}</p> : null}
        <Link
          href="/panel/karaoke"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5"
        >
          <ExternalLink size={14} aria-hidden="true" /> Karaoke ekranı
        </Link>
      </div>
      {card.gone ? (
        <p className="rounded-xl bg-panel px-3 py-2 text-sm font-medium text-ink">Sayaç zaten silinmiş</p>
      ) : card.changed.length || card.otherPending.length ? (
        <section aria-label="İstekten sonra" className="space-y-1 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] leading-5 text-warn">
          {card.changed.map((c) => (
            <p key={c} className="font-medium">
              {c}
            </p>
          ))}
          {card.otherPending.length ? <p className="font-medium">Aynı sayacın silinmesini {card.otherPending.join(", ")} de istedi</p> : null}
        </section>
      ) : null}
      {!card.gone ? (
        <Field label="Not (isteğe bağlı; personele görünür, tutar yazmayın)" htmlFor={`karaoke-not-${card.id}`}>
          <Textarea id={`karaoke-not-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
        </Field>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {card.gone ? (
          <Button variant="secondary" onClick={() => decide("approve")} disabled={pending}>
            Kapat
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => decide("reject")} disabled={pending}>
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
          decide("approve");
        }}
        pending={pending}
        confirmLabel="Sil"
        title={`${card.name} sayacı silinsin mi?`}
        description="Sayaç karaoke geçmişinden, doluluktan ve aylık özetteki rezervasyonsuz oturumlardan çıkar. Geri alınamaz."
      />
    </article>
  );
}
