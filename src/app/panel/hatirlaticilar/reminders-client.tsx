"use client";

import {
  AlarmClock,
  BellRing,
  CalendarClock,
  Check,
  FileText,
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
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT } from "@/components/akmanos/lib/motion-ease";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTimeTR, dateTR, num, tl } from "@/lib/format";
import {
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

type Filter = "all" | "reminder" | "invoice";

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
  email: { configured: boolean; cron: boolean; from: string; defaultFrom: string };
  settings: NotifySettings;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Reminder | "new" | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [fixedOpen, setFixedOpen] = useState(false);
  const [dueFor, setDueFor] = useState<UpcomingItem | null>(null);
  const [removing, setRemoving] = useState<Reminder | null>(null);
  const [pending, start] = useTransition();

  const shown = items.filter((i) => filter === "all" || i.source === filter);
  const sum = (list: UpcomingItem[]) => list.reduce((a, i) => a + (i.amount ?? 0), 0);
  const overdue = items.filter((i) => i.status === "overdue");
  const todayItems = items.filter((i) => i.status === "today");
  const week = items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 7);
  const month = items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 30);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "İşlem tamamlanamadı");
      else if (success) toast.success(success);
    });

  const markPaid = (item: UpcomingItem) =>
    start(async () => {
      if (item.source === "invoice") {
        const r = await setInvoicePaid(item.sourceId, true);
        if (!r.ok) return void toast.error(r.error);
        toast.success(`${item.title} ödendi olarak işaretlendi`);
      } else {
        const r = await markReminderDone(item.sourceId, item.projected ? item.dueDate : undefined);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.data.next ? `Ödendi · sıradaki ${dateTR(r.data.next)}` : "Ödendi, hatırlatıcı kapandı");
      }
    });

  return (
    <>
      <PageHeader
        eyebrow="Satış & gider"
        title="Ödemeler & hatırlatıcılar"
        description="Yaklaşan kira, vergi, maaş ve fatura ödemeleri. Zamanı gelenler her sabah bildirim adreslerine e-postayla gider."
        actions={
          <>
            <Button variant="secondary" onClick={() => setFixedOpen(true)}>
              <Repeat size={16} /> Sabit giderlerden
            </Button>
            <Button variant="secondary" onClick={() => setPresetsOpen(true)}>
              <Landmark size={16} /> Vergi takvimi
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> Yeni hatırlatıcı
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat icon={<BellRing />} label="Gecikmiş" value={num(overdue.length)} tone={overdue.length ? "bad" : "default"} sub={overdue.length ? tl(sum(overdue)) : "Geciken ödeme yok"} />
        <Stat icon={<CalendarClock />} label="Bugün" value={num(todayItems.length)} tone={todayItems.length ? "warn" : "default"} sub={todayItems.length ? tl(sum(todayItems)) : "Bugün son günü olan yok"} />
        <Stat icon={<AlarmClock />} label="7 gün içinde" value={num(week.length)} sub={tl(sum(week))} />
        <Stat icon={<Wallet />} label="30 gün toplamı" value={tl(sum(month))} sub={`${num(month.length)} ödeme`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader
            icon={<CalendarClock />}
            title="Yaklaşan ödemeler"
            description="Önümüzdeki 45 gün ve gecikenler. Ödediğinizi işaretleyin; tekrar eden hatırlatıcı bir sonraki döneme geçer."
            actions={
              <Segmented<Filter>
                label="Kaynak"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "Tümü", count: items.length },
                  { value: "reminder", label: "Hatırlatıcı", count: items.filter((i) => i.source === "reminder").length },
                  { value: "invoice", label: "Fatura", count: items.filter((i) => i.source === "invoice").length },
                ]}
              />
            }
          />
          <CardContent>
            {shown.length === 0 ? (
              <EmptyState
                title="Yaklaşan ödeme yok"
                description="Kira, vergi ya da maaş için hatırlatıcı ekleyin. Ödenmemiş faturalar burada kendiliğinden görünür."
                action={
                  <Button onClick={() => setEditing("new")}>
                    <Plus size={16} /> Yeni hatırlatıcı
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {GROUPS.map((g) => {
                  const list = shown.filter((i) => i.status === g.key);
                  if (!list.length) return null;
                  return (
                    <section key={g.key}>
                      <p className="mb-1 flex items-center justify-between px-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">
                        <span>{g.label}</span>
                        <span className="tabular">{tl(sum(list))}</span>
                      </p>
                      <ul className="rounded-2xl bg-surface p-1.5">
                        {list.map((item, i) => (
                          <UpcomingRow
                            key={item.ref}
                            item={item}
                            index={i}
                            last={i === list.length - 1}
                            pending={pending}
                            onPaid={() => markPaid(item)}
                            onDue={item.source === "invoice" ? () => setDueFor(item) : undefined}
                            onEdit={item.source === "reminder" ? () => setEditing(reminders.find((r) => r.id === item.sourceId) ?? null) : undefined}
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

      <Card className="mt-4">
        <CardHeader
          icon={<Repeat />}
          title="Tüm hatırlatıcılar"
          meta={
            <>
              <span>Etkin</span>
              <span className="text-ink-quiet">·</span>
              <span className="font-semibold text-ink tabular">{reminders.filter((r) => r.active).length}</span>
            </>
          }
          actions={
            <Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
              <Plus size={14} /> Ekle
            </Button>
          }
        />
        {reminders.length === 0 ? (
          <CardContent>
            <EmptyState title="Henüz hatırlatıcı yok" description="Vergi takviminden ya da sabit giderlerden tek tıkla ekleyebilirsiniz." />
          </CardContent>
        ) : (
          <TableWrap>
            <Table className="min-w-[760px]">
              <THead>
                <tr>
                  <TH>Hatırlatıcı</TH>
                  <TH>Tür</TH>
                  <TH numeric>Tutar</TH>
                  <TH>Sıradaki tarih</TH>
                  <TH>Tekrar</TH>
                  <TH numeric>Kaç gün önce</TH>
                  <TH>Durum</TH>
                  <TH className="text-right">Eylemler</TH>
                </tr>
              </THead>
              <tbody>
                {reminders.map((r) => {
                  const Icon = KIND_ICON[r.kind];
                  return (
                    <TR key={r.id} className={cn(!r.active && "opacity-60")}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <span className={cn("flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-white", KIND_WELL[r.kind])} aria-hidden="true">
                            <Icon size={14} strokeWidth={2.25} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.title}</p>
                            {r.note ? <p className="truncate text-xs text-ink-mute">{r.note}</p> : null}
                          </div>
                        </div>
                      </TD>
                      <TD>
                        <Badge tone="gray">{KIND_LABEL[r.kind]}</Badge>
                      </TD>
                      <TD numeric>{r.amount !== null ? tl(r.amount) : "–"}</TD>
                      <TD className="whitespace-nowrap tabular">{dateTR(r.dueDate)}</TD>
                      <TD className="whitespace-nowrap text-ink-mute">{REPEAT_LABEL[r.repeat]}</TD>
                      <TD numeric>{r.remindDaysBefore}</TD>
                      <TD>
                        <Switch
                          checked={r.active}
                          showText
                          label={`${r.title} etkin`}
                          onText="Etkin"
                          offText="Kapalı"
                          disabled={pending}
                          onChange={(v) => run(() => setReminderActive(r.id, v))}
                        />
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          <IconButton label="Düzenle" onClick={() => setEditing(r)}>
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton label="Sil" tone="danger" onClick={() => setRemoving(r)}>
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
        )}
      </Card>

      {editing ? <ReminderDialog key={editing === "new" ? "new" : editing.id} reminder={editing === "new" ? null : editing} today={today} onClose={() => setEditing(null)} /> : null}
      <PresetsDialog open={presetsOpen} onClose={() => setPresetsOpen(false)} />
      <FixedDialog open={fixedOpen} onClose={() => setFixedOpen(false)} rows={fixedExpenses} today={today} />
      {dueFor ? <DueDateDialog key={dueFor.ref} item={dueFor} onClose={() => setDueFor(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Hatırlatıcı silinsin mi?"
        description={removing ? `“${removing.title}” silinecek. Geçmiş bildirim kayıtları kalır.` : undefined}
        pending={pending}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          start(async () => {
            const res = await deleteReminder(r.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success("Hatırlatıcı silindi");
            setRemoving(null);
          });
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
      <div className="flex items-start gap-3 rounded-[14px] px-3 py-3">
        <span className={cn("mt-0.5 flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]", KIND_WELL[item.kind])} aria-hidden="true">
          <Icon size={15} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{item.title}</p>
            <span className="shrink-0 text-[15px] font-semibold text-ink tabular">{item.amount !== null ? tl(item.amount) : "–"}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
            <Badge tone={STATUS_TONE[item.status]} dot>
              {daysLeftLabel(item.daysLeft)}
            </Badge>
            <span className="tabular">{dateTR(item.dueDate)}</span>
            {item.repeat !== "none" ? <span>· {REPEAT_LABEL[item.repeat]}</span> : null}
            {item.detail ? <span className="min-w-0 truncate">· {item.detail}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onEdit ? (
            <IconButton label="Düzenle" onClick={onEdit}>
              <Pencil size={15} />
            </IconButton>
          ) : null}
          {onDue ? (
            <IconButton label="Vade tarihi" onClick={onDue}>
              <CalendarClock size={15} />
            </IconButton>
          ) : null}
          <Button size="sm" variant="secondary" disabled={pending} onClick={onPaid}>
            <Check size={14} /> Ödendi
          </Button>
        </div>
      </div>
      {!last ? <div aria-hidden="true" className="pointer-events-none absolute right-3 bottom-0 left-[58px] h-px bg-ink/[0.08]" /> : null}
    </motion.li>
  );
}

function NotificationsCard({
  email,
  settings,
  recipients,
  log,
  className,
}: {
  email: { configured: boolean; cron: boolean; from: string; defaultFrom: string };
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
  const dirty = from !== (settings.from ?? "") || daysBefore !== String(settings.invoiceDaysBefore) || term !== String(settings.invoiceTermDays);

  const save = (patch: Partial<NotifySettings> = {}) =>
    start(async () => {
      const r = await saveNotificationSettings({
        emailEnabled: patch.emailEnabled ?? settings.emailEnabled,
        from: from.trim() || null,
        invoiceDaysBefore: Math.round(parseNumberTR(daysBefore) ?? settings.invoiceDaysBefore),
        invoiceTermDays: Math.round(parseNumberTR(term) ?? settings.invoiceTermDays),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Bildirim ayarları kaydedildi");
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
            onChange={(v) => save({ emailEnabled: v })}
          />
        }
      />
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={email.configured ? "green" : "red"} dot>
            {email.configured ? "Resend bağlı" : "RESEND_API_KEY yok"}
          </Badge>
          <Badge tone={email.cron ? "green" : "amber"} dot>
            {email.cron ? "Her sabah 08:00" : "CRON_SECRET yok"}
          </Badge>
          <Badge tone="gray">{email.from}</Badge>
        </div>

        <div className="rounded-2xl bg-surface p-1.5">
          {recipients.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-mute">Henüz bildirim adresi yok. Hatırlatmalar bu adreslere gider.</p>
          ) : (
            <ul>
              {recipients.map((r, i) => (
                <li key={r.id} className={cn("flex items-center gap-3 px-2.5 py-2", i > 0 && "border-t border-ink/[0.06]")}>
                  <Avatar name={r.name || r.email} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.name || r.email}</p>
                    {r.name ? <p className="truncate text-xs text-ink-mute">{r.email}</p> : null}
                  </div>
                  <Switch checked={r.active} label={`${r.email} bildirim alsın`} disabled={pending} onChange={(v) => start(async () => {
                    const res = await setRecipientActive(r.id, v);
                    if (!res.ok) toast.error(res.error);
                  })} />
                  <IconButton label="Adresi sil" tone="danger" onClick={() => setRemoving(r)}>
                    <Trash2 size={15} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addRecipient(addr, name || null);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Bildirim adresi eklendi");
              setAddr("");
              setName("");
            });
          }}
        >
          <Input type="email" required placeholder="ad@ornek.com" value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="Bildirim e-postası" />
          <Input placeholder="Ad (isteğe bağlı)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Ad" />
          <Button type="submit" disabled={pending || !addr}>
            <Plus size={16} /> Ekle
          </Button>
        </form>

        <details className="group rounded-2xl bg-surface px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-ink marker:hidden">Gönderim ayarları</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Gönderen" className="sm:col-span-2" hint={`Boş bırakılırsa: ${email.defaultFrom}`}>
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder={email.defaultFrom} />
            </Field>
            <Field label="Fatura vadesinden kaç gün önce" tip="Ödenmemiş faturalar için ilk hatırlatma.">
              <NumberInput value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} />
            </Field>
            <Field label="Vadesiz faturada vade (gün)" tip="Vade tarihi girilmemiş ödenmemiş faturalar, fatura tarihinden bu kadar gün sonra vadeli sayılır.">
              <NumberInput value={term} onChange={(e) => setTerm(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={!dirty || pending} onClick={() => save()}>
              Kaydet
            </Button>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || !recipients.some((r) => r.active)}
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
            disabled={pending}
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

        {log.length ? (
          <div>
            <p className="mb-1 px-1 text-[0.65rem] font-medium tracking-wide text-ink-mute uppercase">Son gönderimler</p>
            <ul className="space-y-1.5">
              {dedupeLog(log).map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-[13px]">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", l.ok ? "bg-good" : "bg-bad")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="text-ink">{l.ok ? l.subject : "Gönderilemedi"}</span>
                    <span className="block text-xs text-ink-mute">
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
        description={removing ? `${removing.email} artık hatırlatma almayacak.` : undefined}
        pending={pending}
        onConfirm={() => {
          const r = removing;
          if (!r) return;
          start(async () => {
            const res = await deleteRecipient(r.id);
            if (!res.ok) return void toast.error(res.error);
            setRemoving(null);
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

function ReminderDialog({ reminder, today, onClose }: { reminder: Reminder | null; today: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(reminder?.title ?? "");
  const [kind, setKind] = useState<ReminderKind>(reminder?.kind ?? "odeme");
  const [amount, setAmount] = useState(reminder?.amount !== null && reminder?.amount !== undefined ? String(reminder.amount).replace(".", ",") : "");
  const [dueDate, setDueDate] = useState(reminder?.dueDate ?? today);
  const [repeat, setRepeat] = useState<ReminderRepeat>(reminder?.repeat ?? "monthly");
  const [before, setBefore] = useState(String(reminder?.remindDaysBefore ?? 3));
  const [note, setNote] = useState(reminder?.note ?? "");

  const submit = () =>
    start(async () => {
      const amt = amount.trim() ? parseNumberTR(amount) : null;
      if (amount.trim() && amt === null) return void toast.error("Tutar sayı olmalı");
      const r = await saveReminder({
        id: reminder?.id ?? null,
        title,
        kind,
        amount: amt,
        dueDate,
        repeat,
        remindDaysBefore: Math.round(parseNumberTR(before) ?? 3),
        note: note || null,
        active: reminder?.active ?? true,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(reminder ? "Hatırlatıcı güncellendi" : "Hatırlatıcı eklendi");
      onClose();
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={reminder ? "Hatırlatıcıyı düzenle" : "Yeni hatırlatıcı"}
      description="Tarih sıradaki ödeme günüdür; tekrar edenler ödendi işaretlenince ilerler."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={pending || !title.trim()}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Başlık" className="sm:col-span-2">
          <Input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ör. Kira, KDV, internet" required />
        </Field>
        <Field label="Tür">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ReminderKind)}>
            {REMINDER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tutar (₺)" hint="Boş bırakılabilir">
          <NumberInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Son ödeme günü">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
        <Field label="Tekrar">
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}>
            {REMINDER_REPEATS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kaç gün önce haber verilsin" tip="O gün e-posta gider; son gün ve gecikince bir kez daha hatırlatılır.">
          <NumberInput value={before} onChange={(e) => setBefore(e.target.value)} />
        </Field>
        <Field label="Not" className="sm:col-span-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function PresetsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, string>>({});
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Vergi takvimi ve hazır şablonlar" description="Genel takvime göre ilk tarih otomatik bulunur. İşletmenize uyan tarihleri muhasebecinizle kontrol edin.">
      <ul className="space-y-2">
        {REMINDER_PRESETS.map((p) => {
          const Icon = KIND_ICON[p.kind];
          return (
            <li key={p.key} className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel p-3">
              <span className={cn("flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-white", KIND_WELL[p.kind])} aria-hidden="true">
                <Icon size={15} strokeWidth={2.25} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{p.title}</p>
                <p className="text-xs text-ink-mute">
                  {REPEAT_LABEL[p.repeat]} · {p.note}
                </p>
              </div>
              <NumberInput
                className="w-28"
                placeholder="Tutar"
                aria-label={`${p.title} tutarı`}
                value={amounts[p.key] ?? ""}
                onChange={(e) => setAmounts((a) => ({ ...a, [p.key]: e.target.value }))}
              />
              <AnimatePresence mode="wait" initial={false}>
                {added[p.key] ? (
                  <motion.span key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-xs font-medium text-good">
                    Eklendi · {dateTR(added[p.key])}
                  </motion.span>
                ) : (
                  <motion.span key="btn" initial={false}>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await addPresetReminder(p.key, parseNumberTR(amounts[p.key] ?? "") ?? null);
                          if (!r.ok) return void toast.error(r.error);
                          setAdded((a) => ({ ...a, [p.key]: r.data.dueDate }));
                        })
                      }
                    >
                      <Plus size={14} /> Ekle
                    </Button>
                  </motion.span>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function FixedDialog({ open, onClose, rows, today }: { open: boolean; onClose: () => void; rows: FixedRow[]; today: string }) {
  const [pending, start] = useTransition();
  const [days, setDays] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, string>>({});
  const usable = useMemo(() => rows.filter((r) => r.period !== "gunluk"), [rows]);
  // Varsayılan: gelecek ayın 1'i
  const defaultFirst = useMemo(() => {
    const [y, m] = today.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }, [today]);
  const periodLabel: Record<string, string> = { aylik: "aylık", haftalik: "haftalık", yillik: "yıllık", gunluk: "günlük" };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Sabit giderlerden hatırlatıcı"
      description="Her biri için ilk ödeme tarihini seçin; gider döneminde (her hafta / ay / yıl) o günden tekrar eder."
    >
      {usable.length === 0 ? (
        <EmptyState
          title="Sabit gider yok"
          description="Önce Giderler & personel sayfasında sabit giderleri girin."
          action={
            <Link href="/panel/giderler" className="text-sm font-medium text-ink underline">
              Sabit giderlere git
            </Link>
          }
        />
      ) : (
        <ul className="space-y-2">
          {usable.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-panel p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{f.name}</p>
                <p className="text-xs text-ink-mute">
                  {tl(f.amount)} · {periodLabel[f.period] ?? f.period}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-mute">
                İlk ödeme
                <Input
                  type="date"
                  className="w-40"
                  value={days[f.id] ?? defaultFirst}
                  onChange={(e) => setDays((d) => ({ ...d, [f.id]: e.target.value }))}
                  aria-label={`${f.name} ilk ödeme tarihi`}
                />
              </label>
              {added[f.id] ? (
                <span className="text-xs font-medium text-good">Eklendi · {dateTR(added[f.id])}</span>
              ) : (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await addFixedExpenseReminder(f.id, days[f.id] ?? defaultFirst);
                      if (!r.ok) return void toast.error(r.error);
                      setAdded((a) => ({ ...a, [f.id]: r.data.dueDate }));
                    })
                  }
                >
                  <Plus size={14} /> Ekle
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function DueDateDialog({ item, onClose }: { item: UpcomingItem; onClose: () => void }) {
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
          onClick={() =>
            start(async () => {
              const r = await setInvoiceDueDate(item.sourceId, null);
              if (!r.ok) return void toast.error(r.error);
              onClose();
            })
          }
        >
          Vadeyi kaldır
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={pending || !date}
            onClick={() =>
              start(async () => {
                const r = await setInvoiceDueDate(item.sourceId, date);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Vade kaydedildi");
                onClose();
              })
            }
          >
            Kaydet
          </Button>
        </>
      }
    >
      <Field label="Son ödeme günü">
        <Input data-autofocus type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Dialog>
  );
}
