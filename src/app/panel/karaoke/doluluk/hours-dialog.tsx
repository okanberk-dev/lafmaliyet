"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { DAY_START_HOUR, type RoomHours } from "@/lib/karaoke/occupancy";
import { closeOptionLabel, hourLabel } from "@/lib/karaoke/occupancy-text";
import { saveKaraokeHours } from "@/server/actions/karaoke-doluluk";

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
/** Açılış 05:00–23:00; kapanış açılıştan sonra, en geç ertesi gün 05:00 (iş günü ölçeğinde 29) */
const OPEN_HOURS = range(DAY_START_HOUR, 23);
const LAST_CLOSE = 24 + DAY_START_HOUR;

/**
 * Oda saatleri düğmesi ve penceresi (uyarı şeridi, ısı haritasının dipnotu ve Veri ve ayarlar kartı aynısını kullanır).
 * Kaydet'e basınca önce pencere kapanır, sonra kaydedilir; sayfa sunucu eylemiyle yenilenir.
 */
export function HoursButton({
  hours,
  label = "Değiştir",
  variant = "secondary",
}: {
  hours: RoomHours;
  label?: string;
  variant?: "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useActionTransition();

  function save(next: RoomHours) {
    setOpen(false);
    start(async () => {
      const r = await saveKaraokeHours(next);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Oda saatleri kaydedildi");
    });
  }

  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {pending ? "Kaydediliyor…" : label}
      </Button>
      {open ? <HoursDialog hours={hours} onClose={() => setOpen(false)} onSave={save} /> : null}
    </>
  );
}

function HoursDialog({ hours, onClose, onSave }: { hours: RoomHours; onClose: () => void; onSave: (h: RoomHours) => void }) {
  const formId = useId();
  const [openAt, setOpenAt] = useState(hours.open);
  const [closeAt, setCloseAt] = useState(hours.close);
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title="Oda saatleri"
      description="Doluluk bu saatlere göre hesaplanır; değişiklik geçmiş aylara da uygulanır. Gece yarısından sonra kapanıyorsa kapanışı ertesi günün saati olarak seçin (ör. 02:00)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId}>
            Kaydet
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-3 pb-2 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ open: openAt, close: closeAt });
        }}
      >
        <Field label="Açılış" htmlFor={`${formId}-acilis`}>
          <Select
            id={`${formId}-acilis`}
            value={openAt}
            onChange={(e) => {
              const v = Number(e.target.value);
              setOpenAt(v);
              // Kapanış açılıştan sonra kalsın
              if (closeAt <= v) setCloseAt(v + 1);
            }}
          >
            {OPEN_HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kapanış" htmlFor={`${formId}-kapanis`} hint="Her gün aynı saatler">
          <Select id={`${formId}-kapanis`} value={closeAt} onChange={(e) => setCloseAt(Number(e.target.value))}>
            {range(openAt + 1, LAST_CLOSE).map((h) => (
              <option key={h} value={h}>
                {closeOptionLabel(h)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}
