/**
 * Komisyon ve hakediş raporu (saf; sunucu ve testler kullanır; tests/komisyon.test.ts). Her yemek kartı şirketi ve
 * sipariş platformu için ay ay: kanaldan geçen satış, kanalın faturaları ve kalemleri, gerçek oran (kanalın kestiği
 * her şey ÷ satış), uyarılar ("olabilir"), beklenen hakediş, son günü ve geldi işareti. Veriyi sunucu toplar
 * (src/server/data/commission.ts); burada saat okunmaz, `today` girdidir. Ayrıntı: docs/KOMISYON.md.
 *
 * Satış kanal kanal ayrı yazılmaz: Z raporunda yemek kartları da online (platformlar) da tek toplamdır. Bir kanalın
 * satışı önce yöneticinin yazdığı aylık ekstreden (`elle`), yoksa o ay grubunda tek kanal varsa Z'deki toplamdan
 * (`tek`) gelir; ikisi de yoksa bilinmez ve nedeni yazılır. LafPOS'a geçiş günü seçiliyse o günden itibaren LafPOS'un
 * gün sonu ödemeleri kanal kanal yollar (`lafpos`, denetim E-37): elle > lafpos > tek. Geçiş ayından itibaren markası
 * bilinmeyen tutar (geçiş gününden önceki günlerin ve ModPOS'ta kalan şubenin Z'si, LafPOS'ta kanalı seçilmemiş ödeme,
 * gün sonu gelmemiş günün kasa raporu) tek kanala da yazılmaz: grubun "Marka belirsiz" satırında durur (23 Kasım 2026);
 * ModPOS föyünde markası olan ödeme (modposBrands) kanalına yazılır. ModPOS'ta kalan şube seçiliyken (Tuzla) aynı kural
 * geçiş ayından itibaren onun Z'sine de uygulanır (`modposScope`; şube görünümü "Tümü"yle tutarlı). Yemek kartlarının
 * toplam oranı her zaman hesaplanır: %6'yı aşıyorsa en az bir kart aşıyordur.
 */

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import { partialStart, type TillOpening } from "@/lib/cash-month";
import { MONTH_NAMES } from "@/lib/constants";
import { money, pct } from "@/lib/format";
import { isLafposBranch, scopeSwitchDay } from "@/lib/lafpos/switch";
import { addDays, dayLocativeTR, dayMonthTR, daysBetween, monthEnd, monthLocativeTR, shiftMonth } from "@/lib/reminders";
import type { DigestBox } from "@/server/notify/digest-template";

import { CHANNELS, channelDef, channelOf, classifyLine, isChannelKey, LINE_CLASSES, type ChannelDef, type ChannelKey, type ChannelKind, type LineClass } from "./channels";

// ---------------------------------------------------------------- Girdi

/** Kategorisi Komisyon olan fatura ve kalemleri (Paraşüt'ün kalemleri ya da e-faturanın UBL kalemleri) */
export interface CommissionInvoiceIn {
  id: number;
  date: string;
  supplier: string;
  /** Kanalı aranan adlar, sırayla: faturadaki ad, (yalnız ekranda) tedarikçi kartının adı ve diğer adları */
  names: string[];
  invoiceNo: string | null;
  /** KDV hariç, iskonto öncesi; amount − discount = KDV hariç tutar (Gelir-gider'in saydığı) */
  amount: number;
  discount: number;
  /** KDV dahil (Excel'den gelenlerde vat sütunu 0 olduğu için KDV = payable − net) */
  payable: number;
  needsReview: boolean;
  /** KDV hariç kalem tutarları; kalemi okunmamış faturada boş */
  lines: { name: string; description: string | null; netTotal: number }[];
}

/** Kasa raporunun günü: Z'deki yemek kartı ve online (platformlar) tutarı */
export interface TillDayIn {
  date: string;
  mealCard: number;
  online: number;
  /**
   * Raporun şubesi (yoksa Tuzla): LafPOS'un girdiği ayda LafPOS'un şubesinin raporu yalnız gün sonu gelmeyen günün
   * yedeğidir; ModPOS'ta kalan şubenin raporu kasa raporu kuralıyla sayılmaya devam eder (lafposMonth `modpos`)
   */
  branchId?: string | null;
}

/** LafPOS'un gün sonundaki bir ödeme türü (pos_day_reports.payments; docs/LAFPOS.md) */
export interface LafposPaymentIn {
  name: string;
  zField: "cash" | "card" | "meal_card" | "online" | "other";
  /** Komisyon kanalı (LafPOS'ta seçilen, lafposChannel ile tanınan); seçilmemiş ya da tanınmayan kanal null */
  channel: ChannelKey | null;
  /** LafPOS'ta yazılan kanal (tanınmayanın uyarısı için) */
  rawChannel: string | null;
  amount: number;
}

/** LafPOS'un bir iş günü (yalnız geçiş gününden sonraki günler): Z'deki yemek kartı ve online, ödeme türleri */
export interface LafposDayIn {
  date: string;
  mealCard: number;
  online: number;
  payments: LafposPaymentIn[];
}

/**
 * ModPOS föyünden bir kasa gününün markalı ödemeleri (src/lib/modpos/z.ts modposChannels; yalnız kanalı olanlar):
 * LafPOS'un girdiği ayda kasa raporu kuralıyla sayılan günün (geçiş gününden önce ya da ModPOS'ta kalan şubede) Z'deki
 * yemek kartı ve online toplamı föydeki markalara bölünür; föy Z'den fazlasını söylüyorsa o gün bölünmez
 */
export interface ModposBrandDay {
  date: string;
  /** Föyün şubesi (yoksa Tuzla) */
  branchId?: string | null;
  byChannel: Partial<Record<ChannelKey, number>>;
}

/** Yöneticinin bir kanal ve satış ayı için yazdığı: aylık ekstredeki satış, gelen hakediş, not (boş = yazılmadı) */
export interface ChannelMonthIn {
  channel: ChannelKey;
  month: string;
  sales: number | null;
  receivedOn: string | null;
  received: number | null;
  note: string | null;
}

export interface ChannelSettings {
  /** Hakedişin son günü: ayın son faturasının tarihi + bu kadar gün */
  payDays: number;
}

/** Komisyon faturası sorgusunun satırı (src/server/data/commission.ts): fatura ve LEFT JOIN'le kalemi; kalemsizde kalem alanları boş */
export interface CommissionInvoiceRow {
  id: number;
  date: string;
  supplier: string;
  supplierTaxNumber: string | null;
  invoiceNo: string | null;
  amount: number;
  discount: number;
  payable: number;
  needsReview: boolean;
  lineName: string | null;
  lineDescription: string | null;
  lineNet: number | null;
}

/**
 * Sorgunun satırları → faturalar ve kalemleri, sorgunun sırasıyla (fatura başına bir kayıt, kalemleri altında).
 * `names`: kanalın aranacağı adlar (faturadaki ad, tedarikçi kartının adı ve diğer adları); yoksa yalnız faturadaki ad.
 */
export function groupInvoiceRows(rows: readonly CommissionInvoiceRow[], names?: ((supplier: string, taxNumber: string | null) => string[]) | null): CommissionInvoiceIn[] {
  const byId = new Map<number, CommissionInvoiceIn>();
  for (const r of rows) {
    let inv = byId.get(r.id);
    if (!inv) {
      inv = {
        id: r.id,
        date: r.date,
        supplier: r.supplier,
        names: names ? names(r.supplier, r.supplierTaxNumber) : [r.supplier],
        invoiceNo: r.invoiceNo,
        amount: r.amount,
        discount: r.discount,
        payable: r.payable,
        needsReview: r.needsReview,
        lines: [],
      };
      byId.set(r.id, inv);
    }
    if (r.lineName !== null && r.lineNet !== null) inv.lines.push({ name: r.lineName, description: r.lineDescription, netTotal: r.lineNet });
  }
  return [...byId.values()];
}

export interface CommissionInput {
  /** Türkiye'de bugün (okumalardan sonra alınır) */
  today: string;
  /** Eksik kasa raporu günleri buna kadar aranır (dün: bugünün raporu akşam girilir) */
  through: string;
  /** Hakediş takibinin başladığı gün; öncesindeki son günler "takip öncesi" kalır, hiç alarm vermez */
  since: string;
  /** Pencerenin ilk ayı (`reportWindow`: 13 ay; ekran, zil, Bugün ve sabah e-postası aynı) */
  fromMonth: string;
  invoices: CommissionInvoiceIn[];
  till: TillDayIn[];
  /** İlk kasa raporunun günü: ay ortasında başlayan ayda Z toplamı ayın yalnız bir kısmıdır */
  firstReport: string | null;
  /** Kapalı işaretli günler (özel günlerin `kapali` satırı; dalga 10 §2.9): eksik rapor sayılmaz, ayrı yazılır */
  closed?: readonly string[];
  marks: ChannelMonthIn[];
  settings: Partial<Record<ChannelKey, Partial<ChannelSettings>>>;
  /**
   * LafPOS'a geçiş günü seçiliyse (docs/LAFPOS.md › Geçiş günü) geçiş günü ve pencerede o günden itibaren gelen gün
   * sonları; yoksa (varsayılan) yok: rapor bugünkü gibi yalnız kasa raporlarından. Geçiş gününden önceki LafPOS günleri
   * (deneme) buraya hiç girmez
   */
  lafpos?: { switchDay: string; days: LafposDayIn[] } | null;
  /** ModPOS föylerinin markalı ödemeleri (yalnız LafPOS'un girdiği aylarda okunur; yoksa markası bilinmez) */
  modposBrands?: ModposBrandDay[];
  /**
   * Şube seçiliyken şubenin açılışı (src/lib/cash-month.ts tillOpenedOn): sonradan açılan şubenin açılış ayı "kasa
   * raporları ay ortasında başladı" sayılmaz (partialStart; Marina 13 Kasım 2026'da açıldı). "Tümü"de ve verilmezse
   * bugünkü kural (ilk rapor ay ortasındaysa ay yarım)
   */
  openedOn?: TillOpening;
  /**
   * ModPOS'ta kalan şube seçiliyken (Tuzla; geçiş günü LafPOS'un şubesinin, commissionScopeDays) geçiş günü: o günün
   * ayından itibaren şubenin Z'sindeki yemek kartı ve online tek kanala yazılmaz ("Tümü"yle aynı kural): föyde markası
   * bulunan kısım kanalına (modposBrands), kalan "Marka belirsiz". "Tümü"de, LafPOS'un şubesinde ve geçiş günü yokken yok
   */
  modposScope?: { switchDay: string } | null;
  /** LafPOS'un şubesi (kütükten türetilmiş, lafposBranchId); verilmezse geri düşüş değeri */
  lafposBranch?: string;
}

/**
 * Komisyonun kapsama göre geçiş günleri (src/server/data/commission.ts loadCommissionInput): `lafpos` LafPOS'un gün
 * sonlarının okunduğu geçiş günü ("Tümü" ve LafPOS'un şubesi; scopeSwitchDay), `modpos` ModPOS'ta kalan şube seçiliyken
 * geçiş günü (CommissionInput.modposScope: o ayın başından itibaren Z tek kanala yığılmaz). Geçiş günü yoksa ikisi de null.
 * `lafposBranch`: LafPOS'un şubesi (verilmezse geri düşüş değeri)
 */
export function commissionScopeDays(switchDay: string | null, scope: string, lafposBranch?: string): { lafpos: string | null; modpos: string | null } {
  const lafpos = scopeSwitchDay(switchDay, scope, lafposBranch);
  return { lafpos, modpos: switchDay && !lafpos ? switchDay : null };
}

