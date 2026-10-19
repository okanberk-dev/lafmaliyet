"use client";

import { ChevronDown, Plus, Save, Trash2, Users, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { EASE_OUT, SPRING_PRESS } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Button, buttonClass, IconButton } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, Well } from "@/components/ui/card";
import { FloatingBar } from "@/components/ui/floating-bar";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { Avatar } from "@/components/ui/icon-tile";
import { EmptyState, InfoTip } from "@/components/ui/misc";
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

const toRows = (staff: StaffIn[]) => staff.map((x) => ({ ...x, net: num(x.netSalary, 2), ext: num(x.extras, 2) }));
const staffKey = (staff: StaffIn[]) => staff.map((x) => `${x.id}:${x.name}:${x.netSalary}:${x.extras}:${x.active ? 1 : 0}`).join("|");

const RATE_FIELDS: { key: keyof Rates; label: string; hint?: string }[] = [
  { key: "isciSgk", label: "İşçi SGK primi (%)", hint: "Brütten kesilir" },
  { key: "isciIssizlik", label: "İşçi işsizlik (%)" },
  { key: "isverenSgk", label: "İşveren SGK (%)", hint: "5 puan teşvikli: %15,75" },
  { key: "isverenIssizlik", label: "İşveren işsizlik (%)" },
];

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
  const [r, setR] = useState({
    isciSgk: num(rates.isciSgk * 100, 2),
    isciIssizlik: num(rates.isciIssizlik * 100, 2),
    isverenSgk: num(rates.isverenSgk * 100, 2),
    isverenIssizlik: num(rates.isverenIssizlik * 100, 2),
  });
  const [rows, setRows] = useState(() => toRows(staff));
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

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

  const rateNum = (k: keyof typeof r) => (parseNumberTR(r[k]) ?? 0) / 100;
  const st: Settings = { ...settings, isciSgk: rateNum("isciSgk"), isciIssizlik: rateNum("isciIssizlik"), isverenSgk: rateNum("isverenSgk"), isverenIssizlik: rateNum("isverenIssizlik") };
  const calcs = rows.map((x) =>
    staffCost({ id: x.id, name: x.name, netSalary: parseNumberTR(x.net) ?? 0, extras: parseNumberTR(x.ext) ?? 0, active: x.active }, st),
  );
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

  type Row = (typeof rows)[number];
  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((y, j) => (j === i ? { ...y, ...patch } : y)));
    setDirty(true);
  }
  function addRow() {
    setRows((x) => [...x, { id: -Date.now(), name: `Personel ${x.length + 1}`, netSalary: 0, extras: 0, active: true, net: "0", ext: "0" }]);
    setDirty(true);
  }
  function removeRow(i: number, id: number) {
    if (id > 0) setRemoved((r2) => [...r2, id]);
    setRows((rs) => rs.filter((_, j) => j !== i));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    const a = await saveStaffRates({ isciSgk: st.isciSgk, isciIssizlik: st.isciIssizlik, isverenSgk: st.isverenSgk, isverenIssizlik: st.isverenIssizlik });
    const b = await saveStaff(
      rows.map((x) => ({ id: x.id > 0 ? x.id : null, name: x.name, netSalary: parseNumberTR(x.net) ?? 0, extras: parseNumberTR(x.ext) ?? 0, active: x.active })),
      removed,
    );
    setBusy(false);
    if (!a.ok) return toast.error(a.error);
    if (!b.ok) return toast.error(b.error);
    setRemoved([]);
    setDirty(false);
    toast.success("Personel bilgileri kaydedildi");
  }

  const rateSummary = `İşçi ${pct(st.isciSgk, 2)} + ${pct(st.isciIssizlik, 2)} · İşveren ${pct(st.isverenSgk, 2)} + ${pct(st.isverenIssizlik, 2)}`;
  const saveLabel = busy ? "Kaydediliyor…" : "Kaydet";

  return (
    <div className={cn("space-y-6", dirty && "pb-20")}>
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
            <p className="mt-1 text-[13px] text-ink-mute">{activeCount} aktif personel · aylık</p>
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
              Brüt = net ÷ (1 − işçi SGK − işçi işsizlik). <InfoTip text="Asgari ücret istisnası nedeniyle kaba bir tahmindir." />
            </>
          }
          meta={
            <>
              <span>Aktif · {activeCount}</span>
              {inactiveCount ? <span className="text-ink-quiet">· Pasif · {inactiveCount}</span> : null}
            </>
          }
          actions={
            <Button size="sm" variant="secondary" onClick={addRow}>
              <Plus size={16} /> Personel ekle
            </Button>
          }
        />

        {rows.length ? (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <TH sticky>Personel</TH>
                  <TH numeric>Net maaş</TH>
                  <TH numeric>Tahmini brüt</TH>
                  <TH numeric>İşçi kesintileri</TH>
                  <TH numeric>İşveren SGK</TH>
                  <TH numeric>İşveren işsizlik</TH>
                  <TH numeric>
                    <span className="inline-flex items-center gap-1">
                      Yemek / yol / prim <InfoTip text="Varsa yemek kartı, yol parası, prim gibi aylık ek ödemeler." />
                    </span>
                  </TH>
                  <TH numeric>Toplam işveren maliyeti</TH>
                  <TH>Durum</TH>
                  <TH>
                    <span className="sr-only">Eylemler</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {rows.map((x, i) => {
                  const c = calcs[i];
                  const dim = !x.active && "opacity-50";
                  return (
                    <TR key={x.id}>
                      <TD sticky>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={x.name || "Personel"} className={cn("max-sm:hidden", dim)} />
                          <Input
                            value={x.name}
                            onChange={(e) => updateRow(i, { name: e.target.value })}
                            aria-label="Personel adı"
                            className={cn("min-w-32 sm:min-w-36", dim)}
                          />
                        </div>
                      </TD>
                      <TD numeric>
                        <NumberInput value={x.net} onChange={(e) => updateRow(i, { net: e.target.value })} aria-label={`${x.name} net maaş`} className="cell-input w-28" />
                      </TD>
                      <TD numeric className={cn(dim)}>
                        {tl(c.gross)}
                      </TD>
                      <TD numeric className={cn("text-ink-soft", dim)}>
                        {tl(c.deductions)}
                      </TD>
                      <TD numeric className={cn("text-ink-soft", dim)}>
                        {tl(c.employerSgk)}
                      </TD>
                      <TD numeric className={cn("text-ink-soft", dim)}>
                        {tl(c.employerUnemployment)}
                      </TD>
                      <TD numeric>
                        <NumberInput
                          value={x.ext}
                          onChange={(e) => updateRow(i, { ext: e.target.value })}
                          aria-label={`${x.name} yemek / yol / prim`}
                          className="cell-input w-24"
                        />
                      </TD>
                      <TD numeric className={cn("font-semibold", dim)}>
                        {tl(c.total)}
                      </TD>
                      <TD>
                        <Switch checked={x.active} label={`${x.name || "Personel"} aktif`} onChange={(v) => updateRow(i, { active: v })} showText />
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <IconButton label="Kaldır" tone="danger" onClick={() => removeRow(i, x.id)}>
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
                  <TD numeric>{tl(sums.employerSgk)}</TD>
                  <TD numeric>{tl(sums.employerUnemployment)}</TD>
                  <TD numeric>{tl(sums.extras)}</TD>
                  <TD numeric>{tl(sums.total)}</TD>
                  <TD colSpan={2} />
                </TFootRow>
              </tfoot>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState
            icon={<Users />}
            title="Personel yok"
            description="Net maaşı yazın; brüt ve işveren maliyeti otomatik hesaplanır."
            action={
              <Button size="sm" variant="secondary" onClick={addRow}>
                <Plus size={16} /> Personel ekle
              </Button>
            }
          />
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
                    <Field key={fd.key} label={fd.label} htmlFor={`rate-${fd.key}`} hint={fd.hint}>
                      <NumberInput
                        id={`rate-${fd.key}`}
                        value={r[fd.key]}
                        onChange={(e) => {
                          setR({ ...r, [fd.key]: e.target.value });
                          setDirty(true);
                        }}
                        className="cell-input"
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
            {dirty ? "Kaydedilmemiş değişiklikler var" : "Personel ve oranlar birlikte kaydedilir."}
          </span>
          <Button onClick={save} disabled={busy}>
            <Save size={16} /> {saveLabel}
          </Button>
        </CardFooter>
      </Card>

      <FloatingBar open={dirty}>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-ink">
          <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          Kaydedilmemiş değişiklikler var
        </span>
        <Button size="sm" onClick={save} disabled={busy}>
          <Save size={16} /> {saveLabel}
        </Button>
      </FloatingBar>
    </div>
  );
}
