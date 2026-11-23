import type { OkcVatLine } from "@/lib/okc-z";
import { addDays, shiftMonth } from "@/lib/reminders";

import { checkLafposRequest } from "./request";
import { modposThroughOf } from "./sales";
import { LAFPOS_BRANCH_ID } from "./switch";

/**
 * LafPOS'un ModPOS dönemi (docs/LAFPOS.md › ModPOS dönemi: `GET /api/panel/pos/modpos-gunler`; saf, testleri
 * tests/lafpos-modpos.test.ts). LafPOS'un şubesinin (Marina) LafPOS'a geçmeden önceki ModPOS günleri ve o dönemin ModPOS
 * ürün listesi, panelin kendi kaynaklarından: kasa LafPOS Uzaktan'daki ve kendi Raporlar'ındaki "ModPOS" günlerini
 * buradan doldurur (sahibin 23 Kasım 2026 bildirimi: "Geçen hafta"da 16–21 Kasım görünmüyordu). Hiçbir şey yazılmaz.
 *
 * Kurallar:
 * - Günler geçiş gününden ÖNCE, en çok MODPOS_DAYS_MAX gün geriye; geçiş günü boşsa gün yok.
 * - Kaynak ay rakamınınki: günün kasa raporu, raporsuz günde (Ayarlar › ModPOS › Ay rakamına yedek açıkken) kapanmış
 *   föy (src/server/data/cash-reports.ts tillRows; yükleyici src/server/lafpos/modpos-gunler.ts).
 * - `ciro` ödemelerin toplamıdır (kart + nakit + yemek + online + diğer): indirimden sonra, ödenmez / ikram hariç; Z
 *   toplamı ödenmezi içerse de (src/lib/cash-revenue.ts) ciro budur. Panel ödenmezle ikramı tek tutar tutar
 *   (`offRevenue`, föyün `ciroDisi`'si): hepsi `odenmez`'e, `ikram` 0. Föyde indirim yoktur: föy gününde `indirim` 0.
 * - KDV: kasa raporunun yazarkasa dökümü (`okc_vat`) günün cirosunu kuruşu kuruşuna tutuyorsa oran oran o; yoksa tek
 *   satır %10, matrah = round(ciro × 100 / 110) (kafenin satışı; LafPOS'un `splitKdv`'si ile aynı yuvarlama).
 * - Tutarlar TL, iki ondalık (hesap kuruşla), sıfırdan küçük değil. Satışı, indirimi, ödenmezi ve fişi olmayan gün gitmez.
 * - Ürün listesi: şubenin Satışlar'a yüklenen ModPOS listesi (sales_lines), indirim öncesi; dönem bloğu (aşağıda,
 *   modposProducts). Kişi adı, kasa ve sayım rakamı gitmez.
 */

/** Geçiş gününden geriye en çok bu kadar gün */
export const MODPOS_DAYS_MAX = 400;
/** Dökümü olmayan günün KDV oranı (kafe satışı) */
export const MODPOS_KDV_RATE = 10;
/** Ürün bloğunda en çok bu kadar satır (LafPOS'un geçmiş ürün sınırı); fazlası "Diğer ürünler" satırında toplanır */
export const MODPOS_PRODUCTS_MAX = 500;
/** Toplanan fazla satırların adı */
export const MODPOS_PRODUCTS_REST = "Diğer ürünler";
/** Z no en çok bu kadar karakter (LafPOS'un geçmiş gününün sınırı) */
const ZNO_MAX = 40;
/** Şube kimliği: gün sonu gövdesinin `sube` kuralı (src/lib/lafpos/day.ts) */
const SUBE = /^[a-z][a-z0-9-]{1,23}$/;

export interface ModposKdv {
  /** Oran (yüzde, tam sayı) */
  rate: number;
  /** Matrah (KDV hariç) */
  base: number;
  vat: number;
}

/** Yanıtın bir günü (sözleşmenin alan sırası) */
export interface ModposDay {
  date: string;
  ciro: number;
  kart: number;
  nakit: number;
  yemek: number;
  online: number;
  diger: number;
  indirim: number;
  odenmez: number;
  ikram: number;
  fis: number;
  zNo: string | null;
  kdv: ModposKdv[];
}

export interface ModposProductRow {
  ad: string;
  boy: "M" | "L" | null;
  adet: number;
  /** İndirim öncesi, KDV dahil */
  tutar: number;
}

/** Dönemin ModPOS ürün listesi: tek blok, [from, to] iki uç dahil */
export interface ModposProducts {
  from: string;
  to: string;
  rows: ModposProductRow[];
}

/** Ucun okuduğu (geçiş günü, günler, ürün bloğu) */
export interface ModposDaysData {
  switchDay: string | null;
  days: ModposDay[];
  urunler: ModposProducts | null;
}

