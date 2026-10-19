"use client";

import { ArrowUpRight, House, Pencil, PiggyBank, Plus, Store, Target, Trash2, Users, Wallet, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useCalmMotion } from "@/components/ui/motion";
import { AnimatedNumber } from "@/components/akmanos/charts/animated-number";
import { EASE_OUT, SPRING_SWAP } from "@/components/akmanos/lib/motion-ease";
import { SERIES } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton, IconLink } from "@/components/ui/button";
import { Card, CardHeader, Well } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { Table, TableWrap, TD, TFootRow, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { FixedExpense, FixedPeriod, FixedSection } from "@/lib/calc/types";
import { FIXED_PERIODS, FIXED_SECTIONS } from "@/lib/constants";
import { monthLabel, num, pct, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteFixedExpense, deleteInvestment, saveFixedExpense, saveInvestment } from "@/server/actions/costs";

const PERIOD_LABEL = Object.fromEntries(FIXED_PERIODS.map((p) => [p.key, p.label])) as Record<FixedPeriod, string>;

const SECTION_ICON: Record<FixedSection, ReactNode> = {
  personel: <Users />,
  faturalar: <Zap />,
  kira: <House />,
  genel: <Store />,
};

/** Dağılım çubuğunda ve tablodaki bölüm başlıklarında aynı renk: mürekkep, mavi, turuncu, gri */
const SECTION_COLOR: Record<FixedSection, string> = {
  personel: "var(--foreground)",
  faturalar: SERIES[0],
  kira: SERIES[1],
  genel: "var(--chart-muted)",
};

function periodRule(period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? `× ${acikGun} gün` : period === "haftalik" ? "× 52 ÷ 12" : period === "yillik" ? "÷ 12" : "";
}

function monthlyOf(amount: number, period: FixedPeriod, acikGun: number) {
  return period === "gunluk" ? amount * acikGun : period === "haftalik" ? (amount * 52) / 12 : period === "yillik" ? amount / 12 : amount;
}

// ============================================================================ Ortak parçalar (Personel de kullanır)

/** Açılışta sıfırdan sayan tutar (AkmanOS AnimatedNumber); ekran okuyucu son değeri okur */
export function CountUp({ value, digits = 0 }: { value: number; digits?: number }) {
  return (
    <>
      <span aria-hidden="true">
        <AnimatedNumber value={value} format={(v) => tl(v, digits)} />
      </span>
      <span className="sr-only">{tl(value, digits)}</span>
    </>
  );
}

/** Kart başlığındaki kenarlıklı beyaz ikon kutusu (CardHeader ile aynı), büyük rakamlı özet kartlarında */
export function HeadIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink [&>svg]:size-[18px] [&>svg]:stroke-[1.75]"
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

export type ShareSegment = { key: string; label: string; value: number; color: string; note?: ReactNode };

/**
 * AkmanOS agent-limits-card dili: tek yuvarlak çubukta renkli parçalar + tutar ve yüzdeli lejant.
 * Parçalar açılışta sırayla yayla dolar; lejantın üzerine gelince ilgili parça öne çıkar.
 */
export function ShareBreakdown({
  segments,
  total,
  className,
  legendClassName,
}: {
  segments: ShareSegment[];
  /** Yüzdelerin paydası; verilmezse parçaların toplamı */
  total?: number;
  className?: string;
  legendClassName?: string;
}) {
  const reduce = useCalmMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const sum = total ?? segments.reduce((a, s) => a + s.value, 0);
  // Geçersiz oranlarda (ör. işçi kesintisi %100) tutarlar sonsuz/negatif olabilir; çubuk o zaman boş kalır
  const valid = Number.isFinite(sum) && sum > 0;
  const filled = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);

  return (
    <div className={className}>
      <div className="flex h-2.5 w-full gap-1" aria-hidden="true">
        {filled.length > 0 && valid ? (
          filled.map((s, i) => (
            <motion.span
              key={s.key}
              title={`${s.label}: ${tl(s.value)} (${pct(s.value / sum, 0)})`}
              onMouseEnter={() => setFocus(s.key)}
              onMouseLeave={() => setFocus(null)}
              className={cn("h-full min-w-1.5 basis-0 rounded-full transition-opacity duration-200", focus && focus !== s.key && "opacity-25")}
              style={{ backgroundColor: s.color, originX: 0 }}
              initial={reduce ? false : { scaleX: 0, flexGrow: s.value }}
              animate={{ scaleX: 1, flexGrow: s.value }}
              transition={reduce ? { duration: 0 } : { ...SPRING_SWAP, delay: 0.12 + i * 0.06 }}
            />
          ))
        ) : (
          <span className="h-full w-full rounded-full bg-panel-deep" />
        )}
      </div>

      <ul className={cn("mt-4 grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-4", legendClassName)}>
        {segments.map((s, i) => (
          <motion.li
            key={s.key}
            onMouseEnter={() => setFocus(s.key)}
            onMouseLeave={() => setFocus(null)}
            className={cn("min-w-0 transition-opacity duration-200", focus && focus !== s.key && "opacity-50")}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT, delay: 0.18 + i * 0.04 }}
          >
            <div className="flex items-start gap-2 text-[13px] leading-5 text-ink-mute">
              <span className="mt-[5px] size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="min-w-0">{s.label}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 pl-[18px]">
              <span className="text-base font-semibold text-ink tabular">{tl(s.value)}</span>
              <span className="text-xs font-medium text-ink-mute tabular">{valid ? pct(s.value / sum, 0) : "–"}</span>
            </div>
            {s.note ? <div className="pl-[18px] text-xs leading-5 text-ink-mute">{s.note}</div> : null}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================ Özet ve dağılım

export type SectionTotal = { key: FixedSection; label: string; total: number };

export function FixedSummary({
  total,
  acikGun,
  sections,
  personnelCount,
  breakEvenDaily,
  breakEvenRef,
}: {
  total: number;
  acikGun: number;
  sections: SectionTotal[];
  personnelCount: number;
  breakEvenDaily: number | null;
  /** Başabaş hesabında kullanılan satış ayı, ör. "Eylül 2026" */
  breakEvenRef: string | null;
}) {
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <HeadIcon>
              <Wallet />
            </HeadIcon>
            <h2 className="text-base font-semibold tracking-tight text-ink">Aylık sabit gider</h2>
          </div>
          <p className="mt-4 text-3xl font-semibold tracking-tight text-ink tabular sm:text-4xl">
            <CountUp value={total} />
          </p>
          <p className="mt-1 text-[13px] text-ink-mute">{acikGun} açık gün varsayımıyla · KDV hariç</p>
        </div>

        {breakEvenDaily ? (
          <Well className="flex w-full items-start gap-3 p-3.5 sm:w-auto sm:max-w-sm">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info" aria-hidden="true">
              <Target size={16} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] text-ink-mute">
                Başabaş için günlük ciro
                <InfoTip text="Bu giderleri karşılamak için günde ortalama gereken ciro (KDV dahil)." />
              </p>
              <p className="text-lg font-semibold text-ink tabular">{tl(breakEvenDaily)}</p>
              <p className="text-xs leading-5 text-ink-mute">KDV dahil{breakEvenRef ? ` · ${breakEvenRef} brüt kâr oranıyla` : null}</p>
            </div>
          </Well>
        ) : null}
      </div>

      <ShareBreakdown
        className="mt-6"
        total={total}
        segments={sections.map((s) => ({
          key: s.key,
          label: s.label,
          value: s.total,
          color: SECTION_COLOR[s.key],
          note: s.key === "personel" ? `${personnelCount} kişi, maaş + SGK` : undefined,
        }))}
      />
    </Card>
  );
}

// ============================================================================ Sabit giderler

const FIXED_COLS = 7;

type FixedRow = FixedExpense & { monthly: number };

export function FixedExpensesClient({
  rows,
  personnel,
  total,
  acikGun,
  sections,
}: {
  rows: FixedRow[];
  personnel: { total: number; count: number };
  total: number;
  acikGun: number;
  /** Bölüm başına aktif aylık toplam (personel dahil) */
  sections: SectionTotal[];
}) {
  const [editing, setEditing] = useState<FixedExpense | "new" | null>(null);
  const [deleting, setDeleting] = useState<FixedExpense | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Aynı anda birden çok satır kaydedilebilir; her biri kendi isteği bitene kadar kilitli kalır
  const [busyIds, setBusyIds] = useState<ReadonlySet<number>>(() => new Set());

  const groups = FIXED_SECTIONS.map((sec) => ({ ...sec, rows: rows.filter((r) => r.section === sec.key) })).filter(
    (g) => g.key === "personel" || g.rows.length > 0,
  );
  const activeCount = rows.filter((r) => r.active).length;
  const inactiveCount = rows.length - activeCount;

  async function toggleActive(r: FixedExpense) {
    if (busyIds.has(r.id)) return;
    setBusyIds((s) => new Set(s).add(r.id));
    const res = await saveFixedExpense({ id: r.id, name: r.name, section: r.section, period: r.period, amount: r.amount, note: r.note, active: !r.active });
    setBusyIds((s) => {
      const next = new Set(s);
      next.delete(r.id);
      return next;
    });
    if (!res.ok) return toast.error(res.error);
    toast.success(r.active ? `${r.name} pasife alındı` : `${r.name} aktifleştirildi`);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const res = await deleteFixedExpense(deleting.id);
    setDeletePending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Gider silindi");
    setDeleting(null);
    setEditing(null);
  }

  return (
    <Card>
      <CardHeader
        icon={<Wallet />}
        title="Aylık sabit giderler"
        meta={
          <>
            <span>Aktif · {activeCount}</span>
            {inactiveCount ? <span className="text-ink-quiet">· Pasif · {inactiveCount}</span> : null}
          </>
        }
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus size={16} /> Gider ekle
          </Button>
        }
      />

      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Gider kalemi</TH>
              <TH numeric>Tutar</TH>
              <TH>Dönem</TH>
              <TH numeric>Aylık karşılığı</TH>
              <TH>Kaynak / not</TH>
              <TH>Durum</TH>
              <TH>
                <span className="sr-only">Eylemler</span>
              </TH>
            </tr>
          </THead>
          {groups.map((g, gi) => {
            const subtotal = sections.find((s) => s.key === g.key)?.total ?? 0;
            const pad = gi === 0 ? "pt-3" : "pt-6";
            return (
              <tbody key={g.key}>
                <tr className="border-b border-line">
                  <th scope="rowgroup" colSpan={3} className={cn("px-3 pb-2 text-left font-normal", pad)}>
                    <span className="flex items-center gap-2.5">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface [&>svg]:size-3.5 [&>svg]:stroke-[2]"
                        style={{ color: SECTION_COLOR[g.key] }}
                        aria-hidden="true"
                      >
                        {SECTION_ICON[g.key]}
                      </span>
                      <span className="text-[13px] font-semibold text-ink">{g.label}</span>
                      <span className="text-[13px] whitespace-nowrap text-ink-mute tabular">{g.rows.length + (g.key === "personel" ? 1 : 0)} kalem</span>
                    </span>
                  </th>
                  <td className={cn("px-3 pb-2 text-right text-[13px] font-semibold whitespace-nowrap text-ink tabular", pad)}>
                    <span className="sr-only">Bölüm toplamı </span>
                    {tl(subtotal)}
                  </td>
                  <td colSpan={FIXED_COLS - 4} className={pad} />
                </tr>

                {g.key === "personel" ? (
                  <TR>
                    <TD className="font-medium">
                      <Link href="/panel/personel" className="rounded-md hover:underline">
                        Personel ({personnel.count} kişi, maaş + SGK)
                      </Link>
                    </TD>
                    <TD numeric className="text-ink-quiet">
                      –
                    </TD>
                    <TD className="text-[13px] whitespace-nowrap text-ink-mute">Personel sayfasından</TD>
                    <TD numeric className="font-semibold">
                      {tl(personnel.total)}
                    </TD>
                    <TD className="min-w-44 text-[13px] text-ink-mute">Toplam işveren maliyeti, otomatik</TD>
                    <TD>
                      <Badge tone="blue">Otomatik</Badge>
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <IconLink href="/panel/personel" label="Personel sayfasına git">
                          <ArrowUpRight size={16} />
                        </IconLink>
                      </div>
                    </TD>
                  </TR>
                ) : null}

                {g.rows.map((r) => {
                  const dim = !r.active && "opacity-50";
                  const rule = periodRule(r.period, acikGun);
                  return (
                    <TR key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}>
                      <TD className={cn("font-medium", dim)}>{r.name}</TD>
                      <TD numeric className={cn(dim)}>
                        {tl(r.amount, r.amount < 100 ? 2 : 0)}
                      </TD>
                      <TD className={cn("whitespace-nowrap", dim)}>
                        <span className="inline-flex items-center gap-1.5">
                          <Badge tone="gray">{PERIOD_LABEL[r.period]}</Badge>
                          {rule ? <span className="text-xs text-ink-mute tabular">{rule}</span> : null}
                        </span>
                      </TD>
                      <TD numeric className={cn("font-semibold", dim)}>
                        {tl(r.monthly, r.monthly < 100 ? 2 : 0)}
                      </TD>
                      <TD className={cn("max-w-80 min-w-44 text-[13px] text-ink-mute", dim)}>
                        {r.note ? (
                          <span className="line-clamp-2" title={r.note}>
                            {r.note}
                          </span>
                        ) : null}
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()}>
                        <Switch checked={r.active} disabled={busyIds.has(r.id)} label={`${r.name} aktif`} onChange={() => toggleActive(r)} showText />
                      </TD>
                      <TD onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          <IconButton label="Düzenle" onClick={() => setEditing(r)}>
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton label="Sil" tone="danger" onClick={() => setDeleting(r)}>
                            <Trash2 size={15} />
                          </IconButton>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            );
          })}
          <tfoot>
            <TFootRow>
              <TD colSpan={3}>Toplam</TD>
              <TD numeric>{tl(total)}</TD>
              <TD colSpan={3} className="text-[13px] font-normal text-ink-mute">
                {inactiveCount ? "Pasif kalemler dahil değil" : null}
              </TD>
            </TFootRow>
          </tfoot>
        </Table>
      </TableWrap>

      {editing ? (
        <FixedDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDelete={setDeleting} acikGun={acikGun} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={deletePending}
        title="Gideri sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </Card>
  );
}

function FixedDialog({
  row,
  onClose,
  onDelete,
  acikGun,
}: {
  row: FixedExpense | null;
  onClose: () => void;
  /** Silme onayını açar; onaylanınca bu pencere de kapanır */
  onDelete: (row: FixedExpense) => void;
  acikGun: number;
}) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: row?.name ?? "",
    section: row?.section ?? ("genel" as FixedSection),
    period: row?.period ?? ("aylik" as FixedPeriod),
    amount: num(row?.amount ?? 0, 2),
    note: row?.note ?? "",
    active: row?.active ?? true,
  });
  const amount = parseNumberTR(f.amount) ?? 0;
  const monthly = monthlyOf(amount, f.period, acikGun);

  async function save() {
    setBusy(true);
    const res = await saveFixedExpense({ id: row?.id ?? null, name: f.name, section: f.section, period: f.period, amount, note: f.note, active: f.active });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Kaydedildi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Gideri düzenle" : "Sabit gider ekle"}
      footerStart={
        row ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null
      }
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
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Gider kalemi" htmlFor="fx-n">
          <Input id="fx-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
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
      </form>
    </Dialog>
  );
}

// ============================================================================ Yatırımlar

type Investment = { id: number; name: string; amount: number; date: string | null; note: string | null };

/** "2026-07" ise "Temmuz 2026", değilse yazıldığı gibi */
function periodText(date: string | null) {
  if (!date) return "–";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(date) ? monthLabel(date) : date;
}

export function InvestmentsClient({ rows, total }: { rows: Investment[]; total: number }) {
  const [editing, setEditing] = useState<Investment | "new" | null>(null);
  const [deleting, setDeleting] = useState<Investment | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    const res = await deleteInvestment(deleting.id);
    setDeletePending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Yatırım silindi");
    setDeleting(null);
    setEditing(null);
  }

  const addButton = (
    <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
      <Plus size={16} /> Yatırım ekle
    </Button>
  );

  return (
    <Card>
      <CardHeader
        icon={<PiggyBank />}
        title="Tek seferlik yatırımlar"
        description="Bilgi amaçlı, aylık gidere dahil değil."
        meta={
          <>
            <span className="font-medium text-ink tabular">Toplam {tl(total)}</span>
            <span>(KDV hariç)</span>
            <span className="text-ink-quiet">· {rows.length} kayıt</span>
          </>
        }
        actions={addButton}
      />
      {rows.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Yatırım</TH>
                <TH>Dönem</TH>
                <TH numeric>Tutar</TH>
                <TH>Not</TH>
                <TH>
                  <span className="sr-only">Eylemler</span>
                </TH>
              </tr>
            </THead>
            <tbody>
              {rows.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="whitespace-nowrap text-ink-soft" title={r.date ?? undefined}>
                    {periodText(r.date)}
                  </TD>
                  <TD numeric className="font-semibold">
                    {tl(r.amount)}
                  </TD>
                  <TD className="max-w-96 min-w-44 text-[13px] text-ink-mute">
                    {r.note ? (
                      <span className="line-clamp-2" title={r.note}>
                        {r.note}
                      </span>
                    ) : null}
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <IconButton label="Düzenle" onClick={() => setEditing(r)}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label="Sil" tone="danger" onClick={() => setDeleting(r)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <EmptyState
          icon={<PiggyBank />}
          title="Yatırım kaydı yok"
          description="Açılış, ekipman, dekorasyon gibi tek seferlik harcamaları buraya ekleyin."
          action={addButton}
        />
      )}
      {editing ? <InvestmentDialog row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDelete={setDeleting} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
        pending={deletePending}
        title="Yatırımı sil"
        description={
          deleting ? (
            <>
              <strong className="font-semibold text-ink">{deleting.name}</strong> kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </>
          ) : null
        }
      />
    </Card>
  );
}

function InvestmentDialog({ row, onClose, onDelete }: { row: Investment | null; onClose: () => void; onDelete: (row: Investment) => void }) {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(row?.name ?? "");
  const [amount, setAmount] = useState(num(row?.amount ?? 0, 2));
  const [date, setDate] = useState(row?.date ?? "");
  const [note, setNote] = useState(row?.note ?? "");

  async function save() {
    setBusy(true);
    const res = await saveInvestment({ id: row?.id ?? null, name, amount: parseNumberTR(amount) ?? 0, date, note });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Kaydedildi");
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row ? "Yatırımı düzenle" : "Yatırım ekle"}
      footerStart={
        row ? (
          <Button variant="ghost" className="text-bad hover:bg-bad-soft hover:text-bad" onClick={() => onDelete(row)} disabled={busy}>
            <Trash2 size={16} /> Sil
          </Button>
        ) : null
      }
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
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Yatırım" htmlFor="iv-n">
          <Input id="iv-n" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tutar (KDV hariç)" htmlFor="iv-a">
            <NumberInput id="iv-a" value={amount} onChange={(e) => setAmount(e.target.value)} className="cell-input" />
          </Field>
          <Field label="Dönem (YYYY-AA)" htmlFor="iv-d">
            <Input id="iv-d" value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026-07" />
          </Field>
        </div>
        <Field label="Not" htmlFor="iv-note">
          <Textarea id="iv-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </form>
    </Dialog>
  );
}
