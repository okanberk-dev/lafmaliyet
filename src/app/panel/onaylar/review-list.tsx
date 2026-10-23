"use client";

import { AlertTriangle, Check, ChevronDown, ClipboardCheck, ExternalLink, History, Info, PackagePlus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RecipeDiff, RecipeList } from "@/components/panel/recipe-diff";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/misc";
import { priceProduct } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { SIZE_LABELS } from "@/lib/constants";
import { dateTimeTR, money, pct, tl } from "@/lib/format";
import { genitive, NEW_PRODUCT_NAME_MAX, REQUEST_STATUS_LABEL, takenIssue, type ProductSize, type RecipeSnapshot, type RequestKind, type RequestStatus } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import { approveNewProduct, reviewRecipeChange } from "@/server/actions/recipe-requests";

import { STATUS_TONE } from "../receteler/my-requests";
import { priceText } from "../urunler/price-text";

export interface ReviewItem {
  kind: "change";
  id: number;
  productId: number;
  productName: string;
  size: "M" | "L" | "Tek";
  categoryName: string | null;
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
  message: string | null;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
  /** Bugünkü reçete; öneriden sonra değiştiyse `changedSince` */
  current: RecipeSnapshot | null;
  changedSince: boolean;
  cost: { before: number; after: number; price: number; ratioBefore: number; ratioAfter: number; target: number } | null;
  /** Önerilen reçetede paket fiyatı girilmemiş malzemeler (sayımda eklenen kalem): maliyet eksik görünür */
  unpriced: string[];
  /** Eklenen ya da miktarı değişen satırlarda paket fiyatı tahmini olan malzemeler (estimateNames): maliyet farkı kesin değil */
  estimates: string[];
}

/** Personelin yeni ürün önerisi (boy başına bir öneri): satır maliyetleri bugünkü hammadde fiyatlarıyla */
export interface NewProductItem {
  kind: "new";
  id: number;
  name: string;
  size: ProductSize;
  categoryId: number;
  requestedByName: string;
  updatedAt: string;
  message: string | null;
  /** Personelin yazdığı satış fiyatı (KDV dahil); fiyat alanı bununla dolu gelir */
  proposedPrice: number | null;
  lines: {
    name: string;
    qtyLabel: string;
    note: string | null;
    qty: number;
    /** ₺ / malzeme birimi, KDV hariç */
    unitCost: number;
    vatRate: number;
    isPackaging: boolean;
    /** Malzeme artık hammaddelerde yok (onay olmaz) */
    missing: boolean;
    /** Paket fiyatı girilmemiş (sayımda eklenen kalem): maliyet eksik */
    unpriced: boolean;
    /** Paket fiyatı tahmini (öneride "Yeni malzeme" ile ya da sayımda personelin yazdığı, faturada bulunmayan) */
    estimate: boolean;
  }[];
}

/** Yeni ürün kartının ortamı: kategoriler, kategoriden gelen zayi oranı, hesap ayarları, var olan ürünlerin ad + boyu */
export interface NewProductEnv {
  categories: { id: number; name: string }[];
  fireByCategory: Record<number, number | null>;
  settings: Settings;
  taken: { name: string; size: ProductSize }[];
}

export interface RecentItem {
  id: number;
  kind: RequestKind;
  productId: number | null;
  productName: string;
  size: "M" | "L" | "Tek";
  status: RequestStatus;
  requestedByName: string;
  reviewedByName: string | null;
  reviewNote: string | null;
  message: string | null;
  at: string;
  before: RecipeSnapshot;
  after: RecipeSnapshot;
}

/** Reddetme penceresinin konusu (iki tür öneri) */
type RejectTarget = { id: number; kind: RequestKind; productName: string; size: ProductSize };

/**
 * Yöneticinin onay listesi: her öneride kim, ne zaman, neden; önce / sonra farkı; maliyet etkisi (bugünkü hammadde
 * fiyatlarıyla). "Onayla ve uygula" reçeteyi değiştirir; reçete öneriden sonra değiştiyse önce bugünkü hâl ile öneri
 * yan yana gösterilir, yönetici yine de uygulayabilir. Yeni ürün önerisinde satır maliyetleri ve canlı kâr marjıyla
 * satış fiyatı yazılır, "Onayla ve ürünü ekle" ürünü açar. "Reddet" isteğe bağlı bir notla.
 */