/** Günün kaynağı (kasa raporu ya da föyün Z'si), TL */
export interface ModposDayInput {
  date: string;
  zNo: string | null;
  receipts: number | null;
  cash: number;
  card: number;
  mealCard: number;
  online: number;
  other: number;
  /** Girilmediyse (ya da föyse) null: 0 */
  discounts: number | null;
  /** Ödenmez / ikram (ciro dışı) */
  offRevenue: number | null;
  /** Kasa raporundaki yazarkasa KDV dökümü */
  vat?: readonly OkcVatLine[] | null;
}

/** ModPOS listesinin bir satırı (sales_lines) ve bağlı ürünü */
export interface ModposListLine {
  month: string;
  posName: string;
  qty: number;
  revenue: number;
  /** Bağlı panel ürününün adı ve boyu (bağlı değilse null) */
  productName: string | null;
  productSize: string | null;
}

/** TL → kuruş, sıfırdan küçük değil (+0) */
const kurus = (v: number | null | undefined) => Math.max(0, Math.round((v ?? 0) * 100));
const tl = (k: number) => k / 100;

/** Geçiş gününden önceki pencere: [geçiş − 400, geçiş − 1], iki uç dahil */
export function modposWindow(switchDay: string): { from: string; to: string } {
  return { from: addDays(switchDay, -MODPOS_DAYS_MAX), to: addDays(switchDay, -1) };
}

/** Sorgunun `sube`'si: tek değer, gün sonunun kuralıyla; değilse null (400) */
export function modposSube(url: URL): string | null {
  const all = url.searchParams.getAll("sube");
  return all.length === 1 && SUBE.test(all[0]) ? all[0] : null;
}

export type ModposDaysCheck = { ok: true; sube: string } | { ok: false; status: 400 | 401 | 409 | 413 | 503; body: Record<string, unknown> };

/**
 * İsteğin denetimi: anahtar (503), imza (401; yol ve sıralı sorgu imzanın içinde, gövdesiz GET), sonra şube: yoksa ya
 * da bozuksa 400 `{ error: "invalid", field: "sube" }`, LafPOS'un şubesi değilse 409 `{ error: "wrong_branch", sube,
 * expected }` (gün sonunun kuralı: başka şubeye ayarlı kasa başka şubenin rakamını almaz). İmzasız istek şubeyi öğrenmez.
 */
export function checkModposDaysRequest(input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: number }): ModposDaysCheck {
  const check = checkLafposRequest({ ...input, method: "GET", body: "", maxBytes: 0 });
  if (!check.ok) return { ok: false, status: check.status, body: { error: check.error } };
  const sube = modposSube(input.url);
  if (sube === null) return { ok: false, status: 400, body: { error: "invalid", field: "sube" } };
  if (sube !== LAFPOS_BRANCH_ID) return { ok: false, status: 409, body: { error: "wrong_branch", sube, expected: LAFPOS_BRANCH_ID } };
  return { ok: true, sube };
}

/** KDV satırları, ciro kuruşla */
function kdvOf(ciro: number, vat: readonly OkcVatLine[] | null | undefined): ModposKdv[] {
  if (ciro === 0) return [];
  const lines = (vat ?? []).filter((l) => kurus(l.total) > 0);
  const valid =
    lines.length > 0 &&
    lines.every((l) => Number.isInteger(l.rate) && l.rate >= 0 && l.rate <= 100 && kurus(l.vat) <= kurus(l.total)) &&
    new Set(lines.map((l) => l.rate)).size === lines.length &&
    lines.reduce((a, l) => a + kurus(l.total), 0) === ciro;
  if (valid) {
    return [...lines].sort((a, b) => a.rate - b.rate).map((l) => ({ rate: l.rate, base: tl(kurus(l.total) - kurus(l.vat)), vat: tl(kurus(l.vat)) }));
  }
  // 10 × ciro / 11 hiçbir kuruşta tam yarım olmaz: Math.round yarım-yukarı ile aynı
  const base = Math.round((ciro * 100) / (100 + MODPOS_KDV_RATE));
  return [{ rate: MODPOS_KDV_RATE, base: tl(base), vat: tl(ciro - base) }];
}

/** Günün KDV satırları (ciro TL): döküm ciroyu tutuyorsa o, yoksa %10 */
export function modposKdv(ciro: number, vat?: readonly OkcVatLine[] | null): ModposKdv[] {
  return kdvOf(kurus(ciro), vat);
}

/** Bir günün yanıttaki hâli; boş gün (satış, indirim, ödenmez, fiş yok) null */
export function modposDay(r: ModposDayInput): ModposDay | null {
  const kart = kurus(r.card);
  const nakit = kurus(r.cash);
  const yemek = kurus(r.mealCard);
  const online = kurus(r.online);
  const diger = kurus(r.other);
  const ciro = kart + nakit + yemek + online + diger;
  const indirim = kurus(r.discounts);
  const odenmez = kurus(r.offRevenue);
  const fis = Math.max(0, Math.round(r.receipts ?? 0));
  if (ciro === 0 && indirim === 0 && odenmez === 0 && fis === 0) return null;
  const zNo = r.zNo?.trim().slice(0, ZNO_MAX) || null;
  return {
    date: r.date,
    ciro: tl(ciro),
    kart: tl(kart),
    nakit: tl(nakit),
    yemek: tl(yemek),
    online: tl(online),
    diger: tl(diger),
    indirim: tl(indirim),
    odenmez: tl(odenmez),
    ikram: 0,
    fis,
    zNo,
    kdv: kdvOf(ciro, r.vat),
  };
}

