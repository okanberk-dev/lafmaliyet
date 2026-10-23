// Geç girilen gider faturalarının kimlik taraması (src/server/parasut/late-bills.ts): tarama birden çok çalışmaya
// yayılır, kaldığı yerden sürer; sayfalar yeni faturayla aşağı, silinenle yukarı kayar; Paraşüt'e sorulamayan fatura
// taramayı birkaç çalışma tutar, sonra geçilir. Paraşüt'süz ve veritabanısız: liste bellekte.
// Çalıştırma: npx tsx --test tests/parasut-gec-fatura.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { LATE_HOLD_RUNS, parseLateCursor, runLateScan, type LateCursor } from "../src/server/parasut/late-bills";

const SIZE = 25;

/** Kimliğe göre azalan, 25'erli sayfalanan bellekteki Paraşüt listesi */
class List {
  ids = new Set<number>();
  reads: number[] = [];
  add(...ns: number[]) {
    for (const n of ns) this.ids.add(n);
  }
  range(from: number, to: number) {
    for (let n = from; n <= to; n++) this.ids.add(n);
  }
  read = async (page: number) => {
    this.reads.push(page);
    const sorted = [...this.ids].sort((a, b) => b - a);
    return { bills: sorted.slice((page - 1) * SIZE, page * SIZE).map((n) => ({ n, bill: n })), totalPages: Math.max(1, Math.ceil(sorted.length / SIZE)) };
  };
}

/** Bir çalışma: yazılanlar `applied`a düşer; `defer` true dönen kimlik bu çalışmada yazılamaz */
async function day(list: List, cursor: LateCursor | null, applied: number[], defer: (n: number) => boolean = () => false) {
  list.reads = [];
  const r = await runLateScan<number>(
    cursor,
    {
      read: list.read,
      apply: async (n) => {
        if (defer(n)) return "deferred";
        applied.push(n);
      },
    },
    { pages: 4, until: Number.POSITIVE_INFINITY },
  );
  return { ...r, next: r.save ?? cursor };
}

test("ilk çalışma yalnız en büyük kimliği kaydeder, sonra sınıra kadar okunur", async () => {
  const list = new List();
  list.range(1, 301);
  const applied: number[] = [];
  let r = await day(list, null, applied);
  assert.deepEqual(r.save, { id: 301 });
  assert.deepEqual(applied, [], "eski faturalar alınmaz");
  list.add(302, 303);
  r = await day(list, r.next, applied);
  assert.deepEqual(applied, [303, 302]);
  assert.deepEqual(r.save, { id: 303 });
  assert.equal(r.complete, true);
  // Yeni fatura yokken imleç yazılmaz
  r = await day(list, r.next, applied);
  assert.equal(r.save, null);
  assert.deepEqual(list.reads, [1]);
});

test("100'den fazla yeni fatura: tarama kaldığı yerden sürer (eskiden her sabah aynı 4 sayfa okunuyordu)", async () => {
  const list = new List();
  list.range(1, 301);
  list.range(302, 422);
  const applied: number[] = [];
  let r = await day(list, { id: 301 }, applied);
  assert.equal(r.complete, false);
  assert.deepEqual(r.save, { id: 301, scan: { top: 422, page: 4, edge: 323 } });
  assert.equal(applied.length, 100);
  // Bu arada 10 yeni fatura: sayfalar aşağı kayar, işlenmişler atlanır; yeniler sonraki taramanın
  list.range(423, 432);
  r = await day(list, r.next, applied);
  assert.deepEqual(r.save, { id: 422 });
  assert.deepEqual(applied.slice(100), [322, 321, 320, 319, 318, 317, 316, 315, 314, 313, 312, 311, 310, 309, 308, 307, 306, 305, 304, 303, 302]);
  r = await day(list, r.next, applied);
  assert.deepEqual(r.save, { id: 432 });
  assert.equal(new Set(applied).size, applied.length, "hiçbir fatura iki kez yazılmadı");
  assert.equal(applied.length, 131);
});

