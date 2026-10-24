"use client";

import { ArrowLeft, Check, CircleCheck, Contact, Copy, EyeOff, ExternalLink, FileText, History, IdCard, Mail, MessageCircle, Paperclip, Pencil, Phone, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, startTransition, useEffect, useOptimistic, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/panel/page-header";
import { toastUnreachable } from "@/components/ui/action-error";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink, IconButton, IconLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { keepScroll, useQueryState } from "@/components/ui/filters";
import { FloatingBar } from "@/components/ui/floating-bar";
import { EmptyState, InfoTip } from "@/components/ui/misc";
import { Pagination, usePaged } from "@/components/ui/pagination";
import { Segmented } from "@/components/ui/segmented";
import { PRODUCT_NAME } from "@/components/akmanos/lib/brand";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";
import { openBalance, isPartiallyPaid } from "@/lib/calc/insights";
import { dateTR, money, num } from "@/lib/format";
import { daysBetween } from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { restoreInvoicePayment, setInvoicePayment, type InvoicePaymentState } from "@/server/actions/invoices";
import { importSupplierHistory, unhideSupplier } from "@/server/actions/suppliers";
import type { LedgerRow } from "@/server/data/suppliers";
import type { DocumentMeta } from "@/server/documents";

import { canHaveDocument, isParasutDocument } from "../../faturalar/document-rules";
import { DocumentSheet } from "../../faturalar/document-sheet";
import { isEInvoiceOnly, supplierMatchKey } from "../../faturalar/rules";
import { useCopied } from "../../kullanicilar/password-field";
import { SupplierCardDialog } from "../card-dialog";
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
import { PaymentDialog, type PaymentChoice } from "../payment-dialog";
import { RemoveSupplierDialog } from "../remove-supplier";
import { RequestDialog } from "../request-dialog";

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
}) {
  const router = useRouter();
  const [list, apply] = useOptimistic(invoices, applyPatch);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [requestFor, setRequestFor] = useState<number[] | null>(null);
  const [paying, setPaying] = useState<{ ids: number[]; initial?: PayState } | null>(null);
  const [docFor, setDocFor] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const { copied, copy } = useCopied();

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
  }, [focusId, list, visible, paged, setFocus, setStatus]);
  const termDays = supplier.termDays;

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
  const hasDebt = unpaid.some((r) => openBalance(r) > 0);
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
  function setPayment(selection: Row[], choice: PaymentChoice, opts: { onlyOpen?: boolean } = {}) {
    const onlyOpen = opts.onlyOpen || selection.length > 1;
    const rows = onlyOpen && choice.status !== "unpaid" ? selection.filter((r) => r.unpaid) : selection;
    const ids = rows.map((r) => r.id);
    if (!ids.length) return void toast.info("Seçilen faturalar zaten ödenmiş; değişiklik yapılmadı.");
    keepScroll();
    const patch = patchFor(choice);
    startTransition(async () => {
      apply({ patches: ids.map((id) => [id, patch]) });
      const r = await setInvoicePayment(ids, choice, { onlyOpen });
      if (!r.ok) return void toast.error(r.error);
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
      const detail = [what, money(total), choice.status === "paid" && choice.date ? `ödeme ${dateTR(choice.date)}` : null, choice.status === "paid" ? methodLabel(choice.via) : null].filter(Boolean).join(" · ");
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
      {r.unpaid && isPartiallyPaid(r) ? <span className="block text-xs text-warn">Kalan {money(r.outstanding)}</span> : null}
    </>
  );

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
    </>
  );

  const headerDescription =
    (card ? [card.legalName, card.taxNumber ? `Vergi no ${card.taxNumber}` : null, card.taxOffice ? `${card.taxOffice} VD` : null].filter(Boolean).join(" · ") : "") ||
    `Faturalardaki adı: ${supplier.names.join(", ") || supplier.name}${supplier.viaTax.length ? " (aynı vergi no)" : ""}`;
  // Paraşüt'ün adı okunamayan faturaları: silinmez, geçmişi alınmaz (sonraki eşitlemede gerçek tedarikçilerine geçer)
  const placeholder = supplier.key === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME);

  async function importHistory() {
    setImporting(true);
    keepScroll();
    // Okuma sürerken başka sayfaya geçildiyse dönüşte o sayfanın adresine dokunulmaz
    const path = window.location.pathname;
    const toastId = toast.loading("Paraşüt'ten geçmiş faturalar okunuyor…", { description: "Faturası çok olan tedarikçide yarım dakikayı bulabilir." });
    try {
      const r = await importSupplierHistory({ cardId: card?.id ?? null, key: supplier.key });
      if (!r.ok) return void toast.error(r.error, { id: toastId, description: undefined });
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
    const r = await unhideSupplier({ cardId: card.id });
    if (!r.ok) return void toast.error(r.error);
    toast.success("Tedarikçi listeye geri alındı", { description: supplier.name });
  }

  return (
    <>
      <PageHeader
        eyebrow="Satış & gider"
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
            <Button size="sm" onClick={() => setEditing(true)}>
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

      {hidden && card ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-panel px-4 py-3 text-[13px] leading-5 text-ink-soft ring-1 ring-line" role="status">
          <EyeOff size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
          <span className="min-w-[14rem] flex-1">
            Bu tedarikçi {card.hiddenOn ? `${dateTR(card.hiddenOn)} tarihinde ` : ""}listeden kaldırıldı; faturaları Faturalar&apos;da duruyor. Yeni faturası gelirse listeye kendiliğinden döner.
          </span>
          <Button variant="secondary" size="sm" onClick={restoreToList} className="text-ink">
            Listeye geri al
          </Button>
        </div>
      ) : null}

      <TaxNotices notes={taxNotes} />

      {/* Sunucudan gelen öğe kendi Fragment'ında: içindeki istemci bileşenleri yüklenmeden RSC yükü okunursa öğe iç
          içe lazy olarak gelir ve React (geliştirmede) onu bu listede anahtarsız sanıp "unique key" uyarısı verirdi */}
      <Fragment key="ozet">{stats}</Fragment>

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
                  onClick={importHistory}
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
            <div className="mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-bordo-50 px-3.5 py-2.5 text-[13px] leading-5 text-bordo-800 max-sm:mx-4" role="status">
              <span className="min-w-[14rem] flex-1">
                Paraşüt&apos;te {num(parasutPaid.length)} faturanın ödemesi kayıtlı ({money(parasutPaid.reduce((a, r) => a + openBalance(r), 0))}); panelde ödenmedi duruyor.
                Ödediyseniz işaretleyin.
              </span>
              <Button size="sm" variant="secondary" className="text-ink" onClick={() => setPayment(parasutPaid, { status: "paid", date: null, via: null }, { onlyOpen: true })}>
                <CircleCheck size={15} aria-hidden="true" /> Ödendi yap ({num(parasutPaid.length)})
              </Button>
            </div>
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
                  title="Henüz fatura yok"
                  description="Bu tedarikçinin faturası Paraşüt'e gelince her sabah kendiliğinden buraya düşer; eskileri “Geçmiş faturaları al” getirir. Faturalar adla ve vergi numarasıyla eşleşir: aynı vergi noyla başka adla gelen fatura da buraya düşer. Kâğıt ya da e-Arşiv faturayı Faturalar'dan elle ekleyebilirsiniz."
                  action={
                    canImport && !placeholder ? (
                      <Button variant="secondary" onClick={importHistory} disabled={importing}>
                        <History size={16} aria-hidden="true" /> {importing ? "Okunuyor…" : "Geçmiş faturaları al"}
                      </Button>
                    ) : (
                      <ButtonLink href="/panel/faturalar" variant="secondary">
                        Faturalar
                      </ButtonLink>
                    )
                  }
                />
              )}
            </div>
          )}
        </Card>
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
          onClose={() => setPaying(null)}
          onSave={(choice) => {
            const rows = list.filter((r) => paying.ids.includes(r.id));
            setPaying(null);
            clearSelection();
            setPayment(rows, choice);
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
        <div key={n.slug} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-panel px-4 py-3 text-[13px] leading-5 text-ink-soft ring-1 ring-line" role="status">
          <IdCard size={16} className="shrink-0 text-ink-mute" aria-hidden="true" />
          <span className="min-w-[14rem] flex-1">{n.text}</span>
          <ButtonLink href={supplierHref(n.slug)} variant="secondary" size="sm" className="text-ink max-sm:w-full">
            Sayfasına git →
          </ButtonLink>
        </div>
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
            <button
              type="button"
              onClick={onEdit}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl bg-warn-soft px-3.5 py-3 text-left text-[13px] font-medium text-warn"
            >
              IBAN girilmemiş: ödeme talebinde gerekir <span aria-hidden="true">Ekle →</span>
            </button>
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
