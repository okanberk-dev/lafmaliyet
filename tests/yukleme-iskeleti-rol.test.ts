// Sayfa yüklenirken (rol henüz okunmadan) çizilen iskelet, o ekranı açabilen HER rolün görebileceğinden fazlasını
// göstermez (denetim, 28 Kasım 2026). Kusur: İşçilik / ciro'nun iskeleti Raporlar'ın bütün sekmelerini (Şube
// karşılaştırma, Kaçak raporu, Kayıp önleme) çiziyordu; ekranı müdür de açar, o sekmeler yalnız yöneticinin. Aylık
// harcamalar'ın iskeleti de Sabit giderler ve Maaşlar sekmelerini muhasebeciye gösteriyordu. İkisinde de başlık bileşeninin
// rolü verilmeyince "yönetici" sayılıyordu.
//
// Kural (docs/ROLLER.md): iskelet ekranı açabilen rollerin en darıyla çizilir; yöneticinin sekmeleri içerik gelince
// eklenir (Stok sayımı, Zayi & ikram ve Kasa raporu baştan beri böyle).
//
// Test panelin BÜTÜN sayfalarını tarar: yönetici dışında bir rolün açabildiği her sayfanın iskeletini (Suspense
// `fallback`'leri ve onların dışında hemen çizilenler) HTML'e çevirir; iskeletteki her panel bağlantısını, o sayfayı
// açabilen her rol açabilmelidir. Yeni bir sayfa ya da sekme eklenince kendiliğinden kapsanır.
// Çalıştırma: npx tsx --test tests/yukleme-iskeleti-rol.test.ts

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { before, test } from "node:test";

import { cloneElement, createElement, Fragment, isValidElement, Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ROLE_ORDER, type Role } from "../src/lib/constants";
import { canOpen } from "../src/lib/roles";

// Sayfa modülleri sunucu kütüphanelerini ve stil dosyalarını yükler; içerik (async bileşenler) bu testte hiç çağrılmaz
const require = createRequire(import.meta.url);
const stub = (id: string, exports: unknown) => {
  const p = require.resolve(id);
  require.cache[p] = { id: p, filename: p, loaded: true, exports } as unknown as NodeJS.Module;
};
// Stil modülleri (grafik bileşenleri): sınıf adı yerine boş nesne
require.extensions[".css"] = (m) => {
  m.exports = new Proxy({}, { get: (_, key) => (typeof key === "string" ? key : undefined) });
};
stub("server-only", {});
stub("next/headers", {
  cookies: async () => {
    throw new Error("iskelet çerez okumaz");
  },
  headers: async () => new Headers(),
});
stub("next/navigation", {
  ...require("next/navigation"),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {}, back() {} }),
  usePathname: () => "/panel",
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
});
stub("next/cache", { ...require("next/cache"), refresh: () => {}, revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} });
stub("next/server", { ...require("next/server"), connection: async () => {}, after: () => {} });

const ROOT = join(__dirname, "..", "src", "app", "panel");

/** Paneldeki sayfa dosyaları ve adresleri ("[id]" yerine örnek parça) */
function pageFiles(dir = ROOT): { file: string; route: string }[] {
  const out: { file: string; route: string }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pageFiles(p));
    else if (name === "page.tsx") {
      const parts = relative(ROOT, dir).split(sep).filter(Boolean);
      out.push({ file: p, route: ["/panel", ...parts.map((x) => (x.startsWith("[") ? "1" : x))].join("/") });
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** Yönetici dışında bu adresi açabilen roller */
const otherRoles = (route: string): Role[] => ROLE_ORDER.filter((r) => r !== "admin" && canOpen(r, route));

/**
 * Sayfanın yükleme iskeleti: ağaçtaki her <Suspense> yerine `fallback`'i; gerisi olduğu gibi. Sayfa işlevinin döndürdüğü
 * ağaç üzerinde çalışır (başlığın `description`, `tabs`, `actions` gibi öğe taşıyan prop'ları dahil)
 */
function shell(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map((n, i) => createElement(Fragment, { key: i }, shell(n)));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === Suspense) return shell(el.props.fallback as ReactNode);
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el.props)) props[k] = isValidElement(v) || Array.isArray(v) ? shell(v as ReactNode) : v;
  return cloneElement(el, props);
}

const panelLinks = (html: string): string[] => [...html.matchAll(/href="(\/panel[^"]*)"/g)].map((m) => m[1].split(/[?#]/, 1)[0]);
/** Hiç çözülmeyen söz: iskelet `searchParams` / `params` beklemez */
const never = new Promise<never>(() => {});

