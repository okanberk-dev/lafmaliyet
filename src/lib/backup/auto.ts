/*
 * Otomatik haftalık yedeğin saf kuralları (tests/yedek-oto.test.ts; docs/YEDEK.md › Otomatik haftalık yedek).
 *
 * Sabah işi (src/app/api/cron/gunluk/route.ts) her gün bakar: içinde bulunulan haftanın (pazartesi başlar, İstanbul
 * günü) depoda yedeği yoksa tam yedeği alır ve özel depoya yazar. Yani yedek pazartesi alınır; o gün alınamazsa salı,
 * çarşamba… yeniden denenir. Depoda en yeni 8 dosya kalır, eskisi silinir. Dosyanın biçimi panelden indirilen yedekle
 * aynıdır (src/lib/backup/format.ts; yazılmayan gizli değerler de aynı), `npm run db:restore` ile yüklenir.
 */

import { formatBytes } from "@/lib/documents";

/** Depodaki klasör (özel Vercel Blob; yerelde .data/backups altında) */
export const AUTO_BACKUP_PREFIX = "yedek/haftalik/";
/** Saklanan dosya sayısı: son 8 hafta */
export const AUTO_BACKUP_KEEP = 8;
/** En yeni otomatik yedek bu kadar günden eskiyse kart "Gecikti" der (bir hafta + üç deneme günü) */
export const AUTO_BACKUP_STALE_DAYS = 10;
/** Durum kaydı (integration_state): son deneme ve son başarılı yedek */
export const AUTO_BACKUP_STATE_KEY = "backup.auto";

const TR_OFFSET_MS = 3 * 3600_000;
const TZ = "Europe/Istanbul";
const NAME_RE = /^laffogato-yedek-oto-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-[0-9a-f]{8}\.json\.gz$/;

const trDay = (d: Date) => new Date(d.getTime() + TR_OFFSET_MS).toISOString().slice(0, 10);

/** laffogato-yedek-oto-2026-11-23-0812-1a2b3c4d.json.gz (İstanbul saati; son ek rastgele: aynı dakikada iki dosya çakışmaz) */
export function autoBackupName(now: Date, suffix: string): string {
  const t = new Date(now.getTime() + TR_OFFSET_MS).toISOString();
  return `laffogato-yedek-oto-${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}-${suffix}.json.gz`;
}

/** Yalnız autoBackupName'in ürettiği adlar (indirme rotası ve dosya sistemi sürücüsü başka ad kabul etmez) */
export const isAutoBackupName = (name: string) => NAME_RE.test(name);

/** Addan gün ve an; ad bizim değilse null */
export function parseAutoBackupName(name: string): { day: string; at: string } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) - TR_OFFSET_MS;
  return Number.isFinite(ms) ? { day: m[1], at: new Date(ms).toISOString() } : null;
}

/** Günün haftasının pazartesisi (YYYY-AA-GG) */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Depodaki bir yedek (ad, boyut; gün ve an addan) */
export interface StoredBackup {
  name: string;
  bytes: number;
  day: string;
  at: string;
}

