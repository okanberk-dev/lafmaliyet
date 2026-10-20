// Sabit gider / personel ekranlarının "hangi aydan itibaren?" kuralları ve metinleri.
// Çalıştırma: npx tsx --test tests/giderler-history.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  amountChangeText,
  choiceMonths,
  choiceValue,
  closedDataMonths,
  entryAt,
  monthsBetween,
  periodAmount,
  rangeText,
  resumePlan,
  resumeText,
  spanText,
  staffDeleteBlocker,
  startText,
  stopText,
} from "../src/app/panel/giderler/history-text";

const CUR = "2026-10";
const CLOSED = ["2026-07", "2026-08", "2026-09"];

test("choiceValue: bu ay, seçilen ay, bütün aylar", () => {
  assert.equal(choiceValue({ mode: "current", month: "2026-12" }, CUR), "2026-10");
  assert.equal(choiceValue({ mode: "month", month: "2026-11" }, CUR), "2026-11");
  assert.equal(choiceValue({ mode: "all", month: "2026-11" }, CUR), "all");
});

test("spanText / rangeText / monthsBetween", () => {
  assert.equal(spanText(["2026-09", "2026-07", "2026-08"]), "Temmuz–Eylül 2026");
  assert.equal(spanText(["2026-12", "2027-01"]), "Aralık 2026 – Ocak 2027");
  assert.equal(spanText(["2026-09"]), "Eylül 2026");
  assert.equal(spanText([]), "");
  assert.equal(rangeText({ startMonth: null, endMonth: null }), "Baştan beri");
  assert.equal(rangeText({ startMonth: "2026-10", endMonth: null }), "Ekim 2026 ve sonrası");
  assert.equal(rangeText({ startMonth: "2026-07", endMonth: "2026-09" }), "Temmuz–Eylül 2026");
  assert.equal(rangeText({ startMonth: null, endMonth: "2026-09" }), "Eylül 2026 sonuna kadar");
  assert.deepEqual(monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsBetween("2026-11", "2026-10"), []);
});

test("closedDataMonths: açık gün ya da elle giriş olan, bu aydan önceki aylar (sunucu kuralı)", () => {
  const ds = {
    months: [
      { month: "2026-07", openDays: 23 },
      { month: "2026-08", openDays: 31 },
      { month: "2026-09", openDays: 30 },
      { month: "2026-10", openDays: 16 },
      { month: "2026-06", openDays: 0 },
      { month: "2026-05", openDays: null },
    ],
    pnlEntries: [{ month: "2026-04" }, { month: "2026-10" }],
  };
  assert.deepEqual(closedDataMonths(ds, CUR), ["2026-04", "2026-07", "2026-08", "2026-09"]);
});

test("choiceMonths: verisi olan ilk aydan (en çok 12 ay geri) 12 ay sonrasına", () => {
  const list = choiceMonths(CUR, "2026-07");
  assert.equal(list[0], "2026-07");
  assert.equal(list[list.length - 1], "2027-10");
  assert.ok(list.includes(CUR));
  // Çok eski veri: en fazla 12 ay geri
  assert.equal(choiceMonths(CUR, "2020-01")[0], "2025-10");
  // Veri yok: 12 ay geriden
  assert.equal(choiceMonths(CUR, null)[0], "2025-10");
  // Alt sınır (ör. bitiş ayından sonrası)
  assert.equal(choiceMonths(CUR, "2026-07", "2026-09")[0], "2026-09");
});

test("periodAmount: dönemle birlikte, küçük tutarda kuruş", () => {
  assert.equal(periodAmount("aylik", 160000), "160.000 ₺/ay");
  assert.equal(periodAmount("gunluk", 330), "330 ₺/gün");
  assert.equal(periodAmount("yillik", 50), "50,00 ₺/yıl");
  assert.equal(periodAmount("haftalik", 0), "0 ₺/hafta");
});

