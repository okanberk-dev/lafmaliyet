"use client";

import { BellRing, Check, Clock, Repeat, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LiveResponse } from "@/lib/live";
import {
  dueInstant,
  pendingReminders,
  postponeTarget,
  reminderAlarm,
  reminderAlertKey,
  ringingReminders,
  sinceLabel,
  userRepeatLabel,
  whenLabel,
} from "@/lib/user-reminders";
import { completeUserReminder, postponeUserReminder, restoreUserReminder } from "@/server/actions/user-reminders";

import { stopAlarm, useAlarmOwners } from "./sounds";
import { liveNow, patchLive, refreshLive, useLive } from "./store";

/**
 * Saatli kişisel hatırlatmanın ekrandaki yüzü (docs/HATIRLATICILAR.md, "Açılır pencere ve köşe kartı"):
 *
 * - **Açılır pencere:** saati gelince (uyarı motoru, alert-center.tsx › showReminder) ekranın ortasında: başlık, not,
 *   kim kurdu, saat; "Yaptım" (tamamlar: tekrar eden ilerler, tek seferlik kapanır), "1 saat sonra hatırlat" (erteler)
 *   ve sürekli seste "Sesi kes". Kapatmak (✕, Esc) pencereyi köşeye küçültür, sesi kesmez.
 * - **Köşe kartı:** saati gelmiş, yapılmamış her saatli hatırlatma "Yaptım" denene (ya da ertelenene) kadar sağ altta
 *   (telefonda alt menünün üstünde) durur; kapatılamaz, ara ara sallanır (hareket azaltılmışsa durur). Liste sunucunun
 *   verisinden türer (src/lib/user-reminders.ts › pendingReminders): başka ekrana geçince ve sayfa yenilenince yerinde.
 *
 * Kart açıkken telefonda yüzen düğmeler ve kaydetme çubuğu kartın üstüne çıkar (globals.css, [data-reminder-dock]).
 */

type LiveReminder = LiveResponse["reminders"][number];

// ─── Açılır pencerenin sırası (sekme başına; aynı anda gelenler sırayla) ─────────────────────────────────────

type Popup = { id: number; key: string };
type PopupState = { queue: readonly Popup[]; shownAt: number };

let popups: PopupState = { queue: [], shownAt: 0 };
const SERVER_POPUPS: PopupState = popups;
const popupListeners = new Set<() => void>();

function setPopups(next: PopupState) {
  popups = next;
  for (const fn of popupListeners) fn();
}

function subscribePopups(fn: () => void) {
  popupListeners.add(fn);
  return () => {
    popupListeners.delete(fn);
  };
}

/**
 * Hatırlatmayı ekranın ortasında aç. Uyarı motoru saatinde (ya da bu cihazda hiç açılmamış, yeni kaçanı) çağırır;
 * köşe kartındaki başlığa dokunmak `front` ile öne alır. Pencere o dönemi (tarih + saat) gösterir: başka cihazda
 * tamamlanır ya da ertelenirse kendiliğinden kalkar.
 */
export function showReminder(r: LiveReminder, opts: { front?: boolean } = {}) {
  const item: Popup = { id: r.id, key: reminderAlertKey(r) };
  const rest = popups.queue.filter((p) => p.id !== r.id);
  const queued = popups.queue.some((p) => p.id === r.id && p.key === item.key);
  const queue = opts.front ? [item, ...rest] : queued ? popups.queue : [...rest, item];
  // Saat (useClock) yarım dakikada bir ilerler: az önce açılan hatırlatma kapatılınca köşede hemen görünsün
  setPopups({ queue, shownAt: Math.max(popups.shownAt, liveNow(), dueInstant(r) ?? 0) });
}

function dropPopup(id: number) {
  if (!popups.queue.some((p) => p.id === id)) return;
  setPopups({ ...popups, queue: popups.queue.filter((p) => p.id !== id) });
}

const NO_REMINDERS: LiveReminder[] = [];

