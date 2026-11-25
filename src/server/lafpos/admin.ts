import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { LAFPOS_GROUP } from "@/lib/branch-settings/groups";
import { LAFPOS_STATE_KEY } from "@/lib/lafpos/status";
import { branchSwitchDay, dayMonthYearTR, isLafposDay, switchDayProblem } from "@/lib/lafpos/switch";
import { lockGroup, putBranchSetting, resolveBranchSetting } from "@/server/branch-settings";
import { schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

import { lafposBranchId, lafposSwitchDay } from "./branch";
import { detachLafposCashOuts } from "./cash-moves";

/**
 * Ayarlar › LafPOS (kasa) kartının iki yazımı (docs/LAFPOS.md › Geçiş günü, Durum ve onarım), eylemlerden ayrı ve
 * veritabanını parametre alarak (tests/lafpos-durum-db.test.ts doğrudan çalıştırır). İkisi de yalnız yöneticinin:
 * eylem (src/server/actions/lafpos.ts) oturumu ve parolayı denetler, burada da rol yeniden denetlenir.
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };

export const ADMIN_ONLY = "Bu işlemi yalnız yönetici yapabilir";

const switchText = (v: string | null) => (v ? dayMonthYearTR(v) : "yok (kasa ModPOS)");

/**
 * Geçiş gününü yazar (null: siler, kasa yeniden ModPOS). Hiçbir veri yazılmaz ya da silinmez, yalnız okuyanlar değişir.
 * Değişiklik yoksa null; varsa işlem geçmişinin metni ("LafPOS'a geçiş günü: yok → 10 Kasım 2026").
 */
export async function writeLafposSwitchDay(db: DB, me: Actor, day: string | null, today: string): Promise<string | null> {
  if (me.role !== "admin") throw new UserError(ADMIN_ONLY);
  if (day !== null) {
    const problem = switchDayProblem(day, today);
    if (problem) throw new UserError(problem);
  }
  // LafPOS'un şubesinin şube ayarına yazılır (grup pos.lafpos; docs/SUBE.md › Şube başına ayarlar). İlk kayıtta satır
  // açılır, eski genel kayıt (settings › lafposGecisGunu) bırakılır: satırı olan şube onu bir daha okumaz
  const branchId = await lafposBranchId(db);
  return db.transaction(async (tx) => {
    await lockGroup(tx, LAFPOS_GROUP.id);
    const prev = (await resolveBranchSetting(LAFPOS_GROUP, branchId, tx)).value.switchDay;
    if (prev === day) return null;
    await putBranchSetting(tx, LAFPOS_GROUP, branchId, { switchDay: day }, me.name);
    return `LafPOS'a geçiş günü: ${switchText(prev)} → ${switchText(day)}`;
  });
}

/**
 * Bir günün LafPOS kaydını siler (409 z_conflict'in çözümü: LafPOS'taki Z doğruysa paneldeki eski kayıt silinir; ya da
 * deneme gününün temizliği). LafPOS reddedilen ya da silinen günü kendisi yeniden göndermez: yenisi LafPOS'ta Kasa ›
 * Geçmiş günler › o günün Z raporu › Gönder ile gelir (LAFPOS_RESEND_PATH). Gün sonunun yazımıyla aynı danışma kilidi
 * altında, tek işlemde: günün özeti (pos_day_reports) ve satırları (pos_daily_sales). `zNo`: yöneticinin gördüğü Z; bu
 * arada gün başka bir Z ile yeniden yazıldıysa silinmez. Durum satırındaki o günün reddi yalnız bu silmenin çözdüğü
 * çakışmaysa (409, aynı Z) "silindi" olur (kart kırmızı yerine "Gönder bekleniyor" der); aynı günün 400'ü olduğu gibi
 * kalır (alanı ve nedeni görünmeye devam eder). Sürüm geçmişi (pos_day_revisions) silinmez: silinen Z'nin gövdeleri
 * denetim için kalır, sonra gelen yeni Z'nin gövdeleri aynı güne eklenir (docs/LAFPOS.md › Sürüm geçmişi). Kasadan
 * çıkanlar'daki günün LafPOS satırları LafPOS'tan ayrılır (cash-moves.ts detachLafposCashOuts; inceleme LM-3): gün
 * sayılmıyorsa (deneme günü) LafPOS'un açtığı satırlar kalkar, sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır
 * kalır; sayılan günde (409'un çözümü) satırların hepsi kalır, yeni Z gelince yeniden sahiplenilir.
 */
export async function removeLafposDay(db: DB, me: Actor, date: string, zNo: number, now: Date = new Date()): Promise<{ zNo: number; lines: number }> {
  if (me.role !== "admin") throw new UserError(ADMIN_ONLY);
  // LafPOS'un şubesi (türetilmiş, branch.ts): gün sonunu yazanla aynı kilit ve aynı şube
  const branchId = await lafposBranchId(db);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lafpos-gun:${branchId}:${date}`}))`);
    // Yalnız LafPOS'un şubesinin günü (başka şubenin aynı günkü kaydına dokunulmaz)
    const [rep] = await tx.select({ z: s.posDayReports.z }).from(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId))).limit(1);
    if (!rep) throw new UserError("Bu günün LafPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin");
    if (rep.z.zNo !== zNo) throw new UserError(`Bu gün bu arada Z ${rep.z.zNo} ile yeniden gönderildi; sayfayı yenileyip yeniden bakın`);
    const lines = await tx.delete(s.posDailySales).where(and(eq(s.posDailySales.date, date), eq(s.posDailySales.branchId, branchId))).returning({ id: s.posDailySales.id });
    await tx.delete(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)));
    // Geçiş günü LafPOS'un şubesinin kasasınındır (branchSwitchDay): bu gün o şubenin günü
    const counted = isLafposDay(date, branchSwitchDay(await lafposSwitchDay(tx), branchId, branchId));
    await detachLafposCashOuts(tx, date, counted ? "release" : "drop", { by: { id: me.id, name: me.name }, branchId });
    await tx.execute(sql`
      update integration_state
         set value = jsonb_set(value, array['rejections', ${date}::text, 'clearedAt'], to_jsonb(${now.toISOString()}::text)), updated_at = now()
       where key = ${LAFPOS_STATE_KEY}
         and value->'rejections'->${date}::text->>'error' = 'z_conflict'
         and (value->'rejections'->${date}::text->>'zNo')::int = ${rep.z.zNo}::int`);
    return { zNo: rep.z.zNo, lines: lines.length };
  });
}
