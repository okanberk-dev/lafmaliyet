/**
 * Mutabakat: ekstre satırlarını panel kayıtlarıyla eşleştirme (saf; tests/mutabakat-eslesme.test.ts,
 * docs/MUTABAKAT.md). Eşleşme okuma anında hesaplanır, saklanmaz: yalnız yöneticinin kararı (elle eşleştirme, yok say,
 * eşleşmeyi ayır, POS hakedişi) satırda durur. Panel kaydına hiçbir şey yazılmaz: mutabakat bir karşılaştırmadır,
 * faturayı "ödendi" yapmaz, ödeme kaydı açmaz.
 */
import { addDays, daysBetween } from "../reminders";
import { fold } from "./parse";

/** Panel kaydının türü */
export type RecordKind = "harcama" | "odeme" | "fatura-odeme" | "teslim" | "fatura";

export const RECORD_LABEL: Record<RecordKind, string> = {
  harcama: "Harcama",
  odeme: "Tedarikçi ödemesi",
  "fatura-odeme": "Fatura ödemesi",
  teslim: "Kasadan teslim",
  fatura: "Fatura",
};

export const RECORD_KINDS = Object.keys(RECORD_LABEL) as RecordKind[];

export interface Candidate {
  kind: RecordKind;
  id: number;
  date: string;
  /** Ekstre satırıyla aynı işaret kuralı: banka + giren / − çıkan; tedarikçi + fatura / − ödeme */
  amount: number;
  /** Ekranda görünen ad ("Sütaş · havale") */
  label: string;
  /** Açıklamada aranacak adlar (tedarikçi adı ve diğer adları, harcamanın açıklaması) */
  names?: readonly string[];
  /** Belge numarası (fatura no): ekstrede geçiyorsa kesin eşleşme */
  ref?: string | null;
  /** Ekrandaki bağlantı */
  href?: string | null;
}

/** Yöneticinin satır kararı. `elle`: bu kayıtla eşleşir; `yoksay`: listeden düşer; `ayir`: kendiliğinden eşleşmez; `pos`: POS hakedişi */
export type Decision = "elle" | "yoksay" | "ayir" | "pos";
export const DECISIONS = ["elle", "yoksay", "ayir", "pos"] as const satisfies readonly Decision[];

export interface MatchLine {
  id: number;
  date: string;
  amount: number;
  description: string;
  ref: string | null;
  decision: Decision | null;
  matchKind: string | null;
  matchId: number | null;
}

export type MatchStatus = "eslesti" | "fark" | "yok" | "yoksay";
/** Eşleşmenin dayanağı: yöneticinin seçimi, belge numarası, ad + tutar, yalnız tutar ve gün, ad + yakın tutar */
export type MatchBasis = "elle" | "belge" | "ad" | "tutar" | "yakin";

export const BASIS_LABEL: Record<MatchBasis, string> = {
  elle: "Elle eşleştirildi",
  belge: "Belge numarasından",
  ad: "Ad ve tutardan",
  tutar: "Tutar ve günden",
  yakin: "Yakın tutardan",
};

export interface LineMatch<L extends MatchLine = MatchLine> {
  line: L;
  status: MatchStatus;
  candidate: Candidate | null;
  basis: MatchBasis | null;
  /** Ekstre − panel (mutlak tutarlar üzerinden; + ekstrede fazla) */
  diff: number;
  /** Elle eşleştirilen kayıt artık yok (silinmiş ya da başka satıra bağlanmış) */
  stale?: boolean;
}

export interface MatchOptions {
  /** Kaydın günü ile ekstre günü arasındaki en çok gün farkı */
  windowDays: number;
  /** Tutarı farklı adayda ad şartı (banka: evet; tedarikçi ekstresinde bütün kayıtlar aynı tedarikçinin: hayır) */
  nameRequiredForDiff: boolean;
  /** Tutarı farklı adayda en çok oransal fark (0,2 = %20) */
  diffRatio?: number;
  /** "Panelde var, ekstrede yok" listesinin dönemi (ekstrenin kapsadığı günler) */
  period?: { from: string; to: string } | null;
}

export const BANK_MATCH: MatchOptions = { windowDays: 5, nameRequiredForDiff: true, diffRatio: 0.2 };
export const SUPPLIER_MATCH: MatchOptions = { windowDays: 7, nameRequiredForDiff: false, diffRatio: 0.2 };

const EPS = 0.005;
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= 0.01 + EPS;
const sameSign = (a: number, b: number) => a > 0 === b > 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Adın ayırt etmeyen sözcükleri (şirket türü, sektör, işlem): açıklamada geçmesi bir şey söylemez */
const STOP = new Set(
  "limited sirketi sirket anonim ticaret sanayi pazarlama gida urunleri hizmetleri dagitim insaat turizm ithalat ihracat grup grubu market marketler magazacilik isletmeleri isletmesi odeme odemesi fatura faturasi havale banka hesap icin nolu tarihli kasa kasadan teslim".split(
    " ",
  ),
);

