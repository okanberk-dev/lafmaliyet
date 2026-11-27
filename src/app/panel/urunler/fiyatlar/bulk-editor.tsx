"use client";

import { ArrowRight, CheckCircle2, ChevronDown, Eye, Globe, ListChecks, Percent, RotateCcw, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useActionTransition } from "@/components/ui/action-error";
import { Badge, STATUS_TONE } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearQuery, FilterChip, releaseScroll, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState, InfoTip, Signed, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { basisText, type SalesBasis } from "@/lib/calc/price-loss";
import type { Size } from "@/lib/calc/types";
import { SIZE_LABELS, SIZES } from "@/lib/constants";
import { locativeTR, money, num, numPossessive, pct } from "@/lib/format";
import {
  bulkSummary,
  defaultRounding,
  parseRuleAmount,
  previewRows,
  roundingById,
  ROUNDINGS,
  rulePrice,
  ruleSummary,
  ruleText,
  type BulkRow,
  type BulkRule,
  type Econ,
  type PreviewRow,
  type PriceSettings,
  type RoundingId,
} from "@/lib/prices/bulk";
import type { KasaName } from "@/lib/asilpos/kasa";
import { branchBulkRows, effectiveFromText, effectiveLocalValue, parseEffectiveLocal } from "@/lib/prices/branch";
import { batchPosNote } from "@/lib/prices/pos";
import type { SiteBranchPrice } from "@/lib/site-menu/schema";
import { toMinor } from "@/lib/site-menu/slot";
import { cn } from "@/lib/utils";
import { applyBranchPrices, applyBulkPrices, undoPriceBatch } from "@/server/actions/prices";

import { FilterSheet, FilterSheetButton, FilterSummaryLine, SHEET_CHIP, SheetSection, SheetToggle } from "../filter-sheet";
import { filterSummary } from "../filter-text";
import { priceText } from "../price-text";
import { filterBulkRows, parseCategoryParam, parseSizeParam, tabHref } from "./logic";

type Kind = "percent" | "amount" | "suggested";

const KINDS: { value: Kind; label: string }[] = [
  { value: "percent", label: "Yüzde" },
  { value: "amount", label: "Tutar (₺)" },
  { value: "suggested", label: "Önerilen fiyat" },
];

/** Hızlı seçimler: alana yazılacak metin ve düğmenin adı */
const QUICK: Record<"percent" | "amount", { text: string; label: string }[]> = {
  percent: [
    { text: "5", label: "+%5" },
    { text: "10", label: "+%10" },
    { text: "15", label: "+%15" },
  ],
  amount: [
    { text: "5", label: "+5 ₺" },
    { text: "10", label: "+10 ₺" },
    { text: "20", label: "+20 ₺" },
  ],
};

const sizeLabel = (s: string) => SIZE_LABELS[s as Size] ?? s;

/** "+20 ₺", "−5 ₺" (kuruşluysa iki ondalık) */
const signedMoney = (v: number) => `${v < 0 ? "−" : "+"}${money(Math.abs(v))}`;
/** "+%10,3", "−%5" */
const signedPct = (v: number) => `${v < 0 ? "−" : "+"}${pct(Math.abs(v))}`;

/** Oran anlamsız: reçete yok ya da fiyat 0 (Ürün listesiyle aynı kural) */
const noRatio = (e: Econ, price: number) => e.status === "Reçete yok" || price <= 0;

/** Maliyet oranı; anlamsızsa tire */
const ratioText = (e: Econ, price: number) => (noRatio(e, price) ? "–" : pct(e.costRatio, 0));

/** Maliyet oranının hedefe göre rengi (Ürün listesiyle aynı eşikler); oranı anlamsızsa renk yok */
const ratioTone = (e: Econ, price: number, target: number) =>
  noRatio(e, price) ? "text-ink-quiet" : e.costRatio > target + 0.1 ? "text-bad" : e.costRatio > target ? "text-warn" : "text-good";

/** Kasada (ModPOS) değiştirilecek fiyatı kalan satırlar */
const posPendingOf = (applied: readonly { posPending: boolean }[]) => applied.filter((a) => a.posPending).length;

/** Toplu değişikliğin ya da geri almasının sonucu (önizlemenin yerine durur) */
interface Outcome {
  /** "branch": şube fiyatı (Şube seçimi); geri alınmaz, anı gelmemiş satır Şube fiyatı sekmesinde iptal edilir */
  kind: "bulk" | "undo" | "branch";
  /** Toplu değişikliğin kimliği (geri alma ve "Tekrar dene" bununla) */
  batchId: string;
  note: string;
  applied: { productId: number; label: string; from: number; to: number; site: boolean; posPending: boolean }[];
  failed: { productId: number; label: string; from: number; to: number; reason: string }[];
  skipped: { productId: number; label: string; reason: string }[];
  /** Şube fiyatının şubesi ve anı ("Tekrar dene" aynısını gönderir) */
  target?: { branch: string; effectiveFrom: string };
}

/**
 * Ürünler › Fiyatlar › Toplu değiştir: ürünleri süz (kategori, boy, arama, pasifler), kuralı seç (yüzde, tutar,
 * önerilen fiyat) ve yuvarlamayı; önizlemede her satırın yeni fiyatı, maliyet oranı, birim kârı ve aylık etkisi. Satır
 * çıkarılabilir, yeni fiyat elle yazılabilir. "Fiyatları değiştir" onaydan sonra uygular: siteye bağlılar önce sitede
 * değişir (tek tek); sonuç değişenleri ve değişmeyenleri nedeniyle söyler, geri alınabilir (docs/FIYATLAR.md).
 */
