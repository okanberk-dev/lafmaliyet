"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_VIEW_LOCKED, bulkViewPatch, parseBranchView, VIEW_AREA_KEYS, VIEW_MODES, viewAreasFor } from "@/lib/branch-view";
import { can } from "@/lib/roles";
import { requireUser } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { attempt, UserError } from "./util";

const input = z.union([
  z.object({ area: z.enum(VIEW_AREA_KEYS, { message: "Bilinmeyen ekran" }), mode: z.enum(VIEW_MODES, { message: "Bilinmeyen görünüm" }) }).strict(),
  z.object({ all: z.enum(["sube", "firma", "varsayilan"], { message: "Bilinmeyen seçim" }) }).strict(),
]);

/**
 * Şube görünümü tercihini yazar (Hesabım › Şube görünümü ve ekranın çipi; docs/SUBE.md › Şube ayrımı). Yalnız kişinin
 * kendi satırı (`users.branch_view`): tek alan `{ area, mode }` ya da toplu `{ all }` ("Hepsi yalnız şube", "Hepsi firma
 * geneli", "Varsayılanlara dön"). Bütün şubeleri görmeyen hesap (müdür, personel) reddedilir: onda her ekran zaten
 * yalnız kendi şubesi. Muhasebeci yazar (kendi hesabının tercihi; tests/roller.test.ts › OWN_OR_READ). Oturum sürümü
 * değişmez; sayfa yeniden çizilir (`refresh`)
 */
export async function saveBranchView(raw: unknown) {
  return attempt(async () => {
    const me = await requireUser();
    if (!can(me.role, "sube.tumu")) throw new UserError(BRANCH_VIEW_LOCKED);
    const data = input.parse(raw);
    const db = getDb();
    let next: unknown;
    if ("area" in data) {
      if (!viewAreasFor(me.role).includes(data.area)) throw new UserError("Bu ekran hesabınızda yok");
      const [row] = await db
        .update(s.users)
        .set({ branchView: sql`${s.users.branchView} || jsonb_build_object(${data.area}::text, ${data.mode}::text)` })
        .where(eq(s.users.id, me.id))
        .returning({ v: s.users.branchView });
      next = row?.v;
    } else {
      const patch = bulkViewPatch(data.all, me.role);
      const [row] = await db
        .update(s.users)
        .set({ branchView: patch ? sql`${s.users.branchView} || ${JSON.stringify(patch)}::jsonb` : sql`'{}'::jsonb` })
        .where(eq(s.users.id, me.id))
        .returning({ v: s.users.branchView });
      next = row?.v;
    }
    refresh();
    return { prefs: parseBranchView(next) };
  });
}
