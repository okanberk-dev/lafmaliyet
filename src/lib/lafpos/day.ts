import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { isCalendarDate } from "@/lib/reminders";
import { SITE_MENU_ID } from "@/lib/site-menu/schema";

import { sortStaffRefs, STAFF_REF, STAFF_REFS_MAX } from "./personel";

/**
 * LafPOS'un gün sonu (docs/LAFPOS.md; sözleşme LafPOS deposunda docs/03-ENTEGRASYON.md §4). Kafedeki kasa internetten
 * erişilemediği için panel çekmez: LafPOS her iş gününü kapanışta bir kez, düzeltmede yeniden `POST /api/pos/gun` ile
 * iter; aynı `date` öncekinin yerine geçer. Saf modül: uç, veritabanı katmanı ve testler paylaşır
 * (tests/lafpos.test.ts).
 *
 * Beyaz liste: yalnız burada adı geçen alanlar okunur ve saklanır, bilinmeyen alan atılır (kişisel veri gelse de
 * yazılmaz). Tutarlar TL (iki ondalık; fazlası yuvarlanır), ciro ve menü değeri KDV dahil. `date` iş günüdür (05:00
 * kuralı, Kasa raporuyla aynı).
 */

/** Gövdenin sürümü: tanınmayan sürüm reddedilir (400, alan `version`) */
export const LAFPOS_VERSION = 1;
/** Gövde en çok 256 KB (katı JSON) */
export const POS_DAY_MAX_BYTES = 256 * 1024;

const MAX_TL = 100_000_000;
const round2 = (v: number) => Math.round(v * 100) / 100;

const tl = z.number().finite().min(0).max(MAX_TL).transform(round2);
const signedTl = z.number().finite().min(-MAX_TL).max(MAX_TL).transform(round2);
const count = z.number().int().min(0).max(10_000_000);
const qty = z.number().finite().min(0).max(10_000_000);
/** POS adı: sales_lines'taki gibi boşluklar sadeleşir (eşleştirme posMatchKey ile) */
const posName = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((v) => v.replace(/\s+/g, " "));
const siteMenuId = z.string().regex(SITE_MENU_ID).nullable();
const slot = z.enum(["M", "L"]).nullable();

/**
 * Faz 2 alanı (23 Kasım 2026; docs/LAFPOS.md › Faz 2 alanları): isteğe bağlı, eski LafPOS ve saklanmış eski gün
 * göndermez. Bozuk gelirse yok sayılır (alan yazılmaz, parsePosDay günlüğe yazar), gün reddedilmez: 400 LafPOS'ta
 * kalıcıdır. Saklanan jsonb aynı şemayla yeniden okunur; zorunlu bir alan eski günleri sessizce düşürürdü
 */
const soft = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);
/** `lines[].listPrices` en çok bu kadar fiyat (LafPOS docs/03-ENTEGRASYON.md §4) */
export const LIST_PRICES_MAX = 20;
/** Serbest metin neden: kırpılır, en çok 200 karakter, boşsa null (KVKK: LafPOS da 200'de keser) */
const reasonText = z
  .string()
  .max(1000)
  .nullable()
  .transform((v) => v?.trim().slice(0, 200) || null);
/** Kısa metin (Z no, hata kodu): kırpılır, boşsa null; baştaki sıfır korunur */
const shortText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => v?.trim() || null);
/** ISO an (LafPOS'un `new Date().toISOString()`'i) */
const isoInstant = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/).nullable();

/** Günün KDV dökümünün bir oranı: oran (%), matrah ve KDV, TL (LafPOS'un summary.kdv'si; Σ(matrah + KDV) = zTotal) */
export const vatLineSchema = z.object({
  rate: z.number().finite().min(0).max(100),
  base: tl,
  vat: tl,
});
export type PosVatLine = z.output<typeof vatLineSchema>;

/**
 * Z özeti: Kasa raporunun ModPOS Z ve kasa alanları (docs/03-ENTEGRASYON.md §3.2). `cashIn`, `expectedCash`, `cardTips`
 * ve `cardCollections` sonradan geldi: eski LafPOS'un gövdesinde (ve saklanmış eski özetlerde) yoktur, yazılmayabilir;
 * `cashIn` yoksa 0 sayılır.
 */
