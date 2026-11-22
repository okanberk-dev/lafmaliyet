// ModPOS kasa föyünün yöneticiye uyarıları (docs/MODPOS-API.md › Nerede görünür; docs/BILDIRIMLER.md, docs/BUGUN.md),
// saf kurallar (src/lib/modpos/zil.ts): föyünden farklı yazılan rapor (yalnız ModPOS günü ve kasası kapanmış föy), zilin
// satırı (kimlik, başlık, 220 harflik gövde), sabah e-postasının satırı ve "ModPOS API'den veri çekilemiyor" (yalnız
// anahtarın kendi hatası, son başarılı çekimden sonraysa). Kaynak denetimi: hepsi yalnız yönetici dalında, hiçbiri istek
// göndermez. Veritabanında: tests/modpos-zil-db.test.ts.
// Çalıştırma: npx tsx --test tests/modpos-zil.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type { ModposSavedFields } from "../src/lib/modpos/compare";
import { parseKasaFoyu, type KasaFoyu } from "../src/lib/modpos/foy";
import { parseModposState, type ModposError, type ModposState } from "../src/lib/modpos/status";
import {
  MODPOS_BELL_BODY_MAX,
  MODPOS_KEY_FORMAT_TEXT,
  MODPOS_KEY_TITLE,
  MODPOS_MISMATCH_TITLE,
  modposKeyAlert,
  modposKeyDigestText,
  modposMismatchBell,
  modposMismatchDates,
  modposMismatchDigestText,
  modposMismatches,
  type ModposSheetLite,
} from "../src/lib/modpos/zil";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** Bölünmez boşluk düz boşluğa */
const plain = (s: string) => s.replace(/ /g, " ");

/** Kitapçığın örnek föyü (1 Kasım 2026; tek kasa, kapalı, Z no 0312, nakit 8.210, kart 16.120,50, sayılan 7.820) */
function sampleFoy(day = "2026-11-01", o: Partial<KasaFoyu> = {}): KasaFoyu {
  const r = parseKasaFoyu(read("tests/fixtures/modpos/belge-ornegi.xml"));
  assert.ok(r.ok, "örnek föy okunamadı");
  return { ...r.foy, kasaGunu: day, ...o };
}

const sheet = (day: string, revision = 1, foy = sampleFoy(day)): ModposSheetLite => ({ day, foy, revision });

type Report = ModposSavedFields & { date: string; revision: number; branchId?: string };

/** Föyle birebir aynı yazılmış rapor */
function report(date: string, o: Partial<Report> = {}): Report {
  return {
    date,
    revision: 1,
    zNo: "312",
    receipts: 214,
    zTotal: 28450.5,
    cash: 8210,
    card: 16120.5,
    mealCard: 0,
    online: 0,
    other: 0,
    offRevenue: 145,
    openingCash: 500,
    cashIn: 0,
    cashOut: 870,
    countedCash: 7820,
    ...o,
  };
}

const D = "2026-11-01";
const D2 = "2026-11-02";

// ---------------------------------------------------------------- Föyünden farklı yazılan rapor

test("föyünden farklı: aynı yazılan rapor uyarı değil; nakit farklıysa tek alan, rapor ve föyle birlikte", () => {
  assert.deepEqual(modposMismatches([report(D)], [sheet(D)], null), []);
  const out = modposMismatches([report(D, { cash: 8190 })], [sheet(D, 3)], null);
  assert.equal(out.length, 1);
  assert.equal(out[0].report.date, D);
  assert.equal(out[0].sheet.revision, 3);
  assert.deepEqual(
    out[0].diffs.map((d) => [d.field, d.saved, d.modpos]),
    [["cash", 8190, 8210]],
  );
  // Z no baştaki sıfırsız yazılabilir ("312" = "0312"); 1 kuruşluk yuvarlama farkı sayılmaz
  assert.deepEqual(modposMismatches([report(D, { zNo: "0312", cash: 8210.01 })], [sheet(D)], null), []);
});

