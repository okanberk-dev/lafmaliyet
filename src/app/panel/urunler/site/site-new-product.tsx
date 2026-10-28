"use client";

import { Globe, Info } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { cleanName } from "@/lib/count-item";
import { tl } from "@/lib/format";
import { pendingProposalIssue } from "@/lib/recipe-change";
import { CATEGORY_SOURCE_TEXT, NEW_FROM_SITE_PENDING_THEN, newFromSiteTaken, type NewFromSiteDraft, type PanelSize } from "@/lib/site-menu/new-product";
import type { SiteMenuItem } from "@/lib/site-menu/schema";
import { fromMinor, isSingleSize, slotLabel } from "@/lib/site-menu/slot";
import { createProductsFromSite } from "@/server/actions/site-menu";

import { productHref } from "../logic";

const siteMoney = (minor: number) => tl(fromMinor(minor), minor % 100 ? 2 : 0);
const capFirst = (t: string) => t.charAt(0).toLocaleUpperCase("tr-TR") + t.slice(1);

/**
 * "Yalnız sitede" kalemden panel ürünü açma penceresi (denetim E-48): ad (sitedeki ad; kalemin öteki boyu panelde
 * bağlıysa onun adı), kategori tahmini ve kalemin panelde bağlısı olmayan fiyatları, her biri bir boy. Fiyat ve menü
 * durumu sitenindir (değiştirilmez, bağlı kalır). "Aç, bağla ve reçeteye geç" ürünleri tek işlemde açar ve bağlar,
 * ilk boyun reçete kartına geçer (kartın boy seçicisi öteki boyu açar).
 */
