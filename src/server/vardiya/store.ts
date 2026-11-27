import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { ALL_BRANCHES, type BranchRow } from "@/lib/branches";
import { businessDate } from "@/lib/cash-report";
import { isShiftRole } from "@/lib/roles";
import { addDays, todayTR } from "@/lib/reminders";
import {
  buildRows,
  byName,
  cellOf,
  cleanName,
  DAY_NAMES,
  nameRef,
  parseShiftCell,
  refUserId,
  saveWeekSchema,
  shiftAccountRefused,
  SHIFT_NAME_MAX,
  staleText,
  userRef,
  weekLabel,
  weekSaveDiff,
  weekStart,
  weekSummary,
  type SaveWeekInput,
  type ShiftCell,
  type ShiftEntry,
  type ShiftRow,
} from "@/lib/vardiya";
import { shiftChanges, type ShiftChange } from "@/lib/vardiya-bildirim";
import { currentBranchScope } from "@/server/branch-scope";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";
import { UserError } from "@/server/user-error";

/**
 * Vardiya planının veritabanı tarafı (kurallar ve metinler src/lib/vardiya.ts; docs/VARDIYA.md). Plan şube, gün ve kişi
 * başına tek satırdır (`shifts`); ekran haftayı okur, yönetici haftayı bütün olarak kaydeder (yalnız ekranda değişen
 * hücre yazılır, boşaltılan silinir). PDF ve personelin görünümü aynı okuyucudan beslenir: her zaman kaydedilen plan.
 */

export interface ShiftWeek {
  branch: { id: string; name: string };
  monday: string;
  rows: ShiftRow[];
  /** "Kişi ekle"nin önerdiği, ızgarada satırı olmayan etkin hesaplar (yönetici, başka şubenin personeli) */
  others: { id: number; name: string }[];
  /** Haftaya en son kim, ne zaman dokundu (plan boşsa null) */
  updated: { by: string | null; at: string } | null;
}

/** Vardiyası planlanabilen şubeler: etkin fiziksel şubeler (online kanalın vardiyası olmaz) */
export const shiftBranches = (branches: readonly BranchRow[]) => branches.filter((b) => b.active && b.kind === "fiziksel");

/** Haftanın kayıtlı satırları ve son değişiklik */
export async function loadShiftEntries(db: Pick<DB, "select">, branchId: string, monday: string): Promise<{ entries: ShiftEntry[]; updated: ShiftWeek["updated"] }> {
  const rows = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.branchId, branchId), gte(s.shifts.date, monday), lte(s.shifts.date, addDays(monday, 6))))
    .orderBy(asc(s.shifts.date), asc(s.shifts.personName));
  const entries: ShiftEntry[] = [];
  let last: (typeof rows)[number] | null = null;
  for (const r of rows) {
    const cell = cellOf(r);
    if (cell) entries.push({ date: r.date, ref: r.personRef, userId: r.userId, name: r.personName, cell });
    if (!last || r.updatedAt > last.updatedAt) last = r;
  }
  return { entries, updated: last ? { by: last.updatedByName, at: last.updatedAt.toISOString() } : null };
}

/**
 * Şubenin vardiyasına önerilebilir hesap (şube kapsamı C P2-11): yönetici, şubesiz personel ve o şubenin personeli. Başka
 * şubeye kilitli personel o şubenin ekranını göremez; "Kişi ekle" ve Claude'un taslağı onu önermez (elle yazılan ad yine
 * hesapsız satır olabilir)
 */
export function shiftCandidate(u: { role: string; branchId: string | null }, branchId: string): boolean {
  // Muhasebeci vardiyada çalışmaz (docs/ROLLER.md)
  return u.role !== "accountant" && (u.role === "admin" || u.branchId === null || u.branchId === branchId);
}