// ---------------------------------------------------------------- Çıktı

/** Satışın kaynağı: elle yazılan ekstre, LafPOS'un kanal kanal ödemeleri, grupta tek kanalken Z toplamı */
export type SalesSource = "elle" | "lafpos" | "tek";

/**
 * Kanal-ayın satışı. `foy` (yalnız `lafpos`): ModPOS föyünde markası bulunan kısım (geçiş gününden önceki ya da ModPOS'ta
 * kalan şubenin günleri); yoksa alan yok. Markası bilinmeyen tutar kanala yazılmaz (GroupMonth.unbranded)
 */
export interface ChannelSales {
  amount: number;
  source: SalesSource;
  foy?: number;
}
export type PayoutStatus = "geldi" | "eksik" | "bekliyor" | "gecikti" | "takip-oncesi" | "faturasiz" | "yok";
export type FlagKey = "oran-sinir" | "yasak-ucret" | "erken-odeme" | "asli-ucret" | "reklam" | "fatura-yok" | "fatura-kayan" | "kasa-eksik" | "lafpos-kanal";
export type FlagLevel = "bad" | "warn" | "info";

export interface Flag {
  key: FlagKey;
  level: FlagLevel;
  text: string;
}

export interface InvoiceLineView {
  name: string;
  description: string | null;
  /** Faturanın KDV hariç tutarına ölçeklenmiş tutar (kalemler toplanınca fatura tutarını verir) */
  amount: number;
  cls: LineClass;
}

export interface InvoiceView {
  id: number;
  date: string;
  invoiceNo: string | null;
  supplier: string;
  net: number;
  vat: number;
  payable: number;
  /** Faturanın sayıldığı satış ayı */
  month: string;
  /** Satış ayı fatura tarihinin ayı değilse: "3 Kasım tarihli fatura · Ekim satışları için" */
  coverNote: string | null;
  /** Kalemi okunmamış: tutarın tamamı komisyon sayıldı */
  lineless: boolean;
  needsReview: boolean;
  lines: InvoiceLineView[];
}

export interface Payout {
  /** Satış − kanalın faturaları (KDV dahil); satış bilinmiyorsa null */
  expected: number | null;
  /** Ayın son faturası + ödeme süresi; faturası yoksa null */
  due: string | null;
  received: number | null;
  receivedOn: string | null;
  status: PayoutStatus;
  /** Geldiyse son günden kaç gün sonra (geç geldiyse) */
  lateDays: number | null;
  /** Gecikmişse son günden bu yana gün */
  daysOverdue: number | null;
}

export interface ChannelMonth {
  channel: ChannelKey;
  label: string;
  kind: ChannelKind;
  month: string;
  invoices: InvoiceView[];
  /** Sınıf sınıf kesilen (KDV hariç) */
  fees: Record<LineClass, number>;
  feesTotal: number;
  vat: number;
  payable: number;
  sales: ChannelSales | null;
  /** Satış bilinmiyorsa nedeni ve ne yapılacağı */
  salesReason: string | null;
  /**
   * Yazılan satış silinirse kullanılacak satış (pencerenin ipucu): LafPOS'un girdiği ayda kanalın LafPOS ödemeleri (ve
   * föyde markalı ödemeleri), öncesinde (grupta tek kanal varsa) Z toplamı; yoksa null
   */
  autoSales: { amount: number; source: "lafpos" | "tek"; foy?: number } | null;
  rate: number | null;
  /**
   * Platform: seçilen ay ve önceki iki ayda satışı bilinen (en az iki) ayın toplam oranı; haftalık fatura ay sınırında
   * kayar. Seçilen ayın kendi oranı bilinmiyorsa null
   */
  rate3: number | null;
  payout: Payout;
  mark: ChannelMonthIn | null;
  flags: Flag[];
  /** Ayın en yeni faturasının günü */
  latestInvoice: string | null;
}

export interface GroupMonth {
  kind: ChannelKind;
  month: string;
  /** Z'deki yemek kartı (ya da online) toplamı; ayın kasa raporu yoksa null (raporu olan ayda 0 da olabilir) */
  zTotal: number | null;
  reportDays: number;
  missing: string[];
  /** Kapalı işaretli, raporsuz günler (eksik sayılmaz) */
  closed: string[];
  /** Kasa raporlarının ay ortasında başladığı gün (o ay Z toplamı eksiktir) */
  partialFrom: string | null;
  /** Ayın LafPOS'tan sayıldığı ilk gün (geçiş günü ya da ayın 1'i); LafPOS'un girmediği ayda null */
  lafposFrom: string | null;
  /**
   * Marka belirsiz (LafPOS'un girdiği ayda; öncesinde null): grubun hiçbir kanala yazılmayan tutarı. `pre` geçiş gününden
   * önceki günlerin, `modpos` ModPOS'ta kalan şubenin Z'si (föyde markası bulunan kısım hariç), `loose` LafPOS'ta kanalı
   * seçilmemiş ödeme, `fallback` gün sonu gelmemiş günün kasa raporu
   */
  unbranded: { amount: number; pre: number; modpos: number; loose: number; fallback: number } | null;
  invoiceCount: number;
  feesTotal: number;
  vat: number;
  payable: number;
  rate: number | null;
  expected: number | null;
  received: number;
  /** O ay etkin kanallar; faturası sonraki ayın 1–15'inde kesilen kanal da (bu ayın satışlarını kapsıyor olabilir) */
  activeChannels: ChannelKey[];
  latestInvoice: string | null;
  flags: Flag[];
}

export interface UnmatchedInvoice {
  id: number;
  date: string;
  supplier: string;
  invoiceNo: string | null;
  net: number;
}

export interface CommissionReport {
  today: string;
  since: string;
  /** LafPOS'a geçiş günü (seçilmediyse null: satış yalnız kasa raporlarından) */
  switchDay: string | null;
  /** Pencerenin ayları, eskiden yeniye */
  months: string[];
  /** Verisi olan ilk aydan bu aya (ay seçicinin listesi; veri yoksa yalnız bu ay) */
  dataMonths: string[];
  /** Faturası ya da işareti olan kanal-aylar */
  rows: ChannelMonth[];
  groups: GroupMonth[];
  unmatched: UnmatchedInvoice[];
  /** Gelmesi gereken para: gecikti, eksik geldi ya da son günü 7 gün içinde; en acil önce */
  pending: ChannelMonth[];
  /** Komisyon faturası olan son ay (yoksa bu ay) */
  defaultMonth: string;
  settings: Record<ChannelKey, ChannelSettings>;
}

// ---------------------------------------------------------------- Kurallar

/** Yönetmelik: yemek kartı komisyonu en çok %6; yuvarlamayı yutan pay */
export const MEAL_LIMIT = 0.06;
export const LIMIT_TOLERANCE = 0.0005;
/** Gelen hakediş beklenenden bu kadar azsa "eksik": en az 50 ₺, beklenenin %2'si */
export const PAYOUT_TOL = { abs: 50, rel: 0.02 } as const;
export const DEFAULT_PAY_DAYS = 30;
/** Yönetmelik: hakediş fatura tarihinden en geç 30 gün içinde */
export const MEAL_MAX_PAY_DAYS = 30;
export const PLATFORM_MAX_PAY_DAYS = 90;
/** Zil ve e-posta: oran ve ücret uyarısı ayın son faturası bu kadar günden yeniyse */
export const ALERT_INVOICE_DAYS = 45;
/** Zil ve e-postadaki en çok uyarı */
export const MAX_ALERTS = 5;
/** Ticaret Bakanlığı Genelgesi 2026/1: sipariş ve ödeme altyapısı için ayrı ücret bu günden beri alınamaz */
export const PLATFORM_RULES_FROM = "2026-04-01";
/** Faturası gelmeyen ay: sonraki ayın bu gününden sonra uyarılır */
export const INVOICE_GRACE_DAY = 15;
/** Yemek kartı faturası ayın ilk bu kadar gününde kesildiyse önceki ayın satışları içindir */
export const MEAL_PREVIOUS_MONTH_DAYS = 5;
/** Bekleyen hakedişler kartı: son günü bu kadar gün içinde olanlar da */
export const PENDING_SOON_DAYS = 7;
/**
 * Raporun penceresi, bu ay dahil: ekran, zil, Bugün ve sabah e-postası aynı ayları okur. Geciken hakediş işaretlenene
 * kadar gecikmiştir; zil, Bugün ve e-posta daha kısa bir pencere okursa satış ayı pencereden çıkınca (ay dönünce) uyarı
 * düşer, ödeme süresi 90 gün olan platformda hiç gelmezdi. Pencereden çıkan ay ekranda da yoktur.
 */
export const REPORT_MONTHS = 13;

const r2 = (v: number) => Math.round(v * 100) / 100;
const monthName = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1];
const overLimit = (rate: number | null) => rate !== null && rate > MEAL_LIMIT + LIMIT_TOLERANCE;
/** Satışı bilinmeyen ayın her nedeninin sonu: kanalın kendi ekranındaki satış yazılınca oran çıkar */
const TYPE_HINT = " Kanalın ekstresindeki satışı yazarsanız oran hesaplanır.";

/**
 * Pencerenin ilk ayı ve ilk günü (src/server/data/commission.ts loadCommissionInput): komisyon faturaları ve kasa
 * raporları `fromDay`'den, hakediş işaretleri `fromMonth`'tan okunur
 */
export function reportWindow(today: string): { fromMonth: string; fromDay: string } {
  const fromMonth = shiftMonth(today.slice(0, 7), -(REPORT_MONTHS - 1));
  return { fromMonth, fromDay: `${fromMonth}-01` };
}

/** [from, to] ayları */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Kaydedilmiş ayarlar + varsayılan (30 gün); yemek kartında en çok 30, platformda en çok 90 gün */
export function effectiveSettings(settings: Partial<Record<ChannelKey, Partial<ChannelSettings>>> | null | undefined): Record<ChannelKey, ChannelSettings> {
  const out = {} as Record<ChannelKey, ChannelSettings>;
  for (const c of CHANNELS) {
    const raw = Number(settings?.[c.key]?.payDays);
    const max = c.kind === "meal" ? MEAL_MAX_PAY_DAYS : PLATFORM_MAX_PAY_DAYS;
    out[c.key] = { payDays: Number.isFinite(raw) && raw >= 1 ? Math.min(max, Math.round(raw)) : DEFAULT_PAY_DAYS };
  }
  return out;
}

/**
 * İşletmenin hakedişinin ödeme süreleri: şubelerin (yemek kartı açık kasaların) süreleri kanal kanal, en kısası.
 * Faturalar, hakediş ve işaretleri işletmenin; hangi şubenin sözleşmesine düştükleri bilinmez. Son gün en erken şubenin
 * süresiyle hesaplanır: Komisyon & hakediş (seçici ne olursa olsun), zil, Bugün, sabah e-postası ve haftalık özet aynı
 * son günü görür, kısa süreli şubenin gecikmesi kaçmaz. Hiç şube yoksa kaydedilmemiş sayılır (30 gün).
 * Şubeler "aynı"yken (sahibin varsayılanı) değer tek şubeninkiyle aynıdır (docs/KOMISYON.md › Şube)
 */
export function businessPayDays(list: readonly (Partial<Record<ChannelKey, Partial<ChannelSettings>>> | null | undefined)[]): Record<ChannelKey, ChannelSettings> {
  const all = (list.length ? list : [null]).map(effectiveSettings);
  const out = {} as Record<ChannelKey, ChannelSettings>;
  for (const c of CHANNELS) out[c.key] = { payDays: Math.min(...all.map((s) => s[c.key].payDays)) };
  return out;
}

