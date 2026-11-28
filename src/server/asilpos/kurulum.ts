import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { accessLink, formatExpiry } from "@/app/panel/kullanicilar/access";
import { KURULUM_SIFRE_AMACI } from "@/lib/asilpos/eski-adlar";
import { isBranchAccount, kurulumBaglantilari, kurulumDurumu, kurulumLink, KURULUM_GUN, type KurulumDurumu } from "@/lib/asilpos/kurulum";
import { kurulumMail } from "@/lib/asilpos/kurulum-mail";
import { appUrl } from "@/server/auth/tokens";
import { getDb, schema as s, type DB } from "@/server/db";
import { open, seal } from "@/server/secret-box";
import { isEmailConfigured, resolveFrom, sendEmail } from "@/server/notify/resend";
import { loadNotifySettings } from "@/server/notify/settings";
import { ensurePosKey, forgetPosKeys } from "@/server/asilpos/branch";
import { personelForKasa, type KasaPersoneli } from "@/server/asilpos/ilk-personel";
import { writeKasaKaydi } from "@/server/asilpos/kasa-durumu";

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
 * veritabanında özeti ve mühürlü kopyası durur. Şubenin kullanılabilen AsilPOS anahtarı yoksa aynı işlemde üretilip şubenin
 * ayarına saklanır (çok şube: her kasanın kendi anahtarı; kasa kodu verince yalnız bunu alır)
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
    await ensurePosKey(tx, o.branchId, "kurulum kodu");
  });
  forgetPosKeys();
  return { raw, expiresAt, link: kurulumLink(appUrl(), raw) };
}

/**
 * Şubenin bekleyen kurulum kodlarını iptal eder (şube kapatıldı; asıl yönetici, 28 Kasım 2026): bağlantı indirmez,
 * kasa kodu veremez. Kullanılmış kodlar olduğu gibi kalır (kurulu kasa çalışmaya devam eder; anahtar değişmez). Döner:
 * iptal edilen kod sayısı. Eylemin işleminin içinden çağrılır
 */
