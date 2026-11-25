"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { BRANCH_FEATURES, branchFeatures, withFeature } from "@/lib/branch-features";
import { BRANCH_SETTING_GROUPS } from "@/lib/branch-settings/groups";
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
  posRateError,
  type BranchKind,
  type BranchPosSource,
  type BranchRow,
} from "@/lib/branches";
import { lafposBranchOf, lafposSourceError } from "@/lib/lafpos/switch";
import { requireAdmin, requireUser } from "@/server/auth/dal";
import { staffBranchLock } from "@/server/branch-scope";
import { branchSettingsCloseError } from "@/server/branch-settings";
import { branchUsageCount, getBranch, listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { forgetLafposBranch, lafposInUse } from "@/server/lafpos/branch";

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
/**
 * Banka POS komisyon oranı (0,02 = %2; branches.pos_rate). İsteğe bağlı: verilmezse eklemede veritabanının varsayılanı
 * (%2), düzenlemede eski değer kalır. Yalnız yönetici (eylemler requireAdmin); banka POS komisyonu şube şube bu oranla
 */
const posRate = z
  .number({ message: "POS oranını yüzde olarak yazın (ör. 2)" })
  .optional()
  .superRefine((v, ctx) => {
    const hata = v === undefined ? null : posRateError(v);
    if (hata) ctx.addIssue({ code: "custom", message: hata });
  });
/** "%2", "%1,5" (işlem geçmişi) */
const oranMetni = (v: number) => `%${(Math.round(v * 10_000) / 100).toLocaleString("tr-TR")}`;
const scopeInput = z.object({ scope: z.string().trim().max(24) });

const createInput = z.object({
  id: z.string().trim(),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  posRate,
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
    // LafPOS bugün tek şubenin kasası (LafPOS'un şubesi kütükten türetilir: lafposBranchOf)
    const lafposHata = lafposSourceError({ id: d.id.trim(), kind: d.kind, posSource: d.posSource, active: true }, mevcut, await implicitHolderUsed(db, mevcut, d.posSource));
    if (lafposHata) throw new UserError(lafposHata);
    if (mevcut.some((b) => b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    const sortOrder = Math.max(0, ...mevcut.map((b) => b.sortOrder)) + 1;
    const { posRate: oran, ...alanlar } = d;
    await db.insert(s.branches).values({ ...alanlar, id: d.id.trim(), sortOrder, ...(oran !== undefined ? { posRate: oran } : {}) });
    forgetLafposBranch();
    await logActivity(me, "Şube eklendi", `${d.name} (${d.id})`);
    refresh();
    return { id: d.id.trim() };
  });
}

/**
 * Geri düşüşle LafPOS'un şubesi olan (kütükte kaynağı ModPOS) şube LafPOS'u kullanıyor mu (geçiş günü ya da kayıtlı
 * gün): kullanıyorsa başka şubenin kasası LafPOS yapılamaz (lafposSourceError). Yalnız LafPOS seçilirken sorulur
 */
async function implicitHolderUsed(db: ReturnType<typeof getDb>, others: readonly BranchRow[], source: BranchPosSource): Promise<boolean> {
  if (source !== "lafpos") return false;
  return lafposInUse(lafposBranchOf(others), db);
}

const updateInput = z.object({
  id: z.string().trim().min(1),
  name: zText("Şube adı", BRANCH_NAME_MAX),
  kind,
  posSource,
  openedOn,
  active: z.boolean(),
  posRate,
});

/**
 * Adı, türü, kasa kaynağını, açılış gününü, banka POS oranını ve açık / kapalı durumunu değiştirir (kimlik değişmez).
 * POS oranı verilmezse eskisi kalır
 */
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
    // Kasası LafPOS'a geçen (ya da LafPOS kasasıyla yeniden açılan) şube: LafPOS bugün tek şubenin kasası. Zaten LafPOS
    // olan şubenin başka alanı düzenlenirken sorulmaz
    const lafposOlur = d.posSource === "lafpos" && d.active && (mevcut.posSource !== "lafpos" || !mevcut.active);
    const lafposHata = lafposOlur
      ? lafposSourceError({ id: d.id, kind: d.kind, posSource: d.posSource, active: d.active }, hepsi, await implicitHolderUsed(db, hepsi, d.posSource))
      : null;
    if (lafposHata) throw new UserError(lafposHata);
    // Başka şube bu şubenin ayarını kullanıyorsa ("Marina ile aynı") kapatılmaz: bağ tek adımlı, bağlı şube değersiz kalırdı
    if (mevcut.active && !d.active) {
      const bagli = await branchSettingsCloseError(db, mevcut, BRANCH_SETTING_GROUPS);
      if (bagli) throw new UserError(bagli);
    }
    if (hepsi.some((b) => b.id !== d.id && b.name.localeCompare(d.name, "tr", { sensitivity: "base" }) === 0)) {
      throw new UserError("Bu adda bir şube zaten var");
    }
    // Kapatılan şubenin tek şubelik özelliği (karaoke) düşer: başka şubede açılabilsin, şube yeniden açılınca iki şubede
    // birden açık kalmasın (src/lib/branch-features.ts featureChangeError)
    const closing = mevcut.active && !d.active;
    const kept = closing ? BRANCH_FEATURES.filter((f) => f.single).reduce((acc, f) => withFeature(acc, f.id, false), branchFeatures(mevcut)) : null;
    await db
      .update(s.branches)
      .set({
        name: d.name,
        kind: d.kind,
        posSource: d.posSource,
        openedOn: d.openedOn,
        active: d.active,
        ...(kept ? { features: kept } : {}),
        ...(d.posRate !== undefined ? { posRate: d.posRate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(s.branches.id, d.id));
    // Kasa kaynağı ya da durum değiştiyse LafPOS'un şubesi değişmiş olabilir: bu sunucunun önbelleği hemen düşer
    forgetLafposBranch();
    const degisen = [
      mevcut.name === d.name ? null : `ad: ${mevcut.name} → ${d.name}`,
      mevcut.posSource === d.posSource ? null : `kasa: ${mevcut.posSource} → ${d.posSource}`,
      d.posRate === undefined || mevcut.posRate === d.posRate ? null : `POS oranı: ${mevcut.posRate === undefined ? "?" : oranMetni(mevcut.posRate)} → ${oranMetni(d.posRate)}`,
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
    const hata = branchDeleteError(mevcut, await branchUsageCount(db, id)) ?? (await branchSettingsCloseError(db, mevcut, BRANCH_SETTING_GROUPS));
    if (hata) throw new UserError(hata);
    await db.delete(s.branches).where(eq(s.branches.id, id));
    forgetLafposBranch();
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
    // Şubesi seçilmiş personel başka şubeye geçemez (seçim zaten kişinin şubesinde kilitli, src/server/branch-scope.ts)
    const kilit = await staffBranchLock();
    if (kilit && secim !== kilit) throw new UserError("Şubeniz yönetici tarafından belirlendi; başka şubeye geçemezsiniz");
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