interface Shell {
  route: string;
  roles: Role[];
  html: string;
}
const shells: Shell[] = [];
const skipped: string[] = [];

before(async () => {
  for (const { file, route } of pageFiles()) {
    const roles = otherRoles(route);
    if (!roles.length) continue;
    const page = ((await import(file)) as { default: (props: unknown) => unknown }).default;
    // Kendisi async olan sayfanın iskeleti yok (içerik gelene kadar hiçbir şey çizmez)
    if (page.constructor.name === "AsyncFunction") {
      skipped.push(route);
      continue;
    }
    const tree = page({ searchParams: never, params: never }) as ReactNode;
    shells.push({ route, roles, html: renderToStaticMarkup(createElement(Fragment, null, shell(tree))).replace(/&amp;/g, "&") });
  }
});

test("tarama boş değil: yönetici dışında rollerin açtığı sayfaların iskeleti çizildi", () => {
  const routes = shells.map((s) => s.route);
  // Bilinen çok rollü ekranlar listede (liste roles.ts'ten türer; burası yalnız taramanın çalıştığını doğrular)
  for (const r of ["/panel/bugun", "/panel/kasa", "/panel/sayim", "/panel/zayi", "/panel/raporlar/iscilik", "/panel/harcamalar", "/panel/faturalar", "/panel/gelir-gider", "/panel/onaylar", "/panel/vardiya"]) {
    assert.ok(routes.includes(r), `${r} taranmalı (taranmayanlar: ${skipped.join(", ") || "yok"})`);
  }
  assert.deepEqual(skipped, [], "iskeletsiz (async) sayfa: kendi yükleme durumunu ayrıca sınayın");
  for (const s of shells) assert.ok(s.html.length > 0, `${s.route}: iskelet boş`);
});

test("iskeletteki her bağlantıyı, sayfayı açabilen her rol açabilir (yöneticinin sekmesi rol okunmadan çizilmez)", () => {
  const bad: string[] = [];
  for (const s of shells) {
    for (const href of new Set(panelLinks(s.html))) {
      for (const role of s.roles) if (!canOpen(role, href)) bad.push(`${s.route}: iskelette ${href} (${role} açamaz)`);
    }
  }
  assert.deepEqual(bad, []);
});

test("İşçilik / ciro: yüklenirken Raporlar'ın yönetici sekmeleri yok (müdür de açar)", () => {
  const s = shells.find((x) => x.route === "/panel/raporlar/iscilik");
  assert.ok(s, "sayfa tarandı");
  assert.deepEqual(s.roles, ["manager"]);
  for (const t of ["Şube karşılaştırma", "Kaçak raporu", "Kayıp önleme"]) assert.ok(!s.html.includes(t), `iskelette “${t}” sekmesi`);
  assert.ok(s.html.includes("İşçilik / ciro"), "başlık iskelette de yazar");
});

test("Aylık harcamalar: yüklenirken Giderler'in yönetici sekmeleri yok (muhasebeci de açar)", () => {
  const s = shells.find((x) => x.route === "/panel/harcamalar");
  assert.ok(s, "sayfa tarandı");
  assert.deepEqual(s.roles, ["accountant"]);
  for (const t of ["Sabit giderler", "Maaşlar"]) assert.ok(!s.html.includes(t), `iskelette “${t}” sekmesi`);
  assert.ok(s.html.includes("Aylık harcamalar"), "başlık iskelette de yazar");
});

test("iskeletin bağlam satırı ve açıklaması da en dar rolün: yöneticinin menü grubu ve 'yazın / ekleyin' rol okunmadan yazılmaz", () => {
  const pnl = shells.find((x) => x.route === "/panel/gelir-gider");
  assert.ok(pnl, "sayfa tarandı");
  assert.ok(!pnl.html.includes("Kâr & ödemeler"), "yöneticinin menü grubu Gelir-gider iskeletinde");
  // Muhasebeci salt okur: yazmayı öneren açıklama rol okunmadan çizilmez
  assert.ok(!pnl.html.includes("tutarları yazın"), "Gelir-gider iskeleti tutar yazmayı önermez");
  const invoices = shells.find((x) => x.route === "/panel/faturalar");
  assert.ok(invoices, "sayfa tarandı");
  assert.ok(!invoices.html.includes("elle de ekleyebilirsiniz"), "Faturalar iskeleti fatura eklemeyi önermez");
});
