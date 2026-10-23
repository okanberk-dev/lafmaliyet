"use client";

import { AlertTriangle } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import type { CountUnit } from "@/lib/calc/types";
import { COUNT_UNITS } from "@/lib/constants";
import {
  BASE_UNIT,
  cleanName,
  COUNT_ITEM_NAME_MAX,
  COUNT_ITEM_NAME_MIN,
  defaultPackageSize,
  formulaStartMessage,
  nameKey,
  readPackagePrice,
  startsLikeFormula,
} from "@/lib/count-item";
import { num } from "@/lib/format";

import { addCountItem } from "./actions";

/** Paket içeriğinin açıklaması, malzemenin birimine göre */
const SIZE_HINT: Record<CountUnit, string> = {
  KG: "Bir paket kaç gram (ör. 1 kg → 1000).",
  LT: "Bir paket kaç ml (ör. 750 ml şişe → 750).",
  ADET: "Bir pakette kaç adet (tek tek alınıyorsa 1).",
  "DİLİM": "Bir pakette kaç dilim (ör. 12 dilimlik pasta → 12).",
};

/** Sayım grubu ve grubun olağan sayım birimi (pencere bu birimle açılır) */
export interface CountItemGroup {
  name: string;
  unit: CountUnit;
}

/** Formun sunucuya gidecek değerleri (countItemSchema'nın girdisi; ayı çağıran ekler) */
export interface CountItemValues {
  name: string;
  group: string;
  countUnit: CountUnit;
  packageDesc: string | null;
  packageSize: number;
  /** "Paket fiyatı (₺, biliyorsanız)": boşsa null */
  packagePrice: number | null;
}

/**
 * "Listeye ekle" formunun durumu: Stok sayımı'ndaki pencere ve reçete önerisindeki "Yeni malzeme" aynı alanları ve
 * aynı denetimi kullanır (sunucu kuralı ortak: src/server/data/count-item.ts). `defaultGroup` yoksa sayımda ilk grup
 * seçili gelir; `requireGroup` iken grup boş başlar ve seçilmesi istenir (reçetede kalemin hangi grupta durduğu bilinmez).
 */
