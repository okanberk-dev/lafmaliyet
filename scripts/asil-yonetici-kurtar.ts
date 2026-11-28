// Asıl yönetici kilitlenirse son çare (docs/DEPLOY.md › Asıl yönetici kilitlenirse; docs/ROLLER.md › Yönetici
// hesapları). Yalnız yazılımcı, komut satırından, hedef veritabanının adresiyle çalıştırır; panelde karşılığı yok.
// Asıl yöneticinin adresindeki hesapta (LADMIN_ANA_ADMIN, yoksa info@nextgenlab.com.tr):
//   - iki adımlı doğrulamayı sıfırlar (anahtar ve kurtarma kodları silinir; kişi Hesabım'dan yeniden kurar),
//   - hesap kilidini ve cihaz kilitlerini açar,
//   - oturum sürümünü artırır: panelde ve Yönetim konsolunda açık bütün oturumlar kapanır,
//   - işlem geçmişine "Asıl yönetici hesabı kurtarıldı (komut satırı)" yazar.
// Parolaya dokunmaz: parola "Parolamı unuttum" ile e-postadan sıfırlanır. Hesap yoksa ya da yönetici değilse açık bir
// iletiyle durur, hiçbir şey yazmaz. Varsayılan KURU ÇALIŞMA: ne yapılacağını yazar, veritabanına dokunmaz; yalnız
// --uygula ile yazar. Ekrana sır yazılmaz (parola, anahtar, kod, veritabanı parolası).
//
// Kullanım:
//   DATABASE_URL=postgres://… npx tsx scripts/asil-yonetici-kurtar.ts            -> kuru çalışma
//   DATABASE_URL=postgres://… npx tsx scripts/asil-yonetici-kurtar.ts --uygula   -> yazar
// Canlıda LADMIN_ANA_ADMIN tanımlıysa aynı değeri komut satırında da verin (LADMIN_ANA_ADMIN=… DATABASE_URL=… …).

import { eq, sql } from "drizzle-orm";

