/**
 * Tedarikçiler ekranının saf kuralları (cari hesaplar): faturaların tedarikçi tedarikçi toplanması, kalan borç ve
 * vade, ödeme durumu, cari kartı alanlarının denetimi (IBAN, VKN / TCKN, telefon) ve ödeme talebi metni. Sayfalar,
 * sunucu eylemleri, Ödemeler'in tahmini vadesi ve Paraşüt eşitlemesi (peşin çalışılan tedarikçi) bunu kullanır;
 * tests/tedarikciler.test.ts ile sınanır.
 *
 * Faturalar karta yabancı anahtarla bağlanmaz: faturadaki tedarikçi adının anahtarı (supplierMatchKey: büyük/küçük
 * harf, I/ı, boşluk ve parantezli not sayılmaz) kartın adının ya da diğer adlarından birinin anahtarıyla aynıysa
 * fatura o karttadır. Adı tutmayan fatura vergi numarasıyla (VKN / TCKN) eşleşir: kartta yazılı numarayla ya da aynı
 * numarayı taşıyan öteki faturaların adlarıyla (supplierResolver). Kartı olmayan ad kendi başına bir tedarikçidir
 * (aynı vergi nolu adlar birlikte); kart, bilgi girilince açılır.
 */
import { accountOf, SOON_DAYS, type SupplierSummary } from "@/lib/cari/account";
import { dateTR, money, num } from "@/lib/format";
import { daysBetween } from "@/lib/reminders";

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
  /** Listeden kaldırıldığı gün (YYYY-MM-DD); kaldırılmadıysa null (isHiddenSupplier) */
  hiddenOn: string | null;
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

// ---------------------------------------------------------------- Vergi no ile eşleşme

/**
 * Eşleşmede yok sayılan yer tutucu numaralar: formlarda ve örneklerde yazılan numaralar. 1234567890 VKN kontrol
 * hanesini geçtiği için listede (örnek e-faturalarda ve testlerde de bu yazılı).
 */
export const DUMMY_TAX_NUMBERS: ReadonlySet<string> = new Set([
  "1234567890",
  "1111111111",
  "11111111111",
  "2222222222",
  "22222222222",
  "0000000000",
  "00000000000",
  "9999999999",
  "99999999999",
]);

/** Faturada saklanan biçim: yalnız rakam, 10 (VKN) ya da 11 (TCKN) hane; başka uzunlukta null */
export function cleanTaxNumber(raw: string | null | undefined): string | null {
  const v = normalizeTaxNumber(raw);
  return v.length === 10 || v.length === 11 ? v : null;
}

/**
 * Eşleşmede kullanılan biçim: kontrol hanesi tutan ve yer tutucu olmayan numara. Değilse null: o numara saklanır,
 * faturada görünür ama iki firmayı birleştirmez.
 */
export function taxKey(raw: string | null | undefined): string | null {
  const v = cleanTaxNumber(raw);
  if (!v || DUMMY_TAX_NUMBERS.has(v)) return null;
  return (v.length === 10 ? isValidVkn(v) : isValidTckn(v)) ? v : null;
}

/** Faturalar'daki "Tedarikçinin sayfası" bağlantısının anahtarı: ad ve (geçerliyse) vergi no birlikte */
export const supplierPairKey = (name: string, taxNumber?: string | null) => `${supplierMatchKey(name)}|${taxKey(taxNumber) ?? ""}`;

/** Birleşim-bul (yol kısaltmalı); düğüm adları "n:<ad anahtarı>", "t:<vergi no>", "c:<kart kimliği>" */
class UnionFind {
  private parent = new Map<string, string>();

  has(x: string): boolean {
    return this.parent.has(x);
  }

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    for (let cur = x; cur !== root; ) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Kök sıradan bağımsız seçilir (küçük olan): aynı girdi her sırada aynı ağacı verir
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }

  nodes(): string[] {
    return [...this.parent.keys()];
  }
}

/** Tedarikçisi bulunacak fatura: ad ve (Paraşüt'ten geldiyse) vergi no; tarih gerekmez */
export interface SupplierRef {
  supplier: string;
  supplierTaxNumber?: string | null;
  date?: string;
}

/**
 * Faturanın tedarikçisi. `id` grubu ayırır ("kart:<kimlik>" ya da kartsızda "ad:<anahtar>"), `key` grubun anahtarı.
 * `via`: "ad" kartın adı ya da diğer adıyla, "vergi" vergi numarasıyla eşleşti; kartsızda null.
 */
export interface SupplierMatch<C> {
  id: string;
  key: string;
  card: C | null;
  via: "ad" | "vergi" | null;
}

/**
 * Faturayı (ad, vergi no) çiftinden tedarikçisine bağlar. Sonuç yalnız çifte, kartlara ve bütün çiftlerin kümesine
 * bağlıdır: aynı çiftleri veren her çağıran (Tedarikçiler, adres parçaları, ⌘K, Faturalar'daki bağlantı, Ödemeler'in
 * tahmini vadesi, eşitlemedeki peşin kuralı) aynı tedarikçiyi bulur. Sıra:
 * 1. Ad önce: kartın adı ya da diğer adıysa o kart. Sahibin elle yazdığı ad hep kazanır (iki firmayı ayırmanın yolu).
 * 2. Kartta yazılı vergi no tek bir kartta varsa o kart. İki kartta aynı numara yazılıysa kartlardaki numara
 *    eşleşmede kullanılmaz (numara faturalar üzerinden yine bir karta bağlanabilir, 3. adım).
 * 3. Öteki faturalar üzerinden: aynı faturada geçen ad ve vergi no birbirine bağlanır (birleşim-bul). Bağlı küme tek
 *    kart içeriyorsa o kart; kartsızsa kümenin kartsız grubu (anahtarı kümedeki en küçük ad anahtarı). İki kart
 *    içeriyorsa (çakışma) aynı adlı ve vergi nolu faturalar 2. adımda tek karta gittiyse onu izler.
 * 4. Yoksa (bugünkü kural) kendi adının kartsız grubu.
 * Kontrol hanesi tutmayan ve yer tutucu numaralar (taxKey) hiçbir şeyi bağlamaz; Paraşüt'ün geçici adı ("Paraşüt
 * tedarikçisi") köprü olmaz, vergi nosu bilinen tedarikçisine gider. Vergi nosu olmayan veride sonuç eskisiyle aynıdır.
 */