test("amountChangeText: bu aydan itibaren zam, önceki aylar korunur", () => {
  const e = amountChangeText({
    choice: CUR,
    currentMonth: CUR,
    closed: CLOSED,
    range: { startMonth: null, endMonth: null },
    before: "160.000 ₺/ay",
    after: "175.000 ₺/ay",
    versions: [],
  });
  assert.match(e.text, /^Ekim 2026 ve sonrasında 175\.000 ₺\/ay; öncesi eski tutarla \(160\.000 ₺\/ay\) kalır\.$/);
  assert.equal(e.warn, null);
});

test("amountChangeText: geçmiş bir aydan itibaren kapanmış aylar için uyarı; sonraki değişikliğe kadar", () => {
  const e = amountChangeText({
    choice: "2026-08",
    currentMonth: CUR,
    closed: CLOSED,
    range: { startMonth: null, endMonth: null },
    before: "160.000 ₺/ay",
    after: "170.000 ₺/ay",
    versions: [{ fromMonth: "2026-09", label: "175.000 ₺/ay" }],
  });
  assert.match(e.text, /Eylül 2026 değişikliği \(175\.000 ₺\/ay\) yerinde kalır/);
  // Yalnızca Ağustos etkilenir: Eylül'den itibaren kayıtlı değişiklik geçerli
  assert.equal(e.warn, "Kapanmış Ağustos 2026 kâr/zararı da değişir.");
});

test("amountChangeText: bütün aylar düzeltmesi geçmişi değiştirir ve değişiklikleri siler", () => {
  const e = amountChangeText({
    choice: "all",
    currentMonth: CUR,
    closed: CLOSED,
    range: { startMonth: null, endMonth: null },
    before: "160.000 ₺/ay",
    after: "150.000 ₺/ay",
    versions: [{ fromMonth: "2026-11", label: "175.000 ₺/ay" }],
  });
  assert.match(e.text, /Bütün aylarda 150\.000 ₺\/ay olur/);
  assert.match(e.text, /Kayıtlı 1 tutar değişikliği silinir/);
  assert.equal(e.warn, "Temmuz–Eylül 2026 kâr/zararı da değişir.");
  // Kalem kapanmış aylarda yoksa uyarı yok
  const fresh = amountChangeText({ ...{ choice: "all", currentMonth: CUR, closed: CLOSED, before: "a", after: "b", versions: [] }, range: { startMonth: CUR, endMonth: null } });
  assert.equal(fresh.warn, null);
});

test("amountChangeText: bu ay başlayan kalemde yeni tutar baştan geçerli", () => {
  const e = amountChangeText({
    choice: CUR,
    currentMonth: CUR,
    closed: CLOSED,
    range: { startMonth: CUR, endMonth: null },
    before: "1.000 ₺/ay",
    after: "1.500 ₺/ay",
    versions: [],
  });
  assert.equal(e.text, "Kalem Ekim 2026 başladığı için yeni tutar (1.500 ₺/ay) baştan geçerli.");
  // Gelecek bir aydan itibaren değişiklik: "öncesi eski tutarla"
  const later = amountChangeText({ choice: "2026-11", currentMonth: CUR, closed: CLOSED, range: { startMonth: CUR, endMonth: null }, before: "1.000 ₺/ay", after: "1.500 ₺/ay", versions: [] });
  assert.match(later.text, /^Kasım 2026 ve sonrasında 1\.500 ₺\/ay; öncesi eski tutarla/);
});

test("startText: yeni kalem bu aydan, geçmiş aydan ya da baştan beri", () => {
  assert.equal(startText({ choice: CUR, currentMonth: CUR, closed: CLOSED, what: "gider" }).warn, null);
  assert.equal(startText({ choice: "2026-09", currentMonth: CUR, closed: CLOSED, what: "gider" }).warn, "Kapanmış Eylül 2026 kâr/zararına da eklenir.");
  const all = startText({ choice: "all", currentMonth: CUR, closed: CLOSED, what: "personel" });
  assert.equal(all.text, "Baştan beri maaş hesabına girer.");
  assert.equal(all.warn, "Temmuz–Eylül 2026 kâr/zararına da eklenir.");
});

