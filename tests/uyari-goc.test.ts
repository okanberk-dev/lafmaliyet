// Uyarı göçünün bekçisi (docs/planlar/ux-sade.md §6.4, §12): panelde uyarı yalnız ortak `Notice` bileşeniyle yazılır.
// Elle renkli kutu (renk zemini + dolgu), elle uyarı ikonu, açık zeminde AA'nın altında kalan `text-bad` + `bg-bad-soft`,
// ekran gövdesinde geliştirici sözcüğü (anahtar adı, Vercel, komut, belge yolu), uzun düz başlık ve personelin açtığı
// ekranda `tech` yeni bir kodda çıkarsa bu test kırmızıya döner. İzinler dosya + sınıf dizesinin bir parçasıyla
// tutulur (satır numarası kayar): Ek A'nın "D" (dokunulmaz) satırları, §4.7'nin başlık ikonları, kurulumun evi olan
// yönetici ekranları.
// Çalıştırma: npx tsx --test tests/uyari-goc.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Bekçinin kapsamı: panelin ekranları ve panel bileşenleri (.tsx) */
function scopeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) out.push(p);
    }
  };
  walk("src/app/panel");
  walk("src/components/panel");
  return out.sort();
}

/**
 * Yorumları boşlukla değiştirir (satır numarası ve konumlar korunur): blok yorumlar, JSX yorumları ve satır yorumları.
 * Dize içindeki "//" (adres) satır yorumu sayılmaz: yalnız satır başında ya da boşluktan sonra gelen "//".
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[\s(])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

/** Dosyadaki dize sabitleri ("…", '…', `…` parçaları); sınıf adları bunların içinde */
function stringLiterals(src: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) out.push({ text: m[1] ?? m[2] ?? m[3] ?? "", index: m.index });
  return out;
}

// Renkli zemin (durum ön eki "hover:" gibi olanlar düğmenin hâli, kutu değil) ve dolgu
const BOX_BG = /(?<![\w:/-])bg-(?:warn|bad|info|good)-soft(?:\/\d+)?(?![\w-])|(?<![\w:/-])bg-lime\/25(?![\w-])/;
const PADDING = /(?<![\w:-])(?:px|py|p)-/;

/**
 * Ek A'nın "D" satırları (rozet, hap, form içi onay bloğu, içerik vurgusu, ikon karosu): kutu sınıfı ya da
 * `text-bad` + `bg-bad-soft` bir arada olabilir. Dosya + sınıf dizesinin bir parçası.
 */
const D_ALLOW: readonly [string, string][] = [
  ["src/app/panel/kontrol/[id]/run-form.tsx", "rounded-xl bg-warn-soft p-3"], // 129 aralık dışı değer + not alanı (form içi soru)
  ["src/app/panel/kontrol/[id]/run-form.tsx", "bg-bad-soft text-bad"], // 128 değer hapı
  ["src/app/panel/kontrol/run-view.tsx", "rounded-full bg-bad-soft px-2.5 py-0.5 text-bad"], // 137 değer hapı
  ["src/app/panel/urunler/[id]/recipe-editor.tsx", "rounded-full bg-info-soft px-2 py-0.5 font-mono"], // 240 parametre kodu çipi
  ["src/app/panel/urunler/page.tsx", "rounded-full bg-warn-soft px-1.5 py-0.5"], // 250 "Kasa N" rozeti
  ["src/app/panel/faturalar/cash-out-invoices.tsx", "bg-bad-soft/60 px-4 py-2"], // 24 liste başlığı
  ["src/app/panel/faturalar/cash-out-invoices.tsx", "rounded-lg bg-bad-soft text-bad"], // 25 ikon karosu
  ["src/app/panel/tedarikciler/cari-payment-dialog.tsx", "flex cursor-pointer items-start gap-2 rounded-2xl bg-warn-soft"], // 219 onay kutulu blok
  ["src/app/panel/tedarikciler/[cari]/debt-dialog.tsx", "mt-2 flex cursor-pointer items-start gap-2 rounded-2xl bg-warn-soft"], // 202 onay kutulu blok
  ["src/app/panel/tedarikciler/cari-ui.tsx", "space-y-2 rounded-2xl bg-warn-soft px-3.5 py-3"], // 222 PastConfirm
  ["src/app/panel/karaoke/orders-board.tsx", "rounded-xl bg-warn-soft px-3 py-2 text-[14px]"], // 86 müşterinin notu
  ["src/app/panel/hatirlaticilar/payment-ui.tsx", "rounded-full bg-info-soft px-1.5 py-px"], // 69 "Sıradaki dönem" hapı
  ["src/components/panel/error-view.tsx", "rounded-2xl bg-bad-soft text-bad"], // 274 hata ikon karosu
];

