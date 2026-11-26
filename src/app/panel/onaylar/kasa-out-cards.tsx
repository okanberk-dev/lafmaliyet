"use client";

import { Check, ExternalLink, ImageMinus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PhotoThumb } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { diffText, stampTR } from "@/lib/cash-report";
import { cashOutCardTitle, lineText, photoCardTitle, type CashOutLineT } from "@/lib/cash-out-requests";
import { money } from "@/lib/format";
import { photoCaption } from "@/lib/photo-rules";
import { genitive } from "@/lib/recipe-change";
import { dayMonthTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { reviewCashOutRequest, reviewPhotoRemoval } from "@/server/actions/cash-out-requests";
import type { CashOutCard, PhotoRemovalCard } from "@/server/data/cash-out-requests";

import { BranchBadge, kasaDayHref } from "./branch-badge";

/*
 * Onaylar › Kasa: kasadan çıkan istekleri ve fotoğraf kaldırma (yalnız yönetici; docs/KASA-RAPORU.md › Kasadan çıkan:
 * kapanmış gün, yöneticinin satırı). Kartta satır, fişi, değişiklikler ve bağlam (günün kasa farkı, o günün satırları,
 * fiş tekrarı, kırmızı işaretler, gider ayı); onay kasa raporunu değiştirmez, fark kartta görünür ve rapor normal yoldan
 * düzeltilir. Not personele görünür (tutar yazılmaz). Birden çok kasa açıkken kart isteğin kasasını adıyla yazar ve
 * "Günü aç" / "Raporu aç" o şubenin gününü açar (`?sube=`; denetim 21 Kasım #29).
 */

const OP_BADGE = { ekle: { tone: "blue", text: "Ekleme" }, duzelt: { tone: "amber", text: "Düzeltme" }, sil: { tone: "red", text: "Silme" } } as const;
const DOC: Record<CashOutLineT["docType"], string> = { fis: "fiş", e_arsiv: "e-Arşiv", fatura: "fatura", yok: "belgesiz" };

/** Satırın ayrıntısı: "Migros · süt · 412,50 ₺ · fiş · fiş tarihi 21 Eki · KDV 30,50 ₺" */
function lineDetail(l: CashOutLineT): string {
  const parts = [lineText(l)];
  if (l.kind === "harcama") {
    parts.push(DOC[l.docType]);
    if (l.receiptDate) parts.push(`fiş tarihi ${dayMonthTR(l.receiptDate)}`);
    if (l.vat !== null) parts.push(`KDV ${money(l.vat)}`);
  }
  if (l.kind === "harcama" && l.description && l.store) parts.splice(1, 0, l.description);
  return parts.join(" · ");
}

function Head({ title, by, createdAt, waited, message, badges }: { title: string; by: string; createdAt: string; waited: string; message: string | null; badges: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="min-w-0 break-words">{title}</span>
        {badges}
      </h3>
      <p className="text-[13px] text-ink-mute tabular">
        {by} · {stampTR(createdAt)} · {waited} bekliyor
      </p>
      {message ? <p className="text-sm break-words text-ink-soft">Not: {message}</p> : null}
    </div>
  );
}

function NoteField({ id, note, setNote }: { id: number; note: string; setNote: (v: string) => void }) {
  return (
    <Field label="Not (isteğe bağlı; personele görünür, tutar yazmayın)" htmlFor={`not-${id}`}>
      <Textarea id={`not-${id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
    </Field>
  );
}

/**
 * Kasadan çıkan isteği: ekleme (satır ve fiş), düzeltme (değişecekler) ya da silme; satır istekten sonra değiştiyse
 * amber uyarı ve "Yine de uygula". Ekleme ve düzeltmede "Aylık harcamalar'a da yaz" ve kategori (yöneticiye bütün etkin
 * kategoriler, müdüre personelinkiler; düzeltmede satırın şimdiki kategorisi kalabilir).
 */
export function CashOutItem({ card, categories }: { card: CashOutCard; categories: { id: number; name: string }[] }) {
  const [note, setNote] = useState("");
  const [toExpenses, setToExpenses] = useState(card.defaults.toExpenses);
  const [categoryId, setCategoryId] = useState(card.defaults.categoryId ? String(card.defaults.categoryId) : "");
  const [confirm, setConfirm] = useState(false);
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const [pending, start] = useActionTransition();
  const l = card.line;
  const harcama = l?.kind === "harcama";
  const who = genitive(card.requestedByName);
  const c = card.context;
  // Düzeltmede satırın şimdiki kategorisi seçicide yoksa (müdür yalnız personelin kategorilerini seçer)
  const currentHidden = card.op === "duzelt" && card.defaults.categoryId !== null && !categories.some((k) => k.id === card.defaults.categoryId);

  function decide(decision: "approve" | "reject") {
    if (decision === "approve" && harcama && toExpenses && !categoryId) return void toast.error("Kategori seçin");
    start(async () => {
      const res = await reviewCashOutRequest({
        id: card.id,
        seenVersion: card.version,
        decision,
        note: note.trim() || null,
        toExpenses: harcama ? toExpenses : null,
        categoryId: harcama && toExpenses && categoryId ? Number(categoryId) : null,
        force: card.changedSince,
      });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      setConfirm(false);
      if (decision === "reject") toast.success(`${who} isteği reddedildi`, { description: "Kasa değişmedi." });
      else toast.success(card.op === "sil" ? "Satır silindi" : card.op === "ekle" ? "Satır kasaya eklendi" : "Satır düzeltildi", { description: `${who} isteği onaylandı. Kasa raporu değişmedi.` });
    });
  }

  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <Head
        title={cashOutCardTitle(card.op, card.date)}
        by={card.requestedByName}
        createdAt={card.createdAt}
        waited={card.waited}
        message={card.message}
        badges={
          <>
            <BranchBadge branch={card.branch} />
            <Badge tone={OP_BADGE[card.op].tone}>{OP_BADGE[card.op].text}</Badge>
            {c.dayClosed ? <Badge tone="gray">Kapanmış gün</Badge> : null}
            {card.expense?.admin ? <Badge tone="violet">Yöneticinin satırı</Badge> : null}
          </>
        }
      />
      {card.photoId ? (
        <PhotoThumb id={card.photoId} caption={photoCaption("fis", card.createdAt, card.requestedByName)} onOpen={() => setViewer({ id: card.photoId!, caption: "Fiş" })} />
      ) : null}
      {card.op === "ekle" && l ? <p className="text-sm break-words text-ink tabular">{lineDetail(l)}</p> : null}
      {card.op !== "ekle" && card.before ? (
        <p className="text-sm break-words text-ink-soft tabular">
          {card.op === "sil" ? "Silinecek: " : "Şimdiki: "}
          {lineDetail(card.before)} · {card.before.createdByName} ekledi
        </p>
      ) : null}
      {card.changes.length ? (
        <section aria-label="Değişecek" className="space-y-1">
          <h4 className="text-[13px] font-semibold text-ink-soft">Değişecek</h4>
          <ul className="space-y-0.5 text-sm">
            {card.changes.map((x) => (
              <li key={x} className="font-medium break-words text-warn">
                {x}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {card.expense ? (
        <p className="text-[13px] text-ink-mute">
          {/* Müdüre yöneticinin kategorisinin adı gelmez (categoryName null): yalnız "yöneticinin kategorisi" */}
          Bağlı gider: {card.expense.categoryName ?? (card.expense.admin ? "yöneticinin kategorisi" : "kategori yok")}
          {card.expense.admin && card.expense.categoryName ? " (yöneticinin kategorisi)" : ""}
        </p>
      ) : null}
      {card.rowGone ? <Notice tone="bad" size="sm" title="Satır silinmiş; isteği reddedin" /> : null}
      {card.changedSince ? (
        <Notice
          tone="warn"
          size="sm"
          title="İstekten sonra değişti"
          text="Satır, fişi ya da bağlı gider kaydı. Günü açıp bakın; onaylarsanız istenen hâl yazılır."
        />
      ) : null}
      {c.flags.length ? (
        <ul className="space-y-1">
          {c.flags.map((f) => (
            <li key={f}>
              <Notice tone="bad" size="line" title={f} />
            </li>
          ))}
        </ul>
      ) : null}
      <section aria-label="O gün" className="space-y-1.5 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5">
        <p className="text-ink">
          {c.report ? (
            <>
              Kasa farkı: <span className="font-semibold">{diffText(c.report.cashDiff)}</span> · Rapor: gün içinde kasadan çıkan {money(c.report.cashOut)} · satırlar onaydan sonra{" "}
              {money(c.totals.after)}
            </>
          ) : (
            <>O günün kasa raporu yok · satırlar onaydan sonra {money(c.totals.after)}</>
          )}
        </p>
        {c.lines.length ? (
          <ul className="space-y-0.5 text-ink-soft">
            {c.lines.map((x) => (
              <li key={x.id} className={cn("flex min-w-0 gap-2", x.subject && "font-medium text-ink")}>
                <span className="min-w-0 flex-1 truncate">
                  {x.label} · {x.by}
                  {x.photo ? " · fişli" : ""}
                </span>
                <span className="shrink-0 tabular">{money(x.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-mute">O güne kayıtlı kasadan çıkan yok.</p>
        )}
        {c.duplicates.length ? (
          <div className="text-warn">
            <p className="font-medium">Olası tekrar:</p>
            <ul>
              {c.duplicates.map((d) => (
                <li key={d} className="break-words">
                  {d}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.monthWarning ? <p className="text-warn">{c.monthWarning}</p> : null}
        <Link href={kasaDayHref(card)} className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
          <ExternalLink size={14} aria-hidden="true" /> Günü aç
        </Link>
      </section>
      {harcama && card.op !== "sil" && !card.rowGone ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Switch checked={toExpenses} onChange={setToExpenses} label="Aylık harcamalar'a da yaz" showText onText="Aylık harcamalar'a da yaz" offText="Aylık harcamalar'a yazılmaz" />
          </div>
          {toExpenses ? (
            <Field label="Kategori" htmlFor={`kat-${card.id}`} className="sm:col-span-2">
              <Select id={`kat-${card.id}`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Kategori seçin</option>
                {/* Satırın şimdiki kategorisi listede yoksa (müdüre yöneticinin kategorisi): adı yazmadan kalabilir */}
                {currentHidden ? <option value={card.defaults.categoryId!}>{card.expense?.categoryName ?? "Yöneticinin kategorisi"} (şimdiki)</option> : null}
                {categories.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      ) : null}
      <NoteField id={card.id} note={note} setNote={setNote} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject")} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        {!card.rowGone ? (
          card.op === "sil" ? (
            <Button variant="danger" onClick={() => setConfirm(true)} disabled={pending}>
              <Trash2 size={15} /> {card.changedSince ? "Yine de sil" : "Onayla ve sil"}
            </Button>
          ) : (
            <Button onClick={() => decide("approve")} disabled={pending}>
              <Check size={15} /> {card.changedSince ? "Yine de uygula" : "Onayla"}
            </Button>
          )
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => decide("approve")}
        pending={pending}
        confirmLabel="Sil"
        title="Satır silinsin mi?"
        description={card.before ? `${lineText(card.before)} silinir; bağlı gider kaydı da gider. Kasa raporu değişmez.` : undefined}
      />
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </article>
  );
}

/** Fotoğraf kaldırma: küçük resim, okuma farkları ve neden; tek Z, okuma farkı ya da kopuk bağda onay yok */
export function PhotoRemovalItem({ card }: { card: PhotoRemovalCard }) {
  const [note, setNote] = useState("");
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useActionTransition();
  const who = genitive(card.requestedByName);

  function decide(decision: "approve" | "reject") {
    start(async () => {
      const res = await reviewPhotoRemoval({ id: card.id, seenVersion: card.version, decision, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error, { duration: 10_000 });
      setConfirm(false);
      toast.success(decision === "approve" ? "Fotoğraf rapordan çıkarıldı" : `${who} isteği reddedildi`, { description: decision === "approve" ? "Fotoğraf 30 gün saklanır." : "Fotoğraf yerinde kaldı." });
    });
  }

  const caption = card.photo ? photoCaption(card.photo.kind, card.photo.createdAt, card.photo.byName) : "";
  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <Head
        title={photoCardTitle(card.photoKind, card.date)}
        by={card.requestedByName}
        createdAt={card.createdAt}
        waited={card.waited}
        message={card.message}
        badges={
          <>
            <BranchBadge branch={card.branch} />
            <Badge tone="red">Fotoğraf</Badge>
          </>
        }
      />
      {card.photo ? <PhotoThumb id={card.photo.id} caption={caption} onOpen={() => setViewer({ id: card.photo!.id, caption })} /> : null}
      <p className="text-sm text-ink-soft">{card.diffs.length ? `Okuma: ${card.diffs.join("; ")}` : "Okuma farkı yok."}</p>
      {card.refusal ? <Notice tone="bad" size="sm" title={`${card.refusal}; isteği reddedin.`} /> : null}
      <Link href={kasaDayHref(card)} className="inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink pointer-coarse:py-2.5">
        <ExternalLink size={14} aria-hidden="true" /> Raporu aç
      </Link>
      <NoteField id={card.id} note={note} setNote={setNote} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject")} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        {!card.refusal ? (
          <Button variant="danger" onClick={() => setConfirm(true)} disabled={pending}>
            <ImageMinus size={15} /> Onayla ve kaldır
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => decide("approve")}
        pending={pending}
        confirmLabel="Kaldır"
        title="Fotoğraf rapordan çıkarılsın mı?"
        description="Rapor kalır; fotoğraf 30 gün saklanır, okuması işlem geçmişine yazılır."
      />
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </article>
  );
}