/** Kayıttaki kanal ayarı (integration_state › komisyon.ayar: { channels: { pluxee: { payDays: 30 } } }); bozuk ya da eski biçim yok sayılır */
export function parseCommissionSettings(value: unknown): Partial<Record<ChannelKey, ChannelSettings>> {
  const channels = (value as { channels?: unknown } | null)?.channels;
  if (!channels || typeof channels !== "object") return {};
  const out: Partial<Record<ChannelKey, ChannelSettings>> = {};
  for (const [key, v] of Object.entries(channels as Record<string, unknown>)) {
    const payDays = Number((v as { payDays?: unknown } | null)?.payDays);
    if (isChannelKey(key) && Number.isInteger(payDays) && payDays > 0) out[key] = { payDays };
  }
  return out;
}

/**
 * Faturanın sayıldığı satış ayı. Yemek kartı aylık ekstreyi ayın son günü ya da sonraki ayın ilk günlerinde keser:
 * ayın 1–5'inde kesilen yemek kartı faturası önceki ayın satışları içindir. Gelir-gider her faturayı kendi tarihinin
 * ayına yazar; bu ekran satışla faturayı aynı ayda karşılaştırmak için kendi kuralını kullanır.
 */
export function coverMonth(date: string, kind: ChannelKind): { month: string; note: string | null } {
  const own = date.slice(0, 7);
  if (kind === "meal" && Number(date.slice(8, 10)) <= MEAL_PREVIOUS_MONTH_DAYS) {
    const month = shiftMonth(own, -1);
    return { month, note: `${dayMonthTR(date)} tarihli fatura · ${monthName(month)} satışları için` };
  }
  return { month: own, note: null };
}

export interface ChannelTill {
  meal: number;
  online: number;
  reportDays: number;
  /** Raporu olmayan günler (ayın başı ya da ilk rapor → ayın sonu ya da dün); kapalı işaretliler hariç */
  missing: string[];
  /** Kapalı işaretli, raporsuz günler */
  closed: string[];
  partialFrom: string | null;
}

/**
 * Ayın kasa raporlarından Z'deki yemek kartı ve online toplamı; Kasa raporu ekranının ay kuralıyla aynı
 * (src/lib/cash-month.ts tillMonths): eksik günler ayın başından (ya da ilk rapordan) ayın sonuna ya da düne kadar
 * aranır, ilk rapor ayın ortasındaysa o ay yarımdır. `endDay`: ayın yalnız bu güne kadarki kısmı (geçiş ayında geçiş
 * gününden önceki günler; sonrası LafPOS'tan, lafposMonth). `openedOn`: şube görünümünde şubenin açılışı (partialStart:
 * sonradan açılan şubenin açılış ayı yarım sayılmaz).
 */
export function channelTill(
  rows: readonly TillDayIn[],
  month: string,
  through: string,
  firstReport: string | null,
  closedDays: readonly string[] = [],
  endDay?: string,
  openedOn?: TillOpening,
): ChannelTill {
  const start = `${month}-01`;
  const end = endDay ?? monthEnd(start);
  const list = rows.filter((r) => r.date.slice(0, 7) === month && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return { meal: 0, online: 0, reportDays: 0, missing: [], closed: [], partialFrom: null };
  const first = firstReport ?? list[0].date;
  const lastDate = list[list.length - 1].date;
  const from = first > start ? first : start;
  const upto = through > lastDate ? through : lastDate;
  const to = upto < end ? upto : end;
  const have = new Set(list.map((r) => r.date));
  const shut = new Set(closedDays);
  const missing: string[] = [];
  const closed: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!have.has(d)) (shut.has(d) ? closed : missing).push(d);
  return {
    meal: r2(list.reduce((a, r) => a + r.mealCard, 0)),
    online: r2(list.reduce((a, r) => a + r.online, 0)),
    reportDays: have.size,
    missing,
    closed,
    partialFrom: partialStart(month, first, openedOn),
  };
}

/** Bir grubun (yemek kartı ya da platform) ayın LafPOS günlerindeki ödemeleri */
export interface LafposGroupMonth {
  /** Kanal kanal (kanalın türü bu grup), KDV dahil */
  byChannel: Partial<Record<ChannelKey, number>>;
  /** Gün sonlarının Z'sindeki grup toplamı + gün sonu gelmemiş günlerin kasa raporundaki toplamı */
  total: number;
  /** Kanal kanal dağıtılamayan: kanalı seçilmemiş ya da tanınmayan ödeme türleri ve gün sonu gelmemiş günlerin kasa raporu */
  unassigned: number;
  /** Kanalı seçilmemiş ya da tanınmayan ödeme türleri, ad ve yazılan kanal başına (en çok ödenen önce) */
  loose: { name: string; channel: string | null; amount: number }[];
}

/**
 * Ayın LafPOS kısmı (denetim E-37): geçiş gününden (ya da ayın 1'inden) itibaren gelen gün sonları. Geçiş ayında
 * geçiş gününden önceki günler `pre`dir (kasa raporları; `tek` kuralı). Gün sonu gelmemiş günün kasa raporu varsa
 * grubun toplamı ondan gelir (kanal kanal bilinmez: `fallback`); ikisi de yoksa gün eksiktir.
 */
export interface LafposMonth {
  /** Ayın LafPOS'tan sayıldığı ilk gün: geçiş günü ya da ayın 1'i */
  from: string;
  /** Geçiş ayında geçiş gününden önceki günlerin kasa raporları; ay tamamen LafPOS'taysa null */
  pre: ChannelTill | null;
  /** Geçiş gününden önceki (kapalı olmayan) günlerin hiç kasa raporu yok: o günlerin satışı bilinmez */
  preUnknown: boolean;
  /** Gün sonu gelen günler */
  days: number;
  /** Gün sonu gelmemiş, kasa raporu olan günler */
  fallback: string[];
  /** Gün sonu da kasa raporu da olmayan günler (kapalı işaretliler hariç) */
  missing: string[];
  /** Kapalı işaretli, gün sonu ve raporu olmayan günler */
  closed: string[];
  meal: LafposGroupMonth;
  platform: LafposGroupMonth;
  /**
   * ModPOS'ta kalan şubelerin (geçiş günü yalnız LafPOS'un şubesinindir; Marina) bu günlerdeki kasa raporlarının Z
   * toplamı: kasa raporu kuralıyla (kanal kanal bilinmez, `pre` gibi) sayılır; yoksa null (denetim 21 Kasım #5)
   */
  modpos: { meal: number; online: number } | null;
  /**
   * ModPOS föyünde markası bulunan kısım, kanal kanal: geçiş gününden önceki günlerin (`pre`) ve ModPOS'ta kalan şubenin
   * (`modpos`) kasa raporlarından (ModposBrandDay). Kalan Z markası belirsizdir
   */
  branded: { pre: Partial<Record<ChannelKey, number>>; modpos: Partial<Record<ChannelKey, number>> };
}

const groupKindOf = (p: Pick<LafposPaymentIn, "channel" | "zField">): ChannelKind | null =>
  p.channel ? channelDef(p.channel).kind : p.zField === "meal_card" ? "meal" : p.zField === "online" ? "platform" : null;

/**
 * Ayın LafPOS kısmı; LafPOS'un girmediği ayda null: geçiş günü yok, ay geçiş gününden önce ya da geçiş günü henüz
 * gelmedi (o güne kadar ay bugünkü gibi kasa raporlarından). Ödeme kanalı olan tür kanalına (kanalın türü grubu
 * belirler), kanalsız ya da tanınmayan kanallı tür Z alanına göre gruba ("loose"); nakit, kart ve diğer komisyona girmez.
 */
export function lafposMonth(
  input: Pick<CommissionInput, "lafpos" | "till" | "through" | "firstReport" | "closed" | "modposBrands" | "openedOn" | "lafposBranch">,
  month: string,
): LafposMonth | null {
  const S = input.lafpos?.switchDay ?? null;
  if (!S) return null;
  const start = `${month}-01`;
  const end = monthEnd(start);
  if (S > end) return null;
  const from = S > start ? S : start;
  const days = (input.lafpos?.days ?? []).filter((d) => d.date >= from && d.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  if (!days.length && from > input.through) return null;
  const closedDays = input.closed ?? [];
  const shut = new Set(closedDays);
  const inMonth = input.till.filter((r) => r.date >= from && r.date <= end);
  // Gün sonunun yedeği yalnız LafPOS'un şubesinin raporu; ModPOS'ta kalan şubenin raporu ayrıca, kasa raporu kuralıyla
  const reports = new Map(inMonth.filter((r) => isLafposBranch(r.branchId, input.lafposBranch)).map((r) => [r.date, r]));
  const modposRows = inMonth.filter((r) => !isLafposBranch(r.branchId, input.lafposBranch));
  const modpos = modposRows.length ? { meal: r2(modposRows.reduce((a, r) => a + r.mealCard, 0)), online: r2(modposRows.reduce((a, r) => a + r.online, 0)) } : null;
  const have = new Set(days.map((d) => d.date));
  const lastSeen = [input.through, days.at(-1)?.date ?? from, ...reports.keys()].reduce((a, b) => (b > a ? b : a));
  const to = lastSeen < end ? lastSeen : end;
  const fallback: string[] = [];
  const missing: string[] = [];
  const closed: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (have.has(d)) continue;
    (reports.has(d) ? fallback : shut.has(d) ? closed : missing).push(d);
  }
  const groups: Record<ChannelKind, { byChannel: Partial<Record<ChannelKey, number>>; total: number; unassigned: number; loose: Map<string, LafposGroupMonth["loose"][number]> }> = {
    meal: { byChannel: {}, total: 0, unassigned: 0, loose: new Map() },
    platform: { byChannel: {}, total: 0, unassigned: 0, loose: new Map() },
  };
  for (const day of days) {
    groups.meal.total += day.mealCard;
    groups.platform.total += day.online;
    for (const p of day.payments) {
      const kind = groupKindOf(p);
      if (!kind || !(p.amount > 0)) continue;
      const g = groups[kind];
      if (p.channel) g.byChannel[p.channel] = (g.byChannel[p.channel] ?? 0) + p.amount;
      else {
        g.unassigned += p.amount;
        const key = `${p.name}|${p.rawChannel ?? ""}`;
        const l = g.loose.get(key) ?? { name: p.name, channel: p.rawChannel, amount: 0 };
        l.amount += p.amount;
        g.loose.set(key, l);
      }
    }
  }
  for (const d of fallback) {
    const r = reports.get(d)!;
    groups.meal.total += r.mealCard;
    groups.meal.unassigned += r.mealCard;
    groups.platform.total += r.online;
    groups.platform.unassigned += r.online;
  }
  const done = (g: (typeof groups)[ChannelKind]): LafposGroupMonth => ({
    byChannel: Object.fromEntries(Object.entries(g.byChannel).map(([k, v]) => [k, r2(v)])) as Partial<Record<ChannelKey, number>>,
    total: r2(g.total),
    unassigned: r2(g.unassigned),
    loose: [...g.loose.values()].map((l) => ({ ...l, amount: r2(l.amount) })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "tr")),
  });
  // ModPOS föyünde markası bulunan kısım: kasa raporu kuralıyla sayılan günler (geçiş gününden önce ya da ModPOS'ta kalan
  // şubede); yalnız föyün markalı tutarı Z'dekini aşmıyorsa (föy ile rapor tutmuyorsa o gün o grup belirsiz kalır)
  const preRows = from > start ? input.till.filter((r) => r.date >= start && r.date < from) : [];
  const branded = { pre: brandedOf(preRows, input.modposBrands), modpos: brandedOf(modposRows, input.modposBrands) };
  let pre: ChannelTill | null = null;
  let preUnknown = false;
  if (from > start) {
    const before = addDays(from, -1);
    pre = channelTill(input.till, month, input.through, input.firstReport, closedDays, before, input.openedOn);
    // Hiç raporu yok: geçiş gününden önceki açık günler (düne kadar) bilinmez. Şube görünümünde açılıştan önceki günler
    // aranmaz; açılış günü yazılmamış sonradan açılan şube (`true`) raporsuzsa geçiş gününde açılmıştır
    if (!pre.reportDays && input.openedOn !== true) {
      const until = before < input.through ? before : input.through;
      const opened = typeof input.openedOn === "string" && input.openedOn > start ? input.openedOn : start;
      for (let d = opened; d <= until; d = addDays(d, 1)) {
        if (!shut.has(d)) {
          preUnknown = true;
          break;
        }
      }
    }
  }
  return { from, pre, preUnknown, days: days.length, fallback, missing, closed, meal: done(groups.meal), platform: done(groups.platform), modpos, branded };
}

