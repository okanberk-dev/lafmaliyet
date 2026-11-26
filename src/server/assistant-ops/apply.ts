import "server-only";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { dateTR, tl } from "@/lib/format";
import { priceReminder } from "@/lib/prices/pos";
import type { OpName } from "@/lib/assistant/op-specs";
import { formatShiftCell, parseShiftCell, refUserId, weekDays } from "@/lib/vardiya";
import { saveSupplierPayment } from "@/server/actions/cari";
import { saveCashOut } from "@/server/actions/cash-outs";
import { saveExpenseEntry } from "@/server/actions/expenses";
import { setIngredientEstimate, updateIngredientPrice } from "@/server/actions/ingredients";
import { restoreInvoicePayment, setInvoicePayment } from "@/server/actions/invoices";
import { logActivity } from "@/server/actions/log";
import { setSoldOut } from "@/server/actions/menu-status";
import { saveProductLink } from "@/server/actions/parasut";
import { updateProductPrice } from "@/server/actions/products";
import { markReminderDone, restoreReminder, saveReminder, setReminderActive } from "@/server/actions/reminders";
import type { ActionResult } from "@/server/actions/util";
import { saveShiftWeekAction } from "@/server/actions/vardiya";
import { addWasteEntry } from "@/server/actions/waste";
import { getDb, schema as s } from "@/server/db";

import { createdReminderId, ingredientPrice, invoicePaymentState, personCells, productPrice, reminderState } from "./preview";
import type { ApplyResult, OpApplier, UndoResult } from "./types";

/*
 * İşlemlerin uygulanması (docs/ASISTAN-ISLEMLER.md § 2): her uyarlayıcı mevcut sunucu eylemini AYNI doğrulama ve
 * yetkiyle düz işlev gibi çağırır (eylemin requireAdmin'i, zod'u, iş kuralları ve işlem geçmişi kaydı çalışır).
 * Yalnız kartın Onayla / Geri al düğmesinin sunucu eyleminden çalışır (eylemler refresh() çağırır; sohbet ucunda bu
 * hata fırlatırdı). Silme, toplu işlem ve şifre onayı isteyen hiçbir eylem burada içe aktarılmaz (kaynak testi).
 *
 * "ok: true her zaman başarı değil": değişiklik olmadan dönen yanıt (`changed: 0`, `changed: false`) başarı sayılmaz.
 */

const INVOICE_VIA_LABEL: Record<string, string> = { havale: "Havale / EFT", nakit: "Nakit", kart: "Kart", cek: "Çek", diger: "Diğer" };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const notOk = <T>(r: ActionResult<T>): r is { ok: false; error: string } => !r.ok;

// ---------------------------------------------------------------- Tükendi / satışa aç

type SoldOutArgs = { siteMenuId: string; soldOut: boolean; name: string };

const soldOut: OpApplier<SoldOutArgs, { isActive: boolean }> = {
  async apply(args) {
    const r = await setSoldOut({ siteMenuId: args.siteMenuId, soldOut: args.soldOut });
    if (notOk(r)) return r;
    // changed:false başarı değil (zaten tükendi / satışta). setSoldOutCore'un "Tükenenler listesi dolu" dalı (capHit)
    // yalnız personelde olur (capRefusal yöneticiye sınır koymaz); kartı yalnız yönetici onaylar
    if (!r.data.changed) return fail(r.data.message || "Değişiklik olmadı.");
    return { ok: true, message: r.data.message || (args.soldOut ? "Ürün Tükendi yapıldı." : "Ürün satışa açıldı."), undo: { soldOut: args.soldOut } };
  },
  async undo(args) {
    const r = await setSoldOut({ siteMenuId: args.siteMenuId, soldOut: !args.soldOut });
    if (notOk(r)) return r;
    if (!r.data.changed) return fail(r.data.message || "Ürünün durumu bu arada değişmiş; Siparişler › Tükenenler'e bakın.");
    return { ok: true, message: r.data.message || "Geri alındı." };
  },
};

