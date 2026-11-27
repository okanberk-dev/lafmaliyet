"use client";

import { FileSpreadsheet } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

/**
 * Muhasebe › Muhasebeci paketi: ay seçimi ve indirme (düz bağlantı; /api/muhasebe/paket). Alıcılar ve "Şimdi gönder"
 * Ayarlar'da, yalnız yöneticide. Adres seçicinin değerinden değil listedeki ayın kendisinden kurulur. Şube seçiliyken
 * (`branch`) bağlantı o şubenin paketini indirir (`&sube=`; şube ayrımı parça 6), yanında bütün şubelerin paketi.
 */
export function PackageDownload({ months, branch = null }: { months: { month: string; title: string }[]; branch?: { id: string; name: string } | null }) {
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
      <a href={packageHref(picked?.month ?? "", branch?.id ?? null)} download className={buttonClass("secondary", "md")}>
        <FileSpreadsheet size={16} aria-hidden="true" /> {branch ? `Paketi indir · ${branch.name} (.xlsx)` : "Paketi indir (.xlsx)"}
      </a>
      {branch ? (
        <a href={packageHref(picked?.month ?? "", null)} download className={buttonClass("ghost", "md")}>
          Bütün şubeler (.xlsx)
        </a>
      ) : null}
    </div>
  );
}

/** Paketin indirme adresi: ay ve (şube seçiliyken) şube; aylık e-posta hep bütün şubeler */
export function packageHref(month: string, branchId: string | null): string {
  return `/api/muhasebe/paket?ay=${encodeURIComponent(month)}${branchId ? `&sube=${encodeURIComponent(branchId)}` : ""}`;
}
