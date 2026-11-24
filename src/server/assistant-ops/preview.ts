import "server-only";

import { and, desc, eq, gt, isNotNull, max } from "drizzle-orm";
import { z } from "zod";

import { EPS, openBalance, paidViaOf, round2, type BalanceInvoice, type CariMethod } from "@/lib/cari/balance";
import { businessDate } from "@/lib/cash-report";
import { branchSwitchDay, isLafposDay } from "@/lib/lafpos/switch";
import { dateTR, num, pct, tl, tlUnit } from "@/lib/format";
import { cleanName, foldName, ToolInputError } from "@/lib/mcp/answers/common";
import type { OpName } from "@/lib/assistant/op-specs";
import type { OpCardLine } from "@/lib/assistant/ops";
import { longDateTR, nextOccurrence, taxAmountTravels, todayTR, type ReminderRepeat } from "@/lib/reminders";
import { SITE_MENU_ID } from "@/lib/site-menu/schema";
import {
  dayLong,
  expandShiftAbbr,
  formatShiftCell,
  hoursLabel,
  parseShiftCell,
  rowMinutes,
  type ShiftCell,
  userRef,
  weekDays,
  weekLabel,
  weekStart,
} from "@/lib/vardiya";
import { loadModel } from "@/server/data/dataset";
import { cardResolver, paymentCredits } from "@/server/cari/settle";
import { activeProductsUsing } from "@/server/data/ingredient-usage";
import { lafposSwitchDayOf } from "@/server/data/lafpos-ikram";
import { loadTillScope } from "@/server/data/till-scope";
import { soldOutNoteFor } from "@/server/data/menu-status";
import { getDb, schema as s } from "@/server/db";
import { siteLinkSecret } from "@/server/site-link";
import { readSiteSnapshot } from "@/server/site-menu/sync";
import { loadShiftEntries, loadShiftWeek } from "@/server/vardiya/store";

import { expenseBranch, physicalBranch, pickByName } from "./resolve";
import type { OpPreview, PreviewCtx } from "./types";

/*
 * İşlemlerin önizlemesi (SALT OKUR; docs/ASISTAN-ISLEMLER.md § 2). Sohbet ucu yalnız bunu çağırır: kartı sunucu yazar
 * (eski → yeni, şube, gün, kişi / ürün, dış etki, geri alma yolu), modelin verdiği adlar sunucu okumasıyla kimliğe
 * çözülür. "Değişiklik yok" durumunda kart açılmaz. Onayda `stale` aynı değeri yeniden okur; farklıysa iş yapılmaz.
 */

const db = () => getDb();

const NO_CHANGE = (what: string) => new ToolInputError(`${what}; değişiklik yok, kart açılmadı.`);
const yesNo = (v: boolean) => (v ? "Evet" : "Hayır");
const today = (ctx: PreviewCtx) => todayTR(ctx.now);
const dayText = (date: string) => `${longDateTR(date)} ${date.slice(0, 4)}`;

/**
 * Modelin yazdığı serbest metin, kartta görünen ve yazılan AYNI olsun diye temizlenir (kırpılmaz; uzunluk girdi
 * şemasında): denetim, sıfır genişlikli ve yön değiştiren karakterler ile satır sonları boşluğa. Boş kalırsa null
 */
const plainText = (v: string | undefined | null): string | null => (v ? cleanName(v, Number.POSITIVE_INFINITY) || null : null);

/** Ürünler adla ve boyla: önce ad (birebir, sonra adında geçen; tek ad kalmalı), sonra boy (birden çok boy varsa zorunlu) */
function pickProduct<T extends { name: string; size: string }>(rows: readonly T[], name: string, size: string | undefined, hint = ""): T {
  const names = [...new Map(rows.map((r) => [foldName(r.name), r])).values()];
  const chosen = pickByName(names, name, (r) => r.name, "Ürün", hint);
  const sizes = rows.filter((r) => foldName(r.name) === foldName(chosen.name));
  if (size) {
    const hit = sizes.find((r) => r.size === size);
    if (!hit) throw new ToolInputError(`${cleanName(chosen.name)} için ${size} boyu yok; boyları: ${sizes.map((r) => r.size).join(", ")}.`);
    return hit;
  }
  if (sizes.length > 1) throw new ToolInputError(`${cleanName(chosen.name)} birden çok boyda (${sizes.map((r) => r.size).join(", ")}); kullanıcıya hangi boy olduğunu sor.`);
  return sizes[0];
}

const productLabel = (p: { name: string; size?: string | null }) => (!p.size || p.size === "Tek" ? p.name : `${p.name} ${p.size}`);

// ---------------------------------------------------------------- Tükendi / satışa aç

const soldOutArgs = z.object({ siteMenuId: z.string().regex(SITE_MENU_ID), soldOut: z.boolean(), name: z.string() });
const soldOutBefore = z.object({ isActive: z.boolean() });

function soldOutPreview(soldOut: boolean): OpPreview<"urun_tukendi_yap" | "urun_satisa_ac", z.output<typeof soldOutArgs>, z.output<typeof soldOutBefore>> {
  return {
    args: soldOutArgs,
    before: soldOutBefore,
    async preview(input, ctx) {
      if (!siteLinkSecret()) throw new ToolInputError("Site bağlantısı kurulu değil: Tükendi yalnız laffogato.net menüsüne bağlı üründe çalışır (Ayarlar › Site bağlantısı).");
      const rows = await db()
        .select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active, siteMenuId: s.products.siteMenuId })
        .from(s.products)
        .where(isNotNull(s.products.siteMenuId));
      const linked = rows.filter((r) => r.active);
      // Bir site kalemi M ve L'yi birlikte taşır: kalem başına bir aday
      const items = [...new Map(linked.map((r) => [r.siteMenuId!, r])).values()];
      const hit = pickByName(items, input.urun, (r) => r.name, "Siteye bağlı ürün", "Ürün siteye bağlı değilse Tükendi yapılamaz: Ürünler › ürün › Site menüsü kartından bağlayın.");
      const siteMenuId = hit.siteMenuId!;
      const item = (await readSiteSnapshot()).items.find((i) => i.id === siteMenuId);
      if (!item) throw new ToolInputError("Ürünün site kalemi panelin kopyasında yok; önce Site menüsü'nden eşitleyin (/panel/urunler/site).");
      if (soldOut && !item.isActive) throw NO_CHANGE(`${cleanName(hit.name)} zaten Tükendi`);
      if (!soldOut && item.isActive) throw NO_CHANGE(`${cleanName(hit.name)} zaten satışta`);
      const sizes = linked.filter((r) => r.siteMenuId === siteMenuId).map((r) => r.size);
      const lines: OpCardLine[] = [
        { label: "Durum", from: item.isActive ? "Satışta" : "Tükendi", to: soldOut ? "Tükendi" : "Satışta" },
        { label: "Boylar", to: sizes.filter((x) => x !== "Tek").join(", ") || "Tek boy" },
      ];
      if (!soldOut) {
        const marker = await soldOutNoteFor(siteMenuId);
        if (marker) lines.push({ label: "Kapatan", to: `${cleanName(marker.by, 40)} · ${new Date(marker.at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" })}` });
      }
      return {
        card: {
          title: soldOut ? `${cleanName(hit.name)} Tükendi yapılacak` : `${cleanName(hit.name)} yeniden satışa açılacak`,
          subject: cleanName(hit.name),
          branch: "Bütün şubeler (menü ortak)",
          day: dayText(today(ctx)),
          lines,
          effects: ["site", "lafpos"],
          undo: soldOut ? "Sonuç kartındaki Geri al ürünü yeniden satışa açar." : "Sonuç kartındaki Geri al ürünü yeniden Tükendi yapar.",
          undoable: true,
          warnings: [
            soldOut
              ? "Sitede, uygulamada ve QR menüde hemen kapanır (M ve L birlikte); LafPOS kasası gün açıkken en geç 15 dakikada görür."
              : "Sitede, uygulamada ve QR menüde hemen açılır; LafPOS kasası en geç 15 dakikada görür.",
          ],
        },
        args: { siteMenuId, soldOut, name: hit.name },
        before: { isActive: item.isActive },
        branch: null,
      };
    },
    async stale(args, before) {
      const item = (await readSiteSnapshot()).items.find((i) => i.id === args.siteMenuId);
      if (!item) return "Ürünün site kalemi artık yok; Site menüsü'ne bakın.";
      return item.isActive === before.isActive ? null : `Ürünün durumu bu arada değişti (şimdi ${item.isActive ? "satışta" : "Tükendi"}).`;
    },
  };
}