/** Adın ayırt eden sözcükleri (en az 4 harf, durak sözcük ve salt rakam değil) */
export function nameTokens(name: string): string[] {
  return [...new Set(fold(name).split(" ").filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t)))];
}

/** Açıklamada adlardan birinin ayırt eden sözcüğü geçiyor mu (sözcük başından) */
export function nameHit(description: string, names: readonly string[] | undefined): boolean {
  if (!names?.length) return false;
  const text = ` ${fold(description)} `;
  return names.some((n) => nameTokens(n).some((t) => text.includes(` ${t}`)));
}

const compact = (s: string) => fold(s).replace(/ /g, "");

/** Kaydın belge numarası satırın belge no'sunda ya da açıklamasında geçiyor mu (en az 5 karakterli numara) */
export function refHit(line: Pick<MatchLine, "description" | "ref">, ref: string | null | undefined): boolean {
  const r = compact(ref ?? "");
  if (r.length < 5) return false;
  return compact(line.ref ?? "").includes(r) || compact(line.description).includes(r);
}

const keyOf = (c: Pick<Candidate, "kind" | "id">) => `${c.kind}:${c.id}`;

/**
 * Satırları kayıtlarla eşleştirir; bir kayıt en çok bir satıra gider. Sıra: (0) yöneticinin kararları, (1) belge
 * numarası (tutar tutuyorsa eşleşti, tutmuyorsa tutarı farklı), (2) aynı tutar + açıklamada ad, (3) aynı tutar, en
 * yakın gün, (4) ad (ya da aynı tedarikçi) + yakın tutar: tutarı farklı. Kalan satır eşleşmeyendir; dönemdeki kalan
 * kayıtlar `missing`'te ("panelde var, ekstrede yok").
 */
export function matchLines<L extends MatchLine>(lines: readonly L[], candidates: readonly Candidate[], opts: MatchOptions): { rows: LineMatch<L>[]; missing: Candidate[] } {
  const byKey = new Map(candidates.map((c) => [keyOf(c), c] as const));
  const used = new Set<string>();
  const out = new Map<number, LineMatch<L>>();
  const set = (line: L, status: MatchStatus, candidate: Candidate | null, basis: MatchBasis | null, extra: Partial<LineMatch<L>> = {}) => {
    if (candidate) used.add(keyOf(candidate));
    out.set(line.id, { line, status, candidate, basis, diff: candidate ? r2(Math.abs(line.amount) - Math.abs(candidate.amount)) : 0, ...extra });
  };
  const ordered = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  // 0. Kararlar
  for (const l of ordered) {
    if (l.decision === "yoksay") set(l, "yoksay", null, null);
    else if (l.decision === "ayir" || l.decision === "pos") set(l, "yok", null, null);
    else if (l.decision === "elle") {
      const c = l.matchKind && l.matchId !== null ? byKey.get(`${l.matchKind}:${l.matchId}`) : undefined;
      if (!c || used.has(keyOf(c))) set(l, "yok", null, null, { stale: true });
      else set(l, sameAmount(Math.abs(l.amount), Math.abs(c.amount)) ? "eslesti" : "fark", c, "elle");
    }
  }
  const open = () => ordered.filter((l) => !out.has(l.id));
  const free = () => candidates.filter((c) => !used.has(keyOf(c)));
  const gap = (l: L, c: Candidate) => Math.abs(daysBetween(c.date, l.date));
  const nearest = (l: L, list: readonly Candidate[]) => [...list].sort((a, b) => gap(l, a) - gap(l, b) || a.date.localeCompare(b.date) || a.id - b.id)[0];
  const off = (l: L, c: Candidate) => Math.abs(Math.abs(l.amount) - Math.abs(c.amount));

  // 1. Belge numarası
  for (const l of open()) {
    const hits = free().filter((c) => sameSign(l.amount, c.amount) && refHit(l, c.ref));
    if (!hits.length) continue;
    const exact = hits.filter((c) => sameAmount(l.amount, c.amount));
    set(l, exact.length ? "eslesti" : "fark", nearest(l, exact.length ? exact : hits), "belge");
  }
  // 2. Aynı tutar + ad
  for (const l of open()) {
    const hits = free().filter((c) => sameAmount(l.amount, c.amount) && gap(l, c) <= opts.windowDays && nameHit(l.description, c.names));
    if (hits.length) set(l, "eslesti", nearest(l, hits), "ad");
  }
  // 3. Aynı tutar, en yakın gün
  for (const l of open()) {
    const hits = free().filter((c) => sameAmount(l.amount, c.amount) && gap(l, c) <= opts.windowDays);
    if (hits.length) set(l, "eslesti", nearest(l, hits), "tutar");
  }
  // 4. Tutarı farklı
  const ratio = opts.diffRatio ?? 0.2;
  for (const l of open()) {
    const hits = free().filter(
      (c) =>
        sameSign(l.amount, c.amount) &&
        gap(l, c) <= opts.windowDays &&
        off(l, c) <= ratio * Math.max(Math.abs(l.amount), Math.abs(c.amount)) &&
        (!opts.nameRequiredForDiff || nameHit(l.description, c.names)),
    );
    if (!hits.length) continue;
    set(l, "fark", [...hits].sort((a, b) => off(l, a) - off(l, b) || gap(l, a) - gap(l, b) || a.id - b.id)[0], "yakin");
  }
  for (const l of open()) set(l, "yok", null, null);

  const period = opts.period;
  const missing = period ? free().filter((c) => c.date >= period.from && c.date <= period.to) : [];
  missing.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return { rows: ordered.map((l) => out.get(l.id)!), missing };
}

