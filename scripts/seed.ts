// Başlangıç verisini (tests/fixtures/baslangic/veri.json; ilk kurulumda eski hesap tablosundan bir kez aktarıldı)
// veritabanına yükler.
// Kullanım:
//   npm run db:seed                        -> veritabanı boşsa yükler
//   npm run db:reset [-- --onay=<sunucu>]  -> kullanıcılar hariç verinin çoğunu silip yeniden yükler (README › db:reset)
// İkisi de hazır kontrol listelerini (Açılış, Kapanış) bir kez ekler; dolu veritabanında da (canlıya ilk çıkış). Ürünler
// eski tablonun boş bıraktığı zayi oranlarını kategorilerinden alır (src/lib/fire-defaults.ts).
//
// Derleme öncesi hazırlık (scripts/predeploy.ts) da runSeed'i çağırır, ama canlıda, önizlemede ve uzak veritabanında boş
// veritabanına başlangıç verisini yüklemez (`emptySkip`; scripts/predeploy-guard.ts › emptySeedSkipReason, docs/DEPLOY.md
// § 5). db:seed ve db:reset açıkça çağrıldıkları için yükler.
//
// db:reset geri alınamaz: bu bilgisayarda olmayan bir veritabanında (Neon) sunucu adıyla onay ister (db:restore gibi;
// .env.local canlının adresini gösteriyorsa yerel sanılan sıfırlama canlıyı silmesin) ve silmeden önce her zaman tam
// yedeği ev klasörüne yazar (laffogato-yedek-once-<sunucu>-….json.gz; yüklenen belgeler dahil, docs/YEDEK.md).

import { homedir } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { loadEnvConfig } from "@next/env";
import { and, count, eq, sql } from "drizzle-orm";

import { backupFileName, backupSummaryText, databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { normalizePosName } from "../src/lib/calc/engine";
import { BRANCH_SEED_KEY, DEFAULT_BRANCHES } from "../src/lib/branches";
import {
  CHECKLIST_SEED_KEY,
  DEFAULT_CHECKLISTS,
  FOOD_SAFETY_ITEMS,
  FOOD_SAFETY_LISTS,
  FOOD_SAFETY_SEED_KEYS,
  MARINA_CHECKLIST_SEED_KEY,
  MARINA_CHECKLISTS,
  MARINA_CLOSE_PHOTOS,
  MARINA_OPEN_PHOTOS,
  MARINA_PHOTO_SEED_KEY,
  placeNewItems,
  TUZLA_HOURLY_CHECKLISTS,
  TUZLA_HOURLY_SEED_KEY,
  type SeedItem,
  type SeedTemplate,
} from "../src/lib/checklist-seed";
import { withFireDefaults } from "../src/lib/fire-defaults";
import { IMPORT_ACTIVITY_LABEL, IMPORTED_LABEL, IMPORT_AUTHOR_LABEL } from "../src/lib/import-labels";
import { relinkWaste } from "../src/lib/waste";
import { hashPassword } from "../src/server/auth/password";
import { appVersion, writeBackupFile } from "../src/server/backup/core";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";
import { datasetFromSeed, investmentSeed, readSeedData } from "../tests/fixtures/baslangic";

import { emptySeedWarning } from "./predeploy-guard";

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
 * Şube ve kanal kütüğü (src/lib/branches.ts) bir kez yazılır: Tuzla, Marina ve laffogato.net. Anahtar
 * (`branches_seeded`) yazılıysa hiçbir şey yapılmaz; silinen ya da adı değiştirilen kayıt geri gelmez. Dolu
 * veritabanında da çalışır (canlıya ilk çıkış): şubesiz geçmiş veri Tuzla'ya yazılmıştır (docs/SUBE.md).
 */
async function ensureBranchSeed(db: DB) {
  const added = await db.transaction(async (tx) => {
    const [mark] = await tx
      .insert(s.integrationState)
      .values({ key: BRANCH_SEED_KEY, value: { at: new Date().toISOString(), version: 1 } })
      .onConflictDoNothing()
      .returning({ key: s.integrationState.key });
    if (!mark) return [];
    const rows = await tx
      .insert(s.branches)
      .values(DEFAULT_BRANCHES.map((b) => ({ ...b })))
      .onConflictDoNothing()
      .returning({ name: s.branches.name });
    return rows.map((r) => r.name);
  });
  if (added.length) console.log(`✓ Şubeler eklendi: ${added.join(", ")}`);
}

/**
 * Açılış ve kapanış kontrol listeleri (src/lib/checklist-seed.ts) bir kez eklenir: anahtar (`kontrol.seeded`) yazılıysa
 * hiçbir şey yapılmaz, silinen liste geri gelmez. Listeler eklendikleri andan etkin: canlıya ilk çıkış öğleden sonraysa
 * o günün açılışı "gecikti" demez. Anahtar ve listeler tek işlemde; aynı adda liste varsa o atlanır.
 */
async function ensureChecklistSeed(db: DB) {
  await seedChecklists(db, CHECKLIST_SEED_KEY, DEFAULT_CHECKLISTS);
}

/**
 * Marina'nın açılış ve kapanış listeleri (karaokesiz), kendi anahtarıyla bir kez (`kontrol.marina.seeded`). Şube
 * tohumundan sonra çalışır; Marina kütükte yoksa (silinmiş ya da kimliği değişmiş) hiçbir şey yazılmaz ve anahtar da
 * yazılmaz.
 */
async function ensureMarinaChecklistSeed(db: DB) {
  const [marina] = await db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.id, "marina")).limit(1);
  if (!marina) return;
  await seedChecklists(db, MARINA_CHECKLIST_SEED_KEY, MARINA_CHECKLISTS);
}

