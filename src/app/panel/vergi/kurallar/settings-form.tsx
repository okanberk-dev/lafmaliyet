"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { ToggleRow } from "@/components/ui/toggle-row";
import { saveTaxSettings } from "@/server/actions/tax";

export interface SettingsFormData {
  periodStart: string;
  firstActivity: "ilk" | "devir" | null;
  quarterDepreciation: "kalan" | "ay12";
  muhtasarQuarterly: boolean;
  minWageSupport: boolean;
  includeSeparate: boolean;
}

type Patch = Partial<Omit<SettingsFormData, "firstActivity">> & { firstActivity?: "ilk" | "devir" | null };

/**
 * Kurallar › "Vergi ayarları" (plan docs/planlar/vergi.md §4.4): hesap dönemi başlangıcı (Kaydet ile), şirketin
 * kuruluşu, geçici vergide amortisman ve üç anahtar (değişince kaydedilir). Bildirim değişen alanı yazar.
 */
export function SettingsForm({ data, today, supportTip }: { data: SettingsFormData; today: string; supportTip: string }) {
  const id = useId();
  const [pending, run] = useActionTransition();
  const [periodStart, setPeriodStart] = useState(data.periodStart);
  const startError = !periodStart ? "Tarih seçin" : periodStart > today ? "Hesap dönemi bugünden sonra başlayamaz" : periodStart < "2000-01-01" ? "Tarih 2000'den önce olamaz" : null;

  function save(patch: Patch) {
    run(async () => {
      const r = await saveTaxSettings(patch);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      toast.success(r.data.changed.length ? `Vergi ayarları kaydedildi: ${r.data.changed.join(" · ")}` : "Değişiklik yok");
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!startError && periodStart !== data.periodStart) save({ periodStart });
        }}
      >
        <Field label="Hesap dönemi başlangıcı" htmlFor={`${id}-baslangic`} hint="Vergi levhasındaki işe başlama tarihi" error={startError}>
          <Input
            id={`${id}-baslangic`}
            type="date"
            value={periodStart}
            max={today}
            onChange={(e) => setPeriodStart(e.target.value)}
            aria-invalid={startError ? true : undefined}
            disabled={pending}
            className="pointer-coarse:h-12"
          />
        </Field>
        <div className="sm:pb-6">
          <Button type="submit" variant="secondary" disabled={pending || Boolean(startError) || periodStart === data.periodStart}>
            Kaydet
          </Button>
        </div>
      </form>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Şirket nasıl kuruldu?" htmlFor={`${id}-kurulus`} hint="Asgari kurumlar vergisi muafiyeti yalnız ilk defa faaliyete başlayan şirkette uygulanır.">
          <Select
            id={`${id}-kurulus`}
            value={data.firstActivity ?? ""}
            disabled={pending}
            onChange={(e) => save({ firstActivity: e.target.value === "ilk" || e.target.value === "devir" ? e.target.value : null })}
            className="pointer-coarse:h-12"
          >
            <option value="ilk">İlk defa faaliyete başladı</option>
            <option value="devir">Birleşme, devir, bölünme ya da tür değişikliğiyle</option>
            <option value="">Bilmiyorum</option>
          </Select>
        </Field>
        <Field label="Geçici vergide amortisman" htmlFor={`${id}-amortisman`} hint="Muhasebecinizin yöntemi (Muhasebeciye sorulacaklar › Demirbaş)">
          <Select
            id={`${id}-amortisman`}
            value={data.quarterDepreciation}
            disabled={pending}
            onChange={(e) => save({ quarterDepreciation: e.target.value === "ay12" ? "ay12" : "kalan" })}
            className="pointer-coarse:h-12"
          >
            <option value="kalan">Kalan çeyreklere eşit</option>
            <option value="ay12">Kümülatif ay ÷ 12</option>
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <ToggleRow
          title="Muhtasarın vergi kısmı 3 aylık"
          description="Muhasebeciniz muhtasarı 3 ayda bir veriyorsa açın (10 ve daha az çalışan): vergi kısmı Mart, Haziran, Eylül ve Aralık dönemlerinde, prim hizmet damgası her ay."
          checked={data.muhtasarQuarterly}
          onChange={(v) => save({ muhtasarQuarterly: v })}
          disabled={pending}
          label="Muhtasarın vergi kısmı 3 aylık"
          onText="Açık"
          offText="Kapalı"
        />
        <ToggleRow
          title="Asgari ücret desteği SGK'dan düşülsün"
          description="Yalnız SGK tahakkukunuzda düşülüyorsa açın."
          tip={supportTip}
          checked={data.minWageSupport}
          onChange={(v) => save({ minWageSupport: v })}
          disabled={pending}
          label="Asgari ücret desteği SGK'dan düşülsün"
          onText="Açık"
          offText="Kapalı"
        />
        <ToggleRow
          title="Kafe dışı faturaları vergi hesabına kat"
          description="Kafe dışı geliri de girin; yalnız gider girmek vergiyi düşük gösterir."
          checked={data.includeSeparate}
          onChange={(v) => save({ includeSeparate: v })}
          disabled={pending}
          label="Kafe dışı faturaları vergi hesabına kat"
          onText="Açık"
          offText="Kapalı"
        />
      </div>
    </div>
  );
}
