"use client";

import { Check, LoaderCircle, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Notice, type NoticeTone } from "@/components/ui/notice";
import { cardExpired, isSettled, OP_EFFECTS, OP_STATUS_LABEL, type OpCardState, type OpOutcome, type OpStatus } from "@/lib/assistant/ops";
import { cn } from "@/lib/utils";
import { cancelAssistantOp, confirmAssistantOp, undoAssistantOp } from "@/server/actions/assistant-ops";

/**
 * Panel asistanının onay kartı (docs/ASISTAN-ISLEMLER.md › Onay kartı). İçeriği sunucu yazar: ne yapılacak, eski → yeni,
 * şube, gün, kişi / ürün, dış etki rozetleri, geri alma yolu, son geçerlilik (10 dk). Kullanıcı Onayla'ya basmadan
 * hiçbir şey değişmez; Onayla ve Vazgeç sunucu eylemleridir (src/server/actions/assistant-ops.ts). Sonuçtan sonra
 * yalnız katalogda geri alması tanımlı işlemde "Geri al" (1 saat). Tek sütun; düğmeler en az 44 px (dokunmatikte 48),
 * yerleri sabit. Telefonda (sm altı) yazılar bir boy büyük, satırların etiketi üstte değeri altta: 360 px'te de okunur.
 */

const time = (iso: string) => new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** Sonucun uyarı tonu (Notice): yapıldı iyi, yapılamadı kötü, belirsiz dikkat, öteki durumlar bilgi */
const TONE: Partial<Record<OpStatus, NoticeTone>> = { done: "good", failed: "bad", unknown: "warn" };