export const posZSchema = z.object({
  zNo: z.number().int().min(0).max(999_999_999),
  receipts: count,
  zTotal: tl,
  cash: tl,
  card: tl,
  mealCard: tl,
  online: tl,
  other: tl,
  offRevenue: tl,
  discounts: tl,
  openingCash: tl,
  /** LafPOS'un harcama türü kasa hareketleri */
  cashOut: tl,
  /** Gün sonu sayımı; sayılmadan kapanan günde null */
  countedCash: tl.nullable(),
  /** LafPOS'un teslim türü kasa hareketleri: gün açıkken, sayımdan önce çekmeceden çıkar */
  handedOver: tl,
  /** Sayılan − beklenen nakit (LafPOS'un hesabı); sayım yoksa null */
  cashDiff: signedTl.nullable(),
  /** Nakit satış dışında çekmeceye giren nakit: giriş türü kasa hareketleri, nakit müşteri tahsilatı ve nakit bahşiş (isteğe bağlı) */
  cashIn: tl.nullable().optional(),
  /** LafPOS'un olması gereken nakdi: açılış + nakit satış + cashIn − harcama − teslim (isteğe bağlı) */
  expectedCash: signedTl.nullable().optional(),
  /**
   * Kartla bahşiş ve kartla cari tahsilatı (isteğe bağlı; LafPOS L1): banka POS'unun gördüğü ama Z'nin kartına girmeyen
   * tutarlar. Kasa raporunun kart farkı LafPOS günlerinde bunları düşer (src/lib/lafpos/prefill.ts lafposCardExtra)
   */
  cardTips: tl.nullable().optional(),
  cardCollections: tl.nullable().optional(),
  /**
   * Faz 2 (hesap sözleşmesi §5; isteğe bağlı, bozuksa yok sayılır): liste değeri = satılan + ikram + ödenmez (servis
   * dahil, zayi hariç); türüne göre liste değerleri (ikram + ödenmez + zayi = offRevenue; zTotal = liste − indirim −
   * ikram − ödenmez)
   */
  listValue: soft(tl),
  ikramTotal: soft(tl),
  odenmezTotal: soft(tl),
  zayiTotal: soft(tl),
  /** Günün KDV dökümü (kapanmış kasa adisyonları, servis dahil): LafPOS günlerinde günün KDV'si buradan (yeniden hesaplanmaz) */
  vat: soft(z.array(vatLineSchema).max(10)),
  /** Günün açılış ve son kapanış anı (ISO) */
  openedAt: soft(isoInstant),
  closedAt: soft(isoInstant),
  /** Yazarkasanın (ÖKC) mali Z no'su, günün son tamamlanan cihaz fişinden; metin (LafPOS'un `zNo`'sundan ayrı); yoksa null */
  okcZNo: soft(shortText(30)),
  /**
   * Faz 3, kasa zinciri (23 Kasım 2026; docs/LAFPOS.md › Kasa zinciri; isteğe bağlı, bozuksa yok sayılır): açılışta
   * beklenen nakit (önceki gerçek günün devri; bilinmiyorsa null), açılış − beklenen (işaretli: eksik açılış eksi;
   * beklenen yoksa null) ve farkın nedeni (en çok 200 karakter; fark ₺1,00 ve üstündeyse LafPOS'ta zorunlu)
   */
  expectedOpening: soft(tl.nullable()),
  openingDiff: soft(signedTl.nullable()),
  openingReason: soft(reasonText),
  /**
   * Gün sonu tam (24 Kasım 2026; docs/LAFPOS.md › Gün sonu otomasyonu; isteğe bağlı, bozuksa yok sayılır): iade edilmemiş
   * nakit satış ödemelerinin bahşişi (z.cashIn'in içinde), kapanış / föy notu (en çok 200) ve föyde ödeme türü başına
   * sayılan (personelin yazdığı banka POS slibi, yemek kartı raporu; yalnız bilgi, Banka POS'u doldurmaz)
   */
  cashTips: soft(tl),
  closeNote: soft(reasonText),
  methodCounts: soft(z.array(z.object({ name: z.string().trim().min(1).max(60), zField: z.enum(["cash", "card", "meal_card", "online", "other"]), channel: z.string().trim().max(40).nullable().transform((v) => v || null), counted: tl })).max(50)),
});

