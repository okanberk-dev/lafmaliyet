// Kaldırılan / sadeleşen defteri (docs/planlar/ux-sade.md §9): personelin Reçete defterinde fiyat / ModPOS anan ürün
// notu çizilmez ama veri aynen gelir (öneri penceresi notun kendisiyle başlar), cihaz ipuçları tek açılırda, Onaylar'ın ve
// Kontrol listelerinin boş durumu tek satır, Sayım (personel) ve Genel bakış KPI'ının sade sözü.
// Çalıştırma: npx tsx --test tests/sadelesen.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { STAFF_HIDDEN_NOTE, staffRecipeNote } from "../src/app/panel/receteler/staff-note";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("§9 #23 (H6): personelin kartında fiyat / maliyet / ModPOS anan not çizilmez, hazırlama notu kalır", () => {
  const hidden = [
    "Instagram menüsünde yok; fiyat Patron (ModPOS) Eylül raporundaki ortalama satış fiyatından alındı.",
    "Maliyet yüksek, gözden geçir",
    "Satış 145 ₺",
    "ModPOS'ta adı farklı",
    "Kasada 120 TL",
  ];
  for (const n of hidden) assert.equal(staffRecipeNote(n), null, n);
  const kept = ["M = solo (11 gr), L = doppio (18 gr), 4oz bardak.", "Reçete kartında yok; Salted Caramel Latte gibi, karamel sos ile hesaplandı.", "Tam pot 105 gr kahve; pottan çıkan miktar Ayarlar sayfasında."];
  for (const n of kept) assert.equal(staffRecipeNote(n), n, n);
  assert.equal(staffRecipeNote(null), null);
  // Süzgeç belgedeki ifadenin kendisi (§9 #23)
  assert.equal(String(STAFF_HIDDEN_NOTE), String(/fiyat|maliyet|modpos|patron|₺|\btl\b/i));
});

test("§9 #23: süzgeç çizimde; sunucu notu aynen verir (süzülse personelin önerisi onayda ürünün notunu silerdi)", () => {
  const page = read("src/app/panel/receteler/page.tsx");
  assert.match(page, /\bnote: v\.product\.note,/);
  assert.doesNotMatch(page, /staffRecipeNote/);
  const book = read("src/app/panel/receteler/recipe-book.tsx");
  assert.match(book, /\(canEdit \? v\.note : staffRecipeNote\(v\.note\)\)/);
  // Öneri penceresi bugünkü reçeteyle (notun kendisiyle) başlar
  assert.match(book, /const snapshotOf = \(v: Variant\): RecipeSnapshot => \(\{\n\s+note: v\.note,/);
});

test("§9 #25 (H5): dört cihaz ipucu tek açılırda, metinler aynen; seçicinin yanında tekrar yok", () => {
  const alerts = read("src/components/panel/live/device-alerts.tsx");
  assert.match(alerts, /Ses ve bildirim ipuçları \(\{tips\.length\}\)/);
  assert.match(alerts, /OUTPUT_TIPS\.bluetooth,\n\s+OUTPUT_TIPS\.permission,/);
  assert.match(alerts, /Tarayıcı sesi ancak sayfaya bir kez dokununca açar; açılış sonrası ilk dokunuş yeter\./);
  const picker = read("src/components/panel/live/output-picker.tsx");
  assert.equal(picker.split("Müzik Bluetooth hoparlörden çalıyorsa").length, 2, "bluetooth ipucu bir kez (OUTPUT_TIPS)");
  assert.equal(picker.split("Chrome hoparlörlerin adını göstermek için").length, 2, "izin ipucu bir kez (OUTPUT_TIPS)");
});

test("§9 #26 ve sadeleşenler: tek satır boş durumlar, Sayım (personel), KPI etiketi", () => {
  const review = read("src/app/panel/onaylar/review-list.tsx");
  assert.match(review, /<p className="text-\[13px\] text-ink-mute">Onay bekleyen reçete önerisi yok<\/p>/);
  assert.doesNotMatch(review, /<EmptyState/);
  const kontrol = read("src/app/panel/kontrol/page.tsx");
  assert.match(kontrol, /title="Bugün açık liste yok"/);
  assert.match(kontrol, /`\$\{listTitle\(tomorrow\.name\)\} yarın \$\{clockSuffixTR\(tomorrow\.opensAt\)\} başlar\.`/);
  assert.match(read("src/app/panel/sayim/stock-form.tsx"), /"Listede olmayan bir şey varsa buraya ekleyin; fiyatını yönetici girer\."/);
  assert.match(read("src/app/panel/page.tsx"), /label="Zarar etmemek için günlük satış \(başabaş\)"/);
});
