/**
 * Tedarikçiler ekranının saf kuralları (cari hesaplar): faturaların tedarikçi tedarikçi toplanması, kalan borç ve
 * vade, ödeme durumu, cari kartı alanlarının denetimi (IBAN, VKN / TCKN, telefon) ve ödeme talebi metni. Sayfalar,
 * sunucu eylemleri, Ödemeler'in tahmini vadesi ve Paraşüt eşitlemesi (peşin çalışılan tedarikçi) bunu kullanır;
 * tests/tedarikciler.test.ts ile sınanır.
 *
 * Faturalar karta yabancı anahtarla bağlanmaz: faturadaki tedarikçi adının anahtarı (supplierMatchKey: büyük/küçük
 * harf, I/ı, boşluk ve parantezli not sayılmaz) kartın adının ya da diğer adlarından birinin anahtarıyla aynıysa
 * fatura o karttadır. Kartı olmayan ad kendi başına bir tedarikçidir; kart, bilgi girilince açılır.
 */
import { openBalance } from "@/lib/calc/insights";
import { dateTR, money } from "@/lib/format";
import { addDays, daysBetween } from "@/lib/reminders";

import { splitSupplier, supplierMatchKey } from "../faturalar/rules";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- Ödeme şekli

export type PaymentMethod = "havale" | "nakit" | "kart" | "cek" | "diger";

/** Veritabanındaki sırayla (schema.ts invoices.paidVia, suppliers.paymentMethod) */
export const PAYMENT_METHOD_VALUES = ["havale", "nakit", "kart", "cek", "diger"] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "havale", label: "Havale / EFT" },
  { value: "nakit", label: "Nakit" },
  { value: "kart", label: "Kredi kartı" },
  { value: "cek", label: "Çek / senet" },
  { value: "diger", label: "Diğer" },
];

export function methodLabel(m: string | null | undefined): string | null {
  return PAYMENT_METHODS.find((x) => x.value === m)?.label ?? null;
}

// ---------------------------------------------------------------- Cari kartı ve eşleşme

export interface SupplierCard {
  id: number;
  /** Faturalardaki (kısa) ad */
  name: string;
  /** Faturalarda geçen başka adlar */
  aliases: string[];
  legalName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  iban: string | null;
  bankName: string | null;
  accountHolder: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  paymentTermDays: number | null;
  paymentMethod: PaymentMethod | null;
  paidOnDelivery: boolean;
  note: string | null;
}

type CardNames = Pick<SupplierCard, "id" | "name" | "aliases">;

/**
 * Ad anahtarı → kart. Kartın kendi adı diğer adlardan önce gelir: bir ad hem bir kartın adı hem başka bir kartın
 * diğer adıysa faturaları adın sahibi olan karttadır.
 */
export function cardIndex<C extends CardNames>(cards: readonly C[]): Map<string, C> {
  const byKey = new Map<string, C>();
  for (const c of cards) {
    const k = supplierMatchKey(c.name);
    if (k && !byKey.has(k)) byKey.set(k, c);
  }
  for (const c of cards) {
    for (const a of c.aliases) {
      const k = supplierMatchKey(a);
      if (k && !byKey.has(k)) byKey.set(k, c);
    }
  }
  return byKey;
}

/** Faturadaki tedarikçi adının kartı (yoksa null) */
export function cardFor<C>(index: ReadonlyMap<string, C>, supplier: string): C | null {
  return index.get(supplierMatchKey(supplier)) ?? null;
}

/**
 * Kart kaydedilirken adların çakışması: kartın adı ve diğer adları başka bir kartın adı ya da diğer adı olamaz (bir
 * faturanın iki kartı olmasın). Çakışan ilk ad ve sahibi döner; yoksa null.
 */
export function nameConflict(
  card: { id: number | null; name: string; aliases: readonly string[] },
  others: readonly CardNames[],
): { name: string; owner: string } | null {
  const taken = new Map<string, string>();
  for (const o of others) {
    if (o.id === card.id) continue;
    for (const n of [o.name, ...o.aliases]) {
      const k = supplierMatchKey(n);
      if (k && !taken.has(k)) taken.set(k, o.name);
    }
  }
  for (const n of [card.name, ...card.aliases]) {
    const owner = taken.get(supplierMatchKey(n));
    if (owner) return { name: n, owner };
  }
  return null;
}

