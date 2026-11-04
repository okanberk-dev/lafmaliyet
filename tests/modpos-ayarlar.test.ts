// Ayarlar › ModPOS API kartı ve eylemleri (docs/MODPOS-API.md › Nerede görünür, Kota ve çekme sırası, Ay
// rakamına yedek), saf kurallar ve kaynak bekçileri: "Bu günü çek"in onay penceresi (kalan hak, bugün kesin değil, zaten
// saklı gün) ve sonucu (bildirim, işlem geçmişi, hata metni), son çekilen günlerin rozetleri ve satırı, yedek anahtarının
// metni; eylemler önce yönetici oturumunu denetler, sayfa açılışı ya da after() hiçbir zaman ModPOS'a istek göndermez
// (günde 2 hak), istemci eylemi useActionTransition'la çağırır, bölüm listesinde ve sayfada kart LafPOS'tan sonra, sayfanın
// maxDuration'ı 60 sn. Veritabanında: tests/modpos-ayarlar-db.test.ts.
// Çalıştırma: npx tsx --test tests/modpos-ayarlar.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SETTINGS_SECTIONS } from "../src/app/panel/ayarlar/sections";
import { NAV_FOOTER } from "../src/components/panel/nav";
import {
  MODPOS_DAY_INVALID,
  MODPOS_NOT_CONFIGURED,
  MODPOS_PREVIEW,
  modposDayBadges,
  modposDayLine,
  modposDayWarnings,
  modposFallbackChangeText,
  modposFetchConfirmLines,
  modposFetchOutcome,
  type ModposDayView,
  type ModposFetchRun,
} from "../src/lib/modpos/ayarlar";
import { parseKasaFoyu } from "../src/lib/modpos/foy";
import { foyWarnings, foyZ, sheetState, type ModposZ } from "../src/lib/modpos/z";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Bölünmez boşluk düz boşluğa, sözcük birleştirici silinir */
const plain = (s: string) => s.replace(/ /g, " ").replace(/⁠/g, "");
/** Yorumlar boşlukla (kaynak bekçileri yalnız kodu arar) */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s(])\/\/[^\n]*/g, "$1");

function sample(day = "2026-11-01") {
  const r = parseKasaFoyu(read("tests/fixtures/modpos/belge-ornegi.xml"));
  assert.ok(r.ok);
  const foy = { ...r.foy, kasaGunu: day };
  return { foy, z: foyZ(foy)! };
}

const view = (o: Partial<ModposDayView> = {}): ModposDayView => {
  const { foy, z } = sample();
  return { day: "2026-11-01", state: sheetState(foy), final: true, revision: 1, z, warnings: foyWarnings(foy), ...o };
};

const zOf = (o: Partial<ModposZ>): ModposZ => ({ ...sample().z, ...o });

// ---------------------------------------------------------------- Bu günü çek: sonuç

test("Bu günü çek: alınan gün bildirimi ciro, fiş ve kalan hakla; işlem geçmişine gün · sonuç · kalan hak", () => {
  const { z } = sample("2026-11-02");
  const ok: ModposFetchRun = { status: "ok", days: [{ day: "2026-11-02", result: "yeni" }], left: 1 };
  const out = modposFetchOutcome(ok, "2026-11-02", { final: true, z });
  assert.ok(out.ok);
  assert.equal(plain(out.title), "2 Kasım 2026 ModPOS API verisi alındı");
  assert.equal(plain(out.description), "Ciro 28.450,50 ₺ · 214 fiş · bugün kalan hak 1");
  assert.equal(plain(out.log), "2 Kasım 2026 · alındı · kalan hak 1");

  const changed = modposFetchOutcome({ ...ok, days: [{ day: "2026-11-02", result: "degisti", revision: 3 }], left: 0 }, "2026-11-02", { final: true, z });
  assert.ok(changed.ok);
  assert.equal(plain(changed.title), "2 Kasım 2026 ModPOS API verisi değişti (sürüm 3)");
  assert.equal(plain(changed.log), "2 Kasım 2026 · değişti · kalan hak 0");

  const same = modposFetchOutcome({ ...ok, days: [{ day: "2026-11-02", result: "ayni" }], left: null }, "2026-11-02", { final: true, z });
  assert.ok(same.ok);
  assert.equal(plain(same.title), "2 Kasım 2026 ModPOS API verisi değişmedi");
  assert.equal(plain(same.log), "2 Kasım 2026 · değişmedi · kalan hak bilinmiyor");
});

