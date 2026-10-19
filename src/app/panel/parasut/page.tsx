import { asc, count, desc, eq, max } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { PageSkeleton } from "@/components/ui/misc";
import { INVOICE_CATEGORIES } from "@/lib/constants";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";
import { isParasutConfigured, parasutEnvStatus } from "@/server/parasut/config";
import { unlinkedProducts } from "@/server/parasut/sync";

import { ParasutClient as ParasutScreen } from "./parasut-client";

export const metadata: Metadata = { title: "Paraşüt entegrasyonu" };
// Elle eşitleme bu sayfanın sunucu eylemiyle çalışır
export const maxDuration = 60;

export default function ParasutPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader eyebrow="Ayarlar" title="Paraşüt entegrasyonu" />
          <PageSkeleton rows={8} />
        </>
      }
    >
      <ParasutContent />
    </Suspense>
  );
}

async function ParasutContent() {
  await requireAdmin();
  const db = getDb();
  const [runs, rules, links, ingredients, unlinked, [stats], cursorRow, pendingRow] = await Promise.all([
    db.select().from(s.parasutSyncRuns).orderBy(desc(s.parasutSyncRuns.startedAt)).limit(8),
    db.select().from(s.parasutCategoryRules).orderBy(asc(s.parasutCategoryRules.priority), asc(s.parasutCategoryRules.id)),
    db
      .select({
        id: s.parasutProductLinks.id,
        productKey: s.parasutProductLinks.productKey,
        productName: s.parasutProductLinks.productName,
        ingredientId: s.parasutProductLinks.ingredientId,
        ingredientName: s.ingredients.name,
        unit: s.ingredients.unit,
        factor: s.parasutProductLinks.factor,
        updatePrice: s.parasutProductLinks.updatePrice,
      })
      .from(s.parasutProductLinks)
      .innerJoin(s.ingredients, eq(s.ingredients.id, s.parasutProductLinks.ingredientId))
      .orderBy(asc(s.parasutProductLinks.productName)),
    db.select({ id: s.ingredients.id, name: s.ingredients.name, unit: s.ingredients.unit, category: s.ingredients.category }).from(s.ingredients).orderBy(asc(s.ingredients.name)),
    unlinkedProducts(40),
    db.select({ n: count(), last: max(s.invoices.syncedAt) }).from(s.invoices).where(eq(s.invoices.source, "parasut")),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.cursor")).limit(1),
    db.select().from(s.integrationState).where(eq(s.integrationState.key, "parasut.pendingEInvoices")).limit(1),
  ]);
  const pending = pendingRow[0]?.value as { count: number; sample: { from: string | null; date: string | null }[]; at: string } | undefined;

  return (
    <ParasutScreen
      configured={isParasutConfigured()}
      env={parasutEnvStatus()}
      cronSet={Boolean(process.env.CRON_SECRET)}
      syncFrom={process.env.PARASUT_SYNC_FROM?.trim() || null}
      cursor={(cursorRow[0]?.value as { lastIssueDate?: string } | undefined)?.lastIssueDate ?? null}
      pendingEInvoices={pending ?? null}
      stats={{ invoices: stats?.n ?? 0, lastSyncedAt: stats?.last ? new Date(stats.last).toISOString() : null }}
      runs={runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }))}
      rules={rules.map((r) => ({ id: r.id, matchType: r.matchType, pattern: r.pattern, category: r.category, priority: r.priority }))}
      links={links}
      ingredients={ingredients}
      unlinked={unlinked}
      categories={INVOICE_CATEGORIES}
    />
  );
}
