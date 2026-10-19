"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, NumberInput } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { staffCost } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Settings } from "@/lib/calc/types";
import { num, tl } from "@/lib/format";
import { saveStaff, saveStaffRates } from "@/server/actions/costs";

type Rates = { isciSgk: number; isciIssizlik: number; isverenSgk: number; isverenIssizlik: number };

export function StaffEditor({
  staff,
  rates,
  settings,
}: {
  staff: { id: number; name: string; netSalary: number; extras: number; active: boolean }[];
  rates: Rates;
  settings: Settings;
}) {
  const [r, setR] = useState({
    isciSgk: num(rates.isciSgk * 100, 2),
    isciIssizlik: num(rates.isciIssizlik * 100, 2),
    isverenSgk: num(rates.isverenSgk * 100, 2),
    isverenIssizlik: num(rates.isverenIssizlik * 100, 2),
  });
  const [rows, setRows] = useState(staff.map((x) => ({ ...x, net: num(x.netSalary, 2), ext: num(x.extras, 2) })));
  const [removed, setRemoved] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const rateNum = (k: keyof typeof r) => (parseNumberTR(r[k]) ?? 0) / 100;
  const st: Settings = { ...settings, isciSgk: rateNum("isciSgk"), isciIssizlik: rateNum("isciIssizlik"), isverenSgk: rateNum("isverenSgk"), isverenIssizlik: rateNum("isverenIssizlik") };
  const calcs = rows.map((x) =>
    staffCost({ id: x.id, name: x.name, netSalary: parseNumberTR(x.net) ?? 0, extras: parseNumberTR(x.ext) ?? 0, active: x.active }, st),
  );
  const activeCalcs = calcs.filter((_, i) => rows[i].active);
  const total = (f: (c: (typeof calcs)[number]) => number) => activeCalcs.reduce((a, c) => a + f(c), 0);

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
    toast.success("Personel bilgileri kaydedildi");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-12">
      <Card className="xl:col-span-4">
        <CardHeader title="Oranlar" description="Teşvikten yararlanmıyorsanız işveren SGK primini %20,75 yazın." />
        <CardContent className="grid grid-cols-2 gap-3">
          <Field label="İşçi SGK primi (%)" htmlFor="r1" hint="Brütten kesilir">
            <NumberInput id="r1" value={r.isciSgk} onChange={(e) => setR({ ...r, isciSgk: e.target.value })} className="cell-input" />
          </Field>
          <Field label="İşçi işsizlik (%)" htmlFor="r2">
            <NumberInput id="r2" value={r.isciIssizlik} onChange={(e) => setR({ ...r, isciIssizlik: e.target.value })} className="cell-input" />
          </Field>
          <Field label="İşveren SGK (%)" htmlFor="r3" hint="5 puan teşvikli: %15,75">
            <NumberInput id="r3" value={r.isverenSgk} onChange={(e) => setR({ ...r, isverenSgk: e.target.value })} className="cell-input" />
          </Field>
          <Field label="İşveren işsizlik (%)" htmlFor="r4">
            <NumberInput id="r4" value={r.isverenIssizlik} onChange={(e) => setR({ ...r, isverenIssizlik: e.target.value })} className="cell-input" />
          </Field>
        </CardContent>
      </Card>

      <Card className="xl:col-span-8">
        <CardHeader
          title="Personel maliyeti"
          description="Brüt = net ÷ (1 − işçi SGK − işçi işsizlik). Asgari ücret istisnası nedeniyle kaba bir tahmindir."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setRows((x) => [...x, { id: -Date.now(), name: `Personel ${x.length + 1}`, netSalary: 0, extras: 0, active: true, net: "0", ext: "0" }])}>
              <Plus size={14} /> Personel ekle
            </Button>
          }
        />
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Personel</TH>
                <TH numeric>Net maaş</TH>
                <TH numeric>Tahmini brüt</TH>
                <TH numeric>İşçi kesintileri</TH>
                <TH numeric>İşveren SGK</TH>
                <TH numeric>İşveren işsizlik</TH>
                <TH numeric>
                  Yemek / yol / prim <InfoTip text="Varsa yemek kartı, yol parası, prim gibi aylık ek ödemeler." className="ml-1" />
                </TH>
                <TH numeric>Toplam işveren maliyeti</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {rows.map((x, i) => (
                <TR key={x.id} className={x.active ? "" : "opacity-50"}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={x.active} onChange={(e) => setRows((rs) => rs.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} className="accent-coffee-800" title="Aktif" />
                      <Input value={x.name} onChange={(e) => setRows((rs) => rs.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className="h-8 min-w-32" />
                    </div>
                  </TD>
                  <TD numeric>
                    <NumberInput value={x.net} onChange={(e) => setRows((rs) => rs.map((y, j) => (j === i ? { ...y, net: e.target.value } : y)))} className="cell-input h-8 w-28" />
                  </TD>
                  <TD numeric>{tl(calcs[i].gross)}</TD>
                  <TD numeric>{tl(calcs[i].deductions)}</TD>
                  <TD numeric>{tl(calcs[i].employerSgk)}</TD>
                  <TD numeric>{tl(calcs[i].employerUnemployment)}</TD>
                  <TD numeric>
                    <NumberInput value={x.ext} onChange={(e) => setRows((rs) => rs.map((y, j) => (j === i ? { ...y, ext: e.target.value } : y)))} className="cell-input h-8 w-24" />
                  </TD>
                  <TD numeric className="font-semibold">{tl(calcs[i].total)}</TD>
                  <TD>
                    <button
                      type="button"
                      className="rounded p-1 text-coffee-400 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => {
                        if (x.id > 0) setRemoved((r2) => [...r2, x.id]);
                        setRows((rs) => rs.filter((_, j) => j !== i));
                      }}
                      aria-label="Kaldır"
                    >
                      <Trash2 size={14} />
                    </button>
                  </TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
                <td className="px-3 py-2 text-sm">TOPLAM (aktif)</td>
                <td className="px-3 py-2 text-right tabular">{tl(activeCalcs.reduce((a, c) => a + c.staff.netSalary, 0))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(total((c) => c.gross))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(total((c) => c.deductions))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(total((c) => c.employerSgk))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(total((c) => c.employerUnemployment))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(activeCalcs.reduce((a, c) => a + c.staff.extras, 0))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(total((c) => c.total))}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </TableWrap>
        <div className="flex justify-end border-t border-coffee-100 px-5 py-3">
          <Button onClick={save} disabled={busy}>
            <Save size={16} /> {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
