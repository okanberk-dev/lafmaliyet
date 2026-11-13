"use client";

import { Check, ExternalLink, Pencil, Trash2, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Field, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { carryDiffText, changeLine, computeCash, diffText, stampTR, zNoOrder, type CashReportFields } from "@/lib/cash-report";
import { olderFirstText } from "@/lib/cash-requests";
import { money } from "@/lib/format";
import type { LafposDay } from "@/lib/lafpos/prefill";
import { genitive } from "@/lib/recipe-change";
import { dayMonthTR, longDateTR } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { reviewCashRequest } from "@/server/actions/cash-requests";
import type { LateCard } from "@/server/data/cash-late";
import type { CashRequestCard, CorrectionCard, DeleteCard } from "@/server/data/cash-requests";

import { CashForm } from "../kasa/cash-form";
import { SavedPhotos } from "../kasa/cash-photos";
import { CashBreakdown, LafposDiffList } from "../kasa/cash-summary";
import { ClosedDayItem } from "./kasa-closed-cards";
import { CashOutItem, PhotoRemovalItem } from "./kasa-out-cards";

/**
 * Onaylar › Kasa kartları (yalnız yönetici): personelin kasa raporu düzeltme önerileri ve silme istekleri. Düzeltmede
 * raporun şimdiki hâlinden onaydan sonraki hâline değişenler (kasa alanları kalın ve uyarı renginde), rapor istekten
 * sonra değiştiyse üç sütun, sonuç ve devir, sonraki raporun açılışı, fişler ve geçmiş ay uyarısı; silmede raporun
 * özeti; geç raporda fotoğraflar, Z no sırası, devir zinciri, ay ve kasadan çıkanlar. Kasa alanı değişen onay ve her
 * silme onay penceresi açar. Not personele görünür (tutar yazılmaz).
 */
export function KasaRequestCards({
  cards,
  counters,
  categories,
  siteSlots = {},
}: {
  cards: CashRequestCard[];
  counters: { id: number; name: string }[];
  categories: { id: number; name: string }[];
  /** Kapalı gün kartlarının site sayıları (sunucuda, kart başına ayrı Suspense) */
  siteSlots?: Record<number, ReactNode>;
}) {
  return (
    <Card>
      <CardHeader
        icon={<Wallet />}
        title="Kasa"
        description="Personelin kasa istekleri, en eski gün önce. Onaylayınca yöneticinin girdiği gibi kaydedilir; reddederseniz notunuz personele görünür."
      />
      <div className="divide-y divide-line border-t border-line">
        {cards.map((c) =>
          c.kind === "kasa-duzeltme" ? (
            <CorrectionItem key={c.id} card={c} />
          ) : c.kind === "kasa-silme" ? (
            <DeleteItem key={c.id} card={c} />
          ) : c.kind === "kasa-gec" ? (
            <LateItem key={c.id} card={c} counters={counters} />
          ) : c.kind === "kasa-cikan" ? (
            <CashOutItem key={c.id} card={c} categories={categories} />
          ) : c.kind === "kapali-gun" ? (
            <ClosedDayItem key={c.id} card={c} site={siteSlots[c.id]} />
          ) : (
            <PhotoRemovalItem key={c.id} card={c} />
          ),
        )}
      </div>
    </Card>
  );
}

/** Kartın başı: tür ve gün, isteyen, an, bekleme, neden */
function Head({ card, title, badge }: { card: CorrectionCard | DeleteCard; title: string; badge?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
        <span className="min-w-0 break-words">{title}</span>
        {card.branch ? <Badge tone="gray">{card.branch}</Badge> : null}
        {badge}
      </h3>
      <p className="text-[13px] text-ink-mute tabular">
        {card.requestedByName} · {stampTR(card.createdAt)} · {card.waited} bekliyor
      </p>
      {card.message ? <p className="text-sm break-words text-ink-soft">Neden: {card.message}</p> : null}
    </div>
  );
}

type Decided = { revision: number | null; next: { date: string; opening: number } | null; nextBroken: boolean; skippedPhotos: number };

/** Karar: not alanı ve düğmeler; sonuç toast ile. Geç raporda raporun sürümü yok, "Düzeltip onayla" değerleri ve teslim işareti */
function useDecision(card: CorrectionCard | DeleteCard | LateCard) {
  const [note, setNote] = useState("");
  const [pending, start] = useActionTransition();
  const decide = (decision: "approve" | "reject" | "close", done: (r: Decided) => void, extra: { fields?: Omit<CashReportFields, "date"> | null; handoverSeen?: boolean } = {}) =>
    start(async () => {
      const res = await reviewCashRequest({
        id: card.id,
        seenVersion: card.version,
        seenRevision: card.kind === "kasa-gec" ? null : card.reportRevision,
        decision,
        note: note.trim() || null,
        ...extra,
      });
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
      toast.success(`${day} kasa raporu güncellendi`, { description: `${genitive(card.requestedByName)} önerisi onaylandı; rapor yeni sürümle kaydedildi.` });
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
        <Notice tone="neutral" size="sm" title="Rapor zaten bu hâlde; isteği kapatın" />
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
          {card.receipts?.lafposHanded ? (
            <li className="text-ink-soft">
              Fişlerden fazlası LafPOS&apos;ta olup Kasadan çıkanlar&apos;a girilmemiş teslim ({money(card.receipts.lafposHanded)}): fişsiz değil.
            </li>
          ) : null}
          {card.monthPassed ? (
            <li>
              <Notice tone="warn" size="line" title={card.monthPassed} />
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
            <Button variant="ghost" onClick={() => decide("reject", () => toast.success(`${genitive(card.requestedByName)} önerisi reddedildi`, { description: "Rapor değişmedi." }))} disabled={pending}>
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
      <Notice
        tone="warn"
        size="sm"
        risk="veri"
        title="Silinince rapor ve önceki sürümleri gider"
        text={
          <>
            Değerleri işlem geçmişinde kalır, fotoğraflar 30 gün saklanır.
            {card.next ? <span className="block font-medium text-ink">{card.next}</span> : null}
          </>
        }
      />
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
          decide("approve", () => toast.success(`${day} raporu silindi`, { description: `${genitive(card.requestedByName)} isteği onaylandı.` }));
        }}
        pending={pending}
        confirmLabel="Sil"
        title={`${day} raporu silinsin mi?`}
        description="Rapor ve önceki sürümleri silinir; personel o günü yeniden girebilir. Gönderilmiş e-posta geri alınmaz."
      />
    </article>
  );
}

/** "LafPOS gün sonu · Z 14 · 63 fiş · 12.400 ₺ · nakit 3.100 ₺ · sayılan 3.050 ₺" (yönetici kartı) */
function lafposZLine(day: LafposDay): string {
  const v = day.prefill.values;
  const n = (k: keyof typeof v) => (v[k] ? Number(v[k]!.value) : null);
  const parts = [
    v.zNo ? `Z ${v.zNo.value}` : null,
    n("receipts") !== null ? `${n("receipts")} fiş` : null,
    n("zTotal") !== null ? money(n("zTotal")!) : null,
    n("cash") !== null ? `nakit ${money(n("cash")!)}` : null,
    n("countedCash") !== null ? `sayılan ${money(n("countedCash")!)}` : "sayım yok",
  ].filter(Boolean);
  return `LafPOS gün sonu · ${parts.join(" · ")}`;
}

/** Zincirin bir halkasının adı: "13 Ekim" ya da "13 Ekim (onay bekliyor)" */
const linkName = (l: { date: string; kind: "rapor" | "bekleyen" }) => `${dayMonthTR(l.date)}${l.kind === "bekleyen" ? " (onay bekliyor)" : ""}`;

/**
 * Geç kasa raporu (docs/KASA-RAPORU.md › Geç rapor): personelin girdiği gün, fotoğraflar ve okumalar, Z no sırası,
 * döküm ve teslim alan, devir zinciri iki yönde, ay satırı, kasadan çıkanlar. "Onayla ve kaydet" teslim varsa işaret
 * ister; "Düzeltip onayla" formu personelin değerleriyle açar; aynı aralıkta daha eski bekleyen gün ya da artık
 * raporlu gün varken onay kapalı.
 */
function LateItem({ card, counters }: { card: LateCard; counters: { id: number; name: string }[] }) {
  const { pending, decide, noteField } = useDecision(card);
  const [seen, setSeen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const day = longDateTR(card.date);
  const f = card.fields;
  const { prev, next, prevCheck, nextCheck } = card.chain;
  // Z no sırası yalnız aynı kasanın komşusuyla (LafPOS'a geçişte Z numarası 1'den başlar)
  const zPrev = prev && card.lafpos.sameTill.prev ? { date: prev.date, zNo: prev.zNo, pending: prev.kind === "bekleyen" } : null;
  const zNext = next && card.lafpos.sameTill.next ? { date: next.date, zNo: next.zNo, pending: next.kind === "bekleyen" } : null;
  const z = zNoOrder(zPrev, f.zNo, zNext);
  const zOtherTill = (prev && !card.lafpos.sameTill.prev) || (next && !card.lafpos.sameTill.next);
  const carry = computeCash(f).carryOver;
  const blocked = card.reported ? "Bu günün raporu artık var; isteği reddedin" : card.olderPending ? olderFirstText(card.olderPending) : null;
  // Açılış önceki raporun devriyle tutmuyor ve not yok: kayıt kuralı not ister, olduğu gibi onaylanamaz
  const needsNote = !blocked && prev?.kind === "rapor" && Boolean(prevCheck) && !(f.note ?? "").trim();

  const approved = (r: Decided, corrected: boolean) => {
    toast.success(`${day} raporu kayda geçti`, {
      description: `${card.requestedByName} girdi${corrected ? ", siz düzelttiniz" : ""}; rapor kaydedildi.${r.skippedPhotos ? ` ${r.skippedPhotos} fotoğraf bağlanamadı.` : ""}`,
    });
    if (r.next) toast.warning(`${dayMonthTR(r.next.date)} açılışı bu devirle tutmuyor`, { description: "Ertesi günün açılışını ya da bu raporun sayımını kontrol edin.", duration: 12_000 });
  };
  const handover = f.handedOver > 0;

  return (
    <article id={`istek-${card.id}`} className="scroll-mt-24 space-y-3 px-5 py-4">
      <div className="space-y-1">
        <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink">
          <span className="min-w-0 break-words">{day} kasa raporu</span>
          {card.branch ? <Badge tone="gray">{card.branch}</Badge> : null}
          <Badge tone="amber">Geç rapor</Badge>
        </h3>
        <p className="text-[13px] text-ink-mute tabular">
          {card.requestedByName} gönderdi · {stampTR(card.createdAt)} · {card.lateBy}
        </p>
        {card.message ? <p className="text-sm break-words text-ink-soft">Neden geç: {card.message}</p> : null}
      </div>
      {card.photos.length ? <SavedPhotos photos={card.photos} diffs={card.diffs} admin={false} /> : null}
      {/* LafPOS gününde kanıt LafPOS'un gün sonu (G8); personelin ondan farklı yazdıkları (E-09) */}
      {card.lafpos.day ? (
        <Notice tone="neutral" size="sm" className="tabular" title={lafposZLine(card.lafpos.day)} />
      ) : card.lafpos.lafpos ? (
        <Notice tone="warn" size="sm" title="LafPOS'un bu gün sonu gelmedi: Z fotoğrafından kontrol edin" />
      ) : null}
      <LafposDiffList diffs={card.lafpos.diffs} />
      {card.unread ? <Notice tone="warn" size="sm" title="Fotoğraf okunmadı: tarihi ve rakamları fotoğraftan kontrol edin" /> : null}
      <p className={cn("text-sm break-words tabular", z.ok === false ? "font-medium text-bad" : "text-ink-soft")}>
        {z.text}
        {zOtherTill ? " · komşu rapor öteki kasanın (ModPOS / LafPOS), Z no karşılaştırılmaz" : ""}
      </p>
      {/* Yazarkasa Z'si iki komşusuyla: Z no sırası ve kümülatif zinciri (docs/planlar/okc-z.md §3.8) */}
      {card.okcChain ? <p className={cn("text-sm break-words tabular", card.okcChain.ok === false ? "font-medium text-bad" : "text-ink-soft")}>{card.okcChain.text}</p> : null}
      <CashBreakdown report={f} carry={prevCheck} next={nextCheck} audience="admin" kasa={card.lafpos.lafpos ? "LafPOS" : "ModPOS"} cardExtra={card.lafpos.day?.cardExtra ?? null} />
      {handover ? (
        <p className="text-sm text-ink">
          Teslim edilen {money(f.handedOver)}
          {card.handedTo ? (
            <span className="text-ink-soft">
              {" "}
              · {card.handedTo === "bankaya" ? "bankaya yatırıldı" : `alan: ${card.handedTo}`} ({card.requestedByName} yazdı)
            </span>
          ) : null}
        </p>
      ) : null}
      <ul className="space-y-1 text-sm">
        <li className={prevCheck ? "text-warn" : "text-ink-soft"}>
          {prev ? `Açılış ${money(f.openingCash)} · ${linkName(prev)} devri ${money(prev.carry)}: ${prevCheck ? carryDiffText(prevCheck) : "tutuyor"}` : "Önceki rapor yok; açılış denetlenemedi"}
        </li>
        <li className={nextCheck ? "text-warn" : "text-ink-soft"}>
          {next ? `${linkName(next)} açılışı ${money(next.openingCash)} · bu raporun devri ${money(carry)}: ${nextCheck ? carryDiffText(nextCheck) : "tutuyor"}` : "Sonraki rapor yok"}
        </li>
        <li className="text-ink-soft">{card.monthLine}</li>
        {card.outs.warning ? <li className={card.outs.lafposHanded !== null && card.outs.unreceipted < 1 ? "text-ink-soft" : "font-medium text-bad"}>{card.outs.warning}</li> : null}
        <li>
          <Notice tone="neutral" size="line" title="Devir zincirinin tutması kanıt değildir: teslim ve çıkan bellekten yazılabilir." />
        </li>
      </ul>
      <p className="text-sm text-ink">
        Kasa farkı: <span className="font-semibold">{diffText(card.cashDiff)}</span>
      </p>
      {blocked ? <Notice tone="bad" size="sm" title={blocked} /> : null}
      {needsNote ? (
        // Onayı engelliyor: kırmızı (docs/planlar/ux-sade.md Ek A 148)
        <Notice tone="bad" size="sm" title="Açılış devirle tutmuyor ve not yok: bu hâliyle kaydedilemez" text="Düzeltip onaylayın ve nedeni nota yazın." />
      ) : null}
      {correcting ? (
        <CashForm
          date={card.date}
          report={null}
          carry={prev ? { date: prev.date, amount: prev.carry } : null}
          whatsapp={null}
          recipients={0}
          canEdit
          photoUi={{ storage: false, reading: "off", admin: true, me: "" }}
          saved={null}
          cashOuts={[]}
          counters={counters}
          mode="review"
          initial={f}
          prevOkcZ={card.okcPrevZ}
          lafpos={card.lafpos.day}
          lafposMode={card.lafpos.lafpos}
          reviewPending={pending}
          onCancel={() => {
            setCorrecting(false);
            setSeen(false);
          }}
          onReview={(fields) => {
            const { date: _d, ...rest } = fields;
            void _d;
            if ((handover || fields.handedOver > 0) && !seen) return void toast.error("Teslimi aldığınızı ya da bankada gördüğünüzü işaretleyin");
            decide(
              "approve",
              (r) => {
                setCorrecting(false);
                approved(r, true);
              },
              { fields: rest, handoverSeen: seen },
            );
          }}
        />
      ) : null}
      {noteField}
      {/* Düzeltirken de: personel teslim 0 yazmış, yönetici teslim yazıyorsa onay işaret ister (sunucu da) */}
      {(handover || correcting) && !blocked ? (
        <Checkbox
          checked={seen}
          onChange={(e) => setSeen(e.target.checked)}
          label={
            correcting
              ? handover
                ? "Teslimi aldım / bankada gördüm (formdaki Teslim edilen tutar)"
                : "Teslim yazdıysanız: teslimi aldım / bankada gördüm (formdaki tutar)"
              : `Bu teslimi aldım / bankada gördüm (${money(f.handedOver)}${card.handedTo ? `, ${card.handedTo === "bankaya" ? "banka" : card.handedTo}` : ""})`
          }
        />
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => decide("reject", () => toast.success("Geç rapor reddedildi", { description: "Rapor kaydedilmedi; fotoğraflar 30 gün saklanır." }))} disabled={pending}>
          <X size={15} /> Reddet
        </Button>
        {!blocked ? (
          <>
            {!correcting ? (
              <Button
                variant="secondary"
                onClick={() => {
                  // Personelin tutarı için verilen işaret düzeltilen tutara geçmez
                  setSeen(false);
                  setCorrecting(true);
                }}
                disabled={pending}
              >
                <Pencil size={15} /> Düzeltip onayla
              </Button>
            ) : null}
            <Button onClick={() => decide("approve", (r) => approved(r, false), { handoverSeen: seen })} disabled={pending || (handover && !seen) || correcting || needsNote}>
              <Check size={15} /> Onayla ve kaydet
            </Button>
          </>
        ) : null}
      </div>
    </article>
  );
}
