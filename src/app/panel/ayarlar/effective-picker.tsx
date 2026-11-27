"use client";

import { CalendarRange } from "lucide-react";

import { Select } from "@/components/ui/form";
import { CHANGE_MODE_LABELS, fromMonthAblative, fromMonthText, type ChangeMode } from "@/lib/month-settings";
import { cn } from "@/lib/utils";

/** Ay bazlı ayarın geçerliliği (docs/AYARLAR.md): "şu aydan itibaren" ya da "yalnız bu ay" ve ay */
export interface Effective {
  mode: ChangeMode;
  month: string;
}

/** Seçicinin ihtiyaç duyduğu ay bilgisi (sunucu hazırlar: src/server/month-settings-view.ts) */
export interface EffectiveMonths {
  /** Seçilebilir aylar, eskiden yeniye (verinin ilk ayından bu aydan 12 ay sonrasına) */
  months: string[];
  /** Bu ay (YYYY-MM, Türkiye saati) */
  current: string;
  /** Kapalı aylar (docs/DONEM-KAPANISI.md): seçilemez, değişiklik onlara dokunamaz */
  closed: string[];
}

export const defaultEffective = (m: EffectiveMonths): Effective => ({ mode: "from", month: m.current });

/** Seçimin açıklaması: hangi aylar değişir, hangileri değişmez */
export function effectiveText(e: Effective, current: string): string {
  if (e.mode === "only") return `Yalnız ${fromMonthText(e.month)} değişir; önceki ve sonraki aylar kendi değerinde kalır.`;
  const past = e.month < current ? " Geçmiş aylar dahil: o ayların rakamı yeniden hesaplanır." : " Önceki aylar değişmez.";
  return `${fromMonthAblative(e.month)} itibaren, sonraki kayıtlı değişikliğe kadar.${past}`;
}

/**
 * "Hangi aydan?" seçicisi: Ayarlar'ın oranları ve yemek kartı, Maaşlar › SGK oranları, Şubeler › POS oranı ve Gelir-gider'in
 * SGK oranı uyarısı aynı seçiciyi kullanır. Varsayılan bu aydan itibaren; kapalı ay seçilemez (sunucu da reddeder)
 */
export function EffectivePicker({
  value,
  onChange,
  months,
  idPrefix,
  className,
}: {
  value: Effective;
  onChange: (e: Effective) => void;
  months: EffectiveMonths;
  idPrefix: string;
  className?: string;
}) {
  const closed = new Set(months.closed);
  // "Şu aydan itibaren" kapalı ayı da değiştirirdi: son kapalı ay ve öncesi seçilemez (sonraki değişiklik araya girse de
  // sunucu ayrıca denetler)
  const lastClosed = months.closed.length ? [...months.closed].sort().at(-1)! : null;
  const blocked = (m: string) => closed.has(m) || (value.mode === "from" && lastClosed !== null && m <= lastClosed);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <CalendarRange size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
        <label htmlFor={`${idPrefix}-mode`} className="sr-only">
          Geçerlilik
        </label>
        <Select id={`${idPrefix}-mode`} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as ChangeMode })} className="w-auto min-w-40">
          {(Object.keys(CHANGE_MODE_LABELS) as ChangeMode[]).map((m) => (
            <option key={m} value={m}>
              {CHANGE_MODE_LABELS[m]}
            </option>
          ))}
        </Select>
        <label htmlFor={`${idPrefix}-month`} className="sr-only">
          Ay
        </label>
        <Select id={`${idPrefix}-month`} value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })} className="w-auto min-w-36">
          {[...months.months].reverse().map((m) => (
            <option key={m} value={m} disabled={blocked(m)}>
              {fromMonthText(m)}
              {m === months.current ? " (bu ay)" : closed.has(m) ? " (kapalı)" : ""}
            </option>
          ))}
        </Select>
      </div>
      <p className="text-xs text-ink-mute">
        {effectiveText(value, months.current)}
        {lastClosed ? ` ${fromMonthText(lastClosed)} kapalı: kapalı ayı değiştiren seçim yapılamaz (Ayarlar › Dönem kapanışı).` : ""}
      </p>
    </div>
  );
}
