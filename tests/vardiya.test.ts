// Vardiya planı (docs/VARDIYA.md): hücrenin okunuşu ve yazılışı, hafta hesabı, toplamlar, kaydın farkı, rol kuralı,
// menü ve yetki bağlantıları, PDF (Türkçe harfler gömülü yazı tipinde; çizim %PDF ile başlar, başlık Türkçe kalır).
// Çalıştırma: npx tsx --test tests/vardiya.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";

import { BOTTOM_NAV, mobileTitleFor, NAV_GROUPS, navTreeFor } from "../src/components/panel/nav";
import { canOpen, ROLE_PERMISSIONS, STAFF_PATHS } from "../src/lib/roles";
import {
  buildRows,
  canEditShifts,
  cellOf,
  clockOf,
  dayHeadcount,
  expandShiftAbbr,
  dayHeading,
  formatShiftCell,
  hoursLabel,
  listedRows,
  nameRef,
  parseShiftCell,
  pdfFileName,
  pdfHref,
  plannedRows,
  presetOf,
  presetShort,
  presetText,
  refUserId,
  rowMinutes,
  saveWeekSchema,
  SHIFT_TEXT,
  shiftMinutes,
  shiftPresets,
  todayShiftText,
  userRef,
  weekDays,
  weekDiff,
  weekLabel,
  weekParam,
  weekStart,
  weekSummary,
  type ShiftCell,
  type ShiftEntry,
  type ShiftRow,
} from "../src/lib/vardiya";
import { LAF_BEAN_PATH, LAF_LETTERS_PATH, LAF_MARK_BOX } from "../src/server/vardiya/logo";
import { renderShiftPdf, SHIFT_FONT_FILES } from "../src/server/vardiya/pdf";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

const cell = (text: string): ShiftCell | null => {
  const p = parseShiftCell(text);
  assert.ok(p.ok, `${text}: ${p.ok ? "" : p.error}`);
  return p.cell;
};
const errorOf = (text: string): string => {
  const p = parseShiftCell(text);
  assert.equal(p.ok, false, `${text} geçerli sayıldı`);
  return p.ok ? "" : p.error;
};
const row = (ref: string, name: string, texts: string[], userId: number | null = null): ShiftRow => ({ ref, userId, name, cells: texts.map(cell) });

test("hücre: saat yazımları tek biçime gelir; dakika, nokta, bitişik ve gece yarısı", () => {
  assert.deepEqual(cell("10-18"), { kind: "work", startMin: 600, endMin: 1080, note: null });
  assert.deepEqual(cell(" 10:30 - 18:45 "), { kind: "work", startMin: 630, endMin: 1125, note: null });
  assert.deepEqual(cell("10.30-18"), { kind: "work", startMin: 630, endMin: 1080, note: null });
  assert.deepEqual(cell("1000-1800"), { kind: "work", startMin: 600, endMin: 1080, note: null });
  assert.deepEqual(cell("930-18"), { kind: "work", startMin: 570, endMin: 1080, note: null });
  assert.deepEqual(cell("9–17"), { kind: "work", startMin: 540, endMin: 1020, note: null });
  // Bitiş 24 = gece yarısı; bitiş başlangıçtan küçükse ertesi gün
  assert.deepEqual(cell("16-24"), { kind: "work", startMin: 960, endMin: 1440, note: null });
  assert.deepEqual(cell("16-00"), { kind: "work", startMin: 960, endMin: 1440, note: null });
  assert.deepEqual(cell("18-02"), { kind: "work", startMin: 1080, endMin: 1560, note: null });
  assert.deepEqual(cell("22-06"), { kind: "work", startMin: 1320, endMin: 1800, note: null });
  assert.equal(cell(""), null);
  assert.equal(cell("   "), null);
});

test("hücre: görev notu ve izin; büyük / küçük harf ve Türkçe I", () => {
  assert.deepEqual(cell("10-18 kasa"), { kind: "work", startMin: 600, endMin: 1080, note: "kasa" });
  assert.deepEqual(cell("18-02  Karaoke  odası"), { kind: "work", startMin: 1080, endMin: 1560, note: "Karaoke odası" });
  for (const t of ["izin", "İzin", "IZIN", "İZİN", "izinli", "off", "OFF", "x", "X", "tatil"]) assert.deepEqual(cell(t), { kind: "off", note: null }, t);
  assert.deepEqual(cell("izin rapor"), { kind: "off", note: "rapor" });
  assert.deepEqual(cell("İZİN Yıllık"), { kind: "off", note: "Yıllık" });
});

