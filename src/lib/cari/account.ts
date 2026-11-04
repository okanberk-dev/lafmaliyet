/**
 * Cari hesabın saf kuralları (docs/TEDARIKCILER.md "Hesap hareketleri"): elle borç ve ödeme kayıtları, ödemenin
 * dağıtımı, hesapta duran paranın okuma anında mahsubu, ödeme olayları ve tedarikçinin hesap özeti. İstemci ve sunucu
 * birlikte kullanır; veritabanına yazan yarı src/server/cari/settle.ts (tests/cari-hesap.test.ts, cari-sabit.test.ts).
 *
 * Tedarikçinin hesabı (kartın grubu):
 * - açık = Σ faturaların kalanı (openBalance; ödenmemiş iade eksi) + Σ bağsız borçların kalanı
 * - hesaptaki para = Σ ödemelerin dağıtılmamış kısmı
 * - bakiye = açık − hesaptaki para
 * Hiç kayıt yokken bütün rakamlar bugünkü kuralla aynıdır (tests/cari-sabit.test.ts).
 */
import { dateTR, tl } from "../format";
import { addDays, daysBetween } from "../reminders";
import { coveredByAllocations, EPS, openBalance, paidViaOf, round2, type BalanceInvoice, type CariMethod, type InvoicePaidVia } from "./balance";

// ---------------------------------------------------------------- Türler

/** Borcun gideri: fatura gelince fatura, faturasız bir Aylık harcamalar kaydı, var olan kayıt ya da hiç (eski borç) */
export type CostMode = "fatura" | "gider" | "mevcut" | "devir";

export const COST_MODES = ["fatura", "gider", "mevcut", "devir"] as const satisfies readonly CostMode[];

export const COST_MODE_LABEL: Record<CostMode, string> = {
  fatura: "Faturası gelecek",
  gider: "Faturası yok · gider yaz",
  mevcut: "Gideri zaten girildi",
  devir: "Eski borç (devir)",
};

/** Bağlanmadan önceki hâl ("Faturası geldi"); bağ kaldırılınca ya da fatura silinince geri gelir */
export interface LinkPrev {
  costMode: CostMode;
  categoryId: number | null;
  /**
   * Bağlarken silinen gider kaydı (gider ve mevcut kipte); kimliği, ödeme şekli ve yazanı sonradan eklendi (eski
   * kayıtta yok)
   */
  expense?: {
    categoryId: number;
    description: string | null;
    note: string | null;
    amount: number;
    date: string;
    id?: number;
    paymentMethod?: "nakit" | "kart" | "havale" | "diger" | null;
    createdBy?: string | null;
    /** Kaydın şubesi (null = işletme geneli); dalga 3'te eklendi, eski kayıtta yok (docs/SUBE.md) */
    branchId?: string | null;
  } | null;
}

/** "Gideri zaten girildi": sahiplenilen kaydın sahiplenmeden önceki günü ve tutarı (sahiplik kalkınca geri yazılır) */
export interface AdoptPrev {
  /** Aylık harcamalar kaydı */
  id: number;
  date: string;
  amount: number;
}

export interface CariDebt {
  id: number;
  /** Alım günü */
  date: string;
  amount: number;
  /** Ne alındı */
  description: string | null;
  costMode: CostMode;
  dueDate: string | null;
  /** Bağlandığı fatura ("Faturası geldi"); bağlıyken kalanı 0 */
  invoiceId: number | null;
  note?: string | null;
  categoryId?: number | null;
  remindAfter?: string | null;
  dismissedInvoiceIds?: readonly number[];
}

export interface CariPayment {
  id: number;
  date: string;
  amount: number;
  method: CariMethod;
  note?: string | null;
  cashOutId?: number | null;
  /** Kasadan ödemede Kasa satırının Kime'si (ekstrede "Teslim · Sütaş") */
  cashOutStore?: string | null;
}

export interface CariAllocation {
  id: number;
  paymentId: number;
  invoiceId: number | null;
  debtId: number | null;
  originDebtId?: number | null;
  amount: number;
}

