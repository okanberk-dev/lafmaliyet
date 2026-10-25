"use client";

import { useRouter } from "next/navigation";

import { ButtonLink } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

/**
 * Zayi sayfasının gün şeridi (dalga 10 §2.8): "Bugün · 24 Eki", "Dün · 23 Eki" ve "Önceki gün" seçicisi. Seçici yerel
 * tarih alanı değildir: izin verilen 13 günü listeleyen bir select ("22 Eki Per" … "10 Eki Cmt"); tek değişiklikte
 * o güne gider. Günler ve etiketler sunucudan gelir (iş günüyle).
 */
export function WasteDayStrip({
  date,
  today,
  yesterday,
  days,
}: {
  date: string;
  today: { day: string; label: string };
  yesterday: { day: string; label: string };
  /** Önceki günler: [gün, etiket] */
  days: { day: string; label: string }[];
}) {
  const router = useRouter();
  const inList = days.some((d) => d.day === date);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Gün">
      {[
        { ...today, name: "Bugün" },
        { ...yesterday, name: "Dün" },
      ].map((d) => (
        <ButtonLink key={d.day} href={`/panel/zayi?gun=${d.day}`} variant={d.day === date ? "primary" : "secondary"} size="sm" aria-current={d.day === date ? "page" : undefined}>
          {d.name} · {d.label}
        </ButtonLink>
      ))}
      <label className="sr-only" htmlFor="zayi-onceki-gun">
        Önceki gün
      </label>
      <Select
        id="zayi-onceki-gun"
        value={inList ? date : ""}
        onChange={(e) => {
          if (e.target.value) router.push(`/panel/zayi?gun=${e.target.value}`);
        }}
        className="h-11 w-auto min-w-36"
      >
        <option value="">Önceki gün</option>
        {days.map((d) => (
          <option key={d.day} value={d.day}>
            {d.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