export function useCountItemForm({
  groups,
  defaultGroup,
  initialName = "",
  requireGroup = false,
  formId: givenId,
}: {
  groups: CountItemGroup[];
  defaultGroup: string | null;
  initialName?: string;
  requireGroup?: boolean;
  /** Formun kimliği pencerenin altbilgisindeki gönder düğmesi için dışarıdan verilebilir */
  formId?: string;
}) {
  const ownId = useId();
  const formId = givenId ?? ownId;
  const first = groups.find((g) => g.name === defaultGroup) ?? (requireGroup ? undefined : groups[0]);
  const [name, setNameValue] = useState(initialName);
  const [group, setGroup] = useState(first?.name ?? "");
  const [unit, setUnit] = useState<CountUnit>(first?.unit ?? "ADET");
  const [unitTouched, setUnitTouched] = useState(false);
  const [packageDesc, setPackageDesc] = useState("");
  const [size, setSizeValue] = useState(num(defaultPackageSize(first?.unit ?? "ADET")));
  const [sizeTouched, setSizeTouched] = useState(false);
  const [price, setPriceValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  function changeUnit(u: CountUnit) {
    setUnit(u);
    // Kullanıcı paket içeriğini yazmadıysa yeni birimin önerisi gelir (LT → 1000 ml, ADET → 1)
    if (!sizeTouched) setSizeValue(num(defaultPackageSize(u)));
  }

  const ids = { name: `${formId}-ad`, group: `${formId}-grup`, desc: `${formId}-paket`, size: `${formId}-icerik`, price: `${formId}-fiyat` };
  const focus = (id: string) => document.getElementById(id)?.focus();

  return {
    formId,
    ids,
    name,
    group,
    unit,
    packageDesc,
    size,
    price,
    error,
    nameError,
    groupError,
    sizeError,
    priceError,
    groups,
    setError,
    setName(v: string) {
      setNameValue(v);
      setNameError(null);
      setError(null);
    },
    pickGroup(name: string) {
      setGroup(name);
      setGroupError(null);
      // Birim elle seçilmediyse grubun olağan birimi gelir (şurup grubunda LT, ambalajda ADET)
      const g = groups.find((x) => x.name === name);
      if (g && !unitTouched) changeUnit(g.unit);
    },
    chooseUnit(u: CountUnit) {
      setUnitTouched(true);
      changeUnit(u);
    },
    setPackageDesc,
    setSize(v: string) {
      setSizeValue(v);
      setSizeTouched(true);
      setSizeError(null);
    },
    setPrice(v: string) {
      setPriceValue(v);
      setPriceError(null);
    },
    focusName: () => focus(ids.name),
    /** Alanları denetler; sorun varsa ilkine odaklanır ve null döner */
    validate(): CountItemValues | null {
      const clean = cleanName(name);
      if (clean.length < COUNT_ITEM_NAME_MIN || startsLikeFormula(clean)) {
        setNameError(!clean ? "Kalemin adını yazın" : clean.length < COUNT_ITEM_NAME_MIN ? `Ad en az ${COUNT_ITEM_NAME_MIN} harf olmalı` : formulaStartMessage("Ad"));
        focus(ids.name);
        return null;
      }
      if (!group) {
        setGroupError("Sayım grubunu seçin");
        focus(ids.group);
        return null;
      }
      const packageSize = parseNumberTR(size);
      if (packageSize === null || !(packageSize > 0)) {
        setSizeError("Paket içeriğini 0'dan büyük bir sayı olarak yazın");
        focus(ids.size);
        return null;
      }
      const packagePrice = readPackagePrice(price);
      if (packagePrice.error) {
        setPriceError(packagePrice.error);
        focus(ids.price);
        return null;
      }
      return { name: clean, group, countUnit: unit, packageDesc: packageDesc.trim() || null, packageSize, packagePrice: packagePrice.value };
    },
  };
}

export type CountItemForm = ReturnType<typeof useCountItemForm>;

/**
 * "Listeye ekle" alanları: ad, grup, sayım birimi, paket, paket içeriği ve isteğe bağlı paket fiyatı. Paket fiyatı
 * yalnız yazılır: pencere kayıtlı bir fiyat göstermez (personel kaydettiği fiyatı bir daha görmez). `nameNotice` adın altındaki
 * hatanın yerine geçer (ör. "zaten sayım listesinde", "listede var · Onu seç").
 */
export function CountItemFields({ form, nameNotice, priceHint, autoFocusName = true }: { form: CountItemForm; nameNotice?: ReactNode; priceHint: string; autoFocusName?: boolean }) {
  const base = BASE_UNIT[form.unit];
  const shownNameError = nameNotice ?? form.nameError;
  return (
    <>
      {form.error ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] leading-5 text-bad">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {form.error}
        </p>
      ) : null}
      <Field label="Ad" htmlFor={form.ids.name} error={shownNameError}>
        <Input
          id={form.ids.name}
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          maxLength={COUNT_ITEM_NAME_MAX}
          placeholder="ör. Çilek şurubu"
          autoComplete="off"
          aria-invalid={shownNameError ? true : undefined}
          data-autofocus={autoFocusName ? "always" : undefined}
        />
      </Field>
      <Field label="Grup" htmlFor={form.ids.group} error={form.groupError}>
        <Select id={form.ids.group} value={form.group} onChange={(e) => form.pickGroup(e.target.value)} aria-invalid={form.groupError ? true : undefined}>
          {!form.group ? <option value="">Sayım grubu seçin…</option> : null}
          {form.groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sayım birimi" hint="Şişe ya da kutu tane tane sayılıyorsa ADET; açık şişe litreyle sayılıyorsa LT.">
        <Segmented<CountUnit> label="Sayım birimi" value={form.unit} onChange={form.chooseUnit} options={COUNT_UNITS.map((u) => ({ value: u, label: u }))} stretch />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paket (isteğe bağlı)" htmlFor={form.ids.desc}>
          <Input
            id={form.ids.desc}
            value={form.packageDesc}
            onChange={(e) => form.setPackageDesc(e.target.value)}
            maxLength={160}
            placeholder="ör. 750 ml şişe"
            autoComplete="off"
          />
        </Field>
        <Field label={`Paket içeriği (${base})`} htmlFor={form.ids.size} error={form.sizeError} hint={SIZE_HINT[form.unit]}>
          <NumberInput id={form.ids.size} value={form.size} onChange={(e) => form.setSize(e.target.value)} aria-invalid={form.sizeError ? true : undefined} className="cell-input" />
        </Field>
      </div>
      <Field label="Paket fiyatı (₺, biliyorsanız)" htmlFor={form.ids.price} error={form.priceError} hint={priceHint}>
        <div className="relative sm:max-w-[calc(50%-0.375rem)]">
          <NumberInput
            id={form.ids.price}
            value={form.price}
            onChange={(e) => form.setPrice(e.target.value)}
            placeholder="ör. 760"
            aria-invalid={form.priceError ? true : undefined}
            className="cell-input pr-7"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
        </div>
      </Field>
    </>
  );
}

