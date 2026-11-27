import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { accessLink, formatExpiry } from "@/app/panel/kullanicilar/access";
import { KURULUM_SIFRE_AMACI } from "@/lib/asilpos/eski-adlar";
import { isBranchAccount, kurulumBaglantilari, kurulumDurumu, kurulumLink, KURULUM_GUN, type KurulumDurumu } from "@/lib/asilpos/kurulum";
import { kurulumMail } from "@/lib/asilpos/kurulum-mail";
import { appUrl } from "@/server/auth/tokens";
import { getDb, schema as s, type DB } from "@/server/db";
import { open, seal } from "@/server/secret-box";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { asilposSecret } from "@/server/asilpos/branch";

// Şube kurulumu (docs/ASILPOS.md › Şube kurulumu): kodu üretir, e-postayla gönderir, şube hesabına gösterir ve kasa
// verince (POST /api/asilpos/kurulum) şubeyi ve bağlantı bilgilerini döner. Kurallar saf dosyada (src/lib/asilpos/kurulum.ts).

const hashOf = (raw: string) => createHash("sha256").update(raw).digest("hex");

export interface KurulumView {
  id: number;
  branchId: string;
  email: string;
  durum: KurulumDurumu;
  /** Bağlantı (yalnız bekliyorken; kullanılan ya da süresi dolan bağlantı gösterilmez) */
  link: string | null;
  expiresAt: string;
  usedAt: string | null;
  downloads: number;
  createdAt: string;
}

/**
 * Şubeye yeni kurulum kodu: bekleyen eski kodlar iptal olur (tek geçerli bağlantı). Ham kod döner (e-posta ve ekran);
 * veritabanında özeti ve mühürlü kopyası durur
 */
export async function issueInstallCode(db: DB, o: { branchId: string; email: string; by: number | null }, now = new Date()): Promise<{ raw: string; expiresAt: Date; link: string }> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + KURULUM_GUN * 86_400_000);
  await db.transaction(async (tx) => {
    await tx
      .update(s.asilposInstalls)
      .set({ revokedAt: now })
      .where(and(eq(s.asilposInstalls.branchId, o.branchId), isNull(s.asilposInstalls.usedAt), isNull(s.asilposInstalls.revokedAt)));
    await tx.insert(s.asilposInstalls).values({ branchId: o.branchId, email: o.email, tokenHash: hashOf(raw), tokenSealed: seal(raw, KURULUM_SIFRE_AMACI), expiresAt, createdBy: o.by });
  });
  return { raw, expiresAt, link: kurulumLink(appUrl(), raw) };
}

