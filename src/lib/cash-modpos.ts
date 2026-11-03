import { paymentLines, paymentsTotalLine, perUnit, type DayFact, type DayLine } from "@/lib/cash-ladmin";
import { computeCash, diffKind, diffText, type CashReportFields } from "@/lib/cash-report";
import { money, num } from "@/lib/format";
import { modposCompare, modposDiffs, type ModposCompareRow, type ModposDiff, type ModposSavedFields } from "@/lib/modpos/compare";
import { MODPOS_UYARI, type FoyAraKasa, type FoyGider, type FoyKasa, type FoyOdeme, type FoyTahsilat, type KasaFoyu } from "@/lib/modpos/foy";
import { timeText } from "@/lib/modpos/status";
import { foysuzBucket, foyWarnings, modposBucket, type ModposSheetPrevious, type ModposZ } from "@/lib/modpos/z";

/**
 * Yöneticinin Kasa ekranındaki ModPOS kasa föyünün metinleri ve kuralları (saf; docs/MODPOS-API.md › Nerede görünür;
 * tests/modpos-kasa.test.ts). Gün görünümünün "ModPOS kasa föyü" kartı ve günden güne listesinin rozeti buradan okur;
 * karşılaştırmanın kendisi çekirdekte (src/lib/modpos/compare.ts). Yalnız yöneticiye çizilir: personelin hiçbir
 * yüküne girmez (WhatsApp, e-posta ve personelin sayfası föyü bilmez).
 *
 * Gün açıkken alınan föy (Ayarlar'da bugünü "Bu günü çek", ya da kapanmamış kasa) o anki tutarlardır: rapora göre
 * "farklı" sayılmaz, tabloda bilgi olarak görünür; ertesi sabah kesin föy gelince karşılaştırılır.
 */

/** Raporun föyle karşılaştırılan alanları (kayıtlı rapor ya da DTO) */
export type ModposReportFields = Pick<
  CashReportFields,
  "zNo" | "receipts" | "zTotal" | "cash" | "card" | "mealCard" | "online" | "other" | "offRevenue" | "openingCash" | "cashIn" | "cashOut" | "countedCash" | "handedOver" | "bankPos" | "okcCard"
>;

/** Saklanan föyün kartta okunan kısmı (src/server/modpos/store.ts › ModposSheet) */
export interface ModposSheetView {
  /** ModPOS'un gönderdiği ham XML (yalnız günün görünümünde; eski föyde yok) */
  raw?: string | null;
  state: "KAPALI" | "ACIK" | "BOS";
  final: boolean;
  revision: number;
  previous: ModposSheetPrevious | null;
  fetchedAt: string;
  foy: KasaFoyu;
}

/**
 * Raporun karşılaştırma girdisi: Z ve kasa alanları, olması gereken nakit ve kasa farkı formun hesabından (computeCash;
 * kayıtlı cashDiff'in kaynağı da odur)
 */
export function modposSavedOf(r: ModposReportFields): ModposSavedFields & { expectedCash: number; cashDiff: number } {
  const c = computeCash(r);
  return {
    zNo: r.zNo,
    receipts: r.receipts,
    zTotal: r.zTotal,
    cash: r.cash,
    card: r.card,
    mealCard: r.mealCard,
    online: r.online,
    other: r.other,
    offRevenue: r.offRevenue,
    openingCash: r.openingCash,
    cashIn: r.cashIn,
    cashOut: r.cashOut,
    countedCash: r.countedCash,
    expectedCash: c.expectedCash,
    cashDiff: c.cashDiff,
  };
}

/** Föy rapora göre karşılaştırılır mı: bütün kasalar kapalı (gün açıkken alınan föyün tutarları o anki) */
export function modposComparable(z: ModposZ): boolean {
  return z.durum === "KAPALI";
}

/** Raporda farklı yazılan alanlar; rapor yoksa ya da föy gün açıkken alındıysa boş */
export function modposReportDiffs(report: ModposReportFields | null, z: ModposZ): ModposDiff[] {
  return report && modposComparable(z) ? modposDiffs(modposSavedOf(report), z) : [];
}

