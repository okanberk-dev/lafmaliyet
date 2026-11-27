// Vardiyayla ilgili şube maddeleri (docs/VARDIYA.md › Hazır vardiyalar, Ekran; docs/SUBE.md › Şube başına ayarlar):
// - hazır vardiya saatleri (sabahçı / akşamcı) şube ayarı `vardiya.hazir`: kaydın okunuşu (bozuk öğe atlanır), ayarı
//   olmayan şubenin bugünkü sabit saatleri, girilen saatlerin okunuşu (kutunun okuyucusuyla aynı kural), sessiz saat notu;
// - ızgara, PDF, yazarak doldurma ve asistanın kartı listeyi şubenin ayarından okur (kaynak bağlantıları);
// - "Tümü" ya da online kanal seçiliyken birden çok şube açıksa Vardiya ekranı önce şubeyi sorar; Kaydet ızgaranın
//   şubesini gönderir.
// Veritabanı tarafı tests/vardiya-sube-db.test.ts. Çalıştırma: npx tsx --test tests/vardiya-sube.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { alertQuietDuring } from "../src/lib/audio-output";
import { branchSettingGroup, SHARED_FOR_NOW, SHIFT_PRESET_GROUP } from "../src/lib/branch-settings/groups";
import { settingLinkError, settingMode } from "../src/lib/branch-settings/rules";
import {
  defaultShiftPresets,
  expandShiftAbbr,
  parseShiftCell,
  presetHours,
  presetOf,
  presetText,
  SHIFT_PRESETS,
  SHIFT_TEXT,
  shiftGridLinks,
  shiftPresetsError,
  shiftPresetsOf,
  validPresetMinutes,
} from "../src/lib/vardiya";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const text = (list: readonly { label: string; startMin: number; endMin: number }[]) => list.map((p) => `${p.label} ${presetText(p)}`);

test("grup: vardiya.hazir şube başına, 'aynı' yok; eski kayıt yok; şimdilik ortak listesinden düştü", () => {
  assert.equal(branchSettingGroup("vardiya.hazir"), SHIFT_PRESET_GROUP);
  assert.equal(SHIFT_PRESET_GROUP.linkable, false);
  assert.equal(SHIFT_PRESET_GROUP.legacyKey, null);
  assert.equal(SHIFT_PRESET_GROUP.legacySettings, undefined);
  assert.deepEqual(SHIFT_PRESET_GROUP.secretFields, []);
  // Satırı olmayan Marina örtük olarak Tuzla'ya bağlanmaz: saatleri bugün de ayrı
  assert.deepEqual(settingMode(SHIFT_PRESET_GROUP, "marina", []), { kind: "own" });
  const branches = [
    { id: "tuzla", name: "Tuzla", kind: "fiziksel", active: true },
    { id: "marina", name: "Marina", kind: "fiziksel", active: true },
  ] as const;
  assert.match(settingLinkError(SHIFT_PRESET_GROUP, "marina", "tuzla", [], branches) ?? "", /şube başına tutulur/);
  assert.ok(!SHARED_FOR_NOW.some((g) => g.id === "vardiya.hazir" || /vardiya/i.test(g.label)), "hazır vardiya artık şube başına");
});

