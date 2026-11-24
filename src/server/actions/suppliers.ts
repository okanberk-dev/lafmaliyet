"use server";

import { and, asc, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { supplierMatchKey } from "@/app/panel/faturalar/rules";
import {
  cleanAliases,
  formatIban,
  supplierResolver,
  ibanProblem,
  INFO_FIELDS,
  mergeInfo,
  nameConflict,
  nameMoveBlock,
  nameMoves,
  normalizeIban,
  normalizeTaxNumber,
  PAYMENT_METHOD_VALUES,
  isHiddenSupplier,
  PLACEHOLDER_SUPPLIER_NAME,
  taxKey,
  taxNameIndex,
  taxNumberCheck,
  type SupplierInfo,
} from "@/app/panel/tedarikciler/logic";
import { dateTR, money, num } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { accountOf } from "@/lib/cari/account";
import { loadCardEntries } from "@/server/data/cari";
import { loadSupplierLedger, loadSupplierRefs, supplierSlugOf, supplierSlugOfKey } from "@/server/data/suppliers";
import { getDb, schema as s } from "@/server/db";
import { ParasutAuthError, ParasutClient, ParasutDeadlineError, ParasutError } from "@/server/parasut/client";
import { isParasutConfigured, readParasutConfig } from "@/server/parasut/config";
import { contactInfo, sameSupplier } from "@/server/parasut/mapping";
import { syncSupplierHistory } from "@/server/parasut/sync";
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
  if (supplierMatchKey(name) === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME)) {
    throw new UserError(`“${PLACEHOLDER_SUPPLIER_NAME}” Paraşüt'ün adı okunamayan faturalara verdiği geçici ad; tedarikçinin gerçek adını yazın.`);
  }
  return { ...data, name, iban, taxNumber: taxNumber || null };
}

/**
 * Ad çakışmasının sözü: ad listede görünmeyen (listeden kaldırılmış) bir tedarikçideyse nereden geri getirileceği de
 * söylenir. Gizli mi, listeyle aynı kuralla bakılır (kaldırılmış ama yeni faturasıyla dönmüş olabilir).
 */
async function conflictMessage(conflict: { name: string; owner: string }) {
  const { groups } = await loadSupplierLedger();
  const owner = groups.find((g) => g.card?.name === conflict.owner);
  const hidden = Boolean(owner && isHiddenSupplier(owner.card, owner.summary, { ...owner.account, lastEntry: owner.lastEntry }));
  return `“${conflict.name}” zaten “${conflict.owner}” tedarikçisinde kayıtlı; bir ad iki tedarikçide olamaz.${
    hidden ? " O tedarikçi listeden kaldırılmış: Tedarikçiler listesinin altındaki “Listeden kaldırılanlar”dan geri getirip düzenleyin." : " Önce oradan çıkarın."
  }`;
}

/** Faturalarda bu anahtarla duran tedarikçi adı var mı (ad değişince eski adın faturaları kartta kalsın) */
async function hasInvoicesNamed(key: string): Promise<boolean> {
  const rows = await getDb().selectDistinct({ supplier: s.invoices.supplier }).from(s.invoices);
  return rows.some((r) => supplierMatchKey(r.supplier) === key);
}

/**
 * Kart eklenince ya da adı, diğer adları veya vergi nosu değişince başka gruba geçecek faturalar (eski ve yeni
 * eşleşme, bütün kartlarda): içlerinde cari ödemesi sayılmış (`allocated` > 0) ya da faturasız alımı bağlı olup bir
 * karttan çıkan varsa kayıt reddedilir (K23). Yalnız düzenlenen kartın değil, başka bir kartın faturasını bu karta
 * (ya da kartsız bir gruba) çeken değişiklik de; yeni kart da denetlenir. Para gruplar arasında sessizce dağılmasın.
 */
