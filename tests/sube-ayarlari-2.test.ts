// Şube başına ayarların ikinci turu (docs/SUBE.md › Şube başına ayarlar): komisyon ve yemek kartı kanalları, AsilPOS
// bağlantısı ve geçiş günü, ModPOS ay yedeği, çalışma takvimi, banka POS ve yazarkasa. Saf kurallar ve kaynak kilitleri;
// veritabanında tests/sube-ayarlari-2-db.test.ts.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayContext, dayTasks, eveningHours, nextRefreshAt, type DayFacts } from "../src/app/panel/bugun/logic";
import { ALL_FIELDS } from "../src/app/panel/ayarlar/fields";
import { GECIS_GUNU_AYARI, SUBE_AYAR_GRUBU } from "../src/lib/asilpos/eski-adlar";
import {
  BRANCH_SETTING_GROUPS,
  CALENDAR_GROUP,
  COMMISSION_GROUP,
  ASILPOS_GROUP,
  legacyOwnerId,
  MODPOS_GROUP,
  plainFields,
  SHARED_FOR_NOW,
  TILL_DEVICE_GROUP,
  tillDeviceGenitive,
  tillDeviceLabel,
  groupReadIds,
  branchSettingGroup,
} from "../src/lib/branch-settings/groups";
import { settingLinkError, settingMode } from "../src/lib/branch-settings/rules";
import type { BranchRow } from "../src/lib/branches";
import { CASH_EVENING_HOUR, isCashEvening } from "../src/lib/cash-report";
import { businessPayDays } from "../src/lib/commission/report";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
/** İstanbul saatiyle an ("2026-11-25T21:00" → UTC+3) */
const tr = (local: string) => new Date(`${local}:00+03:00`);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

const BRANCHES: Pick<BranchRow, "id" | "name" | "kind" | "active">[] = [
  { id: "tuzla", name: "Tuzla", kind: "fiziksel", active: true },
  { id: "marina", name: "Marina", kind: "fiziksel", active: true },
  { id: "online", name: "laffogato.net", kind: "online", active: true },
];

test("gruplar: komisyon, ModPOS ve takvim 'aynı' sunar (Tuzla'nın eski kaydı); AsilPOS ve cihaz şubenin kendisinin", () => {
  const ids = BRANCH_SETTING_GROUPS.map((g) => g.id);
  for (const id of ["komisyon", SUBE_AYAR_GRUBU, "modpos", "isletme.takvim", "kasa.cihaz"]) assert.ok(ids.includes(id), id);
  assert.equal(COMMISSION_GROUP.linkable && MODPOS_GROUP.linkable && CALENDAR_GROUP.linkable, true);
  assert.equal(ASILPOS_GROUP.linkable || TILL_DEVICE_GROUP.linkable, false);
  // Eski kaydın sahibi: AsilPOS'unki Marina (geçildiği gün AsilPOS'un şubesi), öbürleri Tuzla
  assert.equal(legacyOwnerId(ASILPOS_GROUP), "marina");
  for (const g of [COMMISSION_GROUP, MODPOS_GROUP, CALENDAR_GROUP]) assert.equal(legacyOwnerId(g), "tuzla", g.id);
  assert.deepEqual(ASILPOS_GROUP.legacySettings, { switchDay: GECIS_GUNU_AYARI });
  // Ad değişikliği: grup ve eski kaydın anahtarı eski adla yazılır, yeni adları önce okunur
  assert.deepEqual([ASILPOS_GROUP.id, ASILPOS_GROUP.readIds, ASILPOS_GROUP.legacySettingsNew], [SUBE_AYAR_GRUBU, ["pos.asilpos"], { switchDay: "asilposGecisGunu" }]);
  assert.deepEqual(groupReadIds(ASILPOS_GROUP), ["pos.asilpos", SUBE_AYAR_GRUBU]);
  assert.equal(branchSettingGroup("pos.asilpos"), ASILPOS_GROUP);
  assert.deepEqual(MODPOS_GROUP.legacySettings, { monthFallback: "modposAyYedegi" });
  assert.deepEqual(CALENDAR_GROUP.legacySettings, { openDays: "acikGun" });
  assert.equal(COMMISSION_GROUP.legacyKey, "komisyon.ayar");
  // Satırı yokken öbür şubeler Tuzla'ya örtük bağlı (sahibin varsayılanı: komisyon "aynı")
  assert.deepEqual(settingMode(COMMISSION_GROUP, "marina", []), { kind: "linked", to: "tuzla", implicit: true });
  assert.deepEqual(settingMode(TILL_DEVICE_GROUP, "marina", []), { kind: "own" });
  assert.match(settingLinkError(ASILPOS_GROUP, "marina", "tuzla", [], BRANCHES) ?? "", /şube başına tutulur/);
  // Artık şube başına olanlar "şimdilik ortak" listesinde yok
  for (const id of [SUBE_AYAR_GRUBU, "komisyon", "modpos", "isletme.takvim"]) assert.ok(!SHARED_FOR_NOW.some((g) => g.id === id), id);
});

