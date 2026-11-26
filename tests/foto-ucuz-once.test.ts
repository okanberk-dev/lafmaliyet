// Önce ucuz model, gerekirse bir kez güçlü model (sahibin isteği, 25 Kasım 2026: "rapor ve z raporlarını ai okusun ama
// ucuz model ile okut"): ModPOS Z'si, yazarkasa Z'si (elle girilen rapor) ve kasadan çıkan fiş.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { cheapFirst, receiptReadProblems, zReadProblems, type CheapStep } from "../src/lib/photo-read/cheap-first";
import type { AmountRaw, KasaZ, Receipt } from "../src/lib/photo-read/schemas";

const amt = (v: number | null, confidence: AmountRaw["confidence"] = "high"): AmountRaw => ({ text: v === null ? null : v.toLocaleString("tr-TR", { minimumFractionDigits: 2 }), value: v, confidence });

const z = (o: Partial<KasaZ> = {}): KasaZ => ({
  documentType: "z_report",
  readable: true,
  date: "2026-11-24",
  time: "23:40",
  zNo: "0128",
  receiptCount: 63,
  total: amt(9_350),
  paymentLines: [
    { label: "NAKİT", amount: amt(3_350), kind: "cash" },
    { label: "KREDİ KARTI", amount: amt(6_000), kind: "card" },
  ],
  discounts: amt(null),
  comps: amt(null),
  refunds: amt(null),
  issues: [],
  ...o,
});

const receipt = (o: Partial<Receipt> = {}): Receipt => ({
  documentType: "purchase_receipt",
  readable: true,
  store: "BİM",
  storeTaxNo: null,
  date: "2026-11-24",
  time: "10:12",
  receiptNo: "0042",
  total: amt(150),
  vatTotal: amt(13.64),
  vatLines: [{ rate: 10, amount: amt(13.64) }],
  paymentMethod: "cash",
  items: [
    { name: "SÜT", amount: amt(100) },
    { name: "BUZ", amount: amt(50) },
  ],
  itemSummary: "süt, buz",
  categoryId: null,
  issues: [],
  ...o,
});

const ok = <T>(data: T, model: string): CheapStep<T> => ({ ok: true, data, model });

test("Net Z tek ucuz çağrıyla biter; tutmayan Z bir kez güçlü modele gider, güçlü düşerse ucuz okunuş kalır", async () => {
  const calls: string[] = [];
  const run = (cheap: CheapStep<KasaZ>, strong: CheapStep<KasaZ>) =>
    cheapFirst({
      cheap: async () => (calls.push("haiku"), cheap),
      strong: async () => (calls.push("opus"), strong),
      problems: zReadProblems,
    });
  const a = await run(ok(z(), "claude-haiku-5-5"), ok(z(), "claude-opus-5-5"));
  assert.deepEqual([a.steps, calls], [["cheap"], ["haiku"]]);
  assert.equal(a.result.ok && a.result.model, "claude-haiku-5-5");
  calls.length = 0;
  const bad = z({ paymentLines: [{ label: "NAKİT", amount: amt(3_350), kind: "cash" }, { label: "KREDİ KARTI", amount: amt(5_000), kind: "card" }] });
  const b = await run(ok(bad, "claude-haiku-5-5"), ok(z(), "claude-opus-5-5"));
  assert.deepEqual(b.problems, ["ödemeler toplamı tutmuyor"]);
  assert.deepEqual(calls, ["haiku", "opus"]);
  assert.equal(b.result.ok && b.result.model, "claude-opus-5-5");
  calls.length = 0;
  const c = await run(ok(bad, "claude-haiku-5-5"), { ok: false, code: "timeout", message: "süre" });
  assert.equal(c.result.ok && c.result.model, "claude-haiku-5-5", "güçlü düştü: ucuz okunuş kalır");
});

