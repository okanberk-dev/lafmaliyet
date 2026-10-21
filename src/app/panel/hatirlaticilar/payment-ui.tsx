"use client";

import {
  AlarmClock,
  Check,
  CreditCard,
  Ellipsis,
  FileText,
  Landmark,
  Repeat,
  ShieldCheck,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { DotList } from "@/components/ui/misc";
import { useCalmMotion } from "@/components/ui/motion";
import { dateTR, money } from "@/lib/format";
import {
  CATEGORY_LABEL,
  daysLeftLabel,
  longDateTR,
  monthShortTR,
  reminderCategory,
  repeatLabel,
  type PostponeBy,
  type ReminderCategory,
  type UpcomingItem,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { restoreInvoicePayment, setInvoicePaid } from "@/server/actions/invoices";
import { markReminderDone, postponeInvoice, postponeReminder, restoreReminder, setInvoiceDueDate } from "@/server/actions/reminders";

import { itemKey } from "./calendar-entries";
import { Sheet, useIsPhone } from "./sheet";

// ---------------------------------------------------------------- Tür ikonu

export const CATEGORY_ICON: Record<ReminderCategory, LucideIcon> = {
  kira: Store,
  vergi: Landmark,
  sgk: ShieldCheck,
  maas: Users,
  abonelik: CreditCard,
  fatura: FileText,
  odeme: Wallet,
  diger: AlarmClock,
};

/** AkmanOS Recent Activity kuyuları (beyaz glif) */
export const CATEGORY_WELL: Record<ReminderCategory, string> = {
  kira: "bg-[#ff9f0a]",
  vergi: "bg-[#bf5af2]",
  sgk: "bg-[#5e5ce6]",
  maas: "bg-[#30d158]",
  abonelik: "bg-[#ff375f]",
  fatura: "bg-[#32ade6]",
  odeme: "bg-[#0a84ff]",
  diger: "bg-[#8e8e93]",
};

export function CategoryWell({ category, size = "sm", className }: { category: ReminderCategory; size?: "xs" | "sm" | "md"; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  const box = { xs: "size-[18px] rounded-[5px]", sm: "size-6 rounded-[7px]", md: "size-9 rounded-[10px]" }[size];
  const glyph = { xs: 11, sm: 13, md: 17 }[size];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]", box, CATEGORY_WELL[category], className)}
      aria-hidden="true"
    >
      <Icon size={glyph} strokeWidth={2.25} />
    </span>
  );
}

// ---------------------------------------------------------------- Aciliyet ve takvim karosu

export type Urgency = "overdue" | "today" | "soon" | "later";

/** Gecikti · bugün · 7 gün içinde · sonra */
export function urgencyOf(daysLeft: number): Urgency {
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "today";
  if (daysLeft <= 7) return "soon";
  return "later";
}

export const URGENCY: Record<Urgency, { band: string; day: string; text: string; dot: string; ring: string }> = {
  overdue: { band: "bg-bad text-white", day: "text-bad", text: "text-bad", dot: "bg-bad", ring: "ring-bad/25" },
  today: { band: "bg-brass-500 text-white", day: "text-brass-700", text: "text-warn", dot: "bg-brass-500", ring: "ring-brass-500/30" },
  soon: { band: "bg-brass-200 text-brass-900", day: "text-ink", text: "text-brass-800", dot: "bg-brass-300", ring: "ring-line-strong" },
  later: { band: "bg-panel-deep text-ink-soft", day: "text-ink", text: "text-ink-mute", dot: "bg-ink-quiet", ring: "ring-line-strong" },
};

/** Takvim yaprağı: üstte kısa ay (aciliyet renginde şerit), altta gün */
export function DateTile({ date, daysLeft, size = "md", muted }: { date: string; daysLeft: number; size?: "sm" | "md"; muted?: boolean }) {
  const u = URGENCY[urgencyOf(daysLeft)];
  return (
    <span
      role="img"
      aria-label={longDateTR(date)}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden bg-surface text-center ring-1 ring-inset",
        size === "md" ? "w-12 rounded-xl" : "w-10 rounded-[10px]",
        muted ? "ring-line-strong opacity-70" : u.ring,
      )}
    >
      <span className={cn("font-semibold", size === "md" ? "text-[10px] leading-4" : "text-[9px] leading-[14px]", muted ? "bg-panel text-ink-mute" : u.band)}>{monthShortTR(date)}</span>
      <span className={cn("font-semibold tracking-tight tabular", size === "md" ? "text-xl leading-8" : "text-base leading-6", muted ? "text-ink-mute" : u.day)}>
        {Number(date.slice(8, 10))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- Kaynak

export type ItemSource = "reminder" | "fixed" | "parasut" | "invoice";

export const SOURCE_LABEL: Record<ItemSource, string> = {
  reminder: "Hatırlatıcı",
  fixed: "Sabit gider",
  parasut: "Paraşüt faturası",
  invoice: "Fatura",
};

/** Hatırlatıcı mı, sabit giderden mi, Paraşüt'ten gelen fatura mı */
export function sourceOf(item: UpcomingItem, invoiceSource?: Record<number, string>): ItemSource {
  if (item.source === "invoice") return invoiceSource?.[item.sourceId] === "parasut" ? "parasut" : "invoice";
  return item.detail?.startsWith("Sabit giderlerden") ? "fixed" : "reminder";
}

export const categoryOf = (i: Pick<UpcomingItem, "kind" | "title">) => reminderCategory(i.kind, i.title);

/** Tutar: küsuratlıysa iki ondalık (12.500,50 ₺), değilse tam (12.500 ₺); toplamlar da aynı biçimde */
export { money };

/** Yaklaşan bir ödemenin tekil anahtarı (calendar-entries.ts) */
export { itemKey };

// ---------------------------------------------------------------- Ödendi / ertele (geri al ile)

type Result = { ok: true } | { ok: false; error: string };

function undo(run: () => Promise<Result>, done = "Geri alındı") {
  return {
    label: "Geri al",
    onClick: () =>
      startTransition(async () => {
        const r = await run();
        if (!r.ok) toast.error(r.error);
        else toast.success(done);
      }),
  };
}

/**
 * "Ödendi" ve "Ertele": öğe sunucu yanıtını beklemeden listeden kalkar (hide, useOptimistic), bildirim balonunda
 * 8 saniye "Geri al" düğmesi durur. Ödendi geri alınınca hatırlatıcı önceki tarihine, fatura ödenmemişe döner.
 * Her öğe kendi isteğini bekler (`busy(key)`): biri sürerken öteki kartlar ödenebilir, kaydırılabilir.
 */
export function usePaymentActions(hide: (key: string) => void) {
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const busy = useCallback((key: string) => inFlight.has(key), [inFlight]);

  const start = (key: string, run: () => Promise<void>) => {
    setInFlight((s) => new Set(s).add(key));
    startTransition(async () => {
      try {
        await run();
      } finally {
        setInFlight((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    });
  };

  const pay = (item: UpcomingItem) =>
    start(itemKey(item), async () => {
      hide(itemKey(item));
      if (item.source === "invoice") {
        const r = await setInvoicePaid(item.sourceId, true);
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${item.title} ödendi`, {
          description: "Fatura ödendi olarak işaretlendi. Sonra da Ödemeler › Son ödenenler'den geri alınabilir.",
          duration: 8000,
          // Önceki hâli olduğu gibi döner (ödeme talebi dahil)
          action: undo(() => restoreInvoicePayment(r.data.previous), "Fatura yeniden ödenmedi"),
        });
      } else {
        const r = await markReminderDone(item.sourceId, item.projected ? item.dueDate : undefined);
        if (!r.ok) return void toast.error(r.error);
        const { next, prev } = r.data;
        toast.success(`${item.title} ödendi`, {
          description: `${next ? `Sıradaki tarih ${dateTR(next)}.` : "Tek seferlikti; hatırlatıcı kapandı."} Sonra da Ödemeler › Son ödenenler'den geri alınabilir.`,
          duration: 8000,
          action: undo(() => restoreReminder(item.sourceId, prev)),
        });
      }
    });

  const postpone = (item: UpcomingItem, by: PostponeBy) =>
    start(itemKey(item), async () => {
      hide(itemKey(item));
      const span = by === "week" ? "1 hafta" : "1 ay";
      if (item.source === "invoice") {
        const r = await postponeInvoice(item.sourceId, by);
        if (!r.ok) return void toast.error(r.error);
        const { prev } = r.data;
        toast.success(`${item.title} ${span} ertelendi`, {
          description: `Yeni vade ${dateTR(r.data.dueDate)}.`,
          duration: 8000,
          action: undo(() => setInvoiceDueDate(item.sourceId, prev)),
        });
      } else {
        const r = await postponeReminder(item.sourceId, by);
        if (!r.ok) return void toast.error(r.error);
        const { prev, createdId, next, dueDate } = r.data;
        toast.success(`${item.title} ${span} ertelendi`, {
          description: next ? `Bu dönem ${dateTR(dueDate)} tarihine alındı; tekrar ${dateTR(next)} tarihinden sürer.` : `Yeni tarih ${dateTR(dueDate)}.`,
          duration: 8000,
          action: undo(() => restoreReminder(item.sourceId, prev, createdId)),
        });
      }
    });

  return { pending: inFlight.size > 0, busy, pay, postpone };
}

// ---------------------------------------------------------------- Eylem menüsü (telefonda alt sayfa, masaüstünde açılır liste)

export interface MenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  hint?: string;
  tone?: "danger";
  disabled?: boolean;
}

export function ActionMenu({
  label,
  title,
  subtitle,
  actions,
  className,
  onOpenChange,
}: {
  label: string;
  title: string;
  subtitle?: string;
  actions: MenuAction[];
  className?: string;
  /** Kart menü açıkken kaydırmayı kapatır */
  onOpenChange?: (open: boolean) => void;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, phone]);

  const choose = (a: MenuAction) => {
    setOpen(false);
    a.onSelect();
  };

  // Telefonda alt sayfa yalnız açıkken ve gövdeye çizilir: kartın içinde kalsaydı sayfadaki sürükleme kartın
  // "kaydırınca ödendi" hareketine ulaşırdı (motion yerel olay dinler)
  const phoneSheet =
    phone && open
      ? createPortal(
          <Sheet open onClose={() => setOpen(false)} title={title} description={subtitle} size="sm">
            <ul role="menu" aria-label={label} className="-mx-1 space-y-1 pb-1">
              {actions.map((a) => (
                <li key={a.key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={a.disabled}
                    onClick={() => choose(a)}
                    className={cn(
                      "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium transition-colors active:bg-panel disabled:cursor-not-allowed disabled:opacity-45",
                      a.tone === "danger" ? "text-bad" : "text-ink",
                    )}
                  >
                    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", a.tone === "danger" ? "bg-bad-soft" : "bg-panel")}>
                      <a.icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block">{a.label}</span>
                      {a.hint ? <span className="block text-[13px] font-normal text-ink-mute">{a.hint}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Sheet>,
          document.body,
        )
      : null;

  return (
    <div ref={wrap} className={cn("relative", className)}>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          setUp(Boolean(r && window.innerHeight - r.bottom < 300));
          setOpen(!open);
        }}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface text-ink-mute ring-1 ring-line-strong transition-colors ring-inset hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none sm:pointer-fine:size-9 sm:pointer-fine:rounded-[10px]"
      >
        <Ellipsis size={18} />
      </button>
      {phone ? (
        phoneSheet
      ) : open ? (
        <ul
          role="menu"
          aria-label={label}
          className={cn(
            "absolute right-0 z-40 w-60 rounded-2xl bg-surface p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line-strong",
            up ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {actions.map((a) => (
            <li key={a.key} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={() => choose(a)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                  a.tone === "danger" ? "text-bad hover:bg-bad-soft" : "text-ink",
                )}
              >
                <a.icon size={16} className={cn("shrink-0", a.tone === "danger" ? "text-bad" : "text-ink-mute")} />
                <span className="min-w-0 flex-1">
                  <span className="block">{a.label}</span>
                  {a.hint ? <span className="block text-xs text-ink-mute">{a.hint}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Ödeme kartı

/** Ödendi düğmesi: limon onay dairesi + metin; telefonda 44px yüksek, satırı kaplar */
export function PaidButton({ onClick, disabled, label, className, compact }: { onClick: () => void; disabled?: boolean; label: string; className?: string; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-panel font-medium text-ink transition-[background-color,transform] hover:bg-panel-deep active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
        "focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none",
        compact ? "h-11 px-3 text-sm sm:px-2.5 sm:text-[13px] sm:pointer-fine:h-9 sm:pointer-fine:rounded-[10px]" : "h-11 px-4 text-[15px]",
        className,
      )}
    >
      <span className="flex size-5 items-center justify-center rounded-full bg-lime text-good-ink" aria-hidden="true">
        <Check size={12} strokeWidth={3} />
      </span>
      Ödendi
    </button>
  );
}

export function PaymentCard({
  item,
  source,
  pending,
  onPaid,
  actions,
  index = 0,
  anchorDate,
  swipe,
}: {
  item: UpcomingItem;
  source: ItemSource;
  pending: boolean;
  onPaid: () => void;
  actions?: MenuAction[];
  index?: number;
  /** Hatırlatıcının çapa tarihi (tekrar rozeti "Her ayın son günü" gibi doğru yazılsın) */
  anchorDate?: string | null;
  /** Telefonda sağa kaydırınca ödendi */
  swipe?: boolean;
}) {
  const calm = useCalmMotion();
  const category = categoryOf(item);
  const u = URGENCY[urgencyOf(item.daysLeft)];
  const repeat = repeatLabel(item.repeat, item.dueDate, anchorDate);
  const [armed, setArmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Kaydırarak ödeme yalnız telefonda (masaüstünde fareyle sürükleme metin seçimine karışmasın); eylem menüsü
  // açıkken kapalı (menüdeki sürükleme kartı ödendi yapmasın)
  const phone = useIsPhone();
  const canSwipe = Boolean(swipe) && phone && !pending && !menuOpen;
  // Üçüncü güvence: sürükleme kartın kendi kutusunda başlamadıysa (React olayları portaldan, ör. menünün alt
  // sayfasından da buraya kabarcıklanır) ödendi sayılmaz
  const fromCard = useRef(false);
  const amount = item.amount !== null ? money(item.amount) : null;
  const menu = (
    <ActionMenu
      label={`${item.title} için diğer eylemler`}
      title={item.title}
      subtitle={`${dateTR(item.dueDate)} · ${daysLeftLabel(item.daysLeft)}`}
      actions={actions ?? []}
      onOpenChange={setMenuOpen}
    />
  );
  // Faturada ayrıntı kısa ve önemli ("Fatura KLA… · vade tahmini"): kesilmez; hatırlatıcı notu iki satırla sınırlı
  const detail = item.detail && item.detail !== "Sabit giderlerden" ? item.detail : null;

  return (
    <motion.li
      initial={calm ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={calm ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT, delay: Math.min(index, 8) * 0.03 }}
      className="relative"
    >
      {canSwipe && dragging ? (
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 flex items-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-colors",
            armed ? "bg-lime text-good-ink" : "bg-lime/40 text-good-ink/70",
          )}
        >
          <Check size={18} strokeWidth={2.5} /> Ödendi
        </div>
      ) : null}
      <motion.div
        drag={canSwipe ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.55 }}
        dragSnapToOrigin
        onPointerDownCapture={(e) => {
          fromCard.current = e.currentTarget.contains(e.target as Node) && !menuOpen;
        }}
        onDragStart={() => setDragging(fromCard.current)}
        onDrag={(_, info) => setArmed(fromCard.current && info.offset.x > 110)}
        onDragEnd={(_, info) => {
          setArmed(false);
          setDragging(false);
          if (fromCard.current && !menuOpen && info.offset.x > 110) {
            // Titreşim yalnız sayfayla etkileşimden sonra (yoksa tarayıcı konsola hata yazar)
            if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(12);
            onPaid();
          }
          fromCard.current = false;
        }}
        className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-2xl bg-surface p-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-line sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-3.5"
      >
        <div className="self-start">
          <DateTile date={item.dueDate} daysLeft={item.daysLeft} />
        </div>
        <div className="min-w-0 self-start">
          <p className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-pretty break-words text-ink">{item.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5 text-ink-mute">
            <CategoryWell category={category} size="xs" />
            <span>{item.source === "invoice" ? SOURCE_LABEL[source] : CATEGORY_LABEL[category]}</span>
            {repeat ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-panel px-1.5 py-px text-xs text-ink-soft ring-1 ring-line ring-inset">
                <Repeat size={11} aria-hidden="true" />
                {repeat}
              </span>
            ) : null}
            {item.projected ? <span className="rounded-full bg-info-soft px-1.5 py-px text-xs text-info">Sıradaki dönem</span> : null}
          </p>
          <DotList className="mt-0.5 text-[13px] leading-5">
            <span className={cn("inline-flex items-center gap-1.5 font-medium", u.text)}>
              <span className={cn("size-1.5 rounded-full", u.dot)} aria-hidden="true" />
              {daysLeftLabel(item.daysLeft)}
            </span>
            {item.source === "reminder" ? <span className="text-ink-mute">{SOURCE_LABEL[source]}</span> : null}
          </DotList>
          {detail ? (
            <p className={cn("mt-0.5 text-xs leading-[18px] wrap-anywhere text-ink-mute", item.source === "reminder" && "line-clamp-2")}>{detail}</p>
          ) : null}
        </div>
        <div className="hidden items-center gap-3 self-center sm:flex">
          <span className="text-[15px] leading-5 font-semibold whitespace-nowrap text-ink tabular">{amount ?? <span className="text-ink-quiet">–</span>}</span>
          <div className="flex items-center gap-1.5">
            <PaidButton compact onClick={onPaid} disabled={pending} label={`${item.title} ödendi`} />
            {actions?.length ? menu : null}
          </div>
        </div>
        {/* Telefon: tutar, büyük Ödendi ve menü alt satırda, başparmak hizasında (başlık tüm genişliği kullanır) */}
        <div className="col-span-2 mt-3 flex items-center gap-2 sm:hidden">
          {amount ? <span className="shrink-0 pr-1 text-base leading-5 font-semibold whitespace-nowrap text-ink tabular">{amount}</span> : null}
          <PaidButton onClick={onPaid} disabled={pending} label={`${item.title} ödendi`} className="min-w-0 flex-1" />
          {actions?.length ? menu : null}
        </div>
      </motion.div>
    </motion.li>
  );
}
