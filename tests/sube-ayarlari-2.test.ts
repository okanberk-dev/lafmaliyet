// Şube başına ayarların ikinci turu (docs/SUBE.md › Şube başına ayarlar): komisyon ve yemek kartı kanalları, LafPOS
// bağlantısı ve geçiş günü, ModPOS ay yedeği, çalışma takvimi, banka POS ve yazarkasa. Saf kurallar ve kaynak kilitleri;
// veritabanında tests/sube-ayarlari-2-db.test.ts.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { dayContext, nextRefreshAt } from "../src/app/panel/bugun/logic";
import { ALL_FIELDS } from "../src/app/panel/ayarlar/fields";
import {
  BRANCH_SETTING_GROUPS,
  CALENDAR_GROUP,
  COMMISSION_GROUP,
  LAFPOS_GROUP,
  legacyOwnerId,
  MODPOS_GROUP,
  plainFields,
  SHARED_FOR_NOW,
  TILL_DEVICE_GROUP,
  tillDeviceGenitive,
  tillDeviceLabel,
} from "../src/lib/branch-settings/groups";
import { settingLinkError, settingMode } from "../src/lib/branch-settings/rules";
import type { BranchRow } from "../src/lib/branches";
import { CASH_EVENING_HOUR, isCashEvening } from "../src/lib/cash-report";

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

test("gruplar: komisyon, ModPOS ve takvim 'aynı' sunar (Tuzla'nın eski kaydı); LafPOS ve cihaz şubenin kendisinin", () => {
  const ids = BRANCH_SETTING_GROUPS.map((g) => g.id);
  for (const id of ["komisyon", "pos.lafpos", "modpos", "isletme.takvim", "kasa.cihaz"]) assert.ok(ids.includes(id), id);
  assert.equal(COMMISSION_GROUP.linkable && MODPOS_GROUP.linkable && CALENDAR_GROUP.linkable, true);
  assert.equal(LAFPOS_GROUP.linkable || TILL_DEVICE_GROUP.linkable, false);
  // Eski kaydın sahibi: LafPOS'unki Marina (geçildiği gün LafPOS'un şubesi), öbürleri Tuzla
  assert.equal(legacyOwnerId(LAFPOS_GROUP), "marina");
  for (const g of [COMMISSION_GROUP, MODPOS_GROUP, CALENDAR_GROUP]) assert.equal(legacyOwnerId(g), "tuzla", g.id);
  assert.deepEqual(LAFPOS_GROUP.legacySettings, { switchDay: "lafposGecisGunu" });
  assert.deepEqual(MODPOS_GROUP.legacySettings, { monthFallback: "modposAyYedegi" });
  assert.deepEqual(CALENDAR_GROUP.legacySettings, { openDays: "acikGun" });
  assert.equal(COMMISSION_GROUP.legacyKey, "komisyon.ayar");
  // Satırı yokken öbür şubeler Tuzla'ya örtük bağlı (sahibin varsayılanı: komisyon "aynı")
  assert.deepEqual(settingMode(COMMISSION_GROUP, "marina", []), { kind: "linked", to: "tuzla", implicit: true });
  assert.deepEqual(settingMode(TILL_DEVICE_GROUP, "marina", []), { kind: "own" });
  assert.match(settingLinkError(LAFPOS_GROUP, "marina", "tuzla", [], BRANCHES) ?? "", /şube başına tutulur/);
  // Artık şube başına olanlar "şimdilik ortak" listesinde yok
  for (const id of ["pos.lafpos", "komisyon", "modpos", "isletme.takvim"]) assert.ok(!SHARED_FOR_NOW.some((g) => g.id === id), id);
});

