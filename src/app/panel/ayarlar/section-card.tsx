"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { Card, CardHeader } from "@/components/ui/card";
import { TONE_ICON } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

import { pinSection } from "./pin-scroll";
import { SECTION_SCROLL_MARGIN, type SettingsSectionId } from "./sections";

const OPEN_EVENT = "ayarlar:bolum-ac";

/**
 * Telefonda kapalı bir bölümü açar (kayıtta hatalı alan, başka ekrandan #bölüm bağlantısı); DOM hemen güncellenir,
 * çağıran hemen ardından bölümdeki alana odaklanabilir. Geniş ekranda bölümler zaten açık; etkisi yoktur.
 */
export function openSettingsSection(id: SettingsSectionId) {
  window.dispatchEvent(new CustomEvent<SettingsSectionId>(OPEN_EVENT, { detail: id }));
}

/** Bölümdeki alanı göster ve odakla (telefonda bölüm kapalıysa önce açılır) */
export function revealSettingsField(section: SettingsSectionId, fieldId: string) {
  openSettingsSection(section);
  const el = document.getElementById(fieldId);
  el?.focus({ preventScroll: true });
  el?.scrollIntoView({ block: "center" });
}

/**
 * Ayarlar sayfasının bölüm kartı. Geniş ekranda (sm ve üstü) olağan kart: başlık, açıklama, eylemler, içerik;
 * bölümler arası gezinme kenardaki listeden. Telefonda akordeon: kapalıyken tek satır (ikon, ad, şu anki
 * değerlerin özeti, kaydedilmemiş değişiklik noktası), dokununca açıklama, eylemler ve alanlar açılır.
 * Birden çok bölüm aynı anda açık kalabilir. Adres #bölüm ise (yer imi, yenileme, Yardım'dan gelen bağlantı) o
 * bölüm açık gelir ve başlığı üst çubuğun altına kaydırılır (pin-scroll.ts).
 * `href` verilirse bölüm başka bir ekrana giden karttır: telefonda satırın tamamı o ekrana gider (akordeon yok).
 * Kapalı görünüm sunucu HTML'inde CSS ile verilir: telefonda ilk boyamada yer kaymaz, geniş ekran etkilenmez.
 */
export function SectionCard({
  id,
  icon,
  title,
  description,
  meta,
  actions,
  actionsClassName,
  summary,
  summaryTone,
  dirty,
  href,
  className,
  children,
}: {
  id: SettingsSectionId;
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  actionsClassName?: string;
  /** Telefonda kapalıyken başlığın altında: kayıtlı değerlerin kısa özeti */
  summary?: ReactNode;
  /** Özet bir uyarı söylüyor (yedek yok, su faturası girilmedi): kapalı satır da önemi taşır (tonun mürekkebi + ikon) */
  summaryTone?: "warn" | "bad";
  /** Bölümde kaydedilmemiş değişiklik var */
  dirty?: boolean;
  /** Telefonda satırın gideceği ekran (bölüm burada açılmaz) */
  href?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // #bölüm ile her gelişte artar; kaydırma, bölümün açılışı işlendikten (sayfa uzadıktan) sonra yapılır
  const [hashHits, setHashHits] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const toggleId = `${id}-ac`;
  const bodyId = `${id}-icerik`;

  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash !== `#${id}`) return;
      setOpen(true);
      setHashHits((n) => n + 1);
    };
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<SettingsSectionId>).detail === id) flushSync(() => setOpen(true));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [id]);

  useEffect(() => {
    if (!hashHits || !ref.current) return;
    return pinSection(ref.current);
  }, [hashHits]);

  const heading = (
    <>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-base leading-6 font-semibold tracking-tight text-ink">
          {title}
          {dirty ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
              <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
              değişti
            </span>
          ) : null}
        </span>
        {summary && (href || !open) ? (
          <span
            className={cn(
              "mt-0.5 flex items-start gap-1 text-[13px] leading-5 text-pretty",
              summaryTone === "bad" ? "font-medium text-bad-ink" : summaryTone === "warn" ? "font-medium text-warn-ink" : "text-ink-mute",
            )}
          >
            {summaryTone ? <SummaryIcon tone={summaryTone} /> : null}
            <span className="min-w-0">{summary}</span>
          </span>
        ) : null}
      </span>
    </>
  );
  const rowClass =
    "flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-3xl px-5 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset";

  return (
    <Card ref={ref} id={id} className={cn(SECTION_SCROLL_MARGIN, className)}>
      {/* Telefon: akordeon başlığı ya da başka ekrana giden satır (tüm satır dokunulabilir, en az 64px) */}
      <h2 className="sm:hidden">
        {href ? (
          <Link href={href} className={rowClass}>
            {heading}
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-mute" />
          </Link>
        ) : (
          <button type="button" id={toggleId} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className={rowClass}>
            {heading}
            <ChevronDown size={18} aria-hidden="true" className={cn("shrink-0 text-ink-mute transition-transform", open && "rotate-180")} />
          </button>
        )}
      </h2>

      {/* Geniş ekran: olağan kart başlığı */}
      <CardHeader className="max-sm:hidden" icon={icon} title={title} description={description} meta={meta} actions={actions} actionsClassName={actionsClassName} />

      {href && !children ? null : (
        <div id={bodyId} className={cn("flex flex-1 flex-col", (href || !open) && "max-sm:hidden")}>
          {/* Telefonda açıklama ve eylemler başlığın altında, alanların üstünde (her zaman ilk çocuk: içeriğin üst boşluğu iki görünümde aynı kalır) */}
          <div className="sm:hidden">
            {!href && (description || meta || actions) ? (
              <div className="space-y-3 px-5 pb-4">
                {description ? <p className="text-[13px] leading-5 text-ink-mute">{description}</p> : null}
                {meta ? <div className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-mute">{meta}</div> : null}
                {actions ? <div className={cn("flex flex-wrap items-center gap-2", actionsClassName)}>{actions}</div> : null}
              </div>
            ) : null}
          </div>
          {children}
        </div>
      )}
    </Card>
  );
}

/** Kapalı satırdaki uyarının ikonu (uyarılarla aynı tablo) */
function SummaryIcon({ tone }: { tone: "warn" | "bad" }) {
  const Icon = TONE_ICON[tone];
  return (
    <>
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="mt-[3px] size-3.5 shrink-0" />
      <span className="sr-only">{tone === "bad" ? "Önemli: " : "Dikkat: "}</span>
    </>
  );
}
