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
import { startTransition, useMemo, useOptimistic, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { clearQuery, FilterBar, FilterChip, keepScroll, matches, SearchField, useQueryState, useQueryText, useSettleScroll } from "@/components/ui/filters";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { SortButton, Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { daysInMonth } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import {
  createPosMappingIndex,
  describeSkipped,
  isSummaryRow,
  parsePastedSales,
  suspectTotalRows,
  type SalesParseResult,
} from "@/lib/calc/pos-paste";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  applyLineMatches,
  clearMonthSales,
  deleteLine,
  importSales,
  parseSalesFile,
  saveLine,
  saveMonthInfo,
  setLineMatch,
} from "@/server/actions/sales";

import {
  collectSuggestions,
  inMarginScale,
  marginColor,
  marginLevelLabel,
  marginScale,
  monthPhase,
  openDaysHint,
  openDaysProblem,
  previewMatches,
  suggestProduct,
  type MappingLite,
  type MarginScale,
} from "./sales-logic";


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

/** Açık gün alanının "Tüm ay (30)" tek tık düzeltmesi */
function AllMonthButton({ dim, onPick }: { dim: number; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="cursor-pointer font-medium text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink pointer-coarse:min-h-8"
    >
      Tüm ay ({dim})
    </button>
  );
}

export function MonthInfoForm({
  month,
  label,
  info,
  listTotal,
  currentMonth,
  className,
}: {
  month: string;
  label: string;
  info: { openDays: number | null; posRevenue: number | null; discounts: number; offRevenue: number; note: string | null };
  listTotal: number;
  /** Türkiye saatine göre bu ay; açık gün açıklaması (devam eden ay / kapanmış ay) buna göre */
  currentMonth: string;
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
  const dim = daysInMonth(month);
  const phase = monthPhase(month, currentMonth);
  const daysError = openDaysProblem(openDays, month);
  /** Boş değil ama okunamayan tutar; ayın gün sayısından büyük açık gün */
  const bad = {
    pos: pos.trim() !== "" && posNum === null,
    disc: disc.trim() !== "" && parseNumberTR(disc) === null,
    off: off.trim() !== "" && parseNumberTR(off) === null,
    days: daysError !== null,
  };
  const invalid = bad.pos || bad.disc || bad.off || bad.days;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (invalid) return toast.error(daysError ?? "Tutarları kontrol edin (ör. 429.698 ya da 11.997,50)");
    setBusy(true);
    keepScroll();
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
      toast.success(res.data.removed ? "Ay bilgileri boşaltıldı" : "Ay bilgileri kaydedildi", {
        description: res.data.removed ? `${label} için kayıtlı bilgi kalmadı.` : undefined,
      });
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
        {/* Dokunmatikte alanlar 40px (parmakla rahat seçilsin) */}
        <form onSubmit={save} className="flex flex-1 flex-col gap-3 pointer-coarse:[&_input]:h-10">
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <Field label="POS ciro, KDV dahil (₺)" tip="İndirimler düşülmüş, ödenmezler hariç" htmlFor="m-pos" error={bad.pos ? "Sayı girin" : undefined}>
              <NumberInput id="m-pos" value={pos} onChange={(e) => setPos(e.target.value)} placeholder="0" aria-invalid={bad.pos || undefined} className={bad.pos ? undefined : "cell-input"} />
            </Field>
            <Field
              label="Açık gün sayısı"
              tip={
                <>
                  Sabit giderler açık gün ÷ ayın gün sayısı oranıyla bölünür (Excel Genel Maliyet, 2. satır). Devam eden ayda bu sayı
                  &quot;bugüne kadar geçen gün&quot; olarak da kullanılır: Genel bakış&apos;taki ay sonu tahmini POS cirosu ÷ açık gün × ayın
                  gün sayısıdır. Ay bitince gerçek açık gün sayısını yazın; kapanmış aylarda tahmin yapılmaz.
                </>
              }
              htmlFor="m-days"
              // Hata çıktığında da "Tüm ay" tek tık düzeltmesi görünür kalır (ör. Eylül'e 31 yazıldı)
              error={
                daysError ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{daysError}</span>
                    {phase !== "running" ? <AllMonthButton dim={dim} onPick={() => setOpenDays(String(dim))} /> : null}
                  </span>
                ) : undefined
              }
              hint={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{openDaysHint(openDays, month, currentMonth)}</span>
                  {phase !== "running" && openDays.trim() !== String(dim) ? <AllMonthButton dim={dim} onPick={() => setOpenDays(String(dim))} /> : null}
                </span>
              }
            >
              <NumberInput
                id="m-days"
                value={openDays}
                onChange={(e) => setOpenDays(e.target.value.replace(/\D/g, "").slice(0, 2))}
                inputMode="numeric"
                placeholder={phase === "running" ? "bugüne kadar" : `ör. ${dim}`}
                aria-invalid={bad.days || undefined}
                className={bad.days ? undefined : "cell-input"}
              />
            </Field>
            <Field label="Yönetici indirimleri (₺)" tip="KDV dahil (Patron > İndirim)" htmlFor="m-disc" error={bad.disc ? "Sayı girin" : undefined}>
              <NumberInput id="m-disc" value={disc} onChange={(e) => setDisc(e.target.value)} aria-invalid={bad.disc || undefined} className={bad.disc ? undefined : "cell-input"} />
            </Field>
            <Field label="Ödenmez / ikram (₺)" tip="Ciro dışı: malzemesi harcanan, geliri olmayan satışlar" htmlFor="m-off" error={bad.off ? "Sayı girin" : undefined}>
              <NumberInput id="m-off" value={off} onChange={(e) => setOff(e.target.value)} aria-invalid={bad.off || undefined} className={bad.off ? undefined : "cell-input"} />
            </Field>
          </div>
          <Field label="Not" htmlFor="m-note">
            <Textarea id="m-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="max-h-48 min-h-16 [field-sizing:content]" />
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
            <Button type="submit" variant={dirty ? "primary" : "secondary"} disabled={busy} className="pointer-coarse:h-10">
              {busy ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
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
  const found = products.filter((p) => matches(`${p.name} ${p.size} ${p.category}`, q));
  // Arama yokken şu anki eşleşme en üstte (uzun listede aranmasın)
  const current = !isService && currentId ? found.find((p) => p.id === currentId) : undefined;
  const list = (current && !q.trim() ? [current, ...found.filter((p) => p !== current)] : found).slice(0, PICKER_LIMIT);
  return (
    <Dialog open onClose={onClose} title="Ürünle eşleştir" description={title} size="md">
      <div className="space-y-3 pb-2">
        {/* Enter ilk sonucu seçer: ada göre arayıp tek tuşla eşleştirme */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim() && list[0]) onPick({ productId: list[0].id, isService: false });
          }}
        >
          <SearchField value={q} onChange={setQ} placeholder="Ürün, boy ya da kategori" label="Menüde ara" shortcut={false} />
        </form>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onPick({ productId: null, isService: true })}
            aria-pressed={isService}
            className={cn("pointer-coarse:h-10", isService && "text-info ring-info/30")}
          >
            <Mic size={15} /> HİZMET (maliyetsiz, ör. karaoke)
            {isService ? <Check size={14} aria-hidden="true" /> : null}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPick({ productId: null, isService: false })}
            disabled={!currentId && !isService}
            className="pointer-coarse:h-10"
            title={!currentId && !isService ? "Bu satır henüz eşleşmedi" : undefined}
          >
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
        {found.length > PICKER_LIMIT || (q.trim() && list.length) ? (
          <p className="text-xs text-ink-mute">
            {found.length > PICKER_LIMIT ? `İlk ${PICKER_LIMIT} sonuç gösteriliyor (${num(found.length)} ürün). Aramayı daraltın. ` : null}
            {q.trim() && list.length ? "Enter ilk sonucu seçer." : null}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Satış tablosu

type RowStatus = "service" | "matched" | "unmatched";

function rowStatus(r: SalesRow): RowStatus {
  return r.isService ? "service" : r.matched ? "matched" : "unmatched";
}

/** Adresteki ?durum= değerleri (bildirimdeki bağlantı ?durum=eslesmeyen kullanır) */
type StatusFilter = "tumu" | "eslesmeyen" | "eslesen" | "hizmet";
const FILTER_STATUS: Record<Exclude<StatusFilter, "tumu">, RowStatus> = { eslesmeyen: "unmatched", eslesen: "matched", hizmet: "service" };
/** "Temizle" düğmesinin sıfırladığı adres anahtarları (sıralama ve ay korunur) */
const FILTER_KEYS = ["ara", "durum"];

type SortKey = "ad" | "adet" | "ciro" | "maliyet" | "kom" | "kar" | "marj";
const COMPARE: Record<SortKey, (a: SalesRow, b: SalesRow) => number> = {
  ad: (a, b) => a.posName.localeCompare(b.posName, "tr"),
  adet: (a, b) => a.qty - b.qty,
  ciro: (a, b) => a.revenue - b.revenue,
  maliyet: (a, b) => a.cost - b.cost,
  kom: (a, b) => a.commission - b.commission,
  kar: (a, b) => a.grossProfit - b.grossProfit,
  marj: (a, b) => a.margin - b.margin,
};
/** Varsayılan: rapordaki sıra (içe aktarılan dosyadaki gibi) */
const REPORT_ORDER = "rapor";
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: REPORT_ORDER, label: "Rapor sırası" },
  { value: "ciro-azalan", label: "Ciro: yüksekten düşüğe" },
  { value: "kar-azalan", label: "Brüt kâr: yüksekten düşüğe" },
  { value: "kar-artan", label: "Brüt kâr: düşükten yükseğe" },
  { value: "marj-artan", label: "Marj: düşükten yükseğe" },
  { value: "marj-azalan", label: "Marj: yüksekten düşüğe" },
  { value: "adet-azalan", label: "Adet: çoktan aza" },
  { value: "maliyet-azalan", label: "Maliyet: yüksekten düşüğe" },
  { value: "ad-artan", label: "Ad: A → Z" },
];

