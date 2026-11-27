import "server-only";

import { and, eq, gt, inArray, isNull, notInArray, or } from "drizzle-orm";

import { ALL_BRANCHES, type BranchScope, DEFAULT_BRANCH_ID, requestInScope } from "@/lib/branches";
import { cashSubjectBranch } from "@/lib/cash-requests";
import { closedRequestBranch } from "@/lib/closed-days";
import { RETIRED_REQUEST_KINDS, type StaffRequestKind } from "@/lib/staff-requests";
import { karaokeBranchId } from "@/server/branches";
import { schema as s, type DB } from "@/server/db";

/*
 * Bekleyen personel isteğinin şubesi (docs/SUBE.md › Onaylar; şube kapsamı C P1-1). İsteklerin şube sütunu yok: şube
 * türüne göre konudan, yükten ya da isteğin kaydından okunur. Onaylar, yöneticinin zili ve sabah e-postası tek şube
 * seçiliyken (ya da alıcı tek şubeye bağlıyken) yalnız o şubenin isteklerini gösterir (`requestInScope`):
 * - kasa düzeltmesi ve silmesi: konudaki şube (`gun:<gün>:<şube>`; şubesiz eski konu Tuzla);
 * - geç rapor, geç zayi / ikram, kasadan çıkan: yükteki şube (isteği açanın); yoksa kasadan çıkan satırın şubesi, o da
 *   yoksa Tuzla (onay da oraya yazar);
 * - kapalı gün: yük ya da konu (`closedRequestBranch`);
 * - fotoğraf kaldırma: fotoğrafın raporunun şubesi; zayi silme: silinecek kaydın şubesi (kayıt gitmişse bilinmez);
 * - karaoke sayacı: karaokenin şubesi (şube özelliği; karaoke hiçbir şubede açık değilse bilinmez); mal taslağı: işletme
 *   geneli (null).
 */

type Reader = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export interface RequestBranchRow {
  id: number;
  kind: string;
  subject: string;
  payload: unknown;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const pos = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const field = (payload: unknown, key: string): unknown => (payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined);

/** İsteklerin şubeleri (kimlik → şube; bilinmiyorsa null). Fotoğraf, zayi ve kasadan çıkan satırları tek sorguyla okunur */
export async function requestBranches(db: Reader, rows: readonly RequestBranchRow[]): Promise<Map<number, string | null>> {
  const reportIds = new Set<number>();
  const wasteIds = new Set<number>();
  const outIds = new Set<number>();
  for (const r of rows) {
    if (r.kind === "foto-kaldir") {
      const id = pos(field(r.payload, "reportId"));
      if (id) reportIds.add(id);
    } else if (r.kind === "zayi-sil") {
      const id = pos(field(r.payload, "entryId"));
      if (id) wasteIds.add(id);
    } else if (r.kind === "kasa-cikan" && !str(field(r.payload, "branchId"))) {
      const id = pos(field(r.payload, "cashOutId"));
      if (id) outIds.add(id);
    }
  }
  const [reports, wastes, outs, karaoke] = await Promise.all([
    reportIds.size ? db.select({ id: s.cashReports.id, b: s.cashReports.branchId }).from(s.cashReports).where(inArray(s.cashReports.id, [...reportIds])) : [],
    wasteIds.size ? db.select({ id: s.wasteEntries.id, b: s.wasteEntries.branchId }).from(s.wasteEntries).where(inArray(s.wasteEntries.id, [...wasteIds])) : [],
    outIds.size ? db.select({ id: s.cashOuts.id, b: s.cashOuts.branchId }).from(s.cashOuts).where(inArray(s.cashOuts.id, [...outIds])) : [],
    rows.some((r) => r.kind === "karaoke-sil") ? karaokeBranchId(db) : null,
  ]);
  const reportOf = new Map(reports.map((x) => [x.id, x.b]));
  const wasteOf = new Map(wastes.map((x) => [x.id, x.b]));
  const outOf = new Map(outs.map((x) => [x.id, x.b]));
  const out = new Map<number, string | null>();
  for (const r of rows) out.set(r.id, branchOf(r, { reportOf, wasteOf, outOf, karaoke }));
  return out;
}

function branchOf(
  r: RequestBranchRow,
  m: { reportOf: Map<number, string>; wasteOf: Map<number, string>; outOf: Map<number, string>; karaoke: string | null },
): string | null {
  switch (r.kind) {
    case "kasa-duzeltme":
    case "kasa-silme":
      return cashSubjectBranch(r.subject);
    case "kasa-gec":
    case "zayi-gec":
      return str(field(r.payload, "branchId")) ?? DEFAULT_BRANCH_ID;
    case "kasa-cikan": {
      const own = str(field(r.payload, "branchId"));
      if (own) return own;
      const id = pos(field(r.payload, "cashOutId"));
      return (id ? m.outOf.get(id) : undefined) ?? DEFAULT_BRANCH_ID;
    }
    case "kapali-gun":
      return closedRequestBranch(r);
    case "foto-kaldir": {
      const id = pos(field(r.payload, "reportId"));
      return (id ? m.reportOf.get(id) : undefined) ?? null;
    }
    case "zayi-sil": {
      const id = pos(field(r.payload, "entryId"));
      return (id ? m.wasteOf.get(id) : undefined) ?? null;
    }
    case "karaoke-sil":
      return m.karaoke;
    default:
      return null;
  }
}

/**
 * Seçili şubenin dışında bekleyen istek sayısı (Onaylar tek şube seçiliyken "Öbür şubelerde N istek daha"): onay bekleyen
 * iş seçici yüzünden gözden kaçmasın. "Tümü"de 0
 */
export async function pendingOutOfScope(db: Reader, scope: BranchScope, now: Date = new Date()): Promise<number> {
  if (scope === ALL_BRANCHES) return 0;
  const r = s.staffRequests;
  const rows = await db
    .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload })
    .from(r)
    .where(and(eq(r.status, "pending"), or(isNull(r.expiresAt), gt(r.expiresAt, now)), notInArray(r.kind, [...RETIRED_REQUEST_KINDS])));
  if (!rows.length) return 0;
  const branchOf = await requestBranches(db, rows);
  return rows.filter((x) => !requestInScope(branchOf.get(x.id) ?? null, scope)).length;
}

