"use client";

import { CalendarClock, ChevronDown, CirclePause, CirclePlay, Pencil, Plus, RotateCcw, Save, Trash2, Undo2, Users, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT, SPRING_PRESS } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FilterBar, matches, SearchField, useQueryText } from "@/components/ui/filters";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { shiftMonth, staffCost, type RangeStatus, type StaffCost, type StaffHistoryEntry } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteStaffVersion, endStaff, saveStaff, saveStaffRates } from "@/server/actions/costs";

import { pinSection } from "../ayarlar/pin-scroll";
import { CountUp, HeadIcon, ShareBreakdown } from "../giderler/expenses-client";
import { amountChangeText, choiceValue, entryAt, rangeText, spanText, startText, type EffectText, type MonthChoice } from "../giderler/history-text";
import { Disclosure, EffectNote, HistoryList, MonthChoiceField, RangeBadge, ResumeDialog, StopDialog } from "../giderler/history-ui";
import { checkRates, RATE_KEYS, ratesChanged, toRateTexts, type RateKey, type Rates, type RateTexts } from "./rates";

/** Liste satırı: maaş bu aya (ayrılmışsa son ayına, başlamadıysa ilk ayına) göre; geçmiş ve silme izni ile */
export type StaffRow = {
  id: number;
  name: string;
  netSalary: number;
  extras: number;
  startMonth: string | null;
  endMonth: string | null;
  status: RangeStatus;
  inRangeNow: boolean;
  valueMonth: string;
  history: StaffHistoryEntry[];
  /** Silinemiyorsa nedeni (kapanmış bir ayın maaş hesabına girdi); null = silinebilir */
  deleteBlocker: string | null;
};

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const RATE_FIELDS: { key: RateKey; label: string; hint?: string }[] = [
  { key: "isciSgk", label: "İşçi SGK primi (%)", hint: "Brütten kesilir" },
  { key: "isciIssizlik", label: "İşçi işsizlik (%)" },
  { key: "isverenSgk", label: "İşveren SGK (%)", hint: "5 puan teşvikli: 15,75" },
  { key: "isverenIssizlik", label: "İşveren işsizlik (%)" },
];

/** Boş alan 0 sayılır; yazılmış ama sayı olmayan metin geçersizdir */
/** SGK oranları bölümünün çapası: ⌘K'daki "SGK oranı" kaydı buraya iner */
const RATES_ANCHOR = "sgk-oranlari";

const parseOrZero = (text: string) => (text.trim() === "" ? 0 : parseNumberTR(text));
const invalidAmount = (text: string) => {
  const v = parseOrZero(text);
  return v === null || v < 0;
};

/** "30.000 ₺ net" ya da "30.000 ₺ net + 2.000 ₺ ek" */
const salaryLabel = (net: number, extras: number) => `${tl(net)} net${extras ? ` + ${tl(extras)} ek` : ""}`;

/** Uzun sütun başlıkları iki satıra sarılır, alta hizalanır: tablo 1400px ekranda yatay kaydırmasız sığar */
const WRAP_HEAD = "align-bottom leading-5 whitespace-normal";
/** Az önce kaydedilen satırın kısa süreli vurgusu */
const FLASH = "bg-lime/20 hover:bg-lime/25";

function useFlash(): [number | null, (id: number) => void] {
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);
  return [flash, setFlash];
}

/** Satırın altındaki açıklamalar: "Kasım 2026 itibarıyla 32.000 ₺ net", "Ekim 2026 itibarıyla · önce 30.000 ₺ net" */
function ChangeLines({ row, className }: { row: StaffRow; className?: string }) {
  const { entry, prev } = entryAt(row.history, row.valueMonth);
  const since = entry?.versionId && prev ? `${monthLabel(entry.fromMonth!)} itibarıyla · önce ${salaryLabel(prev.netSalary, prev.extras)}` : null;
  const up = row.history.find((h) => h.versionId !== null && h.fromMonth! > row.valueMonth && (!row.endMonth || h.fromMonth! <= row.endMonth));
  const next = up ? `${monthLabel(up.fromMonth!)} itibarıyla ${salaryLabel(up.netSalary, up.extras)}` : null;
  if (!since && !next) return null;
  return (
    <span className={cn("block space-y-0.5 text-xs leading-5 font-normal text-ink-mute", className)}>
      {next ? (
        <span className="flex items-center gap-1 text-ink-soft">
          <CalendarClock size={12} className="shrink-0" aria-hidden="true" />
          {next}
        </span>
      ) : null}
      {since ? <span className="block">{since}</span> : null}
    </span>
  );
}

type Undo = { row: StaffRow; versionId: number; fromMonth: string; label: string; back: string };