test("okuma: seçilmemiş (null) ile 'hazır vardiya yok' (boş liste) ayrı; bozuk öğe atlanır, anahtar başına bir, sıra sabit", () => {
  const r = (raw: Record<string, unknown>) => SHIFT_PRESET_GROUP.read(raw, {}).presets;
  assert.equal(r({}), null);
  assert.equal(r({ presets: "x" }), null);
  assert.deepEqual(r({ presets: [] }), []);
  assert.deepEqual(
    r({
      presets: [
        { key: "evening", startMin: 960, endMin: 1500 },
        { key: "morning", startMin: 540, endMin: 1080 },
        { key: "morning", startMin: 600, endMin: 1080 },
        { key: "gece", startMin: 0, endMin: 60 },
      ],
    }),
    [
      { key: "morning", startMin: 540, endMin: 1080 },
      { key: "evening", startMin: 960, endMin: 1500 },
    ],
  );
  // Okuyucunun sınırları: bitiş başlangıçtan sonra, en geç 06:00 (1800), en çok 16 saat; tam sayı
  for (const [s, e] of [
    [540, 540],
    [600, 540],
    [1200, 1801],
    [0, 16 * 60 + 1],
    [1440, 1500],
    [540.5, 1080],
  ]) {
    assert.equal(validPresetMinutes(s, e), false, `${s}-${e}`);
    assert.deepEqual(r({ presets: [{ key: "morning", startMin: s, endMin: e }] }), [], `${s}-${e} okunmaz`);
  }
  assert.equal(validPresetMinutes(1080, 1800), true);
  // Aynı saatli ikinci vardiya okunmaz (ad saatlerden türer)
  assert.deepEqual(r({ presets: [{ key: "morning", startMin: 540, endMin: 1080 }, { key: "evening", startMin: 540, endMin: 1080 }] }), [{ key: "morning", startMin: 540, endMin: 1080 }]);
  assert.equal(SHIFT_PRESET_GROUP.summary({ presets: null }), "varsayılan saatler");
  assert.equal(SHIFT_PRESET_GROUP.summary({ presets: [] }), "hazır vardiya yok");
  assert.equal(SHIFT_PRESET_GROUP.summary({ presets: [{ key: "evening", startMin: 960, endMin: 1500 }] }), "Akşamcı 16:00–01:00");
});

test("çözüm: ayarı olmayan şube bugünkü sabit saatler (Tuzla, Marina; öbür şube yok), ayar seçilince onun saatleri", () => {
  assert.deepEqual(text(shiftPresetsOf("tuzla", null)), ["Sabahçı 09:00–18:00", "Akşamcı 16:00–01:00"]);
  assert.deepEqual(text(shiftPresetsOf("marina", null)), ["Sabahçı 09:30–18:30", "Akşamcı 13:00–22:00"]);
  assert.deepEqual(shiftPresetsOf("bodrum", null), []);
  assert.deepEqual(shiftPresetsOf("tuzla", null), [...defaultShiftPresets("tuzla")]);
  // Varsayılan kopyalanır: dönen liste değişse de sabit saatler değişmez
  shiftPresetsOf("tuzla", null)[0].startMin = 0;
  assert.equal(SHIFT_PRESETS.tuzla[0].startMin, 540);
  // Seçilen saatler (sıra sabahçı, akşamcı; ad koddan); boş liste: hazır vardiya yok
  const own = shiftPresetsOf("tuzla", [
    { key: "evening", startMin: 17 * 60, endMin: 26 * 60 },
    { key: "morning", startMin: 8 * 60 + 30, endMin: 17 * 60 + 30 },
  ]);
  assert.deepEqual(text(own), ["Sabahçı 08:30–17:30", "Akşamcı 17:00–02:00"]);
  assert.deepEqual(shiftPresetsOf("marina", []), []);
  assert.deepEqual(text(shiftPresetsOf("bodrum", [{ key: "morning", startMin: 600, endMin: 1140 }])), ["Sabahçı 10:00–19:00"]);
  // Ad, harf ve kısaltma yeni saatlerle; eski saatli hücre artık "başka saat"
  const cell = (t: string) => {
    const p = parseShiftCell(t);
    return p.ok ? p.cell : null;
  };
  assert.equal(expandShiftAbbr(own, "s kasa"), "08:30–17:30 kasa");
  assert.equal(expandShiftAbbr(own, "a"), "17:00–02:00");
  assert.equal(presetOf(own, cell("8.30-17.30"))?.label, "Sabahçı");
  assert.equal(presetOf(own, cell("9-18")), null);
  assert.equal(expandShiftAbbr(shiftPresetsOf("marina", []), "s"), "s");
});

