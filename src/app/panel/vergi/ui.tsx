import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { SectionTabs } from "@/components/panel/section-tabs";
import { Badge, type Tone } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { Notice, NoticeGroup, type NoticeItem, NoticeLink, type NoticeRisk } from "@/components/ui/notice";
import { type Confidence, CONFIDENCE_LABELS, TAX_DISCLAIMER, TAX_DISCLAIMER_SHORT } from "@/lib/tax/rules";
import { cn } from "@/lib/utils";

import type { RuleRef } from "./refs";

/*
 * Vergi bölümünün ortak parçaları (plan docs/planlar/vergi.md §4.0, docs/planlar/ux-sade.md §7.4): başlık ve sekmeler,
 * üst bant (kutusuz tek satır: kısa feragat ve tam metni açan ⓘ, kapsam ve muhasebeci çipleri), bandın altındaki
 * uyarılar, "Nasıl hesaplandı" açılırı, döküm listesi ve kullanılan kuralların dayanağı. Sunucu bileşenleri;
 * içlerindeki InfoTip istemcide açılır.
 */

export type VergiPath = "/panel/vergi" | "/panel/vergi/gelir-gider" | "/panel/vergi/demirbas" | "/panel/vergi/kurallar";

export const OZET_DESCRIPTION = "Devlete ödenecekler: KDV, SGK, maaş vergileri ve kâr vergisi; tahmini tutar ve son gün.";

/**
 * Sayfa başlığı ve dört sekme (Özet, Vergi kârı, Demirbaş, Muhasebeci; kenar çubuğunun "Vergi, KDV, SGK" grubundan);
 * yalnız yönetici. `more`: eski uzun açıklama, açıklamanın sonundaki ⓘ "Nasıl çalışır?" (§8)
 */
export function VergiHeader({ current, title, description, more, actions }: { current: VergiPath; title: string; description?: ReactNode; more?: string; actions?: ReactNode }) {
  return (
    <PageHeader path={current} title={title} description={description} more={more} actions={actions} tabs={<SectionTabs section="vergi" current={current} role="admin" />} />
  );
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
  /**
   * Bandın altında bayat kurallarla aynı grupta çizilen uyarılar (Özet'in günü geçmiş vergi ödemesi, §7.2). Bant
   * çağrısı her sekmede aynı kalır (`<TaxBanner data={banner} />`)
   */
  notices?: readonly NoticeItem[];
}

const CHIP = "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs leading-4 font-medium whitespace-nowrap text-ink-soft ring-1 ring-line";

/** Kurallar bayatlayınca bandın altında (§7.4): cümleler Ayrıntı'da, eylem kural tablosu (adres onu açık getirir) */
function staleNotice(stale: readonly string[]): NoticeItem | null {
  if (!stale.length) return null;
  return {
    key: "stale",
    tone: "warn",
    size: "sm",
    title: "Vergi kuralları güncel olmayabilir",
    action: <NoticeLink href="/panel/vergi/kurallar#kurallar">Kural tablosu</NoticeLink>,
    children: stale.map((s) => (
      <p key={s} className="break-words">
        {s}
      </p>
    )),
  };
}

/**
 * Üst bant (§7.4): kutusuz tek satır, her sekmede ve her genişlikte aynı. Kısa feragat ve tam metni (feragat,
 * kuralların derlendiği gün, bayatlama cümleleri) açan ⓘ; kapsam çipi; muhasebeci çipi yalnız masaüstünde (telefonda
 * "Muhasebeci" sekmesi aynı yere gider). Bayat kurallar ve Özet'in günü geçmiş ödemesi altında tek `NoticeGroup`'ta
 */
export function TaxBanner({ data }: { data: BannerData }) {
  const full = [TAX_DISCLAIMER, data.compiled, ...data.stale].join(" ");
  const stale = staleNotice(data.stale);
  const notices = [...(data.notices ?? []), ...(stale ? [stale] : [])];
  return (
    <>
      <div role="note" aria-label="Vergi tahmini hakkında" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5 text-ink-soft">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          {TAX_DISCLAIMER_SHORT}
          <InfoTip text={full} label="Tahmin hakkında" />
        </span>
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
            "relative outline-none after:absolute after:-inset-y-3 after:inset-x-0 after:content-[''] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 max-sm:hidden",
            data.checks.allDone && "bg-lime/25 text-good-ink ring-lime/40",
          )}
        >
          {data.checks.chip}
        </Link>
      </div>
      <NoticeGroup items={notices} className="mb-4" />
    </>
  );
}

/** Feragatin tam metni: yalnız Muhasebeci'nin sonunda, her genişlikte (§7.4; bandın ⓘ'si aynı metni açar) */
export function DisclaimerBody({ data }: { data: Pick<BannerData, "compiled" | "stale"> }) {
  return (
    <p id="feragat" className="scroll-mt-20 text-xs leading-5 text-pretty text-ink-mute">
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

/** Döküm notları (uyarı değil; uyarı cümleleri `NoteNotice` ile) */
export function NoteList({ notes, className }: { notes: readonly string[]; className?: string }) {
  if (!notes.length) return null;
  return (
    <ul className={cn("space-y-1 text-[13px] leading-5 text-ink-mute", className)}>
      {notes.map((n, i) => (
        <li key={i} className="min-w-0 break-words text-pretty">
          {n}
        </li>
      ))}
    </ul>
  );
}

/**
 * Vergi uyarı cümleleri tek kutuda (docs/planlar/ux-sade.md §6.2): ilk not başlık, kalanı Ayrıntı. Tutarı ya da yasal
 * sonucu bozduğu için hiç katlanmaz (`risk`). `size="line"` takvim satırının açık gövdesinde.
 */
export function NoteNotice({
  notes,
  risk = "para",
  action,
  size = "sm",
  className,
}: {
  notes: readonly string[];
  risk?: NoticeRisk;
  action?: ReactNode;
  size?: "sm" | "line";
  className?: string;
}) {
  const [first, ...rest] = notes;
  if (!first) return null;
  return (
    <Notice tone="warn" size={size} risk={risk} title={first.replace(/\.$/, "")} action={action} className={className}>
      {rest.length
        ? rest.map((n, i) => (
            <p key={i} className="break-words">
              {n}
            </p>
          ))
        : null}
    </Notice>
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