/**
 * Türüne göre bekleyen istekler ve en eskisinin anı, seçili kapsamda (şube ayrımı, 27 Kasım 2026; Bugün'ün Onaylar
 * satırı): "Tümü"de `countPendingByKind`'ın aynısı; tek şube seçiliyken yalnız o şubenin ve şubesi bilinmeyen istekler
 * (`requestInScope`). Önceden Bugün'ün satırı Marina seçiliyken Tuzla'nın kasa isteklerini de sayıyordu, Onaylar ise
 * yalnız Marina'nınkini gösteriyordu
 */
export async function pendingByKindInScope(db: Reader, scope: BranchScope, now: Date = new Date()): Promise<{ kind: StaffRequestKind; count: number; oldestAt: Date }[]> {
  const r = s.staffRequests;
  const rows = await db
    .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload, createdAt: r.createdAt })
    .from(r)
    .where(and(eq(r.status, "pending"), or(isNull(r.expiresAt), gt(r.expiresAt, now)), notInArray(r.kind, [...RETIRED_REQUEST_KINDS])));
  if (!rows.length) return [];
  const branchOf = scope === ALL_BRANCHES ? null : await requestBranches(db, rows);
  const byKind = new Map<StaffRequestKind, { kind: StaffRequestKind; count: number; oldestAt: Date }>();
  for (const x of rows) {
    if (branchOf && !requestInScope(branchOf.get(x.id) ?? null, scope)) continue;
    const g = byKind.get(x.kind);
    if (!g) byKind.set(x.kind, { kind: x.kind, count: 1, oldestAt: x.createdAt });
    else {
      g.count++;
      if (x.createdAt < g.oldestAt) g.oldestAt = x.createdAt;
    }
  }
  return [...byKind.values()];
}

/**
 * Kimliği bilinen isteklerden seçili kapsamdakiler (sabah e-postasının "Onay bekleyenler"i, şubeye bağlı alıcı): konu ve
 * yük yalnız şube için okunur; çağıranın satırları (başlık, ad) olduğu gibi döner
 */
export async function requestsInScope<T extends { id: number }>(db: Reader, rows: T[], scope: BranchScope): Promise<T[]> {
  if (scope === ALL_BRANCHES || !rows.length) return rows;
  const r = s.staffRequests;
  const full = await db
    .select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload })
    .from(r)
    .where(inArray(r.id, rows.map((x) => x.id)));
  const branchOf = await requestBranches(db, full);
  return rows.filter((x) => requestInScope(branchOf.get(x.id) ?? null, scope));
}

/** Müdürün öteki şubenin isteğine karar vermeye çalışması */
export const OTHER_BRANCH_REVIEW = "Bu istek başka bir şubenin; yalnız kendi şubenizin isteklerini karara bağlayabilirsiniz";

/**
 * Karar eyleminin başında (docs/ROLLER.md): yönetici her isteği, müdür yalnız KENDİ şubesinin isteğini karara bağlar.
 * İsteğin şubesi `requestBranches`'tan; şubesi bilinmeyen istek müdüre kapalı (varsayılan kapalı). Öteki roller hiç
 * (eylem zaten requireCan("onay") ister). İstek arada değişirse çekirdeğin sürüm denetimi (lockForReview) reddeder.
 * Engel yoksa null, varsa kullanıcıya gösterilecek metin.
 */
export async function reviewBranchRefusal(db: Reader, me: { role: string; branchId?: string | null }, id: number): Promise<string | null> {
  if (me.role === "admin") return null;
  if (me.role !== "manager" || !me.branchId) return OTHER_BRANCH_REVIEW;
  const r = s.staffRequests;
  const [row] = await db.select({ id: r.id, kind: r.kind, subject: r.subject, payload: r.payload }).from(r).where(eq(r.id, id)).limit(1);
  if (!row) return null;
  const branch = (await requestBranches(db, [row])).get(row.id) ?? null;
  return branch === me.branchId ? null : OTHER_BRANCH_REVIEW;
}
