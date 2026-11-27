import "server-only";

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import type { z } from "zod";

import { staffCategory, staffExpenseLocked } from "@/lib/cash-outs";
import { branchSwitchDay, isAsilposDay } from "@/lib/asilpos/switch";
import { normalizeZ } from "@/lib/photo-read/kasa";
import { cheapFirst, receiptReadProblems, zReadProblems, type CheapStep } from "@/lib/photo-read/cheap-first";
import { cheapReadingProblems, formFailureOf } from "@/lib/photo-read/asilpos-read";
import { normalizeOkc, okcReadingOnAsilposDay, okcToLegacyPos, toStaffReading } from "@/lib/photo-read/okc";
import { OKC_TASK, RECEIPT_TASK, SYSTEM, Z_TASK } from "@/lib/photo-read/prompts";
import type { PhotoReading } from "@/lib/photo-read/reading";
import { normalizeReceipt, receiptToStore } from "@/lib/photo-read/receipt";
import { KasaOkcRaw, KasaZRaw, ReceiptRaw } from "@/lib/photo-read/schemas";
import { addDays } from "@/lib/reminders";
import { extractImage, loadAiSettings, type AiErrorCode, type AiResult } from "@/server/ai/claude";
import { OKC_EFFORT, OKC_MAX_TOKENS, RETRYABLE, type AiEffort, type AiImageType, type AiTimeouts } from "@/server/ai/run";
import { can, opsLevel } from "@/lib/roles";
import type { CurrentUser } from "@/server/auth/dal";
import { currentTillBranch } from "@/server/branch-scope";
import { cashOutCategories } from "@/server/data/cash-outs";
import { previousOkc } from "@/server/data/cash-reports";
import { asilposSwitchDayOf } from "@/server/data/asilpos-ikram";
import { getDb, schema as s } from "@/server/db";
import { asilposBranchId } from "@/server/asilpos/branch";
import { asilposOkcDeviceOf } from "@/server/asilpos/foto";

import { logPhotoRead, readAsilposDayPhoto } from "./asilpos";

export interface ReadOutcome {
  reading: PhotoReading | null;
  /** Okunamadı (servis, sınır, kapalı): fotoğraf yine saklandı; metin personele */
  readError: string | null;
  readCode: AiErrorCode | null;
  /** "Yeniden dene" anlamlı mı */
  canRetry: boolean;
}

/**
 * Ucuz okuma (önce): tek 15 sn'lik deneme. Güçlü okuma (gerekirse) 35 sn'ye sığar: fotoğraf yolu 60 sn'de kesilir
 * (src/app/api/foto/route.ts), ucuz + güçlü + yanıt payı ona sığar
 */
const CHEAP_FIRST_TIMEOUTS: AiTimeouts = { timeout: 15_000, maxRetries: 1, totalMs: 15_000 };
const STRONG_AFTER_CHEAP_TIMEOUTS: AiTimeouts = { timeout: 35_000, maxRetries: 0, totalMs: 35_000 };

/**
 * Kasanın şubesinde bu günden önceki son raporun Z no'su (Z no sırası denetimi; "eski bir Z raporu olabilir"). Her
 * şubenin kendi ModPOS'u ve Z sayacı var (docs/SUBE.md): öteki şubenin Z'siyle karşılaştırılmaz. Şube formun kasasıdır
 * (`currentTillBranch`; yazarkasa Z'sinin `previousOkc`'si gibi)
 */
async function previousZNo(day: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ zNo: s.cashReports.zNo })
    .from(s.cashReports)
    .where(and(lt(s.cashReports.date, day), eq(s.cashReports.branchId, await currentTillBranch())))
    .orderBy(desc(s.cashReports.date))
    .limit(1);
  return row?.zNo ?? null;
}

/**
 * Büyüklük denetimi için son 28 günün toplamları (plan §5.1): yazarkasa toplamları, hiç yoksa ModPOS Z toplamları
 * (yazarkasa bölümü kullanılmaya başlamadan önceki günler). Önceki yazarkasa Z'si (`previousOkc`, Z no sırası ve
 * kümülatif zinciri) kayıtlı raporların okc_* sütunlarından okunur; zincir denetimi burada, okumada yapılır (D17).
 * Toplamlar kasanın şubesinin (`currentTillBranch`; `previousZNo` gibi): iki şubenin toplamı karışınca ortanca öbür
 * şubeye kayıyordu; büyük şubenin gerçek Z'si "çok büyük" görünebiliyor, küçük şubede okunan kümülatif uyarısız
 * kalabiliyordu
 */
