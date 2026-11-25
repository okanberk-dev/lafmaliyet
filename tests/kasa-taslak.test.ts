// Kasa raporu formunun taslağı ve ayrılma uyarısı (denetim 25 Kasım 2026, bulgu 87; docs/KASA-RAPORU.md › Ekranın
// düzeni › Taslak ve ayrılma uyarısı): Z fişi çekilirken telefon sekmeyi yeniden yüklese ya da alt menüye dokunulsa
// yazılanlar kaybolmaz. Stok sayımının deseni (src/app/panel/sayim/logic.ts): şube ve gün anahtarı, başka şubenin taslağı
// karışmaz, gönderilince ve gün / şube değişince silinir.
// Çalıştırma: npx tsx --test tests/kasa-taslak.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { cashDraftJson, cashDraftKey, leaveDropsDraft, parseCashDraft, staleCashDraftKeys, type CashDraft } from "../src/lib/cash-draft";

const KEYS = ["zTotal", "cash", "card", "openingCash", "countedCash", "cashOut", "cashOutNote", "note"];
const draft: CashDraft = {
  values: { zTotal: "12.400", cash: "3.100", countedCash: "3.550", hacker: "x" },
  counter: 7,
  photos: [{ id: 41, kind: "kasa-z", createdAt: "2026-11-24T19:55:00.000Z", byName: "Ayşe" }],
  revision: 0,
  branch: "tuzla",
  date: "2026-11-24",
  by: "Ayşe",
  at: "2026-11-24T20:01:00.000Z",
};
const expect = { branch: "tuzla", date: "2026-11-24", revision: 0, keys: KEYS };

test("anahtar şube ve gün başına: Tuzla'nın taslağı Marina'nın, dünkü bugünkünün anahtarı değil", () => {
  assert.equal(cashDraftKey("tuzla", "2026-11-24"), "laf:kasa-taslak:tuzla:2026-11-24");
  assert.notEqual(cashDraftKey("tuzla", "2026-11-24"), cashDraftKey("marina", "2026-11-24"));
  assert.notEqual(cashDraftKey("tuzla", "2026-11-24"), cashDraftKey("tuzla", "2026-11-23"));
});

test("okuma: yazılanlar, sayan, fotoğraflar ve yazan geri gelir; bilinmeyen alan atılır", () => {
  const back = parseCashDraft(cashDraftJson(draft), expect);
  assert.ok(back, "taslak okunur");
  assert.deepEqual(back.values, { zTotal: "12.400", cash: "3.100", countedCash: "3.550" });
  assert.deepEqual([back.counter, back.by, back.at], [7, "Ayşe", "2026-11-24T20:01:00.000Z"]);
  assert.deepEqual(back.photos, draft.photos);
});

test("başka şubenin, günün ya da sürümün taslağı önerilmez; bozuk ya da boş taslak da", () => {
  const json = cashDraftJson(draft);
  assert.equal(parseCashDraft(json, { ...expect, branch: "marina" }), null, "başka şube karışmaz");
  assert.equal(parseCashDraft(json, { ...expect, date: "2026-11-25" }), null, "başka gün");
  assert.equal(parseCashDraft(json, { ...expect, revision: 1 }), null, "arada rapor gönderildi: eski rakamın üstüne yüklenmez");
  assert.equal(parseCashDraft("{bozuk", expect), null);
  assert.equal(parseCashDraft(null, expect), null);
  assert.equal(parseCashDraft(cashDraftJson({ ...draft, values: {}, photos: [] }), expect), null, "boş taslak bant çıkarmaz");
  // Bozuk fotoğraf satırı atılır, öteki yazılanlar kalır
  const odd = JSON.parse(json) as Record<string, unknown>;
  odd.p = [{ id: "x", kind: "kasa-z" }, { id: 5, kind: "fis", createdAt: "x" }];
  assert.deepEqual(parseCashDraft(JSON.stringify(odd), expect)?.photos, []);
});

test("temizlik: geç rapor penceresinden (14 gün) eski günün taslağı silinir; öteki anahtarlara dokunulmaz", () => {
  const keys = [cashDraftKey("tuzla", "2026-11-24"), cashDraftKey("marina", "2026-11-10"), cashDraftKey("tuzla", "2026-11-09"), "laf:kasa-taslak:bozuk", "laf:sayim-taslak:tuzla:2026-10", "tema"];
  assert.deepEqual(staleCashDraftKeys(keys, "2026-11-24"), [cashDraftKey("tuzla", "2026-11-09"), "laf:kasa-taslak:bozuk"]);
});

test("Göndermeden geç: başka güne ya da şubeye geçerken taslak silinir, başka sayfaya giderken kalır", () => {
  const today = "2026-11-24";
  assert.equal(leaveDropsDraft("/panel/kasa?gun=2026-11-23", "2026-11-24", today), true, "Dün çipi");
  assert.equal(leaveDropsDraft("/panel/kasa", "2026-11-23", today), true, "dünün formundan bugüne");
  assert.equal(leaveDropsDraft("/panel/kasa?gun=2026-11-24&sube=marina", "2026-11-24", today), true, "şube seçici");
  assert.equal(leaveDropsDraft("/panel/bugun?sube=marina", "2026-11-24", today), true);
  assert.equal(leaveDropsDraft("/panel/kasa", "2026-11-24", today), false, "aynı günün formu");
  assert.equal(leaveDropsDraft("/panel/zayi?gun=2026-11-24", "2026-11-24", today), false, "Zayi & ikram'a gidip dönülür");
  assert.equal(leaveDropsDraft("/panel/bugun", "2026-11-24", today), false);
});

test("form: taslak ve ayrılma uyarısı kasa formunda kurulu; gönderilince silinir", () => {
  const form = readFileSync(join(process.cwd(), "src/app/panel/kasa/cash-form.tsx"), "utf8");
  assert.match(form, /const draftKey = cashDraftKey\(branchId \?\? "", date\);/);
  assert.match(form, /const \[leaveHref, setLeaveHref\] = useLeaveGuard\(dirty, BRANCH_LEAVE\);/);
  // "Düzeltip onayla" taslak tutmaz; düzenleyemeyen (kör kasa, kilitli) de
  assert.match(form, /const draftOn = mode !== "review" && branchId !== null && canEdit;/);
  // Başarılı her gönderim (rapor, düzeltme önerisi, geç rapor) taslağı siler
  assert.equal(form.match(/forgetDraft\(\);\n\s*(?:setEditing\(false\)|onSent\?\.\(\))/g)?.length, 3);
  assert.match(form, /if \(leaveDropsDraft\(href, date, businessDate\(\)\)\) forgetDraft\(\);/);
});
