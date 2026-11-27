import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { ASILPOS_GROUP } from "@/lib/branch-settings/groups";
import { GUN_KILIDI_ONEKI } from "@/lib/asilpos/eski-adlar";
import { ASILPOS_STATE_KEY, ASILPOS_STATE_KEY_NEW, stateKeysOf } from "@/lib/asilpos/status";
import { dayMonthYearTR, isAsilposDay, switchAffectedMonths, switchDayProblem } from "@/lib/asilpos/switch";
import { lockRefusal } from "@/lib/closed-period";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import { lockGroup, putBranchSetting, resolveBranchSetting } from "@/server/branch-settings";
import { loadClosedPeriods } from "@/server/closed-period";
import { schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

import { forgetPosBranches, switchDayOf } from "./branch";
import { loadPosTillIds } from "../pos/tills";
import { detachAsilposCashOuts } from "./cash-moves";

/**
 * Ayarlar › AsilPOS (kasa) kartının iki yazımı (docs/ASILPOS.md › Geçiş günü, Durum ve onarım), eylemlerden ayrı ve
 * veritabanını parametre alarak (tests/asilpos-durum-db.test.ts doğrudan çalıştırır). İkisi de yalnız yöneticinin:
 * eylem (src/server/actions/asilpos.ts) oturumu ve parolayı denetler, burada da rol yeniden denetlenir.
 */

type Actor = { id: number; name: string; role: "admin" | "staff" };

export const ADMIN_ONLY = "Bu işlemi yalnız yönetici yapabilir";

const switchText = (v: string | null) => (v ? dayMonthYearTR(v) : "yok (kasa ModPOS)");

/**
 * Bir kasanın geçiş gününü yazar (null: siler, kasa yeniden ModPOS gibi sayılır). Çok şube (27 Kasım 2026): her AsilPOS
 * kasasının kendi günü, yalnız kasası AsilPOS olan şubeye yazılır (şubenin ayarı, grup SUBE_AYAR_GRUBU). Eski genel kayda
 * (settings) artık yazılmaz. Değişikliğin etkilediği aylardan biri kapalı dönemdeyse (docs/DONEM-KAPANISI.md) yazılmaz:
 * kapanmış ayların rakamı değişirdi. Hiçbir veri yazılmaz ya da silinmez, yalnız okuyanlar değişir. Değişiklik yoksa null;
 * varsa işlem geçmişinin metni ("Marina: AsilPOS'a geçiş günü: yok → 10 Kasım 2026").
 */
export async function writeAsilposSwitchDay(db: DB, me: Actor, branchId: string, day: string | null, today: string): Promise<string | null> {
  if (me.role !== "admin") throw new UserError(ADMIN_ONLY);
  if (day !== null) {
    const problem = switchDayProblem(day, today);
    if (problem) throw new UserError(problem);
  }
  const [branch] = await db.select({ id: s.branches.id, name: s.branches.name }).from(s.branches).where(eq(s.branches.id, branchId)).limit(1);
  if (!branch) throw new UserError("Şube bulunamadı; sayfayı yenileyin");
  if (!(await loadPosTillIds(db, Date.now(), true)).ids.includes(branchId)) {
    throw new UserError(`${branch.name} şubesinin kasası AsilPOS değil; geçiş günü yalnız kasası AsilPOS olan şubeye yazılır (Ayarlar › Şubeler › kasa kaynağı)`);
  }
  const result = await db.transaction(async (tx) => {
    await lockGroup(tx, ASILPOS_GROUP.id);
    const prev = (await resolveBranchSetting(ASILPOS_GROUP, branchId, tx)).value.switchDay;
    if (prev === day) return null;
    // Kapalı dönem (R7): kaynağı değişen günlerin ayları (switchAffectedMonths) kapalı olmamalı
    const refusal = lockRefusal(
      switchAffectedMonths(prev, day, today).map((m) => `${m}-01`),
      await loadClosedPeriods(tx),
    );
    if (refusal) throw new UserError(refusal);
    await putBranchSetting(tx, ASILPOS_GROUP, branchId, { switchDay: day }, me.name);
    return `${branch.name}: AsilPOS'a geçiş günü: ${switchText(prev)} → ${switchText(day)}`;
  });
  if (result) forgetPosBranches();
  return result;
}

/**
 * Bir günün AsilPOS kaydını siler (409 z_conflict'in çözümü: AsilPOS'taki Z doğruysa paneldeki eski kayıt silinir; ya da
 * deneme gününün temizliği). AsilPOS reddedilen ya da silinen günü kendisi yeniden göndermez: yenisi AsilPOS'ta Kasa ›
 * Geçmiş günler › o günün Z raporu › Gönder ile gelir (ASILPOS_RESEND_PATH). Gün sonunun yazımıyla aynı danışma kilidi
 * altında, tek işlemde: günün özeti (pos_day_reports) ve satırları (pos_daily_sales). `zNo`: yöneticinin gördüğü Z; bu
 * arada gün başka bir Z ile yeniden yazıldıysa silinmez. Durum satırındaki o günün reddi yalnız bu silmenin çözdüğü
 * çakışmaysa (409, aynı Z) "silindi" olur (kart kırmızı yerine "Gönder bekleniyor" der); aynı günün 400'ü olduğu gibi
 * kalır (alanı ve nedeni görünmeye devam eder). Sürüm geçmişi (pos_day_revisions) silinmez: silinen Z'nin gövdeleri
 * denetim için kalır, sonra gelen yeni Z'nin gövdeleri aynı güne eklenir (docs/ASILPOS.md › Sürüm geçmişi). Kasadan
 * çıkanlar'daki günün AsilPOS satırları AsilPOS'tan ayrılır (cash-moves.ts detachAsilposCashOuts; inceleme LM-3): gün
 * sayılmıyorsa (deneme günü) AsilPOS'un açtığı satırlar kalkar, sahiplenilen elle satır ve tedarikçi ödemesine bağlı satır
 * kalır; sayılan günde (409'un çözümü) satırların hepsi kalır, yeni Z gelince yeniden sahiplenilir.
 */
export async function removeAsilposDay(db: DB, me: Actor, branchId: string, date: string, zNo: number, now: Date = new Date()): Promise<{ zNo: number; lines: number }> {
  if (me.role !== "admin") throw new UserError(ADMIN_ONLY);
  // Kasanın şubesi (bölümün şubesi): gün sonunu yazanla aynı kilit ve aynı şube
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${GUN_KILIDI_ONEKI}${branchId}:${date}`}))`);
    // Yalnız bu şubenin günü (başka şubenin aynı günkü kaydına dokunulmaz)
    const [rep] = await tx.select({ z: s.posDayReports.z }).from(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId))).limit(1);
    if (!rep) throw new UserError("Bu günün AsilPOS kaydı yok (silinmiş olabilir); sayfayı yenileyin");
    if (rep.z.zNo !== zNo) throw new UserError(`Bu gün bu arada Z ${rep.z.zNo} ile yeniden gönderildi; sayfayı yenileyip yeniden bakın`);
    const lines = await tx.delete(s.posDailySales).where(and(eq(s.posDailySales.date, date), eq(s.posDailySales.branchId, branchId))).returning({ id: s.posDailySales.id });
    await tx.delete(s.posDayReports).where(and(eq(s.posDayReports.date, date), eq(s.posDayReports.branchId, branchId)));
    // Şubenin kendi kasasının geçiş günü (kasası AsilPOS değilse gün deneme)
    const counted = isAsilposDay(date, await switchDayOf(branchId, tx));
    await detachAsilposCashOuts(tx, date, counted ? "release" : "drop", { by: { id: me.id, name: me.name }, branchId });
    // Kasanın durum satırı (stateKeysOf; eski adla, yeni adlı satır varsa o da); eski kurulumun şubesinde genel satır da
    const keys = [...stateKeysOf(branchId).read, ...(branchId === LEGACY_POS_BRANCH_ID ? [ASILPOS_STATE_KEY, ASILPOS_STATE_KEY_NEW] : [])];
    await tx.execute(sql`
      update integration_state
         set value = jsonb_set(value, array['rejections', ${date}::text, 'clearedAt'], to_jsonb(${now.toISOString()}::text)), updated_at = now()
       where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
         and value->'rejections'->${date}::text->>'error' = 'z_conflict'
         and (value->'rejections'->${date}::text->>'zNo')::int = ${rep.z.zNo}::int`);
    return { zNo: rep.z.zNo, lines: lines.length };
  });
}
