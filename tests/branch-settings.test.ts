// Şube başına ayarlar (plan B1–B3, B5, B7; docs/SUBE.md › Şube başına ayarlar): saf kurallar (kendi ayarı mı, kime
// bağlı, değer hangi şubeden, "aynı" seçimi geçerli mi, kapatma) ve kaynak denetimleri (kasa raporu ayarının her okuyucusu
// şubeyi verir, yalnız yönetici yazar, yedek şifreli alanı almaz). Veritabanı yolları tests/branch-settings-db.test.ts'te.
// Çalıştırma: npx tsx --test tests/branch-settings.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SUBE_AYAR_GRUBU } from "../src/lib/asilpos/eski-adlar";
import { TABLE_RULES } from "../src/lib/backup/format";
import {
  BRANCH_SETTING_GROUPS,
  CASH_REPORT_GROUP,
  CASH_STAFF_GROUP,
  PARASUT_GROUP,
  branchSettingGroup,
  legacyOwnerId,
  plainFields,
  SHARED_FOR_NOW,
} from "../src/lib/branch-settings/groups";
import {
  settingCloseError,
  settingDependents,
  settingLinkError,
  settingLinkTargets,
  settingMode,
  settingModeText,
  settingSource,
  type SettingLink,
} from "../src/lib/branch-settings/rules";
import type { BranchRow } from "../src/lib/branches";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const b = (id: string, name: string, o: Partial<BranchRow> = {}): BranchRow => ({ id, name, kind: "fiziksel", posSource: "modpos", active: true, openedOn: null, sortOrder: 0, ...o });
const TUZLA = b("tuzla", "Tuzla");
const MARINA = b("marina", "Marina", { posSource: "asilpos" });
const BODRUM = b("bodrum", "Bodrum");
const ONLINE = b("online", "laffogato.net", { kind: "online", posSource: "yok" });
const ALL = [TUZLA, MARINA, BODRUM, ONLINE];
const linkable = { linkable: true, label: "Kasa raporu alıcıları" };

test("durum: varsayılan şube hep kendi ayarı; satırı olmayan öbür şube örtük olarak ona bağlı; liste grubunda bağ yok", () => {
  assert.deepEqual(settingMode(linkable, "tuzla", []), { kind: "own" });
  assert.deepEqual(settingMode(linkable, "marina", []), { kind: "linked", to: "tuzla", implicit: true }, "geçişte Marina 'Tuzla ile aynı' başlar");
  assert.deepEqual(settingMode(linkable, "marina", [{ branchId: "marina", sameAs: null }]), { kind: "own" });
  assert.deepEqual(settingMode(linkable, "marina", [{ branchId: "marina", sameAs: "bodrum" }]), { kind: "linked", to: "bodrum", implicit: false });
  assert.deepEqual(settingMode({ linkable: false }, "marina", []), { kind: "own" }, "çalışan listesi şubenin kendisinin");
  // Bozuk satır (varsayılan şube bağlı, kendine bağlı) okumayı döngüye sokmaz
  assert.deepEqual(settingMode(linkable, "tuzla", [{ branchId: "tuzla", sameAs: "marina" }]), { kind: "own" });
  assert.deepEqual(settingMode(linkable, "marina", [{ branchId: "marina", sameAs: "marina" }]), { kind: "own" });
});

test("değerin şubesi: bağlıysa hedef; hedef kapandıysa ya da kendisi bağlıysa zincir yok, varsayılan şube", () => {
  assert.equal(settingSource(linkable, "marina", [], ALL).from, "tuzla");
  assert.equal(settingSource(linkable, "marina", [{ branchId: "marina", sameAs: null }], ALL).from, "marina");
  const rows: SettingLink[] = [
    { branchId: "bodrum", sameAs: null },
    { branchId: "marina", sameAs: "bodrum" },
  ];
  assert.equal(settingSource(linkable, "marina", rows, ALL).from, "bodrum");
  assert.equal(settingSource(linkable, "marina", rows, [TUZLA, MARINA, { ...BODRUM, active: false }]).from, "tuzla", "kapalı hedef");
  // Bodrum'un satırı yok: örtük olarak Tuzla'ya bağlı, Marina zincirle Tuzla'ya gitmez, doğrudan varsayılana düşer
  assert.equal(settingSource(linkable, "marina", [{ branchId: "marina", sameAs: "bodrum" }], ALL).from, "tuzla");
});