/**
 * Tuzla'nın saatlik tuvalet çizelgesi, kendi anahtarıyla bir kez (`kontrol.tuzla.tuvalet.seeded`). Tuzla kütükte yoksa
 * hiçbir şey yazılmaz ve anahtar da yazılmaz.
 */
async function ensureTuzlaHourlySeed(db: DB) {
  const [tuzla] = await db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.id, "tuzla")).limit(1);
  if (!tuzla) return;
  await seedChecklists(db, TUZLA_HOURLY_SEED_KEY, TUZLA_HOURLY_CHECKLISTS);
}

/**
 * Gıda güvenliği maddeleri (SKT, ikinci raf ömrü etiketi, yerde ürün, FIFO) var olan açılış listelerine; her anahtar
 * (`FOOD_SAFETY_SEED_KEYS`) bir kez.
 */
async function ensureFoodSafetyItems(db: DB) {
  for (const key of FOOD_SAFETY_SEED_KEYS) await addSeedItems(db, key, "Gıda güvenliği maddeleri", FOOD_SAFETY_LISTS.map((name) => ({ name, items: FOOD_SAFETY_ITEMS })));
}

/** Marina'nın fotoğraflı maddeleri (Tuzla gibi; 20 Kasım 2026) var olan Marina listelerine bir kez (`kontrol.marina.foto.seeded`) */
async function ensureMarinaPhotoItems(db: DB) {
  await addSeedItems(db, MARINA_PHOTO_SEED_KEY, "Marina fotoğraflı maddeleri", [
    { name: "Marina Açılış", items: MARINA_OPEN_PHOTOS },
    { name: "Marina Kapanış", items: MARINA_CLOSE_PHOTOS },
  ]);
}

/**
 * Var olan listelere yeni hazır maddeler, anahtarla bir kez (`key` integration_state'e yazılır; tek işlemde). Liste
 * adıyla bulunur; adı değişmiş ya da silinmiş liste atlanır. Listede aynı adda etkin madde varsa (yeni kurulumda
 * tohum zaten ekledi, ya da yönetici eklemiş) o madde atlanır. Yeni madde kendi bölümünün sonuna girer, bölüm yoksa
 * "Not"tan önce (placeNewItems); etkin maddeler yeniden sıralanır. Bugün açılmış kayıt değişmez; maddeler ertesi
 * güne (bugün açılmadıysa bugüne) girer.
 */