/** ?sirala=ciro-azalan -> { key: "ciro", dir: "desc" }; tanınmayan değer rapor sırası */
function parseSort(v: string): { key: SortKey; dir: "asc" | "desc" } | null {
  const [k, d] = v.split("-");
  if (!(k in COMPARE)) return null;
  return { key: k as SortKey, dir: d === "artan" ? "asc" : "desc" };
}

/**
 * Satır içi eşleşme düğmesi: masaüstünde 32px, dokunmatikte 40px. 160px'te kesilir (tablo 1280px ekranda
 * yatay kaymadan sığsın); uzun adda kesilen ürün adıdır, boy (· M / · L) her zaman görünür.
 */
const MATCH_BTN =
  "inline-flex h-8 max-w-40 cursor-pointer items-center gap-1.5 rounded-[10px] px-2.5 text-left text-[13px] font-medium transition-colors pointer-coarse:h-10";

const MATCH_TONE = {
  matched: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink/25",
  unmatched: "bg-warn-soft text-warn ring-1 ring-inset ring-warn/25 hover:ring-warn/50",
  service: "bg-info-soft text-info ring-1 ring-inset ring-info/20 hover:ring-info/40",
} as const;

type Totals = { qty: number; revenue: number; net: number; cost: number; commission: number; grossProfit: number; margin: number };
type Optimistic = { kind: "match"; id: number; productId: number | null; isService: boolean; label: string | null } | { kind: "delete"; id: number };

/** Tablo başlığı: kalın ad + altında küçük birim/açıklama satırı (sütunlar dar kalsın, birim görünsün) */
function HeadLabel({ children, sub, wrap }: { children: ReactNode; sub?: string; wrap?: boolean }) {
  return (
    <>
      {children}
      {sub ? <span className={cn("block text-xs font-normal text-ink-mute", wrap && "whitespace-normal")}>{sub}</span> : null}
    </>
  );
}

/** Ürün adı kesilebilir, boyu kesilmez ("Ice White Choc. Mo… · M") */
function NameSize({ name, size }: { name: string; size?: string }) {
  return (
    <>
      <span className="truncate">{name}</span>
      {size ? <span className="-ml-1 shrink-0">· {size}</span> : null}
    </>
  );
}

/**
 * Kâr marjı (Excel Satış Raporu J sütunu, 0,0%) ve üç renkli ölçek: ayın en düşük marjı kırmızı, ortancası
 * sarı, en yükseği yeşil. Ölçeğe yalnızca reçeteli ürüne bağlı satırlar girer; HİZMET ve eşleşmeyen
 * (maliyeti tahmini) satırlar renksiz gösterilir.
 */
