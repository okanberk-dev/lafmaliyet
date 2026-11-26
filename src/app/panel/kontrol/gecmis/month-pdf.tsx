"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/form";

/**
 * Kontrol geçmişi › Aylık PDF (yalnız yönetici; docs/KONTROL-LISTELERI.md › Aylık PDF): ay ve şube seçilir, PDF yeni
 * sekmede açılır (/api/kontrol/pdf). Düz bağlantı: rota dosyayı her istekte kayıtlardan çizer.
 */
export function MonthPdfLink({ months, branches, branch }: { months: { month: string; title: string }[]; branches: { id: string; name: string }[]; branch: string }) {
  const [month, setMonth] = useState(months[0]?.month ?? "");
  const [sube, setSube] = useState(branch);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Ay" value={month} onChange={(e) => setMonth(e.target.value)} className="w-36">
        {months.map((m) => (
          <option key={m.month} value={m.month}>
            {m.title}
          </option>
        ))}
      </Select>
      {branches.length > 1 ? (
        <Select aria-label="Şube" value={sube} onChange={(e) => setSube(e.target.value)} className="w-36">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      ) : null}
      <a href={`/api/kontrol/pdf?ay=${month}&sube=${encodeURIComponent(sube)}`} target="_blank" rel="noopener" className={buttonClass("secondary", "md")}>
        <FileDown size={16} aria-hidden="true" /> Aylık PDF
      </a>
    </div>
  );
}