/**
 * Kartın tablosu (Alan | Kasa raporu | ModPOS föyü | Fark): çekirdeğin satırları; gün açıkken alınan föyde "farklı"
 * satırlar bilgi olur (uyarı rengi yok)
 */
export function modposTableRows(report: ModposReportFields | null, z: ModposZ): ModposCompareRow[] {
  const rows = modposCompare(report ? modposSavedOf(report) : null, z);
  return modposComparable(z) ? rows : rows.map((r) => (r.tone === "diff" ? { ...r, tone: "info" as const } : r));
}

/**
 * Günden güne listesinin bir günü (yalnız yöneticiye; tarihe göre): föyün cirosu (raporu girilmemiş günün satırı),
 * raporda farklı yazılanlar ("ModPOS'tan farklı" rozeti ve gün ayrıntısındaki liste) ve föy gün açıkken mi alındı
 */
export interface ModposDayView {
  zTotal: number;
  diffs: ModposDiff[];
  open: boolean;
}

export function modposDayView(report: ModposReportFields | null, z: ModposZ): ModposDayView {
  return { zTotal: z.zTotal, diffs: modposReportDiffs(report, z), open: !modposComparable(z) };
}

const STATE_TEXT: Record<ModposSheetView["state"], string> = { KAPALI: "Kapalı", ACIK: "Açık", BOS: "Kasa açılmamış" };

/** "Kapalı", "Kapalı (06:00'da kendiliğinden)", "Açık", "Kasa açılmamış" */
export function modposStateText(state: ModposSheetView["state"], z: ModposZ | null): string {
  return state === "KAPALI" && z?.otomatikKapandi ? "Kapalı (06:00'da kendiliğinden)" : STATE_TEXT[state];
}

/** Kartın başlık satırı: "Z 0312 · Kapalı · Kesin (alındı: bugün 08:02)"; birden çok kasada "2 kasa" */
export function modposHeadline(sheet: Pick<ModposSheetView, "state" | "final" | "fetchedAt">, z: ModposZ | null, now: Date): string {
  const parts: string[] = [];
  if (z?.zNo) parts.push(`Z ${z.zNo}`);
  else if (z && z.kasaSayisi > 1) parts.push(`${z.kasaSayisi} kasa`);
  parts.push(modposStateText(sheet.state, z));
  parts.push(`${sheet.final ? "Kesin" : "Kesin değil"} (alındı: ${timeText(sheet.fetchedAt, now)})`);
  return parts.join(" · ");
}

/**
 * Föy olmayan günün satırı: bugün için yarın sabah; geçmiş gün için sabah işi (dün + bir geçmiş gün) ya da Ayarlar'dan
 * elle çekim (docs/MODPOS-API.md › Kota ve çekme sırası)
 */
export function modposMissingText(date: string, today: string): string {
  return date >= today
    ? "Bugünün föyü yarın sabah 08:00'de gelir (Ayarlar › ModPOS kasa föyü'nden de çekilebilir)."
    : "Her sabah 08:00'de dünün föyü gelir (Ayarlar › ModPOS kasa föyü'nden de çekilebilir).";
}

/** İşaretli tutar: "+120 ₺", "−20 ₺", "0 ₺" */
export function signedMoney(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r > 0 ? `+${money(r)}` : r < 0 ? `−${money(-r)}` : money(0);
}

/** Tablonun hücresi: tutar para biçiminde, sayı ve metin olduğu gibi, yoksa "–" */
export function modposCell(v: number | string | null, isMoney: boolean): string {
  if (v === null) return "–";
  return isMoney && typeof v === "number" ? money(v) : typeof v === "number" ? num(v) : v;
}

