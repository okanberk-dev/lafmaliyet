import "server-only";

import { todayTR } from "@/lib/reminders";
import { cleanName, formatShiftCell, nameRef, parseShiftCell, refUserId, userRef, weekStart } from "@/lib/vardiya";
import { draftPeople, draftToCells, draftWeekSchema, SHIFT_DRAFT_SYSTEM, ShiftDraftRaw, shiftDraftTask, type DraftResult, type DraftWeekInput } from "@/lib/vardiya-taslak";
import { extractText, shiftDraftStatus } from "@/server/ai/claude";
import { listBranches } from "@/server/branches";
import { schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

import { loadShiftPresets } from "./presets";
import { shiftBranches, shiftCandidate } from "./store";

/** Vardiya ekranı için: yazarak doldurma kullanılabilir mi ("on" | "nokey" | "off" | "cap"); anahtarın kendisi dönmez */
export const shiftDraftState = async (now: Date = new Date()) => (await shiftDraftStatus(now)).state;

/**
 * Vardiyayı yazarak doldurma: yöneticinin metnini Claude'a gönderir, dönen atamaları ızgaranın hücrelerine çevirir
 * (kurallar ve istem src/lib/vardiya-taslak.ts; kapılar ve maliyet günlüğü src/server/ai/claude.ts; docs/VARDIYA.md).
 * **Veritabanına hiçbir şey yazmaz**: sonuç ekrana taslak olarak döner, plan ancak yönetici "Kaydet"e basınca yazılır
 * (saveShiftWeek, aynı okuyucu). Yetkiyi eylem denetler (yalnız yönetici).
 *
 * Servise gidenler: şubenin adı, haftanın tarihleri, ızgaradaki kişilerin **adı**, o anki plan ve yazılan metin.
 * E-posta, telefon, rol ve hesap kimliği gitmez (kişiler "p1", "p2" anahtarlarıyla gider).
 */
export async function draftShiftWeek(db: DB, me: { id: number }, raw: DraftWeekInput, now: Date = new Date()): Promise<DraftResult> {
  const data = draftWeekSchema.parse(raw);
  const monday = weekStart(data.week);
  const branch = shiftBranches(await listBranches(db)).find((b) => b.id === data.branchId);
  if (!branch) throw new UserError("Şube bulunamadı ya da kapalı; sayfayı yenileyin.");
  const users = await db.select({ id: s.users.id, name: s.users.name, active: s.users.active, role: s.users.role, branchId: s.users.branchId }).from(s.users);
  const byId = new Map(users.map((u) => [u.id, u]));
  const seen = new Set<string>();
  const rows = data.rows.flatMap((r) => {
    const uid = refUserId(r.ref);
    const typed = cleanName(r.name);
    // Hesabı duran kişi güncel adıyla (istemcinin gönderdiği ad eski olabilir); hesabı olmayan çalışan yazılan adıyla
    const name = uid !== null ? (byId.get(uid)?.name ?? typed) : typed;
    const ref = uid !== null ? userRef(uid) : nameRef(typed);
    if (!name || seen.has(ref)) return [];
    seen.add(ref);
    // Okunamayan kutu modele boş gider (ekran onu zaten kırmızı gösterir)
    const cells = r.cells.map((t) => {
      const p = parseShiftCell(t);
      return p.ok ? formatShiftCell(p.cell) : "";
    });
    return [{ ref, userId: uid !== null && byId.has(uid) ? uid : null, name, cells }];
  });
  // Hazır vardiyalar şubenin ayarından (ekrandaki S / A düğmeleriyle aynı saatler)
  const ctx = { branch: { id: branch.id, name: branch.name }, presets: await loadShiftPresets(branch.id, db), monday, today: todayTR(now), people: draftPeople(rows) };
  const res = await extractText({ userId: me.id, system: SHIFT_DRAFT_SYSTEM, task: shiftDraftTask(ctx, data.prompt), schema: ShiftDraftRaw });
  if (!res.ok) throw new UserError(res.message);
  // Yeni kişi adı ızgarada olmayan etkin bir hesabınkiyse o hesabın satırı olur ("Kişi ekle" ile aynı)
  // Başka şubeye kilitli hesap önerilmez (şube kapsamı C P2-11; shiftCandidate)
  const accounts = users.filter((u) => u.active && !seen.has(userRef(u.id)) && shiftCandidate(u, branch.id)).map((u) => ({ id: u.id, name: u.name }));
  return draftToCells(res.data, ctx, accounts);
}