/**
 * İstemcinin gönderdiği hesap satırlarının ("u:<kimlik>") denetimi (kaydet ve yazarak doldur; docs/VARDIYA.md › Ekran,
 * docs/ROLLER.md › Müdür). Hesap ancak ekranın önerebileceği biriyse yazılır: etkin ve şubenin vardiyasına önerilebilir
 * (`shiftCandidate`, "Kişi ekle" ve taslakla aynı kural) ya da kişi bu şubenin planında zaten var (pasife alınan, başka
 * şubeye geçen, hesabı silinen; "Geçen haftayı kopyala"). Gerisi (öteki şubeye kilitli personel ve müdür, muhasebeci,
 * planda olmayan pasif ya da hiç olmayan hesap) reddedilir: yoksa müdür kimlik kimlik bütün hesapların adını kendi
 * planında okur ve öteki şubenin kişisine "Vardiyanız değişti" gönderirdi. `names`: kabul edilen hesapların güncel adı.
 */
export async function shiftAccounts(db: Pick<DB, "select" | "selectDistinct">, branchId: string, refs: readonly string[]): Promise<{ allowed: Set<number>; names: Map<number, string> }> {
  const ids = [...new Set(refs.flatMap((r) => refUserId(r) ?? []))];
  if (!ids.length) return { allowed: new Set(), names: new Map() };
  const users = await db
    .select({ id: s.users.id, name: s.users.name, role: s.users.role, branchId: s.users.branchId, active: s.users.active })
    .from(s.users)
    .where(inArray(s.users.id, ids));
  const planned = await db
    .selectDistinct({ ref: s.shifts.personRef })
    .from(s.shifts)
    .where(and(eq(s.shifts.branchId, branchId), inArray(s.shifts.personRef, ids.map(userRef))));
  const allowed = new Set(planned.flatMap((p) => refUserId(p.ref) ?? []));
  for (const u of users) if (u.active && shiftCandidate(u, branchId)) allowed.add(u.id);
  return { allowed, names: new Map(users.filter((u) => allowed.has(u.id)).map((u) => [u.id, u.name])) };
}

/**
 * Haftanın planı. `roster`: yöneticinin ızgarası için şubenin etkin personeli planı boş olsa da satır olur ve "Kişi
 * ekle"ye öteki hesaplar önerilir; personelin görünümünde ve PDF'te yalnız planı olanlar. Hesabı duran kişi güncel
 * adıyla görünür.
 */
export async function loadShiftWeek(db: DB, branch: { id: string; name: string }, monday: string, opts: { roster: boolean; includeUserId?: number }): Promise<ShiftWeek> {
  const { entries, updated } = await loadShiftEntries(db, branch.id, monday);
  const users = await db.select({ id: s.users.id, name: s.users.name, role: s.users.role, branchId: s.users.branchId, active: s.users.active }).from(s.users);
  const byId = new Map(users.map((u) => [u.id, u]));
  // Plandaki kullanıcı güncel adıyla (plandaki ad kaydedildiği andakidir)
  const named = entries.map((e) => (e.userId !== null && byId.has(e.userId) ? { ...e, name: byId.get(e.userId)!.name } : e));
  const roster = opts.roster ? users.filter((u) => u.active && isShiftRole(u.role) && (u.branchId === null || u.branchId === branch.id)) : users.filter((u) => u.id === opts.includeUserId);
  const rows = buildRows(monday, roster, named);
  const inGrid = new Set(rows.map((r) => r.ref));
  // "Kişi ekle" önerileri: başka şubeye kilitli personel önerilmez (şube kapsamı C P2-11); yönetici ve şubesiz personel kalır
  const others = opts.roster
    ? users
        .filter((u) => u.active && !inGrid.has(userRef(u.id)) && shiftCandidate(u, branch.id))
        .map((u) => ({ id: u.id, name: u.name }))
        .sort(byName)
    : [];
  return { branch: { id: branch.id, name: branch.name }, monday, rows: opts.roster ? rows : rows.filter((r) => r.cells.some(Boolean) || r.userId === opts.includeUserId), others, updated };
}

