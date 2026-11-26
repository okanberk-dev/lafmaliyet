"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dateTR, money } from "@/lib/format";
import { DECISIONS, manualCandidates, RECORD_KINDS, RECORD_LABEL, type Candidate } from "@/lib/mutabakat/match";
import { parseStatement, type Cell, type ColumnMap, type Grid, type ParsedLine, type StatementKind } from "@/lib/mutabakat/parse";
import { accountName, ACCOUNT_MAX, bankScope, decisionProblem, KIND_LABEL } from "@/lib/mutabakat/view";
import { todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { readStatementFile } from "@/server/mutabakat/file";
import { candidateFor, loadLinePool, resolveSupplier } from "@/server/mutabakat/load";
import { countDuplicates, insertStatement, removeStatement, writeDecision, writePosBlockDays } from "@/server/mutabakat/store";

import { logActivity } from "./log";
import { attempt, UserError, type ActionResult } from "./util";

// Mutabakat (yalnız yönetici; docs/MUTABAKAT.md): ekstre yükleme (önizleme ve kayıt), silme, satırın kararı (elle
// eşleştir, yok say, ayır, POS hakedişi) ve POS bloke günü. Yüklenen dosya yalnız bellekte okunur, saklanmaz; panel
// kayıtlarına (fatura, harcama, ödeme) hiçbir şey yazılmaz.

const ACTION = "Mutabakat";

const zCol = z.number().int().min(0).max(200);
const zMap = z.object({
  headerRow: z.number().int().min(0).max(200),
  date: zCol,
  description: zCol.nullable(),
  amount: zCol.nullable(),
  debit: zCol.nullable(),
  credit: zCol.nullable(),
  balance: zCol.nullable(),
  ref: zCol.nullable(),
});

const zKind = z.enum(["banka", "tedarikci"], { message: "Ekstrenin türünü seçin" });

/** Önizlemede gösterilen ham satır ve sütun sayısı (başlığı ve sütunları seçmek için) */
const RAW_ROWS = 40;
const RAW_COLS = 16;

const cellText = (c: Cell): string => (c instanceof Date ? dateTR(c.toISOString().slice(0, 10)) : c === null || c === undefined ? "" : String(c).trim().slice(0, 40));

function rawRows(grid: Grid): { rows: string[][]; width: number } {
  const rows = grid.slice(0, RAW_ROWS).map((r) => (r ?? []).slice(0, RAW_COLS).map(cellText));
  return { rows, width: Math.min(RAW_COLS, Math.max(0, ...rows.map((r) => r.length))) };
}

/** Formdaki dosya ve seçimler → okunmuş ekstre */
async function readUpload(fd: FormData) {
  const kind: StatementKind = zKind.parse(fd.get("kind"));
  const rawMap = fd.get("map");
  let map: ColumnMap | null = null;
  if (typeof rawMap === "string" && rawMap) {
    try {
      map = zMap.parse(JSON.parse(rawMap));
    } catch {
      throw new UserError("Sütun seçimi okunamadı; yeniden seçin");
    }
  }
  const flip = fd.get("flip") === "1";
  const { grid, name } = await readStatementFile(fd.get("file"));
  return { kind, grid, name, flip, parsed: parseStatement(grid, { kind, map, flip }) };
}

/** Hesabın kimliği ve adı: banka hesabının adı ya da seçilen tedarikçi */
async function accountOf(kind: StatementKind, fd: FormData) {
  if (kind === "banka") {
    const account = accountName(String(fd.get("account") ?? ""));
    if (!account) throw new UserError("Banka hesabının adını yazın (ör. Garanti TL)");
    if (account.length > ACCOUNT_MAX) throw new UserError(`Hesap adı en çok ${ACCOUNT_MAX} harf olabilir`);
    return { account, scope: bankScope(account), cardId: null, names: [] as string[] };
  }
  const slug = String(fd.get("supplier") ?? "").trim();
  if (!slug) throw new UserError("Tedarikçiyi seçin");
  const sup = await resolveSupplier(slug);
  if (!sup) throw new UserError("Tedarikçi bulunamadı; listeyi yenileyip yeniden seçin");
  return { account: sup.name, scope: sup.scope, cardId: sup.cardId, names: sup.keys };
}

export type PreviewResult =
  | { status: "map"; error: string; headers: string[]; headerRow: number; rows: string[][]; width: number }
  | {
      status: "ready";
      count: number;
      skipped: number;
      period: { from: string; to: string };
      map: ColumnMap;
      headers: string[];
      sample: ParsedLine[];
      /** Giren (+) ve çıkan (−) toplamı */
      plus: number;
      minus: number;
      /** Bu hesaba önceden yazılmış hareket sayısı (hesap seçilmediyse null) */
      duplicates: number | null;
      rows: string[][];
      width: number;
    };

/**
 * Önizleme: dosyayı okur, sütunları tanır (ya da verilen seçimle okur) ve ilk satırları, dönemi, toplamları ve önceden
 * yüklenmiş hareket sayısını döner. Hiçbir şey yazılmaz.
 */
export async function previewStatement(fd: FormData): Promise<ActionResult<PreviewResult>> {
  return attempt(async () => {
    await requireAdmin();
    const { kind, grid, parsed } = await readUpload(fd);
    const raw = rawRows(grid);
    if ("error" in parsed) return { status: "map" as const, error: parsed.error, headers: parsed.headers, headerRow: parsed.headerRow, ...raw };
    if (!parsed.lines.length) return { status: "map" as const, error: "Seçilen sütunlarda tarih ve tutarı okunabilen satır yok", headers: parsed.headers, headerRow: parsed.map.headerRow, ...raw };
    let duplicates: number | null = null;
    const hasAccount = kind === "banka" ? Boolean(accountName(String(fd.get("account") ?? ""))) : Boolean(String(fd.get("supplier") ?? "").trim());
    if (hasAccount) {
      try {
        duplicates = await countDuplicates((await accountOf(kind, fd)).scope, parsed.lines);
      } catch {
        duplicates = null;
      }
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const dates = parsed.lines.map((l) => l.date).sort();
    return {
      status: "ready" as const,
      count: parsed.lines.length,
      skipped: parsed.skipped,
      period: { from: dates[0], to: dates[dates.length - 1] },
      map: parsed.map,
      headers: parsed.headers,
      sample: parsed.lines.slice(0, 8),
      plus: r2(parsed.lines.reduce((a, l) => a + Math.max(0, l.amount), 0)),
      minus: r2(parsed.lines.reduce((a, l) => a + Math.min(0, l.amount), 0)),
      duplicates,
      ...raw,
    };
  });
}

/**
 * Ekstreyi kaydeder: dosya yeniden okunur (önizlemeyle aynı seçimle), satırlar yazılır; bu hesaba önceden yazılmış
 * hareketler atlanır. Dosya saklanmaz.
 */
export async function saveStatement(fd: FormData): Promise<ActionResult<{ id: number; inserted: number; duplicates: number }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const { kind, name, parsed } = await readUpload(fd);
    if ("error" in parsed) throw new UserError(parsed.error);
    if (!parsed.lines.length) throw new UserError("Dosyada okunabilen hareket yok");
    const acc = await accountOf(kind, fd);
    const res = await insertStatement({
      kind,
      account: acc.account,
      supplierCardId: acc.cardId,
      supplierNames: acc.names,
      fileName: name,
      scope: acc.scope,
      lines: parsed.lines,
      uploadedOn: todayTR(),
      by: { id: me.id, name: me.name },
    });
    await logActivity(
      me,
      ACTION,
      `${KIND_LABEL[kind]} ekstresi yüklendi: ${acc.account}, ${dateTR(res.period.from)}–${dateTR(res.period.to)}, ${res.inserted} hareket${res.duplicates ? ` (${res.duplicates} hareket önceden yüklenmişti)` : ""}`,
    );
    refresh();
    return { id: res.id, inserted: res.inserted, duplicates: res.duplicates };
  });
}