test("föyünden farklı: yalnız ModPOS günü (LafPOS'a geçiş gününden önce ya da geçiş günü boşken)", () => {
  // LafPOS'un şubesi Marina (21 Kasım kararı): geçiş günü yalnız onun kasasını keser
  const bad = [report(D, { cash: 8190, branchId: "marina" })];
  const foy = [{ ...sheet(D), branchId: "marina" }];
  assert.equal(modposMismatches(bad, foy, null).length, 1, "geçiş günü boş");
  assert.equal(modposMismatches(bad, foy, "2026-11-10").length, 1, "geçiş gününden önce");
  assert.deepEqual(modposMismatches(bad, foy, D), [], "geçiş günü LafPOS'tur");
  assert.deepEqual(modposMismatches(bad, foy, "2026-10-20"), [], "geçiş gününden sonra");
  // ModPOS'ta kalan Tuzla'nın (şubesiz eski rapor da Tuzla'nın) raporu geçiş gününden sonra da föyüyle karşılaştırılır
  assert.equal(modposMismatches([report(D, { cash: 8190 })], [sheet(D)], D).length, 1, "Tuzla, geçiş günü");
  assert.equal(modposMismatches([report(D, { cash: 8190 })], [sheet(D)], "2026-10-20").length, 1, "Tuzla, geçiş gününden sonra");
});

test("föyünden farklı: föyü olmayan, satışsız ya da kasası açık föyün günü atlanır; sıra raporların sırası", () => {
  const bad = (date: string) => report(date, { cash: 8190 });
  assert.deepEqual(modposMismatches([bad(D)], [], null), [], "föy hiç çekilmedi");
  assert.deepEqual(modposMismatches([bad(D)], [sheet(D2)], null), [], "başka günün föyü");
  // Satışsız gün: kasa da föysüz satış da yok (foyZ null)
  assert.deepEqual(modposMismatches([bad(D)], [sheet(D, 1, sampleFoy(D, { kasalar: [], foysuzGunler: [] }))], null), []);
  // Gün açıkken "Bu günü çek"le alınan föy o anki tutarlardır: akşamki raporla karşılaştırılmaz
  const open = sampleFoy(D);
  const acik = { ...open, kasalar: open.kasalar.map((k) => ({ ...k, durum: "ACIK" as const })) };
  assert.deepEqual(modposMismatches([bad(D)], [sheet(D, 1, acik)], null), []);
  // İki gün: raporların sırasıyla (zil en yeni önce okur)
  const both = modposMismatches([bad(D2), bad(D)], [sheet(D), sheet(D2)], null);
  assert.deepEqual(
    both.map((m) => m.report.date),
    [D2, D],
  );
  assert.deepEqual([...modposMismatchDates([bad(D2), report(D)], [sheet(D), sheet(D2)], null)], [D2]);
});

test("föyünden farklı: raporda boş bırakılan isteğe bağlı alan (Z no, fiş, ödenmez) farklı sayılmaz; sayılan nakit yalnız Z raporuna dayanırken", () => {
  assert.deepEqual(modposMismatches([report(D, { zNo: null, receipts: null, offRevenue: null })], [sheet(D)], null), []);
  const auto = sampleFoy(D);
  const noCount = {
    ...auto,
    kasalar: auto.kasalar.map((k) => ({ ...k, otomatikKapandi: true, nakitKasa: k.nakitKasa ? { ...k.nakitKasa, dayanak: "OTOMATIK_KAPANIS" as const } : null })),
  };
  assert.deepEqual(modposMismatches([report(D, { countedCash: 9999 })], [sheet(D, 1, noCount)], null), [], "kendiliğinden kapanan günde sayım yok");
  assert.deepEqual(
    modposMismatches([report(D, { countedCash: 9999 })], [sheet(D)], null)[0].diffs.map((d) => d.field),
    ["countedCash"],
  );
});

// ---------------------------------------------------------------- Zil ve e-posta metni

test("zilin satırı: kimlik raporun ve föyün sürümünden, gövde gün · farklı alanlar, gününe götürür", () => {
  const [m] = modposMismatches([report(D2, { cash: 8190, revision: 2 })], [sheet(D2, 4)], null);
  const b = modposMismatchBell(m);
  assert.equal(b.id, "kasa-modpos-2026-11-02-r2-s4");
  assert.equal(b.title, "Kasa raporu ModPOS API'den farklı");
  assert.equal(b.title, MODPOS_MISMATCH_TITLE);
  assert.equal(plain(b.body), "2 Kasım Pazartesi · Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺)");
  assert.equal(b.href, "/panel/kasa?gun=2026-11-02");
  // Birden çok alan "; " ile; rapor yeniden gönderilince ya da föy değişince kimlik değişir
  const [many] = modposMismatches([report(D2, { cash: 8190, card: 16000, zNo: "311" })], [sheet(D2, 5)], null);
  assert.equal(plain(modposMismatchBell(many).body), "2 Kasım Pazartesi · Z no 311 (ModPOS API'de 0312); Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺); Kart 16.000 ₺ (ModPOS API'de 16.120,50 ₺)");
  assert.equal(modposMismatchBell(many).id, "kasa-modpos-2026-11-02-r1-s5");
});