// ---------------------------------------------------------------- Paraşüt ürünü → hammadde

const linkTriple = z.object({ ingredientId: z.number().int().positive(), factor: z.number().positive(), updatePrice: z.boolean() });
const linkArgs = linkTriple.extend({ productKey: z.string().min(2).max(300), productName: z.string().min(1).max(300) });
const linkBefore = z.object({ link: linkTriple.nullable() });

async function currentLink(productKey: string) {
  const [l] = await db()
    .select({ ingredientId: s.parasutProductLinks.ingredientId, factor: s.parasutProductLinks.factor, updatePrice: s.parasutProductLinks.updatePrice })
    .from(s.parasutProductLinks)
    .where(eq(s.parasutProductLinks.productKey, productKey))
    .limit(1);
  return l ?? null;
}

const sameLink = (a: z.output<typeof linkTriple> | null, b: z.output<typeof linkTriple> | null) =>
  a === null || b === null ? a === b : a.ingredientId === b.ingredientId && Math.abs(a.factor - b.factor) < 1e-9 && a.updatePrice === b.updatePrice;

const parasutLink: OpPreview<"parasut_urun_bagla", z.output<typeof linkArgs>, z.output<typeof linkBefore>> = {
  args: linkArgs,
  before: linkBefore,
  async preview(input, ctx) {
    const keys = await db()
      .selectDistinct({ productKey: s.parasutBillLines.productKey, productName: s.parasutBillLines.productName })
      .from(s.parasutBillLines)
      .where(isNotNull(s.parasutBillLines.productKey));
    const byKey = [...new Map(keys.filter((k) => k.productKey).map((k) => [k.productKey!, { productKey: k.productKey!, productName: k.productName }])).values()];
    const product = pickByName(byKey, input.urun, (k) => k.productName, "Paraşüt ürünü", "Adı parasut_bekleyenler'den olduğu gibi alın.");
    if (product.productKey.length > 300) throw new ToolInputError("Bu ürünün anahtarı çok uzun; Paraşüt › Ürün → hammadde bağlantıları ekranından bağlayın.");
    const ingredients = await db()
      .select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, active: s.ingredients.active })
      .from(s.ingredients)
      .where(eq(s.ingredients.active, true));
    const ing = pickByName(ingredients, input.hammadde, (i) => i.name, "Hammadde", "Hammaddeyi Hammaddeler ekranında açın ya da adını ara ile bulun.");
    const prev = await currentLink(product.productKey);
    const next = { ingredientId: ing.id, factor: input.carpan, updatePrice: input.fiyatGuncellensin };
    if (sameLink(prev, next)) throw NO_CHANGE("Bu ürün zaten bu hammaddeye bu çarpanla bağlı");
    const prevIng = prev ? (ingredients.find((i) => i.id === prev.ingredientId) ?? (await db().select({ name: s.ingredients.name, unit: s.ingredients.unit }).from(s.ingredients).where(eq(s.ingredients.id, prev.ingredientId)))[0]) : null;
    const factorText = (f: number, unit: string) => `1 fatura birimi = ${num(f, 3)} ${unit}`;
    const warnings = ["Bağlantı bütün faturalara yeniden uygulanır: bu ürünün alınan miktarları hammaddeye sayılır."];
    if (input.fiyatGuncellensin) warnings.push("Faturanın birim fiyatı hammaddeye yazılabilir; %40'tan büyük değişiklik Hammaddeler'de onaya düşer. Yazılan fiyat kendiliğinden geri dönmez.");
    return {
      card: {
        title: prev ? `Paraşüt ürününün bağlantısı değişecek: ${cleanName(product.productName)}` : `Paraşüt ürünü hammaddeye bağlanacak: ${cleanName(product.productName)}`,
        subject: cleanName(product.productName),
        branch: "İşletme geneli",
        day: dayText(today(ctx)),
        lines: [
          { label: "Hammadde", from: prevIng ? cleanName(prevIng.name) : null, to: cleanName(ing.name) },
          { label: "Çarpan", from: prev && prevIng ? factorText(prev.factor, prevIng.unit) : null, to: factorText(input.carpan, ing.unit) },
          { label: "Fiyat güncellensin", from: prev ? yesNo(prev.updatePrice) : null, to: yesNo(input.fiyatGuncellensin) },
        ],
        effects: input.fiyatGuncellensin ? ["stok", "maliyet"] : ["stok"],
        undo: prev
          ? "Sonuç kartındaki Geri al önceki bağlantıyı geri yazar (yazılmış fiyatlar kendiliğinden dönmez)."
          : "Bağlantıyı kaldırmak silmedir, asistan yapmaz: Paraşüt › Ürün → hammadde bağlantıları › satır › Sil.",
        undoable: prev !== null,
        warnings,
      },
      args: { productKey: product.productKey, productName: product.productName.slice(0, 300), ...next },
      before: { link: prev },
      branch: null,
    };
  },
  async stale(args, before) {
    return sameLink(await currentLink(args.productKey), before.link) ? null : "Bu ürünün bağlantısı bu arada değişti; Paraşüt ekranında bakın.";
  },
};

// ---------------------------------------------------------------- Hatırlatıcı ekle

const KIND_LABEL = { odeme: "Ödeme", vergi: "Vergi", kira: "Kira", maas: "Maaş", fatura: "Fatura", diger: "Diğer" } as const;
const REPEAT_LABEL = { none: "Tek sefer", weekly: "Her hafta", monthly: "Her ay", quarterly: "3 ayda bir", yearly: "Her yıl" } as const;

const reminderArgs = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(["odeme", "vergi", "kira", "maas", "fatura", "diger"]),
  amount: z.number().min(0).nullable(),
  dueDate: z.string(),
  repeat: z.enum(["none", "weekly", "monthly", "quarterly", "yearly"]),
  remindDaysBefore: z.number().int().min(0).max(60),
  branchId: z.string().nullable(),
});
const reminderBefore = z.object({ maxId: z.number().int() });