export function ReminderAlerts({ enabled, now, onChanged }: { enabled: boolean; now: number; onChanged: () => void }) {
  const live = useLive();
  const state = useSyncExternalStore(subscribePopups, () => popups, () => SERVER_POPUPS);
  const owners = useAlarmOwners();
  const [busy, setBusy] = useState<number | null>(null);
  const list = live.data?.reminders ?? NO_REMINDERS;
  const at = now ? Math.max(now, state.shownAt) : 0;
  const pending = enabled && at ? pendingReminders(list, at) : NO_REMINDERS;
  const ringing = new Set(ringingReminders(owners));
  // Sıradaki pencereler: kayıt hâlâ açık ve aynı dönemde (başka cihazda tamamlandıysa ya da ertelendiyse atlanır)
  const queued = enabled ? state.queue.flatMap((p) => list.filter((r) => r.id === p.id && r.active && reminderAlertKey(r) === p.key)) : NO_REMINDERS;
  const popup = queued[0] ?? null;
  const waitingAfter = Math.max(0, queued.length - 1);

  // Sürekli çalan hatırlatma başka cihazda tamamlandı ya da ertelendi (canlı veri yenilendi) ya da bu cihazda
  // hatırlatmalar kapatıldı: burada da sussun
  useEffect(() => {
    for (const id of ringingReminders(owners)) {
      const r = list.find((x) => x.id === id);
      const due = r ? dueInstant(r) : null;
      if (!enabled || !r || !r.active || due === null || due > liveNow() + 60_000) stopAlarm(reminderAlarm(id));
    }
  }, [owners, list, enabled]);

  // Sıradaki pencerelerden başka cihazda tamamlanan ya da ertelenenler sıradan çıkar (geri alınırsa yeniden açılmasın:
  // köşede görünür)
  useEffect(() => {
    if (!live.data) return;
    const current = live.data.reminders;
    for (const p of popups.queue) {
      if (!current.some((r) => r.id === p.id && r.active && reminderAlertKey(r) === p.key)) dropPopup(p.id);
    }
  }, [live.data]);

  const changed = () => void refreshLive().then(onChanged);

  /** Geri al: "Yaptım"dan ya da ertelemeden önceki hâl */
  function undo(id: number, prev: Parameters<typeof restoreUserReminder>[1]) {
    void tryAction(() => restoreUserReminder(id, prev)).then((x) => {
      if (x && !x.ok) toast.error(x.error);
      changed();
    });
  }

  /** Kaydedilemedi: iyimser değişiklik geri alınır, hatırlatma köşedeki kartta yeniden görünür */
  function revert(r: LiveReminder) {
    patchLive((d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === r.id ? r : x)) }));
  }

  async function done(r: LiveReminder) {
    setBusy(r.id);
    stopAlarm(reminderAlarm(r.id));
    dropPopup(r.id);
    // Kart hemen kalksın; sunucunun hâli (tekrar edende sıradaki tarih) canlı veriyle gelir
    patchLive((d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === r.id ? { ...x, active: false } : x)) }));
    const res = await tryAction(() => completeUserReminder(r.id));
    setBusy(null);
    if (!res?.ok) {
      revert(r);
      if (res) toast.error(res.error);
    } else {
      const prev = res.data.prev;
      toast.success(res.data.next ? `${r.title}: sıradaki ${res.data.nextLabel}` : `${r.title} tamamlandı`, {
        action: { label: "Geri al", onClick: () => undo(r.id, prev) },
      });
    }
    changed();
  }

  async function snooze(r: LiveReminder) {
    setBusy(r.id);
    stopAlarm(reminderAlarm(r.id));
    dropPopup(r.id);
    // Sunucunun kuralıyla aynı hesap (src/lib/user-reminders.ts › postponeTarget): bir saat sonrası, 5 dakikaya yuvarlı
    const target = postponeTarget(r, "hour", new Date(liveNow()));
    patchLive((d) => ({ ...d, reminders: d.reminders.map((x) => (x.id === r.id ? { ...x, ...target } : x)) }));
    const res = await tryAction(() => postponeUserReminder(r.id, "hour"));
    setBusy(null);
    if (!res?.ok) {
      revert(r);
      if (res) toast.error(res.error);
    } else {
      const prev = res.data.prev;
      toast.success(`${r.title} ertelendi`, {
        description: `${whenLabel(res.data, new Date(liveNow()))} hatırlatılacak`,
        action: { label: "Geri al", onClick: () => undo(r.id, prev) },
      });
    }
    changed();
  }

  function silence(ids: Iterable<number>) {
    for (const id of ids) stopAlarm(reminderAlarm(id));
  }

  if (!enabled) return null;

  const popupAt = popup ? (dueInstant(popup) ?? 0) : 0;
  const popupNow = Math.max(at, popupAt);
  const repeat = popup ? userRepeatLabel(popup) : null;

  return (
    <>
      {/* Ekran okuyucuya: köşedeki kartın özeti (sayı ya da başlık değişince okunur) */}
      <p role="status" className="sr-only">
        {pending.length ? `${pending.length === 1 ? "Yapılmamış hatırlatma" : `${pending.length} yapılmamış hatırlatma`}: ${pending.map((r) => r.title).join(", ")}` : ""}
      </p>
      {pending.length ? (
        <ReminderDock
          items={pending}
          now={at}
          ringing={ringing}
          busy={busy}
          onDone={(r) => void done(r)}
          onOpen={(r) => showReminder(r, { front: true })}
          onSilence={() => silence(ringing)}
        />
      ) : null}
      <Dialog
        open={popup !== null}
        onClose={() => {
          if (popup) dropPopup(popup.id);
        }}
        size="sm"
        title={popup?.title ?? ""}
        description={popup ? `Hatırlatma · ${whenLabel(popup, new Date(popupNow))} · ${sinceLabel(popupAt, popupNow)}` : undefined}
        footer={
          popup ? (
            <>
              <Button variant="secondary" disabled={busy === popup.id} onClick={() => void snooze(popup)}>
                <Clock size={15} aria-hidden="true" /> 1 saat sonra hatırlat
              </Button>
              <Button variant="accent" disabled={busy === popup.id} onClick={() => void done(popup)}>
                <Check size={16} aria-hidden="true" /> Yaptım
              </Button>
            </>
          ) : null
        }
      >
        {popup ? (
          // Odak içerikte başlar, düğmede değil: kasada yazarken açılan pencerede Enter / boşluk yanlışlıkla "Yaptım" demesin
          <div data-autofocus tabIndex={-1} className="space-y-3 pb-2 outline-none">
            {popup.note ? <p className="text-[15px] leading-6 break-words whitespace-pre-line text-ink">{popup.note}</p> : null}
            {popup.createdByName || repeat ? (
              <p className="flex flex-wrap items-center gap-1.5">
                {popup.createdByName ? <Badge tone="blue">{popup.createdByName} kurdu</Badge> : null}
                {repeat ? (
                  <Badge tone="gray">
                    <Repeat size={11} aria-hidden="true" /> {repeat}
                  </Badge>
                ) : null}
              </p>
            ) : null}
            {ringing.has(popup.id) ? (
              <div className="flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-2.5 ring-1 ring-line-strong">
                <BellRing size={18} className="shrink-0 text-warn motion-safe:animate-bounce" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-sm font-medium text-ink">Ses çalıyor</p>
                <Button size="sm" variant="secondary" onClick={() => silence([popup.id])}>
                  <VolumeX size={14} aria-hidden="true" /> Sesi kes
                </Button>
              </div>
            ) : null}
            <p className="text-[13px] text-pretty text-ink-mute">
              Kapatırsanız köşede durur; “Yaptım” deyince kalkar.
              {waitingAfter ? ` Sırada ${waitingAfter} hatırlatma daha var.` : ""}
            </p>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

/** Köşedeki kart: yapılmamış saatli hatırlatmalar, en son geleni üstte */
function ReminderDock({
  items,
  now,
  ringing,
  busy,
  onDone,
  onOpen,
  onSilence,
}: {
  items: LiveReminder[];
  now: number;
  ringing: ReadonlySet<number>;
  busy: number | null;
  onDone: (r: LiveReminder) => void;
  onOpen: (r: LiveReminder) => void;
  onSilence: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // Kartın yüksekliği (ve üstündeki boşluk): telefonda yüzen düğme ve kaydetme çubuğu kartın üstüne çıkar, içeriğin
  // altına o kadar boşluk (globals.css, [data-reminder-dock])
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty("--reminder-dock-h", `${Math.ceil(el.getBoundingClientRect().height) + 24}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--reminder-dock-h");
    };
  }, []);

  const single = items.length === 1;
  const anyRinging = items.some((r) => ringing.has(r.id));
  const date = new Date(now);

  return (
    <section
      ref={ref}
      data-reminder-dock
      aria-label="Yapılmamış hatırlatmalar"
      className="no-print fixed right-3 bottom-[calc(var(--mobile-nav-space,0px)+0.75rem)] left-3 z-[35] in-data-[keyboard=open]:hidden sm:left-auto sm:w-[23rem] lg:right-6 lg:bottom-6"
    >
      <div className="reminder-nudge overflow-hidden rounded-2xl bg-ink text-white shadow-[0_12px_40px_rgba(0,0,0,0.3)] ring-2 ring-warn">
        {!single || anyRinging ? (
          <div className="flex items-center gap-2.5 border-b border-white/10 px-3.5 py-2.5">
            <BellTile />
            <p className="min-w-0 flex-1 text-[13px] font-semibold">{single ? "Hatırlatma bekliyor" : `${items.length} hatırlatma bekliyor`}</p>
            {anyRinging ? (
              <button
                type="button"
                onClick={onSilence}
                className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] bg-white/15 px-3 text-[13px] font-medium hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none pointer-coarse:h-11"
              >
                <VolumeX size={14} aria-hidden="true" /> Sesi kes
              </button>
            ) : null}
          </div>
        ) : null}
        <ul className="max-h-[min(15rem,40dvh)] divide-y divide-white/10 overflow-y-auto overscroll-contain">
          {items.map((r) => {
            const due = dueInstant(r) ?? now;
            return (
              <li key={r.id} className="flex items-center gap-3 px-3.5 py-2.5">
                {single && !anyRinging ? <BellTile /> : null}
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  title="Ayrıntı ve erteleme"
                  className="min-w-0 flex-1 cursor-pointer rounded-lg text-left focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
                >
                  <span className="block truncate text-[15px] font-semibold">{r.title}</span>
                  <span className="block truncate text-[12px] text-white/70 tabular">
                    {whenLabel(r, date)} · {sinceLabel(due, now)}
                    {r.createdByName ? ` · ${r.createdByName} kurdu` : ""}
                  </span>
                </button>
                <Button size="sm" variant="accent" disabled={busy === r.id} onClick={() => onDone(r)} aria-label={`Yaptım: ${r.title}`}>
                  <Check size={15} aria-hidden="true" /> Yaptım
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Turuncu zil karosu; arkasındaki halka yayılarak dikkat çeker (hareket azaltılmışsa durur) */
function BellTile() {
  return (
    <span aria-hidden="true" className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-warn text-white">
      <span className="absolute inset-0 rounded-full bg-warn opacity-60 motion-safe:animate-ping" />
      <BellRing size={17} className="relative" />
    </span>
  );
}
