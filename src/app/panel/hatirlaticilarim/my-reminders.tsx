"use client";

import { AlarmClock, Check, ChevronDown, Clock, MoreHorizontal, Pencil, Plus, Repeat, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { DeviceAlerts } from "@/components/panel/live/device-alerts";
import { refreshLive } from "@/components/panel/live/store";
import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Role } from "@/lib/constants";
import { dateTimeTR } from "@/lib/format";
import { addDays, todayTR } from "@/lib/reminders";
import { DUE_GROUPS, dueGroup, isTime, USER_REPEATS, userRepeatLabel, whenLabel, type UserRepeat } from "@/lib/user-reminders";
import { cn } from "@/lib/utils";
import { completeUserReminder, deleteUserReminder, postponeUserReminder, restoreUserReminder, saveUserReminder } from "@/server/actions/user-reminders";
import type { UserReminderDTO } from "@/server/data/user-reminders";

/**
 * Kişisel hatırlatıcılar: üstte hızlı ekleme (başlık + isteğe bağlı saat), altta gruplar (Gecikti, Bugün, Yarın, Bu
 * hafta, Daha sonra). Tamamlandı / ertele bildirimdeki "Geri al" ile geri alınır; tamamlanan tek seferlikler iki
 * hafta altta durur. Saatli hatırlatma panel açıkken saatinde çalar (uyarı motoru, src/components/panel/live).
 */