test("stopText: son ay seçimi, kapanmış aydan çıkarsa uyarı, başlangıçtan önceyse hata", () => {
  const now = stopText({ lastMonth: CUR, currentMonth: CUR, closed: CLOSED, range: { startMonth: null, endMonth: null }, what: "gider" });
  assert.equal(now.text, "Kasım 2026 ve sonrasında hesaba girmez. Ekim 2026 ve öncesi değişmez.");
  assert.equal(now.warn, null);
  assert.equal(now.error, null);
  const back = stopText({ lastMonth: "2026-08", currentMonth: CUR, closed: CLOSED, range: { startMonth: null, endMonth: null }, what: "gider" });
  assert.equal(back.warn, "Kapanmış Eylül 2026 kâr/zararından da çıkar.");
  const bad = stopText({ lastMonth: "2026-09", currentMonth: CUR, closed: CLOSED, range: { startMonth: CUR, endMonth: null }, what: "personel" });
  assert.match(bad.error ?? "", /başlangıç ayından \(Ekim 2026\) önce olamaz/);
});

test("resumePlan: bitişin ertesi ayından devam = bitiş kaldırılır; boşluk varsa yeni kayıt", () => {
  assert.deepEqual(resumePlan({ fromMonth: "2026-10", endMonth: "2026-09", currentMonth: CUR }), { mode: "clear", gap: [] });
  // Bitiş henüz gelmedi (durdurma planlı): kaldırmak geçmişi değiştirmez
  assert.deepEqual(resumePlan({ fromMonth: "2026-12", endMonth: "2026-10", currentMonth: CUR }), { mode: "clear", gap: [] });
  // Ağustos'ta bitti, Ekim'den devam: Eylül değişmesin diye yeni kayıt
  assert.deepEqual(resumePlan({ fromMonth: "2026-10", endMonth: "2026-08", currentMonth: CUR }), { mode: "copy", gap: ["2026-09"] });
  assert.match(resumeText({ fromMonth: "2026-10", endMonth: "2026-08", currentMonth: CUR, what: "gider" }).text, /Arada kalan Eylül 2026 değişmesin/);
});

test("staffDeleteBlocker: kapanmış bir ayın maaş hesabına giren personel silinemez", () => {
  assert.equal(staffDeleteBlocker({ startMonth: null, endMonth: null }, CLOSED), "Temmuz–Eylül 2026 maaş hesabına girdi");
  assert.equal(staffDeleteBlocker({ startMonth: CUR, endMonth: null }, CLOSED), null);
  assert.equal(staffDeleteBlocker({ startMonth: "2026-09", endMonth: null }, CLOSED), "Eylül 2026 maaş hesabına girdi");
  // Eski biçim veri (aralık yok): active bakılır
  assert.equal(staffDeleteBlocker({ active: false }, CLOSED), null);
});

test("entryAt: listede gösterilen ayın girişi ve bir öncekisi", () => {
  const h = [
    { fromMonth: null, versionId: null, amount: 160000 },
    { fromMonth: "2026-09", versionId: 1, amount: 170000 },
    { fromMonth: "2026-11", versionId: 2, amount: 175000 },
  ];
  assert.equal(entryAt(h, "2026-08").entry?.amount, 160000);
  assert.equal(entryAt(h, "2026-08").prev, null);
  assert.equal(entryAt(h, "2026-10").entry?.amount, 170000);
  assert.equal(entryAt(h, "2026-10").prev?.amount, 160000);
  assert.equal(entryAt(h, "2026-11").entry?.amount, 175000);
  assert.deepEqual(entryAt([], "2026-10"), { entry: null, prev: null });
});

test("stopText: kalem silinemiyorsa hata metni silmeyi önermez", () => {
  const range = { startMonth: CUR, endMonth: null };
  const free = stopText({ lastMonth: "2026-09", currentMonth: CUR, closed: CLOSED, range, what: "gider", deleteBlocker: null });
  assert.match(free.error ?? "", /silebilirsiniz/);
  const blocked = stopText({ lastMonth: "2026-09", currentMonth: CUR, closed: CLOSED, range, what: "gider", deleteBlocker: "Ekim 2026 elle girilmiş tutar var" });
  assert.ok(blocked.error && !/sil/i.test(blocked.error), blocked.error ?? "");
  assert.match(blocked.error ?? "", /en erken Ekim 2026/);
});
