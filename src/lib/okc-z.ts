/**
 * Yazarkasanın (banka POS, yeni nesil ÖKC) mali Z raporunun saf denetimleri (dalga 13 PR-b, docs/planlar/okc-z.md §5,
 * §8, §9; tests/okc-z.test.ts). Okuma (src/lib/photo-read/okc.ts) ve form (canlı denetim) aynı fonksiyonları kullanır.
 * `server-only` yok, istemciye girer.
 *
 * İlke (plan §0.1, D7): model yalnız aktarır, hesap burada. Bir kimlik bir alanı ancak iki tarafı **farklı basılı
 * rakamlardan** geliyorsa doğrular: tek oranlı günde K1 / K2, tek ödemeli günde K4 aynı rakamın kopyalarını
 * karşılaştırır ve yalnız "çelişki yok" verir. K3 (KDV formülü) payı fiş sayısıyla büyüdüğü için hiçbir alanı
 * doğrulamaz, yalnız çürütür. Bir alan önce "tutmadı" (herhangi bir kimlikte), sonra "doğrulandı", yoksa
 * "denetlenemedi"dir. Kimliğin bir ucu okunmamışsa kimlik çalışmaz.
 *
 * Personele giden metinlerde jargon yok (kümülatif, zincir, KÜM., MATRAH; D16); ayrıntılı metinler yalnız yöneticiye.
 * Kümülatif zinciri (K6) ancak çağıran önceki saklanan kümülatifi verirse çalışır: adım 0 KÜM. satırlarının basıldığını
 * ve bu Z'yi içerdiğini doğrulamazsa çağıran onu vermez (plan §1 adım 0 madde 1).
 */

import { money, numPossessive } from "./format";
import { dayMonthTR } from "./reminders";

/**
 * Yazarkasa Z okuması forma kendiliğinden yazılsın mı (sahibin kararı bekleniyor): gerçek fotoğraflarla canlı
 * değerlendirme (plan §10, §17 b2 / b8: yanlış dolum 0, "doğrulandı ama yanlış" 0) geçene kadar kapalı. Kapalıyken
 * okunan her rakam öneri olarak gösterilir (`prefillPlan` → `unsure`, "Fotoğraftakini yaz"); hiçbir alan dolmaz.
 * Açmak bu sabiti `true` yapmaktır (tests/okc-z.test.ts ikisini de sınar)
 */
export const OKC_PREFILL_ENABLED: boolean = false;

/** Doldurma kapalıyken önerinin nedeni (personele) */
export const OKC_SUGGEST_TEXT = "Fotoğraftan okundu; fişle karşılaştırıp yazın.";

/** Toplamlar kuruşa kadar toplanır: 0,05 ₺ pay */
export const SUM_TOL = 0.05;

/** KDV fiş fiş yuvarlanır: pay fiş sayısıyla büyür (fiş sayısı yoksa 1 ₺) */
export function vatTol(receipts: number | null | undefined): number {
  return receipts === null || receipts === undefined || !Number.isFinite(receipts) || receipts < 0 ? 1 : Math.max(SUM_TOL, 0.005 * receipts);
}

/** Bugünkü KDV oranları (alanı olanlar) ve eski oranlar (tutar basılmamalı) */
export const OKC_RATES = [1, 10, 20] as const;
export type OkcRate = (typeof OKC_RATES)[number];
const OLD_RATES = [8, 18];
/** KDV dökümünde kabul edilen oranlar: bugünküler, eskiler (%8, %18; tutar basılmamalı) ve %0 */
export const OKC_KNOWN_RATES: readonly number[] = [0, 1, 8, 10, 18, 20];
const KNOWN_RATES = new Set(OKC_KNOWN_RATES);

/** Yazarkasa alanları (ModPOS anahtarlarından ayrı: çapraz karşılaştırma olmaz) */
export type OkcField =
  | "okcZNo"
  | "okcReceipts"
  | "okcTotal"
  | "okcVatTotal"
  | "okcCash"
  | "okcCard"
  | "okcMealCard"
  | "okcOther"
  | "okcT1"
  | "okcV1"
  | "okcT10"
  | "okcV10"
  | "okcT20"
  | "okcV20";

export const OKC_FIELDS: readonly OkcField[] = ["okcZNo", "okcReceipts", "okcTotal", "okcVatTotal", "okcCash", "okcCard", "okcMealCard", "okcOther", "okcT1", "okcV1", "okcT10", "okcV10", "okcT20", "okcV20"];

/** Alanların adı (formdaki etiketlerle aynı sözcükler) */
export const OKC_FIELD_LABELS: Record<OkcField, string> = {
  okcZNo: "Yazarkasa Z no",
  okcReceipts: "Yazarkasa fiş sayısı",
  okcTotal: "Günlük toplam",
  okcVatTotal: "Toplam KDV",
  okcCash: "Yazarkasa nakit",
  okcCard: "Yazarkasa kredi kartı",
  okcMealCard: "Yazarkasa yemek kartı",
  okcOther: "Yazarkasa diğer",
  okcT1: "%1 toplam",
  okcV1: "%1 KDV",
  okcT10: "%10 toplam",
  okcV10: "%10 KDV",
  okcT20: "%20 toplam",
  okcV20: "%20 KDV",
};

const totalField = (rate: number): OkcField | null => (OKC_RATES.includes(rate as OkcRate) ? (`okcT${rate}` as OkcField) : null);
const vatField = (rate: number): OkcField | null => (OKC_RATES.includes(rate as OkcRate) ? (`okcV${rate}` as OkcField) : null);

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => `%${Math.round(v * 100)}`;

/** Bir oranın KDV dökümü (KDV dahil toplam ve KDV; MATRAH yalnız basılıysa) */
export interface OkcVatGroup {
  rate: number;
  total: number | null;
  vat: number | null;
  base?: number | null;
}

/** Saklanan döküm satırı (`cash_reports.okc_vat`): sıfır gruplar yazılmaz, orana göre sıralı */
export interface OkcVatLine {
  rate: number;
  total: number;
  vat: number;
}

/** Kimliklerin girdisi: okumadan ya da formdan gelen rakamlar (null = okunmadı / yazılmadı) */
export interface OkcFigures {
  zNo: string | null;
  receipts: number | null;
  total: number | null;
  vatTotal: number | null;
  /** Sıfır olmayan oran grupları (sıfır gruplar verilmez) */
  groups: OkcVatGroup[];
  cash: number | null;
  card: number | null;
  /** Boş: 0 sayılır (isteğe bağlı alanlar) */
  mealCard: number | null;
  other: number | null;
  /** Yazarkasa toplamı dışındaki tahsilat (faturalı satış, bilgi fişi…); yalnız okumada */
  outside?: number | null;
  /**
   * Personelin formu ve kayıtlı raporu: sunucu Z'de toplam dışı tahsilat gördü, tutarı verilmez (D16, D17). K4'te
   * ödemelerin günlük toplamdan fazlası tutmadı sayılmaz (fazlası o tahsilat olabilir)
   */
  extraTakings?: boolean;
  /** Kart satırı varken altındaki banka satırlarının toplamı (K7); yalnız okumada */
  bankSublines?: number | null;
  /** Fişteki kümülatif (yalnız okumada; formda yoktur, D17) */
  cumTotal?: number | null;
  cumVat?: number | null;
  /** Günlük toplamın yanında basılı etiket (GENEL TOPLAM kuralı) */
  totalLabel?: string | null;
}

/** Önceki yazarkasa Z'si (plan §5.3): `z` personelin formuna da gider, `cum` yalnız sunucuda */
export interface OkcPrev {
  z: { date: string; zNo: string } | null;
  cum?: { date: string; zNo: string; cumTotal: number; cumVat: number | null } | null;
}

export interface OkcContext {
  /** Raporun iş günü (YYYY-MM-DD) */
  day: string;
  prev: OkcPrev;
  /** Son 28 günün yazarkasa toplamları (yoksa ModPOS toplamları): büyüklük denetimi (§5.1) */
  recentTotals?: number[];
}

export type OkcStatus = "confirmed" | "failed";

/** Bir denetimin sonucu (yöneticiye ayrıntılı metin) */
export interface OkcCheck {
  key: string;
  level: "warn" | "info";
  /** Yönetici metni (§5.2 tablosunun "Metin" sütunu) */
  text: string;
  /** Turuncu olacak (tutmadı ya da uyarı alan) alanlar */
  fields: OkcField[];
  /** Okumanın bütününü durdurur (aynı Z no): hiçbir alan yazılmaz */
  whole?: boolean;
  /** Personele de gösterilir (işlemsel bilgi; en çok iki satır) */
  staff?: string;
}

