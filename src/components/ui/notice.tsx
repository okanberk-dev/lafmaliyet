import { ChevronDown, CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode, Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * Panelin tek uyarı bileşeni (docs/TASARIM.md §4, docs/planlar/ux-sade.md §4). Dört ton: bad (işlem yapılamadı ya da
 * para, son gün, barın işleyişi şimdi bozuk), warn (ay sonu rakamını bozan eksik, çift sayılma, onay bekleyen),
 * neutral (durum, kurulum, kaynak, nasıl çalışır), good (tutarlı, tamam). Başlık sonucu söyler (tutar, gün, ne olur),
 * `text` ne yapılacağını; neden, varsayım ve liste kapalı "Ayrıntı"nın içinde. Geliştirici dili (anahtar adı, komut,
 * belge yolu) yalnız `tech`'te ve personelin açtığı ekranda hiç verilmez.
 *
 * "use client" yok: açılma `<details>` ile, JavaScript'siz çalışır; istemci bileşenleri de kullanır (eylem ve
 * çocuklar ReactNode, işlev prop'u yok). Renk tek başına anlam taşımaz: her tonun kendi ikon şekli ve başlığın başında
 * ekran okuyucu öneki var.
 */

export type NoticeTone = "bad" | "warn" | "neutral" | "good";
/** Kompakt hâlde bile katlanmayan sonuç: para, yasal yükümlülük, veri kaybı, barın işleyişi */
export type NoticeRisk = "para" | "hukuk" | "veri" | "bar";

/** Tek ikon eşlemesi: sayfa, zil, "Dikkat edilmesi gerekenler" kartı ve iş listeleri aynı tabloyu kullanır */
export const TONE_ICON: Record<NoticeTone, LucideIcon> = {
  bad: CircleAlert,
  warn: TriangleAlert,
  neutral: Info,
  good: CircleCheck,
};

/** Ekran okuyucu öneki (sr-only) */
export const TONE_LABEL: Record<NoticeTone, string> = {
  bad: "Önemli",
  warn: "Dikkat",
  neutral: "Bilgi",
  good: "Tamam",
};

/** İkon kuyusu (zil, iş listesi, "Dikkat" kartı) */
export const TONE_TILE: Record<NoticeTone, string> = {
  bad: "bg-bad-soft text-bad-ink",
  warn: "bg-warn-soft text-warn-ink",
  neutral: "bg-note text-ink-mute",
  good: "bg-good-soft text-good",
};

// Kutunun zemini: halka, gölge ve mavi zemin yok (mavi artık uyarı rengi değil; yalnız seçim, hücre, rozet)
const TONE_BG: Record<NoticeTone, string> = {
  bad: "bg-bad-soft",
  warn: "bg-warn-soft",
  neutral: "bg-note",
  good: "bg-good-soft",
};

// İkonun rengi; nötrde soluk (ikon için 3:1 yeter)
const TONE_ICON_INK: Record<NoticeTone, string> = {
  bad: "text-bad-ink",
  warn: "text-warn-ink",
  neutral: "text-ink-mute",
  good: "text-good",
};

// Kutusuz satırda (size="line") başlık tonun mürekkebiyle yazılır
const TONE_LINE_INK: Record<NoticeTone, string> = {
  bad: "text-bad-ink",
  warn: "text-warn-ink",
  neutral: "text-ink-soft",
  good: "text-good",
};

export interface NoticeProps {
  tone: NoticeTone;
  /** Sonuç: konu + tutar / sayı / gün + ne olur. ≤ 10 sözcük, sonda nokta yok */
  title: ReactNode;
  /** Her zaman görünen ikinci satır: ne yapılacak, zorunlu bilgi. ≤ 18 sözcük */
  text?: ReactNode;
  /** "Ayrıntı" altında, kapalı: neden, varsayım, liste */
  children?: ReactNode;
  /** Geliştirici dili (anahtar adı, Vercel, komut, belge yolu): Ayrıntı'nın içinde "Teknik ayrıntı (geliştirici için)" altında. Personelin açtığı ekranda VERİLMEZ */
  tech?: ReactNode;
  /** Tek birincil eylem: <NoticeLink> ya da <Button size="xs" variant="secondary">. İki düğme yalnız pencere içinde (sm) */
  action?: ReactNode;
  risk?: NoticeRisk;
  /** md: sayfa düzeyi · sm: kart ve pencere içi · line: kutusuz tek satır (alan, satır, hücre altı) */
  size?: "md" | "sm" | "line";
  /** Yalnız istemcide sonradan beliren uyarıda: assertive → role="alert" (eylem / form hatası), polite → role="status"; yoksa role="note" */
  live?: "polite" | "assertive";
  /** Ayrıntı açık başlasın (satır başına eylemi olan liste, kullanıcının eylemine cevap veren hata dökümü) */
  defaultOpen?: boolean;
  /** Varsayılan "Ayrıntı" */
  detailsLabel?: string;
  id?: string;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}

/** Boş sayılan düğüm: verilmemiş, null, false ya da boş metin */
const present = (n: ReactNode) => n !== undefined && n !== null && n !== false && n !== "";

const SUMMARY =
  "relative inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-soft underline decoration-current/40 underline-offset-2 outline-none select-none [&::-webkit-details-marker]:hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] pointer-fine:after:-inset-y-1";
const BODY = "mt-1.5 space-y-1 text-ink-soft [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs";

/** "Ayrıntı ⌄" / "Gizle ⌃": metin ve ok açık olup olmamasına göre, JavaScript'siz (group-open) */
function DetailsLabel({ label }: { label: string }) {
  return (
    <>
      <span className="group-open/n:hidden">{label}</span>
      <span className="hidden group-open/n:inline">Gizle</span>
      <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="size-3.5 shrink-0 motion-safe:transition-transform group-open/n:rotate-180" />
    </>
  );
}

/**
 * Kapalı "Teknik ayrıntı (geliştirici için)": anahtar adı, komut, belge yolu. Notice'in Ayrıntı'sının içinde; uyarı
 * olmayan bir kurulum talimatı (ör. karaoke Bağlantı kartı) tek başına da kullanır. Personelin açtığı ekranda verilmez.
 */
export function NoticeTech({ tech, className }: { tech: ReactNode; className?: string }) {
  return (
    <details className={cn("group/t", className)}>
      <summary className="relative inline-flex cursor-pointer list-none text-xs text-ink-mute underline decoration-current/40 underline-offset-2 outline-none select-none [&::-webkit-details-marker]:hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] pointer-fine:after:-inset-y-1">
        Teknik ayrıntı (geliştirici için)
      </summary>
      <div className="mt-1 font-mono text-xs break-words text-ink-mute">{tech}</div>
    </details>
  );
}

/** Ayrıntı'nın gövdesi: çocuklar, sonra (varsa) kapalı "Teknik ayrıntı" */
function DetailsBody({ children, tech, className }: { children?: ReactNode; tech?: ReactNode; className?: string }) {
  return (
    <div className={cn(BODY, className)}>
      {present(children) ? children : null}
      {present(tech) ? <NoticeTech tech={tech} /> : null}
    </div>
  );
}

export function Notice({
  tone,
  title,
  text,
  children,
  tech,
  action,
  risk,
  size = "md",
  live,
  defaultOpen,
  detailsLabel = "Ayrıntı",
  id,
  ref,
  className,
}: NoticeProps) {
  const Icon = TONE_ICON[tone];
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : "note";
  const hasDetails = present(children) || present(tech);
  const line = size === "line";

  const root = cn(
    line ? "flex flex-col gap-0.5 text-[13px] leading-5" : "flex flex-col gap-1 text-[13px] leading-5",
    !line && TONE_BG[tone],
    !line && "print:bg-transparent print:px-0",
    size === "md" && "rounded-2xl",
    size === "sm" && "rounded-xl",
    className,
  );
  // Kutunun iç payı: eylemsiz ve ayrıntılı kutuda bütün kutu tıklanır özet olsun diye pay özete ve gövdeye iner
  const pad = size === "md" ? "px-3.5 py-2.5" : size === "sm" ? "px-3 py-2" : "";

  const icon = <Icon size={16} strokeWidth={1.75} aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", TONE_ICON_INK[tone])} />;
  const heading = (
    <span className={cn("min-w-0 text-pretty break-words", line ? cn("font-medium", TONE_LINE_INK[tone]) : "flex-1 basis-48 font-medium text-ink")}>
      <span className="sr-only">{TONE_LABEL[tone]}: </span>
      {title}
    </span>
  );

  // 2. Eylemsiz ve ayrıntılı: bütün kutu tek <details>; özet = ikon · başlık · (text) · sağda "Ayrıntı ⌄".
  // Özette etkileşimli öğe yok (vergi takviminin kuralı).
  if (!present(action) && hasDetails) {
    return (
      <div ref={ref} id={id} role={role} data-notice={tone} data-risk={risk} className={root}>
        <details className="group/n" open={defaultOpen || undefined}>
          <summary
            className={cn(
              "flex cursor-pointer list-none flex-col gap-1 outline-none select-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-inset",
              line ? "rounded-sm" : size === "md" ? "rounded-2xl" : "rounded-xl",
              pad,
            )}
          >
            <span className="flex items-start gap-2">
              {icon}
              {heading}
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 pl-1 text-[13px] font-medium text-ink-soft underline decoration-current/40 underline-offset-2">
                <DetailsLabel label={detailsLabel} />
              </span>
            </span>
            {present(text) ? <span className="block pl-6 text-ink-soft">{text}</span> : null}
          </summary>
          {/* Gövde başlığın hizasında: kutunun payı + ikon (16 px) + boşluk (8 px) */}
          <DetailsBody tech={tech} className={size === "md" ? "mt-0 pr-3.5 pb-2.5 pl-[2.375rem]" : size === "sm" ? "mt-0 pr-3 pb-2 pl-9" : "mt-1 pl-6"}>
            {children}
          </DetailsBody>
        </details>
      </div>
    );
  }

  // 1. Eylemli ya da ayrıntısız: satır = ikon · başlık · eylem (eylem sığmazsa başlığın altına, ikon hizasına iner);
  // text altında; Ayrıntı varsa en altta.
  return (
    <div ref={ref} id={id} role={role} data-notice={tone} data-risk={risk} className={cn(root, pad)}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        {icon}
        {heading}
        {present(action) ? <div className="no-print ml-auto shrink-0 self-center max-sm:ml-6">{action}</div> : null}
      </div>
      {present(text) ? <div className="pl-6 text-ink-soft">{text}</div> : null}
      {hasDetails ? (
        <details className="group/n pl-6" open={defaultOpen || undefined}>
          <summary className={SUMMARY}>
            <DetailsLabel label={detailsLabel} />
          </summary>
          <DetailsBody tech={tech}>{children}</DetailsBody>
        </details>
      ) : null}
    </div>
  );
}

export interface NoticeItem extends NoticeProps {
  key: string;
}

const RANK: Record<NoticeTone, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

/**
 * Katlama planı (saf, test edilir). Sıra: bad > warn > neutral > good, aynı tonda yazıldığı sıra (kararlı).
 * Hiç katlanmaz: her `bad`, `risk` taşıyan her `warn`. Geri kalanlardan ilk `max` (varsayılan 2) görünür, kalanı katlanır.
 */
export function foldPlan(items: readonly Pick<NoticeItem, "key" | "tone" | "risk">[], max = 2): { shown: string[]; folded: string[] } {
  const sorted = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => RANK[a.it.tone] - RANK[b.it.tone] || a.i - b.i)
    .map((x) => x.it);
  const shown: string[] = [];
  const folded: string[] = [];
  let free = 0;
  for (const it of sorted) {
    if (it.tone === "bad" || (it.tone === "warn" && it.risk)) shown.push(it.key);
    else if (free < max) {
      shown.push(it.key);
      free++;
    } else folded.push(it.key);
  }
  return { shown, folded };
}

