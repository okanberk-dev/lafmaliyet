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
 * istisnalar durur (parolalar, tek kullanımlık bağlantılar, cihaz anahtarları, şifreli belirteçler, uygulama
 * siparişlerindeki müşteri adları dosyaya yazılmaz). Adı gizli bir değer gibi görünen her yeni sütun ya da durum
 * anahtarı ya burada dışarıda bırakılır ya da testte gizli olmadığı yazılır (tests/yedek.test.ts).
 */

import { formatBytes } from "@/lib/documents";

export const BACKUP_FORMAT = "laffogato-yedek";
export const BACKUP_VERSION = 1;
/**
 * Panelden indirilen belgeli yedeğin (tahmini) boyutu en çok bu kadar olur (documentsDownloadBytes). Vercel'in yanıt
 * sınırı (4,5 MB) akan yanıtta da geçerli mi doğrulanmadı: 4,5 MB'ı aşan belgeli bir indirme canlıda denenene kadar
 * 4 MB. Daha büyüğü bilgisayardan alınır (npm run db:backup -- --belgeler).
 */
export const PANEL_DOCUMENTS_MAX_BYTES = 4 * 1024 * 1024;
/** Belgeler dosyada onaltılık metin olarak gzip'lenir: fotoğraf ve PDF sıkışmaz, ~%8 büyür (%10 sayılır) */
const DOCUMENT_GROWTH = 1.1;
/** Verinin kendi payı bilinmiyorsa (panelden henüz belgesiz yedek alınmadı): bugün 1 MB'ın çok altında */
const DATA_BYTES_GUESS = 1024 * 1024;
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

/**
 * Dosyaya yazılmayan durum anahtarları (integration_state) ve nedeni. Şifreli olanlar AUTH_SECRET'sız zaten okunamaz
 * ama dosyada durmaları gerekmez: uygulama yokluklarında yenisini alır.
 */
export const EXCLUDED_STATE_KEYS: Readonly<Record<string, string>> = {
  // Belirteçler her yenilemede değişir; yedekteki eski hâli işe yaramaz, AUTH_SECRET değişince de açılmaz
  "parasut.token": "Paraşüt oturumu (şifreli); geri yüklemeden sonra panelden “Paraşüt hesabını bağla” ile yeniden bağlanır",
  "parasut.legacyToken": "Paraşüt'ün eski parola yönteminin belirteci (şifreli, 10 Aralık 2026'ya kadar); ilk eşitlemede yeniden alınır",
  webpush_vapid: "bildirim anahtarı (şifreli); yenisi üretilir, cihazlar panel açılınca yeniden abone olur",
  // KVKK: laffogato.net'in açık uygulama siparişlerinin kopyası müşteri adlarını taşır; site bilerek geçmişsiz tutar,
  // bar ekranı açılınca siteden yeniden çekilir (docs/SITE-SIPARIS.md)
  site_orders: "uygulama siparişlerinin müşteri adları (sitenin geçmişsiz kopyası; bar ekranı yeniden çeker)",
};

const sqlList = (keys: string[]) => keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");

const MCP_SKIP = "Claude bağlantıları; geri yüklemeden sonra Claude'da yeniden bağlanılır";

export const TABLE_RULES: Record<string, TableRule> = {
  user_tokens: { skip: "tek kullanımlık bağlantılar (özet); yenisi gönderilir" },
  // Giriş bilgileri gibi (USER_CREDENTIAL_COLUMNS): bilinen cihazların hata sayacı ve kilidi geçicidir
  login_device_locks: { skip: "bilinen cihazların giriş deneme sayaçları (geçici)" },
  push_subscriptions: { skip: "cihazlar panel açılınca yeniden abone olur" },
  users: { dropColumns: USER_CREDENTIAL_COLUMNS },
  integration_state: { where: `key NOT IN (${sqlList(Object.keys(EXCLUDED_STATE_KEYS))})` },
  // Paraşüt'ün e-fatura PDF'i önbellektir (ilk açılışta yeniden indirilir); yalnız panelden yüklenenler
  invoice_documents: { where: `source = 'upload'`, documents: true },
  // Claude bağlantısı (docs/CLAUDE-BAGLANTISI.md): anahtar özetleri ve bağlantılar; beşi birden dışarıda kalır, atlanan
  // tabloya yabancı anahtarla bağlı yazılan satır olmasın
  mcp_clients: { skip: MCP_SKIP },
  mcp_codes: { skip: MCP_SKIP },
  mcp_grants: { skip: MCP_SKIP },
  mcp_tokens: { skip: MCP_SKIP },
  mcp_calls: { skip: MCP_SKIP },
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
  /** Yazılmayanlar; `documents`: hangi belgeler dışarıda (yalnız Paraşüt önbelleği ya da hepsi) */
  excluded: { tables: string[]; columns: Record<string, string[]>; stateKeys: string[]; documents: "parasut-onbellek" | "hepsi" };
}