// ---------------------------------------------------------------- Paraşüt ürünü → hammadde

type LinkTriple = { ingredientId: number; factor: number; updatePrice: boolean };
type LinkArgs = LinkTriple & { productKey: string; productName: string };

const linkOf = async (productKey: string) =>
  (
    await getDb()
      .select({ ingredientId: s.parasutProductLinks.ingredientId, factor: s.parasutProductLinks.factor, updatePrice: s.parasutProductLinks.updatePrice })
      .from(s.parasutProductLinks)
      .where(eq(s.parasutProductLinks.productKey, productKey))
      .limit(1)
  )[0] ?? null;

const parasutLink: OpApplier<LinkArgs, { link: LinkTriple | null }> = {
  async apply(args, before) {
    const r = await saveProductLink({ productKey: args.productKey, productName: args.productName, ingredientId: args.ingredientId, factor: args.factor, updatePrice: args.updatePrice });
    if (notOk(r)) return r;
    return { ok: true, message: "Bağlandı; bu ürünün alınan miktarları hammaddeye sayıldı.", undo: before.link ? { prev: before.link } : null };
  },
  async undo(args, before) {
    if (!before.link) return fail("Yeni bağlantı asistanla geri alınmaz (kaldırmak silmedir): Paraşüt › Ürün → hammadde bağlantıları › Sil.");
    const now = await linkOf(args.productKey);
    if (!now || now.ingredientId !== args.ingredientId || Math.abs(now.factor - args.factor) > 1e-9 || now.updatePrice !== args.updatePrice) {
      return fail("Bağlantı bu arada değişmiş; Paraşüt ekranında bakın.");
    }
    const r = await saveProductLink({ productKey: args.productKey, productName: args.productName, ...before.link });
    return notOk(r) ? r : { ok: true, message: "Önceki bağlantı geri yazıldı (yazılmış fiyatlar kendiliğinden dönmez)." };
  },
};

// ---------------------------------------------------------------- Hatırlatıcı

type ReminderArgs = { title: string; kind: "odeme" | "vergi" | "kira" | "maas" | "fatura" | "diger"; amount: number | null; dueDate: string; repeat: "none" | "weekly" | "monthly" | "quarterly" | "yearly"; remindDaysBefore: number; branchId: string | null };
const reminderUndo = z.object({ reminderId: z.number().int().positive() });

const reminderAdd: OpApplier<ReminderArgs, { maxId: number }> = {
  async apply(args, before) {
    const r = await saveReminder({ id: null, title: args.title, kind: args.kind, amount: args.amount, dueDate: args.dueDate, repeat: args.repeat, remindDaysBefore: args.remindDaysBefore, note: null, active: true, branchId: args.branchId });
    if (notOk(r)) return r;
    const id = await createdReminderId(args, before.maxId);
    return { ok: true, message: "Hatırlatıcı eklendi (Ödemeler › Hatırlatıcılar).", undo: id ? { reminderId: id } : null };
  },
  async undo(args, _before, data, ctx) {
    const { reminderId } = reminderUndo.parse(data);
    const r = await setReminderActive(reminderId, false);
    if (notOk(r)) return r;
    // setReminderActive işlem geçmişine yazmaz: uyarlayıcı kendi satırını yazar
    await logActivity(ctx.me, "Asistan: hatırlatıcı kapatıldı", args.title);
    return { ok: true, message: "Hatırlatıcı kapatıldı (silinmedi)." };
  },
};

// ---------------------------------------------------------------- Hatırlatıcı ödendi

const reminderPaidUndo = z.object({ prev: z.record(z.string(), z.unknown()), next: z.string().nullable() });

