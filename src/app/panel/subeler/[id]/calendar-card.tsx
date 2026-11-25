"use client";

import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SameAsToggle } from "@/components/panel/same-as-toggle";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, NumberInput, Select } from "@/components/ui/form";
import { EVENING_HOUR_MAX, EVENING_HOUR_MIN, type CalendarSetting } from "@/lib/branch-settings/groups";
import { clockSuffixTR } from "@/lib/reminders";
import { saveBranchCalendar } from "@/server/actions/branch-settings";
import type { BranchSettingView } from "@/server/branch-settings-view";

const HOURS = Array.from({ length: EVENING_HOUR_MAX - EVENING_HOUR_MIN + 1 }, (_, i) => EVENING_HOUR_MIN + i);
/** "20:00'den sonra", "13:00'ten sonra", "16:00'dan sonra" (ayrılma hâli saate göre; clockSuffixTR) */
const afterHourText = (h: number) => `${clockSuffixTR(`${String(h).padStart(2, "0")}:00`, "abl")} sonra`;

/** Yazılan gün sayısının sorunu (sunucu aynı sınırı ayrıca denetler) */
function daysProblem(text: string): string | null {
  const v = Number(text.trim());
  if (!text.trim() || !Number.isInteger(v)) return "Tam gün yazın";
  if (v < 1) return "En az 1 gün";
  if (v > 31) return "En fazla 31 gün";
  return null;
}

/**
 * Şube ayarları › Çalışma takvimi (şube ayarı isletme.takvim; docs/SUBE.md › Şube başına ayarlar): ayda kaç gün açık
 * (Genel bakış'ın ve Analiz'in başabaşı, günlük giderler; şube seçiliyken o şubenin) ve kasa raporunun hangi saatten
 * sonra beklendiği (zil ve Bugün). Birden çok kasa açıkken "Diğer şubeyle aynı"; bağlıyken değerler salt okunur.
 */
export function CalendarCard({ view }: { view: BranchSettingView<CalendarSetting> }) {
  const [days, setDays] = useState(String(view.value.openDays));
  const [hour, setHour] = useState(view.value.eveningHour);
  const [pending, start] = useActionTransition();
  const linked = view.link?.mode.kind === "linked";
  // Kayıtlı değer değişince (kayıttan, "aynı" değişince) form ona döner
  const savedKey = `${view.value.openDays}:${view.value.eveningHour}`;
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setDays(String(view.value.openDays));
    setHour(view.value.eveningHour);
  }
  const problem = daysProblem(days);
  const dirty = Number(days) !== view.value.openDays || hour !== view.value.eveningHour;

  function save() {
    if (problem) return;
    start(async () => {
      const res = await saveBranchCalendar({ branchId: view.branchId, openDays: Number(days), eveningHour: hour });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.changed ? "Çalışma takvimi kaydedildi" : "Değişiklik yok");
    });
  }

  return (
    <Card id="takvim" className="scroll-mt-20">
      <CardHeader
        icon={<CalendarClock />}
        title="Çalışma takvimi"
        description="Ayda kaç gün açık (başabaş ve günlük giderler) ve kasa raporunun hangi saatten sonra beklendiği (zil ve Bugün)."
      />
      <div className="space-y-3 px-5 pb-5">
        <SameAsToggle link={view.link} branchId={view.branchId} branchName={view.branchName} group="isletme.takvim" what="çalışma takvimi" anchor="takvim" />
        {linked ? (
          <dl className="grid gap-1 rounded-2xl bg-surface px-4 py-3 text-sm ring-1 ring-line">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-mute">Ayda açık gün</dt>
              <dd className="tabular text-ink">{view.value.openDays} gün</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-mute">Kasa raporu</dt>
              <dd className="tabular text-ink">{afterHourText(view.value.eveningHour)}</dd>
            </div>
          </dl>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ayda kaç gün açık" htmlFor="takvim-gun" hint="Başabaş günlük cirosu ve günlük giderler" error={problem ?? undefined}>
                <NumberInput
                  id="takvim-gun"
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-invalid={problem ? true : undefined}
                  className="pointer-coarse:h-12"
                />
              </Field>
              <Field label="Kasa raporu beklenir" htmlFor="takvim-saat" hint="Bu saatten sonra zil ve Bugün bugünün raporunu sorar">
                <Select id="takvim-saat" value={hour} onChange={(e) => setHour(Number(e.target.value))} className="pointer-coarse:h-12">
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {afterHourText(h)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button onClick={save} disabled={pending || !dirty || Boolean(problem)} className="max-sm:w-full">
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
