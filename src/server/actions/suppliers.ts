"use server";

import { desc, eq, isNotNull, or } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import {
  cleanAliases,
  formatIban,
  ibanProblem,
  INFO_FIELDS,
  mergeInfo,
  nameConflict,
  normalizeIban,
  normalizeTaxNumber,
  PAYMENT_METHOD_VALUES,
  taxNumberCheck,
  type SupplierInfo,
} from "@/app/panel/tedarikciler/logic";
import { dateTR } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { supplierSlugOf } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { ParasutAuthError, ParasutClient, ParasutDeadlineError, ParasutError } from "@/server/parasut/client";
import { isParasutConfigured } from "@/server/parasut/config";
import { contactInfo } from "@/server/parasut/mapping";
import { extractUblXml, parseUbl } from "@/server/parasut/ubl";

import { logActivity } from "./log";
import { attempt, UserError, zOptText, zText } from "./util";

const zId = z.number().int().positive();

const cardSchema = z.object({
  name: zText("Tedarikçi adı", 120),
  aliases: z.array(z.string().max(200, "Diğer ad çok uzun")).max(30, "En fazla 30 diğer ad"),
  legalName: zOptText(250),
  taxNumber: zOptText(30),
  taxOffice: zOptText(120),
  iban: zOptText(60),
  bankName: zOptText(120),
  accountHolder: zOptText(160),
  contactName: zOptText(120),
  phone: zOptText(40),
  email: zOptText(160).refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-posta adresi geçersiz"),
  address: zOptText(500),
  paymentTermDays: z.number({ message: "Vade gün olarak girilir" }).int("Vade tam gün olmalı").min(0, "Vade negatif olamaz").max(365, "Vade en fazla 365 gün").nullable(),
  paymentMethod: z.enum(PAYMENT_METHOD_VALUES).nullable(),
  paidOnDelivery: z.boolean(),
  note: zOptText(1000),
});

type CardInput = z.input<typeof cardSchema>;

/** Formdan gelen kartı doğrular ve saklanacak biçime getirir (IBAN boşluksuz, vergi no yalnız rakam) */
function cleanCard(input: CardInput) {
  const data = cardSchema.parse(input);
  const iban = data.iban ? normalizeIban(data.iban) : null;
  const ibanError = ibanProblem(iban);
  if (ibanError) throw new UserError(ibanError);
  const taxNumber = data.taxNumber ? normalizeTaxNumber(data.taxNumber) : null;
  const tax = taxNumberCheck(taxNumber);
  if (tax && "error" in tax) throw new UserError(tax.error);
  const name = data.name.replace(/\s+/g, " ").trim();
  return { ...data, name, iban, taxNumber: taxNumber || null };
}

/** Faturalarda bu anahtarla duran tedarikçi adı var mı (ad değişince eski adın faturaları kartta kalsın) */
async function hasInvoicesNamed(key: string): Promise<boolean> {
  const rows = await getDb().selectDistinct({ supplier: s.invoices.supplier }).from(s.invoices);
  return rows.some((r) => supplierMatchKey(r.supplier) === key);
}

/**
 * Cari kartını ekler ya da günceller. Faturalar adla eşleşir: kartın adı ve diğer adları başka bir kartta olamaz.
 * Ad değiştiyse ve eski adla faturalar duruyorsa eski ad diğer adlara eklenir (faturalar kartta kalır).
 */