/** ModPOS'un uyarıları (kasalardan, tekilleştirilmiş): bilinen kodun Türkçesi, bilinmeyenin servis mesajı, tutarıyla */
export function modposWarningTexts(foy: KasaFoyu): string[] {
  return foyWarnings(foy).map((u) => {
    const known = Object.hasOwn(MODPOS_UYARI, u.kod) ? MODPOS_UYARI[u.kod as keyof typeof MODPOS_UYARI] : null;
    return `${known ?? u.mesaj}${u.tutar !== null ? `: ${signedMoney(u.tutar)}` : ""}`;
  });
}

const CLOCK = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "17:12" (Türkiye); zaman yoksa null */
export function modposClock(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : CLOCK.format(t);
}

/**
 * Ödeme yönteminin alt satırı: cari tahsilat, sistem ve defter ("cari tahsilat 1.500 ₺ · sistem 17.620,50 ₺ · defter
 * 17.620,50 ₺"); defter girilmediyse "defter girilmedi", ciroya dahil değilse söylenir. Defter farkı ayrı
 * (modposPaymentGap): sıfırdan farklıysa kartta turuncu yazılır
 */
export function modposPaymentDetail(o: FoyOdeme): string {
  const parts: string[] = [];
  if (!o.ciroyaDahil) parts.push("ciroya dahil değil");
  if (Math.abs(o.cariTahsilat) >= 0.01) parts.push(`cari tahsilat ${money(o.cariTahsilat)}`, `sistem ${money(o.sistem)}`);
  parts.push(o.defter === null ? "defter girilmedi" : `defter ${money(o.defter)}`);
  return parts.join(" · ");
}

/** Defter − sistem ("fark −20 ₺"; eksi: açık); defter yoksa null, `off`: 1 kuruştan büyük */
export function modposPaymentGap(o: FoyOdeme): { text: string; off: boolean } | null {
  return o.fark === null ? null : { text: `fark ${signedMoney(o.fark)}`, off: Math.abs(o.fark) >= 0.01 };
}

/** Kırılım satırı: "Garanti BBVA 9.800 ₺ · Akbank 6.320,50 ₺" (yoksa null) */
export function modposBreakdownText(o: FoyOdeme): string | null {
  return o.kirilim.length ? o.kirilim.map((k) => `${k.ad} ${money(k.tutar)}`).join(" · ") : null;
}

/** Gider satırının adı: "Market · Temizlik malzemesi" */
export function modposExpenseLabel(g: FoyGider): string {
  return [g.kategori ?? "Kategorisiz", g.aciklama].filter(Boolean).join(" · ");
}

/** Cari tahsilatın satırı: "Yıldız Lojistik · Kredi Kartı · 17:12" (eski föyde müşteri adı yok) */
export function modposCollectionLabel(t: FoyTahsilat): string {
  return [t.musteri, t.yontem ?? "Yöntem yok", modposClock(t.zaman)].filter(Boolean).join(" · ");
}

