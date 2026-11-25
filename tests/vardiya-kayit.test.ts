// Vardiya: eski ekrandan kaydetme (denetim bulgusu 46, docs/VARDIYA.md › Veri). Kaydet her kutunun ekran açıldığındaki
// metnini (`seen`) taşır; yalnız bundan farklı kutular yazılır ya da silinir, arada başkasının değiştirdiği kutuyu
// değiştiren kayıt bütünüyle reddedilir. Saf fark burada; gerçek Postgres'te kayıt tests/vardiya-kayit-db.test.ts.
// Çalıştırma: npx tsx --test tests/vardiya-kayit.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseShiftCell, saveWeekSchema, SHIFT_STALE, staleText, weekSaveDiff, formatShiftCell, type ShiftCell, type ShiftEntry, type ShiftRow } from "../src/lib/vardiya";

const monday = "2026-11-23";
const cell = (text: string): ShiftCell | null => {
  const p = parseShiftCell(text);
  assert.ok(p.ok, `${text}: ${p.ok ? "" : p.error}`);
  return p.cell;
};
const week = (texts: string[]) => texts.map(cell);
const row = (ref: string, name: string, texts: string[], userId: number | null = null): ShiftRow => ({ ref, userId, name, cells: week(texts) });
const entry = (date: string, ref: string, name: string, text: string, userId: number | null = null): ShiftEntry => ({ date, ref, userId, name, cell: cell(text)! });
const E = ["", "", "", "", "", "", ""];

test("A'nın eski ekranı: dokunmadığı kutu (B'nin değiştirdiği Salı, B'nin eklediği Çarşamba) yerinde kalır", () => {
  // A haftayı açtığında Ayşe: Pzt 10-18, Sal 10-18. Sonra B Salı'yı izin yaptı, Çarşamba'ya 12-20 ekledi.
  const seenByA = new Map([["u:1", week(["10-18", "10-18", "", "", "", "", ""])]]);
  const db = [entry("2026-11-23", "u:1", "Ayşe", "10-18", 1), entry("2026-11-24", "u:1", "Ayşe", "izin", 1), entry("2026-11-25", "u:1", "Ayşe", "12-20", 1)];
  // A yalnız Perşembe'ye 16-01 yazıp kaydeder; ekranında Salı hâlâ 10-18, Çarşamba boş
  const next = [row("u:1", "Ayşe", ["10-18", "10-18", "", "16-01", "", "", ""], 1)];
  const diff = weekSaveDiff(db, next, seenByA, monday);
  assert.deepEqual(diff.stale, []);
  assert.deepEqual(
    diff.upserts.map((u) => `${u.date} ${formatShiftCell(u.cell)}`),
    ["2026-11-26 16:00–01:00"],
  );
  // Çarşamba silinmez (A boş görmüştü, boş bıraktı), Salı geri yazılmaz
  assert.deepEqual(diff.deletes, []);
});

test("A'nın değiştirdiği kutuyu arada B de değiştirdiyse kayıt reddedilir; ikisi aynı şeyi yazdıysa çakışma yok", () => {
  const seenByA = new Map([["u:1", week(["10-18", "10-18", "", "", "", "", ""])]]);
  const db = [entry("2026-11-23", "u:1", "Ayşe", "10-18", 1), entry("2026-11-24", "u:1", "Ayşe", "izin", 1)];
  // A Salı'yı 12-20 yapar; B izin yapmıştı
  const clash = weekSaveDiff(db, [row("u:1", "Ayşe", ["10-18", "12-20", "", "", "", "", ""], 1)], seenByA, monday);
  assert.deepEqual(clash.stale, [{ name: "Ayşe", day: 1 }]);
  assert.equal(staleText(clash.stale), "Plan siz bakarken değişti (Ayşe, Salı), sayfayı yenileyin.");
  // A da izin yazdıysa: veritabanı zaten öyle, yazılacak bir şey yok
  const same = weekSaveDiff(db, [row("u:1", "Ayşe", ["10-18", "izin", "", "", "", "", ""], 1)], seenByA, monday);
  assert.deepEqual(same, { upserts: [], deletes: [], stale: [] });
  // A Salı'yı boşaltır, B izin yapmıştı: B'nin izni sessizce silinmez
  const cleared = weekSaveDiff(db, [row("u:1", "Ayşe", ["10-18", "", "", "", "", "", ""], 1)], seenByA, monday);
  assert.deepEqual(cleared.stale, [{ name: "Ayşe", day: 1 }]);
  // Birden çok kutu: ilki adıyla, kalanı sayıyla
  assert.equal(staleText([{ name: "Ayşe", day: 1 }, { name: "Ali", day: 4 }, { name: "Ali", day: 5 }]), "Plan siz bakarken değişti (Ayşe, Salı ve 2 kutu daha), sayfayı yenileyin.");
  assert.equal(staleText([]), SHIFT_STALE);
});

test("değişmeyen planda: değiştirilen kutu yazılır, boşaltılan silinir, dokunulmayan ad yenilemesi yapılmaz", () => {
  const seen = new Map([["u:1", week(["10-18 kasa", "10-18", "izin", "", "", "", ""])]]);
  const db = [entry("2026-11-23", "u:1", "Ayşe", "10-18 kasa", 1), entry("2026-11-24", "u:1", "Ayşe", "10-18", 1), entry("2026-11-25", "u:1", "Ayşe", "izin", 1)];
  const diff = weekSaveDiff(db, [row("u:1", "Ayşe Yılmaz", ["11-19 kasa", "10-18", "", "", "", "", ""], 1)], seen, monday);
  assert.deepEqual(diff.stale, []);
  // Ad değişti: yalnız değiştirilen Pazartesi yeni adla yazılır; Salı'ya dokunulmaz
  assert.deepEqual(
    diff.upserts.map((u) => `${u.date} ${u.name} ${formatShiftCell(u.cell)}`),
    ["2026-11-23 Ayşe Yılmaz 11:00–19:00 · kasa"],
  );
  assert.deepEqual(diff.deletes, [{ date: "2026-11-25", ref: "u:1" }]);
});

test("bu oturumda eklenen satır boş görülmüş sayılır: arada başkası aynı kişiyi yazdıysa red", () => {
  const db = [entry("2026-11-23", "n:can", "Can", "09-18")];
  const next = [row("n:can", "Can", ["10-18", "", "", "", "", "", ""])];
  assert.deepEqual(weekSaveDiff(db, next, new Map(), monday).stale, [{ name: "Can", day: 0 }]);
  // Kimse yazmadıysa yazılır
  const fresh = weekSaveDiff([], next, new Map([["n:can", week(E)]]), monday);
  assert.deepEqual(fresh.upserts.map((u) => u.date), ["2026-11-23"]);
});

test("girdi şeması: `seen` yedi kutu ister; eski sekme (seen yok) yenileme metniyle reddedilir", () => {
  const base = { branchId: "tuzla", week: monday };
  assert.ok(saveWeekSchema.safeParse({ ...base, rows: [{ ref: "u:1", name: "Ayşe", cells: E, seen: E }] }).success);
  const old = saveWeekSchema.safeParse({ ...base, rows: [{ ref: "u:1", name: "Ayşe", cells: E }] });
  assert.equal(old.success, false);
  assert.equal(old.error?.issues[0]?.message, SHIFT_STALE);
  const short = saveWeekSchema.safeParse({ ...base, rows: [{ ref: "u:1", name: "Ayşe", cells: E, seen: E.slice(1) }] });
  assert.equal(short.error?.issues[0]?.message, SHIFT_STALE);
});
