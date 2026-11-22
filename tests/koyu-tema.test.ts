// Koyu tema (docs/KOYU-TEMA.md): globals.css'teki `html.dark` belirteçlerinin kontrastı, mor / bordo tonun yokluğu,
// açık temanın değerlerinin aynı kalması ve ilk boyamadan önce çalışan tema betiği.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { THEME_KEY, THEME_SCRIPT, resolveDark } from "../src/lib/theme";

const css = readFileSync("src/app/globals.css", "utf8");
const arcCss = readFileSync("src/components/arc/foundation.css", "utf8");

/** `seçici {` ile başlayan ilk bloğun içi (iç içe süslü parantezleri sayar) */
function block(source: string, selector: string): string {
  const at = source.indexOf(`${selector} {`);
  assert.ok(at >= 0, `${selector} bloğu bulunamadı`);
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(source.indexOf("{", at) + 1, i);
  }
  throw new Error(`${selector} bloğu kapanmıyor`);
}

/** Bloktaki `--ad: değer;` çiftleri (yorumlar atlanır) */
function vars(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

type RGBA = { r: number; g: number; b: number; a: number };

function parseColor(v: string): RGBA | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/.exec(v);
  if (rgb) return { r: +rgb[1]!, g: +rgb[2]!, b: +rgb[3]!, a: rgb[4] === undefined ? 1 : +rgb[4] };
  return null;
}

/** Saydam rengi zeminin üstüne koyar */
function over(c: RGBA, bg: RGBA): RGBA {
  return { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 };
}

function luminance({ r, g, b }: RGBA): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrast(fg: RGBA, bg: RGBA): number {
  const f = luminance(over(fg, bg));
  const b = luminance(bg);
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
}

