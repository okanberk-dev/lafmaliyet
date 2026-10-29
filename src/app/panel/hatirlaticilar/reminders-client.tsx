"use client";

import { AlarmClock, BellRing, CalendarClock, CalendarDays, CalendarRange, ChartNoAxesColumn, ChevronDown, ClockArrowUp, List, Pencil, Plus, Trash2, Wallet, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { useActionTransition } from "@/components/ui/action-error";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fold, useQueryState } from "@/components/ui/filters";
import { Fab } from "@/components/ui/fab";
import { EmptyState } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { dateTR, money, num, tl } from "@/lib/format";
import type { ReminderDrift } from "@/lib/cash-plan";
import type { RecentPaid } from "@/lib/recent-paid";
import {
  inSummaryRange,
  laterReminderItems,
  longDateTR,
  parseSummaryRange,
  postponeDate,
  postponePlan,
  summarize,
  TIMELINE_GROUPS,
  timelineGroup,
  UPCOMING_HORIZON_DAYS,
  type SummaryRange,
  type TimelineGroup,
  type UpcomingItem,
} from "@/lib/reminders";
import { unreachable } from "@/lib/unreachable";
import { cn } from "@/lib/utils";
import { applySupplierCredit, dismissLinkCandidate } from "@/server/actions/cari";
import { deleteReminder, setReminderActive } from "@/server/actions/reminders";
import type { NotifySettings } from "@/server/notify/settings";

import { AllReminders, oneOf } from "./all-reminders";
import { calendarEntries } from "./calendar-entries";
import { CalendarView, ForecastRow } from "./calendar-view";
import { useFabBlocked } from "./fab-clear";
import { NotificationsSection, type EmailStatus, type LogRow, type Recipient } from "./notifications-section";
import { itemKey, PaymentCard, sourceOf, usePaymentActions, type MenuAction } from "./payment-ui";
import { RecentPaidList } from "./recent-paid";
import { DueDateSheet, isPresetKey, ReminderSheet, type FixedRow, type Reminder } from "./reminder-sheet";
import { Sheet } from "./sheet";
import { WeeklyRow, type WeeklyPanel } from "./weekly-row";

/** Adresteki süzgeç değerleri (?kaynak=fatura&aralik=gecikmis&gorunum=takvim&ay=2026-11; faturasız borç: ?kaynak=cari) */
type Source = "tumu" | "hatirlatici" | "fatura" | "cari";
const SOURCES = ["tumu", "hatirlatici", "fatura", "cari"] as const;
const SOURCE_OF: Record<Exclude<Source, "tumu">, UpcomingItem["source"]> = { hatirlatici: "reminder", fatura: "invoice", cari: "cari" };

/** Hatırlatıcının çapa tarihi (tekrar rozeti); fatura ve faturasız borçta yok */
function anchorOf(item: UpcomingItem, byId: ReadonlyMap<number, { anchorDate: string }>): string | null {
  switch (item.source) {
    case "reminder":
      return byId.get(item.sourceId)?.anchorDate ?? null;
    case "invoice":
    case "cari":
      return null;
    default:
      return unreachable(item.source);
  }
}

/** Kaynak başına kalem sayısı (süzgeç sekmeleri) */
function countBySource(items: readonly UpcomingItem[]): Record<UpcomingItem["source"], number> {
  const out: Record<UpcomingItem["source"], number> = { reminder: 0, invoice: 0, cari: 0 };
  for (const i of items) out[i.source]++;
  return out;
}
type View = "liste" | "takvim";
const VIEWS = ["liste", "takvim"] as const;