const reminderAdd: OpPreview<"hatirlatici_ekle", z.output<typeof reminderArgs>, z.output<typeof reminderBefore>> = {
  args: reminderArgs,
  before: reminderBefore,
  async preview(input, ctx) {
    const b = expenseBranch(input.sube, ctx.scope, ctx.branches);
    const title = plainText(input.baslik);
    if (!title) throw new ToolInputError("Hatırlatıcının başlığı boş; kullanıcıya sor.");
    const [{ maxId }] = await db().select({ maxId: max(s.reminders.id) }).from(s.reminders);
    const same = await db()
      .select({ id: s.reminders.id, title: s.reminders.title })
      .from(s.reminders)
      .where(and(eq(s.reminders.active, true), eq(s.reminders.dueDate, input.ilkTarih)));
    const warnings = ["Sabah e-postasında ve nakit planında görünür; ödendi işaretini Ödemeler'den koyarsınız."];
    if (same.some((r) => foldName(r.title) === foldName(title))) warnings.push("Aynı gün aynı adla açık bir hatırlatıcı zaten var: iki kez eklemediğinizden emin olun.");
    if (input.ilkTarih < today(ctx)) warnings.push("İlk tarih geçmişte: hatırlatıcı hemen gecikmiş görünür.");
    const days = input.kacGunOnce ?? 3;
    return {
      card: {
        title: `Hatırlatıcı eklenecek: ${cleanName(title, 60)}`,
        subject: cleanName(title, 60),
        branch: b.label,
        day: dayText(input.ilkTarih),
        lines: [
          { label: "Başlık", to: title },
          { label: "Tür", to: KIND_LABEL[input.tur] },
          { label: "Tutar", to: input.tutar === undefined ? "Yok" : tl(input.tutar, 2) },
          { label: "İlk tarih", to: dayText(input.ilkTarih) },
          { label: "Tekrar", to: REPEAT_LABEL[input.tekrar] },
          { label: "Hatırlatma", to: days ? `${days} gün önce` : "O gün" },
        ],
        effects: ["eposta", "nakit"],
        undo: "Sonuç kartındaki Geri al hatırlatıcıyı kapatır (silmez); Ödemeler › Hatırlatıcılar'da kapalılar arasında kalır.",
        undoable: true,
        warnings,
      },
      args: {
        title,
        kind: input.tur,
        amount: input.tutar ?? null,
        dueDate: input.ilkTarih,
        repeat: input.tekrar,
        remindDaysBefore: days,
        branchId: b.branchId,
      },
      before: { maxId: maxId ?? 0 },
      branch: b.scope,
    };
  },
  stale: async () => null,
};

/** Önizlemede okunan en büyük kimlikten sonra eklenen hatırlatıcı (eylem kimliği döndürmez) */
export async function createdReminderId(args: { title: string; dueDate: string }, maxId: number): Promise<number | null> {
  const [r] = await db()
    .select({ id: s.reminders.id })
    .from(s.reminders)
    .where(and(gt(s.reminders.id, maxId), eq(s.reminders.title, args.title), eq(s.reminders.dueDate, args.dueDate)))
    .orderBy(desc(s.reminders.id))
    .limit(1);
  return r?.id ?? null;
}

// ---------------------------------------------------------------- Hatırlatıcı ödendi

const reminderPaidArgs = z.object({ reminderId: z.number().int().positive(), title: z.string() });
const reminderPaidBefore = z.object({ dueDate: z.string(), active: z.boolean(), amount: z.number().nullable() });

export async function reminderState(id: number) {
  const [r] = await db().select({ dueDate: s.reminders.dueDate, active: s.reminders.active, amount: s.reminders.amount }).from(s.reminders).where(eq(s.reminders.id, id)).limit(1);
  return r ?? null;
}

const reminderPaid: OpPreview<"hatirlatici_odendi", z.output<typeof reminderPaidArgs>, z.output<typeof reminderPaidBefore>> = {
  args: reminderPaidArgs,
  before: reminderPaidBefore,
  async preview(input, ctx) {
    const rows = await db().select().from(s.reminders).where(eq(s.reminders.active, true));
    const r = pickByName(rows, input.hatirlatici, (x) => x.title, "Açık hatırlatıcı", "Ödemeler › Hatırlatıcılar'daki başlığıyla yazın.");
    const next = nextOccurrence(r.dueDate, r.repeat as ReminderRepeat, r.anchorDate);
    const clear = next !== null && taxAmountTravels(r);
    const branch = r.branchId ? (ctx.branches.find((b) => b.id === r.branchId)?.name ?? r.branchId) : "İşletme geneli";
    const warnings = ["Yalnız işaret: banka ödemesi yapmaz."];
    if (clear) warnings.unshift("Bu dönemin vergi tutarı sıradaki döneme taşınmaz (silinir); Geri al geri yazar.");
    if (next && next < today(ctx)) warnings.unshift("Sıradaki dönem de geçmişte: yalnız bir dönem kapanır. Birden çok dönemi birden kapatmak Ödemeler ekranından.");
    return {
      card: {
        title: `${cleanName(r.title, 60)} bu dönem ödendi işaretlenecek`,
        subject: cleanName(r.title, 60),
        branch,
        day: dayText(r.dueDate),
        lines: [
          { label: "Tutar", to: r.amount === null ? "Yok" : tl(r.amount, 2) },
          { label: "Kapanan dönem", to: dayText(r.dueDate) },
          { label: "Sıradaki dönem", to: next ? dayText(next) : "Yok (tek seferlik; kapanır)" },
        ],
        effects: ["nakit"],
        undo: "Sonuç kartındaki Geri al eski hâline döndürür; ya da Ödemeler › Son ödenenler › Geri al (30 gün).",
        undoable: true,
        warnings,
      },
      args: { reminderId: r.id, title: r.title },
      before: { dueDate: r.dueDate, active: r.active, amount: r.amount },
      branch: null,
    };
  },
  async stale(args, before) {
    const now = await reminderState(args.reminderId);
    if (!now) return "Hatırlatıcı bulunamadı.";
    return now.dueDate === before.dueDate && now.active === before.active && now.amount === before.amount ? null : "Hatırlatıcı bu arada değişti (ödendi ya da ertelendi olabilir).";
  },
};

// ---------------------------------------------------------------- Fatura ödendi

const METHOD_LABEL = { havale: "Havale / EFT", nakit: "Nakit", kart: "Kart", cek: "Çek", diger: "Diğer" } as const;
const invoiceArgs = z.object({
  invoiceId: z.number().int().positive(),
  status: z.enum(["paid", "requested"]),
  date: z.string(),
  via: z.enum(["havale", "nakit", "kart", "cek", "diger"]).nullable(),
  separately: z.boolean(),
});
const invoiceState = z.object({ unpaid: z.boolean(), paidAt: z.string().nullable(), paidVia: z.string().nullable(), paymentRequestedAt: z.string().nullable() });

export async function invoicePaymentState(id: number) {
  const [r] = await db()
    .select({ unpaid: s.invoices.unpaid, paidAt: s.invoices.paidAt, paidVia: s.invoices.paidVia, paymentRequestedAt: s.invoices.paymentRequestedAt })
    .from(s.invoices)
    .where(eq(s.invoices.id, id))
    .limit(1);
  return r ?? null;
}

/**
 * Önce hesaptaki para (settle.ts creditFirst'ün salt okunur tahmini): faturanın kartının hesabında sayılmamış ödeme
 * varsa en eski ödemeden başlayarak faturanın kalanına kadar sayılır. Fatura tamamen karşılanırsa defterle kapanır:
 * ödeme günü ve şekli son sayılan ödemeninki olur (kartın gösterdiği bugün ve seçilen şekil değil).
 */