export function OpCardView({ state, onChange }: { state: OpCardState; onChange: (next: OpCardState) => void }) {
  const { card, status } = state;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<"confirm" | "cancel" | "undo" | null>(null);

  // Süre ve geri al penceresi: kart açıkken dakikada birkaç kez bakılır (düğmeler zamanında kapansın)
  useEffect(() => {
    if (isSettled(status) && !(status === "done" && state.undoUntil)) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [status, state.undoUntil]);

  const expired = status === "pending" && cardExpired(card, now);
  const canUndo = status === "done" && card.undoable && !!state.undoUntil && Date.parse(state.undoUntil) > now;

  const run = async (kind: "confirm" | "cancel" | "undo") => {
    if (busy) return;
    setBusy(kind);
    if (kind === "confirm") onChange({ ...state, status: "running", message: undefined });
    if (kind === "undo") onChange({ ...state, status: "undoing" });
    let out: OpOutcome;
    try {
      out = await (kind === "confirm" ? confirmAssistantOp(card.id) : kind === "cancel" ? cancelAssistantOp(card.id) : undoAssistantOp(card.id));
    } catch {
      // Yanıt gelmedi: plan tek kullanımlık olduğu için yeniden denemek güvenli (yapıldıysa sunucu "zaten" der)
      onChange({ ...state, status: kind === "undo" ? "done" : "pending", message: "Sunucudan yanıt alınamadı. Yeniden deneyin; işlem yapıldıysa kart bunu söyler." });
      setBusy(null);
      return;
    }
    setBusy(null);
    if (out.status === "refused") {
      // Hiçbir şey yapılmadı: kart önceki durumunda kalır, ileti görünür (zaten kullanılmışsa düğmeler kapanır)
      const used = kind === "confirm" && /zaten/.test(out.message);
      onChange({ ...state, status: used ? "unknown" : kind === "undo" ? "done" : state.status === "running" ? "pending" : state.status, message: out.message });
      return;
    }
    onChange({ ...state, status: out.status, message: out.message, undoUntil: out.undoUntil ?? (out.status === "done" ? state.undoUntil : null) });
  };

  const pending = status === "pending" && !expired;
  const shownStatus = expired ? "expired" : status;

  return (
    <section aria-label={`Onay kartı: ${card.title}`} className="rounded-2xl bg-surface p-3.5 text-[13.5px] leading-5 ring-1 ring-line-strong max-sm:p-3 max-sm:text-[14px]" data-component="op-card">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-5 font-semibold break-words text-ink max-sm:text-[15px] max-sm:leading-[22px]">{card.title}</h3>
          <p className="mt-0.5 text-[12px] leading-4 break-words text-ink-mute max-sm:text-[13px] max-sm:leading-[18px]">
            {[card.subject, card.branch, card.day].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5">
        {card.lines.map((l, i) => (
          // Dar telefonda (360–390 px) etiket üstte, değer altta: "eski → yeni" sıkışmasın
          <div key={i} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-2 max-sm:grid-cols-1 max-sm:gap-0 max-sm:border-b max-sm:border-line max-sm:pb-1.5 max-sm:last:border-b-0 max-sm:last:pb-0">
            <dt className="text-ink-mute max-sm:text-[12.5px] max-sm:leading-[18px]">{l.label}</dt>
            <dd className={cn("break-words", l.danger ? "font-medium text-bad-ink" : "text-ink")}>
              {l.from === undefined || l.from === null ? (
                l.to
              ) : (
                <>
                  <span className="text-ink-mute line-through decoration-ink-quiet">{l.from}</span>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> yerine </span>
                  <span className="font-medium">{l.to}</span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {card.effects.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Dış etkiler">
          {card.effects.map((e) => (
            <li key={e}>
              <Badge tone="blue">{OP_EFFECTS[e] ?? e}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {card.warnings.length ? (
        <ul className="mt-3 space-y-1 text-[12.5px] leading-[18px] text-warn-ink max-sm:text-[13.5px] max-sm:leading-5 dark:text-brass-300">
          {card.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {card.note ? (
        <p className="mt-3 rounded-lg bg-panel px-2.5 py-1.5 text-[12.5px] leading-[18px] text-ink-soft max-sm:text-[13.5px] max-sm:leading-5">
          <span className="font-medium">Asistanın notu:</span> {card.note}
        </p>
      ) : null}

      <p className="mt-3 text-[12px] leading-4 text-ink-mute max-sm:text-[13px] max-sm:leading-[18px]">
        <span className="font-medium text-ink-soft">Geri alma:</span> {card.undo}
      </p>

      {pending || status === "running" ? (
        <>
          <p className="mt-2 text-[12px] leading-4 text-ink-mute max-sm:text-[13px] max-sm:leading-[18px]">Onaylamadıkça hiçbir şey değişmez · son geçerlilik {time(card.expiresAt)} (10 dk)</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void run("cancel")}
              disabled={busy !== null || status === "running"}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-panel px-3 text-[14px] font-medium text-ink pointer-coarse:min-h-12 ring-1 ring-line-strong hover:bg-panel-deep focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50"
            >
              <X className="size-4" aria-hidden="true" /> Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void run("confirm")}
              disabled={busy !== null || status === "running"}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-primary px-3 pointer-coarse:min-h-12 text-[14px] font-semibold text-on-primary hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
            >
              {status === "running" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
              {status === "running" ? "İşleniyor…" : "Onayla"}
            </button>
          </div>
        </>
      ) : null}

      {!pending && status !== "running" ? (
        <div className="mt-3 space-y-2">
          <Notice
            size="sm"
            live="polite"
            tone={TONE[shownStatus] ?? "neutral"}
            title={OP_STATUS_LABEL[shownStatus].replace(/^./, (c) => c.toLocaleUpperCase("tr-TR"))}
            text={state.message ?? (expired ? "Hiçbir şey değişmedi; asistandan yeniden isteyin." : undefined)}
          />
          {canUndo || status === "undoing" ? (
            <button
              type="button"
              onClick={() => void run("undo")}
              disabled={busy !== null || status === "undoing"}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-panel px-3 text-[14px] font-medium text-ink ring-1 ring-line-strong hover:bg-panel-deep focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none disabled:opacity-50"
            >
              {status === "undoing" ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
              {status === "undoing" ? "Geri alınıyor…" : `Geri al (son: ${time(state.undoUntil!)})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {pending && state.message ? (
        <p className="mt-2 text-[12.5px] leading-[18px] text-warn-ink dark:text-brass-300" role="status">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