const TILES: { key: SummaryRange; label: string; icon: LucideIcon; empty: string }[] = [
  { key: "gecikmis", label: "Gecikmiş", icon: BellRing, empty: "Geciken yok" },
  { key: "hafta", label: "Bu hafta", icon: AlarmClock, empty: "Bu hafta ödeme yok" },
  { key: "ay", label: "Bu ay", icon: CalendarRange, empty: "Bu ay ödeme yok" },
  { key: "45gun", label: `${UPCOMING_HORIZON_DAYS} gün içinde`, icon: Wallet, empty: `${UPCOMING_HORIZON_DAYS} gün içinde yok` },
];
const RANGE_LABEL: Record<SummaryRange, string> = { gecikmis: "Gecikmiş", hafta: "Bu hafta", ay: "Bu ay", "45gun": `${UPCOMING_HORIZON_DAYS} gün içinde` };

const GROUP_DOT: Record<TimelineGroup, string> = { overdue: "bg-bad", today: "bg-brass-500", week: "bg-brass-300", month: "bg-ink-quiet", later: "bg-ink-quiet/50" };

const NO_ITEMS: UpcomingItem[] = [];

const EMPTY_TITLE: Record<Source, string> = {
  tumu: "Yaklaşan ödeme yok",
  hatirlatici: "Yaklaşan hatırlatıcı yok",
  fatura: "Yaklaşan fatura ödemesi yok",
  cari: "Yaklaşan faturasız borç yok",
};
const NO_RECENT: RecentPaid[] = [];
const NO_DRIFTS: (ReminderDrift & { text: string })[] = [];

type ItemHide = { key: string } | { reminderId: number };
type ReminderPatch = { type: "active"; id: number; active: boolean } | { type: "remove"; id: number };

