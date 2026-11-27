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
  ["src/app/panel/siparisler/orders-board.tsx", "rounded-xl bg-warn-soft px-3 py-2 text-[14px]"], // 86 müşterinin notu
  ["src/app/panel/hatirlaticilar/payment-ui.tsx", "rounded-full bg-info-soft px-1.5 py-px"], // 69 "Sıradaki dönem" hapı
  ["src/components/panel/error-view.tsx", "rounded-2xl bg-bad-soft text-bad"], // 274 hata ikon karosu
];

/**
 * Sınıf ifadesinde (className={…}, cn(…)) birleşince kutu olan, ama tek dizede kutu olmayan Ek A "D" satırları: dolgu
 * ve renk ayrı dizelerde (seçili hâl, rozet tonu). Dosya + birleşik metnin bir parçası.
 */
const D_EXPR_ALLOW: readonly [string, string][] = [
  ["src/app/panel/analiz/analysis-client.tsx", "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular"], // senaryo değişim hapı
  ["src/app/panel/gelir-gider/month-view.tsx", "relative inline-flex h-10 min-w-24 shrink-0 items-center justify-end"], // elle girilen hücre
  ["src/app/panel/gelir-gider/pnl-grid.tsx", "relative flex h-8 w-full cursor-text items-center justify-end rounded-lg"], // elle girilen hücre
  ["src/app/panel/hatirlaticilar/reminders-client.tsx", "flex min-h-[6.5rem] cursor-pointer flex-col justify-between"], // süzgeç kartı (gecikmiş)
  ["src/app/panel/siparisler/orders-board.tsx", "flex min-w-0 flex-col gap-2.5 rounded-2xl bg-surface p-3.5"], // yeni masa siparişinin kartı
  ["src/app/panel/kasa/okc-card.tsx", "flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5"], // "Ayrıntılar" açma düğmesi
  ["src/app/panel/kasa/fold.tsx", "flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5"], // Z'nin katlı alanlarının açma düğmesi (Ayrıntılar'la aynı)
  ["src/app/panel/satislar/sales-client.tsx", "flex items-start gap-2 py-2 pr-1.5 pl-3"], // şüpheli önizleme satırı
  ["src/app/panel/vergi/gelir-gider/classify-list.tsx", "grid gap-2 px-4 py-3 md:grid-cols"], // kaydedilmemiş liste satırı
  ["src/app/panel/faturalar/invoices-client.tsx", "h-7 max-w-full cursor-pointer appearance-none truncate rounded-full"], // kategori hapı (PILL_TONE)
  ["src/app/panel/hammaddeler/ingredients-client.tsx", "relative rounded-xl px-3 py-3.5 transition-colors"], // tahmini fiyatlı satır (ESTIMATE_ROW)
  ["src/app/panel/satislar/sales-client.tsx", "inline-flex h-8 max-w-40 cursor-pointer items-center gap-1.5 rounded-[10px]"], // eşleşme düğmesi (MATCH_TONE)
  ["src/app/panel/vergi/ui.tsx", "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1"], // bandın "sorular" çipi (CHIP)
];

const allowed = (file: string, text: string, list: readonly [string, string][]) => list.some(([f, part]) => f === file && text.includes(part));

/**
 * Konumdaki açılış ayracının (`{` ya da `(`) dengeli kapanışına kadar olan ifade; dize sabitlerinin içi sayılmaz
 * (`"(1)"`, `"[&_x]:…"`). Şablon dizesindeki `${…}` ayraçları dengeli olduğu için sayıma girer.
 */