/**
 * Kasa raporu günlerinin föyde markası bulunan ödemeleri, kanal kanal (lafposMonth `branded`): gün ve şube başına föyün
 * markalı tutarı, grubun (yemek kartı ya da online) o günkü Z'sini aşmıyorsa kanala yazılır; aşıyorsa o gün o grup
 * markasız kalır (föy ile kasa raporu tutmuyor)
 */
function brandedOf(rows: readonly TillDayIn[], brands: readonly ModposBrandDay[] | undefined): Partial<Record<ChannelKey, number>> {
  const out: Partial<Record<ChannelKey, number>> = {};
  if (!brands?.length || !rows.length) return out;
  // Şubesi verilmeyen kayıt Tuzla'nındır (şubeler öncesi)
  const key = (date: string, branchId: string | null | undefined) => `${branchId ?? DEFAULT_BRANCH_ID}|${date}`;
  const byDay = new Map<string, Partial<Record<ChannelKey, number>>>();
  for (const b of brands) {
    const k = key(b.date, b.branchId);
    const cur = byDay.get(k) ?? {};
    for (const [ch, v] of Object.entries(b.byChannel) as [ChannelKey, number][]) if (v > 0) cur[ch] = (cur[ch] ?? 0) + v;
    byDay.set(k, cur);
  }
  for (const r of rows) {
    const day = byDay.get(key(r.date, r.branchId));
    if (!day) continue;
    for (const kind of ["meal", "platform"] as const) {
      const entries = (Object.entries(day) as [ChannelKey, number][]).filter(([ch]) => channelDef(ch).kind === kind);
      const sum = entries.reduce((a, [, v]) => a + v, 0);
      const z = kind === "meal" ? r.mealCard : r.online;
      if (!(sum > 0) || sum > z + 0.005) continue;
      for (const [ch, v] of entries) out[ch] = r2((out[ch] ?? 0) + v);
    }
  }
  return out;
}

/** Grubun (yemek kartı ya da platform) föyde markası bulunan toplamı */
const brandedTotal = (b: Partial<Record<ChannelKey, number>>, kind: ChannelKind) =>
  r2((Object.entries(b) as [ChannelKey, number][]).filter(([ch]) => channelDef(ch).kind === kind).reduce((a, [, v]) => a + v, 0));

/**
 * Grubun markası belirsiz tutarı (GroupMonth.unbranded): geçiş gününden önceki ve ModPOS'ta kalan şubenin Z'sinden föyde
 * markası bulunmayan kısım, LafPOS'ta kanalı seçilmemiş ödeme ve gün sonu gelmemiş günün kasa raporu
 */
export function unbrandedOf(lm: LafposMonth, kind: ChannelKind): NonNullable<GroupMonth["unbranded"]> {
  const g = kind === "meal" ? lm.meal : lm.platform;
  const preTotal = lm.pre ? (kind === "meal" ? lm.pre.meal : lm.pre.online) : 0;
  const modposTotal = lm.modpos ? (kind === "meal" ? lm.modpos.meal : lm.modpos.online) : 0;
  const pre = Math.max(0, r2(preTotal - brandedTotal(lm.branded.pre, kind)));
  const modpos = Math.max(0, r2(modposTotal - brandedTotal(lm.branded.modpos, kind)));
  const loose = r2(g.loose.reduce((a, l) => a + l.amount, 0));
  const fallback = Math.max(0, r2(g.unassigned - loose));
  return { amount: r2(pre + modpos + loose + fallback), pre, modpos, loose, fallback };
}

/**
 * ModPOS'ta kalan şube seçiliyken (CommissionInput.modposScope; Tuzla) geçiş ayından itibarenki ay: şubenin Z'sindeki
 * yemek kartı ve online tek toplamdır, "Tümü"de olduğu gibi tek kanala yazılmaz (23 Kasım 2026; eskiden şube görünümünde
 * `tek` kuralıyla yazılır, şubenin payı işletmenin faturasını aşabilirdi). Föyde markası bulunan kısım (brandedOf)
 * kanalına, kalan grubun markası belirsiz satırına. Toplam, eksik günler ve ay ortası kasa raporu kuralıyla (channelTill)
 */
export interface ModposScopeMonth {
  /** Föyde markası bulunan kısım, kanal kanal */
  branded: Partial<Record<ChannelKey, number>>;
}

/** ModPOS'ta kalan şubenin ayı (ModposScopeMonth); modposScope yoksa ya da ay geçiş ayından önceyse null */
export function modposScopeMonth(input: Pick<CommissionInput, "modposScope" | "till" | "modposBrands">, month: string): ModposScopeMonth | null {
  const S = input.modposScope?.switchDay;
  if (!S || month < S.slice(0, 7)) return null;
  return { branded: brandedOf(input.till.filter((r) => r.date.slice(0, 7) === month), input.modposBrands) };
}

/** ModPOS'ta kalan şubenin ayında grubun markası belirsiz tutarı: Z − föyde markası bulunan (GroupMonth.unbranded `modpos`) */
function modposScopeUnbranded(mm: ModposScopeMonth, till: ChannelTill, kind: ChannelKind): NonNullable<GroupMonth["unbranded"]> {
  const modpos = Math.max(0, r2((kind === "meal" ? till.meal : till.online) - brandedTotal(mm.branded, kind)));
  return { amount: modpos, pre: 0, modpos, loose: 0, fallback: 0 };
}

/**
 * LafPOS'un girdiği ayın grup toplamı (Yemek kartları kartı, Platformlar satırı): geçiş gününden önceki kasa raporları +
 * LafPOS + ModPOS'ta kalan şubenin kasa raporları
 */
function lafposTill(lm: LafposMonth): ChannelTill {
  const pre = lm.pre;
  return {
    meal: r2((pre?.meal ?? 0) + lm.meal.total + (lm.modpos?.meal ?? 0)),
    online: r2((pre?.online ?? 0) + lm.platform.total + (lm.modpos?.online ?? 0)),
    reportDays: (pre?.reportDays ?? 0) + lm.days + lm.fallback.length,
    missing: [...(pre?.missing ?? []), ...lm.missing],
    closed: [...(pre?.closed ?? []), ...lm.closed],
    // Toplam ayın bir kısmı: kasa raporları geçiş ayında geç başladı ya da geçiş gününden önce hiç yok
    partialFrom: pre?.partialFrom ?? (lm.preUnknown ? lm.from : null),
  };
}

/**
 * Faturanın görünümü: kalemler sınıflanır ve faturanın KDV hariç tutarına ölçeklenir (yuvarlama farkı ve fatura altı
 * iskonto sınıflara dağılır; sınıfların toplamı Gelir-gider'in saydığı tutardır). Tek kalemli faturanın "diğer"
 * kalemi komisyondur ("Hizmet faturası"); kalemsiz faturanın tamamı komisyon.
 */
export function invoiceView(inv: CommissionInvoiceIn, kind: ChannelKind): InvoiceView {
  const net = r2(inv.amount - inv.discount);
  const { month, note } = coverMonth(inv.date, kind);
  const raw = inv.lines.map((l) => ({ name: l.name, description: l.description, netTotal: l.netTotal, cls: classifyLine(`${l.name} ${l.description ?? ""}`, kind) }));
  if (raw.length === 1 && raw[0].cls === "diger") raw[0].cls = "komisyon";
  const sum = raw.reduce((a, l) => a + l.netTotal, 0);
  const k = Math.abs(sum) >= 0.01 ? net / sum : 1;
  const lines: InvoiceLineView[] = raw.map((l) => ({ name: l.name, description: l.description, amount: r2(l.netTotal * k), cls: l.cls }));
  // Kuruş farkı en büyük kaleme: kalemler faturanın tutarını tam versin
  const gap = r2(net - lines.reduce((a, l) => a + l.amount, 0));
  if (lines.length && gap !== 0 && Math.abs(sum) >= 0.01) {
    const big = lines.reduce((b, l, i) => (Math.abs(l.amount) > Math.abs(lines[b].amount) ? i : b), 0);
    lines[big] = { ...lines[big], amount: r2(lines[big].amount + gap) };
  }
  return {
    id: inv.id,
    date: inv.date,
    invoiceNo: inv.invoiceNo,
    supplier: inv.supplier,
    net,
    vat: r2(inv.payable - net),
    payable: r2(inv.payable),
    month,
    coverNote: note,
    lineless: !raw.length,
    needsReview: inv.needsReview,
    lines,
  };
}

const zeroFees = (): Record<LineClass, number> => ({ komisyon: 0, erken: 0, yasak: 0, asli: 0, reklam: 0, diger: 0 });

/** Faturaların sınıf sınıf toplamı; kalemsiz faturanın tamamı komisyon, kalemlerin tutmayan kuruşu da */
function feesOf(invoices: readonly InvoiceView[]): Record<LineClass, number> {
  const fees = zeroFees();
  for (const inv of invoices) {
    const counted = inv.lines.reduce((a, l) => a + l.amount, 0);
    for (const l of inv.lines) fees[l.cls] += l.amount;
    fees.komisyon += inv.net - counted;
  }
  for (const c of LINE_CLASSES) fees[c] = r2(fees[c]);
  return fees;
}

/** Sınıfın kalemleri adlarıyla, aynı ad birleşik: "“POS Cihaz Kira Bedeli” 150 ₺" (en çok iki ad, sonra "ve 2 kalem daha") */
export function namedLines(invoices: readonly InvoiceView[], cls: LineClass, filter: (inv: InvoiceView) => boolean = () => true): { text: string; total: number; ids: number[] } {
  const byName = new Map<string, number>();
  const ids = new Set<number>();
  for (const inv of invoices) {
    if (!filter(inv)) continue;
    for (const l of inv.lines) {
      if (l.cls !== cls) continue;
      const name = (l.name || l.description || "Kalem").trim();
      byName.set(name, (byName.get(name) ?? 0) + l.amount);
      ids.add(inv.id);
    }
  }
  const items = [...byName].sort((a, b) => b[1] - a[1]);
  const shown = items.slice(0, 2).map(([n, v]) => `“${n}” ${money(r2(v))}`).join(", ");
  const rest = items.length - 2;
  return { text: rest > 0 ? `${shown} ve ${rest} kalem daha` : shown, total: r2(items.reduce((a, [, v]) => a + v, 0)), ids: [...ids].sort((a, b) => a - b) };
}

/** Grupta (yemek kartı ya da platform) o ay etkin kanal: faturası, yazılmış satışı ya da gelen hakedişi olan */
function isActive(invoices: readonly InvoiceView[] | undefined, mark: ChannelMonthIn | null | undefined): boolean {
  return Boolean(invoices?.length) || (mark?.sales ?? 0) > 0 || (mark?.received ?? 0) > 0;
}