async function creditEstimate(inv: BalanceInvoice & { supplier: string; supplierTaxNumber: string | null }): Promise<{ used: number; closes: boolean; last: { date: string; method: CariMethod } } | null> {
  if (inv.payable <= 0) return null;
  const cardId = (await cardResolver(db()))(inv.supplier, inv.supplierTaxNumber);
  if (cardId === null) return null;
  const credits = (await paymentCredits(db(), cardId)).filter((p) => p.credit > EPS);
  if (!credits.length) return null;
  // Faturanın sayılabilecek kalanı: takipteyse Ödenecek − taban − sayılan; takip ödemeyle başlayacaksa tabanı Paraşüt'ün
  // ödendi gösterdiği kısım olur, kalan yine bugünkü kalandır (openBalance ikisini de verir)
  let room = round2(Math.max(0, openBalance(inv)));
  let used = 0;
  let last: { date: string; method: CariMethod } | null = null;
  for (const p of credits) {
    if (room <= EPS) break;
    const take = round2(Math.min(room, p.credit));
    used = round2(used + take);
    room = round2(room - take);
    last = { date: p.date, method: p.method };
  }
  return used > EPS && last ? { used, closes: room <= EPS, last } : null;
}

const invoicePaid: OpPreview<"fatura_odendi", z.output<typeof invoiceArgs>, z.output<typeof invoiceState>> = {
  args: invoiceArgs,
  before: invoiceState,
  async preview(input, ctx) {
    const rows = await db()
      .select({
        id: s.invoices.id,
        date: s.invoices.date,
        supplier: s.invoices.supplier,
        invoiceNo: s.invoices.invoiceNo,
        payable: s.invoices.payable,
        unpaid: s.invoices.unpaid,
        paidAt: s.invoices.paidAt,
        paidVia: s.invoices.paidVia,
        paymentRequestedAt: s.invoices.paymentRequestedAt,
        supplierTaxNumber: s.invoices.supplierTaxNumber,
        ledgerBase: s.invoices.ledgerBase,
        allocated: s.invoices.allocated,
        outstanding: s.invoices.outstanding,
      })
      .from(s.invoices)
      .where(eq(s.invoices.unpaid, true));
    const q = foldName(input.tedarikci);
    const bySupplier = rows.filter((r) => foldName(r.supplier) === q);
    let hits = bySupplier.length ? bySupplier : rows.filter((r) => foldName(r.supplier).includes(q));
    if (!hits.length) throw new ToolInputError(`“${cleanName(input.tedarikci, 60)}” adına ödenmemiş fatura bulunamadı (tedarikci_ozeti ile adı ve faturaları kontrol edin).`);
    if (new Set(hits.map((r) => foldName(r.supplier))).size > 1) {
      throw new ToolInputError(`Birden çok tedarikçi eşleşti: ${[...new Set(hits.map((r) => cleanName(r.supplier)))].slice(0, 6).join(", ")}. Kullanıcıya hangisi olduğunu sor.`);
    }
    if (input.faturaNo) hits = hits.filter((r) => r.invoiceNo && foldName(r.invoiceNo) === foldName(input.faturaNo!));
    if (input.faturaTarihi) hits = hits.filter((r) => r.date === input.faturaTarihi);
    if (input.tutar !== undefined) hits = hits.filter((r) => Math.abs(r.payable - input.tutar!) < 0.01);
    if (!hits.length) throw new ToolInputError("Verilen numara, tarih ya da tutarla ödenmemiş fatura bulunamadı; tedarikci_ozeti ile faturaları kontrol edin.");
    if (hits.length > 1) {
      const list = hits.slice(0, 6).map((r) => `${dateTR(r.date)} · ${r.invoiceNo ? cleanName(r.invoiceNo, 30) : "numarasız"} · ${tl(r.payable, 2)}`);
      throw new ToolInputError(`Bu tedarikçinin ${hits.length} ödenmemiş faturası var: ${list.join("; ")}. Kullanıcıya hangisi olduğunu sor (numara, tarih ya da tutar).`);
    }
    const inv = hits[0];
    const status = input.durum === "odendi" ? "paid" : "requested";
    if (status === "requested" && inv.paymentRequestedAt) throw NO_CHANGE("Bu faturanın ödemesi zaten talep edilmiş");
    const date = input.odemeGunu ?? today(ctx);
    if (date > today(ctx)) throw new ToolInputError("Ödeme günü ileri bir tarih olamaz.");
    const label = inv.invoiceNo ? cleanName(inv.invoiceNo, 40) : `${dateTR(inv.date)} faturası`;
    const lines: OpCardLine[] = [
      { label: "Fatura", to: `${label} (${dateTR(inv.date)})` },
      { label: "Tutar", to: tl(inv.payable, 2) },
      { label: "Durum", from: inv.paymentRequestedAt ? "Ödemesi istendi" : "Ödenmedi", to: status === "paid" ? "Ödendi" : "Ödemesi istendi" },
    ];
    const credit = status === "paid" && !input.ayricaOdendi ? await creditEstimate(inv) : null;
    if (credit) {
      lines.push({ label: "Hesaptan sayılacak", to: credit.closes ? `${tl(credit.used, 2)} (faturanın tamamı)` : `${tl(credit.used, 2)} (kalan ${tl(round2(inv.payable - credit.used), 2)} karttaki gün ve şekille ödendi yazılır)` });
    }
    if (credit?.closes) {
      // Defter kapatır: gün ve şekil ödemenin kendisinden (kartın seçtiği gün ve şekil yazılmaz)
      lines.push({ label: "Ödeme günü ve şekli", to: `Ödemenin kendisinden: ${dateTR(credit.last.date)}, ${METHOD_LABEL[paidViaOf(credit.last.method)]}` });
    } else if (status === "paid") {
      lines.push({ label: "Ödeme günü", to: dayText(date) });
      lines.push({ label: "Ödeme şekli", to: input.odemeSekli ? METHOD_LABEL[input.odemeSekli] : "Belirtilmedi" });
    }
    const warnings = ["Yalnız işaret: banka ödemesi yapmaz, Paraşüt'e yazmaz."];
    if (status === "paid")
      warnings.unshift(
        input.ayricaOdendi
          ? "“Ayrıca ödendi”: tedarikçinin hesabındaki ödeme bu faturaya sayılmaz."
          : credit
            ? `Tedarikçinin hesabında sayılmamış ödeme var: önce o sayılır${credit.closes ? "; fatura onunla kapanır" : ""}. Ayrıca ödendiyse asistana “ayrıca ödendi” deyin.`
            : "Tedarikçinin hesabında sayılmamış ödeme yok: fatura bu gün ve şekille işaretlenir.",
      );
    return {
      card: {
        title: status === "paid" ? `${cleanName(inv.supplier)} faturası ödendi işaretlenecek` : `${cleanName(inv.supplier)} faturasının ödemesi talep edilecek`,
        subject: cleanName(inv.supplier),
        branch: "İşletme geneli",
        day: dayText(status === "paid" ? date : today(ctx)),
        lines,
        effects: ["nakit"],
        undo: "Sonuç kartındaki Geri al eski durumu geri yazar; ya da Ödemeler › Son ödenenler › Geri al (30 gün).",
        undoable: true,
        warnings,
      },
      args: { invoiceId: inv.id, status, date, via: status === "paid" ? (input.odemeSekli ?? null) : null, separately: Boolean(input.ayricaOdendi) },
      before: { unpaid: inv.unpaid, paidAt: inv.paidAt, paidVia: inv.paidVia, paymentRequestedAt: inv.paymentRequestedAt },
      branch: null,
    };
  },
  async stale(args, before) {
    const now = await invoicePaymentState(args.invoiceId);
    if (!now) return "Fatura bulunamadı; silinmiş olabilir.";
    const same = now.unpaid === before.unpaid && now.paidAt === before.paidAt && now.paidVia === before.paidVia && now.paymentRequestedAt === before.paymentRequestedAt;
    return same ? null : "Faturanın ödeme durumu bu arada değişti; Faturalar ekranında bakın.";
  },
};

// ---------------------------------------------------------------- Tedarikçiye ödeme

