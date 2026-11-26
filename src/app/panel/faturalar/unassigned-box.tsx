"use client";

import { Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Checkbox, Select } from "@/components/ui/form";
import { dateTR, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setInvoiceBranch } from "@/server/actions/invoices";
import type { UnassignedBox as BoxData } from "@/server/data/invoice-branch";

import { splitSupplier } from "./rules";

/**
 * "Şubesi seçilmemiş" kutusu (Faturalar, "Tümü"; docs/SUBE.md › Faturanın şubesi): şubesi seçilmemiş faturalar
 * tedarikçi tedarikçi, her grubun kanıta dayalı önerisi (tedarikçinin varsayılanı, o gün açık tek şube, tedarikçinin
 * öteki faturaları ya da kasadan ödemeleri). Öneri yazılmaz: "Uygula" ya da elle seçim yazar; "Tedarikçinin varsayılanı
 * da olsun" kartı da günceller, sonra gelen faturaları o şubeye düşer.
 */
export function UnassignedBox({ box, options }: { box: BoxData; options: { value: string; label: string }[] }) {
  const [pending, start] = useActionTransition();
  const [asDefault, setAsDefault] = useState(true);
  const [confirmAll, setConfirmAll] = useState(false);
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const suggestedGroups = box.groups.filter((g) => g.suggestion);
  const suggestedShown = suggestedGroups.reduce((a, g) => a + g.ids.length, 0);

  function apply(groups: { ids: number[]; value: string; supplierDefault: boolean }[]) {
    start(async () => {
      let changed = 0;
      for (const g of groups) {
        const r = await tryAction(() => setInvoiceBranch({ ids: g.ids, value: g.value, supplierDefault: g.supplierDefault }));
        if (!r) return;
        if (!r.ok) return void toast.error(r.error);
        changed += r.data.changed;
      }
      toast.success(`${num(changed)} faturanın şubesi seçildi`);
    });
  }

  if (!box.count) return null;
  return (
    <Card id="subesiz" className="mb-4 scroll-mt-20">
      <CardHeader
        icon={<Building2 />}
        title={`${num(box.count)} faturanın şubesi seçilmemiş`}
        description={`Tek şube seçiliyken görünmezler (${tl(box.total)}, KDV hariç). Öneriler yazılmaz: dokunduğunuzda yazılır.`}
        meta={
          suggestedShown ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirmAll(true)} disabled={pending}>
              Önerilenleri uygula ({num(suggestedShown)})
            </Button>
          ) : null
        }
      />
      <CardContent className="space-y-3 px-3 sm:px-5">
        <Checkbox checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} label="Seçilen şube tedarikçinin varsayılanı da olsun (yeni faturaları oraya gelir)" />
        <ul className="divide-y divide-line-strong/70" aria-busy={pending || undefined}>
          {box.groups.map((g) => {
            const s = g.suggestion;
            const first = g.invoices[g.invoices.length - 1];
            const last = g.invoices[0];
            return (
              <li key={`${g.supplier}|${g.ids[0]}`} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3", pending && "opacity-60")}>
                <span className="min-w-0 flex-1 basis-56">
                  <span className="block font-medium text-ink">{splitSupplier(g.supplier).base}</span>
                  <span className="block text-[13px] text-ink-mute tabular">
                    {num(g.ids.length)} fatura · {tl(g.total)} · {first.date === last.date ? dateTR(first.date) : `${dateTR(first.date)} – ${dateTR(last.date)}`}
                  </span>
                  {s ? (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
                      <Badge tone={s.kind === "gecmis" ? "gray" : "blue"}>Öneri: {label(s.value)}</Badge>
                      {s.reason}
                    </span>
                  ) : (
                    <span className="mt-1 block text-[13px] text-ink-mute">Kanıt yok ya da karışık: şubeyi seçin.</span>
                  )}
                </span>
                <span className="flex w-full items-center gap-2 sm:w-auto">
                  {s ? (
                    <Button size="sm" disabled={pending} onClick={() => apply([{ ids: g.ids, value: s.value, supplierDefault: asDefault && s.kind !== "tarih" }])}>
                      {label(s.value)} yap
                    </Button>
                  ) : null}
                  <Select
                    defaultValue=""
                    aria-label={`${splitSupplier(g.supplier).base}: şube seç`}
                    disabled={pending}
                    className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v) apply([{ ids: g.ids, value: v, supplierDefault: asDefault }]);
                    }}
                  >
                    <option value="" disabled>
                      {s ? "Başka şube…" : "Şube seç…"}
                    </option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </span>
              </li>
            );
          })}
        </ul>
        {box.groups.reduce((a, g) => a + g.ids.length, 0) < box.count ? (
          <p className="text-[13px] text-ink-mute">Kalanlar bunlar bitince görünür; listede “Şubesi seçilmemiş” süzgecinden de seçebilirsiniz.</p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        tone="primary"
        confirmLabel="Uygula"
        pending={pending}
        title={`${num(suggestedShown)} faturaya önerilen şube yazılsın mı?`}
        description={
          <ul className="space-y-1">
            {suggestedGroups.map((g) => (
              <li key={`${g.supplier}|${g.ids[0]}`}>
                {splitSupplier(g.supplier).base}: {num(g.ids.length)} fatura → {label(g.suggestion!.value)} <span className="text-ink-mute">({g.suggestion!.reason})</span>
              </li>
            ))}
          </ul>
        }
        onConfirm={() => {
          setConfirmAll(false);
          // Tarih kanıtı (o gün açık tek şube) tedarikçinin varsayılanını yazmaz: sonraki faturası başka şubeye gelebilir
          apply(suggestedGroups.map((g) => ({ ids: g.ids, value: g.suggestion!.value, supplierDefault: asDefault && g.suggestion!.kind !== "tarih" })));
        }}
      />
    </Card>
  );
}
