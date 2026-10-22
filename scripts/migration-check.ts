// Migration'lar gerçekten uygulandı mı (saf; scripts/migrate.ts ve tests/migrations.test.ts kullanır).
//
// Drizzle bir migration'ı yalnız günlükteki zamanı (drizzle/meta/_journal.json › when) veritabanındaki en yeni
// kaydınkinden büyükse uygular (drizzle-orm/pg-core/dialect.js). Daha yeni tarihli bir kayıt önce girdiyse (bir
// önizleme erken uyguladı ya da dallar üretildikleri sıradan farklı birleşti), eski tarihli migration'lar hata
// vermeden sonsuza dek atlanır. Bu yüzden migration'dan sonra günlükteki her girdinin veritabanında kaydı aranır:
// eksik varsa derleme durur (canlıda eski sürüm yayında kalır), günlükte olmayan kayıt yalnız uyarıdır.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** drizzle-kit'in migration günlüğü (sırası ve zamanları) */
export function readJournal(dir = "drizzle"): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] };
  return raw.entries.map(({ idx, when, tag }) => ({ idx, when, tag }));
}

/**
 * `missing`: günlükte olup veritabanında kaydı olmayanlar (atlanmış). `orphans`: veritabanında olup günlükte
 * olmayanların zamanı (ör. 21 Eki 2026'da bir önizlemenin erken uyguladığı menü migration'ı; 0018 olarak yeniden
 * ve IF NOT EXISTS ile uygulandı).
 */
export function migrationGaps(journal: JournalEntry[], appliedCreatedAt: number[]): { missing: JournalEntry[]; orphans: number[] } {
  const applied = new Set(appliedCreatedAt);
  const known = new Set(journal.map((e) => e.when));
  return {
    missing: journal.filter((e) => !applied.has(e.when)),
    orphans: [...applied].filter((t) => !known.has(t)).sort((a, b) => a - b),
  };
}

/** Derleme günlüğüne yazılacaklar: `error` doluysa derleme durur, `warning` yalnız yazılır */
export function migrationReport(journal: JournalEntry[], appliedCreatedAt: number[]): { error: string | null; warning: string | null; ok: string } {
  const { missing, orphans } = migrationGaps(journal, appliedCreatedAt);
  const error = missing.length
    ? `Migration uygulanmadı: ${missing.map((e) => e.tag).join(", ")}. Veritabanında daha yeni tarihli bir migration kayıtlı olduğu için drizzle bunları atladı (sıra bozuk). Dalı main ile birleştirip "npm run db:generate" ile migration'ı yeniden üretin. Ayrıntı: docs/DEPLOY.md § 7.`
    : null;
  const when = (t: number) => (Number.isFinite(t) ? `${t} = ${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC` : String(t));
  const warning = orphans.length
    ? `! Veritabanında depoda olmayan ${orphans.length} migration kaydı var (created_at ${orphans.map(when).join(", ")}). Bir önizleme uygulamış olabilir; şemayı docs/DEPLOY.md § 7'deki gibi kontrol edin.`
    : null;
  return { error, warning, ok: `✓ Veritabanı şeması güncel (${journal.length} migration)` };
}
