// Personel avansları (docs/PERSONEL-BELGE.md › Avans): src/lib/staff-advances.ts. Bakiye = verilen − maaştan düşülen;
// kesinti kalanı aşamaz, ileri tarih yazılmaz, kesintisi yazılmış avans silinmez. Avans gider değildir: maliyet
// hesabına girmez (kaynak taraması), yalnız "bu ay ele geçecek" tutarı değişir.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  advanceProblem,
  advanceTotals,
  balanceWarning,
  deductedInMonth,
  deleteProblem,
  payableThisMonth,
  totalsByStaff,
  withRunningBalance,
  type AdvanceRow,
} from "../src/lib/staff-advances";

const TODAY = "2026-11-26";
const row = (o: Partial<AdvanceRow> & { id: number }): AdvanceRow => ({ staffId: 1, date: "2026-11-01", kind: "avans", amount: 1000, ...o });

test("toplamlar ve kişi başı bakiye (kuruşa yuvarlı)", () => {
  const rows = [row({ id: 1, amount: 1500.1 }), row({ id: 2, kind: "kesinti", amount: 500.05 }), row({ id: 3, staffId: 2, amount: 300 })];
  assert.deepEqual(advanceTotals(rows), { given: 1800.1, deducted: 500.05, balance: 1300.05 });
  const by = totalsByStaff(rows);
  assert.deepEqual(by.get(1), { given: 1500.1, deducted: 500.05, balance: 1000.05 });
  assert.deepEqual(by.get(2), { given: 300, deducted: 0, balance: 300 });
  assert.equal(by.has(3), false, "hareketi olmayan kişi haritada yok");
  assert.deepEqual(advanceTotals([]), { given: 0, deducted: 0, balance: 0 });
});

test("hareketler eskiden yeniye, ardından kalan bakiye (aynı gün kimlik sırası)", () => {
  const rows = [row({ id: 3, date: "2026-11-10", kind: "kesinti", amount: 400 }), row({ id: 1, date: "2026-11-01", amount: 1000 }), row({ id: 2, date: "2026-11-10", amount: 200 })];
  assert.deepEqual(
    withRunningBalance(rows).map((r) => [r.id, r.balanceAfter]),
    [
      [1, 1000],
      [2, 1200],
      [3, 800],
    ],
  );
});

test("bu ay düşülen ve ele geçecek: net + ek ödeme − bu ay düşülen, eksiye inmez", () => {
  const rows = [row({ id: 1, date: "2026-10-05", kind: "kesinti", amount: 300 }), row({ id: 2, date: "2026-11-25", kind: "kesinti", amount: 2000 }), row({ id: 3, date: "2026-11-02", amount: 5000 })];
  assert.equal(deductedInMonth(rows, "2026-11"), 2000);
  assert.equal(deductedInMonth(rows, "2026-10"), 300);
  assert.equal(payableThisMonth(30000, 1500, 2000), 29500);
  assert.equal(payableThisMonth(1000, 0, 2000), 0);
});

test("yeni hareketin denetimi: tür, tutar, tarih, ileri tarih yok, kesinti kalanı aşamaz", () => {
  const ctx = { balance: 1000, today: TODAY };
  assert.equal(advanceProblem({ kind: "avans", amount: 500, date: TODAY }, ctx), null);
  assert.equal(advanceProblem({ kind: "kesinti", amount: 1000, date: TODAY }, ctx), null, "kalanın tamamı düşülebilir");
  assert.equal(advanceProblem({ kind: "kesinti", amount: 1000.01, date: TODAY }, ctx), "Kesinti kalan avansı aşamaz");
  assert.equal(advanceProblem({ kind: "kesinti", amount: 10, date: TODAY }, { balance: 0, today: TODAY }), "Bu kişinin kalan avansı yok; önce avansı yazın");
  assert.equal(advanceProblem({ kind: "x", amount: 10, date: TODAY }, ctx), "Hareket türü seçin");
  assert.equal(advanceProblem({ kind: "avans", amount: 0, date: TODAY }, ctx), "Tutar 0'dan büyük olmalı");
  assert.equal(advanceProblem({ kind: "avans", amount: Number.NaN, date: TODAY }, ctx), "Tutar 0'dan büyük olmalı");
  assert.equal(advanceProblem({ kind: "avans", amount: 20_000_000, date: TODAY }, ctx), "Tutar çok büyük");
  assert.equal(advanceProblem({ kind: "avans", amount: 10, date: "26.11.2026" }, ctx), "Tarih seçin");
  assert.equal(advanceProblem({ kind: "avans", amount: 10, date: "2026-11-27" }, ctx), "İleri tarihli hareket yazılamaz");
});

test("silme: kesinti her zaman; avans ancak sonraki bakiye hiçbir anda eksiye düşmüyorsa", () => {
  const rows = [row({ id: 1, date: "2026-11-01", amount: 1000 }), row({ id: 2, date: "2026-11-05", amount: 500 }), row({ id: 3, date: "2026-11-20", kind: "kesinti", amount: 1200 })];
  assert.equal(deleteProblem(rows, 3), null);
  assert.equal(deleteProblem(rows, 2), "Bu avansın kesintisi yazılmış; önce kesintiyi silin");
  assert.equal(deleteProblem(rows, 1), "Bu avansın kesintisi yazılmış; önce kesintiyi silin");
  assert.equal(deleteProblem([row({ id: 1, amount: 1000 }), row({ id: 2, amount: 500 }), row({ id: 3, kind: "kesinti", amount: 400, date: "2026-11-20" })], 2), null, "kalan avans kesintiyi karşılıyor");
  assert.equal(deleteProblem(rows, 99), "Hareket bulunamadı");
});

test("kalan bir aylık net maaşı aşarsa uyarı; part-time'da (maaşı yok) uyarı yok", () => {
  assert.equal(balanceWarning(30001, 30000), "Kalan avans bir aylık net maaşı aşıyor; tek maaştan düşülemez.");
  assert.equal(balanceWarning(30000, 30000), null);
  assert.equal(balanceWarning(5000, null), null);
  assert.equal(balanceWarning(5000, 0), null);
});

test("avans gider değildir: maliyet ve kâr-zarar hesapları avans tablosunu okumaz", () => {
  const root = process.cwd();
  for (const f of ["src/lib/calc/engine.ts", "src/server/data/dataset.ts", "src/lib/calc/insights.ts"]) {
    const src = readFileSync(join(root, f), "utf8");
    assert.doesNotMatch(src, /staffAdvances|staff_advances|staff-advances/, `${f} avansı okumamalı`);
  }
  // Silme koruması: avans hareketi olan kişi silinemez (Maaşlar), kişi silinince belge dosyaları da silinir
  const costs = readFileSync(join(root, "src/server/actions/costs.ts"), "utf8");
  assert.match(costs, /if \(advances\.get\(id\)\) throw new UserError\(`\$\{row\.name\} için avans hareketi var; silmek yerine ayrıldığı ayı \(bitiş ayı\) girin\.`\);/);
  assert.match(costs, /else if \(advances\.get\(row\.id\)\) out\[row\.id\] = "avans hareketi var";/);
  assert.match(costs, /await dropStaffDocFiles\(docKeys\);/);
});
