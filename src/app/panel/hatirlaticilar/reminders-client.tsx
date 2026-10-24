"use client";

import { AlarmClock, BellRing, CalendarClock, CalendarDays, CalendarRange, ChartNoAxesColumn, ClockArrowUp, List, Pencil, Plus, Trash2, Wallet, X, type LucideIcon } from "lucide-react";
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
import { dateTR, money, num } from "@/lib/format";
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
import { cn } from "@/lib/utils";
import { deleteReminder, setReminderActive } from "@/server/actions/reminders";
import type { NotifySettings } from "@/server/notify/settings";

import { AllReminders, oneOf } from "./all-reminders";
import { calendarEntries } from "./calendar-entries";
import { CalendarView, ForecastRow } from "./calendar-view";
import { useFabBlocked } from "./fab-clear";
import { NotificationsSection, type EmailStatus, type LogRow, type Recipient } from "./notifications-section";
import { itemKey, PaymentCard, sourceOf, usePaymentActions, type MenuAction } from "./payment-ui";
import { RecentPaidList } from "./recent-paid";
import { DueDateSheet, ReminderSheet, type FixedRow, type Reminder } from "./reminder-sheet";
import { Sheet } from "./sheet";
import { WeeklyRow, type WeeklyPanel } from "./weekly-row";

/** Adresteki süzgeç değerleri (?kaynak=fatura&aralik=gecikmis&gorunum=takvim&ay=2026-11) */
type Source = "tumu" | "hatirlatici" | "fatura";
const SOURCES = ["tumu", "hatirlatici", "fatura"] as const;
const SOURCE_OF: Record<Exclude<Source, "tumu">, UpcomingItem["source"]> = { hatirlatici: "reminder", fatura: "invoice" };
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
const NO_RECENT: RecentPaid[] = [];

type ItemHide = { key: string } | { reminderId: number };
type ReminderPatch = { type: "active"; id: number; active: boolean } | { type: "remove"; id: number };

export function RemindersClient({
  today,
  items,
  laterInvoices = NO_ITEMS,
  reminders,
  recipients,
  log,
  fixedExpenses,
  email,
  settings,
  invoiceSource,
  recentPaid = NO_RECENT,
  weekly = null,
}: {
  today: string;
  items: UpcomingItem[];
  /** Vadesi 45 günden sonra olan ödenmemiş faturalar (yalnız takvimde) */
  laterInvoices?: UpcomingItem[];
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
  const [dueFor, setDueFor] = useState<UpcomingItem | null>(null);
  const [removing, setRemoving] = useState<Reminder | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [listPending, start] = useActionTransition();
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
  const invoiceCount = visible.filter((i) => i.source === "invoice").length;

  const actionsFor = (item: UpcomingItem): MenuAction[] => {
    const out: MenuAction[] = [];
    // Gecikmiş ödeme bugünden ertelenir (eski vadeden sayılsa yine gecikmiş kalırdı)
    const week = postponeDate(item.dueDate, "week", today);
    const monthLater = postponeDate(item.dueDate, "month", today);
    if (item.source === "reminder") {
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
    } else {
      const parasut = invoiceSource[item.sourceId] === "parasut";
      out.push({ key: "due", label: "Vade tarihi", hint: item.detail?.includes("vade tahmini") ? "Şu an tahmini vade" : dateTR(item.dueDate), icon: CalendarDays, onSelect: () => setDueFor(item) });
      // Eşitleme ertelenen vadeyi korur; yalnız Paraşüt'te vade değişirse o gelir (sync.ts, syncedDueDate)
      const note = parasut ? " · Paraşüt'te vade değişirse o geçer" : "";
      out.push({ key: "week", label: "Vadeyi 1 hafta ertele", hint: `${dateTR(week)}${note}`, icon: ClockArrowUp, onSelect: () => postpone(item, "week") });
      out.push({ key: "month", label: "Vadeyi 1 ay ertele", hint: `${dateTR(monthLater)}${note}`, icon: CalendarClock, onSelect: () => postpone(item, "month") });
    }
    return out;
  };

  const card = (item: UpcomingItem, i: number) => (
    <PaymentCard
      key={itemKey(item)}
      item={item}
      index={i}
      source={sourceOf(item, invoiceSource)}
      anchorDate={item.source === "reminder" ? byId.get(item.sourceId)?.anchorDate : null}
      pending={pendingFor(item)}
      onPaid={() => pay(item)}
      actions={actionsFor(item)}
      swipe
    />
  );

  // Takvim: listedeki ödemeler, ufuktan (45 gün) sonraki şimdiki dönemler ve tekrar edenlerin ileriki dönemleri
  // (yalnız bilgi). Ay toplamı ve gün sayfası da bundan.
  const entries = useMemo(() => {
    const laterShown = source === "tumu" ? visibleLater : visibleLater.filter((i) => i.source === SOURCE_OF[source]);
    return calendarEntries(month, today, [...shown, ...laterShown], list, source !== "fatura");
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
        eyebrow="Satış & gider"
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
            {invoiceCount ? (
              <Segmented<Source>
                label="Kaynak"
                value={source}
                onChange={setSource}
                options={[
                  { value: "tumu", label: "Tümü", count: visible.length },
                  { value: "hatirlatici", label: "Hatırlatıcı", count: visible.length - invoiceCount },
                  { value: "fatura", label: "Fatura", count: invoiceCount },
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
                title={range ? `${RANGE_LABEL[range]}: ödeme yok` : source === "fatura" ? "Yaklaşan fatura ödemesi yok" : "Yaklaşan hatırlatıcı yok"}
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

      {editing ? (
        <ReminderSheet
          key={editing.reminder ? editing.reminder.id : `new-${editing.date ?? ""}`}
          reminder={editing.reminder}
          today={today}
          initialDate={editing.date}
          existing={existingTitles}
          fixedExpenses={fixedExpenses}
          onClose={() => setEditing(null)}
          onDelete={(r) => {
            setEditing(null);
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
