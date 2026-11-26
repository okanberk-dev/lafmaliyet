import assert from "node:assert/strict";
import { test } from "node:test";

import { badge, button, kpiGrid, kvRow, layout, list, note, section, splitHeadline, stack, statusBanner } from "../src/lib/email";

test("layout: e-posta istemcisinin beklediği kabuk (renk şeması, telefon ve koyu tema stilleri, Outlook genişliği, önizleme metni)", () => {
  const html = layout({ subject: "Konu <1>", preheader: "Önizleme & metin", branch: "Marina", meta: "Gün sonu", title: "Başlık", body: ["<p>a</p>", null, false, "<p>b</p>"], footer: "Alt bilgi" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Konu &lt;1&gt;<\/title>/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /@media only screen and \(max-width:620px\)/);
  assert.match(html, /@media \(prefers-color-scheme:dark\)/);
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="600"/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /display:none[^>]*>Önizleme &amp; metin/);
  assert.ok(html.includes("L'Affogato") && html.includes("Marina") && html.includes("Alt bilgi"));
  // Bloklar arasına tek boşluk girer; boş bloklar atlanır
  assert.equal(stack(["a", null, "", "b"]).split('class="e-gap"').length - 1, 1);
});

test("bileşenler: metin kaçışlanır, ton sınıfı ve rengi satır içinde, rakamlar tabular", () => {
  assert.match(statusBanner({ tone: "bad", title: "120 ₺ <eksik>", sub: "alt" }), /e-t-bad[^]*120 ₺ &lt;eksik&gt;[^]*alt/);
  assert.match(kvRow("Kasa farkı", "120 ₺ eksik", { tone: "bad", strong: true }), /e-v-bad[^>]*font-weight:700[^>]*tabular-nums[^>]*>120 ₺ eksik/);
  // Kısa değer telefonda yanında kalır, uzun değer etiketin altına iner
  assert.ok(!kvRow("Nakit", "3.390 ₺").includes("e-kv-s"));
  assert.ok(kvRow("Banka POS", "7.800 ₺ (000278 2.400 ₺ + 000279 5.400 ₺)").includes("e-kv-s"));
  assert.match(kvRow("Nakit", "x", { badge: { text: "FARK", tone: "bad" } }), /e-t-bad[^>]*>FARK</);
  assert.equal(kpiGrid([]), "");
  const four = [1, 2, 3, 4].map((n) => ({ label: `k${n}`, value: String(n) }));
  assert.equal(kpiGrid(four).split('class="e-kpi e-well"').length - 1, 3);
  assert.match(section("Satış", [["Toplam", "1 ₺"]], { aside: "2 kalem" }), /Satış[^]*2 kalem[^]*Toplam[^]*1 ₺/);
  assert.match(list(["a & b"], { ordered: true }), />1<\/div>[^]*a &amp; b/);
  assert.equal(note([]), "");
  assert.match(button("https://x.test/?a=1&b=2", "Panelde aç"), /href="https:\/\/x\.test\/\?a=1&amp;b=2"[^>]*>Panelde aç<\/a>/);
  assert.match(badge("aynı", "good"), /e-t-good/);
  assert.deepEqual(splitHeadline("Z raporu tutuyor: fotoğraftaki rakamlar aynı"), { title: "Z raporu tutuyor", sub: "Fotoğraftaki rakamlar aynı" });
  assert.deepEqual(splitHeadline("Tek cümle"), { title: "Tek cümle" });
});

test("durum bandı başlığı: ilk ': ' ya da '; ' ayracından bölünür, parantezin içi bölünmez; uzun başlık bir boy küçük", () => {
  assert.deepEqual(splitHeadline("Z raporu okunamadı ya da yanlış belge; personelden yeniden çekmesi istendi"), {
    title: "Z raporu okunamadı ya da yanlış belge",
    sub: "Personelden yeniden çekmesi istendi",
  });
  assert.deepEqual(splitHeadline("Yapay zekâ kullanılamadı; fotoğraf kodla okundu: fotoğrafa bakın"), { title: "Yapay zekâ kullanılamadı", sub: "Fotoğraf kodla okundu: fotoğrafa bakın" });
  assert.deepEqual(splitHeadline("Pavo sonucu alınamadı (Bağlantı yok; hata kodu 5085)."), { title: "Pavo sonucu alınamadı (Bağlantı yok; hata kodu 5085)." });
  assert.deepEqual(splitHeadline("Saat 23:10"), { title: "Saat 23:10" });
  assert.match(statusBanner({ tone: "warn", title: "Yapay zekâ kullanılamadı ve fotoğraf kodla da okunamadı" }), /font-size:18px/);
  assert.match(statusBanner({ tone: "good", title: "Z raporu tutuyor" }), /font-size:20px/);
});

test("satırlar: çok uzun değer her genişlikte etiketin altında, karşılaştırma satırı rozet ve gri alt satırla; büyük rakamda rozet", () => {
  const long = kvRow("Fotoğraf", "alındı · LafPOS'tan farklı: Yazarkasa nakdi: fotoğrafta 3.270 ₺; LafPOS'ta 3.390 ₺");
  // Etiket ve değer ayrı satırlarda (iki <tr>), değer sola dayalı
  assert.equal(long.split("<tr>").length - 1, 2);
  assert.ok(!long.includes("text-align:right"));
  const cmp = kvRow("Yazarkasa nakdi", "fotoğrafta 3.270 ₺", { badge: { text: "FARK", tone: "bad" }, valueSub: "LafPOS'ta 3.390 ₺", stack: true });
  assert.match(cmp, /e-kv-s/);
  assert.match(cmp, /fotoğrafta 3.270 ₺[^]*FARK[^]*LafPOS&#39;ta 3.390 ₺/);
  // Kısa etiketin yanındaki uzun değer geniş sütunda
  assert.match(kvRow("Banka POS", "7.920 ₺ (000278 2.400 ₺ + 000279 5.520 ₺)"), /width="28%"/);
  assert.match(kpiGrid([{ label: "Nakit", value: "3.270 ₺", sub: "LafPOS'ta 3.390 ₺", tone: "bad", badge: { text: "FARK", tone: "bad" } }]), /LafPOS&#39;ta 3.390 ₺ <span class="e-t-bad"[^>]*>FARK</);
});
