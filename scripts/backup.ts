// Tam yedeği bilgisayara alır (biçim ve geri yükleme: docs/YEDEK.md). Panelin Ayarlar › Yedek'teki dosyasıyla aynı;
// ek olarak panelden indirilemeyecek kadar büyük yüklenmiş belgeler de alınabilir. Veritabanına yazmaz (son yedek
// kaydı ve zil hatırlatması yalnız panelden indirilen yedekle değişir).
//
// Kullanım:
//   npm run db:backup                            -> ~/laffogato-yedek-2026-10-22-0915.json.gz
//   npm run db:backup -- --belgeler              -> panelden yüklenen fatura belgeleri de
//   npm run db:backup -- --cikti <dosya.json.gz> -> başka bir yere

import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { loadEnvConfig } from "@next/env";

import { backupFileName, backupSummaryText, databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { appVersion, writeBackupFile } from "../src/server/backup/core";
import { createDb } from "../src/server/db";

const USAGE = "Kullanım: npm run db:backup -- [--belgeler] [--cikti <dosya>]";

export async function runBackup(argv: string[], url: string | undefined, now = new Date()): Promise<string> {
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  let out = join(homedir(), backupFileName(now));
  let documents = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--belgeler") documents = true;
    else if (argv[i] === "--cikti" && argv[i + 1]) out = resolve(argv[++i]);
    else throw new Error(`Anlaşılmayan seçenek: ${argv[i]}. ${USAGE}`);
  }
  console.log(`Kaynak: ${databaseTarget(url).label}`);
  const db = createDb(url, 1);
  try {
    const s = await writeBackupFile(db.$client, out, { documents, createdBy: "komut satırı", app: appVersion(), now });
    const text = backupSummaryText({ tables: Object.keys(s.tables).length, rows: s.rows, bytes: s.bytes, documents: s.documents, docCount: s.docCount });
    console.log(`✓ Yedek yazıldı: ${out} · ${text}`);
    return out;
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("backup.ts")) {
  // Komut satırında verilen kaynak .env.local'dakinden önce gelir
  const shell = { ...process.env };
  loadEnvConfig(process.cwd());
  runBackup(process.argv.slice(2), databaseUrl(shell, process.env)).catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
