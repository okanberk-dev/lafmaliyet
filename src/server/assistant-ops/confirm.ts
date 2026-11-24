import "server-only";

import { unstable_rethrow } from "next/navigation";

import { errorTag } from "@/lib/assistant/error-tag";
import { OP_STATUS_LABEL, OP_UNDO_MS, type OpOutcome, type OpStatus } from "@/lib/assistant/ops";
import { isOpName, OP_INPUTS, type OpName } from "@/lib/assistant/op-specs";
import { runViaAssistant } from "@/server/activity-via";
import { withBranchScope } from "@/server/branch-scope";

import { APPLIERS } from "./apply";
import { PREVIEWS } from "./preview";
import { cancelPlan, claimUndo, consumePlan, expirePlan, finishPlan, finishUndo, getPlan, parseOpId, settleStuck, type OpRow } from "./store";
import type { ApplyCtx, OpApplier, OpPreview } from "./types";

/*
 * Onay kartının düğmeleri (docs/ASISTAN-ISLEMLER.md › Onayda sunucuda yeniden doğrulama). Sunucu eylemleri
 * (src/server/actions/assistant-ops.ts) oturumu ve rolü alıp buraya verir; burada sıra:
 *
 * 1. Yalnız yönetici.
 * 2. Plan tek koşullu UPDATE ile tüketilir (sahibi bu kullanıcı, durumu bekliyor, süresi geçmemiş). Satır dönmezse
 *    hiçbir şey yapılmaz: başkasının kartı, ikinci dokunuş ve süresi dolan kart hiçbir şey yazmaz.
 * 3. Girdi aracın zod şemasıyla, sunucunun çözdüğü bağımsız değişkenler ve önceki değerler kendi şemalarıyla yeniden
 *    ayrıştırılır (veritabanındaki ham değer eyleme gitmez).
 * 4. Bayatlık: önizlemede okunan değer yeniden okunur; farklıysa iş yapılmaz ("değer değişti, yeniden bakın").
 * 5. Asıl eylem planın şubesiyle (withBranchScope) ve "asistan aracılığıyla" bağlamında (runViaAssistant) çağrılır;
 *    eylemin kendi yetki ve iş kuralları da çalışır. `ok: false` → failed; beklenmeyen hata → unknown (yazım olmuş
 *    olabilir, aynı plan yeniden onaylanamaz).
 */

export interface OpUser {
  id: number;
  name: string;
  role: "admin" | "staff";
}

const refused = (message: string): OpOutcome => ({ status: "refused", message, undoUntil: null });
const NOT_FOUND = "Kart bulunamadı (başka bir kullanıcının ya da silinmiş olabilir); hiçbir şey değişmedi.";
const ADMIN_ONLY = "Asistanın kartlarını yalnız yönetici onaylayabilir; hiçbir şey değişmedi.";
const UNKNOWN = "Beklenmeyen bir hata oldu; işlem yapılmış olabilir. Sonucu ilgili ekranda denetleyin, kart yeniden onaylanamaz.";

type Parts = { name: OpName; args: unknown; before: unknown; preview: OpPreview<OpName, unknown, unknown>; applier: OpApplier<unknown, unknown> };

/** Planın parçaları kendi şemalarıyla; bozuksa null */
function partsOf(row: OpRow): Parts | null {
  if (!isOpName(row.tool)) return null;
  const name = row.tool;
  if (!OP_INPUTS[name].safeParse(row.input).success) return null;
  const preview = PREVIEWS[name] as OpPreview<OpName, unknown, unknown>;
  const stored = (row.preview ?? {}) as { args?: unknown; before?: unknown };
  const args = preview.args.safeParse(stored.args);
  const before = preview.before.safeParse(stored.before);
  if (!args.success || !before.success) return null;
  return { name, args: args.data, before: before.data, preview, applier: APPLIERS[name] as OpApplier<unknown, unknown> };
}

/** Planın şimdiki durumu ve (yapılmışsa) geri al süresi: kart bunu gösterir */
function currentOf(row: OpRow): NonNullable<OpOutcome["current"]> {
  const status = row.status as OpStatus;
  const undoable = status === "done" && row.undo !== null && row.undo !== undefined && row.doneAt;
  return { status, undoUntil: undoable ? new Date(row.doneAt!.getTime() + OP_UNDO_MS).toISOString() : null };
}

/** Plan zaten işlenmiş: hiçbir şey yapılmaz, kart gerçek durumu gösterir */
function already(row: OpRow, tail: string): OpOutcome {
  const label = OP_STATUS_LABEL[row.status as OpStatus] ?? row.status;
  return { status: "refused", message: `Bu kart zaten ${label}${tail}`, undoUntil: null, current: currentOf(row) };
}

/** Planın şubesiyle (şubesiz işte isteğin seçimi) */
const scoped = <T>(row: OpRow, fn: () => Promise<T>) => (row.branch ? withBranchScope(row.branch, fn) : fn());

