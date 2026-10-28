// Dalga 12 (vergi) migration'ı (docs/planlar/vergi.md §5):
// - dosya düzeyinde: üretilen drizzle/00xx_vergi.sql üç yeni tabloyu, dört yeni sütunu, tax_filings (kind, period) tekil
//   indeksini, tax_assets CHECK'lerini ve invoices.tax_not_asset varsayılanını taşır; günlükte tek "vergi" migration'ı var;
// - VERGI_TEST_DATABASE_URL verilirse (migration'ları uygulanmış bir veritabanı; yoksa atlanır) işlem içinde: cost = 0
//   reddedilir, aynı (kind, period) ikinci kez reddedilir, yeni sütunların varsayılanları; işlem geri alınır.
// Çalıştırma: VERGI_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/laffogato_vergi npx tsx --test tests/vergi-migration.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import postgres from "postgres";

import { readJournal } from "../scripts/migration-check";

const DIR = join(process.cwd(), "drizzle");
const files = readdirSync(DIR).filter((f) => /^\d{4}_vergi\.sql$/.test(f));

test("tek vergi migration'ı var ve günlükte sırasında", () => {
  assert.equal(files.length, 1, "drizzle/ altında tek *_vergi.sql");
  const tag = files[0].replace(/\.sql$/, "");
  const journal = readJournal();
  const at = journal.findIndex((e) => e.tag === tag);
  assert.ok(at > 0, `${tag} günlükte`);
  assert.ok(journal[at].when > journal[at - 1].when);
});

test("vergi migration'ı: tablolar, sütunlar, tekil indeks, CHECK'ler, varsayılan", () => {
  const sql = readFileSync(join(DIR, files[0]), "utf8");
  for (const t of ["tax_assets", "tax_filings", "tax_adjustments"]) assert.match(sql, new RegExp(`CREATE TABLE "${t}"`), t);
  assert.match(sql, /ALTER TABLE "fixed_expenses" ADD COLUMN "tax_doc" text;/);
  assert.match(sql, /ALTER TABLE "fixed_expenses" ADD COLUMN "tax_withholding" text;/);
  assert.match(sql, /ALTER TABLE "expense_categories" ADD COLUMN "tax_doc" text;/);
  assert.match(sql, /ALTER TABLE "invoices" ADD COLUMN "tax_not_asset" boolean DEFAULT false NOT NULL;/);
  assert.match(sql, /CREATE UNIQUE INDEX "tax_filings_kind_period_uq" ON "tax_filings" USING btree \("kind","period"\)/);
  assert.match(sql, /CONSTRAINT "tax_assets_cost_pos" CHECK \("tax_assets"\."cost" > 0\)/);
  assert.match(sql, /CONSTRAINT "tax_assets_life_range" CHECK \("tax_assets"\."life_years" is null or "tax_assets"\."life_years" between 1 and 50\)/);
  assert.match(sql, /CONSTRAINT "tax_adjustments_amount_pos" CHECK/);
  assert.match(sql, /CONSTRAINT "tax_adjustments_span_kind" CHECK \("tax_adjustments"\."span" = 'ay' or "tax_adjustments"\."kind" in \('gelir_kafe_disi', 'gider_kafe_disi'\)\)/);
  // Faturası silinen demirbaş kalır (künyesiyle), kaydı giren kullanıcı silinince kayıt kalır
  assert.match(sql, /"tax_assets_invoice_id_invoices_id_fk" FOREIGN KEY \("invoice_id"\) REFERENCES "public"\."invoices"\("id"\) ON DELETE set null/);
  assert.match(sql, /"tax_filings_entered_by_users_id_fk" FOREIGN KEY \("entered_by"\) REFERENCES "public"\."users"\("id"\) ON DELETE set null/);
  // Yalnız eklemeli: var olan hiçbir şey silinmez ya da değişmez
  assert.doesNotMatch(sql, /DROP |ALTER COLUMN|RENAME /);
});

