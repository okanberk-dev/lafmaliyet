import "server-only";

import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { LatePayload, requestBranch } from "@/lib/cash-requests";
import { schema as s, type DB } from "@/server/db";

/*
 * Geç kasa raporunun devir zinciri (docs/KASA-RAPORU.md › Geç rapor): bir günün zincirdeki komşuları, kayıtlı rapor ya
 * da onay bekleyen geç rapor (staff_requests, tür `kasa-gec`). Personelin açılış önerisi önceki halkanın devrinden
 * gelir; yöneticinin kartı Z no sırasını ve devri iki yönde bununla gösterir. Onayda zincir işlem içinde yeniden
 * hesaplanır (daha eski bir bekleyen gün varken onay kapalı: önceki halka hep rapordur).
 */

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Zincirin bir halkası */
export interface ChainLink {
  /** Kayıtlı rapor ya da onay bekleyen geç rapor */
  kind: "rapor" | "bekleyen";
  date: string;
  zNo: string | null;
  openingCash: number;
  /** Ertesi güne devir (sayılan − teslim) */
  carry: number;
  /** Bekleyen geç raporun isteği ve isteyeni */
  requestId: number | null;
  requestedByName: string | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * En yakın önceki ve sonraki halka, şubenin zincirinde (`branchId`; denetim KP-06: öteki şubenin devri önceki halka
 * sayılmaz). Aynı günde birden çok bekleyen geç rapor varsa `prefer` (isteyen kişi) önce, yoksa en eski. Rapor ile
 * bekleyen arasında güne en yakın olan seçilir. `prevReportDate`: günden önceki son kayıtlı rapor (önceki halka bekleyen
 * geç rapor olsa da); "aynı aralık" onu sınır alır (onaydaki reviewLate gibi).
 */
export async function chainNeighbours(
  db: DB | Tx,
  date: string,
  o: { prefer?: number | null; exceptRequestId?: number; branchId: string },
): Promise<{ prev: ChainLink | null; next: ChainLink | null; prevReportDate: string | null }> {
  const cols = { date: s.cashReports.date, zNo: s.cashReports.zNo, openingCash: s.cashReports.openingCash, counted: s.cashReports.countedCash, handed: s.cashReports.handedOver };
  const own = eq(s.cashReports.branchId, o.branchId);
  const [[before], [after], pending] = await Promise.all([
    db
      .select(cols)
      .from(s.cashReports)
      .where(and(lt(s.cashReports.date, date), own))
      .orderBy(desc(s.cashReports.date))
      .limit(1),
    db
      .select(cols)
      .from(s.cashReports)
      .where(and(gt(s.cashReports.date, date), own))
      .orderBy(asc(s.cashReports.date))
      .limit(1),
    db
      .select({
        id: s.staffRequests.id,
        day: s.staffRequests.day,
        subject: s.staffRequests.subject,
        payload: s.staffRequests.payload,
        requestedBy: s.staffRequests.requestedBy,
        requestedByName: s.staffRequests.requestedByName,
      })
      .from(s.staffRequests)
      .where(and(eq(s.staffRequests.kind, "kasa-gec"), eq(s.staffRequests.status, "pending")))
      .orderBy(asc(s.staffRequests.createdAt), asc(s.staffRequests.id))
      .then((rows) => rows.filter((p) => requestBranch(p) === o.branchId)),
  ]);
  const report = (r: typeof before): ChainLink | null =>
    r ? { kind: "rapor", date: r.date, zNo: r.zNo, openingCash: r.openingCash, carry: r2(r.counted - r.handed), requestId: null, requestedByName: null } : null;
  const links = new Map<string, ChainLink>();
  for (const p of pending) {
    if (!p.day || p.day === date || p.id === o.exceptRequestId) continue;
    const parsed = LatePayload.safeParse(p.payload);
    if (!parsed.success) continue;
    const have = links.get(p.day);
    // Aynı gün: istenen kişinin isteği önce, yoksa en eskisi
    if (have && !(o.prefer && p.requestedBy === o.prefer)) continue;
    links.set(p.day, {
      kind: "bekleyen",
      date: p.day,
      zNo: parsed.data.zNo,
      openingCash: parsed.data.openingCash,
      carry: r2(parsed.data.countedCash - parsed.data.handedOver),
      requestId: p.id,
      requestedByName: p.requestedByName,
    });
  }
  const days = [...links.keys()];
  const prevPending = days.filter((d) => d < date).sort().at(-1);
  const nextPending = days.filter((d) => d > date).sort()[0];
  const prevReport = report(before);
  const nextReport = report(after);
  const prev = prevPending && (!prevReport || prevPending > prevReport.date) ? links.get(prevPending)! : prevReport;
  const next = nextPending && (!nextReport || nextPending < nextReport.date) ? links.get(nextPending)! : nextReport;
  return { prev, next, prevReportDate: before?.date ?? null };
}
