import "server-only";

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import type { Decision, RecordKind } from "@/lib/mutabakat/match";
import { expiryOf } from "@/lib/mutabakat/match";
import { lineFingerprints, periodOf, type ParsedLine, type StatementKind } from "@/lib/mutabakat/parse";
import { DEFAULT_BLOCK_DAYS, blockDaysError } from "@/lib/mutabakat/pos";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

// Mutabakatın yazma yolu (docs/MUTABAKAT.md): ekstre ve satırları, satırın kararı, POS bloke günü ve saklama süresi
// dolan ekstrelerin silinmesi (günlük iş). Yüklenen dosya buraya hiç gelmez: yalnız okunmuş satırlar.

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface NewStatement {
  kind: StatementKind;
  account: string;
  supplierCardId: number | null;
  supplierNames: string[];
  fileName: string | null;
  /** Hesabın kimliği (src/lib/mutabakat/view.ts bankScope / supplierScope) */
  scope: string;
  lines: readonly ParsedLine[];
  uploadedOn: string;
  by: { id: number | null; name: string };
}

const CHUNK = 500;

/** Bu hesapta zaten yazılmış parmak izleri */
async function existingFingerprints(tx: Tx | DB, scope: string, prints: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < prints.length; i += CHUNK) {
    const part = prints.slice(i, i + CHUNK);
    const rows = await tx
      .select({ f: s.reconLines.fingerprint })
      .from(s.reconLines)
      .where(and(eq(s.reconLines.scope, scope), inArray(s.reconLines.fingerprint, part)));
    for (const r of rows) out.add(r.f);
  }
  return out;
}

/** Önizleme: dosyadaki hareketlerden kaçı bu hesaba önceden yazılmış */
export async function countDuplicates(scope: string, lines: readonly ParsedLine[], db: DB = getDb()): Promise<number> {
  return (await existingFingerprints(db, scope, lineFingerprints(lines))).size;
}

/**
 * Ekstreyi ve yeni satırlarını yazar (tek işlem). Bu hesaba önceden yazılmış hareketler atlanır (`duplicates`); hepsi
 * yazılmışsa ekstre açılmaz. Aynı anda gelen iki yükleme aynı satırı iki kez yazamaz (benzersiz indeks).
 */
export async function insertStatement(input: NewStatement, db: DB = getDb()): Promise<{ id: number; inserted: number; duplicates: number; period: { from: string; to: string } }> {
  const period = periodOf(input.lines);
  if (!period) throw new UserError("Dosyada okunabilen hareket yok");
  const prints = lineFingerprints(input.lines);
  return db.transaction(async (tx) => {
    const known = await existingFingerprints(tx, input.scope, prints);
    const fresh = input.lines.map((l, i) => ({ l, f: prints[i] })).filter((x) => !known.has(x.f));
    if (!fresh.length) throw new UserError("Bu ekstrenin bütün hareketleri daha önce yüklenmiş");
    const [st] = await tx
      .insert(s.reconStatements)
      .values({
        kind: input.kind,
        account: input.account,
        supplierCardId: input.kind === "tedarikci" ? input.supplierCardId : null,
        supplierNames: input.kind === "tedarikci" ? input.supplierNames : [],
        fileName: input.fileName,
        periodFrom: period.from,
        periodTo: period.to,
        uploadedOn: input.uploadedOn,
        expiresOn: expiryOf(input.uploadedOn),
        createdBy: input.by.id,
        createdByName: input.by.name,
      })
      .returning({ id: s.reconStatements.id });
    let inserted = 0;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const rows = await tx
        .insert(s.reconLines)
        .values(
          fresh.slice(i, i + CHUNK).map(({ l, f }) => ({
            statementId: st.id,
            scope: input.scope,
            fingerprint: f,
            rowNo: l.rowNo,
            date: l.date,
            description: l.description,
            amount: l.amount,
            balance: l.balance,
            ref: l.ref,
          })),
        )
        .onConflictDoNothing({ target: [s.reconLines.scope, s.reconLines.fingerprint] })
        .returning({ id: s.reconLines.id });
      inserted += rows.length;
    }
    if (!inserted) throw new UserError("Bu ekstrenin bütün hareketleri daha önce yüklenmiş");
    const duplicates = input.lines.length - inserted;
    await tx.update(s.reconStatements).set({ lineCount: inserted, duplicates }).where(eq(s.reconStatements.id, st.id));
    return { id: st.id, inserted, duplicates, period };
  });
}

/** Ekstreyi ve satırlarını siler; silinenin özeti (yoksa null) */
export async function removeStatement(id: number, db: DB = getDb()) {
  const [row] = await db.delete(s.reconStatements).where(eq(s.reconStatements.id, id)).returning();
  return row ?? null;
}

/** Satırın kararı (null: kaldır). `match` yalnız `elle`de */
export async function writeDecision(
  lineId: number,
  decision: Decision | null,
  match: { kind: RecordKind; id: number } | null,
  by: string,
  db: DB = getDb(),
): Promise<boolean> {
  const rows = await db
    .update(s.reconLines)
    .set({
      decision,
      matchKind: decision === "elle" ? (match?.kind ?? null) : null,
      matchId: decision === "elle" ? (match?.id ?? null) : null,
      decidedByName: decision ? by : null,
      decidedAt: decision ? new Date() : null,
    })
    .where(eq(s.reconLines.id, lineId))
    .returning({ id: s.reconLines.id });
  return rows.length > 0;
}

/**
 * Saklama süresi dolan ekstreleri siler (günlük iş; satırlar CASCADE ile). `today` saklamanın son gününden sonraysa.
 * Silinen ekstre sayısı döner.
 */
export async function purgeExpiredStatements(db: DB, today: string): Promise<number> {
  const rows = await db.delete(s.reconStatements).where(lt(s.reconStatements.expiresOn, today)).returning({ id: s.reconStatements.id });
  return rows.length;
}

// ---------------------------------------------------------------- POS bloke günü

/** Ayarın anahtarı (settings; ayar ekranında değil, Mutabakat › POS hakediş'te değişir) */
export const POS_BLOCK_DAYS_SETTING = "mutabakatPosBlokeGunu";

export async function readPosBlockDays(db: DB = getDb()): Promise<number> {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, POS_BLOCK_DAYS_SETTING)).limit(1);
  const v = row?.value;
  return typeof v === "number" && blockDaysError(v) === null ? v : DEFAULT_BLOCK_DAYS;
}

/** Bloke gününü yazar; önceki değer döner */
export async function writePosBlockDays(days: number, db: DB = getDb()): Promise<number> {
  const problem = blockDaysError(days);
  if (problem) throw new UserError(problem);
  return db.transaction(async (tx) => {
    const before = await readPosBlockDays(tx as unknown as DB);
    await tx
      .insert(s.settings)
      .values({ key: POS_BLOCK_DAYS_SETTING, value: days })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: sql`excluded.value`, updatedAt: new Date() } });
    return before;
  });
}