/** Elle eşleştirme penceresinin adayları: aynı yön, ±45 gün; önce tutarı tutan, sonra günü yakın olan */
export function manualCandidates(line: Pick<MatchLine, "amount" | "date">, free: readonly Candidate[], limit = 40): Candidate[] {
  const gap = (c: Candidate) => Math.abs(daysBetween(c.date, line.date));
  const off = (c: Candidate) => Math.abs(Math.abs(line.amount) - Math.abs(c.amount));
  return free
    .filter((c) => sameSign(line.amount, c.amount) && gap(c) <= 45)
    .sort((a, b) => Number(sameAmount(line.amount, b.amount)) - Number(sameAmount(line.amount, a.amount)) || gap(a) - gap(b) || off(a) - off(b))
    .slice(0, limit);
}

export interface MatchSummary {
  eslesti: number;
  fark: number;
  yok: number;
  yoksay: number;
  /** Eşleşmeyen satırların mutlak tutar toplamı */
  yokAmount: number;
  /** Tutarı farklı satırlardaki farkların mutlak toplamı */
  farkAmount: number;
}

export function summarize(rows: readonly LineMatch[]): MatchSummary {
  const s: MatchSummary = { eslesti: 0, fark: 0, yok: 0, yoksay: 0, yokAmount: 0, farkAmount: 0 };
  for (const r of rows) {
    s[r.status]++;
    if (r.status === "yok") s.yokAmount = r2(s.yokAmount + Math.abs(r.line.amount));
    if (r.status === "fark") s.farkAmount = r2(s.farkAmount + Math.abs(r.diff));
  }
  return s;
}

// ---------------------------------------------------------------- Banka satırının türü

const POS_WORDS = /\bpos\b|uye isyeri|uye is yeri|hakedis|bloke coz|blokaj coz|isyeri odemesi|\bvalorlu\b/;
const POS_FEE_WORDS = /komisyon|kesinti|ucret|masraf|iade|chargeback|ters ibraz|bloke/;

/**
 * Banka satırı POS hakedişi mi: açıklamasında POS / üye işyeri / hakediş geçen GİRİŞ; çıkışlarda yalnız POS komisyonu,
 * kesintisi, iadesi (hakedişten düşer). Şirket kartıyla yapılan alışveriş ("POS alışveriş", çıkış) hakediş değildir:
 * harcama kayıtlarıyla eşleşir. Yönetici kararıyla değişir (`pos`: hakediş say; öteki kararlar: sayma).
 */
export function isPosLine(line: Pick<MatchLine, "amount" | "description" | "decision">): boolean {
  if (line.decision === "pos") return true;
  if (line.decision) return false;
  const text = fold(line.description);
  if (!POS_WORDS.test(text)) return false;
  return line.amount > 0 || POS_FEE_WORDS.test(text);
}

// ---------------------------------------------------------------- Saklama süresi (KVKK)

/**
 * Ekstre satırları yüklendikten bu kadar gün sonra silinir (günlük iş). Dosyanın kendisi hiç saklanmaz. Süre,
 * mutabakatın bir ay sonu kapanışı ve ertesi ayın kontrolü için yetecek kadar; satırlar kişi adı taşıyabilir (havale
 * açıklaması), gerektiğinden uzun tutulmaz.
 */
export const KEEP_DAYS = 90;

/** Saklama süresinin son günü: yüklendiği gün + `keepDays`; bu günden SONRA silinir */
export const expiryOf = (uploadedOn: string, keepDays: number = KEEP_DAYS) => addDays(uploadedOn, keepDays);