/** Ekstreyi ve satırlarını (kararlarıyla) siler */
export async function deleteStatement(id: number): Promise<ActionResult> {
  return attempt(async () => {
    const me = await requireAdmin();
    const sid = z.number().int().positive().parse(id);
    const row = await removeStatement(sid);
    if (!row) throw new UserError("Ekstre bulunamadı (silinmiş olabilir)");
    await logActivity(me, ACTION, `${KIND_LABEL[row.kind]} ekstresi silindi: ${row.account}, ${dateTR(row.periodFrom)}–${dateTR(row.periodTo)}, ${row.lineCount} hareket`);
    refresh();
    return null;
  });
}

const decisionInput = z.object({
  lineId: z.number().int().positive(),
  decision: z.enum(DECISIONS).nullable(),
  match: z.object({ kind: z.enum(RECORD_KINDS), id: z.number().int().positive() }).nullish(),
});

/**
 * Satırın kararı: `elle` (seçilen kayıtla eşleşir), `yoksay`, `ayir` (kendiliğinden eşleşmez), `pos` (POS hakedişi
 * say; yalnız banka) ya da null (kararı kaldır, kendiliğinden eşleşmeye döner). Elle seçilen kayıt satırın havuzunda
 * olmalı ve başka bir satıra elle bağlı olmamalı.
 */
