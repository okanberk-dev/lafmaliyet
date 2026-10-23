import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";

import { SYSTEM_ALERT_HELP } from "../src/lib/job-health";
import { digestSummary, type UpcomingItem } from "../src/lib/reminders";
import {
  APP_URL,
  collectDigestExtras,
  DIGEST_EXTRA_MS,
  emailLayout,
  esc,
  FONT,
  invoiceNewsOf,
  renderDigest,
  renderSystemAlert,
  type DigestBox,
  type DigestExtras,
  type DigestExtraSource,
  type DigestInvoices,
  type DigestPrices,
} from "../src/server/notify/digest-template";

const NBSP = " ";

const item = (over: Partial<UpcomingItem>): UpcomingItem => ({
  ref: "reminder:1",
  source: "reminder",
  sourceId: 1,
  kind: "kira",
  title: "Kira",
  detail: null,
  amount: 25000,
  dueDate: "2026-10-20",
  daysLeft: 0,
  status: "today",
  remindDaysBefore: 3,
  repeat: "monthly",
  ...over,
});

const rows = [
  { item: item({ title: "Muhasebe <ödeme>", amount: 1000, dueDate: "2026-10-25", daysLeft: 5, status: "soon" }), stage: "before" as const },
  { item: item({ title: "Kira" }), stage: "due" as const },
  {
    item: item({ ref: "invoice:23", source: "invoice", sourceId: 23, kind: "fatura", title: "Kaldi", detail: "Fatura KLA1 · vade tahmini (30 gün)", amount: 12500.5, dueDate: "2026-10-13", daysLeft: -7, status: "overdue", repeat: "none" }),
    stage: "overdue" as const,
  },
];

test("e-posta: konu aşamaları sayar, gruplar gecikmiş → bugün → yaklaşan sırasında", () => {
  const { subject, html, text } = renderDigest(rows, "2026-10-20");
  assert.equal(subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan");
  const order = ["Gecikenler · 1", "Son günü bugün · 1", "Yaklaşanlar · 1"].map((t) => html.indexOf(t));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /<h1[^>]*>3 ödeme sizi bekliyor<\/h1>/);
  assert.ok(html.includes("20 Ekim Salı"));
  assert.ok(text.startsWith("L'Affogato · 20.10.2026\nÖdeme hatırlatması"));
});

test("e-posta: kuruşlu tutar ve toplam iki ondalıkla (yuvarlanmaz)", () => {
  const { html, text } = renderDigest(rows, "2026-10-20");
  assert.ok(html.includes(`12.500,50${NBSP}₺`), "satır tutarı");
  // Toplam 1.000 + 25.000 + 12.500,50
  assert.ok(html.includes(`38.500,50${NBSP}₺`), "toplam");
  assert.ok(!html.includes(`12.501${NBSP}₺`));
  assert.ok(text.includes(`Toplam 38.500,50${NBSP}₺`));
  // Kuruşsuz toplam tam yazılır
  const whole = renderDigest([rows[1]], "2026-10-20");
  assert.ok(whole.html.includes(`25.000${NBSP}₺`));
  assert.ok(!whole.html.includes(`25.000,00`));
});

test("e-posta: başlık ve ayrıntı HTML'e kaçışlı yazılır, bağlantı panele gider", () => {
  const { html, text } = renderDigest(rows, "2026-10-20");
  assert.ok(html.includes("Muhasebe &lt;ödeme&gt;"));
  assert.ok(!html.includes("Muhasebe <ödeme>"));
  assert.ok(html.includes("Fatura KLA1 · vade tahmini (30 gün)"));
  assert.ok(html.includes("7 gün gecikti"));
  assert.ok(html.includes(`href="${APP_URL}/panel/hatirlaticilar"`));
  assert.ok(text.includes(`Panelde aç: ${APP_URL}/panel/hatirlaticilar`));
  // Düz metinde başlık olduğu gibi
  assert.ok(text.includes("- Muhasebe <ödeme> · 25.10.2026 (5 gün kaldı)"));
});

test("e-posta: tutarsız satır tire ile, tek ödemede tekil başlık", () => {
  const { subject, html } = renderDigest([{ item: item({ amount: null }), stage: "due" }], "2026-10-20");
  assert.equal(subject, "Ödeme hatırlatması: 1 bugün");
  assert.ok(html.includes("1 ödeme sizi bekliyor"));
  assert.ok(html.includes('<span style="color:#a1a1aa">–</span>'));
});

// ---------------------------------------------------------------- Sistem uyarıları (günlük işler)

const system = {
  items: [
    { title: "Dünkü sabah işi çalışmadı (21 Ekim)", body: "08:00–09:00 arasında çalışması gerekiyordu: sabah e-postası gitmedi." },
    { title: "Paraşüt işi bu sabah çalışmadı", body: "Eşitlemeyi sabah işi yaptı <tamam>." },
  ],
};
const invoices: DigestInvoices = {
  items: [
    { supplier: "Kaldi", date: "2026-10-21", payable: 1200, category: "Kahve", needsReview: false },
    { supplier: "Metro", date: "2026-10-21", payable: 800, category: "Market", needsReview: true },
  ],
  reviewCount: 1,
  syncError: null,
};
const prices: DigestPrices = { changes: [{ name: "Süt", unit: "ml", before: 0.04, after: 0.05, pct: 0.25 }], products: [], productCount: 0 };

