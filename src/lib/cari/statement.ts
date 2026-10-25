/**
 * Hesap hareketleri (ekstre): okuma anında üretilir, saklanmaz (saf; tests/cari-ekstre.test.ts). Bugünkü ✓'ler
 * "Faturada işaretli ödeme", Paraşüt'teki kısmi ödemeler "Paraşüt'te ödenen kısım" satırıdır; veri değişmeden son
 * bakiye bugünkü Kalan borca eşittir (accountOf'un `balance`'ı; tests/cari-hesap.test.ts rastgele örneklerde sınar).
 */
import { methodLabel, type PaymentMethod } from "../../app/panel/tedarikciler/logic";
import { dateTR, tl } from "../format";
import { round2, METHOD_LABEL, type CariMethod } from "./balance";
import { debtLabel, invoiceLabel, type AccountInvoice, type CariAllocation, type CariDebt, type CariPayment } from "./account";

export type StatementKind = "fatura" | "iade" | "iade-dusuldu" | "parasut-kismi" | "isaretli" | "alim" | "devir" | "bagli" | "odeme" | "baska" | "baska-odeme";

export interface StatementRow {
  key: string;
  date: string;
  kind: StatementKind;
  label: string;
  /** Borç (bakiyeyi artırır) */
  debit: number;
  /** Ödeme (bakiyeyi azaltır) */
  credit: number;
  /** Bu satırdan sonraki bakiye */
  balance: number;
  /** Bakiyeyi etkilemeyen gri satır (faturaya bağlanmış alım) */
  muted?: boolean;
  /** Ödeme günü bilinmiyor (fatura günü yazıldı) */
  unknownDay?: boolean;
  ref: { type: "invoice" | "debt" | "payment"; id: number };
  /** Ödemenin neye sayıldığı ve hesapta kalan */
  allocations?: { label: string; amount: number }[];
  left?: number;
  /** Faturada işaretli ödemenin ya da ödemenin şekli (ekstre metni) */
  method?: PaymentMethod | CariMethod | null;
  /** Tedarikçiye giden metindeki ad (iç not olmadan; ekranda `label`) */
  textLabel?: string;
}

/** Grubun faturasına başka bir kartın ödemesinden sayılan (ör. faturası başka tedarikçide görünen alım bağlandı, R3d) */
export interface ForeignCredit {
  invoiceId: number;
  paymentId: number;
  /** Ödemenin günü */
  date: string;
  /** Ödemenin kartı (yalnız ekranda; tedarikçiye giden metne yazılmaz) */
  card: string;
  amount: number;
  /** Ödemenin şekli (ekstre metninde "Ödeme (havale)") */
  method?: CariMethod | null;
}

export interface StatementInput {
  invoices: readonly AccountInvoice[];
  debts?: readonly CariDebt[];
  payments?: readonly CariPayment[];
  allocations?: readonly CariAllocation[];
  /** Başka kartların ödemelerinden bu grubun faturalarına sayılanlar (yoksa faturanın bu kısmı ekstrede ödenmemiş görünürdü) */
  foreign?: readonly ForeignCredit[];
}

const MODE_NOTE: Record<CariDebt["costMode"], string> = {
  fatura: "faturası gelecek",
  gider: "gider yazıldı",
  mevcut: "gideri zaten girildi",
  devir: "",
};

/** Borç satırları önce, sonra ödeme satırları (aynı günde) */
const debitFirst = (r: Pick<StatementRow, "debit" | "credit" | "muted">) => (r.credit > 0 && r.debit === 0 ? 1 : 0);

/**
 * Ekstrenin satırları (§4.8): gün, sonra borç satırları, sonra ödeme satırları, sonra kimlik; bakiye satır satır
 * yürür. `from` verilirse ondan önceki satırlar "Devreden bakiye"de toplanır (`opening`).
 */
