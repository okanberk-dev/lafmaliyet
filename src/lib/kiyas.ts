/**
 * Genel bakış ve Bugün › "Kıyas" kartı (saf; tests/kiyas.test.ts; docs/KIYAS.md). Son kapanmış iş gününün cirosu ve
 * önceki gün, geçen hafta aynı gün, geçen ay aynı tarih ile kıyası; dönem kıyasları (hafta başından ↔ geçen haftanın
 * aynı günleri, ay başından ↔ geçen ayın aynı tarihleri, son 7 gün ↔ önceki 7 gün; üçü de ciro toplamı). Her kıyas:
 * tutar, ₺ fark, % değişim; fiş (adisyon) sayısı ve ortalama fiş veri varsa.
 *
 * **Kaynak** Genel bakış'ın günlük ciro kartıyla aynı: ay bilgisinin okuduğu kasa satırları (src/server/data/cash-reports.ts
 * tillRows: kasa raporu > LafPOS gün sonu (yalnız geçiş gününden itibaren) > ModPOS föyü, şube başına günde bir satır),
 * seçili şubenin kapsamıyla. Ciro kuralı ayınki (src/lib/cash-revenue.ts dayRevenue): KDV dahil, ödenmez / ikram hariç.
 * Para TL, kuruşa yuvarlanır (ay rakamının kuralı).
 *
 * **Şube-gün durumları.** Satırı olan gün: Z toplamı sıfırdan büyükse "satış", değilse "satış yok". Kapalı işaretli gün
 * (Özel günler › kapalı) satırı yoksa da "satış yok" sayılır. Satırı da kapalı işareti de olmayan gün "veri yok": sıfır
 * sayılmaz, kıyasa girmez. Şubenin açılış gününden önceki gün "açılmamış": beklenmez, veri yok sayılmaz. Marina'nın geçiş
 * gününden önceki LafPOS gün sonları (deneme) hiç sayılmaz.
 *
 * **Bir tarafın (gün ya da dönem) durumu.** En az bir şube-günde satış varsa satış var. Beklenen bütün şube-günler
 * biliniyor ve hiçbirinde satış yoksa "satış yok". Satış yokken bilinmeyen (veri yok) şube-gün de varsa "veri yok":
 * "Tümü"de Tuzla kapalıyken Marina'nın verisi gelmediyse o gün satışsız denemez.
 *
 * **Benzerle benzer.** Yüzde ve ₺ fark şube şube ve gün gün eşlenerek hesaplanır: bir şubenin bir günü, ancak eşi olan
 * gün de bilinirse (satış ya da satış yok) kıyasa girer. Satırda yazan tutar ise günün ya da dönemin bilinen bütün
 * cirosudur (`curAll` / `prevAll`); ikisi ayrıldığında kart kıyaslananları ayrıca yazar. Açık gün (en az bir şubede satış
 * olan gün) "Tümü"de bir kez sayılır.
 */

import { DEFAULT_BRANCH_ID } from "@/lib/branches";
import type { TillRow } from "@/lib/cash-month";
import { dayRevenue } from "@/lib/cash-revenue";
import { branchSwitchDay, isLafposDay } from "@/lib/lafpos/switch";
import { addDays, monthTitleTR, shiftMonth } from "@/lib/reminders";

export interface KiyasBranch {
  id: string;
  name: string;
  /** Açılış günü; o günden önce şube beklenmez (kıyasa girmez, veri yok sayılmaz) */
  openedOn: string | null;
}

export interface KiyasInput {
  /** Seçili kapsamın kasa satırları (tillRows) */
  rows: readonly TillRow[];
  /** Kapsamdaki fiziksel şubeler (tek şube seçiliyse yalnız o) */
  branches: readonly KiyasBranch[];
  /** Bugünün iş günü (05:00 kuralı, src/lib/cash-report.ts businessDate) */
  today: string;
  /** LafPOS'a geçiş günü (ayar); LafPOS satırı yalnız şubesinin geçiş gününden itibaren sayılır */
  switchDay: string | null;
  /** Kasa raporlarının fiş sayısı, `şube|gün` anahtarıyla (tillRows rapor satırına fiş koymaz) */
  receipts?: ReadonlyMap<string, number | null>;
  /** Kapalı işaretli gün mü (şubenin kendi ya da işletme geneli işareti) */
  isClosed?: (branchId: string, date: string) => boolean;
}