export function supplierResolver<C extends CardNames & { taxNumber?: string | null }>(cards: readonly C[], refs: readonly SupplierRef[]) {
  const placeholder = supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME);
  const byName = cardIndex(cards);
  const byId = new Map(cards.map((c) => [String(c.id), c] as const));
  const taxCards = new Map<string, C[]>();
  for (const c of cards) {
    const t = taxKey(c.taxNumber);
    if (t) taxCards.set(t, [...(taxCards.get(t) ?? []), c]);
  }
  const byTax = new Map<string, C>();
  for (const [t, list] of taxCards) if (list.length === 1) byTax.set(t, list[0]);

  const uf = new UnionFind();
  for (const [k, c] of byName) uf.union(`n:${k}`, `c:${c.id}`);
  for (const [t, c] of byTax) uf.union(`t:${t}`, `c:${c.id}`);
  const pairs = refs.map((r) => ({ k: supplierMatchKey(r.supplier), t: taxKey(r.supplierTaxNumber) }));
  for (const { k, t } of pairs) if (k && t && k !== placeholder) uf.union(`n:${k}`, `t:${t}`);

  // Kümelerin kartları ve kartsız kümenin anahtarı (en küçük ad anahtarı: tarihe bakmadan her çağıranda aynı)
  const compCards = new Map<string, Set<C>>();
  const compKey = new Map<string, string>();
  for (const node of uf.nodes()) {
    const root = uf.find(node);
    if (node.startsWith("c:")) {
      const c = byId.get(node.slice(2));
      if (c) compCards.set(root, (compCards.get(root) ?? new Set()).add(c));
    } else if (node.startsWith("n:")) {
      const k = node.slice(2);
      const cur = compKey.get(root);
      if (k !== placeholder && (cur === undefined || k < cur)) compKey.set(root, k);
    }
  }
  // Çakışmada: adı karta ait olmayan, vergi nosu bir kartta yazılı faturalar (2. adım) hangi kartlara gitti
  const nameTaxCards = new Map<string, Set<C>>();
  for (const { k, t } of pairs) {
    const c = t ? byTax.get(t) : undefined;
    if (!c || !k || k === placeholder || byName.has(k)) continue;
    nameTaxCards.set(k, (nameTaxCards.get(k) ?? new Set()).add(c));
  }

  const toCard = (c: C, via: "ad" | "vergi"): SupplierMatch<C> => ({ id: `kart:${c.id}`, key: supplierMatchKey(c.name), card: c, via });
  const only = (set: Set<C>) => set.values().next().value as C;

  function resolve(supplier: string, taxNumber?: string | null): SupplierMatch<C> {
    const k = supplierMatchKey(supplier);
    const named = byName.get(k);
    if (named) return toCard(named, "ad");
    const t = taxKey(taxNumber);
    const taxed = t ? byTax.get(t) : undefined;
    if (taxed) return toCard(taxed, "vergi");
    // Çiftlerde olmayan vergi no (eşitlemenin yeni faturası, henüz kayıtlı değil): çift eklenince numara adın kümesine
    // katılırdı, o yüzden adın kümesine bakılır
    const tNode = t ? `t:${t}` : null;
    const node = tNode && uf.has(tNode) ? tNode : k !== placeholder ? `n:${k}` : null;
    if (node && uf.has(node)) {
      const root = uf.find(node);
      const inComp = compCards.get(root);
      if (inComp?.size === 1) return toCard(only(inComp), "vergi");
      if (!inComp?.size) {
        const key = compKey.get(root);
        if (key !== undefined) return { id: `ad:${key}`, key, card: null, via: null };
      } else if (k !== placeholder) {
        const follow = nameTaxCards.get(k);
        if (follow?.size === 1) return toCard(only(follow), "vergi");
      }
    }
    return { id: `ad:${k}`, key: k, card: null, via: null };
  }

  return { resolve };
}

/**
 * Faturadaki ad (ve vergi no) → komisyon kanalının aranacağı adlar (channelOf): faturadaki ad, sonra tedarikçi
 * kartının adı ve diğer adları (supplierResolver: ad önce, sonra vergi no). Komisyon & hakediş
 * (src/server/data/commission.ts) ve Gelir-gider'in POS komisyonu uyarısı (src/server/data/dataset.ts) aynı kuralla:
 * "Diğer adlar"a eklenen ad faturayı iki ekranda birden kanala bağlar (denetim B16).
 */
export function channelNameResolver<C extends CardNames & { taxNumber?: string | null }>(cards: readonly C[], refs: readonly SupplierRef[]) {
  const { resolve } = supplierResolver(cards, refs);
  return (supplier: string, taxNumber?: string | null): string[] => {
    const card = resolve(supplier, taxNumber).card;
    return card ? [supplier, card.name, ...card.aliases] : [supplier];
  };
}