/** Ara kasanın satırı: "1. ara kasa · 15:00 · ciro 11.200 ₺ · nakit 3.400 ₺ · 88 adisyon · gider 320 ₺ · beklenen … · sayılan … · fark 0 ₺" */
export function modposAraKasaText(a: FoyAraKasa): string {
  const m = (label: string, v: number | null) => (v === null ? null : `${label} ${money(v)}`);
  return [
    a.no !== null ? `${a.no}. ara kasa` : "Ara kasa",
    modposClock(a.zaman),
    a.personel ?? null,
    m("ciro", a.ciro),
    m("nakit", a.nakit),
    a.adisyonSayisi !== null ? `${num(a.adisyonSayisi)} adisyon` : null,
    m("gider", a.gider),
    m("beklenen", a.beklenen),
    m("sayılan", a.sayilan),
    a.fark !== null ? `fark ${signedMoney(a.fark)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Kişi sayısı, bahşiş ve kartla alınan cari tahsilat (bilgi; föysüz günde yok) */
export function modposServiceLine(z: ModposZ): string | null {
  if (z.foysuz) return null;
  const parts = [z.covers !== null ? `Kişi sayısı ${num(z.covers)}` : null, `bahşiş ${money(z.tips)}`];
  if (Math.abs(z.cardCollections) >= 0.01) parts.push(`kartla cari tahsilat ${money(z.cardCollections)} (banka POS'unda var, Z'nin kartında yok)`);
  const t = parts.filter(Boolean).join(" · ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Sayım olmayan günün nedeni (tablonun altında; föysüz günü föysüz satırı söyler) */
export function modposNoCountText(z: ModposZ): string | null {
  if (z.noCount === "acik") return "Sayım yok: föy alındığında gün açıktı.";
  if (z.noCount === "otomatik") return "Sayım yok: gün 06:00'da kendiliğinden kapandı (ModPOS defterdeki nakdi yazar).";
  return null;
}

/** Kasası açılmamış satış: gün föysüzse tutarların kaynağı, kasa açıkken gelen föysüz satış (başka şube) ayrıca */
export function modposFoysuzText(z: ModposZ): string | null {
  if (z.foysuz) return "Kasa açılmadan satış yapılmış: tutarlar föysüz satıştan, açılış ve sayım yok.";
  if (Math.abs(z.foysuzCiro) >= 0.01) return `Kasası açılmamış satış da var: ciro ${money(z.foysuzCiro)}; yukarıdaki toplamlara girmez.`;
  return null;
}

/** Tanınmayan ödeme kodları (belge §6: "diğer" sayılır) */
export function modposUnknownCodesText(z: ModposZ): string | null {
  return z.unknownCodes.length ? `Tanınmayan ödeme kodu: ${z.unknownCodes.join(", ")}; ciroya dahilse Diğer'e sayıldı.` : null;
}

/**
 * Föy kendi içinde tutmuyor (ödemelerin ciroya dahil toplamı ≠ ciro; docs/MODPOS-API.md › Eşleme): uyarının başlığı,
 * 1 kuruştan küçük farkta null
 */
export function modposGapTitle(z: ModposZ): string | null {
  if (Math.abs(z.paymentsGap) < 0.01) return null;
  return `ModPOS föyünde ödemeler cirodan ${money(Math.abs(z.paymentsGap))} ${z.paymentsGap > 0 ? "fazla" : "eksik"}`;
}

const PREVIOUS_FIELDS = [
  ["cash", "nakit"],
  ["card", "kart"],
  ["mealCard", "yemek kartı"],
  ["online", "online"],
  ["other", "diğer"],
  ["offRevenue", "ödenmez / ikram"],
  ["countedCash", "sayılan nakit"],
] as const;

/**
 * Föy değiştiyse (sürüm > 1) önceki sürümle farkı: "Önceki sürüm (dün 23:10): toplam satış 12.400 ₺ → 11.900 ₺ ·
 * nakit … → …". Toplam satış her zaman yazılır (değişmediyse "değişmedi"); öteki alanlar yalnız değiştiyse.
 */
export function modposPreviousLine(sheet: Pick<ModposSheetView, "revision" | "previous" | "state">, z: ModposZ | null, now: Date): string | null {
  const p = sheet.previous;
  if (sheet.revision <= 1 || !p) return null;
  const cur = {
    zTotal: z?.zTotal ?? 0,
    cash: z?.cash ?? 0,
    card: z?.card ?? 0,
    mealCard: z?.mealCard ?? 0,
    online: z?.online ?? 0,
    other: z?.other ?? 0,
    offRevenue: z?.offRevenue ?? 0,
    receipts: z?.receipts ?? 0,
    countedCash: z?.countedCash ?? null,
  };
  const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 0.01);
  const parts = [same(p.zTotal, cur.zTotal) ? `toplam satış ${money(cur.zTotal)}, değişmedi` : `toplam satış ${money(p.zTotal)} → ${money(cur.zTotal)}`];
  if (p.state !== sheet.state) parts.push(`durum ${STATE_TEXT[p.state].toLocaleLowerCase("tr")} → ${STATE_TEXT[sheet.state].toLocaleLowerCase("tr")}`);
  for (const [k, label] of PREVIOUS_FIELDS) if (!same(p[k], cur[k])) parts.push(`${label} ${p[k] === null ? "–" : money(p[k])} → ${cur[k] === null ? "–" : money(cur[k])}`);
  if (p.receipts !== cur.receipts) parts.push(`fiş sayısı ${num(p.receipts)} → ${num(cur.receipts)}`);
  return `Önceki sürüm (${timeText(p.fetchedAt, now)} alınan): ${parts.join(" · ")}`;
}