const lineSchema = z.object({
  posName,
  siteMenuId,
  slot,
  qty,
  /** TL, KDV dahil */
  revenue: tl,
  isService: z.boolean(),
  /** Faz 2: satırın liste değeri, indirimden önce (TL, KDV dahil; servis satırında servis ücreti). Σ(gross − revenue) = z.discounts */
  gross: soft(tl),
  /** Faz 2: birleşen satırda içeceğin seçeneğinden ayrılan ek parçası var (EXTRA SHOT, SYRUP, ALTERNATIF SÜT) */
  isAddon: soft(z.boolean()),
  /**
   * Şube fiyatı (LP-E, 24 Kasım 2026): satılan parçaların dondurulan liste birim fiyatları (TL; ana parçada kalemin
   * `basePrice`'ı, ekte seçeneğin fiyatı) ve adetleri, en çok 20. Hizmet satırında ve eski LafPOS'ta yok. "Eski fiyattan
   * satılanlar" ve fiyat değişikliğinin durumu yalnız buradan okunur (src/lib/prices/branch.ts); `revenue / qty` liste
   * fiyatı değildir. Bozuksa yok sayılır, gün reddedilmez
   */
  listPrices: soft(z.array(z.object({ price: tl, qty })).max(LIST_PRICES_MAX)),
});

const ikramSchema = z.object({
  posName,
  siteMenuId,
  slot,
  qty,
  /** İkram edilenin menü değeri, TL, KDV dahil */
  menuValue: tl,
  reason: reasonText,
  /** Faz 2: türü (eski LafPOS göndermez: nedenin ön eki "Ödenmez: ", "Zayi: " okunur; src/lib/lafpos/ikram.ts) */
  kind: soft(z.enum(["ikram", "odenmez", "zayi"])),
  /** Faz 2: ödenmezin kişi türü (kişinin adı ve kimliği gelmez; KVKK); kişisiz ödenmez, ikram ve zayide null */
  personKind: soft(z.enum(["personel", "musteri", "patron"]).nullable()),
});

/** Faz 2: günün iptal edilen bir ödemesi; `name` ödeme türünün adı (kişi değil) */
const refundSchema = z.object({
  amount: tl,
  zField: z.enum(["cash", "card", "meal_card", "online", "other"]),
  name: z.string().trim().min(1).max(60),
  channel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  reason: reasonText,
});

/**
 * Faz 2: günün kasa adisyonlarının iptal edilen bir kalemi (ana ürün ve ek parçaları ayrı, satırla aynı ad). Hazırlanmış
 * (`prepared`: bar ya da mutfak başlamıştı ya da hazırdı) iptal zayi tüketimidir (src/server/data/lafpos-ikram.ts),
 * hazırlanmamış yalnız bilgi. `refund`: kalem iadesi (nedeni "İade: " ile başlar; tutarı `refunds`'ta da var)
 */
const iptalSchema = z.object({
  posName,
  siteMenuId,
  slot,
  qty,
  /** Adet × liste fiyatı, TL, KDV dahil */
  listValue: tl,
  prepared: z.boolean(),
  reason: reasonText,
  refund: z.boolean(),
});

/**
 * Faz 3: günün bir kasa hareketi (LafPOS `cash_movements`; docs/LAFPOS.md › Kasadan çıkanlar LafPOS'tan). Kimlik
 * hareketin ULID'i (26 karakter Crockford base32; değişmez, aynı gün yeniden gönderilince aynı satır). Harcama ve teslim
 * panelin "Kasadan çıkanlar"ına satır olur (src/server/lafpos/cash-moves.ts), giriş olmaz (Kasa raporunun "Gün içinde
 * kasaya giren"i `z.cashIn`'den). Kişi gelmez; açıklama personelin yazdığı serbest metin (en çok 200, boş olabilir).
 * `categoryId` harcamanın panel gider kategorisi (expense_categories.id) ya da null
 */
