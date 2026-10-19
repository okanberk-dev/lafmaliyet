"use client";

import { Plus, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { FixedExpense, FixedPeriod, FixedSection } from "@/lib/calc/types";
import { FIXED_PERIODS, FIXED_SECTIONS } from "@/lib/constants";
import { num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteFixedExpense, deleteInvestment, saveFixedExpense, saveInvestment } from "@/server/actions/costs";

const SECTION_LABEL = Object.fromEntries(FIXED_SECTIONS.map((s) => [s.key, s.label])) as Record<FixedSection, string>;
const PERIOD_LABEL = Object.fromEntries(FIXED_PERIODS.map((p) => [p.key, p.label])) as Record<FixedPeriod, string>;

export function FixedExpensesClient({
  rows,
  personnel,
  total,
  acikGun,
  breakEvenDaily,
}: {
  rows: (FixedExpense & { monthly: number })[];
  personnel: { total: number; count: number };
  total: number;
  acikGun: number;
  breakEvenDaily: number | null;
}) {
  const [editing, setEditing] = useState<FixedExpense | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Aylık sabit giderler"
        description={breakEvenDaily ? `Bu giderleri karşılamak için günde ortalama ${tl(breakEvenDaily)} ciro (KDV dahil) gerekir.` : undefined}
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={14} /> Gider ekle
          </Button>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Gider kalemi</TH>
              <TH>Bölüm</TH>
              <TH numeric>Tutar</TH>
              <TH>Dönem</TH>
              <TH numeric>Aylık karşılığı</TH>
              <TH>Kaynak / not</TH>
            </tr>
          </THead>
          <tbody>
            <TR className="bg-coffee-50/40">
              <TD className="font-medium">
                <Link href="/panel/personel" className="inline-flex items-center gap-2 hover:underline">
                  <Users size={14} className="text-coffee-400" /> Personel ({personnel.count} kişi, maaş + SGK)
                </Link>
              </TD>
              <TD>
                <Badge tone="coffee">Personel giderleri</Badge>
              </TD>
              <TD numeric>–</TD>
              <TD className="text-xs text-coffee-500">Personel sayfasından</TD>
              <TD numeric className="font-semibold">{tl(personnel.total)}</TD>
              <TD className="text-xs text-coffee-600">Toplam işveren maliyeti, otomatik</TD>
            </TR>
            {rows.map((r) => (
              <TR key={r.id} className={cn("cursor-pointer", !r.active && "opacity-50")} onClick={() => setEditing(r)}>
                <TD className="font-medium">{r.name}</TD>
                <TD>
                  <Badge tone="gray">{SECTION_LABEL[r.section]}</Badge>
                </TD>
                <TD numeric>{tl(r.amount, r.amount < 100 ? 2 : 0)}</TD>
                <TD className="text-xs text-coffee-600">
                  {PERIOD_LABEL[r.period]}
                  {r.period === "gunluk" ? ` × ${acikGun} gün` : r.period === "haftalik" ? " × 52 ÷ 12" : r.period === "yillik" ? " ÷ 12" : ""}
                </TD>
                <TD numeric className="font-semibold">{tl(r.monthly, r.monthly < 100 ? 2 : 0)}</TD>
                <TD className="max-w-96 text-xs text-coffee-600">{r.note}</TD>
              </TR>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
              <td className="px-3 py-2 text-sm" colSpan={4}>
                TOPLAM
              </td>
              <td className="px-3 py-2 text-right tabular">{tl(total)}</td>
              <td />
            </tr>
          </tfoot>
        </Table>
      </TableWrap>
      {editing ? <FixedDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} acikGun={acikGun} /> : null}
    </Card>
  );
}

function FixedDialog({ row, onClose, acikGun }: { row: FixedExpense | null; onClose: () => void; acikGun: number }) {
  const [f, setF] = useState({
    name: row?.name ?? "",
    section: row?.section ?? ("genel" as FixedSection),
    period: row?.period ?? ("aylik" as FixedPeriod),
    amount: num(row?.amount ?? 0, 2),
    note: row?.note ?? "",
    active: row?.active ?? true,
  });
  const amount = parseNumberTR(f.amount) ?? 0;
  const monthly = f.period === "gunluk" ? amount * acikGun : f.period === "haftalik" ? (amount * 52) / 12 : f.period === "yillik" ? amount / 12 : amount;
  return (
    <Dialog open onClose={onClose} title={row ? "Gideri düzenle" : "Sabit gider ekle"}>
      <div className="space-y-3">
        <Field label="Gider kalemi" htmlFor="fx-n">
          <Input id="fx-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bölüm (gelir-gider tablosunda)" htmlFor="fx-s">
            <Select id="fx-s" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value as FixedSection })}>
              {FIXED_SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dönem" htmlFor="fx-p" hint={FIXED_PERIODS.find((p) => p.key === f.period)?.hint}>
            <Select id="fx-p" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as FixedPeriod })}>
              {FIXED_PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Tutar (₺, KDV hariç)" htmlFor="fx-a" hint={`Aylık karşılığı: ${tl(monthly, 2)}`}>
          <NumberInput id="fx-a" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="cell-input" />
        </Field>
        <Field label="Kaynak / not" htmlFor="fx-note">
          <Textarea id="fx-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} />
        </Field>
        <Checkbox label="Aktif" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        <div className="flex items-center justify-between gap-2 pt-2">
          {row ? (
            <Button
              variant="ghost"
              className="text-rose-700 hover:bg-rose-50"
              onClick={async () => {
                const res = await deleteFixedExpense(row.id);
                if (!res.ok) return toast.error(res.error);
                onClose();
              }}
            >
              <Trash2 size={16} /> Sil
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Vazgeç
            </Button>
            <Button
              onClick={async () => {
                const res = await saveFixedExpense({ id: row?.id ?? null, name: f.name, section: f.section, period: f.period, amount, note: f.note, active: f.active });
                if (!res.ok) return toast.error(res.error);
                toast.success("Kaydedildi");
                onClose();
              }}
            >
              Kaydet
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function InvestmentsClient({ rows, total }: { rows: { id: number; name: string; amount: number; date: string | null; note: string | null }[]; total: number }) {
  const [editing, setEditing] = useState<(typeof rows)[number] | "new" | null>(null);
  return (
    <Card>
      <CardHeader
        title="Tek seferlik yatırımlar"
        description={`Bilgi amaçlı, aylık gidere dahil değil. Toplam ${tl(total)} (KDV hariç).`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            <Plus size={14} /> Yatırım ekle
          </Button>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Yatırım</TH>
              <TH>Dönem</TH>
              <TH numeric>Tutar</TH>
              <TH>Not</TH>
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="text-coffee-600">{r.date ?? "–"}</TD>
                <TD numeric className="font-semibold">{tl(r.amount)}</TD>
                <TD className="max-w-96 text-xs text-coffee-600">{r.note}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {editing ? <InvestmentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function InvestmentDialog({ row, onClose }: { row: { id: number; name: string; amount: number; date: string | null; note: string | null } | null; onClose: () => void }) {
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(num(row?.amount ?? 0, 2));
  const [date, setDate] = useState(row?.date ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  return (
    <Dialog open onClose={onClose} title={row ? "Yatırımı düzenle" : "Yatırım ekle"}>
      <div className="space-y-3">
        <Field label="Yatırım" htmlFor="iv-n">
          <Input id="iv-n" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tutar (KDV hariç)" htmlFor="iv-a">
            <NumberInput id="iv-a" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Dönem (YYYY-AA)" htmlFor="iv-d">
            <Input id="iv-d" value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-07" />
          </Field>
        </div>
        <Field label="Not" htmlFor="iv-note">
          <Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <div className="flex items-center justify-between gap-2 pt-2">
          {row ? (
            <Button
              variant="ghost"
              className="text-rose-700 hover:bg-rose-50"
              onClick={async () => {
                const res = await deleteInvestment(row.id);
                if (!res.ok) return toast.error(res.error);
                onClose();
              }}
            >
              <Trash2 size={16} /> Sil
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Vazgeç
            </Button>
            <Button
              onClick={async () => {
                const res = await saveInvestment({ id: row?.id ?? null, name, amount: parseNumberTR(amount) ?? 0, date, note });
                if (!res.ok) return toast.error(res.error);
                onClose();
              }}
            >
              Kaydet
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