const reminderPaid: OpApplier<{ reminderId: number; title: string }, { dueDate: string; active: boolean; amount: number | null }> = {
  async apply(args) {
    // Tek dönem: `through` verilmez (çok dönemi kapatmak toplu işlem, rehber)
    const r = await markReminderDone(args.reminderId);
    if (notOk(r)) return r;
    return { ok: true, message: r.data.next ? `Ödendi; sıradaki dönem ${dateTR(r.data.next)}.` : "Ödendi; hatırlatıcı kapandı.", undo: { prev: r.data.prev, next: r.data.next } };
  },
  async undo(args, before, data) {
    const { prev, next } = reminderPaidUndo.parse(data);
    const now = await reminderState(args.reminderId);
    const ours = now && (next ? now.dueDate === next && now.active : !now.active && now.dueDate === before.dueDate);
    if (!ours) return fail("Hatırlatıcı bu arada değişmiş; Ödemeler › Son ödenenler'den bakın.");
    // removeId verilmez: geri al hiçbir kaydı silmez
    const r = await restoreReminder(args.reminderId, prev as Parameters<typeof restoreReminder>[1]);
    return notOk(r) ? r : { ok: true, message: "Hatırlatıcı ödenmeden önceki hâline döndü." };
  },
};

// ---------------------------------------------------------------- Fatura ödendi

type InvoiceArgs = { invoiceId: number; status: "paid" | "requested"; date: string; via: "havale" | "nakit" | "kart" | "cek" | "diger" | null; separately: boolean };
type InvoiceState = { unpaid: boolean; paidAt: string | null; paidVia: string | null; paymentRequestedAt: string | null };
const invoiceStateSchema = z.object({ unpaid: z.boolean(), paidAt: z.string().nullable(), paidVia: z.string().nullable(), paymentRequestedAt: z.string().nullable() });
/** previous: eylemin geri yazacağı önceki durum; after: yazımdan hemen sonra okunan durum ("bizim mi" denetimi) */
const invoiceUndo = z.object({ previous: z.array(z.record(z.string(), z.unknown())).min(1).max(1), after: invoiceStateSchema.nullable().optional() });

const sameInvoiceState = (a: InvoiceState, b: InvoiceState) =>
  a.unpaid === b.unpaid && a.paidAt === b.paidAt && a.paidVia === b.paidVia && a.paymentRequestedAt === b.paymentRequestedAt;

const invoicePaid: OpApplier<InvoiceArgs, InvoiceState> = {
  async apply(args) {
    const change = args.status === "paid" ? { status: "paid" as const, date: args.date, via: args.via } : { status: "requested" as const, date: args.date };
    const r = await setInvoicePayment([args.invoiceId], change, { onlyOpen: true, separately: args.separately });
    if (notOk(r)) return r;
    if (!r.data.changed) return fail("Fatura zaten ödenmiş; değişiklik yapılmadı.");
    // Gerçek durum: hesaptaki para faturayı tamamen kapattıysa gün ve şekil ödemeninkidir (kartınki değil)
    const after = await invoicePaymentState(args.invoiceId);
    const used = r.data.credit.used > 0 ? ` Tedarikçinin hesabındaki ${tl(r.data.credit.used, 2)} önce sayıldı.` : "";
    const fromLedger =
      args.status === "paid" && after && !after.unpaid && after.paidAt && (after.paidAt !== args.date || after.paidVia !== args.via)
        ? ` Fatura hesaptaki ödemeyle kapandı: ödeme günü ${dateTR(after.paidAt)}${after.paidVia ? `, ${INVOICE_VIA_LABEL[after.paidVia] ?? after.paidVia}` : ""}.`
        : "";
    return {
      ok: true,
      message: `${args.status === "paid" ? "Fatura ödendi işaretlendi." : "Faturanın ödemesi talep edildi."}${used}${fromLedger}`,
      undo: { previous: r.data.previous, after },
    };
  },
  async undo(args, _before, data) {
    const { previous, after } = invoiceUndo.parse(data);
    const now = await invoicePaymentState(args.invoiceId);
    // Bizim mi: yazımdan sonra okunan durum hâlâ duruyorsa (eski planlarda: kartın günü ya da talep)
    const ours = now && (after ? sameInvoiceState(now, after) : args.status === "paid" ? !now.unpaid && now.paidAt === args.date : now.unpaid && now.paymentRequestedAt !== null);
    if (!ours) return fail("Faturanın ödeme durumu bu arada değişmiş; Ödemeler › Son ödenenler'den bakın.");
    const r = await restoreInvoicePayment(previous as Parameters<typeof restoreInvoicePayment>[0]);
    if (notOk(r)) return r;
    return r.data.changed ? { ok: true, message: "Faturanın eski ödeme durumu geri yazıldı." } : fail("Geri yazılacak değişiklik bulunamadı.");
  },
};

