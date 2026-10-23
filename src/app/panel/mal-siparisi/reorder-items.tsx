"use client";

import { ClipboardPen, Plus, Settings2, Timer, Truck } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { matches } from "@/components/ui/filters";
import { Field, Input, NumberInput, SearchInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, num, tl } from "@/lib/format";
import { coverDays, suggestedLevels } from "@/lib/reorder/levels";
import { bulkPrice, bulkUnit } from "@/lib/supplier-prices";
import { cn } from "@/lib/utils";
import { restoreReorderItem, saveReorderItem, saveReorderSettings, setLeadDays, trackIngredients, untrackIngredient } from "@/server/actions/reorder";
import type { ItemGroupView, ItemView, ReorderItemsView } from "@/server/data/reorder";

const WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const SOURCE_LABEL = { elle: "seçildi", "son-alinan": "son alınan", hammadde: "Hammaddeler'deki" } as const;

/** Günlük kullanım okunur birimde: 2689 ml → "2,7 L" */
function perDayText(perDay: number, baseUnit: ItemView["baseUnit"]): string {
  const b = bulkUnit(baseUnit);
  return `${num(perDay / b.scale, perDay / b.scale < 10 ? 1 : 0)} ${b.per}`;
}

/** Sayım biriminde yazılan sayı: boş null; okunamazsa undefined */
function readNumber(raw: string): number | null | undefined {
  if (!raw.trim()) return null;
  return parseNumberTR(raw) ?? undefined;
}

/**
 * Kalemler ekranı: sayım günleri ve ayarlar, takip edilen kalemler tedarikçi tedarikçi (dokununca düzenleme), takibe
 * önerilenler ve arama. Hedef ve birimin içeriği sayım biriminde yazılır, malzemenin kendi biriminde saklanır.
 */