test("hücre: okunamayan metin nedeniyle reddedilir", () => {
  assert.equal(errorOf("sabah"), SHIFT_TEXT.format);
  assert.equal(errorOf("10"), SHIFT_TEXT.format);
  assert.equal(errorOf("tatilde"), SHIFT_TEXT.format);
  assert.equal(errorOf("25-30"), SHIFT_TEXT.hour);
  assert.equal(errorOf("10-25"), SHIFT_TEXT.hour);
  assert.equal(errorOf("10-24:30"), SHIFT_TEXT.hour);
  assert.equal(errorOf("10:75-18"), SHIFT_TEXT.minute);
  assert.equal(errorOf("10-10"), SHIFT_TEXT.same);
  // Ertesi gün 06:00'dan sonra biten ve 16 saatten uzun vardiya (yazım hatası: "18-17")
  assert.equal(errorOf("20-07"), SHIFT_TEXT.late);
  assert.equal(errorOf("18-17"), SHIFT_TEXT.late);
  assert.equal(errorOf("06-23"), SHIFT_TEXT.long);
  assert.equal(errorOf(`10-18 ${"a".repeat(41)}`), SHIFT_TEXT.note);
});

test("biçim: kutudaki metin yeniden okununca aynı vardiya (kaydedilen plan düzenlenir)", () => {
  assert.equal(formatShiftCell(cell("10-18 kasa")), "10:00–18:00 · kasa");
  assert.equal(formatShiftCell(cell("18-02")), "18:00–02:00");
  assert.equal(formatShiftCell(cell("16-24")), "16:00–00:00");
  assert.equal(formatShiftCell(cell("izin rapor")), "İzin · rapor");
  assert.equal(formatShiftCell(null), "");
  for (const t of ["10-18 kasa", "18-02", "16-24", "izin", "izin rapor", "10:30-18:45 bar arkası", "22-06"]) {
    const first = cell(t);
    assert.deepEqual(cell(formatShiftCell(first)), first, t);
  }
  assert.equal(clockOf(1560), "02:00");
  assert.equal(clockOf(1440), "00:00");
});

test("süre ve toplam: saat etiketi, kişinin haftası, gün gün çalışan sayısı", () => {
  assert.equal(shiftMinutes(cell("18-02")), 480);
  assert.equal(shiftMinutes(cell("izin")), 0);
  assert.equal(shiftMinutes(null), 0);
  assert.equal(hoursLabel(0), "0 sa");
  assert.equal(hoursLabel(2400), "40 sa");
  assert.equal(hoursLabel(2250), "37,5 sa");
  assert.equal(hoursLabel(495), "8,25 sa");
  assert.equal(hoursLabel(440), "7 sa 20 dk");
  const rows = [row("u:1", "Ayşe", ["10-18", "10-18", "izin", "", "", "16-02", ""]), row("u:2", "Çağrı", ["16-24", "", "", "", "18:30-02", "", ""]), row("u:3", "Boş", ["", "", "", "", "", "", ""])];
  assert.equal(rowMinutes(rows[0]), 480 + 480 + 600);
  assert.deepEqual(dayHeadcount(rows), [2, 1, 0, 0, 1, 1, 0]);
  assert.deepEqual(plannedRows(rows).map((r) => r.name), ["Ayşe", "Çağrı"]);
  assert.equal(weekSummary(rows), "2 kişi · 5 vardiya · 1 izin");
  assert.equal(weekSummary([rows[2]]), "plan boş");
});

test("hafta: Pazartesi'den başlar; adresteki gün haftasına yuvarlanır; ay ve yıl aşan etiket", () => {
  assert.equal(weekStart("2026-11-23"), "2026-11-23");
  assert.equal(weekStart("2026-11-25"), "2026-11-23");
  assert.equal(weekStart("2026-11-29"), "2026-11-23");
  assert.equal(weekStart("2026-11-30"), "2026-11-30");
  assert.equal(weekParam("2026-11-28", "2026-01-01"), "2026-11-23");
  assert.equal(weekParam("2026-02-30", "2026-11-22"), "2026-11-16", "takvimde olmayan gün: bu hafta");
  assert.equal(weekParam(undefined, "2026-11-22"), "2026-11-16");
  assert.equal(weekParam(["2026-11-28"], "2026-11-22"), "2026-11-16");
  assert.deepEqual(weekDays("2026-11-30"), ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]);
  assert.equal(weekLabel("2026-11-23"), "23–29 Kasım 2026");
  assert.equal(weekLabel("2026-11-30"), "30 Kasım – 6 Aralık 2026");
  assert.equal(weekLabel("2026-12-28"), "28 Aralık 2026 – 3 Ocak 2027");
  assert.equal(dayHeading("2026-11-23", 0), "Pzt 23");
  assert.equal(dayHeading("2026-12-01", 1, true), "Sal 1 Ara");
});

