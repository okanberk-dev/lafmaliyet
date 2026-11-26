// Kişi bazında kayıp önleme özeti (Raporlar › Kayıp önleme; docs/RAPORLAR.md). Saf; yükleyici
// src/server/data/kayip-onleme.ts, testi tests/kayip-onleme.test.ts.
//
// LafPOS deposu değiştirilmeden, panelde var olan kişi bilgisiyle üç bölüm:
// 1. Kasa farkı, kasayı sayana göre (doğrudan): kasa raporunun "Kasayı sayan"ı (eski raporda gönderen). LafPOS'un kendiliğinden
//    yazdığı raporda kişi yok: LafPOS kasayı sayanı göndermiyor, satır "kişi bilinmiyor" sayılır.
// 2. Zayi ve ikram, kaydı girene göre (doğrudan): panelde zayi / ikram kaydını giren kişi (kaydeden; ikramı yapan olmayabilir).
//    LafPOS'tan gelen ikram ve zayi satırlarında kişi yok (ödenmezde yalnız kişinin türü).
// 3. İptal, ikram, indirim ve kasa farkı, çalıştığı günlere göre (dolaylı): LafPOS iptal edeni, ikram edeni ve indirimi
//    yapanı göndermiyor; gönderdiği tek kişi bilgisi o gün çalışanların listesi (personel bağlantısı). Kişinin çalıştığı
//    günlerin günlük ortalaması, aynı şubede çalışmadığı günlerinkiyle karşılaştırılır. Kişiye yazılmaz, tek başına kanıt
//    değildir: aynı gün çalışanların hepsi aynı sapmayı alır. LafPOS'un listesi olmayan günde Vardiya planı.
//
// Sapma yalnız iki tarafta da en az MIN_DAYS gün varken hesaplanır; "dikkat" işareti sapma kötü yönde ve şubenin günlük
// değerlerinin standart sapmasından büyükse.

import { CASH_TOLERANCE } from "./cash-report";

/** Sapma için iki tarafta da en az bu kadar gün */
export const MIN_DAYS = 3;

export interface LossPerson {
  /** Kişinin anahtarı: "u:<kullanıcı>", hesabı olmayan Vardiya adı "n:<ad>", bağlantısız personel "s:<kimlik>" */
  key: string;
  name: string;
}

/** Bir kasa raporu */
export interface LossCashReport {
  branchId: string;
  date: string;
  cashDiff: number;
  /** Kasayı sayan (yoksa gönderen); LafPOS'un otomatik raporunda null */
  person: LossPerson | null;
}

/** Panelde girilmiş bir zayi / ikram kaydı */
export interface LossWasteEntry {
  branchId: string;
  date: string;
  kind: "zayi" | "ikram";
  /** Malzeme maliyeti (KDV hariç; Zayi & ikram'ın kuralı) */
  cost: number;
  person: LossPerson | null;
}

/** Ölçülen günlük değerler */
export type LossMetric = "cashDiff" | "iptal" | "ikram" | "discount";

export const LOSS_METRIC_LABEL: Record<LossMetric, string> = {
  cashDiff: "Kasa farkı",
  iptal: "İptal",
  ikram: "İkram / ödenmez",
  discount: "İndirim",
};

/** Kötü yön: kasa farkında eksi (eksik), ötekilerde artı */
const WORSE: Record<LossMetric, -1 | 1> = { cashDiff: -1, iptal: 1, ikram: 1, discount: 1 };

/** Bir şubenin bir günü */
export interface LossDay {
  branchId: string;
  date: string;
  /** O gün çalışanların anahtarları; bilinmiyorsa null */
  workers: readonly string[] | null;
  /** Kaynağı: LafPOS'un çalışan listesi ya da Vardiya planı */
  workersFrom?: "lafpos" | "vardiya";
  /** Günün değerleri (TL); bilinmeyen null (iptal ModPOS'tan gelmez) */
  values: Partial<Record<LossMetric, number | null>>;
}

export interface CashPersonRow {
  branchId: string;
  person: LossPerson;
  reports: number;
  total: number;
  mean: number;
  /** Eksik çıkan gün (1 ₺'den çok) ve en büyük eksik */
  shortDays: number;
  worst: number;
  /** Kişinin ortalaması − şubenin rapor ortalaması (eksi: kişinin saydığı kasa daha çok eksik) */
  deviation: number | null;
  flag: boolean;
}

