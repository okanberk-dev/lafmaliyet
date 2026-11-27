// Zilin okunamayan bölümleri (denetim bulgu 88): src/lib/bell-failed.ts failedBellRows. Düşen kaynak sessizce boş
// görünmez; grup başına tek "… yüklenemedi" satırı, okunmamış sayılmaz, kimliği grup ve günden.
import assert from "node:assert/strict";
import { test } from "node:test";

import { failedBellRows } from "../src/lib/bell-failed";

const DAY = "2026-11-25";

test("hiçbir kaynak düşmediyse satır yok", () => {
  assert.deepEqual(failedBellRows([], "admin", DAY), []);
});

test("kasa düşünce Kasa grubunda tek satır; okunmamış sayılmaz", () => {
  assert.deepEqual(failedBellRows(["kasa"], "admin", DAY), [
    {
      id: `okunamadi-kasa-${DAY}`,
      kind: "warning",
      title: "Kasa yüklenemedi",
      body: "Kasa raporları şu an okunamadı; zili birazdan yeniden açın.",
      timeLabel: "",
      unread: false,
      href: "/panel/kasa",
      group: "kasa",
    },
  ]);
});

test("aynı gruptan birden çok kaynak tek satır; gövde okunamayanları sayar, bağlantı ilk düşeninki", () => {
  const rows = failedBellRows(["bekletme", "kontrol", "recete", "istek", "recete"], "admin", DAY);
  assert.deepEqual(
    rows.map((r) => [r.id, r.group, r.title, r.href]),
    [
      [`okunamadi-onay-${DAY}`, "onay", "Onaylar yüklenemedi", "/panel/onaylar"],
      [`okunamadi-kontrol-${DAY}`, "kontrol", "Kontrol listeleri yüklenemedi", "/panel/kontrol"],
    ],
  );
  assert.equal(rows[0].body, "Bekleyen fiyat onayları, reçete önerileri ve personel istekleri şu an okunamadı; zili birazdan yeniden açın.");
});

test("personelde onay grubu 'İstekleriniz yüklenemedi', kendi sayfasına götürür", () => {
  const [row] = failedBellRows(["istek"], "staff", DAY);
  assert.equal(row.title, "İstekleriniz yüklenemedi");
  assert.equal(row.body, "İsteklerinizin sonucu şu an okunamadı; zili birazdan yeniden açın.");
  assert.equal(row.href, "/panel/kasa#isteklerim");
});

test("AsilPOS retleri okunamazsa Sistem grubunda, Ayarlar › AsilPOS'a götürür", () => {
  const [row] = failedBellRows(["asilpos"], "admin", DAY);
  assert.deepEqual([row.group, row.title, row.href], ["sistem", "Sistem uyarıları yüklenemedi", "/panel/ayarlar#asilpos"]);
  assert.equal(row.body, "AsilPOS gün sonu retleri şu an okunamadı; zili birazdan yeniden açın.");
});

test("sistem kaynakları tek Sistem satırında", () => {
  const rows = failedBellRows(["sistem", "modpos", "alici"], "admin", DAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Sistem uyarıları yüklenemedi");
  assert.equal(rows[0].body, "Günlük işlerin durumu, ModPOS anahtarı ve bildirim alıcıları şu an okunamadı; zili birazdan yeniden açın.");
});