test("'aynı' seçimi: liste grubu, kendisi, varsayılan şube, kapalı ya da online hedef, bağlı hedef, bağlı şubesi olan reddedilir", () => {
  assert.match(settingLinkError({ linkable: false, label: "Çalışanların gün sonu e-postası" }, "marina", "tuzla", [], ALL)!, /şube başına tutulur/);
  assert.match(settingLinkError(linkable, "marina", "marina", [], ALL)!, /kendisiyle/);
  assert.match(settingLinkError(linkable, "tuzla", "marina", [{ branchId: "marina", sameAs: null }], ALL)!, /ana ayardır/);
  assert.match(settingLinkError(linkable, "marina", "online", [], ALL)!, /açık bir şube/);
  assert.match(settingLinkError(linkable, "marina", "bodrum", [], [TUZLA, MARINA, { ...BODRUM, active: false }])!, /açık bir şube/);
  assert.match(settingLinkError(linkable, "marina", "bodrum", [], ALL)!, /Bodrum de başka şubenin/, "Bodrum'un satırı yok: Tuzla'ya bağlı");
  const rows: SettingLink[] = [
    { branchId: "bodrum", sameAs: null },
    { branchId: "marina", sameAs: "bodrum" },
  ];
  assert.match(settingLinkError(linkable, "bodrum", "tuzla", rows, ALL)!, /Marina bu şubenin ayarını kullanıyor/);
  assert.equal(settingLinkError(linkable, "marina", "tuzla", rows, ALL), null);
  assert.equal(settingLinkError(linkable, "marina", "tuzla", [], ALL), null, "örtük bağ açık bağa çevrilebilir");
});

test("seçenekler, bağlılar ve kapatma: kendi ayarı olan açık şubeler; bağlı şube varken kapatılmaz", () => {
  const rows: SettingLink[] = [{ branchId: "bodrum", sameAs: null }];
  assert.deepEqual(settingLinkTargets(linkable, "marina", rows, ALL).map((x) => x.id), ["tuzla", "bodrum"]);
  assert.deepEqual(settingLinkTargets(linkable, "tuzla", rows, ALL), [], "varsayılan şube bağlanamaz");
  assert.deepEqual(settingLinkTargets({ linkable: false }, "marina", rows, ALL), []);
  assert.deepEqual(settingDependents(linkable, "tuzla", rows, ALL).map((x) => x.id), ["marina"], "örtük bağlı Marina");
  const linked: SettingLink[] = [...rows, { branchId: "marina", sameAs: "bodrum" }];
  const byGroup = new Map([[CASH_REPORT_GROUP.id, linked]]);
  assert.match(settingCloseError(BRANCH_SETTING_GROUPS, BODRUM, byGroup, ALL)!, /^Marina, kasa raporu alıcıları için Bodrum şubesinin ayarını kullanıyor/);
  assert.equal(settingCloseError(BRANCH_SETTING_GROUPS, MARINA, byGroup, ALL), null);
  assert.equal(settingModeText({ kind: "linked", to: "tuzla", implicit: true }, ALL), "Tuzla ile aynı");
  assert.equal(settingModeText({ kind: "own" }, ALL), "Kendi ayarı");
});