/** Hesabın faturası (Tedarikçiler'in fatura alanları; LedgerInvoice bunu karşılar) */
export interface AccountInvoice extends BalanceInvoice {
  id: number;
  date: string;
  invoiceNo?: string | null;
  dueDate?: string | null;
  paidAt?: string | null;
  paidVia?: InvoicePaidVia | null;
  paymentRequestedAt?: string | null;
  paidByLedger?: boolean | null;
}

/** Faturalar penceresinin cari bilgisi: bu faturaya sayılan ödemeler ve bağlı faturasız alımlar (fotoğraflarıyla) */
export interface InvoiceCariLinks {
  /** Kartın adı (silme onayında: para bu tedarikçinin hesabına geçer) */
  card: string | null;
  payments: { date: string; method: CariMethod; amount: number }[];
  debts: { id: number; date: string; description: string | null; amount: number; photoId: number | null }[];
}

// ---------------------------------------------------------------- Vade

/** "Yakında" sayılan gün: vadesi bugünden en çok bu kadar sonra (gecikmişler hariç) */
export const SOON_DAYS = 7;

export interface Due {
  date: string;
  /** Faturada vade yok: fatura tarihi + vade günü */
  estimated: boolean;
}

/** Faturanın (ya da borcun) vadesi; yazılmamışsa tarih + vade günü (kartta yoksa Ödemeler'deki genel ayar) tahminidir */
export function dueOf(i: { date: string; dueDate?: string | null }, termDays: number): Due {
  return i.dueDate ? { date: i.dueDate, estimated: false } : { date: addDays(i.date, termDays), estimated: true };
}

// ---------------------------------------------------------------- Tek kayıt

const sumBy = <T>(list: readonly T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

/** Borcun kalanı: faturaya bağlıysa 0, değilse tutar − borca sayılanlar (eksi olmaz) */
export function debtRemaining(d: Pick<CariDebt, "id" | "amount" | "invoiceId">, allocations: readonly CariAllocation[]): number {
  if (d.invoiceId !== null) return 0;
  return round2(Math.max(0, d.amount - sumBy(allocations.filter((a) => a.debtId === d.id), (a) => a.amount)));
}

/** Ödemenin hesapta duran (hiçbir kaleme sayılmamış) kısmı */
export function paymentCredit(p: Pick<CariPayment, "id" | "amount">, allocations: readonly CariAllocation[]): number {
  return round2(Math.max(0, p.amount - sumBy(allocations.filter((a) => a.paymentId === p.id), (a) => a.amount)));
}

// ---------------------------------------------------------------- Açık kalemler, dağıtım ve mahsup

/** Ödemenin sayılabileceği açık kalem: kalanı 0'dan büyük fatura ya da bağsız borç (iadeler hariç) */
export interface OpenItem {
  kind: "invoice" | "debt";
  id: number;
  date: string;
  /** Vade (kalemin kendi vadesi ya da tahmini) */
  due: string;
  dueEstimated: boolean;
  /** Kalan (> 0) */
  balance: number;
  /** Kısa ad: fatura numarası ya da ne alındı */
  label: string;
  /**
   * Sessiz kalem: "link" faturasız alımın faturası olabilir (bağlanana kadar e-postada ve planda yok), "kasa" kasadan
   * ödenmiş olabilir. Mahsup sessiz kalemi atlar
   */
  quiet?: "link" | "kasa";
}

/** Dağıtım ve mahsup sırası: vade, sonra tarih, sonra önce faturalar, sonra kimlik */
export function compareOpenItems(a: Pick<OpenItem, "kind" | "id" | "date" | "due">, b: Pick<OpenItem, "kind" | "id" | "date" | "due">): number {
  return a.due.localeCompare(b.due) || a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1) || a.id - b.id;
}

/** Fatura kaleminin kısa adı */
export const invoiceLabel = (i: { invoiceNo?: string | null; date: string }) => i.invoiceNo?.trim() || `${dateTR(i.date)} faturası`;

/** Borç kaleminin kısa adı */
export const debtLabel = (d: { description: string | null; date: string }) => d.description?.trim() || `${dateTR(d.date)} alımı`;

