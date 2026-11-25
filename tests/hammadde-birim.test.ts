// Hammaddenin birimi değişince eski birimle yazılmış bağlılar (denetim bulgu 41): Paraşüt çarpanı, kritik eşik ve son
// 90 günün zayi / ikram kayıtları söylenir; ölçü ailesi değişiyorsa (gr / ml ↔ adet / dilim) kayıt onay ister.
import assert from "node:assert/strict";
import { test } from "node:test";

import { unitChangeNotes, unitConfirmText, unitFamilyChanged, UNIT_WASTE_DAYS } from "../src/lib/ingredient-unit";

test("ölçü ailesi: gr / ml tartılan, adet / dilim sayılan", () => {
  assert.equal(unitFamilyChanged("gr", "adet"), true);
  assert.equal(unitFamilyChanged("ml", "dilim"), true);
  assert.equal(unitFamilyChanged("adet", "gr"), true);
  assert.equal(unitFamilyChanged("gr", "ml"), false);
  assert.equal(unitFamilyChanged("adet", "dilim"), false);
  assert.equal(unitFamilyChanged("gr", "gr"), false);
});

test("bağlı yoksa ya da birim aynıysa söylenecek bir şey yok", () => {
  assert.deepEqual(unitChangeNotes("gr", "adet", { links: 0, thresholds: 0, recentWaste: 0 }), []);
  assert.deepEqual(unitChangeNotes("gr", "gr", { links: 3, thresholds: 2, recentWaste: 5 }), []);
});

test("Paraşüt çarpanı, eşik ve zayi kayıtları eski birimle: üçü de söylenir", () => {
  const notes = unitChangeNotes("ml", "adet", { links: 2, thresholds: 1, recentWaste: 4 });
  assert.equal(notes.length, 3);
  assert.match(notes[0], /^Paraşüt'te 2 ürün bu hammaddeye bağlı; çarpanı “ml” ile yazıldı/);
  assert.match(notes[0], /çarpanı “adet” ile yeniden girin/);
  assert.equal(notes[1], "1 şubenin kritik stok eşiği “ml” ile yazıldı; Tahmini stok'ta eşiği “adet” ile yeniden girin.");
  assert.equal(notes[2], `Son ${UNIT_WASTE_DAYS} günde 4 zayi / ikram kaydı “ml” üzerinden girildi; miktarları yeni birimle okunur, gerekirse Zayi & ikram'da düzeltin.`);
});

test("onay metni yönü söyler", () => {
  assert.equal(unitConfirmText("gr", "adet"), "Birim gr → adet değişiyor: tartılan malzeme sayılan olur, eski miktarlar kendiliğinden çevrilmez.");
  assert.equal(unitConfirmText("adet", "ml"), "Birim adet → ml değişiyor: sayılan malzeme tartılan olur, eski miktarlar kendiliğinden çevrilmez.");
});
