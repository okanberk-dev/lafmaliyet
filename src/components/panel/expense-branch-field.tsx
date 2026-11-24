"use client";

import { Field, Select } from "@/components/ui/form";
import { EXPENSE_SHARED } from "@/lib/branches";

/**
 * Giderin şube seçimi (docs/SUBE.md › Yazarken hangi şube): Aylık harcamalar ve cari "Faturası yok · gider yaz". Seçenekler
 * şubeler ve "İşletme geneli" (EXPENSE_SHARED). Varsayılan seçili şube; "Tümü"de görünür biçimde işletme geneli. `ask`
 * false ise (tek şube açık) seçim çizilmez, varsayılan gider.
 */
export interface ExpenseBranchChoice {
  options: { id: string; name: string }[];
  /** Yeni giderin varsayılanı: seçili şube; "Tümü"de işletme geneli */
  defaultId: string;
  ask: boolean;
}

/** Seçimin ekrandaki adı */
export function expenseBranchName(choice: ExpenseBranchChoice, id: string): string {
  return id === EXPENSE_SHARED ? "İşletme geneli" : (choice.options.find((b) => b.id === id)?.name ?? id);
}

export function ExpenseBranchField({
  id,
  choice,
  value,
  onChange,
  locked = null,
  className,
}: {
  id: string;
  choice: ExpenseBranchChoice;
  value: string;
  onChange: (v: string) => void;
  /** Değiştirilemiyorsa nedeni (alanın altında) */
  locked?: string | null;
  className?: string;
}) {
  // Kapanmış şubenin eski kaydı: seçenek listede kalır (kayıt şubesiz düşmesin)
  const known = value === EXPENSE_SHARED || choice.options.some((b) => b.id === value);
  return (
    <Field
      label="Şube"
      htmlFor={id}
      className={className}
      hint={locked ?? (value === EXPENSE_SHARED ? "İşletme geneli: her şubenin görünümünde bilgi olarak, Tümü'de bir kez sayılır." : undefined)}
    >
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={Boolean(locked)}>
        {choice.options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        {known ? null : <option value={value}>{value}</option>}
        <option value={EXPENSE_SHARED}>İşletme geneli</option>
      </Select>
    </Field>
  );
}