async function addSeedItems(db: DB, key: string, what: string, lists: { name: string; items: readonly SeedItem[] }[]) {
  const added = await db.transaction(async (tx) => {
    const [mark] = await tx
      .insert(s.integrationState)
      .values({ key, value: { at: new Date().toISOString(), version: 1 } })
      .onConflictDoNothing()
      .returning({ key: s.integrationState.key });
    if (!mark) return [];
    const names: string[] = [];
    for (const { name, items } of lists) {
      const [tpl] = await tx.select({ id: s.checklistTemplates.id }).from(s.checklistTemplates).where(eq(s.checklistTemplates.name, name)).limit(1);
      if (!tpl) continue;
      const rows = (
        await tx
          .select({ id: s.checklistItems.id, label: s.checklistItems.label, section: s.checklistItems.section, sortOrder: s.checklistItems.sortOrder })
          .from(s.checklistItems)
          .where(and(eq(s.checklistItems.templateId, tpl.id), eq(s.checklistItems.active, true)))
      ).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
      const have = new Set(rows.map((r) => r.label));
      const fresh = items.filter((i) => !have.has(i.label));
      if (!fresh.length) continue;
      for (const [n, e] of placeNewItems(rows, fresh).entries()) {
        const sortOrder = n + 1;
        if ("row" in e) {
          if (e.row.sortOrder !== sortOrder) await tx.update(s.checklistItems).set({ sortOrder }).where(eq(s.checklistItems.id, e.row.id));
        } else {
          const i = e.item;
          await tx.insert(s.checklistItems).values({
            templateId: tpl.id,
            label: i.label,
            type: i.type,
            section: i.section ?? null,
            hint: i.hint ?? null,
            required: i.required ?? true,
            unit: i.unit ?? null,
            min: i.min ?? null,
            max: i.max ?? null,
            sortOrder,
          });
        }
      }
      names.push(name);
    }
    return names;
  });
  if (added.length) console.log(`✓ ${what} eklendi: ${added.join(", ")}`);
}