export const LAFPOS_MOVE_KINDS = ["harcama", "teslim", "giris"] as const;
export const cashMoveSchema = z.object({
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  kind: z.enum(LAFPOS_MOVE_KINDS),
  amount: tl.refine((v) => v > 0),
  description: z
    .string()
    .max(1000)
    .nullable()
    .transform((v) => v?.trim().slice(0, 200) ?? ""),
  // Takvimde olan an: biçime uyan ama olmayan an ("…T25:99") satırın saatine Invalid Date yazdırır, yazım düşer ve gün
  // 500 alır (LafPOS yeniden dener, gün hiç yazılmaz). Okunamayan an listeyi düşürür (soft; gün yine yazılır)
  at: z
    .string()
    .max(40)
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    .refine((v) => Number.isFinite(Date.parse(v))),
  categoryId: z.number().int().positive().max(2_147_483_647).nullable(),
});

/** Hareketlerin listesi: aynı kimlik iki kez geçmez (geçerse liste okunamaz sayılır, satırlara dokunulmaz) */
const cashMovesSchema = z
  .array(cashMoveSchema)
  .max(2000)
  .refine((ms) => new Set(ms.map((m) => m.id)).size === ms.length);

/** Ödeme türünün cinsi (LafPOS payment_methods.kind): "Diğer"in içinde cari ile havaleyi ayırır */
export const PAYMENT_KINDS = ["nakit", "kart", "yemek", "havale", "cari", "online", "diger"] as const;
const paymentKind = z.enum(PAYMENT_KINDS);

const paymentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  zField: z.enum(["cash", "card", "meal_card", "online", "other"]),
  /** Komisyon kanalı (pluxee, multinet, edenred, setcard, metropol, yemeksepeti…) */
  channel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  count,
  amount: tl,
  /** Gün sonu tam: ödeme türünün cinsi (eski LafPOS göndermez). Günün özetine (dayHash) girmez */
  kind: soft(paymentKind),
});

/**
 * Gün sonu tam (24 Kasım 2026): siparişsiz tahsilatlar (cari tahsilatı), ödeme türü başına. Müşterinin adı ve kimliği
 * gelmez. Kart satırlarının toplamı z.cardCollections
 */
const collectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  zField: z.enum(["cash", "card", "meal_card", "online", "other"]),
  channel: z
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => v || null),
  kind: paymentKind,
  count,
  amount: tl,
});

/** Gün sonu tam: vardiya devrinde sayım (kişi gelmez); fark işaretli (sayılan − beklenen) */
const shiftCountSchema = z.object({
  at: isoInstant.unwrap(),
  counted: tl,
  expected: tl,
  diff: signedTl,
  confirmed: z.boolean(),
});

/** Gün sonu tam: indirim satırları (Σ amount = z.discounts); indirimi yapan gelmez */
const discountLineSchema = z.object({
  scope: z.enum(["order", "item"]),
  posName: posName.nullable(),
  type: z.enum(["percent", "amount"]),
  value: z.number().finite().min(0).max(MAX_TL),
  amount: tl,
  reason: reasonText,
});

/**
 * Gün sonu tam (24 Kasım 2026): yazarkasanın (mali cihaz: Pavo e-Arşiv ya da TokenX ÖKC) günün belgelerinden rakamları.
 * `zReport`: cihaz mali Z basıyor mu (TokenX evet, Pavo hayır: VUK 507, e-Arşiv). `docs` tamamlanan belge sayısı; tutarlar
 * o belgelerle kaydedilen, iade edilmemiş ödemeler (online ve diğer "other"da); `voided` cihazda iptal edilen belgeler
 * (yukarıdakilere girmez); `vat` tamamlanan belgelerin sepetinden (hesaplanamazsa null). Değişmezler: cash = z.cash −
 * offDevice.cash − voided.cash; card = z.card − offDevice.card − voided.card. Cihaz yoksa ya da eski LafPOS'ta alan yok
 */
export const okcSchema = z.object({
  provider: z.enum(["pavo", "tokenx"]),
  zReport: z.boolean(),
  docs: count,
  cash: tl,
  card: tl,
  mealCard: tl,
  other: tl,
  total: tl,
  voided: z.object({ count, cash: tl, card: tl }),
  vat: z.array(z.object({ rate: z.number().finite().min(0).max(100), total: tl, vat: tl })).max(10).nullable(),
});
export type PosOkc = z.output<typeof okcSchema>;