export function StaffEditor({
  staff,
  rates,
  settings,
  currentMonth,
  closed,
  months,
}: {
  staff: StaffRow[];
  rates: Rates;
  settings: Settings;
  /** "Bu ay" (YYYY-MM, Türkiye saati) */
  currentMonth: string;
  /** Hesabı olan kapanmış aylar */
  closed: string[];
  /** "Hangi aydan itibaren?" listesindeki aylar */
  months: string[];
}) {
  const reduce = useCalmMotion();
  const ratesId = useId();
  const [ratesOpen, setRatesOpen] = useState(false);
  const [r, setR] = useState<RateTexts>(() => toRateTexts(rates));
  const [ratesBusy, setRatesBusy] = useState(false);
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);
  const [stopping, setStopping] = useState<StaffRow | null>(null);
  const [resuming, setResuming] = useState<StaffRow | null>(null);
  const [deleting, setDeleting] = useState<StaffRow | null>(null);
  const [undoing, setUndoing] = useState<Undo | null>(null);
  const [pending, setPending] = useState(false);
  const [flash, setFlash] = useFlash();
  const [q, setQ] = useQueryText("ara");

  // Kayıtlı oranlar değişince (kayıttan sonra) alanlar onlardan yeniden kurulur
  const ratesKey = RATE_KEYS.map((k) => rates[k]).join("|");
  const [syncedRates, setSyncedRates] = useState(ratesKey);
  if (syncedRates !== ratesKey) {
    setSyncedRates(ratesKey);
    setR(toRateTexts(rates));
  }
  const check = checkRates(r);
  const ratesDirty = ratesChanged(r, rates);

  // ⌘K "SGK oranı" (/panel/personel#sgk-oranlari) bölümü açık getirir; aynı sayfada çapaya gelince de açılır (palet
  // aynı sayfada tarayıcının çapa gezinmesini kullanır, nav.ts samePageHash). Ayarlar'ın bölüm deseni
  // (ayarlar/section-card.tsx): kaydırma bölümün açılışı işlendikten sonra yapılır ve sayfa uzadıkça yeniden hizalanır;
  // kapalı bölümle sayfa kısa kalır, kaydırma alt sınırda kırpılırdı.
  const ratesRef = useRef<HTMLDivElement>(null);
  const [hashHits, setHashHits] = useState(0);
  useEffect(() => {
    const fromHash = () => {
      if (window.location.hash !== `#${RATES_ANCHOR}`) return;
      setRatesOpen(true);
      setHashHits((n) => n + 1);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);
  useEffect(() => {
    if (!hashHits || !ratesRef.current) return;
    return pinSection(ratesRef.current);
  }, [hashHits]);

  // Kaydedilmemiş oran varken sekmeyi kapatmadan önce tarayıcı sorsun
  useEffect(() => {
    if (!ratesDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ratesDirty]);

  // Hesap: yazılan oranlar geçerliyse onlarla (önizleme), değilse kayıtlı oranlarla
  const st: Settings = check.ok
    ? { ...settings, isciSgk: check.values.isciSgk!, isciIssizlik: check.values.isciIssizlik!, isverenSgk: check.values.isverenSgk!, isverenIssizlik: check.values.isverenIssizlik! }
    : settings;
  const costOf = (x: StaffRow) => staffCost({ id: x.id, name: x.name, netSalary: x.netSalary, extras: x.extras, active: true }, st);

  const live = staff.filter((x) => x.status !== "ended");
  const ended = staff.filter((x) => x.status === "ended");
  const now = live.filter((x) => x.inRangeNow);
  const nowCosts = now.map(costOf);
  const sum = (f: (c: StaffCost) => number) => nowCosts.reduce((a, c) => a + f(c), 0);
  const sums = {
    net: sum((c) => c.staff.netSalary),
    gross: sum((c) => c.gross),
    deductions: sum((c) => c.deductions),
    employerSgk: sum((c) => c.employerSgk),
    employerUnemployment: sum((c) => c.employerUnemployment),
    extras: sum((c) => c.staff.extras),
    total: sum((c) => c.total),
  };
  const visible = live.filter((x) => matches(x.name, q));
  const changes = staff
    .flatMap((x) => x.history.map((h, i) => ({ x, h, prev: x.history[i - 1] })).filter((c): c is { x: StaffRow; h: StaffHistoryEntry; prev: StaffHistoryEntry } => c.h.versionId !== null))
    .sort((a, b) => b.h.fromMonth!.localeCompare(a.h.fromMonth!) || a.x.name.localeCompare(b.x.name, "tr-TR"));
  const showSearch = live.length > 6 || q.trim() !== "";

  /**
   * Sunucu iletisini (hangi aydan itibaren, önceki aylar) bildirim olarak gösterir. Eylem atarsa (ağ kesildi, panel
   * güncellendi; E-51) bildirim çıkar, düğmeler bırakılır, pencere açık kalır. `maybeSaved`: eylem yeni kayıt açar;
   * yanıt yolda kaybolursa "Kaydedilemedi" denmez (kayıt yapılmış olabilir, ikinci dokunuş ikinci kişiyi yazar)
   */
  async function run<T extends { message?: string | null }>(p: Promise<ActionResult<T>>, fallback: string, maybeSaved = false): Promise<T | null> {
    setPending(true);
    const res = await tryAction(() => p, { maybeSaved });
    setPending(false);
    if (!res) return null;
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    toast.success(res.data.message ?? fallback);
    return res.data;
  }

  /** Diğer kişiler olduğu gibi gider (sıra korunur; gösterilen ayın değeri gider, hiçbir ay değişmez) */
  const unchanged = (except?: number) =>
    staff.filter((x) => x.id !== except).map((x) => ({ id: x.id, name: x.name, netSalary: x.netSalary, extras: x.extras, effectiveFrom: x.valueMonth }));

  async function stop(x: StaffRow, lastMonth: string) {
    const done = await run(endStaff(x.id, lastMonth), `${x.name} durduruldu`);
    if (done) setFlash(x.id);
    return !!done;
  }

  async function resume(x: StaffRow, fromMonth: string, mode: "clear" | "copy") {
    if (mode === "clear") {
      const done = await run(endStaff(x.id, null), `${x.name} devam ediyor`);
      if (done) setFlash(x.id);
      return !!done;
    }
    // Arada kapanmış aylar var: o ayları değiştirmemek için seçilen aydan itibaren yeni kayıt açılır
    const done = await run(
      saveStaff([...unchanged(), { id: null, name: x.name, netSalary: x.netSalary, extras: x.extras, effectiveFrom: fromMonth }]),
      `${x.name} ${monthLabel(fromMonth)} itibarıyla devam ediyor`,
      true,
    );
    const created = done?.changes.find((c) => !staff.some((s) => s.id === c.id));
    if (created) setFlash(created.id);
    return !!done;
  }

  async function unstop(x: StaffRow) {
    const done = await run(endStaff(x.id, null), `${x.name}: bitiş ayı kaldırıldı`);
    if (done) setFlash(x.id);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    const res = await tryAction(() => saveStaff([], [deleting.id]));
    setPending(false);
    if (!res) return;
    // Sunucu son sözü söyler: kapanmış bir ayın maaş hesabına girmişse silmez, nedenini yazar
    if (!res.ok) return toast.error(res.error);
    toast.success(`${deleting.name} silindi`);
    setDeleting(null);
    setEditing(null);
  }

  function askUndo(x: StaffRow, versionId: number) {
    const i = x.history.findIndex((h) => h.versionId === versionId);
    const h = x.history[i];
    const prev = x.history[i - 1];
    if (!h || !prev) return;
    setUndoing({ row: x, versionId, fromMonth: h.fromMonth!, label: salaryLabel(h.netSalary, h.extras), back: salaryLabel(prev.netSalary, prev.extras) });
  }

  async function confirmUndo() {
    if (!undoing) return;
    const done = await run(deleteStaffVersion(undoing.versionId), "Değişiklik geri alındı");
    if (!done) return;
    setFlash(undoing.row.id);
    setUndoing(null);
  }

  function discardRates() {
    setR(toRateTexts(rates));
    toast("Oran değişiklikleri geri alındı");
  }

  async function saveRates() {
    if (!check.ok) {
      setRatesOpen(true);
      return toast.error(check.formError ?? Object.values(check.errors)[0] ?? "Oranları kontrol edin");
    }
    setRatesBusy(true);
    const res = await tryAction(() =>
      saveStaffRates({
        isciSgk: check.values.isciSgk!,
        isciIssizlik: check.values.isciIssizlik!,
        isverenSgk: check.values.isverenSgk!,
        isverenIssizlik: check.values.isverenIssizlik!,
      }),
    );
    setRatesBusy(false);
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    toast.success("SGK oranları kaydedildi", { description: `Bütün ayların SGK tutarı yeniden hesaplandı. Bu ay işveren maliyeti ${tl(sums.total)}.` });
  }

  const rateSummary = `İşçi ${pct(rates.isciSgk, 2)} + ${pct(rates.isciIssizlik, 2)} · İşveren ${pct(rates.isverenSgk, 2)} + ${pct(rates.isverenIssizlik, 2)}`;
  const addButton = (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus size={16} /> Personel ekle
    </Button>
  );

  /** Satır eylemleri: düzenle, durdur / durdurmayı kaldır, (izin varsa) sil */
  const rowActions = (x: StaffRow) => (
    <div className="flex justify-end gap-1.5">
      <IconButton label={`${x.name}: düzenle`} onClick={() => setEditing(x)}>
        <Pencil size={15} />
      </IconButton>
      {x.status === "active" ? (
        x.endMonth ? (
          <IconButton label={`${x.name}: durdurmayı kaldır (devam ettir)`} onClick={() => void unstop(x)} disabled={pending}>
            <CirclePlay size={15} />
          </IconButton>
        ) : (
          <IconButton label={`${x.name}: durdur (ayrıldı)`} onClick={() => setStopping(x)}>
            <CirclePause size={15} />
          </IconButton>
        )
      ) : null}
      {!x.deleteBlocker ? (
        <IconButton label={`${x.name}: sil`} tone="danger" onClick={() => setDeleting(x)}>
          <Trash2 size={15} />
        </IconButton>
      ) : null}
    </div>
  );

  return (
    <div className={cn("space-y-6", ratesDirty && "pb-4")}>
      {/* Asıl cevap: bu ayın işveren maliyeti ve nereye gittiği */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <HeadIcon>
                <Wallet />
              </HeadIcon>
              <h2 className="text-base font-semibold tracking-tight text-ink">Toplam işveren maliyeti · {monthLabel(currentMonth)}</h2>
              <InfoTip text="Sabit giderler ve Gelir-gider tablosuna otomatik gider olarak geçer." />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">
              <CountUp value={sums.total} />
            </p>
            <p className="mt-1 text-[13px] text-ink-mute">
              {now.length} kişi · aylık{ratesDirty && check.ok ? " · kaydedilmemiş oranlarla" : ""}
            </p>
          </div>

          <Well className="grid w-full grid-cols-2 gap-x-6 gap-y-1 p-3.5 sm:w-auto">
            <div className="min-w-0">
              <p className="text-[13px] text-ink-mute">Tahmini brüt</p>
              <p className="text-lg font-semibold text-ink tabular">{tl(sums.gross)}</p>
              <p className="text-xs leading-5 text-ink-mute">Net + işçi kesintileri</p>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-ink-mute">İşveren SGK + işsizlik</p>
              <p className="text-lg font-semibold text-ink tabular">{tl(sums.employerSgk + sums.employerUnemployment)}</p>
              <p className="text-xs leading-5 text-ink-mute">Brüt üzerinden</p>
            </div>
          </Well>
        </div>

        <ShareBreakdown
          className="mt-6"
          total={sums.total}
          legendClassName="sm:grid-cols-3 lg:grid-cols-5"
          segments={[
            { key: "net", label: "Net maaşlar", value: sums.net, color: "var(--foreground)", note: "Personelin eline geçen" },
            { key: "deductions", label: "İşçi kesintileri", value: sums.deductions, color: "var(--chart-muted)", note: "SGK + işsizlik, brütten" },
            { key: "employerSgk", label: "İşveren SGK", value: sums.employerSgk, color: SERIES[1] },
            { key: "employerUnemployment", label: "İşveren işsizlik", value: sums.employerUnemployment, color: SERIES[0] },
            { key: "extras", label: "Yemek / yol / prim", value: sums.extras, color: SERIES[2] },
          ]}
        />
      </Card>

      <Card>
        <CardHeader
          icon={<Users />}
          title="Personel maliyeti"
          description={
            <>
              Satıra tıklayınca düzenlenir. Brüt = net ÷ (1 − işçi SGK − işçi işsizlik).{" "}
              <InfoTip text="Asgari ücret istisnası nedeniyle kaba bir tahmindir. Maaş değişikliği seçtiğiniz aydan itibaren geçerli olur; önceki aylar eski maaşla kalır." />
            </>
          }
          meta={
            <>
              <span>Bu ay · {now.length} kişi</span>
              {live.length > now.length ? <span className="text-ink-quiet">· Başlayacak · {live.length - now.length}</span> : null}
              {ended.length ? <span className="text-ink-quiet">· Ayrılan · {ended.length}</span> : null}
            </>
          }
          actions={addButton}
        />

        {showSearch ? (
          <div className="px-5 pb-3">
            <FilterBar active={q.trim() !== ""} onClear={() => setQ("")} shown={visible.length} total={live.length} unit="kişi">
              <SearchField value={q} onChange={setQ} placeholder="Personel ara" className="w-full sm:w-56" />
            </FilterBar>
          </div>
        ) : null}

        {!live.length ? (
          <EmptyState
            icon={<Users />}
            title="Personel yok"
            description="Personel ekleyip net maaşı yazın; brüt ve işveren maliyeti otomatik hesaplanır, Sabit giderler ve Gelir-gider tablosuna geçer."
            action={addButton}
          />
        ) : !visible.length ? (
          <EmptyState
            title="Bu aramaya uyan personel yok"
            description="Aramayı kısaltın. Ayrılan personel aşağıdaki Geçmiş bölümünde."
            action={
              <Button size="sm" variant="secondary" onClick={() => setQ("")}>
                Aramayı temizle
              </Button>
            }
          />
        ) : (
          <>
            {/*
              Geniş ekran: tablo (ilk sütun yatay kaydırmada sabit). xl altında kartlar: tablo 852px, 768px tablette ve
              kenar çubuğu açılan 1024px'te sığmıyor; Durum ve düzenle / durdur düğmeleri yana kayıp gizleniyordu.
            */}
            <TableWrap className="max-xl:hidden">
              <Table>
                <THead>
                  <tr>
                    <TH sticky className="align-bottom">
                      Personel
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      Net maaş
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      Tahmini brüt
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      İşçi kesintileri
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      <span className="inline-flex items-end gap-1">
                        <span>İşveren SGK + işsizlik</span>
                        <InfoTip text="Brüt üzerinden işveren SGK primi ve işveren işsizlik payı. Altında ikisi ayrı ayrı yazar." className="mb-0.5" />
                      </span>
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      <span className="inline-flex items-end gap-1">
                        <span>Yemek / yol / prim</span>
                        <InfoTip text="Varsa yemek kartı, yol parası, prim gibi aylık ek ödemeler." className="mb-0.5" />
                      </span>
                    </TH>
                    <TH numeric className={WRAP_HEAD}>
                      İşveren maliyeti
                    </TH>
                    <TH className="align-bottom">Durum</TH>
                    <TH>
                      <span className="sr-only">Eylemler</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {visible.map((x) => {
                    const c = costOf(x);
                    const dim = !x.inRangeNow && "opacity-60";
                    return (
                      <TR key={x.id} className={cn("cursor-pointer", x.id === flash && FLASH)} onClick={() => setEditing(x)}>
                        <TD sticky>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={x.name || "Personel"} className={cn(dim)} />
                            <span className={cn("min-w-0 font-medium", dim)}>
                              {x.name}
                              <ChangeLines row={x} className="mt-0.5" />
                            </span>
                          </div>
                        </TD>
                        <TD numeric className={cn("font-medium", dim)}>
                          {tl(x.netSalary)}
                        </TD>
                        <TD numeric className={cn(dim)}>
                          {tl(c.gross)}
                        </TD>
                        <TD numeric className={cn("text-ink-soft", dim)}>
                          {tl(c.deductions)}
                        </TD>
                        <TD numeric className={cn("text-ink-soft", dim)}>
                          {tl(c.employerSgk + c.employerUnemployment)}
                          <span className="block text-xs text-ink-mute">
                            <span className="sr-only">SGK </span>
                            {tl(c.employerSgk)} + <span className="sr-only">işsizlik </span>
                            {tl(c.employerUnemployment)}
                          </span>
                        </TD>
                        <TD numeric className={cn("text-ink-soft", dim)}>
                          {tl(x.extras)}
                        </TD>
                        <TD numeric className={cn("font-semibold", dim)}>
                          {tl(c.total)}
                        </TD>
                        <TD>
                          <RangeBadge status={x.status} range={x} currentMonth={currentMonth} />
                        </TD>
                        <TD onClick={(e) => e.stopPropagation()}>{rowActions(x)}</TD>
                      </TR>
                    );
                  })}
                </tbody>
                <tfoot>
                  <TFootRow>
                    <TD sticky className="whitespace-nowrap">
                      Toplam <span className="font-normal text-ink-mute">(bu ay)</span>
                    </TD>
                    <TD numeric>{tl(sums.net)}</TD>
                    <TD numeric>{tl(sums.gross)}</TD>
                    <TD numeric>{tl(sums.deductions)}</TD>
                    <TD numeric>
                      {tl(sums.employerSgk + sums.employerUnemployment)}
                      <span className="block text-xs font-normal text-ink-mute">
                        {tl(sums.employerSgk)} + {tl(sums.employerUnemployment)}
                      </span>
                    </TD>
                    <TD numeric>{tl(sums.extras)}</TD>
                    <TD numeric>{tl(sums.total)}</TD>
                    <TD colSpan={2} className="text-[13px] font-normal text-ink-mute">
                      {live.length > now.length ? "Başlamayanlar dahil değil" : null}
                    </TD>
                  </TFootRow>
                </tfoot>
              </Table>
            </TableWrap>

            {/* Telefon ve tablet: her kişi bir kart; tablodaki bütün değerler, altta durum ve eylemler */}
            <ul className="divide-y divide-line border-t border-line xl:hidden">
              {visible.map((x) => {
                const c = costOf(x);
                return (
                  <li key={x.id} className={cn("space-y-2 px-5 py-4 transition-colors", x.id === flash && FLASH)}>
                    <button type="button" onClick={() => setEditing(x)} className={cn("flex min-h-11 w-full cursor-pointer items-start gap-2.5 text-left", !x.inRangeNow && "opacity-60")}>
                      <Avatar name={x.name || "Personel"} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium break-words text-ink">{x.name}</span>
                        <span className="block text-xs text-ink-mute tabular">{salaryLabel(x.netSalary, x.extras)}</span>
                        <ChangeLines row={x} className="mt-0.5" />
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-ink tabular">{tl(c.total)}</span>
                        <span className="block text-xs text-ink-mute">işveren maliyeti</span>
                      </span>
                    </button>
                    <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1 pl-[42px] text-[13px] sm:max-w-md", !x.inRangeNow && "opacity-60")}>
                      <dt className="text-ink-mute">Tahmini brüt</dt>
                      <dd className="text-right text-ink tabular">{tl(c.gross)}</dd>
                      <dt className="text-ink-mute">İşçi kesintileri</dt>
                      <dd className="text-right text-ink tabular">{tl(c.deductions)}</dd>
                      <dt className="text-ink-mute">İşveren SGK + işsizlik</dt>
                      <dd className="text-right text-ink tabular">
                        {tl(c.employerSgk + c.employerUnemployment)}
                        {/* Tablodaki gibi altında ikisi ayrı: SGK + işsizlik */}
                        <span className="block text-xs text-ink-mute">
                          <span className="sr-only">SGK </span>
                          {tl(c.employerSgk)} + <span className="sr-only">işsizlik </span>
                          {tl(c.employerUnemployment)}
                        </span>
                      </dd>
                    </dl>
                    <div className="flex items-center justify-between gap-2 pl-[42px]">
                      <RangeBadge status={x.status} range={x} currentMonth={currentMonth} />
                      {rowActions(x)}
                    </div>
                  </li>
                );
              })}
              <li className="flex items-baseline justify-between gap-3 px-5 py-3.5 font-semibold text-ink">
                <span>Toplam · {monthLabel(currentMonth)}</span>
                <span className="tabular">{tl(sums.total)}</span>
              </li>
            </ul>
          </>
        )}

        {/* Geçmiş: ayrılan personel ve maaş değişiklikleri (kapalı gelir) */}
        <div className="border-t border-line px-5 py-3.5">
          <Disclosure
            title="Geçmiş"
            summary={
              ended.length || changes.length
                ? [ended.length ? `${ended.length} ayrılan` : "", changes.length ? `${changes.length} maaş değişikliği` : ""].filter(Boolean).join(" · ")
                : "Henüz yok: ayrılan personel ve maaş değişiklikleri burada görünür"
            }
            headClassName="pointer-coarse:min-h-11"
          >
            <div className="space-y-5 pt-3 pb-1">
              {ended.length ? (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-soft">Ayrılan personel</p>
                  <ul className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
                    {ended.map((x) => (
                      <li key={x.id} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-2.5", x.id === flash && FLASH)}>
                        <button type="button" onClick={() => setEditing(x)} className="min-w-0 cursor-pointer text-left">
                          <span className="block text-sm font-medium text-ink">{x.name}</span>
                          <span className="block text-xs text-ink-mute">
                            {rangeText(x)} · son maaş {salaryLabel(x.netSalary, x.extras)}
                          </span>
                        </button>
                        <span className="flex items-center gap-1.5">
                          <Button size="xs" variant="secondary" onClick={() => setResuming(x)}>
                            <CirclePlay size={14} /> Devam ettir
                          </Button>
                          {!x.deleteBlocker ? (
                            <IconButton label={`${x.name}: sil`} tone="danger" onClick={() => setDeleting(x)}>
                              <Trash2 size={15} />
                            </IconButton>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {changes.length ? (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-ink-soft">Maaş değişiklikleri</p>
                  <ul className="divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
                    {changes.map(({ x, h, prev }) => (
                      <li key={h.versionId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5 text-[13px]">
                        <span className="min-w-0">
                          <span className="font-medium text-ink">{x.name}</span>
                          <span className="text-ink-mute">
                            {" "}
                            · {monthLabel(h.fromMonth!)} itibarıyla <span className="font-semibold text-ink tabular">{salaryLabel(h.netSalary, h.extras)}</span> (önce{" "}
                            {salaryLabel(prev.netSalary, prev.extras)})
                          </span>
                        </span>
                        <Button size="xs" variant="ghost" onClick={() => askUndo(x, h.versionId!)}>
                          <Undo2 size={14} /> Geri al
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!ended.length && !changes.length ? (
                <p className="text-[13px] text-ink-mute">
                  Bir maaşı &quot;bu aydan itibaren&quot; değiştirdiğinizde ya da birini durdurduğunuzda önceki aylar eski hâliyle kalır; kayıtları burada görürsünüz.
                </p>
              ) : null}
            </div>
          </Disclosure>
        </div>

        {/* SGK oranları: nadiren değişir, kapalı gelir. Bütün aylar için geçerlidir (Excel'deki Personel sayfası gibi). */}
        <div ref={ratesRef} id={RATES_ANCHOR} className="scroll-mt-20 border-t border-line">
          <button
            type="button"
            aria-expanded={ratesOpen}
            aria-controls={ratesId}
            onClick={() => setRatesOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3.5 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">SGK oranları</span>
              <span className="block text-[13px] text-ink-mute tabular">
                {rateSummary}
                {ratesDirty ? <span className="ml-1.5 font-medium text-warn">· kaydedilmedi</span> : null}
              </span>
            </span>
            <span className={buttonClass("secondary", "sm", "pointer-events-none")}>
              {ratesOpen ? "Gizle" : "Düzenle"}
              <motion.span
                className="inline-flex"
                initial={false}
                animate={{ rotate: ratesOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_PRESS}
                aria-hidden="true"
              >
                <ChevronDown size={16} />
              </motion.span>
            </span>
          </button>
          <motion.div
            id={ratesId}
            initial={false}
            animate={{ gridTemplateRows: ratesOpen ? "1fr" : "0fr", opacity: ratesOpen ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.34, ease: EASE_OUT }}
            className="grid"
            inert={!ratesOpen}
          >
            <div className="min-h-0 overflow-hidden">
              <form
                noValidate
                className="px-5 pb-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!ratesBusy && ratesDirty) void saveRates();
                }}
              >
                <Well className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {RATE_FIELDS.map((fd) => {
                    const v = check.values[fd.key];
                    const err = check.errors[fd.key];
                    const warn = check.warnings[fd.key];
                    return (
                      <Field
                        key={fd.key}
                        label={fd.label}
                        htmlFor={`rate-${fd.key}`}
                        error={err}
                        hint={
                          <>
                            {/* Yazılanın nasıl okunduğu: "= %15,75" (yanlış girilen değer hemen görünsün) */}
                            {v !== null ? <span className="font-medium text-ink-soft tabular">= {pct(v, 2)}</span> : null}
                            {warn ? <span className="block font-medium text-warn">{warn}</span> : fd.hint ? <span className="block">{fd.hint}</span> : null}
                          </>
                        }
                      >
                        <NumberInput
                          id={`rate-${fd.key}`}
                          value={r[fd.key]}
                          onChange={(e) => setR({ ...r, [fd.key]: e.target.value })}
                          aria-invalid={err ? true : undefined}
                          data-warn={warn ? true : undefined}
                          className="cell-input"
                        />
                      </Field>
                    );
                  })}
                </Well>
                {check.formError ? (
                  <Notice tone="bad" size="line" className="mt-2.5" title={check.formError} />
                ) : null}
                <p className="mt-2.5 text-xs leading-5 text-ink-mute">
                  Yüzde olarak yazın: 14 ya da %14. Teşvikten yararlanmıyorsanız işveren SGK primini 20,75 yazın. Oranlar bütün aylar için geçerlidir
                  {closed.length ? `: ${spanText(closed)} personel SGK tutarı da yeniden hesaplanır` : ""} (Excel&apos;deki Personel sayfası gibi).
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                  {ratesDirty ? (
                    <Button variant="ghost" onClick={discardRates} disabled={ratesBusy}>
                      <RotateCcw size={16} /> Vazgeç
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={ratesBusy || !ratesDirty} className="max-sm:flex-1">
                    <Save size={16} /> {ratesBusy ? "Kaydediliyor…" : "Oranları kaydet"}
                  </Button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>

        <CardFooter>
          <span className="text-[13px] text-ink-mute">
            Personel toplamı Sabit giderler&apos;de &quot;Personel&quot; satırı olarak ve Gelir-gider&apos;de personel maaş + SGK satırlarında görünür.
          </span>
        </CardFooter>
      </Card>

      {editing ? (
        <StaffDialog
          row={editing === "new" ? null : editing}
          staff={staff}
          settings={st}
          currentMonth={currentMonth}
          closed={closed}
          months={months}
          unchanged={unchanged}
          onClose={() => setEditing(null)}
          onSaved={setFlash}
          onDelete={setDeleting}
          onStop={(x) => {
            setEditing(null);
            setStopping(x);
          }}
          onResume={(x) => {
            setEditing(null);
            setResuming(x);
          }}
          onUnstop={(x) => {
            setEditing(null);
            void unstop(x);
          }}
          onUndo={(x, versionId) => {
            setEditing(null);
            askUndo(x, versionId);
          }}
        />
      ) : null}
      {stopping ? (
        <StopDialog
          open
          onClose={() => setStopping(null)}
          name={stopping.name}
          what="personel"
          range={stopping}
          currentMonth={currentMonth}
          closed={closed}
          months={months}
          deleteBlocker={stopping.deleteBlocker}
          onConfirm={(last) => stop(stopping, last)}
        />
      ) : null}
      {resuming && resuming.endMonth ? (
        <ResumeDialog
          open
          onClose={() => setResuming(null)}
          name={resuming.name}
          what="personel"
          endMonth={resuming.endMonth}
          currentMonth={currentMonth}
          onConfirm={(from, mode) => resume(resuming, from, mode)}
        />
      ) : null}
      <ConfirmDialog
        open={undoing !== null}
        onClose={() => setUndoing(null)}
        onConfirm={() => void confirmUndo()}
        pending={pending}
        tone="primary"
        title="Maaş değişikliğini geri al"
        confirmLabel="Geri al"
        description={
          undoing ? (
            <>
              <strong className="font-semibold text-ink">{undoing.row.name}</strong>: {monthLabel(undoing.fromMonth)} itibarıyla {undoing.label} değişikliği silinir;
              o aydan itibaren {undoing.back} geçerli olur.
              {(() => {
                const hit = undoing.fromMonth < currentMonth ? closed.filter((m) => m >= undoing.fromMonth) : [];
                return hit.length ? <span className="mt-2 block font-medium text-warn">Kapanmış {spanText(hit)} kâr/zararı da değişir.</span> : null;
              })()}
            </>
          ) : null
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={pending}
        title="Personeli sil"
        confirmLabel="Personeli sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> kalıcı olarak silinecek ve maaş geçmişi de gider. Hiçbir kapanmış ayın maaş
              hesabına girmediği için geçmiş aylar değişmez. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </div>
  );
}

function StaffDialog({
  row,
  staff,
  settings,
  currentMonth,
  closed,
  months,
  unchanged,
  onClose,
  onSaved,
  onDelete,
  onStop,
  onResume,
  onUnstop,
  onUndo,
}: {
  row: StaffRow | null;
  staff: StaffRow[];
  /** Hesapta kullanılan oranlar (yazılan geçerli oranlar ya da kayıtlı oranlar) */
  settings: Settings;
  currentMonth: string;
  closed: string[];
  months: string[];
  /** Diğer kişiler olduğu gibi (sıra korunsun) */
  unchanged: (except?: number) => { id: number; name: string; netSalary: number; extras: number; effectiveFrom: string }[];
  onClose: () => void;
  onSaved: (id: number) => void;
  onDelete: (row: StaffRow) => void;
  onStop: (row: StaffRow) => void;
  onResume: (row: StaffRow) => void;
  onUnstop: (row: StaffRow) => void;
  onUndo: (row: StaffRow, versionId: number) => void;
}) {
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const netRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [name, setName] = useState(row?.name ?? "");
  const [net, setNet] = useState(row ? num(row.netSalary, 2) : "");
  const [ext, setExt] = useState(row ? num(row.extras, 2) : "");
  const [choice, setChoice] = useState<MonthChoice>(() =>
    row?.status === "ended" ? { mode: "month", month: row.valueMonth } : { mode: "current", month: row?.status === "upcoming" ? row.valueMonth : currentMonth },
  );
  const netValue = parseOrZero(net);
  const extValue = parseOrZero(ext);
  const nameError = tried && !name.trim() ? "Adını yazın" : null;
  const netError = invalidAmount(net) ? "Tutarı sayı olarak yazın, ör. 28.500" : null;
  const extError = invalidAmount(ext) ? "Tutarı sayı olarak yazın, ör. 2.000" : null;
  const valid = netValue !== null && extValue !== null;
  const changed = !!row && valid && (Math.abs(netValue - row.netSalary) > 1e-9 || Math.abs(extValue - row.extras) > 1e-9);
  const eff = choiceValue(choice, currentMonth);

  const cost = staffCost({ id: row?.id ?? 0, name, netSalary: netValue ?? 0, extras: extValue ?? 0, active: true }, settings);
  const before = row ? staffCost({ id: row.id, name: row.name, netSalary: row.netSalary, extras: row.extras, active: true }, settings) : null;

  const effect: EffectText | null = !row
    ? startText({ choice: eff, currentMonth, closed, what: "personel" })
    : changed && valid
      ? (() => {
          const from = eff === "all" ? currentMonth : eff;
          const prev = entryAt(row.history, shiftMonth(from, -1)).entry ?? row.history[0];
          return amountChangeText({
            choice: eff,
            currentMonth,
            closed,
            range: row,
            before: prev ? salaryLabel(prev.netSalary, prev.extras) : salaryLabel(row.netSalary, row.extras),
            after: salaryLabel(netValue, extValue),
            versions: row.history.filter((h) => h.versionId !== null).map((h) => ({ fromMonth: h.fromMonth!, label: salaryLabel(h.netSalary, h.extras) })),
          });
        })()
      : null;

  async function save() {
    setTried(true);
    if (!name.trim()) return nameRef.current?.focus();
    if (netValue === null || extValue === null || netError || extError) return netRef.current?.focus();
    setBusy(true);
    const self = { id: row?.id ?? null, name, netSalary: netValue, extras: extValue, effectiveFrom: !row || changed ? eff : row.valueMonth };
    // Liste sırası korunur: düzenlenen kişi yerinde, yeni kişi sonda
    const list = row ? unchanged().map((x) => (x.id === row.id ? { ...self, id: row.id } : x)) : [...unchanged(), self];
    // Yeni kişide yanıt yolda kaybolursa kişi yazılmış olabilir: ikinci "Kaydet" aynı kişiyi iki kez ekler
    const res = await tryAction(() => saveStaff(list), { maybeSaved: !row });
    setBusy(false);
    // Atılan eylem (E-51): bildirim çıktı, pencere ve yazılanlar yerinde
    if (!res) return;
    if (!res.ok) return toast.error(res.error);
    const id = row?.id ?? res.data.changes.find((c) => !staff.some((s) => s.id === c.id))?.id;
    if (id) onSaved(id);
    toast.success(row ? `${name.trim()} güncellendi` : `${name.trim()} eklendi`, {
      description: res.data.message ?? `Aylık işveren maliyeti ${tl(cost.total)}`,
    });
    onClose();
  }

  const activeIdx = row ? row.history.indexOf(entryAt(row.history, row.valueMonth).entry ?? row.history[0]) : 0;
  const diff = before ? cost.total - before.total : 0;
  /** Durdur / devam ettir / sil: masaüstünde altbilgide, telefonda formun sonunda */
  const secondary =
    row ? (
      <>
        {row.status === "ended" ? (
          <Button variant="ghost" onClick={() => onResume(row)} disabled={busy}>
            <CirclePlay size={16} /> Devam ettir
          </Button>
        ) : row.status === "active" && row.endMonth ? (
          <Button variant="ghost" onClick={() => onUnstop(row)} disabled={busy}>
            <CirclePlay size={16} /> Durdurmayı kaldır
          </Button>
        ) : row.status === "active" ? (
          <Button variant="ghost" onClick={() => onStop(row)} disabled={busy}>
            <CirclePause size={16} /> Durdur
          </Button>
        ) : null}
        {!row.deleteBlocker ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Personeli düzenle" : "Personel ekle"}
      description={row ? undefined : "Net maaşı yazın; brüt ve işveren maliyeti hemen hesaplanır."}
      footerStart={secondary}
      footerStartOnPhone="body"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3 pb-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Ad soyad" htmlFor="st-n" error={nameError}>
          <Input
            ref={nameRef}
            id="st-n"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ör. Ayşe Yılmaz"
            aria-invalid={nameError ? true : undefined}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="next"
            data-autofocus={row ? undefined : true}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Net maaş (₺)" htmlFor="st-net" error={netError}>
            <NumberInput
              ref={netRef}
              id="st-net"
              value={net}
              onChange={(e) => setNet(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              enterKeyHint="next"
              placeholder="0"
              aria-invalid={netError ? true : undefined}
              className="cell-input pointer-coarse:h-12 pointer-coarse:text-lg"
            />
          </Field>
          <Field label="Yemek / yol / prim (₺)" htmlFor="st-ext" error={extError} tip="Varsa yemek kartı, yol parası, prim gibi aylık ek ödemeler.">
            <NumberInput
              id="st-ext"
              value={ext}
              onChange={(e) => setExt(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="0"
              aria-invalid={extError ? true : undefined}
              className="cell-input pointer-coarse:h-12 pointer-coarse:text-lg"
            />
          </Field>
        </div>
        {row && !changed ? <p className="-mt-1 text-xs text-ink-mute">{monthLabel(row.valueMonth)} maaşı. Değiştirirseniz hangi aydan itibaren geçerli olacağı sorulur.</p> : null}

        {/* Canlı hesap: yazdıkça brüt, kesintiler ve işveren maliyeti (tablodaki bütün tutarlar) */}
        {/* Telefonda alt alta satırlar (etiket solda, tutar sağda), genişte iki sütun */}
        <Well className="grid grid-cols-1 gap-3 p-3 text-[13px] max-sm:gap-0 max-sm:divide-y max-sm:divide-line max-sm:py-1 sm:grid-cols-2">
          <div className="min-w-0 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-2">
            <p className="text-ink-mute">Tahmini brüt</p>
            <p className="font-semibold text-ink tabular">{tl(cost.gross)}</p>
          </div>
          <div className="min-w-0 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-2">
            <p className="text-ink-mute">İşçi kesintileri</p>
            <p className="font-semibold text-ink tabular">{tl(cost.deductions)}</p>
          </div>
          <div className="min-w-0 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-2">
            <p className="text-ink-mute">İşveren SGK + işsizlik</p>
            <p className="font-semibold text-ink tabular max-sm:text-right">
              {tl(cost.employerSgk + cost.employerUnemployment)}
              <span className="block text-xs font-normal text-ink-mute">
                SGK {tl(cost.employerSgk)} + işsizlik {tl(cost.employerUnemployment)}
              </span>
            </p>
          </div>
          <div className="min-w-0 max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:py-2">
            <p className="text-ink-mute">İşveren maliyeti</p>
            <p className="font-semibold text-ink tabular max-sm:text-right">
              {tl(cost.total)}
              {changed && Math.abs(diff) >= 1 ? (
                <span className={cn("ml-1 block text-xs font-medium sm:inline", diff > 0 ? "text-bad" : "text-good")}>
                  ({diff > 0 ? "+" : "−"}
                  {tl(Math.abs(diff))})
                </span>
              ) : null}
            </p>
          </div>
        </Well>

        {!row || changed ? (
          <MonthChoiceField
            legend={row ? "Yeni maaş hangi aydan itibaren?" : "Hangi aydan itibaren maaş hesabına girsin?"}
            tip="Excel'deki gibi her ay kendi tutarını taşır: seçtiğiniz aydan önceki aylar değişmez."
            value={choice}
            onChange={setChoice}
            currentMonth={currentMonth}
            months={months}
            allLabel={row ? "Bütün aylar (geçmiş de değişir)" : "Baştan beri (geçmiş aylara da eklenir)"}
            allHint={row ? "Yanlış girilmiş bir maaşı düzeltmek için." : "Kişi hep çalışıyordu ama panele yeni giriliyorsa."}
            effect={effect}
          />
        ) : null}

        {row ? (
          <Disclosure
            title="Geçmiş"
            summary={`${rangeText(row)} · ${row.history.length > 1 ? `${row.history.length - 1} maaş değişikliği` : "maaş değişikliği yok"}`}
            tile
          >
            <div className="space-y-2.5 pt-0.5">
              <HistoryList
                rows={row.history.map((h) => ({ fromMonth: h.fromMonth, versionId: h.versionId, label: salaryLabel(h.netSalary, h.extras) }))}
                startMonth={row.startMonth}
                activeIndex={activeIdx}
                onUndo={(h) => h.versionId && onUndo(row, h.versionId)}
                disabled={busy}
              />
              <EffectNote
                effect={{
                  text: `${row.endMonth ? `Son ay: ${monthLabel(row.endMonth)}. ` : ""}${
                    row.deleteBlocker
                      ? `Silinemez: ${row.deleteBlocker}. Ayrıldıysa durdurun; geçmiş aylarda kalır.`
                      : "Hiçbir kapanmış ayın maaş hesabına girmediği için silinebilir."
                  }`,
                  warn: null,
                }}
              />
            </div>
          </Disclosure>
        ) : null}
      </form>
    </Dialog>
  );
}