test("e-posta: sistem uyarıları gövdenin en üstünde; ödeme varsa konuya ' · sistem uyarısı' eklenir", () => {
  const { subject, html, text } = renderDigest(rows, "2026-10-22", null, null, system);
  assert.equal(subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan · sistem uyarısı");
  const sys = html.indexOf("Sistem uyarıları · 2");
  assert.ok(sys > 0 && sys < html.indexOf("Gecikenler · 1"), "sistem bölümü ödemelerden önce");
  assert.ok(html.includes("Eşitlemeyi sabah işi yaptı &lt;tamam&gt;."));
  assert.ok(html.includes(`href="${APP_URL}/panel/ayarlar#isler"`));
  assert.match(html, /<h1[^>]*>3 ödeme sizi bekliyor<\/h1>/);
  assert.ok(text.includes("Sistem uyarıları (2)\n- Dünkü sabah işi çalışmadı (21 Ekim): 08:00–09:00"));
  assert.ok(text.indexOf("Sistem uyarıları") < text.indexOf("Gecikenler"));
});

test("e-posta konusu: ödeme yoksa sistem uyarısı öne geçer, ötekiler eklenir", () => {
  const only = renderDigest([], "2026-10-22", null, null, system);
  assert.equal(only.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.match(only.html, /<h1[^>]*>Dünkü sabah işi çalışmadı \(21 Ekim\)<\/h1>/);
  assert.ok(only.html.includes(">Günlük işleri aç</a>"));
  assert.ok(only.text.endsWith(`Günlük işleri aç: ${APP_URL}/panel/ayarlar#isler`));
  const withNews = renderDigest([], "2026-10-22", invoices, prices, system);
  assert.equal(withNews.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim) · 2 yeni fatura · 1 hammaddeye zam");
  assert.ok(withNews.html.includes(">Faturaları aç</a>"));
  // Eşitleme hatası (yeni fatura yok) sistem uyarısının arkasında kalır
  const syncFail = renderDigest([], "2026-10-22", { items: [], reviewCount: 0, syncError: "401" }, null, system);
  assert.equal(syncFail.subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.ok(syncFail.html.includes("Paraşüt eşitlemesi başarısız."));
});

test("e-posta konusu: sistem uyarısı yoksa öncelik eskisi gibi", () => {
  for (const none of [undefined, null, { items: [] }]) {
    assert.equal(renderDigest([], "2026-10-22", invoices, prices, none).subject, "Sabah özeti: 2 yeni fatura · 1 hammaddeye zam");
    assert.equal(renderDigest([], "2026-10-22", { items: [], reviewCount: 0, syncError: "401" }, prices, none).subject, "Paraşüt eşitlemesi başarısız · 1 hammaddeye zam");
    assert.equal(renderDigest([], "2026-10-22", null, prices, none).subject, "Sabah özeti: 1 hammaddeye zam");
    assert.ok(!renderDigest(rows, "2026-10-22", null, null, none).html.includes("Sistem uyarıları"));
  }
});

test("bekçi e-postası: konu ilk sorun, ne yapılacağı ve panel bağlantısı", () => {
  const one = renderSystemAlert(system.items.slice(0, 1), "2026-10-22");
  assert.equal(one.subject, "L'Affogato · Dünkü sabah işi çalışmadı (21 Ekim)");
  assert.match(one.html, /<h1[^>]*>Dünkü sabah işi çalışmadı \(21 Ekim\)<\/h1>/);
  assert.ok(one.html.includes("22 Ekim Perşembe"));
  assert.ok(one.html.includes(`href="${APP_URL}/panel/ayarlar#isler"`));
  assert.ok(one.text.includes(SYSTEM_ALERT_HELP));
  assert.ok(one.text.startsWith("L'Affogato · 22.10.2026\nL'Affogato · Dünkü sabah işi"));
  const two = renderSystemAlert(system.items, "2026-10-22");
  assert.equal(two.subject, "L'Affogato · Dünkü sabah işi çalışmadı (21 Ekim) (+1)");
  assert.match(two.html, /<h1[^>]*>2 sistem uyarısı<\/h1>/);
  assert.ok(two.html.includes("Eşitlemeyi sabah işi yaptı &lt;tamam&gt;."));
  assert.ok(!two.html.includes("<tamam>"));
});

// ---------------------------------------------------------------- Onay bekleyen fiyatlar (Paraşüt bölümü)

const holds = (fresh: number): DigestInvoices => ({
  items: [],
  reviewCount: 0,
  syncError: null,
  priceHolds: {
    count: 2,
    fresh,
    items: [
      { name: "Süt <2,5>", pct: 0.52 },
      { name: "Kahve", pct: -0.45 },
    ],
  },
});

test("e-posta: onay bekleyen fiyatlar kontrol kutusundan sonra turuncu kutuda; tek haberse konu ve düğme ona", () => {
  const { subject, html, text } = renderDigest([], "2026-10-22", holds(1));
  assert.equal(subject, "Sabah özeti: 2 fiyat onay bekliyor");
  assert.match(html, /<h1[^>]*>2 hammadde fiyatı onay bekliyor<\/h1>/);
  const WJ = "\u2060";
  assert.ok(html.includes(`2 hammadde fiyatı onay bekliyor (Süt &lt;2,5&gt; +${WJ}%52, Kahve −${WJ}%45). Faturadaki fiyat şimdikinden %40'tan fazla farklı.`));
  assert.ok(html.includes(`href="${APP_URL}/panel/hammaddeler#fiyat-onayi"`));
  assert.ok(html.includes(">Hammaddeleri aç</a>"));
  assert.ok(text.includes(`2 hammadde fiyatı onay bekliyor (Süt <2,5> +${WJ}%52, Kahve −${WJ}%45): ${APP_URL}/panel/hammaddeler#fiyat-onayi`));
  assert.ok(text.endsWith(`Hammaddeleri aç: ${APP_URL}/panel/hammaddeler#fiyat-onayi`));
  // Kontrol bekleyen kutusundan sonra
  const both = renderDigest([], "2026-10-22", { ...holds(1), reviewCount: 3 }).html;
  assert.ok(both.indexOf("faturanın kategorisi tahminle yazıldı") < both.indexOf("hammadde fiyatı onay bekliyor ("));
});

test("e-posta konusu: yeni onaya düşen fiyat ötekilerin arkasına eklenir; eskisi yalnız bölümde görünür", () => {
  const withInvoices: DigestInvoices = { ...invoices, priceHolds: holds(1).priceHolds };
  assert.equal(renderDigest([], "2026-10-22", withInvoices, prices).subject, "Sabah özeti: 2 yeni fatura · 2 fiyat onay bekliyor · 1 hammaddeye zam");
  assert.equal(renderDigest(rows, "2026-10-22", holds(1), prices).subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan · 2 fiyat onay bekliyor · 1 hammaddeye zam");
  assert.equal(renderDigest([], "2026-10-22", holds(2), null, system).subject, "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim) · 2 fiyat onay bekliyor");
  assert.equal(
    renderDigest([], "2026-10-22", { ...holds(1), syncError: "401" }, prices).subject,
    "Paraşüt eşitlemesi başarısız · 2 fiyat onay bekliyor · 1 hammaddeye zam",
  );
  // Kontrol bekleyen önce gelir
  assert.equal(renderDigest([], "2026-10-22", { ...holds(1), reviewCount: 3 }).subject, "Sabah özeti: 3 fatura kontrol bekliyor · 2 fiyat onay bekliyor");
  // Son e-postadan beri yenisi yoksa konu ve başlık değişmez, kutu durur
  const stale = renderDigest(rows, "2026-10-22", holds(0));
  assert.equal(stale.subject, "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan");
  assert.ok(stale.html.includes("2 hammadde fiyatı onay bekliyor ("));
  const zamOnly = renderDigest([], "2026-10-22", holds(0), prices);
  assert.equal(zamOnly.subject, "Sabah özeti: 1 hammaddeye zam");
  assert.ok(zamOnly.html.includes(">Ürünleri aç</a>"));
  // Fiyat onayı yokken konu eskisi gibi
  assert.equal(renderDigest([], "2026-10-22", { ...invoices, priceHolds: null }, prices).subject, "Sabah özeti: 2 yeni fatura · 1 hammaddeye zam");
});

test("e-posta: yalnız yeni onaya düşen fiyat e-postayı gönderir; özet satırı", () => {
  assert.equal(invoiceNewsOf(holds(1)), true);
  assert.equal(invoiceNewsOf(holds(0)), false);
  assert.equal(invoiceNewsOf({ items: [], reviewCount: 4, syncError: null }), false);
  assert.equal(invoiceNewsOf(invoices), true);
  assert.equal(digestSummary({ count: 1, invoices: 2, holds: 1, prices: 1 }), "1 hatırlatma · 2 yeni fatura · 1 fiyat onayı · 1 zam");
  assert.equal(digestSummary({ holds: 0 }), "");
});

// ---------------------------------------------------------------- Ortak kabuk ve ek kutular (W2.0, CRITIQUE2 R8 / R11)

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("e-posta kabuğu: alt not verilmezse bildirim adresleri notu, verilirse o (kaçışlı); esc ve FONT dışa açık", () => {
  const shell = { subject: "Haftalık özet: 3 konu", preheader: "19–25 Ekim · 3 konu", brandSub: "Haftalık özet", today: "2026-10-26", card: "<p>kart</p>" };
  const plain = emailLayout(shell);
  assert.ok(plain.includes(">Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler &amp; hatırlatıcılar sayfasından değiştirebilirsiniz.</td>"));
  assert.ok(plain.includes("<p>kart</p>"));
  assert.ok(plain.includes("26 Ekim Pazartesi"));
  assert.ok(plain.includes("<title>Haftalık özet: 3 konu</title>"));
  const own = emailLayout({ ...shell, footer: "Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet." });
  assert.ok(own.includes(">Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler &amp; hatırlatıcılar › E-posta bildirimleri › Haftalık özet.</td>"));
  assert.ok(!own.includes("bildirim adreslerine gönderildi"));
  assert.ok(emailLayout({ ...shell, footer: "<script>" }).includes(">&lt;script&gt;</td>"));
  // Sabah ve bekçi e-postası aynı kabukta, aynı notla
  assert.ok(renderDigest(rows, "2026-10-20").html.includes("bildirim adreslerine gönderildi. Adresleri Ödemeler &amp; hatırlatıcılar"));
  assert.ok(renderSystemAlert(system.items, "2026-10-22").html.includes("bildirim adreslerine gönderildi."));
  assert.equal(esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.match(FONT, /^-apple-system,.*Geist/);
});

const com: DigestBox = {
  title: "Komisyon ve hakediş",
  lines: [
    { strong: "Hakediş gecikti: Pluxee (Ekim)", text: "Beklenen ≈ 1.234 ₺; son gün 30 Kasım'dı <not>" },
    { text: "Yemek kartı oranı %7,2 (sınır %6) olabilir", tone: "bad" },
  ],
  href: "/panel/komisyonlar",
  link: "Komisyon & hakediş'te aç",
  subjectPart: "Hakediş gecikti: Pluxee (Ekim)",
  headline: "Hakediş gecikti: Pluxee (Ekim)",
};
const kon: DigestBox = {
  title: "Kontrol listeleri · 21 Ekim Salı",
  lines: [
    { strong: "Kapanış", text: "hiç açılmadı" },
    { text: "Buzdolabı: 6 °C (0–4 °C) · Ayşe: <b>kapı açık</b>", tone: "bad" },
    { text: "Dün kasa raporu da girilmedi; kafe kapalıysa bu bölümü önemsemeyin.", tone: "muted" },
  ],
  href: "/panel/kontrol/gecmis?gun=2026-10-21",
  link: "Kontrol geçmişi",
  subjectPart: "dünkü kapanış listesi eksik",
  headline: "Dünkü kontrol listelerinde eksik var",
};
const fc: DigestBox = {
  title: "Satış tahmini",
  lines: [{ text: "Bugün ≈ 18.500 ₺ (16.000–21.000) · yoğunluk yüksek · 2 kişi" }, { text: "Hava: MET Norway", tone: "muted" }],
  href: "/panel/tahmin",
  link: "Ayrıntı",
  subjectPart: null,
  headline: null,
};
const one = [{ item: item({ title: "Kira" }), stage: "due" as const }];
const subj = (r: typeof rows, inv: DigestInvoices | null, pr: DigestPrices | null, sys: typeof system | null, ex: DigestExtras) => renderDigest(r, "2026-10-22", inv, pr, sys, ex).subject;

test("ek kutular: verilmezse ya da boşsa e-posta kutusuz hâliyle birebir aynı (konu, HTML, düz metin)", async () => {
  const empty = await collectDigestExtras([], "2026-10-22", { preview: false });
  assert.deepEqual(empty, { extras: {}, news: false, logKeys: [], parts: [] });
  const invs = [null, invoices, { items: [], reviewCount: 0, syncError: "401" }, { items: [], reviewCount: 3, syncError: null }, holds(0), holds(1)];
  for (const r of [[], one, rows]) {
    for (const inv of invs) {
      for (const pr of [null, prices]) {
        for (const sys of [null, system]) {
          const before = renderDigest(r, "2026-10-22", inv, pr, sys);
          for (const ex of [undefined, null, {}, { commission: null, kontrol: null, forecast: null }, empty.extras]) {
            assert.deepEqual(renderDigest(r, "2026-10-22", inv, pr, sys, ex), before);
          }
        }
      }
    }
  }
});

test("ek kutular: gövde sırası sistem, ödemeler, faturalar, kontrol bekleyen, fiyat onayı, komisyon, kontrol, zam, tahmin, düğme", () => {
  const all = renderDigest(rows, "2026-10-22", { ...invoices, priceHolds: holds(1).priceHolds }, prices, system, { commission: com, kontrol: kon, forecast: fc });
  const marks = [
    "Sistem uyarıları · 2",
    "Gecikenler · 1",
    "Paraşüt'ten gelen yeni faturalar · 2",
    "faturanın kategorisi tahminle yazıldı",
    "hammadde fiyatı onay bekliyor (",
    ">Komisyon ve hakediş</div>",
    ">Kontrol listeleri · 21 Ekim Salı</div>",
    "Hammadde zamları · 1",
    ">Satış tahmini</div>",
    ">Panelde aç</a>",
  ];
  const at = marks.map((m) => all.html.indexOf(m));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  const textMarks = ["Sistem uyarıları (2)", "Gecikenler (1)", "Paraşüt'ten gelen yeni faturalar (2)", "1 fatura kontrol bekliyor:", "2 hammadde fiyatı onay bekliyor (", "Komisyon ve hakediş", "Kontrol listeleri · 21 Ekim Salı", "Hammadde zamları (1)", "Satış tahmini", "Panelde aç:"];
  const tat = textMarks.map((m) => all.text.indexOf(m));
  assert.ok(tat.every((i) => i > 0), JSON.stringify(tat));
  assert.deepEqual([...tat].sort((a, b) => a - b), tat);
});

test("ek kutu: başlık, satırlar (kalın, kırmızı, sönük), bağlantı; kullanıcı metni kaçışlı; telefonda taşmaz (nowrap yok)", () => {
  const { html, text } = renderDigest([], "2026-10-22", null, null, null, { commission: com, kontrol: kon });
  assert.ok(html.includes('background:#fff7ed;border-radius:14px;padding:12px 14px;'));
  assert.ok(html.includes("<strong>Hakediş gecikti: Pluxee (Ekim)</strong><br>Beklenen ≈ 1.234 ₺; son gün 30 Kasım&#39;dı &lt;not&gt;</div>"));
  assert.ok(html.includes('<div style="margin-top:6px;color:#b91c1c">Yemek kartı oranı %7,2 (sınır %6) olabilir</div>'));
  assert.ok(html.includes("Ayşe: &lt;b&gt;kapı açık&lt;/b&gt;"));
  assert.ok(!html.includes("<b>kapı"));
  assert.ok(html.includes('<div style="margin-top:6px;color:#71717a;font-size:13px;line-height:18px">Dün kasa raporu da girilmedi;'));
  assert.ok(html.includes(`<a href="${APP_URL}/panel/komisyonlar" style="color:#9a3412;font-weight:600">Komisyon &amp; hakediş&#39;te aç →</a>`));
  assert.ok(html.includes(`<a href="${APP_URL}/panel/kontrol/gecmis?gun=2026-10-21" style="color:#9a3412;font-weight:600">Kontrol geçmişi →</a>`));
  const box = html.slice(html.indexOf(">Komisyon ve hakediş</div>"), html.indexOf("Kontrol geçmişi →"));
  assert.ok(!box.includes("nowrap"));
  assert.ok(text.includes(`\n\nKomisyon ve hakediş\n- Hakediş gecikti: Pluxee (Ekim): Beklenen ≈ 1.234 ₺; son gün 30 Kasım'dı <not>\n- Yemek kartı oranı %7,2 (sınır %6) olabilir\nKomisyon & hakediş'te aç: ${APP_URL}/panel/komisyonlar\n`));
  assert.ok(text.includes(`\n- Kapanış: hiç açılmadı\n`));
  // Tahmin kutusu gri
  const f = renderDigest(one, "2026-10-22", null, null, null, { forecast: fc }).html;
  assert.ok(f.includes('background:#f4f4f5;border-radius:14px;padding:12px 14px;font-family:'));
  assert.ok(f.includes(`<a href="${APP_URL}/panel/tahmin" style="color:#3f3f46;font-weight:600">Ayrıntı →</a>`));
});

test("ek kutu bağlantısı yalnız panel yolu: fotoğraf, Blob ya da dış adres panelin girişine düşer; düğme de", () => {
  for (const bad of [
    "/api/foto/12",
    "https://abc.private.blob.vercel-storage.com/kontrol/1.jpg",
    "//evil.example/panel",
    "javascript:alert(1)",
    "/panelx",
    "panel/kontrol",
    "",
    "/panel/../api/foto/12",
    "/panel/%2e%2e/api/foto/12",
    "/panel/./kontrol",
    "/panel//evil.example",
    "/panel/kontrol gecmis",
  ]) {
    const { html, text } = renderDigest([], "2026-10-22", null, null, null, { kontrol: { ...kon, href: bad } });
    assert.ok(html.includes(`<a href="${APP_URL}/panel" style="color:#9a3412;font-weight:600">Kontrol geçmişi →</a>`), bad);
    assert.ok(html.includes(`<a href="${APP_URL}/panel" style="display:block;`), bad);
    assert.ok(!html.includes("/api/foto") && !html.includes("blob.vercel-storage") && !html.includes("evil.example") && !html.includes("javascript:"), bad);
    assert.ok(text.endsWith(`Kontrol geçmişi: ${APP_URL}/panel`), bad);
  }
  const amp = renderDigest([], "2026-10-22", null, null, null, { kontrol: { ...kon, href: "/panel/kontrol/gecmis?gun=2026-10-21&liste=2" } });
  assert.ok(amp.html.includes(`href="${APP_URL}/panel/kontrol/gecmis?gun=2026-10-21&amp;liste=2"`));
  assert.ok(amp.text.endsWith(`Kontrol geçmişi: ${APP_URL}/panel/kontrol/gecmis?gun=2026-10-21&liste=2`));
  for (const good of ["/panel", "/panel/", "/panel/komisyonlar?ay=2026-09#trendyol", "/panel/mal-siparisi/kalemler", "/panel/hatirlaticilar#e_posta"]) {
    assert.ok(renderDigest([], "2026-10-22", null, null, null, { kontrol: { ...kon, href: good } }).text.endsWith(`Kontrol geçmişi: ${APP_URL}${good}`), good);
  }
});

test("konu sırası (R11): ödeme, sistem uyarısı, eşitleme hatası, sabah özeti; ek parçalar hep aynı sırada (fatura, fiyat onayı, zam, komisyon, kontrol)", () => {
  const withHolds: DigestInvoices = { ...invoices, priceHolds: holds(1).priceHolds };
  const full = { commission: com, kontrol: kon, forecast: fc };
  // 1. Ödeme
  assert.equal(subj(one, null, null, null, { commission: com }), "Ödeme hatırlatması: 1 bugün · Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(
    subj(rows, withHolds, prices, system, full),
    "Ödeme hatırlatması: 1 gecikmiş, 1 bugün, 1 yaklaşan · sistem uyarısı · 2 yeni fatura · 2 fiyat onay bekliyor · 1 hammaddeye zam · Hakediş gecikti: Pluxee (Ekim) · dünkü kapanış listesi eksik",
  );
  assert.equal(subj(one, null, prices, null, { kontrol: kon }), "Ödeme hatırlatması: 1 bugün · 1 hammaddeye zam · dünkü kapanış listesi eksik");
  // 2. Sistem uyarısı
  assert.equal(subj([], null, null, system, { commission: com, kontrol: kon }), "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim) · Hakediş gecikti: Pluxee (Ekim) · dünkü kapanış listesi eksik");
  assert.equal(subj([], invoices, prices, system, { kontrol: kon }), "Sistem uyarısı: Dünkü sabah işi çalışmadı (21 Ekim) · 2 yeni fatura · 1 hammaddeye zam · dünkü kapanış listesi eksik");
  // 3. Yeni faturasız eşitleme hatası
  assert.equal(subj([], { items: [], reviewCount: 0, syncError: "401" }, null, null, { commission: com }), "Paraşüt eşitlemesi başarısız · Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(
    subj([], { ...holds(1), syncError: "401" }, prices, null, full),
    "Paraşüt eşitlemesi başarısız · 2 fiyat onay bekliyor · 1 hammaddeye zam · Hakediş gecikti: Pluxee (Ekim) · dünkü kapanış listesi eksik",
  );
  // 4. Sabah özeti: ilk haber yeni fatura, kontrol bekleyen, fiyat onayı, komisyon ya da kontrol; ötekiler kendi sırasında
  assert.equal(subj([], invoices, prices, null, full), "Sabah özeti: 2 yeni fatura · 1 hammaddeye zam · Hakediş gecikti: Pluxee (Ekim) · dünkü kapanış listesi eksik");
  assert.equal(subj([], { items: [], reviewCount: 3, syncError: null }, null, null, { commission: com }), "Sabah özeti: 3 fatura kontrol bekliyor · Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(subj([], holds(1), null, null, { kontrol: kon }), "Sabah özeti: 2 fiyat onay bekliyor · dünkü kapanış listesi eksik");
  assert.equal(subj([], null, null, null, { commission: com }), "Sabah özeti: Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(subj([], null, prices, null, { commission: com }), "Sabah özeti: Hakediş gecikti: Pluxee (Ekim) · 1 hammaddeye zam");
  assert.equal(subj([], null, null, null, { kontrol: kon }), "Sabah özeti: dünkü kapanış listesi eksik");
  assert.equal(subj([], null, prices, null, { kontrol: kon }), "Sabah özeti: dünkü kapanış listesi eksik · 1 hammaddeye zam");
  assert.equal(subj([], null, prices, null, { commission: com, kontrol: kon }), "Sabah özeti: Hakediş gecikti: Pluxee (Ekim) · 1 hammaddeye zam · dünkü kapanış listesi eksik");
  // Eski onay bekleyen fiyat konuya girmez, kutunun parçası girer
  assert.equal(subj([], holds(0), null, null, { kontrol: kon }), "Sabah özeti: dünkü kapanış listesi eksik");
  // 5. Yalnız zam ya da hiçbir şey; tahmin konuya girmez
  assert.equal(subj([], null, prices, null, { forecast: fc }), "Sabah özeti: 1 hammaddeye zam");
  assert.equal(subj([], null, null, null, { forecast: fc }), "Sabah özeti: bugün yeni bir şey yok");
  // Konu parçası olmayan kutu konuya girmez
  assert.equal(subj([], null, prices, null, { commission: { ...com, subjectPart: null } }), "Sabah özeti: 1 hammaddeye zam");
  assert.equal(subj(one, null, null, null, { commission: { ...com, subjectPart: null } }), "Ödeme hatırlatması: 1 bugün");
});

test("başlık ve düğme: kutu fiyat onayından sonra, zamdan önce; yalnız kutu varsa kapanış notu yok; ön metin konunun parçalarıyla", () => {
  const h1 = (ex: DigestExtras, inv: DigestInvoices | null = null, pr: DigestPrices | null = null) => /<h1[^>]*>([^<]*)<\/h1>/.exec(renderDigest([], "2026-10-22", inv, pr, null, ex).html)?.[1];
  assert.equal(h1({ commission: com }), "Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(h1({ kontrol: kon }), "Dünkü kontrol listelerinde eksik var");
  assert.equal(h1({ commission: com, kontrol: kon }), "Hakediş gecikti: Pluxee (Ekim)");
  assert.equal(h1({ commission: { ...com, headline: null }, kontrol: kon }), "Dünkü kontrol listelerinde eksik var");
  assert.equal(h1({ kontrol: kon }, null, prices), "Dünkü kontrol listelerinde eksik var");
  assert.equal(h1({ kontrol: kon }, holds(1)), "2 hammadde fiyatı onay bekliyor");
  assert.equal(h1({ kontrol: kon }, invoices), "Paraşüt&#39;ten 2 yeni fatura geldi");

  const comOnly = renderDigest([], "2026-10-22", null, null, null, { commission: com });
  assert.ok(comOnly.html.includes(`<a href="${APP_URL}/panel/komisyonlar" style="display:block;padding:15px 20px;`));
  assert.ok(comOnly.html.includes(">Komisyon &amp; hakediş&#39;te aç</a>"));
  assert.ok(comOnly.text.endsWith(`Komisyon & hakediş'te aç: ${APP_URL}/panel/komisyonlar`));
  assert.ok(!comOnly.html.includes('<p style="margin:12px 0 0;'));
  // Kontrol, zamdan önce düğmeye geçer; fiyat onayı ve fatura kutudan önce
  assert.ok(renderDigest([], "2026-10-22", null, prices, null, { kontrol: kon }).html.includes(">Kontrol geçmişi</a>"));
  assert.ok(renderDigest([], "2026-10-22", holds(1), null, null, { kontrol: kon }).html.includes(">Hammaddeleri aç</a>"));
  assert.ok(renderDigest([], "2026-10-22", invoices, null, null, { kontrol: kon }).html.includes(">Faturaları aç</a>"));
  assert.ok(renderDigest(one, "2026-10-22", null, null, null, { kontrol: kon }).html.includes(">Panelde aç</a>"));
  // Sistem uyarısıyla: düğme kutuya, not sistemin
  const withSys = renderDigest([], "2026-10-22", null, null, system, { commission: com });
  assert.ok(withSys.html.includes(">Komisyon &amp; hakediş&#39;te aç</a>"));
  assert.ok(withSys.html.includes("İş yeniden düzgün çalışınca uyarı kendiliğinden kalkar."));
  // Fatura ya da zam varsa not eskisi gibi
  assert.ok(renderDigest([], "2026-10-22", null, prices, null, { kontrol: kon }).html.includes(">Faturalar her sabah Paraşüt'ten kendiliğinden gelir; kategorisi tahmin edilenleri panelde onaylayın.</p>"));
  // Ön metin: ödemeyle konunun ek parçaları, ödemesizken başlık
  assert.ok(renderDigest(one, "2026-10-22", null, null, null, { commission: com }).html.includes(`>1 bugün · toplam 25.000${NBSP}₺ · Hakediş gecikti: Pluxee (Ekim)</div>`));
});

test("tahmin kutusu konuya, başlığa, düğmeye ve habere girmez; yalnız gövdede (zamdan sonra) ve düz metinde", async () => {
  const sneaky: DigestBox = { ...fc, subjectPart: "tahmin", headline: "Tahmin başlığı" };
  for (const [r, inv, pr, sys] of [[[], null, null, null], [[], null, prices, null], [one, null, null, null], [[], null, null, system], [[], invoices, null, null]] as const) {
    const without = renderDigest([...r], "2026-10-22", inv, pr, sys);
    const withFc = renderDigest([...r], "2026-10-22", inv, pr, sys, { forecast: sneaky });
    assert.equal(withFc.subject, without.subject);
    assert.equal(/<h1[^>]*>([^<]*)<\/h1>/.exec(withFc.html)?.[1], /<h1[^>]*>([^<]*)<\/h1>/.exec(without.html)?.[1]);
    assert.equal(withFc.text.split("\n").at(-1), without.text.split("\n").at(-1));
    assert.ok(withFc.html.includes(">Satış tahmini</div>"));
    assert.ok(withFc.text.includes("\nSatış tahmini\n- Bugün ≈ 18.500 ₺ (16.000–21.000) · yoğunluk yüksek · 2 kişi\n- Hava: MET Norway\nAyrıntı: "));
  }
  // Haber sayılmaz: kaynak yanlışlıkla news: true dese de
  const silence = mock.method(console, "error", () => {});
  try {
    const src = { key: "forecast", news: true, load: async () => ({ box: sneaky, logKeys: [] }) } as unknown as DigestExtraSource;
    const r = await collectDigestExtras([src], "2026-10-22", { preview: false });
    assert.equal(r.news, false);
    assert.deepEqual(r.parts, []);
    assert.equal(r.extras.forecast, sneaky);
  } finally {
    silence.mock.restore();
  }
});

test("ek kutuların toplanması: aynı anda, her biri en çok 4 sn; hata ve süre aşımı kutuyu düşürür; haber, anahtarlar, önizleme", async () => {
  assert.equal(DIGEST_EXTRA_MS, 4_000);
  const errors = mock.method(console, "error", () => {});
  try {
    const seen: unknown[] = [];
    const sources: DigestExtraSource[] = [
      {
        key: "commission",
        news: true,
        load: async (today, ctx) => {
          seen.push([today, ctx]);
          return { box: com, logKeys: ["komisyon:gecikti:pluxee:2026-10", "komisyon:gecikti:pluxee:2026-10", ""] };
        },
      },
      { key: "kontrol", news: true, load: async () => Promise.reject(new Error("tablo yok")) },
      { key: "forecast", news: false, load: async () => ({ box: fc, logKeys: [] }) },
    ];
    const r = await collectDigestExtras(sources, "2026-10-23", { preview: true });
    assert.deepEqual(seen, [["2026-10-23", { preview: true }]]);
    assert.deepEqual(Object.keys(r.extras), ["commission", "forecast"]);
    assert.equal(r.news, true);
    assert.deepEqual(r.logKeys, ["komisyon:gecikti:pluxee:2026-10"]);
    assert.deepEqual(r.parts, ["Hakediş gecikti: Pluxee (Ekim)"]);
    assert.equal(errors.mock.callCount(), 1);
    assert.match(String(errors.mock.calls[0].arguments[0]), /Sabah e-postası ek kutusu \(kontrol\)/);

    // Süresi dolan kaynak beklenmez; zaman uyumlu hata da yakalanır; boş dönen kutu yok sayılır
    const t0 = Date.now();
    const slow = await collectDigestExtras(
      [
        { key: "kontrol", news: true, load: () => new Promise(() => {}) },
        {
          key: "commission",
          news: true,
          load: () => {
            throw new Error("zaman uyumlu");
          },
        },
        { key: "forecast", news: false, load: async () => null },
      ],
      "2026-10-23",
      { preview: false },
      30,
    );
    assert.ok(Date.now() - t0 < 1000);
    assert.deepEqual(slow, { extras: {}, news: false, logKeys: [], parts: [] });
    assert.ok(errors.mock.calls.some((c) => /\(kontrol\): 0\.03 sn içinde yüklenemedi/.test(String(c.arguments[0]))));

    // Aynı anda: ikinci kaynak birincisi bitmeden başlar
    const started: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const pending = collectDigestExtras(
      [
        {
          key: "commission",
          news: true,
          load: async () => {
            started.push("commission");
            await gate;
            return { box: com, logKeys: [] };
          },
        },
        {
          key: "kontrol",
          news: false,
          load: async () => {
            started.push("kontrol");
            await gate;
            return { box: kon, logKeys: [] };
          },
        },
      ],
      "2026-10-23",
      { preview: false },
    );
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(started, ["commission", "kontrol"]);
    release();
    const both = await pending;
    // Haber yalnız haber olan kaynaktan; konu parçası da yalnız onun
    assert.equal(both.news, true);
    assert.deepEqual(both.parts, ["Hakediş gecikti: Pluxee (Ekim)"]);
    assert.equal((await collectDigestExtras([{ key: "kontrol", news: false, load: async () => ({ box: kon, logKeys: ["kontrol:2026-10-22"] }) }], "2026-10-23", { preview: false })).news, false);

    // Aynı anahtarlı ikinci kaynak yok sayılır
    const dup = await collectDigestExtras(
      [
        { key: "commission", news: true, load: async () => ({ box: com, logKeys: ["komisyon:a"] }) },
        { key: "commission", news: true, load: async () => ({ box: { ...com, title: "İkinci" }, logKeys: ["komisyon:b"] }) },
      ],
      "2026-10-23",
      { preview: false },
    );
    assert.equal(dup.extras.commission?.title, "Komisyon ve hakediş");
    assert.deepEqual(dup.logKeys, ["komisyon:a"]);
  } finally {
    errors.mock.restore();
  }
});

test("sabah e-postası: ek kutular ötekilerle aynı anda yüklenir; haber, tekil anahtar ve günlük satırları yalnız kutu varsa değişir; gönderim sınırı", () => {
  const extrasSrc = read("src/server/notify/digest-extras.ts");
  assert.ok(extrasSrc.startsWith('import "server-only";'));
  assert.match(extrasSrc, /export const DIGEST_EXTRA_SOURCES: DigestExtraSource\[\] = \[/);
  assert.match(extrasSrc, /return collectDigestExtras\(DIGEST_EXTRA_SOURCES, today, \{ preview: o\.preview \?\? false \}\);/);

  const digest = read("src/server/notify/digest.ts");
  const run = digest.slice(digest.indexOf("export async function runReminderDigest"), digest.indexOf("/** Son gönderimler"));
  // Kapalı ya da Resend'siz e-posta kutu yüklemez; yükleme ötekilerle aynı anda başlar
  assert.ok(run.indexOf("const extrasP = loadDigestExtras(today);") > run.indexOf('off: "nokey"'));
  assert.ok(run.indexOf("const extrasP = loadDigestExtras(today);") < run.indexOf("await loadDigestInvoices()"));
  assert.match(run, /if \(!fresh\.length && !invoiceNews && !prices && !system\.length && !extras\.news\) \{/);
  assert.match(run, /system\.length \? \{ items: system \} : null,\s*extras\.extras,\s*\);/);
  // Tekil anahtarın tohumu kutusuzken eskisiyle aynı (boş dizi yayılır, ayraç eklenmez)
  assert.match(run, /system\.length \? `sys:\$\{system\.map\(\(p\) => p\.key\)\.join\(","\)\}` : "",\s*\/\/[^\n]*\n\s*\.\.\.\(extras\.logKeys\.length \? \[`ek:\$\{extras\.logKeys\.join\(","\)\}`\] : \[\]\),\s*\]\.join\("\|"\);/);
  // Günlüğe yalnız başarılı gönderimden sonra
  assert.ok(run.indexOf("...extras.logKeys.map((key) => ({ key, subject, recipients: to.join(\", \"), ok: true }))") > run.indexOf("if (!res.ok) {"));
  assert.match(run, /\.\.\.\(extras\.parts\.length \? \{ boxes: extras\.parts \} : \{\}\),/);
  // Gönderim sınırı yalnız sabah işinden; elle gönderim seçeneksiz (bugünkü gibi)
  assert.match(run, /ctx\.sendDeadlineAt === undefined \? undefined : \{ deadlineAt: ctx\.sendDeadlineAt \},/);

  // Önizleme kutuları yazmadan yükler; örnek satır yalnız hiç haber yoksa
  const actions = read("src/server/actions/reminders.ts");
  const preview = actions.slice(actions.indexOf("export async function previewDigest"), actions.indexOf("export async function runDigestNow"));
  assert.match(preview, /loadDigestExtras\(today, \{ preview: true \}\)/);
  assert.match(preview, /const sample = !due\.length && !invoiceNews && !prices && !system\.length && !extras\.news;/);
  assert.match(preview, /extras\.extras,\s*\);/);
});

test("bildirim özeti: haber olan ek kutuların parçaları fiyat onayından sonra, zamdan önce", () => {
  assert.equal(digestSummary({ count: 1, holds: 1, prices: 2, boxes: ["Hakediş gecikti: Pluxee (Ekim)", "dünkü kapanış listesi eksik"] }), "1 hatırlatma · 1 fiyat onayı · Hakediş gecikti: Pluxee (Ekim) · dünkü kapanış listesi eksik · 2 zam");
  assert.equal(digestSummary({ boxes: ["dünkü kapanış listesi eksik"] }), "dünkü kapanış listesi eksik");
  assert.equal(digestSummary({ count: 1, boxes: [] }), "1 hatırlatma");
});