export function ReorderItemsClient({ view }: { view: ReorderItemsView }) {
  const [editing, setEditing] = useState<ItemView | null>(null);
  const [leadGroup, setLeadGroup] = useState<ItemGroupView | null>(null);
  // Sayfadan çıkılınca (Activity sayfayı gizler) açık pencere kapanır
  useLayoutEffect(
    () => () => {
      setEditing(null);
      setLeadGroup(null);
    },
    [],
  );
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <div className="xl:col-start-2 xl:row-start-1">
        <SettingsCard view={view} />
      </div>
      <div className="xl:col-start-1 xl:row-span-2 xl:row-start-1">
        <TrackedCard view={view} onEdit={setEditing} onLead={setLeadGroup} />
      </div>
      <div className="xl:col-start-2 xl:row-start-2">
        <AddCard view={view} />
      </div>
      {editing ? <EditDialog item={editing} view={view} onClose={() => setEditing(null)} /> : null}
      {leadGroup ? <LeadDialog group={leadGroup} onClose={() => setLeadGroup(null)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- Ayarlar

function SettingsCard({ view }: { view: ReorderItemsView }) {
  const s = view.settings;
  const [days, setDays] = useState<number[]>(s.countWeekdays);
  const [margin, setMargin] = useState(num(s.marginPct * 100, 1));
  const [lead, setLead] = useState(String(s.defaultLeadDays));
  const [signature, setSignature] = useState(s.signature);
  const [pending, start] = useTransition();
  const toggle = (d: number) => setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d].sort((a, b) => a - b)));
  const marginValue = parseNumberTR(margin);
  const leadValue = readNumber(lead);
  const marginBad = marginValue === null || marginValue < 0 || marginValue > 100;
  const leadBad = leadValue === undefined || leadValue === null || !Number.isInteger(leadValue) || leadValue < 0 || leadValue > 30;
  const save = () =>
    start(async () => {
      if (marginBad || leadBad || !signature.trim()) return void toast.error("Ayarları kontrol edin: pay %0–100, teslim 0–30 gün, mesajdaki ad gerekli");
      const res = await saveReorderSettings({ countWeekdays: days, marginPct: marginValue! / 100, defaultLeadDays: leadValue!, signature: signature.trim() });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Sipariş ayarları kaydedildi");
    });
  return (
    <Card>
      <CardHeader icon={<Settings2 />} title="Ayarlar" />
      <CardContent className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Sayım günleri</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((label, i) => {
              const on = days.includes(i + 1);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(i + 1)}
                  className={cn(
                    "h-9 min-w-11 cursor-pointer rounded-xl px-2.5 text-[13px] font-medium ring-1 ring-inset transition-colors pointer-coarse:h-11",
                    on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-mute ring-line-strong hover:text-ink",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-mute">
            Hızlı sayım bu günlerde hatırlatılır (Bugün ekranı ve telefon bildirimi). Sipariş bir sonraki sayıma kadar yetecek kadar önerilir: {num(coverDays(days))} gün.
          </p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Field label="Emniyet payı (%)" htmlFor="mp-margin" hint="Günlük kullanımın üstüne eklenir: satış dalgalanır, teslim gecikebilir." error={marginBad ? "0 ile 100 arasında yazın" : undefined}>
            <NumberInput id="mp-margin" value={margin} onChange={(e) => setMargin(e.target.value)} aria-invalid={marginBad || undefined} />
          </Field>
          <Field label="Teslim süresi (gün)" htmlFor="mp-lead" hint="Kalemde ya da tedarikçide yazılmamışsa." error={leadBad ? "0 ile 30 arasında tam gün yazın" : undefined}>
            <NumberInput id="mp-lead" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} aria-invalid={leadBad || undefined} />
          </Field>
        </div>
        <Field label="Mesajdaki ad" htmlFor="mp-signature" hint={`WhatsApp mesajında “Merhaba, ${signature.trim() || "…"} siparişimiz:” diye geçer.`}>
          <Input id="mp-signature" value={signature} maxLength={60} onChange={(e) => setSignature(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Takip edilen kalemler

function TrackedCard({ view, onEdit, onLead }: { view: ReorderItemsView; onEdit: (i: ItemView) => void; onLead: (g: ItemGroupView) => void }) {
  return (
    <Card>
      <CardHeader
        icon={<ClipboardPen />}
        title="Takip edilen kalemler"
        meta={`${num(view.count)} kalem`}
        description="10–15 kritik kalem yeterli: çabuk biten, pahalı ya da tedarikçisi geç getiren."
      />
      <p className="px-5 pb-3 text-xs leading-5 text-ink-mute">
        {view.basis
          ? `Günlük kullanım: ${view.basis.label} (ModPOS + online) ve kayıtlı zayi / ikram; ayda ${num(view.basis.standardDays)} açık güne göre, 30 güne bölündü. Tutarlılık'taki beklenen tüketimle aynı hesap.`
          : "Satış verisi yok: hedefleri elle girin."}
      </p>
      {view.groups.length ? (
        <div className="border-t border-line">
          {view.groups.map((g) => (
            <section key={g.key ?? "atanmamis"} className="border-b border-line last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-surface/50 px-5 py-2">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <Truck size={15} className="text-ink-mute" aria-hidden="true" />
                  {g.name ?? "Tedarikçisi seçilmemiş"}
                  {g.key ? <span className="font-normal text-ink-mute">· teslim {num(g.lead)} gün</span> : null}
                </h3>
                {g.key ? (
                  <Button variant="ghost" size="xs" onClick={() => onLead(g)}>
                    <Timer size={14} aria-hidden="true" /> Teslim süresi
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((i) => (
                  <li key={i.ingredientId}>
                    <ItemRow item={i} onEdit={() => onEdit(i)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="border-t border-line px-5 py-6 text-sm text-ink-mute">Henüz kalem seçilmedi; aşağıdan ya da aramadan ekleyin.</p>
      )}
    </Card>
  );
}

function ItemRow({ item: i, onEdit }: { item: ItemView; onEdit: () => void }) {
  const amount = (v: number | null) => (v === null ? "–" : `${num(v, 1)} ${i.countUnit ?? ""}`.trim());
  const unitSize = i.saved.orderUnitCount ?? i.defaults.orderUnitCount;
  const unit = i.saved.orderUnit ?? i.defaults.orderUnit;
  const who = i.supplier ? `${i.supplier.name}${i.supplier.source === "elle" ? "" : ` · ${SOURCE_LABEL[i.supplier.source]}`}` : null;
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn("flex w-full cursor-pointer items-start gap-3 px-5 py-3 text-left hover:bg-surface/60 focus-visible:bg-surface/60 focus-visible:outline-none", !i.live && "opacity-60")}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-medium break-words text-ink">
          {i.name}
          {i.saved.parCount !== null ? <Badge tone="blue">Elle</Badge> : null}
          {!i.supplier ? <Badge tone="amber">Tedarikçi seçilmedi</Badge> : null}
          {!i.live ? <Badge tone="gray">{i.inactiveReason === "pasif" ? "Pasif" : "Sayılmaz"}: takipten çıkarın</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs break-words text-ink-mute tabular">
          {i.perDay !== null && i.perDay > 0
            ? [`Günde ~${perDayText(i.perDay, i.baseUnit)}`, `en az ${amount(i.minCount)}`, `1 ${unit} = ${amount(unitSize)}`, who].filter(Boolean).join(" · ")
            : ["Satış verisi yok · hedef elle", `1 ${unit} = ${amount(unitSize)}`, who].filter(Boolean).join(" · ")}
        </span>
        {i.missingSupplier ? <span className="mt-0.5 block text-xs text-warn">“{i.missingSupplier}” adlı tedarikçi bulunamadı; yeniden seçin.</span> : null}
      </span>
      <span className="shrink-0 text-right text-sm font-semibold text-ink tabular">{i.parCount !== null ? `Hedef ${amount(i.parCount)}` : <span className="font-normal text-ink-mute">Hedef yok</span>}</span>
    </button>
  );
}

// ---------------------------------------------------------------- Düzenleme

function EditDialog({ item: i, view, onClose }: { item: ItemView; view: ReorderItemsView; onClose: () => void }) {
  const [supplier, setSupplier] = useState(i.supplier?.source === "elle" ? i.supplier.key : "");
  const [orderName, setOrderName] = useState(i.saved.orderName ?? "");
  const [orderUnit, setOrderUnit] = useState(i.saved.orderUnit ?? "");
  const [unitCount, setUnitCount] = useState(i.saved.orderUnitCount !== null ? num(i.saved.orderUnitCount, 3) : "");
  const [lead, setLead] = useState(i.saved.leadDays !== null ? String(i.saved.leadDays) : "");
  const [par, setPar] = useState(i.saved.parCount !== null ? num(i.saved.parCount, 2) : "");
  const [pending, start] = useTransition();
  const cu = i.countUnit ?? "";
  const amount = (v: number | null) => (v === null ? "–" : `${num(v, 1)} ${cu}`.trim());

  const leadValue = readNumber(lead);
  const leadBad = leadValue === undefined || (leadValue !== null && (!Number.isInteger(leadValue) || leadValue < 0 || leadValue > 60));
  const parValue = readNumber(par);
  const parBad = parValue === undefined || (parValue !== null && parValue < 0);
  const unitValue = readNumber(unitCount);
  const unitBad = unitValue === undefined || (unitValue !== null && unitValue <= 0);
  // Öneri, yazılan teslim süresiyle canlı
  const effLead = !leadBad && leadValue !== null ? leadValue : i.defaults.leadDays;
  const levels = suggestedLevels({
    perDay: i.perDay,
    leadDays: effLead,
    coverDays: view.coverDays,
    marginPct: view.settings.marginPct,
    countUnit: cu || "ADET",
    countFactor: i.countFactor,
  });
  const suggestion = levels ? levels.par / i.countFactor : null;
  const min = levels ? levels.min / i.countFactor : null;

  const sellerKeys = new Set(i.sellers.map((x) => x.key));
  const others = view.suppliers.filter((x) => !sellerKeys.has(x.key));
  // Seçili tedarikçi listelerde yoksa (kartsız, mal faturası olmayan) yine seçili görünsün
  const current = i.supplier?.source === "elle" && !sellerKeys.has(i.supplier.key) && !others.some((x) => x.key === i.supplier!.key) ? i.supplier : null;
  const d = i.defaults.supplier;
  const defaultLabel = d ? `Varsayılan: ${d.name} (${d.source === "son-alinan" ? "son alınan" : "Hammaddeler'deki tedarikçi"}${d.date ? `, ${dateTR(d.date)}` : ""})` : "Varsayılan: seçilmemiş";

  const save = () =>
    start(async () => {
      if (leadBad || parBad || unitBad) return void toast.error("İşaretli alanları düzeltin");
      const res = await saveReorderItem({
        ingredientId: i.ingredientId,
        supplierKey: supplier || null,
        leadDays: leadValue ?? null,
        parCount: parValue ?? null,
        orderName: orderName.trim() || null,
        orderUnit: orderUnit.trim() || null,
        orderUnitCount: unitValue ?? null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${i.name} kaydedildi`);
      onClose();
    });

  const untrack = () =>
    start(async () => {
      const res = await untrackIngredient(i.ingredientId);
      if (!res.ok) return void toast.error(res.error);
      onClose();
      const snapshot = res.data;
      toast.success(`${i.name} takipten çıktı`, {
        action: {
          label: "Geri al",
          onClick: async () => {
            const r = await restoreReorderItem(snapshot);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${i.name} yeniden takipte`);
          },
        },
      });
    });

  return (
    <Dialog
      open
      onClose={onClose}
      title={i.name}
      description={`${i.packageDesc ? `${i.packageDesc} · ` : ""}sayım birimi ${cu || "yok"}`}
      footerStart={
        <Button variant="ghost" onClick={untrack} disabled={pending} className="text-bad hover:bg-bad-soft hover:text-bad">
          Takipten çıkar
        </Button>
      }
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {!i.live ? (
          <p className="rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn" role="status">
            {i.inactiveReason === "pasif" ? "Hammadde pasif" : "Hammadde “Sayılmaz”"}: hızlı sayımda ve sipariş listesinde çıkmaz. Takipten çıkarın ya da{" "}
            <Link href={`/panel/hammaddeler?ara=${encodeURIComponent(i.name)}`} onNavigate={onClose} className="font-semibold underline-offset-2 hover:underline">
              Hammaddeler&apos;den
            </Link>{" "}
            açın.
          </p>
        ) : null}
        <Field label="Tedarikçi" htmlFor="mp-supplier" hint={i.missingSupplier ? `“${i.missingSupplier}” adlı tedarikçi bulunamadı; yeniden seçin.` : undefined}>
          <Select id="mp-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">{defaultLabel}</option>
            {current ? <option value={current.key}>{current.name}</option> : null}
            {i.sellers.length ? (
              <optgroup label="Bu kalemi satanlar">
                {i.sellers.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name} · son {dateTR(x.date)} · {bulkPrice(x.unitPrice, i.baseUnit)}
                    {x.cheapest ? " · en ucuz" : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length ? (
              <optgroup label="Diğer tedarikçiler">
                {others.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </Field>
        <Field label="Tedarikçideki adı" htmlFor="mp-order-name" hint="WhatsApp mesajında bu ad yazılır.">
          <Input id="mp-order-name" value={orderName} maxLength={120} placeholder={i.defaults.orderName} onChange={(e) => setOrderName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sipariş birimi" htmlFor="mp-order-unit">
            <Input id="mp-order-unit" value={orderUnit} maxLength={30} placeholder={i.defaults.orderUnit} onChange={(e) => setOrderUnit(e.target.value)} />
          </Field>
          <Field label="1 birim =" htmlFor="mp-unit-count" error={unitBad ? "0'dan büyük bir sayı" : undefined}>
            <div className="relative">
              <NumberInput
                id="mp-unit-count"
                value={unitCount}
                placeholder={num(i.defaults.orderUnitCount, 3)}
                onChange={(e) => setUnitCount(e.target.value)}
                aria-invalid={unitBad || undefined}
                className="pr-14"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">{cu}</span>
            </div>
          </Field>
          <p className="col-span-2 -mt-1 text-xs text-ink-mute">
            {i.lastLine
              ? `Son faturada: ${num(i.lastLine.quantity, 2)} ${i.lastLine.unit ?? "birim"}, 1 ${i.lastLine.unit ?? "birim"} = ${amount(i.lastLine.factorCount)}`
              : i.packageDesc
                ? `Paket: ${i.packageDesc}`
                : "Faturada bu kalem yok; birimi ve içeriğini yazın."}
          </p>
        </div>
        <Field
          label="Teslim süresi (gün)"
          htmlFor="mp-item-lead"
          error={leadBad ? "0 ile 60 arasında tam gün yazın" : undefined}
          hint={`Boşsa ${i.defaults.leadFrom === "tedarikci" && i.supplier ? `${i.supplier.name} kalemlerinden` : "genel ayardan"}: ${num(i.defaults.leadDays)} gün`}
        >
          <NumberInput id="mp-item-lead" inputMode="numeric" value={lead} placeholder={String(i.defaults.leadDays)} onChange={(e) => setLead(e.target.value)} aria-invalid={leadBad || undefined} />
        </Field>
        <Field
          label="Hedef stok"
          htmlFor="mp-par"
          error={parBad ? "0 ya da daha büyük bir sayı yazın" : undefined}
          hint={
            suggestion !== null && i.perDay !== null
              ? `Öneri: ${amount(suggestion)} = günde ${perDayText(i.perDay, i.baseUnit)} × (${num(effLead)} gün teslim + ${num(view.coverDays)} gün sayım aralığı) × ${num(1 + view.settings.marginPct, 2)}. Boş bırakılırsa öneri kullanılır.`
              : "Satış verisi yok: hedefi elle girin."
          }
        >
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <NumberInput
                id="mp-par"
                value={par}
                placeholder={suggestion !== null ? num(suggestion, 1) : ""}
                onChange={(e) => setPar(e.target.value)}
                aria-invalid={parBad || undefined}
                className="pr-14"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-mute">{cu}</span>
            </div>
            {par ? (
              <Button variant="ghost" size="sm" onClick={() => setPar("")}>
                Öneriyi kullan
              </Button>
            ) : null}
          </div>
        </Field>
        <p className="text-[13px] text-ink-soft">{min !== null ? `En az: ${amount(min)}. Eldeki bunun altına inince listede “Az kaldı” yazar.` : "En az: satış verisi olmadan hesaplanmaz."}</p>
      </div>
    </Dialog>
  );
}

function LeadDialog({ group, onClose }: { group: ItemGroupView; onClose: () => void }) {
  const [raw, setRaw] = useState(String(group.lead));
  const [pending, start] = useTransition();
  const v = readNumber(raw);
  const bad = v === undefined || v === null || !Number.isInteger(v) || v < 0 || v > 60;
  const save = () =>
    start(async () => {
      if (bad) return;
      const res = await setLeadDays({ ingredientIds: group.items.map((i) => i.ingredientId), leadDays: v! });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${group.name}: teslim ${num(v!)} gün`);
      onClose();
    });
  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${group.name}: teslim süresi`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={save} disabled={pending || bad}>
            Kaydet
          </Button>
        </>
      }
    >
      <Field label="Teslim süresi (gün)" htmlFor="mp-group-lead" hint={`Bu tedarikçinin ${num(group.items.length)} kalemine yazılır.`} error={bad ? "0 ile 60 arasında tam gün yazın" : undefined} className="pb-2">
        <NumberInput id="mp-group-lead" inputMode="numeric" data-autofocus="always" value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </Field>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Eklenebilecek kalemler

const SEARCH_LIMIT = 8;

function AddCard({ view }: { view: ReorderItemsView }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const add = (ids: number[]) =>
    start(async () => {
      const res = await trackIngredients(ids);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${num(res.data.added)} kalem eklendi`);
    });
  const results = q.trim() ? view.addable.filter((a) => matches(`${a.name} ${a.packageDesc ?? ""}`, q)).slice(0, SEARCH_LIMIT) : [];
  return (
    <Card>
      <CardHeader
        icon={<Plus />}
        title="Eklenebilecek kalemler"
        description="Ayda en çok tutan, sayım birimi olan ve henüz takip edilmeyen kalemler (satış ve reçeteye göre)."
        actions={
          view.suggestions.length ? (
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => add(view.suggestions.map((x) => x.id))} className="text-ink">
              Hepsini ekle ({num(view.suggestions.length)})
            </Button>
          ) : undefined
        }
      />
      {view.suggestions.length ? (
        <ul className="divide-y divide-line border-t border-line">
          {view.suggestions.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-5 py-2">
              <span className="min-w-0 flex-1 text-sm break-words text-ink">
                {x.name}
                <span className="text-ink-mute tabular"> · {x.monthly !== null ? `ayda ~${tl(x.monthly)}` : "fiyatı girilmemiş"}</span>
              </span>
              <Button variant="secondary" size="sm" disabled={pending} onClick={() => add([x.id])} className="text-ink">
                Ekle
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-5 py-3 text-[13px] text-ink-mute">{view.basis ? "Satışı olan bütün kalemler takipte." : "Satış verisi yok: aşağıdan arayıp ekleyin."}</p>
      )}
      <div className="space-y-2 border-t border-line px-5 py-4">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hammadde ara" aria-label="Takibe eklenecek hammaddeyi ara" />
        {results.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {results.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3.5 py-2">
                <span className="min-w-0 flex-1 text-sm break-words text-ink">
                  {a.name}
                  <span className="text-xs text-ink-mute"> · {a.countUnit}</span>
                </span>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => add([a.id])} className="text-ink">
                  Ekle
                </Button>
              </li>
            ))}
          </ul>
        ) : q.trim() ? (
          <p className="text-[13px] text-ink-mute">Eşleşen kalem yok.</p>
        ) : null}
        <p className="text-xs text-ink-mute">
          Listede yoksa{" "}
          <Link href="/panel/hammaddeler" className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
            Hammaddeler&apos;den
          </Link>{" "}
          sayım birimi seçin.
        </p>
      </div>
    </Card>
  );
}