/** Hesabın açık kalemleri, dağıtım sırasıyla */
export function openItems(
  input: { invoices: readonly AccountInvoice[]; debts?: readonly CariDebt[]; allocations?: readonly CariAllocation[] },
  termDays: number,
): OpenItem[] {
  const allocations = input.allocations ?? [];
  const out: OpenItem[] = [];
  for (const i of input.invoices) {
    const balance = openBalance(i);
    if (!(balance > EPS)) continue;
    const due = dueOf(i, termDays);
    out.push({ kind: "invoice", id: i.id, date: i.date, due: due.date, dueEstimated: due.estimated, balance, label: invoiceLabel(i) });
  }
  for (const d of input.debts ?? []) {
    const balance = debtRemaining(d, allocations);
    if (!(balance > EPS)) continue;
    const due = dueOf(d, termDays);
    out.push({ kind: "debt", id: d.id, date: d.date, due: due.date, dueEstimated: due.estimated, balance, label: debtLabel(d) });
  }
  return out.sort(compareOpenItems);
}

export interface AllocationLine {
  kind: "invoice" | "debt";
  id: number;
  amount: number;
}

/** "En eski borçtan": tutar açık kalemlere sırayla sayılır, sayılamayan kısım hesapta kalır (`left`) */
export function allocateFifo<T extends Pick<OpenItem, "kind" | "id" | "date" | "due" | "balance">>(items: readonly T[], amount: number): { lines: AllocationLine[]; left: number } {
  let rest = round2(amount);
  const lines: AllocationLine[] = [];
  for (const it of [...items].sort(compareOpenItems)) {
    if (rest <= EPS) break;
    if (!(it.balance > EPS)) continue;
    const take = round2(Math.min(rest, it.balance));
    lines.push({ kind: it.kind, id: it.id, amount: take });
    rest = round2(rest - take);
  }
  return { lines, left: Math.max(0, rest) };
}

/**
 * "Seçerek" dağıtımın denetimi (kilit altında yeniden de çalışır): her satır açık bir kalem, kalanını aşmaz, toplam
 * ödemeyi aşmaz. Hata yoksa null.
 */
export function validateManual(lines: readonly AllocationLine[], items: readonly OpenItem[], amount: number): string | null {
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  const seen = new Set<string>();
  let total = 0;
  for (const l of lines) {
    const k = `${l.kind}:${l.id}`;
    const it = byKey.get(k);
    if (!it) return "Seçilen kalem bu tedarikçinin açık kalemi değil; sayfayı yenileyin.";
    if (seen.has(k)) return `${it.label} iki kez seçilmiş`;
    seen.add(k);
    if (!(l.amount > 0)) return `${it.label} için tutar girin`;
    if (l.amount > it.balance + EPS) return `${it.label} kalanı ${tl(it.balance, 2)}`;
    total += l.amount;
  }
  if (round2(total) > round2(amount) + EPS) return "Sayılan tutar ödemeden fazla";
  return null;
}

/**
 * Canlı önizleme (Ödeme ekle): "Kapanacak: SUT123 8.450,50 ₺ · Kısmen: SUT140 1.549,50 / 1.800,00 ₺ · Hesapta kalacak:
 * 0,00 ₺". `items`: dağıtılan kalemler (kalanlarıyla)
 */
export function allocationPreview(lines: readonly AllocationLine[], items: readonly Pick<OpenItem, "kind" | "id" | "label" | "balance">[], left: number): string {
  const byKey = new Map(items.map((i) => [`${i.kind}:${i.id}`, i]));
  const closed: string[] = [];
  const partial: string[] = [];
  for (const l of lines) {
    const it = byKey.get(`${l.kind}:${l.id}`);
    if (!it) continue;
    if (l.amount >= it.balance - EPS) closed.push(`${it.label} ${tl(l.amount, 2)}`);
    else partial.push(`${it.label} ${num2(l.amount)} / ${tl(it.balance, 2)}`);
  }
  return [closed.length ? `Kapanacak: ${closed.join(", ")}` : "", partial.length ? `Kısmen: ${partial.join(", ")}` : "", `Hesapta kalacak: ${tl(left, 2)}`]
    .filter(Boolean)
    .join(" · ");
}

/** Tutar, ₺ işareti olmadan (iki ondalık) */
const num2 = (v: number) => tl(v, 2).replace(/\s*₺$/u, "");