const CARI_METHOD_LABEL = { havale: "Havale / EFT", elden: "Elden (nakit, kasa dışı)", kart: "Kart", cek: "Çek", diger: "Diğer" } as const;
const supplierPayArgs = z.object({
  cardId: z.number().int().positive(),
  amount: z.number().positive(),
  date: z.string(),
  method: z.enum(["havale", "elden", "kart", "cek", "diger"]),
  mode: z.enum(["auto", "none"]),
  note: z.string().max(500).nullable(),
});
const emptyBefore = z.object({}).strict();

const supplierPayment: OpPreview<"tedarikci_odemesi_ekle", z.output<typeof supplierPayArgs>, z.output<typeof emptyBefore>> = {
  args: supplierPayArgs,
  before: emptyBefore,
  async preview(input, ctx) {
    if (input.tarih > today(ctx)) throw new ToolInputError("Ödeme günü ileri bir tarih olamaz.");
    const cards = await db().select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
    const q = foldName(input.tedarikci);
    const namesOf = (c: (typeof cards)[number]) => [c.name, ...(c.aliases ?? [])];
    let hits = cards.filter((c) => namesOf(c).some((n) => foldName(n) === q));
    if (!hits.length) hits = cards.filter((c) => namesOf(c).some((n) => foldName(n).includes(q)));
    if (!hits.length)
      throw new ToolInputError(`“${cleanName(input.tedarikci, 60)}” için tedarikçi kartı yok. İlk ödeme kartı açar; bunu Tedarikçiler › tedarikçi › Ödeme ekle'den kullanıcı yapar (/panel/tedarikciler).`);
    if (hits.length > 1) throw new ToolInputError(`Birden çok tedarikçi kartı eşleşti: ${hits.slice(0, 6).map((c) => cleanName(c.name)).join(", ")}. Kullanıcıya hangisi olduğunu sor.`);
    const card = hits[0];
    const sameDay = await db()
      .select({ amount: s.supplierEntries.amount })
      .from(s.supplierEntries)
      .where(and(eq(s.supplierEntries.supplierId, card.id), eq(s.supplierEntries.kind, "odeme"), eq(s.supplierEntries.date, input.tarih)));
    const warnings = ["Yalnız kayıt: banka ödemesi yapmaz."];
    if (sameDay.some((r) => Math.abs(r.amount - input.tutar) < 0.005)) warnings.unshift("Bu tedarikçiye aynı gün aynı tutarda bir ödeme zaten girilmiş: iki kez girmediğinizden emin olun.");
    const lines: OpCardLine[] = [
      { label: "Tedarikçi", to: cleanName(card.name) },
      { label: "Tutar", to: tl(input.tutar, 2) },
      { label: "Ödeme günü", to: dayText(input.tarih) },
      { label: "Ödeme şekli", to: CARI_METHOD_LABEL[input.odemeSekli] },
      {
        label: "Nereye sayılır",
        to: input.dagitim === "otomatik" ? "En eski vadeli borçtan başlayarak açık kalemlere; artan hesapta durur" : "Hiçbir kaleme sayılmaz, hesapta bekler",
      },
    ];
    const note = plainText(input.aciklama);
    if (note) lines.push({ label: "Not", to: note });
    return {
      card: {
        title: `${cleanName(card.name)} için ${tl(input.tutar, 2)} ödeme kaydı girilecek`,
        subject: cleanName(card.name),
        branch: "İşletme geneli",
        day: dayText(input.tarih),
        lines,
        effects: ["nakit"],
        undo: "Asistan geri almaz: Ödemeler › Son ödenenler › Geri al (30 gün) ya da Tedarikçiler › hareket › Sil.",
        undoable: false,
        warnings,
      },
      args: { cardId: card.id, amount: input.tutar, date: input.tarih, method: input.odemeSekli, mode: input.dagitim === "otomatik" ? "auto" : "none", note },
      before: {},
      branch: null,
    };
  },
  stale: async () => null,
};

// ---------------------------------------------------------------- Hammadde fiyatı

const ingredientPriceArgs = z.object({ ingredientId: z.number().int().positive(), price: z.number().min(0), clearEstimate: z.boolean() });
const ingredientPriceBefore = z.object({ packagePrice: z.number(), isEstimate: z.boolean() });

export async function ingredientPrice(id: number) {
  const [r] = await db().select({ packagePrice: s.ingredients.packagePrice, isEstimate: s.ingredients.isEstimate }).from(s.ingredients).where(eq(s.ingredients.id, id)).limit(1);
  return r ?? null;
}

const ingredientPriceChange: OpPreview<"hammadde_fiyati_degistir", z.output<typeof ingredientPriceArgs>, z.output<typeof ingredientPriceBefore>> = {
  args: ingredientPriceArgs,
  before: ingredientPriceBefore,
  async preview(input, ctx) {
    const rows = await db().select().from(s.ingredients).where(eq(s.ingredients.active, true));
    const ing = pickByName(rows, input.hammadde, (r) => r.name, "Hammadde", "Adını ara ile bulun.");
    if (ing.priceSource === "water") throw new ToolInputError("Su ve buz fiyatı su faturasından hesaplanır; elle değişmez.");
    if (Math.abs(ing.packagePrice - input.paketFiyati) < 0.0001) throw NO_CHANGE(`${cleanName(ing.name)} paket fiyatı zaten ${tl(ing.packagePrice, 2)}`);
    const clear = input.tahminiKalksin ?? true;
    const used = (await activeProductsUsing(db(), [ing.id])).get(ing.id) ?? [];
    const unit = (p: number) => `${tlUnit(p / ing.packageSize)} / ${ing.unit}`;
    const lines: OpCardLine[] = [
      { label: "Paket fiyatı", from: tl(ing.packagePrice, 2), to: tl(input.paketFiyati, 2) },
      { label: "Paket", to: ing.packageDesc ? cleanName(ing.packageDesc, 80) : `${num(ing.packageSize, 3)} ${ing.unit}` },
      { label: "Birim fiyat", from: unit(ing.packagePrice), to: unit(input.paketFiyati) },
    ];
    if (ing.isEstimate) lines.push({ label: "Tahmini", from: "Evet", to: yesNo(!clear) });
    lines.push({ label: "Etkilenen ürünler", to: used.length ? `${used.length} aktif ürün: ${used.slice(0, 5).map((p) => cleanName(productLabel(p), 30)).join(", ")}${used.length > 5 ? "…" : ""}` : "Aktif ürün yok" });
    const warnings = ["Ürün maliyetleri, marjlar ve zam uyarıları yeni fiyatla hesaplanır; fiyat geçmişine yazılır."];
    const change = ing.packagePrice > 0 ? (input.paketFiyati - ing.packagePrice) / ing.packagePrice : null;
    if (change !== null && Math.abs(change) > 0.4) warnings.unshift(`Fiyat ${pct(change)} değişiyor: paket boyunu ve fiyatın paketin tamamı için olduğunu kontrol edin.`);
    return {
      card: {
        title: `${cleanName(ing.name)} paket fiyatı ${tl(input.paketFiyati, 2)} olacak`,
        subject: cleanName(ing.name),
        branch: "İşletme geneli",
        day: dayText(today(ctx)),
        lines,
        effects: ["maliyet"],
        undo: "Sonuç kartındaki Geri al eski fiyatı geri yazar (fiyat geçmişinde iki satır kalır).",
        undoable: true,
        warnings,
      },
      args: { ingredientId: ing.id, price: input.paketFiyati, clearEstimate: clear },
      before: { packagePrice: ing.packagePrice, isEstimate: ing.isEstimate },
      branch: null,
    };
  },
  async stale(args, before) {
    const now = await ingredientPrice(args.ingredientId);
    if (!now) return "Hammadde bulunamadı.";
    return Math.abs(now.packagePrice - before.packagePrice) < 0.0001 ? null : `Paket fiyatı bu arada değişti (şimdi ${tl(now.packagePrice, 2)}).`;
  },
};