test("girilen saatler kutunun okuyucusuyla okunur: gece yarısını geçen bitiş ertesi gün; aynı saat, 16 saat, 06:00 reddedilir", () => {
  assert.deepEqual(presetHours("09:00", "18:00"), { startMin: 540, endMin: 1080 });
  assert.deepEqual(presetHours("16:00", "01:00"), { startMin: 960, endMin: 1500 });
  assert.deepEqual(presetHours("16:00", "00:00"), { startMin: 960, endMin: 1440 });
  assert.deepEqual(presetHours(" 9.30 ", "18:30"), { startMin: 570, endMin: 1110 });
  assert.deepEqual(presetHours("09:00", "09:00"), { error: SHIFT_TEXT.same });
  assert.deepEqual(presetHours("12:00", "07:00"), { error: SHIFT_TEXT.late });
  assert.deepEqual(presetHours("06:00", "23:00"), { error: SHIFT_TEXT.long });
  assert.deepEqual(presetHours("25:00", "02:00"), { error: SHIFT_TEXT.hour });
  for (const [s, e] of [
    ["", "18:00"],
    ["9", "18"],
    ["izin", "x"],
    ["09:00", "18:00 kasa"],
  ]) assert.ok("error" in presetHours(s, e), `${s}–${e}`);
  assert.equal(shiftPresetsError([{ key: "morning", startMin: 540, endMin: 1080 }]), null);
  assert.equal(shiftPresetsError([{ key: "morning", startMin: 540, endMin: 1080 }, { key: "evening", startMin: 960, endMin: 1500 }]), null);
  assert.match(shiftPresetsError([{ key: "morning", startMin: 540, endMin: 1080 }, { key: "evening", startMin: 540, endMin: 1080 }]) ?? "", /aynı saatlerde olamaz/);
});

test("sessiz saat: 01:00–09:00 arasına uzanan vardiya kartta söylenir; varsayılanlar ses penceresinde", () => {
  for (const presets of Object.values(SHIFT_PRESETS)) for (const p of presets) assert.equal(alertQuietDuring(p.startMin, p.endMin), false, presetText(p));
  assert.equal(alertQuietDuring(8 * 60 + 30, 17 * 60 + 30), true, "08:30'da açılış");
  assert.equal(alertQuietDuring(17 * 60, 26 * 60), true, "02:00'ye kadar");
  assert.equal(alertQuietDuring(16 * 60, 25 * 60), false, "01:00'de biter");
  assert.equal(alertQuietDuring(0, 60), false, "00:00–01:00");
  assert.equal(alertQuietDuring(9 * 60, 18 * 60), false);
});

