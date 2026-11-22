"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { addedOnThisDevice } from "@/components/panel/live/alert-center";
import { refreshLive } from "@/components/panel/live/store";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import {
  deskAddedToast,
  deskDays,
  deskInstants,
  deskLengths,
  deskNow,
  deskStartHours,
  type DeskField,
  type DeskKind,
} from "@/lib/karaoke/desk";
import { overlapText, siteOverlaps } from "@/lib/karaoke/overlap";
import { reminderHint } from "@/lib/karaoke/reminder";
import { dayLabel, dayShortTR, timeRange, type KaraokeSessionDTO } from "@/lib/karaoke/session";
import { addDeskKaraoke } from "@/server/actions/karaoke";

/** Odanın saatleri (Doluluk › Oda saatleri; iş günü ölçeğinde, 24 = gece yarısı) */
export interface RoomHoursProp {
  open: number;
  close: number;
}

const two = (n: number) => String(n).padStart(2, "0");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Açılışta seçili gün ve saat: bugün saat kaldıysa bugün, yoksa yarın; saat 20:00 (yoksa ilk boş saat) */
function initialSlot(hours: RoomHoursProp, nowMs: number): { date: string; startHour: number } {
  const now = deskNow(nowMs);
  const days = deskDays(now.today);
  const date = deskStartHours(hours, now.today, now).length ? now.today : days[1];
  const starts = deskStartHours(hours, date, now);
  return { date, startHour: starts.includes(20) ? 20 : (starts[0] ?? 20) };
}

/**
 * Elle ekle (Karaoke ekranı, yönetici ve personel): telefonla ya da kasada alınan rezervasyon ya da kapatılan saatler.
 * Satır laffogato.net'in takvimine yazılır (sunucu eylemi sitenin imzalı ucuna gönderir), sitede, uygulamada ve kasada
 * hemen dolu görünür; sonra bu panelin listesine her zamanki eşitlemeyle gelir. Sitenin itirazı (Türkçe mesaj) adı
 * geçen alanın yanında, alanı yoksa pencerenin başında. Telefon yalnız siteye gider; e-posta yazılırsa misafire sitenin
 * onay e-postası, rezervasyona bir günden fazla varsa bir gün kala panelin hatırlatma e-postası da gider (ipucu söyler).
 */
export function DeskDialog({ open, onClose, sessions, roomHours, nowMs }: { open: boolean; onClose: () => void; sessions: KaraokeSessionDTO[]; roomHours: RoomHoursProp; nowMs: number }) {
  // Pencere her açılışta boş başlar (kapatınca içerik söner, `key` ile yeniden kurulur)
  return open ? <DeskForm key="desk-form" onClose={onClose} sessions={sessions} roomHours={roomHours} nowMs={nowMs} /> : null;
}

