"use client";

import {
  AlarmClock,
  BellRing,
  CalendarClock,
  Check,
  ChevronDown,
  FileText,
  KeyRound,
  Landmark,
  Mail,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Send,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useId, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, fold, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { SortButton, Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTimeTR, dateTR, num, tl } from "@/lib/format";
import {
  addDays,
  daysBetween,
  daysLeftLabel,
  REMINDER_KINDS,
  REMINDER_PRESETS,
  REMINDER_REPEATS,
  type ReminderKind,
  type ReminderRepeat,
  type UpcomingItem,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { setInvoicePaid } from "@/server/actions/invoices";
import {
  addFixedExpenseReminder,
  addPresetReminder,
  addRecipient,
  deleteRecipient,
  deleteReminder,
  markReminderDone,
  runDigestNow,
  saveNotificationSettings,
  saveReminder,
  sendTestNotification,
  setInvoiceDueDate,
  setRecipientActive,
  setReminderActive,
} from "@/server/actions/reminders";
import type { NotifySettings } from "@/server/notify/settings";

interface Reminder {
  id: number;
  title: string;
  kind: ReminderKind;
  amount: number | null;
  dueDate: string;
  anchorDate: string;
  repeat: ReminderRepeat;
  remindDaysBefore: number;
  note: string | null;
  active: boolean;
  lastDoneAt: string | null;
}
interface Recipient {
  id: number;
  email: string;
  name: string | null;
  active: boolean;
}
interface LogRow {
  id: number;
  key: string;
  subject: string | null;
  recipients: string | null;
  ok: boolean;
  error: string | null;
  sentAt: string;
}
interface FixedRow {
  id: number;
  name: string;
  amount: number;
  period: string;
  section: string;
}
type EmailStatus = { configured: boolean; cron: boolean; from: string; defaultFrom: string };

const KIND_ICON: Record<ReminderKind, LucideIcon> = {
  odeme: Wallet,
  vergi: Landmark,
  kira: Receipt,
  maas: Users,
  fatura: FileText,
  diger: AlarmClock,
};
/** AkmanOS Recent Activity kuyuları (beyaz glif) */
const KIND_WELL: Record<ReminderKind, string> = {
  odeme: "bg-[#0a84ff]",
  vergi: "bg-[#bf5af2]",
  kira: "bg-[#ff9f0a]",
  maas: "bg-[#30d158]",
  fatura: "bg-[#64d2ff]",
  diger: "bg-[#8e8e93]",
};
const KIND_LABEL = Object.fromEntries(REMINDER_KINDS.map((k) => [k.value, k.label])) as Record<ReminderKind, string>;
const REPEAT_LABEL = Object.fromEntries(REMINDER_REPEATS.map((r) => [r.value, r.label])) as Record<ReminderRepeat, string>;

const STATUS_TONE: Record<UpcomingItem["status"], Tone> = { overdue: "red", today: "orange", soon: "amber", later: "gray" };
const GROUPS: { key: UpcomingItem["status"]; label: string }[] = [
  { key: "overdue", label: "Gecikmiş" },
  { key: "today", label: "Bugün" },
  { key: "soon", label: "Yakında" },
  { key: "later", label: "Sonra" },
];

/** Adresteki süzgeç değerleri (?kaynak=fatura&durum=etkin&tur=vergi&sirala=-tutar&ara=kira) */
type Source = "tumu" | "hatirlatici" | "fatura";
const SOURCES = ["tumu", "hatirlatici", "fatura"] as const;
const SOURCE_OF: Record<Exclude<Source, "tumu">, UpcomingItem["source"]> = { hatirlatici: "reminder", fatura: "invoice" };
type StatusFilter = "tumu" | "etkin" | "kapali";
const STATUSES = ["tumu", "etkin", "kapali"] as const;
type SortCol = "tarih" | "ad" | "tutar";
type SortKey = SortCol | `-${SortCol}`;
const SORTS = ["tarih", "-tarih", "ad", "-ad", "tutar", "-tutar"] as const;

/** Adresten gelen değer beklenenlerden biri değilse varsayılan kullanılır */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Tekrarın bir aya düşen payı (aylık ortalama yük); bir kezlikler sayılmaz */
const PER_MONTH: Record<ReminderRepeat, number> = { none: 0, weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

/** Telefonda dokunma alanı 40px */
const TOUCH_ICON = "pointer-coarse:size-10";
const TOUCH_BTN = "pointer-coarse:h-10";
const TOUCH_INPUT = "pointer-coarse:h-10";
/** Dokunmatik ekranda liste pencereleri ilk alana odaklanmaz: klavye açılıp listeyi örtmesin (Dialog önce [data-autofocus]'u seçer) */
const listFocus = () => (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? { tabIndex: -1, "data-autofocus": "" } : {});

/** Yaklaşan bir ödemenin tekil anahtarı (tekrarlı hatırlatıcı ödenince aynı ref yeni tarihle döner) */
const itemKey = (i: UpcomingItem) => `${i.ref}|${i.dueDate}`;

type ItemHide = { key: string } | { reminderId: number };
type ReminderPatch = { type: "active"; id: number; active: boolean } | { type: "remove"; id: number };

export function RemindersClient({
  today,
  items,
  reminders,
  recipients,
  log,
  fixedExpenses,
  email,
  settings,
}: {
  today: string;
  items: UpcomingItem[];
  reminders: Reminder[];
  recipients: Recipient[];
  log: LogRow[];
  fixedExpenses: FixedRow[];
  email: EmailStatus;
  settings: NotifySettings;
}) {
  const [sourceRaw, setSource] = useQueryState<Source>("kaynak", "tumu");
  const source = oneOf(sourceRaw, SOURCES, "tumu");
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [dueFor, setDueFor] = useState<UpcomingItem | null>(null);
  const [removing, setRemoving] = useState<Reminder | null>(null);
  const [pending, start] = useTransition();

  // İyimser görünüm: "Ödendi", aç/kapa ve sil sunucu yanıtını beklemeden görünür; hata olursa geri döner
  const [visible, hideItem] = useOptimistic(items, (state, h: ItemHide) =>
    state.filter((i) => ("key" in h ? itemKey(i) !== h.key : !(i.source === "reminder" && i.sourceId === h.reminderId))),
  );
  const [list, patchList] = useOptimistic(reminders, (state, p: ReminderPatch) =>
    p.type === "remove" ? state.filter((r) => r.id !== p.id) : state.map((r) => (r.id === p.id ? { ...r, active: p.active } : r)),
  );
  const existingTitles = useMemo(() => new Set(reminders.map((r) => fold(r.title))), [reminders]);

  const shown = source === "tumu" ? visible : visible.filter((i) => i.source === SOURCE_OF[source]);
  const sum = (l: UpcomingItem[]) => l.reduce((a, i) => a + (i.amount ?? 0), 0);
  const overdue = visible.filter((i) => i.status === "overdue");
  const todayItems = visible.filter((i) => i.status === "today");
  const week = visible.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 7);
  const month = visible.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 30);

  const markPaid = (item: UpcomingItem) =>
    start(async () => {
      hideItem({ key: itemKey(item) });
      if (item.source === "invoice") {
        const r = await setInvoicePaid(item.sourceId, true);
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${item.title} ödendi olarak işaretlendi`);
      } else {
        const r = await markReminderDone(item.sourceId, item.projected ? item.dueDate : undefined);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.data.next ? `${item.title} ödendi · sıradaki ${dateTR(r.data.next)}` : `${item.title} ödendi, hatırlatıcı kapandı`);
      }
    });

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

  return (
    <>
      <PageHeader
        eyebrow="Satış & gider"
        title="Ödemeler & hatırlatıcılar"
        description="Yaklaşan kira, vergi, maaş ve fatura ödemeleri. Zamanı gelenler her sabah bildirim adreslerine e-postayla gider."
        actions={
          <>
            <Button variant="secondary" onClick={() => setFixedOpen(true)} className={TOUCH_BTN}>
              <Repeat size={16} /> Sabit giderlerden
            </Button>
            <Button variant="secondary" onClick={() => setPresetsOpen(true)} className={TOUCH_BTN}>
              <Landmark size={16} /> Vergi takvimi
            </Button>
            {/* Telefonda birincil eylem ilk sırada */}
            <Button onClick={() => setEditing("new")} className={cn("max-sm:order-first", TOUCH_BTN)}>
              <Plus size={16} /> Yeni hatırlatıcı
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={<BellRing />} label="Gecikmiş" value={num(overdue.length)} tone={overdue.length ? "bad" : "default"} sub={overdue.length ? tl(sum(overdue)) : "Geciken ödeme yok"} />
        <Stat icon={<CalendarClock />} label="Bugün" value={num(todayItems.length)} tone={todayItems.length ? "warn" : "default"} sub={todayItems.length ? tl(sum(todayItems)) : "Bugün son günü olan yok"} />
        <Stat icon={<AlarmClock />} label="7 gün içinde" value={num(week.length)} sub={week.length ? tl(sum(week)) : "Bu hafta ödeme yok"} />
        <Stat
          icon={<Wallet />}
          label="30 gün toplamı"
          info="Önümüzdeki 30 günde son günü gelen hatırlatıcı ve ödenmemiş faturaların toplamı. Tutarı girilmemiş hatırlatıcılar sayılmaz; gecikmişler ayrı karoda."
          value={tl(sum(month))}
          sub={`${num(month.length)} ödeme`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader
            icon={<CalendarClock />}
            title="Yaklaşan ödemeler"
            description="Önümüzdeki 45 gün ve gecikenler. Ödediğinizi işaretleyin; tekrar eden hatırlatıcı bir sonraki döneme geçer."
            actions={
              visible.length ? (
                <Segmented<Source>
                  label="Kaynak"
                  value={source}
                  onChange={setSource}
                  options={[
                    { value: "tumu", label: "Tümü", count: visible.length },
                    { value: "hatirlatici", label: "Hatırlatıcı", count: visible.filter((i) => i.source === "reminder").length },
                    { value: "fatura", label: "Fatura", count: visible.filter((i) => i.source === "invoice").length },
                  ]}
                />
              ) : null
            }
          />
          <CardContent>
            {visible.length === 0 ? (
              <EmptyState
                title="Yaklaşan ödeme yok"
                description="Kira, vergi ya da maaş için hatırlatıcı ekleyin. Ödenmemiş faturalar burada kendiliğinden görünür."
                action={
                  <>
                    <Button onClick={() => setEditing("new")} className={TOUCH_BTN}>
                      <Plus size={16} /> Yeni hatırlatıcı
                    </Button>
                    <Button variant="secondary" onClick={() => setPresetsOpen(true)} className={TOUCH_BTN}>
                      <Landmark size={16} /> Vergi takvimi
                    </Button>
                  </>
                }
              />
            ) : shown.length === 0 ? (
              <EmptyState
                title={source === "fatura" ? "Yaklaşan fatura ödemesi yok" : "Yaklaşan hatırlatıcı yok"}
                description="Bu kaynakta önümüzdeki 45 gün içinde ödeme görünmüyor."
                action={
                  <Button variant="secondary" onClick={() => setSource("tumu")} className={TOUCH_BTN}>
                    Süzgeci temizle
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {GROUPS.map((g) => {
                  const group = shown.filter((i) => i.status === g.key);
                  if (!group.length) return null;
                  return (
                    <section key={g.key} aria-label={g.label}>
                      <p className="mb-1 flex items-center justify-between gap-3 px-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">
                        <span>
                          {g.label} · {group.length}
                        </span>
                        <span className="tabular">{tl(sum(group))}</span>
                      </p>
                      <ul className="rounded-2xl bg-surface p-1.5">
                        {group.map((item, i) => (
                          <UpcomingRow
                            key={item.ref}
                            item={item}
                            index={i}
                            last={i === group.length - 1}
                            pending={pending}
                            onPaid={() => markPaid(item)}
                            onDue={item.source === "invoice" ? () => setDueFor(item) : undefined}
                            onEdit={item.source === "reminder" ? () => setEditing(list.find((r) => r.id === item.sourceId) ?? null) : undefined}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <NotificationsCard email={email} settings={settings} recipients={recipients} log={log} className="lg:col-span-5" />
      </div>

      <AllReminders
        reminders={list}
        today={today}
        pending={pending}
        onAdd={() => setEditing("new")}
        onPresets={() => setPresetsOpen(true)}
        onFixed={() => setFixedOpen(true)}
        onEdit={setEditing}
        onRemove={setRemoving}
        onToggle={toggleActive}
      />

      {editing ? (
        <ReminderDialog
          key={editing === "new" ? "new" : editing.id}
          reminder={editing === "new" ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onDelete={(r) => {
            setEditing(null);
            setRemoving(r);
          }}
        />
      ) : null}
      <PresetsDialog open={presetsOpen} onClose={() => setPresetsOpen(false)} existing={existingTitles} />
      <FixedDialog open={fixedOpen} onClose={() => setFixedOpen(false)} rows={fixedExpenses} today={today} existing={existingTitles} />
      {dueFor ? <DueDateDialog key={dueFor.ref} item={dueFor} onClose={() => setDueFor(null)} /> : null}
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

function UpcomingRow({
  item,
  index,
  last,
  pending,
  onPaid,
  onDue,
  onEdit,
}: {
  item: UpcomingItem;
  index: number;
  last: boolean;
  pending: boolean;
  onPaid: () => void;
  onDue?: () => void;
  onEdit?: () => void;
}) {
  const reduce = useCalmMotion();
  const Icon = KIND_ICON[item.kind];
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE_OUT, delay: 0.03 * index }}
      className="relative"
    >
      {/* Yerleşim tek kısa yazımla (col-[2/4]); col-span ile col-start birlikte kırılımda birbirini eziyordu */}
      <div className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-[14px] px-3 py-3 sm:grid-cols-[34px_minmax(0,1fr)_auto_auto]">
        <span
          className={cn(
            "col-[1] row-[1/3] mt-0.5 flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
            KIND_WELL[item.kind],
          )}
          aria-hidden="true"
        >
          <Icon size={15} strokeWidth={2.25} />
        </span>
        <p className="col-[2] row-[1] truncate text-[15px] font-semibold tracking-[-0.01em] text-ink" title={item.title}>
          {item.title}
        </p>
        <span className="col-[3] row-[1] text-right text-[15px] font-semibold whitespace-nowrap text-ink tabular">{item.amount !== null ? tl(item.amount) : "–"}</span>
        <div className="col-[2/4] row-[2] flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
          <Badge tone={STATUS_TONE[item.status]} dot>
            {daysLeftLabel(item.daysLeft)}
          </Badge>
          <span className="tabular">{dateTR(item.dueDate)}</span>
          {item.repeat !== "none" ? <span>· {REPEAT_LABEL[item.repeat]}</span> : null}
          {item.detail ? <span className="min-w-0 break-words">· {item.detail}</span> : null}
        </div>
        {/* Telefonda eylemler alt satıra iner; masaüstünde tutarın sağında */}
        <div className="col-[2/4] row-[3] mt-1.5 flex items-center gap-1.5 sm:col-[4] sm:row-[1/3] sm:mt-0 sm:self-center">
          {onEdit ? (
            <IconButton label={`${item.title} düzenle`} onClick={onEdit} className={TOUCH_ICON}>
              <Pencil size={15} />
            </IconButton>
          ) : null}
          {onDue ? (
            <IconButton label={`${item.title} vade tarihi`} onClick={onDue} className={TOUCH_ICON}>
              <CalendarClock size={15} />
            </IconButton>
          ) : null}
          <Button size="sm" variant="secondary" disabled={pending} onClick={onPaid} className={TOUCH_BTN} aria-label={`${item.title} ödendi`}>
            <Check size={14} /> Ödendi
          </Button>
        </div>
      </div>
      {!last ? <div aria-hidden="true" className="pointer-events-none absolute right-3 bottom-0 left-[58px] h-px bg-ink/[0.08]" /> : null}
    </motion.li>
  );
}

/** "Tüm hatırlatıcılar": arama, durum ve tür süzgeci, sıralama; masaüstünde tablo, telefonda liste */
function AllReminders({
  reminders,
  today,
  pending,
  onAdd,
  onPresets,
  onFixed,
  onEdit,
  onRemove,
  onToggle,
}: {
  reminders: Reminder[];
  today: string;
  pending: boolean;
  onAdd: () => void;
  onPresets: () => void;
  onFixed: () => void;
  onEdit: (r: Reminder) => void;
  onRemove: (r: Reminder) => void;
  onToggle: (r: Reminder, active: boolean) => void;
}) {
  const [q, setQ] = useQueryText("ara");
  const [statusRaw, setStatus] = useQueryState<StatusFilter>("durum", "tumu");
  const status = oneOf(statusRaw, STATUSES, "tumu");
  const [kindRaw, setKind] = useQueryState<string>("tur", "");
  const kind = REMINDER_KINDS.find((k) => k.value === kindRaw)?.value ?? null;
  const [sortRaw, setSort] = useQueryState<SortKey>("sirala", "tarih");
  const sort = oneOf(sortRaw, SORTS, "tarih");
  const sortCol = sort.replace("-", "") as SortCol;
  const sortDir = sort.startsWith("-") ? "desc" : "asc";
  const sortBy = (col: SortCol) => setSort(sortCol === col ? (sortDir === "asc" ? `-${col}` : col) : col === "tutar" ? "-tutar" : col);
  const dirOf = (col: SortCol) => (sortCol === col ? sortDir : null);

  const searched = reminders.filter((r) => matches(`${r.title} ${r.note ?? ""} ${KIND_LABEL[r.kind]} ${REPEAT_LABEL[r.repeat]}`, q));
  const byStatus = searched.filter((r) => status === "tumu" || (status === "etkin" ? r.active : !r.active));
  const filtered = byStatus.filter((r) => !kind || r.kind === kind);
  const rows = [...filtered].sort((a, b) => {
    const d =
      sortCol === "ad" ? a.title.localeCompare(b.title, "tr") : sortCol === "tutar" ? (a.amount ?? -1) - (b.amount ?? -1) : a.dueDate.localeCompare(b.dueDate);
    return (sortDir === "desc" ? -d : d) || a.title.localeCompare(b.title, "tr");
  });
  const filterActive = Boolean(q.trim()) || status !== "tumu" || kind !== null;
  const clear = () => {
    setQ("");
    clearQuery(["ara", "durum", "tur"]);
  };

  const activeCount = reminders.filter((r) => r.active).length;
  const total = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  const monthly = rows.reduce((a, r) => a + (r.active ? (r.amount ?? 0) * PER_MONTH[r.repeat] : 0), 0);
  const kindCounts = new Map<ReminderKind, number>();
  for (const r of byStatus) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);

  return (
    <Card className="mt-4">
      <CardHeader
        icon={<Repeat />}
        title="Tüm hatırlatıcılar"
        meta={
          <>
            <span>Etkin</span>
            <span className="text-ink-quiet">·</span>
            <span className="font-semibold text-ink tabular">{activeCount}</span>
            {reminders.length > activeCount ? (
              <>
                <span className="text-ink-quiet">·</span>
                <span>Kapalı {reminders.length - activeCount}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={onAdd} className={TOUCH_BTN}>
            <Plus size={14} /> Ekle
          </Button>
        }
      />
      {reminders.length === 0 ? (
        <CardContent>
          <EmptyState
            title="Henüz hatırlatıcı yok"
            description="Kira, KDV, SGK ya da maaş gibi düzenli ödemeleri ekleyin; tarih yaklaşınca e-postayla haber verilir. Vergi takviminden ya da sabit giderlerden tek tıkla da eklenebilir."
            action={
              <>
                <Button onClick={onAdd} className={TOUCH_BTN}>
                  <Plus size={16} /> Yeni hatırlatıcı
                </Button>
                <Button variant="secondary" onClick={onPresets} className={TOUCH_BTN}>
                  <Landmark size={16} /> Vergi takvimi
                </Button>
                <Button variant="secondary" onClick={onFixed} className={TOUCH_BTN}>
                  <Repeat size={16} /> Sabit giderlerden
                </Button>
              </>
            }
          />
        </CardContent>
      ) : (
        <>
          <div className="space-y-2 px-5 pb-3">
            <FilterBar active={filterActive} onClear={clear} shown={rows.length} total={reminders.length} unit="hatırlatıcı">
              <SearchField value={q} onChange={setQ} placeholder="Hatırlatıcı ara" className="w-full sm:w-64" />
              <Segmented<StatusFilter>
                label="Durum"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "tumu", label: "Tümü", count: searched.length },
                  { value: "etkin", label: "Etkin", count: searched.filter((r) => r.active).length },
                  { value: "kapali", label: "Kapalı", count: searched.filter((r) => !r.active).length },
                ]}
              />
            </FilterBar>
            {kindCounts.size > 1 || kind ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tür">
                {REMINDER_KINDS.filter((k) => kindCounts.has(k.value) || k.value === kind).map((k) => (
                  <FilterChip key={k.value} active={kind === k.value} onToggle={() => setKind(kind === k.value ? "" : k.value)} count={kindCounts.get(k.value) ?? 0}>
                    {k.label}
                  </FilterChip>
                ))}
              </div>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <CardContent>
              <EmptyState
                title="Bu süzgece uyan hatırlatıcı yok"
                description={q.trim() ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.` : "Seçili durum ya da türde hatırlatıcı yok."}
                action={
                  <Button variant="secondary" onClick={clear} className={TOUCH_BTN}>
                    Süzgeci temizle
                  </Button>
                }
              />
            </CardContent>
          ) : (
            <>
              {/* Telefon: kart listesi */}
              <ul className="mx-2 mb-2 rounded-2xl bg-surface p-1.5 md:hidden">
                {rows.map((r, i) => {
                  const Icon = KIND_ICON[r.kind];
                  const left = daysBetween(today, r.dueDate);
                  return (
                    <li key={r.id} className={cn("flex items-start gap-3 px-2.5 py-3", i > 0 && "border-t border-ink/[0.06]")}>
                      <span
                        className={cn("mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white", KIND_WELL[r.kind], !r.active && "opacity-60")}
                        aria-hidden="true"
                      >
                        <Icon size={14} strokeWidth={2.25} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* Kapalı hatırlatıcıda yalnız metin soluklaşır; anahtar ve düğmeler tam renkte kalır */}
                        <div className={cn(!r.active && "opacity-60")}>
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="min-w-0 truncate text-sm font-semibold text-ink" title={r.title}>
                              {r.title}
                            </p>
                            <span className="shrink-0 text-sm font-semibold text-ink tabular">{r.amount !== null ? tl(r.amount) : "–"}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-ink-mute">
                            {KIND_LABEL[r.kind]} · <span className="tabular">{dateTR(r.dueDate)}</span>
                            {r.active ? <span className={cn(left < 0 && "text-bad")}> ({daysLeftLabel(left)})</span> : null} · {REPEAT_LABEL[r.repeat]} ·{" "}
                            {r.remindDaysBefore} gün önce haber
                          </p>
                          {r.note ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-mute">{r.note}</p> : null}
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Switch
                            checked={r.active}
                            showText
                            label={`${r.title} etkin`}
                            onText="Etkin"
                            offText="Kapalı"
                            disabled={pending}
                            onChange={(v) => onToggle(r, v)}
                            className="pointer-coarse:h-10"
                          />
                          <div className="flex gap-1.5">
                            <IconButton label={`${r.title} düzenle`} onClick={() => onEdit(r)} className={TOUCH_ICON}>
                              <Pencil size={15} />
                            </IconButton>
                            <IconButton label={`${r.title} sil`} tone="danger" onClick={() => onRemove(r)} className={TOUCH_ICON}>
                              <Trash2 size={15} />
                            </IconButton>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Masaüstü: tablo */}
              <TableWrap className="hidden md:block">
                <Table className="min-w-[640px]">
                  <THead>
                    <tr>
                      <TH sticky>
                        <SortButton dir={dirOf("ad")} onClick={() => sortBy("ad")}>
                          Hatırlatıcı
                        </SortButton>
                      </TH>
                      <TH numeric>
                        <SortButton numeric dir={dirOf("tutar")} onClick={() => sortBy("tutar")}>
                          Tutar
                        </SortButton>
                      </TH>
                      <TH>
                        <SortButton dir={dirOf("tarih")} onClick={() => sortBy("tarih")}>
                          Sıradaki tarih
                        </SortButton>
                      </TH>
                      <TH>Tekrar</TH>
                      <TH numeric>
                        <span className="inline-flex items-center gap-1.5">
                          Haber
                          <InfoTip text="Son ödeme gününden kaç gün önce ilk e-posta gider. Son gün ve gecikince bir kez daha hatırlatılır." />
                        </span>
                      </TH>
                      <TH>Durum</TH>
                      <TH className="text-right">
                        <span className="sr-only">Eylemler</span>
                      </TH>
                    </tr>
                  </THead>
                  <tbody>
                    {rows.map((r) => {
                      const Icon = KIND_ICON[r.kind];
                      const left = daysBetween(today, r.dueDate);
                      return (
                        <TR key={r.id}>
                          <TD sticky>
                            <div className={cn("flex max-w-[18rem] items-center gap-3", !r.active && "opacity-60")}>
                              <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white", KIND_WELL[r.kind])} aria-hidden="true">
                                <Icon size={14} strokeWidth={2.25} />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium" title={r.title}>
                                  {r.title}
                                </p>
                                <p className="truncate text-xs text-ink-mute" title={r.note ?? undefined}>
                                  {KIND_LABEL[r.kind]}
                                  {r.note ? ` · ${r.note}` : ""}
                                </p>
                              </div>
                            </div>
                          </TD>
                          <TD numeric className={cn(!r.active && "opacity-60")}>
                            {r.amount !== null ? tl(r.amount) : <span className="text-ink-quiet">–</span>}
                          </TD>
                          <TD className={cn("whitespace-nowrap", !r.active && "opacity-60")}>
                            <span className="tabular">{dateTR(r.dueDate)}</span>
                            {r.active ? <span className={cn("block text-xs", left < 0 ? "text-bad" : "text-ink-mute")}>{daysLeftLabel(left)}</span> : null}
                          </TD>
                          <TD className={cn("whitespace-nowrap text-ink-mute", !r.active && "opacity-60")}>{REPEAT_LABEL[r.repeat]}</TD>
                          <TD numeric className={cn("text-ink-mute", !r.active && "opacity-60")}>
                            {r.remindDaysBefore} gün önce
                          </TD>
                          <TD>
                            <Switch checked={r.active} showText label={`${r.title} etkin`} onText="Etkin" offText="Kapalı" disabled={pending} onChange={(v) => onToggle(r, v)} />
                          </TD>
                          <TD>
                            <div className="flex justify-end gap-1.5">
                              <IconButton label={`${r.title} düzenle`} onClick={() => onEdit(r)}>
                                <Pencil size={15} />
                              </IconButton>
                              <IconButton label={`${r.title} sil`} tone="danger" onClick={() => onRemove(r)}>
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>

              <CardFooter>
                <span className="tabular">
                  {num(rows.length)} hatırlatıcı · tutarı girilenlerin toplamı <span className="font-semibold text-ink">{tl(total)}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 tabular">
                  Aylık ortalama yük <span className="font-semibold text-ink">{tl(monthly)}</span>
                  <InfoTip text="Etkin ve tekrar eden hatırlatıcıların bir aya düşen payı: haftalık × 52 ÷ 12, üç aylık ÷ 3, yıllık ÷ 12. Bir kezlik ödemeler sayılmaz." />
                </span>
              </CardFooter>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function NotificationsCard({
  email,
  settings,
  recipients,
  log,
  className,
}: {
  email: EmailStatus;
  settings: NotifySettings;
  recipients: Recipient[];
  log: LogRow[];
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState(settings.from ?? "");
  const [daysBefore, setDaysBefore] = useState(String(settings.invoiceDaysBefore));
  const [term, setTerm] = useState(String(settings.invoiceTermDays));
  const [removing, setRemoving] = useState<Recipient | null>(null);
  const addrRef = useRef<HTMLInputElement>(null);
  const settingsForm = useId();
  const [shownRecipients, patchRecipients] = useOptimistic(recipients, (state, p: { id: number; active?: boolean; remove?: boolean }) =>
    p.remove ? state.filter((r) => r.id !== p.id) : state.map((r) => (r.id === p.id ? { ...r, active: p.active ?? r.active } : r)),
  );

  const dirty = from !== (settings.from ?? "") || daysBefore !== String(settings.invoiceDaysBefore) || term !== String(settings.invoiceTermDays);
  const daysN = parseNumberTR(daysBefore);
  const termN = parseNumberTR(term);
  const daysError = daysN === null || daysN < 0 || daysN > 30 ? "0 ile 30 gün arasında olmalı" : null;
  const termError = termN === null || termN < 0 || termN > 120 ? "0 ile 120 gün arasında olmalı" : null;
  const addrInvalid = addr.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
  const activeRecipients = shownRecipients.filter((r) => r.active).length;
  const missing = [!email.configured && "RESEND_API_KEY", !email.cron && "CRON_SECRET"].filter(Boolean) as string[];

  const save = (patch: Partial<NotifySettings> = {}) =>
    start(async () => {
      const r = await saveNotificationSettings({
        emailEnabled: patch.emailEnabled ?? settings.emailEnabled,
        from: from.trim() || null,
        invoiceDaysBefore: Math.round(daysN ?? settings.invoiceDaysBefore),
        invoiceTermDays: Math.round(termN ?? settings.invoiceTermDays),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(patch.emailEnabled === undefined ? "Bildirim ayarları kaydedildi" : patch.emailEnabled ? "Hatırlatma e-postaları açıldı" : "Hatırlatma e-postaları kapatıldı");
    });

  return (
    <Card className={className}>
      <CardHeader
        icon={<Mail />}
        title="E-posta bildirimleri"
        description="Resend ile laffogato.net adresinden gider (sitedeki hesapla aynı)."
        actions={
          <Switch
            checked={settings.emailEnabled}
            showText
            onText="Açık"
            offText="Kapalı"
            label="Hatırlatma e-postaları"
            disabled={pending}
            className="pointer-coarse:h-10"
            onChange={(v) => save({ emailEnabled: v })}
          />
        }
      />
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={email.configured ? "green" : "red"} dot>
            {email.configured ? "Resend bağlı" : "Resend anahtarı yok"}
          </Badge>
          <Badge tone={email.cron ? "green" : "amber"} dot>
            {email.cron ? "Her sabah 08:00" : "Otomatik gönderim kapalı"}
          </Badge>
          <Badge tone="gray" className="max-w-full">
            <span className="min-w-0 truncate">{email.from}</span>
          </Badge>
        </div>

        {missing.length ? (
          <div role="note" className="flex gap-2.5 rounded-2xl bg-info-soft px-3.5 py-3 text-[13px] leading-5 text-ink-soft">
            <KeyRound size={16} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              {!email.configured ? (
                <p>
                  <span className="font-semibold text-ink">Resend anahtarı girilmedi.</span> <code className="rounded bg-surface px-1 font-mono text-xs">RESEND_API_KEY</code> Vercel
                  ortam değişkenlerine (yerelde <code className="rounded bg-surface px-1 font-mono text-xs">.env.local</code>) eklenince e-postalar gitmeye başlar; adresler ve
                  ayarlar şimdiden kaydedilebilir.
                </p>
              ) : null}
              {!email.cron ? (
                <p>
                  <code className="rounded bg-surface px-1 font-mono text-xs">CRON_SECRET</code> yok: sabah gönderimi kendiliğinden çalışmaz, elle gönderebilirsiniz.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-1.5">
          {shownRecipients.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-mute">Henüz bildirim adresi yok. Aşağıdan bir e-posta ekleyin; hatırlatmalar bu adreslere gider.</p>
          ) : (
            <ul>
              {shownRecipients.map((r, i) => (
                <li key={r.id} className={cn("flex items-center gap-3 px-2.5 py-2", i > 0 && "border-t border-ink/[0.06]")}>
                  <Avatar name={r.name || r.email} size="sm" />
                  <div className={cn("min-w-0 flex-1", !r.active && "opacity-60")}>
                    <p className="truncate text-sm font-medium text-ink" title={r.email}>
                      {r.name || r.email}
                    </p>
                    <p className="truncate text-xs text-ink-mute">{r.name ? r.email : r.active ? "Hatırlatma alır" : "Duraklatıldı"}</p>
                  </div>
                  <Switch
                    checked={r.active}
                    label={`${r.email} bildirim alsın`}
                    disabled={pending}
                    className="pointer-coarse:h-10"
                    onChange={(v) =>
                      start(async () => {
                        patchRecipients({ id: r.id, active: v });
                        const res = await setRecipientActive(r.id, v);
                        if (!res.ok) toast.error(res.error);
                      })
                    }
                  />
                  <IconButton label={`${r.email} adresini sil`} tone="danger" onClick={() => setRemoving(r)} className={TOUCH_ICON}>
                    <Trash2 size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (addrInvalid) return void toast.error("Geçerli bir e-posta girin");
            start(async () => {
              const r = await addRecipient(addr, name || null);
              if (!r.ok) return void toast.error(r.error);
              toast.success(`${addr.trim()} eklendi`);
              setAddr("");
              setName("");
              addrRef.current?.focus();
            });
          }}
        >
          <Input
            ref={addrRef}
            type="email"
            inputMode="email"
            required
            placeholder="ad@ornek.com"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            aria-label="Bildirim e-postası"
            aria-invalid={addrInvalid || undefined}
            className={cn("col-span-2 sm:col-span-1 lg:col-span-2", TOUCH_INPUT)}
          />
          <Input placeholder="Ad (isteğe bağlı)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Ad" className={TOUCH_INPUT} />
          <Button type="submit" disabled={pending || !addr.trim()} className={TOUCH_BTN}>
            <Plus size={16} /> Adres ekle
          </Button>
        </form>

        <details className="group rounded-2xl bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ink/30 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">Gönderim ayarları</span>
              <span className="block text-xs text-ink-mute sm:truncate">
                Faturadan {settings.invoiceDaysBefore} gün önce haber · vadesiz faturada {settings.invoiceTermDays} gün vade
              </span>
            </span>
            <ChevronDown size={16} className="shrink-0 text-ink-quiet transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <form
            id={settingsForm}
            className="px-4 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && !daysError && !termError) save();
            }}
          >
            <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <Field label="Gönderen" className="sm:col-span-2 lg:col-span-1" hint={`Boş bırakılırsa: ${email.defaultFrom}`}>
                <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={email.defaultFrom} className={TOUCH_INPUT} />
              </Field>
              <Field label="Fatura vadesinden kaç gün önce" tip="Ödenmemiş faturalar için ilk hatırlatma." error={daysError}>
                <div className="relative">
                  <NumberInput value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} aria-invalid={Boolean(daysError) || undefined} className={cn("pr-10", TOUCH_INPUT)} />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
                </div>
              </Field>
              <Field label="Vadesiz faturada vade" tip="Vade tarihi girilmemiş ödenmemiş faturalar, fatura tarihinden bu kadar gün sonra vadeli sayılır." error={termError}>
                <div className="relative">
                  <NumberInput value={term} onChange={(e) => setTerm(e.target.value)} aria-invalid={Boolean(termError) || undefined} className={cn("pr-10", TOUCH_INPUT)} />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
                </div>
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {dirty ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFrom(settings.from ?? "");
                    setDaysBefore(String(settings.invoiceDaysBefore));
                    setTerm(String(settings.invoiceTermDays));
                  }}
                  className={TOUCH_BTN}
                >
                  Geri al
                </Button>
              ) : null}
              <Button type="submit" size="sm" disabled={!dirty || pending || Boolean(daysError || termError)} className={TOUCH_BTN}>
                Kaydet
              </Button>
            </div>
          </form>
        </details>

        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              className={TOUCH_BTN}
              disabled={pending || !email.configured || activeRecipients === 0}
              onClick={() =>
                start(async () => {
                  const r = await sendTestNotification();
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Deneme e-postası ${r.data.recipients} adrese gönderildi`);
                })
              }
            >
              <Send size={14} /> Deneme gönder
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={TOUCH_BTN}
              disabled={pending || !email.configured}
              onClick={() =>
                start(async () => {
                  const r = await runDigestNow();
                  if (!r.ok) return void toast.error(r.error);
                  if (r.data.status === "sent") toast.success(`${r.data.count} hatırlatma ${r.data.recipients} adrese gönderildi`);
                  else if (r.data.status === "skipped") toast.message(r.data.reason);
                })
              }
            >
              <BellRing size={14} /> Bugünküleri şimdi gönder
            </Button>
          </div>
          {!email.configured ? (
            <p className="text-xs text-ink-mute">Gönderim düğmeleri Resend anahtarı girilince açılır.</p>
          ) : activeRecipients === 0 ? (
            <p className="text-xs text-ink-mute">Deneme için en az bir etkin adres ekleyin.</p>
          ) : null}
        </div>

        {log.length ? (
          <div>
            <p className="mb-1 px-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">Son gönderimler</p>
            <ul className="space-y-1.5">
              {dedupeLog(log).map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-[13px]">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", l.ok ? "bg-good" : "bg-bad")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="break-words text-ink">{l.ok ? l.subject : "Gönderilemedi"}</span>
                    <span className="block text-xs break-words text-ink-mute">
                      {dateTimeTR(l.sentAt)}
                      {l.ok && l.recipients ? ` · ${l.recipients}` : ""}
                      {!l.ok && l.error ? ` · ${l.error}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Adres silinsin mi?"
        description={removing ? `${removing.email} artık hatırlatma almayacak. Geçici olarak durdurmak için silmek yerine anahtarı kapatabilirsiniz.` : undefined}
        confirmLabel="Adresi sil"
        pending={pending}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          setRemoving(null);
          start(async () => {
            patchRecipients({ id: r.id, remove: true });
            const res = await deleteRecipient(r.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success(`${r.email} silindi`);
          });
        }}
      />
    </Card>
  );
}

/** Aynı iletinin satır başına kaydı tek satırda gösterilir */
function dedupeLog(log: LogRow[]): LogRow[] {
  const seen = new Set<string>();
  return log.filter((l) => {
    const k = `${l.subject}|${l.sentAt.slice(0, 16)}|${l.ok}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Başlıktan tür tahmini (yeni hatırlatıcıda tür elle seçilmediyse) */
function guessKind(title: string): ReminderKind | null {
  const t = fold(title);
  if (/(kdv|vergi|sgk|muhtasar|stopaj|beyan|bagkur|damga)/.test(t)) return "vergi";
  if (/(kira|aidat)/.test(t)) return "kira";
  if (/(maas|ucret|avans|bordro)/.test(t)) return "maas";
  if (/(fatura|elektrik|dogalgaz|internet|telefon)|(^|\s)su(\s|$)/.test(t)) return "fatura";
  return null;
}

function ReminderDialog({
  reminder,
  today,
  onClose,
  onDelete,
}: {
  reminder: Reminder | null;
  today: string;
  onClose: () => void;
  onDelete: (r: Reminder) => void;
}) {
  const formId = useId();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? "odeme");
  const [kindTouched, setKindTouched] = useState(Boolean(reminder));
  const [amount, setAmount] = useState(reminder?.amount !== null && reminder?.amount !== undefined ? num(reminder.amount, 2) : "");
  const [dueDate, setDueDate] = useState(reminder?.dueDate ?? today);
  const [repeat, setRepeat] = useState<ReminderRepeat>(reminder?.repeat ?? "monthly");
  const [before, setBefore] = useState(String(reminder?.remindDaysBefore ?? 3));
  const [note, setNote] = useState(reminder?.note ?? "");

  const amt = amount.trim() ? parseNumberTR(amount) : null;
  const amountError = amount.trim() && (amt === null || amt < 0) ? "Sayı girin, ör. 12.500 ya da 12500,50" : null;
  const beforeN = parseNumberTR(before);
  const beforeError = beforeN === null || !Number.isInteger(beforeN) || beforeN < 0 || beforeN > 60 ? "0 ile 60 arasında tam gün" : null;
  const invalid = !title.trim() || !dueDate || Boolean(amountError || beforeError);
  // E-postanın ne zaman gideceği (dueNotifications: önceden · son gün · gecikince)
  const notice = (() => {
    if (!dueDate || beforeError) return null;
    if (dueDate < today) return "Bu tarih geçmişte; ödeme gecikmiş görünür ve bir kez daha hatırlatılır.";
    if (dueDate === today) return "Son gün bugün; bir sonraki sabah gönderiminde listede olur.";
    if (!beforeN) return `E-posta son gün (${dateTR(dueDate)}) sabahı gider.`;
    const first = addDays(dueDate, -beforeN);
    return first > today
      ? `İlk e-posta ${dateTR(first)} sabahı, ikincisi son gün (${dateTR(dueDate)}) gider.`
      : `Hatırlatma aralığı başladı; ilk e-posta bir sonraki sabah gönderiminde gider, son gün ${dateTR(dueDate)}.`;
  })();

  const submit = () => {
    if (invalid) return;
    start(async () => {
      const r = await saveReminder({
        id: reminder?.id ?? null,
        title,
        kind,
        amount: amt,
        dueDate,
        repeat,
        remindDaysBefore: Math.round(beforeN ?? 3),
        note: note || null,
        active: reminder?.active ?? true,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(reminder ? `“${title.trim()}” güncellendi` : `“${title.trim()}” eklendi · ${dateTR(dueDate)}`);
      onClose();
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={reminder ? "Hatırlatıcıyı düzenle" : "Yeni hatırlatıcı"}
      description="Tarih sıradaki ödeme günüdür; tekrar edenler ödendi işaretlenince ilerler."
      footerStart={
        reminder ? (
          <Button variant="ghost" className={cn("text-bad hover:bg-bad-soft hover:text-bad", TOUCH_BTN)} onClick={() => onDelete(reminder)} disabled={pending}>
            <Trash2 size={15} /> Sil
          </Button>
        ) : null
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={TOUCH_BTN}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending || invalid} className={TOUCH_BTN}>
            {pending ? "Kaydediliyor…" : reminder ? "Kaydet" : "Ekle"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Başlık" className="sm:col-span-2" htmlFor={`${formId}-title`}>
          <Input
            id={`${formId}-title`}
            data-autofocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!kindTouched) setKind(guessKind(e.target.value) ?? "odeme");
            }}
            placeholder="Ör. Kira, KDV, internet"
            maxLength={120}
            required
            className={TOUCH_INPUT}
          />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[13px] font-medium text-ink-soft" id={`${formId}-kind`}>
            Tür
          </span>
          <div role="group" aria-labelledby={`${formId}-kind`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {REMINDER_KINDS.map((k) => {
              const Icon = KIND_ICON[k.value];
              const on = kind === k.value;
              return (
                <button
                  key={k.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setKind(k.value);
                    setKindTouched(true);
                  }}
                  className={cn(
                    "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-medium ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none",
                    on ? "bg-panel text-ink ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink",
                  )}
                >
                  <span className={cn("flex size-6 items-center justify-center rounded-[7px] text-white", KIND_WELL[k.value])} aria-hidden="true">
                    <Icon size={13} strokeWidth={2.25} />
                  </span>
                  <span className="text-center leading-4">{k.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Tutar" hint={amountError ? undefined : "Boş bırakılabilir"} error={amountError} htmlFor={`${formId}-amount`}>
          <div className="relative">
            <NumberInput id={`${formId}-amount`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" aria-invalid={Boolean(amountError) || undefined} className={cn("pr-8", TOUCH_INPUT)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-mute">₺</span>
          </div>
        </Field>
        <Field label="Son ödeme günü" htmlFor={`${formId}-due`}>
          <Input id={`${formId}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={TOUCH_INPUT} />
        </Field>
        <Field label="Tekrar" htmlFor={`${formId}-repeat`}>
          <Select id={`${formId}-repeat`} value={repeat} onChange={(e) => setRepeat(e.target.value as ReminderRepeat)} className={TOUCH_INPUT}>
            {REMINDER_REPEATS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kaç gün önce haber verilsin" tip="O gün e-posta gider; son gün ve gecikince bir kez daha hatırlatılır." error={beforeError} htmlFor={`${formId}-before`}>
          <div className="relative">
            <NumberInput id={`${formId}-before`} value={before} onChange={(e) => setBefore(e.target.value)} aria-invalid={Boolean(beforeError) || undefined} className={cn("pr-10", TOUCH_INPUT)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">gün</span>
          </div>
        </Field>
        <Field label="Not" className="sm:col-span-2" hint="İsteğe bağlı; e-postada başlığın altında görünür." htmlFor={`${formId}-note`}>
          <Textarea id={`${formId}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </Field>
        {notice ? (
          <p className="flex items-start gap-2 rounded-xl bg-panel px-3 py-2.5 text-[13px] leading-5 text-ink-soft sm:col-span-2" aria-live="polite">
            <BellRing size={15} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
            <span>
              {notice}
              {repeat !== "none" ? ` ${REPEAT_LABEL[repeat]} tekrar eder; ödendi işaretlenince sıradaki tarihe geçer.` : " Ödendi işaretlenince kapanır."}
            </span>
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

function PresetsDialog({ open, onClose, existing }: { open: boolean; onClose: () => void; existing: Set<string> }) {
  const [pending, start] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, string>>({});
  const add = (p: (typeof REMINDER_PRESETS)[number]) =>
    start(async () => {
      const raw = amounts[p.key] ?? "";
      const amount = raw.trim() ? parseNumberTR(raw) : null;
      if (raw.trim() && (amount === null || amount < 0)) return void toast.error("Tutar sayı olmalı, ör. 12.500");
      const r = await addPresetReminder(p.key, amount);
      if (!r.ok) return void toast.error(r.error);
      setAdded((a) => ({ ...a, [p.key]: r.data.dueDate }));
      toast.success(`${p.title} eklendi · ilk tarih ${dateTR(r.data.dueDate)}`);
    });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Vergi takvimi ve hazır şablonlar"
      description="Genel takvime göre ilk tarih otomatik bulunur. İşletmenize uyan tarihleri muhasebecinizle kontrol edin. Tutar isteğe bağlıdır."
      footer={
        <Button variant="secondary" onClick={onClose} className={TOUCH_BTN}>
          Tamam
        </Button>
      }
    >
      <ul className="space-y-2 outline-none" {...listFocus()}>
        {REMINDER_PRESETS.map((p) => {
          const Icon = KIND_ICON[p.kind];
          const exists = existing.has(fold(p.title));
          return (
            <li key={p.key} className="flex flex-col gap-3 rounded-2xl bg-panel p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white", KIND_WELL[p.kind])} aria-hidden="true">
                  <Icon size={15} strokeWidth={2.25} />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
                    {p.title}
                    {exists && !added[p.key] ? <Badge tone="gray">Listede var</Badge> : null}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {REPEAT_LABEL[p.repeat]} · {p.note}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:shrink-0">
                <div className="relative flex-1 sm:w-32 sm:flex-none">
                  <NumberInput
                    className={cn("pr-7", TOUCH_INPUT)}
                    placeholder="Tutar"
                    aria-label={`${p.title} tutarı (₺)`}
                    value={amounts[p.key] ?? ""}
                    disabled={Boolean(added[p.key])}
                    onChange={(e) => setAmounts((a) => ({ ...a, [p.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !added[p.key]) {
                        e.preventDefault();
                        add(p);
                      }
                    }}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-ink-mute">₺</span>
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {added[p.key] ? (
                    <motion.span key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="inline-flex min-w-[5.5rem] items-center gap-1 text-xs font-medium text-good">
                      <Check size={14} aria-hidden="true" /> {dateTR(added[p.key])}
                    </motion.span>
                  ) : (
                    <motion.span key="btn" initial={false}>
                      <Button size="sm" variant={exists ? "secondary" : "primary"} disabled={pending} onClick={() => add(p)} className={TOUCH_BTN}>
                        <Plus size={14} /> {exists ? "Yine ekle" : "Ekle"}
                      </Button>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function FixedDialog({ open, onClose, rows, today, existing }: { open: boolean; onClose: () => void; rows: FixedRow[]; today: string; existing: Set<string> }) {
  const [pending, start] = useTransition();
  const [days, setDays] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, string>>({});
  const [q, setQ] = useState("");
  const usable = useMemo(() => rows.filter((r) => r.period !== "gunluk"), [rows]);
  const shown = usable.filter((f) => matches(`${f.name} ${f.section}`, q));
  const close = () => {
    setQ("");
    onClose();
  };
  // Varsayılan: gelecek ayın 1'i
  const defaultFirst = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }, [today]);
  const periodLabel: Record<string, string> = { aylik: "aylık", haftalik: "haftalık", yillik: "yıllık", gunluk: "günlük" };
  const add = (f: FixedRow) =>
    start(async () => {
      const r = await addFixedExpenseReminder(f.id, days[f.id] ?? defaultFirst);
      if (!r.ok) return void toast.error(r.error);
      setAdded((a) => ({ ...a, [f.id]: r.data.dueDate }));
      toast.success(`${f.name} eklendi · ilk tarih ${dateTR(r.data.dueDate)}`);
    });
  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Sabit giderlerden hatırlatıcı"
      description="Her biri için ilk ödeme tarihini seçin; gider döneminde (her hafta / ay / yıl) o günden tekrar eder. Günlük giderler listelenmez."
      footer={
        usable.length ? (
          <Button variant="secondary" onClick={close} className={TOUCH_BTN}>
            Tamam
          </Button>
        ) : null
      }
    >
      {usable.length === 0 ? (
        <EmptyState
          title="Sabit gider yok"
          description="Önce Giderler & personel sayfasında kira, aidat, internet gibi sabit giderleri girin."
          action={
            <Link href="/panel/giderler" className="text-sm font-medium text-ink underline">
              Sabit giderlere git
            </Link>
          }
        />
      ) : (
        <div className="space-y-3 outline-none" {...listFocus()}>
          {usable.length > 6 ? (
            <div className="flex items-center gap-3">
              <SearchField value={q} onChange={setQ} placeholder="Sabit gider ara" shortcut={false} className="flex-1 sm:max-w-72" />
              <span className="text-[13px] whitespace-nowrap text-ink-mute tabular" aria-live="polite">
                {shown.length === usable.length ? `${usable.length} gider` : `${shown.length} / ${usable.length} gider`}
              </span>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-3 text-[13px] text-ink-mute">
              <span className="min-w-0 break-words">“{q.trim()}” için sabit gider yok.</span>
              <Button variant="secondary" size="sm" onClick={() => setQ("")} className={TOUCH_BTN}>
                Aramayı temizle
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((f) => {
                const exists = existing.has(fold(f.name));
                return (
                  <li key={f.id} className="flex flex-col gap-3 rounded-2xl bg-panel p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-ink">
                        <span className="min-w-0 break-words">{f.name}</span>
                        {exists && !added[f.id] ? <Badge tone="gray">Listede var</Badge> : null}
                      </p>
                      <p className="text-xs text-ink-mute tabular">
                        {tl(f.amount)} · {periodLabel[f.period] ?? f.period}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:shrink-0">
                      <label className="flex flex-1 items-center gap-2 text-xs text-ink-mute sm:flex-none">
                        <span className="shrink-0">İlk ödeme</span>
                        <Input
                          type="date"
                          className={cn("min-w-0 flex-1 sm:w-40 sm:flex-none", TOUCH_INPUT)}
                          value={days[f.id] ?? defaultFirst}
                          disabled={Boolean(added[f.id])}
                          onChange={(e) => setDays((d) => ({ ...d, [f.id]: e.target.value }))}
                          aria-label={`${f.name} ilk ödeme tarihi`}
                        />
                      </label>
                      {added[f.id] ? (
                        <span className="inline-flex min-w-[5.5rem] items-center gap-1 text-xs font-medium text-good">
                          <Check size={14} aria-hidden="true" /> Eklendi
                        </span>
                      ) : (
                        <Button size="sm" variant={exists ? "secondary" : "primary"} disabled={pending || !(days[f.id] ?? defaultFirst)} onClick={() => add(f)} className={TOUCH_BTN}>
                          <Plus size={14} /> {exists ? "Yine ekle" : "Ekle"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function DueDateDialog({ item, onClose }: { item: UpcomingItem; onClose: () => void }) {
  const formId = useId();
  const [pending, start] = useTransition();
  const [date, setDate] = useState(item.dueDate);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Fatura vadesi"
      description={`${item.title}${item.amount !== null ? ` · ${tl(item.amount)}` : ""}`}
      footerStart={
        <Button
          variant="ghost"
          disabled={pending}
          className={TOUCH_BTN}
          onClick={() =>
            start(async () => {
              const r = await setInvoiceDueDate(item.sourceId, null);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Vade kaldırıldı; tahmini vade kullanılacak");
              onClose();
            })
          }
        >
          Vadeyi kaldır
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className={TOUCH_BTN}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending || !date} className={TOUCH_BTN}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!date) return;
          start(async () => {
            const r = await setInvoiceDueDate(item.sourceId, date);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Vade ${dateTR(date)} olarak kaydedildi`);
            onClose();
          });
        }}
      >
        <Field label="Son ödeme günü" hint="Vadesi olmayan faturalarda vade, fatura tarihinden ayarlardaki gün kadar sonra sayılır.">
          <Input data-autofocus type="date" value={date} onChange={(e) => setDate(e.target.value)} className={TOUCH_INPUT} />
        </Field>
      </form>
    </Dialog>
  );
}