export function RemindersClient({
  today,
  items,
  laterInvoices = NO_ITEMS,
  covered = NO_ITEMS,
  reminders,
  recipients,
  log,
  fixedExpenses,
  email,
  settings,
  invoiceSource,
  recentPaid = NO_RECENT,
  weekly = null,
  drifts = NO_DRIFTS,
}: {
  today: string;
  items: UpcomingItem[];
  /** Vadesi 45 günden sonra olan ödenmemiş faturalar ve faturasız borçlar (yalnız takvimde) */
  laterInvoices?: UpcomingItem[];
  /** Tedarikçinin hesabındaki sayılmamış ödemeyle tamamen karşılananlar (listede yok; altta kapalı kutuda) */
  covered?: UpcomingItem[];
  reminders: Reminder[];
  recipients: Recipient[];
  log: LogRow[];
  fixedExpenses: FixedRow[];
  email: EmailStatus;
  settings: NotifySettings;
  invoiceSource: Record<number, string>;
  /** Son 30 günde "Ödendi" işaretlenenler (geri alınabilir) */
  recentPaid?: RecentPaid[];
  /** Haftalık özetin satırı (E-posta bildirimleri içinde); okunamadıysa null */
  weekly?: WeeklyPanel | null;
  /**
   * Sabit gidere bağlı tutarlı hatırlatıcının tutarı Giderler'deki sürümden farklı (denetim E-46; src/lib/cash-plan.ts
   * fixedReminderDrifts): nakit planı hatırlatıcıdaki tutarı öder
   */
  drifts?: (ReminderDrift & { text: string })[];
}) {
  const [sourceRaw, setSource] = useQueryState<Source>("kaynak", "tumu");
  const source = oneOf(sourceRaw, SOURCES, "tumu");
  const [rangeRaw, setRange] = useQueryState<string>("aralik", "");
  const range = parseSummaryRange(rangeRaw);
  const [viewRaw, setView] = useQueryState<View>("gorunum", "liste");
  const view = oneOf(viewRaw, VIEWS, "liste");
  const thisMonth = today.slice(0, 7);
  const [monthRaw, setMonth] = useQueryState<string>("ay", thisMonth);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw) ? monthRaw : thisMonth;

  const [editing, setEditing] = useState<{ reminder: Reminder | null; date?: string } | null>(null);
  // `?yeni=<şablon>` (Vergi › takvimin "Ödemeler'e ekle"si): ekleme sayfası o şablonla dolu açılır; kapanınca adres
  // temizlenir (yenileme yeniden açmasın). Bilinmeyen şablon yok sayılır
  const [yeni, setYeni] = useQueryState<string>("yeni", "");
  const urlPreset = isPresetKey(yeni) ? yeni : null;
  const sheet = editing ?? (urlPreset ? { reminder: null, preset: urlPreset } : null);
  const closeSheet = () => {
    setEditing(null);
    if (yeni) setYeni("");
  };
  const [dueFor, setDueFor] = useState<UpcomingItem | null>(null);
  const [removing, setRemoving] = useState<Reminder | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [listPending, start] = useActionTransition();
  const router = useRouter();
  const fabRef = useRef<HTMLButtonElement>(null);
  const fabBlocked = useFabBlocked(fabRef);

  // Takvim için: listenin ufkundan (45 gün) sonraki tarihi olan hatırlatıcılar (yıllık, erken ödenmiş, ileri
  // ertelenmiş) ve faturalar. Listede ve özette görünmez; takvimde kendi ayında görünür, gün sayfasından ödenebilir.
  const later = useMemo(() => [...laterReminderItems(reminders, today), ...laterInvoices], [reminders, today, laterInvoices]);
  const laterKeys = useMemo(() => new Set(later.map(itemKey)), [later]);
  const allItems = useMemo(() => [...items, ...later], [items, later]);
  // İyimser görünüm: "Ödendi", ertele, aç/kapa ve sil sunucu yanıtını beklemeden görünür; hata olursa geri döner
  const [visibleAll, hideItem] = useOptimistic(allItems, (state, h: ItemHide) =>
    state.filter((i) => ("key" in h ? itemKey(i) !== h.key : !(i.source === "reminder" && i.sourceId === h.reminderId))),
  );
  const visible = useMemo(() => visibleAll.filter((i) => !laterKeys.has(itemKey(i))), [visibleAll, laterKeys]);
  const visibleLater = useMemo(() => visibleAll.filter((i) => laterKeys.has(itemKey(i))), [visibleAll, laterKeys]);
  const [list, patchList] = useOptimistic(reminders, (state, p: ReminderPatch) =>
    p.type === "remove" ? state.filter((r) => r.id !== p.id) : state.map((r) => (r.id === p.id ? { ...r, active: p.active } : r)),
  );
  const { busy, pay, postpone } = usePaymentActions((key) => hideItem({ key }));
  // Kart başına bekleme: bir ödemenin isteği sürerken öteki kartlar ödenebilir
  const pendingFor = (item: UpcomingItem) => busy(itemKey(item)) || listPending;
  const pending = listPending;
  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);
  const existingTitles = useMemo(() => new Set(reminders.map((r) => fold(r.title))), [reminders]);

  const shown = source === "tumu" ? visible : visible.filter((i) => i.source === SOURCE_OF[source]);
  const sums = summarize(shown, today);
  const filtered = range ? shown.filter((i) => inSummaryRange(i.dueDate, range, today)) : shown;
  const sum = (l: { amount: number | null }[]) => l.reduce((a, i) => a + (i.amount ?? 0), 0);
  const counts = countBySource(visible);
  const invoiceCount = counts.invoice;
  const cariCount = counts.cari;

  const actionsFor = (item: UpcomingItem): MenuAction[] => {
    const out: MenuAction[] = [];
    // Gecikmiş ödeme bugünden ertelenir (eski vadeden sayılsa yine gecikmiş kalırdı)
    const week = postponeDate(item.dueDate, "week", today);
    const monthLater = postponeDate(item.dueDate, "month", today);
    switch (item.source) {
      case "reminder": {
        const r = byId.get(item.sourceId);
        if (r) out.push({ key: "edit", label: "Düzenle", icon: Pencil, onSelect: () => setEditing({ reminder: r }) });
        if (!item.projected) {
          const keep = item.repeat !== "none" ? " · tekrar aynı günden sürer" : "";
          // Tekrar edende yeni tarih sıradaki dönemin günü ya da sonrası olursa (aylıkta "1 ay", haftalıkta "1 hafta")
          // aynı ödeme o gün iki kez görünür, iki kez ödenebilirdi: seçenek kapalı, nedeni altında yazar
          const step = (by: "week" | "month", label: string, icon: typeof ClockArrowUp) => {
            const plan = r ? postponePlan(r, by, today) : { target: by === "week" ? week : monthLater, next: null, conflict: false };
            out.push({
              key: by,
              label,
              hint: plan.conflict && plan.next ? `Sıradaki dönemle çakışır (${dateTR(plan.next)})` : `${dateTR(plan.target)}${keep}`,
              icon,
              disabled: plan.conflict,
              onSelect: () => postpone(item, by),
            });
          };
          step("week", "1 hafta ertele", ClockArrowUp);
          step("month", "1 ay ertele", CalendarClock);
        }
        if (r) out.push({ key: "delete", label: "Sil", icon: Trash2, tone: "danger", onSelect: () => setRemoving(r) });
        break;
      }
      case "invoice": {
        const parasut = invoiceSource[item.sourceId] === "parasut";
        out.push({ key: "due", label: "Vade tarihi", hint: item.detail?.includes("vade tahmini") ? "Şu an tahmini vade" : dateTR(item.dueDate), icon: CalendarDays, onSelect: () => setDueFor(item) });
        // Eşitleme ertelenen vadeyi korur; yalnız Paraşüt'te vade değişirse o gelir (sync.ts, syncedDueDate)
        const note = parasut ? " · Paraşüt'te vade değişirse o geçer" : "";
        out.push({ key: "week", label: "Vadeyi 1 hafta ertele", hint: `${dateTR(week)}${note}`, icon: ClockArrowUp, onSelect: () => postpone(item, "week") });
        out.push({ key: "month", label: "Vadeyi 1 ay ertele", hint: `${dateTR(monthLater)}${note}`, icon: CalendarClock, onSelect: () => postpone(item, "month") });
        break;
      }
      case "cari": {
        // Faturasız borç: düzenleme tedarikçinin sayfasında (Borcu düzenle), vade ertelenir
        const href = item.href;
        if (href) out.push({ key: "edit", label: "Düzenle", hint: "Tedarikçinin sayfasında", icon: Pencil, onSelect: () => router.push(`${href}?borc=${item.sourceId}`) });
        out.push({ key: "week", label: "Vadeyi 1 hafta ertele", hint: dateTR(week), icon: ClockArrowUp, onSelect: () => postpone(item, "week") });
        out.push({ key: "month", label: "Vadeyi 1 ay ertele", hint: dateTR(monthLater), icon: CalendarClock, onSelect: () => postpone(item, "month") });
        break;
      }
      default:
        unreachable(item.source);
    }
    return out;
  };

  const card = (item: UpcomingItem, i: number) => (
    <PaymentCard
      key={itemKey(item)}
      item={item}
      index={i}
      source={sourceOf(item, invoiceSource)}
      anchorDate={anchorOf(item, byId)}
      pending={pendingFor(item)}
      onPaid={() => pay(item)}
      actions={actionsFor(item)}
      onSeparate={item.hint?.kind === "link" ? () => separate(item) : undefined}
      swipe
    />
  );

  // İpucundaki "Ayrı alım": fatura bu faturasız alımların faturası değil (aday bir daha önerilmez; geri alınabilir)
  const separate = (item: UpcomingItem) => {
    const h = item.hint;
    if (h?.kind !== "link") return;
    start(async () => {
      const r = await dismissLinkCandidate({ debtIds: h.debtIds, invoiceId: h.invoiceId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Ayrı alım işaretlendi", {
        description: `${item.title} faturası artık faturasız alımla eşleştirilmiyor.`,
        duration: 8000,
        action: {
          label: "Geri al",
          onClick: () =>
            start(async () => {
              const u = await dismissLinkCandidate({ debtIds: h.debtIds, invoiceId: h.invoiceId, undo: true });
              if (!u.ok) toast.error(u.error);
            }),
        },
      });
    });
  };

  // Hesaptaki ödemeyle karşılananlar: "Borçlara say" parayı kalıcı olarak sayar (rakamlar değişmez)
  const coveredBy = useMemo(() => {
    const m = new Map<number, { cardId: number; title: string; items: UpcomingItem[] }>();
    for (const i of covered) {
      if (i.supplierId === undefined) continue;
      const g = m.get(i.supplierId) ?? { cardId: i.supplierId, title: i.title, items: [] };
      g.items.push(i);
      m.set(i.supplierId, g);
    }
    return [...m.values()];
  }, [covered]);
  const applyCredit = (cardId: number, title: string) =>
    start(async () => {
      const r = await applySupplierCredit({ cardId });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${title}: hesaptaki ${tl(r.data.total, 2)} borçlara sayıldı`, { description: r.data.lines.map((l) => `${l.label} ${tl(l.amount, 2)}`).join(" · ") });
    });

  // Takvim: listedeki ödemeler, ufuktan (45 gün) sonraki şimdiki dönemler ve tekrar edenlerin ileriki dönemleri
  // (yalnız bilgi). Ay toplamı ve gün sayfası da bundan.
  const entries = useMemo(() => {
    const laterShown = source === "tumu" ? visibleLater : visibleLater.filter((i) => i.source === SOURCE_OF[source]);
    // Tekrar eden hatırlatıcıların ileriki dönemleri yalnız hatırlatıcılar gösterilirken
    return calendarEntries(month, today, [...shown, ...laterShown], list, source === "tumu" || source === "hatirlatici");
  }, [month, shown, visibleLater, list, source, today]);
  const dayEntries = day ? entries.filter((e) => e.date === day) : [];

  const toggleActive = (r: Reminder, active: boolean) =>
    start(async () => {
      patchList({ type: "active", id: r.id, active });
      if (!active) hideItem({ reminderId: r.id });
      const res = await setReminderActive(r.id, active);
      if (!res.ok) toast.error(res.error);
    });

  const remove = (r: Reminder) => {
    setRemoving(null);
    start(async () => {
      patchList({ type: "remove", id: r.id });
      hideItem({ reminderId: r.id });
      const res = await deleteReminder(r.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`“${r.title}” silindi`);
    });
  };

  const add = (date?: string) => setEditing({ reminder: null, date });

  return (
    <>
      <PageHeader
        eyebrow="Finans"
        title="Ödemeler & hatırlatıcılar"
        description="Kira, vergi, SGK, maaş ve fatura ödemeleri tek yerde. Zamanı gelenler her sabah e-postayla hatırlatılır."
        actions={
          <>
            {/* Önümüzdeki 6 haftanın gelen, ödenecek ve kalan parası (alt ekran); telefonda da görünür */}
            <ButtonLink href="/panel/hatirlaticilar/nakit" variant="secondary">
              <ChartNoAxesColumn size={16} aria-hidden="true" /> Nakit planı
            </ButtonLink>
            <Button onClick={() => add()} className="max-lg:hidden">
              <Plus size={16} /> Hatırlatıcı ekle
            </Button>
          </>
        }
      />

      {/* Özet karoları: dokununca liste o aralığa süzülür */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4" role="group" aria-label="Özet ve aralık süzgeci">
        {TILES.map((t) => {
          const s = sums[t.key];
          const on = range === t.key;
          const alert = t.key === "gecikmis" && s.count > 0;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setRange(on ? "" : t.key);
                if (view === "takvim") setView("liste");
              }}
              className={cn(
                "flex min-h-[6.5rem] cursor-pointer flex-col justify-between gap-2 rounded-2xl p-3.5 text-left transition-[background-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]",
                on ? "bg-ink text-white shadow-[0_8px_24px_rgba(0,0,0,0.16)]" : alert ? "bg-bad-soft ring-1 ring-bad/15 ring-inset hover:ring-bad/30" : "bg-panel hover:bg-panel-deep/60",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn("text-[13px] leading-5 font-medium", on ? "text-white/80" : alert ? "text-bad" : "text-ink-mute")}>{t.label}</span>
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg [&>svg]:size-[15px]",
                    on ? "bg-white/15 text-white" : alert ? "bg-surface text-bad" : "border border-line-strong bg-surface text-ink",
                  )}
                  aria-hidden="true"
                >
                  <t.icon strokeWidth={1.9} />
                </span>
              </span>
              <span>
                <span className="flex items-baseline gap-1.5">
                  <span className={cn("text-2xl leading-7 font-semibold tracking-tight tabular", on ? "text-white" : alert ? "text-bad" : "text-ink")}>{num(s.count)}</span>
                  <span className={cn("text-[13px]", on ? "text-white/70" : "text-ink-mute")}>ödeme</span>
                </span>
                <span className={cn("mt-0.5 block text-[13px] leading-5 tabular", on ? "text-white/80" : alert ? "font-medium text-bad" : "text-ink-mute")}>
                  {s.count ? money(s.total) : t.empty}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {drifts.length ? (
        <div role="status" className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm ring-1 ring-warn/20 ring-inset">
          <p className="font-medium text-ink">Hatırlatıcı tutarı sabit giderden farklı</p>
          <p className="mt-0.5 text-[13px] text-ink-soft">
            Nakit planı hatırlatıcıdaki tutarı öder. Tutarı güncelleyin ya da boşaltın (boşken plan Giderler&apos;deki tutarı izler); gider bittiyse
            hatırlatıcıyı kapatın.
          </p>
          <ul className="mt-2 space-y-1.5">
            {drifts.map((d) => {
              const r = byId.get(d.reminderId);
              return (
                <li key={d.reminderId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 text-[13px] break-words text-ink">{d.text}</span>
                  {r ? (
                    <Button variant="secondary" size="sm" className="pointer-coarse:h-11" onClick={() => setEditing({ reminder: r })}>
                      <Pencil size={14} aria-hidden="true" /> Düzenle
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-12 xl:items-start">
        <Card className="xl:col-span-8">
          <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-5 sm:pt-4">
            <Segmented<View>
              label="Görünüm"
              value={view}
              onChange={setView}
              options={[
                {
                  value: "liste",
                  label: (
                    <>
                      <List size={14} aria-hidden="true" /> Liste
                    </>
                  ),
                },
                {
                  value: "takvim",
                  label: (
                    <>
                      <CalendarDays size={14} aria-hidden="true" /> Takvim
                    </>
                  ),
                },
              ]}
            />
            {invoiceCount || cariCount ? (
              <Segmented<Source>
                label="Kaynak"
                value={source}
                onChange={setSource}
                options={[
                  { value: "tumu", label: "Tümü", count: visible.length },
                  { value: "hatirlatici", label: "Hatırlatıcı", count: counts.reminder },
                  ...(invoiceCount ? [{ value: "fatura" as const, label: "Fatura", count: invoiceCount }] : []),
                  ...(cariCount ? [{ value: "cari" as const, label: "Faturasız borç", count: cariCount }] : []),
                ]}
              />
            ) : null}
            {range && view === "liste" ? (
              <button
                type="button"
                onClick={() => setRange("")}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-ink px-3 text-[13px] font-medium text-white pointer-coarse:h-11"
                aria-label={`${RANGE_LABEL[range]} süzgecini kaldır`}
              >
                {RANGE_LABEL[range]} <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <CardContent className="px-3 pt-4 sm:px-5">
            {view === "takvim" ? (
              <CalendarView month={month} onMonth={setMonth} today={today} entries={entries} onDay={setDay} />
            ) : visible.length === 0 ? (
              <EmptyState
                title="Yaklaşan ödeme yok"
                description="Kira, vergi ya da maaş için hatırlatıcı ekleyin. Ödenmemiş faturalar burada kendiliğinden görünür."
                action={
                  <Button onClick={() => add()} className="max-sm:h-12">
                    <Plus size={16} /> Hatırlatıcı ekle
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                title={range ? `${RANGE_LABEL[range]}: ödeme yok` : EMPTY_TITLE[source]}
                description={range ? "Bu aralıkta son günü gelen ödeme görünmüyor." : `Bu kaynakta önümüzdeki ${UPCOMING_HORIZON_DAYS} gün içinde ödeme görünmüyor.`}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setRange("");
                      setSource("tumu");
                    }}
                    className="max-sm:h-12"
                  >
                    Süzgeci temizle
                  </Button>
                }
              />
            ) : (
              <div className="space-y-5">
                {TIMELINE_GROUPS.map((g) => {
                  const group = filtered.filter((i) => timelineGroup(i.dueDate, today) === g.key);
                  if (!group.length) return null;
                  return (
                    <section key={g.key} aria-label={`${g.label}, ${group.length} ödeme`}>
                      <h3 className="mb-2 flex items-center justify-between gap-3 px-1">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                          <span className={cn("size-2 rounded-full", GROUP_DOT[g.key])} aria-hidden="true" />
                          {g.label}
                          <span className="font-normal text-ink-mute tabular">{group.length}</span>
                        </span>
                        <span className="text-[13px] text-ink-mute tabular">{money(sum(group))}</span>
                      </h3>
                      <ul className="space-y-2">{group.map(card)}</ul>
                    </section>
                  );
                })}
                <p className="px-1 text-xs leading-5 text-ink-mute">
                  Gecikenler ve önümüzdeki {UPCOMING_HORIZON_DAYS} gün; daha ilerisi takvimde. “Ödendi” bildirimden hemen, sonra da aşağıdaki “Son ödenenler”den geri alınabilir
                  <span className="sm:hidden">; kartı sağa kaydırmak da “Ödendi” demektir</span>.
                </p>
              </div>
            )}
            {coveredBy.length ? (
              <details className="group/c mt-4 rounded-2xl bg-surface ring-1 ring-line">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
                  <Wallet size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">Hesaptaki ödemeyle karşılananlar · {num(covered.length)}</span>
                    <span className="block text-xs text-ink-mute">Tedarikçiye önceden yapılan ödeme bu kalemleri karşılıyor; listeye ve toplamlara girmez.</span>
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open/c:rotate-180" aria-hidden="true" />
                </summary>
                <ul className="divide-y divide-ink/[0.06] px-4 pb-1.5">
                  {coveredBy.map((g) => (
                    <li key={g.cardId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-words text-ink">{g.title}</p>
                        <p className="mt-0.5 text-xs break-words text-ink-mute tabular">
                          {g.items.map((i) => `${i.detail ?? ""} ${tl(i.credited ?? 0, 2)}`.trim()).join(" · ")}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => applyCredit(g.cardId, g.title)} className="shrink-0 pointer-coarse:h-11">
                        Borçlara say
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {recentPaid.length ? <RecentPaidList items={recentPaid} /> : null}
          </CardContent>
        </Card>

        <NotificationsSection
          email={email}
          settings={settings}
          recipients={recipients}
          log={log}
          weekly={weekly ? <WeeklyRow weekly={weekly} emailConfigured={email.configured} /> : null}
          className="xl:col-span-4"
        />
      </div>

      <div className="mt-4">
        <AllReminders
          reminders={list}
          today={today}
          pending={pending}
          onAdd={() => add()}
          onEdit={(r) => setEditing({ reminder: r })}
          onRemove={setRemoving}
          onToggle={toggleActive}
        />
      </div>

      {/* Telefonda ekleme düğmesi: alt menünün üstünde, başparmak hizasında; aşağı kaydırırken gizlenir, yukarı
          kaydırınca gelir. E-posta bildirimlerinin ("Adres ekle") ya da bölüm açma okunun üstüne geldiğinde çekilir
          (fab-clear.ts): yanyana iki "Ekle" olmasın */}
      <div aria-hidden="true" className="h-20 lg:hidden" />
      <Fab
        ref={fabRef}
        onClick={() => add()}
        aria-label="Hatırlatıcı ekle"
        aria-hidden={fabBlocked || undefined}
        tabIndex={fabBlocked ? -1 : undefined}
        className={cn(fabBlocked && "pointer-events-none translate-y-[calc(100%+1rem)] opacity-0")}
      >
        <Plus size={20} aria-hidden="true" /> Ekle
      </Fab>

      {day ? (
        <Sheet
          open
          onClose={() => setDay(null)}
          title={longDateTR(day)}
          description={dayEntries.length ? `${dayEntries.length} ödeme · ${money(sum(dayEntries.map((e) => e.item)))}` : "Bu gün ödeme yok"}
          footer={
            <Button
              variant="secondary"
              onClick={() => {
                const d = day;
                setDay(null);
                add(d);
              }}
              className="max-sm:h-12 max-sm:flex-1"
            >
              <Plus size={16} /> Bu güne ekle
            </Button>
          }
        >
          {dayEntries.length ? (
            <ul className="space-y-2">
              {dayEntries.map((e, i) =>
                e.forecast ? (
                  <ForecastRow key={e.key} entry={e} />
                ) : (
                  <PaymentCard
                    key={e.key}
                    item={e.item}
                    index={i}
                    source={sourceOf(e.item, invoiceSource)}
                    anchorDate={e.anchorDate}
                    pending={pendingFor(e.item)}
                    onSeparate={e.item.hint?.kind === "link" ? () => separate(e.item) : undefined}
                    onPaid={() => {
                      setDay(null);
                      pay(e.item);
                    }}
                    actions={actionsFor(e.item).map((a) => ({
                      ...a,
                      onSelect: () => {
                        setDay(null);
                        a.onSelect();
                      },
                    }))}
                  />
                ),
              )}
            </ul>
          ) : (
            <p className="rounded-2xl bg-panel px-4 py-6 text-center text-sm text-ink-mute">{day < today ? "Bu tarihte kayıtlı ödeme yok." : "Bu güne bir hatırlatıcı ekleyebilirsiniz."}</p>
          )}
        </Sheet>
      ) : null}

      {sheet ? (
        <ReminderSheet
          key={sheet.reminder ? sheet.reminder.id : "preset" in sheet ? `preset-${sheet.preset}` : `new-${sheet.date ?? ""}`}
          reminder={sheet.reminder}
          today={today}
          initialDate={"date" in sheet ? sheet.date : undefined}
          initialPreset={"preset" in sheet ? sheet.preset : null}
          existing={existingTitles}
          fixedExpenses={fixedExpenses}
          onClose={closeSheet}
          onDelete={(r) => {
            closeSheet();
            setRemoving(r);
          }}
        />
      ) : null}
      {dueFor ? <DueDateSheet key={dueFor.ref} item={dueFor} onClose={() => setDueFor(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Hatırlatıcı silinsin mi?"
        description={
          removing
            ? `“${removing.title}” ve sıradaki tarihleri kalıcı olarak silinir. Geçmiş bildirim kayıtları kalır. Yalnızca bir süre durdurmak istiyorsanız silmek yerine kapatın.`
            : undefined
        }
        confirmLabel="Hatırlatıcıyı sil"
        pending={pending}
        onConfirm={() => {
          if (removing) remove(removing);
        }}
      />
    </>
  );
}