export function statementRows(input: StatementInput, range: { from?: string | null } = {}): { opening: number | null; rows: StatementRow[]; closing: number } {
  const debts = input.debts ?? [];
  const payments = input.payments ?? [];
  const allocations = input.allocations ?? [];
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));
  const debtById = new Map(debts.map((d) => [d.id, d]));
  const rows: Omit<StatementRow, "balance">[] = [];
  for (const i of input.invoices) {
    const ref = { type: "invoice" as const, id: i.id };
    const no = i.invoiceNo?.trim();
    if (i.payable > 0) rows.push({ key: `f:${i.id}`, date: i.date, kind: "fatura", label: no ? `Fatura ${no}` : "Fatura", debit: i.payable, credit: 0, ref });
    else if (i.payable < 0) {
      rows.push({ key: `f:${i.id}`, date: i.date, kind: "iade", label: no ? `İade faturası ${no}` : "İade faturası", debit: 0, credit: -i.payable, ref });
      if (!i.unpaid) rows.push({ key: `fd:${i.id}`, date: i.paidAt ?? i.date, kind: "iade-dusuldu", label: "İade düşüldü", debit: -i.payable, credit: 0, ref });
      continue;
    } else continue;
    const tracked = i.ledgerBase !== null && i.ledgerBase !== undefined;
    const base = tracked ? (i.ledgerBase ?? 0) : i.unpaid && i.outstanding !== null && i.outstanding !== undefined && i.outstanding > 0 ? round2(i.payable - i.outstanding) : 0;
    if (base > 0.005) rows.push({ key: `fp:${i.id}`, date: i.date, kind: "parasut-kismi", label: "Paraşüt'te ödenen kısım (gün bilinmiyor)", debit: 0, credit: base, ref });
    if (!i.unpaid && !i.paidByLedger) {
      const marked = round2(i.payable - (tracked ? (i.ledgerBase ?? 0) : 0) - (i.allocated ?? 0));
      if (marked > 0.005) {
        const via = methodLabel(i.paidVia);
        rows.push({
          key: `fo:${i.id}`,
          date: i.paidAt ?? i.date,
          kind: "isaretli",
          label: `Faturada işaretli ödeme${via ? ` · ${via}` : ""}${i.paidAt ? "" : " (gün bilinmiyor)"}`,
          debit: 0,
          credit: marked,
          unknownDay: !i.paidAt,
          ref,
          method: i.paidVia ?? null,
        });
      }
    }
  }
  for (const d of debts) {
    const ref = { type: "debt" as const, id: d.id };
    const what = debtLabel(d);
    if (d.invoiceId !== null) {
      const inv = invoiceById.get(d.invoiceId);
      const target = inv ? invoiceLabel(inv) : "faturaya";
      rows.push({ key: `b:${d.id}`, date: d.date, kind: "bagli", label: `Faturasız alım · ${what} → ${inv ? `${target} faturasına` : target} bağlandı`, debit: d.amount, credit: 0, muted: true, ref });
    } else if (d.costMode === "devir") rows.push({ key: `b:${d.id}`, date: d.date, kind: "devir", label: `Eski borç (devir) · ${what}`, debit: d.amount, credit: 0, ref });
    else rows.push({ key: `b:${d.id}`, date: d.date, kind: "alim", label: `Faturasız alım · ${what} (${MODE_NOTE[d.costMode]})`, textLabel: `Faturasız alım · ${what}`, debit: d.amount, credit: 0, ref });
  }
  for (const f of input.foreign ?? []) {
    const inv = invoiceById.get(f.invoiceId);
    if (!inv || !(f.amount > 0.005)) continue;
    // Öteki kartın adı iç nottur: ekranda durur, tedarikçiye giden metinde satır "Ödeme (havale) · PNR1" olur
    rows.push({
      key: `fx:${f.paymentId}:${f.invoiceId}`,
      date: f.date,
      kind: "baska-odeme",
      label: `${f.card} ödemesinden sayılan · ${invoiceLabel(inv)}`,
      textLabel: invoiceLabel(inv),
      debit: 0,
      credit: round2(f.amount),
      ref: { type: "invoice", id: f.invoiceId },
      method: f.method ?? null,
    });
  }
  for (const p of payments) {
    const mine = allocations.filter((a) => a.paymentId === p.id).sort((a, b) => a.id - b.id);
    const parts: { label: string; amount: number }[] = [];
    let foreign = 0;
    for (const a of mine) {
      const inv = a.invoiceId !== null ? invoiceById.get(a.invoiceId) : undefined;
      const debt = a.debtId !== null ? debtById.get(a.debtId) : undefined;
      if (inv) parts.push({ label: invoiceLabel(inv), amount: a.amount });
      else if (debt) parts.push({ label: debtLabel(debt), amount: a.amount });
      else foreign += a.amount;
    }
    const left = round2(p.amount - mine.reduce((x, a) => x + a.amount, 0));
    const kasa = p.method === "kasa" && p.cashOutStore ? `, Teslim · ${p.cashOutStore}` : "";
    rows.push({
      key: `o:${p.id}`,
      date: p.date,
      kind: "odeme",
      label: `Ödeme · ${METHOD_LABEL[p.method]}${kasa}`,
      debit: 0,
      credit: p.amount,
      ref: { type: "payment", id: p.id },
      allocations: parts,
      left: Math.max(0, left),
      method: p.method,
    });
    // Ad değişikliği gibi bir sebeple başka tedarikçide görünen faturaya sayılan kısım: para orada düşülür
    if (foreign > 0.005) {
      rows.push({ key: `ob:${p.id}`, date: p.date, kind: "baska", label: "Başka tedarikçide görünen faturaya sayılan", debit: round2(foreign), credit: 0, ref: { type: "payment", id: p.id } });
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || debitFirst(a) - debitFirst(b) || a.ref.id - b.ref.id || a.key.localeCompare(b.key));
  let balance = 0;
  let opening: number | null = null;
  const out: StatementRow[] = [];
  for (const r of rows) {
    if (!r.muted) balance = round2(balance + r.debit - r.credit);
    if (range.from && r.date < range.from) {
      opening = balance;
      continue;
    }
    out.push({ ...r, balance });
  }
  if (range.from && opening === null) opening = 0;
  return { opening, rows: out, closing: balance };
}

