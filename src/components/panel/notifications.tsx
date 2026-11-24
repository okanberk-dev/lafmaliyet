"use client";

import { Activity, AlarmClock, Banknote, CalendarClock, CheckCheck, ClipboardCheck, FileText, ListChecks } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { SPRING_PANEL } from "@/components/akmanos/lib/motion-ease";
import { NotificationBell } from "@/components/ui/notification-bell";
import { TONE_ICON, TONE_TILE, type NoticeTone } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { alertTone } from "@/app/panel/alert-tone";
import type { Role } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PanelNotification } from "@/server/actions/notifications";

import { useLocalList } from "./local-list";

/**
 * AkmanOS "Notification Dropdown" görünümünde zil: yöneticide en üstte günlük işlerin sorunları ("Sistem": sabah işi ya
 * da Paraşüt işi çalışmadı, hata verdi), sonra kişinin kendi hatırlatıcıları ve onaylar (yöneticide onay bekleyen
 * öneriler ve personel istekleri; personelde "İsteklerim": önerilerinin ve isteklerinin sonucu), kasa, kontrol
 * listeleri (geciken ya da dünden eksik liste, aralık dışı ölçüm; personelde bekleyen liste), sonra zamanı gelen
 * ödemeler, faturalar (Paraşüt'ten yeni gelenler, kontrol bekleyenler, eşitleme hatası), en sonda son satış ayının
 * uyarıları. Personel hatırlatıcılarını, önerilerini ve isteklerini, kasayı ve kontrol listelerini görür.
 * Okunanlar bu tarayıcıda hatırlanır (sayfa yenilenince yeniden "okunmamış" olmaz); uyarının metni değişirse
 * (ör. düşük kârlı ürün sayısı) yeni bildirim sayılır. Her açılışta liste arka planda tazelenir.
 */
const READ_KEY = "laf:bildirim:okundu";

// Bildirimin önemi uyarılarla aynı tablodan (TONE_ICON / TONE_TILE): danger → bad, warning → warn, info → neutral;
// "Uyarılar" grubundaki ayın uyarıları Genel bakış'taki kartla aynı önemde (alertTone)
const KIND_TONE: Record<PanelNotification["kind"], NoticeTone> = { danger: "bad", warning: "warn", info: "neutral" };
const toneOf = (n: PanelNotification): NoticeTone => (!n.group || n.group === "uyari" ? alertTone({ level: n.kind, title: n.title }) : KIND_TONE[n.kind]);
const BadIcon = TONE_ICON.bad;

type Filter = "all" | "unread";

/** Zilin altındaki iki kısayol, role göre */
const FOOTER_LINKS: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: "/panel/hatirlaticilar", label: "Ödemeler" },
    { href: "/panel", label: "Genel bakış" },
  ],
  staff: [
    { href: "/panel/kasa", label: "Kasa raporu" },
    { href: "/panel/hatirlaticilarim", label: "Hatırlatıcılarım" },
  ],
};