export function SiteNewProductDialog({
  item,
  draft,
  categories,
  products,
  pendingNew = [],
  covering,
  onClose,
}: {
  item: SiteMenuItem;
  draft: NewFromSiteDraft;
  categories: { id: number; name: string }[];
  /** Panelin ürünleri (aynı ad + boy denetimi) */
  products: { name: string; size: string }[];
  /** Bekleyen yeni ürün önerileri: aynı ad + boyda öneri varken açılmaz (önce Onaylar'da onaylanır; sunucu da reddeder) */
  pendingNew?: { name: string; size: PanelSize; by: string }[];
  /** Bu kalemin boş fiyatlarına önerilen panel ürünleri ("Ice Latte · M") */
  covering: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(draft.name);
  const [categoryId, setCategoryId] = useState<number | null>(draft.categoryId);
  const [rows, setRows] = useState(() => draft.rows.map((r) => ({ ...r, on: true })));
  const single = isSingleSize(item);
  const chosen = rows.filter((r) => r.on);
  const clean = cleanName(name);
  const sizes = chosen.map((r) => r.size);
  const taken = newFromSiteTaken(clean, sizes, products);
  // Aynı ad + boyda bekleyen öneri: ürün açılırsa öneri onayda "zaten var"a takılır, reçetesi ürüne ulaşmaz
  const proposal = taken ? null : pendingProposalIssue(clean, sizes, pendingNew, NEW_FROM_SITE_PENDING_THEN);
  const nameError =
    clean && clean.length < 2 ? (
      "Ürün adı en az 2 harf olmalı"
    ) : proposal ? (
      <>
        {proposal}.{" "}
        <Link href="/panel/onaylar" className="font-medium underline underline-offset-2">
          Onaylar
        </Link>
      </>
    ) : (
      taken
    );
  const ready = !busy && chosen.length > 0 && categoryId !== null && clean.length >= 2 && !taken && !proposal;
  // İstek sürerken (site çekmesi en çok 8 sn) pencere kapanmaz: kapanırsa ürün yine açılır ve sayfa karta geçerdi
  const close = () => {
    if (!busy) onClose();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || categoryId === null) return;
    setBusy(true);
    const res = await createProductsFromSite({ siteMenuId: item.id, name: clean, categoryId, rows: chosen.map((r) => ({ slot: r.slot, size: r.size })) });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    const created = res.data.created;
    toast.success(`${clean} açıldı ve siteye bağlandı; şimdi reçetesini girin`, {
      description: `${created.map((c) => `${c.size} ${tl(c.price, Number.isInteger(c.price) ? 0 : 2)}`).join(", ")}: sitenin fiyatı. Fiyat ve menü durumu iki yerde aynı kalır.`,
    });
    onClose();
    router.push(productHref(created[0].productId));
  }

  const categoryHint =
    categoryId !== null && categoryId === draft.categoryId && draft.categorySource
      ? `Tahmin: ${CATEGORY_SOURCE_TEXT[draft.categorySource]}. Sitede: ${item.categoryLabel || "kategorisiz"}`
      : `Sitede: ${item.categoryLabel || "kategorisiz"}`;

  return (
    <Dialog
      open
      onClose={close}
      title="Panelde aç ve bağla"
      description="Ürün sitenin adı, fiyatı ve menü durumuyla açılır ve bu kaleme bağlanır; reçetesini sonra ürün kartında girersiniz."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={!ready}>
            {busy ? "Açılıyor…" : "Aç, bağla ve reçeteye geç"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4 pb-3" noValidate>
        <div className="flex items-start gap-2.5 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] leading-5 ring-1 ring-line">
          <Globe size={16} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium text-ink">{item.name}</span>
            <span className="block text-ink-mute">
              laffogato.net · {item.categoryLabel || "kategorisiz"} · {item.id}
            </span>
          </span>
          <Badge tone={item.isActive ? "green" : "amber"} className="ml-auto shrink-0">
            {item.isActive ? "Satışta" : "Tükendi"}
          </Badge>
        </div>

        <Field
          label="Ürün adı"
          htmlFor="snp-name"
          error={nameError}
          hint={draft.pair ? `Öteki boyu panelde “${draft.pair.name} · ${draft.pair.size}” olarak bağlı; iki boy aynı adla eşleşir.` : "Panelde görünecek ad; sitedeki ad değişmez."}
        >
          <Input
            id="snp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            aria-invalid={nameError ? true : undefined}
            data-autofocus
          />
        </Field>

        <Field label="Kategori" htmlFor="snp-cat" hint={categoryHint}>
          <Select id="snp-cat" value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)} aria-invalid={categoryId === null ? true : undefined}>
            {categoryId === null ? <option value="">Kategori seçin</option> : null}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">{single ? "Boy" : "Açılacak boylar"}</legend>
          <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
            {rows.map((r, i) => (
              <li key={r.slot} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2">
                {single ? (
                  <span className="text-sm text-ink">{capFirst(slotLabel(r.slot, item))}</span>
                ) : (
                  <Checkbox
                    label={
                      <span>
                        {SIZE_LABELS[r.size]} <span className="text-ink-mute">· {slotLabel(r.slot, item)}</span>
                      </span>
                    }
                    checked={r.on}
                    onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                  />
                )}
                <span className="ml-auto text-sm font-medium text-ink tabular">{siteMoney(r.priceMinor)}</span>
                {single ? (
                  <Select
                    aria-label="Paneldeki boy"
                    value={r.size}
                    onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, size: e.target.value as PanelSize } : x)))}
                    className="w-auto min-w-36"
                  >
                    {SIZES.map((sz) => (
                      <option key={sz} value={sz}>
                        {sz} — {SIZE_LABELS[sz]}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </li>
            ))}
          </ul>
          {!chosen.length ? <p className="text-[13px] text-bad">En az bir boy seçin.</p> : null}
          <p className="text-xs leading-5 text-ink-mute">
            {single ? "Sitede tek fiyat; paneldeki boyu seçin (çoğu tek boy ürün “Tek”)." : "Her fiyat panelde ayrı bir boy olarak açılır."} Fiyat sitedendir; değiştirmek için
            açtıktan sonra ürün kartında değiştirin, siteye de yazılır.
          </p>
        </fieldset>

        {!item.isActive ? (
          <p className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            Kalem sitede Tükendi: ürün QR menüde gizli açılır, site Satışta deyince menüye girer.
          </p>
        ) : null}
        {covering.length ? (
          <p className="flex items-start gap-2 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[13px] leading-5 text-info">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            Öneriler sekmesinde bu kaleme önerilen ürün var: {covering.join(", ")}. Aynı ürünse yenisini açmak yerine onu bağlayın.
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