async function assertNoCariMove(
  all: readonly { id: number; name: string; aliases: string[] | null; taxNumber: string | null }[],
  next: { id: number | null; name: string; aliases: string[]; taxNumber: string | null },
) {
  const db = getDb();
  const [counted, linked] = await Promise.all([
    db.select({ id: s.invoices.id, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(gt(s.invoices.allocated, 0)),
    db.selectDistinct({ id: s.supplierEntries.invoiceId }).from(s.supplierEntries).where(isNotNull(s.supplierEntries.invoiceId)),
  ]);
  const linkedIds = linked.map((r) => r.id).filter((x): x is number => x !== null);
  const extra = linkedIds.length
    ? await db.select({ id: s.invoices.id, supplier: s.invoices.supplier, tax: s.invoices.supplierTaxNumber }).from(s.invoices).where(inArray(s.invoices.id, linkedIds))
    : [];
  const watched = [...new Map([...counted, ...extra].map((r) => [r.id, r])).values()];
  if (!watched.length) return;
  const refs = await loadSupplierRefs();
  const cards = all.map((c) => ({ ...c, aliases: c.aliases ?? [] }));
  const before = supplierResolver(cards, refs).resolve;
  // Yeni kart eşleşmede geçici bir kimlikle yer alır
  const edited = { id: next.id ?? -1, name: next.name, aliases: next.aliases, taxNumber: next.taxNumber };
  const after = supplierResolver(next.id === null ? [...cards, edited] : cards.map((c) => (c.id === next.id ? { ...c, ...edited } : c)), refs).resolve;
  const leaving = watched.flatMap((r) => {
    const from = before(r.supplier, r.tax).card;
    const to = after(r.supplier, r.tax).card;
    return from && from.id !== (to?.id ?? null) ? [{ ...r, from: from.name }] : [];
  });
  if (!leaving.length) return;
  const names = [...new Set(leaving.map((r) => r.supplier))];
  const owners = [...new Set(leaving.map((r) => r.from))];
  throw new UserError(
    `${names.map((n) => `‘${n}’`).join(", ")} adıyla ${num(leaving.length)} faturaya ${owners.join(", ")} tedarikçisinin ödemesi sayılmış ya da faturasız alımı bağlı; bu değişiklik onları başka tedarikçiye taşır. Önce ödemeden çıkarın ya da bağı kaldırın.`,
  );
}

/**
 * Cari kartını ekler ya da günceller. Faturalar adla eşleşir: kartın adı ve diğer adları başka bir kartta olamaz.
 * Ad değiştiyse ve eski adla faturalar duruyorsa eski ad diğer adlara eklenir (faturalar kartta kalır). Aynı vergi
 * no başka bir kartta da yazılıysa kayıt durmaz (aynı kişinin iki dükkânı olabilir), adları döner: numara eşleşmede
 * kullanılmaz, bildirim söyler.
 */
export async function saveSupplier(input: CardInput & { id: number | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.nullable().parse(input.id);
    const data = cleanCard(input);
    const db = getDb();
    const all = await db
      .select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases, iban: s.suppliers.iban, taxNumber: s.suppliers.taxNumber })
      .from(s.suppliers);
    const cur = id ? all.find((c) => c.id === id) : null;
    if (id && !cur) throw new UserError("Tedarikçi bulunamadı; başka bir oturumda silinmiş olabilir. Sayfayı yenileyin.");
    const renamed = cur && supplierMatchKey(cur.name) !== supplierMatchKey(data.name) && (await hasInvoicesNamed(supplierMatchKey(cur.name))) ? cur.name : null;
    const aliases = cleanAliases(data.name, data.aliases, renamed);
    const conflict = nameConflict({ id, name: data.name, aliases }, all);
    if (conflict) throw new UserError(await conflictMessage(conflict));
    // Cari (K23): ödemesi sayılmış ya da faturasız alımı bağlı faturayı başka tedarikçiye taşıyan ad değişikliği olmaz
    await assertNoCariMove(all, { id: cur?.id ?? null, name: data.name, aliases, taxNumber: data.taxNumber });
    const values = { ...data, aliases, key: supplierMatchKey(data.name), updatedAt: new Date() };
    let savedId: number;
    if (cur) {
      await db.update(s.suppliers).set(values).where(eq(s.suppliers.id, cur.id));
      savedId = cur.id;
    } else {
      const [row] = await db.insert(s.suppliers).values(values).returning({ id: s.suppliers.id });
      savedId = row.id;
    }
    await logActivity(me, cur ? "Tedarikçi düzenlendi" : "Tedarikçi eklendi", [data.name, aliases.length ? `diğer adlar: ${aliases.join(", ")}` : null].filter(Boolean).join(" · "));
    // IBAN değişikliği ayrıca yazılır (eski ve yeni): sahte "IBAN'ımız değişti" e-postası en sık ödeme dolandırıcılığı
    if (cur && (cur.iban ?? null) !== (data.iban ?? null)) {
      await logActivity(me, "Tedarikçi IBAN'ı değişti", `${data.name}: ${cur.iban ? formatIban(cur.iban) : "yok"} → ${data.iban ? formatIban(data.iban) : "silindi"}`);
    }
    refresh();
    const tax = taxKey(data.taxNumber);
    const sharedTax = tax ? all.filter((c) => c.id !== savedId && taxKey(c.taxNumber) === tax).map((c) => c.name) : [];
    return { id: savedId, slug: await supplierSlugOf(savedId), renamedAlias: renamed && aliases.includes(renamed) ? renamed : null, sharedTax };
  });
}

