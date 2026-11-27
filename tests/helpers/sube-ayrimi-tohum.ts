// Şube ayrımı doğrulamasının tohumu (tests/sube-ayrimi-db.test.ts; docs/SUBE.md › Şube ayrımı): şube sütunu olan her
// tabloda Marina'nın ve Tuzla'nın ayrı, tanınır kaydı. Tuzla'nın metinleri `TZ_MARK` taşır, tutarları 91.9xx,xx
// biçimindedir (`tzLeaks` ikisini de arar); Marina'nın tutarları küçük ve 919 içermez. İşletme geneli kalemler
// "Ortak" ile başlar. Başlangıç verisinin (scripts/seed.ts) üstüne yazılır: o veri Tuzla'nındır ya da şubesizdir.
//
// Ayrıca `deleteBranchRows`: bir şubenin bütün satırlarını (ve onlara bağlı satırları) siler. Doğrulama Marina'nın
// görünümünü önce tam veritabanında, sonra Tuzla'nın satırları silinmiş hâlde okur; iki okuma farklıysa Marina'nın
// ekranı Tuzla'nın verisinden etkileniyordur (sızıntı).

import { sql } from "drizzle-orm";

import { supplierMatchKey } from "../../src/app/panel/faturalar/rules";
import { addDays } from "../../src/lib/reminders";
import type { DB } from "../../src/server/db";
import * as s from "../../src/server/db/schema";

/** Tuzla'nın metin işareti */
export const TZ_MARK = "TZMARK";
/**
 * Tuzla'nın tutarlarının biçimi: 91.9xx (JSON'da 919xx, ekranda 91.9xx); öncesinde rakam ya da ondalık ayıracı olmaz
 * (uzun ondalıklı bir sayının ortasındaki "...919272..." sayılmaz), sonrasında rakam olmaz
 */
export const TZ_AMOUNT = /(?<![\d.,])91[.,]?9\d\d(?!\d)/;

/** Metinde ya da değerde Tuzla'nın işareti ya da tutarı var mı; varsa ilk eşleşmenin çevresi */
export function tzLeaks(v: unknown): string | null {
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));
  if (!text) return null;
  const i = text.indexOf(TZ_MARK);
  const m = TZ_AMOUNT.exec(text);
  const at = i >= 0 ? i : m ? m.index : -1;
  return at < 0 ? null : text.slice(Math.max(0, at - 80), at + 80);
}

/** Yalnız metin işareti (tutarı tasarımda firmanın olan yerler: ekstrenin satırı) */
export function tzTextLeak(v: unknown): string | null {
  const text = typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));
  const i = text ? text.indexOf(TZ_MARK) : -1;
  return i < 0 ? null : text.slice(Math.max(0, i - 80), i + 80);
}

export interface SubeTohum {
  /** Kullanıcılar: yönetici, muhasebeci, Marina'nın müdürü ve personeli, Tuzla'nın müdürü ve personeli */
  users: { admin: number; accountant: number; marinaManager: number; marinaStaff: number; tuzlaManager: number; tuzlaStaff: number };
  /** Dün, evvelsi gün; dünün ayı ve bir önceki ay */
  d1: string;
  d2: string;
  month: string;
  prevMonth: string;
  invoices: { marina: number; tuzla: number; shared: number };
  suppliers: { marina: number; tuzla: number };
}

