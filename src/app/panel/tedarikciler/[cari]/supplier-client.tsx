"use client";

import {
  ArrowLeft,
  Check,
  CircleCheck,
  Contact,
  Copy,
  ExternalLink,
  FileText,
  HandCoins,
  History,
  Mail,
  MessageCircle,
  NotebookPen,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useOptimistic, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { ExpenseBranchChoice } from "@/components/panel/expense-branch-field";
import { PageHeader } from "@/components/panel/page-header";
import { toastUnreachable, tryAction, useActionTransition } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton, IconLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { keepScroll, useQueryState } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Notice, NoticeLink } from "@/components/ui/notice";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { PRODUCT_NAME } from "@/components/akmanos/lib/brand";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { EXPENSE_SHARED } from "@/lib/branches";
import { openBalance, isPartiallyPaid } from "@/lib/calc/insights";
import { allocateFifo, allocationPreview, compareOpenItems, debtLabel, debtRemaining, invoiceLabel, type CariAllocation, type CostMode, type OpenItem } from "@/lib/cari/account";
import { coveredByAllocations, EPS, METHOD_LABEL, methodFromCard, round2 } from "@/lib/cari/balance";
import { linkableInvoice } from "@/lib/cari/match";
import type { ForeignCredit } from "@/lib/cari/statement";
import { dateTR, money, num } from "@/lib/format";
import { daysBetween } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import {
  applySupplierCredit,
  deleteSupplierEntry,
  dismissCashOut,
  dismissLinkCandidate,
  fixAllocatedDrift,
  removeAllocations,
  restoreSupplierEntry,
  setPaymentAllocation,
  snoozeDebt,
  unlinkDebts,
} from "@/server/actions/cari";
import { restoreInvoicePayment, setInvoicePayment, type InvoicePaymentState } from "@/server/actions/invoices";
import { importSupplierHistory, unhideSupplier } from "@/server/actions/suppliers";
import type { CardDebt, CardPayment } from "@/server/data/cari-entries";
import type { LedgerRow } from "@/server/data/suppliers";
import type { DocumentMeta } from "@/server/documents";

import { canHaveDocument, isParasutDocument } from "../../faturalar/document-rules";
import { DocumentSheet } from "../../faturalar/document-sheet";
import { isEInvoiceOnly, supplierMatchKey } from "../../faturalar/rules";
import { useCopied } from "../../kullanicilar/password-field";
import { SupplierCardDialog } from "../card-dialog";
import { CariPaymentDialog, type CariPaymentInitial, type CariTarget, type EditPayment, type TillOptions } from "../cari-payment-dialog";
import { CARI_UNDO_MS } from "../cari-ui";
import {
  dueOf,
  dueTone,
  dueWhen,
  formatIban,
  formatPhone,
  historyNotice,
  mailtoHref,
  methodLabel,
  missingInfo,
  nameMoves,
  normalizeTaxNumber,
  paidInParasut,
  payState,
  PLACEHOLDER_SUPPLIER_NAME,
  supplierHref,
  telHref,
  whatsappHref,
  type PayState,
  type SupplierCard,
  type TaxIndex,
  type TaxNote,
} from "../logic";
import { PaymentDialog, type PaymentChoice, type PaymentLedger } from "../payment-dialog";
import { RemoveSupplierDialog } from "../remove-supplier";
import { RequestDialog } from "../request-dialog";
import { AllocationDialog, type PaymentAllocationRow } from "./allocation-dialog";
import { CariStrips, type CandidateStrip, type KasaStrip } from "./cari-strips";
import { DebtDialog, type EditDebt } from "./debt-dialog";
import { EntryConfirm } from "./entry-confirm";
import { LinkDialog } from "./link-dialog";
import { StatementPanel, type StatementAction } from "./statement";

const PAGE_SIZE = 25;
/** "Geri al"lı bildirimlerin süresi (Faturalar'daki gibi) */
const UNDO_MS = 10000;
/** Ödeme talebinde düşülebilecek iade faturalarının yaşı (gün) */
const CREDIT_DAYS = 90;
/** Dökümden açılan faturanın satırı kısa süre bu renkle vurgulanır */
const FLASH = "bg-info-soft/60";

type Row = LedgerRow;
type Status = "odenmedi" | "tumu" | "odendi";

/** Ödeme alanlarının iyimser değişikliği (sunucu yanıtı gelmeden görünür; hata olursa geri döner) */
type Patch = { patches: [number, Partial<Row>][] };

function applyPatch(state: Row[], a: Patch): Row[] {
  const m = new Map(a.patches);
  return state.map((r) => (m.has(r.id) ? { ...r, ...m.get(r.id) } : r));
}

function patchFor(choice: PaymentChoice): Partial<Row> {
  if (choice.status === "paid") return { unpaid: false, paidAt: choice.date, paidVia: choice.via, paymentRequestedAt: null };
  if (choice.status === "requested") return { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: choice.date };
  return { unpaid: true, paidAt: null, paidVia: null, paymentRequestedAt: null };
}

/** Faturalar'da bu faturaya inen bağlantı (arama fatura no, yoksa tedarikçi) */
const invoicesHref = (r: Row) => `/panel/faturalar?ara=${encodeURIComponent(r.invoiceNo ?? r.supplier)}#fatura-listesi`;

/** Faturalardaki geçerli vergi numaraları, en çok fatura önce */
type TaxCount = { taxNumber: string; count: number };

/** Tedarikçinin cari hesabı (sunucuda kurulur; docs/TEDARIKCILER.md "Hesap hareketleri") */
export interface CariData {
  target: CariTarget;
  cardId: number | null;
  debts: CardDebt[];
  payments: CardPayment[];
  allocations: CariAllocation[];
  /** Hesapta sayılmamış ödeme */
  credit: number;
  /** Ödemenin sayılabileceği açık kalemler, dağıtım sırasıyla (kalanlarıyla; hesaptaki para düşülmeden) */
  items: OpenItem[];
  candidates: CandidateStrip[];
  late: { id: number; date: string; label: string; amount: number }[];
  kasa: KasaStrip[];
  foreign: { paymentId: number; allocationIds: number[]; amount: number }[];
  /** Başka kartların ödemelerinden bu tedarikçinin faturalarına sayılanlar (ekstre) */
  foreignIn: ForeignCredit[];
  /** `allocated` toplamı tutmayan fatura sayısı */
  drift: number;
  expenses: Record<number, { id: number; date: string; amount: number; categoryId: number; categoryName: string; branchId: string | null }>;
  categories: { id: number; name: string; section: string }[];
  /** Gelir-gider'de bir harcama kalemine bağlı fatura kategorileri (Faturası geldi önizlemesi) */
  countedCategories: string[];
  defaultCategoryId: number | null;
  defaultCostMode: CostMode;
  /** Kasanın bugünkü günü */
  businessDay: string;
  /** Kasadan ödemenin yeni satırının kasaları (birden çoksa pencere sorar; "Tümü"de varsayılan yok) */
  tills: TillOptions;
  /** "Faturası yok · gider yaz"ın gider kaydının şubesi */
  expenseBranches: ExpenseBranchChoice;
}

type Tab = "faturalar" | "hareketler";

/** Ekrandaki onay penceresi: kayıt silme ya da faturaya bağın kaldırılması */
type Confirming = { kind: "delete"; id: number; entry: "borc" | "odeme"; text: string } | { kind: "unlink"; id: number; text: string };

/** Sayfanın üstünde aynı vergi no şeridinde en çok bu kadar tedarikçi; fazlası sayıyla */
const TAX_NOTES_SHOWN = 3;