/** Silinen kartın geri yazılabilir kopyası (kimlik ve zamanlar hariç) */
export type SupplierSnapshot = z.infer<typeof cardSchema>;

/** Sayfadaki tedarikçi: kartı varsa kartın kimliği, yoksa faturalardaki adlarından birinin anahtarı */
const targetSchema = z.object({ cardId: zId.nullable(), key: z.string().min(1).max(300) });

/**
 * Sayfadaki tedarikçinin güncel grubu (kart ve faturalar). Kartsız tedarikçi adlarından biriyle bulunur: vergi noyla
 * birleşen adların grubunun anahtarı, sayfa açıldıktan sonra daha küçük anahtarlı bir ad katılınca değişebilir.
 */
async function findGroup(input: z.input<typeof targetSchema>) {
  const { cardId, key } = targetSchema.parse(input);
  const ledger = await loadSupplierLedger();
  const g = ledger.groups.find((x) => (cardId ? x.card?.id === cardId : !x.card && x.keys.includes(key)));
  if (!g) throw new UserError("Tedarikçi bulunamadı; başka bir oturumda değişmiş olabilir. Sayfayı yenileyin.");
  return { ...ledger, g };
}

/**
 * Tedarikçiyi siler. Faturası yoksa kartı silinir; bildirimdeki "Geri al" kopyayla geri yazar. Faturası varsa faturalar
 * (gider ve aylık hesapların kaynağı) silinmez: tedarikçi listeden kaldırılır, bilgileri saklanır (kartı yoksa adıyla
 * bir kart açılır). Ödenmemiş faturası olan kaldırılamaz: borç listeden gizlenmesin. Adı başka kartlarda da duran
 * kartsız tedarikçi de kaldırılamaz: açılan kart o faturaları da çekerdi (nameMoves). Kaldırıldıktan sonraki tarihli
 * faturası gelirse listeye kendiliğinden döner (isHiddenSupplier).
 */
