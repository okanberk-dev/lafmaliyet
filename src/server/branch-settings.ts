import "server-only";

import { asc, eq, inArray, sql } from "drizzle-orm";

import { sortBranches, type BranchRow } from "@/lib/branches";
import { legacyOwnerId, plainFields, type BranchSettingGroup } from "@/lib/branch-settings/groups";
import { settingCloseError, settingLinkError, settingMode, settingSource, type SettingLink, type SettingMode } from "@/lib/branch-settings/rules";
import { UserError } from "@/server/actions/util";
import { currentVia } from "@/server/activity-via";
import { getDb, schema as s, type DB } from "@/server/db";
import { open, seal } from "@/server/secret-box";

/*
 * Şube başına ayarların okunması ve yazılması (docs/SUBE.md › Şube başına ayarlar; tablo branch_settings, gruplar
 * src/lib/branch-settings/groups.ts, kurallar src/lib/branch-settings/rules.ts).
 *
 * Çözüm sırası: şubenin kendi satırı; bağlıysa ("aynı") hedefin satırı; değerin okunduğu şube eski genel kaydın sahibiyse
 * eski kayıt (integration_state › cash.settings); yoksa ortam değişkeni ya da grubun varsayılanı (group.read). Veri göçü
 * yok: ilk kayıtta satır yazılır, eski kayıt bırakılır (geri dönüş güvenli).
 *
 * Yazımlar tek işlemdir; aynı grubun yazımları sıraya girer (grup başına işlem kilidi) ki iki sekme aynı anda birbirine
 * bağlanıp döngü kurmasın. Yetki çağıranda (yalnız yönetici; src/server/actions/branch-settings.ts, cash-report.ts).
 */

/** Okuma yapan her şey: veritabanı ya da açık bir işlem */
type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

type Row = typeof s.branchSettings.$inferSelect;

/** Gizli alanın durumu: kayıtlı, kayıtlı ama açılamıyor (AUTH_SECRET değişti), yok */
export type SecretState = "saved" | "unreadable" | "none";

export interface ResolvedSetting<T> {
  /** Kullanılan değer (gizli alanlar açılmış; yalnız sunucuda) */
  value: T;
  mode: SettingMode;
  /** Değerin okunduğu şube */
  from: string;
  /** Gizli alanların durumu (istemciye giden tek bilgi) */
  secrets: Record<string, SecretState>;
}

async function branchesOf(db: Reader): Promise<BranchRow[]> {
  const rows = await db
    .select({
      id: s.branches.id,
      name: s.branches.name,
      kind: s.branches.kind,
      posSource: s.branches.posSource,
      active: s.branches.active,
      openedOn: s.branches.openedOn,
      sortOrder: s.branches.sortOrder,
    })
    .from(s.branches)
    .orderBy(asc(s.branches.sortOrder), asc(s.branches.name));
  return sortBranches(rows);
}

async function rowsOf(db: Reader, grp: string): Promise<Row[]> {
  return db.select().from(s.branchSettings).where(eq(s.branchSettings.grp, grp));
}

async function legacyRaw(db: Reader, key: string): Promise<Record<string, unknown>> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, key)).limit(1);
  const v = row?.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Satırın gizli alanları açılmış hâli ve her alanın durumu */
function openSecrets(group: BranchSettingGroup, row: Row | undefined): { plain: Record<string, string>; state: Record<string, SecretState> } {
  const sealed = asObject(row?.secrets);
  const plain: Record<string, string> = {};
  const state: Record<string, SecretState> = {};
  for (const f of group.secretFields) {
    const v = sealed[f];
    if (typeof v !== "string" || !v) {
      state[f] = "none";
      continue;
    }
    const opened = open(v, "branch-settings");
    if (opened === null) state[f] = "unreadable";
    else {
      plain[f] = opened;
      state[f] = "saved";
    }
  }
  return { plain, state };
}

/** Saf çözüm: satırlar, şubeler ve (gerekirse) eski kayıtla */
async function resolveWith<T extends Record<string, unknown>>(
  db: Reader,
  group: BranchSettingGroup<T>,
  branchId: string,
  rows: readonly Row[],
  branches: readonly BranchRow[],
): Promise<ResolvedSetting<T>> {
  const { from, mode } = settingSource(group, branchId, rows, branches);
  const own = rows.find((r) => r.branchId === from && !r.sameAs);
  let raw: Record<string, unknown> = {};
  let secrets: Record<string, SecretState> = Object.fromEntries(group.secretFields.map((f) => [f, "none" as const]));
  if (own) {
    const opened = openSecrets(group, own);
    raw = { ...asObject(own.value), ...opened.plain };
    secrets = opened.state;
  } else if (from === legacyOwnerId(group)) {
    // Eski genel kayıt (geçiş): yalnız sahibi şube ve ona bağlı şubeler okur. Eski kaydın gizli alanı yok sayılır
    raw = plainFields(group, await legacyRaw(db, group.legacyKey));
  }
  return { value: group.read(raw, process.env), mode, from, secrets };
}