// ---------------------------------------------------------------- Ürün fiyatı

const productPriceArgs = z.object({ productId: z.number().int().positive(), price: z.number().positive() });
const productPriceBefore = z.object({ price: z.number() });

export async function productPrice(id: number) {
  const [r] = await db().select({ price: s.products.price }).from(s.products).where(eq(s.products.id, id)).limit(1);
  return r?.price ?? null;
}

const productPriceChange: OpPreview<"urun_fiyati_degistir", z.output<typeof productPriceArgs>, z.output<typeof productPriceBefore>> = {
  args: productPriceArgs,
  before: productPriceBefore,
  async preview(input, ctx) {
    const rows = await db()
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, price: s.products.price, siteMenuId: s.products.siteMenuId })
      .from(s.products)
      .where(eq(s.products.active, true));
    const p = pickProduct(rows, input.urun, input.boy, "Adını ara ile bulun.");
    if (Math.abs(p.price - input.yeniFiyat) < 0.005) throw NO_CHANGE(`${cleanName(productLabel(p))} fiyatı zaten ${tl(p.price, 2)}`);
    const model = await loadModel();
    const calc = model.products.find((x) => x.product.id === p.id);
    const st = model.settings;
    const marginAt = (price: number) => {
      if (!calc || !calc.cost) return null;
      const net = price / (1 + st.kdv);
      return net > 0 ? (net - calc.cost - price * st.komisyon * st.kartOrani) / net : null;
    };
    const change = p.price > 0 ? (input.yeniFiyat - p.price) / p.price : null;
    const linked = p.siteMenuId !== null;
    // Seçili şubenin bugünkü kasası (Fiyatlar › Kasaya işle ile aynı kural): LafPOS gününde bağlı olmayan ürün de
    // listeye düşer, LafPOS'ta yerel ürünse fiyat orada elle değişir
    const lafposTill = (await loadTillScope(db(), ctx.now)).lafpos;
    const lines: OpCardLine[] = [
      { label: "Satış fiyatı", from: tl(p.price, 2), to: `${tl(input.yeniFiyat, 2)}${change !== null ? ` (${change >= 0 ? "+" : ""}${pct(change)})` : ""}` },
      { label: "Birim maliyet", to: calc?.cost ? tl(calc.cost, 2) : "Reçete yok" },
      { label: "Marj", from: marginAt(p.price) === null ? "–" : pct(marginAt(p.price)), to: marginAt(input.yeniFiyat) === null ? "–" : pct(marginAt(input.yeniFiyat)) },
      { label: "Site menüsü", to: linked ? "Bağlı: fiyat önce laffogato.net'te değişir" : "Bağlı değil" },
    ];
    const warnings = linked
      ? [
          "Önce siteye yazılır; site kabul etmezse hiçbir şey değişmez.",
          "LafPOS fiyatı siteden alır (en geç 15 dakika). ModPOS kullanan kasada fiyatı elle değiştirin: Fiyatlar › Kasaya işle listesine düşer.",
        ]
      : lafposTill
        ? [
            "Sitede değişmez. LafPOS ürünü siteden alıyorsa fiyat LafPOS'ta da değişmez: Ürünler › Site menüsü'nde bağlayın ya da fiyatı sitede değiştirin; LafPOS'ta yerel ürünse orada elle değiştirin. Fiyatlar › Kasaya işle listesine düşer.",
          ]
        : ["Sitede değişmez. Kasada elle değiştirilecek: Fiyatlar › Kasaya işle listesine düşer."];
    if (change !== null && Math.abs(change) > 0.3) warnings.unshift(`Fiyat ${pct(change)} değişiyor: tutarı kontrol edin.`);
    return {
      card: {
        title: `${cleanName(productLabel(p))} fiyatı ${tl(input.yeniFiyat, 2)} olacak`,
        subject: cleanName(productLabel(p)),
        branch: "Bütün şubeler (menü ortak)",
        day: dayText(today(ctx)),
        lines,
        effects: linked ? ["site", "lafpos", "modpos"] : lafposTill ? ["lafpos"] : ["modpos"],
        undo: "Sonuç kartındaki Geri al eski fiyatı geri yazar (fiyat bu arada başka yerde değişmediyse).",
        undoable: true,
        warnings,
      },
      args: { productId: p.id, price: input.yeniFiyat },
      before: { price: p.price },
      branch: null,
    };
  },
  async stale(args, before) {
    const now = await productPrice(args.productId);
    if (now === null) return "Ürün bulunamadı.";
    return Math.abs(now - before.price) < 0.005 ? null : `Ürünün fiyatı bu arada değişti (şimdi ${tl(now, 2)}).`;
  },
};

// ---------------------------------------------------------------- Kasadan çıkan

const DOC_LABEL = { fis: "Fiş", e_arsiv: "e-Arşiv", fatura: "Fatura", yok: "Belgesiz" } as const;
const cashOutArgs = z.object({
  branchId: z.string().min(1).max(24),
  date: z.string(),
  kind: z.enum(["harcama", "teslim"]),
  amount: z.number().positive(),
  store: z.string().max(60).nullable(),
  description: z.string().max(200).nullable(),
  docType: z.enum(["fis", "e_arsiv", "fatura", "yok"]),
  categoryId: z.number().int().positive().nullable(),
  toExpenses: z.boolean(),
});

async function reportEntered(date: string, branchId: string): Promise<boolean> {
  const [r] = await db()
    .select({ id: s.cashReports.id })
    .from(s.cashReports)
    .where(and(eq(s.cashReports.date, date), eq(s.cashReports.branchId, branchId)))
    .limit(1);
  return Boolean(r);
}

async function activeCategories() {
  return db().select({ id: s.expenseCategories.id, name: s.expenseCategories.name }).from(s.expenseCategories).where(eq(s.expenseCategories.active, true));
}