test("zilin satırı: gövde en çok 220 harf (LafPOS satırıyla aynı), kesilince üç nokta", () => {
  const wrong = report(D2, { zNo: "999", receipts: 1, zTotal: 1, cash: 1, card: 1, mealCard: 1, online: 1, other: 1, offRevenue: 1, openingCash: 1, countedCash: 1 });
  const [m] = modposMismatches([wrong], [sheet(D2)], null);
  assert.ok(m.diffs.length >= 10);
  const body = modposMismatchBell(m).body;
  assert.equal(body.length, MODPOS_BELL_BODY_MAX);
  assert.ok(body.endsWith("…"));
});

test("sabah e-postasının satırı: 'Kasa raporu ModPOS API'den farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺)'", () => {
  const [m] = modposMismatches([report(D2, { cash: 8190 })], [sheet(D2)], null);
  assert.equal(plain(modposMismatchDigestText(m.report.date, m.diffs)), "Kasa raporu ModPOS API'den farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS API'de 8.210 ₺)");
});

// ---------------------------------------------------------------- Anahtar çalışmıyor

const keyErr = (at: string, o: Partial<ModposError> = {}): ModposError => ({
  at,
  day: "2026-11-02",
  kod: "ANAHTAR_GECERSIZ",
  text: "ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin",
  keyError: true,
  ...o,
});
const state = (o: Partial<ModposState>): ModposState => ({ quota: null, lastOk: null, lastError: null, runs: [], dayErrors: {}, lastCronAt: null, ...o });

test("anahtar: yoksa uyarı yok (kart 'Kurulmadı' der); biçimi bozuksa canlıda uyarı, önizlemede yok", () => {
  assert.equal(modposKeyAlert({ keyProblem: "missing", preview: false, state: state({ lastError: keyErr("2026-11-03T05:00:00.000Z") }) }), null);
  const format = modposKeyAlert({ keyProblem: "format", preview: false, state: null });
  assert.deepEqual(format, { id: "modpos-anahtar-bicim", title: MODPOS_KEY_TITLE, body: MODPOS_KEY_FORMAT_TEXT, at: null });
  assert.equal(format?.title, "ModPOS API'den veri çekilemiyor");
  assert.equal(modposKeyAlert({ keyProblem: "format", preview: true, state: null }), null);
  // Metin UserError kuralında: sonda nokta yok, ne yapılacağı söylenir
  assert.doesNotMatch(MODPOS_KEY_FORMAT_TEXT, /\.$/);
});

test("anahtar: son hata anahtarın kendisiyle ilgiliyse ve son başarılı çekimden sonraysa uyarı; gövde hatanın metni", () => {
  const err = keyErr("2026-11-03T05:01:00.000Z");
  assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: state({}) }), null, "hiç çekilmedi");
  const a = modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: err }) });
  assert.deepEqual(a, { id: "modpos-anahtar-ANAHTAR_GECERSIZ-0", title: MODPOS_KEY_TITLE, body: err.text, at: err.at });
  // Önizleme canlının durumunu paylaşır: anahtar hatası orada da gerçektir
  assert.ok(modposKeyAlert({ keyProblem: null, preview: true, state: state({ lastError: err }) }));
  const okBefore = { at: "2026-11-02T05:01:00.000Z", day: "2026-11-01" };
  assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: err, lastOk: okBefore }) })?.id, `modpos-anahtar-ANAHTAR_GECERSIZ-${Date.parse(okBefore.at)}`);
  // Sonra başarılı çekim olduysa (anahtar düzeldi) uyarı yok
  assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: err, lastOk: { at: "2026-11-03T06:00:00.000Z", day: "2026-11-02" } }) }), null);
  // Günlük hatalar ve hak dolması anahtar sorunu değildir (ertesi sabah yeniden denenir)
  for (const kod of ["SERVIS_KULLANILAMIYOR", "RAPOR_URETILEMEDI", "KOTA_DOLDU", "BOZUK"]) {
    assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: keyErr(err.at, { kod, keyError: false }) }) }), null, kod);
  }
});

