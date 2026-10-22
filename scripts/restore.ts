// Tam yedeği bir veritabanına geri yükler. Yalnız komut satırından (panelde yok: tek dokunuşla bütün veri değişmesin);
// adımlar, prova ve sonrasında olanlar docs/YEDEK.md'de. İş src/server/backup/restore.ts'te (testler de onu çağırır);
// burada seçenekler, onay ve ekrana yazılanlar.
//
// Kullanım:
//   DATABASE_URL=postgres://…/laffogato_prova npm run db:restore -- <dosya.json.gz>   -> boş veritabanına
//   npm run db:restore -- <dosya.json.gz> --sil [--onay=<sunucu>]                     -> dolu veritabanının yerine
// Tarayıcının açıp bıraktığı .json da verilebilir (Safari .gz'yi kendiliğinden açar).
//
// Hedef: komut satırında verilen DATABASE_URL_UNPOOLED / DATABASE_URL, yoksa .env.local'daki. Dolu hedefe yalnız --sil
// ile yazılır; önce hedefin yedeği dosyanın yanına alınır (laffogato-yedek-once-<sunucu>-….json.gz). Bu bilgisayarda
// olmayan bir hedefte (Neon) sunucu adıyla onay gerekir.

import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { loadEnvConfig } from "@next/env";

import { backupFileName, databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { inspectTarget, planFor, readBackupFile, restoreBackup, RestoreError, targetIsEmpty, targetNotEmptyError } from "../src/server/backup/restore";
import { createDb } from "../src/server/db";

const USAGE = "Kullanım: npm run db:restore -- <dosya.json.gz> [--sil] [--onay=<sunucu>]";

export interface RestoreIo {
  log: (line: string) => void;
  /** Etkileşimli terminalde soru sorar; yoksa null (onay --onay ile verilir) */
  ask: ((question: string) => Promise<string>) | null;
}

export function parseRestoreArgs(argv: string[]): { file: string; wipe: boolean; confirm: string | null } {
  const files: string[] = [];
  let wipe = false;
  let confirm: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sil") wipe = true;
    else if (a.startsWith("--onay=")) confirm = a.slice("--onay=".length);
    else if (a === "--onay") confirm = argv[++i] ?? "";
    else if (a.startsWith("-")) throw new Error(`Bilinmeyen seçenek: ${a}. ${USAGE}`);
    else files.push(a);
  }
  if (files.length !== 1) throw new Error(files.length ? `Tek dosya verin. ${USAGE}` : `Yedek dosyasını verin. ${USAGE}`);
  return { file: files[0], wipe, confirm };
}

const trDateTime = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const thousands = (n: number) => new Intl.NumberFormat("tr-TR").format(n);

/**
 * `url`: hedef (verilmezse `env`'den); `env`: ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME. Hata Türkçe iletiyle atılır;
 * hedefe dokunulmadan önceki her ret "hiçbir şey değişmedi" demektir.
 */
