/*
 * Tam yedek dosyasının biçimi (sürüm 1) ve saf kuralları (tests/yedek.test.ts sınar; docs/YEDEK.md aynısını anlatır).
 *
 * Dosya: UTF-8 JSON satırlarının (her satır bir JSON değeri, "\n" ile biter) gzip'i.
 *   1. satır: başlık  {"format":"laffogato-yedek","version":1,"createdAt":…,"createdBy":…,"app":…,"documents":…,
 *                      "migrations":[{"hash":…,"createdAt":…}],"excluded":{…}}
 *   her tablo: {"table":"<ad>","columns":[…]} ardından satır başına {"r":{…}} (row_to_json; tablolar alfabe sırasıyla)
 *   son satır: {"end":{"tables":{"<ad>":<satır>},"rows":<toplam>,"sha256":"<hex>"}}
 * sha256, son satırdan önceki bütün satırların ("\n" dahil) UTF-8 baytlarını kapsar: son satır yoksa ya da özet
 * tutmuyorsa dosya yarıda kesilmiş ya da bozulmuştur, geri yüklenmez.
 *
 * Tablolar çalışırken information_schema'dan bulunur: yeni bir tablo kod değişmeden yedeğe girer. Burada yalnız
 * istisnalar durur (parolalar, tek kullanımlık bağlantılar, cihaz anahtarları, şifreli belirteçler dosyaya yazılmaz).
 */

import { formatBytes } from "@/lib/documents";

export const BACKUP_FORMAT = "laffogato-yedek";
export const BACKUP_VERSION = 1;
/**
 * Panelden indirilen yedeğe eklenebilecek yüklenmiş belgelerin toplamı. Vercel'in yanıt sınırı (4,5 MB) akan yanıtta
 * da geçerli mi doğrulanmadı: 4,5 MB'ı aşan belgeli bir indirme canlıda denenene kadar 4 MB. Daha büyüğü bilgisayardan
 * alınır (npm run db:backup -- --belgeler).
 */
export const PANEL_DOCUMENTS_MAX_BYTES = 4 * 1024 * 1024;
/** Son yedek bundan eskiyse zil hatırlatır, kart rozet gösterir */
export const BACKUP_REMIND_DAYS = 30;
/** Yedek uyarısının ve kartın yeri: Ayarlar › Yedek */
export const BACKUP_HREF = "/panel/ayarlar#yedek";

export interface TableRule {
  /** Tablo hiç yazılmaz; neden */
  skip?: string;
  /** Yazılmayan sütunlar */
  dropColumns?: readonly string[];
  /** Yalnız bu koşulu tutan satırlar (SQL; yalnız buradaki sabit metin, kullanıcı girdisi değil) */
  where?: string;
  /** Yüklenmiş belgeler: yalnız "belgeleri de ekle" seçilince yazılır */
  documents?: true;
}

/** Giriş bilgileri: dosyaya yazılmaz; geri yüklemede hedefteki aynı e-postanın bilgisi korunur (mergeUserRows) */
export const USER_CREDENTIAL_COLUMNS = [
  "password_hash",
  "totp_secret",
  "totp_enabled",
  "totp_last_step",
  "recovery_codes",
  "failed_logins",
  "locked_until",
  "session_version",
] as const;

/** AUTH_SECRET ile şifreli durum anahtarları: Paraşüt belirteci yeniden alınır, bildirim anahtarı yenilenir */
export const SECRET_STATE_KEYS = ["parasut.token", "webpush_vapid"] as const;

export const TABLE_RULES: Record<string, TableRule> = {
  user_tokens: { skip: "tek kullanımlık bağlantılar (özet); yenisi gönderilir" },
  push_subscriptions: { skip: "cihazlar panel açılınca yeniden abone olur" },
  users: { dropColumns: USER_CREDENTIAL_COLUMNS },
  integration_state: { where: `key NOT IN (${SECRET_STATE_KEYS.map((k) => `'${k}'`).join(", ")})` },
  // Paraşüt'ün e-fatura PDF'i önbellektir (ilk açılışta yeniden indirilir); yalnız panelden yüklenenler
  invoice_documents: { where: `source = 'upload'`, documents: true },
};

export interface BackupMigration {
  hash: string;
  createdAt: number;
}

export interface BackupHeader {
  format: string;
  version: number;
  createdAt: string;
  createdBy: string;
  /** Yedeği alan sürüm (Vercel'de commit'in ilk 7 karakteri, yerelde "yerel") */
  app: string;
  documents: boolean;
  /** Kaynak veritabanının drizzle.__drizzle_migrations kayıtları: şema sürümü */
  migrations: BackupMigration[];
  excluded: { tables: string[]; columns: Record<string, string[]>; stateKeys: string[]; documents: "parasut-onbellek" | "hepsi" };
}

export interface BackupEnd {
  tables: Record<string, number>;
  rows: number;
  sha256: string;
}

