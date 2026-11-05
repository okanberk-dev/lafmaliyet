// Paraşüt entegrasyonu sayfasındaki dört özet kartının dökümü (karta dokununca açılan pencere): fatura sayısı ve
// bağlı ürün dökümü kartın sayısını tutar; bağlantı ve son eşitleme dökümleri bilgi satırlarıdır (toplamsız).
// Çalıştırma: npx tsx --test tests/parasut-dokum.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectionBreakdown,
  invoiceBreakdown,
  invoicesHref,
  invoiceStats,
  linkedBreakdown,
  linksHref,
  runDuration,
  runsBreakdown,
  type InvoiceMix,
  type SyncRun,
} from "../src/app/panel/parasut/breakdowns";
import { prepareBreakdown, type BreakdownGroup } from "../src/lib/breakdown";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const groupsSum = (gs: BreakdownGroup[]) => sum(gs.filter((g) => !g.apart).flatMap((g) => g.rows.map((r) => r.amount)));

// ---------------------------------------------------------------- Paraşüt'ten gelen fatura

const mix = (p: Partial<InvoiceMix> & Pick<InvoiceMix, "month" | "n">): InvoiceMix => ({
  origin: "parasut",
  bill: false,
  eInvoice: true,
  review: 0,
  last: null,
  ...p,
});

const rows: InvoiceMix[] = [
  mix({ month: "2026-09", n: 40, review: 2, last: "2026-10-01T05:00:00.000Z" }),
  mix({ month: "2026-10", n: 25, review: 1, last: "2026-10-20T04:30:00.000Z" }),
  mix({ month: "2026-10", n: 6, bill: true, eInvoice: true, last: "2026-10-19T04:30:00.000Z" }),
  mix({ month: "2026-10", n: 3, bill: true, eInvoice: false }),
  mix({ month: "2026-08", n: 4, bill: true, eInvoice: false }),
  mix({ month: "2026-03", n: 5, origin: "excel", bill: true, eInvoice: true }),
  mix({ month: "2026-03", n: 1, origin: "manual", bill: false, eInvoice: true }),
];

test("Paraşüt faturaları: kartın sayısı, son eşitlenme ve kontrol bekleyen aynı satırlardan", () => {
  assert.deepEqual(invoiceStats(rows), { invoices: 84, lastSyncedAt: "2026-10-20T04:30:00.000Z", needsReview: 3 });
  assert.deepEqual(invoiceStats([]), { invoices: 0, lastSyncedAt: null, needsReview: 0 });
});

test("Paraşüt faturaları: dökümü türüne göre, ay ay; toplam kartın sayısı, kontrol bekleyenler ayrı", () => {
  const g = invoiceBreakdown(rows);
  assert.equal(groupsSum(g), invoiceStats(rows).invoices);
  // En kalabalık tür önce: 65 e-fatura, 13 gider faturası, 6 panel kaydı
  assert.deepEqual(
    g.filter((x) => !x.apart).map((x) => [x.label, sum(x.rows.map((r) => r.amount))]),
    [
      ["Gelen e-fatura", 65],
      ["Gider faturası", 13],
      ["Panel kaydı, Paraşüt'e bağlandı", 6],
    ],
  );
  // Aylar en yeni önce; aya dokununca o ayın Paraşüt faturaları
  const bills = g.find((x) => x.key === "bill")!;
  assert.deepEqual(
    bills.rows.map((r) => [r.label, r.amount, r.sub]),
    [
      ["Ekim 2026", 9, "6 e-faturalı"],
      ["Ağustos 2026", 4, undefined],
    ],
  );
  assert.equal(bills.rows[0].href, "/panel/faturalar?kaynak=parasut&ay=2026-10#fatura-listesi");
  assert.equal(g.find((x) => x.key === "einvoice")!.rows[1].sub, "2 kontrol bekliyor");
  assert.equal(g.find((x) => x.key === "matched")!.rows[0].sub, "5 Excel · 1 elle");
  const review = g.find((x) => x.key === "kontrol")!;
  assert.equal(review.apart, true);
  assert.equal(review.rows[0].amount, 3);
  assert.equal(review.rows[0].href, invoicesHref({ durum: "kontrol" }));
  assert.equal(invoicesHref({ durum: "kontrol" }), "/panel/faturalar?kaynak=parasut&durum=kontrol#fatura-listesi");
  // Pencere verilen sırayı korur ve toplamı kartın sayısı yazar
  const p = prepareBreakdown(g, { order: "given", total: 84 });
  assert.deepEqual(p.groups.map((x) => x.key), ["einvoice", "bill", "matched", "kontrol"]);
  assert.equal(p.total, 84);
  assert.equal(p.base, 84);
});

