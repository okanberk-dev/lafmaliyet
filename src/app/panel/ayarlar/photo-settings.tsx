"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Field, NumberInput } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { updatePhotoReading } from "@/server/actions/photos";

/**
 * Fotoğraftan (ve faturadan) okumayı aç / kapat (dokununca kaydedilir) ve günlük sınır (Kaydet ile). Yalnız yönetici.
 */
export function PhotoReadingForm({ enabled: initialEnabled, dailyCap: initialCap }: { enabled: boolean; dailyCap: number }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedCap, setSavedCap] = useState(initialCap);
  const [cap, setCap] = useState(String(initialCap));
  const [pending, start] = useActionTransition();

  function save(next: { enabled: boolean; dailyCap: number }, previous: boolean) {
    start(async () => {
      const res = await updatePhotoReading(next);
      if (!res.ok) {
        setEnabled(previous);
        return void toast.error(res.error);
      }
      setSavedCap(res.data.dailyCap);
      toast.success(`Fotoğraftan okuma ${res.data.enabled ? "açık" : "kapalı"}`, { description: `Günde en çok ${res.data.dailyCap} okuma` });
    });
  }

  function toggle(v: boolean) {
    setEnabled(v);
    save({ enabled: v, dailyCap: savedCap }, !v);
  }

  function saveCap() {
    const dailyCap = Number(cap.trim());
    if (!cap.trim() || !Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > 500) return void toast.error("Günde en çok: 0 ile 500 arası bir tam sayı yazın");
    save({ enabled, dailyCap }, enabled);
  }

  return (
    <div className="space-y-3">
      <ToggleRow
        title="Fotoğraftan okuma"
        description="Kapalıyken fotoğraf yine eklenir, rakamlar elle yazılır; fatura da okunmaz."
        label="Fotoğraftan okuma"
        checked={enabled}
        onChange={toggle}
        disabled={pending}
      />
      <div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Günde en çok" htmlFor="foto-cap" className="w-36">
            <NumberInput id="foto-cap" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} />
          </Field>
          <Button onClick={saveCap} disabled={pending || cap.trim() === String(savedCap)}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-mute">Sınır dolunca o gün okuma durur.</p>
      </div>
    </div>
  );
}