/** Grubun o ayki etkin kanalları: kendi verisiyle olanlar ve yalnız sonraki ayın ilk yarısındaki faturasıyla görünenler */
interface ActiveChannels {
  own: ChannelKey[];
  /** Faturası sonraki ayın 1–15'inde (bu ayın satışlarını da kapsıyor olabilir); en eski fatura günüyle */
  late: { key: ChannelKey; date: string }[];
}

/** Satışı bilinmeyen kanal-ayın nedeni (gri satır) */
function salesReason(kind: ChannelKind, month: string, till: ChannelTill, active: ActiveChannels, hasInvoice: boolean): string {
  if (!hasInvoice) return `Satış bilinmiyor.${TYPE_HINT}`;
  if (!till.reportDays) return `Satış bilinmiyor: bu ay kasa raporu yok.${TYPE_HINT}`;
  if (till.partialFrom) return `Satış bilinmiyor: kasa raporları ${dayLocativeTR(till.partialFrom)} başladı.${TYPE_HINT}`;
  const total = kind === "meal" ? "Z'de yemek kartları tek toplam" : "Z'deki online (platformlar) tek toplam";
  if (active.own.length >= 2) return `Satış bilinmiyor: ${total} ve bu ay ${active.own.length} ${kind === "meal" ? "kart" : "platform"} var.${TYPE_HINT}`;
  // Öteki kanalın bu aya ait faturası sonraki ayda kesilmiş: ekranda o ay kartı yok, bu yüzden adı ve günü yazılır
  const [late] = active.late;
  if (late) return `Satış bilinmiyor: ${total} ve ${dayMonthTR(late.date)} tarihli ${channelDef(late.key).label} faturası ${monthName(month)} satışlarını da kapsıyor olabilir.${TYPE_HINT}`;
  return kind === "meal"
    ? `Satış bilinmiyor: bu ayın kasa raporlarında yemek kartı tutarı yok.${TYPE_HINT}`
    : `Satış bilinmiyor: bu ayın kasa raporlarında Z'deki online (platformlar) tutarı yok.${TYPE_HINT}`;
}

/**
 * Ayın ekstresi gibi kesilmemiş en eski fatura: ayın son beş gününden önce ya da sonraki ayın beşinden sonra kesilen
 * (iade değil). Düzeltme ya da iki aylık fatura başka bir ayın ücretini de taşır; o ayda %6 aşımı kesin sayılmaz. Hepsi
 * ay sonunda kesildiyse null.
 */
export function offCycleInvoice(invoices: readonly Pick<InvoiceView, "date" | "net">[], month: string): string | null {
  const end = monthEnd(`${month}-01`);
  const from = addDays(end, -(MEAL_PREVIOUS_MONTH_DAYS - 1));
  const to = addDays(end, MEAL_PREVIOUS_MONTH_DAYS);
  const off = invoices.filter((i) => i.net > 0 && (i.date < from || i.date > to)).map((i) => i.date);
  return off.sort()[0] ?? null;
}

/** %6 aşımının neden kesin olmadığı: "Bazı günlerin kasa raporu eksik ve 15 Ekim tarihli fatura ay sonunda kesilmemiş …" */
function doubtText(gap: string | null, offCycle: string | null): string {
  const parts = [gap, offCycle ? `${dayMonthTR(offCycle)} tarihli fatura ay sonunda kesilmemiş, başka bir ayın ücretini de taşıyor olabilir` : null];
  const text = parts.filter((p): p is string => p !== null).join(" ve ");
  return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
}

/**
 * Hakediş: beklenen = satış − kanalın faturaları (KDV dahil; kanal komisyonu ve KDV'sini tutar, kalanı öder), son gün =
 * ayın son faturası + ödeme süresi. Banka hesabı panele bağlı olmadığı için "geldi"yi yönetici işaretler; takip
 * başlamadan (`since`) geçen son gün gecikme sayılmaz.
 */
export function payoutOf(
  cm: { sales: ChannelMonth["sales"]; payable: number; invoices: readonly Pick<InvoiceView, "date">[] },
  mark: ChannelMonthIn | null,
  payDays: number,
  today: string,
  since: string,
): Payout {
  const latest = cm.invoices.reduce<string | null>((a, i) => (a === null || i.date > a ? i.date : a), null);
  const due = latest ? addDays(latest, payDays) : null;
  const expected = cm.sales ? r2(cm.sales.amount - cm.payable) : null;
  const received = mark?.receivedOn && mark.received !== null ? mark.received : null;
  const receivedOn = received !== null ? mark!.receivedOn : null;
  const base = { expected, due, received, receivedOn, lateDays: null, daysOverdue: null };
  if (received !== null && receivedOn) {
    const tol = expected !== null ? Math.max(PAYOUT_TOL.abs, expected * PAYOUT_TOL.rel) : 0;
    const short = expected !== null && expected > 0 && received < expected - tol;
    const late = due && receivedOn > due ? daysBetween(due, receivedOn) : null;
    return { ...base, status: short ? "eksik" : "geldi", lateDays: late };
  }
  if (due === null) return { ...base, status: cm.sales && cm.sales.amount > 0 ? "faturasiz" : "yok" };
  if (expected !== null && expected <= 0) return { ...base, status: "yok" };
  if (today <= due) return { ...base, status: "bekliyor" };
  if (due >= since) return { ...base, status: "gecikti", daysOverdue: daysBetween(due, today) };
  return { ...base, status: "takip-oncesi" };
}

const LEVEL_ORDER: Record<FlagLevel, number> = { bad: 0, warn: 1, info: 2 };
const byLevel = (flags: Flag[]) => flags.map((f, i) => ({ f, i })).sort((a, b) => LEVEL_ORDER[a.f.level] - LEVEL_ORDER[b.f.level] || a.i - b.i).map((x) => x.f);

/**
 * LafPOS'un girdiği ayda kanalın satışı, yazılmadıysa (denetim E-37; docs/KOMISYON.md §3): kanalın LafPOS ödemeleri ve
 * ModPOS föyünde markası bulunan ödemeleri (geçiş gününden önceki günler, ModPOS'ta kalan şube). Markası bilinmeyen
 * tutar (Z'de grubun tek toplamı, kanalı seçilmemiş ödeme türü, gün sonu gelmemiş günün kasa raporu) grupta tek kanal
 * olsa da kanala yazılmaz (23 Kasım 2026; eskiden `tek` kuralıyla yazılırdı): grubun "Marka belirsiz" satırındadır,
 * kanalda "satış eksik kalmış olabilir" bilgisi çıkar (`gap`). Geçiş gününden önce hiç kasa raporu yoksa ya da raporlar
 * ay ortasında başladıysa ay bilinmez.
 */
function lafposSales(def: Pick<ChannelDef, "key" | "label" | "kind">, lm: LafposMonth, hasInvoice: boolean): { sales: ChannelSales | null; reason: string | null; gap: SalesGap | null } {
  const g = def.kind === "meal" ? lm.meal : lm.platform;
  const own = g.byChannel[def.key] ?? 0;
  const foy = r2((lm.branded.pre[def.key] ?? 0) + (lm.branded.modpos[def.key] ?? 0));
  const pre = lm.pre;
  const unknown = (reason: string) => ({ sales: null, reason: `${reason}${TYPE_HINT}`, gap: null });
  if (lm.preUnknown) return unknown(`Satış bilinmiyor: LafPOS ${dayLocativeTR(lm.from)} başladı, öncesinin kasa raporu yok.`);
  if (pre?.partialFrom) return unknown(`Satış bilinmiyor: kasa raporları ${dayLocativeTR(pre.partialFrom)} başladı.`);
  const ub = unbrandedOf(lm, def.kind);
  const zUnbranded = r2(ub.pre + ub.modpos);
  const amount = r2(own + foy);
  if (!(amount > 0)) {
    if (!hasInvoice) return unknown("Satış bilinmiyor.");
    const loose = g.loose.length ? " LafPOS'ta kanalı seçilmemiş ödeme türü var; türün kanalını seçin." : "";
    const unb = zUnbranded > 0 ? ` Z'de markası belirsiz ${money(zUnbranded)} var.` : "";
    return unknown(`Satış bilinmiyor: LafPOS'ta bu ay ${def.label} ödemesi yok.${loose}${unb}`);
  }
  // Eksik kalmış olabilecek: gün sonu gelmemiş (raporlu ya da raporsuz) günler, raporsuz günler, kanalsız ödeme ve Z'de
  // markası belirsiz tutar (hiçbiri kanala yazılmaz)
  const noLafpos = lm.missing.length + lm.fallback.length;
  const parts = [
    noLafpos ? `${noLafpos} gün LafPOS gün sonu yok` : null,
    pre?.missing.length ? `${pre.missing.length} gün kasa raporu yok` : null,
    ub.loose > 0 ? `kanalı seçilmemiş ${money(ub.loose)} ödeme var` : null,
    zUnbranded > 0 ? `Z'de markası belirsiz ${money(zUnbranded)} var` : null,
  ].filter((p): p is string => p !== null);
  const text = parts.join(" ve ");
  return { sales: { amount, source: "lafpos", ...(foy > 0 ? { foy } : {}) }, reason: null, gap: parts.length ? { text, doubt: text } : null };
}

/**
 * ModPOS'ta kalan şubenin geçiş ayından itibarenki ayında kanalın satışı, yazılmadıysa (ModposScopeMonth): föyde markası
 * bulunan ödemeleri (kaynak `lafpos`, `foy` = tutar: "ModPOS föyünden"); markası belirsiz Z kanala yazılmaz, kanalda "satış
 * eksik kalmış olabilir" bilgisi çıkar. Kasa raporu yoksa ya da raporlar ay ortasında başladıysa ay bilinmez
 */
function modposScopeSales(def: Pick<ChannelDef, "key" | "label" | "kind">, mm: ModposScopeMonth, till: ChannelTill, hasInvoice: boolean): { sales: ChannelSales | null; reason: string | null; gap: SalesGap | null } {
  const unknown = (reason: string) => ({ sales: null, reason: `${reason}${TYPE_HINT}`, gap: null });
  if (!hasInvoice && !((mm.branded[def.key] ?? 0) > 0)) return unknown("Satış bilinmiyor.");
  if (!till.reportDays) return unknown("Satış bilinmiyor: bu ay kasa raporu yok.");
  if (till.partialFrom) return unknown(`Satış bilinmiyor: kasa raporları ${dayLocativeTR(till.partialFrom)} başladı.`);
  const amount = r2(mm.branded[def.key] ?? 0);
  const unbranded = modposScopeUnbranded(mm, till, def.kind).amount;
  if (!(amount > 0)) {
    const unb = unbranded > 0 ? ` Z'de markası belirsiz ${money(unbranded)} var.` : "";
    return unknown(`Satış bilinmiyor: ModPOS föyünde bu ay ${def.label} ödemesi yok.${unb}`);
  }
  const parts = [till.missing.length ? `${till.missing.length} gün kasa raporu yok` : null, unbranded > 0 ? `Z'de markası belirsiz ${money(unbranded)} var` : null].filter(
    (p): p is string => p !== null,
  );
  const text = parts.join(" ve ");
  return { sales: { amount, source: "lafpos", foy: amount }, reason: null, gap: parts.length ? { text, doubt: text } : null };
}

/**
 * Satışın eksik kalmış olabileceği günler (Z toplamından ya da LafPOS'tan gelen satışta): `text` uyarının başı ("3 gün
 * kasa raporu yok"), `doubt` %6 aşımının neden kesin olmadığı ("bazı günlerin kasa raporu eksik")
 */