const allowed = (file: string, text: string, list: readonly [string, string][]) => list.some(([f, part]) => f === file && text.includes(part));

test("elle renkli kutu yok: renk zemini + dolgu yalnız Ek A'nın dokunulmaz satırlarında (uyarı Notice'te)", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) {
    const src = stripComments(read(f));
    for (const s of stringLiterals(src)) {
      if (BOX_BG.test(s.text) && PADDING.test(s.text) && !allowed(f, s.text, D_ALLOW)) bad.push(`${f}:${lineOf(src, s.index)}: ${s.text}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("açık kırmızı zeminde text-bad yok (bad-soft üstünde 4,41: AA altı); kutunun mürekkebi text-bad-ink", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) {
    const src = stripComments(read(f));
    for (const s of stringLiterals(src)) {
      if (/(?<![\w:/-])bg-bad-soft(?:\/\d+)?(?![\w-])/.test(s.text) && /(?<![\w:-])text-bad(?![\w-])/.test(s.text) && !allowed(f, s.text, D_ALLOW)) {
        bad.push(`${f}:${lineOf(src, s.index)}: ${s.text}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

/** Uyarı ikonunun JSX'i: yalnız ortak bileşenler ve §4.7'nin kart / rakam başlığı ikonları */
const ICON_ALLOW: readonly string[] = [
  "src/components/panel/error-view.tsx", // sayfa hata görünümü (ayrı desen)
  "src/app/panel/hammaddeler/page.tsx", // Stat ikonu
  "src/app/panel/hammaddeler/price-holds.tsx", // kart başlığı ikonu
  "src/app/panel/faturalar/page.tsx", // Stat ikonu
  "src/app/panel/tutarlilik/page.tsx", // "Büyük fark" Stat ikonu
  // Geçici: Vergi bandı (TaxBanner) Bölüm 3'te kutusuz tek satıra iner, bayatlık ayrı Notice olur (§7.4); o gün kalkar
  "src/app/panel/vergi/ui.tsx",
];

test("elle uyarı ikonu yok: TriangleAlert / AlertTriangle / CircleAlert / AlertCircle JSX'i yalnız izinli yerlerde", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) {
    if (ICON_ALLOW.includes(f)) continue;
    const src = stripComments(read(f));
    for (const m of src.matchAll(/<(TriangleAlert|AlertTriangle|CircleAlert|AlertCircle)\b/g)) bad.push(`${f}:${lineOf(src, m.index)}: ${m[1]}`);
  }
  assert.deepEqual(bad, []);
  // §4.7'nin dört yeri gerçekten başlık ikonu olarak kullanır (izin listesi bayatlamasın)
  assert.match(read("src/app/panel/hammaddeler/page.tsx"), /icon=\{<TriangleAlert \/>\}/);
  assert.match(read("src/app/panel/hammaddeler/price-holds.tsx"), /icon=\{<TriangleAlert \/>\}/);
  assert.match(read("src/app/panel/faturalar/page.tsx"), /icon=\{<CircleAlert \/>\}/);
  assert.match(read("src/app/panel/tutarlilik/page.tsx"), /icon=\{<AlertTriangle \/>\}/);
});

// ---------------------------------------------------------------- Geliştirici sözcükleri

const DEV_WORD = /\bVercel\b|\bopenssl\b|\bdocs\/[A-Z]|(?<!process\.env\.)\b[A-Z][A-Z0-9_]*_(?:SECRET|API_KEY)\b/g;
/** Kurulumun evi olan yönetici ekranları: tam talimat orada durur */
const SETUP_HOMES = [/^src\/app\/panel\/ayarlar\//, /^src\/app\/panel\/parasut\//, /^src\/app\/panel\/yardim\/page\.tsx$/];

/** Konumdaki sözcük bir `tech={…}` ifadesinin içinde mi: son `tech={`'ten konuma kadar açık süslü parantez sayısı > 0 */
function insideTech(src: string, index: number): boolean {
  const start = src.lastIndexOf("tech={", index);
  if (start < 0) return false;
  let depth = 0;
  for (let i = start + 5; i < index; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
  }
  return depth > 0;
}

/** Konumdaki sözcük düz metinli `tech="…"` özniteliğinin içinde mi */
function insideTechString(src: string, index: number): boolean {
  const start = src.lastIndexOf('tech="', index);
  if (start < 0) return false;
  const end = src.indexOf('"', start + 6);
  return end > index;
}

test("ekran gövdesinde geliştirici sözcüğü yok: anahtar adı, Vercel, openssl, docs/ yalnız tech'te ya da kurulumun evinde", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) {
    if (SETUP_HOMES.some((r) => r.test(f))) continue;
    const raw = read(f);
    // İçe aktarma satırları ve "// tech-metni" işaretli satırlar (değişkene alınıp yalnız tech'te kullanılan metin) atlanır
    const lines = raw.split("\n").map((l) => (/^\s*import\b/.test(l) || /\/\/ tech-metni\s*$/.test(l) ? " ".repeat(l.length) : l));
    const src = stripComments(lines.join("\n"));
    for (const m of src.matchAll(DEV_WORD)) {
      if (insideTech(src, m.index) || insideTechString(src, m.index)) continue;
      bad.push(`${f}:${lineOf(src, m.index)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- Notice çağrıları

/** `<Notice` etiketinin öznitelik bölümü (süslü parantez derinliği 0'daki ilk `>`'ye kadar) */
function noticeTags(src: string): { attrs: string; index: number }[] {
  const out: { attrs: string; index: number }[] = [];
  for (const m of src.matchAll(/<Notice\b(?!Link|Group|Tech)/g)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + 7;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (depth === 0 && c === '"') quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === ">") break;
    }
    out.push({ attrs: src.slice(m.index + 7, i), index: m.index });
  }
  return out;
}

/** Derinlik 0'daki düz metin öznitelik (`name="…"`) */
function plainAttr(attrs: string, name: string): string | null {
  let depth = 0;
  for (let i = 0; i < attrs.length; i++) {
    const c = attrs[i]!;
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && attrs.startsWith(`${name}="`, i) && /\s/.test(attrs[i - 1] ?? " ")) {
      const end = attrs.indexOf('"', i + name.length + 2);
      return attrs.slice(i + name.length + 2, end);
    }
  }
  return null;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

test("Notice düz metin başlığı en çok 10, ikinci satırı en çok 18 sözcük", () => {
  const bad: string[] = [];
  let n = 0;
  for (const f of scopeFiles()) {
    const src = stripComments(read(f));
    for (const tag of noticeTags(src)) {
      n++;
      const title = plainAttr(tag.attrs, "title");
      const text = plainAttr(tag.attrs, "text");
      if (title !== null && words(title) > 10) bad.push(`${f}:${lineOf(src, tag.index)}: başlık ${words(title)} sözcük: ${title}`);
      if (text !== null && words(text) > 18) bad.push(`${f}:${lineOf(src, tag.index)}: text ${words(text)} sözcük: ${text}`);
    }
  }
  assert.ok(n > 200, `${n} Notice`);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------- Personel

/** Personelin açtığı ekranların klasörleri (STAFF_PATHS sayfaları ve içe aktardıkları) */
const STAFF_DIRS = ["bugun", "kasa", "karaoke", "kontrol", "zayi", "receteler", "sayim", "hatirlaticilarim", "ozel-gunler"].map((d) => `src/app/panel/${d}/`);

/**
 * Personel klasöründe olup yalnız yöneticiye çizilen bileşenler: tech verebilir; çizildikleri yer aşağıda denetlenir
 */
const ADMIN_ONLY: Record<string, { file: string; check: (src: string) => boolean }> = {
  "src/app/panel/kasa/cash-settings.tsx": {
    file: "src/app/panel/kasa/page.tsx",
    // Personel dalı (`if (!admin) { return … }`) bitmeden çizilmez
    check: (src) => {
      const staff = src.indexOf("if (!admin) {\n    return (");
      const at = src.indexOf("<CashSettingsCard");
      return staff > 0 && at > staff && src.indexOf("<CashSettingsCard", at + 1) < 0;
    },
  },
  "src/app/panel/karaoke/karaoke-admin.tsx": {
    file: "src/app/panel/karaoke/page.tsx",
    check: (src) => /\{admin \? \(\s+<KaraokeAdmin\b/.test(src) && (src.match(/<KaraokeAdmin\b/g) ?? []).length === 1,
  },
};

test("personelin açtığı ekranlarda tech yalnız yönetici dalında (role === \"admin\" ya da isAdmin ile koşullu)", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) {
    if (!STAFF_DIRS.some((d) => f.startsWith(d))) continue;
    const src = stripComments(read(f));
    for (const m of src.matchAll(/\btech=/g)) {
      if (ADMIN_ONLY[f]) continue;
      // Aynı Notice'i ya da çevresini saran koşul: en çok 12 satır yukarıda yönetici sınaması
      const before = src.slice(0, m.index).split("\n").slice(-12).join("\n");
      if (/role === "admin"|\bisAdmin\b/.test(before)) continue;
      bad.push(`${f}:${lineOf(src, m.index)}`);
    }
  }
  assert.deepEqual(bad, []);
  for (const [component, site] of Object.entries(ADMIN_ONLY)) assert.ok(site.check(read(site.file)), `${component} yalnız yöneticiye çizilir`);
  // U7: personelin karaoke kutusu tech ve yönetici talimatı taşımaz
  const board = read("src/app/panel/karaoke/karaoke-board.tsx");
  assert.match(board, /title="Site bağlı değil: rezervasyon ve sipariş buraya gelmez"/);
});

// ---------------------------------------------------------------- Her uyarı yeni bileşende

/**
 * Ek A'nın Notice (N) ve form / eylem hatası (E) satırlarının dosyaları: hepsi ortak bileşeni içe aktarır ve rolü elle
 * yazmaz (rol Notice'in `live` prop'undan gelir). İzin: Ek A'nın D satırlarındaki elle rol (aşağıda).
 */
const NOTICE_FILES = [
  "analiz/analysis-client.tsx",
  "ayarlar/jobs-card.tsx",
  "ayarlar/lafpos-card.tsx",
  "ayarlar/lafpos-client.tsx",
  "ayarlar/page.tsx",
  "ayarlar/photo-card.tsx",
  "ayarlar/settings-client.tsx",
  "c/confirm-password-dialog.tsx",
  "c/live/device-alerts.tsx",
  "c/live/output-picker.tsx",
  "faturalar/invoices-client.tsx",
  "faturalar/review-notice.tsx",
  "gelir-gider/page.tsx",
  "gelir-gider/sgk-rate-notice.tsx",
  "gelir-gider/site-sales-card.tsx",
  "hammaddeler/ingredients-client.tsx",
  "hammaddeler/price-holds.tsx",
  "harcamalar/monthly-expenses.tsx",
  "hatirlaticilar/nakit/cash-plan-client.tsx",
  "hatirlaticilar/notifications-section.tsx",
  "hatirlaticilar/reminders-client.tsx",
  "hesap/page.tsx",
  "hesap/password-form.tsx",
  "hesap/two-factor.tsx",
  "karaoke/doluluk/page.tsx",
  "karaoke/karaoke-admin.tsx",
  "karaoke/karaoke-board.tsx",
  "karaoke/orders-board.tsx",
  "kasa/cash-form.tsx",
  "kasa/cash-history.tsx",
  "kasa/cash-out-dialog.tsx",
  "kasa/cash-photos.tsx",
  "kasa/cash-requests.tsx",
  "kasa/cash-settings.tsx",
  "kasa/cash-summary.tsx",
  "kasa/closed-day.tsx",
  "kasa/late-report.tsx",
  "kasa/okc-card.tsx",
  "kasa/page.tsx",
  "kontrol/[id]/page.tsx",
  "kontrol/[id]/photo-item.tsx",
  "kontrol/[id]/run-form.tsx",
  "kontrol/duzenle/[id]/page.tsx",
  "kontrol/duzenle/[id]/template-editor.tsx",
  "kontrol/duzenle/page.tsx",
  "kontrol/duzenle/templates-client.tsx",
  "kontrol/run-view.tsx",
  "kullanicilar/access-sheet.tsx",
  "kullanicilar/close-guard.tsx",
  "onaylar/karaoke-cards.tsx",
  "onaylar/kasa-cards.tsx",
  "onaylar/kasa-out-cards.tsx",
  "onaylar/ops-cards.tsx",
  "onaylar/review-list.tsx",
  "parasut/parasut-client.tsx",
  "receteler/change-editor.tsx",
  "receteler/recipe-book.tsx",
  "satislar/page.tsx",
  "satislar/sales-client.tsx",
  "sayim/add-item.tsx",
  "sayim/stock-form.tsx",
  "system-banner.tsx",
  "tahmin/page.tsx",
  "tahmin/special-days.tsx",
  "tedarikciler/[cari]/allocation-dialog.tsx",
  "tedarikciler/[cari]/cari-strips.tsx",
  "tedarikciler/[cari]/debt-dialog.tsx",
  "tedarikciler/[cari]/entry-confirm.tsx",
  "tedarikciler/[cari]/link-dialog.tsx",
  "tedarikciler/[cari]/supplier-client.tsx",
  "tedarikciler/card-dialog.tsx",
  "tedarikciler/cari-payment-dialog.tsx",
  "tedarikciler/request-dialog.tsx",
  "tedarikciler/suppliers-client.tsx",
  "tutarlilik/consistency-client.tsx",
  "tutarlilik/page.tsx",
  "urunler/[id]/price-history-card.tsx",
  "urunler/[id]/recipe-editor.tsx",
  "urunler/[id]/site-menu-card.tsx",
  "urunler/fiyatlar/bulk-editor.tsx",
  "urunler/price-impact-panel.tsx",
  "urunler/products-table.tsx",
  "urunler/site-link-dialog.tsx",
  "urunler/site/site-menu-matching.tsx",
  "urunler/site/site-new-product.tsx",
  "vergi/adjustment-dialog.tsx",
  "vergi/gelir-gider/classify-list.tsx",
  "vergi/page.tsx",
  "zayi/page.tsx",
  "zayi/waste-board.tsx",
].map((p) => (p.startsWith("c/") ? `src/components/panel/${p.slice(2)}` : `src/app/panel/${p}`));

/** Ek A'nın D satırlarındaki elle rol: dosya + rolün bulunduğu satırın bir parçası */
const ROLE_ALLOW: readonly [string, string][] = [
  ["src/app/panel/gelir-gider/page.tsx", "-mt-2 mb-6 text-xs text-pretty text-ink-mute"], // U4: yalnız ciro notu kalan gri satır
  ["src/app/panel/hammaddeler/ingredients-client.tsx", 'id="i-active-err"'], // 56 alan hatası (Field)
  ["src/app/panel/hammaddeler/price-holds.tsx", "flex items-center gap-1.5 text-info"], // 59 okunuyor durumu
  ["src/app/panel/kontrol/[id]/run-form.tsx", 'aria-live="polite" className="mb-1.5'], // 126 ilerleme sayacı
  ["src/app/panel/parasut/parasut-client.tsx", "rounded-2xl bg-surface px-3.5 py-2.5 text-sm"], // 161 okuma ilerlemesi
  ["src/app/panel/urunler/fiyatlar/bulk-editor.tsx", "rounded-2xl bg-surface px-4 py-3 text-sm text-ink-soft"], // 248 boş önizleme
];

test("her uyarı yeni bileşende: Ek A'nın N ve E dosyaları Notice'i içe aktarır, rolü elle yazmaz", () => {
  assert.equal(NOTICE_FILES.length, 90);
  const bad: string[] = [];
  for (const f of NOTICE_FILES) {
    const raw = read(f);
    if (!raw.includes('from "@/components/ui/notice"')) bad.push(`${f}: Notice içe aktarılmıyor`);
    const src = stripComments(raw);
    const lines = src.split("\n");
    for (const m of src.matchAll(/role="(alert|status|note)"/g)) {
      const line = lines[lineOf(src, m.index) - 1]!;
      if (!ROLE_ALLOW.some(([file, part]) => file === f && line.includes(part))) bad.push(`${f}:${lineOf(src, m.index)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("yerel uyarı yardımcıları kalktı: Warn, Note, Strip ve NoteList'in tonu (§5)", () => {
  assert.doesNotMatch(read("src/app/panel/gelir-gider/pnl-grid.tsx"), /function Warn\b/);
  assert.doesNotMatch(read("src/app/panel/tedarikciler/[cari]/debt-dialog.tsx"), /function Warn\b/);
  assert.doesNotMatch(read("src/app/panel/kasa/okc-card.tsx"), /function Note\b/);
  assert.doesNotMatch(read("src/app/panel/tedarikciler/[cari]/cari-strips.tsx"), /function Strip\b/);
  const vergi = read("src/app/panel/vergi/ui.tsx");
  assert.match(vergi, /export function NoteList\(\{ notes, className \}: \{ notes: readonly string\[\]; className\?: string \}\)/);
  for (const f of scopeFiles()) assert.doesNotMatch(read(f), /<NoteList\b[^>]*\btone=/, f);
  // İki yerin aynı fotoğraf denetimi listesi tek bileşende
  for (const f of ["src/app/panel/kasa/cash-photos.tsx", "src/app/panel/kasa/cash-out-dialog.tsx"]) assert.match(read(f), /<CheckNotices\b/, f);
});

test("sayfayla gelen sistem uyarısı role=\"alert\" değil note; personelin yüzen ses hapı yok, ses yuvası sayfanın içinde", () => {
  const banner = read("src/app/panel/system-banner.tsx");
  assert.doesNotMatch(stripComments(banner), /role="alert"|live="assertive"/);
  assert.match(banner, /<Notice\b/);
  const layout = read("src/app/panel/layout.tsx");
  assert.match(layout, /<div id="ses-yuvasi" \/>/);
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /createPortal\(/);
  assert.match(center, /title="Sesli uyarılar kapalı"/);
  assert.doesNotMatch(stripComments(center), /Sesli uyarılar için dokunun/);
});