test("Paraşüt faturaları: fatura yoksa döküm boş (kontrol bölümü de düşer)", () => {
  assert.equal(prepareBreakdown(invoiceBreakdown([]), { order: "given" }).groups.length, 0);
});

// ---------------------------------------------------------------- Bağlı ürün

test("Bağlı ürün: hammadde kategorisine göre, hammadde hammadde; toplam bağlı ürün sayısı, bekleyenler ayrı", () => {
  const ingredients = [
    { id: 1, category: "Süt ürünleri" },
    { id: 2, category: "Süt ürünleri" },
    { id: 3, category: "Kahve" },
    { id: 4, category: "" },
  ];
  const links = [
    { productName: "SEK SÜT 1L", ingredientId: 1, ingredientName: "Süt" },
    { productName: "PINAR SÜT 1L", ingredientId: 1, ingredientName: "Süt" },
    { productName: "KREMA 1L", ingredientId: 2, ingredientName: "Krema" },
    { productName: "ESPRESSO 1KG", ingredientId: 3, ingredientName: "Espresso çekirdeği" },
    { productName: "PİPET", ingredientId: 4, ingredientName: "Pipet" },
    { productName: "BİLİNMEYEN", ingredientId: 99, ingredientName: "Silinmiş" },
  ];
  const g = linkedBreakdown(links, ingredients, 12, 3);
  assert.equal(groupsSum(g), links.length);
  const p = prepareBreakdown(g, { total: links.length });
  assert.deepEqual(p.groups.map((x) => [x.label, x.subtotal]), [
    ["Süt ürünleri", 3],
    ["Diğer", 2],
    ["Kahve", 1],
    ["Bağlı olmayan ürünler", 15],
  ]);
  const milk = p.groups[0].rows[0];
  assert.equal(milk.label, "Süt");
  assert.equal(milk.sub, "PINAR SÜT 1L, SEK SÜT 1L");
  assert.equal(milk.href, "/panel/parasut?durum=bagli&ara=S%C3%BCt#urun-baglantilari");
  const apart = p.groups.at(-1)!;
  assert.equal(apart.apart, true);
  assert.deepEqual(apart.rows.map((r) => [r.key, r.amount]), [["bekleyen", 12], ["hammadde-degil", 3]]);
  assert.equal(apart.rows[0].href, linksHref({ durum: "bekleyen" }));
  // Bekleyen ve "hammadde değil" yoksa ayrı bölüm düşer
  assert.deepEqual(prepareBreakdown(linkedBreakdown(links.slice(0, 1), ingredients, 0, 0)).groups.map((x) => x.key), ["kategori:Süt ürünleri"]);
});

test("Bağlı ürün: çok ürünlü hammaddede ilk beş ürün ve kalan sayısı", () => {
  const links = Array.from({ length: 8 }, (_, i) => ({ productName: `Ürün ${i + 1}`, ingredientId: 1, ingredientName: "Süt" }));
  const row = linkedBreakdown(links, [{ id: 1, category: "Süt" }], 0, 0)[0].rows[0];
  assert.equal(row.amount, 8);
  assert.equal(row.sub, "Ürün 1, Ürün 2, Ürün 3, Ürün 4, Ürün 5 ve 3 ürün daha");
});

// ---------------------------------------------------------------- Bağlantı