test("anahtar: kimlik aynı hata her sabah tekrarlanınca değişmez, araya başarılı çekim girince değişir", () => {
  const ok = { at: "2026-11-01T05:01:00.000Z", day: "2026-10-31" };
  const id = (errAt: string, lastOk = ok) => modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: keyErr(errAt), lastOk }) })?.id;
  assert.equal(id("2026-11-02T05:01:00.000Z"), id("2026-11-03T05:01:00.000Z"));
  assert.notEqual(id("2026-11-03T05:01:00.000Z"), id("2026-11-03T05:01:00.000Z", { at: "2026-11-02T09:00:00.000Z", day: "2026-11-01" }));
  // Kod değişince de yeni uyarı (geçersiz → süresi dolmuş)
  const expired = modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: keyErr("2026-11-03T05:01:00.000Z", { kod: "ANAHTAR_SURESI_DOLDU" }), lastOk: ok }) })?.id;
  assert.notEqual(expired, id("2026-11-03T05:01:00.000Z"));
});

test("anahtar: bozuk saklanan durum uyarı üretmez, okunamayan an zilin saatine geçmez", () => {
  // parseModposState bozuk alanı null yapar (src/lib/modpos/status.ts)
  assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: parseModposState({ lastError: { kod: 1 } }) }), null);
  assert.equal(modposKeyAlert({ keyProblem: null, preview: false, state: null }), null);
  const a = modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: keyErr("dün sabah") }) });
  assert.ok(a);
  assert.equal(a.at, null);
});

test("anahtar: sabah e-postasının satırı başlık ve hatanın metni", () => {
  const a = modposKeyAlert({ keyProblem: null, preview: false, state: state({ lastError: keyErr("2026-11-03T05:01:00.000Z") }) })!;
  assert.equal(modposKeyDigestText(a), "ModPOS API'den veri çekilemiyor. ModPOS API anahtarı geçersiz: Vercel'deki MODPOS_API_KEY'i kontrol edin");
});

// ---------------------------------------------------------------- Kaynak: yalnız yönetici, istek yok