export function NotificationMenu({
  items,
  failure = null,
  loading = false,
  onOpen,
  align = "left",
  variant = "sidebar",
  role = "admin",
}: {
  /** null: yükleniyor (failure yoksa) ya da hiç okunamadı */
  items: PanelNotification[] | null;
  /**
   * Son okuma düştü (E-49): "stale" panel güncellendi, sayfa yenilenmeli; "failed" istek düştü, yeniden denenir. Liste
   * boş sayılmaz ("Dikkat isteyen bir şey yok" denmez); önceki liste varsa altında kalır
   */
  failure?: "stale" | "failed" | null;
  /** Okuma sürüyor (Yeniden dene düğmesi beklerken kilitli) */
  loading?: boolean;
  /** Menü açılınca (listeyi tazelemek için) ve "Yeniden dene"de */
  onOpen?: () => void;
  align?: "left" | "right";
  /** sidebar: kenar çubuğundaki beyaz karo; bar: mobil üst çubuktaki çerçeveli düğme */
  variant?: "sidebar" | "bar";
  /** Alttaki kısayollar role göre */
  role?: Role;
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [readIds, setReadIds] = useLocalList(READ_KEY, 300);

  const read = useMemo(() => new Set(readIds), [readIds]);
  const list = useMemo(() => (items ?? []).map((n) => ({ ...n, unread: n.unread && !read.has(n.id) })), [items, read]);
  const unread = list.filter((n) => n.unread).length;
  const visible = filter === "unread" ? list.filter((n) => n.unread) : list;
  const groups = [
    { id: "sistem", label: "Sistem", items: visible.filter((n) => n.group === "sistem") },
    { id: "hatirlatici", label: "Hatırlatıcılarım", items: visible.filter((n) => n.group === "hatirlatici") },
    // Yöneticide onay bekleyen öneri ve istekler; personelde önerilerinin ve isteklerinin sonucu (docs/ONAYLAR.md)
    { id: "onay", label: role === "admin" ? "Onaylar" : "İsteklerim", items: visible.filter((n) => n.group === "onay") },
    { id: "kasa", label: "Kasa", items: visible.filter((n) => n.group === "kasa") },
    { id: "kontrol", label: "Kontrol listeleri", items: visible.filter((n) => n.group === "kontrol") },
    { id: "odeme", label: "Ödemeler", items: visible.filter((n) => n.group === "odeme") },
    { id: "fatura", label: "Faturalar", items: visible.filter((n) => n.group === "fatura") },
    { id: "uyari", label: "Uyarılar", items: visible.filter((n) => !n.group || n.group === "uyari") },
  ].filter((g) => g.items.length);

  const markRead = (ids: string[]) => {
    // Özet satırı (ör. "4 hakediş daha gecikti") okununca içindekiler de okunur: sonra tek satıra çıkınca okunmuş kalır
    const covers = new Map((items ?? []).map((n) => [n.id, n.covers ?? []]));
    const fresh = [...new Set(ids.flatMap((id) => [id, ...(covers.get(id) ?? [])]))].filter((id) => !read.has(id));
    // Listede artık olmayan eski kimlikler zamanla düşer (en yeniler başta tutulur)
    if (fresh.length) setReadIds([...fresh, ...readIds]);
  };

  const toggle = () => {
    if (!open) onOpen?.();
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    // Telefonun üst çubuğunda (bar) kök konumlanmaz: açılan pencere üst çubuğa göre yerleşir. Açıkken data-open
    // (sidebar.tsx): masaüstünde kenar çubuğu karaoke şeridinin, telefonda üst çubuk sayfanın yüzen düğmelerinin
    // üstüne çıkar; pencerenin bir kısmı onların altında kalmaz
    <div
      ref={rootRef}
      data-component="notification-dropdown"
      data-open={open || undefined}
      className={cn("relative inline-flex shrink-0 font-sans", variant === "bar" && "max-lg:static")}
    >
      {/* Zil (ui/notification-bell.tsx): okunmamış sayısı sayfa açıkken artınca sallanır, rozetin rakamı döner; ilk okuma
          (items null → liste) çaldırmaz */}
      <NotificationBell
        ref={triggerRef}
        count={items === null ? null : unread}
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={items === null ? (failure ? "Bildirimler okunamadı" : "Bildirimler yükleniyor") : unread > 0 ? `Bildirimler, ${unread} okunmamış` : "Bildirimler"}
        badgeClassName="ring-2 ring-chart-metric-bg"
        className={variant === "sidebar" ? "rounded-2xl bg-chart-metric-bg hover:bg-chart-bg" : "rounded-lg border border-border bg-background hover:bg-chart-bg"}
      />

      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="region"
            aria-label="Bildirimler"
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: -8 }}
            // Kapanırken dokunuş almaz: solan liste altındaki kenar çubuğu öğesine giden ilk tıklamayı yutmasın
            animate={{ opacity: 1, scale: 1, y: 0, pointerEvents: "auto" }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.96, y: -8, pointerEvents: "none" }}
            transition={reduce ? { duration: 0 } : SPRING_PANEL}
            className={cn(
              "absolute top-[calc(100%+0.5rem)] z-[100] flex max-h-[calc(100dvh-5rem-var(--mobile-nav-h,0px))] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-chart-metric-bg shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-black/5",
              align === "left" ? "left-0 origin-top-left" : "right-0 origin-top-right",
              // Telefonun üst çubuğunda zil en sağda olmayabilir (personelde yanında menü düğmesi var): pencere zile değil
              // üst çubuğa (yapışkan header) göre konumlanır, ekranın sağ kenarına hizalanır, solda ekrandan taşmaz.
              // Karaoke şeridi varken çubukla birlikte iner (--alarm-h); yüksekliği şerit ile alt menünün arasına sığar
              variant === "bar" &&
                "max-lg:right-[max(1rem,env(safe-area-inset-right))] max-lg:max-h-[calc(100dvh-5rem-var(--mobile-nav-h,0px)-var(--alarm-h,0px))]",
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-3">
              <div className="min-w-0">
                <p className="text-[0.95rem] font-semibold tracking-tight text-foreground">Bildirimler</p>
                <p className="mt-0.5 text-[12px] text-chart-muted" aria-live="polite">
                  {items === null ? (failure ? "Okunamadı" : "Yükleniyor…") : unread > 0 ? `${unread} okunmamış` : list.length ? "Hepsi okundu" : failure ? "Okunamadı" : "Dikkat isteyen bir şey yok"}
                </p>
              </div>
              <button
                type="button"
                disabled={unread === 0}
                onClick={() => markRead(list.map((n) => n.id))}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-[12px] font-medium text-chart-muted outline-none transition-colors hover:bg-chart-bg hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent pointer-coarse:h-11"
              >
                <CheckCheck className="size-3.5" strokeWidth={1.75} aria-hidden />
                Tümünü okundu say
              </button>
            </div>

            {list.length ? (
              <div className="shrink-0 px-3 pb-2">
                <Segmented<Filter>
                  stretch
                  label="Bildirim süzgeci"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: "Tümü", count: list.length },
                    { value: "unread", label: "Okunmamış", count: unread },
                  ]}
                />
              </div>
            ) : null}

            <div className="notification-dropdown-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
              {failure ? (
                <div role="alert" className="mx-1.5 mb-1.5 flex items-center gap-2.5 rounded-xl bg-red-500/10 py-2 pr-1.5 pl-2.5 text-[12px] leading-snug text-red-700 dark:bg-bad-soft dark:text-bad-ink">
                  <BadIcon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1">
                    {failure === "stale"
                      ? "Panel güncellendi; bildirimler için sayfayı yenileyin."
                      : // Son okuma boş döndüyse altında gösterilen bir liste yok: "son okunan liste" denmez
                        items === null || items.length === 0
                        ? "Bildirimler okunamadı; bağlantıyı kontrol edip yeniden deneyin."
                        : "Bildirimler yenilenemedi; son okunan liste gösteriliyor."}
                  </span>
                  <button
                    type="button"
                    disabled={failure === "failed" && loading}
                    onClick={() => (failure === "stale" ? window.location.reload() : onOpen?.())}
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg bg-background px-2.5 text-[12px] font-semibold text-foreground outline-none ring-1 ring-black/10 transition-colors dark:ring-line-strong hover:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/30 disabled:cursor-default disabled:opacity-60 pointer-coarse:h-11"
                  >
                    {failure === "stale" ? "Yenile" : loading ? "Deneniyor…" : "Yeniden dene"}
                  </button>
                </div>
              ) : null}
              {items === null ? (
                failure ? null : (
                  <div className="space-y-2 px-2.5 py-2" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex gap-3">
                        <div className="size-9 shrink-0 animate-pulse rounded-xl bg-chart-bg" />
                        <div className="flex-1 space-y-1.5 pt-1">
                          <div className="h-3 w-2/3 animate-pulse rounded bg-chart-bg" />
                          <div className="h-3 w-full animate-pulse rounded bg-chart-bg" />
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : groups.length === 0 ? (
                failure && !(filter === "unread" && list.length) ? null : (
                  <p className="px-3 py-10 text-center text-[13px] text-chart-muted">
                    {filter === "unread" && list.length
                      ? "Okunmamış bildirim yok."
                      : role === "admin"
                        ? "Dikkat isteyen bir şey yok. Gecikmiş ödeme ya da uyarı olunca burada görünür."
                        : "Dikkat isteyen bir şey yok. Hatırlatıcılarınız, önerilerinizin ve isteklerinizin sonucu burada görünür."}
                  </p>
                )
              ) : (
                groups.map((g) => (
                  <div key={g.id} role="group" aria-label={g.label}>
                    {groups.length > 1 ? (
                      <p className="px-2.5 pt-2 pb-1 text-[0.65rem] font-medium tracking-wide text-chart-muted uppercase">{g.label}</p>
                    ) : null}
                    <ul className="flex flex-col gap-0.5">
                      {g.items.map((n) => {
                        const tone = toneOf(n);
                        const Icon =
                          n.group === "odeme"
                            ? CalendarClock
                            : n.group === "hatirlatici"
                              ? AlarmClock
                              : n.group === "onay"
                                ? ClipboardCheck
                                : n.group === "kasa"
                                  ? Banknote
                                : n.group === "kontrol" && n.kind !== "danger"
                                  ? ListChecks
                                : n.group === "fatura" && n.kind !== "danger"
                                  ? FileText
                                  : n.group === "sistem" && n.kind !== "danger"
                                    ? Activity
                                    : TONE_ICON[tone];
                        return (
                          <li key={n.id}>
                            <Link
                              href={n.href}
                              onClick={() => {
                                markRead([n.id]);
                                setOpen(false);
                              }}
                              className="relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left outline-none transition-colors hover:bg-chart-bg focus-visible:bg-chart-bg focus-visible:ring-2 focus-visible:ring-foreground/20"
                            >
                              <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", TONE_TILE[tone])} aria-hidden="true">
                                <Icon className="size-4" strokeWidth={1.75} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-start justify-between gap-2">
                                  <span className={cn("min-w-0 text-[13px] leading-5 tracking-tight text-foreground", n.unread ? "font-semibold" : "font-medium")}>{n.title}</span>
                                  <span className={cn("shrink-0 pt-0.5 text-[11px] tabular", tone === "bad" ? "font-medium text-bad-ink" : "text-chart-muted")}>{n.timeLabel}</span>
                                </span>
                                <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-chart-muted">{n.body}</span>
                              </span>
                              {n.unread ? (
                                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" role="img" aria-label="Okunmamış" />
                              ) : (
                                <span className="mt-2 size-1.5 shrink-0" aria-hidden="true" />
                              )}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>

            <div className="grid shrink-0 grid-cols-2 gap-1.5 p-2 pt-1">
              {FOOTER_LINKS[role].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex h-10 items-center justify-center rounded-xl bg-chart-bg text-[13px] font-semibold pointer-coarse:h-11 text-foreground outline-none transition-colors hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-foreground/20"
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