export interface SalesGap {
  text: string;
  doubt: string;
}

/**
 * Kanal-ayın uyarıları (sözcüklere bakanlar "olabilir" der; kesin hüküm değildir). `nextEarly`: kanalın sonraki ayın
 * ilk yarısında (en geç 15'i) kesilmiş en erken faturası: bu ayın satışlarını da kapsıyor olabilir ("fatura gelmedi" yerine)
 */
function channelFlags(cm: Omit<ChannelMonth, "flags" | "rate3">, gap: SalesGap | null, today: string, nextEarly: string | null = null): Flag[] {
  const flags: Flag[] = [];
  const sales = cm.sales;
  if (cm.kind === "meal") {
    if (overLimit(cm.rate) && sales) {
      // Yazılan ekstre kesindir; Z toplamı (tek kart) kartın satışından az olamaz, LafPOS kartın ödemelerini kendisi
      // yollar: aşım da kesindir. Yalnız raporu ya da gün sonu eksik günler varsa satış eksik kalmış olabilir; ay sonunda
      // kesilmeyen fatura da başka bir ayın ücretini taşıyabilir
      const offCycle = offCycleInvoice(cm.invoices, cm.month);
      const sure = !gap && !offCycle;
      flags.push({
        key: "oran-sinir",
        level: sure ? "bad" : "warn",
        text: `Toplam kesinti ${pct(cm.rate)}: yemek kartında yasal üst sınır %6.${sure ? "" : ` ${doubtText(gap?.doubt ?? null, offCycle)}; kesin değil, kontrol edin.`}`,
      });
    }
    if (cm.fees.yasak > 0) {
      const named = namedLines(cm.invoices, "yasak");
      flags.push({
        key: "yasak-ucret",
        level: "bad",
        text: `Komisyon dışı ücret olabilir: ${named.text}. Yönetmelik komisyon dışında kira, sarf malzemesi, teknik destek, bakım, depozito gibi adlarla ücret alınmasını yasaklıyor.`,
      });
    }
    if (cm.fees.erken > 0) {
      const share = sales && sales.amount > 0 ? ` (oranı ${pct(cm.fees.erken / sales.amount)} artırıyor)` : "";
      flags.push({ key: "erken-odeme", level: "warn", text: `Erken ödeme ücreti ${money(cm.fees.erken)}${share}. Erken ödemeyi siz mi seçtiniz? Seçmediyseniz kapattırın.` });
    }
  } else {
    const core = namedLines(cm.invoices, "asli", (inv) => inv.date >= PLATFORM_RULES_FROM);
    if (core.total > 0) {
      flags.push({ key: "asli-ucret", level: "warn", text: `${core.text}: sipariş ya da ödeme altyapısı ücreti olabilir. 1 Nisan 2026'dan beri bunlar için ayrı ücret alınamıyor.` });
    }
    if (cm.fees.reklam > 0) {
      flags.push({ key: "reklam", level: "info", text: `Reklam / kampanya ücreti olabilir: ${money(cm.fees.reklam)}. Bunlar isteğe bağlıdır; onay vermediyseniz itiraz edin.` });
    }
  }
  // Yazılan ekstre ya da LafPOS'un ödemeleri: kanaldan satış geçti ama ayın faturası gelmedi. LafPOS'un satışında sonraki
  // ayın ilk yarısında kesilen fatura bu ayın satışları için olabilir (kayan fatura; yemek kartında 1–5'i zaten bu aya
  // sayılır): uyarı değil bilgi. Yazılan ekstrenin uyarısı bugünkü gibi (geçiş günü boşken hiçbir şey değişmez)
  if ((sales?.source === "elle" || sales?.source === "lafpos") && sales.amount > 0 && !cm.invoices.length && today >= `${shiftMonth(cm.month, 1)}-${String(INVOICE_GRACE_DAY).padStart(2, "0")}`) {
    flags.push(
      nextEarly && sales.source === "lafpos"
        ? { key: "fatura-kayan", level: "info", text: `${dayMonthTR(nextEarly)} tarihli fatura ${monthName(cm.month)} satışlarını kapsıyor olabilir; ${monthName(shiftMonth(cm.month, 1))} ayında sayılıyor.` }
        : { key: "fatura-yok", level: "warn", text: `${monthName(cm.month)} ayında ${money(sales.amount)} satış var ama komisyon faturası gelmedi.` },
    );
  }
  // Oranı olan (faturası gelmiş) ayda: faturasız LafPOS kanalının satırında "oran yüksek görünür" anlamsız
  if (gap && cm.invoices.length) {
    flags.push({ key: "kasa-eksik", level: "info", text: `${gap.text.charAt(0).toLocaleUpperCase("tr-TR")}${gap.text.slice(1)}; satış eksik kaldıysa oran yüksek görünür.` });
  }
  return byLevel(flags);
}

/** Bir kanalın verisi (her ay: faturaları ve işareti) */
type ChannelData = Map<string, { invoices: InvoiceView[]; mark: ChannelMonthIn | null }>;