/**
 * Gün sonu tam: Pavo'nun bu LafPOS gününe ait başarılı gün sonları (batch), eskiden yeniye (gün ortasında elle alınan da).
 * `total` Pavo'nun genel toplamı (TL); okunamadıysa null
 */
const batchSchema = z.object({
  batchNo: z
    .string()
    .max(60)
    .nullable()
    .transform((v) => v?.trim() || null),
  at: z.string().trim().max(40),
  total: tl.nullable(),
  trigger: z.enum(["otomatik", "elle"]),
  dayClosed: z.boolean(),
});
export type PavoBatch = z.output<typeof batchSchema>;

/**
 * Banka POS (Pavo) gün sonu karşılaştırması (isteğe bağlı; LafPOS PR #154, server/sync/lafmaliyet.ts buildDayPayload):
 * Pavo'nun kart toplamı LafPOS'un kart toplamıyla. Pavo sonucu gün kapandıktan birkaç dakika sonra geldiği için aynı gün
 * bu alanla ikinci kez gelir. Tutarlar TL. Okunamayan alan günü reddetmez: yalnız karşılaştırma düşer (posDaySchema'da
 * `.catch`; parsePosDay günlüğe yazar), gün sonu yine yazılır. Bilinmeyen durum (ileride gelecek ya da LafPOS'un eski
 * sürümünün "running"i) karşılaştırmayı düşürmez, "unknown" okunur: mesaj ve tutarlar yine görünür.
 */
export const BANK_POS_STATUSES = ["ok", "failed", "unknown"] as const;
export const bankPosSchema = z.object({
  status: z
    .string()
    .max(40)
    .transform((s): (typeof BANK_POS_STATUSES)[number] => ((BANK_POS_STATUSES as readonly string[]).includes(s) ? (s as (typeof BANK_POS_STATUSES)[number]) : "unknown")),
  batchNo: z
    .string()
    .max(60)
    .nullable()
    .transform((v) => v?.trim() || null),
  at: z.string().trim().max(40),
  pavoCard: tl.nullable(),
  lafposCard: tl.nullable(),
  diff: signedTl.nullable(),
  acquirers: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        count: count.nullable(),
        total: tl.nullable(),
      }),
    )
    .max(50),
  message: z
    .string()
    .max(1000)
    .nullable()
    .transform((v) => v?.trim().slice(0, 300) || null),
  /** Faz 2: cihazın hata kodu (alınamayan gün sonu, ör. "5085"); alındıysa ya da kod yoksa null. Bozuksa yok sayılır */
  errorCode: soft(shortText(40)),
  /**
   * Gün sonu tam (24 Kasım 2026): günün bütün başarılı Pavo gün sonları (eskiden yeniye, en çok 20; hiçbiri başarılı
   * değilse `[]`). pavoCard / lafposCard / diff yalnız son batch'indir; günün banka toplamı Σ batches.total. Eski LafPOS
   * göndermez
   */
  batches: soft(z.array(batchSchema).max(20)),
  /** Gün sonu tam: LafPOS'un bütün günün kıyas tabanı (Z kartı + kart bahşişi + kart tahsilatı − yazarkasadan geçmeyen − cihazda iptal); gün açıkken null */
  dayCard: soft(tl.nullable()),
});

export type BankPos = z.output<typeof bankPosSchema>;

/** Gövdenin `workedStaffRefs`'i: en çok 500 kimlik; okunurken tekil ve sayı sırasıyla (src/lib/lafpos/personel.ts) */
const workedStaffRefsSchema = z.array(z.string().regex(STAFF_REF)).max(STAFF_REFS_MAX).transform(sortStaffRefs);