/** Bir günün çalışanları (izinliler hariç), başlangıç saatine göre: Bugün'ün satırı */
export async function shiftsOn(db: DB, branchId: string | null, date: string): Promise<{ name: string; startMin: number; endMin: number; branchId: string }[]> {
  const rows = await db
    .select({ name: s.shifts.personName, userName: s.users.name, startMin: s.shifts.startMin, endMin: s.shifts.endMin, branchId: s.shifts.branchId })
    .from(s.shifts)
    .leftJoin(s.users, eq(s.users.id, s.shifts.userId))
    .where(and(eq(s.shifts.date, date), eq(s.shifts.kind, "work"), branchId ? eq(s.shifts.branchId, branchId) : undefined))
    .orderBy(asc(s.shifts.startMin), asc(s.shifts.personName));
  return rows.flatMap((r) => (r.startMin === null || r.endMin === null ? [] : [{ name: r.userName ?? r.name, startMin: r.startMin, endMin: r.endMin, branchId: r.branchId }]));
}

/**
 * Bugün ekranının vardiya olgusu: iş gününün (05:00'te döner) çalışanları, panelde seçili şubede ("Tümü"de bütün
 * şubeler; şubesine kilitli personelde kendi şubesi). Tutar yok; iki rol de okur.
 */
export async function todayShifts(now: Date = new Date()): Promise<{ name: string; startMin: number; endMin: number }[]> {
  const scope = await currentBranchScope();
  return shiftsOn(getDb(), scope === ALL_BRANCHES ? null : scope, businessDate(now));
}

export interface SaveWeekResult {
  /** Yazılan (yeni ya da değişen) ve silinen hücre sayısı */
  written: number;
  removed: number;
  branch: { id: string; name: string };
  monday: string;
  /** "5 kişi · 28 vardiya · 3 izin" (kaydedilen satırların özeti) */
  summary: string;
  /** Kişilere bildirilecek değişiklikler (src/lib/vardiya-bildirim.ts shiftChanges) */
  changes: ShiftChange[];
}

/**
 * Haftayı kaydeder (yönetici ve müdür çağırır; yetkiyi ve şubeyi eylem denetler). Hücreler ekrandaki metinle gelir ve
 * aynı okuyucudan geçer; kişi kullanıcıysa adı hesabından alınır (yalnız `shiftAccounts`'un kabul ettiği hesap), hesabı
 * olmayan çalışan adıyla yazılır. Tek işlemde: yalnız ekranda değiştirilen hücre (`seen`'den farklı) yazılır (aynı gün
 * ve kişide üstüne) ya da boşaltılınca silinir; dokunulmayan hücreye ve girdide olmayan kişinin satırına dokunulmaz.
 * Aynı haftayı iki sekme birden kaydederse sırayla yazar (danışma kilidi); değiştirilen hücreyi ekran açıldıktan sonra
 * başkası da değiştirdiyse kayıt bütünüyle reddedilir ("Plan siz bakarken değişti"; bulgu 46). Özet kayıttan sonraki
 * planındır.
 */
