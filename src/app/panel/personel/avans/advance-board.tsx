"use client";

import { HandCoins, MinusCircle, PlusCircle, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { tryAction } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select } from "@/components/ui/form";
import { EmptyState, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, tl } from "@/lib/format";
import {
  ADVANCE_KIND_LABEL,
  advanceProblem,
  advanceTotals,
  balanceWarning,
  deductedInMonth,
  payableThisMonth,
  withRunningBalance,
  type AdvanceKind,
} from "@/lib/staff-advances";
import { addStaffAdvance, deleteStaffAdvance } from "@/server/actions/staff-docs";
import type { AdvanceListRow } from "@/server/staff-advances";

/*
 * Personel avansları ekranı (docs/PERSONEL-BELGE.md › Avans): kişi başına verilen, düşülen, kalan ve bu ay ele geçecek;
 * hareketler kalan bakiyeyle. Kurallar src/lib/staff-advances.ts'te (sunucu aynı kuralla reddeder).
 */

export interface AdvancePerson {
  id: number;
  name: string;
  /** Bu ayın net maaşı; part-time'da null (ele geçecek hesaplanmaz) */
  net: number | null;
  extras: number;
  left: boolean;
  branchName: string | null;
}

type Adding = { staffId: number | null; kind: AdvanceKind };