function balanced(src: string, open: number): string {
  const pair: Record<string, string> = { "{": "}", "(": ")" };
  const close = pair[src[open]!]!;
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\n" && quote !== "`") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === src[open]) depth++;
    else if (c === close && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/**
 * Dosyadaki `const AD = …;` tanımlarının dize sabitleri (ilk derinlik-0 `;`'ye kadar): sınıfı sabite ya da ton nesnesine
 * alınmış kutu (`cn(box, TONE[tone])`, `const redBox = linked ? "bg-bad-soft text-bad" : …`) ifadede adıyla geçer.
 */
function constLiterals(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/g)) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("{([".includes(c)) depth++;
      else if ("})]".includes(c)) depth--;
      else if (depth <= 0 && c === ";") break;
      if (depth < 0) break;
    }
    out.set(m[1]!, stringLiterals(src.slice(start, i)).map((l) => l.text).join(" "));
  }
  return out;
}

/**
 * Sınıf ifadeleri: her `className=` ("…" ya da {…}) ve onun dışındaki her `cn(…)`; içindeki bütün dize sabitleri ve
 * adıyla geçen dosya sabitlerinin dizeleri birleştirilir. Eski kutular çoğu kez dolguyu ve rengi ayrı dizelere yazardı:
 * `cn("rounded-xl px-3 py-2", warn ? "bg-warn-soft text-warn" : "bg-info-soft text-info")`, `cn(box, TONE[tone])`.
 */
function classExpressions(src: string): { text: string; index: number }[] {
  const out: { text: string; index: number }[] = [];
  const covered: [number, number][] = [];
  const consts = constLiterals(src);
  for (const m of src.matchAll(/\bclassName=(?=["{])|\bcn\(/g)) {
    const at = m.index;
    if (covered.some(([a, b]) => at > a && at < b)) continue;
    const open = at + m[0].length - (m[0].startsWith("cn") ? 1 : 0);
    const expr = src[open] === '"' ? src.slice(open, src.indexOf('"', open + 1) + 1) : balanced(src, open);
    covered.push([open, open + expr.length]);
    // Dize sabitlerinin dışındaki adlar (dize içindeki sözcük ad sayılmaz)
    const bare = expr.replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, " ");
    const named = [...new Set(bare.match(/[A-Za-z_$][\w$]*/g) ?? [])].map((n) => consts.get(n) ?? "");
    out.push({ text: [...stringLiterals(expr).map((l) => l.text), ...named].join(" ").trim(), index: at });
  }
  return out;
}

const BAD_SOFT = /(?<![\w:/-])bg-bad-soft(?:\/\d+)?(?![\w-])/;
const TEXT_BAD = /(?<![\w:-])text-bad(?![\w-])/;

/**
 * Bir dosyanın elle kutu bulguları: tek dize (sabit nesnesindeki sınıf da) ve sınıf ifadesi düzeyinde. `box`: renk
 * zemini + dolgu; `ink`: `bg-bad-soft` + `text-bad` (AA altı).
 */
function boxHits(file: string, raw: string): { box: string[]; ink: string[] } {
  const src = stripComments(raw);
  const box = new Map<number, string>();
  const ink = new Map<number, string>();
  const isBox = (t: string) => BOX_BG.test(t) && PADDING.test(t);
  const isInk = (t: string) => BAD_SOFT.test(t) && TEXT_BAD.test(t);
  for (const l of stringLiterals(src)) {
    const line = lineOf(src, l.index);
    if (allowed(file, l.text, D_ALLOW)) continue;
    if (isBox(l.text)) box.set(line, `${file}:${line}: ${l.text.trim()}`);
    if (isInk(l.text)) ink.set(line, `${file}:${line}: ${l.text.trim()}`);
  }
  for (const e of classExpressions(src)) {
    const line = lineOf(src, e.index);
    if (allowed(file, e.text, D_ALLOW) || allowed(file, e.text, D_EXPR_ALLOW)) continue;
    // Tek dizede zaten bulunan kutu ifadede ikinci kez sayılmaz (satır başına bir bulgu)
    if (isBox(e.text) && !box.has(line)) box.set(line, `${file}:${line}: ${e.text.trim()}`);
    if (isInk(e.text) && !ink.has(line)) ink.set(line, `${file}:${line}: ${e.text.trim()}`);
  }
  return { box: [...box.values()], ink: [...ink.values()] };
}

test("elle renkli kutu yok: renk zemini + dolgu yalnız Ek A'nın dokunulmaz satırlarında (uyarı Notice'te)", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) bad.push(...boxHits(f, read(f)).box);
  assert.deepEqual(bad, []);
});

test("açık kırmızı zeminde text-bad yok (bad-soft üstünde 4,41: AA altı); kutunun mürekkebi text-bad-ink", () => {
  const bad: string[] = [];
  for (const f of scopeFiles()) bad.push(...boxHits(f, read(f)).ink);
  assert.deepEqual(bad, []);
});

test("bekçi koşullu sınıfı da yakalar: dolgu ve renk ayrı dizelerde (göç öncesinin en yaygın kutusu; inceleme B2-R2)", () => {
  const f = "src/app/panel/kasa/check-notices.tsx";
  // Göç öncesi kasa/check-notices.tsx: dolgu bir dizede, renk koşullu öbüründe
  const old = `<p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] leading-5", c.level === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}>`;
  assert.equal(boxHits(f, old).box.length, 1, "koşullu renkli kutu");
  // Değişkene alınmış cn(…) ve şablon dizesi de
  assert.equal(boxHits(f, `const cls = cn("rounded-2xl px-3.5 py-2.5", tone === "bad" && "bg-bad-soft text-bad");`).box.length, 1);
  assert.equal(boxHits(f, `const cls = cn("rounded-2xl px-3.5 py-2.5", tone === "bad" && "bg-bad-soft text-bad");`).ink.length, 1);
  assert.equal(boxHits(f, "<div className={`rounded-xl px-3 py-2 ${on ? \"bg-good-soft\" : \"\"}`} />").box.length, 1);
  // Tek dizedeki kutu bir kez sayılır (dize + ifade iki bulgu olmaz)
  assert.equal(boxHits(f, `<p className="rounded-xl bg-warn-soft px-3 py-2">`).box.length, 1);
  // Dize içindeki ayraç ifadeyi bölmez; dolgusuz renk ya da renksiz dolgu kutu değildir
  assert.equal(boxHits(f, `<p className={cn("px-3 py-2 after:content-['(']", ok && "text-ink")}>`).box.length, 0);
  assert.equal(boxHits(f, `<span className={cn("rounded-full", warn ? "bg-warn-soft" : "bg-note")} />`).box.length, 0);
  // Yorumdaki eski kutu sayılmaz
  assert.equal(boxHits(f, `{/* <p className={cn("px-3 py-2", "bg-warn-soft")}> */}`).box.length, 0);
  // Sabite ya da ton nesnesine alınmış sınıf: göç öncesi cari-strips.tsx (Strip) ve ayarlar/asilpos-card.tsx
  const strip = `const TONE = {\n  info: "bg-info-soft text-info",\n  warn: "bg-warn-soft text-warn",\n} as const;\nfunction Strip() {\n  return <div className={cn("flex rounded-2xl px-4 py-3 text-[13px]", TONE[tone])} />;\n}`;
  assert.deepEqual(boxHits("src/app/panel/tedarikciler/[cari]/cari-strips.tsx", strip).box.length, 1);
  const asilpos = `const box = "space-y-2 rounded-2xl px-4 py-3 text-[13px]";\nconst redBox = linked ? "bg-bad-soft text-bad" : "bg-surface";\n<div className={cn(box, redBox)} />`;
  assert.equal(boxHits("src/app/panel/ayarlar/asilpos-card.tsx", asilpos).box.length, 1);
  assert.ok(boxHits("src/app/panel/ayarlar/asilpos-card.tsx", asilpos).ink.length > 0);
});

