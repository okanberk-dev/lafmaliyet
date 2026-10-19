"use client";

import { Check, ClipboardCheck, ClipboardCopy, Coins, ListTodo, PackagePlus, Plus, Printer, Save, SearchX, Trash2 } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import Link from "next/link";
import { useEffect, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Input, NumberInput, SearchInput } from "@/components/ui/form";
import { EmptyState, InfoTip, KeyValue, Stat } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { parseNumberTR } from "@/lib/calc/expr";
import { num, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { saveStockCounts, saveStockExtras } from "@/server/actions/stock";

interface Line {
  id: number;
  name: string;
  packageDesc: string | null;
  countUnit: string;
  qty: number | null;
  prevQty: number | null;
  unitPrice: number;
  vatRate: number;
}

type Filter = "all" | "empty";
type HistoryMonth = { month: string; short: string; label: string; counted: boolean };

/** Enter ile sıradaki sayım kutusuna geçilir (telefonda klavyenin "İleri" tuşu) */
function focusNextCount(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[data-count-input]")];
  const next = inputs[inputs.indexOf(e.currentTarget) + 1];
  if (!next) return e.currentTarget.blur();
  next.focus({ preventScroll: true });
  next.select();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  next.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

// ---------------------------------------------------------------- AkmanOS hareketli parçalar

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

/** AkmanOS todo-list başlık ikonu: liste ikonu, tüm kalemler sayılınca yeşil onaya döner */
function ProgressIcon({ complete }: { complete: boolean }) {
  const reduce = useCalmMotion() ?? false;
  return (
    <span aria-hidden="true" className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface">
      <AnimatePresence initial={false} mode="popLayout">
        {complete ? (
          <motion.svg
            key="complete"
            viewBox="0 0 24 24"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute size-5 overflow-visible text-good"
          >
            <circle cx="12" cy="12" r="9" fill="currentColor" />
            <motion.path
              d="M7.5 12.25 10.5 15.25 16.75 8.75"
              fill="none"
              stroke="white"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT }}
            />
          </motion.svg>
        ) : (
          <motion.span
            key="todo"
            initial={reduce ? { opacity: 1 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.72 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="absolute grid place-items-center text-ink"
          >
            <ListTodo size={18} strokeWidth={1.75} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * Satırın durumu (AkmanOS todo-list ikonu): boş = kesik halka, sayıldı = yeşil onay, geçersiz = kırmızı çarpı.
 * Yüzlerce satırda hafif kalsın diye çizgi CSS geçişiyle çizilir; hareket azaltılınca geçiş kapanır.
 */
function LineStatus({ status }: { status: "empty" | "counted" | "invalid" }) {
  const stroke = "transition-[stroke-dashoffset,opacity] duration-200 ease-out motion-reduce:transition-none";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn(
        "mt-0.5 size-[18px] shrink-0 overflow-visible transition-colors",
        status === "counted" ? "text-good" : status === "invalid" ? "text-bad" : "text-ink-quiet",
      )}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "empty" ? "2 3" : undefined}
        strokeLinecap="round"
        className="transition-[fill-opacity] duration-200 motion-reduce:transition-none"
        style={{ fillOpacity: status === "empty" ? 0 : 0.14 }}
      />
      <path
        d="M7.5 12.25 10.5 15.25 16.75 8.75"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="1"
        className={stroke}
        style={{ strokeDashoffset: status === "counted" ? 0 : 1, opacity: status === "counted" ? 1 : 0 }}
      />
      <path
        d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeDasharray="1"
        className={stroke}
        style={{ strokeDashoffset: status === "invalid" ? 0 : 1, opacity: status === "invalid" ? 1 : 0 }}
      />
    </svg>
  );
}

const monthCell: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.72 },
  visible: (i: number) => ({ opacity: 1, y: 0, scale: 1, transition: { ...SPRING_PRESS, delay: 0.08 + i * 0.06 } }),
};

/**
 * AkmanOS "Streak" düzeni: son 6 ayın sayım durumu. Sayım girilen ay siyah onay, açık ay halkalı.
 * Kaydedilmemiş değişiklik varken diğer aylara geçiş kapalı (girilen miktarlar kaybolmasın).
 */
function CountHistory({ history, current, currentCounted, locked }: { history: HistoryMonth[]; current: string; currentCounted: boolean; locked: boolean }) {
  const reduce = useCalmMotion() ?? false;
  const done = history.filter((h) => (h.month === current ? currentCounted : h.counted)).length;
  return (
    <div className="no-print border-t border-line px-5 pt-4 pb-5">
      <div className="flex items-center justify-between gap-3 text-xs text-ink-mute">
        <span className="flex items-center gap-1.5">
          Sayım düzeni
          <InfoTip text="Son altı ayın hangilerinde ay sonu sayımı girildi. Bir aya dokunarak o ayın sayımını açın." />
        </span>
        <span className="font-medium text-ink tabular">
          {num(done)} / {num(history.length)} ay
        </span>
      </div>
      <ol className="mt-3 grid grid-cols-6 gap-1">
        {history.map((h, i) => {
          const isCurrent = h.month === current;
          const counted = isCurrent ? currentCounted : h.counted;
          const text = `${h.label}: ${counted ? "sayım var" : "sayım yok"}${isCurrent ? " (açık)" : locked ? " · önce sayımı kaydedin" : ""}`;
          const cell = (
            <motion.span
              custom={i}
              variants={monthCell}
              initial={reduce ? false : "hidden"}
              animate="visible"
              whileHover={reduce || isCurrent || locked ? undefined : { y: -3, scale: 1.06 }}
              whileTap={reduce || isCurrent || locked ? undefined : { scale: 0.94 }}
              className="flex flex-col items-center gap-2"
              aria-hidden="true"
            >
              <span className={cn("text-[11px] font-medium", isCurrent ? "text-ink" : "text-ink-mute")}>{h.short}</span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  counted ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong",
                  isCurrent && "ring-2 ring-ink ring-offset-2 ring-offset-panel",
                )}
              >
                {counted ? (
                  <motion.span
                    initial={reduce ? false : { scale: 0, rotate: -120 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={reduce ? { duration: 0 } : SPRING_SWAP}
                    className="grid place-items-center"
                  >
                    <Check className="size-4" strokeWidth={2.5} />
                  </motion.span>
                ) : null}
              </span>
            </motion.span>
          );
          // Kilitliyken de aynı öğe (Link) kalır: öğe türü değişseydi hücreler yeniden kurulup giriş hareketi tekrar oynardı
          return (
            <li key={h.month} className="flex justify-center">
              {isCurrent ? (
                <span title={text} className="flex w-full justify-center py-1">
                  {cell}
                  <span className="sr-only">{text}</span>
                </span>
              ) : (
                <Link
                  href={`/panel/sayim?ay=${h.month}`}
                  title={text}
                  aria-label={text}
                  aria-disabled={locked || undefined}
                  tabIndex={locked ? -1 : undefined}
                  onClick={locked ? (e) => e.preventDefault() : undefined}
                  className={cn(
                    "flex w-full justify-center rounded-xl py-1 transition-colors",
                    locked ? "cursor-not-allowed opacity-60" : "hover:bg-surface/70",
                  )}
                >
                  {cell}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Money({ value }: { value: number }) {
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={(v) => tl(v)} />
      </span>
      <span className="sr-only">{tl(value)}</span>
    </>
  );
}

// ---------------------------------------------------------------- Sayım formu

export function StockCountForm({
  month,
  monthLabel,
  isAdmin,
  groups,
  extras: initialExtras,
  hasPrev,
  history,
  prevTotal,
}: {
  month: string;
  monthLabel: string;
  isAdmin: boolean;
  groups: { name: string; lines: Line[] }[];
  extras: { name: string; unit: string; qty: number; unitPrice: number }[];
  hasPrev: boolean;
  /** Seçili ay dahil son 6 ayın sayım durumu */
  history: HistoryMonth[];
  /** Geçen ayın stok toplamı (yalnızca yönetici, sayım varsa) */
  prevTotal: number | null;
}) {
  const reduce = useCalmMotion() ?? false;
  const all = groups.flatMap((g) => g.lines);
  const savedExtras = initialExtras.map((e) => ({ name: e.name, unit: e.unit, qty: num(e.qty, 3), unitPrice: num(e.unitPrice, 2) }));
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(all.map((l) => [l.id, l.qty === null ? "" : num(l.qty, 3)])),
  );
  const [extras, setExtras] = useState(savedExtras);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  /** "Sayılmayanlar" seçildiği andaki boş kalemler: yazmaya başlayınca satır listeden kaybolmasın */
  const [emptyIds, setEmptyIds] = useState<Set<number>>(() => new Set());
  const [q, setQ] = useState("");

  const qtyOf = (id: number) => {
    const v = values[id];
    return v === undefined || v.trim() === "" ? null : parseNumberTR(v);
  };
  const isInvalid = (id: number) => {
    if (!values[id]?.trim()) return false;
    const v = qtyOf(id);
    return v === null || v < 0;
  };

  const changedLines = all.filter((l) => qtyOf(l.id) !== l.qty);
  const invalidLines = all.filter((l) => isInvalid(l.id));
  const extrasDirty = JSON.stringify(extras) !== JSON.stringify(savedExtras);
  const dirty = changedLines.length > 0 || extrasDirty || invalidLines.length > 0;
  const counted = all.filter((l) => qtyOf(l.id) !== null).length;
  const remaining = all.length - counted;
  const share = all.length ? counted / all.length : 0;
  const complete = all.length > 0 && remaining === 0;
  const groupTotal = (g: { lines: Line[] }) => g.lines.reduce((a, l) => a + (qtyOf(l.id) ?? 0) * l.unitPrice, 0);
  const extrasTotal = extras.reduce((a, e) => a + (parseNumberTR(e.qty) ?? 0) * (parseNumberTR(e.unitPrice) ?? 0), 0);
  const total = groups.reduce((a, g) => a + groupTotal(g), 0) + extrasTotal;
  const totalVat = groups.reduce((a, g) => a + g.lines.reduce((b, l) => b + (qtyOf(l.id) ?? 0) * l.unitPrice * (1 + l.vatRate), 0), 0) + extrasTotal * 1.01;

  // Kaydedilmemiş sayımla sayfa kapatılır ya da yenilenirse tarayıcı sorsun
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const changeFilter = (f: Filter) => {
    if (f === "empty") setEmptyIds(new Set(all.filter((l) => qtyOf(l.id) === null).map((l) => l.id)));
    setFilter(f);
  };
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      visible: g.lines.filter((l) => (filter === "all" || emptyIds.has(l.id)) && matchesSearch(`${l.name} ${l.packageDesc ?? ""} ${g.name}`, q.trim())),
    }))
    .filter((g) => g.visible.length);

  function fillFromPrev() {
    setValues((v) => {
      const next = { ...v };
      for (const l of all) if (!next[l.id]?.trim() && l.prevQty !== null) next[l.id] = num(l.prevQty, 3);
      return next;
    });
    toast.message("Boş satırlar geçen ayın sayımıyla dolduruldu");
  }

  const updateExtra = (i: number, patch: Partial<(typeof extras)[number]>) => setExtras((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));

  async function save() {
    const bad = invalidLines[0];
    if (bad) return toast.error(`${bad.name}: geçersiz miktar`);
    setBusy(true);
    const res = await saveStockCounts(
      month,
      changedLines.map((l) => ({ ingredientId: l.id, qty: qtyOf(l.id) })),
    );
    if (res.ok && isAdmin) {
      const ex = await saveStockExtras(
        month,
        extras.filter((e) => e.name.trim()).map((e) => ({ name: e.name, unit: e.unit || "ADET", qty: parseNumberTR(e.qty) ?? 0, unitPrice: parseNumberTR(e.unitPrice) ?? 0 })),
      );
      if (!ex.ok) toast.error(ex.error);
      // Sunucunun yazdığı biçime getir (boş adlı satır düşer, "2,0" → "2"): kayıttan sonra çubuk açık kalmasın
      else
        setExtras((x) =>
          x
            .filter((e) => e.name.trim())
            .map((e) => ({ name: e.name.trim(), unit: e.unit.trim() || "ADET", qty: num(parseNumberTR(e.qty) ?? 0, 3), unitPrice: num(parseNumberTR(e.unitPrice) ?? 0, 2) })),
        );
    }
    setBusy(false);
    if (res.ok) toast.success(`${monthLabel} sayımı kaydedildi`);
    else toast.error(res.error);
  }

  const changeLabel = changedLines.length
    ? `${num(changedLines.length)} kalem değişti${extrasDirty ? " · ek kalemler" : ""}`
    : extrasDirty
      ? "Ek kalemler değişti"
      : `${num(invalidLines.length)} geçersiz miktar`;

  return (
    <div className="space-y-4 pb-28">
      <div className={cn("grid gap-3", isAdmin && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
        {/* İlerleme: AkmanOS todo-list başlığı + ince çubuk + sayım düzeni */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5">
            <div className="flex min-w-0 items-start gap-3">
              <ProgressIcon complete={complete} />
              <div className="min-w-0">
                <p className="text-sm leading-5 text-ink-mute">Sayılan kalem</p>
                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-2xl leading-8 font-semibold tracking-tight text-ink" aria-hidden="true">
                  <span className={cn("inline-flex", complete && "text-good")}>
                    <CountRoll value={counted} />
                  </span>
                  <span className="text-lg font-medium text-ink-mute tabular">/ {num(all.length)}</span>
                  <span className="text-sm font-medium text-ink-mute">sayıldı</span>
                </p>
                <p className="sr-only" aria-live="polite">
                  {num(counted)} / {num(all.length)} kalem sayıldı
                </p>
              </div>
            </div>
            <div className="no-print flex flex-wrap gap-2">
              {hasPrev ? (
                <Button variant="secondary" onClick={fillFromPrev}>
                  <ClipboardCopy size={16} /> Geçen aydan doldur
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} /> Yazdır
              </Button>
            </div>
          </div>
          <div className="px-5 pt-4 pb-5">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-panel-deep"
              role="progressbar"
              aria-label="Sayım ilerlemesi"
              aria-valuemin={0}
              aria-valuemax={all.length}
              aria-valuenow={counted}
            >
              <motion.div
                className={cn("h-full rounded-full", complete ? "bg-good" : "bg-ink")}
                initial={reduce ? false : { width: 0, opacity: 0.6 }}
                animate={{ width: `${share * 100}%`, opacity: 1 }}
                transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.1 }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-mute">
              <span className={cn(complete && "font-medium text-good")}>
                {remaining ? `${num(remaining)} kalem kaldı` : all.length ? "Tüm kalemler sayıldı" : "Sayılacak kalem yok"}
              </span>
              {all.length ? <span className="font-medium text-ink tabular">%{num(share * 100)}</span> : null}
            </div>
          </div>
          <CountHistory history={history} current={month} currentCounted={counted > 0 || extras.some((e) => e.name.trim() !== "")} locked={dirty} />
        </Card>

        {isAdmin ? (
          <Stat
            icon={<Coins />}
            label="Toplam stok (KDV hariç)"
            value={<Money value={total} />}
            info={'Gelir-giderde "sonraki aya devreden mal" olur.'}
          >
            <div className="divide-y divide-line rounded-xl bg-surface px-3">
              <KeyValue label="KDV dahil" value={tl(totalVat)} />
              {extras.length ? <KeyValue label="Listede olmayanlar" value={tl(extrasTotal)} /> : null}
              {prevTotal !== null ? <KeyValue label="Geçen ay" value={tl(prevTotal)} /> : null}
            </div>
          </Stat>
        ) : null}
      </div>

      {/* Telefonda başlığın altına yapışan arama ve filtre satırı */}
      <div className="no-print sticky top-14 z-20 -mx-4 flex items-center gap-2 bg-surface/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <SearchInput wrapperClassName="min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kalem ara…" aria-label="Kalem ara" />
        <Segmented<Filter>
          label="Gösterilen kalemler"
          className="shrink-0"
          value={filter}
          onChange={changeFilter}
          options={[
            { value: "all", label: "Tümü", count: all.length },
            {
              value: "empty",
              label: (
                <>
                  <span className="sm:hidden">Kalan</span>
                  <span className="hidden sm:inline">Sayılmayanlar</span>
                </>
              ),
              count: remaining,
            },
          ]}
        />
      </div>

      {visibleGroups.map((g) => {
        const groupCounted = g.lines.filter((l) => qtyOf(l.id) !== null).length;
        const groupDone = groupCounted === g.lines.length;
        return (
          <Card key={g.name} className="break-inside-avoid">
            <CardHeader
              title={g.name}
              meta={
                <>
                  <span className="tabular">
                    {num(groupCounted)} / {num(g.lines.length)} sayıldı
                  </span>
                  {groupDone ? (
                    <Badge tone="green" dot className="ml-1">
                      Tamam
                    </Badge>
                  ) : null}
                </>
              }
              actions={isAdmin ? <span className="text-sm font-semibold text-ink tabular">{tl(groupTotal(g))}</span> : null}
              className="pb-2"
            />
            <ul className="divide-y divide-line px-2 pb-2">
              {g.visible.map((l) => {
                const v = qtyOf(l.id);
                const invalid = isInvalid(l.id);
                const changed = v !== l.qty;
                const inputId = `count-${l.id}`;
                return (
                  <li key={l.id} className="flex items-center gap-2.5 px-2 py-2.5 sm:gap-3 sm:px-3">
                    <LineStatus status={invalid ? "invalid" : v !== null ? "counted" : "empty"} />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm leading-5 font-medium text-ink">
                        <span className="min-w-0 break-words">{l.name}</span>
                        {changed && !invalid ? (
                          <span className="size-1.5 shrink-0 rounded-full bg-info" title="Kaydedilmedi">
                            <span className="sr-only">(kaydedilmedi)</span>
                          </span>
                        ) : null}
                      </label>
                      {l.packageDesc ? <p className="mt-0.5 truncate text-xs text-ink-mute">{l.packageDesc}</p> : null}
                      {l.prevQty !== null ? (
                        <p className="mt-0.5 text-xs text-ink-mute tabular">
                          Geçen ay {num(l.prevQty, 3)} {l.countUnit}
                        </p>
                      ) : null}
                      {invalid ? <p className="mt-0.5 text-xs font-medium text-bad">Geçersiz miktar</p> : null}
                      {isAdmin ? (
                        <p className="mt-0.5 text-xs text-ink-mute tabular sm:hidden">
                          {tl(l.unitPrice, 2)}/{l.countUnit} · <span className="font-semibold text-ink">{v ? tl(v * l.unitPrice) : "–"}</span>
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <NumberInput
                        id={inputId}
                        data-count-input=""
                        enterKeyHint="next"
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValues((x) => ({ ...x, [l.id]: e.target.value }))}
                        onKeyDown={focusNextCount}
                        placeholder="—"
                        aria-label={`${l.name} miktarı (${l.countUnit})`}
                        aria-invalid={invalid || undefined}
                        className="cell-input h-11 w-[5.5rem] sm:h-10 sm:w-24"
                      />
                      <span className="w-11 text-xs font-medium text-ink-mute">{l.countUnit}</span>
                    </div>
                    {isAdmin ? (
                      <div className="hidden w-48 shrink-0 justify-end gap-4 text-right text-xs text-ink-mute tabular sm:flex">
                        <span>
                          {tl(l.unitPrice, 2)}/{l.countUnit}
                        </span>
                        <span className="w-20 font-semibold text-ink">{v ? tl(v * l.unitPrice) : "–"}</span>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      {!visibleGroups.length ? (
        <Card>
          {!all.length ? (
            <EmptyState icon={<ClipboardCheck />} title="Sayılacak kalem yok" description="Hammaddelerde sayım birimi girilmiş aktif kalem yok." />
          ) : q.trim() ? (
            <EmptyState
              icon={<SearchX />}
              title="Eşleşen kalem yok"
              description={`"${q.trim()}" için sonuç bulunamadı.`}
              action={
                <Button variant="secondary" onClick={() => setQ("")}>
                  Aramayı temizle
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ClipboardCheck />}
              title="Sayılmayan kalem kalmadı"
              description="Bu filtrede gösterilecek kalem yok."
              action={
                <Button variant="secondary" onClick={() => changeFilter("all")}>
                  Tümünü göster
                </Button>
              }
            />
          )}
        </Card>
      ) : null}

      {isAdmin ? (
        <Card className="break-inside-avoid">
          <CardHeader
            icon={<PackagePlus />}
            title="Listede olmayanlar"
            description="Hammaddelerde olmayan ama stokta duran kalemler (elle fiyatlı)."
            meta={
              extras.length ? (
                <span className="tabular">
                  {num(extras.length)} kalem · {tl(extrasTotal)}
                </span>
              ) : undefined
            }
            actions={
              <Button variant="secondary" className="no-print" onClick={() => setExtras((x) => [...x, { name: "", unit: "ADET", qty: "", unitPrice: "" }])}>
                <Plus size={16} /> Kalem ekle
              </Button>
            }
          />
          <CardContent>
            {extras.length ? (
              <ul className="space-y-3 sm:space-y-2">
                {extras.map((e, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_8rem_auto]"
                  >
                    <Input
                      value={e.name}
                      onChange={(ev) => updateExtra(i, { name: ev.target.value })}
                      placeholder="Kalem adı"
                      aria-label="Kalem adı"
                      className="col-span-3 sm:col-span-1"
                    />
                    <IconButton label="Kaldır" tone="danger" className="no-print order-1 sm:order-last" onClick={() => setExtras((x) => x.filter((_, j) => j !== i))}>
                      <Trash2 size={16} />
                    </IconButton>
                    <Input value={e.unit} onChange={(ev) => updateExtra(i, { unit: ev.target.value })} placeholder="Birim" aria-label="Birim" className="order-2 sm:order-none" />
                    <NumberInput
                      value={e.qty}
                      onChange={(ev) => updateExtra(i, { qty: ev.target.value })}
                      placeholder="Miktar"
                      aria-label="Miktar"
                      aria-invalid={e.qty.trim() !== "" && parseNumberTR(e.qty) === null ? true : undefined}
                      className="cell-input order-2 sm:order-none"
                    />
                    <NumberInput
                      value={e.unitPrice}
                      onChange={(ev) => updateExtra(i, { unitPrice: ev.target.value })}
                      placeholder="Birim fiyat"
                      aria-label="Birim fiyat"
                      aria-invalid={e.unitPrice.trim() !== "" && parseNumberTR(e.unitPrice) === null ? true : undefined}
                      className="cell-input order-2 sm:order-none"
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-mute">Ek kalem yok.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Kaydetme kapsülü: değişiklik varken alttan yaylı hareketle gelir */}
      <FloatingBar open={dirty}>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-sm font-semibold text-ink">{changeLabel}</p>
          <p className="truncate text-xs text-ink-mute">
            {monthLabel} sayımı kaydedilmedi{isAdmin ? ` · toplam ${tl(total)}` : ""}
          </p>
        </div>
        <Button onClick={save} disabled={busy} size="lg">
          <Save size={18} /> {busy ? "Kaydediliyor…" : "Sayımı kaydet"}
        </Button>
      </FloatingBar>
    </div>
  );
}