const cashOutAdd: OpPreview<"kasadan_cikan_ekle", z.output<typeof cashOutArgs>, z.output<typeof emptyBefore>> = {
  args: cashOutArgs,
  before: emptyBefore,
  async preview(input, ctx) {
    const b = physicalBranch(input.sube, ctx.scope, ctx.branches);
    const date = businessDate(ctx.now);
    if (await reportEntered(date, b.id)) {
      throw new ToolInputError(
        `${b.name} kasasının ${dayText(date)} raporu girilmiş; asistan raporu girilmiş güne yazmaz. Kullanıcı Kasa › gün › Kasadan çıkanlar'dan ekler: /panel/kasa?gun=${date}`,
      );
    }
    const teslim = input.tur === "teslim";
    if (teslim && input.harcamalaraYaz) throw new ToolInputError("Teslim (birine verilen para) Aylık harcamalar'a yazılmaz; harcamalaraYaz false olmalı.");
    if (input.harcamalaraYaz && !input.kategori) throw new ToolInputError("Aylık harcamalar'a yazılacaksa gider kategorisi gerekli; kullanıcıya sor.");
    const cat = !teslim && input.kategori ? pickByName(await activeCategories(), input.kategori, (c) => c.name, "Gider kategorisi", "Kategoriler Aylık harcamalar › Kategoriler'de.") : null;
    // Şubenin bu günü LafPOS'taysa kasadan çıkan LafPOS'ta girilir (docs/LAFPOS.md, KASA-RAPORU.md): panelden eklenen
    // satır LafPOS'un nakit sayımına girmez; aynı tür ve tutarda LafPOS hareketi gün sonunda bu satırı sahiplenir
    const lafposDay = isLafposDay(date, branchSwitchDay(await lafposSwitchDayOf(db()), b.id));
    const warnings = lafposDay
      ? [
          `${b.name} bu gün LafPOS'ta: kasadan çıkanı LafPOS'ta (Kasa › Harcama / Teslim) girin. Aynı tür ve tutarda LafPOS girişi gün sonunda bu satırı sahiplenir; LafPOS'a girilmezse LafPOS'un kasa sayımı eksik çıkar, tutarı farklıysa panelde ayrı bir satır olarak kalır.`,
          "Akşam kasa raporunun “Gün içinde kasadan çıkan” toplamına girer.",
        ]
      : ["Akşam kasa raporunun “Gün içinde kasadan çıkan” toplamına girer; LafPOS'a gitmez."];
    const lines: OpCardLine[] = [
      { label: "Kasa", to: b.name },
      { label: "Gün", to: dayText(date) },
      { label: "Tür", to: teslim ? "Teslim (birine verilen para)" : "Alışveriş" },
      { label: "Tutar", to: tl(input.tutar, 2) },
    ];
    const store = plainText(input.yer);
    const description = plainText(input.aciklama);
    if (store) lines.push({ label: teslim ? "Kime" : "Yer", to: store });
    if (description) lines.push({ label: "Ne alındı", to: description });
    lines.push({ label: "Belge", to: DOC_LABEL[input.belge] });
    if (cat) lines.push({ label: "Kategori", to: cleanName(cat.name) });
    lines.push({ label: "Aylık harcamalar'a", to: yesNo(input.harcamalaraYaz) });
    return {
      card: {
        title: `${b.name} kasasından ${tl(input.tutar, 2)} çıkış eklenecek`,
        subject: cleanName(store ?? description ?? (teslim ? "Teslim" : "Alışveriş"), 60),
        branch: b.name,
        day: dayText(date),
        lines,
        effects: input.harcamalaraYaz ? ["kasa", "gelirGider"] : ["kasa"],
        undo: "Asistan geri almaz (silmek gerekir): Kasa › Kasadan çıkanlar › satır › Sil (bildirimde 15 dk Geri al).",
        undoable: false,
        warnings,
      },
      args: {
        branchId: b.id,
        date,
        kind: input.tur,
        amount: input.tutar,
        store,
        description,
        docType: input.belge,
        categoryId: cat?.id ?? null,
        toExpenses: input.harcamalaraYaz,
      },
      before: {},
      branch: b.id,
    };
  },
  async stale(args) {
    if (businessDate(new Date()) !== args.date) return "İş günü değişti (05:00); kartı yeniden isteyin.";
    return (await reportEntered(args.date, args.branchId)) ? "Bu arada günün kasa raporu girildi; satırı Kasa ekranından ekleyin." : null;
  },
};

// ---------------------------------------------------------------- Harcama (gider)

const PAY_LABEL = { nakit: "Nakit", kart: "Kart", havale: "Havale / EFT", diger: "Diğer" } as const;
const expenseArgs = z.object({
  categoryId: z.number().int().positive(),
  date: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.enum(["nakit", "kart", "havale", "diger"]).nullable(),
  description: z.string().max(200).nullable(),
});

const expenseAdd: OpPreview<"harcama_ekle", z.output<typeof expenseArgs>, z.output<typeof emptyBefore>> = {
  args: expenseArgs,
  before: emptyBefore,
  async preview(input, ctx) {
    if (input.tarih > today(ctx)) throw new ToolInputError("Harcamanın günü ileri bir tarih olamaz.");
    const eb = expenseBranch(input.sube, ctx.scope, ctx.branches);
    const cat = pickByName(await activeCategories(), input.kategori, (c) => c.name, "Gider kategorisi", "Kategoriler Aylık harcamalar › Kategoriler'de.");
    const lines: OpCardLine[] = [
      { label: "Kategori", to: cleanName(cat.name) },
      { label: "Tutar", to: tl(input.tutar, 2) },
      { label: "Gün", to: dayText(input.tarih) },
      { label: "Ödeme şekli", to: input.odemeSekli ? PAY_LABEL[input.odemeSekli] : "Belirtilmedi" },
      { label: "Şube", to: eb.label },
    ];
    const description = plainText(input.aciklama);
    if (description) lines.push({ label: "Açıklama", to: description });
    return {
      card: {
        title: `${cleanName(cat.name)} gideri eklenecek: ${tl(input.tutar, 2)}`,
        subject: cleanName(cat.name),
        branch: eb.label,
        day: dayText(input.tarih),
        lines,
        effects: ["gelirGider"],
        undo: "Asistan geri almaz (silmek gerekir): Aylık harcamalar › kayıt › Sil (bildirimde Geri al).",
        undoable: false,
        warnings: input.tarih.slice(0, 7) < today(ctx).slice(0, 7) ? ["Geçmiş ayın giderine yazılır: o ayın kârı değişir."] : [],
      },
      args: { categoryId: cat.id, date: input.tarih, amount: input.tutar, paymentMethod: input.odemeSekli ?? null, description },
      before: {},
      branch: eb.scope,
    };
  },
  async stale(args) {
    const [c] = await db().select({ active: s.expenseCategories.active }).from(s.expenseCategories).where(eq(s.expenseCategories.id, args.categoryId)).limit(1);
    return c?.active ? null : "Kategori bu arada pasife alındı ya da silindi.";
  },
};

// ---------------------------------------------------------------- Zayi / ikram

const wasteArgs = z.object({
  date: z.string(),
  kind: z.enum(["zayi", "ikram"]),
  productId: z.number().int().positive().nullable(),
  ingredientId: z.number().int().positive().nullable(),
  qty: z.number().positive().max(10_000),
  reason: z.string().max(60).nullable(),
});

const wasteAdd: OpPreview<"zayi_ikram_ekle", z.output<typeof wasteArgs>, z.output<typeof emptyBefore>> = {
  args: wasteArgs,
  before: emptyBefore,
  async preview(input, ctx) {
    const b = physicalBranch(input.sube, ctx.scope, ctx.branches);
    const date = input.tarih ?? businessDate(ctx.now);
    if (date > businessDate(ctx.now)) throw new ToolInputError("İleri bir güne zayi ya da ikram girilemez.");
    let target: { productId: number | null; ingredientId: number | null; name: string; unit: string };
    if (input.urun) {
      const rows = await db().select({ id: s.products.id, name: s.products.name, size: s.products.size }).from(s.products).where(eq(s.products.active, true));
      const p = pickProduct(rows, input.urun, input.boy, "Adını ara ile bulun.");
      if (!Number.isInteger(input.miktar)) throw new ToolInputError("Ürün adetle girilir (ör. 2).");
      target = { productId: p.id, ingredientId: null, name: productLabel(p), unit: "adet" };
    } else {
      const rows = await db()
        .select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, countUnit: s.ingredients.countUnit })
        .from(s.ingredients)
        .where(eq(s.ingredients.active, true));
      const i = pickByName(rows, input.hammadde!, (r) => r.name, "Hammadde", "Adını ara ile bulun.");
      target = { productId: null, ingredientId: i.id, name: i.name, unit: i.countUnit ?? i.unit };
    }
    const kindLabel = input.tur === "zayi" ? "Zayi" : "İkram";
    const lines: OpCardLine[] = [
      { label: "Şube", to: b.name },
      { label: "Gün", to: dayText(date) },
      { label: "Tür", to: kindLabel },
      { label: target.productId ? "Ürün" : "Hammadde", to: cleanName(target.name) },
      { label: "Miktar", to: `${num(input.miktar, 3)} ${target.unit}` },
    ];
    const reason = plainText(input.neden);
    if (reason) lines.push({ label: "Neden", to: reason });
    return {
      card: {
        title: `${kindLabel} kaydı girilecek: ${cleanName(target.name)} ${num(input.miktar, 3)} ${target.unit}`,
        subject: cleanName(target.name),
        branch: b.name,
        day: dayText(date),
        lines,
        effects: ["stok"],
        undo: "Asistan geri almaz (silmek gerekir): Zayi › kayıt › Sil.",
        undoable: false,
        warnings: target.ingredientId ? [`Miktar hammaddenin sayım biriminde (${target.unit}); kontrol edin.`] : [],
      },
      args: { date, kind: input.tur, productId: target.productId, ingredientId: target.ingredientId, qty: input.miktar, reason },
      before: {},
      branch: b.id,
    };
  },
  stale: async () => null,
};