export interface NetItem {
  kind: "invoice" | "debt";
  id: number;
  date: string;
  due: string;
  balance: number;
  quiet?: "link" | "kasa";
}

/**
 * Okuma anında mahsup: hesaptaki para kalemlerden vade sırasıyla düşülür; veritabanına hiçbir şey yazılmaz. Tamamen
 * karşılanan kalem `covered`'a gider, kısmen karşılananın `net`'i azalır. Sessiz "link" kalemi (faturasız alımın
 * faturası olabilir) atlanır, iade (eksi) zaten kalem değildir. Para yoksa `net` kalanın kendisidir (yuvarlanmaz).
 */
export function netCredit<T extends NetItem>(items: readonly T[], credit: number): { items: (T & { net: number; credited: number })[]; covered: (T & { net: number; credited: number })[]; left: number } {
  let rest = Math.max(0, round2(credit));
  const out: (T & { net: number; credited: number })[] = [];
  const covered: (T & { net: number; credited: number })[] = [];
  for (const it of [...items].sort(compareOpenItems)) {
    if (it.quiet === "link" || !(it.balance > EPS) || rest <= EPS) {
      out.push({ ...it, net: it.balance, credited: 0 });
      continue;
    }
    const used = round2(Math.min(rest, it.balance));
    rest = round2(rest - used);
    const net = round2(it.balance - used);
    if (net <= EPS) covered.push({ ...it, net: 0, credited: used });
    else out.push({ ...it, net, credited: used });
  }
  return { items: out, covered, left: rest };
}

// ---------------------------------------------------------------- Ödeme olayları (Bu ay ödenen, Son ödeme)

export interface PaymentEvent {
  /** Ödeme kaydı ya da faturada işaretli ödeme */
  kind: "payment" | "invoice";
  id: number;
  date: string;
  amount: number;
  method: CariMethod | InvoicePaidVia | null;
}

/**
 * Ödeme olayları: her ödeme kaydı (tutarın tamamı; hesapta kalan kısım da ödenmiş paradır) ve faturada işaretli
 * ödemeler (örtük): ödenmiş, defterin kapatmadığı, ödeme günü yazılı her fatura için Ödenecek − takip öncesi kısım −
 * panelde sayılan. Takipsiz faturada bu bugünkü gibi Ödenecek'in tamamıdır (iade dahil); defterin kapattığı fatura 0
 * katar (para ödeme kaydında sayıldı). Takip öncesi Paraşüt'te ödenen kısmın günü bilinmez, olay sayılmaz.
 */
