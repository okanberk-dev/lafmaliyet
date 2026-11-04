"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import {
  BRANCH_KINDS,
  BRANCH_NAME_MAX,
  BRANCH_POS_SOURCES,
  branchChangeError,
  branchDeleteError,
  branchIdError,
  branchSourceError,
  BRANCH_COOKIE,
  parseBranchScope,
  type BranchKind,
  type BranchPosSource,
} from "@/lib/branches";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { branchUsageCount, getBranch, listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zText } from "./util";

// Şube ve kanal yönetimi (/panel/subeler; docs/SUBE.md). Yalnız yönetici. Kimlik veriye yazılır: eklendikten sonra
// değişmez. Kurallar saf dosyada (src/lib/branches.ts) ve tests/subeler.test.ts onları doğrudan çalıştırır; buradaki
// eylemler yalnız yetki, doğrulama, yazma ve işlem geçmişi. "use server" dosyasındaki her dışa açık işlev bir uçtur.

const kind = z.enum(BRANCH_KINDS as unknown as [BranchKind, ...BranchKind[]], { message: "Tür seçin" });
const posSource = z.enum(BRANCH_POS_SOURCES as unknown as [BranchPosSource, ...BranchPosSource[]], {
  message: "Kasa kaynağı seçin",
});
const openedOn = zDate.nullish().transform((v) => v ?? null);
const scopeInput = z.object({ scope: z.string().trim().max(24) });

const createInput = z.object({
  id: z.string().trim(),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
});

/** Yeni şube ya da kanal açar. Kimlik bir daha değişmez: kayıtlar ona bağlanır. */
export async function createBranch(input: z.input<typeof createInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = createInput.parse(input);
    const idHata = branchIdError(d.id);
    if (idHata) throw new UserError(idHata);
    const uyumsuz = branchSourceError(d.kind, d.posSource);
    if (uyumsuz) throw new UserError(uyumsuz);
    const db = getDb();
    const mevcut = await listBranches(db);
    if (mevcut.some((b) => b.id === d.id)) throw new UserError("Bu kimlikte bir şube zaten var");
    if (mevcut.some((b) => b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    const sortOrder = Math.max(0, ...mevcut.map((b) => b.sortOrder)) + 1;
    await db.insert(s.branches).values({ ...d, id: d.id.trim(), sortOrder });
    await logActivity(me, "Şube eklendi", `${d.name} (${d.id})`);
    refresh();
    return { id: d.id.trim() };
  });
}

const updateInput = z.object({
  id: z.string().trim().min(1),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  active: z.boolean(),
});

/** Adı, türü, kasa kaynağını, açılış gününü ve açık / kapalı durumunu değiştirir (kimlik değişmez). */
export async function updateBranch(input: z.input<typeof updateInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = updateInput.parse(input);
    const db = getDb();
    const hepsi = await listBranches(db);
    const mevcut = hepsi.find((b) => b.id === d.id);
    if (!mevcut) throw new UserError("Şube bulunamadı");
    const hata = branchChangeError(
      mevcut,
      { kind: d.kind, posSource: d.posSource, active: d.active },
      hepsi.filter((b) => b.id !== d.id),
    );
    if (hata) throw new UserError(hata);
    if (hepsi.some((b) => b.id !== d.id && b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    await db
      .update(s.branches)
      .set({ name: d.name, kind: d.kind, posSource: d.posSource, openedOn: d.openedOn, active: d.active, updatedAt: new Date() })
      .where(eq(s.branches.id, d.id));
    const degisen = [
      mevcut.name === d.name ? null : `ad: ${mevcut.name} → ${d.name}`,
      mevcut.posSource === d.posSource ? null : `kasa: ${mevcut.posSource} → ${d.posSource}`,
      mevcut.active === d.active ? null : d.active ? "açıldı" : "kapatıldı",
    ].filter(Boolean);
    await logActivity(me, "Şube güncellendi", [d.name, ...degisen].join(" · "));
    refresh();
    return { id: d.id };
  });
}

const deleteInput = z.object({ id: z.string().trim().min(1) });

/** Hiç kaydı olmayan, sabit olmayan şubeyi siler (yanlış açılan kayıt için). Verisi olan şube yalnız kapatılır. */
export async function deleteBranch(input: z.input<typeof deleteInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const { id } = deleteInput.parse(input);
    const db = getDb();
    const mevcut = await getBranch(db, id);
    if (!mevcut) throw new UserError("Şube bulunamadı");
    // Şube sütunu taşıyan her tabloda bağlı kayıt aranır (src/server/branches.ts): bir kuruş bile yazılmışsa
    // şube silinmez, pasife alınır — yoksa ciro kütükten düşer
    const hata = branchDeleteError(mevcut, await branchUsageCount(db, id));
    if (hata) throw new UserError(hata);
    await db.delete(s.branches).where(eq(s.branches.id, id));
    await logActivity(me, "Şube silindi", `${mevcut.name} (${id})`);
    refresh();
    return { id };
  });
}

/**
 * Panelin şube seçimini çereze yazar (docs/SUBE.md › Seçici). Yalnız görünümü süzer, YETKİ VERMEZ: her uç ayrıca
 * `requireAdmin`/`requireUser` ile korunur, bu yüzden personel de kendi ekranlarında şube değiştirebilir.
 * Tanınmayan ya da pasif kimlik "hepsi"ye düşer (`parseBranchScope`), yani çerezde hiçbir zaman çöp durmaz.
 */
export async function chooseBranchScope(input: unknown) {
  return attempt(async () => {
    await requireUser();
    const { scope } = scopeInput.parse(input);
    const secim = parseBranchScope(scope, await listBranches());
    (await cookies()).set(BRANCH_COOKIE, secim, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    refresh();
    return { scope: secim };
  });
}