test("kaynak: saf modül sunucuya bağlı değil; sunucu modülü yalnız okur (istek göndermez)", () => {
  const lib = read("src/lib/modpos/zil.ts");
  assert.doesNotMatch(lib, /server-only|@\/server\//);
  const srv = read("src/server/bell/modpos.ts");
  assert.match(srv, /^import "server-only";/);
  assert.doesNotMatch(srv, /fetchKasaFoyu|syncModpos|storeFoy|noteModposRun/);
  // Şube şube (her ModPOS şubesinin kendi anahtarı ve durumu); anahtar yoksa durum okunmaz; biçimi bozuk ya da başka
  // şubeyle ortaksa da (state null)
  assert.match(srv, /const keyProblem = modposKeyProblem\(env, id, peers\);\s+if \(keyProblem === "missing"\) return null;\s+const state = keyProblem \? null : await readModposState\(undefined, id\);/);
  // E-postanın satırı yalnız dün (sabah işi föyü e-postadan önce çeker); okunamayan kaynak satırsız düşer
  assert.match(srv, /const yesterday = addDays\(businessDate\(now\), -1\);/);
  assert.match(srv, /loadModposSheets\(yesterday, yesterday\)/);
  assert.match(srv, /\.catch\(\(\) => null\),\s+loadKeyAlerts\(\)\.catch\(\(\) => \[\]\),/);
});

test("kaynak: zilin föy satırı kasa modülünün yönetici yolunda; personelin dalında ModPOS yok", () => {
  const bell = read("src/server/bell/kasa.ts");
  const fn = bell.slice(bell.indexOf("async function cashIntegrityNotifications"), bell.indexOf("async function requestNotifications"));
  assert.match(fn, /Promise\.all\(\[loadModposSheets\(oldest\.date, day\), loadLafposSwitchDay\(\)\]\)\.catch\(\(\) => null\),/);
  assert.match(fn, /for \(const m of modpos \? modposMismatches\(reports, modpos\[0\], modpos\[1\]\) : \[\]\) \{/);
  // Birden çok kasa açıkken gövdede şubenin adı
  assert.match(fn, /out\.push\(\{ \.\.\.modposMismatchBell\(m, t\.named \? t\.name : undefined\), kind: "warning", timeLabel: timeLabel\(m\.report\.date\), unread: true, group: "kasa" \}\);/);
  // cashIntegrityNotifications yalnız yönetici dalında çağrılır
  const cash = bell.slice(bell.indexOf("async function cashNotifications"), bell.indexOf("async function cashIntegrityNotifications"));
  const staffBranch = cash.slice(cash.indexOf('if (user.role !== "admin") {'), cash.indexOf("const out: PanelNotification[] = [];"));
  assert.ok(staffBranch.length > 0);
  assert.doesNotMatch(staffBranch, /modpos|Modpos|cashIntegrityNotifications/);
  assert.ok(cash.indexOf("cashIntegrityNotifications(reports, day, user.id, tills)") > cash.indexOf('if (user.role !== "admin") {'));
  // İstek dalları (personelin İsteklerim'i dahil) ModPOS okumaz
  assert.doesNotMatch(bell.slice(bell.indexOf("async function requestNotifications")), /modpos|Modpos/);
});

test("kaynak: anahtarın zil satırı yalnız yönetici dalında, Sistem başlığında; e-postanın kutusuna ModPOS satırları", () => {
  const src = read("src/server/actions/notifications.ts");
  const load = src.slice(src.indexOf("export async function loadPanelNotifications"));
  const staffReturn = load.indexOf('if (user.role !== "admin") return');
  assert.ok(staffReturn > 0);
  assert.ok(load.indexOf("modposKeyBell().catch(() => [])") > staffReturn, "personel dalında yok");
  assert.match(load, /return \[\.\.\.system, \.\.\.recipients, \.\.\.modpos, /);
  const srv = read("src/server/bell/modpos.ts");
  assert.match(srv, /href: MODPOS_SETTINGS_HREF,\s+group: "sistem",/);
  assert.match(srv, /export const MODPOS_SETTINGS_HREF = "\/panel\/ayarlar#modpos";/);
  const digest = read("src/server/staff-requests/digest.ts");
  assert.match(digest, /pastCountDigestLines\(now\), modposDigestLines\(now\)\]\)/);
  assert.match(digest, /\.\.\.count\.lines, \.\.\.modpos\.lines\]/);
  assert.match(digest, /\{ title: "ModPOS API", lines, href: modpos\.href \?\? "\/panel\/kasa"/);
});

test("kaynak: personelin yükleyicileri ve operasyonun ortak olguları föy okumaz", () => {
  for (const f of ["src/server/data/today-ops.ts", "src/server/bell/ops.ts"]) {
    assert.doesNotMatch(read(f), /loadModposSheets|modposMismatch|@\/server\/bell\/modpos/, f);
  }
  // cash-reports.ts föyü yalnız ay rakamına yedekte okur (modposFallbackSheets: modposTillRows, firstModposTillDay ve
  // yöneticinin Bugün kartı onun üstünden; ayın Z toplamı gibi sunucuda kalan ay bilgisi; docs/MODPOS-API.md › Ay
  // rakamına yedek); personelin rapor okuyucuları okumaz
  const cr = read("src/server/data/cash-reports.ts");
  assert.doesNotMatch(cr, /modposMismatch|@\/server\/bell\/modpos/);
  const fns = cr.split(/\n(?=export async function |async function |export function )/);
  const readers = fns.filter((f) => /loadModposSheets\(/.test(f)).map((f) => /function (\w+)/.exec(f)?.[1]);
  assert.deepEqual(readers, ["modposFallbackSheets"], "föy tablosunu yalnız ay yedeği okur (modposTillRows ve firstModposTillDay da onun üstünden)");
  assert.match(fns.find((f) => /function modposTillRows\b/.test(f)) ?? "", /modposFallbackSheets\(db, from, to\)/);
  assert.match(fns.find((f) => /function firstModposTillDay\b/.test(f)) ?? "", /modposTillRows\(db\)/);
  for (const name of ["getCashReport", "cashReportsBetween", "previousCarryOver", "nextReportAfter", "toCashDTO"]) {
    const body = fns.find((f) => new RegExp(`function ${name}\\b`).test(f)) ?? "";
    assert.ok(body, name);
    assert.doesNotMatch(body, /modpos|Modpos/, name);
  }
  const today = read("src/server/data/today.ts");
  const staffFacts = today.slice(today.indexOf("async function staffFacts"), today.indexOf("async function adminFacts"));
  assert.doesNotMatch(staffFacts, /modpos|Modpos/);
});
