"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  ClipboardPaste,
  Coffee,
  Eraser,
  FileUp,
  ListChecks,
  LoaderCircle,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, SearchInput, Textarea } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { normalizePosName } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { num, pct, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { clearMonthSales, deleteLine, importSales, parseSalesFile, saveLine, saveMonthInfo, setLineMatch } from "@/server/actions/sales";

export interface ProductOption {
  id: number;
  name: string;
  size: string;
  category: string;
  cost: number;
  price: number;
  active: boolean;
}

export interface SalesRow {
  id: number;
  posName: string;
  qty: number;
  revenue: number;
  productId: number | null;
  productLabel: string | null;
  isService: boolean;
  matched: boolean;
  unitCost: number | null;
  net: number;
  cost: number;
  commission: number;
  grossProfit: number;
  margin: number;
  note: string | null;
  avgPrice: number;
  menuPrice: number | null;
}

export type SalesFilter = "all" | "unmatched" | "matched" | "service";

// ---------------------------------------------------------------- Sayaçlar

/**
 * AkmanOS AnimatedNumber ile sayan rakam. Ekran okuyucu ara değerleri değil, son değeri okur;
 * hareket azaltıldığında AnimatedNumber doğrudan son değeri yazar.
 */
export function CountUp({ value, kind = "tl" }: { value: number; kind?: "tl" | "num" }) {
  const format = kind === "tl" ? (v: number) => tl(v) : (v: number) => num(v);
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={format} />
      </span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

const COVERAGE_SEGMENTS = 20;

/**
 * AkmanOS capacity-allocation çubuğu: cironun ne kadarının bir ürüne ya da HİZMET'e bağlandığı.
 * Dolu parçalar mürekkep, boşlar şerit; açılışta soldan sağa dolar.
 */
export function MatchCoverage({ share }: { share: number }) {
  const reduce = useCalmMotion();
  const clamped = Math.min(1, Math.max(0, share));
  const filled = Math.round(clamped * COVERAGE_SEGMENTS);
  return (
    <div>
      <div className="flex h-6 items-stretch gap-[2px] sm:gap-[3px]" role="img" aria-label={`Eşleştirilmiş ciro ${pct(clamped, 0)}`}>
        {Array.from({ length: COVERAGE_SEGMENTS }, (_, i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className={cn("min-w-0 flex-1 origin-bottom rounded-[3px]", i < filled ? "bg-ink" : "bg-panel-deep")}
            // initial sunucuda ve istemcide aynı (hidrasyon uyumu); hareket azaltıldığında süre 0
            initial={reduce ? false : { opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: i * 0.012 }}
          />
        ))}
      </div>
      <p className="mt-1.5 flex items-center justify-between gap-2 text-xs text-ink-mute">
        <span>Eşleştirilmiş ciro</span>
        <span className="font-medium text-ink tabular">{pct(clamped, 0)}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Ay bilgisi

export function MonthInfoForm({
  month,
  label,
  info,
  listTotal,
  className,
}: {
  month: string;
  label: string;
  info: { openDays: number | null; posRevenue: number | null; discounts: number; offRevenue: number; note: string | null };
  listTotal: number;
  className?: string;
}) {
  const [openDays, setOpenDays] = useState(info.openDays === null ? "" : String(info.openDays));
  const [pos, setPos] = useState(info.posRevenue === null ? "" : num(info.posRevenue, 2));
  const [disc, setDisc] = useState(num(info.discounts, 2));
  const [off, setOff] = useState(num(info.offRevenue, 2));
  const [note, setNote] = useState(info.note ?? "");
  const [busy, setBusy] = useState(false);
  const snapshot = JSON.stringify([openDays, pos, disc, off, note]);
  const [saved, setSaved] = useState(snapshot);
  const dirty = snapshot !== saved;

  const posNum = parseNumberTR(pos);
  const discNum = parseNumberTR(disc) ?? 0;
  const diff = posNum !== null && listTotal ? listTotal - discNum - posNum : null;
  const consistent = diff !== null && Math.abs(diff) < 1000;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveMonthInfo({
      month,
      openDays: openDays.trim() ? Number(openDays) : null,
      posRevenue: posNum,
      discounts: discNum,
      offRevenue: parseNumberTR(off) ?? 0,
      note,
    });
    setBusy(false);
    if (res.ok) {
      setSaved(snapshot);
      toast.success("Ay bilgileri kaydedildi");
    } else toast.error(res.error);
  }

  return (
    <Card className={className}>
      <CardHeader
        icon={<CalendarDays />}
        title={`${label} bilgileri`}
        description="Patron > Raporlar > Ciro ekranından. Gelir-gider tablosu bu ciroyu kullanır."
      />
      <CardContent className="flex flex-1 flex-col">
        <form onSubmit={save} className="flex flex-1 flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <Field label="POS ciro (KDV dahil)" tip="İndirimler düşülmüş, ödenmezler hariç" htmlFor="m-pos">
              <NumberInput id="m-pos" value={pos} onChange={(e) => setPos(e.target.value)} className="cell-input" />
            </Field>
            <Field label="Açık gün sayısı" tip="Sabit giderler bu oranla bölünür" htmlFor="m-days">
              <NumberInput id="m-days" value={openDays} onChange={(e) => setOpenDays(e.target.value.replace(/\D/g, ""))} className="cell-input" />
            </Field>
            <Field label="Yönetici indirimleri" tip="KDV dahil (Patron > İndirim)" htmlFor="m-disc">
              <NumberInput id="m-disc" value={disc} onChange={(e) => setDisc(e.target.value)} className="cell-input" />
            </Field>
            <Field label="Ciro dışı (ödenmez / ikram)" tip="Malzemesi harcanan, geliri olmayan satışlar" htmlFor="m-off">
              <NumberInput id="m-off" value={off} onChange={(e) => setOff(e.target.value)} className="cell-input" />
            </Field>
          </div>
          <Field label="Not" htmlFor="m-note">
            <Textarea id="m-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="min-h-16" />
          </Field>
          {diff !== null ? (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-xs leading-5",
                consistent ? "bg-good-soft text-good" : "bg-warn-soft text-warn",
              )}
              role="status"
            >
              {consistent ? (
                <CircleCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <p className="tabular">
                <span className="font-semibold">{consistent ? "Tutarlı" : "Kontrol edin"}:</span> ürün listesi {tl(listTotal)} − indirim {tl(discNum)} ={" "}
                {tl(listTotal - discNum)} · POS cirosu ile fark {tl(diff)}
              </p>
            </div>
          ) : null}
          <div className="mt-auto flex items-center justify-end gap-3 pt-1">
            {dirty ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-mute">
                <span className="size-1.5 rounded-full bg-warn" aria-hidden="true" />
                Kaydedilmemiş değişiklik var
              </span>
            ) : null}
            <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={busy}>
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Eşleştirme önerisi

const SIZE_WORDS: Record<string, string> = { LARGE: "L", L: "L", MEDIUM: "M", M: "M", SMALL: "M" };

function tokens(s: string): string[] {
  return normalizePosName(s)
    .replace(/İ/g, "I")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t === "ICED" ? "ICE" : t === "CAFFE" || t === "CAFE" ? "" : t === "CH" ? "CHOC" : t))
    .filter(Boolean);
}

/** Yalnızca kelimeleri birebir aynı (boy hariç) ürünü önerir; benzer ama farklı ürünlerde yanlış eşleşmeyi önler. */
export function suggestProduct(posName: string, products: ProductOption[]): ProductOption | null {
  const toks = tokens(posName);
  let size: string | null = null;
  const last = toks[toks.length - 1];
  if (last && SIZE_WORDS[last]) {
    size = SIZE_WORDS[last];
    toks.pop();
  }
  if (!toks.length) return null;
  const key = [...new Set(toks)].sort().join(" ");
  const candidates = products.filter((p) => p.active && [...new Set(tokens(p.name))].sort().join(" ") === key);
  if (!candidates.length) return null;
  return candidates.find((p) => p.size === (size ?? "Tek")) ?? (candidates.length === 1 && !size ? candidates[0] : null);
}

// ---------------------------------------------------------------- Ürün seçici

const PICKER_LIMIT = 80;

function ProductPicker({
  onClose,
  products,
  title,
  currentId,
  isService,
  onPick,
}: {
  onClose: () => void;
  products: ProductOption[];
  title: string;
  currentId: number | null;
  isService: boolean;
  onPick: (v: { productId: number | null; isService: boolean }) => void;
}) {
  const [q, setQ] = useState("");
  const found = products.filter((p) => matchesSearch(`${p.name} ${p.size} ${p.category}`, q));
  const list = found.slice(0, PICKER_LIMIT);
  return (
    <Dialog open onClose={onClose} title="Ürünle eşleştir" description={title} size="md">
      <div className="space-y-3 pb-2">
        <SearchInput data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Menüde ara…" aria-label="Menüde ara" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPick({ productId: null, isService: true })}
            aria-pressed={isService}
            className={cn(isService && "text-info ring-info/30")}
          >
            <Mic size={15} /> HİZMET (maliyetsiz, ör. karaoke)
            {isService ? <Check size={14} aria-hidden="true" /> : null}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onPick({ productId: null, isService: false })}>
            <X size={15} /> Eşleşmeyi kaldır
          </Button>
        </div>
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto rounded-2xl bg-surface ring-1 ring-line-strong">
          {list.map((p) => {
            const current = !isService && p.id === currentId;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex min-h-12 w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-panel",
                    current && "bg-panel",
                  )}
                  onClick={() => onPick({ productId: p.id, isService: false })}
                >
                  <IconTile size="sm" tone={toneFor(p.category)}>
                    <Coffee />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{p.name}</span>
                      <Badge tone="gray">{p.size}</Badge>
                      {!p.active ? <Badge tone="amber">Pasif</Badge> : null}
                    </span>
                    <span className="block text-xs text-ink-mute">{p.category}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ink-mute tabular">
                    <span className="text-ink-soft">{tl(p.price)}</span>
                    <span className="block">maliyet {tl(p.cost, 2)}</span>
                  </span>
                  {current ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                      <Check size={13} aria-label="Şu anki eşleşme" />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {!list.length ? (
            <li className="px-3 py-4 text-sm text-ink-mute">
              Sonuç yok. Ürün yoksa önce{" "}
              <Link href="/panel/urunler" className="font-medium text-ink underline underline-offset-2">
                Ürünler
              </Link>{" "}
              sayfasından ekleyin.
            </li>
          ) : null}
        </ul>
        {found.length > PICKER_LIMIT ? (
          <p className="text-xs text-ink-mute">
            İlk {PICKER_LIMIT} sonuç gösteriliyor ({num(found.length)} ürün). Aramayı daraltın.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Satış tablosu

function rowStatus(r: SalesRow): "service" | "matched" | "unmatched" {
  return r.isService ? "service" : r.matched ? "matched" : "unmatched";
}

/** Satır içi eşleşme düğmesi: masaüstünde 32px, dokunmatikte 36px */
const MATCH_BTN =
  "inline-flex h-8 max-w-64 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors pointer-coarse:h-9";

const MATCH_TONE = {
  matched: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink/25",
  unmatched: "bg-warn-soft text-warn ring-1 ring-inset ring-warn/25 hover:ring-warn/50",
  service: "bg-info-soft text-info ring-1 ring-inset ring-info/20 hover:ring-info/40",
} as const;

export function SalesTable({
  rows,
  products,
  month,
  initialFilter,
  totals,
}: {
  rows: SalesRow[];
  products: ProductOption[];
  month: string;
  initialFilter: SalesFilter;
  totals: { qty: number; revenue: number; net: number; cost: number; commission: number; grossProfit: number; margin: number };
}) {
  const reduce = useCalmMotion();
  const [filter, setFilter] = useState<SalesFilter>(initialFilter);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<SalesRow | null>(null);
  const [editing, setEditing] = useState<Partial<SalesRow> | null>(null);
  const [deleting, setDeleting] = useState<SalesRow | null>(null);
  const [removing, setRemoving] = useState(false);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const counts = {
    all: rows.length,
    unmatched: rows.filter((r) => rowStatus(r) === "unmatched").length,
    matched: rows.filter((r) => rowStatus(r) === "matched").length,
    service: rows.filter((r) => rowStatus(r) === "service").length,
  };
  const visible = rows.filter((r) => (filter === "all" || rowStatus(r) === filter) && matchesSearch(`${r.posName} ${r.productLabel ?? ""}`, q));
  const paged = usePaged(visible, 25, `${month}|${filter}|${q}`);
  const showTotals = filter === "all" && !q;

  async function pick(row: SalesRow, v: { productId: number | null; isService: boolean }) {
    setPicking(null);
    const res = await setLineMatch(row.id, v.productId, v.isService);
    if (res.ok)
      toast.success(v.isService ? "HİZMET olarak işaretlendi" : v.productId ? "Eşleştirildi, bu ad sonraki aylarda otomatik tanınacak" : "Eşleşme kaldırıldı");
    else toast.error(res.error);
  }

  async function remove() {
    if (!deleting) return;
    setRemoving(true);
    const res = await deleteLine(deleting.id);
    setRemoving(false);
    if (!res.ok) return toast.error(res.error);
    setDeleting(null);
    toast.success("Satır silindi");
  }

  return (
    <Card id="satirlar" className="scroll-mt-6">
      <CardHeader
        icon={<ListChecks />}
        title="Satış satırları"
        description="Eşleşmeyen satırlara menüden ürün seçin; seçim hatırlanır ve sonraki aylarda otomatik uygulanır."
        meta={
          <span className="inline-flex items-center gap-1.5" aria-live="polite">
            <span>Eşleşmeyen</span>
            <span aria-hidden="true">·</span>
            <span className={cn("font-semibold tabular", counts.unmatched ? "text-warn" : "text-ink")}>
              <CountUp value={counts.unmatched} kind="num" />
            </span>
          </span>
        }
        actions={
          <>
            <span className="text-sm text-ink-mute tabular">{num(rows.length)} satır</span>
            <Button variant="secondary" size="sm" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })}>
              <Plus size={16} /> Satır ekle
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <Segmented
          label="Satır filtresi"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Tümü", count: counts.all },
            { value: "unmatched", label: "Eşleşmeyen", count: counts.unmatched },
            { value: "matched", label: "Eşleşen", count: counts.matched },
            { value: "service", label: "Hizmet", count: counts.service },
          ]}
        />
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="POS adı ya da ürün ara…"
          aria-label="Satırlarda ara"
          wrapperClassName="min-w-48 flex-1 sm:max-w-80"
        />
      </div>

      {visible.length ? (
        <>
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH sticky>POS ürün adı</TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Eşleşen ürün
                      <InfoTip text="Tıklayıp menüdeki ürünü seçin. HİZMET = karaoke gibi maliyetsiz satış. Değnekli öneri, adı birebir tutan ürünü tek tıkla uygular." />
                    </span>
                  </TH>
                  <TH numeric>Adet</TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      Ciro (KDV dahil)
                      <InfoTip text="Altında KDV hariç net ciro. Ortalama satış fiyatı menü fiyatından %3'ten fazla saparsa uyarı görünür." />
                    </span>
                  </TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      Malzeme + ambalaj
                      <InfoTip text="Eşleşenlerde adet × birim maliyet; eşleşmeyenlerde net ciro × ortalama maliyet oranı." />
                    </span>
                  </TH>
                  <TH numeric>POS kom.</TH>
                  <TH numeric>Brüt kâr</TH>
                  <TH>
                    <span className="sr-only">İşlemler</span>
                  </TH>
                </tr>
              </THead>
              <motion.tbody
                key={`${filter}|${paged.page}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
              >
                {paged.slice.map((r) => {
                  const status = rowStatus(r);
                  const suggestion = status === "unmatched" ? suggestProduct(r.posName, products) : null;
                  const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
                  const product = r.productId ? productById.get(r.productId) : undefined;
                  return (
                    <TR key={r.id}>
                      <TD sticky className="min-w-36 max-w-72 sm:min-w-52">
                        <div className="flex items-center gap-3">
                          <IconTile
                            className="max-sm:hidden"
                            tone={status === "matched" ? toneFor(product?.category ?? r.posName) : status === "service" ? 2 : 1}
                          >
                            {status === "matched" ? <Coffee /> : status === "service" ? <Mic /> : <CircleHelp />}
                          </IconTile>
                          <div className="min-w-0">
                            <p className="font-medium break-words">{r.posName}</p>
                            {r.note ? (
                              <p className="truncate text-xs text-ink-mute" title={r.note}>
                                {r.note}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TD>
                      <TD className="min-w-48">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={() => setPicking(r)} className={cn(MATCH_BTN, MATCH_TONE[status])} title="Ürünle eşleştir">
                            <span className="truncate">{status === "service" ? "HİZMET" : (r.productLabel ?? "Eşleşmedi — seç")}</span>
                            <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
                          </button>
                          {suggestion ? (
                            <button
                              type="button"
                              className={cn(MATCH_BTN, "bg-lime/25 text-good-ink hover:bg-lime/45")}
                              onClick={() => pick(r, { productId: suggestion.id, isService: false })}
                              title="Önerilen eşleşmeyi uygula"
                            >
                              <Wand2 size={13} className="shrink-0" aria-hidden="true" />
                              <span className="sr-only">Önerilen eşleşmeyi uygula: </span>
                              <span className="truncate">
                                {suggestion.name} · {suggestion.size}
                              </span>
                            </button>
                          ) : null}
                        </div>
                      </TD>
                      <TD numeric>{num(r.qty)}</TD>
                      <TD numeric>
                        {tl(r.revenue)}
                        <span className="block text-xs text-ink-mute">net {tl(r.net)}</span>
                        {Math.abs(priceGap) > 0.03 ? (
                          <span className="block text-[11px] text-warn" title="Ortalama satış fiyatı menü fiyatından farklı">
                            ort. {tl(r.avgPrice)} ({priceGap > 0 ? "+" : ""}
                            {pct(priceGap, 0)})
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric className={cn(status === "unmatched" && "text-warn")}>
                        {tl(r.cost)}
                        {status === "unmatched" ? (
                          <span className="block text-xs">tahmini</span>
                        ) : (
                          <span className="block text-xs text-ink-mute">birim {r.unitCost !== null ? tl(r.unitCost, 2) : "–"}</span>
                        )}
                      </TD>
                      <TD numeric>{tl(r.commission)}</TD>
                      <TD numeric>
                        <span className={cn(r.grossProfit < 0 ? "text-bad" : "font-medium")}>{tl(r.grossProfit)}</span>
                        <span className="block text-xs text-ink-mute">marj {pct(r.margin, 0)}</span>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1">
                          <IconButton label="Düzenle" onClick={() => setEditing(r)}>
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton label="Sil" tone="danger" disabled={removing && deleting?.id === r.id} onClick={() => setDeleting(r)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </motion.tbody>
              {showTotals ? (
                <tfoot>
                  <TFootRow>
                    <TD sticky>Ay toplamı</TD>
                    <TD />
                    <TD numeric>{num(totals.qty)}</TD>
                    <TD numeric>
                      {tl(totals.revenue)}
                      <span className="block text-xs font-normal text-ink-mute">net {tl(totals.net)}</span>
                    </TD>
                    <TD numeric>{tl(totals.cost)}</TD>
                    <TD numeric>{tl(totals.commission)}</TD>
                    <TD numeric>
                      <span className={cn(totals.grossProfit < 0 && "text-bad")}>{tl(totals.grossProfit)}</span>
                      <span className="block text-xs font-normal text-ink-mute">marj {pct(totals.margin, 0)}</span>
                    </TD>
                    <TD />
                  </TFootRow>
                </tfoot>
              ) : null}
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={paged.setPage}
            total={paged.total}
            unit="satır"
            className="border-t border-line"
          />
        </>
      ) : rows.length ? (
        <EmptyState
          icon={<ListChecks />}
          title="Bu filtrede satır yok"
          description={q ? `“${q}” için sonuç bulunamadı.` : undefined}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setFilter("all");
                setQ("");
              }}
            >
              Filtreyi temizle
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<Upload />}
          title="Bu ay için satış raporu yok"
          description="Patron > Raporlar > Satış ekranındaki ürün listesini yukarıdaki İçe aktar bölümüne dosya olarak bırakın ya da yapıştırın."
        />
      )}

      {picking ? (
        <ProductPicker
          key={picking.id}
          onClose={() => setPicking(null)}
          products={products}
          title={`${picking.posName} (${num(picking.qty)} adet)`}
          currentId={picking.productId}
          isService={picking.isService}
          onPick={(v) => pick(picking, v)}
        />
      ) : null}
      {editing ? <LineDialog line={editing} month={month} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => {
          if (!removing) setDeleting(null);
        }}
        onConfirm={remove}
        pending={removing}
        title="Satır silinsin mi?"
        description={
          deleting ? (
            <>
              <span className="font-medium text-ink">{deleting.posName}</span> ({num(deleting.qty)} adet · {tl(deleting.revenue)}) bu aydan silinir.
              Eşleştirme hafızası silinmez.
            </>
          ) : null
        }
      />
    </Card>
  );
}

function LineDialog({ line, month, onClose }: { line: Partial<SalesRow>; month: string; onClose: () => void }) {
  const [posName, setPosName] = useState(line.posName ?? "");
  const [qty, setQty] = useState(num(line.qty ?? 1, 2));
  const [revenue, setRevenue] = useState(num(line.revenue ?? 0, 2));
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveLine({ id: line.id ?? null, month, posName, qty: parseNumberTR(qty) ?? 0, revenue: parseNumberTR(revenue) ?? 0, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Kaydedildi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line.id ? "Satırı düzenle" : "Satır ekle"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="sales-line-form" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="sales-line-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="POS ürün adı" htmlFor="l-name">
          <Input data-autofocus id="l-name" value={posName} onChange={(e) => setPosName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adet" htmlFor="l-qty">
            <NumberInput id="l-qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Ciro (KDV dahil)" htmlFor="l-rev">
            <NumberInput id="l-rev" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </Field>
        </div>
        <Field label="Not" htmlFor="l-note">
          <Input id="l-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- İçe aktarma

type ParsedLine = { posName: string; qty: number; revenue: number };

function parsePasted(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : line.split(/\s{2,}|,(?=\s*\d)/);
    const cells = parts.map((p) => p.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const nums = cells.slice(1).map((c) => parseNumberTR(c));
    const qty = nums[0];
    const revenue = nums[1];
    if (qty === null || qty === undefined || revenue === null || revenue === undefined) continue;
    out.push({ posName: cells[0], qty, revenue });
  }
  return out;
}

/** AkmanOS yüzeyi gibi bırakma alanı: beyaz, kesik çizgili; dosya üstüne gelince yayla hafifçe büyür */
function DropZone({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const reduce = useCalmMotion();
  const [dragging, setDragging] = useState(false);

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) onFile(f);
  }

  return (
    <motion.div className="flex flex-1" animate={{ scale: dragging && !reduce ? 1.015 : 1 }} transition={SPRING_PRESS}>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        aria-busy={busy || undefined}
        className={cn(
          "flex min-h-48 flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-surface px-6 py-8 text-center",
          "transition-[border-color,box-shadow] duration-200 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ink/30",
          dragging ? "border-ink/40 shadow-[0_12px_40px_rgba(0,0,0,0.10)]" : "border-line-strong hover:border-ink/20",
          busy && "pointer-events-none",
        )}
      >
        <input
          type="file"
          accept=".xlsx,.csv,.txt,.tsv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
        <motion.span
          animate={{ y: dragging && !reduce ? -3 : 0 }}
          transition={SPRING_PRESS}
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl border transition-colors duration-200 [&>svg]:size-5 [&>svg]:stroke-[1.75]",
            dragging ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]",
          )}
          aria-hidden="true"
        >
          {busy ? <LoaderCircle className="motion-safe:animate-spin" /> : <FileUp />}
        </motion.span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            {busy ? (
              "Okunuyor…"
            ) : dragging ? (
              "Bırakın, dosya okunsun"
            ) : (
              <>
                Dosyayı buraya bırakın ya da <span className="underline decoration-ink/30 underline-offset-2">seçin</span>
              </>
            )}
          </span>
          <span className="text-xs text-ink-mute">Patron&apos;dan indirdiğiniz satış raporu</span>
        </span>
        <span className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-ink-mute">
          <Badge tone="gray">.xlsx</Badge>
          <Badge tone="gray">.csv</Badge>
          <span>· en fazla 5 MB</span>
        </span>
      </label>
    </motion.div>
  );
}

export function ImportCard({
  month,
  label,
  lineCount,
  mappings,
  products,
  className,
}: {
  month: string;
  /** Hedef ayın adı, ör. "Eylül 2026" (önizleme açıkken ay değiştirilirse hedef görünür kalsın) */
  label: string;
  lineCount: number;
  mappings: { posName: string; productId: number | null; isService: boolean }[];
  products: ProductOption[];
  className?: string;
}) {
  const reduce = useCalmMotion();
  const hasLines = lineCount > 0;
  const [source, setSource] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedLine[]>([]);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const map = useMemo(() => new Map(mappings.map((m) => [m.posName, m])), [mappings]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const preview = rows.map((r) => {
    const m = map.get(normalizePosName(r.posName));
    const p = m?.productId ? productById.get(m.productId) : undefined;
    return { ...r, status: m?.isService ? "service" : p ? "matched" : "new", label: m?.isService ? "HİZMET" : p ? `${p.name} · ${p.size}` : null };
  });
  const totals = preview.reduce((a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue }), { qty: 0, revenue: 0 });
  // initial sunucuda ve istemcide aynı kalmalı (useReducedMotion sunucuda null döner); azaltılmış harekette süre 0
  const fade = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT },
  };

  async function onFile(f: File) {
    const fd = new FormData();
    fd.set("file", f);
    setBusy(true);
    const res = await parseSalesFile(fd);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setRows(res.data);
    toast.success(`${res.data.length} satır okundu`);
  }

  function readPasted() {
    const r = parsePasted(text);
    if (!r.length) return toast.error("Satır okunamadı. Her satırda ürün adı, adet ve ciro olmalı.");
    setRows(r);
  }

  async function submit() {
    setBusy(true);
    const res = await importSales({ month, lines: rows, mode });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${res.data.count} satır yüklendi, ${res.data.matched} tanesi otomatik eşleşti`);
    setRows([]);
    setText("");
  }

  async function clearMonth() {
    setClearing(true);
    const res = await clearMonthSales(month);
    setClearing(false);
    setConfirmClear(false);
    if (res.ok) toast.success("Satırlar silindi");
    else toast.error(res.error);
  }

  return (
    <Card className={className}>
      {!rows.length ? (
        <motion.div key="pick" {...fade} className="flex flex-1 flex-col">
          <CardHeader
            icon={<Upload />}
            title="İçe aktar"
            description="Patron > Raporlar > Satış: ürün adı, adet ve ciro (KDV dahil) sütunları."
            actions={
              <Segmented
                label="Kaynak"
                value={source}
                onChange={setSource}
                options={[
                  { value: "file", label: "Dosya" },
                  { value: "paste", label: "Yapıştır" },
                ]}
              />
            }
          />
          <CardContent className="flex flex-1 flex-col">
            {source === "file" ? (
              <motion.div key="file" {...fade} className="flex flex-1 flex-col">
                <DropZone busy={busy} onFile={onFile} />
              </motion.div>
            ) : (
              <motion.div key="paste" {...fade} className="flex flex-1 flex-col gap-3">
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
                      e.preventDefault();
                      readPasted();
                    }
                  }}
                  rows={7}
                  autoFocus
                  aria-label="Satış listesini yapıştırın"
                  placeholder={"L'AFFOGATO LARGE\t265\t79.500\nICED AMERICANO MEDİUM\t172\t29.770\n…"}
                  className="min-h-44 flex-1 font-mono text-base sm:text-xs"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-mute">
                    Her satırda ürün adı, adet, ciro.{" "}
                    <kbd className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft ring-1 ring-line-strong">Ctrl/⌘ + Enter</kbd> ile
                    okuyun.
                  </p>
                  <Button variant="secondary" onClick={readPasted} disabled={!text.trim()}>
                    <ClipboardPaste size={16} /> Yapıştırılanı oku
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
          {hasLines ? (
            <CardFooter className="mt-auto">
              <span>Bu ayda {num(lineCount)} satır var. Yeni rapor yüklerken değiştirmeyi ya da eklemeyi seçersiniz.</span>
              <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => setConfirmClear(true)}>
                <Eraser size={15} /> Ayı temizle
              </Button>
            </CardFooter>
          ) : null}
        </motion.div>
      ) : (
        <motion.div key="preview" {...fade} className="flex flex-1 flex-col">
          <CardHeader
            icon={<Upload />}
            title="İçe aktar · önizleme"
            description={`${num(rows.length)} satır okundu. Kontrol edip ${label} ayına yükleyin.`}
            actions={
              <Button variant="ghost" size="sm" onClick={() => setRows([])} disabled={busy}>
                <RotateCcw size={15} /> Baştan başla
              </Button>
            }
          />
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green" dot>
                {preview.filter((p) => p.status === "matched").length} eşleşti
              </Badge>
              <Badge tone="blue" dot>
                {preview.filter((p) => p.status === "service").length} hizmet
              </Badge>
              <Badge tone="amber" dot>
                {preview.filter((p) => p.status === "new").length} yeni ad
              </Badge>
              <span className="text-[13px] text-ink-mute tabular">
                Toplam {num(totals.qty)} adet · {tl(totals.revenue)}
              </span>
            </div>
            <div className="scroll-thin max-h-72 overflow-auto rounded-2xl bg-surface px-1 ring-1 ring-line-strong">
              <Table>
                <THead className="sticky top-0 z-10 bg-surface [&_th]:pt-3">
                  <tr>
                    <TH>POS ürün adı</TH>
                    <TH numeric>Adet</TH>
                    <TH numeric>Ciro</TH>
                    <TH>Eşleşme</TH>
                  </tr>
                </THead>
                <tbody>
                  {preview.map((r, i) => (
                    <TR key={i} className="hover:bg-panel/60">
                      <TD className="min-w-40">{r.posName}</TD>
                      <TD numeric>{num(r.qty)}</TD>
                      <TD numeric>{tl(r.revenue)}</TD>
                      <TD className="min-w-40">
                        {r.status === "new" ? (
                          <span className="text-xs text-warn">Yükledikten sonra eşleştirin</span>
                        ) : r.status === "service" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-info">
                            <Mic size={12} aria-hidden="true" /> {r.label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-good">
                            <Check size={12} aria-hidden="true" /> {r.label}
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {hasLines ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-ink-mute">Bu aydaki {num(lineCount)} satır:</span>
                  <Segmented
                    label="Mevcut satırlar"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "replace", label: "Yenisiyle değiştir" },
                      { value: "append", label: "Koru, üstüne ekle" },
                    ]}
                  />
                </div>
              ) : (
                <span className="text-[13px] text-ink-mute">Bu ay boş; satırlar doğrudan yüklenir.</span>
              )}
              <Button onClick={submit} disabled={busy}>
                {busy ? "Yükleniyor…" : `${num(rows.length)} satırı yükle`}
              </Button>
            </div>
          </CardContent>
        </motion.div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => {
          if (!clearing) setConfirmClear(false);
        }}
        onConfirm={clearMonth}
        pending={clearing}
        title="Bu ayın satış satırları silinsin mi?"
        description={
          <>
            <span className="font-medium text-ink">{num(lineCount)} satır silinecek.</span> Ay bilgileri (ciro, açık gün) kalır. Eşleştirme hafızası
            silinmez.
          </>
        }
      />
    </Card>
  );
}