/** Deponun listesinden bizim dosyalarımız, yeni önce (yabancı adlar atlanır) */
export function storedBackups(files: { name: string; bytes: number }[]): StoredBackup[] {
  return files
    .flatMap((f) => {
      const p = parseAutoBackupName(f.name);
      return p ? [{ name: f.name, bytes: f.bytes, ...p }] : [];
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** Bu haftanın yedeği yok mu: yoksa bugün alınır (pazartesi; alınamadıysa haftanın sonraki günleri) */
export function autoBackupDue(items: Pick<StoredBackup, "day">[], now: Date): boolean {
  const week = weekStart(trDay(now));
  return !items.some((i) => weekStart(i.day) === week);
}

/** Silinecek dosyalar: en yeni `keep` dosyanın dışındakiler (yabancı adlara dokunulmaz) */
export function autoBackupsToDelete(items: Pick<StoredBackup, "name">[], keep = AUTO_BACKUP_KEEP): string[] {
  return [...items.map((i) => i.name)].sort().reverse().slice(keep);
}

/** integration_state › backup.auto */
export interface AutoBackupState {
  /** Son deneme (başarılı ya da değil) */
  lastAttemptAt: string | null;
  /** Son deneme hata verdiyse metni; başarılıysa null */
  lastError: string | null;
  /** Son başarılı yedek */
  lastOk: { at: string; name: string; bytes: number; rows: number; tables: number } | null;
}

export const EMPTY_AUTO_BACKUP_STATE: AutoBackupState = { lastAttemptAt: null, lastError: null, lastOk: null };

export function asAutoBackupState(v: unknown): AutoBackupState {
  if (!v || typeof v !== "object") return EMPTY_AUTO_BACKUP_STATE;
  const o = v as Record<string, unknown>;
  const iso = (x: unknown) => (typeof x === "string" && Number.isFinite(Date.parse(x)) ? x : null);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const ok = o.lastOk && typeof o.lastOk === "object" ? (o.lastOk as Record<string, unknown>) : null;
  const okAt = ok ? iso(ok.at) : null;
  return {
    lastAttemptAt: iso(o.lastAttemptAt),
    lastError: typeof o.lastError === "string" && o.lastError ? o.lastError : null,
    lastOk: ok && okAt && typeof ok.name === "string" ? { at: okAt, name: ok.name, bytes: n(ok.bytes), rows: n(ok.rows), tables: n(ok.tables) } : null,
  };
}

const dayText = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", timeZone: TZ });
const ageDays = (iso: string, now: Date) => Math.round((Date.parse(trDay(now)) - Date.parse(trDay(new Date(iso)))) / 86_400_000);
const size = (bytes: number) => formatBytes(bytes).replace(" ", " ");

export interface AutoBackupStatus {
  tone: "ok" | "warn" | "bad" | "off";
  /** Rozet: "Çalışıyor", "Alınamadı", "Gecikti", "Depo yok", "Bekliyor" */
  badge: string;
  text: string;
}

/**
 * Ayarlar › Yedek'teki durum satırı. Depo yoksa (Vercel'de Blob bağlı değil) kapalı; son deneme en yeni dosyadan sonra
 * hata verdiyse kırmızı (hata metniyle; sabah işi ertesi gün yeniden dener); en yeni dosya 10 günden eskiyse turuncu;
 * hiç dosya yoksa ilk sabah işini bekler.
 */
export function autoBackupStatus(i: { available: boolean; state: AutoBackupState; items: Pick<StoredBackup, "at" | "bytes">[]; now: Date }): AutoBackupStatus {
  if (!i.available) return { tone: "off", badge: "Depo yok", text: "Otomatik yedek kapalı: bu ortamda özel dosya deposu (Vercel Blob) bağlı değil." };
  const newest = i.items[0] ?? null;
  const { lastError, lastAttemptAt } = i.state;
  if (lastError && lastAttemptAt && (!newest || Date.parse(lastAttemptAt) > Date.parse(newest.at))) {
    return { tone: "bad", badge: "Alınamadı", text: `Son deneme (${dayText(lastAttemptAt)}) başarısız: ${lastError}. Sabah işi yarın yeniden dener.` };
  }
  if (!newest) return { tone: "warn", badge: "Bekliyor", text: "Henüz otomatik yedek yok; ilk yedek bir sonraki sabah işinde alınır." };
  const age = ageDays(newest.at, i.now);
  if (age >= AUTO_BACKUP_STALE_DAYS) {
    return { tone: "warn", badge: "Gecikti", text: `Son otomatik yedek ${age} gün önce alındı (${dayText(newest.at)}). Ayarlar › Günlük işler'e bakın.` };
  }
  return { tone: "ok", badge: "Çalışıyor", text: `Son otomatik yedek ${dayText(newest.at)} · ${size(newest.bytes)}. Her pazartesi alınır, son ${AUTO_BACKUP_KEEP} hafta saklanır.` };
}

/** Listede bir satır: "23 Kasım 2026 Pazartesi 08:12" */
export function storedBackupLabel(b: Pick<StoredBackup, "at">): string {
  return new Date(b.at).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** Otomatik yedeğin sonucu (src/server/backup/auto.ts runAutoBackup) */
export type AutoBackupResult =
  | { status: "ok"; name: string; bytes: number; rows: number; tables: number; deleted: number }
  /** Bu haftanın yedeği var */
  | { status: "skip" }
  /** Depo yok */
  | { status: "off" }
  | { status: "error"; error: string };