test("kaynak: ızgara, PDF, yazarak doldurma ve asistan şubenin ayarından okur; sabit saatler yalnız varsayılan", () => {
  const presets = read("src/server/vardiya/presets.ts");
  assert.match(presets, /resolveBranchSetting\(SHIFT_PRESET_GROUP, branchId, db\)/);
  assert.match(presets, /return shiftPresetsOf\(branchId, value\.presets\);/);
  const page = read("src/app/panel/vardiya/page.tsx");
  assert.match(page, /loadShiftPresets\(branch\.id, db\)/);
  assert.match(page, /presets=\{presets\}/);
  assert.match(read("src/app/api/vardiya/pdf/route.ts"), /loadShiftPresets\(branch\.id, db\)\]\);\s+const bytes = await renderShiftPdf\(\{ presets,/);
  assert.match(read("src/server/vardiya/draft.ts"), /presets: await loadShiftPresets\(branch\.id, db\)/);
  assert.match(read("src/server/assistant-ops/preview.ts"), /parseShiftCell\(expandShiftAbbr\(presets, g\.metin\)\)/);
  // Saatler şubeden değil listeden okunur: şube kimliğiyle sabit saatlere giden çağrı kalmadı
  for (const f of ["src/app/panel/vardiya/shift-grid.tsx", "src/server/vardiya/pdf.ts", "src/lib/vardiya-taslak.ts", "src/server/assistant-ops/preview.ts", "src/server/vardiya/draft.ts"]) {
    assert.doesNotMatch(read(f), /defaultShiftPresets|SHIFT_PRESETS\b|shiftPresets\(/, f);
  }
  // Şube ayarları ekranında kart; işlem yalnız yönetici, kilit altında, işlem geçmişine
  const settings = read("src/app/panel/subeler/[id]/page.tsx");
  assert.match(settings, /branchSettingView\(SHIFT_PRESET_GROUP, branch\.id\)/);
  assert.match(settings, /<ShiftPresetsCard/);
  const action = read("src/server/actions/branch-settings.ts");
  const save = action.slice(action.indexOf("export async function saveShiftPresets"), action.indexOf("const secretInput"));
  assert.match(save, /const me = await requireAdmin\(\);/);
  assert.match(save, /await lockGroup\(tx, SHIFT_PRESET_GROUP\.id\);/);
  assert.match(save, /putBranchSetting\(tx, SHIFT_PRESET_GROUP, d\.branchId, \{ presets: list \}, me\.name\)/);
  assert.match(save, /logSetting\(tx, me, "Şube ayarı"/);
  // Izgaradan şubenin ayarına bağlantı (yalnız yönetici; müdür Şube ayarları'nı açamaz: tests/roller.test.ts)
  assert.equal(shiftGridLinks("admin", "marina").presets, "/panel/subeler/marina#vardiya");
  assert.match(read("src/app/panel/vardiya/page.tsx"), /links=\{shiftGridLinks\(user\.role, week\.branch\.id\)\}/);
  assert.match(read("src/app/panel/vardiya/shift-grid.tsx"), /<Link href=\{links\.presets\}/);
  assert.match(read("src/app/panel/subeler/[id]/shift-presets-card.tsx"), /<Card id="vardiya"/);
});

test("“Tümü”de şube sorulur: plan çizilmez, Kaydet ızgaranın şubesini gönderir", () => {
  const page = read("src/app/panel/vardiya/page.tsx");
  const choose = page.indexOf("if (physical.length > 1 && !physical.some((b) => b.id === scope))");
  assert.ok(choose > 0, "seçim yokken şube sorusu");
  assert.ok(choose < page.indexOf("loadShiftWeek("), "soru planı okumadan önce");
  assert.ok(choose < page.indexOf("await currentPhysicalBranch()"), "Tuzla'ya düşmeden önce");
  assert.match(page, /<BranchChooser\s+title="Hangi şubenin vardiyası\?"/);
  assert.match(page, /path=\{VARDIYA_PATH\}/);
  assert.match(page, /params=\{\{ hafta: hafta \? monday : undefined \}\}/);
  // Şube değişince ızgara baştan kurulur (doldurma biçimi şubenin hazır vardiyasına göre)
  assert.match(page, /<ShiftGrid\s+key=\{week\.branch\.id\}/);
  // Yazım çerezden değil ızgaranın şubesinden: kayıt ve taslak şubeyi açıkça gönderir, sunucu şubesiz kaydı almaz
  const grid = read("src/app/panel/vardiya/shift-grid.tsx");
  assert.match(grid, /saveShiftWeekAction\(\{ branchId: branch\.id, week: monday,/);
  assert.match(grid, /draftShiftWeekAction\(\{ branchId: branch\.id, week: monday,/);
  assert.match(read("src/lib/vardiya.ts"), /branchId: z\.string\(\)\.min\(2\)\.max\(24\),\n\s+week:/);
  assert.doesNotMatch(read("src/server/vardiya/store.ts"), /currentPhysicalBranch|currentWriteBranch/);
});
