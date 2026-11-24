// Panelin yardımcı metinleri sade (sahibin isteği 24.11.2026: "sitedeki gereksiz olan bilgileri de temizle"; site =
// ladmin paneli): kurulumu çoktan bitmiş bağlantıların geliştirici talimatı (ortam değişkeni, Vercel menüsü, belge yolu)
// her zaman görünen ⓘ'lerde durmaz; kurulmamış bağlantının kendi durum satırı talimatı yine verir. Yardım'ın kendi
// içerik testleri tests/yardim.test.ts ve tests/yardim-personel.test.ts'te.
// Çalıştırma: npx tsx --test tests/sade-metinler.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Yorumlar atılır: belge yolu kodun açıklamasında kalabilir, ekranda değil */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

test("Ayarlar › ModPOS API: kurulum talimatı her zaman görünen ⓘ'de değil (anahtar yokken durum satırı söyler)", () => {
  const card = code("src/app/panel/ayarlar/modpos-card.tsx");
  assert.doesNotMatch(card, /SETUP_TIP|Environment Variables|docs\/MODPOS-API\.md/);
  // Anahtar yokken talimat durum satırında kalır
  assert.match(read("src/lib/modpos/status.ts"), /Environment Variables/);
});

test("Ayarlar › LafPOS (kasa): anahtar talimatı yok; geçiş günü seçildikten sonra 'ModPOS sayılır' cümlesi yok", () => {
  const card = code("src/app/panel/ayarlar/lafpos-card.tsx");
  assert.doesNotMatch(card, /LAFMALIYET_SYNC_SECRET|Açılış sırası|docs\/LAFPOS\.md/);
  assert.match(card, /data\.switchDay\s*\?\s*"Kafenin kasası LafPOS her iş gününü kapanışta buraya gönderir\."/);
});

test("Ayarlar › laffogato.net ve Yedek: bağlıyken imza ve belge yolu anlatılmaz", () => {
  const page = code("src/app/panel/ayarlar/page.tsx");
  assert.doesNotMatch(page, /imzalı ping|dört bağlantı: aynı anahtar/);
  assert.doesNotMatch(page, /docs\/YEDEK\.md/);
  assert.doesNotMatch(code("src/app/panel/ayarlar/backup-client.tsx"), /docs\/YEDEK\.md/);
});

test("Karaoke ve Site menüsü: eşitlemenin iç işleyişi (imzalı ping, sorgu sıklığı) ekranda anlatılmaz", () => {
  for (const p of ["src/app/panel/karaoke/karaoke-admin.tsx", "src/app/panel/urunler/site/site-menu-matching.tsx"]) {
    const src = code(p);
    assert.doesNotMatch(src, /imzalı bir ping|Sürekli sorgu yapılmaz|en çok beş dakikada/, p);
  }
});

test("Ayarlar › laffogato.net bağlıyken açıklama özeti tekrarlamaz; menü iki yönlü", () => {
  const page = code("src/app/panel/ayarlar/page.tsx");
  assert.doesNotMatch(page, /Karaoke rezervasyonları, menü, uygulama siparişleri ve online satışlar siteden kendiliğinden gelir/);
  assert.match(page, /panelde değişen menü fiyatı siteye yazılır/);
});

test("Yedek: belgeli yedek panelden inemeyecek kadar büyükse ne yapılacağı yazılı (belge yolu değil)", () => {
  assert.match(code("src/app/panel/ayarlar/backup-client.tsx"), /belgeli yedeği geliştiriciden isteyin/);
  const action = code("src/server/actions/backup.ts");
  assert.doesNotMatch(action, /docs\/YEDEK\.md/);
  assert.match(action, /geliştiriciden isteyin/);
});