// ---------------------------------------------------------------- Vardiya

const shiftArgs = z.object({
  branchId: z.string().min(1).max(24),
  monday: z.string(),
  ref: z.string().min(3).max(62),
  name: z.string().min(1).max(80),
  changes: z.array(z.object({ date: z.string(), text: z.string().max(120) })).min(1).max(7),
});
const shiftBefore = z.object({ cells: z.array(z.string()).length(7) });

/** Kişinin haftadaki yedi hücresi (kayıttan, taze) */
export async function personCells(branchId: string, monday: string, ref: string): Promise<(ShiftCell | null)[]> {
  const { entries } = await loadShiftEntries(db(), branchId, monday);
  const days = weekDays(monday);
  return days.map((d) => entries.find((e) => e.ref === ref && e.date === d)?.cell ?? null);
}

const shiftCells: OpPreview<"vardiya_hucre_yaz", z.output<typeof shiftArgs>, z.output<typeof shiftBefore>> = {
  args: shiftArgs,
  before: shiftBefore,
  async preview(input, ctx) {
    const b = physicalBranch(input.sube, ctx.scope, ctx.branches);
    const monday = weekStart(input.gunler[0].gun);
    if (input.gunler.some((g) => weekStart(g.gun) !== monday)) throw new ToolInputError("Günler aynı haftada olmalı (Pazartesi–Pazar); başka haftayı ayrı kartla iste.");
    if (new Set(input.gunler.map((g) => g.gun)).size !== input.gunler.length) throw new ToolInputError("Aynı gün iki kez verildi.");
    const week = await loadShiftWeek(db(), { id: b.id, name: b.name }, monday, { roster: true });
    const people = [...week.rows.map((r) => ({ ref: r.ref, name: r.name })), ...week.others.map((o) => ({ ref: userRef(o.id), name: o.name }))];
    const person = pickByName(people, input.kisi, (p) => p.name, "Kişi", "Kişinin adını Vardiya ekranındaki gibi yazın.");
    const days = weekDays(monday);
    const old = await personCells(b.id, monday, person.ref);
    // Bugünkü ekran hesabı: hücre kayıtta yoksa planlanmamış; kişi ızgarada satırı olmayan bir hesapsa da öyle
    const next = [...old];
    const changes: { date: string; text: string }[] = [];
    for (const g of input.gunler) {
      const i = days.indexOf(g.gun);
      const parsed = parseShiftCell(expandShiftAbbr(b.id, g.metin));
      if (!parsed.ok) throw new ToolInputError(`${dayLong(g.gun, i)}: ${parsed.error}`);
      next[i] = parsed.cell;
      changes.push({ date: g.gun, text: formatShiftCell(parsed.cell) });
    }
    const changed = days.flatMap((d, i) => (formatShiftCell(old[i]) !== formatShiftCell(next[i]) || old[i]?.kind !== next[i]?.kind ? [i] : []));
    if (!changed.length) throw NO_CHANGE(`${cleanName(person.name)} için bu günler zaten böyle`);
    const lines: OpCardLine[] = changed.map((i) => ({
      label: dayLong(days[i], i),
      from: formatShiftCell(old[i]) || "Planlanmadı",
      to: next[i] ? formatShiftCell(next[i]) : "Boşaltılacak",
      danger: next[i] === null,
    }));
    lines.push({ label: "Haftalık toplam", from: hoursLabel(rowMinutes({ cells: old })), to: hoursLabel(rowMinutes({ cells: next })) });
    const warnings = ["Personel planı Vardiya ekranında görür; PDF kayıttan çizilir. Bildirim gitmez."];
    if (changed.some((i) => next[i] === null)) warnings.unshift("Kırmızı günler plandan çıkar (hücre boşaltılır).");
    return {
      card: {
        title: `${cleanName(person.name)} için vardiya ayarlanacak (${b.name}, ${weekLabel(monday)})`,
        subject: cleanName(person.name),
        branch: b.name,
        day: weekLabel(monday),
        lines,
        effects: ["personel"],
        undo: "Sonuç kartındaki Geri al eski hücreleri geri yazar (bu arada değişmediyse).",
        undoable: true,
        warnings,
      },
      args: { branchId: b.id, monday, ref: person.ref, name: person.name.slice(0, 80), changes: changes.filter((c) => changed.includes(days.indexOf(c.date))) },
      before: { cells: old.map(formatShiftCell) },
      branch: b.id,
    };
  },
  async stale(args, before) {
    const now = (await personCells(args.branchId, args.monday, args.ref)).map(formatShiftCell);
    return now.every((c, i) => c === before.cells[i]) ? null : "Bu kişinin o haftaki vardiyası bu arada değişti; Vardiya ekranında bakın.";
  },
};

// ---------------------------------------------------------------- Liste

/** İşlem adı → önizleme (her işlem: kendi bağımsız değişken ve önceki değer şemasıyla) */
export const PREVIEWS: { [N in OpName]: OpPreview<N, unknown, unknown> } = {
  urun_tukendi_yap: soldOutPreview(true) as OpPreview<"urun_tukendi_yap", unknown, unknown>,
  urun_satisa_ac: soldOutPreview(false) as OpPreview<"urun_satisa_ac", unknown, unknown>,
  parasut_urun_bagla: parasutLink as OpPreview<"parasut_urun_bagla", unknown, unknown>,
  hatirlatici_ekle: reminderAdd as OpPreview<"hatirlatici_ekle", unknown, unknown>,
  hatirlatici_odendi: reminderPaid as OpPreview<"hatirlatici_odendi", unknown, unknown>,
  fatura_odendi: invoicePaid as OpPreview<"fatura_odendi", unknown, unknown>,
  tedarikci_odemesi_ekle: supplierPayment as OpPreview<"tedarikci_odemesi_ekle", unknown, unknown>,
  hammadde_fiyati_degistir: ingredientPriceChange as OpPreview<"hammadde_fiyati_degistir", unknown, unknown>,
  urun_fiyati_degistir: productPriceChange as OpPreview<"urun_fiyati_degistir", unknown, unknown>,
  kasadan_cikan_ekle: cashOutAdd as OpPreview<"kasadan_cikan_ekle", unknown, unknown>,
  harcama_ekle: expenseAdd as OpPreview<"harcama_ekle", unknown, unknown>,
  zayi_ikram_ekle: wasteAdd as OpPreview<"zayi_ikram_ekle", unknown, unknown>,
  vardiya_hucre_yaz: shiftCells as OpPreview<"vardiya_hucre_yaz", unknown, unknown>,
};
