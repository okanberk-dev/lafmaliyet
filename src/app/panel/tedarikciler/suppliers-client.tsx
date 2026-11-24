"use client";

import { ChevronRight, Copy, EyeOff, Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { TlCounter } from "@/components/ui/animated-counter";
import { Badge } from "@/components/ui/badge";
import { toastUnreachable, tryAction } from "@/components/ui/action-error";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { clearQuery, FilterBar, FilterChip, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { Field, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { ActiveFilters, BIG_FIELDS, ChoiceList, FilterButton, SHEET_BTN, type ActiveFilter } from "@/components/ui/mobile-filters";
import { Notice } from "@/components/ui/notice";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { dateTR, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dismissCashOut } from "@/server/actions/cari";
import { unhideSupplier } from "@/server/actions/suppliers";

import { useCopied } from "../kullanicilar/password-field";
import { SupplierCardDialog } from "./card-dialog";
import {
  compareSuppliers,
  dueTone,
  dueWhen,
  matchesSupplierFilter,
  MISSING_LABEL,
  parseSupplierFilter,
  parseSupplierSort,
  supplierHaystack,
  supplierHref,
  SUPPLIER_SORTS,
  type HiddenSupplierRow,
  type SupplierFilter,
  type SupplierListRow,
  type SupplierSort,
  type TaxIndex,
} from "./logic";

const PAGE_SIZE = 25;
const FILTER_KEYS = ["ara", "durum", "sirala"];

/** Kasadan tedarikçiye çıkan, hesaba işlenmemiş satır (liste şeridi) */
export interface KasaPendingRow {
  id: number;
  date: string;
  kind: "harcama" | "teslim";
  amount: number;
  store: string | null;
  slug: string;
  name: string;
}

/** Sunucu sayfasının özet rakamları (kayan rakamlı sayaç); biçim işlevi sunucudan geçemediği için adıyla */
export function CountUp({ value, format = "tl" }: { value: number; format?: "tl" | "num" }) {
  return <TlCounter value={value} kind={format} className="tabular" />;
}

/** Ödenmemişlerin en yakın vadesi: "3 gün gecikti" kırmızı, SOON_DAYS içi turuncu */
function DueLine({ row, today, className }: { row: SupplierListRow; today: string; className?: string }) {
  const due = row.summary.nextDue;
  if (!due) return <span className={cn("text-ink-quiet", className)}>–</span>;
  return (
    <span className={cn("tabular", DUE_TONE[dueTone(due.date, today)], className)} title={due.estimated ? "Faturada vade yok: fatura tarihi + vade günü (tahmini)" : undefined}>
      {dateTR(due.date)}
      {due.estimated ? "*" : ""} · {dueWhen(due.date, today)}
    </span>
  );
}

const DUE_TONE = { bad: "text-bad", warn: "text-warn", ok: "text-ink-soft" } as const;

/**
 * Tedarikçi listesi: arama (ad, unvan, vergi no, IBAN, telefon), süzgeç (borcu olanlar, vadesi geçen, bilgisi
 * eksik) ve sıra adreste. Satıra dokununca tedarikçinin sayfası açılır (düzenle, sil orada); IBAN satırdan
 * kopyalanır. Telefonda kart, masaüstünde tablo. Listeden kaldırılanlar altta ayrı açılır.
 */
export function SuppliersClient({
  rows,
  hidden,
  today,
  defaultTermDays,
  taxIndex,
  kasa = [],
}: {
  rows: SupplierListRow[];
  hidden: HiddenSupplierRow[];
  today: string;
  defaultTermDays: number;
  /** Yeni tedarikçi penceresinde yazılan vergi noyla gelecek faturaların önizlemesi */
  taxIndex?: TaxIndex;
  /** Kasadan tedarikçilere çıkan, hesaba işlenmemiş satırlar (son 60 gün) */
  kasa?: KasaPendingRow[];
}) {
  const router = useRouter();
  const [q, setQ] = useQueryText("ara");
  const [rawFilter, setFilter] = useQueryState<string>("durum", "tumu");
  const [rawSort, setSort] = useQueryState<string>("sirala", "borc");
  const filter = parseSupplierFilter(rawFilter);
  const sort = parseSupplierSort(rawSort);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // Zilden gelen ?kasa=1: işlenmemiş kasa ödemeleri penceresi açık gelir
  const [kasaParam, setKasaParam] = useQueryState<string>("kasa", "");
  const [kasaOpen, setKasaOpen] = useState(false);
  const showKasa = (kasaOpen || kasaParam === "1") && kasa.length > 0;
  const closeKasa = () => {
    setKasaOpen(false);
    if (kasaParam) setKasaParam("");
  };
  const { copied, copy } = useCopied();

  const searched = rows.filter((r) => matches(supplierHaystack(r), q));
  const counts = {
    all: searched.length,
    borclu: searched.filter((r) => matchesSupplierFilter(r, "borclu")).length,
    geciken: searched.filter((r) => matchesSupplierFilter(r, "geciken")).length,
    eksik: searched.filter((r) => matchesSupplierFilter(r, "eksik")).length,
  };
  const visible = searched.filter((r) => matchesSupplierFilter(r, filter)).sort(compareSuppliers(sort));
  const paged = usePaged(visible, PAGE_SIZE, `${q}|${filter}|${sort}`);
  const anyFilter = Boolean(q.trim() || filter !== "tumu");
  const open = visible.reduce((a, r) => a + r.summary.open, 0);
  const toggle = (f: SupplierFilter) => setFilter(filter === f ? "tumu" : f);
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "durum"]);
  };

  const chips: ActiveFilter[] = [];
  if (filter !== "tumu") chips.push({ key: "durum", label: FILTER_LABEL[filter], onRemove: () => setFilter("tumu") });
  if (sort !== "borc") chips.push({ key: "sirala", label: SUPPLIER_SORTS.find((s) => s.value === sort)!.label, onRemove: () => setSort("borc") });

  const ibanButton = (r: SupplierListRow, className?: string) =>
    r.iban ? (
      <IconButton
        label={copied === r.key ? "IBAN kopyalandı" : `${r.name} IBAN'ını kopyala`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void copy(r.key, r.iban!, `IBAN kopyalandı · ${r.name}`);
        }}
        className={cn("relative z-10", className)}
      >
        <Copy size={15} />
      </IconButton>
    ) : null;

  // Eksik bilgi yalnız borcu olan tedarikçide işaretlenir (ödemek için IBAN gerekir); bütün eksikler "Bilgisi eksik"
  // süzgecinde
  const badges = (r: SupplierListRow) => (
    <>
      {r.paidOnDelivery ? (
        <Badge tone="green" title="Yeni faturaları ödendi gelir (peşin / otomatik ödeme)">
          Peşin
        </Badge>
      ) : null}
      {r.summary.openCount && r.missing.includes("iban") ? (
        <Badge tone="amber" dot title="IBAN girilmemiş: ödeme talebinde ve kopyalarken gerekir. Tedarikçinin sayfasında Düzenle'den ekleyin.">
          {MISSING_LABEL.iban}
        </Badge>
      ) : null}
      {r.summary.requestedCount ? (
        <Badge tone="blue" title="Ödemesi talep edilmiş, henüz ödenmemiş faturalar">
          {num(r.summary.requestedCount)} talep edildi
        </Badge>
      ) : null}
      {r.parasutPaid ? (
        <Badge tone="violet" title="Paraşüt'te ödenmiş görünüyor, panelde ödenmedi: tedarikçinin sayfasından ödendi işaretleyin">
          {num(r.parasutPaid)} Paraşüt&apos;te ödendi
        </Badge>
      ) : null}
      {r.debtOpenCount ? (
        <Badge tone="amber" title="Faturasız ya da elden alım; ödenmedi">
          Faturasız borç
        </Badge>
      ) : null}
      {(r.credit ?? 0) > 0.005 ? (
        <Badge tone="green" title="Hesapta sayılmamış ödeme: borçlara sayılınca düşer">
          Hesapta {money(r.credit ?? 0)}
        </Badge>
      ) : null}
      {r.kasaPending ? (
        <Badge tone="blue" title="Kasadan bu tedarikçiye çıkan para hesaba işlenmedi">
          Kasadan işlenmedi
        </Badge>
      ) : null}
    </>
  );
  /** Satırın Kalan borcu; hesaptaki para borcu aşınca alacak */
  const balanceText = (r: SupplierListRow) =>
    r.summary.open < -0.005 && (r.credit ?? 0) > 0.005 ? <span className="text-good">Alacak {money(-r.summary.open)}</span> : r.summary.open ? money(r.summary.open) : null;

  return (
    <Card id="tedarikci-listesi" className="scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
      <CardHeader
        icon={<Truck />}
        title="Tedarikçi listesi"
        description={
          <>
            <span className="lg:hidden">Tedarikçiye dokunun: bilgileri, faturaları ve ödeme durumu açılır; düzenlemek ve silmek de oradan. Kopyala simgesi IBAN&apos;ı panoya alır.</span>
            <span className="max-lg:hidden">
              Satıra tıklayınca tedarikçinin sayfası açılır: bilgileri, faturaları ve ödeme durumu; düzenlemek ve silmek de oradan. Kopyala simgesi IBAN&apos;ı panoya alır.
            </span>
          </>
        }
        meta={
          <>
            <span>
              <AnimatedNumber value={rows.length} format={(v) => num(v)} className="font-semibold text-ink tabular" /> tedarikçi
            </span>
            {counts.geciken ? (
              <>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => toggle("geciken")} className="inline-flex cursor-pointer items-center gap-1 text-bad underline-offset-2 hover:underline pointer-coarse:min-h-11">
                  <span className="font-semibold tabular">{num(counts.geciken)}</span> vadesi geçen
                </button>
              </>
            ) : null}
          </>
        }
        actions={
          <Button onClick={() => setAdding(true)} className="pointer-coarse:h-11 max-sm:hidden">
            <Plus size={16} /> Tedarikçi ekle
          </Button>
        }
      />

      {kasa.length ? (
        // Borç bakiyesi yanlış görünür: turuncu, katlanmaz (docs/planlar/ux-sade.md Ek A 227)
        <Notice
          tone="warn"
          risk="para"
          live="polite"
          className="mx-5 mb-3 max-sm:mx-4"
          title={`Kasadan tedarikçiye ${num(kasa.length)} ödeme hesaba işlenmedi (${money(kasa.reduce((a, l) => a + l.amount, 0))})`}
          action={
            <Button size="xs" variant="secondary" onClick={() => setKasaOpen(true)}>
              İşle
            </Button>
          }
        />
      ) : null}
      <Dialog
        open={showKasa}
        onClose={closeKasa}
        title="Kasadan işlenmemiş ödemeler"
        description="Personelin Kasa'ya Teslim · ödeme olarak girdiği ya da fişsiz alışveriş olarak yazdığı tedarikçi ödemeleri. İşle, ödemeyi tedarikçinin hesabına kasadan girer; Ödemeye çevir, alışverişin gider kaydını silip satırı ödeme yapar."
        footer={
          <Button variant="ghost" className={SHEET_BTN} onClick={closeKasa}>
            Kapat
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          {kasa.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words text-ink">{l.name}</p>
                <p className="text-xs text-ink-mute tabular">
                  {dateTR(l.date)} · {l.kind === "teslim" ? "Teslim" : "fişsiz alışveriş"} · {l.store} · {money(l.amount)}
                </p>
              </div>
              <Link href={`${supplierHref(l.slug)}?kasa=${l.id}`} onClick={closeKasa} className={buttonClass("secondary", "sm", "text-ink")}>
                {l.kind === "teslim" ? "İşle" : "Ödemeye çevir"}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  try {
                    const r = await dismissCashOut({ cashOutId: l.id });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(l.kind === "teslim" ? "Kasa satırı ayrı tutuldu" : "Ayrı alım olarak işaretlendi", { description: `${l.name} · ${money(l.amount)}` });
                  } catch (e) {
                    toastUnreachable(e);
                  }
                }}
              >
                {l.kind === "teslim" ? "Ayrı tut" : "Ayrı alım"}
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>

      {/* Telefon: arama + "Süzgeç"; seçimler alt sayfada */}
      <div role="search" className="space-y-2.5 px-4 pb-3 lg:hidden">
        <div className="flex items-center gap-2">
          <SearchField value={q} onChange={setQ} placeholder="Tedarikçi ara" label="Tedarikçi ara: ad, unvan, vergi no, IBAN, telefon" shortcut={false} className="flex-1 [&_input]:h-11" />
          <FilterButton count={chips.length} onClick={() => setSheetOpen(true)} />
        </div>
        <ActiveFilters items={chips} />
        <p className="flex min-h-6 items-center justify-between gap-2 text-[13px] text-ink-mute tabular" aria-live="polite">
          <span>{anyFilter ? `${num(visible.length)} / ${num(rows.length)} tedarikçi` : `${num(rows.length)} tedarikçi`}</span>
          {open ? (
            <span>
              borç <span className="font-semibold text-ink">{money(open)}</span>
            </span>
          ) : null}
        </p>
      </div>
      <Dialog
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Süzgeç ve sıralama"
        description={`${num(visible.length)} / ${num(rows.length)} tedarikçi gösteriliyor`}
        footer={
          <>
            <Button
              variant="ghost"
              className={SHEET_BTN}
              disabled={!chips.length && !q.trim()}
              onClick={() => {
                setQ("");
                clearQuery(FILTER_KEYS);
              }}
            >
              Temizle
            </Button>
            <Button className={SHEET_BTN} onClick={() => setSheetOpen(false)}>
              {visible.length ? `${num(visible.length)} tedarikçiyi göster` : "Kapat"}
            </Button>
          </>
        }
      >
        <div className={cn("space-y-4 pb-2", BIG_FIELDS)}>
          <ChoiceList<SupplierFilter>
            label="Göster"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "tumu", label: "Tümü", count: counts.all },
              { value: "borclu", label: "Borcu olanlar", count: counts.borclu },
              { value: "geciken", label: "Vadesi geçen", count: counts.geciken },
              { value: "eksik", label: "Bilgisi eksik", count: counts.eksik },
            ]}
          />
          <Field label="Sıralama" htmlFor="t-sort">
            <Select id="t-sort" value={sort} onChange={(e) => setSort(e.target.value as SupplierSort)}>
              {SUPPLIER_SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>

      <FilterBar active={anyFilter} onClear={clearFilters} shown={visible.length} total={rows.length} unit="tedarikçi" className="px-5 pb-4 max-lg:hidden">
        <SearchField value={q} onChange={setQ} placeholder="Ad, unvan, vergi no, IBAN" label="Tedarikçi ara: ad, unvan, vergi no, IBAN, telefon" className="w-full lg:w-72" />
        <FilterChip active={filter === "borclu"} onToggle={() => toggle("borclu")} count={counts.borclu}>
          Borcu olanlar
        </FilterChip>
        <FilterChip active={filter === "geciken"} onToggle={() => toggle("geciken")} count={counts.geciken}>
          {filter === "geciken" ? null : <span className="size-1.5 rounded-full bg-bad" aria-hidden="true" />}
          Vadesi geçen
        </FilterChip>
        <FilterChip active={filter === "eksik"} onToggle={() => toggle("eksik")} count={counts.eksik}>
          Bilgisi eksik
        </FilterChip>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SupplierSort)} className={cn("min-w-0 sm:w-60 pointer-coarse:h-11", sort !== "borc" && "ring-ink/40")} aria-label="Sıralama">
          {SUPPLIER_SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {visible.length ? (
        <>
          {/* Telefon ve tablet: kart listesi; kartın tamamı bağlantı, IBAN kopyalama üstte */}
          <ul className="divide-y divide-line-strong/70 border-t border-line lg:hidden">
            {paged.slice.map((r) => (
              <li key={r.key} className="relative px-4 pt-3 pb-3.5">
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} className="mt-0.5" />
                  <Link
                    href={supplierHref(r.slug)}
                    className="min-w-0 flex-1 rounded-xl outline-none before:absolute before:inset-0 before:content-[''] focus-visible:before:ring-2 focus-visible:before:ring-ink/30 focus-visible:before:ring-inset"
                  >
                    <span className="block text-[15px] leading-5 font-medium break-words text-ink">{r.name}</span>
                    {r.legalName ? <span className="mt-0.5 block text-[13px] break-words text-ink-mute">{r.legalName}</span> : null}
                    {r.sameTaxNames.length ? <span className="mt-0.5 block text-[13px] break-words text-ink-mute">Aynı vergi no: {r.sameTaxNames.join(", ")}</span> : null}
                    {r.summary.openCount ? <DueLine row={r} today={today} className="mt-0.5 block text-[13px]" /> : null}
                    <span className="mt-0.5 block text-[13px] text-ink-mute tabular">
                      {r.summary.lastInvoice ? `Son fatura ${dateTR(r.summary.lastInvoice)}` : "Faturası yok"}
                      {r.summary.openCount ? ` · ${num(r.summary.openCount)} ödenmemiş` : ""}
                    </span>
                  </Link>
                  <span className={cn("shrink-0 text-right text-[15px] leading-5 font-semibold tabular", r.summary.open ? "text-ink" : "text-sm font-normal text-ink-quiet")}>
                    {balanceText(r) ?? "Borç yok"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2 pl-12">
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">{badges(r)}</span>
                  {ibanButton(r, "-my-1 size-9 pointer-coarse:size-11")}
                  <ChevronRight size={16} className="shrink-0 text-ink-quiet" aria-hidden="true" />
                </div>
              </li>
            ))}
          </ul>

          <TableWrap className="max-lg:hidden">
            <Table>
              <THead>
                <tr>
                  <TH>Tedarikçi</TH>
                  <TH>Son fatura</TH>
                  <TH numeric>Ödenmemiş</TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1.5">
                      <InfoTip text="KDV dahil. Kısmen ödenmiş Paraşüt faturasında kalan tutar sayılır." />
                      Kalan borç
                    </span>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      En yakın vade
                      <InfoTip text={`Ödenmemiş faturaların en erken vadesi. * işaretli: faturada vade yok, fatura tarihi + vade günü (tedarikçinin bilgilerinde yoksa ${defaultTermDays} gün).`} />
                    </span>
                  </TH>
                  <TH className="w-px px-2">
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {paged.slice.map((r) => (
                  <TR key={r.key} className="relative cursor-pointer" onClick={() => router.push(supplierHref(r.slug))}>
                    <TD className="min-w-64 max-w-[28rem]">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} />
                        <div className="min-w-0">
                          <Link href={supplierHref(r.slug)} onClick={(e) => e.stopPropagation()} className="font-medium break-words text-ink underline-offset-2 hover:underline">
                            {r.name}
                          </Link>
                          {r.legalName ? <p className="text-[13px] break-words text-ink-mute">{r.legalName}</p> : null}
                          {r.sameTaxNames.length ? <p className="text-[13px] break-words text-ink-mute">Aynı vergi no: {r.sameTaxNames.join(", ")}</p> : null}
                          <div className="mt-1 flex flex-wrap gap-1 empty:hidden">{badges(r)}</div>
                        </div>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-soft tabular">{r.summary.lastInvoice ? dateTR(r.summary.lastInvoice) : "–"}</TD>
                    <TD numeric className={cn(!r.summary.openCount && "text-ink-quiet")}>
                      {r.summary.openCount ? num(r.summary.openCount) : "–"}
                    </TD>
                    <TD numeric className="font-semibold">
                      {balanceText(r) ?? <span className="font-normal text-ink-quiet">–</span>}
                      {r.summary.overdue ? <span className="block text-xs font-normal text-bad">{money(r.summary.overdue)} gecikmiş</span> : null}
                    </TD>
                    <TD className="whitespace-nowrap">{r.summary.openCount ? <DueLine row={r} today={today} /> : <span className="text-ink-quiet">–</span>}</TD>
                    <TD className="px-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">{ibanButton(r)}</div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={paged.setPage}
            total={paged.pageCount > 1 ? paged.total : undefined}
            unit="tedarikçi"
            className="border-t border-line max-sm:px-3 [&>div]:flex-wrap max-sm:[&>div]:gap-1"
          />
        </>
      ) : (
        <div className="border-t border-line">
          {rows.length ? (
            <EmptyState
              title="Bu süzgece uyan tedarikçi yok"
              description={q.trim() ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.` : FILTER_EMPTY[filter]}
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Süzgeci temizle
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Henüz tedarikçi yok"
              description="Faturalar geldikçe tedarikçiler burada kendiliğinden listelenir. Faturası henüz gelmemiş bir tedarikçinin bilgilerini şimdiden girebilirsiniz."
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus size={16} /> Tedarikçi ekle
                </Button>
              }
            />
          )}
        </div>
      )}

      {hidden.length ? (
        <div className="border-t border-line px-5 py-2 max-sm:px-4">
          <button
            type="button"
            onClick={() => setShowHidden(true)}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-[13px] font-medium text-ink-mute underline-offset-2 hover:text-ink hover:underline pointer-coarse:min-h-11"
          >
            <EyeOff size={14} aria-hidden="true" /> Listeden kaldırılanlar ({num(hidden.length)})
          </button>
        </div>
      ) : null}
      <Dialog
        open={showHidden && hidden.length > 0}
        onClose={() => setShowHidden(false)}
        title="Listeden kaldırılanlar"
        description="Faturaları Faturalar'da duruyor. Yeni faturası gelen tedarikçi listeye kendiliğinden döner."
        footer={
          <Button variant="ghost" className={SHEET_BTN} onClick={() => setShowHidden(false)}>
            Kapat
          </Button>
        }
      >
        <ul className="divide-y divide-line">
          {hidden.map((h) => (
            <li key={h.cardId} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                {/* Önce pencere kapanır: gizlenen liste sayfasında açık kalan pencere yeni sayfayı kilitlerdi */}
                <Link href={supplierHref(h.slug)} onClick={() => setShowHidden(false)} className="font-medium break-words text-ink underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                <p className="text-xs text-ink-mute tabular">
                  {num(h.count)} fatura · {dateTR(h.hiddenOn)} kaldırıldı
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0 text-ink pointer-coarse:h-11"
                onClick={async () => {
                  const r = await tryAction(() => unhideSupplier({ cardId: h.cardId }));
                  if (!r) return;
                  if (!r.ok) return void toast.error(r.error);
                  toast.success("Tedarikçi listeye geri alındı", { description: h.name });
                }}
              >
                Listeye geri al
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>

      <Fab onClick={() => setAdding(true)} className="h-12 pr-5 pl-4 sm:hidden">
        <Plus size={18} aria-hidden="true" /> Tedarikçi ekle
      </Fab>
      {/* Telefon: listenin sonu yüzen düğmenin altında kalmasın */}
      <div aria-hidden="true" className="h-16 sm:hidden" />

      {adding ? (
        <SupplierCardDialog
          card={null}
          defaultTermDays={defaultTermDays}
          taxIndex={taxIndex}
          onClose={() => setAdding(false)}
          onSaved={(r) => {
            if (r.slug) router.push(supplierHref(r.slug));
          }}
        />
      ) : null}
    </Card>
  );
}

const FILTER_LABEL: Record<SupplierFilter, string> = { tumu: "Tümü", borclu: "Borcu olanlar", geciken: "Vadesi geçen", eksik: "Bilgisi eksik" };

const FILTER_EMPTY: Record<SupplierFilter, string> = {
  tumu: "Arama ya da süzgeç bütün tedarikçileri dışarıda bıraktı.",
  borclu: "Ödenmemiş faturası olan tedarikçi yok.",
  geciken: "Vadesi geçmiş ödeme yok.",
  eksik: "Borcu olan ya da bilgisi girilmiş tedarikçilerde eksik bilgi yok.",
};
