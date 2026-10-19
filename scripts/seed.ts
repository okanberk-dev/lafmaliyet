// Excel'den çıkarılan başlangıç verisini veritabanına yükler.
// Kullanım:
//   npm run db:seed              -> veritabanı boşsa yükler
//   npm run db:seed -- --reset   -> kullanıcılar hariç bütün veriyi silip yeniden yükler

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { count, sql } from "drizzle-orm";

import { normalizePosName } from "../src/lib/calc/engine";
import { hashPassword } from "../src/server/auth/password";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { excelToDataset, type ExcelData } from "../src/server/db/seed/excel";

const SERIAL_TABLES = [
  "categories",
  "ingredients",
  "ingredient_prices",
  "products",
  "recipe_items",
  "sales_lines",
  "invoices",
  "staff",
  "fixed_expenses",
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

export async function runSeed({ reset = false } = {}) {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const db = createDb(url, 1);
  try {
    const [{ n }] = await db.select({ n: count() }).from(s.ingredients);
    if (n > 0 && !reset) {
      console.log("✓ Veritabanında veri var, seed atlandı (yeniden yüklemek için --reset)");
      await ensureAdmin(db);
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
              .concat(["settings", "months", "pos_mappings", "notification_log", "parasut_sync_runs"])
              .join(", ")} RESTART IDENTITY CASCADE`,
          ),
        );
        // Paraşüt imleci, fiyat tarihleri ve kişi önbelleği eski kimliklere bağlı; baştan okunsun
        await tx.execute(sql.raw(`DELETE FROM integration_state WHERE key LIKE 'parasut.%'`));
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
      await tx.insert(s.months).values(ds.months);
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
      await tx.insert(s.investments).values(raw.investments.map((x) => ({ ...x, date: "2026-07" })));
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
