"use client";

import { ChevronDown, Plus, RotateCcw, Save, SearchX, Trash2, Users, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT, SPRING_PRESS } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { clearQuery, FilterBar, matches, SearchField, useQueryState, useQueryText } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { staffCost } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveStaff, saveStaffRates } from "@/server/actions/costs";

import { CountUp, HeadIcon, ShareBreakdown } from "../giderler/expenses-client";

type Rates = { isciSgk: number; isciIssizlik: number; isverenSgk: number; isverenIssizlik: number };
type StaffIn = { id: number; name: string; netSalary: number; extras: number; active: boolean };
type Durum = "tumu" | "aktif" | "pasif";

const toRows = (staff: StaffIn[]) => staff.map((x) => ({ ...x, net: num(x.netSalary, 2), ext: num(x.extras, 2) }));
const staffKey = (staff: StaffIn[]) => staff.map((x) => `${x.id}:${x.name}:${x.netSalary}:${x.extras}:${x.active ? 1 : 0}`).join("|");
const toRateText = (rates: Rates) => ({
  isciSgk: num(rates.isciSgk * 100, 2),
  isciIssizlik: num(rates.isciIssizlik * 100, 2),
  isverenSgk: num(rates.isverenSgk * 100, 2),
  isverenIssizlik: num(rates.isverenIssizlik * 100, 2),
});

const RATE_FIELDS: { key: keyof Rates; label: string; hint?: string }[] = [
  { key: "isciSgk", label: "İşçi SGK primi (%)", hint: "Brütten kesilir" },
  { key: "isciIssizlik", label: "İşçi işsizlik (%)" },
  { key: "isverenSgk", label: "İşveren SGK (%)", hint: "5 puan teşvikli: %15,75" },
  { key: "isverenIssizlik", label: "İşveren işsizlik (%)" },
];

/** Boş alan 0 sayılır; yazılmış ama sayı olmayan metin geçersizdir */
const parseOrZero = (text: string) => (text.trim() === "" ? 0 : parseNumberTR(text));
const invalidAmount = (text: string) => {
  const v = parseOrZero(text);
  return v === null || v < 0;
};

/** Değişiklik karşılaştırması için imzalar (metin değil sayı: biçim farkı değişiklik sayılmaz) */
const rowsSig = (list: { id: number; name: string; net: string; ext: string; active: boolean }[]) =>
  list.map((x) => `${x.id}:${x.name}:${parseOrZero(x.net)}:${parseOrZero(x.ext)}:${x.active ? 1 : 0}`).join("|");
const ratesSig = (t: Record<keyof Rates, string>) => RATE_FIELDS.map((f) => parseNumberTR(t[f.key])).join("|");

/** Telefonda dokunma alanı en az 40px */
const TOUCH_INPUT = "pointer-coarse:h-10";
/** Alana klavyeyle (Tab) gelindiğinde altta yüzen kaydetme çubuğunun altında kalmasın */
const CLEAR_BAR = "scroll-mb-28";
/** Uzun sütun başlıkları iki satıra sarılır, alta hizalanır: tablo 1400px ekranda yatay kaydırmasız sığar */
const WRAP_HEAD = "align-bottom leading-5 whitespace-normal";