test("Ucuz model kapıdan dönerse (anahtar yok, kapalı, sınır, fotoğraf sınırı) güçlü denenmez; ret / zaman aşımında bir kez denenir", async () => {
  for (const code of ["nokey", "off", "cap", "photo-limit", "auth", "billing"] as const) {
    let strong = 0;
    const r = await cheapFirst<KasaZ>({ cheap: async () => ({ ok: false, code, message: code }), strong: async () => (strong++, ok(z(), "o")), problems: zReadProblems });
    assert.equal(strong, 0, code);
    assert.equal(r.result.ok, false);
  }
  for (const code of ["refusal", "incomplete", "invalid", "timeout", "overloaded"] as const) {
    const r = await cheapFirst<KasaZ>({ cheap: async () => ({ ok: false, code, message: code }), strong: async () => ok(z(), "claude-opus-5-5"), problems: zReadProblems });
    assert.equal(r.result.ok && r.result.model, "claude-opus-5-5", code);
  }
});

test("ModPOS Z'sinin sorunları: belge türü, toplam, Z no, ödemeler, güven; ödenmezli günde Z toplamı − ödenmez de tutar", () => {
  assert.deepEqual(zReadProblems(z()), []);
  assert.deepEqual(zReadProblems(z({ documentType: "fiscal_z_report" })), ["belge türü"]);
  assert.deepEqual(zReadProblems(z({ total: amt(null) })), ["toplam yok"]);
  assert.deepEqual(zReadProblems(z({ total: amt(9_350, "medium") })), ["düşük güven"]);
  assert.deepEqual(zReadProblems(z({ zNo: null })), ["Z no yok"]);
  assert.deepEqual(zReadProblems(z({ paymentLines: [] })), ["ödeme satırı yok"]);
  assert.ok(zReadProblems(z({ paymentLines: [{ label: "NAKİT", amount: { text: "3.3?0,00", value: null, confidence: "low" }, kind: "cash" }] })).includes("ödeme okunamadı"));
  // İkramlı gün: ödemeler 9.350 − 250 = 9.100'ü tutar (KP-08)
  const comp = z({ comps: amt(250), paymentLines: [{ label: "NAKİT", amount: amt(3_100), kind: "cash" }, { label: "KREDİ KARTI", amount: amt(6_000), kind: "card" }, { label: "İKRAM", amount: amt(250), kind: "comp" }] });
  assert.deepEqual(zReadProblems(comp), []);
  assert.ok(zReadProblems(z({ paymentLines: [...z().paymentLines, { label: "SETCARD?", amount: amt(0), kind: "unknown" }] })).includes("tanınmayan ödeme"));
});

test("Fişin sorunları: belge türü, toplam ve güveni, kalemler ve KDV satırları toplamı tutmuyor", () => {
  assert.deepEqual(receiptReadProblems(receipt()), []);
  assert.deepEqual(receiptReadProblems(receipt({ documentType: "z_report" })), ["belge türü"]);
  assert.deepEqual(receiptReadProblems(receipt({ total: amt(150, "low") })), ["düşük güven"]);
  assert.deepEqual(receiptReadProblems(receipt({ items: [{ name: "SÜT", amount: amt(100) }, { name: "BUZ", amount: amt(40) }] })), ["kalemler tutmuyor"]);
  assert.deepEqual(receiptReadProblems(receipt({ vatTotal: amt(20) })), ["KDV tutmuyor"]);
  // Kalemi okunmayan fişte kalem toplamı denetlenmez (eksik kalem sorun sayılmaz)
  assert.deepEqual(receiptReadProblems(receipt({ items: [{ name: "SÜT", amount: amt(null) }] })), []);
});

test("Kaynak: ModPOS Z'si, elle girilen raporun yazarkasa Z'si ve fiş ucuz-önce yoldan okunur; modeller Ayarlar'dan", () => {
  const src = readFileSync(new URL("../src/server/photo-read/read.ts", import.meta.url), "utf8");
  assert.match(src, /twoStep\(\{ task: Z_TASK\(input\.day\), schema: KasaZRaw, problems: zReadProblems \}\)/);
  assert.match(src, /twoStep\(\{ task: OKC_TASK\(input\.day\), schema: KasaOkcRaw/);
  assert.match(src, /twoStep\(\{ task: RECEIPT_TASK\(input\.day, categories\), schema: ReceiptRaw, problems: receiptReadProblems/);
  assert.match(src, /\(await loadAiSettings\(\)\)\.photoModels/);
});