/** Uyarı ikonunun JSX'i: yalnız ortak bileşenler ve §4.7'nin kart / rakam başlığı ikonları */
const ICON_ALLOW: readonly string[] = [
  "src/components/panel/error-view.tsx", // sayfa hata görünümü (ayrı desen)
  "src/app/panel/hammaddeler/page.tsx", // Stat ikonu
  "src/app/panel/hammaddeler/price-holds.tsx", // kart başlığı ikonu
  "src/app/panel/faturalar/page.tsx", // Stat ikonu
  "src/app/panel/tutarlilik/page.tsx", // "Büyük fark" Stat ikonu
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
const STAFF_DIRS = ["bugun", "kasa", "siparisler", "karaoke", "kontrol", "zayi", "receteler", "sayim", "hatirlaticilarim", "ozel-gunler"].map((d) => `src/app/panel/${d}/`);

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
  "ayarlar/asilpos-card.tsx",
  "ayarlar/asilpos-client.tsx",
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
  "siparisler/orders-board.tsx",
  "siparisler/page.tsx",
  "kasa/cash-form.tsx",
  "kasa/report-sheet.tsx",
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
  "ozel-gunler/special-days.tsx",
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
  assert.equal(NOTICE_FILES.length, 90); // Satış tahmini 4 Kas 2026'da kaldırıldı; Siparişler ekranı 6 Kas 2026'da geldi
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

test("inceleme B2: cari şeritleri yazıldığı sırada, eylemli uyarıların eylemi görünür, boş kart gövdesi yok", () => {
  // R1: her şerit kendi düğmeleriyle görünür (NoticeGroup katlar ve tona göre sıralardı; Ek A 201)
  const strips = stripComments(read("src/app/panel/tedarikciler/[cari]/cari-strips.tsx"));
  assert.doesNotMatch(strips, /NoticeGroup/);
  assert.match(strips, /\{strips\.map\(\(\{ key, \.\.\.p \}\) => \(\s*<Notice key=\{key\} \{\.\.\.p\} \/>/);
  // R3: iade uyarısının yapılacağı ve bağlantısı Ayrıntı'nın dışında (§4.3: warn'da eylem ya da text zorunlu)
  const parasut = read("src/app/panel/parasut/parasut-client.tsx");
  const returns = parasut.slice(parasut.indexOf("function ReturnsNotice"), parasut.indexOf("// ---------------------------------------------------------------- ürün → hammadde bağlantıları"));
  assert.match(returns, /text="Faturalar'da aynı tedarikçiye eksi tutarlı fatura ekleyin; eklenince buradan kalkar\."/);
  assert.match(returns, /action=\{<NoticeLink href="\/panel\/faturalar">Faturalara git<\/NoticeLink>\}/);
  assert.doesNotMatch(returns, /Faturalara git →/);
  // Reçetesiz ürünlerin satır başına bağlantıları açık başlar (§4.4)
  const analiz = read("src/app/panel/analiz/analysis-client.tsx");
  const noRecipe = analiz.slice(analiz.indexOf("function NoRecipeNote"), analiz.indexOf("export function MenuEngineering"));
  assert.match(noRecipe, /<Notice\s+tone="warn"\s+defaultOpen\b/);
  assert.match(noRecipe, /text="Reçetesini girince gruplara katılır\."/);
  // V9: site bağlı değilken siparişler kartının gövdesi (boş pay) çizilmez
  assert.match(read("src/app/panel/siparisler/orders-board.tsx"), /\{data\?\.configured \? \(\s*<div className="space-y-3 px-5 pb-5">/);
});

test("Sayfanın başındaki ses satırları yalnız personelde, yöneticide çıkmaz", () => {
  const center = read("src/components/panel/live/alert-center.tsx");
  assert.match(center, /const pageRows = role !== "admin";/);
  assert.equal((center.match(/\{pageRows && /g) ?? []).length, 3, "üç satır da (susturuldu, karaoke, sesli uyarılar) personele bağlı");
});