export const posDaySchema = z.object({
  version: z.literal(LAFPOS_VERSION),
  source: z.literal("lafpos"),
  /** Kasanın şubesi (LafPOS › Ayarlar › Şube); eski kasa göndermez. LafPOS'un şubesinden (kütükten, lafposBranchId) başkaysa gün reddedilir */
  sube: z.string().regex(/^[a-z][a-z0-9-]{1,23}$/).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(realDate),
  z: posZSchema,
  lines: z.array(lineSchema).max(3000),
  ikram: z.array(ikramSchema).max(2000),
  payments: z.array(paymentSchema).max(200),
  /** Pavo – LafPOS kart karşılaştırması (isteğe bağlı; eski LafPOS göndermez). Bozuksa yok sayılır, gün reddedilmez */
  bankPos: bankPosSchema.nullable().optional().catch(undefined),
  // Faz 2 (23 Kasım 2026; docs/LAFPOS.md › Faz 2 alanları). Hepsi isteğe bağlı; bozuksa yok sayılır, gün reddedilmez
  /** Bu tarihin kaçıncı gönderimi (1'den; LafPOS'tan 200 almış gönderimler + 1). Sürüm geçmişi (pos_day_revisions) bunu da saklar */
  revision: soft(z.number().int().min(1).max(1_000_000)),
  /** Düzeltme: gün yeniden açıldı (`reopen`) ya da kapandıktan sonra sayım değişti (`recount`); yalnız düzeltmeyi taşıyan gövdede */
  correction: soft(z.object({ kind: z.enum(["reopen", "recount"]), reason: z.string().max(1000).transform((v) => v.trim().slice(0, 200)) })),
  /**
   * Mali fişi yazarkasada kesilmeyen satış ödemeleri (bahşiş hariç); gün sonu tam: o kart ödemelerinin bahşişi ayrıca
   * (`cardTips`; Pavo'nun batch'inde de yok, eski LafPOS göndermez)
   */
  offDevice: soft(z.object({ card: tl, cash: tl, cardTips: soft(tl) })),
  /** Günün iptal edilen ödemeleri (en çok 2000) */
  refunds: soft(z.array(refundSchema).max(2000)),
  /** Günün iptal edilen kalemleri (en çok 2000 parça) */
  iptal: soft(z.array(iptalSchema).max(2000)),
  /**
   * Faz 3: günün kasa hareketleri yazıldığı sırayla (harcama, teslim, giriş). Yeni LafPOS hep gönderir, hareketsiz günde
   * `[]`: "hareket yok" eski LafPOS'tan (alan yok) ayrılır. Bozuk tek hareket bütün listeyi düşürür (satırlara dokunulmaz)
   */
  cashMoves: soft(cashMovesSchema),
  // Gün sonu tam (24 Kasım 2026; docs/LAFPOS.md › Gün sonu otomasyonu). Hepsi isteğe bağlı; bozuksa yok sayılır
  /** Yazarkasanın (mali cihaz) günün belgelerinden rakamları; cihaz yoksa ya da eski LafPOS'ta yok */
  okc: soft(okcSchema),
  /** Siparişsiz tahsilatlar (cari), ödeme türü başına (en çok 200; yoksa `[]`) */
  collections: soft(z.array(collectionSchema).max(200)),
  /** Vardiya devri sayımları (en çok 50; yoksa `[]`) */
  shiftCounts: soft(z.array(shiftCountSchema).max(50)),
  /** İndirim satırları (en çok 2000; yoksa `[]`) */
  discountLines: soft(z.array(discountLineSchema).max(2000)),
  /**
   * LM-4b (personel bağlantısı; docs/LAFPOS.md › Personel bağlantısı): o gün çalışanların lafmaliyet personel kimlikleri
   * (`s:<staff.id>`), tekil, sayı sırasıyla. Yalnız en az bir LafPOS kullanıcısı bağlıyken gelir (yoksa bilinmiyor); `[]`
   * "bağlı var, o gün kimse çalışmadı". Ad ve kullanıcı kimliği gitmez. Bozuksa yok sayılır, gün reddedilmez
   */
  workedStaffRefs: soft(workedStaffRefsSchema),
});