/** Yedeğe girmeyenler (başlıkta yazılır): atlanan tablolar, düşen sütunlar, şifreli anahtarlar */
export function excludedFor(tables: string[], documents: boolean): BackupHeader["excluded"] {
  const skipped = tables.filter((t) => TABLE_RULES[t]?.skip || (TABLE_RULES[t]?.documents && !documents));
  const columns: Record<string, string[]> = {};
  for (const t of tables) if (TABLE_RULES[t]?.dropColumns) columns[t] = [...TABLE_RULES[t].dropColumns!];
  return { tables: skipped, columns, stateKeys: [...SECRET_STATE_KEYS], documents: documents ? "parasut-onbellek" : "hepsi" };
}

/** Bir satır: JSON + "\n" */
export const encodeLine = (v: unknown) => `${JSON.stringify(v)}\n`;
/** Satır satırı veritabanının row_to_json metniyle kurulur (sayılar ve tarihler yeniden yazılmaz) */
export const ROW_PREFIX = '{"r":';
export const rowLine = (json: string) => `${ROW_PREFIX}${json}}\n`;

const TR_OFFSET_MS = 3 * 3600_000;

/** laffogato-yedek-2026-10-22-0915.json.gz (İstanbul saati); `before` verilirse geri yükleme öncesi kopyası */
export function backupFileName(now: Date, before?: { host: string }): string {
  const t = new Date(now.getTime() + TR_OFFSET_MS).toISOString();
  const stamp = `${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}`;
  const host = before ? `once-${before.host.replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 60)}-` : "";
  return `laffogato-yedek-${host}${stamp}.json.gz`;
}

export type SchemaPlan =
  | {
      error: null;
      /** Yedeğin uyguladığı en yeni günlük girdisinin zamanı: veri bu sürümde yüklenir, sonrakiler veriden sonra */
      upTo: number;
      fromTag: string;
      toTag: string;
      /** Veriden sonra uygulanacak migration sayısı */
      later: number;
      /** Yedekte olup günlükte olmayan kayıtlar (ör. bir önizlemenin uyguladığı): uyarı */
      unknown: number[];
      /** upTo'dan eski olup yedekte kaydı olmayan günlük girdileri (kaynakta atlanmış): veriden önce uygulanır, uyarı */
      missing: string[];
    }
  | { error: string };

/**
 * Yedeğin şema sürümü ile koddaki migration günlüğü: veri yedeğin sürümünde yüklenir (o sürüme kadar migration, veri,
 * sonra kalan migration'lar; veri migration'ları da geri yüklenen satırlarda çalışır). Yedek koddan yeniyse yüklenmez.
 */
export function backupSchemaPlan(migrations: BackupMigration[], journal: { when: number; tag: string }[]): SchemaPlan {
  if (!journal.length) return { error: "Kodda migration günlüğü yok (drizzle/meta/_journal.json)." };
  if (!migrations.length) return { error: "Yedekte şema sürümü (migration kaydı) yok; bu dosya geri yüklenemez." };
  const newest = journal[journal.length - 1];
  const applied = new Set(migrations.map((m) => Number(m.createdAt)));
  if ([...applied].some((t) => t > newest.when)) return { error: "Yedek bu koddan daha yeni bir sürümle alınmış: önce kodu güncelleyin (git pull)." };
  const known = journal.filter((e) => applied.has(e.when));
  if (!known.length) return { error: "Yedeğin şema sürümü bu kodun migration günlüğünde yok; bu dosya geri yüklenemez." };
  const from = known[known.length - 1];
  const journalWhens = new Set(journal.map((e) => e.when));
  return {
    error: null,
    upTo: from.when,
    fromTag: from.tag,
    toTag: newest.tag,
    later: journal.filter((e) => e.when > from.when).length,
    unknown: [...applied].filter((t) => !journalWhens.has(t)).sort((a, b) => a - b),
    missing: journal.filter((e) => e.when < from.when && !applied.has(e.when)).map((e) => e.tag),
  };
}

/**
 * Tabloları yükleme sırasına dizer: her tablo başvurduğu (yabancı anahtar) tablolardan sonra. Hazır olanlar arasında
 * alfabe sırası (sonuç her seferinde aynı). Kendine başvuru yok sayılır; döngü olursa kalanlar alfabe sırasıyla sona.
 */
export function orderTables(tables: string[], edges: { child: string; parent: string }[]): string[] {
  const names = [...new Set(tables)].sort();
  const set = new Set(names);
  const parents = new Map(names.map((n) => [n, new Set<string>()]));
  for (const e of edges) if (e.child !== e.parent && set.has(e.child) && set.has(e.parent)) parents.get(e.child)!.add(e.parent);
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < names.length) {
    const next = names.find((n) => !done.has(n) && [...parents.get(n)!].every((p) => done.has(p)));
    if (!next) {
      for (const n of names) if (!done.has(n)) out.push(n);
      break;
    }
    out.push(next);
    done.add(next);
  }
  return out;
}

/** Hedefte geri yüklemeden önce okunan giriş bilgileri */
export interface SavedCredentials {
  email: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: number | null;
  recovery_codes: unknown;
  session_version: number;
}