export interface BackupEnd {
  tables: Record<string, number>;
  rows: number;
  sha256: string;
}

/** Yedeğe girmeyenler (başlıkta yazılır): atlanan tablolar, düşen sütunlar, dışarıda kalan durum anahtarları */
export function excludedFor(tables: string[], documents: boolean): BackupHeader["excluded"] {
  const skipped = tables.filter((t) => TABLE_RULES[t]?.skip || (TABLE_RULES[t]?.documents && !documents));
  const columns: Record<string, string[]> = {};
  for (const t of tables) if (TABLE_RULES[t]?.dropColumns) columns[t] = [...TABLE_RULES[t].dropColumns!];
  return { tables: skipped, columns, stateKeys: Object.keys(EXCLUDED_STATE_KEYS), documents: documents ? "parasut-onbellek" : "hepsi" };
}

/** Bir satır: JSON + "\n" */
export const encodeLine = (v: unknown) => `${JSON.stringify(v)}\n`;
/** Satır satırı veritabanının row_to_json metniyle kurulur (sayılar ve tarihler yeniden yazılmaz) */
export const ROW_PREFIX = '{"r":';
export const rowLine = (json: string) => `${ROW_PREFIX}${json}}\n`;
/** Son satırın başı; ondan önceki her satır özete girer */
export const END_PREFIX = '{"end":';

const TR_OFFSET_MS = 3 * 3600_000;
const TZ = "Europe/Istanbul";

/**
 * Komut satırının veritabanı adresi: önce havuzsuz bağlantı (uzun işlem PgBouncer'dan geçmesin). Ortamlar sırayla
 * denenir: kabukta verilen (DATABASE_URL=… npm run …) .env.local'dakinden önce gelir; yoksa .env.local'daki canlının
 * havuzsuz adresi elle verilen yerel adresin önüne geçerdi.
 */
export function databaseUrl(...envs: Record<string, string | undefined>[]): string | undefined {
  for (const e of envs) {
    const url = e.DATABASE_URL_UNPOOLED || e.DATABASE_URL || e.POSTGRES_URL;
    if (url) return url;
  }
  return undefined;
}

/**
 * Komut satırının yazdığı hedef: "sunucu/veritabanı" (kullanıcı adı ve parola yazılmaz). `local`: bu bilgisayardaki
 * veritabanı; değilse (Neon) üzerine yazmak sunucu adıyla onay ister.
 */
