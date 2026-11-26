/**
 * Mutabakat ekranının saf kuralları (tests/mutabakat.test.ts, docs/MUTABAKAT.md): hesabın kimliği, eşleşme havuzu, POS
 * satırlarının ayrılması, ekstrenin özeti, satırın eylemleri ve kararın geçerliliği. Okuma ve eşleştirme parse.ts ile
 * match.ts'te; POS hakedişi pos.ts'te.
 */
import { isPosLine, matchLines, summarize, type Candidate, type Decision, type LineMatch, type MatchLine, type MatchOptions, type MatchStatus, type MatchSummary } from "./match";
import { fold, type StatementKind } from "./parse";

export const KIND_LABEL: Record<StatementKind, string> = { banka: "Banka", tedarikci: "Tedarikçi" };

/** Satırın ekrandaki durumu: eşleşme durumu ya da (bankada) POS hakedişi */
export type RowStatus = MatchStatus | "pos";

export const STATUS_LABEL: Record<RowStatus, string> = {
  eslesti: "Eşleşti",
  fark: "Tutarı farklı",
  yok: "Eşleşmedi",
  yoksay: "Yok sayıldı",
  pos: "POS hakedişi",
};

/** Ekstre ayrıntısının süzgeci (adreste `?durum=`) */
export const ROW_FILTERS = ["hepsi", "yok", "fark", "eslesti", "yoksay", "pos"] as const;
export type RowFilter = (typeof ROW_FILTERS)[number];

// ---------------------------------------------------------------- Hesap

/** Banka hesabının adı en çok bu kadar */
export const ACCOUNT_MAX = 60;

/** Hesap adı: baş ve sondaki boşluk atılır, aradaki boşluklar teke iner */
export const accountName = (raw: string) => raw.replace(/\s+/g, " ").trim();

/**
 * Hesabın kimliği (aynı hareket aynı hesaba ikinci kez yazılmasın: recon_lines.scope + fingerprint). Banka: hesabın
 * sadeleşmiş adı ("Garanti TL" ile "garanti  tl" aynı hesap); tedarikçi: kartı, kartsızda adının anahtarı.
 */
export const bankScope = (account: string) => `banka:${fold(account)}`;
export const supplierScope = (cardId: number | null, key: string) => (cardId !== null ? `tedarikci:kart:${cardId}` : `tedarikci:ad:${key}`);

/**
 * Eşleşme havuzu: bir panel kaydı havuzda en çok bir satıra gider. Bütün banka hesapları tek havuzdur (panel kaydı
 * hangi hesaptan ödendiğini bilmez; aynı ödeme iki hesabın ekstresinde eşleşmesin); tedarikçi ekstresi tedarikçi başına.
 */
export const poolOf = (st: { kind: StatementKind; scope: string }) => (st.kind === "banka" ? "banka" : st.scope);

// ---------------------------------------------------------------- Havuzun eşleşmesi

export interface ReconRow<L extends MatchLine = MatchLine> extends LineMatch<L> {
  /** Bankada POS hakedişi (eşleştirmeye girmez; POS hakediş sekmesinde karşılaştırılır) */
  pos: boolean;
}

/** Satırın ekrandaki durumu */
export const rowStatus = (r: Pick<ReconRow, "pos" | "status">): RowStatus => (r.pos ? "pos" : r.status);

/**
 * Havuzun satırlarını kayıtlarla eşleştirir. Bankada POS hakedişi olan satırlar (açıklamasından ya da yöneticinin
 * kararıyla; isPosLine) eşleştirmeye girmez. `free`: hiçbir satıra gitmeyen kayıtlar ("panelde var, ekstrede yok"
 * listesinin kaynağı; ekstrenin dönemine göre `missingFor` süzer).
 */