test("gruplar: alıcılar 'aynı' sunulur ve Tuzla'nın, çalışan listesi şubenin kendisinin ve Marina'nın; eski kayıt ve ortam", () => {
  assert.deepEqual(
    BRANCH_SETTING_GROUPS.map((g) => [g.id, g.linkable, legacyOwnerId(g), g.legacyKey]),
    [
      ["kasa.rapor", true, "tuzla", "cash.settings"],
      ["kasa.calisan", false, "marina", "cash.settings"],
      // Paraşüt hesabı (B4): satır yalnız bağı tutar; eski kayıt varsayılan şubenin tek hesabı
      ["parasut", true, "tuzla", "parasut.settings"],
      // Şube ayarları 2. tur (25 Kasım 2026): sahibin varsayılanı komisyonda "aynı"; AsilPOS ve cihaz şubenin kendisinin
      ["komisyon", true, "tuzla", "komisyon.ayar"],
      [SUBE_AYAR_GRUBU, false, "marina", null],
      ["modpos", true, "tuzla", null],
      ["isletme.takvim", true, "tuzla", null],
      ["kasa.cihaz", false, "tuzla", null],
      // Kör sayım (Dalga 2): şubenin kendisinin; seçilmemişken varsayılan (ModPOS'taki şubede açık)
      ["kasa.kor", false, "tuzla", null],
      // Hazır vardiyalar (26 Kasım 2026): saatler şubenin açılışına bağlı, "aynı" yok; seçilmemişken bugünkü sabit saatler
      ["vardiya.hazir", false, "tuzla", null],
    ],
  );
  assert.equal(branchSettingGroup("kasa.rapor"), CASH_REPORT_GROUP);
  assert.equal(branchSettingGroup("yok"), null);
  // Kayıt yoksa ortamın alıcıları (CASH_REPORT_RECIPIENTS), e-posta açık; bozuk alan varsayılana düşer
  assert.deepEqual(CASH_REPORT_GROUP.read({}, { CASH_REPORT_RECIPIENTS: "Sahip@Ornek.com, yanlis" }), { recipients: ["sahip@ornek.com"], emailEnabled: true, whatsapp: null });
  assert.deepEqual(CASH_REPORT_GROUP.read({ recipients: [], emailEnabled: false, whatsapp: "905321234567", staffRecipients: ["x@y.z"] }, {}), {
    recipients: [],
    emailEnabled: false,
    whatsapp: "905321234567",
  });
  assert.deepEqual(CASH_STAFF_GROUP.read({ recipients: ["a@b.c"], staffRecipients: ["k@o.com", 3], staffAmounts: "evet" }, {}), { staffRecipients: ["k@o.com"], staffAmounts: false });
  // Gizli alan satırın değerine yazılmaz (secrets sütununda şifreli)
  assert.deepEqual(plainFields({ secretFields: ["secret"] }, { id: "x", secret: "gizli" }), { id: "x" });
  // Şifreli alan yalnız AsilPOS'un anahtarı
  for (const g of BRANCH_SETTING_GROUPS) assert.deepEqual(g.secretFields, g.id === SUBE_AYAR_GRUBU ? ["secret"] : [], `${g.id}: şifreli alanlar`);
  assert.ok(SHARED_FOR_NOW.length > 0 && SHARED_FOR_NOW.every((g) => !branchSettingGroup(g.id)), "henüz ortak olanlar ayrı listede");
  for (const id of [SUBE_AYAR_GRUBU, "komisyon", "modpos", "isletme.takvim", "vardiya.hazir"]) assert.ok(!SHARED_FOR_NOW.some((g) => g.id === id), `${id} artık şube başına`);
  assert.equal(branchSettingGroup("parasut"), PARASUT_GROUP, "Paraşüt hesabı şube başına (B4)");
});

