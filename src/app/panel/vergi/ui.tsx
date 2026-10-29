import { ChevronDown, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Badge, type Tone } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { type Confidence, CONFIDENCE_LABELS, TAX_DISCLAIMER, TAX_DISCLAIMER_SHORT } from "@/lib/tax/rules";
import { cn } from "@/lib/utils";

import type { RuleRef } from "./refs";

/*
 * Vergi bölümünün ortak parçaları (plan docs/planlar/vergi.md §4.0): başlık ve sekmeler, üst bant (TAX_DISCLAIMER),
 * kapsam ve muhasebeci çipleri, "Nasıl hesaplandı" açılırı, döküm listesi ve kullanılan kuralların dayanağı. Sunucu
 * bileşenleri; içlerindeki InfoTip istemcide açılır.
 */

export type VergiPath = "/panel/vergi" | "/panel/vergi/gelir-gider" | "/panel/vergi/demirbas" | "/panel/vergi/kurallar";

export const OZET_DESCRIPTION = "Tahmini vergi takvimi, vergiye göre gelir-gider ve muhasebecinizin rakamları";

/** Sayfa başlığı ve dört sekme (Özet, Vergiye göre, Demirbaş, Kurallar); yalnız yönetici */
export function VergiHeader({ current, title, description, actions }: { current: VergiPath; title: string; description?: ReactNode; actions?: ReactNode }) {
  return <PageHeader eyebrow="Finans" title={title} description={description} actions={actions} tabs={<SectionTabs section="vergi" current={current} role="admin" />} />;
}

export interface BannerData {
  /** Kural tablosunun derlendiği gün ve karşılaştırma durumu ("Kurallar 24.10.2026'da derlendi; …") */
  compiled: string;
  /** Bayatlama cümleleri (§2.5) */
  stale: readonly string[];
  /** Kapsam çipi (K3); Kurallar'da yok (model okunmaz) */
  scope: { text: string; hint: string } | null;
  /** "Muhasebeciye sorulacaklar: 0 / 8" ya da "Muhasebecinizle gözden geçirildi (sahibin işareti)" */
  checks: { chip: string; allDone: boolean };
}

const CHIP = "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs leading-4 font-medium whitespace-nowrap text-ink-soft ring-1 ring-line";

function Chips({ data }: { data: BannerData }) {
  return (
    <>
      {data.scope ? (
        <span className={CHIP}>
          {data.scope.text}
          <InfoTip text={data.scope.hint} />
        </span>
      ) : null}
      <Link
        href="/panel/vergi/kurallar#sorular"
        className={cn(
          CHIP,
          // Dokunmatikte 44 px dokunma alanı görünmez kenarla (çip satırının boyu değişmez)
          "relative outline-none after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30",
          data.checks.allDone && "bg-lime/25 text-good-ink ring-lime/40",
        )}
      >
        {data.checks.chip}
      </Link>
    </>
  );
}

/**
 * Üst bant (gri bilgi kutusu): masaüstünde tam metin, kuralların derlendiği gün ve bayatlama cümleleri; telefonda tek
 * satır "Tahmin, beyanname değil" ve tam metni açan ipucu, çipler aynı satırda kayar
 */
export function TaxBanner({ data }: { data: BannerData }) {
  const full = [TAX_DISCLAIMER, data.compiled, ...data.stale].join(" ");
  return (
    <div role="note" aria-label="Vergi tahmini hakkında" className="mb-6 rounded-2xl bg-panel px-4 py-3 text-[13px] leading-5 text-ink-soft">
      <div className="max-sm:hidden">
        <p className="text-pretty text-ink">{TAX_DISCLAIMER}</p>
        <p className="mt-1 text-pretty text-ink-mute">{data.compiled}</p>
        {data.stale.map((s) => (
          <p key={s} className="mt-1 flex items-start gap-1.5 font-medium text-warn">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{s}</span>
          </p>
        ))}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Chips data={data} />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:hidden">
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-ink">
          {data.stale.length ? <TriangleAlert size={14} className="text-warn" aria-hidden="true" /> : null}
          {TAX_DISCLAIMER_SHORT}
          <InfoTip text={full} tone={data.stale.length ? "warn" : undefined} />
        </span>
        <div className="-my-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Chips data={data} />
        </div>
      </div>
    </div>
  );
}