/** Kurulum e-postası: indirme bağlantısı ve (varsa) şube hesabının davet bağlantısı. E-posta kurulu değilse gönderilmez */
export async function sendInstallMail(o: { to: string; branchName: string; link: string; expiresAt: Date; inviteRaw: string | null }): Promise<{ ok: boolean; error?: string }> {
  if (!isEmailConfigured()) return { ok: false, error: "E-posta gönderimi kurulu değil (RESEND_API_KEY)" };
  const base = appUrl();
  const mail = kurulumMail({ branchName: o.branchName, downloadUrl: o.link, inviteUrl: o.inviteRaw ? accessLink(base, o.inviteRaw) : null, loginUrl: `${base}/giris`, until: formatExpiry(o.expiresAt.toISOString()) });
  const notify = await loadNotifySettings();
  const res = await sendEmail({ from: resolveFrom(notify.from), to: [o.to], subject: mail.subject, html: mail.html, text: mail.text });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Şubenin kurulum bağlantıları (en yenisi önce); bağlantı yalnız bekleyende */
export async function listInstalls(db: DB, branchId: string, now = new Date()): Promise<KurulumView[]> {
  const rows = await db.select().from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, branchId)).orderBy(desc(s.asilposInstalls.createdAt)).limit(10);
  const base = appUrl();
  return rows.map((r) => {
    const durum = kurulumDurumu(r, now);
    const raw = durum === "bekliyor" ? open(r.tokenSealed, KURULUM_SIFRE_AMACI) : null;
    return {
      id: r.id,
      branchId: r.branchId,
      email: r.email,
      durum,
      link: raw ? kurulumLink(base, raw) : null,
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      downloads: r.downloads,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/**
 * Hesabım'daki AsilPOS kurulumu kartı: şubenin son bağlantısı, yalnız şubenin kendi hesabına (`isBranchAccount`); öbür
 * herkese null. Bağlantıdaki ham kod (kasanın anahtarını verir) yalnız bu denetimden sonra sayfaya gider
 */
export async function installForAccount(db: DB, user: { role: string; email: string; branchId?: string | null }, now = new Date()): Promise<KurulumView | null> {
  if (user.role !== "staff" || !user.branchId) return null;
  const [last] = await listInstalls(db, user.branchId, now);
  return last && isBranchAccount(user, last) ? last : null;
}

/** İndirme: kod geçerliyse şube (sayaç artar); değilse null */
export async function installForDownload(raw: string, db: DB = getDb(), now = new Date()) {
  const [row] = await db
    .update(s.asilposInstalls)
    .set({ downloads: sql`${s.asilposInstalls.downloads} + 1` })
    .where(and(eq(s.asilposInstalls.tokenHash, hashOf(raw)), isNull(s.asilposInstalls.usedAt), isNull(s.asilposInstalls.revokedAt), gt(s.asilposInstalls.expiresAt, now)))
    .returning({ branchId: s.asilposInstalls.branchId });
  return row ?? null;
}

export type RedeemResult =
  | { status: 200; body: { ok: true; sube: { id: string; ad: string }; baglanti: Record<string, string> } }
  | { status: 404 | 410; body: { ok: false; error: string } };

/**
 * Kasa kodu verir: kod bir kez geçer (koşullu güncelleme; aynı anda iki kasa veremez). Yanıt: şube (kimlik, ad) ve
 * bağlantılar (lafmaliyet adresi ve anahtarı; ortamda tanımlıysa AsilPOS Uzaktan ve site). 404 kod yok, 410 kullanılmış,
 * iptal ya da süresi dolmuş
 */
export async function redeemInstallCode(raw: string, db: DB = getDb(), now = new Date()): Promise<RedeemResult> {
  const hash = hashOf(raw);
  const [row] = await db
    .update(s.asilposInstalls)
    .set({ usedAt: now })
    .where(and(eq(s.asilposInstalls.tokenHash, hash), isNull(s.asilposInstalls.usedAt), isNull(s.asilposInstalls.revokedAt), gt(s.asilposInstalls.expiresAt, now)))
    .returning({ branchId: s.asilposInstalls.branchId });
  if (!row) {
    const [known] = await db.select({ usedAt: s.asilposInstalls.usedAt, revokedAt: s.asilposInstalls.revokedAt, expiresAt: s.asilposInstalls.expiresAt }).from(s.asilposInstalls).where(eq(s.asilposInstalls.tokenHash, hash)).limit(1);
    if (!known) return { status: 404, body: { ok: false, error: "Kurulum kodu bulunamadı" } };
    const d = kurulumDurumu(known, now);
    return { status: 410, body: { ok: false, error: d === "kuruldu" ? "Bu kurulum bağlantısı kullanılmış" : d === "iptal" ? "Bu kurulum bağlantısı yenisiyle değiştirildi" : "Kurulum bağlantısının süresi dolmuş" } };
  }
  const [branch] = await db.select({ id: s.branches.id, name: s.branches.name }).from(s.branches).where(eq(s.branches.id, row.branchId)).limit(1);
  if (!branch) return { status: 404, body: { ok: false, error: "Şube bulunamadı" } };
  const baglanti = kurulumBaglantilari({ panelUrl: appUrl(), syncSecret: await asilposSecret(db) });
  return { status: 200, body: { ok: true, sube: { id: branch.id, ad: branch.name }, baglanti } };
}