export async function saveShiftWeek(db: DB, me: { name: string }, raw: SaveWeekInput): Promise<SaveWeekResult> {
  const data = saveWeekSchema.parse(raw);
  const monday = weekStart(data.week);
  const branch = shiftBranches(await listBranches(db)).find((b) => b.id === data.branchId);
  if (!branch) throw new UserError("Şube bulunamadı ya da kapalı; sayfayı yenileyin.");
  // Hesap satırı yalnız ekranın önerebileceği kişininki (shiftAccounts); hesabın adı yalnız kabul edilende okunur
  const { allowed, names: userName } = await shiftAccounts(db, branch.id, data.rows.map((r) => r.ref));
  const next: ShiftRow[] = [];
  const seen = new Set<string>();
  // Ekranın gördüğü (kayıtlı metin her zaman okunur; okunamazsa boş sayılır, o kutu değiştirilmiş görünür)
  const saw = new Map<string, (ShiftCell | null)[]>();
  for (const r of data.rows) {
    const uid = refUserId(r.ref);
    const typed = cleanName(r.name);
    if (uid !== null && !allowed.has(uid)) {
      // Yazılacak bir şey yoksa satır yok sayılır (ekran açıkken hesabı kapanan ya da şubesi değişen kişinin boş satırı);
      // hücre varsa kayıt bütünüyle reddedilir. Hata metni hesabın adını taşımaz
      if (r.cells.every((t) => !t.trim())) continue;
      throw new UserError(shiftAccountRefused(typed));
    }
    // Hesabı silinmiş kullanıcının eski satırı anahtarıyla kalır (ad plandaki gibi); hesabı duran güncel adıyla
    const row: ShiftRow =
      uid !== null
        ? { ref: userRef(uid), userId: userName.has(uid) ? uid : null, name: userName.get(uid) ?? (typed || "Kişi"), cells: [] }
        : { ref: nameRef(typed), userId: null, name: typed, cells: [] };
    row.cells = r.cells.map((text, i) => {
      const parsed = parseShiftCell(text);
      if (!parsed.ok) throw new UserError(`${row.name || "Adsız satır"}, ${DAY_NAMES[i]}: ${parsed.error}`);
      return parsed.cell;
    });
    if (!row.name) {
      // Adı yazılmamış boş satır yok sayılır; dolu satırın adı gerekir
      if (!row.cells.some(Boolean)) continue;
      throw new UserError("Adı yazılmamış bir satırda vardiya var; kişinin adını yazın.");
    }
    if (row.name.length > SHIFT_NAME_MAX) throw new UserError(`Ad en çok ${SHIFT_NAME_MAX} karakter olabilir.`);
    if (seen.has(row.ref)) throw new UserError(`${row.name} planda iki kez var; satırlardan birini kaldırın.`);
    seen.add(row.ref);
    next.push(row);
    saw.set(
      row.ref,
      r.seen.map((text) => {
        const parsed = parseShiftCell(text);
        return parsed.ok ? parsed.cell : null;
      }),
    );
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`vardiya:${branch.id}:${monday}`}))`);
    const { entries } = await loadShiftEntries(tx, branch.id, monday);
    const diff = weekSaveDiff(entries, next, saw, monday);
    if (diff.stale.length) throw new UserError(staleText(diff.stale));
    const now = new Date();
    if (diff.upserts.length) {
      await tx
        .insert(s.shifts)
        .values(
          diff.upserts.map((e) => ({
            branchId: branch.id,
            date: e.date,
            personRef: e.ref,
            userId: e.userId,
            personName: e.name,
            kind: e.cell.kind,
            startMin: e.cell.kind === "work" ? e.cell.startMin : null,
            endMin: e.cell.kind === "work" ? e.cell.endMin : null,
            note: e.cell.note,
            updatedByName: me.name,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [s.shifts.branchId, s.shifts.date, s.shifts.personRef],
          set: {
            userId: sql`excluded.user_id`,
            personName: sql`excluded.person_name`,
            kind: sql`excluded.kind`,
            startMin: sql`excluded.start_min`,
            endMin: sql`excluded.end_min`,
            note: sql`excluded.note`,
            updatedByName: sql`excluded.updated_by_name`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    // Boşaltılan hücreler: kişi kişi, o kişinin günleri
    const gone = new Map<string, string[]>();
    for (const d of diff.deletes) gone.set(d.ref, [...(gone.get(d.ref) ?? []), d.date]);
    for (const [ref, dates] of gone) {
      await tx.delete(s.shifts).where(and(eq(s.shifts.branchId, branch.id), eq(s.shifts.personRef, ref), inArray(s.shifts.date, dates)));
    }
    // Özet kayıttan sonraki plandan: dokunulmayan hücre ekrandaki eski hâliyle değil, veritabanındaki hâliyle sayılır
    const after = await loadShiftEntries(tx, branch.id, monday);
    // Kişilere bildirilecek değişiklikler (docs/VARDIYA.md › Bildirimler): kayıttan önceki hâliyle karşılaştırılır
    const changes = shiftChanges({ before: entries, upserts: diff.upserts, deletes: diff.deletes, today: todayTR(now) });
    return { written: diff.upserts.length, removed: diff.deletes.length, summary: weekSummary(buildRows(monday, [], after.entries)), changes };
  });
  return { ...result, branch: { id: branch.id, name: branch.name }, monday };
}

/** İşlem geçmişinin satırı: "Tuzla · 23–29 Kasım 2026 · 5 kişi · 28 vardiya" */
export const shiftLogDetail = (r: SaveWeekResult) => `${r.branch.name} · ${weekLabel(r.monday)} · ${r.summary}`;