const prevMonthOf = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** Başlangıç verisinin üstüne iki şubenin kayıtları (bugün `today`, iş günü) */
export async function seedSubeAyrimi(db: DB, today: string): Promise<SubeTohum> {
  const d1 = addDays(today, -1);
  const d2 = addDays(today, -2);
  const month = d1.slice(0, 7);
  const prevMonth = prevMonthOf(month);
  const in2 = addDays(today, 2);

  const user = async (name: string, email: string, role: "admin" | "accountant" | "manager" | "staff", branchId: string | null) =>
    (await db.insert(s.users).values({ name, email, role, branchId, passwordHash: "x" }).returning({ id: s.users.id }))[0].id;
  const users = {
    admin: await user("Ali Yönetici", "ali@ornek.com", "admin", null),
    accountant: await user("Mine Muhasebe", "mine@ornek.com", "accountant", null),
    marinaManager: await user("Mert Marina", "mert@ornek.com", "manager", "marina"),
    marinaStaff: await user("Ayşe Marina", "ayse@ornek.com", "staff", "marina"),
    tuzlaManager: await user(`${TZ_MARK} Müdür`, "tzmudur@ornek.com", "manager", "tuzla"),
    tuzlaStaff: await user(`${TZ_MARK} Can`, "tzcan@ornek.com", "staff", "tuzla"),
  };

  const [{ id: ing1 }] = await db.select({ id: s.ingredients.id }).from(s.ingredients).orderBy(s.ingredients.id).limit(1);
  const prods = await db.select({ id: s.products.id }).from(s.products).orderBy(s.products.id).limit(3);
  const [p1, p2] = [prods[1].id, prods[2].id];
  const [{ id: cat }] = await db.select({ id: s.expenseCategories.id }).from(s.expenseCategories).orderBy(s.expenseCategories.id).limit(1);
  const tpls = await db.select({ id: s.checklistTemplates.id, branchId: s.checklistTemplates.branchId, name: s.checklistTemplates.name }).from(s.checklistTemplates);
  const tplOf = (b: string) => tpls.find((t) => t.branchId === b)!;

  // Ay satırları ve ModPOS satış listesi (Tuzla'nın Ekim'i başlangıç verisinde)
  await db
    .insert(s.months)
    .values([
      { month, branchId: "marina", openDays: 20, posRevenue: 12_345, note: "Marina ay notu" },
      { month, branchId: "tuzla", openDays: 25, posRevenue: 91_911.11, note: `${TZ_MARK} ay notu` },
      { month: prevMonth, branchId: "marina", openDays: 18, posRevenue: 11_222 },
    ])
    .onConflictDoNothing();
  await db.insert(s.salesLines).values([
    { month, branchId: "marina", posName: "Marina Espresso", productId: p1, qty: 40, revenue: 5_400, sortOrder: 1 },
    { month, branchId: "tuzla", posName: `${TZ_MARK} Latte`, productId: p2, qty: 593, revenue: 91_912.12, sortOrder: 1 },
  ]);

  // Kasa raporları (iki gün), sayım, kasadan çıkan, zayi
  await db.insert(s.cashReports).values([
    { date: d1, branchId: "marina", zNo: "101", receipts: 41, zTotal: 2_100, cash: 900, card: 1_000, mealCard: 200, openingCash: 500, countedCash: 1_400, submittedByName: "Ayşe Marina", note: "Marina kasa notu" },
    { date: d2, branchId: "marina", zNo: "100", receipts: 38, zTotal: 2_200, cash: 1_000, card: 1_000, mealCard: 200, openingCash: 500, countedCash: 1_500, submittedByName: "Ayşe Marina" },
    { date: d1, branchId: "tuzla", zNo: "9191", receipts: 919, zTotal: 91_901.01, cash: 91_921.01, card: 91_931.01, mealCard: 91_941.01, openingCash: 91_951.01, countedCash: 91_961.01, submittedByName: `${TZ_MARK} Can`, note: `${TZ_MARK} kasa notu` },
    { date: d2, branchId: "tuzla", zNo: "9190", receipts: 918, zTotal: 91_902.02, cash: 91_922.02, card: 91_932.02, mealCard: 91_942.02, openingCash: 91_952.02, countedCash: 91_962.02, submittedByName: `${TZ_MARK} Can` },
  ]);
  await db.insert(s.cashCounts).values([
    { date: d1, branchId: "marina", amount: 1_111, userName: "Ayşe Marina", reason: "Marina sayım" },
    { date: d1, branchId: "tuzla", amount: 91_910.1, userName: `${TZ_MARK} Can`, reason: `${TZ_MARK} sayım` },
  ]);
  await db.insert(s.cashOuts).values([
    // Kasadan faturalı alım (faturası beklenir: Genel bakış, Faturalar, sabah e-postası)
    { date: d1, branchId: "marina", amount: 450, kind: "harcama", store: "Marina Market", description: "Marina süt", docType: "fatura", receiptNo: "M-1", createdByName: "Ayşe Marina" },
    { date: d1, branchId: "tuzla", amount: 91_902.22, kind: "harcama", store: `${TZ_MARK} Market`, description: `${TZ_MARK} süt`, docType: "fatura", receiptNo: "T-1", createdByName: `${TZ_MARK} Can` },
    // Teslim: Tuzla'nın ilk teslimi bir önceki ayda (Teslim defterinin ay seçicisi şubenin ilk gününden başlar)
    { date: d2, branchId: "marina", amount: 600, kind: "teslim", store: "Banka", createdByName: "Ayşe Marina" },
    { date: `${prevMonth}-03`, branchId: "tuzla", amount: 91_903.33, kind: "teslim", store: `${TZ_MARK} Banka`, createdByName: `${TZ_MARK} Can` },
  ]);
  await db.insert(s.wasteEntries).values([
    { date: d1, branchId: "marina", kind: "zayi", productId: p1, name: "Marina Espresso", qty: 3, unit: "adet", reason: "Marina döküldü", createdByName: "Ayşe Marina" },
    { date: d1, branchId: "tuzla", kind: "zayi", productId: p2, name: `${TZ_MARK} Latte`, qty: 9, unit: "adet", reason: `${TZ_MARK} döküldü`, createdByName: `${TZ_MARK} Can` },
  ]);

  // Sayım (önceki ay), ek kalem
  await db.insert(s.stockCounts).values([
    { month: prevMonth, branchId: "marina", ingredientId: ing1, qty: 1_200, countedBy: "Ayşe Marina" },
    { month: prevMonth, branchId: "tuzla", ingredientId: ing1, qty: 91_918, countedBy: `${TZ_MARK} Can` },
  ]);
  await db.insert(s.stockExtras).values([
    { month: prevMonth, branchId: "marina", name: "Marina ek kalem", unit: "adet", qty: 2, unitPrice: 12 },
    { month: prevMonth, branchId: "tuzla", name: `${TZ_MARK} ek kalem`, unit: "adet", qty: 1, unitPrice: 91_915.15 },
  ]);

  // Tedarikçiler ve faturalar: Marina'nın, Tuzla'nın, işletme geneli (başlangıç verisinin 81 faturası şubesiz)
  const [supM] = await db.insert(s.suppliers).values({ name: "Marina Süt AŞ", key: supplierMatchKey("Marina Süt AŞ") }).returning({ id: s.suppliers.id });
  const [supT] = await db.insert(s.suppliers).values({ name: `${TZ_MARK} Gıda`, key: supplierMatchKey(`${TZ_MARK} Gıda`) }).returning({ id: s.suppliers.id });
  const invoice = async (supplier: string, amount: number, vat: number, branchId: string | null, companyWide: boolean, needsReview = false) =>
    (
      await db
        .insert(s.invoices)
        // Paraşüt'ten gelmiş gibi (hesap Tuzla'nın: Marina'nın ayrı hesabı yok, "hesap geneli"): sabah e-postasının yeni faturaları
        .values({ date: d1, supplier, category: "Hammadde & İçecek", amount, vat, payable: amount + vat, unpaid: true, dueDate: in2, branchId, companyWide, needsReview, description: `${supplier} faturası`, source: "parasut", origin: "parasut", parasutAccount: "tuzla", externalId: `dogrula-${supplier}` })
        .returning({ id: s.invoices.id })
    )[0].id;
  const invoices = {
    marina: await invoice("Marina Süt AŞ", 1_300, 130, "marina", false, true),
    tuzla: await invoice(`${TZ_MARK} Gıda`, 91_990, 0, "tuzla", false, true),
    shared: await invoice("Ortak Muhasebe", 2_000, 400, null, true),
  };
  // Faturaların Paraşüt kalemleri: hammaddeye bağlanmamış ürünler (Paraşüt bekleyenleri, zil, Bugün)
  // ve hammaddeye bağlı süt (FIFO havuzu, Tutarlılık'ın alınan miktarı)
  await db.insert(s.parasutProductLinks).values({ productKey: "dogrula:sut", productName: "Süt 1L", ingredientId: ing1, factor: 1000 });
  await db.insert(s.parasutBillLines).values([
    { invoiceId: invoices.marina, externalId: `dogrula-m-${invoices.marina}`, productKey: "dogrula:marina-urun", productName: "Marina ürünü", quantity: 1, netTotal: 300 },
    { invoiceId: invoices.tuzla, externalId: `dogrula-t-${invoices.tuzla}`, productKey: "dogrula:tzmark-urun", productName: `${TZ_MARK} ürünü`, quantity: 1, netTotal: 91_990 },
    { invoiceId: invoices.marina, externalId: `dogrula-ms-${invoices.marina}`, productKey: "dogrula:sut", productName: "Süt 1L", quantity: 25, unitPrice: 40, netTotal: 1_000 },
    { invoiceId: invoices.tuzla, externalId: `dogrula-ts-${invoices.tuzla}`, productKey: "dogrula:sut", productName: "Süt 1L", quantity: 919, unitPrice: 100, netTotal: 91_900 },
  ]);
  // Son ödenenler (Ödemeler): iki şubenin ödenmiş birer faturası
  const paidInv = async (supplier: string, amount: number, branchId: string) =>
    (
      await db
        .insert(s.invoices)
        .values({ date: d2, supplier, category: "Hammadde & İçecek", amount, payable: amount, vat: 0, unpaid: false, paidAt: d1, branchId, description: `${supplier} ödendi` })
        .returning({ id: s.invoices.id })
    )[0].id;
  const paidM = await paidInv("Marina Kahve", 700, "marina");
  const paidT = await paidInv(`${TZ_MARK} Kahve`, 91_926.26, "tuzla");
  const at = new Date().toISOString();
  await db
    .insert(s.integrationState)
    .values({
      key: "payments.recent",
      value: [
        { kind: "invoice", id: paidM, title: "Marina Kahve", amount: 700, dueDate: d2, at },
        { kind: "invoice", id: paidT, title: `${TZ_MARK} Kahve`, amount: 91_926.26, dueDate: d2, at },
      ],
    })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value: sql`excluded.value` } });

  const pay = async (supplierId: number, amount: number, note: string, invoiceId: number) => {
    const [p] = await db
      .insert(s.supplierEntries)
      .values({ supplierId, kind: "odeme", date: d1, amount, method: "havale", note, createdByName: "Ali Yönetici" })
      .returning({ id: s.supplierEntries.id });
    await db.insert(s.supplierAllocations).values({ paymentId: p.id, invoiceId, amount, createdByName: "Ali Yönetici" });
  };
  await pay(supM.id, 600, "Marina ödemesi", invoices.marina);
  await pay(supT.id, 91_916.16, `${TZ_MARK} ödemesi`, invoices.tuzla);

  // Harcamalar, sabit giderler, yatırımlar (işletme geneli olanlar "Ortak")
  await db.insert(s.expenseEntries).values([
    { date: d1, categoryId: cat, description: "Marina tamir", amount: 640, paymentMethod: "kart", branchId: "marina" },
    { date: d1, categoryId: cat, description: `${TZ_MARK} tamir`, amount: 91_904.04, paymentMethod: "kart", branchId: "tuzla" },
    { date: d1, categoryId: cat, description: "Ortak internet", amount: 700, paymentMethod: "kart", branchId: null },
  ]);
  await db.insert(s.fixedExpenses).values([
    { name: "Marina kira", section: "kira", amount: 15_000, period: "aylik", branchId: "marina" },
    { name: `${TZ_MARK} kira`, section: "kira", amount: 91_905.05, period: "aylik", branchId: "tuzla" },
  ]);
  await db.insert(s.investments).values([
    { name: "Marina dolap", amount: 3_000, date: d1, branchId: "marina" },
    { name: `${TZ_MARK} makine`, amount: 91_906.06, date: d1, branchId: "tuzla" },
  ]);

  // Personel ve avans
  const [stM] = await db.insert(s.staff).values({ name: "Arda Marina", netSalary: 31_000, branchId: "marina", startMonth: "2026-01" }).returning({ id: s.staff.id });
  const [stT] = await db.insert(s.staff).values({ name: `${TZ_MARK} Barista`, netSalary: 91_907.07, branchId: "tuzla", startMonth: "2026-01" }).returning({ id: s.staff.id });
  await db.insert(s.staffAdvances).values([
    { staffId: stM.id, date: d1, kind: "avans", amount: 500, note: "Marina avans", createdByName: "Ali Yönetici" },
    { staffId: stT.id, date: d1, kind: "avans", amount: 91_908.08, note: `${TZ_MARK} avans`, createdByName: "Ali Yönetici" },
  ]);

  // Ödemeler (hatırlatıcılar)
  await db.insert(s.reminders).values([
    { title: "Marina Elektrik", amount: 1_800, dueDate: in2, anchorDate: in2, branchId: "marina", kind: "fatura", remindDaysBefore: 3 },
    { title: `${TZ_MARK} Elektrik`, amount: 91_909.09, dueDate: in2, anchorDate: in2, branchId: "tuzla", kind: "fatura", remindDaysBefore: 3 },
    { title: "Ortak Muhasebe ücreti", amount: 2_500, dueDate: in2, anchorDate: in2, branchId: null, kind: "odeme", remindDaysBefore: 3 },
  ]);

  // AsilPOS günleri (Marina'nın kasası; Tuzla'nın gün sonu da yazılı: çok şube) ve ürün satışları
  const z = (zTotal: number, zNo: number) => ({ zNo, receipts: 40, zTotal, cash: zTotal / 2, card: zTotal / 2, mealCard: 0, online: 0, other: 0, offRevenue: 0, discounts: 0, openingCash: 500, cashOut: 0, countedCash: null, handedOver: 0, cashDiff: null });
  await db.insert(s.posDayReports).values([
    { date: d1, branchId: "marina", z: z(2_100, 101), payments: [], ikram: [], source: "asilpos" },
    { date: d1, branchId: "tuzla", z: z(91_913.13, 9191), payments: [], ikram: [], source: "asilpos" },
  ] as never);
  await db.insert(s.posDailySales).values([
    { date: d1, branchId: "marina", posName: "Marina Espresso", productId: p1, qty: 10, revenue: 1_350 },
    { date: d1, branchId: "tuzla", posName: `${TZ_MARK} Mocha`, productId: p2, qty: 70, revenue: 91_914.14 },
  ]);
  await db.insert(s.asilposDayEnds).values([
    { date: d1, branchId: "marina", missing: ["photo"] },
    { date: d1, branchId: "tuzla", missing: ["photo"] },
  ] as never);
  await db.insert(s.posMarks).values([
    { productId: p1, price: 140, stalePrice: 135, staleSince: new Date(`${d1}T09:00:00Z`), markedByName: "Ayşe Marina", branchId: "marina" },
    { productId: p2, price: 91_922, stalePrice: 155, staleSince: new Date(`${d1}T09:00:00Z`), markedByName: `${TZ_MARK} Can`, branchId: "tuzla" },
  ]);

  // Vardiya (bugün)
  await db.insert(s.shifts).values([
    { branchId: "marina", date: today, personRef: `u:${users.marinaStaff}`, userId: users.marinaStaff, personName: "Ayşe Marina", kind: "work", startMin: 570, endMin: 1110 },
    { branchId: "tuzla", date: today, personRef: `u:${users.tuzlaStaff}`, userId: users.tuzlaStaff, personName: `${TZ_MARK} Can`, kind: "work", startMin: 600, endMin: 1140 },
    // Hesabı olmadan adıyla yazılmış kişiler
    { branchId: "marina", date: today, personRef: "n:marina-yardimci", personName: "Marina Yardımcı", kind: "work", startMin: 600, endMin: 900 },
    { branchId: "tuzla", date: today, personRef: "n:tzmark-yardimci", personName: `${TZ_MARK} Yardımcı`, kind: "work", startMin: 600, endMin: 900 },
  ]);

  // Personel istekleri (geç kasa raporu; şube yükte) ve reçete önerileri
  const late = (branchId: string, zTotal: number, note: string) => ({
    date: addDays(today, -3),
    zNo: "77",
    handedTo: null,
    photos: [],
    cashDiff: 0,
    branchId,
    receipts: 10,
    zTotal,
    cash: zTotal,
    card: 0,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 0,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: zTotal,
    handedOver: 0,
    bankPos: null,
    offRevenue: null,
    discounts: null,
    note,
  });
  const lateWaste = (branchId: string, name: string, productId: number) => ({ date: d2, kind: "zayi", productId, ingredientId: null, name, unit: "adet", factor: 1, qty: 4, reason: name, note: null, branchId });
  const d3 = addDays(today, -3);
  await db.insert(s.staffRequests).values([
    { kind: "kasa-gec", subject: `gun:${d3}:marina`, day: d3, title: "Marina geç rapor", payload: late("marina", 1_700, "Marina geç not"), requestedBy: users.marinaStaff, requestedByName: "Ayşe Marina" },
    { kind: "kasa-gec", subject: `gun:${d3}:tuzla`, day: d3, title: `${TZ_MARK} geç rapor`, payload: late("tuzla", 91_924.24, `${TZ_MARK} geç not`), requestedBy: users.tuzlaStaff, requestedByName: `${TZ_MARK} Can` },
    { kind: "zayi-gec", subject: "zayi-yeni:dogrula-m", day: d2, title: "Marina geç zayi", payload: lateWaste("marina", "Marina geç zayi", p1), requestedBy: users.marinaStaff, requestedByName: "Ayşe Marina" },
    { kind: "zayi-gec", subject: "zayi-yeni:dogrula-t", day: d2, title: `${TZ_MARK} geç zayi`, payload: lateWaste("tuzla", `${TZ_MARK} geç zayi`, p2), requestedBy: users.tuzlaStaff, requestedByName: `${TZ_MARK} Can` },
    // Karara bağlanmış (Onaylar › Son kararlar)
    {
      kind: "kasa-gec",
      subject: `gun:${addDays(today, -5)}:marina`,
      day: addDays(today, -5),
      title: "Marina eski geç rapor",
      payload: late("marina", 1_600, "Marina eski"),
      status: "rejected",
      requestedBy: users.marinaStaff,
      requestedByName: "Ayşe Marina",
      reviewedByName: "Ali Yönetici",
      reviewedAt: new Date(),
    },
    {
      kind: "kasa-gec",
      subject: `gun:${addDays(today, -5)}:tuzla`,
      day: addDays(today, -5),
      title: `${TZ_MARK} eski geç rapor`,
      payload: late("tuzla", 91_925.25, `${TZ_MARK} eski`),
      status: "rejected",
      requestedBy: users.tuzlaStaff,
      requestedByName: `${TZ_MARK} Can`,
      reviewedByName: "Ali Yönetici",
      reviewedAt: new Date(),
    },
  ] as never);
  const [{ id: catId }] = await db.select({ id: s.categories.id }).from(s.categories).limit(1);
  const proposal = (by: number, name: string) =>
    db.insert(s.recipeChangeRequests).values({
      kind: "new",
      proposed: { name: `${name} Latte`, size: "M", categoryId: catId },
      requestedBy: by,
      requestedByName: name,
      before: { note: null, items: [] },
      after: { note: null, items: [] },
    });
  await proposal(users.marinaStaff, "Ayşe Marina");
  await proposal(users.tuzlaStaff, `${TZ_MARK} Can`);

  // Kontrol listesi kayıtları, işlem geçmişi, gönderim günlüğü, özel günler
  await db.insert(s.checklistRuns).values([
    { templateId: tplOf("marina").id, date: d1, branchId: "marina", name: tplOf("marina").name, items: [], completedByName: "Ayşe Marina", completedAt: new Date(`${d1}T08:00:00Z`) },
    { templateId: tplOf("tuzla").id, date: d1, branchId: "tuzla", name: tplOf("tuzla").name, items: [], completedByName: `${TZ_MARK} Can`, completedAt: new Date(`${d1}T08:00:00Z`) },
  ]);
  await db.insert(s.activityLog).values([
    { action: "kasa.rapor", detail: "Marina işlemi", userName: "Ayşe Marina", branchId: "marina" },
    { action: "kasa.rapor", detail: `${TZ_MARK} işlemi`, userName: `${TZ_MARK} Can`, branchId: "tuzla" },
  ]);
  await db.insert(s.notificationLog).values([
    { key: `gun-sonu:marina:${d1}`, subject: "Marina gün sonu", recipients: "ayse@ornek.com", ok: true, branchId: "marina" },
    { key: `gun-sonu:tuzla:${d1}`, subject: `${TZ_MARK} gün sonu`, recipients: "tzcan@ornek.com", ok: true, branchId: "tuzla" },
  ]);
  await db.insert(s.notificationRecipients).values([
    { email: "marina-alici@ornek.com", name: "Marina alıcısı", branchIds: ["marina"] },
    { email: "tzmark-alici@ornek.com", name: `${TZ_MARK} alıcısı`, branchIds: ["tuzla"] },
  ]);
  await db.insert(s.specialDays).values([
    { dateFrom: in2, dateTo: in2, kind: "kampanya", title: "Marina kampanya", effect: 0.1, createdByName: "Ali Yönetici", branchId: "marina" },
    { dateFrom: in2, dateTo: in2, kind: "kampanya", title: `${TZ_MARK} kampanya`, effect: 0.2, createdByName: "Ali Yönetici", branchId: "tuzla" },
  ]);

  // Fiyat önerisi ve demirbaş (faturanın şubesiyle)
  const [ing2] = await db.select({ id: s.ingredients.id }).from(s.ingredients).orderBy(s.ingredients.id).offset(1).limit(1);
  const hold = (ingredientId: number, invoiceId: number, productName: string, price: number) =>
    db.insert(s.ingredientPriceHolds).values({
      ingredientId,
      invoiceId,
      productKey: `dogrula:oneri-${invoiceId}`,
      productName,
      factor: 1000,
      quantity: 1,
      netTotal: price,
      invoiceDate: d1,
      supplier: productName,
      packagePrice: price,
      packageSize: 1000,
      prevPackagePrice: 40,
      prevPackageSize: 1000,
      status: "pending",
    });
  await hold(ing1, invoices.marina, "Marina Süt", 90);
  await hold(ing2.id, invoices.tuzla, `${TZ_MARK} Süt`, 91_923.23);
  await db.insert(s.taxAssets).values([
    { name: "Marina dolap demirbaş", invoiceId: invoices.marina, acquiredOn: d1, cost: 1_300, lifeYears: 5 },
    { name: `${TZ_MARK} makine demirbaş`, invoiceId: invoices.tuzla, acquiredOn: d1, cost: 91_990, lifeYears: 5 },
  ]);

  // Banka ekstresi (firmanın): POS hakedişi ve iki kart harcaması
  const [st] = await db
    .insert(s.reconStatements)
    .values({ kind: "banka", account: "Garanti TL", periodFrom: addDays(today, -20), periodTo: today, lineCount: 3, uploadedOn: today, expiresOn: addDays(today, 90), createdByName: "Ali Yönetici" })
    .returning({ id: s.reconStatements.id });
  await db.insert(s.reconLines).values([
    { statementId: st.id, scope: "banka:Garanti TL", fingerprint: "pos-1", rowNo: 1, date: d1, description: "POS HAKEDIS UYE ISYERI", amount: 950 },
    { statementId: st.id, scope: "banka:Garanti TL", fingerprint: "kart-m", rowNo: 2, date: d1, description: "KART HARCAMA MARINA", amount: -640 },
    { statementId: st.id, scope: "banka:Garanti TL", fingerprint: "kart-t", rowNo: 3, date: d1, description: "KART HARCAMA TZ", amount: -91_904.04 },
  ]);

  return { users, d1, d2, month, prevMonth, invoices, suppliers: { marina: supM.id, tuzla: supT.id } };
}

