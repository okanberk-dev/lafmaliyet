import "server-only";

import { OP_TTL_MS, type OpCard } from "@/lib/assistant/ops";
import { OP_INPUTS, type OpName } from "@/lib/assistant/op-specs";
import type { BranchScope } from "@/lib/branches";
import { cleanName, ToolInputError } from "@/lib/mcp/answers/common";
import { listBranches } from "@/server/branches";

import { PREVIEWS } from "./preview";
import { createPlan } from "./store";

/*
 * Sohbetin işlem aracı → plan ve onay kartı (docs/ASISTAN-ISLEMLER.md › Öneri ile yazım ayrıdır). Burada hiçbir eylem
 * çağrılmaz ve içe aktarılmaz (kaynak testi): önizleme salt okur, yalnız plan satırı yazılır. Yazım yalnız kartın
 * Onayla düğmesinin sunucu eyleminde (src/server/actions/assistant-ops.ts → confirm.ts).
 */

export interface PlanUser {
  id: number;
  role: "admin" | "staff";
}

/**
 * Modelin girdisinden onay kartı: rol, şema (yeniden), önizleme, plan satırı. Kart açılamıyorsa (bulunamadı, birden
 * çok aday, değişiklik yok, şube belirsiz) ToolInputError: metni asistana döner.
 */
export async function planOp(me: PlanUser, name: OpName, raw: unknown, ctx: { scope: BranchScope; now?: Date; signal?: AbortSignal }): Promise<OpCard> {
  // Rol araç listesi kurulurken de denetlenir (uç yalnız yöneticiye açılır); burada ikinci kez
  if (me.role !== "admin") throw new ToolInputError("İşlem kartını yalnız yönetici açabilir.");
  const parsed = OP_INPUTS[name].safeParse(raw);
  if (!parsed.success) throw new ToolInputError(`Girdi geçersiz: ${parsed.error.issues[0]?.message ?? "biçim"}`);
  const input = parsed.data;
  const now = ctx.now ?? new Date();
  const preview = PREVIEWS[name] as unknown as { preview(i: unknown, c: unknown): Promise<{ card: Omit<OpCard, "id" | "expiresAt" | "note" | "tool">; args: unknown; before: unknown; branch: string | null }> };
  const plan = await preview.preview(input, { userId: me.id, scope: ctx.scope, branches: await listBranches(), now });
  // Aracın süresi doldu ya da yanıt durduruldu: plan satırı açılmaz (model başarısız saydı, kart gösterilmeyecek)
  if (ctx.signal?.aborted) throw new ToolInputError("Kart zamanında hazırlanamadı; hiçbir şey değişmedi.");
  const expiresAt = new Date(now.getTime() + OP_TTL_MS);
  const { id } = await createPlan({ userId: me.id, tool: name, input, preview: { card: plan.card, args: plan.args, before: plan.before }, branch: plan.branch, expiresAt });
  const note = (input as { not?: string }).not;
  return { ...plan.card, id, tool: name, note: note ? cleanName(note, 200) : null, expiresAt: expiresAt.toISOString() };
}