/**
 * Kaydedilecek diğer adlar: boşluklar sadeleşir, kartın kendi adıyla ve birbiriyle aynı anahtarı taşıyanlar düşer.
 * Ad değiştiyse eski ad (faturaları hâlâ o adla durur) diğer adlara eklenir: faturalar kartta kalır.
 */
/**
 * Paraşüt'ün tedarikçi adını okuyamadığı faturalara yazılan geçici ad (sync.ts, einvoice.ts). Bir kartın adı ya da
 * diğer adı olamaz: olsa adı okunamayan her fatura o karta düşerdi.
 */
export const PLACEHOLDER_SUPPLIER_NAME = "Paraşüt tedarikçisi";

export function cleanAliases(name: string, aliases: readonly string[], previousName?: string | null): string[] {
  const own = supplierMatchKey(name);
  const seen = new Set<string>([own, supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME)]);
  const out: string[] = [];
  const list = previousName && supplierMatchKey(previousName) !== own ? [previousName, ...aliases] : aliases;
  for (const raw of list) {
    const a = raw.replace(/\s+/g, " ").trim();
    const k = supplierMatchKey(a);
    if (!a || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------- Vade ve ödeme durumu

/** "Yakında" sayılan gün: vadesi bugünden en çok bu kadar sonra (gecikmişler hariç) */
export const SOON_DAYS = 7;

/** Kalan borcu ve ödeme durumunu hesaplamak için gereken fatura alanları */
export interface LedgerInvoice {
  date: string;
  supplier: string;
  /** KDV dahil (iade eksi) */
  payable: number;
  unpaid: boolean;
  /** Paraşüt'ün bildirdiği kalan (kısmen ödenmişte) */
  outstanding?: number | null;
  dueDate?: string | null;
  paidAt?: string | null;
  paymentRequestedAt?: string | null;
}

export interface Due {
  date: string;
  /** Faturada vade yok: fatura tarihi + vade günü */
  estimated: boolean;
}

/** Faturanın vadesi; yazılmamışsa fatura tarihi + vade günü (kartta yoksa Ödemeler'deki genel ayar) tahminidir */
export function dueOf(i: Pick<LedgerInvoice, "date" | "dueDate">, termDays: number): Due {
  return i.dueDate ? { date: i.dueDate, estimated: false } : { date: addDays(i.date, termDays), estimated: true };
}

/** Ödenmedi → (isteğe bağlı) ödemesi istendi → ödendi. Durumu kullanıcı koyar. */
export type PayState = "unpaid" | "requested" | "paid";

export function payState(i: Pick<LedgerInvoice, "unpaid" | "paymentRequestedAt">): PayState {
  if (!i.unpaid) return "paid";
  return i.paymentRequestedAt ? "requested" : "unpaid";
}

/** Paraşüt'te ödenmiş görünen ama panelde ödenmedi duran fatura (ipucu: "Paraşüt'te ödendi") */
export function paidInParasut(i: { unpaid: boolean; parasutUnpaid?: boolean | null }): boolean {
  return i.unpaid && i.parasutUnpaid === false;
}

/** Vadeye kalan: "5 gün kaldı", "yarın", "bugün", "3 gün gecikti" (listede, tedarikçi sayfasında ve dökümlerde) */
export function dueWhen(date: string, today: string): string {
  const left = daysBetween(today, date);
  return left < 0 ? `${-left} gün gecikti` : left === 0 ? "bugün" : left === 1 ? "yarın" : `${left} gün kaldı`;
}

/** Vadenin rengi: gecikmiş kırmızı, SOON_DAYS içinde turuncu */
export function dueTone(date: string, today: string): "bad" | "warn" | "ok" {
  const left = daysBetween(today, date);
  return left < 0 ? "bad" : left <= SOON_DAYS ? "warn" : "ok";
}

// ---------------------------------------------------------------- Hesap özeti

export interface SupplierSummary {
  count: number;
  /** Bütün faturaların KDV dahil toplamı (iade eksi) */
  invoiced: number;
  /** Bugünün yılındaki faturalar, KDV dahil */
  year: number;
  openCount: number;
  /** Kalan borç, KDV dahil (kısmen ödenmişte kalan tutar) */
  open: number;
  requestedCount: number;
  requested: number;
  overdueCount: number;
  overdue: number;
  /** Vadesi bugün ya da 7 gün içinde olanlar (gecikmişler hariç) */
  soonCount: number;
  soon: number;
  /** Ödenmemişlerin en erken vadesi (gecikmiş olabilir) */
  nextDue: Due | null;
  /** "7 gün içinde"kilerin en erken vadesi (gecikmişler hariç) */
  nextSoonDue: string | null;
  lastInvoice: string | null;
  lastPaid: string | null;
}

export function summarize(invoices: readonly LedgerInvoice[], opts: { today: string; termDays: number }): SupplierSummary {
  const year = opts.today.slice(0, 4);
  const s: SupplierSummary = {
    count: 0,
    invoiced: 0,
    year: 0,
    openCount: 0,
    open: 0,
    requestedCount: 0,
    requested: 0,
    overdueCount: 0,
    overdue: 0,
    soonCount: 0,
    soon: 0,
    nextDue: null,
    nextSoonDue: null,
    lastInvoice: null,
    lastPaid: null,
  };
  for (const i of invoices) {
    s.count++;
    s.invoiced += i.payable;
    if (i.date.startsWith(year)) s.year += i.payable;
    if (!s.lastInvoice || i.date > s.lastInvoice) s.lastInvoice = i.date;
    if (!i.unpaid) {
      if (i.paidAt && (!s.lastPaid || i.paidAt > s.lastPaid)) s.lastPaid = i.paidAt;
      continue;
    }
    const balance = openBalance(i);
    s.openCount++;
    s.open += balance;
    if (i.paymentRequestedAt) {
      s.requestedCount++;
      s.requested += balance;
    }
    // Vade yalnız borçta: ödenmemiş duran iade (eksi) faturası vadeye ve gecikmeye girmez
    if (balance <= 0) continue;
    const due = dueOf(i, opts.termDays);
    const left = daysBetween(opts.today, due.date);
    if (left < 0) {
      s.overdueCount++;
      s.overdue += balance;
    } else if (left <= SOON_DAYS) {
      s.soonCount++;
      s.soon += balance;
      if (!s.nextSoonDue || due.date < s.nextSoonDue) s.nextSoonDue = due.date;
    }
    if (!s.nextDue || due.date < s.nextDue.date) s.nextDue = due;
  }
  for (const k of ["invoiced", "year", "open", "requested", "overdue", "soon"] as const) s[k] = round2(s[k]);
  return s;
}

// ---------------------------------------------------------------- Tedarikçiler (gruplar)

export interface SupplierGroup<I extends LedgerInvoice = LedgerInvoice, C extends CardNames = SupplierCard> {
  /** Kartın adının ya da (kartsızda) faturalardaki adın anahtarı */
  key: string;
  /** Adresteki parça: /panel/tedarikciler/<slug> */
  slug: string;
  name: string;
  card: C | null;
  /** Faturalarda geçen adlar (parantezli not hariç), en yeni faturanınki önce */
  names: string[];
  /** En yeni önce */
  invoices: I[];
  /** Tahmini vadenin günü: kartta yazılıysa o, değilse genel ayar */
  termDays: number;
  summary: SupplierSummary;
}

/**
 * Faturaları tedarikçi tedarikçi toplar: kartı olan adlar kartta (diğer adlarıyla birlikte), kartsız adlar kendi
 * başına. Faturası olmayan kartlar da listede (yeni eklenmiş tedarikçi). Sıra ada göre; ekran kendisi sıralar.
 */
export function groupSuppliers<I extends LedgerInvoice, C extends CardNames & { paymentTermDays?: number | null }>(
  invoices: readonly I[],
  cards: readonly C[],
  opts: { today: string; termDays: number },
): SupplierGroup<I, C>[] {
  const index = cardIndex(cards);
  const byId = new Map<string, { key: string; card: C | null; invoices: I[] }>();
  for (const c of cards) byId.set(`kart:${c.id}`, { key: supplierMatchKey(c.name), card: c, invoices: [] });
  for (const inv of invoices) {
    const k = supplierMatchKey(inv.supplier);
    const card = index.get(k) ?? null;
    const id = card ? `kart:${card.id}` : `ad:${k}`;
    let g = byId.get(id);
    if (!g) {
      g = { key: k, card: null, invoices: [] };
      byId.set(id, g);
    }
    g.invoices.push(inv);
  }
  const slugs = assignSlugs([...byId.values()].map((g) => g.key));
  const out: SupplierGroup<I, C>[] = [];
  for (const g of byId.values()) {
    const list = [...g.invoices].sort((a, b) => b.date.localeCompare(a.date));
    // Her anahtardan bir ad (en yeni faturadaki yazılışı): "KALDI" ile "Kaldi" aynı addır
    const names: string[] = [];
    const seen = new Set<string>();
    for (const inv of list) {
      const k = supplierMatchKey(inv.supplier);
      if (!seen.has(k)) {
        seen.add(k);
        names.push(splitSupplier(inv.supplier).base.trim());
      }
    }
    const termDays = g.card?.paymentTermDays ?? opts.termDays;
    out.push({
      key: g.key,
      slug: slugs.get(g.key) ?? supplierSlug(g.key),
      name: g.card?.name ?? names[0] ?? g.key,
      card: g.card,
      names,
      invoices: list,
      termDays,
      summary: summarize(list, { today: opts.today, termDays }),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Adres parçası: Türkçe harfler ASCII'ye iner, harf ve rakam dışı tireye döner ("Sütaş" → "sutas") */
export function supplierSlug(key: string): string {
  const s = key
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "tedarikci";
}

/**
 * Her anahtara benzersiz bir adres parçası. Aynı parçaya düşen anahtarlar ("sütaş", "sutas") sırayla -2, -3 alır;
 * sıra anahtara göre olduğu için liste ve tedarikçi sayfası aynı parçayı bulur.
 */
export function assignSlugs(keys: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const k of [...new Set(keys)].sort()) {
    const base = supplierSlug(k);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    out.set(k, slug);
  }
  return out;
}

export const supplierHref = (slug: string) => `/panel/tedarikciler/${slug}`;

/**
 * Kartın diğer adı olabilecek kartsız adlar (aynı firmanın faturalarda farklı yazılmış adı). `same` iki adın aynı
 * firmayı gösterip göstermediğine karar verir (sunucuda Paraşüt eşleştirmesindeki sameSupplier).
 */
export function aliasCandidates(
  target: { key: string; name: string; names: readonly string[] },
  groups: readonly { key: string; name: string; card: unknown }[],
  same: (a: string, b: string) => boolean,
): string[] {
  const mine = [target.name, ...target.names];
  return groups.filter((g) => g.key !== target.key && !g.card && mine.some((n) => same(n, g.name))).map((g) => g.name);
}

// ---------------------------------------------------------------- Liste süzgeci ve sırası

/** Listede gösterilen tedarikçi satırı (sunucudan istemciye geçen düz veri) */
export interface SupplierListRow {
  key: string;
  slug: string;
  name: string;
  names: string[];
  hasCard: boolean;
  legalName: string | null;
  taxNumber: string | null;
  iban: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  paidOnDelivery: boolean;
  missing: MissingInfo[];
  /** Paraşüt'te ödenmiş görünen ama panelde ödenmedi duran fatura sayısı */
  parasutPaid: number;
  summary: SupplierSummary;
}

/** Adresteki ?durum= değerleri */
export type SupplierFilter = "tumu" | "borclu" | "geciken" | "eksik";
export const SUPPLIER_FILTERS: readonly SupplierFilter[] = ["tumu", "borclu", "geciken", "eksik"];
/** Adresteki ?sirala= değerleri */
export type SupplierSort = "borc" | "vade" | "son" | "ad";
export const SUPPLIER_SORTS: readonly { value: SupplierSort; label: string }[] = [
  { value: "borc", label: "Kalan borç: yüksekten düşüğe" },
  { value: "vade", label: "Vade: en yakın önce" },
  { value: "son", label: "Son fatura: yeniden eskiye" },
  { value: "ad", label: "Ad: A → Z" },
];

export function parseSupplierFilter(raw: string | null | undefined): SupplierFilter {
  return SUPPLIER_FILTERS.includes(raw as SupplierFilter) ? (raw as SupplierFilter) : "tumu";
}

export function parseSupplierSort(raw: string | null | undefined): SupplierSort {
  return SUPPLIER_SORTS.some((s) => s.value === raw) ? (raw as SupplierSort) : "borc";
}

/**
 * Liste süzgeci. "Bilgisi eksik": kartı olup eksiği olan ya da borcu olup bilgisi eksik tedarikçi; kartı açılmamış ve
 * borcu olmayan (tek seferlik alım, pazar yeri) sayılmaz.
 */
export function matchesSupplierFilter(r: Pick<SupplierListRow, "summary" | "missing" | "hasCard">, f: SupplierFilter): boolean {
  if (f === "borclu") return r.summary.openCount > 0;
  if (f === "geciken") return r.summary.overdueCount > 0;
  if (f === "eksik") return r.missing.length > 0 && (r.hasCard || r.summary.openCount > 0);
  return true;
}

/** Sıralama; eşitlikte ad (Türkçe) */
export function compareSuppliers(sort: SupplierSort) {
  const byName = (a: Pick<SupplierListRow, "name">, b: Pick<SupplierListRow, "name">) => a.name.localeCompare(b.name, "tr");
  return (a: Pick<SupplierListRow, "name" | "summary">, b: Pick<SupplierListRow, "name" | "summary">): number => {
    if (sort === "borc") return b.summary.open - a.summary.open || b.summary.overdue - a.summary.overdue || byName(a, b);
    if (sort === "vade") {
      const x = a.summary.nextDue?.date ?? "9999";
      const y = b.summary.nextDue?.date ?? "9999";
      return x.localeCompare(y) || byName(a, b);
    }
    if (sort === "son") return (b.summary.lastInvoice ?? "").localeCompare(a.summary.lastInvoice ?? "") || byName(a, b);
    return byName(a, b);
  };
}

/** Aramada taranan metin: adlar, unvan, vergi no, IBAN (boşluklu ve boşluksuz), telefon, yetkili, e-posta */
export function supplierHaystack(r: Pick<SupplierListRow, "name" | "names" | "legalName" | "taxNumber" | "iban" | "phone" | "contactName" | "email">): string {
  return [r.name, ...r.names, r.legalName, r.taxNumber, r.iban, r.iban ? formatIban(r.iban) : null, r.phone, r.contactName, r.email].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Kart bilgilerinin denetimi

export type MissingInfo = "iban" | "vergi" | "iletisim";

export const MISSING_LABEL: Record<MissingInfo, string> = { iban: "IBAN yok", vergi: "Vergi no yok", iletisim: "Telefon / e-posta yok" };

/**
 * Kartta eksik olan önemli bilgiler: ödeme için IBAN (peşin çalışılan tedarikçide aranmaz), cari için vergi no,
 * ulaşmak için telefon ya da e-posta. Kart hiç yoksa hepsi eksiktir.
 */
export function missingInfo(card: Pick<SupplierCard, "iban" | "taxNumber" | "phone" | "email" | "paidOnDelivery"> | null): MissingInfo[] {
  const out: MissingInfo[] = [];
  if (!card?.iban && !card?.paidOnDelivery) out.push("iban");
  if (!card?.taxNumber) out.push("vergi");
  if (!card?.phone && !card?.email) out.push("iletisim");
  return out;
}

/** IBAN'ın saklanan biçimi: boşluk, tire ve nokta atılır, büyük harf */
export function normalizeIban(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\s\-.]/g, "").toLocaleUpperCase("en-US");
}

/** Dörderli gösterim: "TR12 0006 4000 0011 2345 6789 01" */
export function formatIban(raw: string | null | undefined): string {
  return normalizeIban(raw)
    .replace(/(.{4})/g, "$1 ")
    .trim();
}

/** ISO 13616 kontrol hanesi (mod 97 = 1) */
function ibanMod97(iban: string): number {
  let r = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const v = ch >= "A" && ch <= "Z" ? ch.charCodeAt(0) - 55 : Number(ch);
    r = (v >= 10 ? r * 100 + v : r * 10 + v) % 97;
  }
  return r;
}

/** IBAN geçerliyse null, değilse nedeni (boş alan geçerlidir: IBAN isteğe bağlı) */
export function ibanProblem(raw: string | null | undefined): string | null {
  const v = normalizeIban(raw);
  if (!v) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return "IBAN iki harf ve rakamlardan oluşur (ör. TR12 0006 4000 …)";
  if (v.startsWith("TR") && !/^TR\d{24}$/.test(v)) return `TR IBAN'ı 26 karakterdir (TR + 24 rakam); ${v.length} karakter yazıldı`;
  if (ibanMod97(v) !== 1) return "IBAN'ın kontrol hanesi tutmuyor: bir rakam eksik ya da yanlış yazılmış olabilir";
  return null;
}

/** TR IBAN'ındaki banka kodu (5–9. haneler) → banka; yalnız sık kullanılanlar, bilinmeyen kodda null */
const TR_BANKS: Record<string, string> = {
  "00010": "Ziraat Bankası",
  "00012": "Halkbank",
  "00015": "VakıfBank",
  "00032": "TEB",
  "00046": "Akbank",
  "00059": "Şekerbank",
  "00062": "Garanti BBVA",
  "00064": "İş Bankası",
  "00067": "Yapı Kredi",
  "00099": "ING",
  "00103": "Fibabanka",
  "00111": "QNB",
  "00123": "HSBC",
  "00124": "Alternatif Bank",
  "00125": "Burgan Bank",
  "00134": "DenizBank",
  "00135": "Anadolubank",
  "00146": "Odeabank",
  "00203": "Albaraka Türk",
  "00205": "Kuveyt Türk",
  "00206": "Türkiye Finans",
  "00209": "Ziraat Katılım",
  "00210": "Vakıf Katılım",
  "00211": "Emlak Katılım",
};

export function bankFromIban(raw: string | null | undefined): string | null {
  const v = normalizeIban(raw);
  if (!/^TR\d{24}$/.test(v)) return null;
  return TR_BANKS[v.slice(4, 9)] ?? null;
}

/** Vergi numarasının rakamları (boşluk, nokta atılır) */
export function normalizeTaxNumber(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Vergi kimlik numarası (10 hane) kontrol hanesi (Gelir İdaresi algoritması) */
export function isValidVkn(v: string): boolean {
  if (!/^\d{10}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (Number(v[i]) + 9 - i) % 10;
    const p = (t * 2 ** (9 - i)) % 9;
    sum += t !== 0 && p === 0 ? 9 : p;
  }
  return (10 - (sum % 10)) % 10 === Number(v[9]);
}

/** T.C. kimlik numarası (11 hane; şahıs şirketleri bunu kullanır) kontrol haneleri */
export function isValidTckn(v: string): boolean {
  if (!/^[1-9]\d{10}$/.test(v)) return false;
  const d = [...v].map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
}

/**
 * Vergi no denetimi: 10 (VKN) ya da 11 (TCKN) hane değilse hata (kaydedilmez); hane sayısı doğru ama kontrol hanesi
 * tutmuyorsa uyarı (kaydedilir; yazım hatası olabilir). Boş alan geçerlidir.
 */
export function taxNumberCheck(raw: string | null | undefined): { error: string } | { warning: string } | null {
  const v = normalizeTaxNumber(raw);
  if (!v) return null;
  if (v.length !== 10 && v.length !== 11) return { error: `Vergi no 10 haneli (VKN) ya da 11 haneli (TCKN) olur; ${v.length} hane yazıldı` };
  const ok = v.length === 10 ? isValidVkn(v) : isValidTckn(v);
  return ok ? null : { warning: `${v.length === 10 ? "VKN" : "TCKN"} doğrulanamadı (kontrol hanesi tutmuyor); faturadakiyle karşılaştırın` };
}

// ---------------------------------------------------------------- Faturadan gelen bilgiler

/** E-faturadan (UBL) ya da Paraşüt'teki kişi kartından okunan cari bilgileri; bilinmeyen alan null */
export interface SupplierInfo {
  legalName: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  iban: string | null;
  bankName: string | null;
}

export const INFO_FIELDS = ["legalName", "taxNumber", "taxOffice", "iban", "bankName", "phone", "email", "address"] as const satisfies readonly (keyof SupplierInfo)[];

export const INFO_LABEL: Record<keyof SupplierInfo, string> = {
  legalName: "unvan",
  taxNumber: "vergi no",
  taxOffice: "vergi dairesi",
  address: "adres",
  phone: "telefon",
  email: "e-posta",
  iban: "IBAN",
  bankName: "banka",
};

/**
 * Alan alan ilk dolu değer (kaynaklar öncelik sırasıyla verilir). Geçersiz IBAN ve vergi no alınmaz; boşluklar
 * sadeleşir. IBAN bulunup banka adı yoksa banka IBAN'daki koddan yazılır.
 */
export function mergeInfo(...parts: (Partial<SupplierInfo> | null | undefined)[]): SupplierInfo {
  const out: SupplierInfo = { legalName: null, taxNumber: null, taxOffice: null, address: null, phone: null, email: null, iban: null, bankName: null };
  for (const p of parts) {
    if (!p) continue;
    for (const k of INFO_FIELDS) {
      if (out[k]) continue;
      let v = p[k]?.replace(/\s+/g, " ").trim() || null;
      if (v && k === "iban") v = ibanProblem(v) ? null : normalizeIban(v);
      if (v && k === "taxNumber") {
        const t = normalizeTaxNumber(v);
        v = t.length === 10 || t.length === 11 ? t : null;
      }
      if (v && k === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) v = null;
      out[k] = v;
    }
  }
  if (out.iban && !out.bankName) out.bankName = bankFromIban(out.iban);
  return out;
}

/**
 * Formun boş alanlarına girecek bilgiler; dolu alana (kullanıcının yazdığına) dokunulmaz. IBAN ekranda dörderli
 * yazılır. Doldurulan alanlar formdaki sırayla döner.
 */
export function fillFromInfo(form: Record<keyof SupplierInfo, string>, info: SupplierInfo): { patch: Partial<Record<keyof SupplierInfo, string>>; filled: (keyof SupplierInfo)[] } {
  const patch: Partial<Record<keyof SupplierInfo, string>> = {};
  const filled: (keyof SupplierInfo)[] = [];
  for (const k of INFO_FIELDS) {
    const v = info[k];
    if (!v || form[k].trim()) continue;
    patch[k] = k === "iban" ? formatIban(v) : v;
    filled.push(k);
  }
  return { patch, filled };
}

/** Metindeki geçerli TR IBAN'ları (fatura notunda "IBAN: TR29 0006 …" gibi; boşluklu ya da bitişik) */
export function ibansInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bTR(?:\s?\d){24}\b/gi)) {
    const v = normalizeIban(m[0]);
    if (!ibanProblem(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- Telefon, WhatsApp, e-posta

/** Uluslararası biçim (+905321234567); Türkiye numarası 0'la, 90'la ya da doğrudan yazılabilir */
export function phoneE164(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+")) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.startsWith("00") && digits.length >= 10) return `+${digits.slice(2)}`;
  if (digits.length === 12 && digits.startsWith("90")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+90${digits.slice(1)}`;
  if (digits.length === 10 && /^[2-5]/.test(digits)) return `+90${digits}`;
  return null;
}

export function telHref(raw: string | null | undefined): string | null {
  const p = phoneE164(raw);
  return p ? `tel:${p}` : null;
}

/** WhatsApp bağlantısı: Türkiye'de yalnız cep (5xx) numarası; yurt dışı numara + ile yazılmışsa */
export function whatsappHref(raw: string | null | undefined, text?: string): string | null {
  const p = phoneE164(raw);
  if (!p || (p.startsWith("+90") && p[3] !== "5")) return null;
  return `https://wa.me/${p.slice(1)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Numara yazılmadan paylaşım (kişiyi WhatsApp'ta seçer) */
export const whatsappShareHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** "0532 123 45 67"; Türkiye numarası değilse yazıldığı gibi */
export function formatPhone(raw: string | null | undefined): string {
  const p = phoneE164(raw);
  if (!p?.startsWith("+90") || p.length !== 13) return (raw ?? "").trim();
  const d = p.slice(3);
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}`;
}

export function mailtoHref(email: string | null | undefined, subject?: string, body?: string): string | null {
  const e = (email ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  const q = new URLSearchParams();
  if (subject) q.set("subject", subject);
  if (body) q.set("body", body);
  // mailto'da boşluk "+" değil %20 olmalı (bazı e-posta uygulamaları + işaretini olduğu gibi yazar)
  const qs = q.toString().replace(/\+/g, "%20");
  return `mailto:${e}${qs ? `?${qs}` : ""}`;
}

/** Alıcısı boş e-posta taslağı (ödeme talebini kime göndereceğini kullanıcı seçer) */
export function emailDraftHref(subject: string, body: string): string {
  const q = new URLSearchParams({ subject, body }).toString().replace(/\+/g, "%20");
  return `mailto:?${q}`;
}

// ---------------------------------------------------------------- Ödeme talebi

/** Banka uygulamasına yapıştırılacak tutar: binlik ayraçsız, virgüllü ("8450,50") */
export function amountForBank(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
}

export interface RequestLine {
  date: string;
  invoiceNo: string | null;
  /** Ödenecek (kalan) tutar, KDV dahil */
  amount: number;
  dueDate: string | null;
}

/**
 * Havale / EFT açıklaması: fatura numaraları (en çok üçü), numarasız faturada tarihi; daha çoğunda sayı ve tarih
 * aralığı. Bankaların açıklama alanına sığacak kadar kısa.
 */
export function transferNote(lines: readonly RequestLine[]): string {
  if (!lines.length) return "";
  if (lines.length <= 3) {
    const parts = lines.map((l) => l.invoiceNo?.trim() || `${dateTR(l.date)} tarihli`);
    const noun = lines.length === 1 ? "fatura" : "faturalar";
    // "SUT…123 nolu fatura"; numarasız fatura varsa "SUT…123, 14.10.2026 tarihli faturalar"
    return lines.every((l) => l.invoiceNo?.trim()) ? `${parts.join(", ")} nolu ${noun}` : `${parts.join(", ")} ${noun}`;
  }
  const dates = lines.map((l) => l.date).sort();
  const first = dateTR(dates[0]);
  const last = dateTR(dates[dates.length - 1]);
  return `${lines.length} fatura (${first === last ? first : `${first} – ${last}`})`;
}

/**
 * Ödeme talebi metni (kopyala, WhatsApp, e-posta): alıcı (unvan), IBAN, banka, tutar, açıklama ve faturalar. Ödemeyi
 * yapacak kişiye (muhasebe, ortak) gönderilir ya da bankanın havale ekranına kopyalanır.
 */
export function paymentRequestText(opts: {
  /** Ödeyen işletme */
  payer?: string;
  name: string;
  card: Pick<SupplierCard, "legalName" | "iban" | "bankName" | "accountHolder" | "taxNumber"> | null;
  /** Ödenecek faturalar; eksi tutarlılar ödemeden düşülen iade faturaları */
  lines: readonly RequestLine[];
  note?: string | null;
}): string {
  const { card, lines } = opts;
  const debts = lines.filter((l) => l.amount > 0);
  const credits = lines.filter((l) => l.amount < 0);
  const total = round2(lines.reduce((a, l) => a + l.amount, 0));
  const recipient = card?.accountHolder?.trim() || card?.legalName?.trim() || opts.name;
  const bank = card?.bankName?.trim() || bankFromIban(card?.iban);
  const credit = round2(credits.reduce((a, l) => a - l.amount, 0));
  const out = [
    opts.payer ? `Ödeme talebi · ${opts.payer}` : "Ödeme talebi",
    `Alıcı: ${recipient}`,
    card?.iban ? `IBAN: ${formatIban(card.iban)}` : "IBAN: (kartta yok)",
    bank ? `Banka: ${bank}` : null,
    card?.taxNumber ? `Vergi no: ${normalizeTaxNumber(card.taxNumber)}` : null,
    `Tutar: ${money(total)}${credits.length ? ` (faturalar ${money(round2(total + credit))} − iade ${money(credit)})` : ""}`,
    debts.length ? `Açıklama: ${transferNote(debts)}` : null,
  ].filter((x): x is string => Boolean(x));
  const byDate = (list: readonly RequestLine[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (debts.length) {
    out.push("", `Faturalar (${debts.length}):`);
    for (const l of byDate(debts)) {
      out.push(`• ${dateTR(l.date)}${l.invoiceNo ? ` · ${l.invoiceNo}` : ""} · ${money(l.amount)}${l.dueDate ? ` · vade ${dateTR(l.dueDate)}` : ""}`);
    }
  }
  if (credits.length) {
    out.push("", `Düşülen iadeler (${credits.length}):`);
    for (const l of byDate(credits)) out.push(`• ${dateTR(l.date)}${l.invoiceNo ? ` · ${l.invoiceNo}` : ""} · −${money(-l.amount)}`);
  }
  const note = opts.note?.trim();
  if (note) out.push("", note);
  // Tutarlardaki bölünmez boşluk (tl) düz metinde de doğru görünür; WhatsApp ve e-posta olduğu gibi gösterir
  return out.join("\n");
}