export function paymentEvents(invoices: readonly AccountInvoice[], payments: readonly Pick<CariPayment, "id" | "date" | "amount" | "method">[] = []): PaymentEvent[] {
  const out: PaymentEvent[] = [];
  for (const p of payments) out.push({ kind: "payment", id: p.id, date: p.date, amount: round2(p.amount), method: p.method });
  for (const i of invoices) {
    if (i.unpaid || i.paidByLedger || !i.paidAt) continue;
    if (i.ledgerBase === null || i.ledgerBase === undefined || i.payable <= 0) {
      out.push({ kind: "invoice", id: i.id, date: i.paidAt, amount: i.payable, method: i.paidVia ?? null });
      continue;
    }
    const implicit = round2(i.payable - i.ledgerBase - (i.allocated ?? 0));
    if (implicit > EPS) out.push({ kind: "invoice", id: i.id, date: i.paidAt, amount: implicit, method: i.paidVia ?? null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || (a.kind === b.kind ? b.id - a.id : a.kind === "payment" ? -1 : 1));
}

/** Bu ay ödenen: günü bu ayda olan olaylar (KDV dahil) */
export function paidInMonthOf(events: readonly PaymentEvent[], month: string): { amount: number; count: number } {
  let amount = 0;
  let count = 0;
  for (const e of events) {
    if (!e.date.startsWith(month)) continue;
    amount += e.amount;
    count++;
  }
  return { amount: Math.round(amount * 100) / 100, count };
}

/** Son ödeme günü ve o günün toplamı */
export function lastPaymentOf(events: readonly PaymentEvent[]): { date: string; amount: number; count: number } | null {
  let date: string | null = null;
  for (const e of events) if (!date || e.date > date) date = e.date;
  if (!date) return null;
  const day = events.filter((e) => e.date === date);
  return { date, amount: round2(sumBy(day, (e) => e.amount)), count: day.length };
}

// ---------------------------------------------------------------- Ödendi işareti ve dağıtım (resettle)

export interface SettleInvoice extends BalanceInvoice {
  paidAt?: string | null;
  paidVia?: InvoicePaidVia | null;
  paidByLedger?: boolean | null;
}

/** Faturaya en son dağıtım yapan ödeme (defterin kapattığı faturanın ödeme günü ve şekli) */
export interface LastAllocation {
  date: string;
  method: CariMethod;
}

export type SettlePatch =
  | { action: "close"; set: { unpaid: false; paidAt: string | null; paidVia: InvoicePaidVia | null; paymentRequestedAt: null; paidByLedger: true } }
  | { action: "reopen"; set: { unpaid: true; paidAt: null; paidVia: null; paidByLedger: false } }
  | { action: "touch"; set: { paidAt: string | null; paidVia: InvoicePaidVia | null } };

/**
 * Dağıtımdan sonra faturanın ödeme işareti: ödenmemiş ve dağıtımla tamamen karşılanan fatura defterle kapanır (gün ve
 * şekil son dağıtım yapan ödemeden); defterin kapattığı fatura artık karşılanmıyorsa yeniden açılır, karşılanıyorsa
 * günü son ödemeyi izler. Elle konmuş ödendi işaretine (`paidByLedger` false) dokunulmaz. Değişiklik yoksa null.
 */
export function settlePatch(i: SettleInvoice, last: LastAllocation | null): SettlePatch | null {
  const covered = coveredByAllocations(i);
  if (i.unpaid) {
    if (!covered) return null;
    return { action: "close", set: { unpaid: false, paidAt: last?.date ?? null, paidVia: last ? paidViaOf(last.method) : null, paymentRequestedAt: null, paidByLedger: true } };
  }
  if (!i.paidByLedger) return null;
  if (!covered) return { action: "reopen", set: { unpaid: true, paidAt: null, paidVia: null, paidByLedger: false } };
  const paidAt = last?.date ?? i.paidAt ?? null;
  const paidVia = last ? paidViaOf(last.method) : (i.paidVia ?? null);
  return paidAt !== (i.paidAt ?? null) || paidVia !== (i.paidVia ?? null) ? { action: "touch", set: { paidAt, paidVia } } : null;
}

/**
 * Kaleme sığdırma: dağıtımlar eskiden yeniye (kimlik sırası) sığdığı kadar kalır, en yenisinden kırpılır. Kırpılan
 * para ödemenin hesabına geçer (dağıtım küçülür ya da silinir).
 */
export function fitAllocations<A extends { id: number; amount: number }>(allocations: readonly A[], capacity: number): { keep: { id: number; amount: number }[]; drop: number[]; trimmed: number } {
  let room = Math.max(0, round2(capacity));
  const keep: { id: number; amount: number }[] = [];
  const drop: number[] = [];
  let trimmed = 0;
  for (const a of [...allocations].sort((x, y) => x.id - y.id)) {
    if (room <= EPS) {
      drop.push(a.id);
      trimmed += a.amount;
      continue;
    }
    const amount = round2(Math.min(a.amount, room));
    if (amount < a.amount - EPS) trimmed += a.amount - amount;
    keep.push({ id: a.id, amount });
    room = round2(room - amount);
  }
  return { keep, drop, trimmed: round2(trimmed) };
}

/** Faturanın dağıtım alabileceği yer: Ödenecek − takip öncesi kısım − zaten sayılan (iade almaz) */
export function invoiceRoom(i: Pick<BalanceInvoice, "payable" | "ledgerBase" | "allocated">): number {
  if (i.payable <= 0) return 0;
  return round2(Math.max(0, i.payable - (i.ledgerBase ?? 0) - (i.allocated ?? 0)));
}

/**
 * Elle faturanın Ödenecek alt sınırı (saveInvoice; Paraşüt'e bağlı faturada tutar zaten kilitli): takip öncesi
 * Paraşüt'te ödenen ve panelde sayılan toplamından aşağı inemez. Sınır yoksa ya da tutar sığıyorsa null.
 */
export function payableFloorProblem(i: Pick<BalanceInvoice, "ledgerBase" | "allocated">, payable: number): string | null {
  const counted = round2((i.ledgerBase ?? 0) + (i.allocated ?? 0));
  if (!(counted > EPS) || payable >= counted - EPS) return null;
  return `Bu faturaya ${tl(counted, 2)} ödeme sayılmış; tutar bundan az olamaz`;
}

// ---------------------------------------------------------------- Hesap özeti

export interface SupplierSummary {
  count: number;
  /** Bütün faturaların KDV dahil toplamı (iade eksi) */
  invoiced: number;
  /** Bugünün yılındaki alımlar, KDV dahil: faturalar ve bağsız faturasız alımlar (eski borç hariç) */
  year: number;
  /** Açık kalem: ödenmemiş fatura (iade dahil) ve kalanı olan bağsız borç */
  openCount: number;
  /** Açık (brüt; hesaptaki para düşülmeden), KDV dahil */
  open: number;
  requestedCount: number;
  requested: number;
  /** Vadesi geçen: hesaptaki para düşüldükten sonra */
  overdueCount: number;
  overdue: number;
  /** Vadesi bugün ya da 7 gün içinde olanlar (gecikmişler hariç), mahsuptan sonra */
  soonCount: number;
  soon: number;
  /** Açık kalemlerin en erken vadesi (gecikmiş olabilir) */
  nextDue: Due | null;
  /** "7 gün içinde"kilerin en erken vadesi (gecikmişler hariç) */
  nextSoonDue: string | null;
  lastInvoice: string | null;
  /** Son ödeme günü (ödeme kayıtları ve faturalardaki ödendi işaretleri) */
  lastPaid: string | null;
}

export interface CariAccount extends SupplierSummary {
  /** Faturaların kalanı (ödenmemiş iade eksi) */
  invoiceOpen: number;
  /** Bağsız borçların kalanı ve sayısı */
  debtOpen: number;
  debtOpenCount: number;
  /** Faturası beklenen ("Faturası gelecek") bağsız borçların kalanı */
  expectedDebt: number;
  /** Bu yılın faturasız alımları (yıl kartının "faturasız X dahil"i) */
  yearDebts: number;
  /** Hesapta duran (sayılmamış) ödeme */
  credit: number;
  /** Bakiye = açık − hesaptaki para; eksiyse alacak (fazla ödeme) */
  balance: number;
  /** Son ödeme gününün toplamı */
  lastPaidAmount: number;
  /** Mahsuptan sonra açık kalemler (`net` > 0) ve hesaptaki parayla tamamen karşılananlar */
  items: (OpenItem & { net: number; credited: number })[];
  covered: (OpenItem & { net: number; credited: number })[];
  events: PaymentEvent[];
}

export interface AccountInput<I extends AccountInvoice> {
  invoices: readonly I[];
  debts?: readonly CariDebt[];
  payments?: readonly CariPayment[];
  allocations?: readonly CariAllocation[];
}

/**
 * Tedarikçi kartında "Alacak (fazla ödeme)": hesapta sayılmamış para var ve bakiye eksi (Tedarikçiler listesiyle aynı
 * kural). Ödemesi olmayan ödenmemiş iade faturasının eksi bakiyesi alacak değildir: "Kalan borç −500 ₺" kalır.
 */
export const showsCredit = (a: Pick<CariAccount, "balance" | "credit">) => a.credit > EPS && a.balance < -EPS;

/**
 * Tedarikçinin hesap özeti. Faturalar bugünkü kuralla (summarize bunu çağırır); kayıt varsa borçlar açığa eklenir,
 * hesaptaki para vade sırasıyla düşülür (Vadesi geçen ve 7 gün mahsuptan sonra). `quietInvoiceIds`: faturasız
 * alımın faturası olabilecek faturalar (mahsup atlar, bakiyede kalır).
 */
export function accountOf<I extends AccountInvoice>(input: AccountInput<I>, opts: { today: string; termDays: number; quietInvoiceIds?: ReadonlySet<number> }): CariAccount {
  const debts = input.debts ?? [];
  const payments = input.payments ?? [];
  const allocations = input.allocations ?? [];
  const year = opts.today.slice(0, 4);
  let count = 0;
  let invoiced = 0;
  let yearSum = 0;
  let openCount = 0;
  let invoiceOpen = 0;
  let requestedCount = 0;
  let requested = 0;
  let lastInvoice: string | null = null;
  const items: OpenItem[] = [];
  for (const i of input.invoices) {
    count++;
    invoiced += i.payable;
    if (i.date.startsWith(year)) yearSum += i.payable;
    if (!lastInvoice || i.date > lastInvoice) lastInvoice = i.date;
    if (!i.unpaid) continue;
    const balance = openBalance(i);
    openCount++;
    invoiceOpen += balance;
    if (i.paymentRequestedAt) {
      requestedCount++;
      requested += balance;
    }
    // Vade yalnız borçta: ödenmemiş duran iade (eksi) faturası vadeye ve gecikmeye girmez
    if (balance <= 0) continue;
    const due = dueOf(i, opts.termDays);
    items.push({ kind: "invoice", id: i.id, date: i.date, due: due.date, dueEstimated: due.estimated, balance, label: invoiceLabel(i), ...(opts.quietInvoiceIds?.has(i.id) ? { quiet: "link" as const } : {}) });
  }
  let debtOpen = 0;
  let debtOpenCount = 0;
  let expectedDebt = 0;
  let yearDebts = 0;
  for (const d of debts) {
    if (d.invoiceId !== null) continue;
    if (d.costMode !== "devir" && d.date.startsWith(year)) yearDebts += d.amount;
    const balance = debtRemaining(d, allocations);
    if (!(balance > EPS)) continue;
    debtOpenCount++;
    debtOpen += balance;
    if (d.costMode === "fatura") expectedDebt += balance;
    const due = dueOf(d, opts.termDays);
    items.push({ kind: "debt", id: d.id, date: d.date, due: due.date, dueEstimated: due.estimated, balance, label: debtLabel(d) });
  }
  const credit = round2(sumBy(payments, (p) => paymentCredit(p, allocations)));
  const net = netCredit(items, credit);
  let overdueCount = 0;
  let overdue = 0;
  let soonCount = 0;
  let soon = 0;
  let nextDue: Due | null = null;
  let nextSoonDue: string | null = null;
  // Kalemlerin kendi sırasıyla (faturalar listedeki sırayla, sonra borçlar): mahsup sırayı değiştirmez, para yokken
  // toplamlar bugünkü toplama sırasıyla birebir aynı çıkar
  const netOf = new Map(net.items.map((x) => [`${x.kind}:${x.id}`, x.net]));
  for (const it of items) {
    const value = netOf.get(`${it.kind}:${it.id}`);
    if (value === undefined || !(value > 0)) continue;
    const left = daysBetween(opts.today, it.due);
    if (left < 0) {
      overdueCount++;
      overdue += value;
    } else if (left <= SOON_DAYS) {
      soonCount++;
      soon += value;
      if (!nextSoonDue || it.due < nextSoonDue) nextSoonDue = it.due;
    }
    if (!nextDue || it.due < nextDue.date) nextDue = { date: it.due, estimated: it.dueEstimated };
  }
  const events = paymentEvents(input.invoices, payments);
  const last = lastPaymentOf(events);
  const open = round2(invoiceOpen + debtOpen);
  return {
    count,
    invoiced: round2(invoiced),
    year: round2(yearSum + yearDebts),
    openCount: openCount + debtOpenCount,
    open,
    requestedCount,
    requested: round2(requested),
    overdueCount,
    overdue: round2(overdue),
    soonCount,
    soon: round2(soon),
    nextDue,
    nextSoonDue,
    lastInvoice,
    lastPaid: last?.date ?? null,
    invoiceOpen: round2(invoiceOpen),
    debtOpen: round2(debtOpen),
    debtOpenCount,
    expectedDebt: round2(expectedDebt),
    yearDebts: round2(yearDebts),
    credit,
    balance: round2(open - credit),
    lastPaidAmount: last?.amount ?? 0,
    items: net.items,
    covered: net.covered,
    events,
  };
}