export async function confirmOp(me: OpUser | null, rawId: unknown, now: Date = new Date()): Promise<OpOutcome> {
  if (!me || me.role !== "admin") return refused(ADMIN_ONLY);
  const id = parseOpId(rawId);
  if (!id) return refused(NOT_FOUND);
  const row = await consumePlan(id, me.id, now);
  if (!row) {
    const existing = await getPlan(id, me.id);
    if (!existing) return refused(NOT_FOUND);
    if (existing.status === "pending" && existing.expiresAt <= now) {
      await expirePlan(id, now);
      return { status: "expired", message: "Kartın süresi doldu (10 dakika); hiçbir şey değişmedi. Asistandan yeniden isteyin.", undoUntil: null };
    }
    return already(existing, "; ikinci kez uygulanmaz.");
  }
  const parts = partsOf(row);
  if (!parts) {
    await finishPlan(id, "failed", { message: "Kartın verisi geçersiz" });
    return { status: "failed", message: "Kartın verisi geçersiz; hiçbir şey değişmedi. Asistandan yeniden isteyin.", undoUntil: null };
  }
  const ctx: ApplyCtx = { opId: id, me: { id: me.id, name: me.name } };
  try {
    const stale = await scoped(row, () => parts.preview.stale(parts.args, parts.before));
    if (stale) {
      const message = `Değer değişti, yeniden bakın: ${stale} Hiçbir şey yazılmadı.`;
      await finishPlan(id, "failed", { message });
      return { status: "failed", message, undoUntil: null };
    }
    const r = await runViaAssistant(() => scoped(row, () => parts.applier.apply(parts.args, parts.before, ctx)));
    if (!r.ok) {
      await finishPlan(id, "failed", { message: r.error });
      return { status: "failed", message: r.error, undoUntil: null };
    }
    const undo = parts.applier.undo && r.undo !== null && r.undo !== undefined ? r.undo : null;
    await finishPlan(id, "done", { message: r.message }, undo);
    return { status: "done", message: r.message, undoUntil: undo ? new Date(now.getTime() + OP_UNDO_MS).toISOString() : null };
  } catch (e) {
    await finishPlan(id, "unknown", { message: UNKNOWN }).catch(() => {});
    unstable_rethrow(e);
    console.error("[asistan] işlem", parts.name, errorTag(e));
    return { status: "unknown", message: UNKNOWN, undoUntil: null };
  }
}

/** Vazgeç: bekleyen plan "cancelled" olur; başka durumda hiçbir şey yapılmaz */
export async function cancelOp(me: OpUser | null, rawId: unknown): Promise<OpOutcome> {
  if (!me || me.role !== "admin") return refused(ADMIN_ONLY);
  const id = parseOpId(rawId);
  if (!id) return refused(NOT_FOUND);
  if (await cancelPlan(id, me.id)) return { status: "cancelled", message: "Vazgeçildi; hiçbir şey değişmedi.", undoUntil: null };
  const existing = await getPlan(id, me.id);
  return existing ? already(existing, ".") : refused(NOT_FOUND);
}

/**
 * Kartın durumu (salt okur; sekmeden geri yüklenen, işlem sürerken kalmış kart için). Yarıda kalan plan önce "unknown"
 * olur (settleStuck). Dönen `current` planın gerçek durumudur; iletisi sonuç iletisidir.
 */
export async function readOp(me: OpUser | null, rawId: unknown, now: Date = new Date()): Promise<OpOutcome> {
  if (!me || me.role !== "admin") return refused(ADMIN_ONLY);
  const id = parseOpId(rawId);
  if (!id) return refused(NOT_FOUND);
  await settleStuck(id, me.id, now);
  const row = await getPlan(id, me.id);
  if (!row) return refused(NOT_FOUND);
  const result = (row.result ?? {}) as { message?: unknown; undoMessage?: unknown };
  const message = typeof result.undoMessage === "string" ? result.undoMessage : typeof result.message === "string" ? result.message : "";
  const current = currentOf(row);
  return { status: "refused", message: message || `Kart ${OP_STATUS_LABEL[current.status] ?? current.status}.`, undoUntil: null, current };
}

/** Sonuç kartının Geri al'ı: yalnız katalogda geri alması tanımlı ve süresi (1 saat) geçmemiş işlemde, bir kez */
export async function undoOp(me: OpUser | null, rawId: unknown, now: Date = new Date()): Promise<OpOutcome> {
  if (!me || me.role !== "admin") return refused(ADMIN_ONLY);
  const id = parseOpId(rawId);
  if (!id) return refused(NOT_FOUND);
  const row = await claimUndo(id, me.id, new Date(now.getTime() - OP_UNDO_MS));
  if (!row) return refused("Bu işlem kartla geri alınamaz (süresi geçti, zaten geri alındı ya da geri alması yok).");
  const parts = partsOf(row);
  if (!parts?.applier.undo) {
    await finishUndo(id, "done", "Geri alma tanımlı değil");
    return refused("Bu işlemin kartla geri alması yok.");
  }
  const undoUntil = row.doneAt ? new Date(row.doneAt.getTime() + OP_UNDO_MS).toISOString() : null;
  try {
    const r = await runViaAssistant(() => scoped(row, () => parts.applier.undo!(parts.args, parts.before, row.undo, { opId: id, me: { id: me.id, name: me.name } })));
    if (!r.ok) {
      await finishUndo(id, "done", r.error);
      return { status: "done", message: `Geri alınamadı: ${r.error}`, undoUntil };
    }
    await finishUndo(id, "undone", r.message);
    return { status: "undone", message: r.message, undoUntil: null };
  } catch (e) {
    await finishUndo(id, "unknown", UNKNOWN).catch(() => {});
    unstable_rethrow(e);
    console.error("[asistan] geri al", parts.name, errorTag(e));
    return { status: "unknown", message: UNKNOWN, undoUntil: null };
  }
}
