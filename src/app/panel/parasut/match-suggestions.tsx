"use client";

import { Bot, Check, Link2, PackageX, Sparkles, Type, X } from "lucide-react";
import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { num } from "@/lib/format";
import { factorText } from "@/lib/price-hold";
import { MATCH_CONFIDENCE_LABEL, MATCH_SOURCE_LABEL, type AiMatchState, type MatchConfidence, type MatchSource, type MatchView } from "@/lib/product-match-ai";
import { cn } from "@/lib/utils";

import { usdText } from "../ayarlar/summaries";

/*
 * Paraşüt › Ürün → hammadde bağlantıları: "AI ile öner" şeridi ve bekleyen ürün satırındaki öneri kutusu (kaynak,
 * hammadde, çarpan, güven, gerekçe, uyarılar, Uygula / Yoksay). Öneri yalnız formu doldurur; bağlantı "Bağla" ya da toplu
 * penceredeki onayla kurulur (src/lib/product-match-ai.ts; docs/PARASUT.md § 5e).
 */

const UNIT_LABEL: Record<string, string> = { gr: "gr", ml: "ml", adet: "adet", dilim: "dilim" };

/** Güven rozeti: yüksek yeşil, orta sarı, düşük gri (renk tek başına anlam taşımasın: metinle ve noktayla) */
export const CONFIDENCE_TONE: Record<MatchConfidence, Tone> = { yuksek: "green", orta: "amber", dusuk: "gray" };
const SOURCE_TONE: Record<MatchSource, Tone> = { link: "blue", name: "gray", ai: "violet" };
const SOURCE_ICON: Record<MatchSource, typeof Link2> = { link: Link2, name: Type, ai: Bot };

/** Kaynak ve güven rozetleri (satırda ve toplu pencerede) */
export function MatchBadges({ view }: { view: Pick<MatchView, "source" | "confidence"> }) {
  const Icon = SOURCE_ICON[view.source];
  return (
    <>
      <Badge tone={SOURCE_TONE[view.source]}>
        <Icon size={11} aria-hidden="true" />
        {MATCH_SOURCE_LABEL[view.source]}
      </Badge>
      <Badge tone={CONFIDENCE_TONE[view.confidence]} dot>
        {MATCH_CONFIDENCE_LABEL[view.confidence]}
      </Badge>
    </>
  );
}

/**
 * Toplu penceredeki uyarı satırları (paket çelişkisi, fiyat farkı, AI'nin reddedilen kısmı): pencerenin öteki
 * satırları gibi renkli metin; satır içi öğelerle (span), etiketin (label) içinde de geçerli HTML
 */
export function MatchWarnings({ warnings, className }: { warnings: MatchView["warnings"]; className?: string }) {
  if (!warnings.length) return null;
  return (
    <span className={cn("block space-y-0.5", className)}>
      {warnings.map((w) => (
        <span key={w.text} className={cn("block break-words", w.kind === "ai" ? "text-ink-mute" : "font-medium text-warn")}>
          <span className="sr-only">{w.kind === "ai" ? "Not: " : "Uyarı: "}</span>
          {w.text}
        </span>
      ))}
    </span>
  );
}

/** Önerinin özeti: "→ Süt · 1 Adet = 1.000 ml" / "Hammadde değil" / "Emin değil" */
export function matchSummary(view: MatchView, ingredient: { name: string; unit: string } | undefined, lineUnit: string | null): string {
  if (view.decision === "hammadde_degil") return "Hammadde değil (kargo, hizmet, ekipman)";
  if (!ingredient) return "AI emin değil: listede uyan hammadde yok";
  const factor = view.factor ? factorText(lineUnit, view.factor, UNIT_LABEL[ingredient.unit] ?? ingredient.unit) : "çarpanı yazın";
  return `${view.decision === "emin_degil" ? "Belki " : ""}${ingredient.name} · ${factor}`;
}

/**
 * Kısa öneri mi: uyarısız ad benzerliği ve uyarısız, yüksek güvenli "aynı ürün bağlı" tek satır (rozet, özet, Uygula).
 * AI önerisi ve uyarılı öneri tam kutu (gerekçe, uyarılar, Yoksay): AI'den önce 25 bekleyenin 17'si aynı kalıp
 * gerekçeli kutuyla listeyi uzatıyor, asıl incelenecek öneriler arada kayboluyordu
 */
export const compactSuggestion = (view: Pick<MatchView, "source" | "confidence" | "warnings">): boolean =>
  view.warnings.length === 0 && (view.source === "name" || (view.source === "link" && view.confidence === "yuksek"));

/**
 * Bekleyen ürün satırındaki öneri. "Uygula" formu doldurur (hammadde ve çarpan; kaydetmez), "Yoksay" öneriyi bu
 * oturumda gizler, AI "hammadde değil" dediyse "Hammadde değil olarak işaretle" bugünkü işaretlemeyi yapar (geri alınır).
 * Kısa öneride (compactSuggestion) gerekçe yalnız ipucunda, Yoksay yok (hammaddeyi seçmek yeter)
 */