// ---------------------------------------------------------------- Tedarikçiye ödeme

type SupplierPayArgs = { cardId: number; amount: number; date: string; method: "havale" | "elden" | "kart" | "cek" | "diger"; mode: "auto" | "none"; note: string | null };

const supplierPayment: OpApplier<SupplierPayArgs, Record<string, never>> = {
  async apply(args) {
    const r = await saveSupplierPayment({
      target: { cardId: args.cardId },
      id: null,
      date: args.date,
      amount: args.amount,
      method: args.method,
      cashOut: null,
      allocation: { mode: args.mode, lines: [] },
      note: args.note,
      photoId: null,
    });
    if (notOk(r)) return r;
    if (!r.data.created) return fail("Ödeme yeni kayıt olarak yazılmadı; Tedarikçiler ekranında bakın.");
    const counted = r.data.lines.length ? `${r.data.closed} kalem kapandı${r.data.partial ? `, ${r.data.partial} kısmen` : ""}` : "hiçbir kaleme sayılmadı";
    return { ok: true, message: `Ödeme kaydedildi: ${counted}; hesapta ${tl(r.data.left, 2)}.`, undo: null };
  },
};

// ---------------------------------------------------------------- Hammadde fiyatı

type IngredientPriceArgs = { ingredientId: number; price: number; clearEstimate: boolean };
type IngredientPriceBefore = { packagePrice: number; isEstimate: boolean };

const ingredientPriceChange: OpApplier<IngredientPriceArgs, IngredientPriceBefore> = {
  async apply(args) {
    const r = await updateIngredientPrice(args.ingredientId, args.price, args.clearEstimate);
    if (notOk(r)) return r;
    return { ok: true, message: "Paket fiyatı değişti; ürün maliyetleri yeniden hesaplandı.", undo: { price: args.price } };
  },
  async undo(args, before) {
    const now = await ingredientPrice(args.ingredientId);
    if (!now || Math.abs(now.packagePrice - args.price) > 0.0001) return fail("Fiyat bu arada yeniden değişmiş; Hammaddeler ekranında bakın.");
    const r = await updateIngredientPrice(args.ingredientId, before.packagePrice, false);
    if (notOk(r)) return r;
    if (before.isEstimate && !now.isEstimate) {
      const e = await setIngredientEstimate(args.ingredientId, true);
      if (notOk(e)) return { ok: true, message: `Eski fiyat geri yazıldı; “Tahmini” işareti geri konamadı (${e.error}).` };
    }
    return { ok: true, message: "Eski paket fiyatı geri yazıldı." };
  },
};

// ---------------------------------------------------------------- Ürün fiyatı

type ProductPriceArgs = { productId: number; price: number };
const productUndo = z.object({ price: z.number().positive() });