/** src altındaki .ts/.tsx dosyaları */
function sources(dir = join(root, "src")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

test("kaynak: kasa raporu ayarını okuyan her yer şubeyi verir; eski kayda yalnız grup kütüğü dokunur", () => {
  const bare: string[] = [];
  const legacy: string[] = [];
  for (const p of sources()) {
    const text = readFileSync(p, "utf8");
    if (/loadCashSettings\(\)/.test(text)) bare.push(p);
    if (/["']cash\.settings["']/.test(text) && !p.endsWith(join("branch-settings", "groups.ts"))) legacy.push(p);
  }
  assert.deepEqual(bare, [], "loadCashSettings(şube) — şubesiz okuma Tuzla'nın listesini Marina'ya gönderirdi");
  assert.deepEqual(legacy, [], "eski genel kayıt yalnız src/lib/branch-settings/groups.ts'te (legacyKey)");
  // Okuyucular raporun / kasanın / gün sonunun şubesiyle
  assert.match(read("src/server/cash/report-email.ts"), /loadCashSettings\(row\.branchId\)/);
  assert.match(read("src/server/actions/cash-report.ts"), /loadCashSettings\(saved\.branchId\)/);
  assert.match(read("src/server/actions/cash-report.ts"), /loadCashSettings\(r\.branchId\)/);
  const dayEnd = read("src/server/asilpos/gun-sonu.ts");
  assert.match(dayEnd, /dayEndRecipients\(db: DB, branchId: string\)/, "şube zorunlu: varsayılan Marina'ya düşmez");
  assert.doesNotMatch(dayEnd, /dayEndRecipients\(db\)/, "gün sonu, Pavo ve fotoğraf e-postası kendi şubesinin alıcılarına");
  assert.match(dayEnd, /async function sendStaffDayEnd\(db: DB, date: string, branchId: string[\s\S]*?loadCashSettings\(branchId, db\)/, "çalışan listesi gün sonunun şubesinin");
  assert.match(read("src/server/asilpos/gun-sonu.ts"), /r\.branchIds\.includes\(branchId\)/, "gün sonu yalnız o şubeye açık bildirim adreslerine");
  assert.match(read("src/app/panel/kasa/page.tsx"), /loadCashSettings\(view\.till\)/);
  // "Tümü"de her şube bölümünde kendi kartı (eskiden yalnız ilkinde)
  assert.doesNotMatch(read("src/app/panel/kasa/page.tsx"), /settings: i === 0 }/);
  assert.match(read("src/app/panel/kasa/page.tsx"), /cashSettingsCardData\(view\.till\)/);
});

test("kaynak: yalnız yönetici yazar; yazım ve işlem geçmişi tek işlem; bağlı şube varken şube kapatılmaz", () => {
  const link = read("src/server/actions/branch-settings.ts");
  assert.match(link, /^"use server";/);
  assert.match(link, /const me = await requireAdmin\(\);[\s\S]*getDb\(\)\.transaction\(async \(tx\) => \{[\s\S]*logSetting\(tx,/);
  const cash = read("src/server/actions/cash-report.ts");
  const update = cash.slice(cash.indexOf("export async function updateCashSettings"), cash.indexOf("/** Alıcılara deneme e-postası"));
  assert.match(update, /await requireAdmin\(\)/);
  assert.match(update, /getDb\(\)\.transaction\(async \(tx\) => \{\s+await saveCashSettings\([\s\S]*\{ tx, by: me\.name \}[\s\S]*logSetting\(tx, me,/);
  const server = read("src/server/branch-settings.ts");
  assert.match(server, /pg_advisory_xact_lock/, "grubun yazımları sıraya girer");
  assert.match(server, /seal\(v\.trim\(\), "branch-settings"\)/, "gizli alan şifreli");
  const branches = read("src/server/actions/branches.ts");
  assert.match(branches, /mevcut\.active && !d\.active\) \{\s+const bagli = await branchSettingsCloseError\(/);
  assert.match(branches, /branchDeleteError\([^;]*\?\? \(await branchSettingsCloseError\(/);
  // Ekran yalnız yöneticiye (sayfa requireAdmin; /panel/subeler personele kapalı)
  assert.match(read("src/app/panel/subeler/[id]/page.tsx"), /await requireAdmin\(\);/);
});

test("şema ve yedek: kendine bağ yok, bağlı satır değersiz; şifreli alan yedeğe girmez", () => {
  const schema = read("src/server/db/schema.ts");
  assert.match(schema, /check\("branch_settings_not_self_ck"/);
  assert.match(schema, /check\("branch_settings_linked_empty_ck"/);
  assert.match(schema, /sameAs: text\("same_as"\)\.references\(\(\) => branches\.id, \{ onDelete: "restrict" \}\)/);
  assert.deepEqual(TABLE_RULES.branch_settings, { dropColumns: ["secrets"] });
  const migration = readdirSync(join(root, "drizzle")).find((f) => f.endsWith("_sube_ayarlari.sql"));
  assert.ok(migration, "göç drizzle-kit ile üretildi");
  assert.match(read(`drizzle/${migration}`), /CREATE TABLE "branch_settings"/);
});
