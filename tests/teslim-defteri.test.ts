// Teslim defteri (Dalga 2, 25 Kasım 2026; docs/KASA-RAPORU.md › Teslim defteri): kasa raporunun "Sayımdan sonra
// teslim"inin "Kime"si (yönetici, banka ya da elle yazılan ad) ve iki şubenin teslimlerinin tek listesi (Marina'nın
// LafPOS'tan gelen alıcıları dahil). Saf kurallar burada; yazım ve defterin okunuşu tests/kor-sayim-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/teslim-defteri.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mobileTitleFor, NAV_GROUPS } from "../src/components/panel/nav";
import { cashReportText, type CashTextFields } from "../src/lib/cash-report";
import { canOpen } from "../src/lib/roles";
import {
  HANDED_TO_BANK,
  handedOverLine,
  handedToChoiceOf,
  handedToInputOf,
  handedToMissing,
  handedToName,
  ledgerByRecipient,
  ledgerTotal,
  sortLedger,
  type HandoverRow,
} from "../src/lib/teslim";

const plain = (t: string) => t.replace(/ /g, " ");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("Kime: seçici ↔ kayıt (yönetici hesabı, banka, elle yazılan ad)", () => {
  assert.deepEqual(handedToChoiceOf({ name: "Okan", userId: 3 }), { choice: "user:3", name: "" });
  assert.deepEqual(handedToChoiceOf({ name: HANDED_TO_BANK, userId: null }), { choice: "banka", name: "" });
  assert.deepEqual(handedToChoiceOf({ name: "Patron", userId: null }), { choice: "ad", name: "Patron" });
  assert.deepEqual(handedToChoiceOf({ name: null, userId: null }), { choice: "", name: "" });
  assert.deepEqual(handedToInputOf("user:3", ""), { kind: "user", id: 3 });
  assert.deepEqual(handedToInputOf("banka", "x"), { kind: "banka" });
  assert.deepEqual(handedToInputOf("ad", "  Okan   Bey "), { kind: "ad", name: "Okan Bey" });
  assert.equal(handedToInputOf("ad", "   "), null, "boş ad seçilmemiş sayılır");
  assert.equal(handedToInputOf("", ""), null);
  // Elle yazılan ad: boşluklar teke iner, en çok 60 karakter (LafPOS'un alıcısıyla aynı sınır)
  assert.equal(handedToName("a".repeat(80))?.length, 60);
  assert.equal(handedToName(" \n "), null);
});

test("Kime zorunlu: yeni raporda ve teslim tutarı değişince; eski raporun boş Kime'si yeniden sorulmaz", () => {
  assert.equal(handedToMissing({ handedOver: 0, to: null, prev: null }), false, "teslim yok");
  assert.equal(handedToMissing({ handedOver: 2_000, to: null, prev: null }), true, "yeni rapor");
  assert.equal(handedToMissing({ handedOver: 2_000, to: "Okan", prev: null }), false);
  assert.equal(handedToMissing({ handedOver: 2_000, to: null, prev: { handedOver: 2_000, handedTo: null } }), false, "alan gelmeden önceki rapor");
  assert.equal(handedToMissing({ handedOver: 2_500, to: null, prev: { handedOver: 2_000, handedTo: null } }), true, "tutar değişti");
  assert.equal(handedToMissing({ handedOver: 2_000, to: null, prev: { handedOver: 2_000, handedTo: "Okan" } }), true, "yazılı Kime silinemez");
});

const row = (o: Partial<HandoverRow> & Pick<HandoverRow, "date" | "amount">): HandoverRow => ({
  branchId: "tuzla",
  to: null,
  by: "Ayşe",
  kind: "sayim",
  lafpos: false,
  ref: { report: 1 },
  ...o,
});

test("defter: yeni gün üstte; alıcıya göre toplam (harf farkı aynı kişi), Kime'siz en sonda", () => {
  const rows = [
    row({ date: "2031-03-02", amount: 2_000, to: "Okan" }),
    row({ date: "2031-03-04", amount: 1_500, to: "patron ", branchId: "marina", kind: "gun-ici", lafpos: true, by: "LafPOS", ref: { cashOut: 9 } }),
    row({ date: "2031-03-04", amount: 3_000, to: null }),
    row({ date: "2031-03-04", amount: 500, to: "Patron", branchId: "marina", kind: "sayim", ref: { report: 7 } }),
    row({ date: "2031-03-03", amount: 4_000, to: "Banka" }),
  ];
  const sorted = sortLedger(rows);
  assert.deepEqual(
    sorted.map((r) => [r.date, r.branchId, r.kind, r.amount]),
    [
      ["2031-03-04", "marina", "gun-ici", 1_500],
      ["2031-03-04", "marina", "sayim", 500],
      ["2031-03-04", "tuzla", "sayim", 3_000],
      ["2031-03-03", "tuzla", "sayim", 4_000],
      ["2031-03-02", "tuzla", "sayim", 2_000],
    ],
  );
  assert.equal(ledgerTotal(rows), 11_000);
  assert.deepEqual(
    ledgerByRecipient(rows).map((r) => [r.to, r.amount, r.count]),
    [
      ["Banka", 4_000, 1],
      ["Okan", 2_000, 1],
      ["patron ", 2_000, 2],
      [null, 3_000, 1],
    ],
  );
});

test("kayıtlı raporun metni teslimin yanında Kime'yi yazar", () => {
  assert.equal(plain(handedOverLine(2_000, "Okan")), "2.000 ₺ · Kime: Okan");
  assert.equal(plain(handedOverLine(2_000, null)), "2.000 ₺");
  const f: CashTextFields = {
    date: "2031-03-04",
    zNo: null,
    receipts: null,
    zTotal: 10_000,
    cash: 3_000,
    card: 7_000,
    mealCard: 0,
    online: 0,
    other: 0,
    openingCash: 500,
    cashIn: 0,
    cashOut: 0,
    cashOutNote: null,
    countedCash: 3_500,
    handedOver: 2_000,
    bankPos: null,
    offRevenue: null,
    note: null,
    handedToName: "Okan",
  };
  assert.match(plain(cashReportText(f, { by: "Ayşe" }, "admin")), /Teslim edilen: 2\.000 ₺ · Kime: Okan · Ertesi güne devir: 1\.500 ₺/);
});

test("ekran: Teslim defteri yalnız yöneticinin; ⌘K'da ve telefon başlığında adıyla", () => {
  assert.equal(canOpen("staff", "/panel/kasa/teslim"), false);
  assert.equal(canOpen("admin", "/panel/kasa/teslim"), true);
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/panel/kasa/teslim");
  assert.ok(item, "⌘K'da Teslim defteri");
  assert.deepEqual(item.roles, ["admin"]);
  assert.equal(mobileTitleFor("/panel/kasa/teslim"), "Teslim defteri");
  const page = read("src/app/panel/kasa/teslim/page.tsx");
  assert.match(page, /await requireAdmin\(\)/);
  // Kaynaklar: kasa raporunun teslimi ve Kasadan çıkanlar'ın teslim satırları (LafPOS'unkiler dahil), şube seçiciye göre
  const data = read("src/server/data/handover-ledger.ts");
  assert.match(data, /gt\(s\.cashReports\.handedOver, 0\)/);
  assert.match(data, /eq\(s\.cashOuts\.kind, "teslim"\)/);
  assert.match(data, /currentBranchWhere\(s\.cashOuts\.branchId\)/);
});