const productPriceChange: OpApplier<ProductPriceArgs, { price: number }> = {
  async apply(args, before) {
    // Eylemin kendi bayatlık denetimi: önizlemede görülen fiyat (seenPrice)
    const r = await updateProductPrice(args.productId, args.price, false, "manual", before.price);
    if (notOk(r)) return r;
    // Ekranın kullandığı ortak metin (Ürünler, Reçete): site, fiyat listesinin tarihi ve günün kasası (LafPOS / ModPOS)
    const reminder = priceReminder({ site: r.data.site, posPending: r.data.posPending, kasa: r.data.kasa });
    return { ok: true, message: `Fiyat ${tl(r.data.price, 2)} oldu.${reminder ? ` ${reminder}` : ""}`, undo: { price: r.data.price } };
  },
  async undo(args, before, data) {
    const { price } = productUndo.parse(data);
    const now = await productPrice(args.productId);
    if (now === null || Math.abs(now - price) > 0.005) return fail("Fiyat bu arada yeniden değişmiş; Ürünler ekranında bakın.");
    const r = await updateProductPrice(args.productId, before.price, false, "manual", price);
    return notOk(r) ? r : { ok: true, message: `Eski fiyat (${tl(r.data.price, 2)}) geri yazıldı.` };
  },
};

// ---------------------------------------------------------------- Kasadan çıkan

/**
 * Sohbete eklenen fiş (önizlemenin denetleyip okuduğu; docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı): kimliği ve fişten
 * okunan tarih, numara, KDV. Fotoğrafı eylemin kendisi bir kez daha denetler (fiş türü, bağlanmamış, süresi işliyor) ve
 * kayda bağlar; eski planlarda yok
 */
type ReceiptArgs = { photoId: number; ownerId: number; receiptDate: string | null; receiptNo: string | null; vat: number | null } | null | undefined;

type CashOutArgs = {
  branchId: string;
  date: string;
  kind: "harcama" | "teslim";
  amount: number;
  store: string | null;
  description: string | null;
  docType: "fis" | "e_arsiv" | "fatura" | "yok";
  categoryId: number | null;
  toExpenses: boolean;
  receipt?: ReceiptArgs;
};

const cashOutAdd: OpApplier<CashOutArgs, Record<string, never>> = {
  async apply(args) {
    const r = await saveCashOut({
      id: null,
      date: args.date,
      kind: args.kind,
      amount: args.amount,
      store: args.store,
      description: args.description,
      receiptDate: args.receipt?.receiptDate ?? null,
      receiptNo: args.receipt?.receiptNo ?? null,
      vat: args.receipt?.vat ?? null,
      docType: args.docType,
      categoryId: args.categoryId,
      toExpenses: args.toExpenses,
      photoId: args.receipt?.photoId ?? null,
      branchId: args.branchId,
    });
    if (notOk(r)) return r;
    return { ok: true, message: `Kasadan çıkan eklendi${args.receipt ? " (fiş fotoğrafıyla)" : ""}${r.data.expenseId ? "; Aylık harcamalar'a da yazıldı" : ""}.`, undo: null };
  },
};

// ---------------------------------------------------------------- Harcama

type ExpenseArgs = { categoryId: number; date: string; amount: number; paymentMethod: "nakit" | "kart" | "havale" | "diger" | null; description: string | null; receipt?: ReceiptArgs };

const expenseAdd: OpApplier<ExpenseArgs, Record<string, never>> = {
  async apply(args) {
    const r = await saveExpenseEntry({
      id: null,
      date: args.date,
      categoryId: args.categoryId,
      description: args.description,
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      note: null,
      photoId: args.receipt?.photoId ?? null,
      vat: args.receipt?.vat ?? null,
    });
    if (notOk(r)) return r;
    return { ok: true, message: `Gider Aylık harcamalar'a eklendi${args.receipt ? " (fiş fotoğrafıyla)" : ""}.`, undo: null };
  },
};

// ---------------------------------------------------------------- Zayi / ikram

type WasteArgs = { date: string; kind: "zayi" | "ikram"; productId: number | null; ingredientId: number | null; qty: number; reason: string | null };

const wasteAdd: OpApplier<WasteArgs, Record<string, never>> = {
  async apply(args, _before, ctx) {
    // İstemci anahtarı = planın kimliği: aynı plan ikinci kayıt açamaz (tek kullanımlık onaya ek koruma)
    const r = await addWasteEntry({ ...args, note: null, clientKey: ctx.opId });
    if (notOk(r)) return r;
    if (r.data.repeated) return fail("Bu kayıt zaten girilmiş; yeni kayıt açılmadı.");
    return { ok: true, message: "Kayıt girildi (Zayi ekranı).", undo: null };
  },
};

