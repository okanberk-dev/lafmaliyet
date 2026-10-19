"use client";

import { Check, ClipboardPaste, FileUp, Pencil, Plus, Search, Trash2, Upload, Wand2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { normalizePosName } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { num, pct, tl } from "@/lib/format";
import { cn, matchesSearch } from "@/lib/utils";
import { clearMonthSales, deleteLine, importSales, parseSalesFile, saveLine, saveMonthInfo, setLineMatch } from "@/server/actions/sales";

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

// ---------------------------------------------------------------- Ay bilgisi

export function MonthInfoForm({
  month,
  label,
  info,
  listTotal,
}: {
  month: string;
  label: string;
  info: { openDays: number | null; posRevenue: number | null; discounts: number; offRevenue: number; note: string | null };
  listTotal: number;
}) {
  const [openDays, setOpenDays] = useState(info.openDays === null ? "" : String(info.openDays));
  const [pos, setPos] = useState(info.posRevenue === null ? "" : num(info.posRevenue, 2));
  const [disc, setDisc] = useState(num(info.discounts, 2));
  const [off, setOff] = useState(num(info.offRevenue, 2));
  const [note, setNote] = useState(info.note ?? "");
  const [busy, setBusy] = useState(false);

  const posNum = parseNumberTR(pos);
  const discNum = parseNumberTR(disc) ?? 0;
  const diff = posNum !== null && listTotal ? listTotal - discNum - posNum : null;

  async function save() {
    setBusy(true);
    const res = await saveMonthInfo({
      month,
      openDays: openDays.trim() ? Number(openDays) : null,
      posRevenue: posNum,
      discounts: discNum,
      offRevenue: parseNumberTR(off) ?? 0,
      note,
    });
    setBusy(false);
    if (res.ok) toast.success("Ay bilgileri kaydedildi");
    else toast.error(res.error);
  }

  return (
    <Card>
      <CardHeader title={`${label} bilgileri`} description="Patron > Raporlar > Ciro ekranından. Gelir-gider tablosu bu ciroyu kullanır." />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="POS ciro (KDV dahil)" htmlFor="m-pos" hint="İndirimler düşülmüş, ödenmezler hariç">
            <NumberInput id="m-pos" value={pos} onChange={(e) => setPos(e.target.value)} className="cell-input" />
          </Field>
          <Field label="Açık gün sayısı" htmlFor="m-days" hint="Sabit giderler bu oranla bölünür">
            <NumberInput id="m-days" value={openDays} onChange={(e) => setOpenDays(e.target.value.replace(/\D/g, ""))} className="cell-input" />
          </Field>
          <Field label="Yönetici indirimleri" htmlFor="m-disc" hint="KDV dahil (Patron > İndirim)">
            <NumberInput id="m-disc" value={disc} onChange={(e) => setDisc(e.target.value)} className="cell-input" />
          </Field>
          <Field label="Ciro dışı (ödenmez / ikram)" htmlFor="m-off" hint="Malzemesi harcanan, geliri olmayan">
            <NumberInput id="m-off" value={off} onChange={(e) => setOff(e.target.value)} className="cell-input" />
          </Field>
        </div>
        <Field label="Not" htmlFor="m-note">
          <Textarea id="m-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        {diff !== null ? (
          <div className={cn("rounded-lg px-3 py-2 text-xs", Math.abs(diff) < 1000 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900")}>
            Ürün listesi {tl(listTotal)} − indirim {tl(discNum)} = {tl(listTotal - discNum)} · POS cirosu ile fark {tl(diff)}{" "}
            {Math.abs(diff) < 1000 ? "✓ tutarlı" : "— kontrol edin"}
          </div>
        ) : null}
        <Button onClick={save} disabled={busy} className="w-full">
          {busy ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- Eşleştirme önerisi

const SIZE_WORDS: Record<string, string> = { LARGE: "L", L: "L", MEDIUM: "M", M: "M", SMALL: "M" };

function tokens(s: string): string[] {
  return normalizePosName(s)
    .replace(/İ/g, "I")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t === "ICED" ? "ICE" : t === "CAFFE" || t === "CAFE" ? "" : t === "CH" ? "CHOC" : t))
    .filter(Boolean);
}

/** Yalnızca kelimeleri birebir aynı (boy hariç) ürünü önerir; benzer ama farklı ürünlerde yanlış eşleşmeyi önler. */
export function suggestProduct(posName: string, products: ProductOption[]): ProductOption | null {
  const toks = tokens(posName);
  let size: string | null = null;
  const last = toks[toks.length - 1];
  if (last && SIZE_WORDS[last]) {
    size = SIZE_WORDS[last];
    toks.pop();
  }
  if (!toks.length) return null;
  const key = [...new Set(toks)].sort().join(" ");
  const candidates = products.filter((p) => p.active && [...new Set(tokens(p.name))].sort().join(" ") === key);
  if (!candidates.length) return null;
  return candidates.find((p) => p.size === (size ?? "Tek")) ?? (candidates.length === 1 && !size ? candidates[0] : null);
}

// ---------------------------------------------------------------- Ürün seçici

function ProductPicker({
  open,
  onClose,
  products,
  title,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  products: ProductOption[];
  title: string;
  onPick: (v: { productId: number | null; isService: boolean }) => void;
}) {
  const [q, setQ] = useState("");
  const list = products.filter((p) => matchesSearch(`${p.name} ${p.size} ${p.category}`, q)).slice(0, 80);
  return (
    <Dialog open={open} onClose={onClose} title="Ürünle eşleştir" description={title} size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Menüde ara…" className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onPick({ productId: null, isService: true })}>
            HİZMET (maliyetsiz, ör. karaoke)
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onPick({ productId: null, isService: false })}>
            <X size={14} /> Eşleşmeyi kaldır
          </Button>
        </div>
        <ul className="max-h-80 divide-y divide-coffee-50 overflow-y-auto rounded-lg border border-coffee-100">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-coffee-50"
                onClick={() => onPick({ productId: p.id, isService: false })}
              >
                <span>
                  <span className="font-medium">{p.name}</span> <Badge tone="coffee">{p.size}</Badge>
                  <span className="block text-xs text-coffee-500">{p.category}</span>
                </span>
                <span className="text-xs text-coffee-500 tabular">
                  {tl(p.price)} · maliyet {tl(p.cost, 2)}
                </span>
              </button>
            </li>
          ))}
          {!list.length ? <li className="px-3 py-4 text-sm text-coffee-500">Sonuç yok. Ürün yoksa önce Ürünler sayfasından ekleyin.</li> : null}
        </ul>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Satış tablosu

