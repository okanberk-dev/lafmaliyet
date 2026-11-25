/**
 * Faturanın kalan borcu: bütün ekranların tek kuralı (Kalan borç, Ödemeler, Nakit planı, zil, sabah e-postası, Bugün,
 * Genel bakış, Claude, dışa aktarım). Saf; istemci ve sunucu birlikte kullanır (tests/cari-bakiye.test.ts).
 *
 * İki kip (docs/TEDARIKCILER.md "Hesap hareketleri"):
 * - Takipsiz (`ledgerBase` boş): bugünkü kural, harfi harfine. Ödenmemiş faturada Paraşüt'ün kalanı (`outstanding`)
 *   0'dan büyükse o, değilse Ödenecek'in tamamı; iade (eksi) de öyle.
 * - Takipli (`ledgerBase` dolu; kart ilk cari ödemesini alınca): kalan = Ödenecek − takip öncesi Paraşüt'te ödenen
 *   (`ledgerBase`) − panelde sayılan (`allocated`). Paraşüt'ün kalanı yalnız ipucu olur.
 *
 * Hiç cari kaydı yokken bütün faturalarda `ledgerBase` boş ve `allocated` 0'dır: sonuç bugünküyle aynıdır.
 */

/** Kapanış toleransı: kalan bundan küçükse kapanmış sayılır (para kuruşa yuvarlanır) */
export const EPS = 0.005;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BalanceInvoice {
  /** Ödenecek, KDV dahil (iade eksi) */
  payable: number;
  unpaid: boolean;
  /** Paraşüt'ün bildirdiği kalan (kısmen ödenmişte) */
  outstanding?: number | null;
  /** Bu faturaya sayılan cari ödemelerin toplamı */
  allocated?: number | null;
  /** Panel takibinin başladığı andaki Paraşüt'te ödenen kısım; boşsa takipsiz */
  ledgerBase?: number | null;
}

const tracked = (i: BalanceInvoice) => i.ledgerBase !== null && i.ledgerBase !== undefined;

/** Ödenmemiş faturanın kalan borcu (KDV dahil); ödenmiş faturada 0. Ödenmemiş iade eksi döner (düşülecek alacak). */
export function openBalance(i: BalanceInvoice): number {
  if (!i.unpaid) return 0;
  if (!tracked(i)) return i.outstanding !== null && i.outstanding !== undefined && i.outstanding > 0 ? i.outstanding : i.payable;
  // İade dağıtım almaz: düşülecek alacak olarak kalır
  if (i.payable <= 0) return i.payable;
  return round2(Math.max(0, i.payable - (i.ledgerBase ?? 0) - (i.allocated ?? 0)));
}

/** Kısmen ödenmiş: kalan 0'dan büyük ve Ödenecek'ten az */
export function isPartiallyPaid(i: BalanceInvoice): boolean {
  if (!tracked(i)) return i.unpaid && i.outstanding !== null && i.outstanding !== undefined && i.outstanding > 0 && i.outstanding < i.payable - EPS;
  const b = openBalance(i);
  return i.unpaid && b > EPS && b < i.payable - EPS;
}

/**
 * Paraşüt ipucu (§4.2; yalnız takipli ödenmemiş fatura): Paraşüt'ün kalanı panelin kalanından farklıysa ikisi.
 * `lower`: Paraşüt daha az kalan gösteriyor (panelde girilmemiş bir ödeme olabilir). Fark yoksa ya da takipsizse null
 */
export function parasutDifference(i: BalanceInvoice): { parasut: number; panel: number; lower: boolean } | null {
  if (!tracked(i) || !i.unpaid || i.outstanding === null || i.outstanding === undefined || !(i.outstanding > EPS)) return null;
  const panel = openBalance(i);
  if (Math.abs(i.outstanding - panel) <= EPS) return null;
  return { parasut: i.outstanding, panel, lower: i.outstanding < panel };
}

/** Panelde bu faturaya sayılan (takip öncesi Paraşüt'te ödenen hariç) */
export const paidInPanel = (i: BalanceInvoice) => round2(i.allocated ?? 0);

