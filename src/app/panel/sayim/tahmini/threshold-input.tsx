"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/form";
import { saveStockThreshold } from "@/server/actions/stock-estimate";

/**
 * Kritik eşik alanı (yönetici; Tahmini stok, docs/STOK-TAHMINI.md § 4). Sayım biriminde yazılır ("2,5" KG); boş
 * bırakılıp kaydedilince eşik silinir. Kaydet yalnız değer değişince çıkar, Enter da kaydeder. Kayıttan sonra sayfa
 * sunucudan yenilenir; değer değişince alan yeniden kurulur (çağıran `key` verir).
 *
 * Eşik önerisi (`suggestion`, sayım biriminde) alanın yanında küçük düğmedir: dokununca öneri alana yazılır, hiçbir şey
 * kaydedilmez; yönetici Kaydet'e basınca (onay) eşik olur. Öneri alandaki değerle aynıysa düğme çıkmaz.
 */
export function ThresholdInput({
  ingredientId,
  name,
  unit,
  initial,
  suggestion,
}: {
  ingredientId: number;
  name: string;
  unit: string;
  initial: string;
  suggestion?: string | null;
}) {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const [pending, start] = useActionTransition();
  const dirty = value.trim() !== initial;

  function save() {
    if (!dirty || pending) return;
    start(async () => {
      const res = await saveStockThreshold({ ingredientId, value });
      if (!res.ok) {
        setInvalid(true);
        toast.error(`${name}: ${res.error}`);
        return;
      }
      setInvalid(false);
      toast.success(res.data.value === null ? `${name}: eşik silindi` : `${name}: eşik kaydedildi`);
    });
  }

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <NumberInput
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
        }}
        aria-label={`${name} kritik eşiği (${unit})`}
        aria-invalid={invalid ? true : undefined}
        placeholder="Yok"
        disabled={pending}
        className="w-20"
      />
      <span className="w-11 shrink-0 text-[12px] text-ink-mute">{unit}</span>
      {dirty ? (
        <Button type="submit" variant="secondary" size="xs" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      ) : null}
      {suggestion && suggestion !== value.trim() ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={pending}
          onClick={() => {
            setValue(suggestion);
            setInvalid(false);
          }}
          aria-label={`${name}: önerilen eşiği (${suggestion} ${unit}) alana yaz; kaydetmek için Kaydet'e basın`}
          className="tabular"
        >
          Öneri {suggestion}
        </Button>
      ) : null}
    </form>
  );
}