export interface CashBranchSummary {
  branchId: string;
  reports: number;
  mean: number | null;
  /** Kişisi olmayan rapor (LafPOS'un otomatik raporu) */
  unknown: number;
  unknownTotal: number;
}

export interface WastePersonRow {
  branchId: string;
  person: LossPerson;
  entries: number;
  zayiCost: number;
  ikramCost: number;
  /** Şubenin panel kayıtlarının maliyetindeki payı */
  share: number | null;
}

export interface MetricCompare {
  /** Çalıştığı ve çalışmadığı günlerin günlük ortalaması ve gün sayısı */
  worked: number | null;
  workedDays: number;
  other: number | null;
  otherDays: number;
  /** worked − other; iki tarafta da MIN_DAYS gün yoksa null */
  deviation: number | null;
  flag: boolean;
}

export interface DayPersonRow {
  branchId: string;
  person: LossPerson;
  workedDays: number;
  metrics: Record<LossMetric, MetricCompare>;
}

export interface DayBranchSummary {
  branchId: string;
  /** Çalışanı bilinen gün, kaynağına göre */
  days: number;
  lafposDays: number;
  vardiyaDays: number;
  /** Çalışanı bilinmeyen gün */
  unknownDays: number;
  /** Şubede hiç bilinmeyen değerler (ör. ModPOS'ta iptal) */
  missingMetrics: LossMetric[];
}

