"use client";

import { ArrowRightLeft, Camera, Megaphone, Pencil, Plus, ReceiptText, Tags, Trash2, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ExpenseBranchField, expenseBranchName, type ExpenseBranchChoice } from "@/components/panel/expense-branch-field";
import { PhotoThumb } from "@/components/panel/photo-picker";
import { PhotoViewer } from "@/components/panel/photo-viewer";
import { useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, NumberInput, Select, Textarea } from "@/components/ui/form";
import { EmptyState, InfoTip, Stat } from "@/components/ui/misc";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { StatBreakdown } from "@/components/ui/stat-breakdown";
import { Switch } from "@/components/ui/switch";
import { EXPENSE_SHARED } from "@/lib/branches";
import { parseNumberTR } from "@/lib/calc/expr";
import { PANEL_FIXED_GROUPS } from "@/lib/constants";
import { dateTR, monthLabel, num, tl } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { cn } from "@/lib/utils";
import {
  convertFixedToMonthly,
  deleteExpenseCategory,
  deleteExpenseEntry,
  restoreExpenseEntry,
  saveExpenseCategory,
  saveExpenseEntry,
} from "@/server/actions/expenses";

import { expenseBreakdowns, missingCategories } from "./summary";

type Section = "mal" | "personel" | "faturalar" | "kira" | "genel";
type Group = "kira" | "personel" | "reklam" | "diger";
type Method = "nakit" | "kart" | "havale" | "diger";

export interface CategoryRow {
  id: number;
  name: string;
  section: Section;
  panelGroup: Group;
  invoiceCategory: string | null;
  monthly: boolean;
  active: boolean;
  /** Bu ay girilmesi bekleniyor mu ("her ay" ve ilk kaydından sonraki aylar) */
  expected: boolean;
  /** Bütün aylardaki kayıt sayısı (silinebilir mi) */
  entryCount: number;
  monthEntries: number;
  monthInvoices: number;
  /** Ayın toplamı: "Tümü"de girilenler + bağlı faturalar; şube seçiliyken yalnız şubenin kendi kayıtları (`expenseSplit`) */
  monthTotal: number;
  prevTotal: number;
  /** Şube seçiliyken işletme geneli kısım (şubesi boş kayıtlar ve bağlı faturalar; toplama girmez); "Tümü"de 0 */
  sharedTotal: number;
}
export interface EntryRow {
  id: number;
  date: string;
  categoryId: number;
  description: string | null;
  amount: number;
  paymentMethod: Method | null;
  note: string | null;
  /** Fişin fotoğrafı (kasadan çıkan bir fişten yazıldıysa) */
  photoId?: number | null;
  /** Fişteki KDV (bilgi) */
  vat?: number | null;
  /** Bağlı kasadan çıkan satırı ve kasa günü: tutar ve tarih orada düzeltilir */
  cashOutId?: number | null;
  cashOutDate?: string | null;
  /** Sahibi bir cari borç (faturasız alımın gideri): tedarikçi ve sayfası; tutar, gün ve kategori orada düzeltilir */
  cari?: { name: string; href: string | null } | null;
  /** Giderin şubesi; null = işletme geneli */
  branchId?: string | null;
  /** Şube seçiliyken işletme geneli kayıt (şubesi boş): satırda rozet, şubenin toplamına girmez */
  shared?: boolean;
}

export interface InvoiceItem {
  id: number;
  date: string;
  supplier: string;
  net: number;
  categoryId: number;
  invoiceCategory: string;
}
export interface FixedCandidate {
  id: number;
  name: string;
  section: string;
  group: Group;
  amount: number;
}