export function databaseTarget(url: string): { host: string; database: string; local: boolean; label: string } {
  let host = "";
  let database = "";
  try {
    const u = new URL(url);
    host = decodeURIComponent(u.hostname) || u.searchParams.get("host") || "localhost";
    database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  } catch {
    host = "?";
  }
  const local = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i.test(host) || host.startsWith("/");
  return { host, database, local, label: `${host}/${database}` };
}

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
 * Geri yüklemede bir migration'dan HEMEN ÖNCE çalışan ek SQL, migration adına göre (src/server/backup/restore.ts ›
 * applyMigrations). Veri yedeğin sürümünde yüklendiği için sonraki migration'lar dolu tablolarda çalışır; boş
 * veritabanında geçen bir migration orada takılabilir. Uygulanmış migration dosyası değiştirilmez (docs/DEPLOY.md ›
 * Migration kuralları): böyle bir durumun düzeltmesi buraya yazılır. Her adım tekrar çalışsa da sonucu değiştirmemeli.
 *
 * 0056_sube_kirilimi şube sütunlarını DEFAULT 'tuzla' ile ekleyip `branches`'a yabancı anahtar kurar; varsayılan şube
 * kütüğe migration'la ancak 0057'de yazılır. Canlıda tohum (`branches_seeded`) 0053 ile 0056 arasında çalıştığı için
 * geçti; 0053'ten (4 Kasım 2026) önce alınmış bir yedekte ay, satış, personel ya da kasa satırı varken 0056 yabancı
 * anahtar hatası verir, bütün geri yükleme geri alınırdı. Satır 0057'dekinin aynısıdır (var olan kayda dokunmaz): sonuç
 * 0057'nin vereceğiyle aynı, yalnız bir migration erken (tests/yedek.test.ts ikisini karşılaştırır).
 */
export const BEFORE_MIGRATION_SQL: Readonly<Record<string, readonly string[]>> = {
  "0056_sube_kirilimi": [
    `INSERT INTO "branches" ("id", "name", "kind", "pos_source", "sort_order") VALUES ('tuzla', 'Tuzla', 'fiziksel', 'modpos', 1) ON CONFLICT ("id") DO NOTHING;`,
  ],
};

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
  /** Parolası hedeften korunanlar ve davet bekleyenler (e-postası hedefte olmayan aktif kişiler), adlarıyla */
  kept: string[];
  invited: string[];
  /** Parolası ADMIN_PASSWORD yapılan kişinin e-postası; kullanılmadıysa null */
  admin: string | null;
}

/**
 * Yedekteki kullanıcılara giriş bilgisi verir: hedefte aynı e-posta (büyük/küçük harf farkı yok) varsa onun parolası ve
 * iki adımlı doğrulaması, yoksa "davet bekliyor" (parola yok, bağlantı gönderilir).
 *
 * ADMIN_EMAIL + ADMIN_PASSWORD: o kişi aktif yönetici olur, parolası budur (yedekte yoksa eklenir). `mode: "always"`
 * boş ya da yerel bir hedefte (prova, yeni veritabanı); `"lockout"` dolu bir canlı veritabanında: yalnız hiçbir aktif
 * yöneticinin parolası korunmadıysa (kimse yönetici olarak giremeyecekse). Yoksa geliştiricinin .env.local'daki yerel
 * yönetici hesabı canlıya eklenir ya da sahibin bugünkü parolası ortamdaki eski değerle değişirdi.
 *
 * Herkesin oturum sürümü hedefteki en büyüğün bir fazlası: eski bütün oturum çerezleri geçersiz olur. Kişi başına
 * "eskisi + 1" yetmezdi: yedekte kimlikler başka kişilere ait olabilir, eski bir çerez başkasının satırında aynı sürüme
 * denk gelip o kişinin oturumunu açabilirdi.
 */