export async function decideLine(input: z.input<typeof decisionInput>): Promise<ActionResult> {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = decisionInput.parse(input);
    const found = await loadLinePool(data.lineId);
    if (!found) throw new UserError("Satır bulunamadı (ekstre silinmiş olabilir)");
    let candidate: Candidate | null = null;
    if (data.decision === "elle") {
      if (!data.match) throw new UserError("Eşleştirilecek kaydı seçin");
      const hit = candidateFor(found.pool, data.lineId, data.match.kind, data.match.id);
      if (hit.takenBy !== null) throw new UserError("Bu kayıt başka bir satırla elle eşleştirildi; önce oradaki eşleşmeyi geri alın");
      candidate = hit.candidate;
    }
    const problem = decisionProblem(found.kind, data.decision, found.line, candidate);
    if (problem) throw new UserError(problem);
    await writeDecision(data.lineId, data.decision, candidate ? { kind: candidate.kind, id: candidate.id } : null, me.name);
    const l = found.line;
    const what =
      data.decision === "elle" && candidate
        ? `${RECORD_LABEL[candidate.kind]} ile eşleştirildi: ${candidate.label}`
        : data.decision === "yoksay"
          ? "yok sayıldı"
          : data.decision === "ayir"
            ? "eşleşmesi ayrıldı"
            : data.decision === "pos"
              ? "POS hakedişi sayıldı"
              : "karar geri alındı";
    await logActivity(me, ACTION, `${dateTR(l.date)} ${money(l.amount)} ${l.description.slice(0, 60)}: ${what}`);
    refresh();
    return null;
  });
}

/** Elle eşleştirme penceresinin seçenekleri: satırın havuzunda boşta kalan (ya da bu satıra bağlı) kayıtlar */
export async function manualOptions(lineId: number): Promise<ActionResult<{ options: Candidate[]; current: { kind: string; id: number } | null }>> {
  return attempt(async () => {
    await requireAdmin();
    const id = z.number().int().positive().parse(lineId);
    const found = await loadLinePool(id);
    if (!found) throw new UserError("Satır bulunamadı (ekstre silinmiş olabilir)");
    const mine = found.pool.rows.find((r) => r.line.id === id)?.candidate ?? null;
    const options = manualCandidates(found.line, mine ? [mine, ...found.pool.free] : found.pool.free);
    return { options, current: mine ? { kind: mine.kind, id: mine.id } : null };
  });
}

/** POS hakedişinin bloke günü (satıştan kaç gün sonra hesaba geçer) */
export async function savePosBlockDays(days: number): Promise<ActionResult<{ before: number }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const value = z.number({ message: "Bloke gününü yazın" }).parse(days);
    const before = await writePosBlockDays(value);
    if (before !== value) await logActivity(me, ACTION, `POS bloke günü: ${before} → ${value} gün`);
    refresh();
    return { before };
  });
}