export function ReviewList({ pending, recent, env }: { pending: (ReviewItem | NewProductItem)[]; recent: RecentItem[]; env: NewProductEnv }) {
  const [busy, startTransition] = useActionTransition();
  const [rejecting, setRejecting] = useState<RejectTarget | null>(null);
  const [reason, setReason] = useState("");
  const [conflict, setConflict] = useState<{ item: ReviewItem; current: RecipeSnapshot } | null>(null);
  const [openRecent, setOpenRecent] = useState<number | null>(null);

  function approve(item: ReviewItem, force = false) {
    startTransition(async () => {
      const res = await reviewRecipeChange({ id: item.id, decision: "approve", force });
      if (!res.ok) return void toast.error(res.error);
      if (res.data.conflict) return setConflict({ item, current: res.data.current });
      setConflict(null);
      toast.success(`${item.productName} · ${SIZE_LABELS[item.size]} reçetesi güncellendi`, { description: `${item.requestedByName} önerisi onaylandı.` });
    });
  }

  function reject() {
    const item = rejecting;
    if (!item) return;
    startTransition(async () => {
      const res = await reviewRecipeChange({ id: item.id, decision: "reject", note: reason.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      setRejecting(null);
      setReason("");
      toast.success(`${item.productName} önerisi reddedildi`, { description: "Personel sonucu Önerilerim'de görür." });
    });
  }

  const askReject = (target: RejectTarget) => {
    setReason("");
    setRejecting(target);
  };

  return (
    <div className="space-y-6">
      {pending.length ? (
        <section aria-label="Onay bekleyenler" className="space-y-4">
          {pending.map((item) =>
            item.kind === "new" ? (
              <NewProductCard
                key={item.id}
                item={item}
                env={env}
                busy={busy}
                startTransition={startTransition}
                onReject={() => askReject({ id: item.id, kind: "new", productName: item.name, size: item.size })}
              />
            ) : (
              <Card key={item.id} id={`oneri-${item.id}`} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
                <CardHeader
                  icon={<ClipboardCheck />}
                  title={
                    <>
                      {item.productName} <span className="font-normal text-ink-mute">· {SIZE_LABELS[item.size]}</span>
                    </>
                  }
                  description={`${item.requestedByName} önerdi · ${dateTimeTR(item.updatedAt)}${item.categoryName ? ` · ${item.categoryName}` : ""}`}
                  actions={
                    <ButtonLink href={`/panel/urunler/${item.productId}`} variant="ghost" size="sm">
                      <ExternalLink size={14} aria-hidden="true" /> Reçete kartı
                    </ButtonLink>
                  }
                />
                <div className="space-y-3 px-5 pb-5">
                  {item.message ? (
                    <p className="rounded-2xl bg-surface px-3.5 py-2.5 text-sm break-words text-ink-soft ring-1 ring-line">
                      <span className="font-medium text-ink">Personelin notu:</span> {item.message}
                    </p>
                  ) : null}
                  {item.changedSince ? (
                    <p role="status" className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                      Reçete bu öneriden sonra değişti. “Önce” sütunu öneri anındaki reçetedir; onaylarken bugünkü hâliyle karşılaştırmanız istenir.
                    </p>
                  ) : null}
                  <RecipeDiff before={item.before} after={item.after} />
                  <UnpricedNote names={item.unpriced} />
                  {item.cost ? <CostImpact cost={item.cost} /> : null}
                  <EstimateNote names={item.estimates} />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button onClick={() => approve(item)} disabled={busy} className="max-sm:flex-1">
                      <Check size={16} /> Onayla ve uygula
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => askReject({ id: item.id, kind: "change", productName: item.productName, size: item.size })}
                      className="max-sm:flex-1"
                    >
                      <X size={16} /> Reddet
                    </Button>
                  </div>
                </div>
              </Card>
            ),
          )}
        </section>
      ) : (
        <Card>
          <EmptyState
            icon={<ClipboardCheck />}
            title="Onay bekleyen öneri yok"
            description="Personel reçete defterinde kalemle değişiklik ya da “Yeni ürün öner” ile ürün önerince burada görünür; zilde de haber verilir."
          />
        </Card>
      )}

      {recent.length ? (
        <Card>
          <CardHeader icon={<History />} title="Son kararlar" description="Son 30 günde onaylanan, reddedilen ve geri çekilen öneriler." />
          <ul className="divide-y divide-line border-t border-line">
            {recent.map((r) => {
              const expanded = openRecent === r.id;
              const isNew = r.kind === "new";
              return (
                <li key={r.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium break-words text-ink">
                        {isNew ? <span className="font-normal text-ink-mute">Yeni ürün: </span> : null}
                        {r.productName} <span className="font-normal text-ink-mute">· {SIZE_LABELS[r.size]}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-mute">
                        <Badge tone={STATUS_TONE[r.status]} dot>
                          {isNew && r.status === "approved" ? "Eklendi" : REQUEST_STATUS_LABEL[r.status]}
                        </Badge>
                        <span>{r.requestedByName} önerdi</span>
                        {r.reviewedByName ? <span>· {r.reviewedByName}</span> : null}
                        <span className="tabular">· {dateTimeTR(r.at)}</span>
                      </p>
                      {r.reviewNote ? <p className="mt-1 text-[13px] break-words text-ink-soft">Not: {r.reviewNote}</p> : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {isNew && r.status === "approved" && r.productId !== null ? (
                        <ButtonLink href={`/panel/urunler/${r.productId}`} variant="ghost" size="sm">
                          <ExternalLink size={14} aria-hidden="true" /> Ürün kartı
                        </ButtonLink>
                      ) : null}
                      <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpenRecent(expanded ? null : r.id)}>
                        <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                        {isNew ? (expanded ? "Reçeteyi gizle" : "Reçeteyi gör") : expanded ? "Farkı gizle" : "Farkı gör"}
                      </Button>
                    </div>
                  </div>
                  {expanded ? isNew ? <RecipeList recipe={r.after} className="mt-3" /> : <RecipeDiff before={r.before} after={r.after} className="mt-3" /> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Dialog
        open={rejecting !== null}
        onClose={() => !busy && setRejecting(null)}
        size="sm"
        title={rejecting ? `${rejecting.productName} · ${SIZE_LABELS[rejecting.size]} önerisi reddedilsin mi?` : ""}
        description={
          rejecting?.kind === "new" ? "Ürün eklenmez. Notunuz personelin Önerilerim listesinde görünür." : "Reçete değişmez. Notunuz personelin Önerilerim listesinde görünür."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={reject} disabled={busy}>
              {busy ? "Bekleyin…" : "Reddet"}
            </Button>
          </>
        }
      >
        <Field label="Gerekçe (isteğe bağlı)" htmlFor="red-not">
          <Textarea
            id="red-not"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={rejecting?.kind === "new" ? "Ör. “menüde benzeri var”" : "Ör. “L boyda 2 pompa yeterli”"}
          />
        </Field>
      </Dialog>

      <Dialog
        open={conflict !== null}
        onClose={() => !busy && setConflict(null)}
        size="lg"
        title="Reçete bu öneriden sonra değişti"
        description="Aşağıda bugünkü reçete ile önerilen reçete karşılaştırılıyor. Uygularsanız bugünkü reçetenin yerine önerilen geçer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConflict(null)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={() => conflict && approve(conflict.item, true)} disabled={busy}>
              {busy ? "Bekleyin…" : "Yine de uygula"}
            </Button>
          </>
        }
      >
        {conflict ? <RecipeDiff before={conflict.current} after={conflict.item.after} /> : null}
      </Dialog>
    </div>
  );
}

/**
 * Yeni ürün önerisinin kartı: önerilen reçete satır satır maliyetiyle (bugünkü hammadde fiyatları, KDV hariç; tahmini
 * fiyatlı malzeme "Tahmini" işaretli), zayi (kategorinin oranı) ve toplam maliyet; yönetici adı ve kategoriyi
 * düzeltebilir (boy sabit), satış fiyatını yazar (personel önerdiyse onunla dolu gelir), kâr marjı ve maliyet oranı canlı
 * hesaplanır (Ürünler ile aynı formül, priceProduct). Fiyat girilmeden onaylanmaz.
 */
function NewProductCard({
  item,
  env,
  busy,
  startTransition,
  onReject,
}: {
  item: NewProductItem;
  env: NewProductEnv;
  busy: boolean;
  startTransition: (fn: () => Promise<void>) => void;
  onReject: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState(env.categories.some((c) => c.id === item.categoryId) ? item.categoryId : (env.categories[0]?.id ?? 0));
  // Personelin önerdiği satış fiyatı (yoksa alan boş gelir)
  const proposed = item.proposedPrice;
  const [price, setPrice] = useState(proposed !== null ? priceText(proposed) : "");
  const [priceError, setPriceError] = useState<string | null>(null);
  const typed = parseNumberTR(price);
  const priceValue = typed !== null && typed > 0 ? typed : null;
  const fire = env.fireByCategory[categoryId] ?? null;
  const econ = priceProduct(
    { price: priceValue ?? 0, fireOverride: fire },
    item.lines.map((l) => ({ qty: l.qty, unitCost: l.unitCost, vatRate: l.vatRate, isPackaging: l.isPackaging })),
    env.settings,
  );
  const taken = takenIssue(name, item.size, env.taken, []);
  const missing = item.lines.filter((l) => l.missing);
  const unpriced = item.lines.filter((l) => l.unpriced);
  const nameId = `yeni-ad-${item.id}`;
  const priceId = `yeni-fiyat-${item.id}`;
  const proposedCategory = env.categories.find((c) => c.id === item.categoryId)?.name;

  function approve() {
    if (priceValue === null) {
      setPriceError(`Satış fiyatını yazın (KDV dahil${econ.cost > 0 ? `; hedef maliyet oranıyla ${tl(econ.suggestedPrice)}` : ""})`);
      document.getElementById(priceId)?.focus();
      return;
    }
    if (taken) return void toast.error(taken);
    startTransition(async () => {
      const res = await approveNewProduct({ id: item.id, name, categoryId, price: priceValue });
      if (!res.ok) return void toast.error(res.error);
      const productId = res.data.productId;
      toast.success(`${name.trim()} · ${SIZE_LABELS[item.size]} eklendi`, {
        description: `${genitive(item.requestedByName)} önerisi onaylandı; ürün reçetesiyle Ürünler'de.`,
        action: { label: "Ürün kartı", onClick: () => router.push(`/panel/urunler/${productId}`) },
      });
    });
  }

  // Zildeki öneri bağlantısı (#oneri-…) kartı başlığıyla, telefonun yapışkan üst çubuğunun altında açar
  return (
    <Card id={`oneri-${item.id}`} className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<PackagePlus />}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {item.name} <span className="font-normal text-ink-mute">· {SIZE_LABELS[item.size]}</span>
            </span>
            <Badge tone="blue">Yeni ürün</Badge>
          </span>
        }
        description={`${item.requestedByName} önerdi · ${dateTimeTR(item.updatedAt)}${proposedCategory ? ` · ${proposedCategory}` : ""}`}
      />
      <div className="space-y-3 px-5 pb-5">
        {item.message ? (
          <p className="rounded-2xl bg-surface px-3.5 py-2.5 text-sm break-words text-ink-soft ring-1 ring-line">
            <span className="font-medium text-ink">Personelin notu:</span> {item.message}
          </p>
        ) : null}
        {missing.length ? (
          <p role="status" className="flex items-start gap-2 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] leading-5 text-bad">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {missing.map((l) => l.name).join(", ")} artık hammaddelerde yok; bu öneri onaylanamaz, reddedin.
          </p>
        ) : null}
        <UnpricedNote names={[...new Set(unpriced.map((l) => l.name))]} />

        <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-line">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line-strong text-left text-[13px] text-ink-soft">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Malzeme
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Miktar
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  Maliyet
                </th>
              </tr>
            </thead>
            <tbody>
              {item.lines.map((l, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="px-3 py-2">
                    <span className={cn("font-medium break-words", l.missing ? "text-bad line-through" : "text-ink")}>{l.name}</span>
                    {l.unpriced ? (
                      <Badge tone="amber" className="ml-1.5">
                        Fiyat yok
                      </Badge>
                    ) : l.estimate ? (
                      <Badge tone="amber" dot className="ml-1.5" title="Paket fiyatı tahmini (faturadan gelmedi); maliyet kesin değil">
                        Tahmini
                      </Badge>
                    ) : null}
                    {l.note ? <span className="mt-1 block text-xs text-ink-mute">Not: {l.note}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-ink tabular">{l.qtyLabel}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-ink tabular">{tl(l.qty * l.unitCost, 2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-[13px]">
              <tr className="border-b border-line text-ink-mute">
                <td colSpan={2} className="px-3 py-1.5">
                  Zayi ({pct(econ.fireRate, 0)}
                  {fire === null ? ", genel oran" : ", kategoriden"})
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular">{tl(econ.fire, 2)}</td>
              </tr>
              <tr className="font-semibold text-ink">
                <td colSpan={2} className="px-3 py-2">
                  Maliyet (KDV hariç)
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular">{tl(econ.cost, 2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ürün adı" htmlFor={nameId} error={taken}>
            <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} maxLength={NEW_PRODUCT_NAME_MAX} aria-invalid={taken ? true : undefined} />
          </Field>
          <Field label="Kategori" htmlFor={`yeni-kategori-${item.id}`}>
            <Select id={`yeni-kategori-${item.id}`} value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              {env.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Satış fiyatı (KDV dahil)"
            htmlFor={priceId}
            error={priceError}
            hint={
              <>
                {priceValue !== null ? (
                  <span className="block tabular">
                    Kâr marjı <span className={cn("font-semibold", econ.unitProfit < 0 ? "text-bad" : "text-ink")}>{pct(econ.margin, 0)}</span> · maliyet oranı{" "}
                    <span className={cn("font-semibold", econ.costRatio > env.settings.hedefMaliyet ? "text-bad" : "text-ink")}>{pct(econ.costRatio, 0)}</span> (hedef{" "}
                    {pct(env.settings.hedefMaliyet, 0)})
                  </span>
                ) : econ.cost > 0 ? (
                  <span className="block">
                    Hedef maliyet oranıyla önerilen{" "}
                    <button
                      type="button"
                      className="cursor-pointer font-semibold text-ink underline underline-offset-2 pointer-coarse:py-2"
                      onClick={() => {
                        setPrice(priceText(econ.suggestedPrice));
                        setPriceError(null);
                      }}
                    >
                      {tl(econ.suggestedPrice)}
                    </button>
                  </span>
                ) : proposed === null ? (
                  "Menüdeki fiyat; virgüllü yazabilirsiniz"
                ) : null}
                {/* Personel fiyat yazdıysa alan onunla dolu gelir; değiştirilince öneriye tek dokunuşla dönülür */}
                {proposed !== null ? (
                  <span className="mt-0.5 block tabular">
                    Personelin önerisi:{" "}
                    {priceValue !== null && Math.abs(priceValue - proposed) < 0.005 ? (
                      money(proposed)
                    ) : (
                      <button
                        type="button"
                        className="cursor-pointer font-semibold text-ink underline underline-offset-2 pointer-coarse:py-2"
                        onClick={() => {
                          setPrice(priceText(proposed));
                          setPriceError(null);
                        }}
                      >
                        {money(proposed)}
                      </button>
                    )}
                  </span>
                ) : null}
              </>
            }
          >
            <div className="relative">
              <NumberInput
                id={priceId}
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setPriceError(null);
                }}
                placeholder={econ.cost > 0 ? `ör. ${priceText(econ.suggestedPrice)}` : "ör. 165"}
                aria-invalid={priceError ? true : undefined}
                className="cell-input pr-7"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute">₺</span>
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={approve} disabled={busy || missing.length > 0} className="max-sm:flex-1">
            <Check size={16} /> Onayla ve ürünü ekle
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onReject} className="max-sm:flex-1">
            <X size={16} /> Reddet
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Paket fiyatı girilmemiş malzeme (sayımda "Listeye ekle" ile eklenen kalem) maliyete 0 ₺ girer: karar vermeden önce söylenir */
function UnpricedNote({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-5 text-warn">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {names.join(", ")} için paket fiyatı girilmemiş; maliyet eksik görünür.{" "}
        <Link href="/panel/hammaddeler?durum=fiyatsiz" className="font-medium underline underline-offset-2">
          Hammaddeler&apos;den fiyatını girin
        </Link>
        .
      </span>
    </p>
  );
}

/** Personelin "Yeni malzeme"de yazdığı ya da faturadan gelmemiş paket fiyatı: maliyet farkı onunla hesaplandı */
function EstimateNote({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] leading-5 text-ink-soft ring-1 ring-line">
      <Info size={16} className="mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
      <span>
        Tahmini fiyatlı: {names.join(", ")}. Paket fiyatı faturadan gelmedi; maliyet kesin değil.{" "}
        <Link href="/panel/hammaddeler?durum=tahmini" className="font-medium underline underline-offset-2">
          Hammaddeler&apos;de bakın
        </Link>
        .
      </span>
    </p>
  );
}

function CostImpact({ cost }: { cost: NonNullable<ReviewItem["cost"]> }) {
  const diff = cost.after - cost.before;
  const over = cost.ratioAfter > cost.target;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] text-ink-soft ring-1 ring-line">
      <span>
        Maliyet <span className="tabular">{tl(cost.before, 2)}</span> → <span className="font-semibold text-ink tabular">{tl(cost.after, 2)}</span>{" "}
        <span className={cn("tabular", diff > 0.005 ? "text-bad" : diff < -0.005 ? "text-good-ink" : "text-ink-mute")}>
          ({diff >= 0 ? "+" : "−"}
          {tl(Math.abs(diff), 2)})
        </span>
      </span>
      {cost.price > 0 ? (
        <span>
          Maliyet oranı <span className="tabular">{pct(cost.ratioBefore, 0)}</span> → <span className={cn("font-semibold tabular", over ? "text-bad" : "text-ink")}>{pct(cost.ratioAfter, 0)}</span>{" "}
          <span className="text-ink-mute">(hedef {pct(cost.target, 0)}, fiyat {tl(cost.price)})</span>
        </span>
      ) : null}
    </p>
  );
}