/** Aynı yerdeki birden çok uyarı: foldPlan'a göre; katlananlar "+{n} uyarı daha" (hepsi neutral/good ise "+{n} not daha") <details>'inde */
export function NoticeGroup({ items, max = 2, label = "Uyarılar", className }: { items: readonly NoticeItem[]; max?: number; label?: string; className?: string }) {
  if (!items.length) return null;
  const { shown, folded } = foldPlan(items, max);
  const byKey = new Map(items.map((it) => [it.key, it]));
  const render = (k: string) => {
    const { key, ...props } = byKey.get(k)!;
    return <Notice key={key} {...props} />;
  };
  const quiet = folded.every((k) => {
    const t = byKey.get(k)!.tone;
    return t === "neutral" || t === "good";
  });
  return (
    <section aria-label={label} className={cn("space-y-2", className)}>
      {shown.map(render)}
      {folded.length ? (
        <details className="group/g">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-ink-mute underline decoration-current/40 underline-offset-2 outline-none select-none [&::-webkit-details-marker]:hidden focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30">
            <span className="group-open/g:hidden">
              +{folded.length} {quiet ? "not" : "uyarı"} daha
            </span>
            <span className="hidden group-open/g:inline">Gizle</span>
            <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="size-3.5 motion-safe:transition-transform group-open/g:rotate-180" />
          </summary>
          <div className="space-y-2">{folded.map(render)}</div>
        </details>
      ) : null}
    </section>
  );
}

/** Uyarının eylem bağlantısı: kalın, altı çizili; görünür 20 px, dokunma alanı 44 px */
export function NoticeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="relative font-medium whitespace-nowrap text-ink underline decoration-ink/30 underline-offset-2 outline-none after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:decoration-ink focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ink/30"
    >
      {children}
    </Link>
  );
}
