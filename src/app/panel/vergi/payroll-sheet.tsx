"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { num } from "@/lib/format";
import { PAYROLL_EXTRAS_NOTE, PAYROLL_FULL_MONTH_NOTE, PAYROLL_NOTE } from "@/lib/tax/payroll";
import { cn } from "@/lib/utils";

type FieldKey = "net" | "gross" | "isciSgk" | "isciIssizlik" | "gvMatrah" | "cumBase" | "gvHesap" | "gvIstisna" | "gv" | "dv" | "isverenSgk" | "isverenIssizlik" | "extras" | "cost";

/** Ayın bordrosu: kişi kişi ve toplam (sunucuda kurulur, dialog-data.ts payrollSheetMonths) */
export interface PayrollSheetMonth {
  month: string;
  label: string;
  people: { name: string; values: Record<FieldKey, number> }[];
  total: Record<FieldKey, number>;
  /** Asgari ücret desteği (şartlı; anahtar kapalıysa 0) */
  support: number;
  /** Kullanılan oranlar */
  rates: string;
}

const ROWS: { key: FieldKey; label: string; strong?: boolean }[] = [
  { key: "net", label: "Net" },
  { key: "gross", label: "Brüt", strong: true },
  { key: "isciSgk", label: "İşçi SGK" },
  { key: "isciIssizlik", label: "İşsizlik" },
  { key: "gvMatrah", label: "GV matrahı" },
  { key: "cumBase", label: "Kümülatif matrah" },
  { key: "gvHesap", label: "Hesaplanan GV" },
  { key: "gvIstisna", label: "Asgari ücret istisnası" },
  { key: "gv", label: "GV" },
  { key: "dv", label: "DV" },
  { key: "isverenSgk", label: "İşveren SGK" },
  { key: "isverenIssizlik", label: "İşveren işsizlik" },
  { key: "extras", label: "Ek ödemeler" },
  { key: "cost", label: "Maliyet", strong: true },
];

/**
 * "Bordro dökümü" (§4.5-e): ay seçimi ve devrik tablo; satırlar alanlar, sütunlar kişiler ve "Toplam", ilk sütun
 * yapışkan. 2–4 kişi 390 px'te sığar, fazlası tablonun içinde yatay kayar (sayfa kaymaz).
 */
export function PayrollButton({ months, month, label = "Bordro dökümü", className }: { months: PayrollSheetMonth[]; month?: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!months.length) return null;
  return (
    <>
      <Button variant="secondary" size="sm" className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <PayrollDialog months={months} initial={month} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PayrollDialog({ months, initial, onClose }: { months: PayrollSheetMonth[]; initial?: string; onClose: () => void }) {
  const id = useId();
  const [month, setMonth] = useState(() => (initial && months.some((m) => m.month === initial) ? initial : months[0].month));
  const m = months.find((x) => x.month === month) ?? months[0];
  const rows = ROWS.filter((r) => r.key !== "extras" || m.total.extras !== 0);
  const cell = "px-1.5 py-1.5 text-right whitespace-nowrap tabular sm:px-2";
  // Hücrelerde ₺ yazılmaz (başlıkta): 2–4 kişi 390 px'te sığsın
  const amount = (v: number) => num(v, 2, 2);
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Bordro dökümü"
      description="Netten brüte, 2026 yasal oranlarıyla; kişi kişi."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Kapat
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Ay" htmlFor={`${id}-ay`}>
          <Select id={`${id}-ay`} value={month} onChange={(e) => setMonth(e.target.value)} className="pointer-coarse:h-12">
            {months.map((x) => (
              <option key={x.month} value={x.month}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="scroll-thin overflow-x-auto rounded-2xl bg-surface ring-1 ring-line">
          <table className="w-full border-collapse text-xs sm:text-[13px]">
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-1.5 py-2 text-left text-[11px] font-normal text-ink-mute sm:px-2">
                  ₺
                </th>
                {m.people.map((p) => (
                  <th key={p.name} scope="col" className="max-w-24 px-1.5 py-2 text-right font-semibold break-words text-ink sm:px-2">
                    {p.name}
                  </th>
                ))}
                <th scope="col" className="px-1.5 py-2 text-right font-semibold text-ink sm:px-2">
                  Toplam
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={cn("border-b border-line last:border-0", r.strong && "font-semibold")}>
                  <th scope="row" className={cn("sticky left-0 z-10 max-w-28 min-w-20 bg-surface px-1.5 py-1.5 text-left font-normal text-ink-mute sm:px-2", r.strong && "font-semibold text-ink")}>
                    {r.label}
                  </th>
                  {m.people.map((p) => (
                    <td key={p.name} className={cell}>
                      {amount(p.values[r.key])}
                    </td>
                  ))}
                  <td className={cn(cell, "bg-ink/[0.03]")}>{amount(m.total[r.key])}</td>
                </tr>
              ))}
              {m.support ? (
                <tr>
                  <th scope="row" className="sticky left-0 z-10 max-w-28 bg-surface px-1.5 py-1.5 text-left font-normal text-ink-mute sm:px-2">
                    Asgari ücret desteği (şartlı)
                  </th>
                  <td colSpan={m.people.length} />
                  <td className={cn(cell, "bg-ink/[0.03]")}>{amount(-m.support)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <ul className="space-y-1 text-xs leading-5 text-ink-mute">
          <li>{PAYROLL_NOTE}</li>
          <li>{m.rates}.</li>
          <li>{PAYROLL_FULL_MONTH_NOTE}.</li>
          {m.total.extras !== 0 ? <li>{PAYROLL_EXTRAS_NOTE}.</li> : null}
        </ul>
      </div>
    </Dialog>
  );
}