/** Bir şubenin bir günü */
export type KiyasCell =
  | { kind: "satis"; revenue: number; receipts: number | null }
  | { kind: "bos"; closed: boolean }
  | { kind: "yok" }
  /** Şube o gün henüz açılmamıştı */
  | { kind: "kapsam-disi" };

/** Bir pencerenin (gün ya da dönem) toplamı */
export interface KiyasAgg {
  revenue: number;
  /** Fiş sayısı; satışlı günlerden birinde bile bilinmiyorsa null */
  receipts: number | null;
  /** Fiş başına ciro */
  avgReceipt: number | null;
  /** Bilinen gün sayısı (takvim günü) */
  days: number;
  /** Açık gün: en az bir şubede satış olan gün ("Tümü"de bir kez sayılır) */
  openDays: number;
  /** Açık gün başına ciro */
  dailyAvg: number | null;
}

/** Bir tarafın durumu: satış var, satış yok (beklenen her şube-gün biliniyor), bilinmiyor */
export type KiyasSide = "satis" | "satis-yok" | "bilinmiyor";

export type KiyasState =
  /** Kıyas yapıldı (change dolu) */
  | "ok"
  /** Kıyaslanan günde / dönemde satış yok (beklenen bütün şubeler biliniyor) */
  | "onceki-satis-yok"
  /** Gösterilen günde / dönemde satış yok (beklenen bütün şubeler biliniyor) */
  | "satis-yok"
  /** Kıyaslanacak bilinen şube-gün yok ya da bir tarafın satışı bilinmiyor */
  | "veri-yok"
  /** Kıyaslanan günde / dönemde şube henüz açılmamıştı (veri yok değil) */
  | "acilmamis"
  /** Geçen ayda o tarih yok (31 → 30) */
  | "tarih-yok";

/** Verisi olmadığı için kıyas dışı kalan şube: kaç gün eşleşmedi, kaçında gösterilen, kaçında kıyaslanan taraf eksikti */
export interface KiyasExcluded {
  id: string;
  name: string;
  days: number;
  curDays: number;
  prevDays: number;
}

/** Kıyaslanan tarafta henüz açılmamış şube (veri yok değil; kıyas dışı) */
export interface KiyasNotOpen {
  id: string;
  name: string;
  days: number;
}

export interface KiyasRow {
  key: "dun" | "gecen-hafta" | "gecen-ay" | "bu-hafta" | "bu-ay" | "son-7";
  /** Satırın adı, gösterilen güne göre ("Bu hafta"; pazartesi gösterilen pazarın haftası "Geçen hafta", ayın 1'inde "Kasım") */
  label: string;
  /** Kıyaslanan tarafın adı ("Geçen hafta", "Önceki hafta", "Geçen ay", "Ekim", "Önceki 7 gün"; gün satırında label) */
  prevLabel: string;
  /** Kıyaslanan gün ya da dönemin ilk / son günü */
  prevFrom: string | null;
  prevTo: string | null;
  curFrom: string;
  curTo: string;
  state: KiyasState;
  /** Tarafların durumu (tarih yoksa null) */
  sides: { cur: KiyasSide; prev: KiyasSide } | null;
  /** Kıyasa giren (iki günü de bilinen) şube-günlerin toplamı: yüzde ve fark bunlardan */
  cur: KiyasAgg | null;
  prev: KiyasAgg | null;
  /** Tarafın bilinen bütün şube-günlerinin toplamı: satırda yazan tutar (günün ya da dönemin cirosu) */
  curAll: KiyasAgg | null;
  prevAll: KiyasAgg | null;
  /** Ciro farkı (TL, kıyaslananlarla) */
  diff: number | null;
  /** Ciro değişimi (0,12 = +%12) */
  change: number | null;
  /** Fiş sayısının ve ortalama fişin değişimi (biliniyorsa) */
  receiptsChange: number | null;
  avgReceiptChange: number | null;
  /** Verisi olmadığı için kıyas dışı kalan şubeler */
  excluded: KiyasExcluded[];
  /** Kıyaslanan tarafta henüz açılmamış şubeler */
  notOpen: KiyasNotOpen[];
  /** Ay kıyasında eşi olmayan günler (ör. 31 Mart: Şubat'ta 31 yok) */
  unpairedDays: number;
}