function DeskForm({ onClose, sessions, roomHours, nowMs }: { onClose: () => void; sessions: KaraokeSessionDTO[]; roomHours: RoomHoursProp; nowMs: number }) {
  const formId = useId();
  const [pending, run] = useActionTransition();
  const [kind, setKind] = useState<DeskKind>("booking");
  const [slot, setSlot] = useState(() => initialSlot(roomHours, nowMs));
  const [length, setLength] = useState(2);
  const [name, setName] = useState("");
  const [guests, setGuests] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<DeskField, string>>>({});
  /** Alanı olmayan hata (bağlantı, zaman aşımı): pencerenin başında */
  const [topError, setTopError] = useState<string | null>(null);

  const now = deskNow(nowMs);
  const days = deskDays(now.today);
  const starts = deskStartHours(roomHours, slot.date, now);
  const startHour = starts.includes(slot.startHour) ? slot.startHour : (starts[0] ?? slot.startHour);
  const lengths = starts.length ? deskLengths(roomHours, startHour) : [];
  const hours = lengths.includes(length) ? length : (lengths.at(-1) ?? 1);
  const { start, end } = deskInstants(slot.date, startHour, hours);
  // Panelin bildiği dolu saatler (sitedeki rezervasyon ve kapatılan saat; kural hızlı sayaçla aynı). Site ayrıca reddeder
  const clash = starts.length ? overlapText(siteOverlaps({ start, end }, sessions), nowMs) : null;
  const block = kind === "block";

  const dayText = (d: string) => (d === now.today || d === days[1] ? `${dayLabel(d, nowMs)} · ${dayShortTR(d)}` : dayLabel(d, nowMs));
  const err = (f: DeskField) => errors[f];
  const described = (f: DeskField, id: string) => (errors[f] ? { "aria-invalid": true as const, "aria-describedby": `${id}-hata` } : {});
  const clearError = (f: DeskField) => {
    if (errors[f]) setErrors((e) => ({ ...e, [f]: undefined }));
    setTopError(null);
  };

  function check(): Partial<Record<DeskField, string>> {
    const out: Partial<Record<DeskField, string>> = {};
    if (!starts.length) out.startHour = "Bu gün için boş saat kalmadı; başka bir gün seçin";
    if (!block) {
      if (!name.trim()) out.name = "Misafirin adını yazın";
      const g = Number(guests);
      if (!guests || !Number.isInteger(g) || g < 1 || g > 100) out.guests = "Kişi sayısını yazın (1–100)";
      if (email.trim() && !EMAIL_RE.test(email.trim())) out.email = "E-posta adresi geçersiz";
    }
    return out;
  }

  function submit() {
    const local = check();
    setErrors(local);
    setTopError(null);
    if (Object.keys(local).length) return void document.getElementById(`${formId}-${Object.keys(local)[0]}`)?.focus();
    run(async () => {
      // Ağ yoksa ya da panel güncellendiyse eylem atar: useActionTransition bildirir, pencere yazılanlarla açık kalır
      const res = await addDeskKaraoke({
        kind,
        date: slot.date,
        startHour,
        hours,
        guests: block ? null : Number(guests),
        name: block ? "" : name.trim(),
        phone: block ? "" : phone.trim(),
        email: block ? "" : email.trim(),
        note: (block ? reason : note).trim(),
      });
      if (!res.ok) return void setTopError(res.error);
      const r = res.data;
      if (r.problem) {
        // Zaman aşımı: site yazmış olabilir; liste tazelenir, pencere açık kalır (kişi bakıp karar verir)
        if (r.problem.uncertain) void refreshLive();
        if (r.problem.field && r.problem.field !== "kind") {
          setErrors({ [r.problem.field]: r.problem.message });
          document.getElementById(`${formId}-${r.problem.field}`)?.focus();
        } else setTopError(r.problem.message);
        return;
      }
      if (r.added.externalId) addedOnThisDevice(r.added.externalId);
      const t = deskAddedToast(r.added.kind, r.added.when, r.added.email, r.added.reminder);
      toast.success(t.title, { description: r.added.synced ? t.description : `${t.description} Listeye birkaç saniye içinde gelir.`, duration: 10_000 });
      onClose();
      await refreshLive();
    });
  }

  const big = "pointer-coarse:h-12";
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Elle ekle"
      description="Telefonla gelen rezervasyon ya da kapatılan saatler. Sitede, uygulamada ve kasada hemen dolu görünür."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} className="max-sm:bg-panel">
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending || !starts.length}>
            {pending ? "Gönderiliyor…" : block ? "Saatleri kapat" : "Rezervasyonu ekle"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {topError ? <Notice tone="bad" size="sm" live="assertive" title={topError} /> : null}
        <Segmented
          label="Tür"
          stretch
          value={kind}
          onChange={(v) => {
            setKind(v);
            setErrors({});
            setTopError(null);
          }}
          options={[
            { value: "booking", label: "Rezervasyon" },
            { value: "block", label: "Saati kapat" },
          ]}
        />
        <Field label="Gün" htmlFor={`${formId}-date`} error={err("date")}>
          <Select
            id={`${formId}-date`}
            value={slot.date}
            onChange={(e) => {
              clearError("date");
              setSlot((s) => ({ ...s, date: e.target.value }));
            }}
            className={big}
            {...described("date", `${formId}-date`)}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {dayText(d)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Başlangıç" htmlFor={`${formId}-startHour`} error={err("startHour")}>
            <Select
              id={`${formId}-startHour`}
              value={String(startHour)}
              disabled={!starts.length}
              onChange={(e) => {
                clearError("startHour");
                setSlot((s) => ({ ...s, startHour: Number(e.target.value) }));
              }}
              className={big}
              {...described("startHour", `${formId}-startHour`)}
            >
              {starts.length ? (
                starts.map((h) => (
                  <option key={h} value={h}>
                    {two(h)}:00
                  </option>
                ))
              ) : (
                <option value={startHour}>Saat yok</option>
              )}
            </Select>
          </Field>
          <Field label="Süre" htmlFor={`${formId}-hours`} error={err("hours")}>
            <Select
              id={`${formId}-hours`}
              value={String(hours)}
              disabled={!lengths.length}
              onChange={(e) => {
                clearError("hours");
                setLength(Number(e.target.value));
              }}
              className={big}
              {...described("hours", `${formId}-hours`)}
            >
              {(lengths.length ? lengths : [hours]).map((n) => (
                <option key={n} value={n}>
                  {n} saat
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {starts.length ? (
          <p className="-mt-1 text-[13px] text-ink-mute tabular">
            {dayLabel(slot.date, nowMs)} {timeRange(start, end)}
            {block ? " · rezervasyon alınmaz" : " · ödemesi köşkte"}
          </p>
        ) : null}
        {clash ? <Notice tone="warn" size="sm" title={`${clash} Site çakışan saati kabul etmez.`} /> : null}
        {block ? (
          <Field label="Neden" htmlFor={`${formId}-note`} error={err("note")} hint="İsteğe bağlı. Yalnız panellerde görünür; sitede yalnız saatler dolu görünür.">
            <Input
              id={`${formId}-note`}
              value={reason}
              maxLength={300}
              onChange={(e) => {
                clearError("note");
                setReason(e.target.value);
              }}
              placeholder="ör. özel etkinlik, bakım"
              className={big}
              {...described("note", `${formId}-note`)}
            />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
              <Field label="Ad" htmlFor={`${formId}-name`} error={err("name")}>
                <Input
                  id={`${formId}-name`}
                  value={name}
                  maxLength={60}
                  autoComplete="off"
                  onChange={(e) => {
                    clearError("name");
                    setName(e.target.value);
                  }}
                  placeholder="Misafirin adı"
                  className={big}
                  {...described("name", `${formId}-name`)}
                />
              </Field>
              <Field label="Kişi" htmlFor={`${formId}-guests`} error={err("guests")}>
                <Input
                  id={`${formId}-guests`}
                  inputMode="numeric"
                  value={guests}
                  onChange={(e) => {
                    clearError("guests");
                    setGuests(e.target.value.replace(/[^\d]/g, "").slice(0, 3));
                  }}
                  placeholder="ör. 6"
                  className={big}
                  {...described("guests", `${formId}-guests`)}
                />
              </Field>
            </div>
            <Field label="Telefon" htmlFor={`${formId}-phone`} error={err("phone")} hint="İsteğe bağlı. Yalnız siteye gider, bu panelde saklanmaz.">
              <Input
                id={`${formId}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={phone}
                maxLength={20}
                onChange={(e) => {
                  clearError("phone");
                  setPhone(e.target.value);
                }}
                placeholder="05xx xxx xx xx"
                className={big}
                {...described("phone", `${formId}-phone`)}
              />
            </Field>
            <Field label="E-posta" htmlFor={`${formId}-email`} error={err("email")} hint={reminderHint(start, nowMs)}>
              <Input
                id={`${formId}-email`}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                maxLength={120}
                onChange={(e) => {
                  clearError("email");
                  setEmail(e.target.value);
                }}
                placeholder="isteğe bağlı"
                className={big}
                {...described("email", `${formId}-email`)}
              />
            </Field>
            <Field label="Not" htmlFor={`${formId}-note`} error={err("note")}>
              <Textarea
                id={`${formId}-note`}
                value={note}
                rows={2}
                maxLength={300}
                onChange={(e) => {
                  clearError("note");
                  setNote(e.target.value);
                }}
                placeholder="ör. doğum günü"
                {...described("note", `${formId}-note`)}
              />
            </Field>
          </>
        )}
      </form>
    </Dialog>
  );
}