export async function runRestore(argv: string[], io: RestoreIo, opts: { env: Record<string, string | undefined>; url?: string; now?: Date }): Promise<void> {
  const args = parseRestoreArgs(argv);
  const env = opts.env;
  const now = opts.now ?? new Date();
  const url = opts.url ?? databaseUrl(env);
  if (!url) throw new Error("DATABASE_URL tanımlı değil: hedef veritabanını verin (DATABASE_URL=postgres://… npm run db:restore -- …).");

  // 1. Dosya baştan sona okunup doğrulanır; hedefe dokunulmadan önce
  const file = resolve(args.file);
  const backup = await readBackupFile(file);
  const h = backup.header;
  io.log(
    `Yedek: ${trDateTime(h.createdAt)} · ${h.createdBy} · ${Object.keys(backup.end.tables).length} tablo · ${thousands(backup.end.rows)} satır · ${h.documents ? "yüklenen belgeler dahil" : "belgeler hariç"} (sürüm ${h.app})`,
  );
  const plan = planFor(backup);
  if (plan.error !== null) throw new RestoreError(plan.error);
  io.log(`Şema: ${plan.later ? `${plan.fromTag} → ${plan.toTag} (${plan.later} migration veriden sonra uygulanır)` : `${plan.fromTag} (bu kodla aynı)`}`);

  // 2. Hedef: boşsa doğrudan; doluysa --sil ve (bu bilgisayarda değilse) sunucu adıyla onay, önce hedefin yedeği
  const target = databaseTarget(url);
  io.log(`Hedef: ${target.label}${target.local ? " (bu bilgisayar)" : ""}`);
  const db = createDb(url, 1);
  try {
    const info = await inspectTarget(db.$client);
    let safetyCopyPath: string | null = null;
    if (!targetIsEmpty(info)) {
      if (!args.wipe) throw targetNotEmptyError(info);
      const docs = !h.documents && info.uploads > 0 ? ` Bu yedekte belge yok: hedefteki ${info.uploads} yüklenen belge silinecek.` : "";
      const warning = `Bu veritabanındaki bütün veri silinip yedekle değiştirilecek: ${target.label}.${docs}`;
      if (target.local) {
        io.log(`! ${warning}`);
      } else if (args.confirm !== null) {
        if (args.confirm !== target.host) throw new Error(`Onay tutmuyor: --onay=${target.host} yazın (sunucu adı). Hiçbir şey değişmedi.`);
        io.log(`! ${warning} Onaylandı (--onay).`);
      } else if (io.ask) {
        const answer = await io.ask(`${warning} Onaylamak için sunucu adını yazın: `);
        if (answer.trim() !== target.host) throw new Error("Onaylanmadı; hiçbir şey değişmedi.");
      } else {
        throw new Error(`${warning} Onay için --onay=${target.host} ekleyin. Hiçbir şey değişmedi.`);
      }
      safetyCopyPath = join(dirname(file), backupFileName(now, { host: target.host }));
      io.log(`Önce hedefin yedeği alınıyor: ${safetyCopyPath}`);
    }

    // 3. Yükleme (tek işlem). ADMIN_*: canlıda yalnız hiçbir yönetici giremeyecekse (mergeUserRows)
    const admin =
      env.ADMIN_EMAIL?.trim() && env.ADMIN_PASSWORD
        ? { email: env.ADMIN_EMAIL.trim(), password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME, onlyIfLockedOut: !target.local }
        : null;
    const r = await restoreBackup(db.$client, backup, { wipe: args.wipe, safetyCopyPath, admin, now });

    io.log(`✓ Geri yükleme tamam. ${r.tables} tablo, ${thousands(r.rows)} satır. Şema: ${r.later ? `${r.fromTag} → ${r.toTag}` : r.toTag}.`);
    if (r.safetyCopy) io.log(`✓ Geri yükleme öncesi kopya: ${r.safetyCopy}`);
    if (r.admin) io.log(`✓ Yönetici parolası ADMIN_PASSWORD ile ayarlandı (${r.admin}${r.adminCreated ? "; yönetici olarak eklendi" : ""}).`);
    if (r.adminSkipped) io.log("· ADMIN_EMAIL / ADMIN_PASSWORD kullanılmadı: yöneticiler hedefteki parolalarıyla girer.");
    if (r.kept.length) io.log(`✓ Parolası korunanlar: ${r.kept.join(", ")}`);
    if (r.invited.length) {
      io.log(`! Parolası olmayan kullanıcılar (Kullanıcılar & roller › Düzenle › Güvenlik › Davet bağlantısını yeniden oluştur): ${r.invited.join(", ")}`);
    }
    if (!r.adminLogin) {
      io.log(
        "! Hiçbir yönetici parolasıyla giremez: ADMIN_EMAIL (sahibin e-postası) ve ADMIN_PASSWORD verip --sil ile yeniden yükleyin ya da giriş ekranında «Parolamı unuttum» ile bağlantı isteyin (e-posta kuruluysa).",
      );
    }
    if (r.replaced) io.log("! Bu veritabanındaki bütün oturumlar kapandı; herkes yeniden giriş yapacak.");
    // Boş hedefte eski veritabanının oturumları bilinmez: aynı AUTH_SECRET'la imzalı eski bir çerez, aynı kimliği alan
    // yeni bir kişinin hesabını açabilirdi. Canlının yeni veritabanıysa anahtar yenilenir
    else if (!target.local) {
      io.log("! Bu, canlının yeni veritabanıysa Vercel'de AUTH_SECRET'ı yenileyip yeniden yayınlayın: eski veritabanında açılmış oturumlar burada geçmesin (docs/YEDEK.md § 8).");
    }
    io.log("! Paraşüt bağlantısı ilk eşitlemede yeniden kurulur; bildirim izinli cihazlar panel açılınca yeniden abone olur.");
    for (const w of r.warnings) io.log(`! ${w}`);
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("restore.ts")) {
  // Komut satırında verilen hedef .env.local'dakinden önce gelir (yerel prova canlının adresine gitmesin)
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  const url = databaseUrl(shell, process.env);
  // Bu bilgisayarda olmayan hedefte (canlı) ADMIN_* yalnız komut satırından: .env.local'daki yerel yönetici canlıya geçmesin
  const remote = Boolean(url) && !databaseTarget(url!).local;
  if (remote && process.env.ADMIN_EMAIL && !shell.ADMIN_EMAIL) {
    console.log("· .env.local'daki ADMIN_EMAIL / ADMIN_PASSWORD bu bilgisayarda olmayan bir hedefte kullanılmaz; gerekirse komut satırında verin.");
  }
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  runRestore(process.argv.slice(2), { log: (l) => console.log(l), ask: rl ? (q) => rl.question(q) : null }, { env: remote ? shell : process.env, url })
    .then(() => rl?.close())
    .catch((e) => {
      rl?.close();
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    });
}
