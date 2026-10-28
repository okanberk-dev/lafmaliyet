/**
 * Cari kayıtlarının eşleşmeleri (saf; tests/cari-eslesme.test.ts): faturasız alımın sonradan gelen faturası (güçlü ve
 * zayıf aday), Kasa'daki aynı tedarikçinin satırları, Aylık harcamalar'daki benzer kayıt ve borcun varsayılan gideri.
 * Hiçbiri kendiliğinden bağ kurmaz: bağ her zaman bilinçli bir tıklamadır (docs/TEDARIKCILER.md "Hesap hareketleri").
 */
import { supplierMatchKey } from "../../app/panel/faturalar/rules";
import { COMMISSION_CATEGORY, SEPARATE_CATEGORIES } from "../constants";
import { tl } from "../format";
import { addDays, daysBetween } from "../reminders";
import { EPS, openBalance, round2, type BalanceInvoice } from "./balance";
import type { CariDebt, CostMode } from "./account";

// ---------------------------------------------------------------- Fatura adayları (K17)

/** Pencere: fatura, borcun gününden en çok bu kadar gün önce ya da sonra tarihli olabilir */
export const LINK_WINDOW = { before: 7, after: 45 } as const;

export interface CandidateInvoice {
  id: number;
  date: string;
  payable: number;
  category: string;
  /** Kalanı var (ödenmemiş); verilmezse açık sayılır. Zayıf aday yalnız açık faturada */
  open?: boolean;
}

export interface LinkCandidate {
  invoiceId: number;
  debtIds: number[];
  /** Fatura − borçların toplamı */
  diff: number;
}

/** Güçlü adayın toleransı: max(1 ₺, Ödenecek'in %2'si) */
export const linkTolerance = (payable: number) => Math.max(1, 0.02 * payable);

/**
 * Faturasız alımın bağlanabileceği fatura: Ödenecek > 0, komisyon ve kafe dışı (karaoke box, Alp Koç) değil. Bağlama
 * borcun gider kaydını siler; bu kategorilerdeki fatura kafenin mal alışına girmez, gider sessizce düşerdi (aday, Faturası
 * geldi penceresi ve sunucu aynı kuralı kullanır)
 */
export const linkableInvoice = (i: { payable: number; category: string }) => i.payable > 0 && i.category !== COMMISSION_CATEGORY && !SEPARATE_CATEGORIES.includes(i.category);

/**
 * Faturasız alımı bağlı faturanın yeni hâli (kategori, Ödenecek) onu bağlanamaz yapıyorsa neden (denetim E-45), yoksa
 * null. Bağlama borcun gider kaydını sildi: fatura kafe dışına (karaoke box, Alp Koç), komisyona ya da iadeye dönerse
 * bağlı alım gelir-giderden, mal maliyetinden ve KDV tahmininden sessizce düşerdi. Yalnız değişen alan sorulur: eski
 * bir bağın faturası bugünkü kuralı tutmasa da notu ya da vadesi düzeltilebilsin.
 */
export function linkedInvoiceProblem(cur: { payable: number; category: string }, next: { payable: number; category: string }): string | null {
  if (linkableInvoice(next)) return null;
  if (next.category !== cur.category && !linkableInvoice({ payable: 1, category: next.category })) return `${next.category} faturası kafenin mal alışına girmez`;
  if (next.payable !== cur.payable && !(next.payable > 0)) return "Ödenecek 0 ya da eksi olursa fatura iade sayılır";
  return null;
}

/** Bağlı alımı olan faturanın değişikliği reddedilirken söylenen: ne bağlı, neden olmaz, ne yapılmalı */
export function linkedInvoiceRefusal(o: { invoice: string; purchases: readonly string[]; reason: string; count?: number; kept: string }): string {
  const what = o.purchases.length === 1 ? `faturasız alım bağlı (${o.purchases[0]})` : `${o.purchases.length} faturasız alım bağlı`;
  const more = o.count && o.count > 1 ? ` ve ${o.count - 1} fatura daha` : "";
  return `${o.invoice}${more}: ${what}. ${o.reason}; bağlı alım gelir-giderden düşerdi. Önce Tedarikçiler'de, Hesap hareketleri'nde alımın Bağı kaldır'ına dokunun. ${o.kept}`;
}

/** Faturanın aday alanları (kalanı varsa açık) */
export const candidateOf = (i: BalanceInvoice & { id: number; date: string; category: string }): CandidateInvoice => ({
  id: i.id,
  date: i.date,
  payable: i.payable,
  category: i.category,
  open: openBalance(i) > EPS,
});