test("vergi tabloları veritabanında: CHECK ve tekil indeks reddeder, varsayılanlar; işlem geri alınır", { skip: process.env.VERGI_TEST_DATABASE_URL ? false : "VERGI_TEST_DATABASE_URL yok" }, async () => {
  const db = postgres(process.env.VERGI_TEST_DATABASE_URL!, { max: 1, onnotice: () => {} });
  const ROLLBACK = new Error("geri al");
  const seen: Record<string, unknown> = {};
  try {
    const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from information_schema.tables where table_name in ('tax_assets', 'tax_filings', 'tax_adjustments')`;
    assert.equal(n, 3, "migration'lar uygulanmamış: npm run db:migrate");
    await db
      .begin(async (tx) => {
        const code = async (q: Promise<unknown>) => {
          await tx`savepoint s`;
          try {
            await q;
            await tx`release savepoint s`;
            return null;
          } catch (e) {
            await tx`rollback to savepoint s`;
            return (e as { code?: string; constraint_name?: string }).constraint_name ?? (e as { code?: string }).code ?? "?";
          }
        };
        seen.cost0 = await code(tx`insert into tax_assets (name, acquired_on, cost) values ('Deneme', '2026-07-01', 0)`);
        seen.life0 = await code(tx`insert into tax_assets (name, acquired_on, cost, life_years) values ('Deneme', '2026-07-01', 100, 0)`);
        seen.life51 = await code(tx`insert into tax_assets (name, acquired_on, cost, life_years) values ('Deneme', '2026-07-01', 100, 51)`);
        const [asset] = await tx<{ kind: string; method: string; life_years: number | null }[]>`insert into tax_assets (name, acquired_on, cost) values ('Deneme', '2026-07-01', 100) returning kind, method, life_years`;
        seen.asset = asset;
        seen.filing1 = await code(tx`insert into tax_filings (kind, period, payable) values ('gecici', '2026-Q3', 41200)`);
        seen.filing2 = await code(tx`insert into tax_filings (kind, period, payable) values ('gecici', '2026-Q3', 1)`);
        seen.filingOther = await code(tx`insert into tax_filings (kind, period, payable) values ('kv', '2026-Q3', 1)`);
        const [f] = await tx<{ stamp: number; values: unknown }[]>`select stamp, values from tax_filings where kind = 'gecici' and period = '2026-Q3'`;
        seen.filing = f;
        seen.adjZero = await code(tx`insert into tax_adjustments (month, kind, amount, label) values ('2026-09', 'kkeg', 0, 'Deneme')`);
        seen.adjSpan = await code(tx`insert into tax_adjustments (month, span, kind, amount, label) values ('2026-09', 'ceyrek', 'kkeg', 5, 'Deneme')`);
        seen.adjSpanOk = await code(tx`insert into tax_adjustments (month, span, kind, amount, label) values ('2026-09', 'ceyrek', 'gelir_kafe_disi', 5, 'Deneme')`);
        const [cols] = await tx<{ n: number }[]>`select count(*)::int as n from information_schema.columns where (table_name, column_name) in (('fixed_expenses', 'tax_doc'), ('fixed_expenses', 'tax_withholding'), ('expense_categories', 'tax_doc'), ('invoices', 'tax_not_asset'))`;
        seen.cols = cols.n;
        const [inv] = await tx<{ tax_not_asset: boolean }[]>`insert into invoices (date, supplier, category) values ('2026-09-01', 'Deneme', 'Diğer') returning tax_not_asset`;
        seen.invoice = inv.tax_not_asset;
        throw ROLLBACK;
      })
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    const [{ left }] = await db<{ left: number }[]>`select (select count(*) from tax_filings where period = '2026-Q3' and payable = 41200)::int as left`;
    assert.equal(left, 0, "işlem geri alındı");
  } finally {
    await db.end();
  }
  assert.equal(seen.cost0, "tax_assets_cost_pos");
  assert.equal(seen.life0, "tax_assets_life_range");
  assert.equal(seen.life51, "tax_assets_life_range");
  assert.deepEqual(seen.asset, { kind: "demirbas", method: "amortisman", life_years: null });
  assert.equal(seen.filing1, null);
  assert.equal(seen.filing2, "tax_filings_kind_period_uq");
  assert.equal(seen.filingOther, null, "başka tür aynı dönemle kaydedilir");
  assert.deepEqual(seen.filing, { stamp: 0, values: {} });
  assert.equal(seen.adjZero, "tax_adjustments_amount_pos");
  assert.equal(seen.adjSpan, "tax_adjustments_span_kind");
  assert.equal(seen.adjSpanOk, null);
  assert.equal(seen.cols, 4);
  assert.equal(seen.invoice, false);
});