export function SupplierClient({
  today,
  supplier,
  card,
  invoices,
  documents,
  defaultTermDays,
  suggestions,
  canFill,
  canImport,
  hidden,
  stats,
  taxNotes = [],
  taxIndex,
  cari,
}: {
  today: string;
  /**
   * `taxNumber`: kartta yazılı, yoksa faturalardaki tek vergi no; `taxNumbers` faturalardaki numaralar; `viaTax` yalnız
   * vergi noyla gelen adlar (logic.ts groupSuppliers)
   */
  supplier: { key: string; slug: string; name: string; names: string[]; termDays: number; taxNumber: string | null; taxNumbers: TaxCount[]; viaTax: string[] };
  card: SupplierCard | null;
  invoices: Row[];
  documents: Record<number, DocumentMeta[]>;
  defaultTermDays: number;
  suggestions: string[];
  canFill: boolean;
  /** Paraşüt bağlı: "Geçmiş faturaları al" görünür */
  canImport: boolean;
  /** Listeden kaldırılmış (isHiddenSupplier): üstte geri getirme şeridi çıkar, Sil düğmesi çıkmaz */
  hidden: boolean;
  /** Sunucuda çizilen özet kartları (dökümleriyle) */
  stats: ReactNode;
  /** Aynı vergi nosunu taşıyan öteki tedarikçiler (sharedTaxNotes) */
  taxNotes?: TaxNote[];
  /** Düzenle penceresinde yazılan vergi noyla gelecek faturaların önizlemesi */
  taxIndex?: TaxIndex;
  cari: CariData;
}) {
  const router = useRouter();
  const [list, apply] = useOptimistic(invoices, applyPatch);
  // Ödeme durumu iyimser yazılır; eylem atarsa (ağ kesildi, panel güncellendi; E-51) satır döner ve bildirim çıkar
  const [, startTransition] = useActionTransition();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [devirAsk, setDevirAsk] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<number[] | null>(null);
  const [paying, setPaying] = useState<{ ids: number[]; initial?: PayState } | null>(null);
  const [docFor, setDocFor] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const { copied, copy } = useCopied();
  const termDays = supplier.termDays;

  // Cari hesap (docs/TEDARIKCILER.md "Hesap hareketleri"): sekme, pencereler, onaylar
  const [rawTab, setTab] = useQueryState<string>("sekme", "faturalar");
  const tab: Tab = rawTab === "hareketler" ? "hareketler" : "faturalar";
  const [debtFor, setDebtFor] = useState<{ debt?: EditDebt; mode?: CostMode } | null>(null);
  const [payFor, setPayFor] = useState<{ payment?: EditPayment; initial?: CariPaymentInitial } | null>(null);
  const [linkFor, setLinkFor] = useState<{ debtIds: number[]; invoiceId: number | null } | null>(null);
  const [allocFor, setAllocFor] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [creditAsk, setCreditAsk] = useState(false);
  const [cariBusy, runCari] = useActionTransition();
  const names = [...new Set([supplier.name, ...supplier.names, ...(card?.aliases ?? [])])];
  const defaultMethod = methodFromCard(card?.paymentMethod);
  const debtCounted = (id: number) => round2(cari.allocations.filter((a) => a.debtId === id).reduce((x, a) => x + a.amount, 0));
  const paymentCounted = (id: number) => round2(cari.allocations.filter((a) => a.paymentId === id).reduce((x, a) => x + a.amount, 0));
  const toEditDebt = (d: CardDebt): EditDebt => ({
    id: d.id,
    date: d.date,
    amount: d.amount,
    description: d.description,
    costMode: d.costMode,
    categoryId: d.categoryId ?? null,
    dueDate: d.dueDate,
    note: d.note ?? null,
    counted: debtCounted(d.id),
    adoptedExpenseId: d.costMode === "mevcut" ? (cari.expenses[d.id]?.id ?? null) : null,
    // Borcun gider kaydının şubesi (mod değişip yeni kayıt açılsa da varsayılan bu)
    expenseBranch: cari.expenses[d.id] ? (cari.expenses[d.id].branchId ?? EXPENSE_SHARED) : null,
    photoId: d.photoId,
  });
  const toEditPayment = (p: CardPayment): EditPayment => ({
    id: p.id,
    date: p.date,
    amount: p.amount,
    method: p.method,
    note: p.note ?? null,
    cashOutId: p.cashOutId ?? null,
    cashOutCreated: p.cashOutCreated,
    cashOutStore: p.cashOutStore ?? null,
    counted: paymentCounted(p.id),
    photoId: p.photoId,
  });
  // Ödeme ekle: o gün kasada bu tedarikçiye işlenmemiş Teslim satırı varsa Kasadan, satır seçili gelir (R1b)
  const todayKasa = cari.kasa.find((l) => l.inScope && l.kind === "teslim" && l.date === cari.businessDay);
  const openPayment = (initial?: CariPaymentInitial) =>
    setPayFor({ initial: initial ?? (todayKasa ? { method: "kasa", cashOutId: todayKasa.id, amount: todayKasa.amount, date: todayKasa.date } : undefined) });
  // Listeden ya da Kasa'dan gelen "İşle" / "Ödemeye çevir" (?kasa=<satır>): Ödeme ekle Kasadan ve o satırla açılır
  // (fişsiz alışveriş satırı seçiliyken pencere ödemeye çevirir)
  const [kasaRaw, setKasaParam] = useQueryState<string>("kasa", "");
  const [kasaSeen, setKasaSeen] = useState("");
  if (kasaRaw && kasaRaw !== kasaSeen) {
    setKasaSeen(kasaRaw);
    const l = cari.kasa.find((x) => String(x.id) === kasaRaw);
    if (l) setPayFor({ initial: { method: "kasa", cashOutId: l.id, amount: l.amount, date: l.date } });
  }
  const closePayment = () => {
    setPayFor(null);
    if (kasaRaw) setKasaParam("");
  };
  // Ödemeler'den gelen "Düzenle" (?borc=<kimlik>) ve "Bağla" (?bagla=<fatura>): Borcu düzenle ya da Faturası geldi
  // penceresi açık gelir (fatura için güçlü adayın alımları seçili)
  const [debtRaw, setDebtParam] = useQueryState<string>("borc", "");
  const [linkRaw, setLinkParam] = useQueryState<string>("bagla", "");
  const [paramSeen, setParamSeen] = useState("");
  const paramKey = `${debtRaw}|${linkRaw}`;
  if ((debtRaw || linkRaw) && paramKey !== paramSeen) {
    setParamSeen(paramKey);
    const d = debtRaw ? cari.debts.find((x) => String(x.id) === debtRaw && x.invoiceId === null) : undefined;
    if (d) setDebtFor({ debt: toEditDebt(d) });
    const c = linkRaw ? cari.candidates.find((x) => String(x.invoiceId) === linkRaw) : undefined;
    if (c) setLinkFor({ debtIds: c.debtIds, invoiceId: c.invoiceId });
  }
  const clearParams = () => {
    if (debtRaw) setDebtParam("");
    if (linkRaw) setLinkParam("");
  };

  /** Bildirimdeki "Geri al" */
  async function undo(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    try {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "Geri alınamadı");
      toast.success(done);
    } catch (e) {
      toastUnreachable(e);
    }
  }

  function cariAction(fn: () => Promise<{ ok: boolean; error?: string }>, onOk: () => void) {
    runCari(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error ?? "İşlem tamamlanamadı");
      onOk();
    });
  }

  function applyCredit() {
    if (!cari.cardId) return;
    const cardId = cari.cardId;
    setCreditAsk(false);
    runCari(async () => {
      const r = await applySupplierCredit({ cardId });
      if (!r.ok) return void toast.error(r.error);
      const ids = r.data.allocationIds;
      toast.success("Hesaptaki ödeme borçlara sayıldı", {
        description: `${money(r.data.total)} → ${r.data.lines.map((l) => l.label).join(", ")}`,
        duration: CARI_UNDO_MS,
        action: { label: "Geri al", onClick: () => void undo(() => removeAllocations({ allocationIds: ids }), "Sayım geri alındı; para hesapta") },
      });
    });
  }

  function onStatement(a: StatementAction) {
    if (a.type === "debt") {
      const d = cari.debts.find((x) => x.id === a.id);
      if (!d) return;
      if (a.action === "edit") setDebtFor({ debt: toEditDebt(d) });
      else if (a.action === "link") setLinkFor({ debtIds: [d.id], invoiceId: null });
      else if (a.action === "delete") setConfirming({ kind: "delete", id: d.id, entry: "borc", text: `${dateTR(d.date)} · ${debtLabel(d)} · ${money(d.amount)}` });
      else setConfirming({ kind: "unlink", id: d.id, text: `${dateTR(d.date)} · ${debtLabel(d)} · ${money(d.amount)}` });
      return;
    }
    const p = cari.payments.find((x) => x.id === a.id);
    if (!p) return;
    if (a.action === "edit") setPayFor({ payment: toEditPayment(p) });
    else if (a.action === "allocate") setAllocFor(p.id);
    else setConfirming({ kind: "delete", id: p.id, entry: "odeme", text: `${dateTR(p.date)} · ${METHOD_LABEL[p.method]} · ${money(p.amount)}` });
  }

  /** Neye sayıldı penceresinin seçenekleri: açık kalemler, bu ödemenin şimdiki payı eklenmiş olarak */
  function allocationOptions(paymentId: number): { current: PaymentAllocationRow[]; options: OpenItem[] } {
    const mine = cari.allocations.filter((a) => a.paymentId === paymentId).sort((a, b) => a.id - b.id);
    const byKey = new Map(cari.items.map((i) => [`${i.kind}:${i.id}`, { ...i }]));
    const current: PaymentAllocationRow[] = [];
    for (const a of mine) {
      const kind = a.invoiceId !== null ? ("invoice" as const) : ("debt" as const);
      const id = (a.invoiceId ?? a.debtId)!;
      const inv = kind === "invoice" ? invoices.find((i) => i.id === id) : undefined;
      const debt = kind === "debt" ? cari.debts.find((d) => d.id === id) : undefined;
      const label = inv ? invoiceLabel(inv) : debt ? debtLabel(debt) : "başka tedarikçide görünen fatura";
      current.push({ id: a.id, kind, targetId: id, label, amount: a.amount, foreign: kind === "invoice" && !inv });
      const k = `${kind}:${id}`;
      const it = byKey.get(k);
      if (it) it.balance = round2(it.balance + a.amount);
      else if (inv || debt) {
        const src = (inv ?? debt)!;
        const due = dueOf(src, termDays);
        byKey.set(k, { kind, id, date: src.date, due: due.date, dueEstimated: due.estimated, balance: a.amount, label });
      }
    }
    return { current, options: [...byKey.values()].sort(compareOpenItems) };
  }

  const allocPayment = allocFor === null ? null : (cari.payments.find((p) => p.id === allocFor) ?? null);
  const creditPlan = allocateFifo(cari.items.filter((i) => i.quiet !== "link"), cari.credit);
  const creditPreview = allocationPreview(creditPlan.lines, cari.items, creditPlan.left);
  const onCariSaved = (r: { slug: string | null }) => {
    // Kartsız tedarikçiye ilk kayıtta kart açılır; adresi değişebilir
    if (r.slug && r.slug !== supplier.slug) router.replace(supplierHref(r.slug));
  };

  /** Ödeme durumu penceresinin cari bilgisi (tek fatura): sayılan ödemeler, hesaptaki para, kısmi ödeme */
  function ledgerFor(ids: number[]): PaymentLedger | null {
    if (ids.length !== 1) return null;
    const r = list.find((x) => x.id === ids[0]);
    if (!r) return null;
    const mine = cari.allocations.filter((a) => a.invoiceId === r.id).sort((a, b) => a.id - b.id);
    return {
      counted: mine.map((a) => {
        const p = cari.payments.find((x) => x.id === a.paymentId);
        return { allocationId: a.id, date: p?.date ?? r.date, method: p ? METHOD_LABEL[p.method] : "Ödeme", amount: a.amount };
      }),
      panelPaid: r.allocated ?? 0,
      remaining: openBalance(r),
      covered: coveredByAllocations(r),
      credit: cari.credit,
      onRemove: (allocationId) => {
        setPaying(null);
        removeAllocation(allocationId);
      },
      onPartial: canPartial(r)
        ? () => {
            setPaying(null);
            partialPay(r);
          }
        : undefined,
    };
  }

  /** Ödemeden çıkar (Ödeme durumu penceresinden); "Geri al" ödemenin önceki dağıtımını yeniden yazar */
  function removeAllocation(allocationId: number) {
    runCari(async () => {
      const r = await removeAllocations({ allocationIds: [allocationId] });
      if (!r.ok) return void toast.error(r.error);
      const prev = r.data.previous[0];
      toast.success("Ödemeden çıkarıldı", {
        description: `${money(r.data.total)} hesaba geçti${r.data.reopened ? " · fatura ödenmemişe döndü" : ""}`,
        duration: CARI_UNDO_MS,
        ...(prev
          ? { action: { label: "Geri al", onClick: () => void undo(() => setPaymentAllocation({ paymentId: prev.paymentId, mode: prev.lines.length ? "manual" : "none", lines: prev.lines }), "Dağıtım geri alındı") } }
          : {}),
      });
    });
  }

  const unpaid = list.filter((r) => r.unpaid);
  const [rawStatus, setStatus] = useQueryState<string>("durum", "");
  const status: Status = rawStatus === "odenmedi" || rawStatus === "tumu" || rawStatus === "odendi" ? rawStatus : invoices.some((r) => r.unpaid) ? "odenmedi" : "tumu";
  const visible = list.filter((r) => (status === "odenmedi" ? r.unpaid : status === "odendi" ? !r.unpaid : true));
  const paged = usePaged(visible, PAGE_SIZE, status);
  const parasutPaid = unpaid.filter(paidInParasut);

  // Özet kartı dökümünden gelen fatura (?fatura=<kimlik>): bulunduğu sekmeye ve sayfaya geçilir, görünen satırına
  // (telefonda kart, masaüstünde tablo satırı) kaydırılıp kısa süre vurgulanır
  const [focusRaw, setFocus] = useQueryState<string>("fatura", "");
  const focusId = Number.parseInt(focusRaw, 10) || null;
  useEffect(() => {
    if (!focusId) return;
    if (tab !== "faturalar") return void setTab("faturalar");
    const row = list.find((r) => r.id === focusId);
    if (!row) {
      setFocus("");
      return;
    }
    const index = visible.findIndex((r) => r.id === focusId);
    if (index < 0) {
      setStatus(row.unpaid ? "odenmedi" : "odendi");
      return;
    }
    const page = Math.floor(index / PAGE_SIZE) + 1;
    if (page !== paged.page) {
      paged.setPage(page);
      return;
    }
    const el = [...document.querySelectorAll<HTMLElement>(`[data-fatura="${focusId}"]`)].find((e) => e.offsetParent !== null);
    setFocus("");
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add(FLASH);
    window.setTimeout(() => el.classList.remove(FLASH), 2500);
  }, [focusId, list, visible, paged, setFocus, setStatus, tab, setTab]);

  // Süzgeç değişince seçim boşalır (gizli satıra toplu işlem uygulanmasın)
  const [selKey, setSelKey] = useState(status);
  if (selKey !== status) {
    setSelKey(status);
    setSelected(new Set());
  }
  const chosen = visible.filter((r) => selected.has(r.id));
  const chosenUnpaid = chosen.filter((r) => r.unpaid);
  /** Ödeme talebine girebilecek (borç, iade değil) faturalar */
  const chosenDebts = chosenUnpaid.filter((r) => openBalance(r) > 0);
  // Ödeme talebine girebilecek faturasız alımlar (kalanlarıyla)
  const purchases = cari.debts
    .filter((d) => d.invoiceId === null)
    .map((d) => ({ id: d.id, date: d.date, description: d.description, amount: debtRemaining(d, cari.allocations) }))
    .filter((d) => d.amount > EPS)
    .sort((a, b) => a.date.localeCompare(b.date));
  const hasDebt = unpaid.some((r) => openBalance(r) > 0) || purchases.length > 0;
  const pageIds = paged.slice.map((r) => r.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // Esc seçimi kaldırır (açık pencere yokken)
  const hasSelection = chosen.length > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  /**
   * Ödeme durumunu yazar; bildirimdeki "Geri al" önceki hâli geri yazar. Birden çok faturada ve `onlyOpen` ile (✓,
   * ödeme talebi, "Ödendi yap": ekranda ödenmemiş görünen faturalar) ödendi / talep edildi yalnız ödenmemişlere
   * yazılır: zaten ödenmiş faturanın ödeme günü bozulmaz. Sunucu da aynı kuralı uygular (başka bir oturumda ödenmişse).
   */
  function setPayment(selection: Row[], choice: PaymentChoice, opts: { onlyOpen?: boolean; separately?: boolean } = {}) {
    const onlyOpen = opts.onlyOpen || selection.length > 1;
    const rows = onlyOpen && choice.status !== "unpaid" ? selection.filter((r) => r.unpaid) : selection;
    const ids = rows.map((r) => r.id);
    if (!ids.length) return void toast.info("Seçilen faturalar zaten ödenmiş; değişiklik yapılmadı.");
    keepScroll();
    const patch = patchFor(choice);
    startTransition(async () => {
      apply({ patches: ids.map((id) => [id, patch]) });
      const r = await setInvoicePayment(ids, choice, { onlyOpen, separately: opts.separately });
      if (!r.ok) return void toast.error(r.error);
      if (!r.data.changed) return void toast.info("Değişiklik yok; ödeme günü ve şekli aynı.");
      const total = rows.reduce((a, x) => a + (x.unpaid ? openBalance(x) : x.payable), 0);
      const what = rows.length === 1 ? `${dateTR(rows[0].date)}${rows[0].invoiceNo ? ` · ${rows[0].invoiceNo}` : ""}` : `${num(rows.length)} fatura`;
      const title =
        choice.status === "paid"
          ? rows.length === 1
            ? "Ödendi olarak işaretlendi"
            : `${num(rows.length)} fatura ödendi`
          : choice.status === "requested"
            ? rows.length === 1
              ? "Ödemesi talep edildi"
              : `${num(rows.length)} faturanın ödemesi talep edildi`
            : "Ödenmedi olarak işaretlendi";
      // Önce hesaptaki para (K6): ne kadarının sayıldığı söylenir
      const used = r.data.credit?.used ?? 0;
      const detail = [
        what,
        money(total),
        used > EPS ? `hesaptaki ${money(used)} sayıldı` : null,
        choice.status === "paid" && choice.date ? `ödeme ${dateTR(choice.date)}` : null,
        choice.status === "paid" ? methodLabel(choice.via) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const previous = r.data.previous;
      toast.success(title, { description: detail, action: { label: "Geri al", onClick: () => restore(previous) }, duration: UNDO_MS });
    });
  }

  function restore(previous: InvoicePaymentState[]) {
    keepScroll();
    startTransition(async () => {
      apply({ patches: previous.map(({ id, ...state }) => [id, state]) });
      const r = await restoreInvoicePayment(previous);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Ödeme durumu geri alındı");
    });
  }

  const quickPaid = (rows: Row[]) => setPayment(rows, { status: "paid", date: today, via: card?.paymentMethod ?? null }, { onlyOpen: true });

  const docRow = docFor === null ? null : (list.find((r) => r.id === docFor) ?? null);
  const docsOf = (id: number) => documents[id] ?? [];
  const docButton = (r: Row, className?: string) =>
    canHaveDocument(r, docsOf(r.id).length) ? (
      <IconButton label="Belgeyi aç" aria-haspopup="dialog" onClick={() => setDocFor(r.id)} className={className}>
        {isParasutDocument(r) ? <FileText size={15} /> : <Paperclip size={15} />}
      </IconButton>
    ) : null;

  const checkbox = (r: Row, className?: string) => (
    <label className={cn("relative flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-ink/[0.04] pointer-coarse:size-11", className)}>
      <input
        type="checkbox"
        checked={selected.has(r.id)}
        onChange={() => toggle(r.id)}
        aria-label={`${dateTR(r.date)}${r.invoiceNo ? ` ${r.invoiceNo}` : ""} faturasını seç`}
        className="size-4 cursor-pointer rounded accent-ink pointer-coarse:size-5"
      />
    </label>
  );

  /** Durum hapı: dokununca ödeme durumu penceresi açılır */
  const statusPill = (r: Row, size: "sm" | "md" = "sm") => {
    const state = payState(r);
    const text = state === "paid" ? (r.paidAt ? `Ödendi · ${dateTR(r.paidAt).slice(0, 5)}` : "Ödendi") : state === "requested" ? `Talep edildi · ${dateTR(r.paymentRequestedAt).slice(0, 5)}` : "Ödenmedi";
    const tip =
      state === "paid"
        ? [r.paidAt ? `Ödeme günü ${dateTR(r.paidAt)}` : r.parasutUnpaid === false ? "Paraşüt'te ödendi olarak işaretli" : "Ödeme günü kayıtlı değil", methodLabel(r.paidVia)].filter(Boolean).join(" · ")
        : state === "requested"
          ? `Ödemesi ${dateTR(r.paymentRequestedAt)} tarihinde talep edildi; ödenince Ödendi yapın`
          : "Ödenmedi";
    return (
      <button
        type="button"
        onClick={() => setPaying({ ids: [r.id] })}
        title={`${tip}. Değiştirmek için dokunun.`}
        aria-label={`${dateTR(r.date)} faturası: ${tip}. Ödeme durumunu değiştir`}
        aria-haspopup="dialog"
        className={cn("group/pill -my-1 inline-flex cursor-pointer items-center rounded-full", size === "md" ? "min-h-11" : "min-h-8 pointer-coarse:min-h-11")}
      >
        <Badge tone={state === "paid" ? "green" : state === "requested" ? "blue" : "red"} dot className={cn("transition-shadow group-hover/pill:ring-1 group-hover/pill:ring-ink/20", size === "md" && "px-2.5 py-1 text-xs")}>
          {text}
        </Badge>
      </button>
    );
  };

  const dueCell = (r: Row) => {
    const due = dueOf(r, termDays);
    if (!r.unpaid) return <span className="text-ink-quiet tabular">{r.dueDate ? dateTR(r.dueDate) : "–"}</span>;
    const tone = dueTone(due.date, today);
    return (
      <span className="tabular" title={due.estimated ? `Faturada vade yok: fatura tarihi + ${termDays} gün (tahmini)` : undefined}>
        <span className={cn("block", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink-soft")}>
          {dateTR(due.date)}
          {due.estimated ? "*" : ""}
        </span>
        <span className={cn("block text-xs", tone === "bad" ? "text-bad" : "text-ink-mute")}>{dueWhen(due.date, today)}</span>
      </span>
    );
  };

  const amountCell = (r: Row) => (
    <>
      <span className="font-semibold">{money(r.payable)}</span>
      {r.unpaid && isPartiallyPaid(r) ? (
        <span className="block text-xs text-warn">
          {(r.allocated ?? 0) > EPS ? `Kısmen ödendi · kalan ${money(openBalance(r))} · panelde ödenen ${money(r.allocated)}` : `Kalan ${money(openBalance(r))}`}
        </span>
      ) : null}
    </>
  );

  /** Kısmi ödeme: Ödeme ekle bu fatura seçili ve kalanıyla açılır */
  const partialPay = (r: Row) => openPayment({ mode: "manual", select: [{ kind: "invoice", id: r.id }], amount: openBalance(r) });
  const canPartial = (r: Row) => !placeholder && r.unpaid && r.payable > 0 && openBalance(r) > EPS;

  /**
   * Paraşüt ipucu (takipli fatura, §4.2): panel kalanı tek kaynak; Paraşüt'ün kalanı farklıysa söylenir. Paraşüt daha
   * az gösteriyorsa panelde girilmemiş ödeme olabilir (Ödeme ekle), daha çok gösteriyorsa ödememiz henüz işlenmemiştir.
   */
  const parasutHint = (r: Row) => {
    if (r.ledgerBase === null || r.ledgerBase === undefined) return null;
    if (r.unpaid && r.outstanding !== null && r.outstanding !== undefined && r.outstanding > EPS) {
      const panel = openBalance(r);
      if (Math.abs(r.outstanding - panel) <= EPS) return null;
      return r.outstanding < panel ? (
        <button
          type="button"
          onClick={() => partialPay(r)}
          title={`Paraşüt'te kalan ${money(r.outstanding)}; panelde ${money(panel)}. Panelde girilmemiş bir ödeme varsa Ödeme ekle.`}
          className="inline-flex min-h-6 cursor-pointer items-center pointer-coarse:min-h-11"
        >
          <Badge tone="violet">Paraşüt&apos;te kalan {money(r.outstanding)} · Ödeme ekle</Badge>
        </button>
      ) : (
        <Badge tone="gray" title="Ödememiz Paraşüt'te henüz işlenmemiş olabilir">
          Paraşüt&apos;te kalan {money(r.outstanding)}
        </Badge>
      );
    }
    if (!r.unpaid && r.paidByLedger && r.parasutUnpaid) return <Badge tone="gray">Paraşüt&apos;te açık görünüyor</Badge>;
    return null;
  };

  const hints = (r: Row) => (
    <>
      {r.source === "parasut" ? (
        <Badge tone="blue" title="Paraşüt'ten otomatik alındı">
          Paraşüt
        </Badge>
      ) : null}
      {isEInvoiceOnly(r) ? <Badge tone="gray">e-fatura</Badge> : null}
      {paidInParasut(r) ? (
        <Badge tone="violet" title="Paraşüt'te bu faturanın ödemesi kayıtlı; panelde ödenmedi duruyor. Ödediyseniz Ödendi yapın.">
          Paraşüt&apos;te ödendi
        </Badge>
      ) : null}
      {parasutHint(r)}
    </>
  );

  const headerDescription =
    (card ? [card.legalName, card.taxNumber ? `Vergi no ${card.taxNumber}` : null, card.taxOffice ? `${card.taxOffice} VD` : null].filter(Boolean).join(" · ") : "") ||
    `Faturalardaki adı: ${supplier.names.join(", ") || supplier.name}${supplier.viaTax.length ? " (aynı vergi no)" : ""}`;
  // Paraşüt'ün adı okunamayan faturaları: silinmez, geçmişi alınmaz (sonraki eşitlemede gerçek tedarikçilerine geçer)
  const placeholder = supplier.key === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME);

  async function importHistory(confirmDevir = false) {
    setDevirAsk(null);
    setImporting(true);
    keepScroll();
    // Okuma sürerken başka sayfaya geçildiyse dönüşte o sayfanın adresine dokunulmaz
    const path = window.location.pathname;
    const toastId = toast.loading("Paraşüt'ten geçmiş faturalar okunuyor…", { description: "Faturası çok olan tedarikçide yarım dakikayı bulabilir." });
    try {
      const r = await importSupplierHistory({ cardId: card?.id ?? null, key: supplier.key, confirmDevir });
      if (!r.ok) return void toast.error(r.error, { id: toastId, description: undefined });
      if (r.data.needs === "devir") {
        // Eski borç (devir) girilmiş: o günden eski faturalar gelirse borç iki kez sayılır (K22)
        toast.dismiss(toastId);
        setDevirAsk(r.data.date);
        return;
      }
      const d = r.data;
      const n = historyNotice(r.data);
      toast.success(n.title, { id: toastId, description: n.description, duration: n.long ? 15000 : 8000 });
      if (d.created && status !== "tumu" && window.location.pathname === path) setStatus("tumu");
    } catch (e) {
      toastUnreachable(e, toastId);
    } finally {
      setImporting(false);
    }
  }

  async function restoreToList() {
    if (!card) return;
    keepScroll();
    const r = await tryAction(() => unhideSupplier({ cardId: card.id }));
    if (!r) return;
    if (!r.ok) return void toast.error(r.error);
    toast.success("Tedarikçi listeye geri alındı", { description: supplier.name });
  }

  return (
    <>
      <PageHeader
        path="/panel/tedarikciler"
        title={supplier.name}
        description={headerDescription}
        actions={
          <>
            <ButtonLink href="/panel/tedarikciler" variant="ghost" size="sm">
              <ArrowLeft size={16} /> Tedarikçiler
            </ButtonLink>
            {hasDebt ? (
              <Button variant="secondary" size="sm" onClick={() => setRequestFor([])} className="text-ink">
                <Send size={15} aria-hidden="true" /> Ödeme talebi
              </Button>
            ) : null}
            {placeholder ? null : (
              <>
                <Button size="sm" onClick={() => openPayment()} className="max-sm:hidden">
                  <HandCoins size={15} aria-hidden="true" /> Ödeme ekle
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setDebtFor({})} className="text-ink max-sm:hidden">
                  <NotebookPen size={15} aria-hidden="true" /> Borç ekle
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} className="text-ink">
              <Pencil size={15} aria-hidden="true" /> Düzenle
            </Button>
            {hidden || placeholder ? null : (
              <Button variant="ghost" size="sm" onClick={() => setRemoving(true)} className="text-bad hover:bg-bad-soft hover:text-bad">
                <Trash2 size={15} aria-hidden="true" /> Sil
              </Button>
            )}
          </>
        }
      />

      {/* Telefon: iki ana eylem başlığın altında, iki sütun */}
      {placeholder ? null : (
        <div className="-mt-2 mb-4 grid grid-cols-2 gap-2 sm:hidden">
          <Button onClick={() => openPayment()} className="h-11">
            <HandCoins size={16} aria-hidden="true" /> Ödeme ekle
          </Button>
          <Button variant="secondary" onClick={() => setDebtFor({})} className="h-11 text-ink">
            <NotebookPen size={16} aria-hidden="true" /> Borç ekle
          </Button>
        </div>
      )}

      {hidden && card ? (
        <Notice
          tone="neutral"
          live="polite"
          className="mb-4"
          title={`Bu tedarikçi ${card.hiddenOn ? `${dateTR(card.hiddenOn)} tarihinde ` : ""}listeden kaldırıldı`}
          text="Faturaları Faturalar'da duruyor; yeni faturası gelirse listeye kendiliğinden döner."
          action={
            <Button variant="secondary" size="xs" onClick={restoreToList}>
              Listeye geri al
            </Button>
          }
        />
      ) : null}

      <TaxNotices notes={taxNotes} />

      {/* Sunucudan gelen öğe kendi Fragment'ında: içindeki istemci bileşenleri yüklenmeden RSC yükü okunursa öğe iç
          içe lazy olarak gelir ve React (geliştirmede) onu bu listede anahtarsız sanıp "unique key" uyarısı verirdi */}
      <Fragment key="ozet">{stats}</Fragment>

      <CariStrips
        credit={cari.credit}
        hasOpen={cari.items.some((i) => i.quiet !== "link")}
        candidates={cari.candidates}
        late={cari.late}
        kasa={cari.kasa}
        foreign={cari.foreign}
        drift={cari.drift}
        busy={cariBusy}
        onApplyCredit={() => setCreditAsk(true)}
        onLink={(c) => setLinkFor({ debtIds: c.debtIds, invoiceId: c.invoiceId })}
        onDismissCandidate={(c) =>
          cariAction(
            () => dismissLinkCandidate({ debtIds: c.debtIds, invoiceId: c.invoiceId }),
            () =>
              toast.success("Ayrı alım olarak işaretlendi", {
                description: `${c.label} bu alımın faturası sayılmaz`,
                duration: CARI_UNDO_MS,
                action: { label: "Geri al", onClick: () => void undo(() => dismissLinkCandidate({ debtIds: c.debtIds, invoiceId: c.invoiceId, undo: true }), "Aday geri geldi") },
              }),
          )
        }
        onLateExpense={(id) => {
          const d = cari.debts.find((x) => x.id === id);
          if (d) setDebtFor({ debt: toEditDebt(d), mode: "gider" });
        }}
        onSnooze={(id) => cariAction(() => snoozeDebt({ debtId: id }), () => toast.success("Beklemeye alındı", { description: "Faturası 45 gün sonra yeniden sorulur." }))}
        onProcessKasa={(l) => openPayment({ method: "kasa", cashOutId: l.id, amount: l.amount, date: l.date })}
        onConvertKasa={(l) => openPayment({ method: "kasa", cashOutId: l.id, amount: l.amount, date: l.date })}
        onKeepApart={(l) =>
          cariAction(
            () => dismissCashOut({ cashOutId: l.id }),
            () =>
              toast.success("Kasa satırı ayrı tutuldu", {
                description: `${dateTR(l.date).slice(0, 5)} · ${money(l.amount)}`,
                duration: CARI_UNDO_MS,
                action: { label: "Geri al", onClick: () => void undo(() => dismissCashOut({ cashOutId: l.id, undo: true }), "Kasa satırı yeniden işlenmemiş") },
              }),
          )
        }
        onRemoveForeign={(f) => cariAction(() => removeAllocations({ allocationIds: f.allocationIds }), () => toast.success("Ödemeden çıkarıldı", { description: `${money(f.amount)} hesaba geçti` }))}
        onFixDrift={() => cari.cardId && cariAction(() => fixAllocatedDrift({ cardId: cari.cardId! }), () => toast.success("Toplamlar düzeltildi"))}
      />

      {/* Bilgiler faturaların üstünde, tam genişlikte: IBAN'ı kopyalamak ve aramak çoğu zaman ilk iş; fatura
          tablosu da sayfanın genişliğini kullanır (yanda dar sütunda eylemleri sığmıyordu) */}
      <div className="space-y-4">
        <CariPanel
          card={card}
          taxNumber={supplier.taxNumber}
          taxNumbers={supplier.taxNumbers}
          viaTax={supplier.viaTax}
          termDays={termDays}
          defaultTermDays={defaultTermDays}
          copied={copied}
          copy={copy}
          onEdit={() => setEditing(true)}
        />

        {/* Faturalar ve Hesap hareketleri (ekstre); adreste ?sekme=hareketler */}
        <Segmented<Tab>
          label="Görünüm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "faturalar", label: "Faturalar", count: list.length },
            { value: "hareketler", label: "Hesap hareketleri" },
          ]}
        />

        {tab === "hareketler" ? (
          <Card id="hareketler" className="min-w-0 scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
            <CardHeader
              icon={<History />}
              title="Hesap hareketleri"
              description="Faturalar, faturasız alımlar ve ödemeler gün sırasıyla; bakiye satır satır yürür. Gri satırlar faturalardaki ödendi işaretleri ve Paraşüt'te ödenen kısımlardır."
            />
            <StatementPanel name={supplier.name} today={today} invoices={list} debts={cari.debts} payments={cari.payments} allocations={cari.allocations} foreign={cari.foreignIn} onAction={onStatement} />
          </Card>
        ) : (
          <Card id="faturalar" className="min-w-0 scroll-mt-[calc(var(--mobile-top-h)+1.5rem)]">
            <CardHeader
              icon={<FileText />}
              title="Faturalar"
              description={
                <>
                  <span className="lg:hidden">Durum hapına dokunun: ödendi (gün ve şekliyle), talep edildi ya da ödenmedi. Birden çok fatura için kutucukları işaretleyin.</span>
                  <span className="max-lg:hidden">Paraşüt&apos;ten kendiliğinden gelir. Durum hapına tıklayınca ödendi (gün ve şekliyle), talep edildi ya da ödenmedi yapılır; seçip toplu işaretleyin.</span>
                </>
              }
              meta={
                <>
                  <span>
                    <span className="font-semibold text-ink tabular">{num(list.length)}</span> fatura
                  </span>
                  {unpaid.length ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-warn">
                        <span className="font-semibold tabular">{num(unpaid.length)}</span> ödenmemiş
                      </span>
                    </>
                  ) : null}
                </>
              }
              actions={
                canImport && !placeholder ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void importHistory()}
                    disabled={importing}
                    className="text-ink"
                    title="Paraşüt'teki bütün gider faturaları, tarih sınırı olmadan. Paneldekiler çoğalmaz; eskiler Paraşüt'teki ödeme durumuyla gelir."
                  >
                    <History size={15} aria-hidden="true" className={cn(importing && "animate-spin")} /> {importing ? "Okunuyor…" : "Geçmiş faturaları al"}
                  </Button>
                ) : null
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3">
              <Segmented<Status>
                label="Faturalar"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "odenmedi", label: "Ödenmemiş", count: unpaid.length },
                  { value: "tumu", label: "Tümü", count: list.length },
                  { value: "odendi", label: "Ödendi", count: list.length - unpaid.length },
                ]}
              />
              {visible.length ? (
                <button
                  type="button"
                  onClick={() => setSelected(pageAll ? new Set() : new Set([...selected, ...pageIds]))}
                  className="min-h-9 cursor-pointer px-1 text-[13px] font-medium text-info underline-offset-2 hover:underline pointer-coarse:min-h-11"
                >
                  {pageAll ? "Seçimi kaldır" : "Sayfadakileri seç"}
                </button>
              ) : null}
            </div>

            {parasutPaid.length ? (
              <Notice
                tone="warn"
                risk="para"
                live="polite"
                className="mx-5 mb-3 max-sm:mx-4"
                title={`Paraşüt'te ödenmiş ${num(parasutPaid.length)} fatura panelde ödenmedi (${money(parasutPaid.reduce((a, r) => a + openBalance(r), 0))})`}
                text="Ödediyseniz işaretleyin."
                action={
                  <Button size="xs" variant="secondary" onClick={() => setPayment(parasutPaid, { status: "paid", date: null, via: null }, { onlyOpen: true })}>
                    <CircleCheck size={15} aria-hidden="true" /> Ödendi işaretle
                  </Button>
                }
              />
            ) : null}

            {visible.length ? (
              <>
                {/* Telefon ve tablet: kartlar */}
                <ul className="divide-y divide-line-strong/70 border-t border-line lg:hidden">
                  {paged.slice.map((r) => {
                    const isSel = selected.has(r.id);
                    return (
                      <li key={r.id} data-fatura={r.id} className={cn("px-4 pt-3 pb-3 transition-colors", isSel && "bg-surface/70")}>
                        <div className="flex items-start gap-2">
                          {checkbox(r, "-mt-1 -ml-1.5 size-11")}
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] leading-5 font-medium text-ink tabular">{dateTR(r.date)}</p>
                            {r.invoiceNo ? <p className="text-xs break-all text-ink-mute">No {r.invoiceNo}</p> : null}
                            <p className="mt-0.5 text-[13px] break-words text-ink-mute">{[r.description, r.category].filter(Boolean).join(" · ")}</p>
                            <div className="mt-1 flex flex-wrap gap-1 empty:hidden">{hints(r)}</div>
                          </div>
                          <div className="shrink-0 text-right text-[15px] tabular">{amountCell(r)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-9">
                          {statusPill(r, "md")}
                          {r.unpaid ? <span className="text-xs">{dueCell(r)}</span> : null}
                          <span className="ml-auto flex items-center gap-1.5">
                            {docButton(r, "size-11")}
                            {canPartial(r) ? (
                              <IconButton label="Kısmi ödeme" onClick={() => partialPay(r)} className="size-11">
                                <HandCoins size={15} />
                              </IconButton>
                            ) : null}
                            {r.unpaid ? (
                              <Button variant="secondary" size="sm" onClick={() => quickPaid([r])} className="text-ink" aria-label={`${dateTR(r.date)} faturası ödendi (bugün)`}>
                                <Check size={15} aria-hidden="true" /> Ödendi
                              </Button>
                            ) : null}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <TableWrap className="max-lg:hidden">
                  <Table>
                    <THead>
                      <tr>
                        <TH className="w-px pr-0">
                          <span className="sr-only">Seç</span>
                        </TH>
                        <TH>Fatura</TH>
                        <TH>
                          <span className="inline-flex items-center gap-1.5">
                            Vade
                            <InfoTip text={`Ödenmemiş faturanın vadesi. * işaretli: faturada vade yok, fatura tarihi + ${termDays} gün (tahmini). Vade günü Düzenle'den değişir.`} />
                          </span>
                        </TH>
                        <TH numeric>
                          Tutar
                          <span className="block text-xs font-normal text-ink-mute">KDV dahil</span>
                        </TH>
                        <TH>Durum</TH>
                        <TH className="w-px px-2">
                          <span className="sr-only">Eylemler</span>
                        </TH>
                      </tr>
                    </THead>
                    <tbody>
                      {paged.slice.map((r) => (
                        <TR key={r.id} data-fatura={r.id} className={cn(selected.has(r.id) && "bg-surface/70")}>
                          <TD className="w-px pr-0">{checkbox(r)}</TD>
                          <TD className="min-w-56">
                            <p className="font-medium text-ink tabular">
                              {dateTR(r.date)}
                              {r.invoiceNo ? <span className="ml-2 text-[13px] font-normal text-ink-mute">No {r.invoiceNo}</span> : null}
                            </p>
                            <p className="mt-0.5 text-[13px] break-words text-ink-mute">{[r.description, r.category].filter(Boolean).join(" · ")}</p>
                            <div className="mt-1 flex flex-wrap gap-1 empty:hidden">{hints(r)}</div>
                          </TD>
                          <TD className="whitespace-nowrap">{dueCell(r)}</TD>
                          <TD numeric>{amountCell(r)}</TD>
                          <TD className="whitespace-nowrap">{statusPill(r)}</TD>
                          <TD className="px-2">
                            <div className="flex justify-end gap-1">
                              {r.unpaid ? (
                                <IconButton label="Ödendi (bugün)" onClick={() => quickPaid([r])}>
                                  <Check size={15} />
                                </IconButton>
                              ) : null}
                              {canPartial(r) ? (
                                <IconButton label="Kısmi ödeme" onClick={() => partialPay(r)}>
                                  <HandCoins size={15} />
                                </IconButton>
                              ) : null}
                              {docButton(r)}
                              <IconLink href={invoicesHref(r)} label="Faturalar'da aç">
                                <ExternalLink size={15} />
                              </IconLink>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                <Pagination
                  page={paged.page}
                  pageCount={paged.pageCount}
                  onChange={paged.setPage}
                  total={paged.pageCount > 1 ? paged.total : undefined}
                  unit="fatura"
                  className="border-t border-line max-sm:px-3 [&>div]:flex-wrap max-sm:[&>div]:gap-1"
                />
              </>
            ) : (
              <div className="border-t border-line">
                {list.length ? (
                  <EmptyState
                    icon={<CircleCheck />}
                    title={status === "odenmedi" ? "Ödenmemiş fatura yok" : "Ödenmiş fatura yok"}
                    description={
                      status === "odenmedi"
                        ? card?.paidOnDelivery
                          ? "Bu tedarikçinin bütün faturaları ödendi. Bilgilerinde “Faturaları ödendi gelsin” açık: yeni faturaları da ödendi gelir."
                          : "Bu tedarikçinin bütün faturaları ödendi. Yeni fatura Paraşüt'ten gelince burada ödenmedi olarak görünür."
                        : "Henüz ödendi işaretlenen fatura yok."
                    }
                    action={
                      <Button variant="secondary" onClick={() => setStatus("tumu")}>
                        Bütün faturaları göster
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    title={cari.debts.length || cari.payments.length ? "Henüz fatura yok" : "Fatura ya da kayıt yok"}
                    description="Elden aldıysanız Borç ekle, Paraşüt'te yoksa Faturalar'dan fatura ekleyin. Paraşüt'e gelen faturalar her sabah kendiliğinden buraya düşer; eskileri “Geçmiş faturaları al” getirir."
                    action={
                      <span className="flex flex-wrap justify-center gap-2">
                        {placeholder ? null : (
                          <Button variant="secondary" onClick={() => setDebtFor({})}>
                            <Plus size={16} aria-hidden="true" /> Borç ekle
                          </Button>
                        )}
                        {canImport && !placeholder ? (
                          <Button variant="secondary" onClick={() => void importHistory()} disabled={importing}>
                            <History size={16} aria-hidden="true" /> {importing ? "Okunuyor…" : "Geçmiş faturaları al"}
                          </Button>
                        ) : (
                          <ButtonLink href="/panel/faturalar" variant="secondary">
                            Faturalar
                          </ButtonLink>
                        )}
                      </span>
                    }
                  />
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Toplu işlem çubuğu: seçim varken altta yüzer */}
      <FloatingBar open={chosen.length > 0}>
        <p className="min-w-0 flex-1 text-sm text-ink sm:flex-none" aria-live="polite">
          <span className="font-semibold tabular">{num(chosen.length)}</span> fatura seçildi
          <span className="text-ink-mute tabular"> · {money(chosen.reduce((a, r) => a + (r.unpaid ? openBalance(r) : r.payable), 0))}</span>
        </p>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          {chosenDebts.length ? (
            <Button variant="secondary" onClick={() => setRequestFor(chosenDebts.map((r) => r.id))} className="text-ink max-sm:flex-1">
              <Send size={16} aria-hidden="true" /> Ödeme talebi
            </Button>
          ) : null}
          <Button onClick={() => setPaying({ ids: chosen.map((r) => r.id), initial: chosenUnpaid.length ? "paid" : "unpaid" })} className="max-sm:flex-1">
            <CircleCheck size={16} aria-hidden="true" /> Ödeme durumu
          </Button>
          <IconButton label="Seçimi kaldır (Esc)" onClick={clearSelection}>
            <X size={15} />
          </IconButton>
        </div>
      </FloatingBar>

      {paying ? (
        <PaymentDialog
          targets={list
            .filter((r) => paying.ids.includes(r.id))
            .map((r) => ({ id: r.id, unpaid: r.unpaid, paidAt: r.paidAt, paidVia: r.paidVia, paymentRequestedAt: r.paymentRequestedAt, amount: r.unpaid ? openBalance(r) : r.payable }))}
          title={
            paying.ids.length === 1
              ? `${supplier.name} · ${dateTR(list.find((r) => r.id === paying.ids[0])?.date)}`
              : supplier.name
          }
          today={today}
          defaultMethod={card?.paymentMethod ?? null}
          initial={paying.initial}
          ledger={ledgerFor(paying.ids)}
          onClose={() => setPaying(null)}
          onSave={(choice, opts) => {
            const rows = list.filter((r) => paying.ids.includes(r.id));
            setPaying(null);
            clearSelection();
            setPayment(rows, choice, { separately: opts.separately });
          }}
        />
      ) : null}

      {requestFor ? (
        <RequestDialog
          name={supplier.name}
          card={card}
          taxNumber={supplier.taxNumber}
          invoices={unpaid
            .filter((r) => openBalance(r) > 0)
            .map((r) => ({ id: r.id, date: r.date, invoiceNo: r.invoiceNo, amount: openBalance(r), dueDate: r.dueDate, paymentRequestedAt: r.paymentRequestedAt }))
            .sort((a, b) => a.date.localeCompare(b.date))}
          // İade faturaları: ödenmedi duranlar (kalan borçtan zaten düşülür) seçili gelir; son 90 günün ödendi
          // görünenlerinin düşülüp düşülmediği bilinmez, seçilirse düşülür
          credits={list
            .filter((r) => r.payable < 0 && (r.unpaid || daysBetween(r.date, today) <= CREDIT_DAYS))
            .map((r) => ({ id: r.id, date: r.date, invoiceNo: r.invoiceNo, amount: r.payable, dueDate: null, paymentRequestedAt: null, open: r.unpaid }))
            .sort((a, b) => a.date.localeCompare(b.date))}
          purchases={purchases}
          accountCredit={cari.credit}
          selected={requestFor}
          termDays={termDays}
          payer={PRODUCT_NAME}
          onClose={() => setRequestFor(null)}
          onEditCard={() => {
            setRequestFor(null);
            setEditing(true);
          }}
          onMark={(ids) => {
            clearSelection();
            setPayment(
              list.filter((r) => ids.includes(r.id)),
              { status: "requested", date: today },
              { onlyOpen: true },
            );
          }}
        />
      ) : null}

      {editing ? (
        <SupplierCardDialog
          card={card}
          name={supplier.name}
          names={supplier.names}
          // Kartta vergi no yoksa faturalardaki tek numara alana önerilir (kart kendiliğinden yazılmaz)
          inferredTaxNumber={card?.taxNumber ? null : supplier.taxNumber}
          taxIndex={taxIndex}
          slug={card ? null : supplier.slug}
          suggestions={suggestions}
          defaultTermDays={defaultTermDays}
          canFill={canFill}
          onClose={() => setEditing(false)}
          onSaved={(r) => {
            // Ad değişince adres de değişir; liste sayfanın yeni adresine geçer
            if (r.slug && r.slug !== supplier.slug) router.replace(supplierHref(r.slug));
          }}
          onDelete={
            hidden || placeholder
              ? undefined
              : () => {
                  setEditing(false);
                  setRemoving(true);
                }
          }
        />
      ) : null}

      {removing ? (
        <RemoveSupplierDialog
          target={{
            cardId: card?.id ?? null,
            key: supplier.key,
            name: supplier.name,
            invoiceCount: invoices.length,
            openCount: unpaid.length,
            open: unpaid.reduce((a, r) => a + openBalance(r), 0),
            // Kartsız tedarikçi adıyla açılan kartla kaldırılır: adı başka kartlarda da duruyorsa onları da çekerdi
            moves: !card && taxIndex ? nameMoves(taxIndex, supplier.names, null) : null,
          }}
          onClose={() => setRemoving(false)}
          // Silinince sayfanın adresi kalmayabilir: listeye dönülür; bildirimdeki "Geri al" sayfayı yeniden açar
          onDone={() => router.replace("/panel/tedarikciler")}
        />
      ) : null}

      {docRow ? <DocumentSheet key={`belge-${docRow.id}`} invoice={docRow} documents={docsOf(docRow.id)} onClose={() => setDocFor(null)} /> : null}

      {debtFor ? (
        <DebtDialog
          target={cari.target}
          supplierName={supplier.name}
          names={names}
          today={today}
          businessDay={cari.businessDay}
          termDays={termDays}
          categories={cari.categories}
          defaultCategoryId={cari.defaultCategoryId}
          defaultMode={cari.defaultCostMode}
          defaultMethod={defaultMethod}
          credit={cari.credit}
          unpaidInvoices={unpaid.map((r) => ({ date: r.date, balance: openBalance(r) }))}
          debt={debtFor.debt ?? null}
          initialMode={debtFor.mode}
          tills={cari.tills}
          expenseBranches={cari.expenseBranches}
          onClose={() => {
            setDebtFor(null);
            clearParams();
          }}
          onSaved={onCariSaved}
        />
      ) : null}

      {payFor ? (
        <CariPaymentDialog
          target={cari.target}
          supplierName={supplier.name}
          names={names}
          today={today}
          businessDay={cari.businessDay}
          defaultMethod={defaultMethod}
          items={cari.items}
          payment={payFor.payment ?? null}
          initial={payFor.initial}
          tills={cari.tills}
          onClose={closePayment}
          onSaved={onCariSaved}
        />
      ) : null}

      {linkFor && cari.cardId ? (
        <LinkDialog
          cardId={cari.cardId}
          supplierName={supplier.name}
          today={today}
          debts={cari.debts.filter((d) => d.invoiceId === null)}
          invoices={list
            .filter((r) => linkableInvoice(r) && !cari.debts.some((d) => d.invoiceId === r.id))
            .map((r) => ({ id: r.id, date: r.date, invoiceNo: r.invoiceNo, payable: r.payable, amount: r.amount, discount: r.discount, category: r.category, vat: r.vat }))}
          expenses={cari.expenses}
          countedCategories={cari.countedCategories}
          preselect={linkFor}
          onClose={() => {
            setLinkFor(null);
            clearParams();
          }}
        />
      ) : null}

      {allocPayment ? (
        <AllocationDialog
          payment={allocPayment}
          title={`${dateTR(allocPayment.date)} · ${METHOD_LABEL[allocPayment.method]} · ${money(allocPayment.amount)}`}
          {...allocationOptions(allocPayment.id)}
          onClose={() => setAllocFor(null)}
        />
      ) : null}

      {confirming?.kind === "delete" ? (
        <EntryConfirm
          title={confirming.entry === "borc" ? "Alımı sil" : "Ödemeyi sil"}
          description={<DeleteText confirming={confirming} cari={cari} />}
          confirmLabel="Sil"
          run={(confirmPast) => deleteSupplierEntry({ id: confirming.id, confirmPast })}
          onDone={(d) =>
            toast.success(d.kind === "borc" ? "Alım silindi" : "Ödeme silindi", {
              description: [confirming.text, d.reopened ? `${num(d.reopened)} fatura ödenmemişe döndü` : "", d.kept ? `${num(d.kept)} fatura başka biçimde ödendi işaretli, bırakıldı` : ""].filter(Boolean).join(" · "),
              duration: CARI_UNDO_MS,
              action: { label: "Geri al", onClick: () => void undo(() => restoreSupplierEntry(d.undo), "Kayıt geri alındı") },
            })
          }
          onClose={() => setConfirming(null)}
        />
      ) : null}
      {confirming?.kind === "unlink" ? (
        <EntryConfirm
          title="Bağı kaldır"
          tone="primary"
          description={`${confirming.text}: faturadan ayrılır ve önceki hâline döner; faturaya bu alımdan geçen ödemeler alıma geri taşınır, gider kaydı varsa yeniden yazılır.`}
          confirmLabel="Bağı kaldır"
          run={(confirmPast) => unlinkDebts({ debtIds: [confirming.id], confirmPast })}
          onDone={() => toast.success("Bağ kaldırıldı", { description: confirming.text })}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      <ConfirmDialog
        open={devirAsk !== null}
        onClose={() => setDevirAsk(null)}
        onConfirm={() => void importHistory(true)}
        title="Geçmiş faturaları al"
        description={`Bu tedarikçide ${dateTR(devirAsk)} tarihli eski borç (devir) var. Bu tarihten eski faturalar alınırsa borç iki kez sayılır. Yine de alınsın mı?`}
        confirmLabel="Yine de al"
        tone="primary"
      />

      <ConfirmDialog
        open={creditAsk}
        onClose={() => setCreditAsk(false)}
        onConfirm={applyCredit}
        title="Borçlara say"
        description={`Hesaptaki ${money(cari.credit)} en eski vadeden açık kalemlere sayılır. ${creditPreview}`}
        confirmLabel="Borçlara say"
        tone="primary"
        pending={cariBusy}
      />
    </>
  );
}

/** Silme onayının açıklaması: neyin silineceği ve paranın nereye gideceği */
function DeleteText({ confirming, cari }: { confirming: Extract<Confirming, { kind: "delete" }>; cari: CariData }) {
  if (confirming.entry === "borc") {
    const d = cari.debts.find((x) => x.id === confirming.id);
    const counted = cari.allocations.filter((a) => a.debtId === confirming.id).reduce((x, a) => x + a.amount, 0);
    return (
      <>
        <p className="font-medium text-ink">{confirming.text}</p>
        <p className="mt-1">
          {[
            counted > EPS ? `Bu alıma sayılan ${money(counted)} ödeme hesaba geçer.` : "",
            d?.costMode === "gider" ? "Aylık harcamalar'daki gider kaydı da silinir." : d?.costMode === "mevcut" ? "Sahiplendiği harcama kaydı olduğu gibi kalır." : "",
          ]
            .filter(Boolean)
            .join(" ") || "Kayıt silinir; bildirimden geri alınabilir."}
        </p>
      </>
    );
  }
  const p = cari.payments.find((x) => x.id === confirming.id);
  return (
    <>
      <p className="font-medium text-ink">{confirming.text}</p>
      <p className="mt-1">
        Sayıldığı faturalar ve alımlar yeniden açılır; elle ödendi işaretlenmiş faturalar olduğu gibi kalır.
        {p?.cashOutId ? (p.cashOutCreated ? " Kasaya açtığı satır da silinir." : " Bağlı kasa satırı kalır ve işlenmemişe döner.") : ""}
      </p>
    </>
  );
}

/**
 * Aynı vergi nosunu taşıyan öteki tedarikçiler: sayfanın üstünde birer satır (listeden kaldırıldı şeridiyle aynı
 * görünüm), onların sayfasına bağlantıyla. Birleştirme yok, yalnız bilgi ve ne yapılabileceği (sharedTaxNotes).
 */
function TaxNotices({ notes }: { notes: TaxNote[] }) {
  if (!notes.length) return null;
  const rest = notes.length - TAX_NOTES_SHOWN;
  return (
    <div className="mb-4 space-y-2">
      {notes.slice(0, TAX_NOTES_SHOWN).map((n) => (
        <Notice key={n.slug} tone="neutral" live="polite" title={n.text} action={<NoticeLink href={supplierHref(n.slug)}>Sayfasına git</NoticeLink>} />
      ))}
      {rest > 0 ? <p className="px-1 text-xs text-ink-mute">+{num(rest)} tedarikçi daha aynı vergi nosunu taşıyor.</p> : null}
    </div>
  );
}

/** "12 fatura" */
const invoiceCount = (n: number) => `${num(n)} fatura`;

/**
 * Tedarikçi bilgileri: IBAN (kopyala), vergi no, iletişim (ara, WhatsApp, e-posta), vade ve ödeme şekli. Kartta vergi
 * no yoksa faturalardaki tek numara "faturalardan" diye görünür (kart kendiliğinden yazılmaz, Düzenle önerir); vergi
 * noyla gelen adlar ve faturalardaki numaralar kartınkiyle uyuşmazsa not düşülür.
 */
function CariPanel({
  card,
  taxNumber,
  taxNumbers,
  viaTax,
  termDays,
  defaultTermDays,
  copied,
  copy,
  onEdit,
}: {
  card: SupplierCard | null;
  /** Kartta yazılı, yoksa faturalardaki tek vergi no */
  taxNumber: string | null;
  taxNumbers: TaxCount[];
  viaTax: string[];
  termDays: number;
  defaultTermDays: number;
  copied: string | null;
  copy: (key: string, text: string, okMessage?: string) => Promise<boolean>;
  onEdit: () => void;
}) {
  // Faturalarda iki ya da daha çok numara: biri başka bir firmanın (ör. kısa adla eşlenmiş başka şirket) olabilir
  const manyTaxes =
    taxNumbers.length > 1 ? (
      <p className="text-xs leading-5 text-ink-mute md:col-span-2">
        Faturalarda {num(taxNumbers.length)} ayrı vergi no var: {taxNumbers.map((t) => `${t.taxNumber} (${invoiceCount(t.count)})`).join(", ")}. Biri başka firmaysa o faturanın tedarikçi
        adını Faturalar&apos;dan düzeltin.
      </p>
    ) : null;
  if (!card) {
    return (
      <Card>
        <CardHeader icon={<Contact />} title="Tedarikçi bilgileri" />
        <CardContent className="space-y-3">
          <p className="text-sm leading-6 text-ink-mute">
            Unvan, vergi no, IBAN ve iletişim bilgileri girilmemiş. IBAN ödeme talebinde ve kopyalarken kullanılır; vade günü bu tedarikçinin vadesiz faturalarının tahmini vadesini belirler (şu an {defaultTermDays} gün).
            {taxNumber ? ` Vergi no faturalardan: ${taxNumber}.` : null}
          </p>
          {manyTaxes}
          <Button onClick={onEdit} className="mt-1 w-full">
            <Pencil size={16} aria-hidden="true" /> Bilgileri ekle
          </Button>
        </CardContent>
      </Card>
    );
  }
  // Kartta yazılı değilse faturalardaki tek numara (taxNumber), yazılıysa kartınki
  const inferred = card.taxNumber ? null : taxNumber;
  const shownTax = card.taxNumber ?? inferred;
  // Kartın numarası faturalardaki tek numaradan farklı: yazım hatası ya da başka firmanın numarası olabilir
  const otherTax = card.taxNumber && taxNumbers.length === 1 && normalizeTaxNumber(card.taxNumber) !== taxNumbers[0].taxNumber ? taxNumbers[0] : null;
  const missing = missingInfo(card, inferred);
  const tel = telHref(card.phone);
  const wa = whatsappHref(card.phone);
  const mail = mailtoHref(card.email);
  const copyBtn = (key: string, text: string, label: string) => (
    <IconButton label={copied === key ? `${label} kopyalandı` : `${label} kopyala`} onClick={() => void copy(key, text, `${label} kopyalandı`)} className="-my-1 shrink-0">
      {copied === key ? <Check size={15} className="text-good" /> : <Copy size={15} />}
    </IconButton>
  );
  return (
    <Card>
      <CardHeader
        icon={<Contact />}
        title="Tedarikçi bilgileri"
        actions={
          <Button variant="secondary" size="sm" onClick={onEdit} className="text-ink">
            <Pencil size={14} aria-hidden="true" /> Düzenle
          </Button>
        }
      />
      <CardContent className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-3">
          {card.iban ? (
            <div className="rounded-2xl bg-surface p-3.5 ring-1 ring-line">
              <p className="text-xs text-ink-mute">IBAN{card.bankName ? ` · ${card.bankName}` : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="min-w-0 flex-1 font-mono text-sm leading-6 tracking-wide break-words text-ink">{formatIban(card.iban)}</p>
                {copyBtn("iban", card.iban, "IBAN")}
              </div>
              {card.accountHolder ? <p className="mt-1 text-xs text-ink-mute">Hesap sahibi: {card.accountHolder}</p> : null}
            </div>
          ) : (
            <Notice
              tone="warn"
              size="sm"
              title="IBAN girilmemiş: ödeme talebinde gerekir"
              action={
                <Button size="xs" variant="secondary" onClick={onEdit}>
                  Ekle
                </Button>
              }
            />
          )}
          {tel || wa || mail ? (
            <div className="flex flex-wrap gap-2">
              {tel ? (
                <a href={tel} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-medium text-ink ring-1 ring-line-strong ring-inset hover:ring-ink/30 pointer-coarse:h-11">
                  <Phone size={15} aria-hidden="true" /> Ara
                </a>
              ) : null}
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-medium text-ink ring-1 ring-line-strong ring-inset hover:ring-ink/30 pointer-coarse:h-11">
                  <MessageCircle size={15} aria-hidden="true" /> WhatsApp
                </a>
              ) : null}
              {mail ? (
                <a href={mail} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface px-3 text-[13px] font-medium text-ink ring-1 ring-line-strong ring-inset hover:ring-ink/30 pointer-coarse:h-11">
                  <Mail size={15} aria-hidden="true" /> E-posta
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
        <dl className="grid gap-x-6 text-sm sm:grid-cols-2 [&>div]:border-b [&>div]:border-line">
          <InfoRow label="Unvan" value={card.legalName} action={card.legalName ? copyBtn("unvan", card.legalName, "Unvan") : null} />
          <InfoRow
            label="Vergi no"
            value={
              shownTax ? (
                <>
                  <span className="tabular">{shownTax}</span>
                  {/* Kartta yazılı değil: faturalardaki tek numara (Düzenle önerir, kaydedince karta geçer) */}
                  {inferred ? <span className="text-ink-mute"> · faturalardan</span> : null}
                  {card.taxOffice ? ` · ${card.taxOffice} VD` : null}
                </>
              ) : card.taxOffice ? (
                `${card.taxOffice} VD`
              ) : null
            }
            action={shownTax ? copyBtn("vergi", shownTax, "Vergi no") : null}
          />
          {viaTax.length ? <InfoRow label="Aynı vergi no" value={viaTax.join(", ")} /> : null}
          <InfoRow label="Yetkili" value={card.contactName} />
          <InfoRow label="Telefon" value={card.phone ? formatPhone(card.phone) : null} />
          <InfoRow label="E-posta" value={card.email} />
          <InfoRow label="Adres" value={card.address} action={card.address ? copyBtn("adres", card.address, "Adres") : null} />
          <InfoRow label="Vade" value={card.paymentTermDays !== null ? `${card.paymentTermDays} gün` : `${termDays} gün (genel ayar)`} />
          <InfoRow label="Ödeme şekli" value={methodLabel(card.paymentMethod)} />
          {card.paidOnDelivery ? <InfoRow label="Faturalar" value="Ödendi gelir (peşin / otomatik ödeme)" /> : null}
          {card.aliases.length ? <InfoRow label="Diğer adlar" value={card.aliases.join(", ")} /> : null}
          {card.note ? <InfoRow label="Not" value={card.note} /> : null}
        </dl>
        {otherTax ? (
          <p className="text-xs leading-5 text-warn md:col-span-2">
            Faturalardaki vergi no farklı: {otherTax.taxNumber} ({invoiceCount(otherTax.count)}). Karttaki numarayı kontrol edin.
          </p>
        ) : null}
        {manyTaxes}
        {missing.length ? (
          <p className="text-xs text-ink-mute md:col-span-2">
            Eksik:{" "}
            {missing
              .map((m) => (m === "iban" ? "IBAN" : m === "vergi" ? "vergi no" : "telefon / e-posta"))
              .join(", ")}
            .{" "}
            <button type="button" onClick={onEdit} className="cursor-pointer font-medium text-info underline-offset-2 hover:underline">
              Tamamla
            </button>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <dt className="w-24 shrink-0 text-ink-mute">{label}</dt>
      <dd className={cn("min-w-0 flex-1 break-words whitespace-pre-line", value ? "text-ink" : "text-ink-quiet")}>{value || "–"}</dd>
      {action}
    </div>
  );
}
