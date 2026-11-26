// Kalem kalem sayma ve faturanın şubesi geçmiş ayların rakamlarını nasıl değiştirir (docs/PARASUT.md › 5f, docs/SUBE.md ›
// Faturanın şubesi): aynı veride eski kural (fatura bütün, kategorisine göre; şube seçiliyken şubesi boş fatura işletme
// geneli) ile yeni kural ay ay karşılaştırılır, değişen her rakam yazılır. Eski kural src/lib/invoice-split-compare.ts.
//
// Kullanım (yalnız bu bilgisayardaki veritabanı; canlıya bağlanmaz):
//   DATABASE_URL=postgres://localhost/<yerel> npx tsx scripts/fatura-kalem-karsilastir.ts [--ornek] [--json <dosya>]
//   --ornek  önce örnek veri ekler: Paraşüt kalemleri ve hammadde bağları (karışık fatura, mal faturasında Sarf /
//            Demirbaş denmiş kalem, kuralı açık tedarikçi), "kalsın" denmiş stoğa giren fatura ve şube seçimleri. Boş
//            bir veritabanında önce: npm run db:migrate && npm run db:seed. Gerçek verinin yedeği de geri yüklenebilir
//            (npm run db:restore), o zaman --ornek vermeyin.
//   --json   değişiklik listesini dosyaya da yazar.
//
// Eski kuralda faturanın eski şubesi: yalnız ayrı Paraşüt hesabından gelen faturada dolu (`parasut_account` varsayılan
// hesap değil); öbürleri şubesi boş, işletme geneli (25 Kasım 2026'ya kadarki main).

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { isLocalDbUrl } from "./test-db";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const SAMPLE = args.includes("--ornek");
const jsonAt = args.indexOf("--json");
const JSON_FILE = jsonAt >= 0 ? args[jsonAt + 1] : null;
const MARKER = "karsilastirma-ornek";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url || !isLocalDbUrl(url)) {
    console.error("DATABASE_URL bu bilgisayardaki bir Postgres olmalı (localhost). Gerçek veriyi denemek için yedeği yerel bir veritabanına geri yükleyin.");
    return 2;
  }
  // Betik Next dışında koşar: sunucu modüllerinin yalnız-sunucu ve önbellek bağımlılıkları boş
  const require = createRequire(import.meta.url);
  const stub = (id: string, exports: unknown) => {
    const p = require.resolve(id);
    require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
  };
  stub("server-only", {});
  stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });

  const { getDb, schema: s } = await import("../src/server/db");
  const { loadModel } = await import("../src/server/data/dataset");
  const { createModel } = await import("../src/lib/calc/engine");
  const { monthNumbers, numberChanges, oldRuleDataset, taxNumbers } = await import("../src/lib/invoice-split-compare");
  const { DEFAULT_PARASUT_ACCOUNT } = await import("../src/lib/parasut/accounts");
  const { todayTR } = await import("../src/lib/reminders");
  const db = getDb();
  try {
    if (SAMPLE) await addSample(db, s);

    // Eski şube: yalnız ayrı Paraşüt hesabından gelen faturada (main'in eşitlemesi yalnız onlara yazardı)
    const separate = await db
      .select({ id: s.invoices.id, branchId: s.invoices.branchId })
      .from(s.invoices)
      .where(and(isNotNull(s.invoices.parasutAccount), ne(s.invoices.parasutAccount, DEFAULT_PARASUT_ACCOUNT), isNotNull(s.invoices.branchId)));
    const oldBranch = new Map(separate.map((r) => [r.id, r.branchId]));
    const branches = await db.select({ id: s.branches.id, name: s.branches.name }).from(s.branches).where(eq(s.branches.active, true));

    const whole = await loadModel({ scope: "hepsi" });
    const all = whole.ds.invoices;
    const months = [...new Set(all.map((i) => i.date.slice(0, 7)))].sort();
    const labels = new Map<string, string>();
    const changes = [];
    const today = todayTR();
    for (const scope of ["hepsi", ...branches.map((b) => b.id)]) {
      const after = scope === "hepsi" ? whole : await loadModel({ scope });
      const before = createModel(oldRuleDataset(after.ds, { all, scope, oldBranchOf: (i) => oldBranch.get(i.id) ?? null }));
      for (const m of months) changes.push(...numberChanges(scope, m, monthNumbers(before, m, labels), monthNumbers(after, m, labels), labels));
      if (scope !== "hepsi") continue;
      // Vergi firma genelidir: yalnız Tümü'yle
      const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
      const tb = taxNumbers(before, years, today, undefined, labels);
      const ta = taxNumbers(after, years, today, undefined, labels);
      for (const m of months) changes.push(...numberChanges("hepsi", m, tb.get(m) ?? new Map(), ta.get(m) ?? new Map(), labels));
    }

    const name = (scope: string) => (scope === "hepsi" ? "Tümü" : (branches.find((b) => b.id === scope)?.name ?? scope));
    const tl = (x: number) => x.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!changes.length) console.log("Değişen rakam yok: hiçbir faturada kalem kalem ayrım ya da şube seçimi rakam değiştirmiyor.");
    let last = "";
    for (const c of changes) {
      const head = `${name(c.scope)} · ${c.month}`;
      if (head !== last) console.log(`\n${head}`);
      last = head;
      console.log(`  ${c.label.padEnd(44)} ${tl(c.before).padStart(14)} → ${tl(c.after).padStart(14)}  (${c.delta > 0 ? "+" : ""}${tl(c.delta)})`);
    }
    console.log(`\n${changes.length} rakam değişti.`);
    if (JSON_FILE) writeFileSync(JSON_FILE, JSON.stringify(changes.map((c) => ({ ...c, scope: name(c.scope) })), null, 2));
    return 0;
  } finally {
    await db.$client.end();
  }
}

