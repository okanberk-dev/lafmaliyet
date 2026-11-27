/**
 * Mutabakat alanının şube kipi (şube ayrımı parça 5, 27 Kasım 2026; docs/SUBE.md › Şube ayrımı › Alanlar, docs/MUTABAKAT.md
 * › Şube). Ekstre firmanındır (banka hesabı ve tedarikçinin carisi şubeye bölünmez): eşleştirme her kipte firmanın bütün
 * kayıtlarıyla yapılır, sonuç değişmez. Şube kipinde yalnız gösterim ayrılır:
 *
 * - Hareketler: şubenin kaydıyla eşleşenler üstte; eşleşmeyen, işletme genelinin (şubesi boş kayıt) ve öbür şubenin
 *   kaydıyla eşleşenler **İşletme geneli** grubunda. Öbür şubenin kaydı adıyla görünmez ("Öbür şubenin kaydı").
 * - "Panelde var, ekstrede yok": yalnız şubenin kayıtları; öbürü sayı olarak.
 * - POS hakediş: şubenin kart satışı ve beklenen neti (kart × şubenin oranı); bankaya gelen para firmanın (terminal →
 *   şube eşlemesi yok), günün durumu firmanın karşılaştırmasından. Karolar şubenin: geciken ve bekleyen şubenin valör
 *   günleri, şubenin beklenen netiyle (`BranchPos.totals`). "Fark" (gelen − beklenen) şubeye bölünemez: yalnız firma
 *   kipinde (şube ayrımı doğrulaması, 27 Kasım 2026: önceden şube kipinde firmanın farkı ve geciken tutarı yazıyordu,
 *   Tuzla'nın kart satışı Marina'nın ekranındaki farka giriyordu).
 *
 * Saf modül; okuma src/server/mutabakat/load.ts, testleri tests/sube-ayrimi-alanlar-5.test.ts.
 */

import type { Candidate } from "./match";
import { type PosRow, type PosSaleDay, type PosSettings, type PosStatus, posReconciliation } from "./pos";
import type { ReconRow } from "./view";

/** Kaydın şubeye göre yeri: şubenin, işletme geneli (şubesi boş), öbür şubenin */
export type ReconPlace = "sube" | "isletme" | "baska";

export function candidatePlace(c: Pick<Candidate, "branchId">, branch: string): ReconPlace {
  if (c.branchId === undefined || c.branchId === null) return "isletme";
  return c.branchId === branch ? "sube" : "baska";
}

/** Öbür şubenin kaydının ekrandaki adı (adı, bağlantısı ve belge numarası gösterilmez) */
export const OTHER_BRANCH_RECORD = "Öbür şubenin kaydı";

export function redactCandidate(c: Candidate): Candidate {
  return { kind: c.kind, id: c.id, date: c.date, amount: c.amount, label: OTHER_BRANCH_RECORD, names: [], ref: null, href: null, branchId: c.branchId };
}

export interface BranchRecon<R> {
  /** Şubenin kaydıyla eşleşen hareketler */
  own: R[];
  /** Eşleşmeyen, işletme geneli ve öbür şubenin kaydıyla eşleşen hareketler (öbür şubeninki adsız) */
  shared: R[];
  /** "Panelde var, ekstrede yok": şubenin kayıtları */
  missing: Candidate[];
  /** Listede olmayan eksik kayıtlar (işletme geneli ve öbür şubeler) */
  otherMissing: number;
}

/** Ekstrenin hareketlerini ve eksik kayıtlarını şube kipine ayırır (eşleşme aynı kalır) */
export function branchRecon<R extends Pick<ReconRow, "candidate">>(rows: readonly R[], missing: readonly Candidate[], branch: string): BranchRecon<R> {
  const own: R[] = [];
  const shared: R[] = [];
  for (const r of rows) {
    const place = r.candidate ? candidatePlace(r.candidate, branch) : "isletme";
    if (place === "sube") own.push(r);
    else shared.push(place === "baska" && r.candidate ? { ...r, candidate: redactCandidate(r.candidate) } : r);
  }
  const mine = missing.filter((c) => candidatePlace(c, branch) === "sube");
  return { own, shared, missing: mine, otherMissing: missing.length - mine.length };
}

/** POS hakedişinin şube kipi: şubenin valör günleri ve firmanın o günkü durumu */
export interface BranchPosRow {
  due: string;
  sales: PosRow["sales"];
  gross: number;
  expected: number;
  /** Firmanın o valör günündeki durumu (bankaya gelen para şubeye bölünmez); firmada satır yoksa "bekleniyor" */
  firmStatus: PosStatus;
}

export interface BranchPos {
  branch: string;
  rows: BranchPosRow[];
  /**
   * Şubenin toplamları: kart satışı ve beklenen net; günün durumu (firmanın) "Gecikti" olan valör günlerinin sayısı ve
   * şubenin o günlerdeki beklenen neti; ekstrenin henüz kapsamadığı günlerdeki beklenen net
   */
  totals: { gross: number; expected: number; lateCount: number; lateAmount: number; waitingAmount: number };
}

/**
 * Şubenin kart satışından beklenen net, valör gününe göre (posReconciliation'ın kuralıyla: şubenin oranı, bloke günü,
 * ekstrenin başından önceki valör yok); günün durumu firmanın satırından. `firmRows` firmanın karşılaştırması
 */
export function branchPos(input: {
  branch: string;
  days: readonly PosSaleDay[];
  settings: PosSettings;
  coverage: { from: string; to: string } | null;
  today: string;
  firmRows: readonly Pick<PosRow, "due" | "status">[];
}): BranchPos {
  const own = input.days.filter((d) => d.branchId === input.branch);
  const { rows } = posReconciliation({ days: own, inflows: [], settings: input.settings, coverage: null, today: input.today });
  const firm = new Map(input.firmRows.filter((r) => r.status !== "beklenmeyen").map((r) => [r.due, r.status]));
  const shown = rows.filter((r) => !input.coverage || r.due >= input.coverage.from);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const out = shown.map((r) => ({ due: r.due, sales: r.sales, gross: r.gross, expected: r.expected, firmStatus: firm.get(r.due) ?? "bekleniyor" }));
  const sum = (xs: readonly BranchPosRow[]) => r2(xs.reduce((a, r) => a + r.expected, 0));
  const late = out.filter((r) => r.firmStatus === "gecikti");
  return {
    branch: input.branch,
    rows: out,
    totals: {
      gross: r2(shown.reduce((a, r) => a + r.gross, 0)),
      expected: sum(out),
      lateCount: late.length,
      lateAmount: sum(late),
      waitingAmount: sum(out.filter((r) => r.firmStatus === "bekleniyor")),
    },
  };
}