const inWindow = (debtDate: string, invoiceDate: string) => invoiceDate >= addDays(debtDate, -LINK_WINDOW.before) && invoiceDate <= addDays(debtDate, LINK_WINDOW.after);

/**
 * Faturası gelmiş olabilecek faturasız alımlar. Faturalar: bağlanabilir (linkableInvoice), henüz bir borç bağlanmamış.
 * Borçlar: bağsız, gideri "fatura", "gider" ya da "mevcut". Pencere: fatura borcun gününden 7 gün önce ile 45 gün sonra
 * arasında; "Ayrı alım" denmiş çift atlanır.
 * - Güçlü (a): tek borç, |A − P| ≤ max(1, %2·P). Bir alımın tek faturası olur: aynı tutarda birden çok fatura (haftalık
 *   faturalar) borcun güçlü adayı olsa da yalnız gününe en yakını güçlü sayılır (eşitse sonra gelen, sonra tutarı
 *   yakın), ötekiler sessize alınmaz (gerçek borç e-postadan ve plandan düşmesin)
 * - Güçlü (b): penceredeki, başka faturanın güçlü adayı olmayan en az iki borcun toplamı aynı toleransla (alt küme
 *   aranmaz, hepsi alınır)
 * - Zayıf: açık (ödenmemiş) faturanın penceresinde güçlü adayı olmayan bağsız bir "Faturası gelecek" borcu var
 */
export function linkCandidates(debts: readonly CariDebt[], invoices: readonly CandidateInvoice[]): { strong: LinkCandidate[]; weak: LinkCandidate[] } {
  const linked = new Set(debts.map((d) => d.invoiceId).filter((x): x is number => x !== null));
  const open = debts.filter((d) => d.invoiceId === null && (d.costMode === "fatura" || d.costMode === "gider" || d.costMode === "mevcut"));
  const wins = invoices
    .filter((inv) => linkableInvoice(inv) && !linked.has(inv.id))
    .map((inv) => ({
      inv,
      tol: linkTolerance(inv.payable),
      window: open.filter((d) => inWindow(d.date, inv.date) && !(d.dismissedInvoiceIds ?? []).includes(inv.id)).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id),
    }))
    .filter((w) => w.window.length)
    .sort((a, b) => a.inv.date.localeCompare(b.inv.date) || a.inv.id - b.inv.id);
  // (a) Her borç gününe en yakın tek faturaya
  const rank = (d: CariDebt, inv: CandidateInvoice) => [Math.abs(daysBetween(d.date, inv.date)), inv.date < d.date ? 1 : 0, Math.abs(d.amount - inv.payable), inv.id];
  const better = (x: number[], y: number[]) => {
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] < y[k];
    return false;
  };
  const best = new Map<number, { invoiceId: number; rank: number[] }>();
  for (const w of wins) {
    for (const d of w.window) {
      if (Math.abs(d.amount - w.inv.payable) > w.tol) continue;
      const r = rank(d, w.inv);
      const cur = best.get(d.id);
      if (!cur || better(r, cur.rank)) best.set(d.id, { invoiceId: w.inv.id, rank: r });
    }
  }
  const used = new Set(best.keys());
  const strongInvoices = new Set<number>();
  const strong: LinkCandidate[] = [];
  for (const w of wins) {
    const singles = w.window.filter((d) => best.get(d.id)?.invoiceId === w.inv.id);
    for (const d of singles) strong.push({ invoiceId: w.inv.id, debtIds: [d.id], diff: round2(w.inv.payable - d.amount) });
    if (singles.length) strongInvoices.add(w.inv.id);
  }
  // (b) Toplam: başka faturanın güçlü adayı olmayan borçlar
  for (const w of wins) {
    if (strongInvoices.has(w.inv.id)) continue;
    const rest = w.window.filter((d) => !used.has(d.id));
    const total = rest.reduce((a, d) => a + d.amount, 0);
    if (rest.length >= 2 && Math.abs(total - w.inv.payable) <= w.tol) {
      strong.push({ invoiceId: w.inv.id, debtIds: rest.map((d) => d.id), diff: round2(w.inv.payable - total) });
      strongInvoices.add(w.inv.id);
      for (const d of rest) used.add(d.id);
    }
  }
  // Zayıf: yalnız açık fatura, güçlü adayı olmayan "Faturası gelecek" borçlar
  const weak: LinkCandidate[] = [];
  for (const w of wins) {
    if (strongInvoices.has(w.inv.id) || w.inv.open === false) continue;
    const expected = w.window.filter((d) => d.costMode === "fatura" && !used.has(d.id));
    if (expected.length) weak.push({ invoiceId: w.inv.id, debtIds: expected.map((d) => d.id), diff: round2(w.inv.payable - expected.reduce((a, d) => a + d.amount, 0)) });
  }
  return { strong, weak };
}