/** Grubun bu şubedeki değeri (docs/SUBE.md › Şube başına ayarlar; çözüm sırası dosyanın başında) */
export async function resolveBranchSetting<T extends Record<string, unknown>>(group: BranchSettingGroup<T>, branchId: string, db: Reader = getDb()): Promise<ResolvedSetting<T>> {
  const [rows, branches] = await Promise.all([rowsOf(db, group.id), branchesOf(db)]);
  return resolveWith(db, group, branchId, rows, branches);
}

/** Grubun açık şubelerdeki değerleri (ekranlar, "bu adres hangi listede"): şube kimliği → çözüm */
export async function resolveForTills<T extends Record<string, unknown>>(group: BranchSettingGroup<T>, db: Reader = getDb()): Promise<Map<string, ResolvedSetting<T>>> {
  const [rows, branches] = await Promise.all([rowsOf(db, group.id), branchesOf(db)]);
  const out = new Map<string, ResolvedSetting<T>>();
  for (const b of branches.filter((x) => x.kind === "fiziksel" && x.active)) out.set(b.id, await resolveWith(db, group, b.id, rows, branches));
  return out;
}

/** Grubun bağ bilgisi (şube → bağlı olduğu şube): ekrandaki "aynı" seçimi ve kapatma denetimi */
export async function settingLinks(grp: string, db: Reader = getDb()): Promise<SettingLink[]> {
  return (await rowsOf(db, grp)).map((r) => ({ branchId: r.branchId, sameAs: r.sameAs }));
}