export interface MergedUsers {
  rows: Record<string, unknown>[];
  /** ADMIN_EMAIL yedekte yoksa eklenecek yönetici (kimliği sayaçtan) */
  newAdmin: Record<string, unknown> | null;
  /** Parolası hedeften korunanlar, davet bekleyenler (e-postası hedefte olmayanlar), parolası ADMIN_PASSWORD olan */
  kept: string[];
  invited: string[];
  admin: string | null;
}

/**
 * Yedekteki kullanıcılara giriş bilgisi verir: hedefte aynı e-posta (büyük/küçük harf farkı yok) varsa onun parolası ve
 * iki adımlı doğrulaması, yoksa "davet bekliyor" (parola yok, bağlantı gönderilir). ADMIN_EMAIL + ADMIN_PASSWORD
 * verildiyse o kişinin parolası odur (yedekte yoksa yönetici olarak eklenir).
 * Herkesin oturum sürümü hedefteki en büyüğün bir fazlası: eski bütün oturum çerezleri geçersiz olur. Kişi başına
 * "eskisi + 1" yetmezdi: yedekte kimlikler başka kişilere ait olabilir, eski bir çerez başkasının satırında aynı sürüme
 * denk gelip o kişinin oturumunu açabilirdi.
 */
export function mergeUserRows(
  rows: Record<string, unknown>[],
  saved: SavedCredentials[],
  opts: { inviteHash: string; maxSv: number; admin?: { email: string; hash: string; name: string } | null },
): MergedUsers {
  const byEmail = new Map(saved.map((c) => [c.email.trim().toLowerCase(), c]));
  const sv = Math.max(0, opts.maxSv) + 1;
  const adminEmail = opts.admin?.email.trim().toLowerCase() || null;
  const kept: string[] = [];
  const invited: string[] = [];
  let admin: string | null = null;
  const out = rows.map((r) => {
    const email = String(r.email ?? "").trim().toLowerCase();
    const c = byEmail.get(email);
    const creds = c
      ? {
          password_hash: c.password_hash,
          totp_secret: c.totp_secret,
          totp_enabled: c.totp_enabled,
          totp_last_step: c.totp_last_step,
          recovery_codes: c.recovery_codes ?? null,
        }
      : { password_hash: opts.inviteHash, totp_secret: null, totp_enabled: false, totp_last_step: null, recovery_codes: null };
    const name = String(r.name ?? email);
    if (adminEmail && email === adminEmail) {
      creds.password_hash = opts.admin!.hash;
      admin = email;
    } else if (c) {
      kept.push(name);
    } else if (r.active !== false) {
      invited.push(name);
    }
    return { ...r, ...creds, failed_logins: 0, locked_until: null, session_version: sv };
  });
  const newAdmin =
    adminEmail && !admin
      ? { email: adminEmail, name: opts.admin!.name, password_hash: opts.admin!.hash, role: "admin", active: true, totp_enabled: false, session_version: sv }
      : null;
  return { rows: out, newAdmin, kept, invited, admin: adminEmail };
}

/** Panelde saklanan son yedek (integration_state › backup.last; dosya tamamen gönderilince yazılır) */
export interface LastBackup {
  at: string;
  by: string;
  bytes: number;
  rows: number;
  tables: number;
  documents: boolean;
  docCount: number;
}

const trDay = (d: Date) => new Date(d.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);

/** Son yedekten bu yana geçen gün (İstanbul günü) */
export function backupAgeDays(lastAt: string, now: Date): number {
  return Math.round((Date.parse(trDay(now)) - Date.parse(trDay(new Date(lastAt)))) / 86_400_000);
}

/** Yedek hatırlatması gerekiyor mu: hiç yedek yoksa ya da son yedek 30 günden eskiyse */
export function backupDue(lastAt: string | null, now: Date): boolean {
  return lastAt === null || backupAgeDays(lastAt, now) >= BACKUP_REMIND_DAYS;
}

/**
 * Zildeki yedek hatırlatması (yalnız canlıda; src/lib/job-health.ts › systemAlerts ekler). Kimlik son yedeğin
 * gününden: okundu işareti yeni bir yedek alınana kadar kalır.
 */
export function backupReminder(lastAt: string | null, now: Date): { id: string; title: string; body: string } | null {
  if (!backupDue(lastAt, now)) return null;
  return {
    id: `yedek-${lastAt ? trDay(new Date(lastAt)) : "yok"}`,
    title: lastAt ? `Yedek almayalı ${backupAgeDays(lastAt, now)} gün oldu` : "Henüz yedek indirilmedi",
    body: "Ayarlar › Yedek › Yedeği indir; dosyayı bilgisayarınızda ya da Drive'da saklayın.",
  };
}

const thousands = (n: number) => new Intl.NumberFormat("tr-TR").format(n);

/** İşlem geçmişi ve komut satırı: "41 tablo · 4.312 satır · 1,2 MB · belgeler hariç" */
export function backupSummaryText(v: { tables: number; rows: number; bytes: number; documents: boolean; docCount: number }): string {
  const docs = v.documents ? `${thousands(v.docCount)} belge dahil` : "belgeler hariç";
  return `${v.tables} tablo · ${thousands(v.rows)} satır · ${formatBytes(v.bytes)} · ${docs}`;
}