// ---------------------------------------------------------------- Gün görünümünün bölümleri (ModPOS · ladmin · Karşılaştırma)

const r2 = (v: number) => Math.round(v * 100) / 100;

/** ModPOS bölümünün karoları: ciro, adisyon (ortalamasıyla), kişi (kişi başı), ciro dışı, bahşiş, kasa farkı */
export function modposFacts(z: ModposZ): DayFact[] {
  const avg = perUnit(z.zTotal, z.receipts);
  const head = perUnit(z.zTotal, z.covers);
  const counted = z.cashDiff !== null;
  // Sayım yoksa nedeni (sayım var ama fark yazılmadıysa "–"): gün açıktı, 06:00'da kapandı, kasa açılmadı (föysüz),
  // kasa kapandı ama Z'ye dayanan sayım girilmedi
  const noCount = z.countedCash !== null ? "fark yazılmadı" : z.noCount === "acik" ? "gün açıktı" : z.noCount === "otomatik" ? "06:00'da kendiliğinden kapandı" : z.noCount === "foysuz" ? "kasa açılmadı" : "sayım girilmedi";
  return [
    {
      label: "Toplam satış (ciro)",
      value: money(z.zTotal),
      sub: z.zNo ? `Z no ${z.zNo}` : z.kasaSayisi > 1 ? `${z.kasaSayisi} kasa` : z.foysuz ? "kasası açılmamış satış" : null,
    },
    { label: "Adisyon sayısı", value: num(z.receipts), sub: avg ? `ortalama adisyon ${avg}` : null },
    { label: "Kişi sayısı", value: z.covers !== null ? num(z.covers) : "–", sub: head ? `kişi başı ${head}` : null },
    { label: "Ciro dışı (ödenmez / ikram)", value: money(z.offRevenue), sub: "ciroya girmez" },
    { label: "Bahşiş", value: money(z.tips), sub: null },
    {
      label: "Kasa farkı",
      value: counted ? diffText(z.cashDiff!) : z.countedCash !== null ? "–" : "Sayım yok",
      sub: counted ? "sayılan − beklenen" : noCount,
      tone: counted ? (diffKind(z.cashDiff!) === "even" ? "good" : "warn") : null,
    },
  ];
}

/** ModPOS'un ödeme kanalları (ciroya göre payı) ve toplamı (föy kendi içinde tutuyor mu) */
export function modposPayments(z: ModposZ): DayLine[] {
  const total = r2(z.cash + z.card + z.mealCard + z.online + z.other);
  return [...paymentLines(z, z.zTotal), paymentsTotalLine(total, z.zTotal, { same: "ciroyla aynı", from: "cirodan" })];
}

const DAYANAK_TEXT: Record<string, string> = { Z_RAPORU: "Z raporu", CANLI: "gün açıkken (anlık)", OTOMATIK_KAPANIS: "06:00'daki kendiliğinden kapanış" };

/**
 * ModPOS'un nakit kasası: açılış + nakit satış + nakit cari tahsilat − gider = beklenen; sayılan ve fark; kartla cari
 * tahsilat (banka POS'unda var, Z'nin kartında yok). Föysüz günde (kasa açılmadı) boş
 */