export async function removeSupplier(input: z.input<typeof targetSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { today, groups, g } = await findGroup(input);
    if (g.key === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME)) {
      throw new UserError("Bunlar Paraşüt'te adı okunamayan faturalar; sonraki eşitlemede gerçek tedarikçilerine geçer.");
    }
    const db = getDb();
    // Cari (K23): kaydı olan kart silinmez, yalnız listeden kalkar; açık borcu ya da hesapta parası olan kalkmaz
    const cari = g.card ? await loadCardEntries([g.card.id]) : null;
    const hasEntries = Boolean(cari && (cari.debts.length || cari.payments.length));
    if (cari && hasEntries) {
      const acc = accountOf({ invoices: [], ...cari }, { today, termDays: 0 });
      if (acc.credit > 0.005) throw new UserError(`${g.name}: hesapta ${money(acc.credit)} sayılmamış ödeme var; önce borçlara sayın ya da ödemeyi silin.`);
      if (acc.debtOpenCount) throw new UserError(`${g.name}: ${num(acc.debtOpenCount)} açık faturasız borcu var (${money(acc.debtOpen)}). Borcu olan tedarikçi listeden kaldırılamaz.`);
    }
    if (!g.invoices.length && !hasEntries) {
      if (!g.card) throw new UserError("Tedarikçi bulunamadı; sayfayı yenileyin.");
      const [row] = await db.delete(s.suppliers).where(eq(s.suppliers.id, g.card.id)).returning();
      if (!row) throw new UserError("Tedarikçi bulunamadı; zaten silinmiş olabilir.");
      await logActivity(me, "Tedarikçi silindi", row.name);
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
      return { mode: "deleted" as const, snapshot };
    }
    // Kartsız tedarikçi onun adıyla açılan (gizli) kartla kaldırılır. İki kartı bağlayan numarada adın vergi nolu
    // faturaları o kartlarda durur; ad önce geldiği için yeni kart onları da çekerdi. Borçtan önce söylenir: borç
    // kapansa da kaldırılamaz
    const moves = g.card ? null : nameMoves(taxNameIndex(groups), g.names, null);
    if (moves?.count) throw new UserError(nameMoveBlock(g.name, moves, g.invoices.length));
    if (g.summary.openCount) {
      // Yalnız ödenmemiş iade (eksi) kaldıysa borç değil, düşülecek iade
      throw new UserError(
        g.summary.open > 0
          ? `${g.name}: ${num(g.summary.openCount)} ödenmemiş faturası var (${money(g.summary.open)}). Borcu olan tedarikçi listeden kaldırılamaz; faturaları ödendi yapın ya da yanlışsa Faturalar'dan silin.`
          : `${g.name}: ${num(g.summary.openCount)} ödenmemiş iade faturası var (${money(Math.abs(g.summary.open))}). Düşüldüyse Ödendi yapın; yanlışsa Faturalar'dan silin.`,
      );
    }
    let id: number;
    if (g.card) {
      await db.update(s.suppliers).set({ hiddenOn: today, updatedAt: new Date() }).where(eq(s.suppliers.id, g.card.id));
      id = g.card.id;
    } else {
      // Kart yalnız görünen adla açılır: aynı anahtarlı yazılışlar ve vergi noyla birleşen öteki adlar (aynı küme)
      // faturalarıyla ona düşer. Anahtar görünen adın kendi anahtarı (grubun anahtarı başka bir ad olabilir)
      const [row] = await db
        .insert(s.suppliers)
        .values({ name: g.name, key: supplierMatchKey(g.name), aliases: [], hiddenOn: today })
        .returning({ id: s.suppliers.id });
      id = row.id;
    }
    await logActivity(me, "Tedarikçi listeden kaldırıldı", `${g.name} · ${num(g.invoices.length)} faturası Faturalar'da duruyor${hasEntries ? ` · ${num((cari?.debts.length ?? 0) + (cari?.payments.length ?? 0))} cari kaydı kartta` : ""}`);
    refresh();
    return { mode: "hidden" as const, cardId: id };
  });
}

/** Kartta adından başka bir bilgi var mı (yoksa listeye geri alınınca kart da silinir) */
const hasInfo = (r: typeof s.suppliers.$inferSelect) =>
  (r.aliases ?? []).length > 0 ||
  r.paidOnDelivery ||
  r.paymentTermDays !== null ||
  [r.legalName, r.taxNumber, r.taxOffice, r.iban, r.bankName, r.accountHolder, r.contactName, r.phone, r.email, r.address, r.paymentMethod, r.note].some(Boolean);

/**
 * Listeden kaldırılan tedarikçiyi listeye geri getirir. Kartta adından başka bilgi yoksa (kaldırırken yalnız adla
 * açılmış ya da hiç doldurulmamış) kart silinir: tedarikçi eskisi gibi faturalarından görünür, adı başka bir karta
 * diğer ad olarak verilebilir. Bilgisi ya da cari kaydı olan kartın yalnız işareti kalkar.
 */