/** Ekstre metnindeki kısa şekil: "(havale)", "(nakit)" */
const SHORT_METHOD: Record<string, string> = { havale: "havale", nakit: "nakit", kasa: "nakit", elden: "nakit", kart: "kart", cek: "çek", diger: "diğer" };

const minus = (v: number) => `−${tl(v, 2)}`;

/**
 * "Ekstreyi kopyala": tedarikçiye gönderilecek mutabakat metni. Gri (bağlanmış) satırlar yazılmaz; ödemeler eksiyle.
 */
export function statementText(name: string, st: { opening: number | null; rows: readonly StatementRow[]; closing: number }, opts: { from: string; to: string }): string {
  const lines = [`${name} · hesap özeti (${dateTR(opts.from)} – ${dateTR(opts.to)})`, `Devreden bakiye: ${tl(st.opening ?? 0, 2)}`];
  for (const r of st.rows) {
    if (r.muted) continue;
    const day = dateTR(r.date);
    if (r.kind === "isaretli" || r.kind === "odeme" || r.kind === "baska-odeme") {
      // Günü bilinmeyen işaretli ödeme fatura gününde yazılır: tedarikçi o günde ödeme aramasın. Başka kartın
      // ödemesinden sayılan para da ödemedir; hangi faturaya sayıldığı yazılır, kartın adı yazılmaz
      const note = [r.method ? SHORT_METHOD[r.method] : null, r.unknownDay ? "gün bilinmiyor" : null].filter(Boolean).join(", ");
      const what = r.kind === "baska-odeme" && r.textLabel ? ` · ${r.textLabel}` : "";
      lines.push(`${day} · Ödeme${note ? ` (${note})` : ""}${what} · ${minus(r.credit)}`);
    } else if (r.credit > 0) lines.push(`${day} · ${r.textLabel ?? r.label} · ${minus(r.credit)}`);
    else lines.push(`${day} · ${r.textLabel ?? r.label} · ${tl(r.debit, 2)}`);
  }
  const c = st.closing;
  lines.push(`Bakiye: ${tl(Math.abs(c), 2)}${c > 0.005 ? " (borcumuz)" : c < -0.005 ? " (alacağımız)" : ""}`);
  lines.push("L'Affogato");
  return lines.join("\n");
}

/** Ekstrenin alt satırı: "Bakiye 3.000,50 ₺ (borcumuz)", "99,50 ₺ alacak (hesapta)", sıfırda ek yok */
export function statementFooter(closing: number): string {
  if (closing < -0.005) return `${tl(-closing, 2)} alacak (hesapta)`;
  return closing > 0.005 ? `Bakiye ${tl(closing, 2)} (borcumuz)` : `Bakiye ${tl(0, 2)}`;
}