// Kullanıcı adı/parola yok: Paraşüt grant_type=password'ü kaldırdı, yetki tarayıcıdan bir kez alınıyor
const env = (missing: string[] = []) => ["PARASUT_CLIENT_ID", "PARASUT_CLIENT_SECRET", "PARASUT_COMPANY_ID"].map((name) => ({ name, set: !missing.includes(name) }));

/** Bağlı bir hesap (çoğu durumda değişmeyen kısım) */
const linked = { connected: true, refreshedAt: "2026-10-20T04:30:00.000Z", stale: false };

test("Bağlantı: ortam değişkenleri tanımlı / eksik, eşitlemenin zamanı; bilgi satırları pencerede kalır", () => {
  const g = connectionBreakdown({
    configured: true,
    env: env(),
    cronSet: false,
    syncFrom: null,
    cursor: "2026-10-18",
    ...linked,
    lastOk: { startedAt: "2026-10-20T04:30:00.000Z", trigger: "cron" },
  });
  const vars = g[0];
  assert.equal(vars.display, "3 / 4");
  assert.deepEqual(vars.rows.at(-1), { key: "CRON_SECRET", label: "CRON_SECRET", sub: "Her sabahki otomatik eşitlemenin anahtarı", amount: 0, display: "Eksik", tone: "warn" });
  assert.deepEqual(vars.rows[0].display, "Tanımlı");
  const sync = Object.fromEntries(g[1].rows.map((r) => [r.key, r]));
  assert.equal(sync.hesap.display, "Bağlı");
  assert.equal(sync.hesap.tone, "good");
  assert.equal(sync.otomatik.display, "Kapalı");
  assert.equal(sync.otomatik.tone, "warn");
  assert.equal(sync.baslangic.display, "Yıl başı");
  assert.equal(sync.imlec.display, "18.10.2026");
  assert.equal(sync["son-basarili"].display, "20.10.2026 07:30");
  assert.equal(sync["son-basarili"].sub, "Otomatik");
  // Tutarı 0 olan bilgi satırları düşmez
  const p = prepareBreakdown(g, { order: "given" });
  assert.equal(p.groups.flatMap((x) => x.rows).length, 9);

  const missing = connectionBreakdown({
    configured: false,
    env: env(["PARASUT_CLIENT_SECRET"]),
    cronSet: true,
    syncFrom: "2026-01-15",
    cursor: null,
    connected: false,
    refreshedAt: null,
    stale: false,
    lastOk: null,
  });
  assert.equal(missing[0].display, "3 / 4");
  assert.equal(missing[0].rows.find((r) => r.key === "PARASUT_CLIENT_SECRET")?.tone, "bad");
  const ms = Object.fromEntries(missing[1].rows.map((r) => [r.key, r]));
  assert.equal(ms.hesap.display, "Bağlı değil");
  assert.equal(ms.hesap.tone, "bad");
  assert.equal(ms.otomatik.display, "Kurulum bekliyor");
  assert.equal(ms.baslangic.display, "15.01.2026");
  assert.equal(ms.imlec.display, "Henüz yok");
  assert.equal(ms["son-basarili"].display, "Yok");

  // Ayarlar tam ama hesap bağlanmamış: otomatik eşitleme çalışmaz, kart bunu söyler
  const unlinked = connectionBreakdown({ configured: true, env: env(), cronSet: true, syncFrom: null, cursor: null, connected: false, refreshedAt: null, stale: false, lastOk: null });
  assert.equal(unlinked[1].rows[1].display, "Hesap bağlanmadı");
  assert.equal(unlinked[1].rows[1].tone, "warn");

  // Yetki uzun süre yenilenmedi (refresh_token 30 gün): bağlı ama tazelenmeli
  const old = connectionBreakdown({ configured: true, env: env(), cronSet: true, syncFrom: null, cursor: null, connected: true, refreshedAt: "2026-09-01T00:00:00.000Z", stale: true, lastOk: null });
  assert.equal(old[1].rows[0].display, "Yenilenmeli");
  assert.equal(old[1].rows[0].tone, "warn");

  assert.equal(connectionBreakdown({ configured: true, env: env(), cronSet: true, syncFrom: null, cursor: null, ...linked, lastOk: null })[1].rows[1].display, "Her sabah");
});