export function modposCash(z: ModposZ, foy: KasaFoyu): DayLine[] {
  if (z.foysuz) return [];
  const dayanak = [...new Set(foy.kasalar.map((k) => k.nakitKasa?.dayanak).filter((d): d is string => Boolean(d)))];
  // Denklemin her satırı aynı kaynaktan: nakit mutabakatının nakit satışı (Z anındaki); yoksa nakit ödemenin satışı.
  // Kapanıştan sonra nakit ödeme değiştiyse (KAPANISTAN_SONRA_CIRO_DEGISTI) şu anki tutar altta yazılır
  const zSales = foy.kasalar.length && foy.kasalar.every((k) => k.nakitKasa?.nakitSatis != null) ? r2(foy.kasalar.reduce((a, k) => a + (k.nakitKasa!.nakitSatis ?? 0), 0)) : z.cash;
  const moved = Math.abs(zSales - z.cash) >= 0.01;
  const lines: DayLine[] = [
    { label: "Açılış", value: money(z.openingCash) },
    { label: "+ Nakit satış", value: money(zSales), sub: moved ? `şu anki nakit ödemeler ${money(z.cash)} (Z'den sonra değişti)` : null, tone: moved ? "warn" : null },
    { label: "+ Nakit cari tahsilat", value: money(z.cashIn) },
    { label: "− Gider", value: money(z.cashOut) },
    { label: "= Beklenen", value: z.expectedCash !== null ? money(z.expectedCash) : "–", strong: true },
    {
      label: "Sayılan",
      value: z.countedCash !== null ? money(z.countedCash) : "Sayım yok",
      sub: dayanak.length ? `dayanak: ${dayanak.map((d) => DAYANAK_TEXT[d] ?? d).join(", ")}` : null,
    },
    {
      label: "Fark",
      value: z.cashDiff !== null ? diffText(z.cashDiff) : "–",
      tone: z.cashDiff === null ? null : diffKind(z.cashDiff) === "even" ? "good" : "warn",
      strong: true,
    },
  ];
  if (Math.abs(z.cardCollections) >= 0.01) lines.push({ label: "Kartla cari tahsilat", value: money(z.cardCollections), sub: "banka POS'unda var, Z'nin kartında yok" });
  return lines;
}

/** Kasanın açık kaldığı süre: "15 sa 16 dk" (açılış ya da kapanış yoksa, ya da ters sırada null) */
export function modposOpenFor(k: Pick<FoyKasa, "acilis" | "kapanis">): string | null {
  const a = k.acilis.zaman ? Date.parse(k.acilis.zaman) : NaN;
  const b = k.kapanis.zaman ? Date.parse(k.kapanis.zaman) : NaN;
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const min = Math.round((b - a) / 60_000);
  const h = Math.floor(min / 60);
  return h ? `${h} sa ${min % 60} dk` : `${min} dk`;
}

/**
 * Föyün künyesi: ModPOS'ta hazırlandığı ve panele alındığı an, kesin mi (değilse neden), sürüm. Önceki sürümün farkı
 * ayrı satırdır (modposPreviousLine)
 */
export function modposSheetMeta(sheet: Pick<ModposSheetView, "final" | "fetchedAt" | "revision" | "foy">, now: Date): string[] {
  const lines: string[] = [];
  if (sheet.foy.olusturulma) lines.push(`ModPOS'ta hazırlandı: ${timeText(sheet.foy.olusturulma, now)}`);
  lines.push(`Panele alındı: ${timeText(sheet.fetchedAt, now)}`);
  lines.push(sheet.final ? "Kesin: kasalar kapalı, ertesi sabah 07:00'den sonra alındı" : "Kesin değil: ertesi sabah kesin föy yeniden çekilir");
  if (sheet.revision > 1) lines.push(`${sheet.revision}. sürüm (ModPOS'ta sonradan değişti)`);
  return lines;
}

/**
 * Karşılaştırmanın satırları: çekirdeğin satırları (modposTableRows) ve iki bilgi satırı: ödemelerin toplamı (iki
 * taraf kendi içinde tutuyor mu) ve raporda banka POS yazıldıysa banka POS ↔ ModPOS'un kartı (kartla cari tahsilat
 * dahil: banka gün sonunda ikisi de var)
 */