/**
 * Stok sayımı › "Listeye ekle": sayım listesine yeni kalem (personel de ekler). Kalem hemen hammadde olarak açılır ve
 * bu aydan itibaren her ay listede çıkar. Paket fiyatı isteğe bağlı: biliniyorsa yazılır (Tahmini kalır), bilinmiyorsa
 * yönetici Hammaddeler'den girer; pencere kayıtlı fiyat göstermez. Telefonda alttan açılan sayfa. Aynı ad bugünkü
 * listede varsa hemen söylenir; sunucu pasif ve "Sayılmaz" hammaddelere de bakar. Her açılışta temiz başlar (açılınca
 * bağlanır).
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
  groups: CountItemGroup[];
  /** Kullanıcının baktığı grup (süzgeç ya da ekrandaki grup) */
  defaultGroup: string | null;
  /** Arama kutusunda yazılan (bulunamayan) ad */
  initialName?: string;
  /** Gösterilen ayın sayım listesindeki adlar */
  listNames: string[];
  onClose: () => void;
  /** `existed`: kalem zaten vardı, daha sonraki bir aydan itibaren listedeydi; artık bu aydan itibaren de. `priced`: paket fiyatı yazıldı */
  onAdded: (item: { id: number; name: string; group: string; existed: boolean; priced: boolean }) => void;
}) {
  const form = useCountItemForm({ groups, defaultGroup, initialName });
  const [busy, setBusy] = useState(false);
  const inList = form.name.trim() ? listNames.find((n) => nameKey(n) === nameKey(form.name)) : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (inList) return form.focusName();
    const values = form.validate();
    if (!values) return;
    setBusy(true);
    form.setError(null);
    try {
      const res = await addCountItem({ month, ...values });
      if (!res.ok) return form.setError(res.error);
      onAdded(res.data);
    } catch {
      form.setError("Eklenemedi: bağlantı yok gibi. Bağlantı gelince yeniden deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title="Sayım listesine ekle"
      description="Kalem bu aydan itibaren her ay listede çıkar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} className="max-sm:h-11">
            Vazgeç
          </Button>
          <Button type="submit" form={form.formId} disabled={busy || !!inList} className="max-sm:h-11 max-sm:flex-1">
            {busy ? "Ekleniyor…" : "Listeye ekle"}
          </Button>
        </>
      }
    >
      <form id={form.formId} onSubmit={submit} className="space-y-4 pb-3" noValidate>
        <CountItemFields
          form={form}
          nameNotice={inList ? `“${inList}” zaten sayım listesinde.` : undefined}
          priceHint={isAdmin ? "KDV hariç yazın; bilmiyorsanız boş bırakın. Tahmini işaretli kalır." : "Fişteki gibi KDV dahil yazın; bilmiyorsanız boş bırakın, yönetici girer."}
        />
      </form>
    </Dialog>
  );
}