// ---------------------------------------------------------------- Son eşitleme

const run = (p: Partial<SyncRun> & Pick<SyncRun, "id" | "status">): SyncRun => ({
  trigger: "cron",
  startedAt: "2026-10-20T04:30:00.000Z",
  finishedAt: null,
  message: null,
  ...p,
});

test("Son eşitleme: son eşitlemeler en yeni üstte, sonucu renkli; eşitlemenin bıraktığı durum altta", () => {
  const runs = [
    run({ id: 3, status: "running", trigger: "manual", startedAt: "2026-10-20T09:00:00.000Z" }),
    run({ id: 2, status: "error", finishedAt: "2026-10-20T04:30:42.000Z", message: "Paraşüt 401: oturum açılamadı" }),
    run({ id: 1, status: "ok", startedAt: "2026-10-19T04:30:00.000Z", finishedAt: "2026-10-19T04:31:05.000Z", message: "12 yeni, 3 güncellendi" }),
  ];
  const g = runsBreakdown(runs, { lastSyncedAt: "2026-10-19T04:31:00.000Z", lineReads: { read: 120, pending: 10 }, pendingEInvoices: { count: 4 } });
  const [history, state] = g;
  assert.equal(history.label, "Son 3 eşitleme");
  assert.equal(history.display, "1 başarılı · 1 hata");
  assert.deepEqual(
    history.rows.map((r) => [r.label, r.display, r.tone, r.sub]),
    [
      ["20.10.2026 12:00 · elle", "Sürüyor", "warn", "Sürüyor…"],
      ["20.10.2026 07:30 · otomatik · 42 sn", "Hata", "bad", "Paraşüt 401: oturum açılamadı"],
      ["19.10.2026 07:30 · otomatik · 1 dk 5 sn", "Başarılı", "good", "12 yeni, 3 güncellendi"],
    ],
  );
  assert.deepEqual(
    state.rows.map((r) => [r.key, r.display, r.tone]),
    [
      ["son-fatura", "19.10.2026 07:31", undefined],
      ["kalemler", "120 / 130", "warn"],
      ["e-fatura", "~4", "warn"],
    ],
  );
  const p = prepareBreakdown(g, { order: "given" });
  assert.equal(p.groups.flatMap((x) => x.rows).length, 6);
  // Uzun hata iletisi kısaltılır
  const long = runsBreakdown([run({ id: 9, status: "error", message: "x".repeat(400) })], { lastSyncedAt: null, lineReads: { read: 0, pending: 0 }, pendingEInvoices: null });
  assert.equal(long[0].rows[0].sub?.length, 240);
  assert.equal(long[1].rows.length, 0);
});

test("Son eşitleme: hiç eşitleme yoksa döküm boş; süre yazısı", () => {
  const g = runsBreakdown([], { lastSyncedAt: null, lineReads: { read: 0, pending: 0 }, pendingEInvoices: { count: 0 } });
  assert.equal(prepareBreakdown(g, { order: "given" }).groups.length, 0);
  assert.equal(runDuration({ startedAt: "2026-10-20T04:30:00.000Z", finishedAt: null }), null);
  assert.equal(runDuration({ startedAt: "2026-10-20T04:30:00.000Z", finishedAt: "2026-10-20T04:32:00.000Z" }), "2 dk");
  assert.equal(runDuration({ startedAt: "2026-10-20T04:30:00.000Z", finishedAt: "2026-10-20T04:29:00.000Z" }), null);
  const ingested = runsBreakdown([], { lastSyncedAt: null, lineReads: { read: 5, pending: 0 }, pendingEInvoices: { count: 7, ingested: true } })[1].rows;
  assert.deepEqual(ingested.map((r) => [r.key, r.display, r.tone]), [["kalemler", "5 / 5", "good"], ["e-fatura", "7", undefined]]);
});