/** Pencere içindeki günler, güne göre sıralı; aynı gün iki kez verilirse ilki (yükleyici raporu föyden önce verir) */
export function modposDays(inputs: readonly ModposDayInput[], window: { from: string; to: string }): ModposDay[] {
  const seen = new Set<string>();
  const out: ModposDay[] = [];
  for (const r of inputs) {
    if (r.date < window.from || r.date > window.to || seen.has(r.date)) continue;
    seen.add(r.date);
    const d = modposDay(r);
    if (d) out.push(d);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Satırın adı ve boyu: bağlı ürünün adı ve boyu (M / L; tek boy null), bağlı değilse ModPOS'taki adı */
function productKey(l: ModposListLine): { ad: string; boy: "M" | "L" | null } {
  const name = l.productName?.trim();
  if (name) return { ad: name, boy: l.productSize === "M" || l.productSize === "L" ? l.productSize : null };
  return { ad: l.posName.trim().replace(/\s+/g, " "), boy: null };
}

/**
 * Dönemin ModPOS ürün listesi (indirim öncesi; liste ↔ ciro + indirim). Satışlar'a ay ay yüklenen listeler gün gün
 * bölünemez; dönem bloğu şöyle kurulur:
 * - Aylar: pencerenin içinde başlayan, listesi olan en son aya kesintisiz uzanan aylar (arada listesi olmayan ay
 *   varsa öncesi girmez: blok boşluklu bir dönemi kapsıyormuş gibi görünmesin).
 * - `to`: son ayın listesinin son günü (kapsam kaydı, yoksa ayın sonu), geçiş gününden önceki günü geçmez (Satışlar'ın
 *   yükleme kuralı geçiş ayında listeyi zaten oraya kırpar).
 * - `from`: ilk ayın 1'i; o aydan itibaren ModPOS günü varsa ilki (ay ortasında açılan şube: Marina 13 Kasım).
 * - Satırlar (ad, boy) başına toplanır, tutara göre sıralı; boş satır gitmez; MODPOS_PRODUCTS_MAX'ı aşan kısım tek satırda.
 * Listesi yoksa null.
 */
export function modposProducts(input: {
  lines: readonly ModposListLine[];
  coverage: Readonly<Record<string, string>>;
  window: { from: string; to: string };
  days: readonly { date: string }[];
}): ModposProducts | null {
  const { window } = input;
  const inWindow = input.lines.filter((l) => `${l.month}-01` >= window.from && `${l.month}-01` <= window.to && (kurus(Math.abs(l.qty)) > 0 || kurus(Math.abs(l.revenue)) > 0));
  const listed = new Set(inWindow.map((l) => l.month));
  if (!listed.size) return null;
  const last = [...listed].sort().at(-1)!;
  let first = last;
  while (listed.has(shiftMonth(first, -1))) first = shiftMonth(first, -1);
  const through = modposThroughOf(last, input.coverage);
  const to = through < window.to ? through : window.to;
  const start = `${first}-01`;
  const firstDay = input.days.map((d) => d.date).find((d) => d >= start && d <= to);
  const from = firstDay ?? start;
  if (from > to) return null;

  const rows = new Map<string, { ad: string; boy: "M" | "L" | null; adet: number; tutar: number }>();
  for (const l of inWindow) {
    if (l.month < first) continue;
    const key = productKey(l);
    const id = `${key.ad}\u0000${key.boy ?? ""}`;
    const row = rows.get(id) ?? rows.set(id, { ...key, adet: 0, tutar: 0 }).get(id)!;
    row.adet += Math.round(l.qty * 100);
    row.tutar += Math.round(l.revenue * 100);
  }
  const sorted = [...rows.values()]
    .filter((r) => r.adet !== 0 || r.tutar !== 0)
    .sort((a, b) => b.tutar - a.tutar || a.ad.localeCompare(b.ad, "tr") || (a.boy ?? "").localeCompare(b.boy ?? ""));
  if (!sorted.length) return null;
  const kept = sorted.length > MODPOS_PRODUCTS_MAX ? sorted.slice(0, MODPOS_PRODUCTS_MAX - 1) : sorted;
  if (kept.length < sorted.length) {
    const rest = sorted.slice(kept.length);
    kept.push({ ad: MODPOS_PRODUCTS_REST, boy: null, adet: rest.reduce((a, r) => a + r.adet, 0), tutar: rest.reduce((a, r) => a + r.tutar, 0) });
  }
  return { from, to, rows: kept.map((r) => ({ ad: r.ad, boy: r.boy, adet: r.adet / 100, tutar: tl(r.tutar) })) };
}