export function modposCompareRows(report: ModposReportFields | null, z: ModposZ): ModposCompareRow[] {
  const rows = modposTableRows(report, z);
  const info = (key: string, label: string, a: number | null, b: number): ModposCompareRow => {
    const diff = a === null ? null : r2(b - a);
    return { key, label, report: a, modpos: b, diff: diff === 0 ? 0 : diff, tone: a === null ? "none" : diff !== null && Math.abs(diff) >= 0.01 ? "info" : "same", money: true };
  };
  rows.push(info("payments", "Ödemelerin toplamı", report ? computeCash(report).paymentsTotal : null, r2(z.cash + z.card + z.mealCard + z.online + z.other)));
  if (report && report.bankPos !== null && !z.foysuz) rows.push(info("bankPos", "Banka POS ↔ ModPOS kartı (kartla cari tahsilat dahil)", report.bankPos, r2(z.card + z.cardCollections)));
  return rows;
}

/** Karşılaştırmanın özeti: "13 satır aynı · 1 alan farklı yazılmış · 2 satırda bilgi farkı" */
export function modposCompareSummary(rows: readonly ModposCompareRow[], z: ModposZ, hasReport: boolean): string {
  if (!hasReport) return "Bu gün için kasa raporu girilmedi: rapor girilince alan alan karşılaştırılır.";
  if (!modposComparable(z)) return "Föy gün açıkken alındı: farklar bilgi olarak görünür, ertesi sabahki kesin föyle karşılaştırılır.";
  const count = (t: ModposCompareRow["tone"]) => rows.filter((r) => r.tone === t).length;
  const [same, diff, info] = [count("same"), count("diff"), count("info")];
  return [
    `${same} satır aynı`,
    diff ? `${diff} alan farklı yazılmış` : "farklı yazılan alan yok",
    info ? `${info} satırda bilgi farkı` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Ödenmez / ikram dökümü (ciroya girmeyen ödeme satırları: ikram, ödenmez, zayi, hediye kartı, sadakat ikramı, değişim
 * mahsubu, ciroya dahil olmayan "diğer"): kod kod tutar ve kırılımı (kime / hangi kuruma); sonda föyün ciro dışı
 * toplamıyla tutuyor mu. Kasasız satışın (föysüz) satırları Z özetinin kuralıyla seçilir (foysuzBucket: ciroyaDahil
 * gelmeyen DIGER ve tanınmayan kod Diğer'dir, ciroya dahil) ve şube şube ayrı yazılır. Kasa açılmışken gelen föysüz
 * satış başka şubenindir, föyün toplamlarına girmez (foyZ): satırı "toplamlara girmez" der, denetime katılmaz.
 * Kasasız günde (föy yalnız föysüz satış) föysüz satırlar toplamın kendisidir. Hiç yoksa boş
 */
export function modposOffLines(foy: KasaFoyu, z: ModposZ | null): DayLine[] {
  type Entry = { label: string; tutar: number; parts: Map<string, number>; counted: boolean; note: string | null };
  const by = new Map<string, Entry>();
  const add = (key: string, label: string, tutar: number, parts: { ad: string; tutar: number }[], counted: boolean, note: string | null) => {
    const e = by.get(key) ?? { label, tutar: 0, parts: new Map<string, number>(), counted, note };
    e.tutar = r2(e.tutar + tutar);
    for (const p of parts) e.parts.set(p.ad, r2((e.parts.get(p.ad) ?? 0) + p.tutar));
    by.set(key, e);
  };
  const kasali = foy.kasalar.length > 0;
  const multi = foy.kasalar.length > 1;
  for (const k of foy.kasalar) {
    const where = multi ? k.kasaAdi || k.sube : null;
    for (const o of k.odemeler) {
      if (modposBucket(o) === "off") add(`${o.kod}|${where ?? ""}`, `${o.yontem} (${o.kod})${where ? ` · ${where}` : ""}`, o.satis, o.kirilim, true, null);
    }
  }
  for (const f of foy.foysuzGunler) {
    const sube = f.sube || "adsız şube";
    for (const o of f.odemeler) {
      if (foysuzBucket(o) === "off") add(`${o.kod}|kasasız:${sube}`, `${o.yontem} (${o.kod}) · kasasız: ${sube}`, o.tutar, [], !kasali, kasali ? "başka şubenin kasasız satışı: föyün toplamlarına girmez" : null);
    }
  }
  if (!by.size) return [];
  const lines: DayLine[] = [...by.values()].map((e) => ({
    label: e.label,
    value: money(e.tutar),
    sub: [...[...e.parts].map(([ad, t]) => `${ad} ${money(t)}`), e.note].filter(Boolean).join(" · ") || null,
  }));
  const sum = r2([...by.values()].filter((e) => e.counted).reduce((a, e) => a + e.tutar, 0));
  if (z) {
    const gap = r2(sum - z.offRevenue);
    lines.push({
      label: "Ciro dışı toplamı (föy)",
      value: money(z.offRevenue),
      sub: Math.abs(gap) < 0.01 ? "satırların toplamıyla aynı" : `satırların toplamı ${money(sum)}: ${money(Math.abs(gap))} ${gap > 0 ? "fazla" : "eksik"}`,
      tone: Math.abs(gap) < 0.01 ? null : "warn",
      strong: true,
    });
  }
  return lines;
}

/**
 * Föydeki kişiler: kasayı açan ve kapatan personel, ara kasayı yapan, cari tahsilatın müşterisi (kasa kasa). Yalnız
 * yöneticiye çizilir; eski föylerde ad yoksa boş
 */
export function modposPeople(foy: KasaFoyu): DayLine[] {
  const multi = foy.kasalar.length > 1;
  const lines: DayLine[] = [];
  for (const k of foy.kasalar) {
    const pre = multi ? `${k.kasaAdi || k.sube} · ` : "";
    if (k.acilis.personel) lines.push({ label: `${pre}Kasayı açan`, value: k.acilis.personel, sub: modposClock(k.acilis.zaman), wrap: true });
    if (k.kapanis.personel) lines.push({ label: `${pre}Kasayı kapatan`, value: k.kapanis.personel, sub: modposClock(k.kapanis.zaman), wrap: true });
    for (const a of k.araKasalar) {
      if (a.personel) lines.push({ label: `${pre}${a.no !== null ? `${a.no}. ara kasa` : "Ara kasa"}`, value: a.personel, sub: modposClock(a.zaman), wrap: true });
    }
    for (const t of k.cariTahsilatlar.kalemler) {
      if (t.musteri) lines.push({ label: `${pre}Cari tahsilat`, value: t.musteri, sub: [money(t.tutar), t.yontem, modposClock(t.zaman)].filter(Boolean).join(" · "), wrap: true });
    }
  }
  return lines;
}

/** Karşılaştırmanın kişi satırı: "ModPOS'ta kapatan Mehmet Kaya · ladmin'de sayan Ece Panel" (ad yoksa null) */
export function modposPeopleLine(foy: KasaFoyu, report: { submittedByName?: string; countedByName?: string | null } | null): string | null {
  const closers = [...new Set(foy.kasalar.map((k) => k.kapanis.personel).filter((n): n is string => Boolean(n)))];
  if (!closers.length) return null;
  const counter = report ? (report.countedByName ?? report.submittedByName ?? null) : null;
  return [`ModPOS'ta kasayı kapatan ${closers.join(", ")}`, counter ? `ladmin'de kasayı sayan ${counter}` : null].filter(Boolean).join(" · ");
}

/** Ham föyün çizilen en çok uzunluğu (ModPOS bölümünün "Ham föy"ü; saklanan her zaman tamdır) */
export const MODPOS_RAW_SHOWN = 200_000;

/** Tanınmayan alanların satırları ("kasa.0.satis.yeniAlan: 42"); yoksa boş */
export function modposExtraLines(foy: KasaFoyu): string[] {
  return (foy.ekAlanlar ?? []).map((e) => `${e.yol}: ${e.deger || "(boş)"}`);
}