export type PosDayPush = z.output<typeof posDaySchema>;
export type PosDayZ = z.output<typeof posZSchema>;
export type PosDayLine = PosDayPush["lines"][number];
export type PosIkram = PosDayPush["ikram"][number];
export type PosPayment = PosDayPush["payments"][number];
export type PosRefund = NonNullable<PosDayPush["refunds"]>[number];
export type PosIptal = NonNullable<PosDayPush["iptal"]>[number];
export type PosCorrection = NonNullable<PosDayPush["correction"]>;
export type PosOffDevice = NonNullable<PosDayPush["offDevice"]>;
export type PosCashMove = NonNullable<PosDayPush["cashMoves"]>[number];
export type PosCollection = NonNullable<PosDayPush["collections"]>[number];
export type PosShiftCount = NonNullable<PosDayPush["shiftCounts"]>[number];
export type PosDiscountLine = NonNullable<PosDayPush["discountLines"]>[number];

/** Takvimde olan gün (2026-02-30 değil), 2020'den sonra */
function realDate(v: string): boolean {
  return isCalendarDate(v) && Number(v.slice(0, 4)) >= 2020;
}

export type PosDayParse = { ok: true; data: PosDayPush } | { ok: false; field: string };

/**
 * Gövdeyi okur: katı JSON, şema, ileri tarih (bugünün iş gününden sonrası; LafPOS'un saati kaymış) ve aynı POS adının
 * iki kez geçmesi (günde bir ada bir satır: lafmaliyet ürünü adla eşleştirir). Hata yanıtı yalnız ilk sorunlu alanın
 * yolunu verir (`lines.3.qty`); gövde okunamazsa `body`.
 */
export function parsePosDay(body: string, now: Date = new Date()): PosDayParse {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, field: "body" };
  }
  const r = posDaySchema.safeParse(json);
  if (!r.success) {
    const path = r.error.issues[0]?.path ?? [];
    return { ok: false, field: path.length ? path.map(String).join(".") : "body" };
  }
  if (r.data.date > businessDate(now)) return { ok: false, field: "date" };
  // Pavo karşılaştırması okunamadıysa gün yine yazılır, ama sessiz kalmaz (önceki karşılaştırma yerinde kalır)
  const sentBank = (json as { bankPos?: unknown }).bankPos;
  if (sentBank !== undefined && sentBank !== null && r.data.bankPos === undefined) {
    const issue = bankPosSchema.safeParse(sentBank).error?.issues[0];
    console.warn("[lafpos] bankPos okunamadı, karşılaştırma yazılmadı:", issue ? `${issue.path.map(String).join(".") || "bankPos"}: ${issue.code}` : "bankPos");
  }
  // Okunamayan Faz 2 ve Faz 3 alanları: gün yazılır, alan yazılmaz; günlükte görünür (LafPOS'un sürümü ile panelin şeması ayrıştı)
  const dropped = droppedSoftFields(json, r.data);
  if (dropped.length) console.warn("[lafpos] okunamayan alanlar yazılmadı:", r.data.date, dropped.join(", "));
  const seen = new Set<string>();
  for (const [i, l] of r.data.lines.entries()) {
    if (seen.has(l.posName)) return { ok: false, field: `lines.${i}.posName` };
    seen.add(l.posName);
  }
  return { ok: true, data: r.data };
}

const TOP_SOFT = ["revision", "correction", "offDevice", "refunds", "iptal", "cashMoves", "okc", "collections", "shiftCounts", "discountLines", "workedStaffRefs"] as const;
const Z_SOFT = [
  "listValue",
  "ikramTotal",
  "odenmezTotal",
  "zayiTotal",
  "vat",
  "openedAt",
  "closedAt",
  "okcZNo",
  "expectedOpening",
  "openingDiff",
  "openingReason",
  "cashTips",
  "closeNote",
  "methodCounts",
] as const;

/**
 * Gönderilip okunamayan Faz 2, Faz 3, gün sonu tam ve şube fiyatı alanlarının yolları ("z.vat", "lines.3.gross", "lines.3.listPrices", "bankPos.errorCode",
 * "bankPos.batches", "offDevice.cardTips", "payments.0.kind", "cashMoves")
 */
