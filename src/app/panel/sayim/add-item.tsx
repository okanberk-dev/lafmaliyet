"use client";

import { AlertTriangle } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import type { CountUnit } from "@/lib/calc/types";
import { COUNT_UNITS } from "@/lib/constants";
import { BASE_UNIT, cleanName, COUNT_ITEM_NAME_MAX, COUNT_ITEM_NAME_MIN, defaultPackageSize, formulaStartMessage, nameKey, startsLikeFormula } from "@/lib/count-item";
import { num } from "@/lib/format";

import { addCountItem } from "./actions";

/** Paket içeriğinin açıklaması, malzemenin birimine göre */
const SIZE_HINT: Record<CountUnit, string> = {
  KG: "Bir paket kaç gram (ör. 1 kg → 1000).",
  LT: "Bir paket kaç ml (ör. 750 ml şişe → 750).",
  ADET: "Bir pakette kaç adet (tek tek alınıyorsa 1).",
  "DİLİM": "Bir pakette kaç dilim (ör. 12 dilimlik pasta → 12).",
};

/**
 * Stok sayımı › "Listeye ekle": sayım listesine yeni kalem (personel de ekler). Kalem hemen hammadde olarak açılır ve
 * bu aydan itibaren her ay listede çıkar; fiyat alanı yok (yönetici Hammaddeler'den girer; KDV ve paket kuralları
 * orada). Telefonda alttan açılan sayfa. Aynı ad bugünkü listede varsa hemen söylenir; sunucu pasif ve "Sayılmaz"
 * hammaddelere de bakar. Her açılışta temiz başlar (açılınca bağlanır).
 */
export function AddCountItemDialog({
  isAdmin,
  month,
  groups,
  defaultGroup,
  initialName = "",
  listNames,
  onClose,
  onAdded,
}: {
  isAdmin: boolean;
  month: string;
  /** Sayım grupları listedeki sırayla, gruptaki kalemlerin çoğunun sayım birimiyle (önerilen birim) */
  groups: { name: string; unit: CountUnit }[];
  /** Kullanıcının baktığı grup (süzgeç ya da ekrandaki grup) */
  defaultGroup: string | null;
  /** Arama kutusunda yazılan (bulunamayan) ad */
  initialName?: string;
  /** Gösterilen ayın sayım listesindeki adlar */
  listNames: string[];
  onClose: () => void;
  /** `existed`: kalem zaten vardı, daha sonraki bir aydan itibaren listedeydi; artık bu aydan itibaren de */
  onAdded: (item: { id: number; name: string; group: string; existed: boolean }) => void;
}) {
  const formId = useId();
  const first = groups.find((g) => g.name === defaultGroup) ?? groups[0];
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState(first?.name ?? "");
  const [unit, setUnit] = useState<CountUnit>(first?.unit ?? "ADET");
  const [unitTouched, setUnitTouched] = useState(false);
  const [packageDesc, setPackageDesc] = useState("");
  const [size, setSize] = useState(num(defaultPackageSize(first?.unit ?? "ADET")));
  const [sizeTouched, setSizeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const base = BASE_UNIT[unit];
  const inList = name.trim() ? listNames.find((n) => nameKey(n) === nameKey(name)) : undefined;
  const shownNameError = inList ? `“${inList}” zaten sayım listesinde.` : nameError;

  function changeUnit(u: CountUnit) {
    setUnit(u);
    // Kullanıcı paket içeriğini yazmadıysa yeni birimin önerisi gelir (LT → 1000 ml, ADET → 1)
    if (!sizeTouched) setSize(num(defaultPackageSize(u)));
  }
  function pickGroup(name: string) {
    setGroup(name);
    // Birim elle seçilmediyse grubun olağan birimi gelir (şurup grubunda LT, ambalajda ADET)
    const g = groups.find((x) => x.name === name);
    if (g && !unitTouched) changeUnit(g.unit);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const clean = cleanName(name);
    if (clean.length < COUNT_ITEM_NAME_MIN || startsLikeFormula(clean)) {
      setNameError(!clean ? "Kalemin adını yazın" : clean.length < COUNT_ITEM_NAME_MIN ? `Ad en az ${COUNT_ITEM_NAME_MIN} harf olmalı` : formulaStartMessage("Ad"));
      document.getElementById(`${formId}-ad`)?.focus();
      return;
    }
    if (inList) return document.getElementById(`${formId}-ad`)?.focus();
    const packageSize = parseNumberTR(size);
    if (packageSize === null || !(packageSize > 0)) {
      setSizeError("Paket içeriğini 0'dan büyük bir sayı olarak yazın");
      document.getElementById(`${formId}-icerik`)?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await addCountItem({ month, name: clean, group, countUnit: unit, packageDesc: packageDesc.trim() || null, packageSize });
      if (!res.ok) return setError(res.error);
      onAdded(res.data);
    } catch {
      setError("Eklenemedi: bağlantı yok gibi. Bağlantı gelince yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title="Sayım listesine ekle"
      description={
        isAdmin
          ? "Kalem bu aydan itibaren her ay listede çıkar. Fiyatını Hammaddeler'den girin."
          : "Kalem bu aydan itibaren her ay listede çıkar. Fiyatını yönetici Hammaddeler'den girer."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="max-sm:h-11">
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy || !!inList} className="max-sm:h-11 max-sm:flex-1">
            {busy ? "Ekleniyor…" : "Listeye ekle"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4 pb-3" noValidate>
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] leading-5 text-bad">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <Field label="Ad" htmlFor={`${formId}-ad`} error={shownNameError}>
          <Input
            id={`${formId}-ad`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
              setError(null);
            }}
            maxLength={COUNT_ITEM_NAME_MAX}
            placeholder="ör. Çilek şurubu"
            autoComplete="off"
            aria-invalid={shownNameError ? true : undefined}
            data-autofocus="always"
          />
        </Field>
        <Field label="Grup" htmlFor={`${formId}-grup`}>
          <Select id={`${formId}-grup`} value={group} onChange={(e) => pickGroup(e.target.value)}>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sayım birimi" hint="Şişe ya da kutu tane tane sayılıyorsa ADET; açık şişe litreyle sayılıyorsa LT.">
          <Segmented<CountUnit>
            label="Sayım birimi"
            value={unit}
            onChange={(u) => {
              setUnitTouched(true);
              changeUnit(u);
            }}
            options={COUNT_UNITS.map((u) => ({ value: u, label: u }))}
            stretch
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paket (isteğe bağlı)" htmlFor={`${formId}-paket`}>
            <Input
              id={`${formId}-paket`}
              value={packageDesc}
              onChange={(e) => setPackageDesc(e.target.value)}
              maxLength={160}
              placeholder="ör. 750 ml şişe"
              autoComplete="off"
            />
          </Field>
          <Field label={`Paket içeriği (${base})`} htmlFor={`${formId}-icerik`} error={sizeError} hint={SIZE_HINT[unit]}>
            <NumberInput
              id={`${formId}-icerik`}
              value={size}
              onChange={(e) => {
                setSize(e.target.value);
                setSizeTouched(true);
                setSizeError(null);
              }}
              aria-invalid={sizeError ? true : undefined}
              className="cell-input"
            />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