async function okcTypical(day: string): Promise<number[]> {
  const rows = await getDb()
    .select({ okc: s.cashReports.okcTotal, z: s.cashReports.zTotal })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, addDays(day, -28)), lt(s.cashReports.date, day), eq(s.cashReports.branchId, await currentTillBranch())));
  const okc = rows.map((r) => r.okc).filter((v): v is number => v !== null && v > 0);
  return okc.length ? okc : rows.map((r) => r.z).filter((v) => v > 0);
}

/** Tekrar denetiminin okuduğu kayıtlar (`recentReceipts`) */
export interface ReceiptLookupScope {
  /** Yalnız bu şubenin kasadan çıkanları ve harcama kayıtları (işletme geneli, şubesiz kayıt da yok); null: hepsi */
  branchId: string | null;
  /** Yöneticinin kategorisindeki (maaş, kira, reklam) satır ve kayıt da (`kategori.tum`) */
  allCategories: boolean;
}

const EVERY_RECEIPT: ReceiptLookupScope = { branchId: null, allCategories: true };

/** Birleşimin kategorisi (kasadan çıkanın harcama kaydı yoksa null) */
const joinedCategory = (c: { section: string | null; panelGroup: string | null; active: boolean | null }) =>
  c.section !== null && c.panelGroup !== null && c.active !== null ? { section: c.section, panelGroup: c.panelGroup, active: c.active } : null;

const CATEGORY_COLUMNS = { section: s.expenseCategories.section, panelGroup: s.expenseCategories.panelGroup, active: s.expenseCategories.active };

/**
 * Aynı fişin ikinci kez eklenmesine karşı: günün ±1 kasadan çıkanları ve (yöneticide) ±7 gün harcama kayıtları. Personel
 * için harcama kayıtları okunmaz (yöneticinin maaş, kira gibi kayıtları; tekrar uyarısı personelde genel metindir,
 * ayrıntılı eşleşme yöneticinin onay kartında).
 *
 * Müdürün uyarısı ayrıntılıdır (eşleşen satırın adı, tutarı, günü), bu yüzden `scope` onunkine daralır: yalnız şubesinin
 * kasadan çıkanları ve harcama kayıtları, yalnız personelin kategorisinde (öteki şubenin satırı, işletme geneli kayıt,
 * maaş ve kira gibi yöneticinin kategorisindeki satır ve kayıt okunmaz; docs/ROLLER.md › Kararlar; Onaylar'ın olası
 * tekrar listesiyle aynı kural, `cashOutCards`)
 */
export async function recentReceipts(day: string, staff: boolean, scope: ReceiptLookupScope = EVERY_RECEIPT) {
  const db = getDb();
  const outs = (
    await db
      .select({ date: s.cashOuts.date, receiptDate: s.cashOuts.receiptDate, amount: s.cashOuts.amount, store: s.cashOuts.store, receiptNo: s.cashOuts.receiptNo, ...CATEGORY_COLUMNS })
      .from(s.cashOuts)
      .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(and(gte(s.cashOuts.date, addDays(day, -1)), lte(s.cashOuts.date, addDays(day, 1)), scope.branchId !== null ? eq(s.cashOuts.branchId, scope.branchId) : undefined))
  )
    .filter((o) => scope.allCategories || !staffExpenseLocked(joinedCategory(o)))
    .map((o) => ({ date: o.receiptDate ?? o.date, amount: o.amount, store: o.store, receiptNo: o.receiptNo }));
  if (staff) return outs;
  const entries = await db
    .select({ date: s.expenseEntries.date, amount: s.expenseEntries.amount, store: s.expenseEntries.description, cashOutId: s.expenseEntries.cashOutId, ...CATEGORY_COLUMNS })
    .from(s.expenseEntries)
    .innerJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
    .where(and(gte(s.expenseEntries.date, addDays(day, -7)), lte(s.expenseEntries.date, addDays(day, 7)), scope.branchId !== null ? eq(s.expenseEntries.branchId, scope.branchId) : undefined));
  return [
    ...outs,
    // Kasadan çıkanın harcama kaydı zaten yukarıda (satırın kendisi)
    ...entries
      .filter((e) => e.cashOutId === null && (scope.allCategories || staffCategory(e)))
      .map((e) => ({ date: e.date, amount: e.amount, store: e.store, receiptNo: null })),
  ];
}