export function SuggestionBox({
  view,
  productName,
  lineUnit,
  ingredient,
  applied,
  pending,
  onApply,
  onIgnore,
  onDismiss,
  className,
}: {
  view: MatchView;
  productName: string;
  lineUnit: string | null;
  ingredient: { name: string; unit: string; packageDesc?: string | null } | undefined;
  applied: boolean;
  pending: boolean;
  onApply: () => void;
  onIgnore: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  const canApply = view.decision !== "hammadde_degil" && Boolean(ingredient);
  const applyButton = canApply ? (
    <Button
      size="xs"
      variant={applied ? "ghost" : "secondary"}
      disabled={applied}
      onClick={onApply}
      aria-label={applied ? `${productName}: öneri forma uygulandı` : `${productName}: öneriyi forma uygula`}
      title="Hammaddeyi ve çarpanı forma yazar; bağlamak için Bağla'ya basın"
    >
      <Check size={13} aria-hidden="true" /> {applied ? "Uygulandı" : "Uygula"}
    </Button>
  ) : null;
  if (compactSuggestion(view))
    return (
      <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5 text-xs", className)} title={view.reason || undefined}>
        <span className="sr-only">Öneri:</span>
        <MatchBadges view={view} />
        <span className="min-w-0 font-medium break-words text-ink-soft">{matchSummary(view, ingredient, lineUnit)}</span>
        {applyButton}
      </div>
    );
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl bg-panel px-3 py-2 text-xs ring-1 ring-line", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="sr-only">Öneri:</span>
        <MatchBadges view={view} />
        <span className={cn("min-w-0 font-medium break-words", view.decision === "bagla" ? "text-ink" : "text-ink-soft")}>
          {matchSummary(view, ingredient, lineUnit)}
        </span>
      </div>
      {ingredient?.packageDesc && canApply ? <p className="break-words text-ink-mute">{ingredient.packageDesc}</p> : null}
      {view.reason ? <p className="break-words text-pretty text-ink-soft">{view.reason}</p> : null}
      {view.warnings.map((w) => (
        <Notice key={w.text} tone={w.kind === "ai" ? "neutral" : "warn"} size="line" className="min-w-0" title={w.text} />
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        {applyButton}
        {view.decision === "hammadde_degil" ? (
          <Button size="xs" variant="secondary" disabled={pending} onClick={onIgnore} aria-label={`${productName}: hammadde değil olarak işaretle`}>
            <PackageX size={13} aria-hidden="true" /> Hammadde değil olarak işaretle
          </Button>
        ) : null}
        <Button size="xs" variant="ghost" onClick={onDismiss} aria-label={`${productName}: öneriyi yoksay`} title="Öneriyi bu sayfada gizler; hammaddeyi elle seçebilirsiniz">
          <X size={13} aria-hidden="true" /> Yoksay
        </Button>
      </div>
    </div>
  );
}

/** Düğme kapalıyken nedeni */
function offReason(ai: AiMatchState): string | null {
  if (ai.state === "nokey") return "Bu ortamda kurulu değil (ANTHROPIC_API_KEY yok); öneriler ürün adından çıkar.";
  if (ai.state === "off") return "Kapalı: Ayarlar › Fotoğraftan okuma kapalıyken AI'ye istek gitmez.";
  if (ai.state === "cap") return `Bugünkü sınır doldu (${num(ai.cap)} parti); yarın yeniden açılır.`;
  return null;
}

/**
 * "AI ile öner" şeridi: yalnız düğmeyle çalışır (sayfa açılınca istek gitmez). Kapalıyken nedeni yazar; sorulacak ürün
 * yoksa düğme kapalıdır. Bu ayın ürün önerisi istekleri ve tutarı küçük notta
 */
export function AiSuggestBar({ ai, running, progress, onRun }: { ai: AiMatchState; running: boolean; progress: { done: number; left: number } | null; onRun: () => void }) {
  const off = offReason(ai);
  const ready = Object.keys(ai.items).length;
  const batches = Math.ceil(ai.askable / Math.max(1, ai.batchSize));
  const status = progress
    ? `${num(progress.done)} ürün önerildi${progress.left ? `, ${num(progress.left)} kaldı…` : ""}`
    : off
      ? off
      : ai.askable
        ? `${num(ai.askable)} ürün sorulacak (${num(batches)} istek${batches > 1 ? `, ${num(ai.batchSize)}'şerli` : ""})${ready ? ` · ${num(ready)} ürünün önerisi hazır` : ""}`
        : ready
          ? `Bekleyen her ürünün önerisi hazır (${num(ready)} AI önerisi).`
          : "Bekleyenlerin önerisi aynı ürünün bağlantısından geliyor; AI'ye sormaya gerek yok.";
  return (
    <div className="mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-surface px-3.5 py-2.5 text-sm">
      <Sparkles size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          AI ile öneri
          <InfoTip text="Claude Sonnet 5.5 bekleyen ürünleri hammadde listenizle ve şimdiye kadar yaptığınız bağlantılarla karşılaştırır; her ürün için hammadde, çarpan, güven ve kısa gerekçe döner. Aynı ürünü zaten bağladıysanız sorulmaz. Öneriler saklanır, sayfa yenilenince yeniden sorulmaz. Hiçbir bağlantı siz onaylamadan kurulmaz." />
        </p>
        <p className="text-xs break-words text-ink-mute" aria-live="polite">
          {status}
          {ai.monthCalls && !progress ? (
            <span className="text-ink-quiet">
              {" "}
              · bu ay {num(ai.monthCalls)} istek, {usdText(ai.monthUsd)}
            </span>
          ) : null}
        </p>
        {ai.state === "off" ? (
          <Link href="/panel/ayarlar#foto" className="text-xs font-medium text-info hover:underline pointer-coarse:inline-block pointer-coarse:py-2.5">
            Ayarlar › Fotoğraftan okuma
          </Link>
        ) : null}
      </div>
      <Button size="sm" variant="secondary" disabled={running || ai.state !== "on" || !ai.askable} onClick={onRun} title={off ?? undefined}>
        <Sparkles size={14} className={cn(running && "animate-pulse")} aria-hidden="true" /> {running ? "Öneriliyor…" : "AI ile öner"}
      </Button>
    </div>
  );
}