test("silinen faturalar sayfaları yukarı kaydırır: önceki sayfaya dönülür, işlenmemiş fatura atlanmaz", async () => {
  const list = new List();
  list.range(1, 422);
  const applied: number[] = [];
  let r = await day(list, { id: 301 }, applied);
  assert.deepEqual(r.save?.scan, { top: 422, page: 4, edge: 323 });
  for (let n = 330; n < 360; n++) list.ids.delete(n);
  r = await day(list, r.next, applied);
  assert.deepEqual(list.reads, [4, 3, 4], "4. sayfanın ilk kimliği (317) işlenmişlerden küçük: 3. sayfaya dönüldü");
  assert.deepEqual(applied.slice(100, 105), [322, 321, 320, 319, 318]);
  assert.deepEqual(r.save, { id: 422 });
  assert.deepEqual([...list.ids].filter((n) => n > 301 && !applied.includes(n)), [], "duran her yeni fatura yazıldı");
});

test("liste kaydedilen sayfadan kısa kaldı: boş sayfadan doğrudan son sayfaya dönülür, tarama birkaç çalışmada biter", async () => {
  const list = new List();
  list.range(1, 400);
  const applied: number[] = [];
  let r = await day(list, { id: 10 }, applied);
  r = await day(list, r.next, applied);
  assert.deepEqual(r.save?.scan, { top: 400, page: 7, edge: 226 });
  for (let n = 100; n <= 390; n++) list.ids.delete(n);
  r = await day(list, r.next, applied);
  assert.deepEqual(list.reads, [7, 5, 4, 3], "7. sayfa boş: 5 sayfalık listenin sonuna, sonra geriye");
  assert.equal(r.complete, false);
  for (let i = 0; i < 3 && !r.complete; i++) r = await day(list, r.next, applied);
  assert.deepEqual(r.save, { id: 400 });
  assert.deepEqual([...list.ids].filter((n) => n > 10 && !applied.includes(n)), [], "duran her yeni fatura yazıldı");
  assert.equal(new Set(applied).size, applied.length, "hiçbir fatura iki kez yazılmadı");
});

test("Paraşüt'e sorulamayan fatura taramayı tutar; sonraki çalışmada yazılır, art arda yazılamazsa geçilir", async () => {
  const list = new List();
  list.range(1, 310);
  const applied: number[] = [];
  let tries = 0;
  // 305 bir kez yazılamaz: tarama 305'te durur, sınır ilerlemez
  let r = await day(list, { id: 300 }, applied, (n) => n === 305 && tries++ === 0);
  assert.deepEqual(applied, [310, 309, 308, 307, 306]);
  assert.deepEqual(r.save, { id: 300, scan: { top: 310, page: 1, edge: 306, held: { id: 305, runs: 1 } } });
  r = await day(list, r.next, applied, (n) => n === 305 && tries++ === 0);
  assert.deepEqual(applied.slice(5), [305, 304, 303, 302, 301]);
  assert.deepEqual(r.save, { id: 310 });
  // 315 hiç yazılamıyor: LATE_HOLD_RUNS çalışmadan sonra geçilir, tarama takılı kalmaz
  list.range(311, 316);
  const never = (n: number) => n === 315;
  for (let i = 1; i < LATE_HOLD_RUNS; i++) {
    r = await day(list, r.next, applied, never);
    assert.deepEqual(r.save?.scan?.held, { id: 315, runs: i });
    assert.equal(r.save?.id, 310);
  }
  r = await day(list, r.next, applied, never);
  assert.deepEqual(r.passed, [315]);
  assert.deepEqual(r.save, { id: 316 });
  assert.deepEqual(applied.slice(10), [316, 314, 313, 312, 311]);
});