export function reconcilePool<L extends MatchLine>(kind: StatementKind, lines: readonly L[], candidates: readonly Candidate[], opts: MatchOptions): { rows: ReconRow<L>[]; free: Candidate[] } {
  const posIds = new Set(kind === "banka" ? lines.filter((l) => isPosLine(l)).map((l) => l.id) : []);
  const { rows } = matchLines(
    lines.filter((l) => !posIds.has(l.id)),
    candidates,
    { ...opts, period: null },
  );
  const used = new Set(rows.flatMap((r) => (r.candidate ? [`${r.candidate.kind}:${r.candidate.id}`] : [])));
  const all: ReconRow<L>[] = [
    ...rows.map((r) => ({ ...r, pos: false })),
    ...lines.filter((l) => posIds.has(l.id)).map((line): ReconRow<L> => ({ line, status: "yok", candidate: null, basis: null, diff: 0, pos: true })),
  ];
  all.sort((a, b) => a.line.date.localeCompare(b.line.date) || a.line.id - b.line.id);
  return { rows: all, free: candidates.filter((c) => !used.has(`${c.kind}:${c.id}`)) };
}

/** Ekstrenin dönemindeki boşta kayıtlar (eski gün önce) */
export function missingFor(free: readonly Candidate[], period: { from: string; to: string }): Candidate[] {
  return free.filter((c) => c.date >= period.from && c.date <= period.to).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export interface StatementSummary extends MatchSummary {
  pos: number;
  /** POS satırlarının işaretli toplamı (giren hakediş − kesinti) */
  posAmount: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function statementSummary(rows: readonly ReconRow[]): StatementSummary {
  const pos = rows.filter((r) => r.pos);
  return {
    ...summarize(rows.filter((r) => !r.pos)),
    pos: pos.length,
    posAmount: r2(pos.reduce((a, r) => a + r.line.amount, 0)),
    total: rows.length,
  };
}

/** Süzgeçteki satırlar */
export const filterRows = <R extends Pick<ReconRow, "pos" | "status">>(rows: readonly R[], f: RowFilter): R[] => (f === "hepsi" ? [...rows] : rows.filter((r) => rowStatus(r) === f));

// ---------------------------------------------------------------- Satırın eylemleri

/**
 * Satırın düğmeleri: `eslestir` (kayıt seç; eşleşmişte "Değiştir"), `yoksay`, `ayir` (kendiliğinden eşleşmeyi ya da
 * POS sayılmayı bırak), `pos` (bankada POS hakedişi say), `geri-al` (kararı kaldır).
 */
export type LineAction = "eslestir" | "yoksay" | "ayir" | "pos" | "geri-al";

export function lineActions(kind: StatementKind, r: Pick<ReconRow, "pos" | "status" | "basis"> & { line: Pick<MatchLine, "decision" | "amount"> }): LineAction[] {
  const d = r.line.decision;
  if (d === "yoksay" || d === "pos") return ["geri-al"];
  if (d === "elle") return ["eslestir", "geri-al"];
  if (d === "ayir") return ["eslestir", "yoksay", "geri-al"];
  if (r.pos) return ["ayir"];
  if (r.status === "eslesti" || r.status === "fark") return ["eslestir", "ayir"];
  return ["eslestir", "yoksay", ...(kind === "banka" && r.line.amount > 0 ? (["pos"] as const) : [])];
}

export const ACTION_LABEL: Record<LineAction, string> = {
  eslestir: "Eşleştir",
  yoksay: "Yok say",
  ayir: "Ayır",
  pos: "POS hakedişi",
  "geri-al": "Geri al",
};

/** Eylemin yazacağı karar (`geri-al`: null; `eslestir` kayıt seçilince `elle`) */
export const ACTION_DECISION: Record<Exclude<LineAction, "eslestir">, Decision | null> = { yoksay: "yoksay", ayir: "ayir", pos: "pos", "geri-al": null };

/** Kararın eksiği (kullanıcıya gösterilecek metin), yoksa null */
export function decisionProblem(kind: StatementKind, decision: Decision | null, line: Pick<MatchLine, "amount">, candidate?: Pick<Candidate, "amount"> | null): string | null {
  if (decision === "pos" && kind !== "banka") return "POS hakedişi yalnız banka ekstresinde işaretlenir";
  if (decision !== "elle") return null;
  if (!candidate) return "Eşleştirilecek kayıt bulunamadı (silinmiş ya da başka satıra bağlanmış olabilir)";
  if (line.amount > 0 !== candidate.amount > 0) {
    return kind === "banka" ? "Hesaba giren para bir çıkış kaydıyla (ya da tersi) eşleştirilemez" : "Fatura bir ödemeyle (ya da tersi) eşleştirilemez";
  }
  return null;
}