export function StaffEditor({
  staff,
  rates,
  settings,
}: {
  staff: StaffIn[];
  rates: Rates;
  settings: Settings;
}) {
  const reduce = useCalmMotion();
  const ratesId = useId();
  const [ratesOpen, setRatesOpen] = useState(false);
  const [r, setR] = useState(() => toRateText(rates));
  const [rows, setRows] = useState(() => toRows(staff));
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  /** Kaydet'e basıldıktan sonra boş adlar kırmızı görünür */
  const [tried, setTried] = useState(false);

  const [q, setQ] = useQueryText("ara");
  const [durum, setDurum] = useQueryState<Durum>("durum", "tumu");
  const filtered = q.trim() !== "" || durum !== "tumu";
  const clearFilters = () => {
    setQ("");
    clearQuery(["ara", "durum"]);
  };

  // Kayıttan sonra sunucudaki liste değişince (ör. yeni personelin gerçek kimliği) satırlar ondan yeniden kurulur;
  // böylece ikinci kayıtta aynı kişi tekrar eklenmez. Bileşen yeniden kurulmadığı için oranlar, açık bölüm ve
  // sayaç animasyonu yerinde kalır.
  const serverKey = staffKey(staff);
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (syncedKey !== serverKey) {
    setSyncedKey(serverKey);
    setRows(toRows(staff));
    setRemoved([]);
  }

  // Kaydedilmemiş değişiklik: sunucudaki listeyle karşılaştırılır (değerler sayı olarak; "30000" ile "30.000" aynı).
  // Böylece "Geri al" ya da aynı değeri yeniden yazmak çubuğu kendiliğinden kapatır.
  const dirty = removed.length > 0 || rowsSig(rows) !== rowsSig(toRows(staff)) || ratesSig(r) !== ratesSig(toRateText(rates));

  // Kaydedilmemiş değişiklik varken sekmeyi kapatmadan / yenilemeden önce tarayıcı sorsun
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const rateNum = (k: keyof typeof r) => (parseNumberTR(r[k]) ?? 0) / 100;
  const st: Settings = { ...settings, isciSgk: rateNum("isciSgk"), isciIssizlik: rateNum("isciIssizlik"), isverenSgk: rateNum("isverenSgk"), isverenIssizlik: rateNum("isverenIssizlik") };
  const calcs = rows.map((x) =>
    staffCost({ id: x.id, name: x.name, netSalary: parseOrZero(x.net) ?? 0, extras: parseOrZero(x.ext) ?? 0, active: x.active }, st),
  );
  const calcOf = new Map(rows.map((x, i) => [x.id, calcs[i]]));
  const activeCalcs = calcs.filter((_, i) => rows[i].active);
  const total = (f: (c: (typeof calcs)[number]) => number) => activeCalcs.reduce((a, c) => a + f(c), 0);
  const sums = {
    net: activeCalcs.reduce((a, c) => a + c.staff.netSalary, 0),
    gross: total((c) => c.gross),
    deductions: total((c) => c.deductions),
    employerSgk: total((c) => c.employerSgk),
    employerUnemployment: total((c) => c.employerUnemployment),
    extras: activeCalcs.reduce((a, c) => a + c.staff.extras, 0),
    total: total((c) => c.total),
  };
  const activeCount = activeCalcs.length;
  const inactiveCount = rows.length - activeCount;
  const visible = rows.filter((x) => (durum === "tumu" || x.active === (durum === "aktif")) && matches(x.name, q));

  // Kaydetmeden önce denetim: boş ad, sayı olmayan tutar ya da oran
  const rateInvalid = (k: keyof Rates) => {
    const v = parseNumberTR(r[k]);
    return v === null || v < 0 || v >= 100;
  };
  const badName = (x: (typeof rows)[number]) => tried && !x.name.trim();
  const problems = [
    rows.some((x) => !x.name.trim()) ? "Her personelin adını yazın" : null,
    rows.some((x) => invalidAmount(x.net) || invalidAmount(x.ext)) ? "Tutarları sayı olarak yazın, ör. 28.500" : null,
    RATE_FIELDS.some((f) => rateInvalid(f.key)) ? "SGK oranlarını 0–100 arası yazın" : null,
  ].filter(Boolean) as string[];

  type Row = (typeof rows)[number];
  function updateRow(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((y) => (y.id === id ? { ...y, ...patch } : y)));
  }

  // Yeni eklenen satırın ad kutusu, satır çizildikten sonra odaklanır ve seçili gelir (yazınca yerine geçer).
  // Görünen kopya seçilir: tablo ve telefon listesi aynı anda çizilir, biri CSS ile gizlidir.
  const focusId = useRef<number | null>(null);
  useEffect(() => {
    const id = focusId.current;
    if (id === null) return;
    const el = [...document.querySelectorAll<HTMLInputElement>(`input[data-staff-name="${id}"]`)].find((e) => e.offsetParent !== null);
    // Süzgeç henüz kalkmadıysa satır bir sonraki çizimde gelir
    if (!el) return;
    focusId.current = null;
    el.focus();
    el.select();
    // Ortaya: kaydedilmemiş değişiklik çubuğu (altta yüzer) yeni satırın üstüne binmesin
    el.scrollIntoView({ block: "center" });
  }, [rows, q, durum]);

  function addRow() {
    const id = -Date.now();
    setRows((x) => [...x, { id, name: `Personel ${x.length + 1}`, netSalary: 0, extras: 0, active: true, net: "", ext: "" }]);
    focusId.current = id;
    // Yeni satır süzgece takılmasın
    if (filtered) clearFilters();
  }
  function removeRow(row: Row) {
    const index = rows.findIndex((y) => y.id === row.id);
    if (row.id > 0) setRemoved((r2) => [...r2, row.id]);
    setRows((rs) => rs.filter((y) => y.id !== row.id));
    toast(`${row.name || "Personel"} listeden çıkarıldı`, {
      description: row.id > 0 ? "Kaydet'e basınca kalıcı olarak silinir." : undefined,
      action: {
        label: "Geri al",
        onClick: () => {
          setRows((rs) => (rs.some((y) => y.id === row.id) ? rs : [...rs.slice(0, index), row, ...rs.slice(index)]));
          setRemoved((r2) => r2.filter((id) => id !== row.id));
        },
      },
    });
  }
  function discard() {
    setRows(toRows(staff));
    setRemoved([]);
    setR(toRateText(rates));
    setTried(false);
    toast("Değişiklikler geri alındı");
  }

  async function save() {
    setTried(true);
    if (problems.length) {
      toast.error(problems[0]);
      if (RATE_FIELDS.some((f) => rateInvalid(f.key))) setRatesOpen(true);
      return;
    }
    setBusy(true);
    const a = await saveStaffRates({ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik });
    const b = await saveStaff(
      rows.map((x) => ({ id: x.id > 0 ? x.id : null, name: x.name, netSalary: parseOrZero(x.net) ?? 0, extras: parseOrZero(x.ext) ?? 0, active: x.active })),
      removed,
    );
    setBusy(false);
    if (!a.ok) return toast.error(a.error);
    if (!b.ok) return toast.error(b.error);
    setRemoved([]);
    setTried(false);
    toast.success("Personel bilgileri kaydedildi", { description: `Aylık işveren maliyeti ${tl(sums.total)}` });
  }

  const rateSummary = `İşçi ${pct(st.isciSgk, 2)} + ${pct(st.isciIssizlik, 2)} · İşveren ${pct(st.isverenSgk, 2)} + ${pct(st.isverenIssizlik, 2)}`;
  const saveLabel = busy ? "Kaydediliyor…" : "Kaydet";
  const addButton = (
    <Button size="sm" variant="secondary" onClick={addRow} className={TOUCH_INPUT}>
      <Plus size={16} /> Personel ekle
    </Button>
  );

  return (
    <div className={cn("space-y-6", dirty && "pb-24")}>
      {/* Asıl cevap: aylık işveren maliyeti ve nereye gittiği */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <HeadIcon>
                <Wallet />
              </HeadIcon>
              <h2 className="text-base font-semibold tracking-tight text-ink">Toplam işveren maliyeti</h2>
              <InfoTip text="Sabit giderler ve Gelir-gider tablosuna otomatik gider olarak geçer." />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">
              <CountUp value={sums.total} />
            </p>
            <p className="mt-1 text-[13px] text-ink-mute">
              {activeCount} aktif personel · aylık{dirty ? " · kaydedilmemiş değişikliklerle" : ""}
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

      {/* Form: herhangi bir alanda Enter kaydeder */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <Card>
          <CardHeader
            icon={<Users />}
            title="Personel maliyeti"
            description={
              <>
                Net maaşı yazın; brüt ve işveren maliyeti hemen hesaplanır. Brüt = net ÷ (1 − işçi SGK − işçi işsizlik).{" "}
                <InfoTip text="Asgari ücret istisnası nedeniyle kaba bir tahmindir." />
              </>
            }
            meta={
              <>
                <span>Aktif · {activeCount}</span>
                {inactiveCount ? <span className="text-ink-quiet">· Pasif · {inactiveCount}</span> : null}
              </>
            }
            actions={addButton}
          />

          {rows.length ? (
            <div className="px-5 pb-3">
              <FilterBar active={filtered} onClear={clearFilters} shown={visible.length} total={rows.length} unit="kişi">
                <SearchField value={q} onChange={setQ} placeholder="Personel ara" className="w-full sm:w-56" />
                <Segmented<Durum>
                  label="Durum"
                  value={durum}
                  onChange={setDurum}
                  options={[
                    { value: "tumu", label: "Tümü" },
                    { value: "aktif", label: "Aktif", count: activeCount },
                    { value: "pasif", label: "Pasif", count: inactiveCount },
                  ]}
                />
              </FilterBar>
            </div>
          ) : null}

          {!rows.length ? (
            <EmptyState
              icon={<Users />}
              title="Personel yok"
              description="Personel ekleyip net maaşı yazın; brüt ve işveren maliyeti otomatik hesaplanır, Sabit giderler ve Gelir-gider tablosuna geçer."
              action={addButton}
            />
          ) : !visible.length ? (
            <EmptyState
              icon={<SearchX />}
              title="Bu süzgece uyan personel yok"
              description="Aramayı kısaltın ya da durum seçimini kaldırın."
              action={
                <Button size="sm" variant="secondary" onClick={clearFilters} className={TOUCH_INPUT}>
                  Süzgeci temizle
                </Button>
              }
            />
          ) : (
            <>
              {/* Masaüstü / tablet: tablo (ilk sütun yatay kaydırmada sabit) */}
              <TableWrap className="max-sm:hidden">
                <Table>
                  <THead>
                    <tr>
                      <TH sticky className="align-bottom">
                        Personel
                      </TH>
                      <TH numeric className={WRAP_HEAD}>
                        Net maaş (₺)
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
                          <span>Yemek / yol / prim (₺)</span>
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
                      const c = calcOf.get(x.id)!;
                      const dim = !x.active && "opacity-50";
                      return (
                        <TR key={x.id}>
                          <TD sticky>
                            <div className="flex items-center gap-2.5">
                              <Avatar name={x.name || "Personel"} className={cn(dim)} />
                              <Input
                                value={x.name}
                                data-staff-name={x.id}
                                onChange={(e) => updateRow(x.id, { name: e.target.value })}
                                aria-label="Personel adı"
                                aria-invalid={badName(x) || undefined}
                                placeholder="Ad soyad"
                                maxLength={80}
                                className={cn("min-w-32", CLEAR_BAR, dim)}
                              />
                            </div>
                          </TD>
                          <TD numeric>
                            <NumberInput
                              value={x.net}
                              onChange={(e) => updateRow(x.id, { net: e.target.value })}
                              aria-label={`${x.name} net maaş`}
                              aria-invalid={invalidAmount(x.net) || undefined}
                              placeholder="0"
                              className={cn("cell-input w-24", CLEAR_BAR)}
                            />
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
                          <TD numeric>
                            <NumberInput
                              value={x.ext}
                              onChange={(e) => updateRow(x.id, { ext: e.target.value })}
                              aria-label={`${x.name} yemek / yol / prim`}
                              aria-invalid={invalidAmount(x.ext) || undefined}
                              placeholder="0"
                              className={cn("cell-input w-24", CLEAR_BAR)}
                            />
                          </TD>
                          <TD numeric className={cn("font-semibold", dim)}>
                            {tl(c.total)}
                          </TD>
                          <TD>
                            <Switch checked={x.active} label={`${x.name || "Personel"} aktif`} onChange={(v) => updateRow(x.id, { active: v })} showText />
                          </TD>
                          <TD>
                            <div className="flex justify-end">
                              <IconButton label={`${x.name || "Personel"}: listeden çıkar`} tone="danger" onClick={() => removeRow(x)}>
                                <Trash2 size={15} />
                              </IconButton>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <TFootRow>
                      <TD sticky>Toplam (aktif)</TD>
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
                      <TD colSpan={2} />
                    </TFootRow>
                  </tfoot>
                </Table>
              </TableWrap>

              {/* Telefon: her kişi bir kart; girilen alanlar üstte, hesaplananlar altta */}
              <ul className="divide-y divide-line border-t border-line sm:hidden">
                {visible.map((x) => {
                  const c = calcOf.get(x.id)!;
                  return (
                    <li key={x.id} className="space-y-3 px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={x.name || "Personel"} className={cn(!x.active && "opacity-50")} />
                        <Input
                          value={x.name}
                          data-staff-name={x.id}
                          onChange={(e) => updateRow(x.id, { name: e.target.value })}
                          aria-label="Personel adı"
                          aria-invalid={badName(x) || undefined}
                          placeholder="Ad soyad"
                          maxLength={80}
                          className={cn("min-w-0 flex-1", TOUCH_INPUT, CLEAR_BAR)}
                        />
                        <IconButton label={`${x.name || "Personel"}: listeden çıkar`} tone="danger" onClick={() => removeRow(x)} className="pointer-coarse:size-10">
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Net maaş (₺)">
                          <NumberInput
                            value={x.net}
                            onChange={(e) => updateRow(x.id, { net: e.target.value })}
                            aria-label={`${x.name} net maaş`}
                            aria-invalid={invalidAmount(x.net) || undefined}
                            placeholder="0"
                            className={cn("cell-input", TOUCH_INPUT, CLEAR_BAR)}
                          />
                        </Field>
                        <Field label="Yemek / yol / prim (₺)">
                          <NumberInput
                            value={x.ext}
                            onChange={(e) => updateRow(x.id, { ext: e.target.value })}
                            aria-label={`${x.name} yemek / yol / prim`}
                            aria-invalid={invalidAmount(x.ext) || undefined}
                            placeholder="0"
                            className={cn("cell-input", TOUCH_INPUT, CLEAR_BAR)}
                          />
                        </Field>
                      </div>
                      <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]", !x.active && "opacity-50")}>
                        <dt className="text-ink-mute">Tahmini brüt</dt>
                        <dd className="text-right text-ink tabular">{tl(c.gross)}</dd>
                        <dt className="text-ink-mute">İşveren SGK + işsizlik</dt>
                        <dd className="text-right text-ink tabular">{tl(c.employerSgk + c.employerUnemployment)}</dd>
                        <dt className="font-semibold text-ink">İşveren maliyeti</dt>
                        <dd className="text-right font-semibold text-ink tabular">{tl(c.total)}</dd>
                      </dl>
                      <Switch
                        checked={x.active}
                        label={`${x.name || "Personel"} aktif`}
                        onChange={(v) => updateRow(x.id, { active: v })}
                        showText
                        onText="Aktif (maliyete dahil)"
                        offText="Pasif (maliyete dahil değil)"
                        className="pointer-coarse:h-10"
                      />
                    </li>
                  );
                })}
                <li className="flex items-baseline justify-between gap-3 px-5 py-3.5 font-semibold text-ink">
                  <span>Toplam (aktif)</span>
                  <span className="tabular">{tl(sums.total)}</span>
                </li>
              </ul>
            </>
          )}

          <div className="border-t border-line">
            <button
              type="button"
              aria-expanded={ratesOpen}
              aria-controls={ratesId}
              onClick={() => setRatesOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3.5 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">SGK oranları</span>
                <span className="block text-[13px] text-ink-mute tabular">{rateSummary}</span>
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
                <div className="px-5 pb-5">
                  <Well className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {RATE_FIELDS.map((fd) => (
                      <Field key={fd.key} label={fd.label} htmlFor={`rate-${fd.key}`} hint={fd.hint} error={rateInvalid(fd.key) ? "0–100 arası yazın" : null}>
                        <NumberInput
                          id={`rate-${fd.key}`}
                          value={r[fd.key]}
                          onChange={(e) => {
                            setR({ ...r, [fd.key]: e.target.value });
                          }}
                          aria-invalid={rateInvalid(fd.key) || undefined}
                          className={cn("cell-input", TOUCH_INPUT)}
                        />
                      </Field>
                    ))}
                  </Well>
                  <p className="mt-2.5 text-xs text-ink-mute">Teşvikten yararlanmıyorsanız işveren SGK primini %20,75 yazın.</p>
                </div>
              </div>
            </motion.div>
          </div>

          <CardFooter>
            <span className={cn("text-[13px]", dirty ? "font-medium text-warn" : "text-ink-mute")}>
              {dirty ? "Kaydedilmemiş değişiklikler var" : "Personel ve oranlar birlikte kaydedilir. Alanlarda Enter da kaydeder."}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <Button variant="ghost" onClick={discard} disabled={busy} className={TOUCH_INPUT}>
                  <RotateCcw size={16} /> Vazgeç
                </Button>
              ) : null}
              <Button type="submit" disabled={busy} className={TOUCH_INPUT}>
                <Save size={16} /> {saveLabel}
              </Button>
            </span>
          </CardFooter>
        </Card>
      </form>

      <FloatingBar open={dirty}>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          {/* Telefonda iki düğmenin yanında tek satıra sığsın */}
          <span className="sm:hidden">Kaydedilmedi</span>
          <span className="max-sm:hidden">Kaydedilmemiş değişiklikler var</span>
        </span>
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={discard} disabled={busy} className={TOUCH_INPUT}>
            Vazgeç
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy} className={TOUCH_INPUT}>
            <Save size={16} /> {saveLabel}
          </Button>
        </span>
      </FloatingBar>
    </div>
  );
}