test("rastgele günler: girilen, silinen, ertelenen faturalarla tarama sonunda duran her yeni faturayı yazar", async () => {
  // Basit, tekrarlanabilir sözde rastgele sayı üreteci (mulberry32)
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let seed = 1; seed <= 40; seed++) {
    const rnd = random(seed);
    const list = new List();
    list.range(1, 300);
    let next = 301;
    let cursor: LateCursor | null = { id: 300 };
    const applied: number[] = [];
    for (let d = 0; d < 90; d++) {
      // Taramalar birkaç çalışmaya yayılsın (günde 150'ye kadar fatura), silmeler çoğunlukla yeni faturalardan
      if (d < 25) {
        const add = Math.floor(rnd() * 150);
        for (let i = 0; i < add; i++) list.add(next++);
        const del = Math.floor(rnd() * 40);
        const pool = [...list.ids].filter((n) => n > 300 || rnd() < 0.05);
        for (let i = 0; i < del; i++) list.ids.delete(pool[Math.floor(rnd() * pool.length)]);
      }
      // İlk 25 günde faturaların bir kısmı o gün yazılamaz; sonra her şey yazılır
      const r = await day(list, cursor, applied, (n) => d < 25 && (n * 7 + d) % 13 === 0);
      cursor = r.next;
    }
    const missing = [...list.ids].filter((n) => n > 300 && !applied.includes(n));
    assert.deepEqual(missing, [], `tohum ${seed}: duran her yeni fatura yazıldı`);
    assert.deepEqual(cursor, { id: Math.max(...list.ids) }, `tohum ${seed}: tarama bitti`);
  }
});

test("süre dolunca okunan sayfalar yazılır, kalınan yer saklanır; hiç okunamadıysa imleç değişmez", async () => {
  const list = new List();
  list.range(1, 400);
  const applied: number[] = [];
  const timed = (limit: number) => {
    let reads = 0;
    return (page: number) => (reads++ < limit ? list.read(page) : Promise.resolve(null));
  };
  let r = await runLateScan<number>({ id: 300 }, { read: timed(2), apply: async (n) => void applied.push(n) }, { pages: 4, until: Number.POSITIVE_INFINITY });
  assert.deepEqual(r.save, { id: 300, scan: { top: 400, page: 2, edge: 351 } });
  assert.equal(applied.length, 50);
  r = await runLateScan<number>(r.save, { read: timed(0), apply: async (n) => void applied.push(n) }, { pages: 4, until: Number.POSITIVE_INFINITY });
  assert.equal(r.save, null);
  r = await runLateScan<number>({ id: 300 }, { read: timed(0), apply: async (n) => void applied.push(n) }, { pages: 4, until: Number.POSITIVE_INFINITY });
  assert.equal(r.save, null);
  r = await runLateScan<number>(null, { read: timed(0), apply: async (n) => void applied.push(n) }, { pages: 4, until: Number.POSITIVE_INFINITY });
  assert.deepEqual([r.save, r.complete], [null, false]);
});

test("saklanan imleç: eski biçim aynen okunur, bozuk tarama düşer", () => {
  assert.deepEqual(parseLateCursor({ id: 301, at: "2026-10-22T05:00:00.000Z" }), { id: 301 });
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 4, edge: 323 } }), { id: 301, scan: { top: 422, page: 4, edge: 323 } });
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 4, edge: 323, held: { id: 322, runs: 2 } } }), {
    id: 301,
    scan: { top: 422, page: 4, edge: 323, held: { id: 322, runs: 2 } },
  });
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 0, edge: 323 } }), { id: 301 }, "sayfa 0");
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 2, edge: 301 } }), { id: 301 }, "sınırın altında");
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 200, page: 2, edge: 201 } }), { id: 301 }, "sınırdan küçük tepe");
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 2, edge: 424 } }), { id: 301 });
  assert.deepEqual(parseLateCursor({ id: 301, scan: { top: 422, page: 2, edge: 323, held: { id: 5, runs: 0 } } }), { id: 301, scan: { top: 422, page: 2, edge: 323 } });
  assert.equal(parseLateCursor({ id: "301" }), null);
  assert.equal(parseLateCursor(null), null);
  assert.equal(parseLateCursor({ id: 1.5 }), null);
});