// ---------------------------------------------------------------- Vardiya

type ShiftArgs = { branchId: string; monday: string; ref: string; name: string; changes: { date: string; text: string }[] };
const shiftUndo = z.object({ cells: z.array(z.string()).length(7) });

/**
 * Kişinin bütün haftası metin olarak yazılır (eylem kişinin yedi hücresini birden alır). `seen` kartın gördüğü hafta:
 * kayıt yalnız ondan farklı günlere dokunur, o günü arada başkası değiştirdiyse reddedilir (bulgu 46)
 */
async function writeWeek(args: ShiftArgs, cells: string[], seen: string[]): Promise<ActionResult<{ written: number; removed: number }>> {
  const uid = refUserId(args.ref);
  const [u] = uid ? await getDb().select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.id, uid)).limit(1) : [];
  const name = u?.name ?? args.name;
  if (cells.some((t) => !parseShiftCell(t).ok)) return { ok: false, error: "Hücre okunamadı; Vardiya ekranından kaydedin." };
  const r = await saveShiftWeekAction({ branchId: args.branchId, week: args.monday, rows: [{ ref: args.ref, name, cells, seen }] });
  return notOk(r) ? r : { ok: true, data: { written: r.data.written, removed: r.data.removed } };
}

const shiftCells: OpApplier<ShiftArgs, { cells: string[] }> = {
  async apply(args, before) {
    const days = weekDays(args.monday);
    const next = [...before.cells];
    for (const c of args.changes) next[days.indexOf(c.date)] = c.text;
    const r = await writeWeek(args, next, before.cells);
    if (notOk(r)) return r;
    if (!r.data.written && !r.data.removed) return fail("Değişiklik olmadı; hücreler zaten böyle.");
    return { ok: true, message: `Vardiya kaydedildi (${r.data.written} hücre yazıldı${r.data.removed ? `, ${r.data.removed} boşaltıldı` : ""}).`, undo: { cells: next } };
  },
  async undo(args, before, data) {
    const { cells } = shiftUndo.parse(data);
    const now = (await personCells(args.branchId, args.monday, args.ref)).map(formatShiftCell);
    if (now.some((c, i) => c !== cells[i])) return fail("Bu kişinin vardiyası bu arada değişmiş; Vardiya ekranında bakın.");
    const r = await writeWeek(args, before.cells, cells);
    return notOk(r) ? r : { ok: true, message: "Eski vardiya geri yazıldı." };
  },
};

// ---------------------------------------------------------------- Liste

export const APPLIERS: { [N in OpName]: OpApplier<never, never> } = {
  urun_tukendi_yap: soldOut as OpApplier<never, never>,
  urun_satisa_ac: soldOut as OpApplier<never, never>,
  parasut_urun_bagla: parasutLink as OpApplier<never, never>,
  hatirlatici_ekle: reminderAdd as OpApplier<never, never>,
  hatirlatici_odendi: reminderPaid as OpApplier<never, never>,
  fatura_odendi: invoicePaid as OpApplier<never, never>,
  tedarikci_odemesi_ekle: supplierPayment as OpApplier<never, never>,
  hammadde_fiyati_degistir: ingredientPriceChange as OpApplier<never, never>,
  urun_fiyati_degistir: productPriceChange as OpApplier<never, never>,
  kasadan_cikan_ekle: cashOutAdd as OpApplier<never, never>,
  harcama_ekle: expenseAdd as OpApplier<never, never>,
  zayi_ikram_ekle: wasteAdd as OpApplier<never, never>,
  vardiya_hucre_yaz: shiftCells as OpApplier<never, never>,
};

export type { ApplyResult, UndoResult };