// ---------------------------------------------------------------- Kasa satırları (K15, K16)

export interface KasaLine {
  id: number;
  date: string;
  kind: "harcama" | "teslim";
  store: string | null;
  docType: "fis" | "e_arsiv" | "fatura" | "yok";
  amount: number;
}

/**
 * Kasa satırının Kime / Yer metninin eşleşme anahtarları (`supplierMatchKey`): yazıldığı gibi, kesme işaretinden
 * sonraki ek atılarak ("Sütaş'a", "Metro’dan") ve parantez içindeki ad ("tedarikçiye (Sütaş)"; baştaki "tedarikçiye"
 * sözü atılır). Kime alanı doğal olarak yönelme ekiyle yazılır; ek yüzünden satır yöneticinin önüne hiç gelmezdi.
 */
export function kasaStoreKeys(store: string): string[] {
  const parts = [store, ...[...store.matchAll(/\(([^)]*)\)/gu)].map((m) => m[1])];
  const out = new Set<string>();
  for (const p of parts) {
    out.add(supplierMatchKey(p));
    const words = supplierMatchKey(p)
      .split(" ")
      .map((w) => w.replace(/['’].*$/u, ""))
      .filter(Boolean);
    if (words.length && /^tedarik[çc]i/u.test(words[0])) words.shift();
    out.add(words.join(" "));
  }
  out.delete("");
  return [...out];
}

/**
 * Tedarikçinin adlarıyla eşleşen işlenmemiş Kasa satırları (Kime / Yer alanı, kasaStoreKeys). İşlenmemiş: bir
 * cari ödemeye bağlı değil ve "Ayrı tut" denmemiş (`handled`). Tutara bakılmaz (900 ile 905 aynı alım olabilir).
 * - `kinds`: Teslim ve / veya Alışveriş
 * - `receiptless`: Alışveriş yalnız fişsizse (belge "yok")
 * - `harcamaDays`: Alışveriş yalnız bu günlerde (grubun o gün açık kalemi varken)
 */
export function kasaMatches<L extends KasaLine>(
  lines: readonly L[],
  opts: {
    keys: Iterable<string>;
    handled: ReadonlySet<number>;
    from: string;
    to: string;
    kinds: readonly KasaLine["kind"][];
    receiptless?: boolean;
    harcamaDays?: ReadonlySet<string>;
  },
): L[] {
  const keys = new Set(opts.keys);
  return lines
    .filter((l) => {
      if (opts.handled.has(l.id) || l.date < opts.from || l.date > opts.to || !opts.kinds.includes(l.kind)) return false;
      if (!l.store || !kasaStoreKeys(l.store).some((k) => keys.has(k))) return false;
      if (l.kind === "harcama") {
        if (opts.receiptless && l.docType !== "yok") return false;
        if (opts.harcamaDays && !opts.harcamaDays.has(l.date)) return false;
      }
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

/** Borç ekle'nin Kasa denetiminde bulunan satır (sunucu bulur, pencere seçimi gösterir; K15) */
export interface KasaFound {
  id: number;
  date: string;
  kind: "harcama" | "teslim";
  amount: number;
  store: string | null;
  docType: "fis" | "e_arsiv" | "fatura" | "yok";
  createdByName: string;
  /** Alışveriş satırının Aylık harcamalar kaydı (varsa) */
  expense: { categoryName: string; amount: number; date: string } | null;
}

/** Borç ekle'nin Kasa denetimi: alım gününün ±3 günü */
export const KASA_DEBT_DAYS = 3;
/** Kalem ipucu, liste şeridi ve zil: son 60 gün */
export const KASA_LOOKBACK_DAYS = 60;

// ---------------------------------------------------------------- Aylık harcamalar'daki kayıtlar (§3.1.3, §3.1.6)

export interface ExpenseLite {
  id: number;
  date: string;
  amount: number;
  categoryId: number;
  description: string | null;
  supplierEntryId: number | null;
  cashOutId: number | null;
}

/**
 * Kopya uyarısı ("Faturası yok · gider yaz" seçiliyken): mal bölümündeki bir kategoride ±3 gün ve ±1 ₺ içindeki,
 * sahibi olmayan kayıtlar
 */
export function expenseDuplicates<E extends ExpenseLite>(entries: readonly E[], debt: { date: string; amount: number }, goodsCategoryIds: ReadonlySet<number>): E[] {
  return entries
    .filter((e) => goodsCategoryIds.has(e.categoryId) && e.supplierEntryId === null && Math.abs(daysBetween(debt.date, e.date)) <= 3 && Math.abs(e.amount - debt.amount) <= 1)
    .sort((a, b) => Math.abs(a.amount - debt.amount) - Math.abs(b.amount - debt.amount) || a.id - b.id);
}

/**
 * "Gideri zaten girildi" adayları: alım gününün ±31 günü, başka bir borcun değil, Kasa'dan yazılmamış (o peşin
 * alımdır). Mal bölümündeki kategoriler önce, sonra tutar farkı en küçük olan.
 */
export function adoptCandidates<E extends ExpenseLite>(entries: readonly E[], debt: { date: string; amount: number }, goodsCategoryIds: ReadonlySet<number>, ownEntryId: number | null = null): E[] {
  return entries
    .filter((e) => (e.supplierEntryId === null || e.supplierEntryId === ownEntryId) && e.cashOutId === null && Math.abs(daysBetween(debt.date, e.date)) <= 31)
    .sort(
      (a, b) =>
        Number(goodsCategoryIds.has(b.categoryId)) - Number(goodsCategoryIds.has(a.categoryId)) ||
        Math.abs(a.amount - debt.amount) - Math.abs(b.amount - debt.amount) ||
        a.id - b.id,
    );
}

// ---------------------------------------------------------------- Varsayılan gider (K8)

/** Son bu kadar günde Paraşüt'ten faturası gelmiş tedarikçi fatura kesiyor sayılır */
export const PARASUT_RECENT_DAYS = 90;

/** Borç ekle'nin varsayılanı: son 90 günde Paraşüt'ten faturası gelmişse "Faturası gelecek", değilse "Faturası yok · gider yaz" */
export function defaultCostMode(invoices: readonly { origin?: string | null; date: string }[], today: string): CostMode {
  const since = addDays(today, -PARASUT_RECENT_DAYS);
  return invoices.some((i) => i.origin === "parasut" && i.date >= since && i.date <= today) ? "fatura" : "gider";
}

// ---------------------------------------------------------------- Genel bakış uyarıları (§6.7)

/** Genel bakış'ın "Dikkat edilmesi gerekenler"i (insights.ts Alert ile aynı biçim) */
export interface CariAlert {
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href?: string;
}

/**
 * Cari hesabın uyarıları: faturası 45 gündür gelmeyen "Faturası gelecek" alımlar (§5.2; "Beklemeye devam" denmişse
 * süresi dolana kadar yok) ve faturası gelmiş olabilecek alımlar (güçlü aday; K17). Bağlantı tedarikçinin sayfası.
 */
export function cariAlerts(input: {
  late: readonly { name: string; date: string; description: string | null; amount: number; href: string | null }[];
  strong: readonly { name: string; href: string | null; debtIds?: readonly number[] }[];
}): CariAlert[] {
  const out: CariAlert[] = [];
  const day = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  if (input.late.length) {
    const first = input.late[0];
    out.push({
      level: "warning",
      title: input.late.length === 1 ? "Faturası 45 gündür gelmeyen alım" : `Faturası 45 gündür gelmeyen ${input.late.length} alım`,
      detail: input.late
        .slice(0, 3)
        .map((d) => `${d.name}: ${day(d.date)} · ${d.description?.trim() || "alım"} · ${tl(d.amount, 2)}`)
        .join(", "),
      ...(first.href ? { href: `${first.href}?sekme=hareketler` } : {}),
    });
  }
  if (input.strong.length) {
    const names = [...new Set(input.strong.map((c) => c.name))];
    const first = input.strong[0];
    // Alım sayısı (bir alımın birden çok aday faturası olabilir; aday yoksa fatura başına)
    const ids = input.strong.flatMap((c) => c.debtIds ?? []);
    const count = ids.length ? new Set(ids).size : input.strong.length;
    out.push({
      level: "info",
      title: count === 1 ? "Faturasız alımın faturası gelmiş olabilir" : `${count} faturasız alımın faturası gelmiş olabilir`,
      detail: `${names.slice(0, 3).join(", ")}: bağlanana kadar fatura Ödemeler'de sessiz, nakit planında yok. Tedarikçi sayfasında Bağla ya da Ayrı alım.`,
      ...(first.href ? { href: first.href } : {}),
    });
  }
  return out;
}
