"use client";

import { AlertTriangle, Check, ExternalLink, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Textarea } from "@/components/ui/form";
import { changeLine, stampTR } from "@/lib/cash-report";
import { money } from "@/lib/format";
import { dayMonthTR, longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { reviewCashRequest } from "@/server/actions/cash-requests";
import type { CashRequestCard, CorrectionCard, DeleteCard } from "@/server/data/cash-requests";

/**
 * Onaylar › Kasa kartları (yalnız yönetici): personelin kasa raporu düzeltme önerileri ve silme istekleri. Düzeltmede
 * raporun şimdiki hâlinden onaydan sonraki hâline değişenler (kasa alanları kalın ve uyarı renginde), rapor istekten
 * sonra değiştiyse üç sütun, sonuç ve devir, sonraki raporun açılışı, fişler ve geçmiş ay uyarısı; silmede raporun
 * özeti. Kasa alanı değişen onay ve her silme onay penceresi açar. Not personele görünür (tutar yazılmaz).
 */
export function KasaRequestCards({ cards }: { cards: CashRequestCard[] }) {
  return (
    <Card>
      <CardHeader icon={<Wallet />} title="Kasa" description="Personelin kasa raporu istekleri, en eski gün önce. Onaylayınca rapor yöneticinin düzeltmesi gibi değişir; reddederseniz notunuz personele görünür." />
      <div className="divide-y divide-line border-t border-line">
        {cards.map((c) => (c.kind === "kasa-duzeltme" ? <CorrectionItem key={c.id} card={c} /> : <DeleteItem key={c.id} card={c} />))}
      </div>
    </Card>
  );
}

/** Kartın başı: tür ve gün, isteyen, an, bekleme, neden */
function Head({ card, title, badge }: { card: CashRequestCard; title: string; badge?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="min-w-0 break-words">{title}</span>
        {badge}
      </h3>
      <p className="text-[13px] text-ink-mute tabular">
        {card.requestedByName} · {stampTR(card.createdAt)} · {card.waited} bekliyor
      </p>
      {card.message ? <p className="text-sm break-words text-ink-soft">Neden: {card.message}</p> : null}
    </div>
  );
}

/** Karar: not alanı ve düğmeler; sonuç toast ile */
function useDecision(card: CashRequestCard) {
  const [note, setNote] = useState("");
  const [pending, start] = useActionTransition();
  const decide = (decision: "approve" | "reject" | "close", done: (r: { revision: number | null; next: { date: string; opening: number } | null; nextBroken: boolean }) => void) =>
    start(async () => {
      const res = await reviewCashRequest({ id: card.id, seenVersion: card.version, seenRevision: card.reportRevision, decision, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      done(res.data);
    });
  const noteField = (
    <Field label="Not (isteğe bağlı; personele görünür, tutar yazmayın)" htmlFor={`not-${card.id}`}>
      <Textarea id={`not-${card.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
    </Field>
  );
  return { pending, decide, noteField };
}

function CorrectionItem({ card }: { card: CorrectionCard }) {
  const { pending, decide, noteField } = useDecision(card);
  const [confirm, setConfirm] = useState(false);
  const sensitive = card.changes.filter((c) => c.sensitive);
  const day = dayMonthTR(card.date);

  function approve() {
    setConfirm(false);
    decide("approve", (r) => {
      toast.success(`${day} kasa raporu güncellendi`, { description: `${card.requestedByName} önerisi onaylandı; rapor alıcılara yeniden gitti.` });
      if (r.next) {
        toast.warning(`${dayMonthTR(r.next.date)} açılışı bu devirle ${r.nextBroken ? "artık " : ""}tutmuyor`, { description: "Ertesi günün açılışını ya da bu raporun sayımını kontrol edin.", duration: 12_000 });
      }
    });
  }

  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <Head card={card} title={`Kasa düzeltmesi · ${longDateTR(card.date)}`} badge={<Badge tone={card.gate === "kilitli" ? "blue" : "amber"}>{card.gate === "kilitli" ? "Kilitli gün" : "Ertesi gün"}</Badge>} />
      {card.changes.length ? (
        <section aria-label="Değişecek" className="space-y-1">
          <h4 className="text-[13px] font-semibold text-ink-soft">Değişecek</h4>
          <ul className="space-y-0.5 text-sm">
            {card.changes.map((c) => (
              <li key={c.key} className={cn("break-words", c.sensitive ? "font-semibold text-warn" : "text-ink")}>
                {changeLine(c)}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-xl bg-panel px-3 py-2 text-sm text-ink-mute">Rapor zaten bu hâlde; isteği kapatın.</p>
      )}
      {card.threeCols?.length ? (
        <div className="overflow-x-auto">
          <p className="mb-1 text-[13px] text-warn">Rapor istekten sonra değişti: önerinin yalnız değiştirdiği alanlar uygulanır.</p>
          <table className="w-full min-w-[22rem] text-[13px]">
            <thead>
              <tr className="text-left text-ink-mute">
                <th className="py-1 pr-2 font-medium">Alan</th>
                <th className="py-1 pr-2 font-medium">Öneri anı</th>
                <th className="py-1 pr-2 font-medium">Şimdi</th>
                <th className="py-1 font-medium">Onaydan sonra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {card.threeCols.map((r) => (
                <tr key={r.label}>
                  <td className="py-1 pr-2 text-ink-mute">{r.label}</td>
                  <td className="py-1 pr-2 break-words tabular">{r.atProposal}</td>
                  <td className="py-1 pr-2 break-words tabular">{r.now}</td>
                  <td className="py-1 font-medium break-words text-ink tabular">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {card.result || card.carry || card.next || card.receipts || card.monthPassed ? (
        <ul className="space-y-1 text-sm">
          {card.result ? <li className="font-medium text-ink">{card.result}</li> : null}
          {card.carry ? <li className="text-ink-soft">{card.carry}</li> : null}
          {card.next ? (
            <li className={card.next.holds ? "text-ink-soft" : "text-warn"}>
              {dayMonthTR(card.next.date)} açılışı ({money(card.next.opening)}) bu devirle {card.next.holds ? "tutacak" : "tutmayacak"}
            </li>
          ) : null}
          {card.receipts ? (
            <li className="text-ink-soft">
              Fişlerden: {card.receipts.count} kalem · {money(card.receipts.total)}
            </li>
          ) : null}
          {card.receipts?.unreceipted ? <li className="font-medium text-bad">Fişsiz çıkış: {money(card.receipts.unreceipted)}</li> : null}
          {card.monthPassed ? (
            <li className="flex items-start gap-1.5 text-warn">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{card.monthPassed}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <Link href={`/panel/kasa?gun=${card.date}`} className="inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
        <ExternalLink size={14} aria-hidden="true" /> Raporu aç
      </Link>
      {noteField}
      <div className="flex flex-wrap justify-end gap-2">
        {card.changes.length ? (
          <>
            <Button variant="ghost" onClick={() => decide("reject", () => toast.success(`${card.requestedByName} önerisi reddedildi`, { description: "Rapor değişmedi." }))} disabled={pending}>
              <X size={15} /> Reddet
            </Button>
            <Button onClick={() => (sensitive.length ? setConfirm(true) : approve())} disabled={pending}>
              <Check size={15} /> Onayla
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => decide("close", () => toast.success("İstek kapatıldı"))} disabled={pending}>
            <Check size={15} /> Kapat
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={approve}
        pending={pending}
        tone="primary"
        confirmLabel="Onayla"
        title={`${day} kasa raporu düzeltilsin mi?`}
        description={`Kasa alanları değişecek: ${sensitive.map((c) => changeLine(c, false)).join("; ")}. Rapor yeni sürümle kaydedilir ve alıcılara yeniden gider.`}
      />
    </article>
  );
}

function DeleteItem({ card }: { card: DeleteCard }) {
  const { pending, decide, noteField } = useDecision(card);
  const [confirm, setConfirm] = useState(false);
  const day = dayMonthTR(card.date);
  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <Head card={card} title={`Kasa raporu silme · ${longDateTR(card.date)}`} badge={<Badge tone="red">Silme</Badge>} />
      <p className="text-sm text-ink tabular">{card.summary}</p>
      <div className="space-y-1 rounded-xl bg-warn-soft px-3 py-2 text-[13px] leading-5 text-warn">
        <p>Silinince rapor ve önceki sürümleri gider; değerleri işlem geçmişinde kalır, fotoğraflar 30 gün saklanır.</p>
        {card.next ? <p className="font-medium">{card.next}</p> : null}
      </div>
      <Link href={`/panel/kasa?gun=${card.date}`} className="inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
        <ExternalLink size={14} aria-hidden="true" /> Raporu aç
      </Link>
      {noteField}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject", () => toast.success("Silme isteği reddedildi", { description: "Rapor yerinde kaldı." }))} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        <Button variant="danger" onClick={() => setConfirm(true)} disabled={pending}>
          <Trash2 size={15} /> Onayla ve sil
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          decide("approve", () => toast.success(`${day} raporu silindi`, { description: `${card.requestedByName} isteği onaylandı.` }));
        }}
        pending={pending}
        confirmLabel="Sil"
        title={`${day} raporu silinsin mi?`}
        description="Rapor ve önceki sürümleri silinir; personel o günü yeniden girebilir. Gönderilmiş e-posta geri alınmaz."
      />
    </article>
  );
}