export function BulkEditor({
  rows,
  categories,
  settings,
  siteConfigured,
  basis,
  salesMissing,
  kasa = "ModPOS",
  branchPrice = null,
}: {
  rows: BulkRow[];
  categories: { id: number; name: string }[];
  settings: PriceSettings;
  siteConfigured: boolean;
  /** Aylık etkinin satış dayanağı (zam etkisiyle aynı: price-loss.ts); satış verisi yoksa null */
  basis: SalesBasis | null;
  /** Satış verisi yokken ne yapılır (src/lib/sales-source.ts `missing`, bugünün ayı) */
  salesMissing: string;
  /** Bugünün kasası (src/lib/asilpos/kasa.ts): AsilPOS gününde siteye bağlı ürünün fiyatını AsilPOS siteden alır */
  kasa?: KasaName;
  /**
   * Şube seçimi (şube fiyatı, src/lib/prices/branch.ts): yazılabilen şubeler, kalemlerin tabanı (kuruş) ve sitenin şube
   * satırları; site `writes.branchPrice` duyurmadıysa null (seçim görünmez)
   */
  branchPrice?: {
    branches: { id: string; name: string }[];
    /** Açılıştaki şube: panelin seçili şubesi (yazılabilense); boş taban */
    defaultBranch?: string;
    defaultEffective: string;
    items: Record<string, { priceMinor: number; priceMinorL: number }>;
    rows: SiteBranchPrice[];
  } | null;
}) {
  // Süzgeçler adreste, Ürün listesiyle aynı adlarla (listedeki "Toplu fiyat" süzgeçleriyle açar)
  const [q, setQ] = useQueryText("ara");
  const [kategori, setKategori] = useQueryState<string>("kategori", "");
  const [boy, setBoy] = useQueryState<string>("boy", "");
  const [pasif, setPasif] = useQueryState<string>("pasif", "");
  const [sheet, setSheet] = useState(false);
  const selected = useMemo(() => parseCategoryParam(kategori).filter((id) => categories.some((c) => c.id === id)), [kategori, categories]);
  const size = parseSizeParam(boy);
  const includeInactive = pasif === "1";
  // Şube: boşsa taban (Tümü: sitenin fiyatı ve kendi fiyatı olmayan her şube); seçilince bugünkü fiyat şubenin Geçerlilik
  // anındaki fiyatıdır ve yalnız siteye bağlı ürünler değişir
  const [branchId, setBranchId] = useState(branchPrice?.defaultBranch ?? "");
  const [when, setWhen] = useState(() => (branchPrice ? effectiveLocalValue(branchPrice.defaultEffective) : ""));
  const branch = branchPrice?.branches.find((b) => b.id === branchId) ?? null;
  const effective = parseEffectiveLocal(when);
  const effectiveAt = effective.ok ? Date.parse(effective.iso) : branchPrice ? Date.parse(branchPrice.defaultEffective) : 0;
  const baseRows = useMemo(
    () => (branch && branchPrice ? branchBulkRows(rows, { items: branchPrice.items, rows: branchPrice.rows, branch: branch.id, at: effectiveAt }) : rows),
    [rows, branch, branchPrice, effectiveAt],
  );
  const scope = useMemo(() => filterBulkRows(baseRows, { categories: selected, size, q, includeInactive }), [baseRows, selected, size, q, includeInactive]);
  const inactiveCount = rows.filter((r) => !r.active).length;
  const categoryCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (includeInactive || r.active) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    return m;
  }, [rows, includeInactive]);
  const sizeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if ((includeInactive || r.active) && (!selected.length || selected.includes(r.categoryId))) m.set(r.size, (m.get(r.size) ?? 0) + 1);
    return m;
  }, [rows, includeInactive, selected]);
  const toggleCategory = (id: number) => setKategori((selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(","));
  const anyFilter = q.trim() !== "" || selected.length > 0 || size !== null || includeInactive;
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "kategori", "boy", "pasif"]);
  };
  const summaryLine = filterSummary([...selected.map((id) => categories.find((c) => c.id === id)?.name), size ? sizeLabel(size) : null, includeInactive && "Pasifler dahil"]);

  // Kural
  const [kind, setKind] = useState<Kind>("percent");
  const [amount, setAmount] = useState("");
  /** Seçilmediyse (null) yuvarlama değişikliğin yönüne göre: artışta 5'e yukarı, indirimde 5'e aşağı */
  const [roundingChoice, setRoundingChoice] = useState<RoundingId | null>(null);
  const parsed = kind === "suggested" ? { value: null, error: null } : parseRuleAmount(amount, kind);
  const roundingId = roundingChoice ?? defaultRounding(parsed.value ?? 0);
  const rule = useMemo<BulkRule | null>(
    () => (kind === "suggested" ? { kind } : parsed.value !== null ? { kind, value: parsed.value, rounding: roundingById(roundingId) } : null),
    [kind, parsed.value, roundingId],
  );

  // Satır seçimleri: elle yazılan fiyat ve çıkarılanlar
  const [overrides, setOverrides] = useState<ReadonlyMap<number, number>>(() => new Map());
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [showUnchanged, setShowUnchanged] = useState(false);

  const preview = useMemo(
    () => previewRows(scope, rule, overrides, excluded, settings, { siteConfigured, branch: !!branch }),
    [scope, rule, overrides, excluded, settings, siteConfigured, branch],
  );
  const listed = preview.filter((p) => !p.unchanged || p.overridden);
  const unchanged = preview.filter((p) => p.unchanged && !p.overridden);
  const summary = bulkSummary(preview);
  const selectable = listed.filter((p) => !p.blocked && !p.unchanged);

  /** Elle yazılan fiyat; kuralın fiyatına eşitse elle sayılmaz */
  const setOverride = (row: PreviewRow, value: number | null) =>
    setOverrides((m) => {
      const next = new Map(m);
      const ruled = rule ? rulePrice(row.price, row.suggestedPrice, rule) : row.price;
      if (value === null || toMinor(value) === toMinor(ruled)) next.delete(row.id);
      else next.set(row.id, value);
      return next;
    });
  const toggleRow = (id: number) =>
    setExcluded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = (on: boolean) =>
    setExcluded((s) => {
      const next = new Set(s);
      for (const p of selectable) {
        if (on) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });

  // Uygulama ve sonuç
  const [pending, start] = useActionTransition();
  const [confirm, setConfirm] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  // Sonuç önizlemenin yerine çıkar: telefonda denetimlerin altında, genişte uzun önizlemenin kaydırıldığı yerde
  // kalabilir; görünmüyorsa görünür alana getirilir (eylem sonrası kaydırma koruması bunu geri almasın)
  useEffect(() => {
    const el = resultRef.current;
    if (!outcome || !el) return;
    const top = el.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight - 160) return;
    releaseScroll();
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [outcome]);
  const [showApplied, setShowApplied] = useState(false);
  /** Uygulanan değişiklikte siteye bağlı ürün var (çubuk "Siteye yazılıyor…" der) */
  const [linkedRun, setLinkedRun] = useState(false);

  const items = preview.filter((p) => p.applicable).map((p) => ({ productId: p.id, from: p.price, to: p.newPrice }));
  const overridesApplied = preview.filter((p) => p.applicable && p.overridden).length;
  const scopeNames = selected.map((id) => categories.find((c) => c.id === id)?.name).filter((x): x is string => !!x);
  const note = rule ? ruleSummary(rule, { categories: scopeNames, size }, overridesApplied) : `${num(overridesApplied)} fiyat elle`;

  function resetRule() {
    setAmount("");
    setOverrides(new Map());
    setExcluded(new Set());
  }

  function apply() {
    setConfirm(false);
    setLinkedRun(summary.linked > 0);
    const sent = { items, note };
    if (branch) {
      if (!effective.ok) return void toast.error(effective.error);
      const target = { branch: branch.id, effectiveFrom: effective.iso };
      return start(async () => {
        const r = await applyBranchPrices({ ...target, ...sent });
        if (!r.ok) return void toast.error(r.error);
        const res = r.data;
        const label = `${branch.name} · ${effectiveFromText(target.effectiveFrom)} · ${sent.note}`;
        setOutcome({ kind: "branch", batchId: "", note: label, applied: res.applied.map((a) => ({ ...a, site: true, posPending: false })), failed: res.failed, skipped: [], target });
        setShowApplied(false);
        resetRule();
        if (res.applied.length) toast.success(`${num(res.applied.length)} şube fiyatı yazıldı`, { description: `${branch.name}, ${effectiveFromText(target.effectiveFrom)}; AsilPOS o anda siteden alır` });
        else toast.error("Hiçbir şube fiyatı yazılmadı", { description: res.failed[0]?.reason });
      });
    }
    start(async () => {
      const r = await applyBulkPrices(sent);
      if (!r.ok) return void toast.error(r.error);
      const res = r.data;
      setOutcome({ kind: "bulk", batchId: res.batchId, note: sent.note, applied: res.applied, failed: res.failed, skipped: [] });
      setShowApplied(false);
      resetRule();
      if (res.applied.length) toast.success(`${num(res.applied.length)} fiyat değişti`, { description: batchPosNote("bulk", res.applied, kasa) });
      else toast.error("Hiçbir fiyat değişmedi", { description: res.failed[0]?.reason });
    });
  }

  /** Değişmeyenleri yeniden dener: aynı kimlik ve not, bugünkü fiyatlarla (sayfa yenilendi) */
  function retry() {
    if (!outcome) return;
    const o = outcome;
    if (o.kind === "undo") return undo(o.batchId);
    // Şube fiyatı yeniden gönderilir (önizlemedeki şube fiyatıyla): aynı satır sitede zaten varsa ikinci kez yazılmaz
    if (o.kind === "branch" && o.target && branchPrice) {
      const target = o.target;
      const current = new Map(branchBulkRows(rows, { items: branchPrice.items, rows: branchPrice.rows, branch: target.branch, at: Date.parse(target.effectiveFrom) }).map((r) => [r.id, r.price]));
      const again = o.failed.flatMap((f) => {
        const from = current.get(f.productId);
        return from === undefined || toMinor(from) === toMinor(f.to) ? [] : [{ productId: f.productId, from, to: f.to }];
      });
      if (!again.length) return void setOutcome({ ...o, failed: [] });
      return start(async () => {
        const r = await applyBranchPrices({ ...target, items: again, note: o.note });
        if (!r.ok) return void toast.error(r.error);
        const res = r.data;
        setOutcome({ ...o, applied: [...o.applied, ...res.applied.map((a) => ({ ...a, site: true, posPending: false }))], failed: res.failed });
        if (res.applied.length) toast.success(`${num(res.applied.length)} şube fiyatı daha yazıldı`);
        else toast.error("Yine yazılmadı", { description: res.failed[0]?.reason });
      });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Silinmiş ürün yeniden denenmez (listede kalır); fiyatı zaten yeni olan listeden düşer
    const missing = o.failed.filter((f) => !byId.has(f.productId));
    const again = o.failed.flatMap((f) => {
      const from = byId.get(f.productId)?.price;
      return from === undefined || toMinor(from) === toMinor(f.to) ? [] : [{ productId: f.productId, from, to: f.to }];
    });
    if (!again.length) {
      setOutcome({ ...o, failed: missing });
      return void toast.success("Değişmeyen kalmadı; fiyatlar zaten yeni hâlinde");
    }
    setLinkedRun(again.some((i) => !!byId.get(i.productId)?.site));
    start(async () => {
      const r = await applyBulkPrices({ items: again, note: o.note, batchId: o.batchId });
      if (!r.ok) return void toast.error(r.error);
      const res = r.data;
      setOutcome({ ...o, applied: [...o.applied, ...res.applied], failed: [...res.failed, ...missing] });
      if (res.applied.length) toast.success(`${num(res.applied.length)} fiyat daha değişti`);
      else toast.error("Yine değişmedi", { description: res.failed[0]?.reason });
    });
  }

  function undo(batchId: string) {
    setConfirmUndo(false);
    setLinkedRun(outcome?.applied.some((a) => a.site) ?? false);
    start(async () => {
      const r = await undoPriceBatch(batchId);
      if (!r.ok) return void toast.error(r.error);
      const res = r.data;
      setOutcome({ kind: "undo", batchId, note: outcome?.note ?? "", applied: res.applied, failed: res.failed, skipped: res.skipped });
      setShowApplied(false);
      if (res.applied.length) toast.success(`${num(res.applied.length)} fiyat eski haline döndü`, { description: batchPosNote("undo", res.applied, kasa) });
      else toast.error("Hiçbir fiyat geri alınmadı", { description: res.failed[0]?.reason });
    });
  }

  const target = settings.hedefMaliyet;
  const ruleCaption = rule ? ruleText(rule) : null;

  // ---------------------------------------------------------------- Görünüm

  const branchField = branchPrice ? (
    <div className="space-y-3">
      <Field label="Şube" htmlFor="bulk-branch" hint={branch ? "Yalnız siteye bağlı ürünler; taban (Tuzla) değişmez." : "Tümü: sitenin fiyatı (Tuzla ve kendi fiyatı olmayan her şube)."}>
        <Select
          id="bulk-branch"
          value={branchId}
          onChange={(e) => {
            // Bugünkü fiyat şubeye göre değişir: elle yazılanlar ve çıkarılanlar sıfırlanır
            setBranchId(e.target.value);
            setOverrides(new Map());
            setExcluded(new Set());
          }}
          className="h-11 sm:h-9"
        >
          <option value="">Tümü (taban fiyat)</option>
          {branchPrice.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      {branch ? (
        <Field label="Geçerlilik" htmlFor="bulk-effective" error={effective.ok ? null : effective.error} hint="Varsayılan sonraki iş günü 05:00 (İstanbul).">
          <Input id="bulk-effective" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="h-11 sm:h-9" />
        </Field>
      ) : null}
    </div>
  ) : null;

  const productsCard = (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title="Ürünler"
        description="Fiyatı değişecek ürünleri süzün; önizlemede tek tek çıkarabilirsiniz."
        meta={<span className="tabular">{num(scope.length)} ürün seçili</span>}
      />
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <SearchField value={q} onChange={setQ} placeholder="Ürün ara" label="Ürün, boy ya da kategori ara" className="min-w-0 flex-1 max-sm:[&_input]:h-11" />
          <FilterSheetButton className="sm:hidden" count={summaryLine.count} onClick={() => setSheet(true)} />
        </div>
        <FilterSummaryLine className="sm:hidden" text={summaryLine.text} onClick={() => setSheet(true)} />
        {/* Geniş ekranda süzgeçler kartta; telefonda alttan açılan pencerede */}
        <div className="space-y-3 max-sm:hidden">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategori">
            <FilterChip active={!selected.length} onToggle={() => setKategori("")}>
              Tümü
            </FilterChip>
            {categories.map((c) => (
              <FilterChip key={c.id} active={selected.includes(c.id)} onToggle={() => toggleCategory(c.id)} count={categoryCounts.get(c.id) ?? 0}>
                {c.name}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Boy">
            <FilterChip active={size === null} onToggle={() => setBoy("")}>
              Tüm boylar
            </FilterChip>
            {SIZES.map((x) => (
              <FilterChip key={x} active={size === x} onToggle={() => setBoy(size === x ? "" : x)} count={sizeCounts.get(x) ?? 0}>
                {SIZE_LABELS[x]}
              </FilterChip>
            ))}
          </div>
          {inactiveCount ? (
            <FilterChip active={includeInactive} onToggle={() => setPasif(includeInactive ? "" : "1")} count={inactiveCount}>
              Pasifleri de dahil et
            </FilterChip>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );

  const ruleCard = (
    <Card>
      <CardHeader icon={<Percent />} title="Değişiklik" description="Bir toplu değişiklikte tek kural; kategoriye göre farklı kural için iki kez yapın." />
      <CardContent className="space-y-4">
        {branchField}
        <Segmented stretch label="Kural" value={kind} onChange={setKind} options={KINDS} />
        {kind === "suggested" ? (
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm leading-6 text-ink-soft">
            Fiyatı önerilen fiyatın altında kalan ürünleri önerilen fiyata çeker (hedef maliyet oranı %{num(target * 100)}, 5 ₺&apos;ye yukarı). Hiçbir fiyat düşmez.
          </p>
        ) : (
          <>
            <Field
              label={kind === "percent" ? "Yüzde" : "Tutar"}
              htmlFor="bulk-amount"
              error={parsed.error}
              hint={kind === "percent" ? "Artış için 10, indirim için -5 yazın." : "Artış için 5, indirim için -5 yazın (₺, KDV dahil)."}
            >
              <div className="relative">
                {/* Eksi yazılabilsin diye harfli klavye (iOS'un ondalık klavyesinde eksi yok) */}
                <NumberInput
                  id="bulk-amount"
                  inputMode="text"
                  aria-label="Değişiklik"
                  placeholder={kind === "percent" ? "10" : "5"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={parsed.error ? true : undefined}
                  className="h-11 pr-9 text-base font-semibold sm:h-10 sm:text-sm"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-mute" aria-hidden="true">
                  {kind === "percent" ? "%" : "₺"}
                </span>
              </div>
            </Field>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Hızlı seçim">
              {QUICK[kind].map((x) => (
                <FilterChip key={x.text} active={parsed.value === Number(x.text)} onToggle={() => setAmount(x.text)} className="h-11 justify-center sm:h-9">
                  {x.label}
                </FilterChip>
              ))}
            </div>
            <Field label="Yuvarlama" htmlFor="bulk-rounding" hint={roundingChoice === null ? "İndirimde kendiliğinden 5 ₺'ye aşağı." : undefined}>
              <Select id="bulk-rounding" value={roundingId} onChange={(e) => setRoundingChoice(e.target.value as RoundingId)} className="h-11 sm:h-9">
                {ROUNDINGS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );

  const stats = (
    // Dört sütun yalnız önizleme kartı yeterince genişse (kart genişliğine göre; dizüstünde ikişer)
    <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
      <Stat compact label="Değişecek" value={`${num(summary.count)} ürün`} sub={summary.linked ? `${numPossessive(summary.linked)} sitede de` : "Yalnız panelde"} />
      <Stat
        compact
        label="Ortalama değişim"
        value={summary.avgPct === null ? "–" : signedPct(summary.avgPct)}
        sub={summary.decreases ? `${num(summary.decreases)} ürünün fiyatı düşüyor` : undefined}
        tone={summary.decreases && summary.decreases === summary.count ? "warn" : "default"}
      />
      <Stat
        compact
        label="Maliyet oranı (ort.)"
        info="Değişecek, reçetesi olan ürünlerin basit ortalaması (Ürün listesinin ORTALAMA satırıyla aynı kural)."
        value={summary.ratioBefore === null || summary.ratioAfter === null ? "–" : `${pct(summary.ratioBefore, 0)} → ${pct(summary.ratioAfter, 0)}`}
        sub={`Hedef %${num(target * 100)}`}
      />
      <Stat
        compact
        label="Aylık brüt kâr"
        info={basis ? `${basisText(basis)} Ürüne eşleşmeyen satışlar sayılmadı. Birim kâr farkı × ayda satılan adet; adet fiyatla değişmez sayılır.` : undefined}
        value={basis ? <Signed value={summary.monthlyDelta}>{signedMoney(Math.round(summary.monthlyDelta))}</Signed> : "–"}
        sub={basis ? "Satış adedi aynı kalırsa" : "Satış verisi yok"}
      />
    </div>
  );

  const previewCard = (
    <Card>
      <CardHeader
        icon={<Eye />}
        title="Önizleme"
        description={ruleCaption ? `${ruleCaption}${overridesApplied ? ` · ${num(overridesApplied)} fiyat elle` : ""}` : "Kuralı yazınca her ürünün yeni fiyatı burada görünür."}
        actions={
          selectable.length ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => selectAll(true)} disabled={selectable.every((p) => !p.excluded)}>
                Tümünü seç
              </Button>
              <Button size="sm" variant="ghost" onClick={() => selectAll(false)} disabled={selectable.every((p) => p.excluded)}>
                Hiçbirini
              </Button>
            </div>
          ) : null
        }
      />
      {!scope.length ? (
        <EmptyState
          icon={<SearchX />}
          title="Bu seçimle ürün yok"
          description="Aramayı kısaltın ya da kategori süzgecini kaldırın."
          action={
            anyFilter ? (
              <Button variant="secondary" onClick={clearFilters}>
                Süzgeci temizle
              </Button>
            ) : undefined
          }
        />
      ) : !listed.length ? (
        <CardContent>
          <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-soft" role="status">
            {!rule
              ? "Bir değişiklik yazın: ör. %10 ya da 5 ₺. Önizleme burada görünür."
              : rule.kind === "suggested"
                ? "Seçilen ürünlerin fiyatı zaten önerilen fiyatta ya da üstünde; değişecek fiyat yok."
                : "Bu kuralla hiçbir fiyat değişmiyor (yuvarlama aynı fiyata getiriyor). Yuvarlamayı değiştirin."}
          </p>
        </CardContent>
      ) : (
        <>
          <CardContent className="@container space-y-2">
            {stats}
            {basis ? (
              <p className="text-xs text-ink-mute">{basisText(basis)} Ürüne eşleşmeyen satışlar sayılmadı.</p>
            ) : (
              <p className="text-xs text-ink-mute">Aylık etkiyi görmek için satış verisi gerekir: {salesMissing}.</p>
            )}
          </CardContent>
          <PreviewTable rows={listed} target={target} onToggle={toggleRow} onOverride={setOverride} hasBasis={!!basis} />
          <PreviewCards rows={listed} target={target} onToggle={toggleRow} onOverride={setOverride} />
        </>
      )}
      {unchanged.length && listed.length ? (
        <div className="border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setShowUnchanged((v) => !v)}
            aria-expanded={showUnchanged}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
          >
            <ChevronDown size={14} className={cn("transition-transform", showUnchanged && "rotate-180")} aria-hidden="true" />
            Değişmeyen {num(unchanged.length)} ürün ({rule?.kind === "suggested" ? "fiyatı önerilen fiyatta ya da üstünde" : "yuvarlama aynı fiyata getiriyor"})
          </button>
          {showUnchanged ? (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-mute">
              {unchanged.map((p) => (
                <li key={p.id} className="tabular">
                  {p.name} · {p.size} <span className="text-ink-soft">{money(p.price)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );

  const resultCard = outcome ? (
    <ResultCard
      outcome={outcome}
      kasa={kasa}
      pending={pending}
      showApplied={showApplied}
      onShowApplied={setShowApplied}
      onRetry={retry}
      onUndo={() => setConfirmUndo(true)}
      onNew={() => {
        setOutcome(null);
        resetRule();
      }}
    />
  ) : null;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Denetimler genişte solda; sütun önizlemenin boyuna uzar, önizlemede aşağı inerken kural kartı üstte kalır
            (yalnız yeterince uzun ekranda: kart ekrandan uzunsa alt kısmı görünmez kalırdı) */}
        <div className="min-w-0 space-y-4">
          {productsCard}
          <div className="xl:top-6 xl:[@media(min-height:40rem)]:sticky">{ruleCard}</div>
        </div>
        <div ref={resultRef} className="min-w-0 scroll-mt-24">
          {outcome ? resultCard : previewCard}
        </div>
      </div>

      <FilterSheet open={sheet} onClose={() => setSheet(false)} onClear={() => clearQuery(["kategori", "boy", "pasif"])} canClear={summaryLine.count > 0} shown={scope.length} unit="ürün">
        <SheetSection title="Kategori">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Kategori">
            <FilterChip active={!selected.length} onToggle={() => setKategori("")} className={SHEET_CHIP}>
              Tümü
            </FilterChip>
            {categories.map((c) => (
              <FilterChip key={c.id} active={selected.includes(c.id)} onToggle={() => toggleCategory(c.id)} count={categoryCounts.get(c.id) ?? 0} className={SHEET_CHIP}>
                <span className="min-w-0 truncate">{c.name}</span>
              </FilterChip>
            ))}
          </div>
        </SheetSection>
        <SheetSection title="Boy">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Boy">
            <FilterChip active={size === null} onToggle={() => setBoy("")} className={SHEET_CHIP}>
              Tüm boylar
            </FilterChip>
            {SIZES.map((x) => (
              <FilterChip key={x} active={size === x} onToggle={() => setBoy(size === x ? "" : x)} count={sizeCounts.get(x) ?? 0} className={SHEET_CHIP}>
                {SIZE_LABELS[x]}
              </FilterChip>
            ))}
          </div>
        </SheetSection>
        {inactiveCount ? (
          <SheetToggle
            title="Pasif ürünleri de dahil et"
            description={`${num(inactiveCount)} ürün menüde pasif`}
            checked={includeInactive}
            onChange={(v) => setPasif(v ? "1" : "")}
            label="Pasif ürünleri de dahil et"
          />
        ) : null}
      </FilterSheet>

      <FloatingBar open={!outcome && summary.count > 0}>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-ink tabular">
            {branch ? `${num(summary.count)} fiyat ${locativeTR(branch.name)} değişecek` : `${num(summary.count)} fiyat değişecek${summary.linked ? ` · ${numPossessive(summary.linked)} sitede de` : ""}`}
          </p>
          {pending ? <p className="text-xs text-ink-mute">{linkedRun ? "Siteye yazılıyor…" : "Kaydediliyor…"}</p> : null}
        </div>
        <Button onClick={() => setConfirm(true)} disabled={pending || (!!branch && !effective.ok)} className="h-11 px-4 pointer-coarse:h-11 sm:h-9">
          {pending ? "Değiştiriliyor…" : "Fiyatları değiştir"}
        </Button>
      </FloatingBar>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={apply}
        tone="primary"
        confirmLabel="Değiştir"
        title={branch ? `${num(summary.count)} ürünün ${branch.name} fiyatı değişsin mi?` : `${num(summary.count)} ürünün fiyatı değişsin mi?`}
        description={(branch && effective.ok
          ? [
              `${note}.`,
              `${locativeTR(branch.name)} ${effectiveFromText(effective.iso)} geçerli; taban (Tuzla) değişmez. Fiyatlar siteye kalem kalem yazılır, AsilPOS o anda siteden alır.`,
              "Anı gelmeden Şube fiyatı sekmesinden iptal edebilirsiniz.",
            ]
          : [
          `${note}.`,
          summary.linked ? `${num(summary.linked)} ürün laffogato.net menüsünde de değişir (siteye tek tek yazılır, birkaç saniye sürebilir).` : null,
          kasa === "AsilPOS"
            ? summary.count > summary.linked
              ? `AsilPOS siteye bağlı ürünlerin fiyatını siteden alır. Bağlı olmayan ${num(summary.count - summary.linked)} ürün Kasaya işle sekmesinde: AsilPOS onları siteden alıyorsa Ürünler › Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin, AsilPOS'ta yerelse orada elle değiştirin.`
              : "AsilPOS yeni fiyatları siteden alır; kasada bir şey yapmanız gerekmez."
            : "Kasadaki (ModPOS) fiyatları elle değiştirmeniz gerekecek; liste Kasaya işle sekmesinde.",
          summary.decreases ? `${num(summary.decreases)} ürünün fiyatı düşüyor.` : null,
            ]
        )
          .filter(Boolean)
          .join(" ")}
      />
      <ConfirmDialog
        open={confirmUndo}
        onClose={() => setConfirmUndo(false)}
        onConfirm={() => outcome && undo(outcome.batchId)}
        tone="primary"
        confirmLabel="Geri al"
        title="Toplu değişiklik geri alınsın mı?"
        description={
          outcome
            ? `${num(outcome.applied.length)} ürünün fiyatı eski haline döner${
                outcome.applied.some((a) => a.site) ? ` (${numPossessive(outcome.applied.filter((a) => a.site).length)} sitede de)` : ""
              }. Bu arada fiyatı değişen ürünlere dokunulmaz.`
            : undefined
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- Satırlar

/** Satırın rozetleri: pasif, sitede de değişir, durum değişimi, zararına, elle, engel nedeni */
function RowBadges({ p, onRule }: { p: PreviewRow; onRule: () => void }) {
  const statusChange = p.before.status !== p.after.status && p.cost > 0;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1">
      {!p.active ? <Badge tone="gray">Pasif</Badge> : null}
      {p.linked && !p.blocked ? (
        <Badge tone="blue" dot title="Fiyat önce laffogato.net'te değişir">
          Sitede de değişir
        </Badge>
      ) : null}
      {statusChange && !p.blocked ? (
        <Badge tone={STATUS_TONE[p.after.status]} dot>
          {p.before.status} → {p.after.status}
        </Badge>
      ) : null}
      {p.cost > 0 && p.after.unitProfit < 0 && !p.blocked && !p.unchanged ? (
        <Badge tone="red" dot title="Yeni fiyatta birim kâr eksi: maliyet ve komisyon fiyatı geçiyor">
          Zararına
        </Badge>
      ) : null}
      {p.overridden ? (
        <>
          <Badge tone="gray">elle</Badge>
          <button type="button" onClick={onRule} className="cursor-pointer text-xs font-medium text-info hover:underline pointer-coarse:-my-2 pointer-coarse:py-2">
            kurala dön
          </button>
        </>
      ) : null}
      {p.overridden && p.unchanged ? <span className="text-xs text-ink-mute">değişmez</span> : null}
    </span>
  );
}

/** Engellenen satırın nedeni (kırmızı; sitede silinen kalem kendiliğinden düzelir, turuncu) */
function BlockText({ p }: { p: PreviewRow }) {
  if (!p.blocked) return null;
  return <span className={cn("mt-1 block text-xs leading-5", p.site === "missing" ? "text-warn" : "text-bad")}>{p.blocked}</span>;
}

/**
 * Yeni fiyat: dokununca alana döner (Enter ya da alandan çıkmak yazar, Esc vazgeçer); yazılan fiyat kuralın yerine
 * geçer ve aynı denetimden geçer.
 */
function NewPrice({ p, onOverride, className }: { p: PreviewRow; onOverride: (row: PreviewRow, v: number | null) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const cancelled = useRef(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(priceText(p.newPrice));
          setEditing(true);
        }}
        disabled={!!p.blocked && !p.overridden}
        title="Fiyatı elle yazın"
        aria-label={`${p.name} ${p.size} yeni fiyat ${money(p.newPrice)}; elle yazmak için dokunun`}
        className={cn(
          "-my-1 inline-flex min-h-8 cursor-pointer items-center rounded-lg px-1.5 font-semibold text-ink tabular underline decoration-ink/25 decoration-dotted underline-offset-4 hover:bg-surface disabled:cursor-default disabled:no-underline pointer-coarse:min-h-11",
          p.excluded && "text-ink-mute line-through decoration-solid",
          className,
        )}
      >
        {money(p.newPrice)}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const v = parseNumberTR(text);
    if (v === null || v < 0) return void toast.error("Geçerli bir fiyat girin (ör. 185 ya da 185,50)");
    onOverride(p, Math.round(v * 100) / 100);
  };
  return (
    <span className={cn("relative inline-block w-24", className)}>
      <NumberInput
        autoFocus
        aria-label={`${p.name} ${p.size} yeni fiyat (₺, KDV dahil)`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="cell-input pr-6 pl-2 max-sm:h-11 max-sm:font-semibold"
      />
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-mute" aria-hidden="true">
        ₺
      </span>
    </span>
  );
}

interface RowsProps {
  rows: PreviewRow[];
  target: number;
  onToggle: (id: number) => void;
  onOverride: (row: PreviewRow, v: number | null) => void;
}

/** Geniş ekran: tablo (ilk sütun yatay kaydırmada sabit) */
function PreviewTable({ rows, target, onToggle, onOverride, hasBasis }: RowsProps & { hasBasis: boolean }) {
  return (
    <TableWrap className="max-sm:hidden">
      <Table className="[&_td]:px-1.5 [&_td:first-child]:pl-3 [&_td:last-child]:pr-3 [&_th]:px-1.5 [&_th:first-child]:pl-3 [&_th:last-child]:pr-3 2xl:[&_td]:px-2 2xl:[&_th]:px-2">
        <THead className="[&_th]:align-bottom">
          <tr>
            <TH sticky>Ürün</TH>
            <TH numeric>Şimdi</TH>
            <TH numeric>Yeni</TH>
            {/* İki satırlık başlıklar (ürün listesindeki gibi): tablo dizüstü genişliğinde yana kaymadan sığar */}
            <TH numeric className="whitespace-normal">
              Maliyet oranı
            </TH>
            <TH numeric className="whitespace-normal">
              Birim kâr
            </TH>
            <TH numeric className="whitespace-normal">
              Aylık etki <InfoTip text="Birim kâr farkı × ayda satılan adet (satış adedi aynı kalırsa)." />
            </TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((p) => {
            const diff = p.newPrice - p.price;
            const dim = p.excluded || !!p.blocked;
            return (
              <TR key={p.id}>
                <TD sticky className="max-w-[16rem] min-w-36">
                  <label className={cn("flex items-start gap-2.5", p.blocked || p.unchanged ? "cursor-default" : "cursor-pointer")}>
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 cursor-pointer rounded accent-ink disabled:cursor-default"
                      checked={!p.excluded && !p.blocked && !p.unchanged}
                      disabled={!!p.blocked || p.unchanged}
                      onChange={() => onToggle(p.id)}
                      aria-label={`${p.name} ${p.size} değişsin`}
                    />
                    <span className="min-w-0">
                      <span className={cn("flex items-center gap-1.5 font-semibold break-words", dim ? "text-ink-mute" : "text-ink")}>
                        {p.name}
                        {p.linked ? <Globe size={13} className="shrink-0 text-info" aria-label="laffogato.net menüsüne bağlı" /> : null}
                      </span>
                      <span className="block text-[13px] leading-5 text-ink-mute">
                        {sizeLabel(p.size)} · {p.category}
                      </span>
                      <BlockText p={p} />
                    </span>
                  </label>
                  <RowBadges p={p} onRule={() => onOverride(p, null)} />
                </TD>
                <TD numeric className="text-ink-mute">
                  {money(p.price)}
                </TD>
                <TD numeric>
                  <NewPrice p={p} onOverride={onOverride} />
                  {!p.unchanged ? (
                    <span className={cn("block text-xs", diff < 0 ? "text-warn" : "text-ink-mute")}>
                      {signedMoney(diff)}
                      {p.price > 0 ? ` · ${signedPct(diff / p.price)}` : ""}
                    </span>
                  ) : null}
                </TD>
                <TD numeric>
                  {p.before.status === "Reçete yok" ? (
                    <span className="text-ink-quiet">Reçete yok</span>
                  ) : (
                    <>
                      <span className="text-ink-mute">{ratioText(p.before, p.price)}</span> →{" "}
                      <span className={cn("font-medium", ratioTone(p.after, p.newPrice, target))}>{ratioText(p.after, p.newPrice)}</span>
                    </>
                  )}
                </TD>
                {/* Tam lira: önce → sonra karşılaştırması (kuruşu ürün kartında); tablo dizüstü genişliğine sığar */}
                <TD numeric>
                  <span className="text-ink-mute">{num(p.before.unitProfit, 0)}</span> →{" "}
                  <Signed value={p.after.unitProfit} className="font-medium">
                    {num(p.after.unitProfit, 0)}
                  </Signed>
                </TD>
                <TD numeric>
                  {hasBasis && p.monthlyQty > 0 && !p.unchanged ? (
                    <Signed value={p.monthlyDelta} className={cn(dim && "text-ink-mute")}>
                      {signedMoney(Math.round(p.monthlyDelta))}
                    </Signed>
                  ) : (
                    <span className="text-ink-quiet" title={hasBasis ? "Son satış ayında satılmadı" : "Satış verisi yok"}>
                      –
                    </span>
                  )}
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** Telefon: her ürün bir satır kartı; işaret kutusu solda (44px), fiyat sağda */
function PreviewCards({ rows, target, onToggle, onOverride }: RowsProps) {
  return (
    <ul className="mx-2 mb-2 divide-y divide-line-strong/70 sm:hidden" aria-label="Önizleme">
      {rows.map((p) => {
        const diff = p.newPrice - p.price;
        const dim = p.excluded || !!p.blocked;
        return (
          <li key={p.id} className="flex gap-1 py-2.5 pr-2">
            <label className={cn("flex size-11 shrink-0 items-center justify-center", p.blocked || p.unchanged ? "cursor-default" : "cursor-pointer")}>
              <input
                type="checkbox"
                className="size-5 cursor-pointer rounded accent-ink disabled:cursor-default"
                checked={!p.excluded && !p.blocked && !p.unchanged}
                disabled={!!p.blocked || p.unchanged}
                onChange={() => onToggle(p.id)}
                aria-label={`${p.name} ${p.size} değişsin`}
              />
            </label>
            <div className="min-w-0 flex-1 pt-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className={cn("min-w-0 text-[15px] leading-6 font-semibold break-words", dim ? "text-ink-mute" : "text-ink")}>
                  {p.name} <span className="font-normal text-ink-mute">· {p.size}</span>
                </p>
                <p className="flex shrink-0 items-center gap-1 text-sm whitespace-nowrap tabular">
                  <span className="text-ink-mute">{money(p.price)}</span>
                  <ArrowRight size={13} className="text-ink-quiet" aria-label="yeni" />
                  <NewPrice p={p} onOverride={onOverride} />
                </p>
              </div>
              {!p.unchanged ? (
                <p className="text-xs leading-5 text-ink-mute tabular">
                  {/* Parçalar kendi içinde bölünmez (ok satır başına düşmesin) */}
                  <span className={diff < 0 ? "text-warn" : undefined}>{signedMoney(diff)}</span>
                  {p.before.status !== "Reçete yok" ? (
                    <>
                      {" · "}
                      <span className="whitespace-nowrap">
                        maliyet oranı {ratioText(p.before, p.price)} →{" "}
                        <span className={cn("font-medium", ratioTone(p.after, p.newPrice, target))}>{ratioText(p.after, p.newPrice)}</span>
                      </span>
                    </>
                  ) : null}
                  {" · "}
                  <span className="whitespace-nowrap">
                    birim kâr {num(p.before.unitProfit, 0)} → {num(p.after.unitProfit, 0)}
                  </span>
                </p>
              ) : null}
              <BlockText p={p} />
              <RowBadges p={p} onRule={() => onOverride(p, null)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Sonuç

function ResultCard({
  outcome,
  kasa,
  pending,
  showApplied,
  onShowApplied,
  onRetry,
  onUndo,
  onNew,
}: {
  outcome: Outcome;
  kasa: KasaName;
  pending: boolean;
  showApplied: boolean;
  onShowApplied: (v: boolean) => void;
  onRetry: () => void;
  onUndo: () => void;
  onNew: () => void;
}) {
  const site = outcome.applied.filter((a) => a.site).length;
  const n = outcome.applied.length;
  const pos = posPendingOf(outcome.applied);
  const undo = outcome.kind === "undo";
  const branch = outcome.kind === "branch";
  const title = branch
    ? n
      ? `${num(n)} şube fiyatı yazıldı.`
      : "Hiçbir şube fiyatı yazılmadı."
    : n
    ? `${num(n)} fiyat ${undo ? "eski haline döndü" : "değişti"}${site ? ` (${numPossessive(site)} sitede de)` : ""}.`
    : undo
      ? "Hiçbir fiyat geri alınmadı."
      : "Hiçbir fiyat değişmedi.";
  // Elle yapılacaklar: sitede fiyat listesinin tarihi; geri almada kasada bir şey kalıp kalmadığı (toplu değişiklikte
  // kasaya giden düğme zaten aşağıda)
  const notes = [site && !branch ? "Fiyat listesinin tarihini sitede (Ayarlar → Vergi) güncellemeyi unutma." : null, undo && n ? batchPosNote("undo", outcome.applied, kasa) : null].filter(
    (x): x is string => !!x,
  );
  return (
    <Card>
      <CardHeader icon={n ? <CheckCircle2 className="text-good" /> : <RotateCcw />} title={title} description={outcome.note || undefined} />
      <CardContent className="space-y-4">
        {notes.length ? (
          <ul className="space-y-1 text-sm text-ink-soft">
            {notes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : null}
        {outcome.failed.length ? (
          <Notice
            tone="bad"
            title={`${num(outcome.failed.length)} ürün ${undo ? "geri alınamadı" : "değişmedi"}`}
            text={
              <ul className="space-y-1">
                {outcome.failed.map((f) => (
                  <li key={f.productId} className="break-words">
                    <span className="font-medium text-ink">{f.label}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            }
            action={
              <Button size="sm" variant="secondary" onClick={onRetry} disabled={pending}>
                <RotateCcw size={14} aria-hidden="true" /> {pending ? "Deneniyor…" : `Tekrar dene (${num(outcome.failed.length)})`}
              </Button>
            }
          />
        ) : null}
        {outcome.skipped.length ? (
          <div className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-soft">
            <p className="font-medium text-ink">Dokunulmayan {num(outcome.skipped.length)} ürün:</p>
            <ul className="mt-1 space-y-0.5">
              {outcome.skipped.map((s) => (
                <li key={s.productId}>
                  {s.label} — {s.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {n ? (
          <div>
            <button
              type="button"
              onClick={() => onShowApplied(!showApplied)}
              aria-expanded={showApplied}
              className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11"
            >
              <ChevronDown size={14} className={cn("transition-transform", showApplied && "rotate-180")} aria-hidden="true" />
              {showApplied ? "Gizle" : `${undo ? "Eski haline dönenler" : "Değişenler"} (${num(n)})`}
            </button>
            {showApplied ? (
              <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {outcome.applied.map((a) => (
                  <li key={a.productId} className="flex justify-between gap-3 tabular">
                    <span className="min-w-0 truncate text-ink-soft">{a.label}</span>
                    <span className="shrink-0 whitespace-nowrap">
                      <span className="text-ink-mute">{money(a.from)}</span> → <span className="font-semibold text-ink">{money(a.to)}</span>
                      {a.site ? <Globe size={12} className="ml-1 inline text-info" aria-label="sitede de" /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {pos ? (
            <ButtonLink href={tabHref("kasa")} variant="primary">
              Kasaya işle ({num(pos)}) <ArrowRight size={15} aria-hidden="true" />
            </ButtonLink>
          ) : null}
          {branch && n ? (
            <ButtonLink href={tabHref("sube")} variant="secondary">
              Şube fiyatı&apos;nda gör (iptal) <ArrowRight size={15} aria-hidden="true" />
            </ButtonLink>
          ) : null}
          {!undo && !branch && n ? (
            <Button variant="secondary" onClick={onUndo} disabled={pending}>
              <RotateCcw size={15} aria-hidden="true" /> Değişikliği geri al
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onNew} disabled={pending}>
            Yeni toplu değişiklik
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