export function AdvanceBoard({ people, rows, today }: { people: AdvancePerson[]; rows: AdvanceListRow[]; today: string }) {
  const [adding, setAdding] = useState<Adding | null>(null);
  const [removing, setRemoving] = useState<AdvanceListRow | null>(null);
  const [pending, setPending] = useState(false);
  const month = today.slice(0, 7);

  const byPerson = useMemo(() => {
    const m = new Map<number, AdvanceListRow[]>();
    for (const r of rows) m.set(r.staffId, [...(m.get(r.staffId) ?? []), r]);
    return m;
  }, [rows]);

  const totals = advanceTotals(rows);
  const deductedNow = deductedInMonth(rows, month);
  const withBalance = people.filter((p) => advanceTotals(byPerson.get(p.id) ?? []).balance > 0.005).length;
  // Hareketi olan ya da çalışan kişiler; ayrılıp avansı kapanmış kişi listeyi kalabalık etmesin
  const shown = people.filter((p) => !p.left || advanceTotals(byPerson.get(p.id) ?? []).balance > 0.005 || (byPerson.get(p.id)?.length ?? 0) > 0);

  const remove = async () => {
    if (!removing) return;
    setPending(true);
    const r = await tryAction(() => deleteStaffAdvance(removing.id));
    setPending(false);
    if (!r) return;
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Hareket silindi");
    setRemoving(null);
  };

  if (!people.length) {
    return <EmptyState icon={<HandCoins />} title="Henüz çalışan yok" description="Önce Maaşlar'dan çalışanları ekleyin; avanslar burada kişi kişi tutulur." />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Kalan avans" value={tl(totals.balance, 2)} sub={withBalance ? `${withBalance} kişide` : "Kimsede kalan yok"} />
        <Stat label="Bu ay maaştan düşülen" value={tl(deductedNow, 2)} />
        <Stat label="Toplam verilen" value={tl(totals.given, 2)} sub={`Düşülen ${tl(totals.deducted, 2)}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setAdding({ staffId: null, kind: "avans" })}>
          <PlusCircle size={16} aria-hidden="true" /> Avans ver
        </Button>
        <Button variant="secondary" onClick={() => setAdding({ staffId: null, kind: "kesinti" })}>
          <MinusCircle size={16} aria-hidden="true" /> Maaştan düş
        </Button>
      </div>

      <div className="space-y-4">
        {shown.map((p) => (
          <PersonCard key={p.id} person={p} rows={byPerson.get(p.id) ?? []} month={month} onAdd={(kind) => setAdding({ staffId: p.id, kind })} onRemove={setRemoving} />
        ))}
      </div>

      {adding ? <AdvanceDialog adding={adding} people={people.filter((p) => !p.left || byPerson.has(p.id))} byPerson={byPerson} today={today} onClose={() => setAdding(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        pending={pending}
        title="Hareket silinsin mi?"
        description={removing ? `${removing.staffName} · ${ADVANCE_KIND_LABEL[removing.kind]} · ${dateTR(removing.date)} · ${tl(removing.amount, 2)} silinir; kalan yeniden hesaplanır.` : null}
      />
    </div>
  );
}

function PersonCard({
  person,
  rows,
  month,
  onAdd,
  onRemove,
}: {
  person: AdvancePerson;
  rows: AdvanceListRow[];
  month: string;
  onAdd: (kind: AdvanceKind) => void;
  onRemove: (r: AdvanceListRow) => void;
}) {
  const t = advanceTotals(rows);
  const deducted = deductedInMonth(rows, month);
  const warning = balanceWarning(t.balance, person.net);
  const history = withRunningBalance(rows).reverse();
  return (
    <Card>
      <CardHeader
        title={person.name}
        meta={
          <>
            {person.branchName ? <span>{person.branchName} ·</span> : null}
            <span>Kalan {tl(t.balance, 2)}</span>
            {person.left ? <Badge tone="gray">Ayrıldı</Badge> : null}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => onAdd("avans")}>
              <PlusCircle size={15} aria-hidden="true" /> Avans
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onAdd("kesinti")} disabled={t.balance <= 0.005}>
              <MinusCircle size={15} aria-hidden="true" /> Maaştan düş
            </Button>
          </>
        }
      />
      <CardContent className="space-y-3 pt-0">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-ink-mute">Verilen</dt>
            <dd className="font-medium text-ink tabular-nums">{tl(t.given, 2)}</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Düşülen</dt>
            <dd className="font-medium text-ink tabular-nums">{tl(t.deducted, 2)}</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Bu ay düşülen</dt>
            <dd className="font-medium text-ink tabular-nums">{tl(deducted, 2)}</dd>
          </div>
          <div>
            <dt className="text-ink-mute">Bu ay ele geçecek</dt>
            <dd className="font-medium text-ink tabular-nums">{person.net === null ? "Günlük ücretli" : tl(payableThisMonth(person.net, person.extras, deducted), 2)}</dd>
          </div>
        </dl>
        {warning ? <Notice tone="warn" size="sm" title={warning.title} text={warning.text} /> : null}
        {history.length ? (
          <ul className="divide-y divide-line rounded-2xl bg-surface">
            {history.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    {ADVANCE_KIND_LABEL[r.kind]} · <span className="tabular-nums">{r.kind === "avans" ? "+" : "−"}{tl(r.amount, 2)}</span>
                  </p>
                  <p className="text-ink-mute">{[dateTR(r.date), r.note, `kalan ${tl(r.balanceAfter, 2)}`].filter(Boolean).join(" · ")}</p>
                </div>
                <IconButton label={`${dateTR(r.date)} ${ADVANCE_KIND_LABEL[r.kind].toLocaleLowerCase("tr-TR")}: sil`} tone="danger" onClick={() => onRemove(r)}>
                  <Trash2 size={15} aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-1 text-[13px] text-ink-mute">Hareket yok.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AdvanceDialog({
  adding,
  people,
  byPerson,
  today,
  onClose,
}: {
  adding: Adding;
  people: AdvancePerson[];
  byPerson: Map<number, AdvanceListRow[]>;
  today: string;
  onClose: () => void;
}) {
  const [staffId, setStaffId] = useState(adding.staffId ? String(adding.staffId) : "");
  const [kind, setKind] = useState<AdvanceKind>(adding.kind);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const balance = staffId ? advanceTotals(byPerson.get(Number(staffId)) ?? []).balance : 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = parseNumberTR(amount);
    const problem = !staffId ? "Kişi seçin" : advanceProblem({ kind, amount: value ?? NaN, date }, { balance, today });
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      const r = await tryAction(() => addStaffAdvance({ staffId: Number(staffId), kind, amount: value!, date, note }), { maybeSaved: true });
      if (!r) return;
      if (!r.ok) return setError(r.error);
      toast.success(`${kind === "avans" ? "Avans yazıldı" : "Maaştan düşüldü"}; kalan ${tl(r.data.balance, 2)}`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const formId = "personel-avans-formu";
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === "avans" ? "Avans ver" : "Maaştan düş"}
      description={kind === "avans" ? "Kişiye verilen avans; maaştan düşülene kadar kalan olarak görünür." : "Maaş öderken avanstan düştüğünüz tutar; kalanı aşamaz."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Kişi" htmlFor="avans-kisi" hint={staffId ? `Kalan avans: ${tl(balance, 2)}` : undefined}>
          <Select id="avans-kisi" value={staffId} onChange={(e) => setStaffId(e.target.value)} required>
            <option value="">Seçin</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.left ? " (ayrıldı)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hareket" htmlFor="avans-tur">
          <Select id="avans-tur" value={kind} onChange={(e) => setKind(e.target.value as AdvanceKind)}>
            <option value="avans">{ADVANCE_KIND_LABEL.avans}</option>
            <option value="kesinti">{ADVANCE_KIND_LABEL.kesinti}</option>
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tutar (₺)" htmlFor="avans-tutar">
            <NumberInput id="avans-tutar" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required />
          </Field>
          <Field label="Tarih" htmlFor="avans-tarih">
            <Input id="avans-tarih" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <Field label="Açıklama (isteğe bağlı)" htmlFor="avans-not">
          <Input id="avans-not" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={kind === "avans" ? "ör. kira için" : "ör. Kasım maaşından"} />
        </Field>
        {error ? (
          <p role="alert" className="text-[13px] leading-5 text-bad">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
