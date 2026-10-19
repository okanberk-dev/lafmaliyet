"use client";

import { Info, ListChecks, Pencil, Plus, Scale, SearchX, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { startTransition, useOptimistic, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, SearchInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, num, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { deleteFinding, saveFinding, setFindingResolved, setPurchaseQty } from "@/server/actions/consistency";

import { RATIO_BAD, RATIO_WARN, SEVERITY, severityOf } from "./severity";

interface Row {
  ingredientId: number;
  name: string;
  unit: string;
  unitCost: number;
  usage: number;
  purchased: number | null;
  ratio: number | null;
  diffAmount: number | null;
  opening: number | null;
  closing: number | null;
  actualUsage: number | null;
  variance: number | null;
  varianceAmount: number | null;
  note: string | null;
}

type IngredientOption = { id: number; name: string; unit: string };
type SevFilter = "all" | "fark" | "buyuk";

// ---------------------------------------------------------------- Sayaçlar ve şeritler (sunucu sayfası da kullanır)

/**
 * AkmanOS AnimatedNumber ile sayan rakam: açılışta ve ay değişince yumuşakça sayılır.
 * Ekran okuyucu yalnızca son değeri duyar; hareket azaltıldığında sayaç doğrudan son değeri yazar.
 */
export function CountUp({ value, kind = "num" }: { value: number; kind?: "num" | "tl" }) {
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

/**
 * AkmanOS agent-limits-card'ın bölümlü paylaşım şeridi: alımı girilen malzemelerin
 * büyük fark / fark var / tutarlı dağılımı. Parçalar açılışta sırayla, yaylı hareketle dolar.
 */
export function SeverityBar({ big, diff, ok }: { big: number; diff: number; ok: number }) {
  const reduce = useCalmMotion();
  const total = big + diff + ok;
  if (!total) return null;
  const parts = [
    { key: "big" as const, n: big },
    { key: "diff" as const, n: diff },
    { key: "ok" as const, n: ok },
  ].filter((p) => p.n > 0);
  const summary = parts.map((p) => `${SEVERITY[p.key].label} ${num(p.n)}`).join(", ");
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface">
        {parts.map((p, i) => (
          <motion.div
            key={p.key}
            className={cn("h-full min-w-0 rounded-full", SEVERITY[p.key].bar)}
            initial={reduce ? false : { width: 0, opacity: 0.6 }}
            animate={{ width: `${(p.n / total) * 100}%`, opacity: 1 }}
            transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.05 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] leading-4 text-ink-mute" aria-hidden="true">
        {parts.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", SEVERITY[p.key].bar)} />
            {SEVERITY[p.key].label} <span className="font-medium text-ink tabular">{num(p.n)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** AkmanOS todo-list sayacı: rakam değişince eskisi yukarı, yenisi aşağıdan kayar */
function CountRoll({ value }: { value: number }) {
  const reduce = useCalmMotion() ?? false;
  const text = num(value);
  return (
    <span className="relative inline-flex h-[1.15em] overflow-hidden align-bottom">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduce ? false : { y: "70%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={reduce ? undefined : { y: "-70%", opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
          className="inline-block tabular"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

// ---------------------------------------------------------------- Reçete ↔ fatura tablosu

function RatioBadge({ row }: { row: Row }) {
  if (row.ratio === null) {
    // Ay içinde hiç kullanılmadığı hâlde alım varsa oran hesaplanamaz ama fark büyüktür
    return severityOf(row) === "big" ? (
      <Badge tone={SEVERITY.big.tone} dot title={SEVERITY.big.label}>
        Kullanım yok
      </Badge>
    ) : (
      <span className="text-ink-mute">–</span>
    );
  }
  const s = SEVERITY[row.ratio > RATIO_BAD ? "big" : row.ratio >= RATIO_WARN ? "diff" : "ok"];
  return (
    <Badge tone={s.tone} dot className="tabular" title={s.label}>
      {num(row.ratio, 2)}×<span className="sr-only">, {s.label}</span>
    </Badge>
  );
}

function PurchaseCell({ month, row }: { month: string; row: Row }) {
  const [value, setValue] = useState(row.purchased === null ? "" : num(row.purchased, 2));
  const [busy, setBusy] = useState(false);
  return (
    <NumberInput
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        const t = value.trim();
        const v = t === "" ? null : parseNumberTR(t);
        if (t !== "" && v === null) return toast.error("Geçerli bir miktar girin");
        if (v === row.purchased) return;
        setBusy(true);
        const res = await setPurchaseQty(month, row.ingredientId, v);
        setBusy(false);
        if (!res.ok) toast.error(res.error);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      aria-label={`${row.name} alınan miktar`}
      aria-invalid={value.trim() !== "" && parseNumberTR(value) === null ? true : undefined}
      className="cell-input w-28"
    />
  );
}

export function ConsistencyTable({
  month,
  monthLabel,
  rows,
  totalDiff,
  totalVariance,
  hasStock,
  ingredients,
  fire,
}: {
  month: string;
  monthLabel: string;
  rows: Row[];
  totalDiff: number;
  totalVariance: number;
  hasStock: boolean;
  ingredients: IngredientOption[];
  fire: number;
}) {
  /** null = kapalı, "new" = yeni alım, Row = satırdaki alımı düzenle */
  const [dialog, setDialog] = useState<Row | "new" | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [sev, setSev] = useState<SevFilter>("all");
  const [q, setQ] = useState("");
  const withPurchase = rows.filter((r) => r.purchased !== null);
  const base = (showAll ? rows : withPurchase.length ? withPurchase : rows).filter((r) => matchesSearch(r.name, q.trim()));
  const isDiff = (r: Row) => {
    const s = severityOf(r);
    return s === "diff" || s === "big";
  };
  const isBig = (r: Row) => severityOf(r) === "big";
  const visible = sev === "all" ? base : base.filter(sev === "buyuk" ? isBig : isDiff);
  const paged = usePaged(visible, 25, `${sev}|${showAll}|${q}`);
  const filtered = sev !== "all" || q.trim() !== "";

  return (
    <Card>
      <CardHeader
        icon={<Scale />}
        title={`Reçete ↔ fatura: ${monthLabel}`}
        description="Satılanlara göre harcanması gereken malzeme (fire hariç) ile ay içinde faturayla alınan. Alınan miktarı tıklayıp yazabilirsiniz."
        meta={
          <>
            <span>Malzeme · {num(rows.length)}</span>
            <span aria-hidden="true">·</span>
            <span>Alım girilen · {num(withPurchase.length)}</span>
          </>
        }
        actions={
          <Button variant="secondary" onClick={() => setDialog("new")}>
            <Plus size={16} /> Alım ekle
          </Button>
        }
      />

      {rows.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <SearchInput
              wrapperClassName="min-w-0 flex-1 basis-56"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Malzeme ara…"
              aria-label="Malzeme ara"
            />
            <Segmented<SevFilter>
              label="Fark filtresi"
              value={sev}
              onChange={setSev}
              options={[
                { value: "all", label: "Tümü", count: base.length },
                { value: "fark", label: SEVERITY.diff.label, count: base.filter(isDiff).length },
                { value: "buyuk", label: SEVERITY.big.label, count: base.filter(isBig).length },
              ]}
            />
            <Checkbox label="Alımı girilmeyenleri de göster" className="min-h-9 px-1" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          </div>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pb-3 text-xs text-ink-mute" aria-label="Oran renkleri">
            {(["ok", "diff", "big"] as const).map((k) => (
              <li key={k} className="inline-flex items-center gap-1.5">
                <Badge tone={SEVERITY[k].tone} dot>
                  {SEVERITY[k].range}
                </Badge>
                <span>
                  {SEVERITY[k].hint}
                  {k === "diff" ? ` (genel fire payı %${num(fire * 100, 0)})` : ""}
                </span>
              </li>
            ))}
            <li className="inline-flex">
              <InfoTip text="Büyük şişeli sos ve püreler birkaç ay yettiği için tek aylık oranları yüksek çıkabilir." />
            </li>
          </ul>
        </>
      ) : null}

      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH sticky>Malzeme</TH>
                <TH numeric>
                  Reçeteye göre kullanım
                  <InfoTip text="Her ürünün bu ayki satış adedi × reçetedeki miktar. Fire payı ve ödenmez siparişler hariç." className="ml-1" />
                </TH>
                <TH numeric>
                  Faturayla alınan
                  <InfoTip text="Bu ayki faturalardaki miktar (malzemenin kendi biriminde: gr, ml, adet). Tıklayıp yazabilirsiniz." className="ml-1" />
                </TH>
                <TH numeric>Alınan ÷ kullanılan</TH>
                <TH numeric>
                  Fark tutarı
                  <InfoTip
                    text="(Alınan − kullanılan) × birim maliyet. Pozitif = reçeteye göre fazla alınan malın parası (stokta duruyor ya da fire/ikram oldu)."
                    className="ml-1"
                  />
                </TH>
                {hasStock ? (
                  <>
                    <TH numeric>
                      Gerçek tüketim
                      <InfoTip text="Geçen ay sayımı + alınan − bu ay sayımı. İki ayın da sayımı girildiyse hesaplanır." className="ml-1" />
                    </TH>
                    <TH numeric>Sapma (₺)</TH>
                  </>
                ) : null}
                <TH>Yorum / kaynak faturalar</TH>
                <TH>
                  <span className="sr-only">Eylemler</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {paged.slice.map((r) => (
                <TR key={r.ingredientId}>
                  <TD sticky className="min-w-36 font-medium">
                    {r.name}
                  </TD>
                  <TD numeric>
                    {num(r.usage)} {r.unit}
                  </TD>
                  <TD numeric>
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Kayıttan sonra (ya da pencereden eklenince) yeni değerle yeniden kurulur */}
                      <PurchaseCell key={`${r.ingredientId}:${r.purchased ?? ""}`} month={month} row={r} />
                      <span className="w-8 text-left text-xs text-ink-mute">{r.unit}</span>
                    </div>
                  </TD>
                  <TD numeric>
                    <RatioBadge row={r} />
                  </TD>
                  <TD
                    numeric
                    className={cn(r.diffAmount !== null && r.diffAmount < 0 && "text-info", r.diffAmount !== null && r.diffAmount > 2000 && "font-semibold text-bad")}
                  >
                    {r.diffAmount === null ? "–" : tl(r.diffAmount)}
                  </TD>
                  {hasStock ? (
                    <>
                      <TD numeric>
                        {r.actualUsage === null ? "–" : `${num(r.actualUsage)} ${r.unit}`}
                        {r.opening !== null && r.closing !== null ? (
                          <span className="block text-xs text-ink-mute">
                            sayım {num(r.opening)} → {num(r.closing)}
                          </span>
                        ) : null}
                      </TD>
                      <TD numeric className={cn(r.varianceAmount !== null && r.varianceAmount > 0 && "font-semibold text-bad")}>
                        {r.varianceAmount === null ? "–" : tl(r.varianceAmount)}
                        {r.variance !== null ? (
                          <span className="block text-xs font-normal text-ink-mute">
                            {num(r.variance)} {r.unit}
                          </span>
                        ) : null}
                      </TD>
                    </>
                  ) : null}
                  <TD className="max-w-80 min-w-48 text-xs text-ink-mute">{r.note ?? ""}</TD>
                  <TD>
                    <div className="flex justify-end">
                      <IconButton label={`${r.name}: alımı ve yorumu düzenle`} onClick={() => setDialog(r)}>
                        <Pencil size={15} />
                      </IconButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <TFootRow className="bg-panel-deep/40">
                <TD colSpan={4}>Toplam fark (alınan − reçeteye göre kullanılan)</TD>
                <TD numeric>{tl(totalDiff)}</TD>
                {hasStock ? (
                  <>
                    <TD />
                    <TD numeric>{tl(totalVariance)}</TD>
                  </>
                ) : null}
                <TD colSpan={2} />
              </TFootRow>
            </tfoot>
          </Table>
        </TableWrap>
      ) : rows.length ? (
        <EmptyState
          icon={<SearchX />}
          title="Bu filtrede malzeme yok"
          description={filtered ? "Aramayı ya da fark filtresini değiştirin." : undefined}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSev("all");
                setQ("");
              }}
            >
              Filtreyi temizle
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<Scale />}
          title="Bu ay karşılaştırılacak malzeme yok"
          description="Satış raporu yüklendiğinde ya da alım girildiğinde malzemeler burada listelenir."
          action={
            <Button variant="secondary" onClick={() => setDialog("new")}>
              <Plus size={16} /> Alım ekle
            </Button>
          }
        />
      )}

      {visible.length ? <Pagination page={paged.page} pageCount={paged.pageCount} onChange={paged.setPage} total={paged.total} unit="malzeme" className="border-t border-line" /> : null}

      {!hasStock ? (
        <CardFooter className="justify-start gap-2 text-xs">
          <Info size={14} className="shrink-0 text-ink-quiet" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            İpucu: Bu ayın ve geçen ayın stok sayımını girerseniz &quot;gerçek tüketim&quot; ve &quot;sapma&quot; sütunları çıkar. Sapma, reçeteye göre olması gerekenden
            fazla harcanan malın parasıdır (fire, ikram, porsiyon kaçağı).{" "}
            <Link href={`/panel/sayim?ay=${month}`} className="font-medium text-ink-soft underline underline-offset-2 hover:text-ink">
              Sayıma git
            </Link>
          </span>
        </CardFooter>
      ) : null}

      {dialog ? <PurchaseDialog month={month} ingredients={ingredients} row={dialog === "new" ? null : dialog} onClose={() => setDialog(null)} /> : null}
    </Card>
  );
}

function PurchaseDialog({ month, ingredients, row, onClose }: { month: string; ingredients: IngredientOption[]; row: Row | null; onClose: () => void }) {
  // Satırdan açılan malzeme elle fiyatlı listede yoksa da seçilebilsin
  const options =
    row && !ingredients.some((i) => i.id === row.ingredientId) ? [{ id: row.ingredientId, name: row.name, unit: row.unit }, ...ingredients] : ingredients;
  const [id, setId] = useState<number>(row?.ingredientId ?? options[0]?.id ?? 0);
  const [qty, setQty] = useState(row && row.purchased !== null ? num(row.purchased, 2) : "");
  const [note, setNote] = useState(row?.note ?? "");
  const [busy, setBusy] = useState(false);
  const unit = options.find((i) => i.id === id)?.unit ?? "";
  const qtyInvalid = qty.trim() !== "" && parseNumberTR(qty) === null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = parseNumberTR(qty);
    if (v === null) return toast.error("Miktar girin");
    setBusy(true);
    const res = await setPurchaseQty(month, id, v, note);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(row ? "Kaydedildi" : "Eklendi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Alınan miktarı düzenle" : "Alınan miktar ekle"}
      description="Faturalardaki toplam miktarı malzemenin kendi biriminde girin (1 kg = 1.000 gr, 1 L = 1.000 ml)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="purchase-form" disabled={busy || !options.length}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="purchase-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="Malzeme" htmlFor="ap-i">
          <Select id="ap-i" value={id} disabled={!!row} onChange={(e) => setId(Number(e.target.value))}>
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Miktar (${unit})`} htmlFor="ap-q" error={qtyInvalid ? "Geçerli bir miktar girin" : undefined}>
          <NumberInput id="ap-q" value={qty} onChange={(e) => setQty(e.target.value)} className="cell-input" aria-invalid={qtyInvalid || undefined} data-autofocus />
        </Field>
        <Field label="Kaynak faturalar / yorum" htmlFor="ap-n">
          <Input id="ap-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Kaldi 01.09 + 15.09: 2 × 12 kg" />
        </Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Bulgular (AkmanOS todo-list görünümü)

type FindingItem = { id: number; section: string; title: string; detail: string | null; resolved: boolean; createdAt: string };

/** AkmanOS todo-list durum ikonu: kesik çizgili halka, çözülünce dolar ve onay işareti çizilir */
function FindingStatusIcon({ done }: { done: boolean }) {
  const reduce = useCalmMotion() ?? false;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0 overflow-visible transition-colors", done ? "text-good" : "text-ink-quiet group-hover/toggle:text-ink-mute")}
    >
      <motion.circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={done ? undefined : "2 3"}
        strokeLinecap="round"
        initial={false}
        animate={{ fillOpacity: done ? 0.14 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
      />
      <motion.path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={false}
        animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
        transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
      />
    </svg>
  );
}

export function Findings({ items }: { items: FindingItem[] }) {
  const reduce = useCalmMotion() ?? false;
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<FindingItem | "new" | null>(null);
  // İşaretleme anında görünsün; sunucu yenilenince gerçek değer gelir, hata olursa geri döner
  const [list, setOptimistic] = useOptimistic(items, (state, change: { id: number; resolved: boolean }) =>
    state.map((i) => (i.id === change.id ? { ...i, resolved: change.resolved } : i)),
  );
  const visible = list.filter((i) => showResolved || !i.resolved);
  const sections = [...new Set(visible.map((i) => i.section))];
  const resolvedCount = list.filter((i) => i.resolved).length;
  const share = list.length ? resolvedCount / list.length : 0;

  const toggle = (item: FindingItem, resolved: boolean) =>
    startTransition(async () => {
      setOptimistic({ id: item.id, resolved });
      const res = await setFindingResolved(item.id, resolved);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Çözülen madde listeden kaybolacaksa geri alma imkânı
      if (resolved && !showResolved) toast.success(`"${item.title}" çözüldü`, { action: { label: "Geri al", onClick: () => toggle(item, false) } });
    });

  return (
    <Card>
      <CardHeader
        icon={<ListChecks />}
        title="Bulgular ve yapılacaklar"
        description="Reçetede olmayan alımlar, fiyat ve fatura kontrolleri. Çözülen maddeyi işaretleyin."
        meta={
          <>
            <span>Açık · {num(list.length - resolvedCount)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-baseline gap-1">
              Çözülen ·{" "}
              <span className={cn("inline-flex items-baseline font-medium", list.length && resolvedCount === list.length ? "text-good" : "text-ink")}>
                <CountRoll value={resolvedCount} />
                <span className="text-ink-mute">&nbsp;/ {num(list.length)}</span>
              </span>
            </span>
          </>
        }
        actions={
          <>
            <Checkbox
              label={`Çözülenleri göster (${resolvedCount})`}
              className="min-h-9 px-1"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            <Button variant="secondary" onClick={() => setEditing("new")}>
              <Plus size={16} /> Bulgu ekle
            </Button>
          </>
        }
      />
      {list.length ? (
        <div className="px-5 pb-4">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-panel-deep"
            role="progressbar"
            aria-label="Çözülen bulgular"
            aria-valuemin={0}
            aria-valuemax={list.length}
            aria-valuenow={resolvedCount}
          >
            <motion.div
              className={cn("h-full rounded-full", share === 1 ? "bg-good" : "bg-ink")}
              initial={reduce ? false : { width: 0, opacity: 0.6 }}
              animate={{ width: `${share * 100}%`, opacity: 1 }}
              transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.2 }}
            />
          </div>
        </div>
      ) : null}
      <CardContent className="space-y-5">
        {sections.map((sec) => {
          const secList = visible.filter((i) => i.section === sec);
          return (
            <div key={sec}>
              <p className="mb-2 text-[13px] font-semibold text-ink-soft">
                {sec} <span className="font-normal text-ink-mute tabular">· {num(secList.length)}</span>
              </p>
              <ul className="flex flex-col rounded-2xl bg-surface p-1.5 ring-1 ring-line">
                <AnimatePresence initial={false} mode="popLayout">
                  {secList.map((i) => (
                    <motion.li
                      layout="position"
                      key={i.id}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
                      transition={reduce ? { duration: 0 } : { opacity: { duration: 0.18, ease: EASE_OUT }, y: SPRING_LAYOUT, layout: SPRING_LAYOUT }}
                      className="flex items-start gap-1 rounded-xl py-0.5 pr-1 transition-colors hover:bg-panel/70"
                    >
                      <button
                        type="button"
                        onClick={() => toggle(i, !i.resolved)}
                        className="group/toggle flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg"
                        aria-label={`${i.title}: ${i.resolved ? "yeniden aç" : "çözüldü olarak işaretle"}`}
                        title={i.resolved ? "Yeniden aç" : "Çözüldü olarak işaretle"}
                      >
                        <FindingStatusIcon done={i.resolved} />
                      </button>
                      <button type="button" className="min-w-0 flex-1 cursor-pointer rounded-lg py-1.5 text-left" onClick={() => setEditing(i)}>
                        <span className={cn("block text-sm font-medium transition-colors", i.resolved ? "text-ink-mute line-through decoration-ink-quiet" : "text-ink")}>
                          {i.title}
                        </span>
                        {i.detail ? (
                          <span className={cn("mt-0.5 block text-[13px] leading-5 whitespace-pre-line text-ink-mute", i.resolved && "opacity-70")}>{i.detail}</span>
                        ) : null}
                        <span className="mt-1 block text-xs text-ink-quiet tabular">{dateTR(i.createdAt.slice(0, 10))}</span>
                      </button>
                      <IconButton label={`${i.title}: düzenle`} className="mt-0.5" onClick={() => setEditing(i)}>
                        <Pencil size={15} />
                      </IconButton>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          );
        })}
        {!visible.length ? (
          <EmptyState
            icon={<ListChecks />}
            title="Açık bulgu yok"
            description={resolvedCount ? `${num(resolvedCount)} çözülmüş bulgu gizli.` : undefined}
            action={
              <Button variant="secondary" onClick={() => setEditing("new")}>
                <Plus size={16} /> Bulgu ekle
              </Button>
            }
          />
        ) : null}
      </CardContent>
      {editing ? (
        <FindingDialog item={editing === "new" ? null : editing} sections={[...new Set(items.map((i) => i.section))]} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

function FindingDialog({
  item,
  sections,
  onClose,
}: {
  item: { id: number; section: string; title: string; detail: string | null } | null;
  sections: string[];
  onClose: () => void;
}) {
  const [section, setSection] = useState(item?.section ?? sections[0] ?? "Genel");
  const [title, setTitle] = useState(item?.title ?? "");
  const [detail, setDetail] = useState(item?.detail ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveFinding({ id: item?.id ?? null, section, title, detail });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? "Bulguyu düzenle" : "Bulgu ekle"}
      footerStart={
        item ? (
          <Button
            variant="ghost"
            className="text-bad hover:bg-bad-soft hover:text-bad"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await deleteFinding(item.id);
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              onClose();
            }}
          >
            <Trash2 size={16} /> Sil
          </Button>
        ) : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form="finding-form" disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id="finding-form" onSubmit={submit} className="space-y-3 pb-2">
        <Field label="Bölüm" htmlFor="fd-s">
          <Input id="fd-s" list="finding-sections" value={section} onChange={(e) => setSection(e.target.value)} />
          <datalist id="finding-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Başlık" htmlFor="fd-t">
          <Input id="fd-t" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus={!item ? true : undefined} />
        </Field>
        <Field label="Ayrıntı" htmlFor="fd-d">
          <Textarea id="fd-d" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
        </Field>
      </form>
    </Dialog>
  );
}