// Koyu belirteçler yalnız ekranda (@media screen içinde): baskı açık temayla çıkar
const darkSection = css.slice(css.indexOf("Koyu tema: finans paneli görünümü"));
assert.match(darkSection, /^[^]*?\*\/\n@media screen \{\n {2}html\.dark \{/);
const dark = vars(block(darkSection, "html.dark"));
const color = (name: string): RGBA => {
  const v = dark.get(name);
  assert.ok(v, `koyu temada ${name} tanımlı değil`);
  const c = parseColor(v);
  assert.ok(c, `${name} renk değil: ${v}`);
  return c;
};

const SURFACES = { "zemin (canvas)": "--color-canvas", "kart (panel)": "--color-panel", "yükseltilmiş (surface)": "--color-surface" } as const;

test("koyu temanın zeminleri nottaki değerler: sayfa #050302, kart #1E1C1B, yükseltilmiş #2B2928", () => {
  assert.equal(dark.get("--color-canvas"), "#050302");
  assert.equal(dark.get("--background"), "#050302");
  assert.equal(dark.get("--color-panel"), "#1e1c1b");
  assert.equal(dark.get("--chart-card-bg"), "#1e1c1b");
  assert.equal(dark.get("--color-surface"), "#2b2928");
  assert.equal(dark.get("--color-ink"), "#ffffff");
  assert.match(block(darkSection, "html.dark"), /color-scheme:\s*dark;/);
});

test("gövde metni belirteçleri üç zeminde de en az 4,5:1", () => {
  const text = [
    "--color-ink",
    "--color-ink-soft",
    "--color-ink-mute",
    "--color-ink-quiet",
    "--foreground",
    "--muted",
    "--chart-muted",
    "--color-good",
    "--color-bad",
    "--color-warn",
    "--color-info",
    "--color-bad-ink",
    "--color-warn-ink",
    "--color-good-ink",
    "--color-brass-700",
    "--color-brass-800",
    "--color-bordo-800",
    "--color-brand-700",
    "--viz-muted",
    "--viz-ink",
  ];
  for (const t of text) {
    for (const [where, bg] of Object.entries(SURFACES)) {
      const r = contrast(color(t), color(bg));
      assert.ok(r >= 4.5, `${t} ${where} üstünde ${r.toFixed(2)}:1 (en az 4,5)`);
    }
  }
});

test("dolu zeminlerin ve rozetlerin yazısı en az 4,5:1", () => {
  const pairs: [string, string][] = [
    ["--color-on-solid", "--color-ink"], // seçili hap, etkin sayfa: beyaz hap, koyu yazı
    ["--color-on-solid", "--color-bad"],
    ["--color-on-solid", "--color-warn"],
    ["--color-on-solid", "--color-good"],
    ["--color-on-solid", "--color-brass-500"],
    ["--color-on-primary", "--color-primary"], // ana eylem düğmesi
    ["--color-good-ink", "--color-lime"], // olumlu dolu rozet, accent düğme
    ["--color-good-ink", "--color-good-soft"],
    ["--color-good", "--color-good-soft"],
    ["--color-bad", "--color-bad-soft"],
    ["--color-bad-ink", "--color-bad-soft"],
    ["--color-warn", "--color-warn-soft"],
    ["--color-warn-ink", "--color-warn-soft"],
    ["--color-info", "--color-info-soft"],
    ["--color-brass-800", "--color-brass-100"],
    ["--color-bordo-800", "--color-bordo-50"],
    ["--color-ink", "--chart-bg"], // açılır menüde üzerine gelinen satır
  ];
  for (const [fg, bg] of pairs) {
    const r = contrast(color(fg), color(bg));
    assert.ok(r >= 4.5, `${fg} / ${bg}: ${r.toFixed(2)}:1 (en az 4,5)`);
  }
  // Saydam rozet zemini (bg-lime/25, Badge green) kartın üstünde
  const tint = { ...color("--color-lime"), a: 0.25 };
  const r = contrast(color("--color-good-ink"), over(tint, color("--color-panel")));
  assert.ok(r >= 4.5, `good-ink / lime%25 kartta ${r.toFixed(2)}:1`);
});

test("arayüz öğeleri (ana eylem dolgusu, grafik serileri, kuruş, odak) üç zeminde en az 3:1", () => {
  const ui = ["--color-primary", "--color-ink-faint", "--viz-1", "--viz-2", "--viz-3", "--viz-target", "--color-brass-500", "--color-bordo-600"];
  for (const t of ui) {
    for (const [where, bg] of Object.entries(SURFACES)) {
      const r = contrast(color(t), color(bg));
      assert.ok(r >= 3, `${t} ${where} üstünde ${r.toFixed(2)}:1 (en az 3)`);
    }
  }
  // Odak çizgisi: beyaz %50, en koyu ve en açık zeminde
  const focus = /outline-color:\s*(rgb\([^)]+\))/.exec(darkSection);
  assert.ok(focus, "koyu temada odak rengi yok");
  for (const bg of Object.values(SURFACES)) assert.ok(contrast(parseColor(focus[1]!)!, color(bg)) >= 3);
});

test("koyu belirteçlerde mor / bordo yok: ton 280-355° arasında doygun renk tanımlanmaz", () => {
  const all = [
    ...dark,
    ...vars(block(darkSection, 'html.dark [data-component="recent-activity"]')),
    ...vars(block(darkSection, 'html.dark [data-component="gauge"]')),
    ...vars(block(darkSection, 'html.dark [data-sonner-toaster][data-sonner-theme="light"]')),
    ...vars(block(arcCss, "html.dark .arc")),
  ];
  let checked = 0;
  for (const [name, value] of all) {
    const c = parseColor(value);
    if (!c) continue;
    checked++;
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    const chroma = (max - min) / 255;
    if (chroma < 0.1) continue; // gri sayılır (sıcak koyu griler ve beyaz)
    const d = max - min;
    let hue = max === c.r ? ((c.g - c.b) / d) % 6 : max === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    assert.ok(hue < 280 || hue > 355, `${name}: ${value} mor / bordo tonda (${hue.toFixed(0)}°)`);
  }
  assert.ok(checked > 60, `yalnız ${checked} renk denetlendi`);
});

test("açık tema değişmedi: anlamsal belirteçlerin açık değerleri eskisiyle aynı", () => {
  const light = vars(block(css, "@theme"));
  const expected: Record<string, string> = {
    "--color-canvas": "#ffffff",
    "--color-surface": "#ffffff",
    "--color-panel": "#f4f4f5",
    "--color-panel-deep": "#e4e4e7",
    "--color-ink": "#171717",
    "--color-ink-soft": "#3f3f46",
    "--color-ink-mute": "#6b6b74",
    "--color-ink-quiet": "#a1a1aa",
    "--color-line": "rgb(0 0 0 / 0.07)",
    "--color-line-strong": "#e4e4e7",
    "--color-good": "#3f6212",
    "--color-lime": "#c0f21e",
    "--color-bad": "#dc2626",
    "--color-warn": "#c2410c",
    "--color-info": "#2563eb",
    // Koyu temayla gelen adlar açıkta eski sınıfların değeri: bg-primary = bg-ink, text-on-solid = text-white
    "--color-primary": "#171717",
    "--color-on-primary": "#ffffff",
    "--color-on-solid": "#ffffff",
  };
  for (const [k, v] of Object.entries(expected)) assert.equal(light.get(k), v, k);
  const root = vars(block(css, ":root"));
  assert.equal(root.get("--background"), "#ffffff");
  assert.equal(root.get("--foreground"), "#171717");
  assert.match(css, /:root \{\n {2}color-scheme: light;/);
  // Grafiklerin açık renkleri eski sabitlerle aynı (charts.tsx SERIES, GRID, AXIS, MUTED)
  const viz = vars(css.slice(css.indexOf("--viz-1"), css.indexOf("--viz-target") + 40));
  assert.equal(viz.get("--viz-1"), "#2563eb");
  assert.equal(viz.get("--viz-2"), "#e8590c");
  assert.equal(viz.get("--viz-3"), "#16a34a");
  assert.equal(viz.get("--viz-grid"), "#e4e4e7");
  // `dark:` öneki işletim sistemine değil <html class="dark">'a bağlı, baskıda hiç
  assert.match(css, /@custom-variant dark \{\s*@media screen \{\s*&:where\(\.dark, \.dark \*\) \{\s*@slot;/);
});

/** src altındaki .tsx dosyaları */
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsxFiles(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

test("dolu mürekkep zeminde (bg-ink) yazı text-on-solid: koyuda zemin beyaz olur, text-white okunmaz", () => {
  const bad: string[] = [];
  for (const f of [...tsxFiles("src/app/panel"), ...tsxFiles("src/components/ui"), ...tsxFiles("src/components/panel")]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/"[^"\n]*\bbg-ink\b[^"\n]*"/g)) if (/\btext-white\b/.test(m[0])) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

/** Betiği sahte bir belgede çalıştırır; `<html>`'in sınıfını ve tarayıcı çubuğu rengini döndürür */
function boot(opts: { stored?: string | null; systemDark: boolean; path?: string; storageThrows?: boolean }) {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const meta = { content: "#ffffff", setAttribute: (_: string, v: string) => (meta.content = v) };
  const listeners: Record<string, (() => void)[]> = {};
  const context = {
    document: {
      documentElement: {
        classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      querySelector: () => meta,
      addEventListener: () => {},
    },
    location: { pathname: opts.path ?? "/panel" },
    window: {} as Record<string, unknown>,
  };
  context.window = {
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error("kapalı");
        return k === THEME_KEY ? (opts.stored ?? null) : null;
      },
    },
    matchMedia: () => ({ matches: opts.systemDark, addEventListener: (e: string, f: () => void) => (listeners[e] ??= []).push(f) }),
    addEventListener: () => {},
  };
  runInNewContext(THEME_SCRIPT, context);
  return { dark: classes.has("dark"), theme: attrs.get("data-theme"), meta: meta.content, listeners, apply: context.window.__ladminTema };
}

test("tema betiği: seçim ve sistem tercihinden <html class=dark> ve data-theme, QR menü hep açık", () => {
  assert.deepEqual([boot({ stored: "koyu", systemDark: false }).dark, boot({ stored: "koyu", systemDark: false }).theme], [true, "dark"]);
  assert.equal(boot({ stored: "acik", systemDark: true }).dark, false);
  assert.equal(boot({ stored: null, systemDark: true }).dark, true);
  assert.equal(boot({ stored: null, systemDark: false }).dark, false);
  assert.equal(boot({ stored: "saçma", systemDark: true }).dark, true, "bilinmeyen değer sistem sayılır");
  assert.equal(boot({ stored: "koyu", systemDark: true, path: "/menu" }).dark, false, "QR menü açık kalır");
  assert.equal(boot({ stored: "koyu", systemDark: true, path: "/menuler" }).dark, true);
  assert.equal(boot({ storageThrows: true, systemDark: true }).dark, true, "depolama kapalıysa sistem");
  const d = boot({ stored: "koyu", systemDark: false });
  assert.equal(d.meta, "#050302");
  assert.equal(typeof d.apply, "function");
  // Sistem tercihi değişince yeniden hesaplanır
  assert.equal(boot({ stored: null, systemDark: false }).listeners.change?.length, 1);
  // TypeScript tarafı aynı kararı verir
  assert.equal(resolveDark("sistem", true, "/panel"), true);
  assert.equal(resolveDark("acik", true, "/panel"), false);
  assert.equal(resolveDark("koyu", false, "/menu/x"), false);
});