export interface KiyasDay {
  date: string;
  /** Gösterilen gün bugünün iş günü mü (bütün şubeler bugünü kapattıysa) */
  isToday: boolean;
  /** Verisi olan şubelerin toplamı; yalnız satışlı günde (satış yok ve veri yok sıfır yazılmaz) */
  revenue: number | null;
  receipts: number | null;
  avgReceipt: number | null;
  /** Gün durumu: satış, satış yok (beklenen her şube biliniyor ve kapalı ya da Z sıfır), veri yok */
  state: "satis" | "satis-yok" | "veri-yok";
  /** Verisi gelmeyen şubeler */
  missing: { id: string; name: string }[];
  /** O gün satışı olmayan (kapalı ya da Z sıfır) şubeler */
  noSale: { id: string; name: string }[];
}

export interface KiyasSummary {
  day: KiyasDay;
  /** Önceki gün, geçen hafta aynı gün, geçen ay aynı tarih */
  days: KiyasRow[];
  /** Hafta başından, ay başından, son 7 gün */
  periods: KiyasRow[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const key = (branchId: string, date: string) => `${branchId}|${date}`;
const PRIORITY = { undefined: 0, lafpos: 1, modpos: 2 } as const;
const rank = (r: TillRow) => PRIORITY[String(r.source) as keyof typeof PRIORITY] ?? 3;

/** Ayın gün sayısı ("2026-02" → 28) */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Haftanın pazartesisi (iş günü takvimi; Türkiye'de hafta pazartesi başlar) */
export function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 pazar
  return addDays(date, -((dow + 6) % 7));
}

/** Geçen ayın aynı tarihi; o ayda o gün yoksa null (31 Mart → Şubat'ta yok) */
export function sameDayLastMonth(date: string): string | null {
  const prev = shiftMonth(date.slice(0, 7), -1);
  const d = Number(date.slice(8, 10));
  return d > daysInMonth(prev) ? null : `${prev}-${date.slice(8, 10)}`;
}

/** Değişim oranı; önceki sıfır ya da yoksa null */
export function changeOf(cur: number | null, prev: number | null): number | null {
  if (cur === null || prev === null || !(prev > 0)) return null;
  return cur / prev - 1;
}

/** Şube-gün hücrelerini kuran okuyucu */
export function cellReader(input: KiyasInput): (branch: KiyasBranch, date: string) => KiyasCell {
  const byKey = new Map<string, TillRow>();
  for (const r of input.rows) {
    const b = r.branchId ?? DEFAULT_BRANCH_ID;
    // Geçiş gününden önceki LafPOS gün sonu deneme günüdür: hiçbir hesaba girmez (tillRows zaten süzer; burada da)
    if (r.source === "lafpos" && !isLafposDay(r.date, branchSwitchDay(input.switchDay, b))) continue;
    const k = key(b, r.date);
    const had = byKey.get(k);
    if (!had || rank(r) < rank(had)) byKey.set(k, r);
  }
  return (branch, date) => {
    if (branch.openedOn !== null && date < branch.openedOn) return { kind: "kapsam-disi" };
    const r = byKey.get(key(branch.id, date));
    if (!r) return input.isClosed?.(branch.id, date) ? { kind: "bos", closed: true } : { kind: "yok" };
    if (!(r.zTotal > 0)) return { kind: "bos", closed: false };
    const revenue = dayRevenue({ zTotal: r.zTotal, offRevenue: r.offRevenue ?? null, payments: r.payments ?? null }).revenue;
    // Rapor satırının fişi raporlardan, yedek satırınki kendi Z'sinden. Satış varken 0 fiş girilmemiş demektir
    // (bilinmiyor): sayılırsa "Fiş 40 → 0" ve şişkin ortalama çıkar
    const n = r.source ? (r.receipts ?? null) : (input.receipts?.get(key(branch.id, date)) ?? null);
    return { kind: "satis", revenue, receipts: n !== null && n > 0 ? n : null };
  };
}

const known = (c: KiyasCell): c is Extract<KiyasCell, { kind: "satis" | "bos" }> => c.kind === "satis" || c.kind === "bos";

interface Acc {
  revenue: number;
  receipts: number | null;
  dates: Set<string>;
  open: Set<string>;
}
const newAcc = (): Acc => ({ revenue: 0, receipts: 0, dates: new Set(), open: new Set() });

function add(acc: Acc, date: string, c: Extract<KiyasCell, { kind: "satis" | "bos" }>) {
  acc.dates.add(date);
  if (c.kind === "bos") return;
  acc.revenue += c.revenue;
  acc.open.add(date);
  acc.receipts = acc.receipts === null || c.receipts === null ? null : acc.receipts + c.receipts;
}

function aggOf(acc: Acc): KiyasAgg {
  const revenue = r2(acc.revenue);
  // Satış yoksa fiş de yok (0 fiş yazılmaz)
  const receipts = acc.open.size ? acc.receipts : null;
  return {
    revenue,
    receipts,
    avgReceipt: receipts ? r2(revenue / receipts) : null,
    days: acc.dates.size,
    openDays: acc.open.size,
    dailyAvg: acc.open.size ? r2(revenue / acc.open.size) : null,
  };
}

/** Tarafın durumu: satış varsa satış; yoksa bilinmeyen beklenen şube-gün varken (ya da hiç bilinen yokken) bilinmiyor */
const sideOf = (acc: Acc, unknown: boolean): KiyasSide => (acc.open.size ? "satis" : unknown || !acc.dates.size ? "bilinmiyor" : "satis-yok");

/**
 * Eşlenmiş günlerin kıyası: her (gösterilen gün, eşi) çiftinde her şube, iki günü de biliniyorsa iki tarafa da girer.
 * Eşi null olan gün (geçen ayda o tarih yok) yalnız gösterilen tarafın tutarına girer. Gösterilen günde açılmamış şube
 * kıyasın konusu değil; kıyaslanan günde açılmamış şube `notOpen`, verisi olmayan `excluded`.
 */
export function comparePairs(
  read: (branch: KiyasBranch, date: string) => KiyasCell,
  branches: readonly KiyasBranch[],
  pairs: readonly (readonly [cur: string, prev: string | null])[],
): Pick<KiyasRow, "state" | "sides" | "cur" | "prev" | "curAll" | "prevAll" | "diff" | "change" | "receiptsChange" | "avgReceiptChange" | "excluded" | "notOpen"> {
  const cur = newAcc();
  const prev = newAcc();
  const curAll = newAcc();
  const prevAll = newAcc();
  let curUnknown = false;
  let prevUnknown = false;
  let pairsIn = 0;
  const excluded = new Map<string, KiyasExcluded>();
  const notOpen = new Map<string, KiyasNotOpen>();
  const exclude = (b: KiyasBranch, curMissing: boolean, prevMissing: boolean) => {
    const e = excluded.get(b.id) ?? { id: b.id, name: b.name, days: 0, curDays: 0, prevDays: 0 };
    e.days += 1;
    if (curMissing) e.curDays += 1;
    if (prevMissing) e.prevDays += 1;
    excluded.set(b.id, e);
  };
  for (const [c, p] of pairs) {
    for (const b of branches) {
      const cc = read(b, c);
      if (cc.kind === "kapsam-disi") continue;
      if (known(cc)) add(curAll, c, cc);
      else curUnknown = true;
      if (p === null) continue;
      const pc = read(b, p);
      if (pc.kind === "kapsam-disi") {
        const n = notOpen.get(b.id) ?? { id: b.id, name: b.name, days: 0 };
        n.days += 1;
        notOpen.set(b.id, n);
        if (!known(cc)) exclude(b, true, false);
        continue;
      }
      if (known(pc)) add(prevAll, p, pc);
      else prevUnknown = true;
      if (!known(cc) || !known(pc)) {
        exclude(b, !known(cc), !known(pc));
        continue;
      }
      add(cur, c, cc);
      add(prev, p, pc);
      pairsIn += 1;
    }
  }
  const sides = { cur: sideOf(curAll, curUnknown), prev: sideOf(prevAll, prevUnknown) };
  const base = {
    sides,
    curAll: curAll.dates.size ? aggOf(curAll) : null,
    prevAll: prevAll.dates.size ? aggOf(prevAll) : null,
    excluded: [...excluded.values()],
    notOpen: [...notOpen.values()],
  };
  const none = { diff: null, change: null, receiptsChange: null, avgReceiptChange: null };
  // Hiç eşleşen yoksa: eksik yalnız açılmamış şubelerden geliyorsa "açılmamıştı", değilse "veri yok"
  if (!pairsIn) return { state: !excluded.size && notOpen.size ? "acilmamis" : "veri-yok", cur: null, prev: null, ...none, ...base };
  const a = aggOf(cur);
  const b = aggOf(prev);
  // Satış yok yalnız tarafın beklenen bütün şube-günleri biliniyorsa; kıyaslananların bir tarafı satışsız kalıyorsa
  // (ör. Tuzla kapalı, satan Marina'nın eşi bilinmiyor) yüzde verilmez
  const state: KiyasState =
    sides.cur === "satis-yok"
      ? "satis-yok"
      : sides.cur === "bilinmiyor"
        ? "veri-yok"
        : sides.prev === "satis-yok"
          ? "onceki-satis-yok"
          : sides.prev === "bilinmiyor" || !a.openDays || !b.openDays
            ? "veri-yok"
            : "ok";
  if (state !== "ok") return { state, cur: a, prev: b, ...none, ...base };
  return {
    state,
    cur: a,
    prev: b,
    diff: r2(a.revenue - b.revenue),
    change: changeOf(a.revenue, b.revenue),
    receiptsChange: changeOf(a.receipts, b.receipts),
    avgReceiptChange: changeOf(a.avgReceipt, b.avgReceipt),
    ...base,
  };
}

/**
 * Kartın günü: kapsamdaki bütün açık şubeler bugünün gün sonunu verdiyse (ya da kapalı işaretliyse, en az birinin satırı
 * varken) bugün, yoksa dün. Akşam bir şube kapattı diye yarım günün toplamı gösterilmez (Bugün'ün şube kartıyla aynı).
 * `today` iş günüdür: gece 00:00–05:00 arası hâlâ önceki takvim günü (src/lib/cash-report.ts businessDate)
 */
export function pickKiyasDay(input: KiyasInput, read = cellReader(input)): string {
  const open = input.branches.filter((b) => b.openedOn === null || b.openedOn <= input.today);
  const cells = open.map((b) => read(b, input.today));
  if (open.length && cells.every(known) && cells.some((c) => c.kind === "satis" || (c.kind === "bos" && !c.closed))) return input.today;
  return addDays(input.today, -1);
}

function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Ayın adı ("2026-11-30" → "Kasım") */
const monthName = (date: string) => monthTitleTR(date.slice(0, 7)).split(" ")[0];

export function kiyasSummary(input: KiyasInput): KiyasSummary {
  const read = cellReader(input);
  const date = pickKiyasDay(input, read);
  const { branches, today } = input;
  const isToday = date === today;

  // Gösterilen gün: satış yok yalnız beklenen bütün şubeler biliniyorsa ("Tümü"de Marina'nın verisi yokken Tuzla
  // kapalıysa gün "veri yok")
  const cells = branches.map((b) => [b, read(b, date)] as const).filter(([, c]) => c.kind !== "kapsam-disi");
  const acc = newAcc();
  for (const [, c] of cells) if (known(c)) add(acc, date, c);
  const missing = cells.filter(([, c]) => c.kind === "yok").map(([b]) => ({ id: b.id, name: b.name }));
  const noSale = cells.filter(([, c]) => c.kind === "bos").map(([b]) => ({ id: b.id, name: b.name }));
  const dayAgg = aggOf(acc);
  const dayState = sideOf(acc, missing.length > 0);
  const sold = dayState === "satis";
  const day: KiyasDay = {
    date,
    isToday,
    revenue: sold ? dayAgg.revenue : null,
    receipts: sold ? dayAgg.receipts : null,
    avgReceipt: sold ? dayAgg.avgReceipt : null,
    state: dayState === "bilinmiyor" ? "veri-yok" : dayState,
    missing,
    noSale,
  };

  const single = (k: KiyasRow["key"], label: string, prev: string | null): KiyasRow => {
    const head = { key: k, label, prevLabel: label, curFrom: date, curTo: date };
    if (prev === null) {
      return {
        ...head,
        prevFrom: null,
        prevTo: null,
        state: "tarih-yok",
        sides: null,
        cur: null,
        prev: null,
        curAll: null,
        prevAll: null,
        diff: null,
        change: null,
        receiptsChange: null,
        avgReceiptChange: null,
        excluded: [],
        notOpen: [],
        unpairedDays: 1,
      };
    }
    return { ...head, prevFrom: prev, prevTo: prev, unpairedDays: 0, ...comparePairs(read, branches, [[date, prev]]) };
  };

  // Gösterilen gün bugünse "Dün", "Geçen hafta bugün"; dünse "Önceki gün", "Geçen hafta aynı gün"
  const days = [
    single("dun", isToday ? "Dün" : "Önceki gün", addDays(date, -1)),
    single("gecen-hafta", isToday ? "Geçen hafta bugün" : "Geçen hafta aynı gün", addDays(date, -7)),
    single("gecen-ay", isToday ? "Geçen ay bugün" : "Geçen ay aynı gün", sameDayLastMonth(date)),
  ];

  // Hafta başından (pazartesi) ↔ geçen haftanın aynı günleri. Pazartesi gece gösterilen pazar geçen haftanındır
  const week = range(mondayOf(date), date);
  const thisWeek = mondayOf(date) === mondayOf(today);
  // Ay başından ↔ geçen ayın aynı tarihleri; geçen ayda olmayan gün (31 → 30) eşsiz kalır. Ayın 1'inde gösterilen gün
  // geçen ayın son günüdür: satır o ayın adıyla ("Kasım" ↔ "Ekim")
  const month = range(`${date.slice(0, 8)}01`, date);
  const monthPairs = month.map((d) => [d, sameDayLastMonth(d)] as const);
  const paired = monthPairs.flatMap(([, p]) => (p ? [p] : []));
  const thisMonth = date.slice(0, 7) === today.slice(0, 7);
  // Son 7 gün ↔ önceki 7 gün
  const last7 = range(addDays(date, -6), date);

  const periods: KiyasRow[] = [
    {
      key: "bu-hafta",
      label: thisWeek ? "Bu hafta" : "Geçen hafta",
      prevLabel: thisWeek ? "Geçen hafta" : "Önceki hafta",
      curFrom: week[0],
      curTo: date,
      prevFrom: addDays(week[0], -7),
      prevTo: addDays(date, -7),
      unpairedDays: 0,
      ...comparePairs(read, branches, week.map((d) => [d, addDays(d, -7)] as const)),
    },
    {
      key: "bu-ay",
      label: thisMonth ? "Bu ay" : monthName(date),
      prevLabel: thisMonth ? "Geçen ay" : monthName(`${shiftMonth(date.slice(0, 7), -1)}-01`),
      curFrom: month[0],
      curTo: date,
      prevFrom: paired[0] ?? null,
      prevTo: paired.at(-1) ?? null,
      unpairedDays: month.length - paired.length,
      ...comparePairs(read, branches, monthPairs),
    },
    {
      key: "son-7",
      label: "Son 7 gün",
      prevLabel: "Önceki 7 gün",
      curFrom: last7[0],
      curTo: date,
      prevFrom: addDays(last7[0], -7),
      prevTo: addDays(date, -7),
      unpairedDays: 0,
      ...comparePairs(read, branches, last7.map((d) => [d, addDays(d, -7)] as const)),
    },
  ];
  return { day, days, periods };
}

/** Hapın "değişim yok" eşiği (GrowthPill'in nötr rengiyle aynı): %0,05'ten küçük değişim "→ %0,0" */
const FLAT = 0.0005;

const pctText = (g: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(g) * 100);

/** "↑ +%83,1" / "↓ %63,4" / "→ %0,0" (sahibin LafPOS Uzaktan'da beğendiği biçim; ok ve işaret, yalnız renge dayanmaz) */
export function changeText(g: number): string {
  const s = pctText(g);
  if (Math.abs(g) < FLAT) return `→ %${s}`;
  return g > 0 ? `↑ +%${s}` : `↓ %${s}`;
}

/** Hapın ekran okuyucu metni, changeText'le aynı eşikte: "artış %12,4", "düşüş %8,1", "değişim yok" */
export function changeSpeech(g: number): string {
  if (Math.abs(g) < FLAT) return "değişim yok";
  return `${g > 0 ? "artış" : "düşüş"} %${pctText(g)}`;
}

/** "+1.234 ₺" / "−1.234 ₺" */
export function diffText(v: number): string {
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Math.abs(Math.round(v)));
  return `${Math.round(v) > 0 ? "+" : Math.round(v) < 0 ? "−" : "±"}${s} ₺`;
}