function MarginPill({ row, scale }: { row: SalesRow; scale: MarginScale | null }) {
  const colored = scale && inMarginScale(row);
  const level = colored ? marginLevelLabel(row.margin, scale) : null;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-lg px-1.5 text-[13px] font-medium tabular",
        colored ? "text-ink" : "text-ink-mute",
        !colored && "ring-1 ring-inset ring-line-strong",
        row.grossProfit < 0 && "text-bad",
      )}
      style={colored ? { backgroundColor: marginColor(row.margin, scale) } : undefined}
      title={row.isService ? "HİZMET: maliyetsiz" : !row.matched ? "Maliyet tahmini (ortalama oran); ölçeğe girmez" : (level ?? undefined)}
    >
      {pct(row.margin, 1)}
      {level ? <span className="sr-only"> · {level}</span> : null}
    </span>
  );
}

export function SalesTable({
  rows: serverRows,
  products,
  mappings,
  month,
  totals,
}: {
  rows: SalesRow[];
  products: ProductOption[];
  /** POS adı hafızası (Satır ekle penceresinde "otomatik bağlanacak" ipucu için) */
  mappings: MappingLite[];
  month: string;
  totals: Totals;
}) {
  const reduce = useCalmMotion();
  // Sayfadaki her eylem (eşleştirme, ay bilgisi, içe aktarma…) yenilemeyle yeni satır dizisi getirir
  useSettleScroll(serverRows);
  // Eşleştirme ve silme sunucu yanıtını beklemeden görünür; hata olursa satır eski haline döner
  const [rows, applyOptimistic] = useOptimistic(serverRows, (state: SalesRow[], a: Optimistic) =>
    a.kind === "delete"
      ? state.filter((r) => r.id !== a.id)
      : state.map((r) =>
          r.id === a.id ? { ...r, productId: a.productId, isService: a.isService, matched: !!a.productId && !a.isService, productLabel: a.label } : r,
        ),
  );
  const [rawFilter, setFilter] = useQueryState<string>("durum", "tumu");
  const [q, setQ] = useQueryText("ara");
  const [rawSort, setSort] = useQueryState<string>("sirala", REPORT_ORDER);
  const filter: StatusFilter = rawFilter in FILTER_STATUS ? (rawFilter as StatusFilter) : "tumu";
  const sort = parseSort(rawSort);
  const [picking, setPicking] = useState<SalesRow | null>(null);
  const [editing, setEditing] = useState<Partial<SalesRow> | null>(null);
  const [deleting, setDeleting] = useState<SalesRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const scale = useMemo(() => marginScale(serverRows.filter(inMarginScale).map((r) => r.margin)), [serverRows]);
  const suggestions = useMemo(() => collectSuggestions(rows, products), [rows, products]);
  /** Rapora yanlışlıkla girmiş toplam satırları ("TOPLAM 2.543 441.955"): ciroyu iki kez sayar */
  const summaryRows = rows.filter((r) => isSummaryRow(r.posName));

  // Durum çiplerinin sayaçları aramaya göre (arama yazılıyken "kaç eşleşmeyen var" görünsün)
  const searched = rows.filter((r) => matches(`${r.posName} ${r.productLabel ?? ""} ${r.note ?? ""}`, q));
  const counts = {
    unmatched: searched.filter((r) => rowStatus(r) === "unmatched").length,
    matched: searched.filter((r) => rowStatus(r) === "matched").length,
    service: searched.filter((r) => rowStatus(r) === "service").length,
  };
  const totalUnmatched = rows.filter((r) => rowStatus(r) === "unmatched").length;
  const byStatus = filter === "tumu" ? searched : searched.filter((r) => rowStatus(r) === FILTER_STATUS[filter]);
  // Sıralama kararlı: eşit değerlerde rapor sırası korunur
  const visible = sort ? [...byStatus].sort((a, b) => (sort.dir === "asc" ? 1 : -1) * COMPARE[sort.key](a, b)) : byStatus;
  const paged = usePaged(visible, 25, `${month}|${filter}|${q}|${rawSort}`);
  const anyFilter = filter !== "tumu" || Boolean(q.trim());
  const sum = (f: (r: SalesRow) => number) => visible.reduce((a, r) => a + f(r), 0);
  // Süzgeç yokken sunucunun ay toplamı; varsa görünen satırların toplamı
  const shownTotals: Totals = anyFilter
    ? (() => {
        const net = sum((r) => r.net);
        const grossProfit = sum((r) => r.grossProfit);
        return {
          qty: sum((r) => r.qty),
          revenue: sum((r) => r.revenue),
          net,
          cost: sum((r) => r.cost),
          commission: sum((r) => r.commission),
          grossProfit,
          margin: net ? grossProfit / net : 0,
        };
      })()
    : totals;
  const totalsLabel = anyFilter ? `Süzülen ${num(visible.length)} satır` : "Ay toplamı";

  const toggleFilter = (f: StatusFilter) => setFilter(filter === f ? "tumu" : f);
  // Sayısal sütun: azalan → artan → rapor sırası; ad: A→Z → Z→A → rapor sırası
  const toggleSort = (key: SortKey) => {
    const first = key === "ad" ? "asc" : "desc";
    if (!sort || sort.key !== key) return setSort(`${key}-${first === "asc" ? "artan" : "azalan"}`);
    if (sort.dir === first) return setSort(`${key}-${first === "asc" ? "azalan" : "artan"}`);
    setSort(REPORT_ORDER);
  };
  const dirOf = (key: SortKey) => (sort?.key === key ? sort.dir : null);
  const sortValue = sort ? `${sort.key}-${sort.dir === "asc" ? "artan" : "azalan"}` : REPORT_ORDER;

  const clearFilters = () => {
    setQ("");
    clearQuery(FILTER_KEYS);
  };

  /** Sayfa değişince listenin başına dön (alttaki sayfalamadan tıklanınca yeni sayfanın sonunda kalınmasın) */
  const toPage = (p: number) => {
    paged.setPage(p);
    const el = document.getElementById("satirlar");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  };

  function pick(row: SalesRow, v: { productId: number | null; isService: boolean }) {
    setPicking(null);
    const p = v.productId ? productById.get(v.productId) : undefined;
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "match", id: row.id, ...v, label: p ? `${p.name} · ${p.size}` : null });
      const res = await setLineMatch(row.id, v.productId, v.isService);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const others = res.data.others ? ` Aynı adlı ${num(res.data.others)} satır daha bağlandı.` : "";
      toast.success(v.isService ? "HİZMET olarak işaretlendi" : v.productId ? "Eşleştirildi" : "Eşleşme kaldırıldı", {
        description:
          v.productId || v.isService
            ? `“${row.posName}” sonraki aylarda otomatik tanınacak.${others}`
            : `“${row.posName}” hafızadan da silindi; sonraki raporlarda eşleşmemiş gelir.`,
      });
    });
  }

  function remove() {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    keepScroll();
    startTransition(async () => {
      applyOptimistic({ kind: "delete", id: target.id });
      const res = await deleteLine(target.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Satır silindi", { description: `${target.posName} · ${num(target.qty)} adet` });
    });
  }

  async function applySuggestions() {
    setBulkBusy(true);
    keepScroll();
    const res = await applyLineMatches(
      month,
      suggestions.map((x) => ({ lineId: x.row.id, productId: x.product.id })),
    );
    setBulkBusy(false);
    setBulkOpen(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${num(res.data.applied)} öneri uygulandı`, {
      description: res.data.skipped
        ? `${num(res.data.skipped)} satır bu arada değişmiş, atlandı.`
        : "Bu adlar sonraki aylarda otomatik tanınacak.",
    });
  }

  /** Eşleşme düğmesi + (varsa) tek tıkla uygulanan değnekli öneri */
  const matchCell = (r: SalesRow) => {
    const status = rowStatus(r);
    const suggestion = status === "unmatched" ? suggestProduct(r.posName, products) : null;
    const product = status === "matched" && r.productId ? productById.get(r.productId) : undefined;
    return (
      <>
        <button
          type="button"
          onClick={() => setPicking(r)}
          className={cn(MATCH_BTN, MATCH_TONE[status])}
          title={status === "matched" && r.productLabel ? `${r.productLabel} · değiştirmek için tıklayın` : "Ürünle eşleştir"}
        >
          {status === "service" ? (
            <span className="truncate">HİZMET</span>
          ) : product ? (
            <NameSize name={product.name} size={product.size} />
          ) : (
            <span className="truncate">{r.productLabel ?? "Eşleşmedi — seç"}</span>
          )}
          <ChevronDown size={14} className="shrink-0 opacity-60" aria-hidden="true" />
        </button>
        {suggestion ? (
          <button
            type="button"
            className={cn(MATCH_BTN, "bg-lime/25 text-good-ink hover:bg-lime/45")}
            onClick={() => pick(r, { productId: suggestion.id, isService: false })}
            title={`Önerilen eşleşmeyi uygula: ${suggestion.name} · ${suggestion.size}`}
          >
            <Wand2 size={13} className="shrink-0" aria-hidden="true" />
            <span className="sr-only">Önerilen eşleşmeyi uygula: </span>
            <NameSize name={suggestion.name} size={suggestion.size} />
          </button>
        ) : null}
      </>
    );
  };

  const rowActions = (r: SalesRow, coarse?: boolean) => (
    <>
      <IconButton label="Düzenle" onClick={() => setEditing(r)} className={coarse ? "pointer-coarse:size-10" : undefined}>
        <Pencil size={15} />
      </IconButton>
      <IconButton label="Sil" tone="danger" onClick={() => setDeleting(r)} className={coarse ? "pointer-coarse:size-10" : undefined}>
        <Trash2 size={15} />
      </IconButton>
    </>
  );

  return (
    // Telefonda üstteki sabit çubuğun (56px) altında kalmasın
    <Card id="satirlar" className="scroll-mt-20 lg:scroll-mt-6">
      <CardHeader
        icon={<ListChecks />}
        title="Satış satırları"
        description="Eşleşmeyen satırlara menüden ürün seçin; seçim hatırlanır ve sonraki aylarda otomatik uygulanır."
        meta={
          rows.length ? (
            totalUnmatched ? (
              <button
                type="button"
                onClick={() => toggleFilter("eslesmeyen")}
                className="inline-flex cursor-pointer items-center gap-1.5 underline-offset-2 hover:underline pointer-coarse:min-h-10"
                aria-live="polite"
              >
                <span>Eşleşmeyen</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-warn tabular">
                  <CountUp value={totalUnmatched} kind="num" />
                </span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-good" aria-live="polite">
                <CircleCheck size={14} aria-hidden="true" /> Tüm satırlar eşleşti
              </span>
            )
          ) : null
        }
        actions={
          <>
            {suggestions.length ? (
              <Button size="sm" variant="accent" onClick={() => setBulkOpen(true)} className="pointer-coarse:h-10">
                <Wand2 size={15} /> {num(suggestions.length)} öneriyi uygula
              </Button>
            ) : null}
            {/* Asıl yol içe aktarma; elle satır ikincil eylem */}
            <Button size="sm" variant="secondary" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })} className="pointer-coarse:h-10">
              <Plus size={16} /> Satır ekle
            </Button>
          </>
        }
      />
      {summaryRows.length ? (
        <div className="mx-5 mb-3 flex items-start gap-2.5 rounded-2xl bg-bad-soft px-3 py-2.5 text-[13px] leading-5 text-bad" role="alert">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-semibold">Listede toplam satırı var:</span> ürün gibi sayıldığı için ay cirosu ve kâr iki kat görünür. Silin.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {summaryRows.map((r) => (
                <li key={r.id}>
                  <Button size="sm" variant="secondary" onClick={() => setDeleting(r)} className="text-bad pointer-coarse:h-10">
                    <Trash2 size={14} /> {r.posName} · {tl(r.revenue)}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {rows.length ? (
        <FilterBar active={anyFilter} onClear={clearFilters} shown={visible.length} total={rows.length} unit="satır" className="px-5 pb-3">
          <SearchField value={q} onChange={setQ} placeholder="POS adı, ürün ya da not ara" label="Satırlarda ara" className="w-full sm:w-72" />
          <FilterChip active={filter === "eslesmeyen"} onToggle={() => toggleFilter("eslesmeyen")} count={counts.unmatched}>
            Eşleşmeyen
          </FilterChip>
          <FilterChip active={filter === "eslesen"} onToggle={() => toggleFilter("eslesen")} count={counts.matched}>
            Eşleşen
          </FilterChip>
          <FilterChip active={filter === "hizmet"} onToggle={() => toggleFilter("hizmet")} count={counts.service}>
            Hizmet
          </FilterChip>
          <Select value={sortValue} onChange={(e) => setSort(e.target.value)} className="w-full md:hidden pointer-coarse:h-10" aria-label="Sıralama">
            {SORT_OPTIONS.some((o) => o.value === sortValue) ? null : <option value={sortValue}>Sırala · özel</option>}
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                Sırala · {o.label}
              </option>
            ))}
          </Select>
        </FilterBar>
      ) : null}

      {visible.length ? (
        <>
          {/* Telefon: kart listesi (geniş tablo 375px'te yalnız iki sütun gösterirdi) */}
          <ul className="divide-y divide-line-strong/70 border-t border-line md:hidden">
            {paged.slice.map((r) => {
              const status = rowStatus(r);
              const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words text-ink">{r.posName}</p>
                      <p className="mt-0.5 text-[13px] text-ink-mute tabular">
                        {num(r.qty)} adet · {tl(r.revenue)}
                      </p>
                      {Math.abs(priceGap) > 0.03 ? (
                        <p className="text-xs text-warn tabular">
                          ort. {tl(r.avgPrice)} · menüden {priceGap > 0 ? "+" : ""}
                          {pct(priceGap, 0)}
                        </p>
                      ) : null}
                      {r.note ? <p className="text-xs break-words text-ink-mute">{r.note}</p> : null}
                    </div>
                    <div className="shrink-0 text-right tabular">
                      <p className={cn("font-semibold", r.grossProfit < 0 ? "text-bad" : "text-ink")}>{tl(r.grossProfit)}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1.5 text-xs text-ink-mute">
                        brüt kâr <MarginPill row={r} scale={scale} />
                      </p>
                      <p className={cn("text-xs", status === "unmatched" ? "text-warn" : "text-ink-mute")}>
                        maliyet {tl(r.cost)}
                        {status === "unmatched" ? " (tahmini)" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{matchCell(r)}</div>
                    <div className="flex shrink-0 gap-1.5">{rowActions(r, true)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line-strong px-5 py-3 text-sm font-semibold md:hidden">
            <span>
              {totalsLabel}
              <span className="block text-xs font-normal text-ink-mute tabular">
                {num(shownTotals.qty)} adet · {tl(shownTotals.revenue)}
              </span>
            </span>
            <span className="text-right tabular">
              <span className={cn(shownTotals.grossProfit < 0 && "text-bad")}>{tl(shownTotals.grossProfit)}</span>
              <span className="block text-xs font-normal text-ink-mute">brüt kâr · marj {pct(shownTotals.margin, 1)}</span>
            </span>
          </div>

          <TableWrap className="max-md:hidden">
            <Table>
              <THead>
                <tr>
                  <TH sticky>
                    <SortButton dir={dirOf("ad")} onClick={() => toggleSort("ad")}>
                      POS ürün adı
                    </SortButton>
                  </TH>
                  <TH>
                    <span className="inline-flex items-center gap-1.5">
                      Eşleşen ürün
                      <InfoTip text="Tıklayıp menüdeki ürünü seçin. HİZMET = karaoke gibi maliyetsiz satış. Değnekli öneri, adı birebir tutan ürünü tek tıkla uygular." />
                    </span>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("adet")} onClick={() => toggleSort("adet")}>
                      Adet
                    </SortButton>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="KDV dahil">
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Altında KDV hariç net ciro. Ortalama satış fiyatı menü fiyatından %3'ten fazla saparsa uyarı görünür." />
                        <SortButton numeric dir={dirOf("ciro")} onClick={() => toggleSort("ciro")}>
                          Ciro
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="malzeme + ambalaj" wrap>
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Eşleşenlerde adet × birim maliyet; eşleşmeyenlerde net ciro × ortalama maliyet oranı (turuncu, tahmini)." />
                        <SortButton numeric dir={dirOf("maliyet")} onClick={() => toggleSort("maliyet")}>
                          Maliyet
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH numeric title="POS (kart) komisyonu">
                    <HeadLabel sub="POS kartı">
                      <SortButton numeric dir={dirOf("kom")} onClick={() => toggleSort("kom")}>
                        Kom.
                      </SortButton>
                    </HeadLabel>
                  </TH>
                  <TH numeric>
                    <SortButton numeric dir={dirOf("kar")} onClick={() => toggleSort("kar")}>
                      Brüt kâr
                    </SortButton>
                  </TH>
                  <TH numeric>
                    <HeadLabel sub="kâr ÷ net">
                      <span className="inline-flex items-center gap-1.5">
                        <InfoTip text="Excel'deki 'Kâr marjı %' sütunu ve renk ölçeği: bu ayın en düşük marjı kırmızı, ortancası sarı, en yükseği yeşil. Ölçeğe reçeteli ürünler girer; HİZMET ve eşleşmeyen (maliyeti tahmini) satırlar renksizdir." />
                        <SortButton numeric dir={dirOf("marj")} onClick={() => toggleSort("marj")}>
                          Marj
                        </SortButton>
                      </span>
                    </HeadLabel>
                  </TH>
                  <TH className="w-px px-2">
                    <span className="sr-only">İşlemler</span>
                  </TH>
                </tr>
              </THead>
              <motion.tbody
                key={`${filter}|${rawSort}|${paged.page}`}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
              >
                {paged.slice.map((r) => {
                  const status = rowStatus(r);
                  const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
                  const product = r.productId ? productById.get(r.productId) : undefined;
                  return (
                    <TR key={r.id}>
                      <TD sticky className="max-w-64 min-w-36 sm:min-w-40">
                        <div className="flex items-center gap-3">
                          {/* Dar masaüstünde (1280–1536px) ad için yer açılsın: karo yalnız geniş ekranda */}
                          <IconTile
                            className="max-2xl:hidden"
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
                      <TD className="min-w-44">
                        <div className="flex flex-col items-start gap-1.5">{matchCell(r)}</div>
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
                      </TD>
                      <TD numeric>
                        <MarginPill row={r} scale={scale} />
                      </TD>
                      <TD className="px-2">
                        <div className="flex justify-end gap-1">{rowActions(r)}</div>
                      </TD>
                    </TR>
                  );
                })}
              </motion.tbody>
              <tfoot>
                <TFootRow>
                  <TD sticky>{totalsLabel}</TD>
                  <TD />
                  <TD numeric>{num(shownTotals.qty)}</TD>
                  <TD numeric>
                    {tl(shownTotals.revenue)}
                    <span className="block text-xs font-normal text-ink-mute">net {tl(shownTotals.net)}</span>
                  </TD>
                  <TD numeric>{tl(shownTotals.cost)}</TD>
                  <TD numeric>{tl(shownTotals.commission)}</TD>
                  <TD numeric>
                    <span className={cn(shownTotals.grossProfit < 0 && "text-bad")}>{tl(shownTotals.grossProfit)}</span>
                  </TD>
                  <TD numeric>{pct(shownTotals.margin, 1)}</TD>
                  <TD />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            onChange={toPage}
            total={paged.total}
            unit="satır"
            // Telefonda 6 sayfa + oklar karta sığsın (sığmazsa alt satıra geçer, kartın dışına taşmaz)
            className="border-t border-line max-sm:px-3 [&>div]:flex-wrap max-sm:[&>div]:gap-1"
          />
        </>
      ) : rows.length ? (
        <div className="border-t border-line">
          <EmptyState
            icon={<ListChecks />}
            title={filter === "eslesmeyen" && !q.trim() ? "Eşleşmeyen satır kalmadı" : "Bu süzgece uyan satır yok"}
            description={
              q.trim()
                ? `“${q.trim()}” için sonuç bulunamadı. Aramayı kısaltın ya da süzgeci temizleyin.`
                : filter === "eslesmeyen"
                  ? "Bu aydaki bütün satırlar bir ürüne ya da HİZMET'e bağlı; maliyetler tahmin değil, reçeteden."
                  : "Seçili durumda satır yok."
            }
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Süzgeci temizle
              </Button>
            }
          />
        </div>
      ) : (
        <EmptyState
          icon={<Upload />}
          title="Bu ay için satış raporu yok"
          description="Patron > Raporlar > Satış ekranındaki ürün listesini yukarıdaki İçe aktar bölümüne dosya olarak bırakın ya da yapıştırın. Tek tek eklemek için “Satır ekle”."
          action={
            <Button variant="secondary" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })}>
              <Plus size={16} /> Satır ekle
            </Button>
          }
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
      {editing ? <LineDialog line={editing} month={month} mappings={mappings} products={products} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={bulkOpen}
        onClose={() => {
          if (!bulkBusy) setBulkOpen(false);
        }}
        title={`${num(suggestions.length)} öneri uygulansın mı?`}
        description="Adı menüdeki ürünle birebir tutan satırlar bağlanır ve hafızaya yazılır. Yanlış olanı sonra tıklayıp değiştirebilirsiniz."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy} data-autofocus>
              Vazgeç
            </Button>
            <Button onClick={applySuggestions} disabled={bulkBusy || !suggestions.length}>
              {bulkBusy ? "Uygulanıyor…" : `${num(suggestions.length)} eşleşmeyi uygula`}
            </Button>
          </>
        }
      >
        <ul className="scroll-thin max-h-80 divide-y divide-line overflow-y-auto rounded-2xl bg-surface text-sm ring-1 ring-line-strong">
          {suggestions.map(({ row, product }) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
              <span className="min-w-0 font-medium break-words text-ink">{row.posName}</span>
              <span className="text-ink-quiet" aria-hidden="true">
                →
              </span>
              <span className="sr-only">ile</span>
              <span className="text-ink-soft">
                {product.name} · {product.size}
              </span>
              <span className="ml-auto text-xs text-ink-mute tabular">
                {num(row.qty)} adet · {tl(row.revenue)}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Satır silinsin mi?"
        confirmLabel="Satırı sil"
        description={
          deleting ? (
            <>
              <span className="font-medium text-ink">{deleting.posName}</span> ({num(deleting.qty)} adet · {tl(deleting.revenue)}) bu aydan silinir.
              Eşleştirme hafızası silinmez; bu ad bir sonraki raporda yine tanınır.
            </>
          ) : null
        }
      />
    </Card>
  );
}

/** Boş değil ama sayı olarak okunamayan değer */
const badNumber = (t: string) => t.trim() !== "" && parseNumberTR(t) === null;

function LineDialog({
  line,
  month,
  mappings,
  products,
  onClose,
}: {
  line: Partial<SalesRow>;
  month: string;
  mappings: MappingLite[];
  products: ProductOption[];
  onClose: () => void;
}) {
  const [posName, setPosName] = useState(line.posName ?? "");
  const index = useMemo(() => createPosMappingIndex(mappings), [mappings]);
  const [qty, setQty] = useState(num(line.qty ?? 1, 2));
  const [revenue, setRevenue] = useState(line.revenue ? num(line.revenue, 2, 2) : "");
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const qtyNum = parseNumberTR(qty);
  const revNum = parseNumberTR(revenue) ?? 0;
  const bad = { qty: badNumber(qty) || (tried && !qty.trim()), revenue: badNumber(revenue) };
  const nameMissing = tried && !posName.trim();
  const isTotal = posName.trim() !== "" && isSummaryRow(posName);
  // Yeni satırda ya da eşleşmemiş satırın adı düzeltilirken hafızadaki eşleşme otomatik bağlanır
  const willLink = !line.matched && !line.isService && posName.trim() ? index.get(posName) : undefined;
  const linkProduct = willLink?.productId ? products.find((p) => p.id === willLink.productId) : undefined;
  const linkLabel = willLink?.isService ? "HİZMET" : linkProduct ? `${linkProduct.name} · ${linkProduct.size}` : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!posName.trim()) return toast.error("POS ürün adını girin");
    if (isTotal) return toast.error("Toplam satırı ürün satırı olarak eklenmez (ciro iki kez sayılır)");
    if (qtyNum === null || bad.revenue) return toast.error("Adet ve ciroyu kontrol edin");
    setBusy(true);
    keepScroll();
    const res = await saveLine({ id: line.id ?? null, month, posName, qty: qtyNum, revenue: revNum, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(line.id ? "Satır güncellendi" : "Satır eklendi", {
      description: `${posName.trim()} · ${num(qtyNum)} adet · ${tl(revNum, 2)}${res.data.linked && linkLabel ? ` · ${linkLabel} ile eşleşti` : ""}`,
    });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={line.id ? "Satırı düzenle" : "Satır ekle"}
      description={line.id ? undefined : "Rapora girmemiş bir satışı elle ekleyin. Ad daha önce eşleştirildiyse ürün otomatik bağlanır."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="pointer-coarse:h-10">
            Vazgeç
          </Button>
          <Button type="submit" form="sales-line-form" disabled={busy} className="pointer-coarse:h-10">
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      {/* Enter kaydeder, Esc kapatır; dokunmatikte alanlar 40px */}
      <form id="sales-line-form" onSubmit={submit} noValidate className="space-y-4 pb-2 pointer-coarse:[&_input]:h-10">
        <Field
          label="POS ürün adı"
          htmlFor="l-name"
          hint={
            linkLabel ? (
              <span className="inline-flex items-center gap-1 text-good">
                <Check size={12} aria-hidden="true" /> Hafızada: {linkLabel} ile otomatik eşleşir
              </span>
            ) : (
              "Patron'daki adıyla, ör. ICED AMERICANO MEDİUM (büyük/küçük harf fark etmez)"
            )
          }
          error={nameMissing ? "Ad girin" : isTotal ? "Bu bir toplam satırı; ürün satırı olarak eklenmez" : undefined}
        >
          <Input
            data-autofocus
            id="l-name"
            value={posName}
            onChange={(e) => setPosName(e.target.value)}
            aria-invalid={nameMissing || isTotal || undefined}
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adet" htmlFor="l-qty" error={bad.qty ? "Sayı girin" : undefined}>
            <NumberInput id="l-qty" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.currentTarget.select()} aria-invalid={bad.qty || undefined} />
          </Field>
          <Field
            label="Ciro, KDV dahil (₺)"
            htmlFor="l-rev"
            error={bad.revenue ? "Sayı girin (ör. 1.250,50)" : undefined}
            hint={qtyNum && revNum ? `Ortalama ${tl(revNum / qtyNum, 2)} / adet` : undefined}
          >
            <NumberInput id="l-rev" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0,00" aria-invalid={bad.revenue || undefined} />
          </Field>
        </div>
        <Field label="Not" htmlFor="l-note" hint="İsteğe bağlı, satırın altında görünür">
          <Input id="l-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- İçe aktarma

type ParsedLine = { posName: string; qty: number; revenue: number };
type Parsed = Pick<SalesParseResult, "skipped" | "skippedRows"> & { rows: ParsedLine[]; source: "file" | "paste" };

const SKIP_REASON: Record<SalesParseResult["skippedRows"][number]["reason"], string> = {
  summary: "toplam satırı",
  header: "başlık",
  invalid: "adet / ciro okunamadı",
};

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
  hasInfo,
  className,
}: {
  month: string;
  /** Hedef ayın adı, ör. "Eylül 2026" (önizleme açıkken ay değiştirilirse hedef görünür kalsın) */
  label: string;
  lineCount: number;
  mappings: MappingLite[];
  products: ProductOption[];
  /** Ayda ciro / açık gün / not gibi bilgi var mı ("Ayı temizle" penceresinde seçenek olarak) */
  hasInfo: boolean;
  className?: string;
}) {
  const reduce = useCalmMotion();
  const hasLines = lineCount > 0;
  const [source, setSource] = useState<"file" | "paste">("file");
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [withInfo, setWithInfo] = useState(false);

  const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
  const preview = useMemo(() => previewMatches(rows, mappings, products), [rows, mappings, products]);
  // Adı "TOPLAM" olmayan ama cirosu diğerlerinin toplamına eşit satır: otomatik atlanmaz, sorulur
  const suspects = useMemo(() => new Set(suspectTotalRows(rows)), [rows]);
  const totals = preview.reduce((a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue }), { qty: 0, revenue: 0 });
  const skippedText = parsed ? describeSkipped(parsed.skipped) : null;
  const counts = {
    matched: preview.filter((p) => p.status === "matched").length,
    service: preview.filter((p) => p.status === "service").length,
    fresh: preview.filter((p) => p.status === "new").length,
  };
  // Sunucu HTML'i ve hidrasyon sırasında useCalmMotion true döner: kart ilk boyamada görünür gelir,
  // yalnızca sonradan değişen görünüm (dosya ↔ yapıştır ↔ önizleme) yumuşakça belirir
  const fade = {
    initial: reduce ? (false as const) : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: reduce ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT },
  };

  /** Okunan listeyi önizlemeye alır; atlanan satırları sessizce yutmaz, sayısını söyler */
  function accept(res: SalesParseResult, from: "file" | "paste") {
    setParsed({ rows: res.rows, skipped: res.skipped, skippedRows: res.skippedRows, source: from });
    const why = describeSkipped(res.skipped);
    toast.success(`${num(res.rows.length)} satır okundu`, {
      description: [why, res.suspectTotals.length ? "Toplam satırı olabilecek bir satır var; önizlemede kontrol edin." : null].filter(Boolean).join(" · ") || undefined,
    });
  }

  async function onFile(f: File) {
    const fd = new FormData();
    fd.set("file", f);
    setBusy(true);
    const res = await parseSalesFile(fd);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    accept(res.data, "file");
  }

  function readPasted() {
    const r = parsePastedSales(text);
    if (!r.rows.length) {
      const why = describeSkipped(r.skipped);
      return toast.error("Satır okunamadı. Her satırda ürün adı, adet ve ciro olmalı.", { description: why ?? undefined });
    }
    accept(r, "paste");
  }

  function dropRow(i: number) {
    setParsed((p) => (p ? { ...p, rows: p.rows.filter((_, j) => j !== i) } : p));
  }

  function restart() {
    setParsed(null);
  }

  async function submit() {
    setBusy(true);
    keepScroll();
    const res = await importSales({ month, lines: rows, mode });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    const d = res.data;
    const left = d.count - d.matched;
    toast.success(`${num(d.count)} satır ${label} ayına yüklendi`, {
      description: [
        `${num(d.matched)} tanesi hafızadan eşleşti${left ? `, ${num(left)} satırı aşağıdan eşleştirin` : ""}.`,
        d.replaced ? `Önceki ${num(d.replaced)} satır değiştirildi.` : null,
        skippedText,
        d.skippedSummary ? `${num(d.skippedSummary)} toplam satırı atlandı.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
    setParsed(null);
    setText("");
  }

  async function clearMonth() {
    setClearing(true);
    keepScroll();
    const res = await clearMonthSales(month, { withInfo });
    setClearing(false);
    setConfirmClear(false);
    setWithInfo(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${num(res.data.deleted)} satır silindi`, {
      description: res.data.monthRemoved
        ? `${label} artık tamamen boş.`
        : withInfo
          ? "Ay bilgileri de silindi."
          : "Ay bilgileri (ciro, açık gün) duruyor.",
    });
  }

  return (
    <Card className={className}>
      {!parsed ? (
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
                    Her satırda ürün adı, adet, ciro. Başlık ve TOPLAM satırları otomatik atlanır.{" "}
                    {/* Klavye kısayolu dokunmatikte anlamsız */}
                    <span className="pointer-coarse:hidden">
                      <kbd className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft ring-1 ring-line-strong">Ctrl/⌘ + Enter</kbd> ile
                      okuyun.
                    </span>
                  </p>
                  <Button variant="primary" onClick={readPasted} disabled={!text.trim()} className="pointer-coarse:h-10">
                    <ClipboardPaste size={16} /> Yapıştırılanı oku
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
          {hasLines || hasInfo ? (
            <CardFooter className="mt-auto">
              <span>
                {hasLines
                  ? `Bu ayda ${num(lineCount)} satır var. Yeni rapor yüklerken değiştirmeyi ya da eklemeyi seçersiniz.`
                  : "Bu ayda satış satırı yok; yalnızca ay bilgileri var."}
              </span>
              <Button variant="ghost" size="sm" className="text-bad hover:bg-bad-soft hover:text-bad pointer-coarse:h-10" onClick={() => setConfirmClear(true)}>
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
            description={`${num(rows.length)} satır ${parsed.source === "file" ? "dosyadan" : "yapıştırılandan"} okundu. Kontrol edip ${label} ayına yükleyin.`}
            actions={
              <Button variant="ghost" size="sm" onClick={restart} disabled={busy} className="pointer-coarse:h-10">
                <RotateCcw size={15} /> Baştan başla
              </Button>
            }
          />
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green" dot>
                {counts.matched} eşleşti
              </Badge>
              {counts.service ? (
                <Badge tone="blue" dot>
                  {counts.service} hizmet
                </Badge>
              ) : null}
              <Badge tone="amber" dot>
                {counts.fresh} yeni ad
              </Badge>
              <span className="text-[13px] text-ink-mute tabular">
                Toplam {num(totals.qty)} adet · {tl(totals.revenue)}
              </span>
            </div>
            {skippedText ? (
              <div className="rounded-2xl bg-info-soft px-3 py-2.5 text-xs leading-5 text-info" role="status">
                <p className="flex items-start gap-2">
                  <CircleCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold">{skippedText}.</span> Bunlar ürün sayılmaz; ay cirosu iki kez sayılmasın diye yüklenmez.
                  </span>
                </p>
                {parsed.skippedRows.length ? (
                  <details className="mt-1.5 pl-6">
                    <summary className="cursor-pointer font-medium underline-offset-2 hover:underline pointer-coarse:min-h-8">Atlanan satırları göster</summary>
                    <ul className="mt-1 space-y-0.5 text-ink-soft">
                      {parsed.skippedRows.map((r) => (
                        <li key={r.line} className="break-words">
                          <span className="text-ink-mute tabular">{r.line}. satır</span> · {SKIP_REASON[r.reason]} ·{" "}
                          <span className="font-mono text-[11px]">{r.text}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
            {[...suspects].map((i) => (
              <div key={`s${i}`} className="flex flex-wrap items-start gap-2.5 rounded-2xl bg-warn-soft px-3 py-2.5 text-xs leading-5 text-warn" role="alert">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p className="min-w-0 flex-1">
                  <span className="font-semibold">“{rows[i].posName}” toplam satırı olabilir:</span> cirosu ({tl(rows[i].revenue)}) diğer satırların
                  toplamına eşit. Ürün değilse çıkarın, yoksa ay cirosu iki kat görünür.
                </p>
                <Button size="sm" variant="secondary" onClick={() => dropRow(i)} className="pointer-coarse:h-10">
                  <X size={14} /> Listeden çıkar
                </Button>
              </div>
            ))}
            <div className="scroll-thin max-h-72 overflow-auto rounded-2xl bg-surface px-1 ring-1 ring-line-strong">
              <Table>
                <THead className="sticky top-0 z-10 bg-surface [&_th]:pt-3">
                  <tr>
                    <TH>POS ürün adı</TH>
                    <TH numeric>Adet</TH>
                    <TH numeric>Ciro</TH>
                    <TH>Eşleşme</TH>
                    <TH className="w-px px-1">
                      <span className="sr-only">Çıkar</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {preview.map((r, i) => (
                    <TR key={`${i}|${r.posName}`} className={cn("hover:bg-panel/60", suspects.has(i) && "bg-warn-soft/60")}>
                      <TD className="min-w-40">{r.posName}</TD>
                      <TD numeric>{num(r.qty, 2)}</TD>
                      <TD numeric>{tl(r.revenue, 2)}</TD>
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
                      <TD className="px-1">
                        <IconButton label={`${r.posName} satırını listeden çıkar`} onClick={() => dropRow(i)} disabled={busy}>
                          <X size={14} />
                        </IconButton>
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
              <Button onClick={submit} disabled={busy || !rows.length} className="pointer-coarse:h-10">
                {busy ? "Yükleniyor…" : `${num(rows.length)} satırı yükle`}
              </Button>
            </div>
          </CardContent>
        </motion.div>
      )}

      <Dialog
        open={confirmClear}
        onClose={() => {
          if (!clearing) setConfirmClear(false);
        }}
        title={`${label} temizlensin mi?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)} disabled={clearing} data-autofocus>
              Vazgeç
            </Button>
            <Button variant="danger" onClick={clearMonth} disabled={clearing || (!hasLines && !withInfo)}>
              {clearing ? "Siliniyor…" : hasLines ? `${num(lineCount)} satırı${withInfo ? " ve bilgileri" : ""} sil` : "Ay bilgilerini sil"}
            </Button>
          </>
        }
      >
        <div className="space-y-3 pb-2 text-sm text-ink-mute">
          <p>
            {hasLines ? (
              <>
                <span className="font-medium text-ink">{num(lineCount)} satış satırı silinecek.</span> Eşleştirme hafızası ve Gelir-gider girişleri
                silinmez.
              </>
            ) : (
              "Bu ayda satış satırı yok."
            )}
          </p>
          {hasInfo ? (
            <Checkbox
              label="Ay bilgilerini de sil (POS ciro, açık gün, indirim, ödenmez, not)"
              checked={withInfo}
              onChange={(e) => setWithInfo(e.target.checked)}
              disabled={clearing}
            />
          ) : null}
        </div>
      </Dialog>
    </Card>
  );
}
