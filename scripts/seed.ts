// Excel'den çıkarılan başlangıç verisini veritabanına yükler.
// Kullanım:
//   npm run db:seed              -> veritabanı boşsa yükler
//   npm run db:seed -- --reset   -> kullanıcılar hariç bütün veriyi silip yeniden yükler

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { count, sql } from "drizzle-orm";

import { normalizePosName } from "../src/lib/calc/engine";
import { CHECKLIST_SEED_KEY, DEFAULT_CHECKLISTS } from "../src/lib/checklist-seed";
import { hashPassword } from "../src/server/auth/password";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { excelToDataset, investmentSeed, type ExcelData } from "../src/server/db/seed/excel";

const SERIAL_TABLES = [
  "categories",
  "ingredients",
  "ingredient_prices",
  "products",
  "recipe_items",
  "sales_lines",
  "invoices",
  "staff",
  "staff_versions",
  "fixed_expenses",
  "fixed_expense_versions",
  "investments",
  "pnl_entries",
  "stock_counts",
  "stock_extras",
  "purchase_quantities",
  "findings",
  "activity_log",
  "users",
];

async function ensureAdmin(db: DB) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("! ADMIN_EMAIL / ADMIN_PASSWORD tanımlı değil, yönetici hesabı oluşturulmadı");
    return;
  }
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) return;
  await db.insert(s.users).values({
    email,
    name: process.env.ADMIN_NAME ?? "Yönetici",
    passwordHash: await hashPassword(password),
    role: "admin",
  });
  console.log(`✓ Yönetici hesabı oluşturuldu: ${email}`);
}

/**
 * Açılış ve kapanış kontrol listeleri (src/lib/checklist-seed.ts) bir kez eklenir: anahtar (`kontrol.seeded`) yazılıysa
 * hiçbir şey yapılmaz, silinen liste geri gelmez. Listeler eklendikleri andan etkin: canlıya ilk çıkış öğleden sonraysa
 * o günün açılışı "gecikti" demez. Anahtar ve listeler tek işlemde; aynı adda liste varsa o atlanır.
 */
async function ensureChecklistSeed(db: DB) {
  const added = await db.transaction(async (tx) => {
    const [mark] = await tx
      .insert(s.integrationState)
      .values({ key: CHECKLIST_SEED_KEY, value: { at: new Date().toISOString(), version: 1 } })
      .onConflictDoNothing()
      .returning({ key: s.integrationState.key });
    if (!mark) return [];
    const names: string[] = [];
    for (const [k, t] of DEFAULT_CHECKLISTS.entries()) {
      const [row] = await tx
        .insert(s.checklistTemplates)
        .values({ name: t.name, description: t.description, schedule: "daily", opensAt: t.opensAt, dueAt: t.dueAt, sortOrder: k + 1 })
        .onConflictDoNothing()
        .returning({ id: s.checklistTemplates.id });
      if (!row) continue;
      await tx.insert(s.checklistItems).values(
        t.items.map((i, n) => ({
          templateId: row.id,
          label: i.label,
          type: i.type,
          section: i.section ?? null,
          hint: i.hint ?? null,
          required: i.required ?? true,
          unit: i.unit ?? null,
          min: i.min ?? null,
          max: i.max ?? null,
          sortOrder: n + 1,
        })),
      );
      names.push(t.name);
    }
    return names;
  });
  if (added.length) console.log(`✓ Kontrol listeleri eklendi: ${added.join(", ")}`);
}