export async function revokePendingInstalls(tx: Pick<DB, "update">, branchId: string, now = new Date()): Promise<number> {
  const rows = await tx
    .update(s.asilposInstalls)
    .set({ revokedAt: now })
    .where(and(eq(s.asilposInstalls.branchId, branchId), isNull(s.asilposInstalls.usedAt), isNull(s.asilposInstalls.revokedAt)))
    .returning({ id: s.asilposInstalls.id });
  return rows.length;
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
  | { status: 200; body: { ok: true; sube: { id: string; ad: string }; baglanti: Record<string, string>; personel?: KasaPersoneli } }
  | { status: 404 | 410; body: { ok: false; error: string } };

/** Kapalı şubenin kodu (kasaya 410, "geçersiz / süresi geçmiş kod"la aynı biçim; kasa 404 ve 410'u kalıcı sayar) */
export const KURULUM_SUBE_KAPALI = "Şube kapatıldı; bu kurulum bağlantısı geçersiz";

/**
 * Kasa kodu verir: kod bir kez geçer (koşullu güncelleme; aynı anda iki kasa veremez). Yanıt: şube (kimlik, ad) ve
 * bağlantılar (lafmaliyet adresi ve şubenin kendi anahtarı; ortamda tanımlıysa AsilPOS Uzaktan ve site). Başka şubenin
 * anahtarı hiçbir zaman verilmez (çok şube): şubenin anahtarı yoksa (kod göç öncesi üretildi) burada üretilir. 404 kod
 * yok, 410 kullanılmış, iptal, süresi dolmuş ya da şubesi kapalı (asıl yönetici, 28 Kasım 2026: şube kapatılınca bekleyen
 * kodları iptal olur, kapalı şubenin kodu hiçbir koşulda geçmez). Yanıtın yolu, biçimi ve durum kodları değişmedi.
 *
 * Kasa açılışı (docs/ASILPOS.md › Kasa açılışı): başarıda şubenin kasa kaydı yazılır (`yol: "kod"`; yeni kasa isteğe bağlı
 * `kimlik` ve `surum` gönderirse onlarla, eski kasa için de yazılır). Yeni kasa `acikAnahtar` gönderirse ve şubenin ilk
 * personeli ayarlıysa yanıta ek alan `personel` girer (PIN'ler kasanın açık anahtarıyla şifreli); göndermeyen eski
 * kasanın yanıtı bugünküyle birebir aynı
 */
export async function redeemInstallCode(
  raw: string,
  db: DB = getDb(),
  now = new Date(),
  kasa: { kimlik: string | null; surum: string | null; acikAnahtar: string | null } = { kimlik: null, surum: null, acikAnahtar: null },
): Promise<RedeemResult> {
  const hash = hashOf(raw);
  const openBranches = db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.active, true));
  const [row] = await db
    .update(s.asilposInstalls)
    .set({ usedAt: now })
    .where(
      and(
        eq(s.asilposInstalls.tokenHash, hash),
        isNull(s.asilposInstalls.usedAt),
        isNull(s.asilposInstalls.revokedAt),
        gt(s.asilposInstalls.expiresAt, now),
        inArray(s.asilposInstalls.branchId, openBranches),
      ),
    )
    .returning({ branchId: s.asilposInstalls.branchId });
  if (!row) {
    const [known] = await db
      .select({ usedAt: s.asilposInstalls.usedAt, revokedAt: s.asilposInstalls.revokedAt, expiresAt: s.asilposInstalls.expiresAt, active: s.branches.active })
      .from(s.asilposInstalls)
      .leftJoin(s.branches, eq(s.branches.id, s.asilposInstalls.branchId))
      .where(eq(s.asilposInstalls.tokenHash, hash))
      .limit(1);
    if (!known) return { status: 404, body: { ok: false, error: "Kurulum kodu bulunamadı" } };
    const d = kurulumDurumu(known, now);
    if (d !== "kuruldu" && known.active !== true) return { status: 410, body: { ok: false, error: KURULUM_SUBE_KAPALI } };
    return { status: 410, body: { ok: false, error: d === "kuruldu" ? "Bu kurulum bağlantısı kullanılmış" : d === "iptal" ? "Bu kurulum bağlantısı yenisiyle değiştirildi" : "Kurulum bağlantısının süresi dolmuş" } };
  }
  const [branch] = await db.select({ id: s.branches.id, name: s.branches.name }).from(s.branches).where(eq(s.branches.id, row.branchId)).limit(1);
  if (!branch) return { status: 404, body: { ok: false, error: "Şube bulunamadı" } };
  // Anahtar işlemin içinden (grubun kilidinin altında okunan ya da üretilen): aynı anda üretilen kod onu ezemez, kasaya
  // panelin sakladığı anahtar gider
  const { key, created } = await db.transaction((tx) => ensurePosKey(tx, branch.id, "kurulum kodu"));
  if (created) forgetPosKeys();
  const baglanti = kurulumBaglantilari({ panelUrl: appUrl(), syncSecret: key });
  // Kod harcandı: kayıt ya da personel yazılamazsa da kasa yanıtını alır (kod ikinci kez geçmez). Kayıt yoksa durum
  // eski ölçütle (kullanılmış kod ve anahtar) yine "kurulu" çıkar
  let personel: KasaPersoneli | null = null;
  try {
    await writeKasaKaydi(db, branch.id, { durum: "kurulu", kimlik: kasa.kimlik, surum: kasa.surum, at: now.toISOString(), by: "kurulum kodu", yol: "kod" });
    personel = await personelForKasa(db, branch.id, kasa.acikAnahtar, now);
  } catch (e) {
    console.error("[asilpos] kurulum kodu: kasa kaydı ya da ilk personel yazılamadı", e);
  }
  return { status: 200, body: { ok: true, sube: { id: branch.id, ad: branch.name }, baglanti, ...(personel ? { personel } : {}) } };
}