export function MyReminders({ role, open, done }: { role: Role; open: UserReminderDTO[]; done: UserReminderDTO[] }) {
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<UserReminderDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<UserReminderDTO | null>(null);
  const [pending, start] = useActionTransition();
  const [quick, setQuick] = useState("");
  const [quickTime, setQuickTime] = useState("");
  const [quickDay, setQuickDay] = useState<"today" | "tomorrow">("today");

  // Saati geçen hatırlatma "Gecikti"ye geçsin
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Sayfa verisini eylemin refresh()'i yeniler; uyarı motorunun verisi (saatli hatırlatmalar) burada tazelenir
  const after = () => refreshLive();

  function complete(r: UserReminderDTO) {
    start(async () => {
      const res = await completeUserReminder(r.id);
      if (!res.ok) return void toast.error(res.error);
      const prev = res.data.prev;
      toast.success(res.data.next ? `${r.title}: sıradaki ${res.data.nextLabel}` : `${r.title} tamamlandı`, {
        action: {
          label: "Geri al",
          onClick: () =>
            void tryAction(() => restoreUserReminder(r.id, prev)).then((x) => {
              if (x && !x.ok) toast.error(x.error);
              void after();
            }),
        },
      });
      await after();
    });
  }

  function postpone(r: UserReminderDTO, by: "hour" | "day") {
    start(async () => {
      const res = await postponeUserReminder(r.id, by);
      if (!res.ok) return void toast.error(res.error);
      const prev = res.data.prev;
      toast.success(`${r.title} ertelendi`, {
        description: whenLabel({ dueDate: res.data.dueDate, dueTime: res.data.dueTime }, new Date()),
        action: {
          label: "Geri al",
          onClick: () =>
            void tryAction(() => restoreUserReminder(r.id, prev)).then((x) => {
              if (x && !x.ok) toast.error(x.error);
              void after();
            }),
        },
      });
      await after();
    });
  }

  function reopen(r: UserReminderDTO) {
    start(async () => {
      const res = await restoreUserReminder(r.id, { dueDate: r.dueDate < todayTR() ? todayTR() : r.dueDate, dueTime: r.dueTime, active: true, doneAt: null });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${r.title} yeniden açıldı`);
      await after();
    });
  }

  function quickAdd(e: FormEvent) {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    start(async () => {
      const today = todayTR();
      const res = await saveUserReminder({ id: null, title, note: null, dueDate: quickDay === "today" ? today : addDays(today, 1), dueTime: quickTime || null, repeat: "none" });
      if (!res.ok) return void toast.error(res.error);
      setQuick("");
      setQuickTime("");
      toast.success("Hatırlatıcı eklendi", { description: `${title} · ${quickDay === "today" ? "Bugün" : "Yarın"}${quickTime ? ` ${quickTime}` : ""}` });
      await after();
    });
  }

  const groups = DUE_GROUPS.map((g) => ({ ...g, items: open.filter((r) => dueGroup(r, now) === g.key) })).filter((g) => g.items.length);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader
            icon={<AlarmClock />}
            title="Hatırlatıcılarım"
            description={open.length ? `${open.length} açık hatırlatıcı` : "Henüz hatırlatıcı yok"}
            actions={
              <Button onClick={() => setEditing("new")} className="max-lg:hidden">
                <Plus size={16} /> Yeni hatırlatıcı
              </Button>
            }
          />
          <form onSubmit={quickAdd} className="flex flex-wrap items-end gap-2 px-5 pb-4">
            <Field label="Hızlı ekle" htmlFor="hz-baslik" className="min-w-[12rem] flex-1">
              <Input id="hz-baslik" value={quick} onChange={(e) => setQuick(e.target.value)} maxLength={120} placeholder="ör. Süt siparişi ver" autoComplete="off" />
            </Field>
            <Segmented<"today" | "tomorrow">
              label="Gün"
              value={quickDay}
              onChange={setQuickDay}
              options={[
                { value: "today", label: "Bugün" },
                { value: "tomorrow", label: "Yarın" },
              ]}
            />
            <Field label="Saat" htmlFor="hz-saat" className="w-28">
              <Input id="hz-saat" type="time" value={quickTime} onChange={(e) => setQuickTime(e.target.value)} />
            </Field>
            <Button type="submit" disabled={pending || !quick.trim()}>
              <Plus size={15} /> Ekle
            </Button>
          </form>
          {groups.length ? (
            <div className="border-t border-line">
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label}>
                  <h3 className={cn("px-5 pt-4 pb-1 text-[13px] font-semibold", g.key === "overdue" ? "text-bad" : "text-ink-soft")}>
                    {g.label} <span className="font-normal text-ink-mute tabular">{g.items.length}</span>
                  </h3>
                  <ul className="divide-y divide-line">
                    {g.items.map((r) => (
                      <ReminderRow
                        key={r.id}
                        r={r}
                        now={now}
                        overdue={g.key === "overdue"}
                        pending={pending}
                        onComplete={() => complete(r)}
                        onPostpone={(by) => postpone(r, by)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => setDeleting(r)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<AlarmClock />}
              title="Açık hatırlatıcı yok"
              description="Yukarıdan hızlıca ekleyin ya da tekrar eden bir hatırlatıcı (her gün, her hafta, her ay) oluşturun."
              action={
                <Button variant="secondary" onClick={() => setEditing("new")}>
                  <Plus size={15} /> Yeni hatırlatıcı
                </Button>
              }
            />
          )}
          {done.length ? (
            <details className="group border-t border-line">
              <summary className="flex cursor-pointer items-center gap-1.5 px-5 py-3 text-[13px] font-medium text-ink-mute hover:text-ink">
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                Tamamlananlar (son 14 gün) <span className="tabular">{done.length}</span>
              </summary>
              <ul className="divide-y divide-line pb-2">
                {done.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Check size={16} className="shrink-0 text-good-ink" aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-words text-ink-mute line-through">{r.title}</span>
                    <span className="text-xs text-ink-mute tabular">{r.doneAt ? dateTimeTR(r.doneAt) : ""}</span>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => reopen(r)}>
                      <RotateCcw size={14} /> Geri al
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      </div>
      <div className="space-y-4">
        <DeviceAlerts role={role} />
      </div>
      <Fab onClick={() => setEditing("new")} aria-label="Yeni hatırlatıcı">
        <Plus size={20} aria-hidden="true" /> Yeni
      </Fab>
      {editing ? (
        <ReminderDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await after();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const r = deleting;
          setDeleting(null);
          if (!r) return;
          start(async () => {
            const res = await deleteUserReminder(r.id);
            if (!res.ok) return void toast.error(res.error);
            toast.success(`${r.title} silindi`);
            await after();
          });
        }}
        title={deleting ? `“${deleting.title}” silinsin mi?` : ""}
        description="Hatırlatıcı kalıcı olarak silinir. Yalnızca bu seferlik bittiyse “Tamamlandı” deyin."
      />
    </div>
  );
}

function ReminderRow({
  r,
  now,
  overdue,
  pending,
  onComplete,
  onPostpone,
  onEdit,
  onDelete,
}: {
  r: UserReminderDTO;
  now: Date;
  overdue: boolean;
  pending: boolean;
  onComplete: () => void;
  onPostpone: (by: "hour" | "day") => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const repeat = userRepeatLabel(r);
  // Menü dışına dokununca ya da Esc ile kapanır
  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <button
        type="button"
        onClick={onComplete}
        disabled={pending}
        aria-label={`${r.title} tamamlandı`}
        title="Tamamlandı"
        className="mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full ring-2 ring-line-strong ring-inset transition-colors hover:bg-lime/30 hover:ring-good disabled:opacity-50 pointer-coarse:size-8"
      >
        <Check size={14} className="text-good-ink opacity-0 transition-opacity hover:opacity-100" aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words text-ink">{r.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <span className={cn("inline-flex items-center gap-1 tabular", overdue ? "font-medium text-bad" : "text-ink-mute")}>
            <Clock size={13} aria-hidden="true" /> {whenLabel(r, now)}
          </span>
          {repeat ? (
            <Badge tone="gray">
              <Repeat size={11} aria-hidden="true" /> {repeat}
            </Badge>
          ) : null}
        </p>
        {r.note ? <p className="mt-1 text-[13px] break-words whitespace-pre-line text-ink-mute">{r.note}</p> : null}
      </div>
      <div ref={menuRef} className="relative flex shrink-0 items-center gap-1.5">
        <IconButton label={`${r.title} için ertele ve diğer işlemler`} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <MoreHorizontal size={15} />
        </IconButton>
        {menu ? (
          <div
            role="menu"
            className="absolute top-[calc(100%+0.25rem)] right-0 z-20 w-48 overflow-hidden rounded-2xl bg-surface p-1 shadow-[0_12px_40px_rgba(0,0,0,0.14)] ring-1 ring-line"
          >
            {[
              ...(isTime(r.dueTime) ? [{ label: "1 saat ertele", icon: Clock, run: () => onPostpone("hour") }] : []),
              { label: "Yarına ertele", icon: AlarmClock, run: () => onPostpone("day") },
              { label: "Düzenle", icon: Pencil, run: onEdit },
              { label: "Sil", icon: Trash2, run: onDelete, danger: true },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  item.run();
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-panel pointer-coarse:min-h-11",
                  "danger" in item && item.danger ? "text-bad" : "text-ink",
                )}
              >
                <item.icon size={15} aria-hidden="true" /> {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ReminderDialog({ initial, onClose, onSaved }: { initial: UserReminderDTO | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.dueDate ?? todayTR());
  const [withTime, setWithTime] = useState(Boolean(initial?.dueTime));
  const [time, setTime] = useState(initial?.dueTime ?? "09:00");
  const [repeat, setRepeat] = useState<UserRepeat>(initial?.repeat ?? "none");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Ne hatırlatılacağını yazın");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("Tarih seçin");
    setBusy(true);
    const res = await tryAction(() => saveUserReminder({ id: initial?.id ?? null, title, note: note || null, dueDate: date, dueTime: withTime ? time : null, repeat }));
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, pencere ve yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return setError(res.error);
    toast.success(initial ? "Hatırlatıcı güncellendi" : "Hatırlatıcı eklendi");
    await onSaved();
  }

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={initial ? "Hatırlatıcıyı düzenle" : "Yeni hatırlatıcı"}
      description="Yalnızca siz görürsünüz."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="max-sm:h-11">
            Vazgeç
          </Button>
          <Button type="submit" form="hatirlatici-form" disabled={busy} className="max-sm:h-11 max-sm:flex-1">
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="hatirlatici-form" onSubmit={submit} noValidate className="space-y-4 pb-2">
        <Field label="Ne hatırlatılsın?" htmlFor="ht-baslik" error={error ?? undefined}>
          <Input
            id="ht-baslik"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError(null);
            }}
            maxLength={120}
            placeholder="ör. Kahve makinesini temizle"
            aria-invalid={error ? true : undefined}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tarih" htmlFor="ht-tarih">
            <Input id="ht-tarih" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Saat" htmlFor="ht-saat" hint={withTime ? "Panel açıkken bu saatte sesli uyarır." : "Saat vermezseniz gün boyu listede durur."}>
            <div className="flex items-center gap-2">
              <Input id="ht-saat" type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!withTime} className="flex-1" />
              <Button variant={withTime ? "ghost" : "secondary"} size="sm" onClick={() => setWithTime((v) => !v)}>
                {withTime ? "Saatsiz" : "Saat ekle"}
              </Button>
            </div>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Tekrar</legend>
          <Segmented<UserRepeat> label="Tekrar" value={repeat} onChange={setRepeat} options={USER_REPEATS.map((r) => ({ value: r.value, label: r.label }))} />
        </fieldset>
        <Field label="Not (isteğe bağlı)" htmlFor="ht-not">
          <Textarea id="ht-not" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}