/**
 * Fotoğrafı türüne göre okur ve forma gidecek hâle getirir. Okuma hatası isteği bozmaz: fotoğraf saklanmıştır,
 * personel rakamları elle yazar ya da yeniden dener.
 *
 * Her tür önce ucuz modelle okunur, okunuş eksik ya da tutarsızsa bir kez güçlü modelle (cheapFirst; ucuz 15 sn, güçlü
 * 35 sn). AsilPOS gününün kasa fotoğrafının kendi sırası var (readAsilposDayPhoto: ucuz → güçlü → kod).
 *
 * Yazarkasa Z'si (`kasa-okc`, plan §4.4, §7): `OKC_TASK` + `KasaOkcRaw`, ucuzda efor `OKC_EFFORT`; önceki
 * Z ve son 28 günün toplamları okumayla paralel okunur, kimlikler ve zincir sunucuda. Personel kümülatifi, yazarkasa
 * dışı tahsilatı ve yöneticinin satırlarını almaz (toStaffReading, D17); ham sonuç ai_calls.result'ta tam durur.
 * `kasa-pos` geçiştir (D2): eski sayfanın isteği; fotoğraf çağıranda `kasa-okc` yapılmıştır, aynı okuma yapılır ve
 * ai_calls'a `kasa-okc` yazılır, yanıt eski biçimde (okcToLegacyPos).
 */