function droppedSoftFields(json: unknown, data: PosDayPush): string[] {
  const raw = json as Record<string, unknown> & {
    z?: Record<string, unknown>;
    lines?: Record<string, unknown>[];
    ikram?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    bankPos?: Record<string, unknown> | null;
    offDevice?: Record<string, unknown> | null;
  };
  const sent = (o: Record<string, unknown> | null | undefined, k: string) => !!o && typeof o === "object" && k in o && o[k] !== undefined;
  const out: string[] = [];
  for (const k of TOP_SOFT) if (sent(raw, k) && data[k] === undefined) out.push(k);
  for (const k of Z_SOFT) if (sent(raw.z, k) && data.z[k] === undefined) out.push(`z.${k}`);
  data.lines.forEach((l, i) => {
    for (const k of ["gross", "isAddon", "listPrices"] as const) if (sent(raw.lines?.[i], k) && l[k] === undefined) out.push(`lines.${i}.${k}`);
  });
  data.ikram.forEach((l, i) => {
    for (const k of ["kind", "personKind"] as const) if (sent(raw.ikram?.[i], k) && l[k] === undefined) out.push(`ikram.${i}.${k}`);
  });
  data.payments.forEach((p, i) => {
    if (sent(raw.payments?.[i], "kind") && p.kind === undefined) out.push(`payments.${i}.kind`);
  });
  for (const k of ["errorCode", "batches", "dayCard"] as const) if (data.bankPos && sent(raw.bankPos, k) && data.bankPos[k] === undefined) out.push(`bankPos.${k}`);
  if (data.offDevice && sent(raw.offDevice, "cardTips") && data.offDevice.cardTips === undefined) out.push("offDevice.cardTips");
  return out.slice(0, 20);
}

/**
 * Gövde `workedStaffRefs`'i taşıyor ve okunuyor mu (uç 200 yanıtına `staff`'ı yalnız o zaman koyar; src/server/lafpos/
 * status.ts handlePosDay): okunmuş liste ya da undefined (alan yok, bozuk ya da gövde JSON değil). Gövdenin kendisi
 * receivePosDay'de denetlenir; bu yalnız alanı yeniden okur
 */
export function sentWorkedStaffRefs(body: string): string[] | undefined {
  try {
    const json = JSON.parse(body) as { workedStaffRefs?: unknown } | null;
    if (!json || typeof json !== "object" || json.workedStaffRefs === undefined) return undefined;
    const r = workedStaffRefsSchema.safeParse(json.workedStaffRefs);
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

/** Sitenin kalemi ve boyu → panel ürünü aramasının anahtarı */
export const siteSlotKey = (siteMenuId: string, slot: "M" | "L") => `${siteMenuId}|${slot}`;

export interface PosLineMatch {
  productId: number | null;
  isService: boolean;
  /** Nereden bulundu: sitenin kalemi, POS adı eşleştirmesi, LafPOS'un hizmet işareti; bulunmadıysa null */
  via: "site" | "eslestirme" | "hizmet" | null;
}

/**
 * Satırın panel ürünü (docs/03-ENTEGRASYON.md §4): LafPOS'un hizmet satırı (karaoke) ürüne bağlanmaz; sonra sitenin
 * kalemi ve boyu (`products.site_menu_id` + `site_menu_slot`); bulunmazsa POS adı eşleştirmesi (`pos_mappings`,
 * posMatchKey: büyük / küçük harf ve I / İ farkı yok; ModPOS'tan öğrenilmiş eşleştirmeler çalışmaya devam eder;
 * HİZMET eşleştirmesi de). Hiçbiri yoksa ürünsüz satır.
 */
export function resolvePosLine(
  line: Pick<PosDayLine, "posName" | "siteMenuId" | "slot" | "isService">,
  bySite: ReadonlyMap<string, number>,
  mapping: (posName: string) => { productId: number | null; isService: boolean } | undefined,
): PosLineMatch {
  if (line.isService) return { productId: null, isService: true, via: "hizmet" };
  if (line.siteMenuId && line.slot) {
    const id = bySite.get(siteSlotKey(line.siteMenuId, line.slot));
    if (id !== undefined) return { productId: id, isService: false, via: "site" };
  }
  const m = mapping(line.posName);
  if (m && (m.productId !== null || m.isService)) return { productId: m.productId, isService: m.isService, via: "eslestirme" };
  return { productId: null, isService: false, via: null };
}