test("Bu günü çek: kesin olmayan föy (bugün, gün açık) bildirimde 'kesin değil' der; satışsız gün 'Satış yok'", () => {
  const open = modposFetchOutcome({ status: "ok", days: [{ day: "2026-11-03", result: "yeni" }], left: 0 }, "2026-11-03", { final: false, z: zOf({ durum: "ACIK" }) });
  assert.ok(open.ok);
  assert.match(plain(open.description), /· kesin değil: yarın sabah kendiliğinden yeniden çekilir · bugün kalan hak 0$/);
  const empty = modposFetchOutcome({ status: "ok", days: [{ day: "2026-10-12", result: "yeni" }], left: 1 }, "2026-10-12", { final: true, z: null });
  assert.ok(empty.ok);
  assert.equal(plain(empty.description), "Satış yok · bugün kalan hak 1");
  // Saklanan föy okunamadıysa da (yarış) gün alındı sayılır, yalnız kalan hak
  const noSheet = modposFetchOutcome({ status: "ok", days: [{ day: "2026-10-12", result: "yeni" }], left: 1 }, "2026-10-12", null);
  assert.ok(noSheet.ok);
  assert.equal(noSheet.description, "Bugün kalan hak 1");
});

test("Bu günü çek: alınamayan gün hata metniyle (servisin, hak doldu, kurulmadı, önizleme, ileri tarih)", () => {
  const day = "2026-11-02";
  assert.deepEqual(modposFetchOutcome({ status: "error", days: [{ day, result: "hata", text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin" }], left: 2, error: "x" }, day, null), {
    ok: false,
    error: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin",
  });
  assert.deepEqual(modposFetchOutcome({ status: "kota", days: [], left: 0, error: "ModPOS API'nin günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir" }, day, null), {
    ok: false,
    error: "ModPOS API'nin günlük 2 çekim hakkı doldu: hak bu gece 00:00'da yenilenir",
  });
  assert.deepEqual(modposFetchOutcome({ status: "off", days: [], left: null }, day, null), { ok: false, error: MODPOS_NOT_CONFIGURED });
  assert.deepEqual(modposFetchOutcome({ status: "preview", days: [], left: null }, day, null), { ok: false, error: MODPOS_PREVIEW });
  assert.deepEqual(modposFetchOutcome({ status: "nothing", days: [], left: 2 }, day, null), { ok: false, error: MODPOS_DAY_INVALID });
  assert.deepEqual(modposFetchOutcome({ status: "error", days: [], left: 2 }, day, null), { ok: false, error: "ModPOS API verisi alınamadı: sonra yeniden deneyin" });
  // UserError kuralı: sonda nokta yok
  for (const t of [MODPOS_NOT_CONFIGURED, MODPOS_PREVIEW, MODPOS_DAY_INVALID]) assert.doesNotMatch(t, /\.$/);
  assert.equal(MODPOS_NOT_CONFIGURED, "ModPOS bağlantısı kurulmamış: Vercel'de MODPOS_API_KEY tanımlı değil");
});

// ---------------------------------------------------------------- Bu günü çek: onay penceresi

test("onay penceresi kalan hakkı ve çekince kalacağını söyler; bugün kesin değil; saklı gün ne getirir; son hak", () => {
  const today = "2026-11-03";
  assert.deepEqual(modposFetchConfirmLines({ day: "2026-11-02", today, left: 2, stored: null }), ["Bugün 2 hak kaldı; çekince 1 kalır.", "Çekim bir dakikaya kadar sürebilir."]);
  const todays = modposFetchConfirmLines({ day: today, today, left: 2, stored: null });
  assert.equal(todays[0], "Bugün 2 hak kaldı; çekince 1 kalır.");
  assert.match(todays[1], /o anki hâliyle gelir \(kesin değil\); yarın sabah kendiliğinden yeniden çekilir\.$/);
  assert.match(modposFetchConfirmLines({ day: "2026-11-01", today, left: 2, stored: true })[1], /^Bu günün kesin verisi zaten var; yeniden çekmek yalnız kapanıştan sonra/);
  assert.equal(modposFetchConfirmLines({ day: "2026-11-01", today, left: 2, stored: false })[1], "Bu günün verisi kesin değil; sabah işi de yeniden çeker.");
  const last = modposFetchConfirmLines({ day: "2026-11-01", today, left: 1, stored: null });
  assert.equal(last[0], "Bugün 1 hak kaldı; çekince 0 kalır.");
  assert.equal(last[1], "Hak bitince sabah işi bugün başka gün çekemez; hak gece yarısı yenilenir.");
  // Hak yokken düğme kapalıdır; yine de eksi sayı yazılmaz
  assert.equal(modposFetchConfirmLines({ day: "2026-11-01", today, left: 0, stored: null })[0], "Bugün 0 hak kaldı; çekince 0 kalır.");
});

// ---------------------------------------------------------------- Son çekilen günler

test("günün satırı: Z no · fiş · ciro · nakit · kart · kasa farkı; birden çok kasa, sayım yok, kasa açılmadı, satış yok", () => {
  assert.equal(plain(modposDayLine(sample().z)), "Z 0312 · 214 fiş · ciro 28.450,50 ₺ · nakit 8.210 ₺ · kart 16.120,50 ₺ · kasa 20 ₺ eksik");
  assert.equal(plain(modposDayLine(zOf({ cashDiff: 0.4 }))), "Z 0312 · 214 fiş · ciro 28.450,50 ₺ · nakit 8.210 ₺ · kart 16.120,50 ₺ · kasa tutuyor");
  assert.match(plain(modposDayLine(zOf({ cashDiff: 35 }))), /· kasa 35 ₺ fazla$/);
  assert.match(plain(modposDayLine(zOf({ zNo: null, kasaSayisi: 2 }))), /^2 kasa · 214 fiş/);
  assert.match(plain(modposDayLine(zOf({ cashDiff: null, countedCash: null, noCount: "acik" }))), /· sayım yok \(gün açık\)$/);
  assert.match(plain(modposDayLine(zOf({ cashDiff: null, countedCash: null, noCount: "otomatik" }))), /· sayım yok \(06:00'da kendiliğinden kapandı\)$/);
  assert.match(plain(modposDayLine(zOf({ foysuz: true, zNo: null, kasaSayisi: 0, cashDiff: null, noCount: "foysuz" }))), /^Kasa açılmadı · 214 fiş · ciro/);
  assert.equal(modposDayLine(null), "Satış yok");
});

test("günün rozetleri: durum, kesin değil, sürüm, uyarı sayısı (ModPOS'un uyarıları ve föyün kendi içinde tutmaması)", () => {
  const v = view();
  assert.deepEqual(
    modposDayWarnings(v).map(plain),
    ["Kasa farkı var (-20 ₺)", "Ödemelerin toplamı ciroyu tutmuyor (ödemeler 4.120 ₺ eksik)"],
    "belgenin örneğinde ödemeler ciroyu tutmuyor: uyarı satırı",
  );
  assert.deepEqual(
    modposDayBadges(v).map((b) => [b.tone, b.text]),
    [
      ["green", "Kapalı"],
      ["amber", "2 uyarı"],
    ],
  );
  assert.deepEqual(
    modposDayBadges(view({ state: "ACIK", final: false, revision: 2, warnings: [], z: zOf({ paymentsGap: 0 }) })).map((b) => [b.tone, b.text]),
    [
      ["amber", "Açık"],
      ["gray", "Kesin değil"],
      ["blue", "Sürüm 2"],
    ],
  );
  assert.deepEqual(
    modposDayBadges(view({ state: "BOS", warnings: [], z: null })).map((b) => b.text),
    ["Satış yok"],
  );
  // Gün içinde kasa açılmadan alınan boş föy: satış "yoktu" (o an), kesin değil
  assert.deepEqual(
    modposDayBadges(view({ state: "BOS", final: false, warnings: [], z: null })).map((b) => b.text),
    ["Satış yoktu", "Kesin değil"],
  );
  assert.deepEqual(
    modposDayBadges(view({ state: "BOS", warnings: [], z: zOf({ foysuz: true, paymentsGap: 0 }) })).map((b) => b.text),
    ["Kasa açılmadı"],
  );
  const unknown = modposDayBadges(view({ warnings: [{ kod: "GUN_ACIK", mesaj: "Gün henüz kapanmadı", tutar: null }], z: zOf({ paymentsGap: 0, unknownCodes: ["YENI_KOD"] }) }));
  assert.deepEqual(unknown.at(-1), { tone: "amber", text: "2 uyarı", title: "Gün henüz kapanmadı; Tanınmayan ödeme kodu: YENI_KOD" });
  // Renk tek başına anlam taşımaz: her rozetin metni var; kırmızı yok (sakin dil)
  for (const b of [...modposDayBadges(v), ...unknown]) assert.ok(b.text && b.tone !== "red");
});

test("ay rakamına yedek: işlem geçmişinin metni eski → yeni", () => {
  assert.equal(modposFallbackChangeText(false, true), "ModPOS ay rakamına yedek: kapalı → açık");
  assert.equal(modposFallbackChangeText(true, false), "ModPOS ay rakamına yedek: açık → kapalı");
});

// ---------------------------------------------------------------- Kaynak bekçileri

test("eylemler: her dışa aktarım bir POST ucu, önce yönetici oturumu; zod; çekim elle koşucudan 50 sn'lik süreyle", () => {
  const actions = read("src/server/actions/modpos.ts");
  assert.match(actions, /^"use server";/);
  const exported = [...actions.matchAll(/^export (?:async )?(?:function|const|let) (\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["fetchModposDay", "saveModposFallback"], "dosyada yardımcı dışa aktarım yok");
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`)).split(/\nexport /)[0];
    assert.match(body, /return attempt\(async \(\) => \{\s*const me = await requireAdmin\(\);/, `${name}: önce yönetici oturumu`);
  }
  const fetch = actions.slice(actions.indexOf("export async function fetchModposDay"), actions.indexOf("export async function saveModposFallback"));
  assert.match(fetch, /const day = zDate\.parse\(input\);/);
  // Sıra: kurulmadı, önizleme, ileri tarih, hak doldu; sonra tek istek
  const order = ["modposKeyProblem(process.env)", "canFetchModpos(process.env)", "requestableDay(day, now)", "quotaLeft(state.quota, now) <= 0", 'syncModpos("elle", { days: [day], deadlineAt: Date.now() + FETCH_BUDGET_MS, db })'];
  const at = order.map((s) => fetch.indexOf(s));
  assert.ok(at.every((i) => i > 0), JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "denetimler istekten önce");
  assert.match(actions, /const FETCH_BUDGET_MS = 50_000;/);
  assert.equal((actions.match(/syncModpos\(/g) ?? []).length, 1);
  // Yalnız alınan gün işlem geçmişine; denenince kart yenilenir
  assert.match(fetch, /refresh\(\);\s*if \(!out\.ok\) throw new UserError\(out\.error\);\s*await logActivity\(me, "ModPOS API verisi çekildi", out\.log\);/);
  const save = actions.slice(actions.indexOf("export async function saveModposFallback"));
  assert.match(save, /const on = z\.boolean\(\{ message: "Geçersiz değer" \}\)\.parse\(input\);/);
  assert.match(save, /const change = await writeModposFallback\(getDb\(\), me, on\);\s*if \(change\) \{\s*await logActivity\(me, "Ayarlar", change\);\s*refresh\(\);/);
  // Yazım çekirdeği rolü yeniden denetler
  const admin = read("src/server/modpos/admin.ts");
  assert.match(admin, /^import "server-only";/m);
  assert.match(admin, /export async function writeModposFallback\(db: DB, me: Actor, on: boolean\): Promise<string \| null> \{\s*if \(me\.role !== "admin"\) throw new UserError\(MODPOS_ADMIN_ONLY\);/);
  assert.match(admin, /\.for\("update"\)/);
});

test("sayfa açılışı ModPOS'a istek göndermez: kart ve yükleyici yalnız okur, after() yok (günde 2 hak)", () => {
  const card = code(read("src/app/panel/ayarlar/modpos-card.tsx"));
  const client = code(read("src/app/panel/ayarlar/modpos-client.tsx"));
  const loader = code(read("src/server/modpos/status.ts"));
  for (const [name, src] of [
    ["modpos-card.tsx", card],
    ["modpos-client.tsx", client],
    ["server/modpos/status.ts", loader],
  ] as const) {
    assert.doesNotMatch(src, /\bafter\(/, `${name}: after() yok`);
    assert.doesNotMatch(src, /syncModpos|fetchKasaFoyu/, `${name}: istek yok`);
    assert.doesNotMatch(src, /useEffect/, `${name}: açılışta eylem yok`);
  }
  assert.match(read("src/server/modpos/status.ts"), /^import "server-only";/m);
  // Kart LafPOS kartının deseninde: okunamazsa yedek kart, bölüm kimliği modpos
  assert.match(card, /const data = await loadModposCard\(undefined, now\)\.catch\(\(e\) => \{/);
  assert.match(card, /<Notice tone="bad" size="sm" title="ModPOS API'nin durumu okunamadı; sayfayı yenileyin" \/>/);
  assert.equal((card.match(/<SectionCard\s+id="modpos"/g) ?? []).length, 2);
  assert.match(card, /<Badge tone=\{sum\.tone\} dot>/);
  assert.match(card, /<InfoTip text=\{SETUP_TIP\} \/>/);
  assert.match(card, /href=\{`\/panel\/kasa\?gun=\$\{d\.day\}`\}/);
  assert.match(card, /<ModposFallbackSwitch on=\{data\.fallback\} \/>/);
});

test("istemci: eylemler useActionTransition'la, onay penceresi tone=\"primary\" ve kalan hakla; düğme kapalıyken nedeni", () => {
  const client = read("src/app/panel/ayarlar/modpos-client.tsx");
  assert.match(client, /^"use client";/);
  assert.doesNotMatch(client, /\buseTransition\(/);
  assert.equal((client.match(/const \[pending, start\] = useActionTransition\(\);/g) ?? []).length, 2);
  assert.match(client, /start\(\s*async \(\) => \{\s*try \{\s*const res = await fetchModposDay\(day\);/);
  // Yanıt kaybolursa çekim yapılmış olabilir: pencere kapanır, "Yenile" önerilir (maybeSaved)
  assert.match(client, /\} finally \{\s*setOpen\(false\);\s*\}\s*\},\s*\{ maybeSaved: true \},/);
  assert.match(client, /start\(async \(\) => \{\s*const res = await saveModposFallback\(next\);/);
  assert.equal((client.match(/<ConfirmDialog[\s\S]*?tone="primary"/g) ?? []).length, 2);
  assert.match(client, /modposFetchConfirmLines\(\{ day, today, left, stored: day in stored \? stored\[day\] : null, now: new Date\(\) \}\)/);
  assert.match(client, /disabled=\{!canFetch \|\| pending \|\| problem !== null\}/);
  assert.match(client, /\{blocked \?\? "/);
  assert.match(client, /max=\{today\}/);
});

test("bölüm listesi, sayfa ve arama: ModPOS LafPOS'tan sonra; sayfanın sunucu eylemi 60 sn'ye kadar", () => {
  const ids = SETTINGS_SECTIONS.map((x) => x.id) as string[];
  assert.equal(ids.indexOf("modpos"), ids.indexOf("lafpos") + 1);
  assert.equal(SETTINGS_SECTIONS.find((x) => x.id === "modpos")?.label, "ModPOS API");
  assert.match(read("src/app/panel/ayarlar/sections.ts"), /\n {2}\/\/ ModPOS'un kasa föyü[^\n]*\n {2}\{ id: "modpos", label: "ModPOS API", icon: ReceiptTurkishLira \},/);
  const page = read("src/app/panel/ayarlar/page.tsx");
  assert.match(page, /\nexport const maxDuration = 60;\n/);
  const lafpos = page.indexOf("<LafposCard");
  const modpos = page.indexOf("<ModposCard />");
  assert.ok(lafpos > page.indexOf("await requireAdmin();") && modpos > lafpos && modpos < page.indexOf("<PhotoReadingCard />"));
  const settings = NAV_FOOTER.find((i) => i.href === "/panel/ayarlar");
  assert.match(settings?.keywords ?? "", /modpos api kasa föyü/);
});
