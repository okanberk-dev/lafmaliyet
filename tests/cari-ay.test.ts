// Cari işlemlerinin aylara etkisi (src/lib/cari/months.ts): geçmiş ay onayı (bugünün ayı onay istemez, önceki ay
// ister; sunucunun denetimi ve işlem geçmişinin eki) ve "Faturası geldi" önizlemesinin metni.
// Çalıştırma: npx tsx --test tests/cari-ay.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { linkPreview, missingPastConfirm, pastMonthConfirmText, pastMonthEffects, pastMonthLogSuffix, pastMonthText, yearGenitive } from "../src/lib/cari/months";

const plain = (s: string) => s.replace(/ /g, " ");

test("geçmiş ay: bugünün ayı onay istemez, önceki aylar ay ay toplanır", () => {
  const today = "2026-10-24";
  assert.deepEqual(pastMonthEffects([{ date: "2026-10-01", delta: -600 }], today), []);
  assert.deepEqual(pastMonthEffects([{ date: "2026-11-02", delta: 100 }], today), [], "ileri ay da onay istemez");
  const effects = pastMonthEffects(
    [
      { date: "2026-09-30", delta: -1200 },
      { date: "2026-08-03", delta: 300 },
      { date: "2026-09-02", delta: 0 },
      { date: "2026-07-10", delta: 500 },
      { date: "2026-07-11", delta: -500 },
    ],
    today,
  );
  assert.deepEqual(effects, [
    { month: "2026-08", delta: 300 },
    { month: "2026-09", delta: -1200 },
  ]);
  assert.equal(plain(pastMonthText(effects[1])), "Eylül 2026 gideri 1.200,00 ₺ azalır (geçmiş ay)");
  assert.equal(plain(pastMonthText(effects[0])), "Ağustos 2026 gideri 300,00 ₺ artar (geçmiş ay)");
  assert.equal(pastMonthConfirmText([effects[1]]), "Eylül 2026'nın kapanmış rakamlarının değişeceğini biliyorum");
  assert.equal(missingPastConfirm(effects, ["2026-08", "2026-09"]), null);
  assert.equal(missingPastConfirm([effects[1]], ["2026-08"]), "Bu değişiklik Eylül 2026 giderini değiştirir; onaylayın");
  assert.equal(missingPastConfirm([], null), null);
  assert.equal(pastMonthLogSuffix([effects[1]]), " · geçmiş ay değişti: Eylül 2026");
  assert.equal(pastMonthLogSuffix([]), "");
});

test("yılın -in hâli", () => {
  assert.deepEqual(
    [2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2040, 2000].map(yearGenitive),
    ["2021'in", "2022'nin", "2023'ün", "2024'ün", "2025'in", "2026'nın", "2027'nin", "2028'in", "2029'un", "2030'un", "2040'ın", "2000'in"],
  );
});

test("Faturası geldi önizlemesi (§5.2 metni aynen)", () => {
  assert.equal(
    plain(
      linkPreview({
        removed: [{ date: "2026-10-21", amount: 600, categoryName: "Nakit malzeme alımı" }],
        invoice: { date: "2026-11-03", net: 545.45, vat: 54.55, payable: 600, goods: true },
        debtTotal: 600,
        today: "2026-11-05",
      }),
    ),
    "Ekim gideri −600,00 ₺ (Nakit malzeme alımı), Kasım mal alışı faturada 545,45 ₺ (KDV hariç; zaten sayılıyor) · KDV tahmini Kasım +54,55 ₺ · fark faturada +0,00 ₺",
  );
  // Faturası gelecek borç: silinen gider yok; fatura tutarı farklı
  assert.equal(
    plain(
      linkPreview({
        removed: [],
        invoice: { date: "2026-10-28", net: 1136.36, vat: 113.64, payable: 1250, goods: true },
        debtTotal: 1260,
        today: "2026-10-28",
      }),
    ),
    "Ekim mal alışı faturada 1.136,36 ₺ (KDV hariç; zaten sayılıyor) · KDV tahmini Ekim +113,64 ₺ · fark faturada −10,00 ₺",
  );
  // Başka yılın ayı yılıyla; aynı ay ve kategorinin giderleri tek parça
  assert.equal(
    plain(
      linkPreview({
        removed: [
          { date: "2025-12-02", amount: 100, categoryName: "Nakit malzeme alımı" },
          { date: "2025-12-20", amount: 50, categoryName: "Nakit malzeme alımı" },
        ],
        invoice: { date: "2026-01-04", net: 136.36, vat: 13.64, payable: 150, goods: false },
        debtTotal: 150,
        today: "2026-01-10",
      }),
    ),
    "Aralık 2025 gideri −150,00 ₺ (Nakit malzeme alımı), Ocak gideri faturada 136,36 ₺ (KDV hariç; zaten sayılıyor) · KDV tahmini Ocak +13,64 ₺ · fark faturada +0,00 ₺",
  );
});

test("Faturası geldi önizlemesi: KDV tahmininin saydığı KDV (tevkifatlı faturada) ve giderde sayılmayan kategori", () => {
  // Hizmet faturası: net 1.000, KDV 200, 5/10 tevkifat, Ödenecek 1.100
  assert.equal(
    plain(
      linkPreview({
        removed: [],
        invoice: { date: "2026-10-28", net: 1000, vat: 200, withheld: 100, payable: 1100, goods: false, counted: true },
        debtTotal: 1100,
        today: "2026-10-28",
      }),
    ),
    "Ekim gideri faturada 1.000,00 ₺ (KDV hariç; zaten sayılıyor) · KDV tahmini Ekim +200,00 ₺ (tevkifat 100,00 ₺, 2 No.lu beyannamede) · fark faturada +0,00 ₺",
  );
  assert.equal(
    plain(
      linkPreview({
        removed: [{ date: "2026-10-05", amount: 600, categoryName: "Nakit malzeme alımı" }],
        invoice: { date: "2026-10-20", net: 545.45, vat: 54.55, payable: 600, goods: false, counted: false },
        debtTotal: 600,
        today: "2026-10-28",
      }),
    ),
    "Ekim gideri −600,00 ₺ (Nakit malzeme alımı), Ekim faturası 545,45 ₺ (KDV hariç) Gelir-gider'de hiçbir kalemde sayılmıyor; bağlarsanız bu alımın gideri düşer · KDV tahmini Ekim +54,55 ₺ · fark faturada +0,00 ₺",
  );
});