export function buildCommissionReport(input: CommissionInput): CommissionReport {
  const { today, through, since, fromMonth } = input;
  const current = today.slice(0, 7);
  const months = monthRange(fromMonth, current);
  const inWindow = new Set(months);
  const settings = effectiveSettings(input.settings);

  // 1. Faturalar: kanala, satış ayına
  const data = new Map<ChannelKey, ChannelData>(CHANNELS.map((c) => [c.key, new Map()]));
  const slot = (ch: ChannelKey, month: string) => {
    const d = data.get(ch)!;
    if (!d.has(month)) d.set(month, { invoices: [], mark: null });
    return d.get(month)!;
  };
  const unmatched: UnmatchedInvoice[] = [];
  for (const inv of input.invoices) {
    const ch = channelOf(inv.names);
    if (!ch) {
      if (inWindow.has(inv.date.slice(0, 7))) unmatched.push({ id: inv.id, date: inv.date, supplier: inv.supplier, invoiceNo: inv.invoiceNo, net: r2(inv.amount - inv.discount) });
      continue;
    }
    const view = invoiceView(inv, channelDef(ch).kind);
    if (inWindow.has(view.month)) slot(ch, view.month).invoices.push(view);
  }
  for (const m of input.marks) if (isChannelKey(m.channel) && inWindow.has(m.month)) slot(m.channel, m.month).mark = m;

  // 2. Ay ay kasa raporları; geçiş gününden itibaren LafPOS'un gün sonları (geçiş günü yoksa hiç okunmaz). ModPOS'ta kalan
  // şube seçiliyken geçiş ayından itibaren kasa raporları, föyün markasıyla (modposScope)
  const lafposMonths = new Map(months.map((m) => [m, lafposMonth(input, m)]));
  const modposMonths = new Map(months.map((m) => [m, lafposMonths.get(m) ? null : modposScopeMonth(input, m)]));
  const tills = new Map(
    months.map((m) => {
      const lm = lafposMonths.get(m);
      return [m, lm ? lafposTill(lm) : channelTill(input.till, m, through, input.firstReport, input.closed, undefined, input.openedOn)];
    }),
  );
  /** Kanalın o ayki LafPOS ödemeleri ve föyde markası bulunan ödemeleri (LafPOS'un ve föy kuralının girmediği ayda 0) */
  const lafposOwn = (c: Pick<ChannelDef, "key" | "kind">, month: string): number => {
    const lm = lafposMonths.get(month);
    if (lm) return ((c.kind === "meal" ? lm.meal : lm.platform).byChannel[c.key] ?? 0) + (lm.branded.pre[c.key] ?? 0) + (lm.branded.modpos[c.key] ?? 0);
    return modposMonths.get(month)?.branded[c.key] ?? 0;
  };
  // Etkin kanallar. Bir kanalın bu ayın satışları için faturası sonraki ayın ilk yarısında kesilebilir (ilk ayı, kayan
  // fatura): o kanal da sayılır, yoksa Z'deki toplamın tamamı öteki kanala yazılırdı (`tek`). LafPOS'ta ödemesi olan
  // kanal da etkindir
  const graceDay = String(INVOICE_GRACE_DAY).padStart(2, "0");
  const activeOf = (kind: ChannelKind, month: string): ActiveChannels => {
    const next = shiftMonth(month, 1);
    const own: ChannelKey[] = [];
    const late: ActiveChannels["late"] = [];
    for (const c of CHANNELS) {
      if (c.kind !== kind) continue;
      const d = data.get(c.key)!;
      if (isActive(d.get(month)?.invoices, d.get(month)?.mark) || lafposOwn(c, month) > 0) {
        own.push(c.key);
        continue;
      }
      const date = (d.get(next)?.invoices ?? []).map((i) => i.date).filter((x) => x <= `${next}-${graceDay}`).sort()[0];
      if (date) late.push({ key: c.key, date });
    }
    return { own, late };
  };

  // 3. Kanal-aylar: faturası ya da işareti olan; LafPOS'ta ödemesi olan kanal da (faturası gelmemiş olsa da)
  const rows: ChannelMonth[] = [];
  for (const month of months) {
    const till = tills.get(month)!;
    const lm = lafposMonths.get(month) ?? null;
    const mm = modposMonths.get(month) ?? null;
    for (const def of CHANNELS) {
      const d = data.get(def.key)!.get(month);
      if ((!d || (!d.invoices.length && !d.mark)) && !(lafposOwn(def, month) > 0)) continue;
      const invoices = [...(d?.invoices ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      const mark = d?.mark ?? null;
      const active = activeOf(def.kind, month);
      // Yazılmadıysa: LafPOS'un girdiği ayda kanalın ödemeleri, ModPOS'ta kalan şubenin geçiş ayından itibaren föyde markalı
      // ödemeleri, yoksa grupta tek kanalken Z toplamı
      let auto: ChannelSales | null;
      let reason: string | null;
      let gap: SalesGap | null;
      if (lm) {
        ({ sales: auto, reason, gap } = lafposSales(def, lm, invoices.length > 0));
      } else if (mm) {
        ({ sales: auto, reason, gap } = modposScopeSales(def, mm, till, invoices.length > 0));
      } else {
        const groupTotal = def.kind === "meal" ? till.meal : till.online;
        const tekOk = invoices.length > 0 && active.own.length === 1 && active.own[0] === def.key && !active.late.length && till.reportDays > 0 && !till.partialFrom && groupTotal > 0;
        auto = tekOk ? { amount: groupTotal, source: "tek" } : null;
        reason = auto ? null : salesReason(def.kind, month, till, active, invoices.length > 0);
        gap = till.missing.length ? { text: `${till.missing.length} gün kasa raporu yok`, doubt: "bazı günlerin kasa raporu eksik" } : null;
      }
      const typed = mark?.sales ?? null;
      const sales: ChannelSales | null = typed !== null ? { amount: typed, source: "elle" } : auto;
      const feesTotal = r2(invoices.reduce((a, i) => a + i.net, 0));
      const payable = r2(invoices.reduce((a, i) => a + i.payable, 0));
      const base = {
        channel: def.key,
        label: def.label,
        kind: def.kind,
        month,
        invoices,
        fees: feesOf(invoices),
        feesTotal,
        vat: r2(invoices.reduce((a, i) => a + i.vat, 0)),
        payable,
        sales,
        salesReason: sales ? null : reason,
        // LafPOS'ta föyden gelen payı da taşır (geçişten önceki ya da ModPOS'ta kalan şubenin günleri): pencere söyler
        autoSales: auto
          ? auto.source === "lafpos"
            ? { amount: auto.amount, source: "lafpos" as const, ...(auto.foy ? { foy: auto.foy } : {}) }
            : { amount: auto.amount, source: "tek" as const }
          : null,
        // İade (eksi) faturası ayın toplamını eksiye düşürürse oran yazılmaz
        rate: sales && sales.amount > 0 && invoices.length && feesTotal >= 0 ? feesTotal / sales.amount : null,
        payout: payoutOf({ sales, payable, invoices }, mark, settings[def.key].payDays, today, since),
        mark,
        latestInvoice: invoices.length ? invoices[invoices.length - 1].date : null,
      };
      // Eksik gün uyarısı yalnız satış Z toplamından ya da LafPOS'tan geldiyse (yazılan ekstre kesindir). Sonraki ayın
      // ilk yarısındaki fatura (activeOf'un kayan faturasıyla aynı sınır) "fatura gelmedi"yi bilgiye çevirir
      const next = shiftMonth(month, 1);
      const nextEarly = (data.get(def.key)!.get(next)?.invoices ?? []).map((i) => i.date).filter((x) => x <= `${next}-${graceDay}`).sort()[0] ?? null;
      rows.push({ ...base, rate3: null, flags: channelFlags(base, sales && sales.source !== "elle" ? gap : null, today, nextEarly) });
    }
  }

  // 4. Platformların 3 aylık oranı: seçilen ay ve önceki ikisi, satışı bilinen en az iki ay. Seçilen ayın kendi oranı
  // bilinmiyorsa yok: başlıktaki oran yalnız önceki aylardan gelip bu ayınki sanılmasın
  const knownRate = (x: ChannelMonth) => x.sales !== null && x.sales.amount > 0 && x.rate !== null;
  for (const r of rows) {
    if (r.kind !== "platform" || !knownRate(r)) continue;
    const window = new Set([shiftMonth(r.month, -2), shiftMonth(r.month, -1), r.month]);
    const known = rows.filter((x) => x.channel === r.channel && window.has(x.month) && knownRate(x));
    if (known.length < 2) continue;
    const fees = known.reduce((a, x) => a + x.feesTotal, 0);
    const sales = known.reduce((a, x) => a + x.sales!.amount, 0);
    r.rate3 = sales > 0 ? fees / sales : null;
  }

  // 5. Gruplar: yemek kartlarının toplamı (her zaman hesaplanır) ve platformların özeti
  const groups: GroupMonth[] = [];
  for (const kind of ["meal", "platform"] as const) {
    for (const month of months) {
      const till = tills.get(month)!;
      const kRows = rows.filter((r) => r.kind === kind && r.month === month);
      const invoiceCount = kRows.reduce((a, r) => a + r.invoices.length, 0);
      const total = kind === "meal" ? till.meal : till.online;
      // Kasa raporu olan ayın Z toplamı 0 da olsa bilinir ("0 ₺ · 31 / 31 gün raporlu", "kasa raporu yok" değil)
      if (!till.reportDays && !invoiceCount) continue;
      const zTotal = till.reportDays > 0 ? total : null;
      const feesTotal = r2(kRows.reduce((a, r) => a + r.feesTotal, 0));
      const payable = r2(kRows.reduce((a, r) => a + r.payable, 0));
      const usable = zTotal !== null && zTotal > 0 && !till.partialFrom;
      const rate = usable && invoiceCount > 0 && feesTotal >= 0 ? feesTotal / zTotal : null;
      const active = activeOf(kind, month);
      const activeChannels = CHANNELS.filter((c) => active.own.includes(c.key) || active.late.some((l) => l.key === c.key)).map((c) => c.key);
      const latestInvoice = kRows.map((r) => r.latestInvoice).filter((d): d is string => d !== null).sort().at(-1) ?? null;
      const flags: Flag[] = [];
      const lm = lafposMonths.get(month) ?? null;
      if (kind === "meal") {
        if (overLimit(rate)) {
          // Z toplamı yemek kartı satışından az olamaz: aşım kesindir. Yalnız eksik günde Z eksik kalmış, ay sonunda
          // kesilmeyen faturada ayın ücreti başka bir ayınkiyle karışmış olabilir; o zaman "olabilir" ve turuncu
          const gap = till.missing.length > 0 ? (lm ? `${till.missing.length} gün kasa raporu ya da LafPOS gün sonu yok` : "bazı günlerin kasa raporu eksik") : null;
          const offCycle = offCycleInvoice(kRows.flatMap((r) => r.invoices), month);
          const sure = !gap && !offCycle;
          const many = activeChannels.length >= 2;
          const lead = many ? `en az bir yemek kartı %6'yı aşıyor${sure ? "" : " olabilir"}.` : "yemek kartında yasal üst sınır %6.";
          const tail = sure ? "" : ` ${doubtText(gap, offCycle)}; ${many ? "" : "kesin değil, "}kontrol edin.`;
          flags.push({ key: "oran-sinir", level: sure ? "bad" : "warn", text: `Ortalama kesinti ${pct(rate)}: ${lead}${tail}` });
        }
        if (zTotal !== null && zTotal > 0 && !invoiceCount && today >= `${shiftMonth(month, 1)}-${String(INVOICE_GRACE_DAY).padStart(2, "0")}`) {
          flags.push({ key: "fatura-yok", level: "warn", text: `${monthLocativeTR(month)} ${money(zTotal)} yemek kartı satışı var ama hiçbir yemek kartı faturası gelmedi.` });
        }
      }
      // LafPOS'ta kanalı seçilmemiş ya da tanınmayan ödeme türü: kart kart satış o kadar eksik kalır
      const loose = lm ? (kind === "meal" ? lm.meal : lm.platform).loose : [];
      if (loose.length) {
        const shown = loose
          .slice(0, 3)
          .map((l) => `“${l.name}”${l.channel ? ` (kanal “${l.channel}”)` : ""} ${money(l.amount)}`)
          .join(", ");
        const more = loose.length > 3 ? ` ve ${loose.length - 3} tür daha` : "";
        flags.push({
          key: "lafpos-kanal",
          level: "info",
          // Tek kanal olsa da yazılmaz (23 Kasım 2026): markası belirsiz satırda durur
          text: `LafPOS'ta kanalı seçilmemiş ya da tanınmayan ödeme türü: ${shown}${more}. Bu tutar hiçbir ${kind === "meal" ? "karta" : "platforma"} yazılmaz, markası belirsiz satırda; LafPOS'ta ödeme türünün kanalını seçin.`,
        });
      }
      groups.push({
        kind,
        month,
        zTotal,
        reportDays: till.reportDays,
        missing: till.missing,
        closed: till.closed,
        partialFrom: till.partialFrom,
        lafposFrom: lm?.from ?? null,
        unbranded: lm ? unbrandedOf(lm, kind) : modposMonths.get(month) ? modposScopeUnbranded(modposMonths.get(month)!, till, kind) : null,
        invoiceCount,
        feesTotal,
        vat: r2(kRows.reduce((a, r) => a + r.vat, 0)),
        payable,
        rate,
        expected: usable && invoiceCount > 0 ? r2(zTotal - payable) : null,
        received: r2(kRows.reduce((a, r) => a + (r.payout.received ?? 0), 0)),
        activeChannels,
        latestInvoice,
        flags,
      });
    }
  }

  // 6. Bekleyen hakedişler (en acil önce) ve açılış ayı
  const soon = addDays(today, PENDING_SOON_DAYS);
  const pending = rows
    .filter((r) => r.payout.status === "gecikti" || r.payout.status === "eksik" || (r.payout.status === "bekliyor" && r.payout.due !== null && r.payout.due <= soon))
    .sort((a, b) => (a.payout.due ?? "9999").localeCompare(b.payout.due ?? "9999") || a.month.localeCompare(b.month));
  const invoiced = rows.filter((r) => r.invoices.length).map((r) => r.month);
  const defaultMonth = invoiced.length ? invoiced.sort().at(-1)! : current;
  const dataStart = [
    ...rows.map((r) => r.month),
    ...unmatched.map((u) => u.date.slice(0, 7)),
    ...months.filter((m) => tills.get(m)!.reportDays > 0),
  ].sort()[0];

  return {
    today,
    since,
    switchDay: input.lafpos?.switchDay ?? null,
    months,
    dataMonths: dataStart ? monthRange(dataStart, current) : [current],
    rows,
    groups,
    unmatched: unmatched.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    pending,
    defaultMonth,
    settings,
  };
}

// ---------------------------------------------------------------- Hakediş işareti (kayıt)

/** Kanal-ayın yazılan değerleri (Hakediş penceresi): gelen hakediş (gün ve tutar birlikte), ekstredeki satış, not */
export interface ChannelMonthValues {
  received: { on: string; amount: number } | null;
  sales: number | null;
  note: string | null;
}

/** Kaydın asıl değişikliği (bildirimin metni): hakediş işaretlendi, işaret kalktı, satış, not ya da hiçbiri */
export type ChannelMonthChange = "geldi" | "kaldirildi" | "satis" | "satis-silindi" | "not" | "yok";

/** Kayıttaki satırın değerleri (satır yoksa hepsi boş): "Geri al" bunları aynı eylemle yeniden yazar */
export function markValues(row: Pick<ChannelMonthIn, "receivedOn" | "received" | "sales" | "note"> | null | undefined): ChannelMonthValues {
  return {
    received: row?.receivedOn && row.received !== null ? { on: row.receivedOn, amount: row.received } : null,
    sales: row?.sales ?? null,
    note: row?.note ?? null,
  };
}

/**
 * Kaydın farkı: bildirimin türü (önce hakediş, sonra satış, sonra not) ve işlem geçmişinin metni (değişen her parça,
 * " · " ile; değişiklik yoksa null). `label`: "Pluxee Ekim 2026".
 */
export function channelMonthChange(prev: ChannelMonthValues, next: ChannelMonthValues, label: string): { change: ChannelMonthChange; log: string | null } {
  const receivedChanged = (prev.received?.on ?? null) !== (next.received?.on ?? null) || (prev.received?.amount ?? null) !== (next.received?.amount ?? null);
  const salesChanged = prev.sales !== next.sales;
  const noteChanged = prev.note !== next.note;
  const parts: string[] = [];
  if (receivedChanged) {
    parts.push(next.received ? `Hakediş geldi: ${label} · ${money(next.received.amount)} (${dayMonthTR(next.received.on)})` : `Hakediş işareti kaldırıldı: ${label}`);
  }
  if (salesChanged) parts.push(`Komisyon kanalı satışı: ${label} → ${next.sales === null ? "boş" : money(next.sales)}`);
  if (noteChanged) parts.push(`Not: ${label} → ${next.note ?? "boş"}`);
  const change: ChannelMonthChange = receivedChanged ? (next.received ? "geldi" : "kaldirildi") : salesChanged ? (next.sales === null ? "satis-silindi" : "satis") : noteChanged ? "not" : "yok";
  return { change, log: parts.length ? parts.join(" · ") : null };
}

// ---------------------------------------------------------------- Ekran yardımcıları

/** Kanalın o ayki satırı (yoksa null) */
export function rowOf(report: Pick<CommissionReport, "rows">, channel: ChannelKey, month: string): ChannelMonth | null {
  return report.rows.find((r) => r.channel === channel && r.month === month) ?? null;
}

/** Şube görünümünde bir kanalın şube payı (branchCommissionShare) */
export interface BranchShareRow {
  channel: ChannelKey;
  label: string;
  kind: ChannelKind;
  /** Şubenin bu kanaldan satışı (şubenin kasa raporları ve LafPOS'u); bilinmiyorsa null */
  sales: number | null;
  /** İşletmenin oranı: bütün faturalar ÷ bütün şubelerin satışı (faturalar şubeye bölünmez) */
  rate: number | null;
  /** Şubenin komisyon payı = şube satışı × işletmenin oranı; ikisinden biri yoksa null */
  commission: number | null;
}

/**
 * Şube görünümü (Komisyon & hakediş; 23 Kasım 2026): faturalar, hakediş ve oran işletme genelidir (`all`: "Tümü"nün
 * raporu); şubenin satışı şubenin raporundan (`branch`: şube seçimiyle okunan kasa raporları, LafPOS ve föy). Şubenin payı
 * = şube satışı × işletmenin oranı. Elle yazılan ekstre satışı işletmenindir (commission_months şubesiz): şubenin satışı
 * olarak değil, şubenin kendi kaynağından (`autoSales`) okunur; yoksa bütün ekstre her şubenin payına girerdi. Ayda iki
 * rapordan birinde satırı olan kanallar, kayıt sırasıyla
 */
export function branchCommissionShare(
  all: Pick<CommissionReport, "rows">,
  branch: Pick<CommissionReport, "rows">,
  month: string,
): BranchShareRow[] {
  return CHANNELS.flatMap((c): BranchShareRow[] => {
    const a = rowOf(all, c.key, month);
    const b = rowOf(branch, c.key, month);
    if (!a && !b) return [];
    const sales = b?.autoSales ? b.autoSales.amount : null;
    const rate = a?.rate ?? null;
    return [{ channel: c.key, label: c.label, kind: c.kind, sales, rate, commission: sales !== null && rate !== null ? r2(sales * rate) : null }];
  });
}

/** Grubun o ayki özeti (yoksa null) */
export function groupOf(report: Pick<CommissionReport, "groups">, kind: ChannelKind, month: string): GroupMonth | null {
  return report.groups.find((g) => g.kind === kind && g.month === month) ?? null;
}

/** Ekranda kartı çıkan kanallar: seçilen ayda ya da önceki beş ayda faturası ya da işareti olan, kayıt sırasıyla */
export function shownChannels(report: Pick<CommissionReport, "rows">, kind: ChannelKind, month: string): ChannelKey[] {
  const from = shiftMonth(month, -5);
  const seen = new Set(report.rows.filter((r) => r.kind === kind && r.month >= from && r.month <= month).map((r) => r.channel));
  return CHANNELS.filter((c) => c.kind === kind && seen.has(c.key)).map((c) => c.key);
}

/** Geciken hakedişler, en eski son gün önce (Bugün) */
export function overduePayouts(report: Pick<CommissionReport, "rows">): ChannelMonth[] {
  return report.rows.filter((r) => r.payout.status === "gecikti").sort((a, b) => (a.payout.due ?? "").localeCompare(b.payout.due ?? "") || a.label.localeCompare(b.label, "tr"));
}

// ---------------------------------------------------------------- Zil, sabah e-postası

export interface CommissionAlert {
  kind: "gecikti" | "oran" | "yasak";
  /** Tekil anahtar: gerçekleri taşır (yeni oran ya da yeni fatura yeniden okunmamış ve yeniden e-postalık olur) */
  key: string;
  level: "danger" | "warning";
  title: string;
  body: string;
  href: string;
  /** Son gün (hakediş) ya da ayın son faturası (oran, ücret) */
  date: string;
  /**
   * Yalnız özet satırında: içine aldığı gecikmelerin anahtarları. Zil özeti okununca bunları da okundu sayar: biri
   * sonra tek satıra çıkınca (öncekiler geldi işaretlendi) yeniden okunmamış olmaz
   */
  covers?: string[];
}

/** "~8.605,20 ₺" yemek kartında; platformda "yaklaşık …" (haftalık fatura ay sınırında kayar) */
export function approxMoney(kind: ChannelKind, v: number): string {
  return kind === "platform" ? `yaklaşık ${money(v)}` : `~${money(v)}`;
}

/**
 * Zilin (Faturalar başlığı) ve sabah e-postasının uyarıları: geciken hakedişler; ayın son faturası 45 günden yeniyse
 * yemek kartında kesin %6 aşımı ve komisyon dışı ücret; kart kart oran yokken yemek kartlarının toplamının aşımı.
 * Önce gecikenler, en eski son gün önce (en acili; denetim E-68: en yeniler önce gelince en eski gecikme beşin dışında
 * kalıp zile hiç düşmüyordu); sonra öteki uyarılar, en yenisi önce. En çok beş (`limit`: e-posta önce daha önce
 * gönderilenleri eler, sonra keser). Geciken hakedişler sınıra sığmazsa son yer özet olur ("3 hakediş daha gecikti"):
 * en eskiler tek tek, kalanların sayısı ve adları tek satırda; zilde hiçbir gecikme sessizce düşmez.
 */
export function commissionAlerts(report: Pick<CommissionReport, "rows" | "groups">, today: string, limit: number = MAX_ALERTS): CommissionAlert[] {
  const out: CommissionAlert[] = [];
  /** Geciken hakedişin kısa adı (özet satırı): "Pluxee (Eylül)" */
  const lateName = new Map<string, string>();
  const recent = addDays(today, -ALERT_INVOICE_DAYS);
  for (const r of report.rows) {
    const mon = monthName(r.month);
    const href = `/panel/komisyonlar?ay=${r.month}#${r.channel}`;
    const p = r.payout;
    if (p.status === "gecikti" && p.due) {
      lateName.set(`gecikti:${r.channel}:${r.month}`, `${r.label} (${mon})`);
      out.push({
        kind: "gecikti",
        key: `gecikti:${r.channel}:${r.month}`,
        level: "danger",
        title: `Hakediş gecikti: ${r.label} (${mon})`,
        body: `Son gün ${dayMonthTR(p.due)}${p.expected !== null ? ` · beklenen ${approxMoney(r.kind, p.expected)}` : ""}. Geldiyse işaretleyin.`,
        href,
        date: p.due,
      });
    }
    if (!r.latestInvoice || r.latestInvoice < recent) continue;
    if (r.rate !== null && r.flags.some((f) => f.key === "oran-sinir" && f.level === "bad")) {
      out.push({
        kind: "oran",
        key: `oran:${r.channel}:${r.month}:${Math.round(r.rate * 1000)}`,
        level: "warning",
        title: `${r.label} ${mon}: kesinti ${pct(r.rate)}`,
        body: "Yemek kartında yasal üst sınır %6.",
        href,
        date: r.latestInvoice,
      });
    }
    if (r.flags.some((f) => f.key === "yasak-ucret")) {
      const named = namedLines(r.invoices, "yasak");
      out.push({
        kind: "yasak",
        key: `yasak:${r.channel}:${r.month}:${named.ids.join(".")}`,
        level: "warning",
        title: `${r.label} ${mon}: komisyon dışı ücret olabilir`,
        body: named.text,
        href,
        date: r.latestInvoice,
      });
    }
  }
  // Kart kart oran bilinmiyorsa toplam söyler: ortalama %6'yı aşıyorsa en az bir kart aşıyordur
  for (const g of report.groups) {
    if (g.kind !== "meal" || g.rate === null || !g.latestInvoice || g.latestInvoice < recent) continue;
    if (!g.flags.some((f) => f.key === "oran-sinir" && f.level === "bad")) continue;
    if (report.rows.some((r) => r.kind === "meal" && r.month === g.month && r.flags.some((f) => f.key === "oran-sinir" && f.level === "bad"))) continue;
    out.push({
      kind: "oran",
      key: `oran:yemek-kartlari:${g.month}:${Math.round(g.rate * 1000)}`,
      level: "warning",
      title: `Yemek kartları ${monthName(g.month)}: ortalama kesinti ${pct(g.rate)}`,
      body: g.activeChannels.length >= 2 ? "En az bir yemek kartı yasal üst sınır %6'yı aşıyor." : "Yemek kartında yasal üst sınır %6.",
      href: `/panel/komisyonlar?ay=${g.month}#yemek-kartlari`,
      date: g.latestInvoice,
    });
  }
  const late = out.filter((a) => a.kind === "gecikti").sort((a, b) => a.date.localeCompare(b.date));
  const rest = out.filter((a) => a.kind !== "gecikti").sort((a, b) => b.date.localeCompare(a.date));
  if (late.length <= limit) return [...late, ...rest].slice(0, limit);
  const shown = late.slice(0, Math.max(0, limit - 1));
  const hidden = late.slice(shown.length);
  return limit >= 1 ? [...shown, lateSummary(hidden, lateName)] : [];
}

/** Zile sığmayan geciken hakedişlerin tek satırı: sayı, ilk üçünün adı, en eskisinin son günü */
function lateSummary(hidden: readonly CommissionAlert[], names: ReadonlyMap<string, string>): CommissionAlert {
  const labels = hidden.map((a) => names.get(a.key) ?? a.title);
  const more = labels.length - 3;
  return {
    kind: "gecikti",
    // Anahtar gizlenenlerin en yenisinden (en eski son gün önce sıralı; sonuncusu): yeni bir gecikme özeti yeniden
    // okunmamış yapar, eskiler "geldi" işaretlenip liste kısalınca anahtar değişmez
    key: `gecikti-diger:${hidden[hidden.length - 1].key.slice("gecikti:".length)}`,
    covers: hidden.map((a) => a.key),
    level: "danger",
    title: `${hidden.length} hakediş daha gecikti`,
    body: `${labels.slice(0, 3).join(", ")}${more > 0 ? ` ve ${more} hakediş daha` : ""}. Hepsi Komisyon & hakediş'te ve Bugün'de.`,
    href: "/panel/komisyonlar",
    date: hidden[0].date,
  };
}

/** Uyarının sabah e-postası günlüğündeki anahtarı (notification_log): "komisyon:gecikti:pluxee:2026-10" */
export const commissionLogKey = (alert: Pick<CommissionAlert, "key">): string => `komisyon:${alert.key}`;

/**
 * E-postaya girecek uyarılar: daha önce gönderilenler (anahtarı günlükte olanlar) önce elenir, sonra en çok `max`.
 * Sıra tersine olsaydı gönderilmiş beş uyarı yeni olanları her sabah dışarıda bırakırdı.
 */
export function freshAlerts(alerts: readonly CommissionAlert[], sent: ReadonlySet<string>, max: number = MAX_ALERTS): CommissionAlert[] {
  return alerts.filter((a) => !sent.has(commissionLogKey(a))).slice(0, max);
}

/**
 * Sabah e-postasının "Komisyon ve hakediş" kutusu (src/server/notify/digest-extras.ts): yeni (daha önce e-postayla
 * bildirilmemiş) uyarılar; yoksa null. Konu: tek gecikme "Hakediş gecikti: Pluxee (Ekim)", birden çoğu "2 hakediş
 * gecikti", gecikme yoksa "komisyon uyarısı".
 */
export function commissionDigestBox(alerts: readonly CommissionAlert[]): DigestBox | null {
  if (!alerts.length) return null;
  const late = alerts.filter((a) => a.kind === "gecikti");
  const subjectPart = late.length === 1 ? late[0].title : late.length > 1 ? `${late.length} hakediş gecikti` : "komisyon uyarısı";
  return {
    title: "Komisyon ve hakediş",
    lines: alerts.map((a) => ({ strong: a.title, text: a.body, tone: a.level === "danger" ? ("bad" as const) : ("warn" as const) })),
    href: "/panel/komisyonlar",
    link: "Komisyon & hakediş'te aç",
    subjectPart,
    headline: alerts.length === 1 ? alerts[0].title : late.length > 1 ? `${late.length} hakediş gecikti` : late.length === 1 ? late[0].title : "Komisyon uyarıları",
  };
}