test("okuma kuralları: bozuk ya da eksik alan varsayılana düşer; anahtar şifreli alan", () => {
  assert.deepEqual(COMMISSION_GROUP.read({ channels: { pluxee: { payDays: 20 }, yok: { payDays: 3 }, multinet: { payDays: "x" } } }, {}), { channels: { pluxee: { payDays: 20 } } });
  assert.deepEqual(COMMISSION_GROUP.read({}, {}), { channels: {} });
  assert.equal(COMMISSION_GROUP.summary({ channels: {} }), "ödeme süresi 30 gün");
  assert.equal(COMMISSION_GROUP.summary({ channels: { pluxee: { payDays: 20 }, getir: { payDays: 45 } } }), "ödeme süreleri 20–45 gün");

  assert.deepEqual(ASILPOS_GROUP.read({ switchDay: "2026-11-21" }, {}), { switchDay: "2026-11-21" });
  assert.deepEqual(ASILPOS_GROUP.read({ switchDay: "bozuk", secret: "  gizli  " }, {}), { switchDay: null, secret: "gizli" });
  assert.deepEqual(ASILPOS_GROUP.secretFields, ["secret"]);
  assert.deepEqual(plainFields(ASILPOS_GROUP, { switchDay: "2026-11-21", secret: "gizli" }), { switchDay: "2026-11-21" }, "anahtar satırın değerine yazılmaz");

  assert.deepEqual(MODPOS_GROUP.read({ monthFallback: "true" }, {}), { monthFallback: false }, "yalnız true açık");
  assert.deepEqual(MODPOS_GROUP.read({ monthFallback: true }, {}), { monthFallback: true });

  assert.deepEqual(CALENDAR_GROUP.read({}, {}), { openDays: 30, eveningHour: CASH_EVENING_HOUR });
  assert.deepEqual(CALENDAR_GROUP.read({ openDays: 26, eveningHour: 21 }, {}), { openDays: 26, eveningHour: 21 });
  assert.deepEqual(CALENDAR_GROUP.read({ openDays: 32, eveningHour: 4 }, {}), { openDays: 30, eveningHour: 20 });
  assert.deepEqual(CALENDAR_GROUP.read({ openDays: 25.5, eveningHour: "21" }, {}), { openDays: 30, eveningHour: 20 });

  assert.deepEqual(TILL_DEVICE_GROUP.read({ device: "tokenx", registerNo: "  AB 123 ", bank: "" }, {}), { device: "tokenx", registerNo: "AB 123", bank: null });
  assert.deepEqual(TILL_DEVICE_GROUP.read({ device: "ingenico" }, {}), { device: null, registerNo: null, bank: null });
  assert.equal(TILL_DEVICE_GROUP.summary({ device: "pavo", registerNo: "AB1", bank: null }), "Pavo · sicil AB1");
  assert.equal(tillDeviceLabel("tokenx"), "TokenX");
  // Akşam hatırlatmasının fişi: belirtilmediyse bugünkü metin (Pavo)
  assert.equal(tillDeviceGenitive(null), "Pavo'nun");
  assert.equal(tillDeviceGenitive("tokenx"), "TokenX'in");
  assert.equal(tillDeviceGenitive("diger"), "banka POS'unun");
});