export interface LossSummary {
  cash: { rows: CashPersonRow[]; branches: CashBranchSummary[] };
  waste: { rows: WastePersonRow[]; unknown: { entries: number; cost: number } };
  days: { rows: DayPersonRow[]; branches: DayBranchSummary[] };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function std(xs: readonly number[]): number {
  const m = mean(xs);
  if (m === null || xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

const byName = (a: { person: LossPerson }, b: { person: LossPerson }) => a.person.name.localeCompare(b.person.name, "tr");

/** Kasa farkı, sayana göre */
export function cashByPerson(reports: readonly LossCashReport[]): LossSummary["cash"] {
  const branches = [...new Set(reports.map((r) => r.branchId))];
  const rows: CashPersonRow[] = [];
  const summaries: CashBranchSummary[] = [];
  for (const b of branches) {
    const list = reports.filter((r) => r.branchId === b);
    const diffs = list.map((r) => r.cashDiff);
    const branchMean = mean(diffs);
    const spread = std(diffs);
    const unknown = list.filter((r) => !r.person);
    summaries.push({ branchId: b, reports: list.length, mean: branchMean === null ? null : r2(branchMean), unknown: unknown.length, unknownTotal: r2(unknown.reduce((a, r) => a + r.cashDiff, 0)) });
    const people = new Map<string, { person: LossPerson; diffs: number[] }>();
    for (const r of list) {
      if (!r.person) continue;
      const cur = people.get(r.person.key) ?? { person: r.person, diffs: [] };
      cur.diffs.push(r.cashDiff);
      people.set(r.person.key, cur);
    }
    for (const { person, diffs: ds } of people.values()) {
      const m = mean(ds) ?? 0;
      // Kişinin dışındaki raporların ortalamasıyla (kendi raporları ortalamayı kendine çekmesin)
      const others = list.filter((r) => r.person?.key !== person.key).map((r) => r.cashDiff);
      const om = mean(others);
      const deviation = ds.length >= MIN_DAYS && others.length >= MIN_DAYS && om !== null ? r2(m - om) : null;
      rows.push({
        branchId: b,
        person,
        reports: ds.length,
        total: r2(ds.reduce((a, x) => a + x, 0)),
        mean: r2(m),
        shortDays: ds.filter((x) => x <= -CASH_TOLERANCE).length,
        worst: r2(Math.min(0, ...ds)),
        deviation,
        flag: deviation !== null && deviation < 0 && -deviation >= Math.max(spread, CASH_TOLERANCE),
      });
    }
  }
  // Önce en çok eksik çıkan (ortalaması en eksi)
  rows.sort((a, b) => a.branchId.localeCompare(b.branchId) || a.mean - b.mean || byName(a, b));
  return { rows, branches: summaries };
}

/** Panelde girilmiş zayi ve ikram, kaydedene göre */
export function wasteByPerson(entries: readonly LossWasteEntry[]): LossSummary["waste"] {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.branchId, (totals.get(e.branchId) ?? 0) + e.cost);
  const people = new Map<string, WastePersonRow>();
  let unknownEntries = 0;
  let unknownCost = 0;
  for (const e of entries) {
    if (!e.person) {
      unknownEntries++;
      unknownCost += e.cost;
      continue;
    }
    const k = `${e.branchId}|${e.person.key}`;
    const cur = people.get(k) ?? { branchId: e.branchId, person: e.person, entries: 0, zayiCost: 0, ikramCost: 0, share: null };
    cur.entries++;
    if (e.kind === "zayi") cur.zayiCost += e.cost;
    else cur.ikramCost += e.cost;
    people.set(k, cur);
  }
  const rows = [...people.values()].map((r) => {
    const total = totals.get(r.branchId) ?? 0;
    return { ...r, zayiCost: r2(r.zayiCost), ikramCost: r2(r.ikramCost), share: total > 0 ? (r.zayiCost + r.ikramCost) / total : null };
  });
  rows.sort((a, b) => a.branchId.localeCompare(b.branchId) || b.zayiCost + b.ikramCost - (a.zayiCost + a.ikramCost) || byName(a, b));
  return { rows, unknown: { entries: unknownEntries, cost: r2(unknownCost) } };
}

const METRICS: readonly LossMetric[] = ["cashDiff", "iptal", "ikram", "discount"];

/** Çalıştığı günlere göre (dolaylı): kişinin çalıştığı ve çalışmadığı günlerin günlük ortalaması, şube içinde */
export function dayAssociation(days: readonly LossDay[], names: ReadonlyMap<string, string>): LossSummary["days"] {
  const branches = [...new Set(days.map((d) => d.branchId))];
  const rows: DayPersonRow[] = [];
  const summaries: DayBranchSummary[] = [];
  for (const b of branches) {
    const list = days.filter((d) => d.branchId === b);
    const known = list.filter((d) => d.workers !== null);
    summaries.push({
      branchId: b,
      days: known.length,
      lafposDays: known.filter((d) => d.workersFrom === "lafpos").length,
      vardiyaDays: known.filter((d) => d.workersFrom === "vardiya").length,
      unknownDays: list.length - known.length,
      missingMetrics: METRICS.filter((m) => !list.some((d) => typeof d.values[m] === "number")),
    });
    const spread = Object.fromEntries(METRICS.map((m) => [m, std(known.flatMap((d) => (typeof d.values[m] === "number" ? [d.values[m] as number] : [])))])) as Record<LossMetric, number>;
    const people = new Set(known.flatMap((d) => d.workers ?? []));
    for (const key of people) {
      const worked = known.filter((d) => d.workers?.includes(key));
      const other = known.filter((d) => !d.workers?.includes(key));
      const metrics = Object.fromEntries(
        METRICS.map((m) => {
          const w = worked.flatMap((d) => (typeof d.values[m] === "number" ? [d.values[m] as number] : []));
          const o = other.flatMap((d) => (typeof d.values[m] === "number" ? [d.values[m] as number] : []));
          const wm = mean(w);
          const om = mean(o);
          const deviation = w.length >= MIN_DAYS && o.length >= MIN_DAYS && wm !== null && om !== null ? r2(wm - om) : null;
          const worse = deviation !== null && deviation * WORSE[m] > 0 && Math.abs(deviation) >= Math.max(spread[m], CASH_TOLERANCE);
          return [m, { worked: wm === null ? null : r2(wm), workedDays: w.length, other: om === null ? null : r2(om), otherDays: o.length, deviation, flag: worse }];
        }),
      ) as Record<LossMetric, MetricCompare>;
      rows.push({ branchId: b, person: { key, name: names.get(key) ?? key }, workedDays: worked.length, metrics });
    }
  }
  rows.sort((a, b) => a.branchId.localeCompare(b.branchId) || b.workedDays - a.workedDays || byName(a, b));
  return { rows, branches: summaries };
}

export function lossSummary(input: { cash: readonly LossCashReport[]; waste: readonly LossWasteEntry[]; days: readonly LossDay[]; names: ReadonlyMap<string, string> }): LossSummary {
  return { cash: cashByPerson(input.cash), waste: wasteByPerson(input.waste), days: dayAssociation(input.days, input.names) };
}

/** LafPOS'un çalışan kimliği ("s:<personel>") → kişinin anahtarı: bağlı hesap "u:<id>", Vardiya adı "n:…", yoksa kendisi */
export function staffPersonKey(staff: { id: number; userId: number | null; personRef: string | null }): string {
  if (staff.userId) return `u:${staff.userId}`;
  if (staff.personRef && /^n:./.test(staff.personRef)) return staff.personRef;
  return `s:${staff.id}`;
}