/**
 * Örnek veri (yalnız yerel veritabanı; başlangıç verisinin ayları): bir kez eklenir (`MARKER` notlu faturalar varsa
 * eklenmez). Tutarlar KDV hariç
 */
async function addSample(db: import("../src/server/db").DB, s: typeof import("../src/server/db/schema")) {
  const { supplierMatchKey } = await import("../src/app/panel/faturalar/rules");
  const { PRODUCT_IGNORE_KEY, SUPPLIER_IGNORE_KEY } = await import("../src/server/parasut/keys");
  const { STOCK_ONLY_ACCEPTED_KEY } = await import("../src/server/data/stock-only-invoices");
  const done = await db.select({ id: s.invoices.id }).from(s.invoices).where(eq(s.invoices.note, MARKER)).limit(1);
  if (done.length) {
    console.log("Örnek veri zaten var.");
    return;
  }
  const ing = async (name: string) => {
    const [row] = await db.select({ id: s.ingredients.id }).from(s.ingredients).where(eq(s.ingredients.name, name)).limit(1);
    if (row) return row.id;
    const [created] = await db.insert(s.ingredients).values({ name, category: "Örnek", unit: "adet" }).returning({ id: s.ingredients.id });
    return created.id;
  };
  const links = [
    { productKey: "ornek:cay", productName: "ÇAY 1 KG", ingredientId: await ing("Çay"), factor: 1000 },
    { productKey: "ornek:sut", productName: "SÜT 1 LT", ingredientId: await ing("Süt %2,5"), factor: 1000 },
    { productKey: "ornek:soda", productName: "SODA 24'LÜ", ingredientId: await ing("Soda (Uludağ 25 cl)"), factor: 24 },
  ];
  await db.insert(s.parasutProductLinks).values(links).onConflictDoNothing();
  let n = 0;
  const bill = async (
    o: { date: string; supplier: string; category: string; amount: number; discount?: number; branchId?: string | null; companyWide?: boolean },
    lines: { key: string; name: string; net: number }[],
  ) => {
    const discount = o.discount ?? 0;
    const [inv] = await db
      .insert(s.invoices)
      .values({
        date: o.date,
        supplier: o.supplier,
        category: o.category,
        amount: o.amount,
        discount,
        payable: Math.round((o.amount - discount) * 1.2 * 100) / 100,
        vat: Math.round((o.amount - discount) * 0.2 * 100) / 100,
        note: MARKER,
        source: "parasut",
        origin: "parasut",
        branchId: o.branchId ?? null,
        companyWide: o.companyWide ?? false,
      })
      .returning({ id: s.invoices.id });
    await db.insert(s.parasutBillLines).values(
      lines.map((l) => ({ invoiceId: inv.id, externalId: `${MARKER}-${++n}`, productKey: l.key, productName: l.name, quantity: 1, unitPrice: l.net, netTotal: l.net })),
    );
    return inv.id;
  };
  // 1. Karışık fatura (Diğer): çay bağlı → mal alışı; çöp torbası "Sarf" → Temizlik & Sarf; kâğıt nedensiz → Diğer.
  //    Fatura altı 100 ₺ iskonto kalemlere oranla dağılır. Şubesi Marina
  await bill({ date: "2026-09-12", supplier: "Avansas", category: "Diğer", amount: 1000, discount: 100, branchId: "marina" }, [
    { key: "ornek:cay", name: "ÇAY 1 KG", net: 400 },
    { key: "ornek:krp", name: "KRP END KONTY ÇÖP TORBASI", net: 350 },
    { key: "ornek:a4", name: "A4 KAĞIT", net: 250 },
  ]);
  // 2. Mal faturası (Hammadde & İçecek): süt bağlı; ısıtıcı "Demirbaş", deterjan "Sarf". Şubesi Tuzla
  await bill({ date: "2026-09-20", supplier: "Metro", category: "Hammadde & İçecek", amount: 12_000, branchId: "tuzla" }, [
    { key: "ornek:sut", name: "SÜT 1 LT", net: 1_500 },
    { key: "ornek:isitici", name: "TÜPLÜ ISITICI", net: 10_000 },
    { key: "ornek:deterjan", name: "BULAŞIK DETERJANI", net: 500 },
  ]);
  // 3. Kuralı açık tedarikçi (hep hammadde değil · Sarf), Temizlik & Sarf: bağlı soda kuraldan etkilenmez → mal alışı.
  //    İşletme geneli
  await bill({ date: "2026-10-08", supplier: "Temizlik Dünyası", category: "Temizlik & Sarf", amount: 800, companyWide: true }, [
    { key: "ornek:camasir", name: "ÇAMAŞIR SUYU", net: 300 },
    { key: "ornek:soda", name: "SODA 24'LÜ", net: 500 },
  ]);
  // 4. Bütün kalemleri bağlı mal faturası: değişmez. Şubesi seçilmemiş
  await bill({ date: "2026-10-15", supplier: "Avansas", category: "Hammadde & İçecek", amount: 600 }, [{ key: "ornek:cay", name: "ÇAY 1 KG", net: 600 }]);
  // 5. "Kategorisi doğru, kalsın" denmiş stoğa giren fatura (Hizmet, süt kalemi): eskiden süt mal alışı sayılmıyordu
  const kept = await bill({ date: "2026-08-22", supplier: "Migros", category: "Hizmet", amount: 300 }, [
    { key: "ornek:sut", name: "SÜT 1 LT", net: 200 },
    { key: "ornek:servis", name: "KARGO", net: 100 },
  ]);
  // 6. Temizlik & Sarf faturası, şubesi Marina (bağlı harcama kategorisi şubenin giderine)
  await bill({ date: "2026-10-20", supplier: "Temizlik Dünyası", category: "Temizlik & Sarf", amount: 400, branchId: "marina" }, [
    { key: "ornek:camasir", name: "ÇAMAŞIR SUYU", net: 400 },
  ]);
  const at = new Date().toISOString();
  await db
    .insert(s.integrationState)
    .values({
      key: PRODUCT_IGNORE_KEY,
      value: [
        { productKey: "ornek:krp", productName: "KRP END KONTY ÇÖP TORBASI", at, reason: "sarf" },
        { productKey: "ornek:isitici", productName: "TÜPLÜ ISITICI", at, reason: "demirbas" },
        { productKey: "ornek:deterjan", productName: "BULAŞIK DETERJANI", at, reason: "sarf" },
      ],
    })
    .onConflictDoNothing();
  await db
    .insert(s.integrationState)
    .values({ key: SUPPLIER_IGNORE_KEY, value: [{ supplierKey: supplierMatchKey("Temizlik Dünyası"), supplierName: "Temizlik Dünyası", reason: "sarf", at }] })
    .onConflictDoNothing();
  await db.insert(s.integrationState).values({ key: STOCK_ONLY_ACCEPTED_KEY, value: [kept] }).onConflictDoNothing();
  // Temizlik & Sarf'ın harcama satırı (0090 açar; yoksa)
  const cats = await db.select({ id: s.expenseCategories.id }).from(s.expenseCategories).where(inArray(s.expenseCategories.invoiceCategory, ["Temizlik & Sarf"]));
  if (!cats.length) await db.insert(s.expenseCategories).values({ name: "Temizlik & sarf malzemesi", section: "genel", panelGroup: "diger", invoiceCategory: "Temizlik & Sarf", sortOrder: 99 });
  console.log("Örnek veri eklendi: 6 Paraşüt faturası, kalemleri, 3 hammadde bağı, 3 ürün nedeni, 1 tedarikçi kuralı.");
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