async function seedChecklists(db: DB, key: string, lists: readonly SeedTemplate[]) {
  const added = await db.transaction(async (tx) => {
    const [mark] = await tx
      .insert(s.integrationState)
      .values({ key, value: { at: new Date().toISOString(), version: 1 } })
      .onConflictDoNothing()
      .returning({ key: s.integrationState.key });
    if (!mark) return [];
    const [{ last }] = await tx.select({ last: sql<number | null>`max(${s.checklistTemplates.sortOrder})` }).from(s.checklistTemplates);
    const names: string[] = [];
    for (const [k, t] of lists.entries()) {
      const [row] = await tx
        .insert(s.checklistTemplates)
        .values({
          name: t.name,
          description: t.description,
          branchId: t.branchId ?? null,
          schedule: "daily",
          opensAt: t.opensAt,
          dueAt: t.dueAt,
          sortOrder: (last ?? 0) + k + 1,
        })
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

/**
 * db:reset'in hedefe göre onayı (saf; tests/zayi-oranlari.test.ts). Bu bilgisayardaki veritabanı onaysız; başkası (Neon)
 * yalnız sunucu adıyla: `--onay=<sunucu>` ya da terminalde sorulunca adı yazmak.
 */
export function resetCheck(
  target: { host: string; label: string; local: boolean },
  confirm: string | null,
): { ok: true } | { ok: false; error: string } | { ok: false; warning: string } {
  if (target.local || confirm === target.host) return { ok: true };
  if (confirm !== null) return { ok: false, error: `Onay tutmuyor: --onay=${target.host} yazın (sunucu adı). Hiçbir şey silinmedi.` };
  return {
    ok: false,
    warning: `Bu veritabanındaki ürünler, faturalar (vergi demirbaş listesiyle), satışlar, sayımlar ve ayarlar silinip başlangıç verisi yüklenecek: ${target.label}.`,
  };
}

/**
 * db:reset'in cari engeli (K28): elle girilmiş cari kayıtları (borç, ödeme) varsa silmeden durur. TRUNCATE … CASCADE
 * onları da silerdi; Kasa satırları kalır, faturalar ödenmemiş geri gelir ve iki kez ödenir. `--cari-sil` ile silinir.
 */
export function cariResetBlock(entries: number, wipe: boolean, backupFile: string): string | null {
  if (!entries || wipe) return null;
  return `Cari hareketleri var (${entries} kayıt). db:reset onları siler, Kasa satırları kalır ve faturalar ödenmemiş geri gelir. Yedek alındı: ${backupFile}. Yine de silmek için: npm run db:reset -- --cari-sil`;
}

/**
 * db:reset'in vergi demirbaş listesi notu (dalga 12, K32; saf): `tax_assets` faturalara bağlı olduğu için `TRUNCATE
 * invoices … CASCADE` onu da boşaltır. Elle girilmiş liste durdurmaz (yedekte kalır), silineceği söylenir. Vergi
 * kayıtları (muhasebecinin rakamları, düzeltmeler) ve vergi ayarları kalır; sabit gider ve aylık harcama kategorisinin
 * vergi belgesi kendi satırıyla birlikte gider ya da kalır (sabit giderler başlangıç verisinden yeniden yüklenir, sınıflandırmasız).
 * Vergi bölümü 27 Kasım 2026'da kaldırıldı; tablolar ve kayıtlar yerinde, ekranı yok: liste yalnız yedekten geri gelir
 */
export function taxAssetsResetNote(assets: number): string | null {
  return assets ? `Vergi demirbaş listesi de silinecek (${assets} varlık; yedekte duruyor, yedekten geri yüklenir; Vergi bölümü kaldırıldı).` : null;
}

/** drizzle/*_sayim_yeni_kalemler.sql: sayım listesine sonradan eklenen sekiz kalem (tek ifade, korumalı) */
export function countItemsSql(): string {
  const dir = join(process.cwd(), "drizzle");
  const file = readdirSync(dir).find((f) => f.endsWith("_sayim_yeni_kalemler.sql"));
  if (!file) throw new Error("drizzle/*_sayim_yeni_kalemler.sql bulunamadı");
  return readFileSync(join(dir, file), "utf8");
}

export interface SeedOptions {
  /** Hedef; verilmezse ortamdan (komut satırı ve derleme kabuktakini öne alarak verir, db:migrate gibi) */
  url?: string;
  reset?: boolean;
  /** db:reset: elle girilmiş cari kayıtları da silinsin (`--cari-sil`; yoksa varken durur) */
  wipeCari?: boolean;
  /** db:reset için `--onay=<sunucu>` */
  confirm?: string | null;
  /** Etkileşimli terminalde soru (yoksa onay yalnız --onay ile) */
  ask?: ((question: string) => Promise<string>) | null;
  /**
   * Boş veritabanına başlangıç verisi yüklenmesin; değer nedeni (derleme öncesi hazırlık verir: canlı, önizleme, uzak
   * veritabanı; scripts/predeploy-guard.ts › emptySeedSkipReason). Veri yüklenmez, uyarı yazılır; ilk yönetici, şube
   * kütüğü ve hazır kontrol listeleri yine eklenir. Verilmezse (db:seed, test:db) boş veritabanı dolar. --reset'te yok sayılır
   */
  emptySkip?: string | null;
  now?: Date;
}

/** Boş ya da dolu her veritabanında: ilk yönetici, şube kütüğü, hazır kontrol listeleri ve maddeleri (her biri bir kez) */
async function ensureBasics(db: DB) {
  await ensureAdmin(db);
  await ensureChecklistSeed(db);
  await ensureBranchSeed(db);
  await ensureMarinaChecklistSeed(db);
  await ensureTuzlaHourlySeed(db);
  await ensureFoodSafetyItems(db);
  await ensureMarinaPhotoItems(db);
}

export async function runSeed({
  url = databaseUrl(process.env),
  reset = false,
  wipeCari = false,
  confirm = null,
  ask = null,
  emptySkip = null,
  now = new Date(),
}: SeedOptions = {}) {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const target = databaseTarget(url);
  console.log(`Hedef: ${target.label}${target.local ? " (bu bilgisayar)" : ""}`);
  if (reset) {
    const check = resetCheck(target, confirm);
    if (!check.ok) {
      if ("error" in check) throw new Error(check.error);
      if (!ask) throw new Error(`${check.warning} Onay için --onay=${target.host} ekleyin. Hiçbir şey silinmedi.`);
      if ((await ask(`${check.warning} Onaylamak için sunucu adını yazın: `)).trim() !== target.host) throw new Error("Onaylanmadı; hiçbir şey silinmedi.");
    }
  }
  const db = createDb(url, 1);
  try {
    const [{ n }] = await db.select({ n: count() }).from(s.ingredients);
    if (n > 0 && !reset) {
      console.log("✓ Veritabanında veri var, seed atlandı (yeniden yüklemek için --reset)");
      await ensureBasics(db);
      return;
    }
    // Canlı derleme boş veritabanına kişisel veri yazmaz (emptySkip); derleme uyarıyla sürer
    if (emptySkip && !reset) {
      console.warn(`! ${emptySeedWarning(emptySkip)}`);
      await ensureBasics(db);
      return;
    }

    const raw = readSeedData();
    const ds = datasetFromSeed(raw);

    if (reset) {
      // Silmeden önce tam yedek (yüklenen belgeler dahil): yanlış veritabanı sıfırlandıysa db:restore ile geri gelir
      const file = join(homedir(), backupFileName(now, { host: target.host }));
      const b = await writeBackupFile(db.$client, file, { documents: true, createdBy: "db:reset öncesi", app: appVersion(), now });
      console.log(`✓ Silmeden önce yedek: ${file} · ${backupSummaryText({ tables: Object.keys(b.tables).length, rows: b.rows, bytes: b.bytes, documents: b.documents, docCount: b.docCount })}`);
      // Cari kayıtları (elle borç ve ödeme) varsa durur: --cari-sil verilmeden silinmez
      const [{ entries }] = await db.select({ entries: count() }).from(s.supplierEntries);
      const block = cariResetBlock(entries, wipeCari, file);
      if (block) throw new Error(block);
      // Vergi demirbaş listesi faturalarla birlikte gider (K32): durdurmaz, söylenir
      const [{ assets }] = await db.select({ assets: count() }).from(s.taxAssets);
      const assetNote = taxAssetsResetNote(assets);
      if (assetNote) console.log(`! ${assetNote}`);
    }

    await db.transaction(async (tx) => {
      // Zayi ve ikram kayıtları kalır (kasa raporları ve kasadan çıkanlar gibi): TRUNCATE … CASCADE ürünlere bağlı
      // oldukları için onları da boşaltır; önce okunur, başlangıç verisinden sonra aynı kimliklerle geri yazılır
      const keptWaste = reset ? await tx.select().from(s.wasteEntries) : [];
      if (reset) {
        await tx.execute(
          sql.raw(
            `TRUNCATE ${SERIAL_TABLES.filter((t) => t !== "users")
              .concat(["settings", "months", "pos_mappings", "notification_log", "parasut_sync_runs", "expense_entries"])
              .concat(wipeCari ? ["supplier_allocations", "supplier_entries"] : [])
              .join(", ")} RESTART IDENTITY CASCADE`,
          ),
        );
        // Cari kayıtları silindiyse "Ayrı tut" denmiş Kasa satırlarının listesi de gider
        if (wipeCari) await tx.execute(sql.raw(`DELETE FROM integration_state WHERE key = 'cari.kasa-ayri'`));
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
        // Personel istekleri ürün, hammadde ve kayıt kimliklerine bağlı (docs/ONAYLAR.md): bekleyenler geri çekilir,
        // kaldırılan mal siparişi taslağının (26 Eki 2026) onaylanmış eski satırı süresi dolmuş sayılır; tuttukları fotoğraflar 7 gün sonra
        // silinmek üzere bırakılır. İstekler kaydıyla kalır (işlem geçmişi gibi), not personele görünür
        await tx.execute(
          sql.raw(
            `UPDATE photos SET expires_at = now() + interval '7 days' WHERE linked_at IS NULL AND id IN (SELECT unnest(photo_ids) FROM staff_requests WHERE status = 'pending')`,
          ),
        );
        const reset = { reviewNote: "Veritabanı sıfırlandı", updatedAt: now };
        await tx.update(s.staffRequests).set({ ...reset, status: "withdrawn" }).where(eq(s.staffRequests.status, "pending"));
        await tx
          .update(s.staffRequests)
          .set({ ...reset, status: "expired" })
          .where(and(eq(s.staffRequests.kind, "mal-taslak"), eq(s.staffRequests.status, "approved")));
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
            note: IMPORTED_LABEL,
            changedBy: IMPORT_AUTHOR_LABEL,
            changedAt: new Date("2026-10-17T12:00:00+03:00"),
          })),
      );
      // Başlangıç verisinde zayi oranı boş ürünler kategorisinin oranını alır (0012_zayi_oranlari'nın kuralları)
      await tx.insert(s.products).values(withFireDefaults(ds.products, ds.categories));
      await tx.insert(s.recipeItems).values(ds.recipeItems);
      // Başlangıç verisinin ay bilgileri elle yazılmış değerlerdir (sıfırlar dahil); kasa raporundan gelen bir şey yok
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
        action: IMPORT_ACTIVITY_LABEL,
        detail: `Başlangıç verisi: ${ds.ingredients.length} hammadde, ${ds.products.length} ürün, ${ds.salesLines.length} satış satırı, ${ds.invoices.length} fatura`,
      });
      // Kalan zayi / ikram kayıtları: aynı kimlikte aynı adla geri gelen ürüne ya da hammaddeye bağlı kalır, yoksa adıyla
      if (keptWaste.length) await tx.insert(s.wasteEntries).values(relinkWaste(keptWaste, ds.products, ds.ingredients));

      // Açık id'lerle eklenen tabloların sayaçlarını ileri al
      for (const t of [...SERIAL_TABLES, ...(keptWaste.length ? ["waste_entries"] : [])]) {
        await tx.execute(
          sql.raw(
            `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0), 1), (SELECT COUNT(*) > 0 FROM ${t}))`,
          ),
        );
      }
      // Sayıma sonradan eklenen sekiz kalem (çilek, cookie, lemon tea, hazelnut şurubu; vanilya sos; yaban mersini ve
      // böğürtlen püre; klips kapak): migration'ları boş veritabanında bir şey eklemez, başlangıç verisi yüklendikten sonra aynı
      // dosya burada çalışır ki taze ortam ve sıfırlanan veritabanı canlıyla aynı listeyi görsün (denetim E-29). Sayaçlar
      // ileri alındıktan sonra; aynı ad varsa atlar. Reçeteler değişmez (hangi ürünün kullandığı sahibin cevabını bekliyor)
      await tx.execute(sql.raw(countItemsSql()));
    });

    const [{ total }] = await db.select({ total: count() }).from(s.ingredients);
    console.log(
      `✓ Başlangıç verisi yüklendi: ${ds.ingredients.length} hammadde (+${total - ds.ingredients.length} sayım kalemi), ${ds.products.length} ürün, ` +
        `${ds.recipeItems.length} reçete satırı, ${ds.salesLines.length} satış satırı, ${ds.invoices.length} fatura`,
    );
    await ensureBasics(db);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  // Komut satırında verilen hedef .env.local'dakinden önce gelir (db:restore gibi): yoksa .env.local'daki canlının
  // havuzsuz adresi elle verilen adresin önüne geçer, yükleme ya da sıfırlama başka veritabanına giderdi (denetim AL-02)
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const onay = args.find((a) => a.startsWith("--onay="))?.slice("--onay=".length) ?? null;
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const url = databaseUrl(shell, process.env);
  runSeed({ url, reset: args.includes("--reset"), wipeCari: args.includes("--cari-sil"), confirm: onay, ask: rl ? (q) => rl.question(q) : null })
    .then(() => rl?.close())
    .catch((e) => {
      rl?.close();
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    });
}
