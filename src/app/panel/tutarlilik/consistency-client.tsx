"use client";

import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import { dateTR, num, tl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deleteFinding, saveFinding, setFindingResolved, setPurchaseQty } from "@/server/actions/consistency";

interface Row {
  ingredientId: number;
  name: string;
  unit: string;
  unitCost: number;
  usage: number;
  purchased: number | null;
  ratio: number | null;
  diffAmount: number | null;
  opening: number | null;
  closing: number | null;
  actualUsage: number | null;
  variance: number | null;
  varianceAmount: number | null;
  note: string | null;
}

function RatioBadge({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-coffee-300">–</span>;
  const tone = ratio > 1.5 ? "red" : ratio >= 1.15 ? "amber" : "green";
  return (
    <Badge tone={tone} className="tabular">
      {num(ratio, 2)}×
    </Badge>
  );
}

function PurchaseCell({ month, row }: { month: string; row: Row }) {
  const [value, setValue] = useState(row.purchased === null ? "" : num(row.purchased, 2));
  const [busy, setBusy] = useState(false);
  return (
    <NumberInput
      value={value}
      disabled={busy}
      onChange={(e) => setValue(e.target.value)}
      onBlur={async () => {
        const t = value.trim();
        const v = t === "" ? null : parseNumberTR(t);
        if (t !== "" && v === null) return toast.error("Geçerli bir miktar girin");
        if (v === row.purchased) return;
        setBusy(true);
        const res = await setPurchaseQty(month, row.ingredientId, v);
        setBusy(false);
        if (!res.ok) toast.error(res.error);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      aria-label={`${row.name} alınan miktar`}
      className="cell-input h-8 w-28"
    />
  );
}

export function ConsistencyTable({
  month,
  monthLabel,
  rows,
  totalDiff,
  totalVariance,
  hasStock,
  ingredients,
  fire,
}: {
  month: string;
  monthLabel: string;
  rows: Row[];
  totalDiff: number;
  totalVariance: number;
  hasStock: boolean;
  ingredients: { id: number; name: string; unit: string }[];
  fire: number;
}) {
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const withPurchase = rows.filter((r) => r.purchased !== null);
  const visible = showAll ? rows : withPurchase.length ? withPurchase : rows;

  return (
    <Card>
      <CardHeader
        title={`2) Reçete ↔ fatura: ${monthLabel}`}
        description={`Satılanlara göre harcanması gereken malzeme (fire hariç) ile ay içinde faturayla alınan. Yeşil < 1,15× tutarlı; sarı 1,15–1,5× stok veya fire olabilir (genel fire payı %${num(fire * 100, 0)}); kırmızı > 1,5× reçete, fire ya da ikram kontrol edilmeli. Büyük şişeli sos ve püreler birkaç ay yettiği için tek aylık oranları yüksek çıkabilir.`}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-coffee-700">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-coffee-800" />
              Alımı girilmeyenleri de göster
            </label>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
              <Plus size={14} /> Alım ekle
            </Button>
          </>
        }
      />
      <TableWrap>
        <Table>
          <THead>
            <tr>
              <TH>Malzeme</TH>
              <TH numeric>
                Reçeteye göre kullanım <InfoTip text="Her ürünün bu ayki satış adedi × reçetedeki miktar. Fire payı ve ödenmez siparişler hariç." className="ml-1" />
              </TH>
              <TH numeric>
                Faturayla alınan <InfoTip text="Bu ayki faturalardaki miktar (malzemenin kendi biriminde: gr, ml, adet). Tıklayıp yazabilirsiniz." className="ml-1" />
              </TH>
              <TH numeric>Alınan ÷ kullanılan</TH>
              <TH numeric>
                Fark tutarı <InfoTip text="(Alınan − kullanılan) × birim maliyet. Pozitif = reçeteye göre fazla alınan malın parası (stokta duruyor ya da fire/ikram oldu)." className="ml-1" />
              </TH>
              {hasStock ? (
                <>
                  <TH numeric>
                    Gerçek tüketim <InfoTip text="Geçen ay sayımı + alınan − bu ay sayımı. İki ayın da sayımı girildiyse hesaplanır." className="ml-1" />
                  </TH>
                  <TH numeric>Sapma (₺)</TH>
                </>
              ) : null}
              <TH>Yorum / kaynak faturalar</TH>
            </tr>
          </THead>
          <tbody>
            {visible.map((r) => (
              <TR key={r.ingredientId}>
                <TD className="font-medium">{r.name}</TD>
                <TD numeric>
                  {num(r.usage)} {r.unit}
                </TD>
                <TD numeric>
                  <div className="flex items-center justify-end gap-1.5">
                    <PurchaseCell month={month} row={r} />
                    <span className="w-8 text-left text-xs text-coffee-500">{r.unit}</span>
                  </div>
                </TD>
                <TD numeric>
                  <RatioBadge ratio={r.ratio} />
                </TD>
                <TD numeric className={cn(r.diffAmount !== null && r.diffAmount < 0 && "text-sky-700", r.diffAmount !== null && r.diffAmount > 2000 && "text-rose-700")}>
                  {r.diffAmount === null ? "–" : tl(r.diffAmount)}
                </TD>
                {hasStock ? (
                  <>
                    <TD numeric>{r.actualUsage === null ? "–" : `${num(r.actualUsage)} ${r.unit}`}</TD>
                    <TD numeric className={cn(r.varianceAmount !== null && r.varianceAmount > 0 && "text-rose-700")}>{r.varianceAmount === null ? "–" : tl(r.varianceAmount)}</TD>
                  </>
                ) : null}
                <TD className="max-w-80 text-xs text-coffee-600">{r.note ?? ""}</TD>
              </TR>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
              <td className="px-3 py-2 text-sm" colSpan={4}>
                TOPLAM fark (alınan − reçeteye göre kullanılan)
              </td>
              <td className="px-3 py-2 text-right tabular">{tl(totalDiff)}</td>
              {hasStock ? (
                <>
                  <td />
                  <td className="px-3 py-2 text-right tabular">{tl(totalVariance)}</td>
                </>
              ) : null}
              <td />
            </tr>
          </tfoot>
        </Table>
      </TableWrap>
      {!hasStock ? (
        <div className="border-t border-coffee-100 px-5 py-3 text-xs text-coffee-500">
          İpucu: Bu ayın ve geçen ayın stok sayımını girerseniz &quot;gerçek tüketim&quot; ve &quot;sapma&quot; sütunları çıkar. Sapma, reçeteye göre olması gerekenden fazla harcanan malın parasıdır (fire, ikram, porsiyon kaçağı).
        </div>
      ) : null}
      {adding ? <AddPurchaseDialog month={month} ingredients={ingredients} onClose={() => setAdding(false)} /> : null}
    </Card>
  );
}

function AddPurchaseDialog({ month, ingredients, onClose }: { month: string; ingredients: { id: number; name: string; unit: string }[]; onClose: () => void }) {
  const [id, setId] = useState<number>(ingredients[0]?.id ?? 0);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const unit = ingredients.find((i) => i.id === id)?.unit ?? "";
  return (
    <Dialog open onClose={onClose} title="Alınan miktar ekle" description="Faturalardaki toplam miktarı malzemenin kendi biriminde girin (1 kg = 1.000 gr, 1 L = 1.000 ml).">
      <div className="space-y-3">
        <Field label="Malzeme" htmlFor="ap-i">
          <Select id="ap-i" value={id} onChange={(e) => setId(Number(e.target.value))}>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Miktar (${unit})`} htmlFor="ap-q">
          <NumberInput id="ap-q" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Kaynak faturalar / yorum" htmlFor="ap-n">
          <Input id="ap-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Kaldi 01.09 + 15.09: 2 × 12 kg" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            onClick={async () => {
              const v = parseNumberTR(qty);
              if (v === null) return toast.error("Miktar girin");
              const res = await setPurchaseQty(month, id, v, note);
              if (!res.ok) return toast.error(res.error);
              toast.success("Eklendi");
              onClose();
            }}
          >
            Kaydet
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Bulgular

export function Findings({
  items,
}: {
  items: { id: number; section: string; title: string; detail: string | null; resolved: boolean; createdAt: string }[];
}) {
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<(typeof items)[number] | "new" | null>(null);
  const visible = items.filter((i) => showResolved || !i.resolved);
  const sections = [...new Set(visible.map((i) => i.section))];

  return (
    <Card>
      <CardHeader
        title="3) Bulgular ve yapılacaklar"
        description="Reçetede olmayan alımlar, fiyat ve fatura kontrolleri. Çözülen maddeyi işaretleyin."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-coffee-700">
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-coffee-800" />
              Çözülenleri göster ({items.filter((i) => i.resolved).length})
            </label>
            <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
              <Plus size={14} /> Bulgu ekle
            </Button>
          </>
        }
      />
      <CardContent className="space-y-5">
        {sections.map((sec) => (
          <div key={sec}>
            <p className="mb-2 text-xs font-semibold tracking-wide text-coffee-500 uppercase">{sec}</p>
            <ul className="space-y-2">
              {visible
                .filter((i) => i.section === sec)
                .map((i) => (
                  <li key={i.id} className={cn("flex gap-3 rounded-xl border border-coffee-100 px-3 py-2.5", i.resolved && "opacity-60")}>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await setFindingResolved(i.id, !i.resolved);
                        if (!res.ok) toast.error(res.error);
                      }}
                      className="mt-0.5 shrink-0 text-coffee-400 hover:text-emerald-600"
                      aria-label={i.resolved ? "Yeniden aç" : "Çözüldü olarak işaretle"}
                    >
                      {i.resolved ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} />}
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(i)}>
                      <p className={cn("text-sm font-medium text-coffee-950", i.resolved && "line-through")}>{i.title}</p>
                      {i.detail ? <p className="mt-0.5 text-xs text-coffee-600">{i.detail}</p> : null}
                      <p className="mt-1 text-[11px] text-coffee-400">{dateTR(i.createdAt.slice(0, 10))}</p>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {!visible.length ? <p className="text-sm text-coffee-500">Açık bulgu yok.</p> : null}
      </CardContent>
      {editing ? <FindingDialog item={editing === "new" ? null : editing} sections={[...new Set(items.map((i) => i.section))]} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function FindingDialog({
  item,
  sections,
  onClose,
}: {
  item: { id: number; section: string; title: string; detail: string | null } | null;
  sections: string[];
  onClose: () => void;
}) {
  const [section, setSection] = useState(item?.section ?? sections[0] ?? "Genel");
  const [title, setTitle] = useState(item?.title ?? "");
  const [detail, setDetail] = useState(item?.detail ?? "");
  return (
    <Dialog open onClose={onClose} title={item ? "Bulguyu düzenle" : "Bulgu ekle"}>
      <div className="space-y-3">
        <Field label="Bölüm" htmlFor="fd-s">
          <Input id="fd-s" list="finding-sections" value={section} onChange={(e) => setSection(e.target.value)} />
          <datalist id="finding-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Başlık" htmlFor="fd-t">
          <Input id="fd-t" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Ayrıntı" htmlFor="fd-d">
          <Textarea id="fd-d" value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
        </Field>
        <div className="flex items-center justify-between gap-2">
          {item ? (
            <Button
              variant="ghost"
              className="text-rose-700 hover:bg-rose-50"
              onClick={async () => {
                const res = await deleteFinding(item.id);
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
                const res = await saveFinding({ id: item?.id ?? null, section, title, detail });
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