export async function saveSupplier(input: CardInput & { id: number | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.nullable().parse(input.id);
    const data = cleanCard(input);
    const db = getDb();
    const all = await db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, iban: s.suppliers.iban }).from(s.suppliers);
    const cur = id ? all.find((c) => c.id === id) : null;
    if (id && !cur) throw new UserError("Tedarikçi kartı bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    const renamed = cur && supplierMatchKey(cur.name) !== supplierMatchKey(data.name) && (await hasInvoicesNamed(supplierMatchKey(cur.name))) ? cur.name : null;
    const aliases = cleanAliases(data.name, data.aliases, renamed);
    const conflict = nameConflict({ id, name: data.name, aliases }, all);
    if (conflict) throw new UserError(`“${conflict.name}” zaten “${conflict.owner}” kartında; bir ad iki kartta olamaz. Önce o karttan çıkarın.`);
    const values = { ...data, aliases, key: supplierMatchKey(data.name), updatedAt: new Date() };
    let savedId: number;
    if (cur) {
      await db.update(s.suppliers).set(values).where(eq(s.suppliers.id, cur.id));
      savedId = cur.id;
    } else {
      const [row] = await db.insert(s.suppliers).values(values).returning({ id: s.suppliers.id });
      savedId = row.id;
    }
    await logActivity(me, cur ? "Tedarikçi kartı düzenlendi" : "Tedarikçi kartı eklendi", [data.name, aliases.length ? `diğer adlar: ${aliases.join(", ")}` : null].filter(Boolean).join(" · "));
    // IBAN değişikliği ayrıca yazılır (eski ve yeni): sahte "IBAN'ımız değişti" e-postası en sık ödeme dolandırıcılığı
    if (cur && (cur.iban ?? null) !== (data.iban ?? null)) {
      await logActivity(me, "Tedarikçi IBAN'ı değişti", `${data.name}: ${cur.iban ? formatIban(cur.iban) : "yok"} → ${data.iban ? formatIban(data.iban) : "silindi"}`);
    }
    refresh();
    return { id: savedId, slug: await supplierSlugOf(savedId), renamedAlias: renamed && aliases.includes(renamed) ? renamed : null };
  });
}

/** Silinen kartın geri yazılabilir kopyası (kimlik ve zamanlar hariç) */
export type SupplierSnapshot = z.infer<typeof cardSchema>;

/** Cari kartını siler; faturalar yerinde kalır (tedarikçi kartsız görünür). Bildirimdeki "Geri al" kopyayla geri yazar. */
export async function deleteSupplier(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [row] = await getDb().delete(s.suppliers).where(eq(s.suppliers.id, zId.parse(id))).returning();
    if (!row) throw new UserError("Tedarikçi kartı bulunamadı; zaten silinmiş olabilir.");
    await logActivity(me, "Tedarikçi kartı silindi", row.name);
    refresh();
    const snapshot: SupplierSnapshot = {
      name: row.name,
      aliases: row.aliases ?? [],
      legalName: row.legalName,
      taxNumber: row.taxNumber,
      taxOffice: row.taxOffice,
      iban: row.iban,
      bankName: row.bankName,
      accountHolder: row.accountHolder,
      contactName: row.contactName,
      phone: row.phone,
      email: row.email,
      address: row.address,
      paymentTermDays: row.paymentTermDays,
      paymentMethod: row.paymentMethod,
      paidOnDelivery: row.paidOnDelivery,
      note: row.note,
    };
    return { snapshot };
  });
}

/** Az önce silinen kartı geri yazar (aynı adlar bu arada başka bir karta verildiyse yazılmaz) */
export async function restoreSupplier(snapshot: CardInput) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = cleanCard(snapshot);
    const db = getDb();
    const all = await db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
    const conflict = nameConflict({ id: null, name: data.name, aliases: data.aliases }, all);
    if (conflict) throw new UserError(`“${conflict.name}” bu arada “${conflict.owner}” kartına verildi; kart geri alınamadı.`);
    const [row] = await db
      .insert(s.suppliers)
      .values({ ...data, key: supplierMatchKey(data.name) })
      .returning({ id: s.suppliers.id });
    await logActivity(me, "Silinen tedarikçi kartı geri alındı", data.name);
    refresh();
    return { id: row.id, slug: await supplierSlugOf(row.id) };
  });
}

/** Faturadan doldururken bakılan en fazla fatura (en yeni önce; ilki bir şey verirse ötekilere geçilmez) */
const INFO_TRIES = 3;

