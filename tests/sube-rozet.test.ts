// Genel bakış'ın aydan aya rozetleri "Tümü"de aynı şubelerle (denetim bulgusu 65; src/lib/same-branches.ts,
// docs/SUBE.md › Aydan aya rozetler): yeni açılan şube büyüme sayılmaz.
// Çalıştırma: npx tsx --test tests/sube-rozet.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Month } from "../src/lib/calc/types";
import { sameBranchBasis, type BranchOpening } from "../src/lib/same-branches";

const plain = (s: string) => s.replace(/ /g, " ");
const m = (month: string, posRevenue: number, openDays: number): Month => ({ month, openDays, posRevenue, discounts: 0, offRevenue: 0, note: null });
/** "Tümü"nün ayı: şubelerin toplamı ve şube kırılımı */
const all = (month: string, parts: Record<string, [number, number]>): Month => {
  const byBranch = Object.fromEntries(Object.entries(parts).map(([id, [pos, days]]) => [id, m(month, pos, days)]));
  const pos = Object.values(parts).reduce((a, [p]) => a + p, 0);
  return { ...m(month, pos, Math.max(...Object.values(parts).map(([, d]) => d))), byBranch };
};
const TUZLA: BranchOpening = { id: "tuzla", name: "Tuzla", openedOn: null };
const MARINA: BranchOpening = { id: "marina", name: "Marina", openedOn: "2026-11-13" };

// Ekim yalnız Tuzla; Marina 13 Kasım'da açıldı (18 gün); Aralık iki şube tam ay
const info = new Map<string, Month>([
  ["2026-10", all("2026-10", { tuzla: [300_000, 31] })],
  ["2026-11", all("2026-11", { tuzla: [306_000, 30], marina: [180_000, 18] })],
  ["2026-12", all("2026-12", { tuzla: [310_000, 31], marina: [310_000, 31] })],
  ["2027-01", all("2027-01", { tuzla: [320_000, 31], marina: [320_000, 31] })],
]);

test("Kasım'ın Ekim'e göre rozeti: Marina kıyas dışı, POS cirosu ve günlük ortalama yalnız Tuzla'yla (bulgu 65)", () => {
  // Toplamlarla "+%62" derdi (486.000 / 300.000); Tuzla %2 arttı
  const s = sameBranchBasis(info, "2026-11", [TUZLA, MARINA]);
  assert.ok(s, "yeni şube var: aynı şubeler temeli");
  assert.deepEqual(s.fresh.map((f) => [f.id, plain(f.since)]), [["marina", "13 Kasım'da"]]);
  assert.deepEqual(s.kept, ["Tuzla"]);
  assert.deepEqual(s.pos, { cur: 306_000, prev: 300_000, growth: 0.02 });
  assert.equal(s.daily!.cur, 306_000 / 30);
  assert.equal(s.daily!.prev, 300_000 / 31);
  assert.equal(plain(s.note), " Rozet: Ekim 2026 ayına göre yalnız iki ayda da açık şubelerle (Tuzla); Marina 13 Kasım'da açıldı, kıyas dışı.");
  assert.match(plain(s.noBadge), /^ Rozet yok: Marina 13 Kasım'da açıldı; bu rakam şubeye bölünmediği için Ekim 2026 ayıyla/);
});

test("Aralık'ın Kasım'a göre rozeti: Marina'nın yarım Kasım'ı büyüme sayılmaz; Ocak'ta iki şube de kıyaslanır", () => {
  const dec = sameBranchBasis(info, "2026-12", [TUZLA, MARINA]);
  assert.ok(dec, "Marina önceki ayın 1'inden sonra açıldı");
  assert.deepEqual(dec.kept, ["Tuzla"]);
  assert.equal(dec.pos!.growth, (310_000 - 306_000) / 306_000);
  // Ocak: Marina Kasım'da açıldı, Aralık tam ay: iki ay aynı şubeler, rozet bugünkü gibi (null)
  assert.equal(sameBranchBasis(info, "2027-01", [TUZLA, MARINA]), null);
});

test("açılış günü yazılmamışsa yeni şube ilk verisinin ayından tanınır; Tuzla hep eski; şube görünümünde (kırılım yok) temel yok", () => {
  const unset = { ...MARINA, openedOn: null };
  const s = sameBranchBasis(info, "2026-11", [TUZLA, unset]);
  assert.deepEqual(s?.fresh.map((f) => [f.id, f.since]), [["marina", "Kasım'da"]]);
  assert.equal(sameBranchBasis(info, "2026-12", [TUZLA, unset])?.fresh[0]?.id, "marina", "ilk ayı önceki ay: yarım ay");
  assert.equal(sameBranchBasis(info, "2027-01", [TUZLA, unset]), null);
  // Şube listesi okunamadıysa da (boş) ilk veriden
  assert.equal(sameBranchBasis(info, "2026-11", [])?.fresh[0]?.name, "marina");
  // Tek şube seçiliyken ay bilgisinde şube kırılımı yok
  const branchView = new Map([["2026-11", m("2026-11", 180_000, 18)]]);
  assert.equal(sameBranchBasis(branchView, "2026-11", [TUZLA, MARINA]), null);
  // Yalnız yeni şube varsa kıyaslanacak şube yok: değer yok, not söyler
  const onlyNew = new Map([["2026-11", all("2026-11", { marina: [180_000, 18] })]]);
  const s2 = sameBranchBasis(onlyNew, "2026-11", [TUZLA, MARINA]);
  assert.equal(s2?.pos, null);
  assert.match(plain(s2!.note), /^ Rozet yok: Marina 13 Kasım'da açıldı/);
});