test("kasa raporu saati şubenin: akşam kuralı, Bugün'ün günü ve yenilenme anı", () => {
  assert.equal(isCashEvening(tr("2026-11-25T20:30")), true, "varsayılan 20:00");
  assert.equal(isCashEvening(tr("2026-11-25T20:30"), 21), false);
  assert.equal(isCashEvening(tr("2026-11-25T21:00"), 21), true);
  assert.equal(isCashEvening(tr("2026-11-26T04:30"), 23), true, "gece 05:00'e kadar akşam");
  assert.equal(dayContext(tr("2026-11-25T20:30")).evening, true);
  assert.equal(dayContext(tr("2026-11-25T20:30"), 22).evening, false);
  // Yenilenme: 21:00'li şubede ekran 21:00'de de yenilenir; 20:00 sınırı kalır
  assert.equal(nextRefreshAt(tr("2026-11-25T20:30"), [], 21), tr("2026-11-25T21:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-11-25T19:30"), [], 21), tr("2026-11-25T20:00").getTime());
  assert.equal(nextRefreshAt(tr("2026-11-25T20:30")), tr("2026-11-26T00:00").getTime());
  // "Tümü"de kasaların saatleri ayrı: ekran her birinde yenilenir
  assert.equal(nextRefreshAt(tr("2026-11-25T20:30"), [], [20, 22]), tr("2026-11-25T22:00").getTime());
  assert.deepEqual(eveningHours({ eveningHour: 18, cash: null }), [18]);
  const till = (id: string, eveningHour?: number) => ({ id, name: id, today: null, yesterday: null, firstDate: null, ...(eveningHour === undefined ? {} : { eveningHour }) });
  assert.deepEqual(eveningHours({ cash: { today: null, yesterday: null, firstDate: null, tills: [till("tuzla", 18), till("marina", 22), till("bodrum")] } }), [CASH_EVENING_HOUR, 18, 22]);
});

test("Bugün 'Tümü'de her kasanın akşamı kendi saatiyle (zil gibi): 19:00'da Marina (22:00) henüz akşam değil", () => {
  const now = tr("2026-11-25T19:00");
  const till = (id: string, eveningHour: number) => ({ id, name: id === "tuzla" ? "Tuzla" : "Marina", today: null, yesterday: null, firstDate: "2026-01-01", eveningHour });
  const tasks = dayTasks({ role: "admin", now, eveningHour: 18, cash: { today: null, yesterday: null, firstDate: "2026-01-01", tills: [till("tuzla", 18), till("marina", 22)] } } as DayFacts);
  const kasa = tasks.filter((x) => x.key.startsWith("kasa") && x.title.startsWith("Bugünkü kasa raporu"));
  assert.deepEqual(
    kasa.map((x) => [x.title, x.status]),
    [
      ["Bugünkü kasa raporu · Tuzla", "todo"],
      ["Bugünkü kasa raporu · Marina", "later"],
    ],
  );
});

test("çalışma takviminin saat metni ayrılma ekini saate göre alır", () => {
  assert.equal(CALENDAR_GROUP.summary({ openDays: 26, eveningHour: 20 }), "ayda 26 gün · rapor 20:00'den sonra");
  assert.equal(CALENDAR_GROUP.summary({ openDays: 26, eveningHour: 13 }), "ayda 26 gün · rapor 13:00'ten sonra");
  assert.equal(CALENDAR_GROUP.summary({ openDays: 26, eveningHour: 16 }), "ayda 26 gün · rapor 16:00'dan sonra");
  assert.equal(CALENDAR_GROUP.summary({ openDays: 26, eveningHour: 19 }), "ayda 26 gün · rapor 19:00'dan sonra");
  assert.equal(CALENDAR_GROUP.summary({ openDays: 26, eveningHour: 23 }), "ayda 26 gün · rapor 23:00'ten sonra");
  assert.doesNotMatch(read("src/app/panel/subeler/[id]/calendar-card.tsx"), /&apos;den sonra/);
});

test("komisyon: işletmenin hakedişi şubelerin en kısa süresiyle; şubeler 'aynı'yken tek şubeninki", () => {
  const tuzla = { pluxee: { payDays: 30 }, multinet: { payDays: 30 } };
  assert.deepEqual(businessPayDays([tuzla, tuzla]), businessPayDays([tuzla]), "aynı süreler: bugünkü gibi");
  const both = businessPayDays([tuzla, { multinet: { payDays: 15 } }]);
  assert.equal(both.multinet.payDays, 15, "Marina'nın kısa süresi işletmenin son gününü öne alır");
  assert.equal(both.pluxee.payDays, 30);
  assert.deepEqual(businessPayDays([]), businessPayDays([null]), "şube yoksa varsayılan");
});