export async function runSeed({ reset = false } = {}) {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const db = createDb(url, 1);
  try {
    const [{ n }] = await db.select({ n: count() }).from(s.ingredients);
    if (n > 0 && !reset) {
      console.log("✓ Veritabanında veri var, seed atlandı (yeniden yüklemek için --reset)");
      await ensureAdmin(db);
      await ensureChecklistSeed(db);
      return;
    }

    const raw: ExcelData = JSON.parse(
      readFileSync(join(process.cwd(), "src/server/db/seed/excel-data.json"), "utf8"),
    );
    const ds = excelToDataset(raw);

    await db.transaction(async (tx) => {
      if (reset) {
        await tx.execute(
          sql.raw(
            `TRUNCATE ${SERIAL_TABLES.filter((t) => t !== "users")
              .concat(["settings", "months", "pos_mappings", "notification_log", "parasut_sync_runs", "expense_entries"])
              .join(", ")} RESTART IDENTITY CASCADE`,
          ),
        );
        // Paraşüt imleci, fiyat tarihleri ve kişi önbelleği eski kimliklere bağlı; baştan okunsun. Son ödenenler de
        // fatura kimliklerine bağlı: kimlikler baştan sayınca "Geri al" başka bir faturayı ödenmedi yapardı. Ödeme
        // takibinin başlangıcı da silinir: faturalar (ödeme işaretleriyle) yeniden yüklenince sonraki eşitleme yeniden
        // belirler; eski tarih kalsa o günden bu yana bütün Paraşüt faturaları "ödenmedi" geri gelirdi
        await tx.execute(sql.raw(`DELETE FROM integration_state WHERE key LIKE 'parasut.%' OR key IN ('payments.recent', 'payments.since')`));
        // laffogato.net menü durumu da ürün kimliklerine bağlı (kopuk / kaldırılan bağlantılar); ürünler bağlantısız
        // yeniden yüklenir, sonraki eşitleme durumu baştan yazar (docs/SITE-MENU.md)
        await tx.execute(sql.raw(`DELETE FROM integration_state WHERE key = 'menu_sync'`));
        // Nakit planının tahmin ayarı sabit gider kimliklerine bağlı (fixed:<id>), kimlikler baştan sayar: başka bir
        // gideri kapatmasın. Bakiye zaten kısa ömürlü; devreden KDV kaydı da gider (docs/NAKIT-PLANI.md)
        await tx.execute(sql.raw(`DELETE FROM integration_state WHERE key = 'cashflow.plan'`));
      }

      await tx.insert(s.settings).values(
        Object.entries(ds.settings)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => ({ key, value: value as unknown })),
      );
      await tx.insert(s.categories).values(ds.categories);
      await tx.insert(s.ingredients).values(ds.ingredients);
      await tx.insert(s.ingredientPrices).values(
        ds.ingredients
          .filter((i) => i.priceSource === "manual")
          .map((i) => ({
            ingredientId: i.id,
            packagePrice: i.packagePrice,
            packageSize: i.packageSize,
            note: "Excel'den aktarıldı",
            changedBy: "Excel",
            changedAt: new Date("2026-10-17T12:00:00+03:00"),
          })),
      );
      await tx.insert(s.products).values(ds.products);
      await tx.insert(s.recipeItems).values(ds.recipeItems);
      // Excel'in ay bilgileri elle yazılmış değerlerdir (sıfırlar dahil); kasa raporundan gelen bir şey yok
      await tx.insert(s.months).values(
        ds.months.map((m) => ({ month: m.month, openDays: m.openDays, posRevenue: m.posRevenue, discounts: m.discounts, offRevenue: m.offRevenue, note: m.note })),
      );
      await tx.insert(s.salesLines).values(ds.salesLines.map((l, i) => ({ ...l, sortOrder: i + 1 })));

      const mappings = new Map<string, { productId: number | null; isService: boolean }>();
      for (const l of ds.salesLines) {
        if (l.productId || l.isService) {
          mappings.set(normalizePosName(l.posName), { productId: l.productId, isService: l.isService });
        }
      }
      await tx
        .insert(s.posMappings)
        .values([...mappings].map(([posName, m]) => ({ posName, ...m })));

      await tx.insert(s.invoices).values(ds.invoices.map((i) => ({ ...i, source: "excel" as const, origin: "excel" as const })));
      await tx.insert(s.staff).values(ds.staff.map((x, i) => ({ ...x, sortOrder: i + 1 })));
      await tx.insert(s.fixedExpenses).values(ds.fixedExpenses);
      await tx.insert(s.investments).values(raw.investments.map(investmentSeed));
      await tx.insert(s.purchaseQuantities).values(ds.purchaseQuantities);
      await tx.insert(s.findings).values(
        raw.findings.map((f) => ({ ...f, resolvedAt: f.resolved ? new Date("2026-10-16T12:00:00+03:00") : null })),
      );
      await tx.insert(s.activityLog).values({
        userName: "Sistem",
        action: "Excel'den aktarım",
        detail: `${raw.meta.source}: ${ds.ingredients.length} hammadde, ${ds.products.length} ürün, ${ds.salesLines.length} satış satırı, ${ds.invoices.length} fatura`,
      });

      // Açık id'lerle eklenen tabloların sayaçlarını ileri al
      for (const t of SERIAL_TABLES) {
        await tx.execute(
          sql.raw(
            `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0), 1), (SELECT COUNT(*) > 0 FROM ${t}))`,
          ),
        );
      }
    });

    console.log(
      `✓ Excel verisi yüklendi: ${ds.ingredients.length} hammadde, ${ds.products.length} ürün, ` +
        `${ds.recipeItems.length} reçete satırı, ${ds.salesLines.length} satış satırı, ${ds.invoices.length} fatura`,
    );
    await ensureAdmin(db);
    await ensureChecklistSeed(db);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  loadEnvConfig(process.cwd());
  runSeed({ reset: process.argv.includes("--reset") }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