export function SalesTable({
  rows,
  products,
  month,
  initialFilter,
  totals,
}: {
  rows: SalesRow[];
  products: ProductOption[];
  month: string;
  initialFilter: "all" | "unmatched" | "service";
  totals: { qty: number; revenue: number; net: number; cost: number; commission: number; grossProfit: number; margin: number };
}) {
  const [filter, setFilter] = useState(initialFilter);
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState<SalesRow | null>(null);
  const [editing, setEditing] = useState<Partial<SalesRow> | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const visible = rows.filter(
    (r) =>
      (filter === "all" || (filter === "unmatched" ? !r.matched && !r.isService : r.isService)) && matchesSearch(`${r.posName} ${r.productLabel ?? ""}`, q),
  );
  const unmatchedCount = rows.filter((r) => !r.matched && !r.isService).length;

  async function pick(row: SalesRow, v: { productId: number | null; isService: boolean }) {
    setPicking(null);
    const res = await setLineMatch(row.id, v.productId, v.isService);
    if (res.ok) toast.success(v.isService ? "HİZMET olarak işaretlendi" : v.productId ? "Eşleştirildi, bu ad sonraki aylarda otomatik tanınacak" : "Eşleşme kaldırıldı");
    else toast.error(res.error);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-coffee-100 p-3">
        <div className="flex rounded-lg bg-coffee-50 p-1 text-sm">
          {(
            [
              ["all", `Tümü (${rows.length})`],
              ["unmatched", `Eşleşmeyen (${unmatchedCount})`],
              ["service", `Hizmet (${rows.filter((r) => r.isService).length})`],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn("rounded-md px-3 py-1.5 font-medium", filter === k ? "bg-white text-coffee-950 shadow-sm" : "text-coffee-600 hover:text-coffee-900")}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="relative min-w-48 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-coffee-300" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="POS ürün adı ara…" className="pl-9" />
        </div>
        <Button variant="outline" onClick={() => setEditing({ posName: "", qty: 1, revenue: 0 })}>
          <Plus size={16} /> Satır ekle
        </Button>
        {rows.length ? (
          <Button variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => setConfirmClear(true)}>
            <Trash2 size={16} /> Ayı temizle
          </Button>
        ) : null}
      </div>
      {visible.length ? (
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <TH>POS ürün adı</TH>
                <TH numeric>Adet</TH>
                <TH numeric>Ciro (KDV dahil)</TH>
                <TH>
                  Eşleşen ürün <InfoTip text="Tıklayıp menüdeki ürünü seçin. HİZMET = karaoke gibi maliyetsiz satış." className="ml-1" />
                </TH>
                <TH numeric>Birim maliyet</TH>
                <TH numeric>Net ciro</TH>
                <TH numeric>
                  Malzeme + ambalaj <InfoTip text="Eşleşenlerde adet × birim maliyet; eşleşmeyenlerde net ciro × ortalama maliyet oranı." className="ml-1" />
                </TH>
                <TH numeric>POS kom.</TH>
                <TH numeric>Brüt kâr</TH>
                <TH numeric>Marj</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {visible.map((r) => {
                const suggestion = !r.matched && !r.isService ? suggestProduct(r.posName, products) : null;
                const priceGap = r.menuPrice && r.avgPrice ? r.avgPrice / r.menuPrice - 1 : 0;
                return (
                  <TR key={r.id}>
                    <TD className="max-w-64">
                      <span className="font-medium">{r.posName}</span>
                      {r.note ? <span className="block truncate text-xs text-coffee-500" title={r.note}>{r.note}</span> : null}
                    </TD>
                    <TD numeric>{num(r.qty)}</TD>
                    <TD numeric>
                      {tl(r.revenue)}
                      {Math.abs(priceGap) > 0.03 ? (
                        <span className="block text-[11px] text-amber-700" title="Ortalama satış fiyatı menü fiyatından farklı">
                          ort. {tl(r.avgPrice)} ({priceGap > 0 ? "+" : ""}
                          {pct(priceGap, 0)})
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPicking(r)}
                          className={cn(
                            "rounded-md border px-2 py-1 text-left text-xs font-medium transition",
                            r.isService
                              ? "border-violet-200 bg-violet-50 text-violet-800"
                              : r.matched
                                ? "border-coffee-200 bg-white text-coffee-900 hover:border-coffee-400"
                                : "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400",
                          )}
                        >
                          {r.isService ? "HİZMET" : (r.productLabel ?? "Eşleşmedi — seç")}
                        </button>
                        {suggestion ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-xs text-sky-800 hover:bg-sky-100"
                            onClick={() => pick(r, { productId: suggestion.id, isService: false })}
                            title="Önerilen eşleşmeyi uygula"
                          >
                            <Wand2 size={12} /> {suggestion.name} · {suggestion.size}
                          </button>
                        ) : null}
                      </div>
                    </TD>
                    <TD numeric>{r.unitCost !== null ? tl(r.unitCost, 2) : "–"}</TD>
                    <TD numeric>{tl(r.net)}</TD>
                    <TD numeric className={cn(!r.matched && !r.isService && "text-amber-700")}>{tl(r.cost)}</TD>
                    <TD numeric>{tl(r.commission)}</TD>
                    <TD numeric className={cn(r.grossProfit < 0 && "text-rose-700")}>{tl(r.grossProfit)}</TD>
                    <TD numeric>{pct(r.margin, 0)}</TD>
                    <TD>
                      <div className="flex justify-end gap-0.5">
                        <button type="button" className="rounded p-1 text-coffee-400 hover:bg-coffee-50 hover:text-coffee-800" onClick={() => setEditing(r)} aria-label="Düzenle">
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-coffee-400 hover:bg-rose-50 hover:text-rose-700"
                          aria-label="Sil"
                          onClick={async () => {
                            const res = await deleteLine(r.id);
                            if (!res.ok) toast.error(res.error);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
            {filter === "all" && !q ? (
              <tfoot>
                <tr className="border-t border-coffee-100 bg-coffee-50/60 font-semibold">
                  <td className="px-3 py-2 text-sm">TOPLAM</td>
                  <td className="px-3 py-2 text-right tabular">{num(totals.qty)}</td>
                  <td className="px-3 py-2 text-right tabular">{tl(totals.revenue)}</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right tabular">{tl(totals.net)}</td>
                  <td className="px-3 py-2 text-right tabular">{tl(totals.cost)}</td>
                  <td className="px-3 py-2 text-right tabular">{tl(totals.commission)}</td>
                  <td className="px-3 py-2 text-right tabular">{tl(totals.grossProfit)}</td>
                  <td className="px-3 py-2 text-right tabular">{pct(totals.margin, 0)}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </Table>
        </TableWrap>
      ) : (
        <EmptyState
          icon={<Upload size={32} />}
          title={rows.length ? "Bu filtrede satır yok" : "Bu ay için satış raporu yok"}
          description={rows.length ? undefined : "Patron > Raporlar > Satış ekranından ürün listesini kopyalayıp 'Satış raporu yükle' ile yapıştırın."}
        />
      )}

      <ProductPicker
        open={!!picking}
        onClose={() => setPicking(null)}
        products={products}
        title={picking ? `${picking.posName} (${num(picking.qty)} adet)` : ""}
        onPick={(v) => picking && pick(picking, v)}
      />
      {editing ? <LineDialog line={editing} month={month} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Bu ayın satış satırları silinsin mi?"
        description="Ay bilgileri (ciro, açık gün) kalır. Eşleştirme hafızası silinmez."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Vazgeç
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const res = await clearMonthSales(month);
                setConfirmClear(false);
                if (res.ok) toast.success("Satırlar silindi");
                else toast.error(res.error);
              }}
            >
              Sil
            </Button>
          </>
        }
      >
        <p className="text-sm text-coffee-700">{rows.length} satır silinecek.</p>
      </Dialog>
    </Card>
  );
}

function LineDialog({ line, month, onClose }: { line: Partial<SalesRow>; month: string; onClose: () => void }) {
  const [posName, setPosName] = useState(line.posName ?? "");
  const [qty, setQty] = useState(num(line.qty ?? 1, 2));
  const [revenue, setRevenue] = useState(num(line.revenue ?? 0, 2));
  const [note, setNote] = useState(line.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={line.id ? "Satırı düzenle" : "Satır ekle"}>
      <div className="space-y-3">
        <Field label="POS ürün adı" htmlFor="l-name">
          <Input id="l-name" value={posName} onChange={(e) => setPosName(e.target.value)} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Adet" htmlFor="l-qty">
            <NumberInput id="l-qty" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Ciro (KDV dahil)" htmlFor="l-rev">
            <NumberInput id="l-rev" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
          </Field>
        </div>
        <Field label="Not" htmlFor="l-note">
          <Input id="l-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await saveLine({ id: line.id ?? null, month, posName, qty: parseNumberTR(qty) ?? 0, revenue: parseNumberTR(revenue) ?? 0, note });
              setBusy(false);
              if (!res.ok) return toast.error(res.error);
              toast.success("Kaydedildi");
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

// ---------------------------------------------------------------- İçe aktarma

function parsePasted(text: string): { posName: string; qty: number; revenue: number }[] {
  const out: { posName: string; qty: number; revenue: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : line.split(/\s{2,}|,(?=\s*\d)/);
    const cells = parts.map((p) => p.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const nums = cells.slice(1).map((c) => parseNumberTR(c));
    const qty = nums[0];
    const revenue = nums[1];
    if (qty === null || qty === undefined || revenue === null || revenue === undefined) continue;
    out.push({ posName: cells[0], qty, revenue });
  }
  return out;
}

export function ImportButton({
  month,
  hasLines,
  mappings,
  products,
}: {
  month: string;
  hasLines: boolean;
  mappings: { posName: string; productId: number | null; isService: boolean }[];
  products: ProductOption[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<{ posName: string; qty: number; revenue: number }[]>([]);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const map = useMemo(() => new Map(mappings.map((m) => [m.posName, m])), [mappings]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const preview = rows.map((r) => {
    const m = map.get(normalizePosName(r.posName));
    const p = m?.productId ? productById.get(m.productId) : undefined;
    return { ...r, status: m?.isService ? "service" : p ? "matched" : "new", label: m?.isService ? "HİZMET" : p ? `${p.name} · ${p.size}` : null };
  });
  const totals = preview.reduce((a, r) => ({ qty: a.qty + r.qty, revenue: a.revenue + r.revenue }), { qty: 0, revenue: 0 });

  async function onFile(f: File) {
    const fd = new FormData();
    fd.set("file", f);
    setBusy(true);
    const res = await parseSalesFile(fd);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setRows(res.data);
    toast.success(`${res.data.length} satır okundu`);
  }

  async function submit() {
    setBusy(true);
    const res = await importSales({ month, lines: rows, mode });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${res.data.count} satır yüklendi, ${res.data.matched} tanesi otomatik eşleşti`);
    setOpen(false);
    setRows([]);
    setText("");
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload size={16} /> Satış raporu yükle
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="xl" title="Satış raporu yükle" description="Patron > Raporlar > Satış: ürün adı, adet ve ciro (KDV dahil) sütunlarını kopyalayıp yapıştırın ya da dosyayı seçin.">
        <div className="space-y-4">
          {!rows.length ? (
            <>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder={"L'AFFOGATO LARGE\t265\t79.500\nICED AMERICANO MEDİUM\t172\t29.770\n…"}
                className="font-mono text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    const r = parsePasted(text);
                    if (!r.length) return toast.error("Satır okunamadı. Her satırda ürün adı, adet ve ciro olmalı.");
                    setRows(r);
                  }}
                  disabled={!text.trim()}
                >
                  <ClipboardPaste size={16} /> Yapıştırılanı oku
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <FileUp size={16} /> {busy ? "Okunuyor…" : "Dosya seç (.xlsx, .csv)"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge tone="green">{preview.filter((p) => p.status === "matched").length} eşleşti</Badge>
                <Badge tone="violet">{preview.filter((p) => p.status === "service").length} hizmet</Badge>
                <Badge tone="amber">{preview.filter((p) => p.status === "new").length} yeni ad</Badge>
                <span className="text-coffee-600">
                  Toplam {num(totals.qty)} adet · {tl(totals.revenue)}
                </span>
                <button type="button" className="ml-auto text-sm text-coffee-600 underline" onClick={() => setRows([])}>
                  Baştan başla
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-coffee-100">
                <Table>
                  <THead>
                    <tr>
                      <TH>POS ürün adı</TH>
                      <TH numeric>Adet</TH>
                      <TH numeric>Ciro</TH>
                      <TH>Eşleşme</TH>
                    </tr>
                  </THead>
                  <tbody>
                    {preview.map((r, i) => (
                      <TR key={i}>
                        <TD>{r.posName}</TD>
                        <TD numeric>{num(r.qty)}</TD>
                        <TD numeric>{tl(r.revenue)}</TD>
                        <TD>
                          {r.status === "new" ? (
                            <span className="text-xs text-amber-700">Yükledikten sonra eşleştirin</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <Check size={12} /> {r.label}
                            </span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-coffee-800" />
                    {hasLines ? "Bu ayın mevcut satırlarını değiştir" : "Yükle"}
                  </label>
                  {hasLines ? (
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={mode === "append"} onChange={() => setMode("append")} className="accent-coffee-800" />
                      Mevcut satırlara ekle
                    </label>
                  ) : null}
                </div>
                <Button onClick={submit} disabled={busy}>
                  {busy ? "Yükleniyor…" : `${rows.length} satırı yükle`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