export interface OkcCheckResult {
  status: Partial<Record<OkcField, OkcStatus>>;
  /** Alan başına tek, sade neden (personel; tutmayan ya da uyarı alan alan) */
  reasons: Partial<Record<OkcField, string>>;
  checks: OkcCheck[];
  /** Okumanın bütünü durdu (aynı Z no) */
  stopped: boolean;
}

const nz = (v: number | null | undefined) => v !== null && v !== undefined && Math.abs(v) >= 0.005;
const isNum = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Z no metni sayıya (baştaki sıfırlar ve boşluklar sayılmaz); yalnız rakamsa */
export function zNoNumber(s: string | null | undefined): number | null {
  const t = (s ?? "").trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

/** Ortanca */
function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** "GENEL TOPLAM" bazı cihazlarda kümülatif toplamdır (araştırma notları §5): yalnız doğrulanırsa kabul */
const GENERAL_TOTAL = /GENEL\s*TOPLAM/i;

/**
 * Kimlikler K1–K9, büyüklük, kümülatif eşitliği, Z no sürekliliği (plan §5.1–§5.3). Önce doğrulayan kimlikler
 * (iki ayrı basılı rakam), sonra çürütenler; "tutmadı" her zaman "doğrulandı"nın önüne geçer.
 */
export function okcChecks(fig: OkcFigures, ctx: Omit<OkcContext, "day"> & { day?: string }): OkcCheckResult {
  const confirmed = new Set<OkcField>();
  const failed = new Set<OkcField>();
  /** Başka bir kimlik doğrulamadıysa tutmadı sayılacaklar (ikinci geçişte) */
  const failedUnlessConfirmed = new Set<OkcField>();
  const reasons: Partial<Record<OkcField, string>> = {};
  const checks: OkcCheck[] = [];
  const reason = (fields: OkcField[], text: string, override = false) => {
    for (const f of fields) if (override || !reasons[f]) reasons[f] = text;
  };
  /** `override`: bu neden alanın öteki nedenlerinden daha açıklayıcı (büyüklük, kümülatif eşitliği) */
  const fail = (fields: OkcField[], staff: string, override = false) => {
    for (const f of fields) failed.add(f);
    reason(fields, staff, override);
  };
  const failSoft = (fields: OkcField[], staff: string) => {
    for (const f of fields) failedUnlessConfirmed.add(f);
    reason(fields, staff);
  };

  const groups = fig.groups.filter((g) => nz(g.total) || nz(g.vat));
  const groupTotalFields = groups.map((g) => totalField(g.rate)).filter((f): f is OkcField => f !== null);
  const groupVatFields = groups.map((g) => vatField(g.rate)).filter((f): f is OkcField => f !== null);
  const vTol = vatTol(fig.receipts);

  // K1: Σ oran toplamları = günlük toplam (yalnız sıfır olmayan ≥ 2 oran grubuyla doğrular)
  if (isNum(fig.total) && groups.length && groups.every((g) => isNum(g.total))) {
    const sum = r2(groups.reduce((a, g) => a + g.total!, 0));
    const diff = r2(sum - fig.total);
    if (Math.abs(diff) <= SUM_TOL) {
      if (groups.filter((g) => nz(g.total)).length >= 2) for (const f of ["okcTotal" as const, ...groupTotalFields]) confirmed.add(f);
    } else {
      const staff = `Oranların toplamı günlük toplamı tutmuyor (${money(Math.abs(diff))} fark).`;
      fail(groupTotalFields, staff);
      failSoft(["okcTotal"], staff);
      checks.push({ key: "k1", level: "warn", fields: [...groupTotalFields, "okcTotal"], text: `Oranların toplamı (${money(sum)}) günlük toplamı (${money(fig.total)}) tutmuyor; fişe bakın.` });
    }
  }

  // K2: Σ oran KDV'leri = toplam KDV (yalnız KDV'si sıfır olmayan ≥ 2 oran grubuyla doğrular)
  let k2Failed = false;
  if (isNum(fig.vatTotal) && groups.length && groups.every((g) => isNum(g.vat))) {
    const sum = r2(groups.reduce((a, g) => a + g.vat!, 0));
    const diff = r2(sum - fig.vatTotal);
    if (Math.abs(diff) <= SUM_TOL) {
      if (groups.filter((g) => nz(g.vat)).length >= 2) for (const f of ["okcVatTotal" as const, ...groupVatFields]) confirmed.add(f);
    } else {
      k2Failed = true;
      const staff = `Oranların KDV'si toplam KDV'yi tutmuyor (${money(Math.abs(diff))} fark).`;
      fail(groupVatFields, staff);
      checks.push({ key: "k2", level: "warn", fields: [...groupVatFields, "okcVatTotal"], text: `Oranların KDV'si (${money(sum)}) toplam KDV'yi (${money(fig.vatTotal)}) tutmuyor; fişe bakın.` });
    }
  }

  // K4: Σ ödemeler = günlük toplam (ya da + yazarkasa dışı tahsilat); yalnız sıfır olmayan ≥ 2 ödeme türüyle doğrular
  // Nakit ve kart her zaman; yemek kartı ve diğer yalnız tutarı varsa (boş isteğe bağlı alan turuncu olmaz)
  const payFields: OkcField[] = [];
  if (isNum(fig.cash)) payFields.push("okcCash");
  if (isNum(fig.card)) payFields.push("okcCard");
  if (nz(fig.mealCard)) payFields.push("okcMealCard");
  if (nz(fig.other)) payFields.push("okcOther");
  if (isNum(fig.total) && isNum(fig.cash) && isNum(fig.card)) {
    const pays = [fig.cash, fig.card, fig.mealCard ?? 0, fig.other ?? 0];
    const sum = r2(pays.reduce((a, v) => a + v, 0));
    const diff = r2(sum - fig.total);
    const outside = isNum(fig.outside) ? fig.outside : 0;
    const held = Math.abs(diff) <= SUM_TOL || (outside > 0 && Math.abs(r2(diff - outside)) <= SUM_TOL);
    // Tutarı bilinmeyen toplam dışı tahsilat (personel): fazlası tutmadı sayılmaz, doğrulamaz da
    const unknownOutside = !held && diff > 0 && outside === 0 && fig.extraTakings === true;
    if (held) {
      if (pays.filter(nz).length >= 2) for (const f of ["okcTotal" as const, ...payFields]) confirmed.add(f);
    } else if (!unknownOutside) {
      // Personelin metninde fazlanın tutarı yok: toplam dışı tahsilatın tutarı olabilir (yalnız yöneticiye, D16, D17)
      const staff =
        diff < 0
          ? `Nakit, kart ve öteki ödemeler toplanınca günlük toplam çıkmıyor (${money(Math.abs(diff))} az).`
          : "Nakit, kart ve öteki ödemeler toplanınca günlük toplamdan fazla çıkıyor; fişle karşılaştırın.";
      fail(payFields, staff);
      failSoft(["okcTotal"], staff);
      checks.push({ key: "k4", level: "warn", fields: [...payFields, "okcTotal"], text: `Ödemelerin toplamı (${money(sum)}) günlük toplamı (${money(fig.total)}) tutmuyor; fişe bakın.` });
    }
  }

  // Z no sürekliliği (§5.3): önceki + 1 doğrular; aynı Z no okumanın bütününü durdurur
  let stopped = false;
  const cur = zNoNumber(fig.zNo);
  const cum = ctx.prev.cum ?? null;
  const cumNo = cum ? zNoNumber(cum.zNo) : null;
  // Okunan kümülatif son saklanandan küçük: cihaz değişmiş ya da Z sayacı sıfırlanmış (EKÜ / mali hafıza), yeni zincir
  const cumBelow = cum !== null && isNum(fig.cumTotal) && fig.cumTotal < cum.cumTotal - SUM_TOL;
  const prevZ = ctx.prev.z;
  const prevNo = prevZ ? zNoNumber(prevZ.zNo) : null;
  if (cur !== null && prevZ && prevNo !== null) {
    const shownPrev = prevZ.zNo.trim();
    const shownCur = (fig.zNo ?? "").trim();
    if (cur === prevNo + 1) confirmed.add("okcZNo");
    else if (cur > prevNo + 1) {
      const gap = cur - prevNo - 1;
      const yesterday = ctx.day ? dayBefore(ctx.day) === prevZ.date : false;
      const base = `Önceki yazarkasa Z'si ${shownPrev} (${dayMonthTR(prevZ.date)}); bu ${shownCur}.`;
      checks.push({
        key: "zno-gap",
        level: yesterday ? "warn" : "info",
        fields: yesterday ? ["okcZNo"] : [],
        text: yesterday ? `${base} Bir günde iki Z alınmış ya da Z no yanlış okunmuş olabilir.` : `${base} Arada ${gap} Z raporu girilmemiş.`,
        staff: `Önceki Z ${shownPrev}; bu ${shownCur}. Arada bir Z raporu girilmemiş olabilir.`,
      });
      if (yesterday) reason(["okcZNo"], `Önceki Z ${shownPrev}; bu ${shownCur}. Z no'yu fişle karşılaştırın.`);
    } else if (cur === prevNo) {
      stopped = true;
      const text = `Bu Z no (${shownCur}) ${dayMonthTR(prevZ.date)} raporunda da var; dünkü Z raporu olabilir.`;
      checks.push({ key: "zno-same", level: "warn", fields: [], whole: true, text, staff: text });
    } else if (cumBelow) {
      // Kümülatif de küçük: yeni cihaz / sıfırlanan sayaç (yalnız bilgi; Z no tutmadı sayılmaz)
      checks.push({ key: "zno-reset", level: "info", fields: [], text: `Z no (${shownCur}) önceki yazarkasa Z'sinden (${shownPrev}) küçük ve kümülatif de önceki saklanandan küçük; yeni cihaz ya da sıfırlanmış sayaç olabilir.` });
    } else {
      fail(["okcZNo"], `Z no (${shownCur}) önceki Z'den (${shownPrev}) büyük olmalı.`);
      checks.push({ key: "zno-low", level: "warn", fields: ["okcZNo"], text: `Z no (${shownCur}) önceki yazarkasa Z'sinden (${shownPrev}) küçük; eski bir Z raporu ya da FİŞ NO / EKÜ NO okunmuş olabilir.` });
    }
  }

  // K6: kümülatif zinciri (yalnız önceki saklanan kümülatif verildiyse; §5.3 farkı ona göre alır)
  if (cum && cumNo !== null && cur !== null && cur > cumNo && isNum(fig.cumTotal) && isNum(fig.total)) {
    const delta = r2(fig.cumTotal - cum.cumTotal);
    const next = cur === cumNo + 1;
    const staff = "Günlük toplam fişteki öteki rakamlarla tutmuyor; fişe bakın.";
    if (next && Math.abs(r2(delta - fig.total)) <= SUM_TOL) {
      confirmed.add("okcTotal");
      confirmed.add("okcZNo");
      checks.push({ key: "k6-held", level: "info", fields: [], text: `Önceki Z'yle (${cum.zNo.trim()}, ${dayMonthTR(cum.date)}) kümülatif zinciri tutuyor.` });
      if (isNum(fig.cumVat) && isNum(cum.cumVat) && isNum(fig.vatTotal)) {
        const dv = r2(fig.cumVat - cum.cumVat);
        if (Math.abs(r2(dv - fig.vatTotal)) <= SUM_TOL) confirmed.add("okcVatTotal");
        else {
          failSoft(["okcVatTotal"], "Toplam KDV fişteki öteki rakamlarla tutmuyor; fişe bakın.");
          checks.push({ key: "k6-vat", level: "warn", fields: ["okcVatTotal"], text: `Önceki Z'den (${cum.zNo.trim()}) bu yana kümülatif KDV artışı ${money(dv)}; toplam KDV ${money(fig.vatTotal)}. Biri yanlış okunmuş olabilir.` });
        }
      }
    } else if (next || delta < fig.total - SUM_TOL) {
      // +1'de fark tutmalı; aralıkta (girilmemiş Z'ler) kümülatif en az günlük toplam kadar büyümeli
      failSoft(["okcTotal"], staff);
      checks.push({ key: "k6", level: "warn", fields: ["okcTotal"], text: `Önceki Z'den (${cum.zNo.trim()}) bu yana kümülatif artış ${money(delta)}; günlük toplam ${money(fig.total)}. Biri yanlış okunmuş olabilir.` });
    }
  }
  // Günlük toplam kümülatife eşit ve önceki kümülatif biliniyor: KÜM. satırı okunmuş olabilir (§5.1). Yeni zincirin
  // ilk Z'sinde (Z no ve kümülatif öncekinden küçük) kümülatif günlük toplama eşit olabilir
  const newChain = cumBelow && cur !== null && cumNo !== null && cur < cumNo;
  if (cum && !newChain && isNum(fig.cumTotal) && isNum(fig.total) && Math.abs(fig.cumTotal - fig.total) <= 0.01) {
    fail(["okcTotal"], "Günlük toplam bir gün için çok büyük; fişin altındaki cihaz toplamı okunmuş olabilir.", true);
    checks.push({ key: "cum-same", level: "warn", fields: ["okcTotal"], text: "Günlük toplam kümülatif satırla aynı; KÜM. satırı okunmuş olabilir." });
  }

  // Büyüklük (§5.1): ortancanın 5 katından ve 50.000 ₺'den büyük
  const med = median(ctx.recentTotals ?? []);
  if (isNum(fig.total) && med !== null && fig.total > 5 * med && fig.total > 50_000) {
    fail(["okcTotal"], "Günlük toplam bir gün için çok büyük; fişin altındaki cihaz toplamı okunmuş olabilir.", true);
    checks.push({ key: "size", level: "warn", fields: ["okcTotal"], text: `Günlük toplam için çok büyük (${money(fig.total)}); KÜM. (kümülatif) satırı okunmuş olabilir.` });
  }

  // GENEL TOPLAM etiketi: bazı cihazlarda kümülatif toplamdır; iki ayrı rakamla doğrulanmadıysa tutmadı sayılır
  if (isNum(fig.total) && fig.totalLabel && GENERAL_TOTAL.test(fig.totalLabel)) {
    failSoft(["okcTotal"], "Bu rakam fişin altındaki cihaz toplamı olabilir; NET SATIŞ ya da TOPLAM satırına bakın.");
    checks.push({ key: "general-total", level: "warn", fields: ["okcTotal"], text: "Günlük toplam GENEL TOPLAM satırından okundu; bazı cihazlarda bu kümülatif toplamdır. NET SATIŞ / MALİ VERİ TOPLAM satırıyla karşılaştırın." });
  }

  // K3: her oran KDV ≈ toplam × r / (100 + r); MATRAH + KDV = toplam. Yalnız çürütür: doğrulanmamış olanı (ikisi de
  // değilse ikisini) tutmadı yapar
  for (const g of groups) {
    const tf = totalField(g.rate);
    const vf = vatField(g.rate);
    const blame = (): OkcField[] => {
      const both = [tf, vf].filter((f): f is OkcField => f !== null);
      const open = both.filter((f) => !confirmed.has(f));
      return open.length ? open : both;
    };
    if (isNum(g.total) && isNum(g.vat) && g.rate >= 0) {
      const expected = r2((g.total * g.rate) / (100 + g.rate));
      if (Math.abs(g.vat - expected) > vTol) {
        const fields = blame();
        fail(fields, `Bu oranın KDV'si toplamına göre ${money(g.vat)} değil, ${money(expected)} civarında olmalı.`);
        checks.push({ key: `k3-${g.rate}`, level: "warn", fields, text: `%${g.rate} KDV'si ${money(g.vat)}; bu toplamdan beklenen ${money(expected)}. Rakamlardan biri yanlış okunmuş olabilir.` });
      }
    }
    if (isNum(g.base) && isNum(g.vat) && isNum(g.total) && Math.abs(r2(g.base + g.vat - g.total)) > SUM_TOL) {
      const fields = blame();
      fail(fields, "Bu oranın toplamı ve KDV'si fişteki öteki rakamla tutmuyor; fişe bakın.");
      checks.push({ key: `k3b-${g.rate}`, level: "warn", fields, text: `%${g.rate} MATRAH (${money(g.base)}) + KDV (${money(g.vat)}) toplamı (${money(g.total)}) tutmuyor; MATRAH grup toplamı diye okunmuş olabilir.` });
    }
  }

  // K5: toplam KDV ÷ günlük toplam, okunan oranların r/(100+r) aralığında (oran yoksa 1/101–1/6), ±0,002
  if (isNum(fig.vatTotal) && isNum(fig.total) && fig.total > 0) {
    const rates = groups.filter((g) => nz(g.total)).map((g) => g.rate);
    const ratios = rates.length ? rates.map((r) => r / (100 + r)) : [1 / 101, 1 / 6];
    const lo = Math.min(...ratios) - 0.002;
    const hi = Math.max(...ratios) + 0.002;
    const ratio = fig.vatTotal / fig.total;
    if (ratio < lo || ratio > hi) {
      const range = Math.round(Math.min(...ratios) * 100) === Math.round(Math.max(...ratios) * 100) ? pct(Math.min(...ratios)) : `${pct(Math.min(...ratios))}–${pct(Math.max(...ratios))}`;
      fail(["okcVatTotal"], `Toplam KDV günlük toplama göre çok ${ratio > hi ? "büyük" : "küçük"}; başka bir satır yazılmış olabilir.`);
      failSoft(["okcTotal"], "Günlük toplam ile toplam KDV birbirini tutmuyor; fişe bakın.");
      checks.push({ key: "k5", level: "warn", fields: ["okcVatTotal", "okcTotal"], text: `Toplam KDV günlük toplamın %${numPossessive(ratio * 100)}; ${range} olmalı. KÜM. ya da MATRAH satırı okunmuş olabilir.` });
    }
  }
  // K2 tutmadıysa ve K6-KDV doğrulamadıysa toplam KDV de
  if (k2Failed) failSoft(["okcVatTotal"], reasons[groupVatFields[0] ?? "okcVatTotal"] ?? "Toplam KDV oranların KDV'siyle tutmuyor; fişe bakın.");

  // K7: banka alt satırları kart satırını tutmalı (yalnız bilgi)
  if (isNum(fig.bankSublines) && isNum(fig.card) && Math.abs(r2(fig.bankSublines - fig.card)) > SUM_TOL) {
    checks.push({ key: "k7", level: "info", fields: [], text: "Banka satırlarının toplamı kart satırını tutmuyor; kartı fişle karşılaştırın." });
  }

  // K8: eski oran (%8, %18) satırında tutar olmaz; oran tanınan oranlardan biri olmalı
  for (const g of groups) {
    if (!nz(g.total) && !nz(g.vat)) continue;
    const fields = [totalField(g.rate), vatField(g.rate)].filter((f): f is OkcField => f !== null);
    if (OLD_RATES.includes(g.rate)) {
      checks.push({ key: `k8-${g.rate}`, level: "warn", fields: [], text: `Eski KDV oranı (%${g.rate}) satırında tutar var; fişe bakın.` });
    } else if (!KNOWN_RATES.has(g.rate)) {
      fail(fields, `KDV oranı (%${g.rate}) alışılmadık; fişe bakın.`);
      checks.push({ key: `k8-${g.rate}`, level: "warn", fields, text: `Alışılmadık KDV oranı (%${g.rate}); fişe bakın.` });
    }
  }

  // K9: fiş sayısı tam sayı, 0–5.000
  if (fig.receipts !== null && (!Number.isInteger(fig.receipts) || fig.receipts < 0 || fig.receipts > 5000)) {
    fail(["okcReceipts"], `Fiş sayısı alışılmadık (${fig.receipts.toLocaleString("tr-TR")}); fişe bakın.`);
    checks.push({ key: "k9", level: "warn", fields: ["okcReceipts"], text: `Fiş sayısı alışılmadık (${fig.receipts.toLocaleString("tr-TR")}); fişe bakın.` });
  }

  for (const f of failedUnlessConfirmed) if (!confirmed.has(f)) failed.add(f);
  const status: Partial<Record<OkcField, OkcStatus>> = {};
  for (const f of confirmed) status[f] = "confirmed";
  for (const f of failed) status[f] = "failed";
  // Doğrulanan alanın nedeni yok (uyarı değil); tutmayanın nedeni kalır
  for (const f of Object.keys(reasons) as OkcField[]) if (status[f] === "confirmed") delete reasons[f];
  const ordered = [...checks.filter((c) => c.level === "warn"), ...checks.filter((c) => c.level === "info")];
  return { status, reasons, checks: ordered, stopped };
}

const dayBefore = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- Form (canlı denetim, §3.6)

/** Formdaki yazarkasa değerleri (boş = null; KDV dökümü yalnız yazılan oranlar) */
export interface OkcFormValues {
  okcZNo: string | null;
  okcReceipts: number | null;
  okcTotal: number | null;
  okcVatTotal: number | null;
  okcCash: number | null;
  okcCard: number | null;
  okcMealCard: number | null;
  okcOther: number | null;
  okcVat: OkcVatLine[] | null;
}

export interface OkcFormCheck {
  /** Alan başına tek turuncu neden (personel, jargonsuz) */
  fields: Partial<Record<OkcField, string>>;
  /** Kartın altındaki tek özet satırı (personel); tutmayan yoksa null */
  summary: string | null;
  /** Yöneticinin ayrıntılı metinleri */
  admin: string[];
}

export function okcFiguresOfForm(v: OkcFormValues): OkcFigures {
  const any = [v.okcTotal, v.okcCash, v.okcCard, v.okcMealCard, v.okcOther].some(isNum);
  return {
    zNo: v.okcZNo,
    receipts: v.okcReceipts,
    total: v.okcTotal,
    vatTotal: v.okcVatTotal,
    groups: (v.okcVat ?? []).filter((g) => nz(g.total) || nz(g.vat)).map((g) => ({ rate: g.rate, total: g.total, vat: g.vat })),
    cash: v.okcCash,
    card: v.okcCard,
    mealCard: any ? (v.okcMealCard ?? 0) : null,
    other: any ? (v.okcOther ?? 0) : null,
  };
}

/**
 * Formun yazarkasa değerleri üstünde canlı denetim (elle yazılana da; plan §3.6). Kümülatif formda yoktur (D17);
 * Z no yalnız önceki Z'nin numarasıyla karşılaştırılır. Gönderimi engellemez.
 */
export function okcFormChecks(
  v: OkcFormValues,
  ctx: { prevZ: { date: string; zNo: string } | null; day?: string; recentTotals?: number[]; outside?: number | null; extraTakings?: boolean },
): OkcFormCheck {
  // `outside`: sunucunun sakladığı yazarkasa dışı tahsilat (yalnız yöneticinin kayıtlı raporu; personelin formunda yok).
  // `extraTakings`: personelde yalnız var olduğu (tutarsız; okumadan ya da kayıtlı rapordan)
  const res = okcChecks({ ...okcFiguresOfForm(v), outside: ctx.outside ?? null, extraTakings: ctx.extraTakings }, { prev: { z: ctx.prevZ }, day: ctx.day, recentTotals: ctx.recentTotals });
  // Nedeni olan alanlar: tutmayanlar ve uyarı alanlar (doğrulananın nedeni yok)
  const fields: Partial<Record<OkcField, string>> = { ...res.reasons };
  for (const [f, s] of Object.entries(res.status) as [OkcField, OkcStatus][]) if (s === "failed") fields[f] ??= "Fişle karşılaştırın.";
  const n = Object.keys(fields).length;
  const summary = res.stopped
    ? (res.checks.find((c) => c.whole)?.staff ?? null)
    : n === 0
      ? null
      : n === 1
        ? "1 rakam fişteki ötekileri tutmuyor; turuncu olanı fişle karşılaştırın."
        : `${n} rakam birbirini tutmuyor; turuncu olanları fişle karşılaştırın.`;
  return { fields, summary, admin: res.checks.filter((c) => c.level === "warn").map((c) => c.text) };
}

// ---------------------------------------------------------------- Zorunluluk (formda ve sunucuda aynı, §3.2)

/** Formdan gelen döküm satırı: oranın toplamı ya da KDV'si yazılmamış olabilir (ikisi birlikte yazılır) */
export interface OkcVatInput {
  rate: number;
  total: number | null;
  vat: number | null;
}

/**
 * Yazarkasa bölümünün zorunluluk kuralları (plan §3.2; form ve sunucu aynı metinle): bölüm bütünüyle boş kalabilir;
 * herhangi bir tutar yazıldıysa günlük toplam, nakit ve kredi kartı gerekli; bir oranın toplamı ile KDV'si birlikte
 * yazılır ve KDV toplamdan büyük olamaz. İlk hatanın metni, yoksa null
 */
export function okcFormError(v: {
  okcTotal?: number | null;
  okcVatTotal?: number | null;
  okcCash?: number | null;
  okcCard?: number | null;
  okcMealCard?: number | null;
  okcOther?: number | null;
  okcVat?: readonly OkcVatInput[] | null;
}): string | null {
  const lines = v.okcVat ?? [];
  for (const l of lines) {
    if ((l.total === null) !== (l.vat === null)) return `%${l.rate} için toplam ve KDV birlikte yazılır`;
    if (l.total !== null && l.vat !== null && l.vat > l.total + 0.005) return `%${l.rate} KDV'si toplamından büyük olamaz`;
  }
  const any = [v.okcTotal, v.okcVatTotal, v.okcCash, v.okcCard, v.okcMealCard, v.okcOther].some(isNum) || lines.some((l) => isNum(l.total) || isNum(l.vat));
  if (!any) return null;
  if (!isNum(v.okcTotal)) return "Yazarkasa günlük toplamı gerekli (bölümü boş da bırakabilirsiniz)";
  if (!isNum(v.okcCash)) return "Nakit gerekli (yoksa 0 yazın)";
  if (!isNum(v.okcCard)) return "Kredi kartı gerekli (yoksa 0 yazın)";
  return null;
}

/** Raporda yazarkasa bölümü yazılmış mı (günlük toplam ya da kart) */
export function okcHasFigures(f: { okcTotal?: number | null; okcCard?: number | null }): boolean {
  return isNum(f.okcTotal) || isNum(f.okcCard);
}

// ---------------------------------------------------------------- KDV dökümü

/** Saklanacak döküm: sıfır gruplar atılır, orana göre sıralanır, tutarlar kuruşa yuvarlanır */
export function normalizeVat(lines: readonly OkcVatLine[] | null | undefined): OkcVatLine[] {
  return (lines ?? [])
    .filter((l) => nz(l.total) || nz(l.vat))
    .map((l) => ({ rate: l.rate, total: r2(l.total), vat: r2(l.vat) }))
    .sort((a, b) => a.rate - b.rate);
}

/**
 * İki KDV dökümü aynı mı (plan §6.5): boş ve `[]` eşit; sıfır gruplar atılır, orana göre sıralanır, tutarlar kuruşa
 * yuvarlanır. `revisionChanges` ve dalga 10'un `same()`'i bunu kullanır (dizi metin ya da sayı gibi karşılaştırılmaz).
 */
export function sameVat(a: readonly OkcVatLine[] | null | undefined, b: readonly OkcVatLine[] | null | undefined): boolean {
  return JSON.stringify(normalizeVat(a)) === JSON.stringify(normalizeVat(b));
}

// ---------------------------------------------------------------- Kümülatifin saklanması (§6.1)

export interface OkcCumulativeInput {
  /** Kaydedilen Z no ve günlük toplam (formdan) */
  savedZNo: string | null;
  savedTotal: number | null;
  /** Fotoğrafın okuması */
  readZNo: string | null;
  readTotal: number | null;
  readVatTotal: number | null;
  cumTotal: number | null;
  cumVat: number | null;
  outside: number | null;
  /** Son **saklanan** kümülatif (zincir hep ona bağlanır) */
  prevCum: OkcPrev["cum"];
}

export interface OkcCumulativeResult {
  cumTotal: number | null;
  cumVat: number | null;
  outside: number | null;
  /** Neden saklandı: zincir tutuyor, ilk kümülatif, aradaki girilmemiş Z'lerle büyümüş */
  basis: "chain" | "first" | "gap" | null;
  /** Okundu ama inandırıcı bulunmadı (yöneticiye "saklanmadı" satırı) */
  rejected: number | null;
}

/**
 * Sunucu sütunları (D10): kümülatif yalnız inandırıcıysa saklanır; okuma kaydedilen Z no'ya ve günlük toplama eşit
 * değilse (elle düzeltilmiş rapor) üçü de boş. Zincir hep son saklanan kümülatife bağlanır: yanlış okunmuş bir
 * kümülatif saklanmaz, ertesi günün doğru toplamını "tutmadı" yapamaz.
 */
export function okcCumulativeToStore(i: OkcCumulativeInput): OkcCumulativeResult {
  const none: OkcCumulativeResult = { cumTotal: null, cumVat: null, outside: null, basis: null, rejected: null };
  const cur = zNoNumber(i.readZNo);
  if (cur === null || zNoNumber(i.savedZNo) !== cur || !isNum(i.readTotal) || !isNum(i.savedTotal) || Math.abs(i.readTotal - i.savedTotal) > 0.01) return none;
  const outside = isNum(i.outside) && i.outside > 1 ? r2(i.outside) : null;
  const out: OkcCumulativeResult = { ...none, outside };
  if (!isNum(i.cumTotal)) return out;
  const total = i.readTotal;
  // Kümülatif günlük toplamdan küçükse yok sayılır (bilgi satırı yok, §5.1)
  if (i.cumTotal < total - SUM_TOL) return out;
  const prev = i.prevCum ?? null;
  const prevNo = prev ? zNoNumber(prev.zNo) : null;
  let basis: OkcCumulativeResult["basis"] = null;
  let vatOk = isNum(i.cumVat) && (!isNum(i.readVatTotal) || i.cumVat >= i.readVatTotal - SUM_TOL);
  if (!prev || prevNo === null) basis = "first";
  // Z no ve kümülatif son saklanandan küçük: yeni cihaz ya da sıfırlanan sayaç; yeni zincirin ilki (yoksa zincir hep
  // eski cihazın kümülatifine bağlı kalır ve hiçbir kümülatif saklanmaz)
  else if (cur < prevNo && i.cumTotal < prev.cumTotal - SUM_TOL) basis = "first";
  else if (cur === prevNo + 1) {
    if (Math.abs(r2(i.cumTotal - prev.cumTotal - total)) <= SUM_TOL) basis = "chain";
    if (vatOk && isNum(prev.cumVat) && isNum(i.readVatTotal)) vatOk = Math.abs(r2(i.cumVat! - prev.cumVat - i.readVatTotal)) <= SUM_TOL;
  } else if (cur > prevNo + 1) {
    if (r2(i.cumTotal - prev.cumTotal) >= total - SUM_TOL) basis = "gap";
    if (vatOk && isNum(prev.cumVat) && isNum(i.readVatTotal)) vatOk = r2(i.cumVat! - prev.cumVat) >= i.readVatTotal - SUM_TOL;
  }
  if (!basis) return { ...out, rejected: r2(i.cumTotal) };
  return { ...out, cumTotal: r2(i.cumTotal), cumVat: vatOk ? r2(i.cumVat!) : null, basis };
}

// ---------------------------------------------------------------- Geç rapor: iki yanlı zincir (§3.8, §5.3)

/** Geç raporun kayıtlı komşu yazarkasa Z'si */
export interface OkcNeighbour {
  date: string;
  zNo: string;
  /** Günlük toplam (sonraki halkanın kümülatif artışı onunla karşılaştırılır) */
  total?: number | null;
  /** Saklanan kümülatif (yalnız inandırıcı bulunmuşsa saklıdır) */
  cumTotal?: number | null;
}

export interface OkcLateChain {
  /** false: bir halka tutmuyor; true: en az bir halka tutuyor, hiçbiri bozuk değil; null: denetlenecek bir şey yok */
  ok: boolean | null;
  /** "Banka POS Z no 0188: önceki 0187 (21 Ekim) ✓ · sonraki 0189 (23 Ekim) ✓ · kümülatif iki yanda da tutuyor" */
  text: string;
}

/**
 * Geç güne eklenen raporun yazarkasa Z'si iki komşusuyla (yöneticinin onay kartı; plan §3.8): Z no önceki + 1 ve
 * sonraki − 1 mi, kümülatif zinciri (K6) iki yanda tutuyor mu. `cur.cumTotal`: geç raporun fotoğrafının okuduğu
 * kümülatif (okunan Z no ve toplam kaydedilenle aynıysa); yoksa önceki ve sonraki saklanan kümülatifin farkı iki günün
 * toplamıyla karşılaştırılır. `prev.z` Z no sırası, `prev.cum` son saklanan kümülatif (previousOkc). Yazarkasa Z no'su
 * yazılmamış raporda null.
 */
export function okcLateChain(
  cur: { zNo: string | null | undefined; total: number | null | undefined; cumTotal?: number | null },
  prev: { z: { date: string; zNo: string } | null; cum?: { date: string; zNo: string; cumTotal: number } | null },
  next: OkcNeighbour | null,
): OkcLateChain | null {
  const c = zNoNumber(cur.zNo);
  if (c === null) return null;
  const shown = (cur.zNo ?? "").trim();
  const parts: string[] = [];
  let good = 0;
  let bad = 0;
  const p = prev.z ? zNoNumber(prev.z.zNo) : null;
  if (prev.z && p !== null) {
    const label = `önceki ${prev.z.zNo.trim()} (${dayMonthTR(prev.z.date)})`;
    if (p + 1 === c) {
      good++;
      parts.push(`${label} ✓`);
    } else if (p >= c) {
      bad++;
      parts.push(`${label} bu Z no'dan büyük ya da eşit`);
    } else parts.push(`${label}; arada ${c - p - 1} Z girilmemiş`);
  }
  const n = next ? zNoNumber(next.zNo) : null;
  if (next && n !== null) {
    const label = `sonraki ${next.zNo.trim()} (${dayMonthTR(next.date)})`;
    if (n === c + 1) {
      good++;
      parts.push(`${label} ✓`);
    } else if (n <= c) {
      bad++;
      parts.push(`${label} bu Z no'dan küçük ya da eşit`);
    } else parts.push(`${label}; arada ${n - c - 1} Z girilmemiş`);
  }
  // Kümülatif: +1'de fark günlük toplamı tutmalı, aralıkta (girilmemiş Z'ler) en az o kadar büyümeli
  const held: string[] = [];
  const broken: string[] = [];
  const total = isNum(cur.total) ? cur.total : null;
  const curCum = isNum(cur.cumTotal) ? cur.cumTotal : null;
  const pc = prev.cum ? zNoNumber(prev.cum.zNo) : null;
  if (prev.cum && pc !== null && pc < c && curCum !== null && total !== null) {
    const d = r2(curCum - prev.cum.cumTotal);
    if (pc + 1 === c) {
      if (Math.abs(r2(d - total)) <= SUM_TOL) held.push("önceki");
      else broken.push(`önceki Z'den bu yana kümülatif artışı ${money(d)}, bu günün toplamı ${money(total)}`);
    } else if (d < total - SUM_TOL) broken.push(`önceki Z'den bu yana kümülatif artışı ${money(d)}, bu günün toplamından (${money(total)}) az`);
  }
  const nextCum = next && isNum(next.cumTotal) ? next.cumTotal : null;
  const nextTotal = next && isNum(next.total) ? next.total : null;
  if (next && n !== null && n > c && nextCum !== null && nextTotal !== null) {
    if (curCum !== null) {
      const d = r2(nextCum - curCum);
      if (n === c + 1) {
        if (Math.abs(r2(d - nextTotal)) <= SUM_TOL) held.push("sonraki");
        else broken.push(`sonraki günün kümülatif artışı ${money(d)}, o günün toplamı ${money(nextTotal)}`);
      } else if (d < nextTotal - SUM_TOL) broken.push(`sonraki günün kümülatif artışı ${money(d)}, o günün toplamından (${money(nextTotal)}) az`);
    } else if (prev.cum && pc !== null && total !== null && pc + 1 === c && n === c + 1) {
      // Geç raporun kendi kümülatifi yok: önceki ve sonraki saklanan kümülatifin farkı iki günün toplamı olmalı
      const d = r2(nextCum - prev.cum.cumTotal);
      const both = r2(total + nextTotal);
      if (Math.abs(r2(d - both)) <= SUM_TOL) held.push("iki yanda");
      else broken.push(`önceki ve sonraki Z arasındaki kümülatif artış ${money(d)}, iki günün toplamı ${money(both)}`);
    }
  }
  good += held.length;
  bad += broken.length;
  if (broken.length) parts.push(...broken);
  else if (held.length === 2 || held.includes("iki yanda")) parts.push("kümülatif iki yanda da tutuyor");
  else if (held.length === 1) parts.push(`kümülatif ${held[0]} Z'yle tutuyor`);
  return { ok: bad ? false : good ? true : null, text: `Banka POS Z no ${shown}${parts.length ? `: ${parts.join(" · ")}` : ""}` };
}

/** Yöneticinin kayıtlı raporundaki satır: saklanmayan kümülatif */
export const cumulativeRejectedText = (v: number) => `Kümülatif okundu ama önceki Z'yle tutmadığı için saklanmadı (${money(v)}).`;

// ---------------------------------------------------------------- Mutabakat (ModPOS ↔ yazarkasa ↔ banka, §8)

/** Raporun karşılaştırılan alanları (`CashReportFields`'ın yazarkasa alanlarıyla genişlemiş hâli; hepsi isteğe bağlı) */
export interface OkcReportFields {
  zTotal: number;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  bankPos: number | null;
  okcZNo?: string | null;
  okcReceipts?: number | null;
  okcTotal?: number | null;
  okcVatTotal?: number | null;
  okcVat?: OkcVatLine[] | null;
  okcCash?: number | null;
  okcCard?: number | null;
  okcMealCard?: number | null;
  okcOther?: number | null;
  /** Sunucu sütunu (yalnız yöneticinin DTO'su): yazarkasa dışı tahsilat; K4 onu da sayar (okumayla aynı) */
  okcOutside?: number | null;
  /** Personelin DTO'su: toplam dışı tahsilat var (tutarsız); K4 fazlayı tutmadı saymaz */
  okcExtraTakings?: boolean;
  /**
   * LafPOS gününde kartla bahşiş + kartla cari tahsilatı (G11; src/lib/lafpos/prefill.ts lafposCardExtra): banka POS'u
   * görür, Z'nin kartı görmez. Kart karşılaştırması bunu düşer; kaydedilmez, LafPOS'un gün sonundan gelir
   */
  cardExtra?: number | null;
  /**
   * LafPOS gününde yazarkasadan geçmeyen satış ödemeleri (Faz 2; src/lib/lafpos/prefill.ts LafposDay.offDevice): mali
   * fişi yazarkasada kesilmedi. Z'nin kartında ve nakdinde var, yazarkasanın Z'sinde ve banka gün sonunda yok: kart, nakit
   * ve toplam karşılaştırmaları bunu düşer; kaydedilmez. `okcCard` LafPOS'un cihaz belgelerinin kartıdır (okc.card;
   * okcFromDevice)
   */
  offDevice?: { card: number; cash: number; okcCard?: number | null } | null;
}

/**
 * Raporun yazarkasa kartı LafPOS'un cihaz belgelerinden mi (gün sonu tam, 24 Kasım 2026): LafPOS'un gönderdiği belge kartıyla
 * aynıysa evet. Belge kartı Z − yazarkasadan geçmeyen − cihazda iptaldir, kartla bahşiş ve cari tahsilatı içermez; elle
 * yazılan yazarkasa kartı (ör. banka fişinden, eski LafPOS günleri) içerebilir, onda bahşiş / tahsilat eskisi gibi düşülür
 */
export function okcFromDevice(okcCard: number | null | undefined, offDevice: { okcCard?: number | null } | null | undefined): boolean {
  const device = offDevice?.okcCard;
  return isNum(okcCard) && isNum(device) && Math.abs(Math.round((okcCard - device) * 100) / 100) < 0.005;
}

export interface OkcReconcileLine {
  /** Personel yalnız `okc-card` ve `okc-self` alır */
  key: "okc-card" | "okc-self" | "okc-cash" | "okc-total" | "okc-meal" | "okc-bank";
  tone: "good" | "info" | "warn";
  text: string;
  diff: number | null;
}

/** Bu kadarın altındaki fark "aynı" sayılır (CASH_TOLERANCE ile aynı; döngüsel içe aktarmayı önlemek için burada) */
const TOL = 1;
const same = (d: number) => Math.abs(d) < TOL;
const moreLess = (d: number) => `${money(Math.abs(d))} ${d > 0 ? "fazla" : "az"}`;

/** Kayıtlı raporun personel satırı: yazarkasa rakamları kendi içinde tutmuyor */
export const OKC_SELF_STAFF_TEXT = "Yazarkasa rakamları birbirini tutmuyor; fişle karşılaştırın, yanlışsa raporu düzeltin.";

/** Kayıtlı değerlerden yazarkasanın kendi içindeki denetimleri (önceki Z'siz; yöneticide yazarkasa dışı tahsilatla) */
function selfCheck(f: OkcReportFields): OkcFormCheck | null {
  if (!isNum(f.okcTotal)) return null;
  return okcFormChecks(
    {
      okcZNo: f.okcZNo ?? null,
      okcReceipts: f.okcReceipts ?? null,
      okcTotal: f.okcTotal,
      okcVatTotal: f.okcVatTotal ?? null,
      okcCash: f.okcCash ?? null,
      okcCard: f.okcCard ?? null,
      okcMealCard: f.okcMealCard ?? null,
      okcOther: f.okcOther ?? null,
      okcVat: f.okcVat ?? null,
    },
    { prevZ: null, outside: f.okcOutside ?? null, extraTakings: f.okcExtraTakings },
  );
}

/**
 * ModPOS ↔ yazarkasa ↔ banka satırları (plan §8). Tolerans 1 ₺; satır yalnız iki tarafın da değeri varsa çıkar.
 * Personel (`"staff"`) yalnız Kart ve Kendi içinde satırlarını alır (İlke 8, D13); öteki satırlar yöneticide.
 * Yazarkasa alanları boş eski raporda yalnız bugünkü "Banka POS" kart satırı. `kasa` raporun gününün kasası (geçiş
 * gününden itibaren "LafPOS"; denetim E-39): metinler o kasanın adıyla, verilmezse ModPOS (bugünkü gibi).
 *
 * LafPOS gününde (gün sonu tam, 24 Kasım 2026) yazarkasanın kartı LafPOS'un cihaz belgelerinindir: Z − yazarkasadan
 * geçmeyen − cihazda iptal (offDevice ikisini taşır; src/lib/lafpos/prefill.ts lafposDayOf), kartla bahşiş ve cari
 * tahsilatı içermez. Yazarkasa ↔ LafPOS satırı onları düşmez; banka gün sonu yazarkasa kartı + bahşiş + tahsilatla
 * karşılaştırılır (Pavo onları da çeker)
 */
export function okcReconcile(f: OkcReportFields, audience: "staff" | "admin", kasa: "ModPOS" | "LafPOS" = "ModPOS"): OkcReconcileLine[] {
  const out: OkcReconcileLine[] = [];
  const okcCard = isNum(f.okcCard) ? f.okcCard : null;
  const hasOkc = isNum(f.okcTotal) || okcCard !== null;
  // LafPOS gününde kartla bahşiş ve cari tahsilatı Z'nin kartında yok, banka POS'unda var (G11): karşılaştırma düşer;
  // tutarı yalnız yöneticinin metninde
  const extra = isNum(f.cardExtra) && f.cardExtra > 0 ? f.cardExtra : 0;
  // Yazarkasadan geçmeyen ödeme (Faz 2) Z'nin kartında ve nakdinde var, yazarkasada ve banka gün sonunda yok: düşülür;
  // tutarı yalnız yöneticinin metninde
  const offCard = f.offDevice && f.offDevice.card > 0 ? f.offDevice.card : 0;
  const offCash = f.offDevice && f.offDevice.cash > 0 ? f.offDevice.cash : 0;
  const offNote = (what: "kart" | "nakit", amount: number) =>
    amount ? (audience === "admin" ? ` LafPOS'ta yazarkasadan geçmeyen ${what} (${money(amount)}) düşüldü.` : ` LafPOS'ta yazarkasadan geçmeyen ${what} düşüldü.`) : "";
  const extraNote =
    (extra ? (audience === "admin" ? ` LafPOS'taki kartla bahşiş ve cari tahsilatı (${money(extra)}) düşüldü.` : " LafPOS'taki kartla bahşiş ve cari tahsilatı düşüldü.") : "") +
    offNote("kart", offCard);
  const card = r2(f.card - offCard);
  // Yazarkasa kartı LafPOS'un cihaz belgelerinden (otomatik rapor): bahşiş / tahsilat onda yok, banka satırında var
  const lafpos = kasa === "LafPOS" && okcFromDevice(okcCard, f.offDevice);
  // Kart: yazarkasa kartı varsa o, yoksa banka gün sonu − ModPOS kart
  if (okcCard !== null) {
    const d = r2(okcCard - card - (lafpos ? 0 : extra));
    const note = lafpos ? offNote("kart", offCard) : extraNote;
    out.push(
      same(d)
        ? { key: "okc-card", tone: "good", text: `Kart: yazarkasa ile ${kasa} aynı.${note}`, diff: d }
        : { key: "okc-card", tone: "warn", text: `Yazarkasa kartı, ${kasa}'taki karttan ${moreLess(d)}. Kartla alınan bir ödeme ${kasa}'ta başka ödeme türüyle girilmiş olabilir.${note}`, diff: d },
    );
  } else if (isNum(f.bankPos)) {
    const d = r2(f.bankPos - card - extra);
    const label = hasOkc ? "Banka gün sonu" : "Banka POS";
    out.push(
      same(d)
        ? { key: "okc-card", tone: "good", text: `Kart: ${label.toLocaleLowerCase("tr-TR")} ile ${kasa} aynı.${extraNote}`, diff: d }
        : { key: "okc-card", tone: "warn", text: `${label}, ${kasa}'taki karttan ${moreLess(d)}.${extraNote}`, diff: d },
    );
  }
  // Kendi içinde: personele tek satır, yöneticiye ayrıntılı
  const self = selfCheck(f);
  // Kayıtlı raporda turuncu alan yok: personele formun "turuncu olanları" cümlesi değil, kendi metni
  if (self?.summary) out.push({ key: "okc-self", tone: "warn", text: audience === "staff" ? OKC_SELF_STAFF_TEXT : `Yazarkasa Z'si kendi içinde tutmuyor: ${self.admin[0] ?? self.summary}`, diff: null });
  if (audience === "staff") return out;

  if (isNum(f.okcCash)) {
    const d = r2(f.okcCash - (f.cash - offCash));
    const note = offNote("nakit", offCash);
    out.push(
      same(d)
        ? { key: "okc-cash", tone: "good", text: `Nakit: yazarkasa ile ${kasa} aynı.${note}`, diff: d }
        : { key: "okc-cash", tone: "info", text: `Yazarkasa nakdi, ${kasa}'taki nakitten ${moreLess(d)}.${note}`, diff: d },
    );
  }
  if (isNum(f.okcTotal)) {
    const d = r2(f.zTotal - f.okcTotal);
    const offFiscal = r2(f.online + f.other);
    // LafPOS gününde yazarkasadan geçmeyen satış da (Faz 2)
    const offDev = r2(offCard + offCash);
    const why = offDev > 0 ? (offFiscal > 0 ? "online, diğer ve yazarkasadan geçmeyen satışlar kadar" : "yazarkasadan geçmeyen satışlar kadar") : "online ve diğer satışlar kadar (yazarkasadan geçmez)";
    out.push(
      same(d)
        ? { key: "okc-total", tone: "good", text: "Toplam: iki Z aynı.", diff: d }
        : d > 0 && offFiscal + offDev > 0 && same(r2(d - offFiscal - offDev))
          ? { key: "okc-total", tone: "info", text: `${kasa} toplamı ${money(d)} fazla; ${why}.`, diff: d }
          : { key: "okc-total", tone: "info", text: `${kasa} toplamı yazarkasadan ${moreLess(d)}.`, diff: d },
    );
  }
  if (isNum(f.okcMealCard) && f.okcMealCard > 0 && f.mealCard > 0) {
    const d = r2(f.okcMealCard - f.mealCard);
    if (!same(d)) out.push({ key: "okc-meal", tone: "info", text: `Yazarkasa yemek kartı, ${kasa}'takinden ${moreLess(d)}.`, diff: d });
  }
  if (okcCard !== null && isNum(f.bankPos)) {
    const d = r2(f.bankPos - okcCard - (lafpos ? extra : 0));
    out.push(
      same(d)
        ? { key: "okc-bank", tone: "good", text: "Banka gün sonu yazarkasa kartıyla aynı.", diff: d }
        : { key: "okc-bank", tone: "info", text: `Banka gün sonu, yazarkasa kartından ${moreLess(d)} (bir gün gün sonu alınmadıysa iki günü kapsar).`, diff: d },
    );
  }
  return out;
}

// ---------------------------------------------------------------- Ay (aşağı akış, §9)

/** Ay okuyucusunun satırı (`cash_reports`'un ilgili sütunları) */
export interface OkcRow {
  date: string;
  /** Şube (her şubenin kendi yazarkasası, kendi Z no ve kümülatif zinciri); verilmezse tek kasa */
  branchId?: string | null;
  /** ModPOS Z toplamı */
  zTotal: number;
  okcZNo?: string | null;
  okcTotal?: number | null;
  okcVatTotal?: number | null;
  okcVat?: OkcVatLine[] | null;
  okcCumTotal?: number | null;
  okcCumVat?: number | null;
}

/**
 * Günün yazarkasa Z'sinin KDV dahil toplamı ve KDV'si (KDV tahmini; src/lib/cash-month.ts vatDaysOf): KDV toplamı
 * girilmişse o, yoksa oran oran dökümün KDV'leri. Toplam ya da KDV girilmemişse null (gün oranla tahmin edilir)
 */
export function okcDayVat(r: Pick<OkcRow, "okcTotal" | "okcVatTotal" | "okcVat">): { total: number; vat: number } | null {
  if (!isNum(r.okcTotal) || !(r.okcTotal > 0)) return null;
  if (isNum(r.okcVatTotal)) return { total: r.okcTotal, vat: r.okcVatTotal };
  const lines = normalizeVat(r.okcVat);
  return lines.length ? { total: r.okcTotal, vat: r2(lines.reduce((a, l) => a + l.vat, 0)) } : null;
}

export interface OkcRateSum {
  rate: number;
  total: number;
  vat: number;
  /** KDV hariç: toplam − KDV */
  base: number;
}

export interface OkcMonth {
  month: string;
  /** Z toplamı > 0 rapor günü */
  reportDays: number;
  /** Yazarkasa toplamı girilmiş gün */
  days: number;
  /** Z toplamı > 0 ama yazarkasa yok */
  missing: string[];
  /** KDV dökümü (okcVat) de girilmiş gün */
  vatDays: number;
  /** Yazarkasa toplamı var, KDV dökümü yok */
  vatMissing: string[];
  /** Σ okcTotal (KDV dahil) */
  total: number;
  /** Σ okcVatTotal */
  vatTotal: number;
  /** Σ okcVat (yalnız girilen döküm) */
  byRate: OkcRateSum[];
  /**
   * vatMissing doluysa: yalnız eksik günlerin toplamının, girilen günlerin oran paylarıyla dağıtılmış tahmini (tek
   * oranlı ayda tek satır). byRate'e hiçbir zaman karışmaz; ayın tahmini oran toplamı byRate + bu. "Tahmini" işaretiyle
   * gösterilir; girilen döküm yoksa null
   */
  byRateEstimated: OkcRateSum[] | null;
  /** Kümülatif(ayın son Z'si) − kümülatif(önceki ayın son Z'si); ikisi de saklıysa */
  chain: { total: number; vat: number | null; fromZ: string; toZ: string } | null;
  /** Oran oran gelir ve KDV bu tabandan alınabilir mi (dalga 12, 13b) */
  complete: boolean;
}

/** Tek yazarkasanın ay zinciri (şube satırları) */
function branchChain(rows: readonly OkcRow[], month: string): { total: number; vat: number | null; fromZ: string; toZ: string } | null {
  const start = `${month}-01`;
  const withCum = rows.filter((r) => isNum(r.okcCumTotal) && r.okcZNo).sort((a, b) => a.date.localeCompare(b.date));
  const before = [...withCum].reverse().find((r) => r.date < start);
  const last = [...withCum].reverse().find((r) => r.date.slice(0, 7) === month);
  return before && last
    ? {
        total: r2(last.okcCumTotal! - before.okcCumTotal!),
        vat: isNum(last.okcCumVat) && isNum(before.okcCumVat) ? r2(last.okcCumVat - before.okcCumVat) : null,
        fromZ: before.okcZNo!,
        toZ: last.okcZNo!,
      }
    : null;
}

/** Ayın zinciri: tek şubede o şubeninki; birden çok şubede ayda yazarkasa girilmiş her şubenin zincirinin toplamı */
function monthChain(rows: readonly OkcRow[], entered: readonly OkcRow[], month: string): OkcMonth["chain"] {
  const branchOf = (r: OkcRow) => r.branchId ?? "";
  const branches = [...new Set(rows.map(branchOf))];
  if (branches.length <= 1) return branchChain(rows, month);
  const parts: { branch: string; chain: NonNullable<ReturnType<typeof branchChain>> }[] = [];
  for (const b of [...new Set(entered.map(branchOf))].sort()) {
    const c = branchChain(
      rows.filter((r) => branchOf(r) === b),
      month,
    );
    if (!c) return null;
    parts.push({ branch: b, chain: c });
  }
  if (!parts.length) return null;
  return {
    total: r2(parts.reduce((a, p) => a + p.chain.total, 0)),
    vat: parts.every((p) => p.chain.vat !== null) ? r2(parts.reduce((a, p) => a + p.chain.vat!, 0)) : null,
    fromZ: parts.map((p) => `${p.branch} ${p.chain.fromZ}`).join(" · "),
    toZ: parts.map((p) => `${p.branch} ${p.chain.toZ}`).join(" · "),
  };
}

/**
 * Ayın yazarkasa kapsamı ve oran oran toplamları (plan §9). Bu dalgada yalnız okuyucu: hiçbir ekranın hesabı
 * değişmez. KDV dökümü olmayan bir günü olan ay toplamı tam olsa bile `complete: false` döner.
 */
export function okcMonth(rows: readonly OkcRow[], month: string): OkcMonth {
  const inMonth = rows.filter((r) => r.date.slice(0, 7) === month).sort((a, b) => a.date.localeCompare(b.date));
  const reportDays = inMonth.filter((r) => r.zTotal > 0).length;
  const entered = inMonth.filter((r) => isNum(r.okcTotal));
  const missing = inMonth.filter((r) => r.zTotal > 0 && !isNum(r.okcTotal)).map((r) => r.date);
  const withVat = entered.filter((r) => normalizeVat(r.okcVat).length > 0);
  const vatMissing = entered.filter((r) => normalizeVat(r.okcVat).length === 0).map((r) => r.date);
  const total = r2(entered.reduce((a, r) => a + r.okcTotal!, 0));
  const vatTotal = r2(entered.reduce((a, r) => a + (r.okcVatTotal ?? 0), 0));

  const rates = new Map<number, { total: number; vat: number }>();
  for (const r of withVat) {
    for (const l of normalizeVat(r.okcVat)) {
      const p = rates.get(l.rate) ?? { total: 0, vat: 0 };
      rates.set(l.rate, { total: p.total + l.total, vat: p.vat + l.vat });
    }
  }
  const byRate: OkcRateSum[] = [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, s]) => ({ rate, total: r2(s.total), vat: r2(s.vat), base: r2(s.total - s.vat) }));
  const byRateTotal = r2(byRate.reduce((a, s) => a + s.total, 0));

  let byRateEstimated: OkcRateSum[] | null = null;
  if (vatMissing.length && byRateTotal > 0) {
    // Satırın kendisiyle (günle değil): iki şubenin aynı günü birinde döküm varken öbürünü eksik saymasın
    const missingTotal = entered.filter((r) => normalizeVat(r.okcVat).length === 0).reduce((a, r) => a + r.okcTotal!, 0);
    byRateEstimated = byRate.map((s) => {
      const t = (missingTotal * s.total) / byRateTotal;
      const v = s.total > 0 ? (t * s.vat) / s.total : 0;
      return { rate: s.rate, total: r2(t), vat: r2(v), base: r2(t - v) };
    });
  }

  // Zincir: ayın son saklanan kümülatifi − önceki ayın son saklanan kümülatifi, ŞUBE BAŞINA (her şubenin ayrı
  // yazarkasası var: Marina'nın kümülatifinden Tuzla'nınki çıkarılmaz). Birden çok şubede ay zinciri, ayda yazarkasa
  // girilmiş her şubenin zinciri varsa şube zincirlerinin toplamıdır
  const chain = monthChain(rows, entered, month);

  const ratesMatch = Math.abs(byRateTotal - total) <= TOL;
  const complete =
    (missing.length === 0 && vatMissing.length === 0 && entered.length > 0 && ratesMatch) ||
    (chain !== null && Math.abs(chain.total - total) <= TOL && vatMissing.length === 0 && entered.length > 0 && ratesMatch);
  return { month, reportDays, days: entered.length, missing, vatDays: withVat.length, vatMissing, total, vatTotal, byRate, byRateEstimated, chain, complete };
}