test("kişi: kullanıcı ve hesapsız çalışanın anahtarı; satırlar personel + planı olanlar, ada göre", () => {
  assert.equal(userRef(12), "u:12");
  assert.equal(refUserId("u:12"), 12);
  assert.equal(refUserId("n:ayşe"), null);
  assert.equal(refUserId("u:abc"), null);
  assert.equal(nameRef("  Deniz   IŞIK "), "n:deniz ışık");
  const entries: ShiftEntry[] = [
    { date: "2026-11-23", ref: "u:2", userId: 2, name: "Çağrı", cell: cell("16-24")! },
    { date: "2026-11-29", ref: "n:deniz", userId: null, name: "Deniz", cell: cell("12-20 bar")! },
    { date: "2026-12-05", ref: "u:2", userId: 2, name: "Çağrı", cell: cell("10-18")! },
  ];
  const rows = buildRows("2026-11-23", [{ id: 1, name: "Ayşe" }, { id: 2, name: "Çağrı" }], entries);
  assert.deepEqual(rows.map((r) => r.name), ["Ayşe", "Çağrı", "Deniz"], "Türkçe sıra: Ç, C'den sonra D'den önce");
  assert.deepEqual(rows[0].cells, [null, null, null, null, null, null, null]);
  assert.equal(formatShiftCell(rows[1].cells[0]), "16:00–00:00");
  assert.equal(rows[1].cells.filter(Boolean).length, 1, "başka haftanın satırı girmez");
  assert.equal(formatShiftCell(rows[2].cells[6]), "12:00–20:00 · bar");
  // Veritabanı satırı → hücre: bozuk satır atlanır
  assert.deepEqual(cellOf({ kind: "off", startMin: null, endMin: null, note: "rapor" }), { kind: "off", note: "rapor" });
  assert.equal(cellOf({ kind: "work", startMin: null, endMin: 600, note: null }), null);
  assert.equal(cellOf({ kind: "work", startMin: 600, endMin: 600, note: null }), null);
});

test("kayıt farkı: yalnız değişen hücre yazılır, boşaltılan silinir, girdide olmayan kişiye dokunulmaz", () => {
  const monday = "2026-11-23";
  const existing: ShiftEntry[] = [
    { date: "2026-11-23", ref: "u:1", userId: 1, name: "Ayşe", cell: cell("10-18 kasa")! },
    { date: "2026-11-24", ref: "u:1", userId: 1, name: "Ayşe", cell: cell("10-18")! },
    { date: "2026-11-25", ref: "u:1", userId: 1, name: "Ayşe", cell: cell("izin")! },
    { date: "2026-11-23", ref: "u:9", userId: 9, name: "Başka sekmeden", cell: cell("12-20")! },
  ];
  const next = [row("u:1", "Ayşe", ["11-19 kasa", "10-18", "", "12-20", "", "", ""], 1)];
  const diff = weekDiff(existing, next, monday);
  assert.deepEqual(
    diff.upserts.map((u) => `${u.date} ${formatShiftCell(u.cell)}`),
    ["2026-11-23 11:00–19:00 · kasa", "2026-11-26 12:00–20:00"],
  );
  assert.deepEqual(diff.deletes, [{ date: "2026-11-25", ref: "u:1" }]);
  // Değişiklik yoksa hiçbir şey yazılmaz
  const same = weekDiff(existing, [row("u:1", "Ayşe", ["10-18 kasa", "10-18", "izin", "", "", "", ""], 1)], monday);
  assert.deepEqual(same, { upserts: [], deletes: [] });
  // Kişinin adı değiştiyse plandaki ad yenilenir
  const renamed = weekDiff(existing, [row("u:1", "Ayşe Yılmaz", ["10-18 kasa", "10-18", "izin", "", "", "", ""], 1)], monday);
  assert.equal(renamed.upserts.length, 3);
  // Girdi şeması: yedi hücre, en çok 60 kişi
  assert.ok(saveWeekSchema.safeParse({ branchId: "tuzla", week: monday, rows: [{ ref: "u:1", name: "Ayşe", cells: Array(7).fill("") }] }).success);
  assert.equal(saveWeekSchema.safeParse({ branchId: "tuzla", week: monday, rows: [{ ref: "u:1", name: "Ayşe", cells: Array(6).fill("") }] }).success, false);
  assert.equal(saveWeekSchema.safeParse({ branchId: "tuzla", week: "2026-02-30", rows: [] }).success, false);
  assert.equal(saveWeekSchema.safeParse({ branchId: "tuzla", week: monday, rows: Array.from({ length: 61 }, (_, i) => ({ ref: `u:${i + 1}`, name: "x", cells: Array(7).fill("") })) }).success, false);
});