const SECTION_LABEL: Record<Section, string> = {
  mal: "Mal maliyeti (nakit / market alımı)",
  personel: "Personel giderleri",
  faturalar: "Fatura giderleri (elektrik, su…)",
  kira: "Kira giderleri",
  genel: "İşletme genel giderleri",
};
const SECTION_SHORT: Record<Section, string> = { mal: "Mal maliyeti", personel: "Personel", faturalar: "Faturalar", kira: "Kira", genel: "Genel gider" };
const GROUP_LABEL: Record<Group, string> = Object.fromEntries(PANEL_FIXED_GROUPS.map((g) => [g.key, g.label])) as Record<Group, string>;
const METHODS: { value: Method; label: string }[] = [
  { value: "nakit", label: "Nakit" },
  { value: "kart", label: "Kart" },
  { value: "havale", label: "Havale/EFT" },
  { value: "diger", label: "Diğer" },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<Method, string>;

/** Yerel saatle bugün (YYYY-AA-GG) */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const moneyText = (v: number) => (v ? num(v, 2).replace(/,00$/, "") : "");

type EntryDraft = {
  id: number | null;
  date: string;
  categoryId: string;
  description: string;
  amount: string;
  paymentMethod: Method | null;
  note: string;
  /** Kasadan çıkan fişten: fotoğrafı ve kasa günü (tutar ve tarih orada düzeltilir) */
  photoId?: number | null;
  cashOutDate?: string | null;
  /** Cari borcun gideri: tutar, tarih ve kategori Tedarikçiler'de düzeltilir */
  cari?: { name: string; href: string | null } | null;
  /** Şube kimliği ya da "isletme" (işletme geneli) */
  branchId: string;
};

/**
 * Aylık harcamalar: hızlı ekleme, ayın harcamaları (kategori kategori; bağlı faturalar dahil), kategoriler ve
 * her ay aynı sayılan sabit giderleri aylık girişe çevirme.
 */
export function MonthlyExpenses({
  month,
  isCurrent,
  categories,
  entries,
  invoices,
  fixed,
  invoiceCategories,
  branches,
  branchName: viewBranch = null,
}: {
  month: string;
  isCurrent: boolean;
  /** Seçili şube (şube görünümü); "Tümü"de null. Toplam şubenin kendi kayıtları, işletme geneli ayrı (expenseSplit) */
  branchName?: string | null;
  categories: CategoryRow[];
  entries: EntryRow[];
  invoices: InvoiceItem[];
  fixed: FixedCandidate[];
  invoiceCategories: string[];
  branches: ExpenseBranchChoice;
}) {
  const [pending, start] = useActionTransition();
  const defaultDate = isCurrent ? localToday() : `${month}-01`;
  const active = categories.filter((c) => c.active);
  const blank = (categoryId = ""): EntryDraft => ({
    id: null,
    date: defaultDate,
    categoryId,
    description: "",
    amount: "",
    paymentMethod: null,
    note: "",
    branchId: branches.defaultId,
  });
  const branchName = (id: string) => expenseBranchName(branches, id);
  const [draft, setDraft] = useState<EntryDraft>(() => blank(active[0] ? String(active[0].id) : ""));
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [catEdit, setCatEdit] = useState<CategoryRow | "new" | null>(null);
  const [converting, setConverting] = useState<FixedCandidate | null>(null);
  const [showAllFixed, setShowAllFixed] = useState(false);

  const total = categories.reduce((a, c) => a + c.monthTotal, 0);
  const prevTotal = categories.reduce((a, c) => a + c.prevTotal, 0);
  const ads = categories.filter((c) => c.panelGroup === "reklam").reduce((a, c) => a + c.monthTotal, 0);
  const offInvoice = categories.reduce((a, c) => a + c.monthEntries, 0);
  const fromInvoices = categories.reduce((a, c) => a + c.monthInvoices, 0);
  const shared = categories.reduce((a, c) => a + c.sharedTotal, 0);
  const missing = missingCategories(categories);
  const shownFixed = showAllFixed ? fixed : fixed.filter((f) => f.group === "reklam");
  const breakdown = expenseBreakdowns(month, categories, entries, invoices, viewBranch !== null);

  const save = (d: EntryDraft, done: () => void) => {
    const amount = parseNumberTR(d.amount);
    if (!d.categoryId) return void toast.error("Kategori seçin");
    if (amount === null || !amount) return void toast.error("Tutarı yazın (ör. 12.500)");
    if (!d.date) return void toast.error("Tarih seçin");
    if (!d.date.startsWith(month) && !d.id) toast.message(`Tarih ${monthLabel(d.date.slice(0, 7))} ayında; o ayın harcamalarına yazılır`);
    start(async () => {
      const r = await saveExpenseEntry({
        id: d.id,
        date: d.date,
        categoryId: Number(d.categoryId),
        description: d.description,
        amount,
        paymentMethod: d.paymentMethod,
        note: d.note,
        branchId: d.branchId,
      });
      if (!r.ok) return void toast.error(r.error);
      const cat = categories.find((c) => c.id === Number(d.categoryId));
      toast.success(`${d.id ? "Düzeltildi" : "Eklendi"}: ${cat?.name ?? "harcama"} · ${tl(amount, 2)}${branches.ask ? ` · ${branchName(d.branchId)}` : ""}`);
      done();
    });
  };
  const remove = (e: EntryRow) =>
    start(async () => {
      const r = await deleteExpenseEntry(e.id);
      if (!r.ok) return void toast.error(r.error);
      setEditing(null);
      toast.success(`Silindi: ${tl(e.amount, 2)}${e.cashOutId ? " · kasa satırı kalır" : ""}`, {
        action: {
          label: "Geri al",
          onClick: () =>
            start(async () => {
              const x = await restoreExpenseEntry(r.data);
              if (!x.ok) return void toast.error(x.error);
              toast.success(`Geri alındı: ${tl(e.amount, 2)}`);
            }),
        },
      });
    });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save(draft, () => setDraft((d) => ({ ...blank(d.categoryId), date: d.date, paymentMethod: d.paymentMethod, branchId: d.branchId })));
  };

  return (
    <>
      {/* Kartlara dokununca rakamın dökümü açılır (kategori ya da kayıt kayıt) */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatBreakdown
          title={`${monthLabel(month)} harcamaları`}
          description="Kategori kategori: girilen harcamalar (ödenen tutar, KDV dahil) ve bağlı faturalar (KDV hariç)."
          groups={breakdown.total}
          total={total}
          exact
          empty="Bu ay harcama yok."
        >
          <Stat
            compact
            icon={<Wallet />}
            label={`${monthLabel(month)} toplamı`}
            value={tl(total)}
            sub={shared ? `İşletme geneli ${tl(shared)} ayrı` : prevTotal ? `Geçen ay ${tl(prevTotal)}` : "Geçen ay kayıt yok"}
            info="Bu sayfadaki bütün kategoriler: girilen harcamalar (ödenen tutar, KDV dahil; fişin KDV'si ayrılmaz) ve kategoriye bağlı faturalar (KDV hariç). Gelir-gider'de her kategori kendi satırında bu tutarla sayılır."
          />
        </StatBreakdown>
        <StatBreakdown
          title={`Reklam & influencer · ${monthLabel(month)}`}
          description="Reklam grubundaki kategoriler, kayıt kayıt. Faturaya dokununca Faturalar'da açılır."
          groups={breakdown.ads}
          total={ads}
          exact
          empty="Bu ay reklam harcaması yok."
        >
          <Stat compact icon={<Megaphone />} label="Reklam & influencer" value={tl(ads)} sub="“Para nereye gitti”de Reklam grubunda" />
        </StatBreakdown>
        <StatBreakdown
          title={`Fatura dışı · ${monthLabel(month)}`}
          description="Bu sayfada girilen harcamalar (ödenen tutar, KDV dahil), kategori kategori."
          groups={breakdown.offInvoice}
          total={offInvoice}
          exact
          empty="Bu ay girilmiş harcama yok."
        >
          <Stat compact icon={<ReceiptText />} label="Fatura dışı" value={tl(offInvoice)} sub="Bu sayfada girilenler, KDV dahil" />
        </StatBreakdown>
        <StatBreakdown
          title={`Faturadan · ${monthLabel(month)}`}
          description="Kategorilere bağlı fatura kategorilerinden (KDV hariç, iskonto düşülmüş). Faturaya dokununca Faturalar'da açılır."
          groups={breakdown.fromInvoices}
          total={fromInvoices}
          exact
          empty="Bu ay bağlı kategorilerden fatura yok."
        >
          <Stat
            compact
            icon={<Tags />}
            label="Faturadan"
            value={tl(fromInvoices)}
            sub={fromInvoices ? (viewBranch ? "İşletme geneli; şubenin toplamına girmez" : "Bağlı fatura kategorilerinden") : "Bağlı fatura yok"}
          />
        </StatBreakdown>
      </div>

      {viewBranch && shared ? (
        <Notice
          tone="neutral"
          size="sm"
          className="mb-4"
          title={`${viewBranch} seçili: toplam yalnız ${genitive(viewBranch)} harcamaları`}
          text={`Şubesi seçilmemiş harcamalar ve kategoriye bağlı faturalar işletme genelidir (${tl(shared)}): satırlarda “İşletme geneli” rozetiyle görünür, Gelir-gider'de “İşletme geneli payı (bilgi)” satırındadır. Hepsi için soldan Tümü'nü seçin.`}
        />
      ) : null}
      {missing.length ? (
        <Notice
          tone="warn"
          risk="para"
          live="polite"
          className="mb-4"
          title={`${missing.map((c) => c.name).join(", ")} ${monthLabel(month)} için girilmedi`}
          text="Girilmezse ayın gideri eksik görünür."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader icon={<Plus />} title="Harcama ekle" description="Reklam, influencer ödemesi, nakit alım, bakım… Fatura Paraşüt'ten geliyorsa buraya ayrıca yazmayın." />
          <CardContent>
            {active.length ? (
              <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
                <Field label="Kategori" htmlFor="x-cat" className="sm:col-span-2">
                  <Select
                    id="x-cat"
                    value={draft.categoryId}
                    onChange={(e) => (e.target.value === "__new" ? setCatEdit("new") : setDraft((d) => ({ ...d, categoryId: e.target.value })))}
                  >
                    {active.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    <option value="__new">＋ Yeni kategori…</option>
                  </Select>
                </Field>
                <Field label="Tutar (₺)" htmlFor="x-amt" tip="Ödenen tutar (KDV ayrılmaz). İade ya da düzeltme için eksi yazabilirsiniz.">
                  <NumberInput id="x-amt" inputMode="text" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="0" enterKeyHint="done" />
                </Field>
                <Field label="Tarih" htmlFor="x-date">
                  <Input id="x-date" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </Field>
                <Field label="Açıklama" htmlFor="x-desc" className="sm:col-span-2">
                  <Input
                    id="x-desc"
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="ör. @kahvesever story, Instagram kampanyası"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Ödeme" className="sm:col-span-2">
                  <Segmented<Method | "">
                    label="Ödeme şekli"
                    stretch
                    value={draft.paymentMethod ?? ""}
                    onChange={(v) => setDraft((d) => ({ ...d, paymentMethod: v === d.paymentMethod ? null : (v as Method) || null }))}
                    options={METHODS}
                  />
                </Field>
                {branches.ask ? (
                  <ExpenseBranchField
                    id="x-branch"
                    className="sm:col-span-2"
                    choice={branches}
                    value={draft.branchId}
                    onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
                  />
                ) : null}
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={pending} className="w-full sm:w-auto">
                    <Plus size={16} /> {pending ? "Kaydediliyor…" : "Ekle"}
                  </Button>
                </div>
              </form>
            ) : (
              <EmptyState
                title="Önce bir kategori ekleyin"
                description="ör. Reklam, Influencer, Nakit malzeme alımı"
                action={
                  <Button onClick={() => setCatEdit("new")}>
                    <Plus size={16} /> Kategori ekle
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader
            icon={<ReceiptText />}
            title={`${monthLabel(month)} harcamaları`}
            description="Kategori kategori. Faturadan gelenler Faturalar'da düzeltilir; buradakiler kalemin üstüne dokunarak."
            meta={<span className="font-semibold text-ink tabular">{tl(total)}</span>}
          />
          <CardContent className="space-y-3">
            {categories.filter((c) => c.monthTotal || c.sharedTotal || c.expected).length === 0 ? (
              <EmptyState title="Bu ay harcama yok" description="Soldan ekledikçe burada kategori kategori listelenir." />
            ) : (
              categories
                .filter((c) => c.monthTotal || c.sharedTotal || c.expected)
                .map((c) => {
                  const rows = entries.filter((e) => e.categoryId === c.id);
                  const invs = invoices.filter((i) => i.categoryId === c.id);
                  return (
                    <section key={c.id} className="rounded-2xl bg-surface px-3 py-2.5" aria-label={c.name}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
                          {c.name}
                          <Badge tone={c.panelGroup === "reklam" ? "violet" : c.section === "mal" ? "green" : "gray"}>
                            {c.panelGroup === "reklam" ? "Reklam" : SECTION_SHORT[c.section]}
                          </Badge>
                          {c.monthly ? <Badge tone="gray">her ay</Badge> : null}
                        </h3>
                        <p className="text-sm text-ink tabular">
                          <span className="font-semibold">{tl(c.monthTotal)}</span>
                          {c.sharedTotal ? <span className="ml-1.5 text-xs text-ink-mute">+ işletme geneli {tl(c.sharedTotal)}</span> : null}
                          {c.prevTotal ? <span className="ml-1.5 text-xs text-ink-mute">geçen ay {tl(c.prevTotal)}</span> : null}
                        </p>
                      </div>
                      <ul className="mt-1.5 divide-y divide-ink/[0.06]">
                        {rows.map((e) => (
                          <li key={e.id}>
                            <button
                              type="button"
                              onClick={() =>
                                setEditing({
                                  id: e.id,
                                  date: e.date,
                                  categoryId: String(e.categoryId),
                                  description: e.description ?? "",
                                  amount: moneyText(e.amount),
                                  paymentMethod: e.paymentMethod,
                                  note: e.note ?? "",
                                  photoId: e.photoId ?? null,
                                  cashOutDate: e.cashOutId ? (e.cashOutDate ?? e.date) : null,
                                  cari: e.cari ?? null,
                                  branchId: e.branchId ?? EXPENSE_SHARED,
                                })
                              }
                              className="flex w-full cursor-pointer items-start justify-between gap-3 py-2 text-left hover:bg-ink/[0.02] pointer-coarse:min-h-11"
                            >
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5 text-sm break-words text-ink">
                                  {e.description || "Harcama"}
                                  {e.photoId ? <Camera size={13} className="shrink-0 text-ink-mute" aria-label="Fişli" role="img" /> : null}
                                  {e.cashOutId ? <Badge tone="gray">Kasadan</Badge> : null}
                                  {e.cari ? <Badge tone="amber">Cari · {e.cari.name}</Badge> : null}
                                  {e.shared ? <Badge tone="gray">İşletme geneli</Badge> : null}
                                </span>
                                <span className="block text-xs text-ink-mute">
                                  {dateTR(e.date)}
                                  {branches.ask ? ` · ${branchName(e.branchId ?? EXPENSE_SHARED)}` : ""}
                                  {e.paymentMethod ? ` · ${METHOD_LABEL[e.paymentMethod]}` : ""}
                                  {e.note ? ` · ${e.note}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-sm text-ink tabular">{tl(e.amount, 2)}</span>
                            </button>
                          </li>
                        ))}
                        {invs.map((i) => (
                          <li key={`inv-${i.id}`} className="flex items-start justify-between gap-3 py-2">
                            <span className="min-w-0">
                              <Link
                                href={`/panel/faturalar?ay=${month}&ara=${encodeURIComponent(i.supplier)}#fatura-listesi`}
                                className="block text-sm break-words text-ink hover:underline pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                              >
                                {i.supplier}
                              </Link>
                              <span className="block text-xs text-ink-mute">
                                {dateTR(i.date)} · faturadan ({i.invoiceCategory}, KDV hariç){viewBranch ? " · işletme geneli" : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm text-ink-soft tabular">{tl(i.net, 2)}</span>
                          </li>
                        ))}
                        {!rows.length && !invs.length ? <li className="py-2 text-xs text-warn">Bu ay girilmedi</li> : null}
                      </ul>
                    </section>
                  );
                })
            )}
          </CardContent>
        </Card>
      </div>

      {shownFixed.length || fixed.length ? (
        <Card className="mt-4">
          <CardHeader
            icon={<ArrowRightLeft />}
            title="Her ay aynı tutarla sayılan giderler"
            description="Sabit giderlerdeki bu kalemler her ay aynı tutarla sayılıyor. Tutarı aydan aya değişiyorsa aylık girişe çevirin: sabit kalem geçen ay biter (geçmiş aylar aynı kalır), bundan sonra tutarı bu sayfada girersiniz."
          />
          <CardContent>
            <ul className="divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3">
              {shownFixed.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium break-words text-ink">{f.name}</span>
                    <span className="block text-xs text-ink-mute">
                      {GROUP_LABEL[f.group]} · ayda {tl(f.amount)}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConverting(f)}>
                    <ArrowRightLeft size={14} /> Aylık girişe çevir
                  </Button>
                </li>
              ))}
              {!shownFixed.length ? <li className="py-2.5 text-sm text-ink-mute">Reklam grubunda sabit gider yok.</li> : null}
            </ul>
            {fixed.length > fixed.filter((f) => f.group === "reklam").length ? (
              <button type="button" onClick={() => setShowAllFixed((v) => !v)} className="mt-2 cursor-pointer text-xs font-medium text-ink-soft hover:text-ink pointer-coarse:min-h-11">
                {showAllFixed ? "Yalnız reklam giderlerini göster" : `Diğer sabit giderleri de göster (${num(fixed.length - fixed.filter((f) => f.group === "reklam").length)})`}
              </button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardHeader
          icon={<Tags />}
          title="Kategoriler"
          description="Her kategori Gelir-gider'de kendi satırında, seçtiğiniz bölümde sayılır. İsterseniz Faturalar'daki bir kategorinin faturaları da buraya eklenir (ör. Reklam & Tabela)."
          meta={
            <Button size="sm" variant="secondary" onClick={() => setCatEdit("new")}>
              <Plus size={14} /> Kategori ekle
            </Button>
          }
        />
        <CardContent>
          <ul className="divide-y divide-ink/[0.06] rounded-2xl bg-surface px-3">
            {categories.map((c) => (
              <li key={c.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5", !c.active && "opacity-60")}>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                    {c.name}
                    {c.monthly ? <Badge tone="gray">her ay</Badge> : null}
                    {!c.active ? <Badge tone="gray">pasif</Badge> : null}
                  </span>
                  <span className="block text-xs text-ink-mute">
                    {SECTION_LABEL[c.section]} · {GROUP_LABEL[c.panelGroup]}
                    {c.invoiceCategory ? ` · + “${c.invoiceCategory}” faturaları` : ""}
                  </span>
                </span>
                <IconButton label={`${c.name} kategorisini düzenle`} onClick={() => setCatEdit(c)}>
                  <Pencil size={15} />
                </IconButton>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {editing ? (
        <EntryDialog
          draft={editing}
          categories={categories}
          branches={branches}
          pending={pending}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={() => save(editing, () => setEditing(null))}
          onDelete={() => {
            const e = entries.find((x) => x.id === editing.id);
            if (e) remove(e);
          }}
        />
      ) : null}
      {catEdit ? (
        <CategoryDialog
          category={catEdit === "new" ? null : catEdit}
          invoiceCategories={invoiceCategories}
          usedInvoiceCategories={categories.filter((c) => c.invoiceCategory && (catEdit === "new" || c.id !== catEdit.id)).map((c) => c.invoiceCategory!)}
          onClose={() => setCatEdit(null)}
          onSaved={(id) => {
            setCatEdit(null);
            if (id) setDraft((d) => ({ ...d, categoryId: String(id) }));
          }}
        />
      ) : null}
      <ConfirmDialog
        open={converting !== null}
        onClose={() => setConverting(null)}
        tone="primary"
        confirmLabel="Aylık girişe çevir"
        title={converting ? `${converting.name} aylık girilsin mi?` : ""}
        description={
          converting
            ? `${monthLabel(month)}'dan itibaren ${converting.name} sabit giderlerde sayılmaz; tutarı her ay bu sayfada girersiniz ("her ay" kategorisi, girilmezse hatırlatılır). Geçmiş aylar aynı kalır. ${monthLabel(month)} için şimdilik sabit giderdeki KDV hariç tutar (${tl(converting.amount)}) tahmini harcama olarak yazılır; ödediğiniz tutarı (KDV dahil) girince düzeltin. Başabaş, ay sonu tahmini ve nakit planı bu gideri buradaki tutarıyla saymaya devam eder (bu ay girilmezse geçen ayın tutarıyla). Gelir-gider'de bu aylara elle yazılmış tutarlar buraya taşınır.`
            : undefined
        }
        pending={pending}
        onConfirm={() => {
          const f = converting;
          if (!f) return;
          start(async () => {
            const r = await convertFixedToMonthly(f.id, month);
            if (!r.ok) return void toast.error(r.error);
            setConverting(null);
            toast.success(
              `${f.name} artık aylık giriliyor${r.data.moved ? ` · ${r.data.moved} ayın tutarı taşındı` : ""}${r.data.estimated ? " · bu ay için tahmini tutar (KDV hariç) yazıldı" : ""} · başabaş ve nakit planı buradaki tutarı sayar`,
            );
          });
        }}
      />
    </>
  );
}

function EntryDialog({
  draft,
  categories,
  branches,
  pending,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  draft: EntryDraft;
  categories: CategoryRow[];
  branches: ExpenseBranchChoice;
  pending: boolean;
  onChange: (d: EntryDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const set = (p: Partial<EntryDraft>) => onChange({ ...draft, ...p });
  const router = useRouter();
  const [viewer, setViewer] = useState<{ id: number; caption: string } | null>(null);
  const cari = draft.cari ?? null;
  const linked = Boolean(draft.cashOutDate) || Boolean(cari);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Harcamayı düzenle"
      footerStart={
        <Button variant="ghost" className="text-bad" disabled={pending} onClick={onDelete}>
          <Trash2 size={15} /> Sil
        </Button>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={onSave} disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {draft.photoId ? (
          <PhotoThumb id={draft.photoId} caption="Fişin fotoğrafı" onOpen={() => setViewer({ id: draft.photoId!, caption: "Fişin fotoğrafı" })} className="sm:col-span-2" />
        ) : null}
        {cari ? (
          <Notice
            tone="warn"
            size="sm"
            className="sm:col-span-2"
            title={`Bu harcama ${cari.name} tedarikçisinin faturasız alımından. Tutarını, gününü ve kategorisini Tedarikçiler'de düzeltin.`}
            action={
              cari.href ? (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    router.push(cari.href!);
                  }}
                >
                  Tedarikçiye git
                </Button>
              ) : undefined
            }
          />
        ) : draft.cashOutDate ? (
          <Notice
            tone="neutral"
            size="sm"
            className="sm:col-span-2"
            title={`Kasa raporundaki bir fişten (${dateTR(draft.cashOutDate!)}). Tutarı ve tarihi Kasa raporu'nda düzeltin.`}
            action={
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  // Önce pencere kapanır, sonra sayfa değişir (açık pencereyle gezinme olmaz)
                  onClose();
                  router.push(`/panel/kasa?gun=${draft.cashOutDate}`);
                }}
              >
                Kasa raporuna git
              </Button>
            }
          />
        ) : null}
        <Field label="Kategori" htmlFor="e-cat" className="sm:col-span-2">
          <Select id="e-cat" value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })} disabled={Boolean(cari)}>
            {categories
              .filter((c) => c.active || String(c.id) === draft.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Tutar (₺)" htmlFor="e-amt" tip="Ödenen tutar (KDV ayrılmaz). İade ya da düzeltme için eksi yazabilirsiniz.">
          <NumberInput id="e-amt" inputMode="text" value={draft.amount} onChange={(e) => set({ amount: e.target.value })} readOnly={linked} disabled={linked} />
        </Field>
        <Field label="Tarih" htmlFor="e-date">
          <Input id="e-date" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} readOnly={linked} disabled={linked} />
        </Field>
        <Field label="Açıklama" htmlFor="e-desc" className="sm:col-span-2">
          <Input id="e-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Ödeme" className="sm:col-span-2">
          <Segmented<Method | "">
            label="Ödeme şekli"
            stretch
            value={draft.paymentMethod ?? ""}
            onChange={(v) => set({ paymentMethod: v === draft.paymentMethod ? null : (v as Method) || null })}
            options={METHODS}
          />
        </Field>
        {branches.ask ? (
          <ExpenseBranchField
            id="e-branch"
            className="sm:col-span-2"
            choice={branches}
            value={draft.branchId}
            onChange={(v) => set({ branchId: v })}
            // Kaynağa bağlı kaydın şubesi kaynağın: kasadan çıkanınki o kasanın, cari giderinki Tedarikçiler'de
            locked={cari ? "Şubesi Tedarikçiler'deki faturasız alımda seçilir." : draft.cashOutDate ? "Şubesi fişin çıktığı kasanın şubesidir." : null}
          />
        ) : null}
        <Field label="Not" htmlFor="e-note" className="sm:col-span-2">
          <Textarea id="e-note" rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>
      <PhotoViewer photo={viewer} onClose={() => setViewer(null)} />
    </Dialog>
  );
}

function CategoryDialog({
  category,
  invoiceCategories,
  usedInvoiceCategories,
  onClose,
  onSaved,
}: {
  category: CategoryRow | null;
  invoiceCategories: string[];
  usedInvoiceCategories: string[];
  onClose: () => void;
  onSaved: (id: number | null) => void;
}) {
  const [pending, start] = useActionTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [f, setF] = useState({
    name: category?.name ?? "",
    section: category?.section ?? ("genel" as Section),
    panelGroup: category?.panelGroup ?? ("diger" as Group),
    invoiceCategory: category?.invoiceCategory ?? "",
    monthly: category?.monthly ?? false,
    active: category?.active ?? true,
  });
  const submit = () =>
    start(async () => {
      const r = await saveExpenseCategory({ id: category?.id ?? null, ...f, invoiceCategory: f.invoiceCategory || null });
      if (!r.ok) return void toast.error(r.error);
      toast.success(category ? `${f.name} kaydedildi` : `${f.name} eklendi`);
      onSaved(category ? null : r.data.id);
    });
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title={category ? "Kategoriyi düzenle" : "Yeni harcama kategorisi"}
        footerStart={
          category ? (
            <Button variant="ghost" className="text-bad" disabled={pending} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={15} /> Sil
            </Button>
          ) : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Vazgeç
            </Button>
            <Button onClick={submit} disabled={pending || !f.name.trim()}>
              {pending ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Ad" htmlFor="c-name">
            <Input id="c-name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="ör. Influencer, Google reklamı, Nakit alım" data-autofocus />
          </Field>
          <Field label="Gelir-gider'de nerede sayılsın" htmlFor="c-sec" tip="Mal maliyeti seçilirse ayın mal alımına eklenir (faturasız market/pazar alımları için); ötekiler gider bölümlerinde.">
            <Select id="c-sec" value={f.section} onChange={(e) => setF((x) => ({ ...x, section: e.target.value as Section }))}>
              {(Object.keys(SECTION_LABEL) as Section[]).map((k) => (
                <option key={k} value={k}>
                  {SECTION_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Genel bakış grubu" htmlFor="c-grp" tip="“Para nereye gitti?” bölümünde hangi grupta görünsün.">
            <Select id="c-grp" value={f.panelGroup} onChange={(e) => setF((x) => ({ ...x, panelGroup: e.target.value as Group }))}>
              {PANEL_FIXED_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Faturalar'dan da say"
            htmlFor="c-inv"
            tip="Seçilen kategorideki faturalar (Paraşüt'ten gelen ya da elle girilen, KDV hariç) bu satıra eklenir. Aynı gideri burada ayrıca girmeyin; iki kez sayılır."
            hint={f.invoiceCategory ? `"${f.invoiceCategory}" faturaları bu kategoriye eklenir; aynısını elle girmeyin.` : "Yalnız bu sayfada girilenler sayılır."}
          >
            <Select id="c-inv" value={f.invoiceCategory} onChange={(e) => setF((x) => ({ ...x, invoiceCategory: e.target.value }))}>
              <option value="">Hayır</option>
              {invoiceCategories.map((c) => (
                <option key={c} value={c} disabled={usedInvoiceCategories.includes(c)}>
                  {c}
                  {usedInvoiceCategories.includes(c) ? " (başka kategoride)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Switch checked={f.monthly} onChange={(v) => setF((x) => ({ ...x, monthly: v }))} label="Her ay girilsin" showText onText="Her ay girilir" offText="Arada bir" />
            <InfoTip text="Her ay girilecek kategori o ay boş kalırsa bu sayfada ve Genel bakış › Bu ayın işleri'nde hatırlatılır." />
            {category ? <Switch checked={f.active} onChange={(v) => setF((x) => ({ ...x, active: v }))} label="Kategori etkin" showText onText="Etkin" offText="Pasif" /> : null}
          </div>
          <button type="submit" hidden />
        </form>
      </Dialog>
      {/* Harcaması olan kategori silinemez: onay penceresi silmek yerine pasif yapmayı sunar (sunucu da reddeder) */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={category?.entryCount ? `${category.name} silinemiyor` : `${category?.name ?? ""} silinsin mi?`}
        description={
          category?.entryCount
            ? `Bu kategoride ${num(category.entryCount)} harcama var; silinemez. ${category.active ? "Bunun yerine pasif yapabilirsiniz: geçmiş aylar korunur, kategori yeni harcamalarda listelenmez." : "Kategori zaten pasif; geçmiş aylar korunur."}`
            : "Kategori silinir. Harcaması yok, hiçbir ay değişmez."
        }
        tone={category?.entryCount ? "primary" : "danger"}
        confirmLabel={category?.entryCount ? (category.active ? "Pasif yap" : "Tamam") : "Sil"}
        pending={pending}
        onConfirm={() =>
          start(async () => {
            if (!category) return;
            if (category.entryCount) {
              if (!category.active) return void setConfirmDelete(false);
              // Formda kaydedilmemiş değişiklikler yazılmaz: kategori kayıtlı haliyle pasif olur
              const { id, name, section, panelGroup, invoiceCategory, monthly } = category;
              const p = await saveExpenseCategory({ id, name, section, panelGroup, invoiceCategory, monthly, active: false });
              if (!p.ok) return void toast.error(p.error);
              toast.success(`${name} pasif yapıldı`);
              setConfirmDelete(false);
              return void onSaved(null);
            }
            const r = await deleteExpenseCategory(category.id);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`${category.name} silindi`);
            setConfirmDelete(false);
            onSaved(null);
          })
        }
      />
    </>
  );
}