export async function unhideSupplier(input: { cardId: number }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const id = zId.parse(input.cardId);
    const db = getDb();
    const [row] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, id)).limit(1);
    if (!row) throw new UserError("Tedarikçi bulunamadı; sayfayı yenileyin.");
    // Cari kaydı olan kart silinmez (K23): kayıtlar karta bağlı
    const [entry] = await db.select({ id: s.supplierEntries.id }).from(s.supplierEntries).where(eq(s.supplierEntries.supplierId, id)).limit(1);
    const drop = !hasInfo(row) && !entry;
    if (drop) await db.delete(s.suppliers).where(eq(s.suppliers.id, id));
    else await db.update(s.suppliers).set({ hiddenOn: null, updatedAt: new Date() }).where(eq(s.suppliers.id, id));
    await logActivity(me, "Tedarikçi listeye geri alındı", row.name);
    refresh();
    return { slug: drop ? await supplierSlugOfKey(row.key) : await supplierSlugOf(id) };
  });
}

/** Az önce silinen tedarikçinin kartını geri yazar (aynı adlar bu arada başka bir karta verildiyse yazılmaz) */
export async function restoreSupplier(snapshot: CardInput) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = cleanCard(snapshot);
    const db = getDb();
    const all = await db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
    const conflict = nameConflict({ id: null, name: data.name, aliases: data.aliases }, all);
    if (conflict) throw new UserError(`“${conflict.name}” bu arada “${conflict.owner}” tedarikçisine verildi; silinen tedarikçi geri alınamadı.`);
    const [row] = await db
      .insert(s.suppliers)
      .values({ ...data, key: supplierMatchKey(data.name) })
      .returning({ id: s.suppliers.id });
    await logActivity(me, "Silinen tedarikçi geri alındı", data.name);
    refresh();
    return { id: row.id, slug: await supplierSlugOf(row.id) };
  });
}

/**
 * "Geçmiş faturaları al": tedarikçinin Paraşüt'teki bütün gider faturaları, tarih sınırı olmadan (syncSupplierHistory).
 * Eşitlemenin bu faturalara verdiği ad (Paraşüt'teki kişi adı, ör. vergi nosuyla bulunan tam unvan) tedarikçinin
 * adlarından değilse kartın diğer adlarına eklenir: faturaları bu sayfada toplanır. O ad başka bir tedarikçide
 * kayıtlıysa eklenmez, söylenir. Kartsız tedarikçide ad eklenemez; aynı vergi noyla buraya gelmediyse söylenir.
 */