test("Bugün satırı: ilk adlar ve saatler, en çok üç kişi; plan yoksa satır yok", () => {
  assert.equal(todayShiftText([]), null);
  assert.equal(todayShiftText([{ name: "Ayşe Yılmaz", startMin: 600, endMin: 1080 }]), "Vardiyada: Ayşe 10:00–18:00");
  const many = ["Ayşe Yılmaz", "Çağrı Öztürk", "İsmail Şengül", "Deniz", "Gülşah Işık"].map((name, i) => ({ name, startMin: 600 + i * 60, endMin: 1560 }));
  assert.equal(todayShiftText(many), "Vardiyada: Ayşe 10:00–02:00 · Çağrı 11:00–02:00 · İsmail 12:00–02:00 · ve 2 kişi");
});

test("rol ve menü: planı yalnız yönetici yazar; iki rol açar, yöneticide adı “Vardiya ayarlama”", () => {
  assert.equal(canEditShifts("admin"), true);
  assert.equal(canEditShifts("staff"), false);
  assert.ok((STAFF_PATHS as readonly string[]).includes("/panel/vardiya"));
  assert.ok(canOpen("staff", "/panel/vardiya") && canOpen("admin", "/panel/vardiya"));
  assert.ok(ROLE_PERMISSIONS.some((p) => p.staff && p.paths?.includes("/panel/vardiya") && /yalnız yönetici yazar/.test(p.label)));
  assert.ok(ROLE_PERMISSIONS.some((p) => !p.staff && /vardiya planını yazma/.test(p.label)));
  const label = (role: "admin" | "staff") => navTreeFor(role).find((n) => n.href === "/panel/vardiya")?.label;
  assert.equal(label("admin"), "Vardiya ayarlama");
  assert.equal(label("staff"), "Vardiya");
  const palette = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.href === "/panel/vardiya");
  assert.deepEqual(palette?.roles, ["admin", "staff"]);
  assert.match(palette?.keywords ?? "", /vardiya ayarlama/);
  assert.equal(mobileTitleFor("/panel/vardiya"), "Vardiya");
  // Alt menü değişmedi: Vardiya çekmecede
  for (const role of ["admin", "staff"] as const) assert.ok(!BOTTOM_NAV[role].some((b) => b.href === "/panel/vardiya"));
  // Kaynak: eylem yöneticiyi ister, ekran ve PDF oturumu; personelin görünümünde kutu yok
  const action = read("src/server/actions/vardiya.ts");
  assert.match(action, /const me = await requireAdmin\(\);\s+const r = await saveShiftWeek\(/);
  const page = read("src/app/panel/vardiya/page.tsx");
  assert.match(page, /await requireUser\(\)/);
  assert.doesNotMatch(page, /requireAdmin/);
  assert.match(page, /loadShiftWeek\(db, branch, monday, \{ roster: canEdit, includeUserId: user\.id \}\)/);
  const route = read("src/app/api/vardiya/pdf/route.ts");
  assert.match(route, /if \(!user\) return Response\.json\(\{ error: "Giriş gerekli" \}, \{ status: 401 \}\);/);
  assert.match(route, /if \(lock && wanted && wanted !== lock\) return Response\.json\([^)]*\{ status: 403 \}\);/);
  const grid = read("src/app/panel/vardiya/shift-grid.tsx");
  const staffView = grid.slice(grid.indexOf("if (!canEdit) {"), grid.indexOf("  return (\n    <div className=\"space-y-4\">\n      {savedNote"));
  assert.ok(staffView.length > 500, "personelin görünümü bulunamadı");
  assert.doesNotMatch(staffView, /<Input|saveShiftWeekAction|cellInput\(/);
});