/**
 * "Faturadan doldur": tedarikçinin en yeni Paraşüt faturasından cari bilgileri okunur. E-faturanın belgesindeki
 * satıcı bilgileri (unvan, VKN, vergi dairesi, adres, telefon, e-posta, IBAN) önce gelir; fatura Paraşüt'te içeri
 * alınmışsa Paraşüt'teki kişi kartı boş kalanları tamamlar. Kart değişmez: bilgiler formun boş alanlarına girer,
 * kullanıcı bakıp kaydeder. `names`: tedarikçinin faturalarda geçen adları (kartın adı ve diğer adları).
 */
export async function supplierInfoFromParasut(names: string[]) {
  return attempt(async () => {
    await requireAdmin();
    if (!isParasutConfigured()) throw new UserError("Paraşüt bağlantısı kurulu değil; bilgileri faturadan bakıp elle girin.");
    const keys = new Set(z.array(z.string().max(300)).min(1).max(40).parse(names).map(supplierMatchKey));
    const rows = await getDb()
      .select({ id: s.invoices.id, supplier: s.invoices.supplier, date: s.invoices.date, invoiceNo: s.invoices.invoiceNo, eInvoiceId: s.invoices.eInvoiceId, externalId: s.invoices.externalId })
      .from(s.invoices)
      .where(or(isNotNull(s.invoices.eInvoiceId), isNotNull(s.invoices.externalId)))
      .orderBy(desc(s.invoices.date), desc(s.invoices.id));
    const mine = rows.filter((r) => keys.has(supplierMatchKey(r.supplier))).slice(0, INFO_TRIES);
    if (!mine.length) throw new UserError("Bu tedarikçinin Paraşüt'ten gelen faturası yok; bilgileri elle girin.");
    const client = new ParasutClient();
    client.setDeadline(Date.now() + 40_000);
    const parts: Partial<SupplierInfo>[] = [];
    let source: string | null = null;
    // Paraşüt'e ulaşılamadıysa "bilgi yok" denmez: kullanıcı sonra yeniden dener
    let unreachable: string | null = null;
    for (const r of mine) {
      const label = r.invoiceNo ?? `${dateTR(r.date)} tarihli fatura`;
      try {
        if (r.eInvoiceId) {
          const file = await client.getBytes(`e_invoices/${encodeURIComponent(r.eInvoiceId)}/signed_ubl`);
          if (file) {
            parts.push(parseUbl(extractUblXml(file.bytes)).supplierInfo);
            source ??= `${label} (e-fatura)`;
          }
        }
        if (r.externalId) {
          const bill = await client.show(`purchase_bills/${encodeURIComponent(r.externalId)}`);
          const rel = bill.data.relationships?.supplier?.data;
          const contactId = rel && !Array.isArray(rel) ? rel.id : null;
          if (contactId) {
            const contact = await client.show<Record<string, unknown>>(`contacts/${encodeURIComponent(contactId)}`);
            parts.push(contactInfo(contact.data.attributes));
            source ??= `${label} (Paraşüt kişi kartı)`;
          }
        }
      } catch (e) {
        if (e instanceof ParasutAuthError) throw new UserError(e.message);
        if (e instanceof ParasutDeadlineError) {
          unreachable = "Paraşüt zamanında yanıt vermedi; biraz sonra yeniden deneyin.";
          break;
        }
        // Belgesi alınamayan fatura (Paraşüt 5xx, bozuk belge) atlanır, bir öncekine bakılır
        if (e instanceof ParasutError) unreachable = e.message;
        console.error("Faturadan cari bilgisi", r.id, e);
      }
      if (parts.length) break;
    }
    const info = mergeInfo(...parts);
    const found = INFO_FIELDS.filter((k) => info[k]);
    if (!found.length) throw new UserError(unreachable && !parts.length ? unreachable : "Faturada okunabilen cari bilgisi bulunamadı; bilgileri elle girin.");
    return { info, found, source };
  });
}
