"use client";

import { useId, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { parseNumberTR } from "@/lib/calc/expr";
import { money, num, tl } from "@/lib/format";
import { ASSET_KIND_LABELS, type AssetKind, type AssetMethod } from "@/lib/tax/assets";
import { ASSET_COST_OVER, ASSET_DIRECT_LIMIT, ASSET_LIFE_RANGE } from "@/lib/tax/edit";
import { deleteTaxAsset, saveTaxAsset } from "@/server/actions/tax";

/** Varlığa bağlanabilecek fatura (sunucuda kurulur, dialog-data.ts invoiceChoices) */
export interface InvoiceChoice {
  id: number;
  supplier: string;
  date: string;
  category: string;
  /** KDV hariç, iskonto düşülmüş */
  net: number;
  /** Varlıklara bağlanmamış kısım */
  remaining: number;
  /** Bu faturaya bağlı varlıklar (düzenlenen varlığın maliyeti kalana geri eklenir) */
  linked: { id: number; cost: number }[];
  /** "Tedarikçi · tarih · net" */
  label: string;
}

export interface AssetData {
  id: number;
  name: string;
  invoiceId: number | null;
  acquiredOn: string;
  cost: number;
  kind: AssetKind;
  method: AssetMethod;
  lifeYears: number | null;
  note: string | null;
}

const amountText = (v: number | null | undefined) => (v === null || v === undefined ? "" : Number.isInteger(Math.round(v * 100) / 100) ? num(v, 0) : num(v, 2, 2));

/**
 * "Varlık ekle" / "Varlık olarak ekle" / "Düzenle" düğmesi ve "Varlık" penceresi (plan docs/planlar/vergi.md §4.5-c).
 * Fatura seçilince edinme günü ve maliyet (faturanın kalanı) dolar; doğrudan gider yalnız VUK 313 sınırına kadar.
 */
export function AssetButton({
  label,
  invoices,
  asset,
  invoiceId,
  directLimit,
  today,
  variant = "secondary",
  size = "sm",
}: {
  label: string;
  invoices: InvoiceChoice[];
  asset?: AssetData;
  /** "Varlık olarak ekle": pencere bu faturayla açılır */
  invoiceId?: number;
  directLimit: number;
  today: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? <AssetDialog invoices={invoices} asset={asset} invoiceId={invoiceId} directLimit={directLimit} today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AssetDialog({
  invoices,
  asset,
  invoiceId,
  directLimit,
  today,
  onClose,
}: {
  invoices: InvoiceChoice[];
  asset?: AssetData;
  invoiceId?: number;
  directLimit: number;
  today: string;
  onClose: () => void;
}) {
  const formId = useId();
  /** Faturanın bu varlık için kalanı (düzenlenen varlığın kendi maliyeti geri eklenir) */
  const remainingFor = (c: InvoiceChoice) => Math.round((c.remaining + (asset ? (c.linked.find((l) => l.id === asset.id)?.cost ?? 0) : 0)) * 100) / 100;
  const preset = invoiceId !== undefined ? (invoices.find((i) => i.id === invoiceId) ?? null) : null;
  const [name, setName] = useState(asset?.name ?? preset?.supplier ?? "");
  const [invoice, setInvoice] = useState<string>(String(asset?.invoiceId ?? preset?.id ?? ""));
  const [acquiredOn, setAcquiredOn] = useState(asset?.acquiredOn ?? preset?.date ?? today);
  const [costText, setCostText] = useState(asset ? amountText(asset.cost) : preset ? amountText(remainingFor(preset)) : "");
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? "demirbas");
  const [method, setMethod] = useState<AssetMethod>(asset?.method ?? "amortisman");
  const [lifeText, setLifeText] = useState(asset?.lifeYears ? String(asset.lifeYears) : "");
  const [note, setNote] = useState(asset?.note ?? "");
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, run] = useActionTransition();

  const chosen = invoices.find((i) => String(i.id) === invoice) ?? null;
  const max = chosen ? remainingFor(chosen) : null;
  const cost = costText.trim() ? parseNumberTR(costText) : null;
  const life = lifeText.trim() ? Number(lifeText.trim()) : null;
  const directAllowed = cost === null || cost <= directLimit + 0.005;

  const nameError = tried && !name.trim() ? "Ad gerekli" : null;
  const dayError = tried && !acquiredOn ? "Günü seçin" : acquiredOn > today ? "Edinme günü bugünden sonra olamaz" : null;
  const costError =
    costText.trim() && cost === null
      ? "Sayı olarak yazın, ör. 12.000"
      : tried && (cost === null || cost <= 0)
        ? "Maliyet sıfırdan büyük olmalı"
        : cost !== null && max !== null && cost > max + 0.01
          ? ASSET_COST_OVER(max)
          : method === "dogrudan_gider" && !directAllowed
            ? ASSET_DIRECT_LIMIT
            : null;
  const lifeError = method === "amortisman" && lifeText.trim() && (life === null || !Number.isInteger(life) || life < 1 || life > 50) ? ASSET_LIFE_RANGE : null;

  function chooseInvoice(v: string) {
    setInvoice(v);
    const c = invoices.find((i) => String(i.id) === v);
    if (!c) return;
    setAcquiredOn(c.date);
    setCostText(amountText(remainingFor(c)));
    if (!name.trim()) setName(c.supplier);
  }

  function submit() {
    setTried(true);
    if (!name.trim() || !acquiredOn || dayError || costError || lifeError || cost === null || cost <= 0) return;
    const input = {
      id: asset?.id ?? null,
      name: name.trim(),
      invoiceId: chosen ? chosen.id : null,
      acquiredOn,
      cost,
      kind,
      method,
      lifeYears: method === "amortisman" ? life : null,
      note: note.trim() || null,
    };
    run(
      async () => {
        const r = await saveTaxAsset(input);
        if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
        onClose();
        toast.success(`${asset ? "Varlık kaydedildi" : "Varlık eklendi"}: ${input.name} · ${money(cost)}`);
      },
      { maybeSaved: !asset },
    );
  }

  function remove() {
    if (!asset) return;
    run(async () => {
      const r = await deleteTaxAsset(asset.id);
      if (!r.ok) return void toast.error(r.error, { duration: 10_000 });
      setConfirmDelete(false);
      onClose();
      toast.success(`Varlık kaldırıldı: ${asset.name}`);
    });
  }

  const big = "pointer-coarse:h-12 pointer-coarse:text-lg";
  return (
    <Dialog
      open
      onClose={() => !pending && onClose()}
      size="md"
      title={asset ? "Varlık" : "Varlık ekle"}
      description="Demirbaş ya da kiralanan yere yapılan özel maliyet (KDV hariç). Faturaya bağlanan tutar o faturanın giderinden düşer, amortismanla gider olur."
      footerStart={
        asset ? (
          <Button variant="ghost" className="text-bad" disabled={pending} onClick={() => setConfirmDelete(true)}>
            Kaldır
          </Button>
        ) : null
      }
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Ad" htmlFor={`${formId}-ad`} error={nameError}>
          <Input
            id={`${formId}-ad`}
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Espresso makinesi"
            aria-invalid={nameError ? true : undefined}
            disabled={pending}
            className={big}
          />
        </Field>
        <Field label="Fatura" htmlFor={`${formId}-fatura`} hint="İsteğe bağlı: son 18 ayın kafe faturaları (tedarikçi · tarih · net · kalan)">
          <Select id={`${formId}-fatura`} value={invoice} onChange={(e) => chooseInvoice(e.target.value)} disabled={pending} className="pointer-coarse:h-12">
            <option value="">Faturasız</option>
            {invoices.map((i) => (
              <option key={i.id} value={String(i.id)}>
                {i.label} · kalan {num(remainingFor(i), 2, 2)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Edinme günü" htmlFor={`${formId}-gun`} error={dayError}>
            <Input
              id={`${formId}-gun`}
              type="date"
              value={acquiredOn}
              max={today}
              onChange={(e) => setAcquiredOn(e.target.value)}
              aria-invalid={dayError ? true : undefined}
              disabled={pending}
              className={big}
            />
          </Field>
          <Field label="Maliyet (₺, KDV hariç)" htmlFor={`${formId}-maliyet`} error={costError} hint={max !== null ? `Faturanın kalanı en çok ${money(max)}` : undefined}>
            <NumberInput
              id={`${formId}-maliyet`}
              value={costText}
              onChange={(e) => setCostText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0"
              enterKeyHint="done"
              aria-invalid={costError ? true : undefined}
              disabled={pending}
              className={big}
            />
          </Field>
          <Field label="Tür" htmlFor={`${formId}-tur`}>
            <Select id={`${formId}-tur`} value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} disabled={pending} className="pointer-coarse:h-12">
              {(Object.keys(ASSET_KIND_LABELS) as AssetKind[]).map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Yöntem" htmlFor={`${formId}-yontem`} hint={`VUK 313: ${today.slice(0, 4)}'da ${tl(directLimit)}'yi aşmayan doğrudan gider yazılabilir`}>
            <Select id={`${formId}-yontem`} value={method} onChange={(e) => setMethod(e.target.value as AssetMethod)} disabled={pending} className="pointer-coarse:h-12">
              <option value="amortisman">Amortisman</option>
              <option value="dogrudan_gider" disabled={!directAllowed && method !== "dogrudan_gider"}>
                Doğrudan gider
              </option>
            </Select>
          </Field>
        </div>
        {method === "amortisman" ? (
          <Field label="Faydalı ömür (yıl)" htmlFor={`${formId}-omur`} error={lifeError} hint="Boş bırakılabilir. Muhasebecinizden öğrenin (VUK amortisman listesi); ömür girilmezse amortisman hesaplanmaz.">
            <NumberInput
              id={`${formId}-omur`}
              value={lifeText}
              onChange={(e) => setLifeText(e.target.value)}
              inputMode="numeric"
              placeholder="ör. 5"
              enterKeyHint="done"
              aria-invalid={lifeError ? true : undefined}
              disabled={pending}
              className={big}
            />
          </Field>
        ) : null}
        {kind === "ozel_maliyet" ? (
          <p className="-mt-1 text-xs text-ink-mute">Kiralanan yere yapılan dekorasyon özel maliyettir; ömrü kira süresine bağlıdır. Muhasebecinize sorun.</p>
        ) : null}
        <Field label="Not" htmlFor={`${formId}-not`}>
          <Input id={`${formId}-not`} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="İsteğe bağlı" disabled={pending} className={big} />
        </Field>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        pending={pending}
        title="Varlık kaldırılsın mı?"
        description={asset ? `${asset.name} listeden silinir; bağlı faturanın tutarı yeniden "varlık listesinde değil" sayılır.` : undefined}
        confirmLabel="Kaldır"
      />
    </Dialog>
  );
}