test("hazır vardiyalar: Tuzla 09:00–18:00 ve 16:00–01:00, Marina 09:30–18:30 ve 13:00–22:00; ad saatlerden türer", () => {
  const cell = (t: string) => {
    const p = parseShiftCell(t);
    return p.ok ? p.cell : null;
  };
  assert.deepEqual(shiftPresets("tuzla").map((p) => `${p.label} ${presetText(p)}`), ["Sabahçı 09:00–18:00", "Akşamcı 16:00–01:00"]);
  assert.deepEqual(shiftPresets("marina").map((p) => `${p.label} ${presetText(p)}`), ["Sabahçı 09:30–18:30", "Akşamcı 13:00–22:00"]);
  // Her biri 9 saat; kutuya yazılan metin okununca aynı vardiya (tıklamayla yazılan da elle yazılan da)
  for (const id of ["tuzla", "marina"]) {
    for (const p of shiftPresets(id)) {
      assert.equal(p.endMin - p.startMin, 9 * 60);
      assert.equal(presetOf(id, cell(presetText(p)))?.key, p.key);
    }
  }
  assert.equal(presetOf("tuzla", cell("9-18 kasa"))?.label, "Sabahçı");
  assert.equal(presetOf("tuzla", cell("16-01"))?.label, "Akşamcı");
  assert.equal(presetOf("marina", cell("13-22"))?.label, "Akşamcı");
  // Başka saat, izin, boş hücre ve başka şubenin saatleri adsız
  assert.equal(presetOf("tuzla", cell("10-18")), null);
  assert.equal(presetOf("tuzla", cell("izin")), null);
  assert.equal(presetOf("tuzla", null), null);
  assert.equal(presetOf("marina", cell("9-18")), null);
  assert.deepEqual(shiftPresets("bilinmeyen"), []);
});

test("seçerek doldurma: her kutuda S / A / İ düğmeleri; elle yazarken “s” ve “a” kısaltması şubenin saatlerine açılır", () => {
  assert.deepEqual(shiftPresets("tuzla").map(presetShort), ["S", "A"]);
  // Kısaltma şubeye göre açılır; büyük harf, uzun yazım ve görev notu da
  assert.equal(expandShiftAbbr("tuzla", "s"), "09:00–18:00");
  assert.equal(expandShiftAbbr("tuzla", " A "), "16:00–01:00");
  assert.equal(expandShiftAbbr("marina", "S"), "09:30–18:30");
  assert.equal(expandShiftAbbr("marina", "a bar"), "13:00–22:00 bar");
  assert.equal(expandShiftAbbr("tuzla", "Sabahçı Kasa"), "09:00–18:00 Kasa");
  assert.equal(expandShiftAbbr("tuzla", "akşam"), "16:00–01:00");
  // Açılan metin okununca o hazır vardiya (not korunur)
  const opened = parseShiftCell(expandShiftAbbr("tuzla", "s kasa"));
  assert.ok(opened.ok && opened.cell?.kind === "work" && opened.cell.note === "kasa" && presetOf("tuzla", opened.cell)?.key === "morning");
  // Saat, izin ve başka metin olduğu gibi kalır; hazır vardiyası olmayan şubede kısaltma yok
  for (const t of ["10-18", "izin", "16-24 bar", "", "salı", "ayşe"]) assert.equal(expandShiftAbbr("tuzla", t), t);
  assert.equal(expandShiftAbbr("bilinmeyen", "s"), "s");
  // Izgara: hazır vardiyası olan şubede seçerek açılır; düğme yazıp seçili olana ikinci tıklama boşaltır; okuma kısaltmayı açar
  const grid = read("src/app/panel/vardiya/shift-grid.tsx");
  assert.match(grid, /useState<"pick" \| "type">\(presets\.length \? "pick" : "type"\)/);
  assert.match(grid, /aria-pressed=\{chosen === c\.key\}/);
  assert.match(grid, /onClick=\{\(\) => setText\(r\.ref, i, chosen === c\.key \? "" : c\.text\)\}/);
  assert.match(grid, /const read = \(text: string\) => parseShiftCell\(expandShiftAbbr\(branch\.id, text\)\);/);
});