/** Telefonda bantta yalnız kısa metin var; tam metin Özet ve Kurallar'ın gövdesinde de durur (§4.0) */
export function DisclaimerBody({ data }: { data: Pick<BannerData, "compiled" | "stale"> }) {
  return (
    <p className="text-xs leading-5 text-pretty text-ink-mute sm:hidden">
      {TAX_DISCLAIMER} {data.compiled}
      {data.stale.length ? ` ${data.stale.join(" ")}` : ""}
    </p>
  );
}

/** Etiket–değer satırları (uzun formül tek satıra yazılmaz; StatBreakdown deseni) */
export function DetailList({ rows, className }: { rows: readonly { label: ReactNode; value: ReactNode; strong?: boolean }[]; className?: string }) {
  if (!rows.length) return null;
  return (
    <dl className={cn("divide-y divide-line rounded-xl bg-surface px-3 ring-1 ring-line", className)}>
      {rows.map((r, i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-3 py-2 text-[13px] leading-5", r.strong && "font-semibold")}>
          {/* Uzun değer sarar (en çok %60), etiket en az %35'te kalır: telefonda harf harf alt alta düşmez (§4.0) */}
          <dt className={cn("min-w-[35%] break-words", r.strong ? "text-ink" : "text-ink-mute")}>{r.label}</dt>
          <dd className="max-w-[60%] text-right break-words text-ink tabular">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Not cümleleri; `tone="warn"` uyarı üçgeniyle */
export function NoteList({ notes, tone, className }: { notes: readonly string[]; tone?: "warn" | "bad"; className?: string }) {
  if (!notes.length) return null;
  return (
    <ul className={cn("space-y-1 text-[13px] leading-5", tone === "bad" ? "font-medium text-bad" : tone === "warn" ? "font-medium text-warn" : "text-ink-mute", className)}>
      {notes.map((n, i) => (
        <li key={i} className="flex items-start gap-1.5">
          {tone ? <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : null}
          <span className="min-w-0 break-words text-pretty">{n}</span>
        </li>
      ))}
    </ul>
  );
}

const CONFIDENCE_TONE: Record<Confidence, Tone> = { kesin: "green", muhtemel: "amber", belirsiz: "red" };

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <Badge tone={CONFIDENCE_TONE[confidence]}>{CONFIDENCE_LABELS[confidence]}</Badge>;
}

/** Kaynak bağlantıları kısa adla, yeni sekmede */
export function SourceLinks({ sources, className }: { sources: readonly { label: string; url: string }[]; className?: string }) {
  if (!sources.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5", className)}>
      {sources.map((s) => (
        <li key={s.url} className="min-w-0">
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-6 items-center break-words text-info underline decoration-info/30 underline-offset-2 outline-none hover:decoration-info focus-visible:ring-2 focus-visible:ring-ink/30 pointer-coarse:min-h-11"
          >
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Kullanılan kurallar: başlık, değer, dayanak, güven, kaynaklar ve varsa "Muhasebecinize sorun" */
export function RuleRefList({ refs }: { refs: readonly RuleRef[] }) {
  if (!refs.length) return null;
  // Kapalı başlar: satırın dökümü kısa kalsın, dayanak bir dokunuşla açılsın
  return (
    <details className="group/rules">
      <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-ink-soft outline-none select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/rules:rotate-180" />
        Kullanılan kurallar ve kaynaklar · {refs.length}
      </summary>
      <ul className="mt-1 space-y-2.5">
        {refs.map((r) => (
          <li key={r.key} className="text-[13px] leading-5">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-ink">{r.title}</span>
              <span className="text-ink tabular">{r.value}</span>
              <ConfidenceBadge confidence={r.confidence} />
            </p>
            <p className="break-words text-ink-mute">{r.basis}</p>
            {r.override ? <p className="break-words text-warn">{r.override}</p> : null}
            {r.ask ? <p className="text-ink-mute">Muhasebecinize sorun: {r.ask}</p> : null}
            <SourceLinks sources={r.sources} className="mt-0.5" />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** "Nasıl hesaplandı": açılır başlıkta başka etkileşimli öğe yok, bağlantı ve düğmeler gövdede */
export function Explain({ title = "Nasıl hesaplandı", children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <details className={cn("group/explain rounded-2xl bg-surface ring-1 ring-line", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-3.5 py-2 text-[13px] font-medium text-ink-soft outline-none select-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ink-quiet transition-transform group-open/explain:rotate-180" />
      </summary>
      <div className="space-y-3 px-3.5 pb-3.5">{children}</div>
    </details>
  );
}
