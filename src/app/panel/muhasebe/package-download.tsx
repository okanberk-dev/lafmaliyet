"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

/**
 * Muhasebe › Muhasebeci paketi: ay seçimi ve indirme (düz bağlantı; /api/muhasebe/paket). Alıcılar ve "Şimdi gönder"
 * Ayarlar'da, yalnız yöneticide. Adres seçicinin değerinden değil listedeki ayın kendisinden kurulur.
 */
export function PackageDownload({ months }: { months: { month: string; title: string }[] }) {
  const [month, setMonth] = useState(months[0]?.month ?? "");
  const picked = months.find((m) => m.month === month) ?? months[0] ?? null;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Ay" htmlFor="muhasebe-paket-ay" className="w-44">
        <Select id="muhasebe-paket-ay" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m.month} value={m.month}>
              {m.title}
            </option>
          ))}
        </Select>
      </Field>
      <a href={`/api/muhasebe/paket?ay=${encodeURIComponent(picked?.month ?? "")}`} download className={buttonClass("secondary", "md")}>
        <FileSpreadsheet size={16} aria-hidden="true" /> Paketi indir (.xlsx)
      </a>
    </div>
  );
}