export async function importSupplierHistory(input: z.input<typeof targetSchema> & { confirmDevir?: boolean }) {
  return attempt(async () => {
    const me = await requireAdmin();
    if (!(await isParasutConfigured())) throw new UserError("Paraşüt bağlantısı kurulu değil.");
    const { g } = await findGroup(input);
    if (g.key === supplierMatchKey(PLACEHOLDER_SUPPLIER_NAME)) throw new UserError("Bunlar Paraşüt'te adı okunamayan faturalar; geçmişi tedarikçinin kendi sayfasından alın.");
    // Eski borç (devir) girilmiş kartta (K22): o günden eski faturalar gelirse aynı borç iki kez sayılır; önce sorulur
    if (g.card && !z.boolean().optional().parse(input.confirmDevir)) {
      const [devir] = await getDb()
        .select({ date: s.supplierEntries.date })
        .from(s.supplierEntries)
        .where(and(eq(s.supplierEntries.supplierId, g.card.id), eq(s.supplierEntries.kind, "borc"), eq(s.supplierEntries.costMode, "devir")))
        .orderBy(asc(s.supplierEntries.date))
        .limit(1);
      if (devir) return { needs: "devir" as const, date: devir.date, name: g.name };
    }
    const own = g.card ? [g.card.name, ...g.card.aliases] : g.names;
    const keys = new Set([g.key, ...own, ...g.names].map(supplierMatchKey));
    const r = await syncSupplierHistory({
      label: g.name,
      billIds: g.invoices.flatMap((i) => (i.externalId ? [i.externalId] : [])),
      // Kartta yoksa faturalardaki tek vergi no: kişi bununla da bulunur
      taxNumber: g.taxNumber,
      names: own,
      match: (name) => (keys.has(supplierMatchKey(name)) ? "same" : own.some((n) => sameSupplier(n, name)) ? "similar" : null),
    });
    if (!r.ok) throw new UserError(r.error);

    const fresh = r.names.filter((n) => !keys.has(supplierMatchKey(n)));
    const added: string[] = [];
    const elsewhere: string[] = [];
    if (fresh.length && g.card) {
      const db = getDb();
      const all = await db.select({ id: s.suppliers.id, name: s.suppliers.name, aliases: s.suppliers.aliases }).from(s.suppliers);
      for (const n of fresh) (nameConflict({ id: g.card.id, name: g.card.name, aliases: [n] }, all) ? elsewhere : added).push(n);
      if (added.length) {
        await db
          .update(s.suppliers)
          .set({ aliases: cleanAliases(g.card.name, [...g.card.aliases, ...added], null), updatedAt: new Date() })
          .where(eq(s.suppliers.id, g.card.id));
      }
    } else if (fresh.length) {
      // Kartsız tedarikçi: yeni adla gelen faturalar aynı vergi noyla zaten bu tedarikçide toplanmış olabilir; yalnız
      // başka bir tedarikçide görünenler söylenir
      const now = (await loadSupplierLedger()).groups.find((x) => !x.card && x.keys.includes(g.key));
      const here = new Set(now?.keys ?? []);
      elsewhere.push(...fresh.filter((n) => !here.has(supplierMatchKey(n))));
    }
    await logActivity(me, "Tedarikçinin geçmiş faturaları alındı", [r.summary, added.length ? `diğer adlara eklendi: ${added.join(", ")}` : null].filter(Boolean).join(" · "));
    refresh();
    return {
      needs: null,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      removed: r.removed,
      oldest: r.oldest,
      partial: r.partial,
      deferred: r.deferred,
      held: r.held,
      resumed: r.resumed,
      added,
      elsewhere,
    };
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
    if (!(await isParasutConfigured())) throw new UserError("Paraşüt bağlantısı kurulu değil; bilgileri faturadan bakıp elle girin.");
    const keys = new Set(z.array(z.string().max(300)).min(1).max(40).parse(names).map(supplierMatchKey));
    const rows = await getDb()
      .select({ id: s.invoices.id, supplier: s.invoices.supplier, date: s.invoices.date, invoiceNo: s.invoices.invoiceNo, eInvoiceId: s.invoices.eInvoiceId, externalId: s.invoices.externalId })
      .from(s.invoices)
      .where(or(isNotNull(s.invoices.eInvoiceId), isNotNull(s.invoices.externalId)))
      .orderBy(desc(s.invoices.date), desc(s.invoices.id));
    const mine = rows.filter((r) => keys.has(supplierMatchKey(r.supplier))).slice(0, INFO_TRIES);
    if (!mine.length) throw new UserError("Bu tedarikçinin Paraşüt'ten gelen faturası yok; bilgileri elle girin.");
    const client = new ParasutClient(await readParasutConfig());
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
          // İlişkinin kimliği yalnız include edilince gelir (docs/parasut-api-spec.md)
          const bill = await client.show(`purchase_bills/${encodeURIComponent(r.externalId)}`, { include: "supplier" });
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
        if (e instanceof ParasutError && (e.status === 0 || e.status === 429 || e.status >= 500)) unreachable = e.message;
        console.error("Faturadan cari bilgisi", r.id, e);
      }
      if (parts.length) break;
    }
    const info = mergeInfo(...parts);
    const found = INFO_FIELDS.filter((k) => info[k]);
    if (!found.length) throw new UserError(unreachable && !parts.length ? unreachable : "Faturada okunabilen tedarikçi bilgisi bulunamadı; bilgileri elle girin.");
    return { info, found, source };
  });
}