test("PDF adresi ve dosya adı", () => {
  assert.equal(pdfFileName("tuzla", "2026-11-23"), "vardiya-tuzla-2026-11-23.pdf");
  assert.equal(pdfHref("tuzla", "2026-11-23"), "/api/vardiya/pdf?hafta=2026-11-23&sube=tuzla");
});

test("PDF yazı tipi: Türkçe harfler ve plandaki işaretler gömülü dosyalarda; dosyalar işleve konur", () => {
  const dir = join(process.cwd(), "src/server/vardiya/fonts");
  for (const file of Object.values(SHIFT_FONT_FILES)) {
    const font = fontkit.create(readFileSync(join(dir, file)));
    for (const ch of "ğĞşŞıİöÖüÜçÇâ–·…›₺'“”") assert.ok(font.hasGlyphForCodePoint(ch.codePointAt(0)!), `${file}: “${ch}” yok`);
    // TrueType anahat: pdf-lib tam dosyayı FontFile2 olarak gömer (CFF'li OTF bütün gömülünce okuyucular uyarır)
    assert.ok(file.endsWith(".ttf"));
  }
  assert.ok(existsSync(join(dir, "OFL.txt")), "yazı tipinin lisansı yanında durur");
  // Dosyalar çalışma anında diskten okunur: Vercel işlevine iz sürme kuralıyla konur
  const config = read("next.config.ts");
  assert.match(config, /outputFileTracingIncludes: \{\s*"\/api\/vardiya\/pdf": \["\.\/src\/server\/vardiya\/fonts\/\*\.ttf"\]/);
});

test("PDF: kaydedilen plandan çizilir; %PDF ile başlar, A4 yatay, başlığı Türkçe; kalabalık plan sayfalanır", async () => {
  const rows = [
    row("u:1", "Ayşe Yılmaz", ["10-18 kasa", "10-18", "izin", "12-20 bar", "", "16-02 karaoke", ""], 1),
    row("u:2", "Çağrı Öztürk", ["16-24", "", "", "izin rapor", "18:30-02", "", ""], 2),
    row("n:gülşah ışık", "Gülşah Işık 😀", ["", "", "", "", "", "", "9-17 açılış ve temizlik işleri"]),
    row("u:3", "Planı boş", ["", "", "", "", "", "", ""], 3),
  ];
  const input = { branchId: "tuzla", branchName: "Tuzla", monday: "2026-11-23", rows, updated: { by: "Okan", at: "2026-11-22T13:40:00Z" }, generatedAt: new Date("2026-11-22T13:45:00Z") };
  const bytes = await renderShiftPdf(input);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString("latin1"), "%PDF-");
  assert.ok(bytes.length > 20_000 && bytes.length < 400_000, `${bytes.length} bayt`);
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getTitle(), "Vardiya planı · Tuzla · 23–29 Kasım 2026");
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(width > height && Math.abs(width - 841.89) < 0.1 && Math.abs(height - 595.28) < 0.1, "A4 yatay");
  // 13 kişiye kadar tek sayfa, sonrası yeni sayfa; boş plan da çizilir
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`u:${i + 1}`, `Kişi ${i + 1}`, ["10-18", "", "", "", "", "", ""], i + 1));
  assert.equal((await PDFDocument.load(await renderShiftPdf({ ...input, rows: many(13) }))).getPageCount(), 1);
  assert.equal((await PDFDocument.load(await renderShiftPdf({ ...input, rows: many(14) }))).getPageCount(), 2);
  assert.equal((await PDFDocument.load(await renderShiftPdf({ ...input, rows: [], updated: null }))).getPageCount(), 1);
  // Şubesi bilinmeyen (hazır vardiyası olmayan) plan da çizilir
  assert.equal((await PDFDocument.load(await renderShiftPdf({ ...input, branchId: undefined }))).getPageCount(), 1);
  // Logo vektör (L'Af'ın harfleri ve çekirdeği ayrı yollar), dosya izine bağlı değil; harfler yeşil, çekirdek altın çizilir
  for (const path of [LAF_LETTERS_PATH, LAF_BEAN_PATH]) assert.match(path, /^M[\d. ]+C[\dA-Za-z. -]+Z?$/);
  assert.deepEqual(LAF_MARK_BOX, { width: 1035.2, height: 846 });
  const pdf = read("src/server/vardiya/pdf.ts");
  assert.match(pdf, /drawSvgPath\(LAF_LETTERS_PATH, \{ x: MARGIN, y: top, scale, color: GREEN \}\)/);
  assert.match(pdf, /drawSvgPath\(LAF_BEAN_PATH, \{ x: MARGIN, y: top, scale, color: GOLD \}\)/);
  // Sade tasarım: dolu kutu yok (yalnız daire, çizgi ve yazı)
  assert.doesNotMatch(pdf, /roundRect|drawRectangle/);
});