/** Dağıtım faturayı tamamen karşılıyor mu (takipli, Ödenecek > 0) */
export function coveredByAllocations(i: BalanceInvoice): boolean {
  return tracked(i) && i.payable > 0 && i.payable - (i.ledgerBase ?? 0) - (i.allocated ?? 0) <= EPS;
}

/**
 * Takip başlarken faturaya yazılan taban: ödenmemiş ve Paraşüt'te kısmen ödenmiş faturada Paraşüt'ün o ana kadar
 * ödendi gösterdiği kısım (Ödenecek − kalan), ötekilerde 0
 */
export function trackingBase(i: Pick<BalanceInvoice, "payable" | "unpaid" | "outstanding">): number {
  if (i.unpaid && i.outstanding !== null && i.outstanding !== undefined && i.outstanding > 0) return round2(Math.max(0, i.payable - i.outstanding));
  return 0;
}

/**
 * Takipli karta sonradan gelen faturanın tabanı (§4.2). Takip başlamadan (`since`: kartın ilk ödeme kaydının günü)
 * önceki tarihli fatura ("Geçmiş faturaları al", geç girilmiş eski fatura) takip başlarken panelde olsaydı alacağı
 * tabanı alır (trackingBase: Paraşüt'te ödenen kısım); o gün ve sonrasının faturasında Paraşüt'ün kısmi ödemesi
 * panelin ödemesi olabilir: 0, yalnız panel sayar
 */
export function arrivalBase(i: Pick<BalanceInvoice, "payable" | "unpaid" | "outstanding"> & { date: string }, since: string): number {
  return i.date < since ? trackingBase(i) : 0;
}

/**
 * Peşin çalışılan takipli kartın eşitlemeyle gelen yeni faturası hesaptaki parayı (avansı) alır mı (K21): yalnız ödenmiş
 * gelen ve takip günü ya da sonrasının faturası. Takip başlamadan önceki tarihli fatura ("Geçmiş faturaları al", geç
 * girilmiş eski fatura) kendi gününde kapıda ödenmiştir: avans ona sayılırsa hesaptaki para eksilir, tedarikçi o kadar az
 * borçlu görünürdü (denetim 26 Eki, E-14)
 */
export function takesCreditOnArrival(i: { date: string; unpaid: boolean }, since: string): boolean {
  return !i.unpaid && i.date >= since;
}

// ---------------------------------------------------------------- Ödeme şekli

/** Cari ödemenin şekli (supplier_entries.method) */
export type CariMethod = "kasa" | "elden" | "havale" | "kart" | "cek" | "diger";

export const CARI_METHODS = ["kasa", "elden", "havale", "kart", "cek", "diger"] as const satisfies readonly CariMethod[];

export const METHOD_LABEL: Record<CariMethod, string> = {
  kasa: "Kasadan",
  elden: "Elden (kasa dışı)",
  havale: "Havale / EFT",
  kart: "Kart",
  cek: "Çek / senet",
  diger: "Diğer",
};

/** Faturanın ödeme şekli (invoices.paidVia) */
export type InvoicePaidVia = "havale" | "nakit" | "kart" | "cek" | "diger";

/** Defterin kapattığı faturaya yazılan ödeme şekli: kasa ve elden nakittir */
export function paidViaOf(m: CariMethod): InvoicePaidVia {
  switch (m) {
    case "kasa":
    case "elden":
      return "nakit";
    case "havale":
      return "havale";
    case "kart":
      return "kart";
    case "cek":
      return "cek";
    case "diger":
      return "diger";
  }
}

/** Kartın ödeme şeklinden cari ödemenin varsayılan şekli: "Nakit" kasa dışı elden sayılır, şekil yoksa havale */
export function methodFromCard(m: InvoicePaidVia | null | undefined): CariMethod {
  switch (m) {
    case "nakit":
      return "elden";
    case "havale":
    case "kart":
    case "cek":
    case "diger":
      return m;
    default:
      return "havale";
  }
}