import { anaAdminEmail } from "../src/lib/asilpos/kurulum";
import { databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { createDb, type DB } from "../src/server/db";
import * as s from "../src/server/db/schema";

const USAGE = "Kullanım: DATABASE_URL=postgres://… npx tsx scripts/asil-yonetici-kurtar.ts [--uygula]";

/** İşlem geçmişinin satırı (tests/asil-yonetici-kurtar-db.test.ts) */
export const KURTARMA_KAYDI = "Asıl yönetici hesabı kurtarıldı (komut satırı)";
/** İşlem geçmişinde işlemi yapanın adı (hesap yok: yazılımcı komut satırından) */
export const KURTARMA_YAPAN = "Komut satırı";

/** Betiğin durduğu, hiçbir şey yazılmadan dönen hata */
export class KurtarmaHatasi extends Error {}

export function parseKurtarArgs(argv: string[]): { uygula: boolean } {
  let uygula = false;
  for (const a of argv) {
    if (a === "--uygula") uygula = true;
    else throw new KurtarmaHatasi(`Bilinmeyen seçenek: ${a}. ${USAGE}`);
  }
  return { uygula };
}

export interface KurtarmaSonucu {
  /** Veritabanına yazıldı mı (kuru çalışmada false) */
  yazildi: boolean;
  email: string;
  userId: number;
}

/**
 * Asıl yöneticinin hesabını kurtarır (`uygula`) ya da yalnız ne yapılacağını yazar. Hesap yoksa ya da yönetici değilse
 * KurtarmaHatasi atar, hiçbir şey yazmaz. Okuma ve yazma tek işlemde, satır kilidiyle
 */
export async function asilYoneticiyiKurtar(
  db: DB,
  o: { uygula: boolean; env?: Record<string, string | undefined>; log?: (line: string) => void; now?: Date },
): Promise<KurtarmaSonucu> {
  const log = o.log ?? (() => {});
  const now = o.now ?? new Date();
  const email = anaAdminEmail(o.env ?? process.env);
  const sonuc = await db.transaction(async (tx): Promise<KurtarmaSonucu> => {
    const [u] = await tx.select().from(s.users).where(eq(s.users.email, email)).for("update").limit(1);
    if (!u) throw new KurtarmaHatasi(`${email} adresinde hesap yok. Hiçbir şey yazılmadı. (Adres doğru mu? Canlıda LADMIN_ANA_ADMIN tanımlıysa aynısını verin.)`);
    if (u.role !== "admin") throw new KurtarmaHatasi(`${email} hesabı yönetici değil (rol: ${u.role}). Hiçbir şey yazılmadı.`);
    const cihazKilidi = await tx.$count(s.loginDeviceLocks, eq(s.loginDeviceLocks.userId, u.id));
    const kilitli = Boolean(u.lockedUntil && u.lockedUntil > now);
    log(`Hesap: ${u.name} <${u.email}> · yönetici · ${u.active ? "etkin" : "pasif"}`);
    log(
      u.totpEnabled
        ? `- İki adımlı doğrulama kapatılır; ${u.recoveryCodes?.length ?? 0} kurtarma kodu silinir. Kişi Hesabım'dan yeniden kurar.`
        : u.totpSecret
          ? "- İki adımlı doğrulama zaten kapalı; yarım kalmış kurulum silinir."
          : "- İki adımlı doğrulama zaten kapalı.",
    );
    log(kilitli || u.failedLogins > 0 ? `- Hesap kilidi açılır (${kilitli ? "kilitli" : "kilitli değil"}, ${u.failedLogins} hatalı deneme sıfırlanır).` : "- Hesap kilitli değil.");
    log(cihazKilidi ? `- ${cihazKilidi} cihaz kilidi silinir.` : "- Cihaz kilidi yok.");
    log(`- Oturum sürümü ${u.sessionVersion} → ${u.sessionVersion + 1}: panelde ve Yönetim konsolunda açık bütün oturumlar kapanır.`);
    log("- Parolaya dokunulmaz: parola giriş sayfasındaki \"Parolamı unuttum\" ile e-postadan sıfırlanır.");
    if (!u.active) log("! Hesap pasif: bu betik etkinleştirmez. Etkinleştirmek ayrı bir karar (veritabanından).");
    if (!o.uygula) {
      log("Kuru çalışma: hiçbir şey yazılmadı. Uygulamak için --uygula ekleyin.");
      return { yazildi: false, email: u.email, userId: u.id };
    }
    await tx
      .update(s.users)
      .set({
        totpEnabled: false,
        totpSecret: null,
        totpLastStep: null,
        recoveryCodes: null,
        failedLogins: 0,
        lockedUntil: null,
        sessionVersion: sql`${s.users.sessionVersion} + 1`,
      })
      .where(eq(s.users.id, u.id));
    await tx.delete(s.loginDeviceLocks).where(eq(s.loginDeviceLocks.userId, u.id));
    await tx.insert(s.activityLog).values({ userName: KURTARMA_YAPAN, userId: null, action: KURTARMA_KAYDI, detail: u.email, branchId: null });
    return { yazildi: true, email: u.email, userId: u.id };
  });
  // İşlem tamamlandıktan sonra (yazım geri alınırsa "uygulandı" denmesin)
  if (sonuc.yazildi) log(`✓ Uygulandı: ${KURTARMA_KAYDI}. Şimdi giriş sayfasında "Parolamı unuttum" ile parolayı sıfırlayın, girip Hesabım'dan iki adımlıyı yeniden kurun.`);
  return sonuc;
}

if (process.argv[1]?.endsWith("asil-yonetici-kurtar.ts")) {
  // Hedef yalnız komut satırından (.env.local okunmaz: yerel ayar canlıya ya da tersi karışmasın)
  const main = async () => {
    const { uygula } = parseKurtarArgs(process.argv.slice(2));
    const url = databaseUrl(process.env);
    if (!url) throw new KurtarmaHatasi(`DATABASE_URL tanımlı değil. ${USAGE}`);
    const target = databaseTarget(url);
    console.log(`Hedef: ${target.label}${target.local ? " (bu bilgisayar)" : ""} · ${uygula ? "UYGULA (yazar)" : "kuru çalışma (yazmaz)"}`);
    console.log(`Asıl yöneticinin adresi: ${anaAdminEmail(process.env)}`);
    const db = createDb(url, 1);
    try {
      await asilYoneticiyiKurtar(db, { uygula, log: (l) => console.log(l) });
    } finally {
      await db.$client.end();
    }
  };
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