// ---------------------------------------------------------------- Vade ve ödeme durumu

// Vade ve hesap özeti cari hesabın saf modülünde (src/lib/cari/account.ts): faturalar ve elle kayıtlar aynı kuralla
export { dueOf, SOON_DAYS, type Due, type SupplierSummary } from "@/lib/cari/account";

/** Kalan borcu ve ödeme durumunu hesaplamak için gereken fatura alanları */
export interface LedgerInvoice {
  date: string;
  supplier: string;
  /** KDV dahil (iade eksi) */
  payable: number;
  unpaid: boolean;
  /** Paraşüt'ün bildirdiği kalan (kısmen ödenmişte) */
  outstanding?: number | null;
  /** Bu faturaya sayılan cari ödemeler (src/lib/cari/balance.ts) */
  allocated?: number | null;
  /** Panel takibinin tabanı; boşsa takipsiz (bugünkü kural) */
  ledgerBase?: number | null;
  /** Defterin (cari ödemelerin) kapattığı fatura */
  paidByLedger?: boolean | null;
  dueDate?: string | null;
  paidAt?: string | null;
  paymentRequestedAt?: string | null;
  /** Paraşüt'ten gelen tedarikçi vergi nosu (elle girilende ve içe aktarılmış kayıtta yok) */
  supplierTaxNumber?: string | null;
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

/**
 * Faturaların hesap özeti (elle kayıt olmadan): cari hesabın özetiyle aynı kural (accountOf; kayıt yokken bugünküyle
 * birebir aynı, tests/cari-sabit.test.ts)
 */
export function summarize(invoices: readonly (LedgerInvoice & { id?: number })[], opts: { today: string; termDays: number }): SupplierSummary {
  const a = accountOf({ invoices: invoices.map((i, k) => ({ ...i, id: i.id ?? -(k + 1) })) }, opts);
  return {
    count: a.count,
    invoiced: a.invoiced,
    year: a.year,
    openCount: a.openCount,
    open: a.open,
    requestedCount: a.requestedCount,
    requested: a.requested,
    overdueCount: a.overdueCount,
    overdue: a.overdue,
    soonCount: a.soonCount,
    soon: a.soon,
    nextDue: a.nextDue,
    nextSoonDue: a.nextSoonDue,
    lastInvoice: a.lastInvoice,
    lastPaid: a.lastPaid,
  };
}

// ---------------------------------------------------------------- Tedarikçiler (gruplar)

/** Aynı vergi nosunu taşıyan başka bir tedarikçi (tedarikçi sayfasındaki şerit); `count` onun fatura sayısı */
export interface SharedTax {
  taxNumber: string;
  others: { name: string; slug: string; cardId: number | null; count: number }[];
}

export interface SupplierGroup<I extends LedgerInvoice = LedgerInvoice, C extends CardNames = SupplierCard> {
  /** Kartın adının ya da (kartsızda) faturalardaki adların en küçük anahtarı */
  key: string;
  /** Adresteki parça: /panel/tedarikciler/<slug> */
  slug: string;
  name: string;
  card: C | null;
  /**
   * Faturalarda geçen adlar (parantezli not hariç), en yeni faturanınki önce. Paraşüt'ün geçici adı yalnız kendi
   * grubunda yazılır ("Faturadan doldur" bu adla bütün adı okunamayan faturalara bakmasın)
   */
  names: string[];
  /** Grubun bütün ad anahtarları: faturalardaki adlar, kartın adı ve diğer adları (kartsız grubu adıyla bulmak için) */
  keys: string[];
  /** Yalnız vergi numarasıyla gelen adlar (kartın adı ya da diğer adı değil; kartsızda grubun anahtarından başkası) */
  viaTax: string[];
  /** Faturalardaki geçerli vergi numaraları, en çok fatura önce */
  taxNumbers: { taxNumber: string; count: number }[];
  /** Kartta yazılı vergi no; yoksa faturalardaki tek vergi no (birden çoksa null) */
  taxNumber: string | null;
  /** Aynı vergi nosunu taşıyan öteki tedarikçiler (adı başka karta ait faturalar, iki kartta aynı numara) */
  sharedTax: SharedTax[];
  /** En yeni önce */
  invoices: I[];
  /** Tahmini vadenin günü: kartta yazılıysa o, değilse genel ayar */
  termDays: number;
  summary: SupplierSummary;
}

/**
 * Faturaları tedarikçi tedarikçi toplar (supplierResolver): kartı olan adlar kartta (diğer adlarıyla birlikte),
 * vergi nosu karta ya da kartın faturalarına bağlanan adlar da kartta; kartsız adlar kendi başına, aynı vergi nolu
 * olanlar birlikte. Faturası olmayan kartlar da listede (yeni eklenmiş tedarikçi). Sıra ada göre; ekran kendisi sıralar.
 */
export function groupSuppliers<I extends LedgerInvoice, C extends CardNames & { paymentTermDays?: number | null; taxNumber?: string | null }>(
  invoices: readonly I[],
  cards: readonly C[],
  opts: { today: string; termDays: number },
): SupplierGroup<I, C>[] {
  const placeholder = supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME);
  const { resolve } = supplierResolver(cards, invoices);
  const byId = new Map<string, { key: string; card: C | null; invoices: I[] }>();
  for (const c of cards) byId.set(`kart:${c.id}`, { key: supplierMatchKey(c.name), card: c, invoices: [] });
  for (const inv of invoices) {
    const r = resolve(inv.supplier, inv.supplierTaxNumber);
    let g = byId.get(r.id);
    if (!g) {
      g = { key: r.key, card: null, invoices: [] };
      byId.set(r.id, g);
    }
    g.invoices.push(inv);
  }
  const slugs = assignSlugs([...byId.values()].map((g) => g.key));
  const out: SupplierGroup<I, C>[] = [];
  for (const g of byId.values()) {
    const list = [...g.invoices].sort((a, b) => b.date.localeCompare(a.date));
    const own = g.card ? [g.card.name, ...g.card.aliases].map(supplierMatchKey) : [g.key];
    // Her anahtardan bir ad (en yeni faturadaki yazılışı): "KALDI" ile "Kaldi" aynı addır
    const names: string[] = [];
    const keys = new Set<string>(g.card ? own.filter(Boolean) : []);
    const seen = new Set<string>();
    const taxCount = new Map<string, number>();
    for (const inv of list) {
      const k = supplierMatchKey(inv.supplier);
      const t = taxKey(inv.supplierTaxNumber);
      if (t) taxCount.set(t, (taxCount.get(t) ?? 0) + 1);
      if (seen.has(k) || (k === placeholder && g.key !== placeholder)) continue;
      seen.add(k);
      keys.add(k);
      names.push(splitSupplier(inv.supplier).base.trim());
    }
    const ownKeys = new Set(own);
    const taxNumbers = [...taxCount]
      .map(([taxNumber, count]) => ({ taxNumber, count }))
      .sort((a, b) => b.count - a.count || a.taxNumber.localeCompare(b.taxNumber));
    const termDays = g.card?.paymentTermDays ?? opts.termDays;
    out.push({
      key: g.key,
      slug: slugs.get(g.key) ?? supplierSlug(g.key),
      name: g.card?.name ?? names[0] ?? g.key,
      card: g.card,
      names,
      keys: [...keys],
      viaTax: names.filter((n) => !ownKeys.has(supplierMatchKey(n))),
      taxNumbers,
      taxNumber: g.card?.taxNumber || (taxNumbers.length === 1 ? taxNumbers[0].taxNumber : null),
      sharedTax: [],
      invoices: list,
      termDays,
      summary: summarize(list, { today: opts.today, termDays }),
    });
  }
  // Aynı vergi no birden çok tedarikçide: faturalarındaki ya da kartındaki numara (adı başka bir kartta olan
  // fatura, iki kartta yazılı aynı numara, iki kartı birbirine bağlayan numara). Paraşüt'ün geçici adının grubu
  // sayılmaz (orada kalan faturanın tedarikçisi henüz bilinmiyor)
  const holders = new Map<string, SupplierGroup<I, C>[]>();
  const taxesOf = (g: SupplierGroup<I, C>) => {
    const own = taxKey(g.card?.taxNumber);
    return [...new Set([...g.taxNumbers.map((t) => t.taxNumber), ...(own ? [own] : [])])];
  };
  for (const g of out) {
    if (!g.card && g.key === placeholder) continue;
    for (const t of taxesOf(g)) holders.set(t, [...(holders.get(t) ?? []), g]);
  }
  for (const g of out) {
    if (!g.card && g.key === placeholder) continue;
    g.sharedTax = taxesOf(g).flatMap((taxNumber) => {
      const others = (holders.get(taxNumber) ?? []).filter((o) => o !== g).sort((a, b) => a.name.localeCompare(b.name, "tr"));
      return others.length ? [{ taxNumber, others: others.map((o) => ({ name: o.name, slug: o.slug, cardId: o.card?.id ?? null, count: o.invoices.length })) }] : [];
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/**
 * Vergi no önizlemesinde o numarayı taşıyan bir tedarikçi ve gelecek adları: kartsız tedarikçinin bütün adları (küme
 * bütünüyle karta geçer), kartlının numarayı taşıyan adları. `count` o adın bu tedarikçideki bütün faturaları (aynı
 * adla vergi nosuz gelenler de adla birlikte geçer); `own` kartın adı ya da diğer adı (ad önce gelir, yerinde kalır).
 */
export interface TaxIndexEntry {
  slug: string;
  name: string;
  cardId: number | null;
  names: { name: string; count: number; own: boolean }[];
}

/**
 * Tedarikçi penceresinin vergi no ve ad önizlemesi için düz veri (sunucudan istemciye geçer; yalnız vergi nolu
 * tedarikçiler)
 */
export interface TaxIndex {
  /** Vergi no → onu taşıyan faturaların tedarikçileri */
  byTax: Record<string, TaxIndexEntry[]>;
  /** Vergi no → kartında bu numara yazılı tedarikçiler */
  cardTax: Record<string, { id: number; name: string }[]>;
  /**
   * Ad anahtarı → bu adla gelip vergi nosuyla bir kartta duran faturalar (ad o kartın adı ya da diğer adı değil):
   * ad başka bir karta yazılırsa ad önce geldiği için faturaları oraya geçer (nameMoves)
   */
  viaTax: Record<string, { cardId: number; card: string; name: string; count: number }[]>;
}

export function taxNameIndex(groups: readonly SupplierGroup<LedgerInvoice, CardNames & { taxNumber?: string | null }>[]): TaxIndex {
  const placeholder = supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME);
  const byTax: TaxIndex["byTax"] = {};
  const cardTax: TaxIndex["cardTax"] = {};
  const viaTax: TaxIndex["viaTax"] = {};
  for (const g of groups) {
    const own = new Set(g.card ? [g.card.name, ...g.card.aliases].map(supplierMatchKey) : []);
    // Ad anahtarı → yazılış, fatura sayısı ve taşıdığı vergi numaraları; Paraşüt'ün geçici adı sayılmaz (sonraki
    // eşitlemede gerçek adını alır)
    const byName = new Map<string, { name: string; count: number; taxes: Set<string> }>();
    for (const inv of g.invoices) {
      const k = supplierMatchKey(inv.supplier);
      if (k === placeholder) continue;
      const cur = byName.get(k) ?? { name: splitSupplier(inv.supplier).base.trim(), count: 0, taxes: new Set<string>() };
      cur.count++;
      const t = taxKey(inv.supplierTaxNumber);
      if (t) cur.taxes.add(t);
      byName.set(k, cur);
    }
    const taxes = new Set([...byName.values()].flatMap((n) => [...n.taxes]));
    for (const t of taxes) {
      const names = [...byName]
        .filter(([, n]) => !g.card || n.taxes.has(t))
        .map(([k, n]) => ({ name: n.name, count: n.count, own: own.has(k) }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"));
      (byTax[t] ??= []).push({ slug: g.slug, name: g.name, cardId: g.card?.id ?? null, names });
    }
    const ct = taxKey(g.card?.taxNumber);
    if (g.card && ct) (cardTax[ct] ??= []).push({ id: g.card.id, name: g.card.name });
    if (!g.card) continue;
    for (const [k, n] of byName) if (!own.has(k)) (viaTax[k] ??= []).push({ cardId: g.card.id, card: g.card.name, name: n.name, count: n.count });
  }
  return { byTax, cardTax, viaTax };
}

export interface TaxPreview {
  /** Bu tedarikçiye gelecek adlar ve faturaları */
  join: { names: { name: string; count: number }[]; count: number };
  /** Adı başka bir karta ait olduğu için faturaları orada kalan tedarikçiler (ad önce gelir) */
  stay: string[];
  /** Bu numara kartında da yazılı tedarikçiler: numara eşleşmede kullanılmaz */
  sharedCards: string[];
}

/**
 * Pencerede yazılan vergi no kaydedilirse ne olur: hangi adların faturaları bu tedarikçiye gelir (`join`), hangileri
 * adı başka bir tedarikçiye ait olduğu için orada kalır (`stay`, ad önce gelir), numara başka bir kartta da yazılı mı
 * (`sharedCards`: o zaman vergi noyla eşleşme ikisinde de çalışmaz). `self`: açık olan tedarikçi (yeni kartta ikisi
 * de null; kartsız tedarikçinin sayfasında adres parçası: onun faturaları adlarıyla zaten buraya gelir).
 */
export function taxPreview(index: TaxIndex, taxNumber: string, self: { cardId: number | null; slug: string | null }): TaxPreview {
  const out: TaxPreview = { join: { names: [], count: 0 }, stay: [], sharedCards: [] };
  const t = taxKey(taxNumber);
  if (!t) return out;
  out.sharedCards = (index.cardTax[t] ?? []).filter((c) => c.id !== self.cardId).map((c) => c.name);
  if (out.sharedCards.length) return out;
  for (const e of index.byTax[t] ?? []) {
    if ((self.cardId !== null && e.cardId === self.cardId) || (self.slug !== null && e.slug === self.slug)) continue;
    // Kartsız tedarikçinin bütün adları gelir; kartlının yalnız vergi noyla bağlanmış adları
    const moving = e.names.filter((n) => !n.own);
    if (moving.length < e.names.length) out.stay.push(e.name);
    for (const n of moving) {
      out.join.names.push({ name: n.name, count: n.count });
      out.join.count += n.count;
    }
  }
  out.join.names.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"));
  return out;
}

const quoted = (names: readonly string[]) => names.map((n) => `“${n}”`).join(", ");

/** Vergi no alanının altındaki önizleme cümleleri (Düzenle / Tedarikçi ekle penceresi) */
export function taxPreviewLines(p: TaxPreview): string[] {
  if (p.sharedCards.length) {
    const many = p.sharedCards.length > 1;
    return [
      `Bu vergi no ${quoted(p.sharedCards)} ${many ? "tedarikçilerinde" : "tedarikçisinde"} de kayıtlı: vergi noyla eşleşme ${many ? "hiçbirinde" : "ikisinde de"} çalışmaz, faturalar adlarına göre ayrılır.`,
    ];
  }
  const out: string[] = [];
  if (p.join.count) {
    out.push(`Bu vergi noyla gelen ${p.join.count} fatura da bu tedarikçide toplanır: ${p.join.names.map((n) => `${n.name} (${n.count})`).join(", ")}.`);
  }
  if (p.stay.length) out.push(`${quoted(p.stay)} adıyla eşleşen faturalar orada kalır (ad önce gelir).`);
  return out;
}

/** Adlar bir karta yazılınca başka kartlardan o karta geçecek faturalar */
export interface NameMoves {
  /** Faturalardaki yazılışıyla adlar ve fatura sayıları */
  names: { name: string; count: number }[];
  /** Faturaların şimdi durduğu kartlar */
  cards: string[];
  count: number;
}

/**
 * Bu adlar bir kartın adı ya da diğer adı olursa (kart kaydı; kartsız tedarikçi listeden kaldırılırken onun adıyla
 * açılan kart) hangi faturalar başka kartlardan ona geçer: o adla gelip vergi nosuyla bir kartta duranlar, çünkü ad
 * önce gelir. Vergi no önizlemesi bunu göstermez (numara yazılmadan da olur). `cardId`: adların yazılacağı kart
 * (kendi faturaları sayılmaz; yeni kartta ve kartsız tedarikçide null). Kartsız tedarikçinin adı ancak iki kartı
 * bağlayan numarada (supplierResolver 3. adımdaki çakışma) başka kartlarda da durur: aynı adın vergi nolu faturaları
 * iki ayrı kartta, vergi nosuzu kendi adının grubunda.
 */
export function nameMoves(index: TaxIndex, names: readonly string[], cardId: number | null): NameMoves {
  const out: NameMoves = { names: [], cards: [], count: 0 };
  const cards = new Set<string>();
  for (const k of new Set(names.map(supplierMatchKey))) {
    const from = k ? (index.viaTax[k] ?? []).filter((e) => e.cardId !== cardId) : [];
    if (!from.length) continue;
    const count = from.reduce((a, e) => a + e.count, 0);
    out.names.push({ name: from[0].name, count });
    out.count += count;
    for (const e of from) cards.add(e.card);
  }
  out.names.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "tr"));
  out.cards = [...cards].sort((a, b) => a.localeCompare(b, "tr"));
  return out;
}

const fromCards = (cards: readonly string[], one: string, many: string) => `${quoted(cards)} ${cards.length > 1 ? many : one}`;

/** Ad önizlemesinin cümlesi (Düzenle / Tedarikçi ekle penceresi): başka kartlardan bu tedarikçiye geçecek faturalar */
export function nameMoveLines(m: NameMoves): string[] {
  if (!m.count) return [];
  const names = `${quoted(m.names.map((n) => n.name))} ${m.names.length > 1 ? "adlarıyla" : "adıyla"}`;
  return [`${names} gelen ${m.count} fatura ${fromCards(m.cards, "tedarikçisinden", "tedarikçilerinden")} bu tedarikçiye geçer (ad önce gelir).`];
}

/**
 * Kartsız tedarikçi neden listeden kaldırılamaz: kaldırmak onun adıyla (gizli) bir kart açar, ad önce geldiği için
 * o adla gelip vergi nosuyla başka kartlarda duran faturalar da o karta geçerdi (nameMoves). Silme penceresi ve
 * sunucu aynı cümleyi söyler; `here` sayfadaki fatura sayısı. Kartsız tedarikçiye ilk cari kaydı da aynı kartı açar
 * (ensureCard): `when` o durumda "bu tedarikçiye borç ya da ödeme girilse".
 */
export function nameMoveBlock(name: string, m: NameMoves, here: number, when = "bu tedarikçi listeden kaldırılsa"): string {
  const many = m.count > 1;
  return (
    `“${name}” adıyla gelen ${m.count} fatura daha vergi ${many ? "nolarıyla" : "nosuyla"} ${fromCards(m.cards, "tedarikçisinde", "tedarikçilerinde")} duruyor; ` +
    `${when} ${many ? "onlar" : "o"} da buraya geçerdi. Buradaki ${here > 1 ? "faturaların" : "faturanın"} tedarikçi adını Faturalar'dan doğru firmanın adıyla değiştirin.`
  );
}

/** Tedarikçi sayfasındaki aynı vergi no şeridi: bir satır, öteki tedarikçinin sayfasına bağlantıyla */
export interface TaxNote {
  slug: string;
  text: string;
}

/**
 * Aynı vergi nosunu taşıyan öteki tedarikçiler için sayfanın üstündeki notlar (öteki tedarikçi başına bir not; ilk
 * ortak numarayla). Birleştirme yok: not ne yapılabileceğini söyler. Faturası olan kart silinince listeden kalkar
 * ama adını tutar; adı öteki kartın diğer adlarına bu yüzden ancak faturasız kart silinince eklenebilir, ikisi de
 * faturalıysa not yalnız bilgi verir.
 */
export function sharedTaxNotes(here: { hasCard: boolean; count: number; names: readonly string[] }, shared: readonly SharedTax[]): TaxNote[] {
  const seen = new Set<string>();
  const out: TaxNote[] = [];
  for (const { taxNumber, others } of shared) {
    for (const o of others) {
      if (seen.has(o.slug)) continue;
      seen.add(o.slug);
      let text: string;
      if (o.cardId === null) {
        text = `“${o.name}” adıyla gelen faturalarda da bu vergi no (${taxNumber}) var. Aynı firmaysa Düzenle'den diğer adlara ekleyin.`;
      } else if (!here.hasCard) {
        const these = here.names.length > 1 ? "bu adları" : "bu adı";
        text = `“${o.name}” tedarikçisi de aynı vergi nosunu (${taxNumber}) taşıyor; faturaları ayrı duruyor. Aynı firmaysa onun sayfasında Düzenle'den ${these} diğer adlara ekleyin.`;
      } else {
        const advice = !o.count
          ? " Aynı firmaysa o tedarikçiyi Düzenle'den silip adını buradaki ‘Diğer adlar’a ekleyin."
          : !here.count
            ? " Aynı firmaysa bu tedarikçiyi Düzenle'den silip adını onun ‘Diğer adlar’ına ekleyin."
            : "";
        text = `“${o.name}” tedarikçisi de aynı vergi nosunu (${taxNumber}) taşıyor; faturaları ayrı duruyor.${advice}`;
      }
      out.push({ slug: o.slug, text });
    }
  }
  return out;
}

/**
 * Listede adın altında yazan, vergi noyla aynı tedarikçide toplanan öteki adlar: kartlıda yalnız vergi noyla gelen
 * adlar, kartsızda görünen addan başka bütün adlar (kartsız grupta birden çok ad ancak vergi noyla olur)
 */
export function sameTaxNames(g: Pick<SupplierGroup, "name" | "names" | "viaTax"> & { card: unknown }): string[] {
  if (!g.viaTax.length) return [];
  return g.card ? g.viaTax.filter((n) => n !== g.name) : g.names.filter((n) => n !== g.name);
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
/**
 * Listeden kaldırılmış tedarikçi listede gizli mi: kaldırıldığı günden sonraki tarihli faturası gelmediyse ve
 * ödenmemiş faturası yoksa. Borç listeden gizlenmez; yeni fatura tedarikçiyi listeye kendiliğinden geri getirir.
 * Cari hesap (K23): açık kalemi (faturasız alım dahil), hesapta sayılmamış parası ya da kaldırıldığı günden sonra
 * tarihli kaydı olan tedarikçi de listeye döner.
 */
export function isHiddenSupplier(
  card: { hiddenOn: string | null } | null,
  summary: Pick<SupplierSummary, "openCount" | "lastInvoice">,
  cari?: { openCount: number; credit: number; lastEntry?: string | null } | null,
): boolean {
  if (!card?.hiddenOn) return false;
  if (cari && (cari.openCount > 0 || cari.credit > 0.005 || (cari.lastEntry && cari.lastEntry > card.hiddenOn))) return false;
  return summary.openCount === 0 && !(summary.lastInvoice && summary.lastInvoice > card.hiddenOn);
}

/** Listeden kaldırılmış tedarikçi (listenin altındaki "Listeden kaldırılanlar") */
export interface HiddenSupplierRow {
  cardId: number;
  slug: string;
  name: string;
  hiddenOn: string;
  /** Fatura sayısı */
  count: number;
}

export interface SupplierListRow {
  key: string;
  slug: string;
  name: string;
  names: string[];
  /** Satırda adın altında: aynı vergi noyla bu tedarikçide toplanan öteki adlar (yoksa boş) */
  sameTaxNames: string[];
  hasCard: boolean;
  legalName: string | null;
  /** Kartta yazılı, yoksa faturalardaki tek vergi no */
  taxNumber: string | null;
  /** Faturalardaki vergi numaraları (aramada) */
  taxNumbers: string[];
  iban: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  paidOnDelivery: boolean;
  missing: MissingInfo[];
  /** Paraşüt'te ödenmiş görünen ama panelde ödenmedi duran fatura sayısı */
  parasutPaid: number;
  /** Hesap özeti; cari kaydı olan tedarikçide `open` bakiyedir (açık − hesaptaki para) */
  summary: SupplierSummary;
  /** Hesapta sayılmamış ödeme (cari) */
  credit?: number;
  /** Açık faturasız alım sayısı (cari) */
  debtOpenCount?: number;
  /** Kasadan bu tedarikçiye çıkan, hesaba işlenmemiş satır sayısı */
  kasaPending?: number;
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
export function matchesSupplierFilter(r: Pick<SupplierListRow, "summary" | "missing" | "hasCard"> & { credit?: number }, f: SupplierFilter): boolean {
  // Hesaptaki para borcu karşılıyorsa borçlu sayılmaz (bakiye ≤ 0); para yokken bugünkü kural
  if (f === "borclu") return r.summary.openCount > 0 && !((r.credit ?? 0) > 0.005 && r.summary.open <= 0.005);
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

/** Aramada taranan metin: adlar, unvan, vergi no (kartta ve faturalarda), IBAN (boşluklu ve boşluksuz), telefon, yetkili, e-posta */
export function supplierHaystack(
  r: Pick<SupplierListRow, "name" | "names" | "legalName" | "taxNumber" | "iban" | "phone" | "contactName" | "email"> & { taxNumbers?: readonly string[] },
): string {
  return [r.name, ...r.names, r.legalName, r.taxNumber, ...(r.taxNumbers ?? []), r.iban, r.iban ? formatIban(r.iban) : null, r.phone, r.contactName, r.email]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------- Kart bilgilerinin denetimi

export type MissingInfo = "iban" | "vergi" | "iletisim";

export const MISSING_LABEL: Record<MissingInfo, string> = { iban: "IBAN yok", vergi: "Vergi no yok", iletisim: "Telefon / e-posta yok" };

/**
 * Kartta eksik olan önemli bilgiler: ödeme için IBAN (peşin çalışılan tedarikçide aranmaz), cari için vergi no
 * (faturalardan tek bir vergi no biliniyorsa eksik sayılmaz: `inferredTaxNumber`), ulaşmak için telefon ya da
 * e-posta. Kart hiç yoksa (faturalardaki vergi no dışında) hepsi eksiktir.
 */
export function missingInfo(card: Pick<SupplierCard, "iban" | "taxNumber" | "phone" | "email" | "paidOnDelivery"> | null, inferredTaxNumber?: string | null): MissingInfo[] {
  const out: MissingInfo[] = [];
  if (!card?.iban && !card?.paidOnDelivery) out.push("iban");
  if (!card?.taxNumber && !inferredTaxNumber) out.push("vergi");
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
  /** Kartta vergi no yoksa faturalardaki (tek) vergi no; kartsız tedarikçide de yazılır */
  taxNumber?: string | null;
  /** Ödenecek faturalar; eksi tutarlılar ödemeden düşülen iade faturaları */
  lines: readonly RequestLine[];
  /** Faturasız alımlar (cari borç; kalanları) */
  purchases?: readonly { date: string; description: string | null; amount: number }[];
  /** Tedarikçinin hesabında duran, tutardan düşülen ödeme */
  accountCredit?: number;
  note?: string | null;
}): string {
  const { card, lines } = opts;
  const debts = lines.filter((l) => l.amount > 0);
  const credits = lines.filter((l) => l.amount < 0);
  const purchases = opts.purchases ?? [];
  const accountCredit = round2(Math.max(0, opts.accountCredit ?? 0));
  const total = round2(lines.reduce((a, l) => a + l.amount, 0) + purchases.reduce((a, l) => a + l.amount, 0) - accountCredit);
  const recipient = card?.accountHolder?.trim() || card?.legalName?.trim() || opts.name;
  const bank = card?.bankName?.trim() || bankFromIban(card?.iban);
  const credit = round2(credits.reduce((a, l) => a - l.amount, 0));
  const taxNumber = card?.taxNumber || opts.taxNumber;
  const out = [
    opts.payer ? `Ödeme talebi · ${opts.payer}` : "Ödeme talebi",
    `Alıcı: ${recipient}`,
    card?.iban ? `IBAN: ${formatIban(card.iban)}` : "IBAN: (girilmemiş)",
    bank ? `Banka: ${bank}` : null,
    taxNumber ? `Vergi no: ${normalizeTaxNumber(taxNumber)}` : null,
    `Tutar: ${money(total)}${credits.length && !purchases.length && !accountCredit ? ` (faturalar ${money(round2(total + credit))} − iade ${money(credit)})` : ""}`,
    debts.length ? `Açıklama: ${transferNote(debts)}` : purchases.length ? `Açıklama: ${purchases.length} faturasız alım` : null,
  ].filter((x): x is string => Boolean(x));
  const byDate = (list: readonly RequestLine[]) => [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (debts.length) {
    out.push("", `Faturalar (${debts.length}):`);
    for (const l of byDate(debts)) {
      out.push(`• ${dateTR(l.date)}${l.invoiceNo ? ` · ${l.invoiceNo}` : ""} · ${money(l.amount)}${l.dueDate ? ` · vade ${dateTR(l.dueDate)}` : ""}`);
    }
  }
  if (purchases.length) {
    out.push("", `Faturasız alımlar (${purchases.length}):`);
    for (const l of [...purchases].sort((a, b) => a.date.localeCompare(b.date))) out.push(`• ${dateTR(l.date)} · Faturasız alım${l.description ? ` (${l.description})` : ""} · ${money(l.amount)}`);
  }
  if (credits.length) {
    out.push("", `Düşülen iadeler (${credits.length}):`);
    for (const l of byDate(credits)) out.push(`• ${dateTR(l.date)}${l.invoiceNo ? ` · ${l.invoiceNo}` : ""} · −${money(-l.amount)}`);
  }
  if (accountCredit > 0.005) out.push("", `Hesaptaki ödeme: −${money(accountCredit)}`);
  const note = opts.note?.trim();
  if (note) out.push("", note);
  // Tutarlardaki bölünmez boşluk (tl) düz metinde de doğru görünür; WhatsApp ve e-posta olduğu gibi gösterir
  return out.join("\n");
}

/** "Geçmiş faturaları al"ın sonucu (src/server/actions/suppliers.ts importSupplierHistory) */
export interface HistoryResult {
  fetched: number;
  created: number;
  removed: number;
  oldest: string | null;
  /** Süre doldu */
  partial: boolean;
  resumed: boolean;
  /** Yazılamayan fatura (eski faturası Paraşüt'e sorulamadı) ve yeniden basınca denenip denenmeyeceği */
  deferred: number;
  held: boolean;
  added: readonly string[];
  elsewhere: readonly string[];
}

/**
 * "Geçmiş faturaları al"ın bildirimi: başlık, açıklama ve uzun kalıp kalmayacağı. "Süre doldu" yalnız süre gerçekten
 * dolunca; yazılamayan faturalar sayısıyla ve ne zaman yeniden deneneceğiyle söylenir (kalınan yer onlarda kaldıysa
 * yeniden basınca, kalmadıysa sonraki tam okumada).
 */
export function historyNotice(d: HistoryResult): { title: string; description: string; long: boolean } {
  const parts = [
    `Paraşüt'te ${num(d.fetched)} fatura okundu.`,
    d.oldest ? `En eski fatura ${dateTR(d.oldest)}.` : null,
    d.removed ? `${num(d.removed)} fatura Paraşüt'te iptal edildiği için kaldırıldı.` : null,
    d.added.length ? `Paraşüt'teki adı (${d.added.join(", ")}) diğer adlara eklendi.` : null,
    d.elsewhere.length ? `“${d.elsewhere.join("”, “")}” adıyla gelenler başka bir tedarikçide görünür; aynı firmaysa Düzenle'den diğer adlara ekleyin.` : null,
    d.deferred
      ? `${num(d.deferred)} fatura yazılamadı (eski faturası Paraşüt'e sorulamadı); ${d.held ? "düğmeye yeniden basınca denenir" : "sonraki tam okumada denenir"}.`
      : null,
    d.partial ? "Süre doldu: kalanı için düğmeye yeniden basın." : null,
  ].filter(Boolean);
  const title = d.created
    ? `${num(d.created)} eski fatura eklendi`
    : d.partial || d.held
      ? "Okuma sürüyor"
      : d.deferred
        ? "Okuma bitti"
        : d.fetched || d.resumed
          ? "Yeni fatura yok: hepsi zaten panelde"
          : "Paraşüt'te bu tedarikçinin faturası yok";
  return { title, description: parts.join(" "), long: d.partial || d.deferred > 0 || d.elsewhere.length > 0 };
}