/**
 * Şubenin bütün satırlarını siler: şube sütunu olan her tablo (şube kütüğü ve şube ayarları hariç; şube açık kalır),
 * yükündeki şubeyle personel istekleri, şubenin kullanıcılarının reçete önerileri; bağlı satırlar (allocations, avans,
 * fotoğraf …) yabancı anahtarı izleyerek önce silinir. Şubesi boş (işletme geneli) satırlara dokunmaz
 */
export async function deleteBranchRows(db: DB, branchId: string): Promise<void> {
  const tables = (await db.execute(
    sql`select c.table_name as t from information_schema.columns c join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema
        where c.table_schema = 'public' and c.column_name = 'branch_id' and x.table_type = 'BASE TABLE' and c.table_name not in ('branches', 'branch_settings', 'users')`,
  )) as unknown as { t: string }[];
  await db.execute(sql`delete from staff_requests where payload->>'branchId' = ${branchId} or subject like ${`%:${branchId}`}`);
  // Şubenin faturalarına sayılan ödemeler (cari kaydının şubesi yok; ödemenin tamamı o faturalara sayıldıysa şubenindir)
  await db.execute(
    sql`delete from supplier_entries e where e.kind = 'odeme' and exists (select 1 from supplier_allocations a join invoices i on i.id = a.invoice_id where a.payment_id = e.id and i.branch_id = ${branchId})
        and not exists (select 1 from supplier_allocations a left join invoices i on i.id = a.invoice_id where a.payment_id = e.id and (i.branch_id is distinct from ${branchId}))`,
  );
  const users = (await db.execute(sql`select id from users where branch_id = ${branchId}`)) as unknown as { id: number }[];
  if (users.length) {
    const ids = users.map((u) => u.id);
    await db.execute(sql`delete from recipe_change_requests where requested_by in ${sql.raw(`(${ids.join(",")})`)}`);
  }
  // Yabancı anahtarla bağlı satırlar: ON DELETE kuralı olmayanlar elle, en çok birkaç tur
  const deleteWhere = async (table: string, where: string, depth = 0): Promise<void> => {
    if (depth > 6) throw new Error(`silme zinciri çok derin: ${table}`);
    const refs = (await db.execute(
      sql`select cl.relname as child, a.attname as col, pa.attname as parent_col, con.confdeltype as rule
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          join pg_class p on p.oid = con.confrelid
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
          join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
          where con.contype = 'f' and p.relname = ${table} and array_length(con.conkey, 1) = 1`,
    )) as unknown as { child: string; col: string; parent_col: string; rule: string }[];
    for (const r of refs) {
      // a: no action, r: restrict → önce çocuklar; c: cascade, n: set null, d: set default → veritabanı halleder
      if (r.rule !== "a" && r.rule !== "r") continue;
      if (r.child === table) continue;
      await deleteWhere(r.child, `"${r.col}" in (select "${r.parent_col}" from "${table}" where ${where})`, depth + 1);
    }
    await db.execute(sql.raw(`delete from "${table}" where ${where}`));
  };
  // Birden çok kolonlu anahtarlar (sales_lines → months) için: önce çocuk tablolar
  const order = (t: string) => (t === "months" ? 1 : 0);
  for (const { t } of [...tables].sort((a, b) => order(a.t) - order(b.t))) {
    await deleteWhere(t, `branch_id = '${branchId.replace(/'/g, "''")}'`);
  }
  await db.execute(sql`delete from notification_recipients where branch_ids = array[${branchId}]::text[]`);
  if (users.length) await db.execute(sql`update users set active = false where branch_id = ${branchId}`);
}
