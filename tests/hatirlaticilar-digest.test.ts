import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("e-posta: mal alışı sayılmayan fatura “kategorisi tahminle yazıldı” sayılmaz (denetim B03)", () => {
  const html = (reviewCount: number, stockOnlyCount?: number) => renderDigest([], "2026-10-22", { items: [], reviewCount, stockOnlyCount, syncError: null }).html;
  assert.ok(html(3).includes("3 faturanın kategorisi tahminle yazıldı. <a"));
  assert.ok(html(3, 0).includes("3 faturanın kategorisi tahminle yazıldı. <a"));
  const mixed = html(3, 2);
  assert.ok(mixed.includes("1 faturanın kategorisi tahminle yazıldı. 2 fatura mal alışı sayılmıyor: kalemi hammaddeye bağlı, kategorisi mal alışı değil. <a"));
  const only = html(2, 2);
  assert.ok(!only.includes("tahminle yazıldı"));
  assert.ok(only.includes("2 fatura mal alışı sayılmıyor"));
});

test("e-posta: kasadan faturalı alımlar Paraşüt bölümünde söylenir, e-postayı tek başına göndermez (denetim E-42)", () => {
  const cashOuts = { count: 2, summary: "D&R 2.400 ₺ ve 1 alım daha" };
  const inv: DigestInvoices = { items: [], reviewCount: 0, cashOuts, syncError: null };
  assert.equal(invoiceNewsOf(inv), false, "haber değil");
  const r = renderDigest([], "2026-10-22", inv);
  assert.ok(r.html.includes("2 kasadan faturalı alım Faturalar'da yok (D&amp;R 2.400 ₺ ve 1 alım daha): Faturalar'a ekleyin ya da Aylık harcamalar'a yazın"));
  assert.ok(r.html.includes(`href="${APP_URL}/panel/faturalar?durum=kontrol#kasa-faturali"`));
  assert.ok(r.text.includes(`2 kasadan faturalı alım Faturalar'da yok (D&R 2.400 ₺ ve 1 alım daha): Faturalar'a ekleyin ya da Aylık harcamalar'a yazın, yoksa gelir-gidere girmez. ${APP_URL}/panel/faturalar?durum=kontrol#kasa-faturali`));
  assert.ok(r.html.includes(`${APP_URL}/panel/faturalar?durum=kontrol"`), "düğme Kontrol süzgecine");
  // Kontrol bekleyen kutusundan sonra; yoksa hiç
  const both = renderDigest([], "2026-10-22", { ...inv, reviewCount: 3 }).html;
  assert.ok(both.indexOf("faturanın kategorisi tahminle yazıldı") < both.indexOf("kasadan faturalı alım"));
  assert.ok(!renderDigest([], "2026-10-22", { ...inv, reviewCount: 3, cashOuts: null }).html.includes("kasadan faturalı"));
  // Aylık harcamalar'a yazılmışken faturası gelen (iki kez sayılıyor; inceleme D2): tek başına da söylenir
  const twice = renderDigest([], "2026-10-22", { ...inv, cashOuts: { count: 0, summary: "", duplicates: 1 } });
  assert.ok(twice.text.includes(`1 kasa alımı iki kez sayılıyor (Aylık harcamalar'a yazılmıştı, faturası sonra geldi): gider kaydını silin. ${APP_URL}/panel/faturalar?durum=kontrol#kasa-faturali`));
  assert.ok(!twice.text.includes("kasadan faturalı alım Faturalar'da yok"));
  const mixed = renderDigest([], "2026-10-22", { ...inv, cashOuts: { ...cashOuts, duplicates: 2 } }).text;
  assert.ok(mixed.includes("yoksa gelir-gidere girmez. 2 kasa alımı iki kez sayılıyor"));
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
  assert.ok(plain.includes(">Bu e-posta ladmin.laffogato.net bildirim adreslerine gönderildi. Adresleri Ödemeler sayfasından değiştirebilirsiniz.</td>"));
  assert.ok(plain.includes("<p>kart</p>"));
  assert.ok(plain.includes("26 Ekim Pazartesi"));
  assert.ok(plain.includes("<title>Haftalık özet: 3 konu</title>"));
  const own = emailLayout({ ...shell, footer: "Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler & hatırlatıcılar › E-posta bildirimleri › Haftalık özet." });
  assert.ok(own.includes(">Bu özet her pazartesi panel yöneticilerine gider. Kapatmak için: Ödemeler &amp; hatırlatıcılar › E-posta bildirimleri › Haftalık özet.</td>"));
  assert.ok(!own.includes("bildirim adreslerine gönderildi"));
  assert.ok(emailLayout({ ...shell, footer: "<script>" }).includes(">&lt;script&gt;</td>"));
  // Sabah ve bekçi e-postası aynı kabukta, aynı notla
  assert.ok(renderDigest(rows, "2026-10-20").html.includes("bildirim adreslerine gönderildi. Adresleri Ödemeler sayfasından"));
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
/* Genel bir ek kutu (satış tahmini 4 Kasım 2026'da kaldırıldı; kutu düzeninin
   testi karaoke kutusuyla sürüyor) */
const fc: DigestBox = {
  title: "Karaoke",
  lines: [{ text: "Bugün 3 rezervasyon · 1 rezervasyonsuz" }, { text: "Oda 20:00'de dolu", tone: "muted" }],
  href: "/panel/karaoke",
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

test("kutusuz sabah e-postası W2.0 öncesiyle birebir aynı: konu, HTML ve düz metnin özeti 0671969'daki şablonunkiyle aynı", () => {
  // Şablon bilerek değişirse bu değerler yenilenir; APP_URL ortamdan bağımsız olsun diye yer tutucuya çevrilir. 29 Eki
  // 2026: yalnız alt not değişti ("Ödemeler & hatırlatıcılar" → "Ödemeler", docs/planlar/ux-sade.md §3.10); eski notla
  // dört özet eskisiyle aynıydı. 30 Eki 2026: kapanış notu düğmenin yeni adıyla ("“Ödedim” ile işaretleyin", K18); eski
  // notla dört özet eskisiyle aynıydı, değişen yalnız hatırlatma satırlı ilki
  const sha = (r: { subject: string; html: string; text: string }) =>
    createHash("sha256").update([r.subject, r.html, r.text].join("\u0000").replaceAll(APP_URL, "{APP_URL}")).digest("hex").slice(0, 16);
  assert.equal(sha(renderDigest(rows, "2026-10-22", { ...invoices, priceHolds: holds(1).priceHolds }, prices, system)), "cec006d1f11c6ba4");
  assert.equal(sha(renderDigest([], "2026-10-22", holds(1))), "4bc12f6bec7c8664");
  assert.equal(sha(renderDigest([], "2026-10-22", { items: [], reviewCount: 0, syncError: "401" }, prices)), "265d05fbed6eb763");
  assert.equal(sha(renderDigest([], "2026-10-22")), "a1dab6e01442bef7");
});

test("ek kutular: gövde sırası sistem, ödemeler, faturalar, kontrol bekleyen, fiyat onayı, komisyon, kontrol, zam, karaoke, düğme", () => {
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
    ">Karaoke</div>",
    ">Panelde aç</a>",
  ];
  const at = marks.map((m) => all.html.indexOf(m));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  const textMarks = ["Sistem uyarıları (2)", "Gecikenler (1)", "Paraşüt'ten gelen yeni faturalar (2)", "1 fatura kontrol bekliyor:", "2 hammadde fiyatı onay bekliyor (", "Komisyon ve hakediş", "Kontrol listeleri · 21 Ekim Salı", "Hammadde zamları (1)", "Karaoke", "Panelde aç:"];
  const tat = textMarks.map((m) => all.text.indexOf(m));
  assert.ok(tat.every((i) => i > 0), JSON.stringify(tat));
  assert.deepEqual([...tat].sort((a, b) => a - b), tat);
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
  for (const good of ["/panel", "/panel/", "/panel/komisyonlar?ay=2026-09#trendyol", "/panel/sayim?ay=2026-10", "/panel/hatirlaticilar#e_posta"]) {
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

test("başlığı ya da konu parçası olmayan kutu tek içerikse e-posta 'yeni bir şey yok' demez: kutunun parçası, yoksa adı", async () => {
  const mail = (ex: DigestExtras, pr: DigestPrices | null = null) => {
    const r = renderDigest([], "2026-10-23", null, pr, null, ex);
    return {
      subject: r.subject,
      h1: /<h1[^>]*>([^<]*)<\/h1>/.exec(r.html)?.[1],
      pre: /<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">([^<]*)<\/div>/.exec(r.html)?.[1],
    };
  };
  const comNoHead = { ...com, headline: null };
  const comBare = { ...com, headline: null, subjectPart: null };
  const konBare = { ...kon, headline: null, subjectPart: null };
  // Başlıksız: başlık ve ön metin konu parçası
  assert.deepEqual(mail({ commission: comNoHead }), { subject: "Sabah özeti: Hakediş gecikti: Pluxee (Ekim)", h1: "Hakediş gecikti: Pluxee (Ekim)", pre: "Hakediş gecikti: Pluxee (Ekim)" });
  // Küçük harfle başlayan parça başlıkta büyük harfle (Türkçe: i → İ)
  assert.deepEqual(mail({ kontrol: { ...kon, headline: null } }), { subject: "Sabah özeti: dünkü kapanış listesi eksik", h1: "Dünkü kapanış listesi eksik", pre: "Dünkü kapanış listesi eksik" });
  assert.equal(mail({ kontrol: { ...kon, headline: null, subjectPart: "iki liste eksik" } }).h1, "İki liste eksik");
  // Başlığı ve parçası yok: konu ve başlık kutunun adı
  assert.deepEqual(mail({ commission: comBare }), { subject: "Sabah özeti: Komisyon ve hakediş", h1: "Komisyon ve hakediş", pre: "Komisyon ve hakediş" });
  assert.deepEqual(mail({ kontrol: konBare }), { subject: "Sabah özeti: Kontrol listeleri · 21 Ekim Salı", h1: "Kontrol listeleri · 21 Ekim Salı", pre: "Kontrol listeleri · 21 Ekim Salı" });
  // Önce parçası olan kutu (konu da onunla başlar), yoksa önce komisyon
  assert.deepEqual(mail({ commission: comBare, kontrol: { ...kon, headline: null } }), { subject: "Sabah özeti: dünkü kapanış listesi eksik", h1: "Dünkü kapanış listesi eksik", pre: "Dünkü kapanış listesi eksik" });
  assert.equal(mail({ commission: comBare, kontrol: konBare }).h1, "Komisyon ve hakediş");
  // Sıra değişmez: başlığı olan kutu ve zam önce gelir; parçası olmayan kutu konuya girmez
  assert.equal(mail({ commission: comBare, kontrol: kon }).h1, "Dünkü kontrol listelerinde eksik var");
  assert.deepEqual(mail({ commission: comBare }, prices), { subject: "Sabah özeti: 1 hammaddeye zam", h1: "1 hammaddenin fiyatı arttı", pre: "1 hammaddenin fiyatı arttı" });
  assert.equal(mail({ commission: comNoHead }, prices).h1, "1 hammaddenin fiyatı arttı");
  assert.equal(renderDigest(one, "2026-10-23", null, null, null, { commission: comBare }).subject, "Ödeme hatırlatması: 1 bugün");
  // Tahmin kutusu yine hiçbir şey söylemez
  assert.deepEqual(mail({ forecast: fc }), { subject: "Sabah özeti: bugün yeni bir şey yok", h1: "Bugün yeni bir şey yok", pre: "Bugün yeni bir şey yok" });
  assert.deepEqual(mail({ forecast: { ...fc, title: "Tahmin", subjectPart: "tahmin", headline: "Tahmin başlığı" } }), mail({}));

  // Bildirimdeki ve önizlemedeki özet satırı: parçası olmayan haber kutusu adıyla (tek haberse "Bugün: ." olmasın)
  const r = await collectDigestExtras(
    [
      { key: "commission", news: true, load: async () => ({ box: comBare, logKeys: [] }) },
      { key: "kontrol", news: false, load: async () => ({ box: konBare, logKeys: [] }) },
    ],
    "2026-10-23",
    { preview: true },
  );
  assert.equal(r.news, true);
  assert.deepEqual(r.parts, ["Komisyon ve hakediş"]);
  assert.equal(digestSummary({ boxes: r.parts }), "Komisyon ve hakediş");
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
  assert.match(extrasSrc, /return collectDigestExtras\(DIGEST_EXTRA_SOURCES, today, \{ preview: o\.preview \?\? false, scope: o\.scope \}\);/);

  const digest = read("src/server/notify/digest.ts");
  const run = digest.slice(digest.indexOf("export async function runReminderDigest"), digest.indexOf("/** Son gönderimler"));
  // Kapalı ya da Resend'siz e-posta kutu yüklemez; yükleme ötekilerle aynı anda başlar
  assert.ok(run.indexOf("const extrasP = loadDigestExtras(today);") > run.indexOf('off: "nokey"'));
  assert.ok(run.indexOf("const extrasP = loadDigestExtras(today);") < run.indexOf("await loadDigestInvoices()"));
  // Alıcı grupları (şube kapsamı C P1-11): grubun haberi bütün şubelerinkiyle aynı kural; grubun kutuları
  assert.match(run, /const news = groupFresh\.length > 0 \|\| invoiceNews \|\| !!prices \|\| system\.length > 0 \|\| groupExtras\.news;/);
  assert.match(run, /system\.length \? \{ items: system \} : null,\s*g\.extras\.extras,\s*g\.branch,\s*\);/);
  // Tekil anahtarın tohumu kutusuzken ve bütün şubelerin grubunda eskisiyle aynı (boş dizi yayılır, ayraç eklenmez)
  assert.match(run, /system\.length \? `sys:\$\{system\.map\(\(p\) => p\.key\)\.join\(","\)\}` : "",\s*\/\/[^\n]*\n\s*\.\.\.\(g\.extras\.logKeys\.length \? \[`ek:\$\{g\.extras\.logKeys\.join\(","\)\}`\] : \[\]\),/);
  assert.match(run, /\.\.\.\(g\.branchIds\.length \? \[`sube:\$\{g\.branchIds\.join\(","\)\}`\] : \[\]\),\s*\]\.join\("\|"\);/);
  // Günlüğe yalnız başarılı gönderimden sonra
  assert.ok(run.indexOf("...g.extras.logKeys.map((key) => ({ key, subject, recipients: to.join(\", \"), ok: true }))") > run.indexOf("if (!res.ok) {"));
  assert.match(run, /\.\.\.\(boxes\.size \? \{ boxes: \[\.\.\.boxes\] \} : \{\}\),/);
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


// Denetim 21 Kasım #18: elle gönderim ve önizleme sabah işi gibi "Tümü"yle okur, yöneticinin şube seçimiyle değil
test("sabah e-postası seçiciden bağımsız: gönderim (sabah işi ve şimdi gönder) ve önizleme Tümü kapsamında", () => {
  const digest = read("src/server/notify/digest.ts");
  const run = digest.slice(digest.indexOf("export async function runReminderDigest"), digest.indexOf("async function sendReminderDigest"));
  assert.match(run, /return withBranchScope\(ALL_BRANCHES, \(\) => sendReminderDigest\(trigger, ctx\)\);/);
  // Gövde yalnız bu sarmalayıcıdan çağrılır (dışa açık değil)
  assert.equal(digest.match(/sendReminderDigest\(/g)?.length, 2);
  assert.doesNotMatch(digest, /export async function sendReminderDigest/);
  const actions = read("src/server/actions/reminders.ts");
  const preview = actions.slice(actions.indexOf("export async function previewDigest"), actions.indexOf("export async function runDigestNow"));
  assert.match(preview, /await requireAdmin\(\);\s+(?:\/\/[^\n]*\n\s+)*return withBranchScope\(ALL_BRANCHES, digestPreview\);/);
  // Şimdi gönder sabah işiyle aynı yoldan
  const now = actions.slice(actions.indexOf("export async function runDigestNow"));
  assert.match(now, /const r = await runReminderDigest\("manual"\);/);
});
