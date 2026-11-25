"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SameAsToggle } from "@/components/panel/same-as-toggle";
import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { NumberInput } from "@/components/ui/form";
import { CHANNELS, type ChannelKey } from "@/lib/commission/channels";
import { MEAL_MAX_PAY_DAYS, PLATFORM_MAX_PAY_DAYS, type ChannelSettings } from "@/lib/commission/report";
import { saveCommissionSettings } from "@/server/actions/commission";
import type { SettingLinkView } from "@/server/branch-settings-view";

/** Yazılan gün: tam sayı değilse ya da sınırın dışındaysa hata metni */
function dayError(text: string, max: number, meal: boolean): string | null {
  const v = Number(text.trim());
  if (!text.trim() || !Number.isInteger(v)) return "Tam gün yazın";
  if (v < 1) return "En az 1 gün";
  if (v > max) return meal ? `En çok ${max} gün (yönetmelik)` : `En çok ${max} gün`;
  return null;
}

/**
 * Kanallar (#kanallar): her kanalın ödeme süresi; hakedişin son günü = ayın son faturası + bu süre. Yemek kartında
 * yönetmelik en çok 30 gün der; platformda sözleşmedeki süre (en çok 90). Kaydet'e basınca hepsi birlikte kaydedilir.
 * Şube başına (şube ayarı komisyon; docs/SUBE.md › Şube başına ayarlar): Komisyon & hakediş ekranı ve Şube ayarları aynı
 * kartı çizer. Birden çok kasa açıkken başlıkta şubenin adı ve "Diğer şubeyle aynı"; bağlıyken süreler salt okunur.
 * Faturalar ve hakediş işletmenin olduğu için son gün şubelerin en kısa süresiyle hesaplanır (businessPayDays).
 */
export function ChannelSettingsCard({
  settings,
  branchId,
  branchName = null,
  link = null,
  anchor = "kanallar",
}: {
  settings: Record<ChannelKey, ChannelSettings>;
  /** Sürelerin şubesi: kayıt buraya iner */
  branchId: string;
  branchName?: string | null;
  link?: SettingLinkView | null;
  anchor?: string;
}) {
  const linked = link?.mode.kind === "linked";
  const initial = () => Object.fromEntries(CHANNELS.map((c) => [c.key, String(settings[c.key].payDays)])) as Record<ChannelKey, string>;
  const [values, setValues] = useState(initial);
  const [pending, start] = useActionTransition();
  // Kayıtlı değerler değişince (kayıttan sonra, başka sekmede) form onlara döner; sayfanın başka bir kaydı (hakediş)
  // yazılmış ama kaydedilmemiş günleri silmez
  const savedKey = CHANNELS.map((c) => settings[c.key].payDays).join(",");
  const [seen, setSeen] = useState(savedKey);
  if (seen !== savedKey) {
    setSeen(savedKey);
    setValues(initial());
  }

  const errors = Object.fromEntries(
    CHANNELS.map((c) => [c.key, dayError(values[c.key], c.kind === "meal" ? MEAL_MAX_PAY_DAYS : PLATFORM_MAX_PAY_DAYS, c.kind === "meal")]),
  ) as Record<ChannelKey, string | null>;
  const dirty = CHANNELS.some((c) => values[c.key].trim() !== String(settings[c.key].payDays));
  const invalid = CHANNELS.some((c) => errors[c.key]);

  function save() {
    if (invalid) return;
    start(async () => {
      const r = await saveCommissionSettings({ branchId, channels: Object.fromEntries(CHANNELS.map((c) => [c.key, { payDays: Number(values[c.key]) }])) });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Kanallar kaydedildi");
    });
  }

  return (
    <Card id={anchor} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)] lg:scroll-mt-4">
      <CardHeader
        icon={<Settings2 />}
        title={branchName ? `Kanallar · ${branchName}` : "Kanallar"}
        description={
          link
            ? "Hakedişin, ayın son faturasından sonra kaç gün içinde gelmesi gerektiği; yemek kartında yönetmelik en çok 30 gün der. Faturalar ve hakediş işletmenin: son gün şubelerin en kısa süresiyle hesaplanır, geçince zil çalar."
            : "Hakedişin, ayın son faturasından sonra kaç gün içinde gelmesi gerektiği; yemek kartında yönetmelik en çok 30 gün der. Son gün geçince zil çalar."
        }
      />
      {link ? (
        <div className="space-y-3 px-5 pb-4">
          <SameAsToggle link={link} branchId={branchId} branchName={branchName} group="komisyon" what="ödeme süreleri" anchor="komisyon" />
        </div>
      ) : null}
      {linked ? (
        <ul className="mx-5 mb-5 grid rounded-2xl bg-surface px-4 ring-1 ring-line lg:grid-cols-2 lg:gap-x-8">
          {CHANNELS.map((c) => (
            <li key={c.key} className="flex min-h-11 items-center justify-between gap-3 border-t border-line py-2 text-sm first:border-t-0 lg:[&:nth-child(2)]:border-t-0">
              <span className="text-ink">{c.label}</span>
              <span className="tabular text-ink-mute">{settings[c.key].payDays} gün</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mx-5 mb-5 grid rounded-2xl bg-surface px-4 ring-1 ring-line lg:grid-cols-2 lg:gap-x-8">
          {CHANNELS.map((c) => {
            const id = `odeme-suresi-${c.key}`;
            const error = errors[c.key];
            return (
              <li key={c.key} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0 lg:[&:nth-child(2)]:border-t-0">
                <label htmlFor={id} className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{c.label}</span>
                  <span className="block text-xs text-ink-mute">
                    {c.kind === "meal" ? "Yemek kartı · en çok 30 gün" : "Platform · sözleşmedeki süre"}
                  </span>
                  {error ? <span className="block text-xs text-bad">{error}</span> : null}
                </label>
                <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-mute">
                  <NumberInput
                    id={id}
                    inputMode="numeric"
                    value={values[c.key]}
                    onChange={(e) => setValues((v) => ({ ...v, [c.key]: e.target.value }))}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-invalid={error ? true : undefined}
                    aria-label={`${c.label} ödeme süresi (gün)`}
                    className="w-16 pointer-coarse:h-12"
                  />
                  gün
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {linked ? null : (
        <CardFooter>
          <span className="min-w-0 flex-[1_1_16rem]">Son gün = ayın son faturasının tarihi + ödeme süresi. Fatura gelmeden son gün belli olmaz.</span>
          <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || invalid || pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