/** Yazımın öncesi: grubun yazımları sıraya girer (iki sekme aynı anda bağlayıp döngü kurmasın) */
async function lockGroup(tx: Tx, grp: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`branch_settings:${grp}`}))`);
}

/** Ayarın yazılabileceği şube: fiziksel (online kanalın kasası ve ayarı yok) */
async function settingBranch(tx: Tx, branchId: string): Promise<{ branch: BranchRow; branches: BranchRow[] }> {
  const branches = await branchesOf(tx);
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) throw new UserError("Şube bulunamadı");
  if (branch.kind !== "fiziksel") throw new UserError("Şube ayarları yalnız fiziksel şubede tutulur");
  return { branch, branches };
}

async function writeRow(tx: Tx, grp: string, branchId: string, set: { value: Record<string, unknown>; secrets: Record<string, string> | null; sameAs: string | null }, by: string) {
  const values = { branchId, grp, ...set, updatedBy: by, updatedAt: new Date() };
  await tx
    .insert(s.branchSettings)
    .values(values)
    .onConflictDoUpdate({ target: [s.branchSettings.branchId, s.branchSettings.grp], set: { value: set.value, secrets: set.secrets, sameAs: set.sameAs, updatedBy: by, updatedAt: new Date() } });
}

/** İşlem geçmişi, yazımla aynı işlemde (yalnız ayarın adı ve ne olduğu; değer yazılmaz) */
export async function logSetting(tx: Tx, me: { id?: number; name: string }, action: string, detail: string) {
  await tx.insert(s.activityLog).values({ userName: me.name, userId: typeof me.id === "number" ? me.id : null, action, detail: detail.slice(0, 500), via: currentVia() });
}

/**
 * Şubenin kendi değerini yazar (verilmeyen alan eskisi kalır; gizli alan: metin şifrelenir, null silinir, verilmezse
 * kalır). Şube başka şubenin ayarını kullanıyorsa yazmaz: önce "aynı" kapatılır (eski sekmeden gelen kayıt bağlı şubenin
 * değerini sessizce ayırmasın).
 */
export async function putBranchSetting<T extends Record<string, unknown>>(
  tx: Tx,
  group: BranchSettingGroup<T>,
  branchId: string,
  change: { [K in keyof T]?: T[K] | null },
  by: string,
): Promise<T> {
  await lockGroup(tx, group.id);
  const { branches } = await settingBranch(tx, branchId);
  const rows = await rowsOf(tx, group.id);
  const mode = settingMode(group, branchId, rows);
  if (mode.kind === "linked") {
    const to = branches.find((b) => b.id === mode.to)?.name ?? mode.to;
    throw new UserError(`Bu şube ${group.label.toLocaleLowerCase("tr-TR")} için ${to} şubesinin ayarını kullanıyor; ayrı ayar için önce “${to} ile aynı”yı kapatın`);
  }
  const current = await resolveWith(tx, group, branchId, rows, branches);
  const sealed = { ...(asObject(rows.find((r) => r.branchId === branchId)?.secrets) as Record<string, string>) };
  const plain: Record<string, unknown> = plainFields(group, current.value);
  for (const [k, v] of Object.entries(change)) {
    if (v === undefined) continue;
    if (group.secretFields.includes(k)) {
      if (typeof v === "string" && v.trim()) sealed[k] = seal(v.trim(), "branch-settings");
      else delete sealed[k];
    } else plain[k] = v;
  }
  const value = group.read({ ...plain }, process.env);
  await writeRow(tx, group.id, branchId, { value: plainFields(group, value), secrets: Object.keys(sealed).length ? sealed : null, sameAs: null }, by);
  return value;
}

/** "Diğer şubeyle aynı": şubenin kendi değeri silinir, değer bundan sonra hedeften okunur */
export async function linkBranchSetting(tx: Tx, group: BranchSettingGroup, branchId: string, target: string, by: string) {
  await lockGroup(tx, group.id);
  const { branches } = await settingBranch(tx, branchId);
  const rows = await rowsOf(tx, group.id);
  const err = settingLinkError(group, branchId, target, rows, branches);
  if (err) throw new UserError(err);
  await writeRow(tx, group.id, branchId, { value: {}, secrets: null, sameAs: target }, by);
}

/**
 * "Aynı" kapatılır: o anki değer (bağlandığı şubeninki) şubeye kopyalanır, sonra ayrı düzenlenir. Gizli alanlar
 * kopyalanmaz (şartname: bir şubenin sırrı öbürüne taşınmaz), yeniden girilir. Döner: gizli alan kopyalanmadı mı
 */
export async function unlinkBranchSetting(tx: Tx, group: BranchSettingGroup, branchId: string, by: string): Promise<{ secretsLeft: string[] }> {
  await lockGroup(tx, group.id);
  const { branches } = await settingBranch(tx, branchId);
  const rows = await rowsOf(tx, group.id);
  if (settingMode(group, branchId, rows).kind === "own") throw new UserError("Bu şubenin zaten kendi ayarı var");
  const current = await resolveWith(tx, group, branchId, rows, branches);
  await writeRow(tx, group.id, branchId, { value: plainFields(group, current.value), secrets: null, sameAs: null }, by);
  return { secretsLeft: group.secretFields.filter((f) => current.secrets[f] === "saved") };
}

/**
 * Şube kapatılmadan ya da silinmeden önce: bu şubenin ayarını kullanan açık şube varsa ret metni (bağ tek adımlı
 * olduğu için bağlı şube değersiz kalırdı; silmede yabancı anahtar da reddeder)
 */
export async function branchSettingsCloseError(db: Reader, branch: Pick<BranchRow, "id" | "name">, groups: readonly BranchSettingGroup[]): Promise<string | null> {
  if (!groups.length) return null;
  const [rows, branches] = await Promise.all([
    db
      .select({ grp: s.branchSettings.grp, branchId: s.branchSettings.branchId, sameAs: s.branchSettings.sameAs })
      .from(s.branchSettings)
      .where(inArray(s.branchSettings.grp, groups.map((g) => g.id))),
    branchesOf(db),
  ]);
  const byGroup = new Map<string, SettingLink[]>();
  for (const r of rows) byGroup.set(r.grp, [...(byGroup.get(r.grp) ?? []), r]);
  const err = settingCloseError(groups, branch, byGroup, branches);
  if (err) return err;
  // Kapalı şubeye bağlı satır kalmasın (kapalı şubeden de olsa: silmede yabancı anahtar reddeder)
  const [linked] = await db
    .select({ branchId: s.branchSettings.branchId })
    .from(s.branchSettings)
    .where(eq(s.branchSettings.sameAs, branch.id))
    .limit(1);
  if (linked) {
    const who = branches.find((b) => b.id === linked.branchId)?.name ?? linked.branchId;
    return `${who} bir ayarında ${branch.name} şubesini kullanıyor; önce Şube ayarları'ndan ayırın`;
  }
  return null;
}