export function mergeUserRows(
  rows: Record<string, unknown>[],
  saved: SavedCredentials[],
  opts: {
    inviteHash: string;
    maxSv: number;
    admin?: { email: string; hash: string; name: string } | null;
    mode?: "always" | "lockout";
  },
): MergedUsers {
  const byEmail = new Map(saved.map((c) => [c.email.trim().toLowerCase(), c]));
  const sv = Math.max(0, opts.maxSv) + 1;
  const kept: string[] = [];
  const invited: string[] = [];
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
    // Hedefte de davet bekliyorsa korunan bir parola yok
    const hasPassword = Boolean(c) && c!.password_hash !== opts.inviteHash;
    return { row: { ...r, ...creds, failed_logins: 0, locked_until: null, session_version: sv } as Record<string, unknown>, email, hasPassword };
  });

  const adminEmail = opts.admin?.email.trim().toLowerCase() || null;
  // Korunan parolasıyla girebilecek aktif bir yönetici varsa "lockout" kipinde ADMIN_* kullanılmaz
  const adminCanLogIn = out.some((u) => u.hasPassword && u.row.role === "admin" && u.row.active !== false);
  const useAdmin = Boolean(adminEmail) && (opts.mode !== "lockout" || !adminCanLogIn);
  let adminFound = false;
  for (const u of out) {
    if (useAdmin && u.email === adminEmail) {
      // Bu kişi yönetici olarak girebilsin: parolası ADMIN_PASSWORD, rolü yönetici, hesabı aktif
      Object.assign(u.row, { password_hash: opts.admin!.hash, role: "admin", active: true });
      adminFound = true;
      continue;
    }
    const name = String(u.row.name ?? u.email);
    if (u.hasPassword) kept.push(name);
    else if (u.row.active !== false) invited.push(name);
  }
  const newAdmin =
    useAdmin && !adminFound
      ? { email: adminEmail, name: opts.admin!.name, password_hash: opts.admin!.hash, role: "admin", active: true, totp_enabled: false, session_version: sv }
      : null;
  return { rows: out.map((u) => u.row), newAdmin, kept, invited, admin: useAdmin ? adminEmail : null };
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
  /** Verinin kendi payı: son belgesiz yedeğin boyutu (belgeli indirmenin tahmini için; documentsDownloadBytes) */
  dataBytes?: number;
}

/** Yeni kaydın dataBytes'ı: belgesiz yedekte dosyanın boyutu; belgeli yedekte ayrılamaz, önceki kayıttan taşınır */
export function nextDataBytes(documents: boolean, bytes: number, prev: Pick<LastBackup, "dataBytes"> | null): number | undefined {
  return documents ? prev?.dataBytes : bytes;
}

/**
 * Belgeli panel indirmesinin tahmini boyutu: yüklenen belgeler (~%10 büyür) ve verinin kendisi (son belgesiz yedeğin
 * boyutu, bilinmiyorsa 1 MB). Belgelerin ham toplamına bakmak yetmezdi: 4 MB'lık fotoğraf dosyada 4,3 MB'ı geçer, üstüne
 * veri gelir. PANEL_DOCUMENTS_MAX_BYTES'ı aşarsa panel belgeli yedek vermez; kart ve eylem aynı hesabı yapar.
 */
export function documentsDownloadBytes(uploadBytes: number, last: Pick<LastBackup, "dataBytes"> | null): number {
  return Math.ceil(uploadBytes * DOCUMENT_GROWTH) + (last?.dataBytes ?? DATA_BYTES_GUESS);
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

/** Ekranda boyut: sayı ve birim ayrı satırlara bölünmesin ("1,2 MB", araları bölünmez boşluk) */
export const sizeText = (bytes: number) => formatBytes(bytes).replace(" ", "\u00a0");

/** Belgeli yedek panelden inemeyecekse kartta ve eylemde aynı söz: "Belgelerle yedek yaklaşık 4,6 MB olur, …" */
export const documentsTooBigText = (estimate: number) =>
  `Belgelerle yedek yaklaşık ${sizeText(estimate)} olur, panelden en çok ${sizeText(PANEL_DOCUMENTS_MAX_BYTES).replace(",0\u00a0", "\u00a0")} iner`;

/** Ayarlar › Yedek kartının telefonda kapalı satırı: "Son yedek 12 Eki · 1,2 MB", "Son yedek 34 gün önce" */
export function backupCardSummary(last: LastBackup | null, now: Date): string {
  if (!last) return "Henüz yedek indirilmedi";
  const days = backupAgeDays(last.at, now);
  if (days >= BACKUP_REMIND_DAYS) return `Son yedek ${days} gün önce`;
  const day = new Date(last.at).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: TZ });
  return `Son yedek ${day} · ${sizeText(last.bytes)}`;
}

/** Kartın içindeki satır: "12 Ekim 2026 09:15 · Okan · 1,2 MB · belgeler hariç" */
export function lastBackupText(last: LastBackup): string {
  const at = new Date(last.at).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const docs = last.documents ? `${thousands(last.docCount)} belge dahil` : "belgeler hariç";
  return [at, last.by, sizeText(last.bytes), docs].filter(Boolean).join(" · ");
}