test("ayda açık gün Ayarlar'ın formunda değil, şube başına; eski sekmenin gönderdiği alan yok sayılır", () => {
  assert.equal(ALL_FIELDS.some((f) => (f.key as string) === "acikGun"), false);
  const settings = read("src/server/actions/settings.ts");
  assert.doesNotMatch(settings, /^\s*acikGun:/m, "saveSettings acikGun yazmaz");
  const dataset = read("src/server/data/dataset.ts");
  assert.match(dataset, /resolveBranchSetting\(CALENDAR_GROUP, scope, db\)/, "veri kümesi seçili şubenin takvimi");
  assert.match(dataset, /acikGun: calendar\.value\.openDays/);
});

test("kaynak: geçiş günü, ModPOS ay yedeği ve komisyon süreleri eski genel kayıttan doğrudan okunmaz", () => {
  const server = [...files("src/server"), ...files("src/app")].filter((f) => !f.endsWith("src/server/data/commission.ts"));
  const bad: string[] = [];
  for (const f of server) {
    const src = read(f);
    if (/ASILPOS_SWITCH_KEY/.test(src)) bad.push(`${f}: ASILPOS_SWITCH_KEY`);
    if (/MODPOS_FALLBACK_KEY/.test(src)) bad.push(`${f}: MODPOS_FALLBACK_KEY`);
    if (/COMMISSION_SETTINGS_KEY/.test(src)) bad.push(`${f}: COMMISSION_SETTINGS_KEY`);
  }
  assert.deepEqual(bad, [], "eski kayıt yalnız şube ayarının geçiş okumasında (legacySettings, legacyKey)");
  // Okuyucular tek yerde (çok şube): kasaların listesi kütükten, her kasanın geçiş günü kendi şube ayarından
  const tills = read("src/server/pos/tills.ts");
  assert.match(tills, /resolveForTills\(ASILPOS_GROUP, db, \{ closed: true \}\)/);
  assert.match(tills, /if \(!ids\.includes\(branchId\)\) return null;\n\s+return \(await resolveBranchSetting\(ASILPOS_GROUP, branchId, db\)\)\.value\.switchDay;/);
  // Gün sonunu yazan ve silen işlem geçiş gününü yazdığı şubeyle okur (şube işlemin içinde yeniden türetilmez)
  assert.match(read("src/server/asilpos/ingest.ts"), /isAsilposDay\(day\.date, await switchDayOf\(branchId, tx\)\)/);
  assert.match(read("src/server/asilpos/admin.ts"), /const counted = isAsilposDay\(date, await switchDayOf\(branchId, tx\)\);/);
  assert.match(read("src/server/data/asilpos-ikram.ts"), /export async function asilposSwitchDaysOf\(db: Reader\): Promise<SwitchDays> \{\s*return loadSwitchDays\(db\);/);
  assert.match(read("src/server/data/dataset.ts"), /asilposGecisGunu: earliestSwitchDay\(switchDays\), acikGun: calendar\.value\.openDays/);
  // Yazım şube ayarına, grup kilidiyle
  const admin = read("src/server/asilpos/admin.ts");
  assert.match(admin, /await lockGroup\(tx, ASILPOS_GROUP\.id\);[\s\S]*?await putBranchSetting\(tx, ASILPOS_GROUP, branchId, \{ switchDay: day \}, me\.name\);/);
  // Eski genel kayda artık yazılmaz (çok şube); kapalı dönemi etkileyen değişiklik yazılmaz
  assert.doesNotMatch(admin, /legacySettings!/);
  assert.match(admin, /const refusal = lockRefusal\(/);
  // Komisyon: hakediş işletmenin; son gün seçiciden bağımsız, şubelerin en kısa süresiyle (ekran, zil, Bugün, e-posta aynı)
  const commission = read("src/server/data/commission.ts");
  assert.doesNotMatch(commission, /settingsBranch/);
  assert.match(commission, /\n {4}loadBusinessPayDays\(db\),\n/);
  assert.match(commission, /resolveForTills\(COMMISSION_GROUP, db\)/);
  assert.match(commission, /return businessPayDays\(/);
  assert.match(commission, /settings: channelSettings,/);
  assert.match(commission, /withBranchScope\(ALL_BRANCHES, \(\) => loadCommissionReport\(\)\), withBranchScope\(scope, \(\) => loadCommissionReport\(\)\)/);
  assert.match(read("src/server/actions/commission.ts"), /await putBranchSetting\(tx, COMMISSION_GROUP, branchId, /);
});

test("kaynak: AsilPOS'un imzalı uçları anahtarı şube ayarından okur (panelde saklanan önce, yoksa ortam)", () => {
  const routes = ["src/app/api/pos/gun/route.ts", ...readdirSync("src/app/api/panel/pos").map((d) => `src/app/api/panel/pos/${d}/route.ts`)];
  for (const f of routes) {
    const src = read(f);
    // İsteğin kasası: anahtar şubeyi bulur; önbellek ön süzgeç, imza tutarsa veritabanından yeniden (döndürülen eski anahtar geçmez)
    assert.match(src, /await posRequestCaller\(request(, body)?\)/, f);
    assert.doesNotMatch(src, /asilpos(Request)?Secret\(/, `${f}: eski tek anahtar okuması kalmadı`);
  }
  const branch = read("src/server/asilpos/branch.ts");
  // Ortamdaki anahtar yalnız eski kurulumun şubesinin, o şubenin saklanan anahtarı yokken
  assert.match(branch, /if \(!raw\.has\(LEGACY_POS_BRANCH_ID\) && env0\) raw\.set\(LEGACY_POS_BRANCH_ID, \{ value: env0, source: "ortam" \}\);/);
  // Eylem: yalnız yönetici, yalnız AsilPOS'un şubesinde, sitenin anahtarı reddedilir; anahtar işlem geçmişine yazılmaz
  const action = read("src/server/actions/branch-settings.ts");
  const save = action.slice(action.indexOf("export async function saveAsilposSecret"));
  assert.match(save, /const me = await requireAdmin\(\);/);
  assert.match(save, /if \(!ids\.includes\(d\.branchId\) && !install\) throw new UserError/);
  assert.match(save, /const taken = await posKeyTaken\(d\.branchId, d\.secret, db\);/, "başka şubenin anahtarı reddedilir");
  // Parolayla (anahtar gün sonu yazımlarının güven kökü), denetimlerden sonra, yazımdan önce
  assert.ok(save.indexOf("await requireStepUp(me, confirm,") > save.indexOf("KARAOKE_SYNC_SECRET"));
  assert.ok(save.indexOf("await requireStepUp(me, confirm,") < save.indexOf("db.transaction("));
  assert.ok(save.indexOf("forgetPosKeys();") > save.indexOf("db.transaction("), "kayıttan sonra önbellek düşer");
  // İmzalı uçların okuması önbellekli ve veritabanı hatasında null (503)
  assert.match(branch, /if \(hit && now - hit\.at < POS_KEYS_CACHE_MS\) return \{ \.\.\.hit, fresh: false \};/);
  assert.match(branch, /console\.error\("\[asilpos\] anahtarlar okunamadı", e\);\s*return null;/);
  assert.match(branch, /export function forgetPosBranches\(\): void \{\s*forgetPosTills\(\);\s*forgetPosKeys\(\);/);
  assert.match(save, /d\.secret === process\.env\.KARAOKE_SYNC_SECRET\?\.trim\(\)/);
  assert.doesNotMatch(save.slice(save.indexOf("logSetting")), /\$\{d\.secret\}/, "anahtar işlem geçmişine yazılmaz");
  // İstemciye giden kart verisinde gizli alan yok
  assert.match(read("src/server/branch-settings-view.ts"), /filter\(\(\[k\]\) => !group\.secretFields\.includes\(k\)\)/);
});

test("ekran: Şube ayarları yeni kartları çizer; Komisyon ve ModPOS aynı bileşenler, şubeyle", () => {
  const page = read("src/app/panel/subeler/[id]/page.tsx");
  for (const re of [/<AsilposBranchCard/, /<ModposBranchCard/, /<TillDeviceCard view=\{device\} asilpos=\{tillHere\} \/>/, /<ChannelSettingsCard settings=\{effectiveSettings\(commission\.value\.channels\)\}/, /<CalendarCard view=\{calendar\} \/>/]) {
    assert.match(page, re);
  }
  // AsilPOS kartı kasası AsilPOS olan ya da kurulumu yapılmış şubede (çok şube; sunucu aynı kurala bakar)
  assert.match(page, /const asilposHere = tillHere \|\| Boolean\(installed\);/);
  assert.match(page, /sourceModpos: branch\.posSource !== "asilpos",/);
  assert.match(page, /<AsilposOldSecretCard branchId=\{branch\.id\} \/>/, "öbür şubede kalan eski anahtar silinebilir");
  // "X şubesinde düzenle" bağlantısı kartı olan sayfaya çıkar: başka şube bu şubenin ayarını kullanıyorsa kart çizilir
  assert.match(page, /\{modposHere \|\| modpos\.link\?\.sharedWith\.length \? \(/);
  assert.match(page, /\{hasFeature\(branch, "yemek_karti"\) \|\| commission\.link\?\.sharedWith\.length \? \(/);
  assert.match(page, /const modposHere = modposBranchIds\(branches\)\.includes\(branch\.id\);/);
  // Komisyon ekranının kartı seçili şubenin, "Tümü"de varsayılan şubenin
  const komisyon = read("src/app/panel/komisyonlar/page.tsx");
  assert.match(komisyon, /const settingsBranch = tillBranches\(view\.branches\)\.find\(\(b\) => b\.id === view\.scope\)\?\.id \?\? DEFAULT_BRANCH_ID;/);
  assert.match(komisyon, /<ChannelSettingsCard settings=\{effectiveSettings\(channelView\.value\.channels\)\} branchId=\{settingsBranch\}/);
  assert.match(read("src/app/panel/komisyonlar/channel-settings.tsx"), /saveCommissionSettings\(\{ branchId, channels:/);
  // "Diğer şubeyle aynı" anahtarı tek bileşen; dokunma hedefi ToggleRow (44 px)
  const toggle = read("src/components/panel/same-as-toggle.tsx");
  assert.match(toggle, /<ToggleRow/);
  assert.match(toggle, /setBranchSettingLink\(\{ branchId, group, sameAs: to === "link" \? target : null \}\)/);
  // Anahtar alanı parola kutusu, değer bir daha gösterilmez
  const pos = read("src/app/panel/subeler/[id]/pos-card.tsx");
  assert.match(pos, /<PasswordInput\s+id="asilpos-anahtar"/);
  // Kaydetme ve silme parola penceresiyle
  assert.match(pos, /await saveAsilposSecret\(\{ branchId: data\.branchId, secret: value \}, \{ password \}\)/);
  assert.match(pos, /await saveAsilposSecret\(\{ branchId, secret: null \}, \{ password \}\)/);
  assert.doesNotMatch(pos, /<ConfirmDialog/);
});

test("kaynak: zil ve Bugün kasa raporu saatini şubeden, akşam fişini şubenin cihazından okur", () => {
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /resolveForTills\(CALENDAR_GROUP\), resolveForTills\(TILL_DEVICE_GROUP\)/);
  assert.match(bell, /body: eveningText\(asilpos, evening\.deviceOf\(till\)\)/);
  assert.match(bell, /body: eveningText\(asilpos, evening\.deviceOf\(b\.id\)\)/);
  const today = read("src/server/data/today.ts");
  assert.match(today, /resolveBranchSetting\(CALENDAR_GROUP, karaokeScope\)\.then\(\(r\) => r\.value\.eveningHour\)/);
  assert.match(read("src/app/panel/bugun/logic.ts"), /const c = dayContext\(f\.now, f\.eveningHour\);/);
  // "Tümü"de kasa satırları her kasanın kendi saatiyle (zil gibi)
  assert.match(today, /resolveForTills\(CALENDAR_GROUP\)/);
  assert.match(read("src/app/panel/bugun/logic.ts"), /evening: isCashEvening\(f\.now, t\.eveningHour\)/);
  // Kasa raporu e-postası yazarkasa başlığında cihaz ve sicil no
  assert.match(read("src/server/cash/report-email.ts"), /resolveBranchSetting\(TILL_DEVICE_GROUP, row\.branchId\)/);
  assert.match(read("src/server/asilpos/foto.ts"), /resolveBranchSetting\(TILL_DEVICE_GROUP, branchId, db\)/);
});
