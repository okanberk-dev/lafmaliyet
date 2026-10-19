"use client";

import { CheckCircle2, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { parseNumberTR } from "@/lib/calc/expr";
import type { Invoice } from "@/lib/calc/types";
import { GOODS_CATEGORIES, INVOICE_CATEGORIES } from "@/lib/constants";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { deleteInvoice, saveInvoice, setInvoicePaid } from "@/server/actions/invoices";

const CAT_TONE: Record<string, "green" | "coffee" | "blue" | "amber" | "gray" | "violet"> = {
  "Hammadde & İçecek": "green",
  "Tatlı & Hazır Ürün": "green",
  Ambalaj: "green",
  "Kira & AVM": "coffee",
  "Kuruluş & Demirbaş": "violet",
  "Yazılım & POS": "blue",
  "Reklam & Tabela": "amber",
  Komisyon: "amber",
};

export function InvoicesClient({
  invoices,
  months,
  suppliers,
  initialUnpaid,
}: {
  invoices: Invoice[];
  months: string[];
  suppliers: string[];
  initialUnpaid: boolean;
}) {
  const [q, setQ] = useState("");
  const [month, setMonth] = useState("");
  const [category, setCategory] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(initialUnpaid);
  const [editing, setEditing] = useState<Invoice | "new" | null>(null);

  const visible = invoices.filter(
    (i) =>
      (!month || i.date.startsWith(month)) &&
      (!category || i.category === category) &&
      (!unpaidOnly || i.unpaid) &&
      matchesSearch(`${i.supplier} ${i.description ?? ""} ${i.invoiceNo ?? ""} ${i.note ?? ""}`, q),
  );
  const sum = (f: (i: Invoice) => number) => visible.reduce((a, i) => a + f(i), 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-coffee-100 p-3">
        <div className="relative min-w-48 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tedarikçi, fatura no ara…" className="pl-9" />
        </div>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} className="w-auto min-w-36" aria-label="Ay">
          <option value="">Tüm aylar</option>
          {[...months].reverse().map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-44" aria-label="Kategori">
          <option value="">Tüm kategoriler</option>
          {INVOICE_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Checkbox label="Sadece ödenmemiş" checked={unpaidOnly} onChange={(e) => setUnpaidOnly(e.target.checked)} className="px-2" />
        <Button onClick={() => setEditing("new")}>
          <Plus size={16} /> Fatura ekle
        </Button>
      </div>
      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>Tarih</TH>
                <TH>Tedarikçi</TH>
                <TH>Fatura no</TH>
                <TH>Kategori</TH>
                <TH numeric>Tutar</TH>
                <TH numeric>İskonto</TH>
                <TH numeric>
                  Net (KDV hariç) <InfoTip text="Mal/hizmet tutarı − iskonto. KDV'yi indirebildiğiniz için gerçek maliyetiniz budur." className="ml-1" />
                </TH>
                <TH numeric>KDV</TH>
                <TH numeric>Ödenecek</TH>
                <TH>Durum</TH>
              </tr>
            </THead>
            <tbody>
              {visible.map((i) => (
                <TR key={i.id} className="cursor-pointer" onClick={() => setEditing(i)}>
                  <TD className="whitespace-nowrap tabular">{dateTR(i.date)}</TD>
                  <TD>
                    <span className="font-medium">{i.supplier}</span>
                    {i.description ? <span className="block text-xs text-coffee-500">{i.description}</span> : null}
                  </TD>
                  <TD className="text-xs text-coffee-600 tabular">{i.invoiceNo ?? "–"}</TD>
                  <TD>
                    <Badge tone={CAT_TONE[i.category] ?? "gray"}>{i.category}</Badge>
                  </TD>
                  <TD numeric>{tl(i.amount, 2)}</TD>
                  <TD numeric className={cn(!i.discount && "text-coffee-300")}>{i.discount ? tl(i.discount, 2) : "–"}</TD>
                  <TD numeric className="font-medium">{tl(i.amount - i.discount, 2)}</TD>
                  <TD numeric className="text-coffee-600">{tl(i.payable - (i.amount - i.discount), 2)}</TD>
                  <TD numeric>{tl(i.payable, 2)}</TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    {i.unpaid ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await setInvoicePaid(i.id, true);
                          if (res.ok) toast.success("Ödendi olarak işaretlendi");
                          else toast.error(res.error);
                        }}
                        title="Ödendi olarak işaretle"
                      >
                        <Badge tone="red">Ödenmedi</Badge>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={14} /> Ödendi
                      </span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
                <td className="px-3 py-2 text-sm" colSpan={4}>
                  {visible.length} fatura
                </td>
                <td className="px-3 py-2 text-right tabular">{tl(sum((i) => i.amount))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(sum((i) => i.discount))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(sum((i) => i.amount - i.discount))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(sum((i) => i.payable - i.amount + i.discount))}</td>
                <td className="px-3 py-2 text-right tabular">{tl(sum((i) => i.payable))}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </TableWrap>
      ) : (
        <EmptyState title="Fatura bulunamadı" description="Filtreleri değiştirin ya da yeni fatura ekleyin." />
      )}
      {editing ? <InvoiceDialog invoice={editing === "new" ? null : editing} suppliers={suppliers} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function InvoiceDialog({ invoice, suppliers, onClose }: { invoice: Invoice | null; suppliers: string[]; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    date: invoice?.date ?? today,
    supplier: invoice?.supplier ?? "",
    description: invoice?.description ?? "",
    invoiceNo: invoice?.invoiceNo ?? "",
    category: invoice?.category ?? "Hammadde & İçecek",
    amount: invoice ? num(invoice.amount, 2) : "",
    discount: invoice ? num(invoice.discount, 2) : "0",
    payable: invoice ? num(invoice.payable, 2) : "",
    vatRate: "1",
    unpaid: invoice?.unpaid ?? false,
    note: invoice?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const amount = parseNumberTR(f.amount) ?? 0;
  const discount = parseNumberTR(f.discount) ?? 0;
  const net = amount - discount;
  const payable = parseNumberTR(f.payable);

  return (
    <Dialog open onClose={onClose} size="lg" title={invoice ? "Faturayı düzenle" : "Fatura ekle"} description="Tutarlar faturadaki gibi: mal/hizmet tutarı, iskonto ve KDV dahil ödenecek tutar.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tarih" htmlFor="f-date">
          <Input id="f-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Fatura no" htmlFor="f-no">
          <Input id="f-no" value={f.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
        </Field>
        <Field label="Tedarikçi" htmlFor="f-sup" hint="Aynı tedarikçi adını kullanın; gelir-giderde birlikte toplanır.">
          <Input id="f-sup" list="supplier-list" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} />
          <datalist id="supplier-list">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="Açıklama" htmlFor="f-desc">
          <Input id="f-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="ör. Eylül kira, tatlı, süt" />
        </Field>
        <Field label="Kategori" htmlFor="f-cat" hint={GOODS_CATEGORIES.includes(f.category) ? "Mal maliyeti sayılır" : f.category === "Komisyon" ? "Komisyon giderlerine eklenir" : "Gelir-gider tablosuna eklenmez (sabit giderlerden izlenir)"}>
          <Select id="f-cat" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            {INVOICE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Mal / hizmet tutarı (₺)" htmlFor="f-amt">
          <NumberInput id="f-amt" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="cell-input" />
        </Field>
        <Field label="İskonto (₺)" htmlFor="f-disc">
          <NumberInput id="f-disc" value={f.discount} onChange={(e) => set({ discount: e.target.value })} className="cell-input" />
        </Field>
        <Field label="Ödenecek, KDV dahil (₺)" htmlFor="f-pay" hint={`Net ${tl(net, 2)} · KDV ${payable !== null ? tl(payable - net, 2) : "–"}`}>
          <div className="flex gap-2">
            <NumberInput id="f-pay" value={f.payable} onChange={(e) => set({ payable: e.target.value })} className="cell-input" />
            <Select value={f.vatRate} onChange={(e) => set({ vatRate: e.target.value })} className="w-24" aria-label="KDV oranı">
              {["1", "10", "20"].map((v) => (
                <option key={v} value={v}>
                  %{v}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => set({ payable: num(net * (1 + Number(f.vatRate) / 100), 2) })} title="Net tutar + seçilen KDV">
              Hesapla
            </Button>
          </div>
        </Field>
        <Field label="Not" className="sm:col-span-2" htmlFor="f-note">
          <Textarea id="f-note" value={f.note} onChange={(e) => set({ note: e.target.value })} rows={2} />
        </Field>
        <Checkbox label="Ödenmedi" checked={f.unpaid} onChange={(e) => set({ unpaid: e.target.checked })} />
      </div>
      <div className="mt-6 flex items-center justify-between gap-2 border-t border-coffee-100 pt-4">
        {invoice ? (
          <Button
            variant="ghost"
            className="text-rose-700 hover:bg-rose-50"
            onClick={async () => {
              const res = await deleteInvoice(invoice.id);
              if (!res.ok) return toast.error(res.error);
              toast.success("Fatura silindi");
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
            disabled={busy}
            onClick={async () => {
              if (!f.supplier.trim()) return toast.error("Tedarikçi girin");
              setBusy(true);
              const res = await saveInvoice({
                id: invoice?.id ?? null,
                date: f.date,
                supplier: f.supplier,
                description: f.description,
                invoiceNo: f.invoiceNo,
                category: f.category,
                amount,
                discount,
                payable: payable ?? net,
                unpaid: f.unpaid,
                note: f.note,
              });
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              toast.success("Fatura kaydedildi");
              onClose();
            }}
          >
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