test("okuma kuralları: bozuk ya da eksik alan varsayılana düşer; anahtar şifreli alan", () => {
  assert.deepEqual(COMMISSION_GROUP.read({ channels: { pluxee: { payDays: 20 }, yok: { payDays: 3 }, multinet: { payDays: "x" } } }, {}), { channels: { pluxee: { payDays: 20 } } });
  assert.deepEqual(COMMISSION_GROUP.read({}, {}), { channels: {} });
  assert.equal(COMMISSION_GROUP.summary({ channels: {} }), "ödeme süresi 30 gün");
  assert.equal(COMMISSION_GROUP.summary({ channels: { pluxee: { payDays: 20 }, getir: { payDays: 45 } } }), "ödeme süreleri 20–45 gün");

  assert.deepEqual(LAFPOS_GROUP.read({ switchDay: "2026-11-21" }, {}), { switchDay: "2026-11-21" });
  assert.deepEqual(LAFPOS_GROUP.read({ switchDay: "bozuk", secret: "  gizli  " }, {}), { switchDay: null, secret: "gizli" });
  assert.deepEqual(LAFPOS_GROUP.secretFields, ["secret"]);
  assert.deepEqual(plainFields(LAFPOS_GROUP, { switchDay: "2026-11-21", secret: "gizli" }), { switchDay: "2026-11-21" }, "anahtar satırın değerine yazılmaz");

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
    if (/LAFPOS_SWITCH_KEY/.test(src)) bad.push(`${f}: LAFPOS_SWITCH_KEY`);
    if (/MODPOS_FALLBACK_KEY/.test(src)) bad.push(`${f}: MODPOS_FALLBACK_KEY`);
    if (/COMMISSION_SETTINGS_KEY/.test(src)) bad.push(`${f}: COMMISSION_SETTINGS_KEY`);
  }
  assert.deepEqual(bad, [], "eski kayıt yalnız şube ayarının geçiş okumasında (legacySettings, legacyKey)");
  // Okuyucular tek yerde: LafPOS'un şubesinin şube ayarı
  const branch = read("src/server/lafpos/branch.ts");
  assert.match(branch, /export async function lafposSwitchDay\(db: Reader = getDb\(\)\): Promise<string \| null> \{\s*const branch = await lafposBranchId\(db\);\s*return \(await resolveBranchSetting\(LAFPOS_GROUP, branch, db\)\)\.value\.switchDay;/);
  assert.match(read("src/server/lafpos/status.ts"), /export async function loadLafposSwitchDay\(db: DB = getDb\(\)\): Promise<string \| null> \{\s*return lafposSwitchDay\(db\);/);
  assert.match(read("src/server/data/lafpos-ikram.ts"), /export async function lafposSwitchDayOf\(db: Reader\): Promise<string \| null> \{\s*return lafposSwitchDay\(db\);/);
  assert.match(read("src/server/data/dataset.ts"), /lafposGecisGunu: switchDay, acikGun: calendar\.value\.openDays/);
  // Yazım şube ayarına, grup kilidiyle
  const admin = read("src/server/lafpos/admin.ts");
  assert.match(admin, /await lockGroup\(tx, LAFPOS_GROUP\.id\);[\s\S]*?await putBranchSetting\(tx, LAFPOS_GROUP, branchId, \{ switchDay: day \}, me\.name\);/);
  // Komisyon: ekran seçili şubenin süreleriyle, yazım şube ayarına
  const commission = read("src/server/data/commission.ts");
  assert.match(commission, /resolveBranchSetting\(COMMISSION_GROUP, opts\.settingsBranch \?\? scope, db\)/);
  assert.match(commission, /settings: channelSettings\.value\.channels,/);
  assert.match(commission, /withBranchScope\(ALL_BRANCHES, \(\) => loadCommissionReport\(scope\)\)/);
  assert.match(read("src/server/actions/commission.ts"), /await putBranchSetting\(tx, COMMISSION_GROUP, branchId, /);
});

test("kaynak: LafPOS'un imzalı uçları anahtarı şube ayarından okur (panelde saklanan önce, yoksa ortam)", () => {
  const routes = ["src/app/api/pos/gun/route.ts", ...readdirSync("src/app/api/panel/pos").map((d) => `src/app/api/panel/pos/${d}/route.ts`)];
  for (const f of routes) {
    const src = read(f);
    assert.match(src, /await lafposSecret\(\)/, f);
    assert.doesNotMatch(src, /[^t] lafposSecret\(\)/, `${f}: senkron okuma kalmadı`);
  }
  const branch = read("src/server/lafpos/branch.ts");
  assert.match(branch, /if \(stored\) return \{ env: \{ \.\.\.env, LAFPOS_SYNC_SECRET: stored \}, source: "panel" \};/);
  // Eylem: yalnız yönetici, yalnız LafPOS'un şubesinde, sitenin anahtarı reddedilir; anahtar işlem geçmişine yazılmaz
  const action = read("src/server/actions/branch-settings.ts");
  const save = action.slice(action.indexOf("export async function saveLafposSecret"));
  assert.match(save, /const me = await requireAdmin\(\);/);
  assert.match(save, /if \(d\.branchId !== \(await lafposBranchId\(db\)\)\) throw new UserError/);
  assert.match(save, /d\.secret === process\.env\.KARAOKE_SYNC_SECRET\?\.trim\(\)/);
  assert.doesNotMatch(save.slice(save.indexOf("logSetting")), /\$\{d\.secret\}/, "anahtar işlem geçmişine yazılmaz");
  // İstemciye giden kart verisinde gizli alan yok
  assert.match(read("src/server/branch-settings-view.ts"), /filter\(\(\[k\]\) => !group\.secretFields\.includes\(k\)\)/);
});

test("ekran: Şube ayarları yeni kartları çizer; Komisyon ve ModPOS aynı bileşenler, şubeyle", () => {
  const page = read("src/app/panel/subeler/[id]/page.tsx");
  for (const re of [/<LafposBranchCard/, /<ModposBranchCard/, /<TillDeviceCard view=\{device\} lafpos=\{lafposHere\} \/>/, /<ChannelSettingsCard settings=\{effectiveSettings\(commission\.value\.channels\)\}/, /<CalendarCard view=\{calendar\} \/>/]) {
    assert.match(page, re);
  }
  // Kart yalnız kasası o sistem olan şubede
  assert.match(page, /const lafposHere = branch\.id === \(await lafposBranchId\(\)\) && branch\.posSource === "lafpos";/);
  assert.match(page, /const modposHere = modposBranchIds\(branches\)\.includes\(branch\.id\);/);
  // Komisyon ekranının kartı seçili şubenin, "Tümü"de varsayılan şubenin
  const komisyon = read("src/app/panel/komisyonlar/page.tsx");
  assert.match(komisyon, /const settingsBranch = tillBranches\(view\.branches\)\.find\(\(b\) => b\.id === view\.scope\)\?\.id \?\? DEFAULT_BRANCH_ID;/);
  assert.match(komisyon, /<ChannelSettingsCard settings=\{report\.settings\} branchId=\{settingsBranch\}/);
  assert.match(read("src/app/panel/komisyonlar/channel-settings.tsx"), /saveCommissionSettings\(\{ branchId, channels:/);
  // "Diğer şubeyle aynı" anahtarı tek bileşen; dokunma hedefi ToggleRow (44 px)
  const toggle = read("src/components/panel/same-as-toggle.tsx");
  assert.match(toggle, /<ToggleRow/);
  assert.match(toggle, /setBranchSettingLink\(\{ branchId, group, sameAs: to === "link" \? target : null \}\)/);
  // Anahtar alanı parola kutusu, değer bir daha gösterilmez
  assert.match(read("src/app/panel/subeler/[id]/pos-card.tsx"), /<PasswordInput\s+id="lafpos-anahtar"/);
});

test("kaynak: zil ve Bugün kasa raporu saatini şubeden, akşam fişini şubenin cihazından okur", () => {
  const bell = read("src/server/bell/kasa.ts");
  assert.match(bell, /resolveForTills\(CALENDAR_GROUP\), resolveForTills\(TILL_DEVICE_GROUP\)/);
  assert.match(bell, /body: eveningText\(lafpos, evening\.deviceOf\(till\)\)/);
  assert.match(bell, /body: eveningText\(lafpos, evening\.deviceOf\(b\.id\)\)/);
  const today = read("src/server/data/today.ts");
  assert.match(today, /resolveBranchSetting\(CALENDAR_GROUP, karaokeScope\)\.then\(\(r\) => r\.value\.eveningHour\)/);
  assert.match(read("src/app/panel/bugun/logic.ts"), /const c = dayContext\(f\.now, f\.eveningHour\);/);
  // Kasa raporu e-postası yazarkasa başlığında cihaz ve sicil no
  assert.match(read("src/server/cash/report-email.ts"), /resolveBranchSetting\(TILL_DEVICE_GROUP, row\.branchId\)/);
  assert.match(read("src/server/lafpos/foto.ts"), /resolveBranchSetting\(TILL_DEVICE_GROUP, branchId, db\)/);
});