export async function readPhotoFor(
  kind: "kasa-z" | "kasa-okc" | "kasa-pos" | "fis",
  input: { photoId: number; bytes: Uint8Array; contentType: AiImageType; day: string; me: CurrentUser },
): Promise<ReadOutcome> {
  const feature = kind === "kasa-pos" ? "kasa-okc" : kind;
  const base = { feature, userId: input.me.id, photoId: input.photoId, image: { bytes: input.bytes, mediaType: input.contentType }, system: SYSTEM } as const;
  const failed = (code: AiErrorCode, message: string): ReadOutcome => ({ reading: null, readError: message, readCode: code, canRetry: RETRYABLE.includes(code) });
  // Önce ucuz model, okunuş eksik ya da tutarsızsa bir kez güçlü model (src/lib/photo-read/cheap-first.ts; sahibin isteği,
  // 25 Kasım 2026). Modeller Ayarlar'dan (ai.settings › photoModels)
  const { cheap, strong } = (await loadAiSettings()).photoModels;
  const twoStep = async <T,>(o: { task: string; schema: z.ZodType<T>; problems: (d: T) => string[]; cheapEffort?: AiEffort; maxTokens?: number; stored?: (d: T) => T }) => {
    const step = (res: AiResult<T>, model: string): CheapStep<T> => (res.ok ? { ok: true, data: res.data, model: res.fallback ? res.servedModel : model } : { ok: false, code: res.code, message: res.message });
    const common = { ...base, task: o.task, schema: o.schema, ...(o.maxTokens ? { maxTokens: o.maxTokens } : {}), ...(o.stored ? { stored: o.stored } : {}) };
    return cheapFirst<T>({
      cheap: async () => step(await extractImage({ ...common, model: cheap, ...(o.cheapEffort ? { effort: o.cheapEffort } : {}), timeouts: CHEAP_FIRST_TIMEOUTS }), cheap),
      strong: async () => step(await extractImage({ ...common, model: strong, timeouts: STRONG_AFTER_CHEAP_TIMEOUTS }), strong),
      problems: o.problems,
    });
  };
  if (kind === "kasa-z") {
    const [prevZNo, run] = await Promise.all([previousZNo(input.day), twoStep({ task: Z_TASK(input.day), schema: KasaZRaw, problems: zReadProblems })]);
    const res = run.result;
    logPhotoRead({ photoId: input.photoId, kind, steps: run.steps, model: res.ok ? res.model : null, documentType: res.ok ? res.data.documentType : null, ok: res.ok });
    if (!res.ok) return failed(res.code, res.message);
    return { reading: normalizeZ(res.data, { day: input.day, prevZNo }), readError: null, readCode: null, canRetry: false };
  }
  if (kind === "kasa-okc" || kind === "kasa-pos") {
    // AsilPOS gününün kasa fotoğrafı (Pavo'nun detaylı Z'si): önce ucuz model, gerekirse bir kez güçlü model, yapay zekâ
    // yoksa kodla (src/server/photo-read/asilpos.ts). Gün sonu fotoğrafı kartı yanıtın okunuşunu ve hatasını göstermez
    // (karşılaştırma yöneticinin); elle girilen raporun formu (OkcCard) alanları yalnız yapay zekâ okunuşuyla doldurur,
    // kodla okunduysa ya da okunamadıysa yapay zekânın hatası eskisi gibi (formFailureOf)
    const till = await currentTillBranch();
    const asilpos = await readAsilposDayPhoto(getDb(), { photoId: input.photoId, bytes: input.bytes, contentType: input.contentType, day: input.day, userId: input.me.id, branchId: till });
    if (asilpos) {
      const failure = formFailureOf(asilpos);
      if (failure || !asilpos.raw) {
        const code = failure && failure.code !== "ocr" ? failure.code : null;
        return { reading: null, readError: failure?.message ?? "Fotoğraf okunamadı; rakamları elle yazın.", readCode: code, canRetry: code !== null && RETRYABLE.includes(code) };
      }
      const [prev, recentTotals] = await Promise.all([previousOkc(input.day), okcTypical(input.day)]);
      // Pavo gününde yalnız banka gün sonu okunduysa "Z'yi de çekin" denmez (Pavo ayrı mali Z basmaz; rakamlar AsilPOS'tan)
      const full = okcReadingOnAsilposDay(normalizeOkc(asilpos.raw, { day: input.day, prev, recentTotals }), asilpos.device);
      const reading = opsLevel(input.me.role) === "admin" ? full : toStaffReading(full);
      return { reading: kind === "kasa-pos" ? okcToLegacyPos(reading) : reading, readError: null, readCode: null, canRetry: false };
    }
    const [prev, recentTotals, asilposDay, run] = await Promise.all([
      previousOkc(input.day),
      okcTypical(input.day),
      // Günün kasası: AsilPOS gününde ModPOS Z bölümü yok, oraya okutma önerilmez (denetim E-39). Kasanın şubesinin geçiş
      // günü (branchSwitchDay): ModPOS'ta kalan şubede öneri kalır
      Promise.all([asilposSwitchDayOf(getDb()), currentTillBranch(), asilposBranchId()])
        .then(async ([d, b, l]) => {
          const switchDay = branchSwitchDay(d, b, l);
          // AsilPOS gününde günün kaydı henüz yoksa cihaz şubenin son gün sonundan (Pavo ayrı mali Z basmaz)
          return { switchDay, device: isAsilposDay(input.day, switchDay) ? await asilposOkcDeviceOf(getDb(), b).catch(() => null) : null };
        })
        .catch(() => ({ switchDay: null, device: null })),
      twoStep({ task: OKC_TASK(input.day), schema: KasaOkcRaw, problems: (raw) => cheapReadingProblems(raw, { expectBatches: false }), cheapEffort: OKC_EFFORT, maxTokens: OKC_MAX_TOKENS }),
    ]);
    const res = run.result;
    logPhotoRead({ photoId: input.photoId, kind, steps: run.steps, model: res.ok ? res.model : null, documentType: res.ok ? res.data.documentType : null, ok: res.ok });
    if (!res.ok) return failed(res.code, res.message);
    const normalized = normalizeOkc(res.data, { day: input.day, prev, recentTotals });
    const full = isAsilposDay(input.day, asilposDay.switchDay) ? okcReadingOnAsilposDay(normalized, asilposDay.device) : normalized;
    const reading = opsLevel(input.me.role) === "admin" ? full : toStaffReading(full);
    return { reading: kind === "kasa-pos" ? okcToLegacyPos(reading) : reading, readError: null, readCode: null, canRetry: false };
  }
  const staff = opsLevel(input.me.role) !== "admin";
  // Önerilen kategori kişinin yazabildiklerinden (writeCashOut'un kuralı): müdür "admin" düzeyinde yazar ama maaş, kira,
  // reklam gibi kategorileri seçemez (`kategori.tum`; docs/ROLLER.md › Kararlar). Bütün liste ona önerilseydi forma
  // seçicide olmayan bir kategori düşer, kayıt "yalnız yönetici" diye reddedilirdi
  const allCategories = !staff && can(input.me.role, "kategori.tum");
  // Tekrar denetimi: müdürün ayrıntılı uyarısı yalnız şubesinin ve personelin kategorisinin kayıtlarından (öteki şube,
  // işletme geneli, maaş ve kira kaydı okunmaz; recentReceipts). Personelin uyarısı genel metindir, kapsamı değişmedi
  const scope: ReceiptLookupScope | undefined = staff
    ? undefined
    : { branchId: can(input.me.role, "sube.tumu") ? null : (input.me.branchId ?? (await currentTillBranch())), allCategories };
  const [categories, recent] = await Promise.all([cashOutCategories(allCategories ? "admin" : "staff"), recentReceipts(input.day, staff, scope)]);
  const run = await twoStep({ task: RECEIPT_TASK(input.day, categories), schema: ReceiptRaw, problems: receiptReadProblems, stored: receiptToStore });
  const res = run.result;
  logPhotoRead({ photoId: input.photoId, kind, steps: run.steps, model: res.ok ? res.model : null, documentType: res.ok ? res.data.documentType : null, ok: res.ok });
  if (!res.ok) return failed(res.code, res.message);
  return { reading: { kind: "fis", ...normalizeReceipt(res.data, { day: input.day, categories, recent, staff }) }, readError: null, readCode: null, canRetry: false };
}