test("boş bırakılanlar listede yazmaz: haftası boş kişi ızgarada, o günü boş kişi telefonun listesinde yok; açılan ve eklenen kalır", () => {
  const E = ["", "", "", "", "", "", ""];
  const rows = [
    { ref: "u:1", texts: ["09:00–18:00", "", "", "", "", "", ""] },
    { ref: "u:2", texts: [...E] },
    { ref: "u:3", texts: ["", "İzin", "", "", "", "", "   "] },
    { ref: "n:can", texts: [...E], added: true },
  ];
  const refs = (r: { listed: { ref: string }[]; hidden: { ref: string }[] }) => [r.listed.map((x) => x.ref), r.hidden.map((x) => x.ref)];
  // Hafta: yazılmış her şey (izin de) listede; boşluk boş sayılır; bu oturumda eklenen satır listede
  assert.deepEqual(refs(listedRows(rows)), [["u:1", "u:3", "n:can"], ["u:2"]]);
  // Gün: yalnız o günü yazılmış olanlar
  assert.deepEqual(refs(listedRows(rows, new Set(), 0)), [["u:1", "n:can"], ["u:2", "u:3"]]);
  assert.deepEqual(refs(listedRows(rows, new Set(), 1)), [["u:3", "n:can"], ["u:1", "u:2"]]);
  assert.deepEqual(refs(listedRows(rows, new Set(), 6)), [["n:can"], ["u:1", "u:2", "u:3"]]);
  // Açılan: `ref` bütün hafta, `ref|gün` yalnız o gün (ızgarada hafta için de listede)
  assert.deepEqual(refs(listedRows(rows, new Set(["u:2"]), 3)), [["u:2", "n:can"], ["u:1", "u:3"]]);
  assert.deepEqual(refs(listedRows(rows, new Set(["u:2|4"]), 3)), [["n:can"], ["u:1", "u:2", "u:3"]]);
  assert.deepEqual(refs(listedRows(rows, new Set(["u:2|4"]), 4)), [["u:2", "n:can"], ["u:1", "u:3"]]);
  assert.deepEqual(refs(listedRows(rows, new Set(["u:2|4"]))), [["u:1", "u:2", "u:3", "n:can"], []]);

  const grid = read("src/app/panel/vardiya/shift-grid.tsx");
  // Yönetici: ızgara haftası yazılmış olanları, telefon o günü yazılmış olanları listeler; kalanlar "Ekle" düğmelerinde
  assert.match(grid, /const weekList = listedRows\(rows, opened\);/);
  assert.match(grid, /const dayList = listedRows\(rows, opened, day\);/);
  assert.match(grid, /\{weekList\.listed\.map\(\(r\) => \{/);
  assert.match(grid, /\{dayList\.listed\.map\(\(r\) => \{/);
  assert.match(grid, /\{addChips\(weekList\.hidden, null\)\}/);
  assert.match(grid, /\{addChips\(dayList\.hidden, day\)\}/);
  // Kayıttan sonra (sunucunun planı) açılanlar sıfırlanır: boşaltılan kişi listeden düşer
  assert.match(grid, /setRows\(saved\);\n\s+setDraftNote\(null\);\n\s+setOpened\(new Set\(\)\);/);
  // Personel: "Benim haftam" yalnız yazılmış günler, telefonun gün listesi yalnız o günü yazılmış kişiler; tabloda boş kutu yazısız
  const staffView = grid.slice(grid.indexOf("if (!canEdit) {"), grid.indexOf("  return (\n    <div className=\"space-y-4\">\n      {savedNote"));
  assert.match(staffView, /mine\.texts\[i\]\.trim\(\) \? \(/);
  assert.match(staffView, /const dayStaff = listedRows\(planned, undefined, day\)\.listed;/);
  assert.match(staffView, /\{cell \? formatShiftCell\(cell\) : null\}/);
  assert.doesNotMatch(grid, /: "–"\}/);
  // Seçim düğmelerinin altında boş kutu için yazı yok (yer tutucu boşluk)
  assert.match(grid, /formatShiftCell\(cell\)\) : "\\u00a0";/);
});
