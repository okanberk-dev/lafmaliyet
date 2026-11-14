// Personel sızıntı denetimi, çalışan sunucuya karşı (plan docs/planlar/personel-yetki.md §6.2). CI'da koşmaz; dalga
// birleşmeden önce elle çalıştırılır.
//
// Panelin üretim derlemesi (`next build && next start`) ya da bir önizleme ve bir personel hesabının oturum çerezi
// verilir. Ekran listesi elle tutulmaz: src/app/panel altındaki her sayfa src/lib/roles.ts'in kuralıyla (canOpen)
// ayrılır. Personelin açabildiği her ekranın hem HTML'i hem RSC yükü (`RSC: 1`) çekilir ve maliyet / tutar anahtarları
// (tests/helpers/leak-scan.ts › COST_KEYS) aranır; ₺ yalnız tutar göstermemesi gereken ekranlarda aranır. Kasa sayfaları
// (personelin kendi yazdığı sayılar, herkese açık satış fiyatı), Bugün (kasa farkı), reçete defteri (satış fiyatı) ve
// hatırlatıcılarım ₺ gösterebilir. Sayfa akış içinde yönlendirirse (HTTP 200, gövdede NEXT_REDIRECT; Stok sayımı ay
// seçilmeden açılınca böyle) hedef izlenir, asıl sayfa taranır: önceden yalnız yönlendirme kabuğu taranıp "✓" basılıyordu
// (denetim KA-03). Dinamik personel ekranı (kontrol/[id]) taranan sayfalardaki ilk bağlantısıyla denenir. Personelin
// açamadığı her adres (yönetici ekranları, personel yolunun altındaki ADMIN_ONLY_PATHS dahil) personel çereziyle Bugün'e
// dönmelidir. Canlı uç (/api/canli) da taranır: COST_KEYS hiç, karaoke tutarı (totalMinor, refundMinor) yalnız null
// olarak. Bir şey tutmazsa çıkış kodu 1.
//
// Çalıştırma:
//   PERSONEL_COOKIE='laf_session=…' npx tsx scripts/personel-sizinti.ts [http://localhost:3000]
// Çerez: personel hesabıyla girişten sonra tarayıcının geliştirici araçlarında (Application › Cookies) panelin
// çerezleri (yerelde laf_session, https'te __Host-laf_session); "ad=değer; ad=değer" biçiminde hepsi verilebilir.
// Anlamlı bir tarama için ekranlarda veri olmalı: bekleyen istekler, taslak, tükenen ürün, kasa raporları, zayi, bugünün
// karaoke oturumları. Eylem yanıtları (zil, kaydetme) taranmaz; onları kaynak testleri bekler
// (tests/personel-sizinti-*.test.ts).

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import { canOpen, STAFF_HOME } from "../src/lib/roles";
import { COST_KEYS, MODPOS_ADMIN_KEYS, OKC_ADMIN_KEYS } from "../tests/helpers/leak-scan";

const PANEL_DIR = fileURLToPath(new URL("../src/app/panel", import.meta.url));

/** ₺ gösterebilen personel ekranları (alt sayfaları ve tarihli görünümleri dahil); ötekilerinde ₺ yasak */
export const LIRA_OK = ["/panel/bugun", "/panel/kasa", "/panel/receteler", "/panel/hatirlaticilarim"] as const;

/** Adres yol parçası sınırında eşleşir ("/panel/kasa" ve "/panel/kasa/fiyatlar" evet, "/panel/kasalar" hayır) */
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);
const pathOf = (path: string) => path.split(/[?#]/)[0];

export type PanelRoute = {
  /** Denenen adres: dinamik parça "1" olur (personeli proxy sayfadan önce yönlendirir, değer önemsiz) */
  path: string;
  /** Dosyadaki biçim ("/panel/kontrol/[id]") */
  pattern: string;
  dynamic: boolean;
};

/** Panelin sayfaları: src/app/panel altındaki her page.tsx (yol grupları "(…)" adrese girmez, "_…" klasörleri sayfa değil) */
export function panelRoutes(dir = PANEL_DIR): PanelRoute[] {
  const out: PanelRoute[] = [];
  const walk = (at: string, segs: string[]) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith("_")) continue;
        walk(join(at, e.name), e.name.startsWith("(") ? segs : [...segs, e.name]);
      } else if (e.name === "page.tsx") {
        const pattern = ["/panel", ...segs].join("/");
        const dynamic = segs.some((s) => s.startsWith("["));
        out.push({ path: dynamic ? pattern.replace(/\[[^\]]+\]/g, "1") : pattern, pattern, dynamic });
      }
    }
  };
  walk(dir, []);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Taranacak personel ekranları: personelin açabildiği her sabit sayfa (roles.ts › canOpen), dünün ve 5 gün öncesinin
 * kasası, 5 gün öncesinin zayisi. `lira: false` olanlarda ₺ yasak.
 */
export function staffPages(routes: PanelRoute[], today: string): { path: string; lira: boolean }[] {
  const fixed = routes.filter((r) => !r.dynamic && canOpen("staff", r.path)).map((r) => r.path);
  const dated = [`/panel/kasa?gun=${addDays(today, -1)}`, `/panel/kasa?gun=${addDays(today, -5)}`, `/panel/zayi?gun=${addDays(today, -5)}`];
  return [...fixed, ...dated].map((path) => ({ path, lira: LIRA_OK.some((p) => under(pathOf(path), p)) }));
}

/**
 * Personel çereziyle Bugün'e dönmesi gereken adresler: personelin açamadığı her sayfa (yönetici ekranları ve personel
 * yolunun altındaki ADMIN_ONLY_PATHS: karaoke doluluğu, kontrol listelerini düzenleme). Vergi'nin dört ekranı da
 * (dalga 12, docs/VERGI.md): RSC isteği de Bugün'e döner, yükte vergi verisi olmaz.
 */
export function adminPages(routes: PanelRoute[]): string[] {
  return routes.filter((r) => !canOpen("staff", r.path)).map((r) => r.path);
}

/** Dinamik personel sayfasının (kontrol/[id]) gövdedeki ilk bağlantısı; personelin açamadığı ya da sabit sayfa olan atlanır */
export function linkFor(route: PanelRoute, body: string, routes: PanelRoute[]): string | null {
  const re = new RegExp(`href=\\\\?"(${route.pattern.replace(/\[[^\]]+\]/g, "[A-Za-z0-9_-]+")})\\\\?"`, "g");
  const fixed = new Set(routes.filter((r) => !r.dynamic).map((r) => r.path));
  for (const m of body.matchAll(re)) if (!fixed.has(m[1]) && canOpen("staff", m[1])) return m[1];
  return null;
}

/**
 * Sayfanın akış içinde verdiği yönlendirme: redirect() Suspense'in içinde çağrılınca yanıt HTTP 200 döner, gövdede
 * `NEXT_REDIRECT;replace;/panel/sayim?ay=2026-11;307;` durur. Hedef (yalnız aynı sitenin adresi), yoksa null.
 */
export function streamRedirect(body: string): string | null {
  const m = /NEXT_REDIRECT;(?:replace|push);((?:[^;"\s\\]|\\u[0-9a-fA-F]{4})+);30[1278]/.exec(body);
  if (!m) return null;
  const to = m[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, "&");
  return to.startsWith("/") && !to.startsWith("//") ? to : null;
}

/** JSON anahtarı olarak (HTML'deki RSC parçalarında tırnaklar kaçışlı: \"cost\":) */
const keyRe = (keys: readonly string[]) => new RegExp(`(?:^|[^A-Za-z0-9_$])\\\\?"(${keys.join("|")})\\\\?"\\s*:`, "g");
const KEY_RE = keyRe(COST_KEYS);
const LIRA_RE = /₺|\\u20ba/i;
/** Kasa sayfalarında yazarkasa Z'sinin yönetici anahtarları da (kümülatif, toplam dışı tahsilat; okc-z.md D17) */
const OKC_RE = keyRe(OKC_ADMIN_KEYS);
/** ModPOS kasa föyünün yönetici anahtarları: föy personelin hiçbir ekranına gitmez (docs/MODPOS-API.md › Nerede görünür) */
const MODPOS_RE = keyRe(MODPOS_ADMIN_KEYS);
/** Karaoke tutarı canlı uçta personele yalnız null gider (src/server/karaoke/board.ts › toSessionDTO) */
const LIVE_AMOUNT_RE = /"(totalMinor|refundMinor)"\s*:\s*(?!null\b)[^\s,}\]]/g;

const found = (body: string, re: RegExp) => [...new Set([...body.matchAll(re)].map((m) => m[1]))];

/** Personelin ekranında yasak anahtarlar: COST_KEYS ve ModPOS föyü her yerde, yazarkasa Z'sinin yönetici anahtarları kasada */
export function pageLeaks(path: string, body: string): string[] {
  return [...found(body, KEY_RE), ...(under(pathOf(path), "/panel/kasa") ? found(body, OKC_RE) : []), ...found(body, MODPOS_RE)];
}

/** Canlı uçta (/api/canli) yasak olan: COST_KEYS anahtarı hiç, karaoke tutarı null dışında bir değerle */
export function liveLeaks(json: string): string[] {
  return [...new Set([...found(json, KEY_RE), ...found(json, LIVE_AMOUNT_RE)])];
}

/** Bulunan yerin çevresi (rapor için) */
function around(body: string, re: RegExp): string {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(body);
  if (!m) return "";
  return body.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ");
}

type Fetched = { status: number; location: string; body: string; path: string; via: string[] };

export type ScanOptions = { base: string; cookie: string; today?: string; routes?: PanelRoute[]; log?: (line: string) => void };
/** `cookie`: çerez personelin değil ya da geçersiz (hiçbir şey taranmadı) */
export type ScanResult = { checked: number; admin: number; failures: string[]; cookie?: string };

/** Çalışan sunucuyu personel çereziyle tarar; ekrana satır satır yazar, sorunları döndürür */
export async function scanStaffLeaks({ base: rawBase, cookie, today = businessDate(new Date()), routes = panelRoutes(), log = console.log }: ScanOptions): Promise<ScanResult> {
  const base = rawBase.replace(/\/+$/, "");
  const failures: string[] = [];
  let checked = 0;

  async function fetchOnce(path: string, rsc: boolean): Promise<Response> {
    const headers: Record<string, string> = { cookie };
    if (rsc) headers.RSC = "1";
    const res = await fetch(base + path, { headers, redirect: "manual" });
    // RSC isteği `_rsc` önbellek anahtarı olmadan gelirse Next aynı adrese `?_rsc=<özet>` ile 307 döner
    // (node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md); yalnız o yönlendirme bir kez izlenir.
    const to = res.headers.get("location");
    if (rsc && res.status === 307 && to) {
      const next = new URL(to, base);
      if (next.pathname === new URL(path, base).pathname && next.searchParams.has("_rsc")) {
        return fetch(next.href, { headers, redirect: "manual" });
      }
    }
    return res;
  }

  /** Sayfa; akış içindeki yönlendirme (200 + NEXT_REDIRECT) en çok üç kez izlenir, taranan asıl sayfadır */
  async function load(path: string, rsc: boolean): Promise<Fetched> {
    const via: string[] = [];
    let at = path;
    for (;;) {
      const res = await fetchOnce(at, rsc);
      if (res.status !== 200) return { status: res.status, location: res.headers.get("location") ?? "", body: "", path: at, via };
      const body = await res.text();
      const to = streamRedirect(body);
      if (!to) return { status: 200, location: "", body, path: at, via };
      if (to === at || via.includes(to) || via.length >= 3) return { status: 0, location: `yönlendirme döngüsü: ${[...via, at, to].join(" → ")}`, body: "", path: at, via };
      via.push(at);
      at = to;
    }
  }

  // Çerez gerçekten personel mi: Bugün açılır, yöneticinin ana sayfası açılmaz
  const home = await fetchOnce("/panel", false);
  const homeTo = home.headers.get("location") ?? "";
  if (!(home.status >= 300 && home.status < 400 && homeTo.includes(STAFF_HOME))) {
    return { checked: 0, admin: 0, failures: [], cookie: `Çerez personelin değil ya da geçersiz: /panel → ${home.status} ${homeTo}` };
  }

  const pages = staffPages(routes, today);
  const dynamic = routes.filter((r) => r.dynamic && canOpen("staff", r.path));
  const tried = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    for (const rsc of [false, true]) {
      const got = await load(p.path, rsc);
      const label = `${[...got.via, got.path].join(" → ")} (${rsc ? "RSC" : "HTML"})`;
      if (got.status !== 200) {
        failures.push(`${label}: durum ${got.status} ${got.location}`);
        log(`✗ ${label} → ${got.status} ${got.location}`);
        continue;
      }
      checked++;
      const keys = pageLeaks(got.path, got.body);
      const lira = !p.lira && LIRA_RE.test(got.body);
      if (keys.length) failures.push(`${label}: yasak anahtar ${keys.join(", ")} · …${around(got.body, KEY_RE)}…`);
      if (lira) failures.push(`${label}: ₺ var · …${around(got.body, LIRA_RE)}…`);
      log(`${keys.length || lira ? "✗" : "✓"} ${label} · ${Math.round(got.body.length / 1024)} KB`);
      // Dinamik personel ekranı: taranan sayfadaki ilk bağlantısıyla bir kez (ör. Kontrol'deki liste)
      if (!rsc) {
        for (const r of dynamic) {
          if (tried.has(r.pattern)) continue;
          const link = linkFor(r, got.body, routes);
          if (!link) continue;
          tried.add(r.pattern);
          pages.push({ path: link, lira: LIRA_OK.some((x) => under(link, x)) });
        }
      }
    }
  }
  for (const r of dynamic) if (!tried.has(r.pattern)) log(`· ${r.pattern}: taranan sayfalarda bağlantısı yok, denenmedi`);

  const admin = adminPages(routes);
  for (const path of admin) {
    // HTML ve RSC isteği ayrı ayrı: ikisi de gövdesiz yönlendirme (yönetici ekranının yükü personele hiç gitmez)
    for (const rsc of [false, true]) {
      const res = await fetchOnce(path, rsc);
      const to = res.headers.get("location") ?? "";
      const ok = res.status >= 300 && res.status < 400 && new URL(to, base).pathname === STAFF_HOME;
      const label = `${path} (${rsc ? "RSC" : "HTML"})`;
      if (!ok) failures.push(`${label}: personel Bugün'e dönmedi (${res.status} ${to})`);
      log(`${ok ? "✓" : "✗"} ${label} → ${res.status} ${to}`);
    }
  }

  // Canlı uç: açık her panel sekmesi bunu sorar (karaoke, siparişler, hatırlatıcılar)
  const live = await fetch(`${base}/api/canli`, { headers: { cookie, accept: "application/json" }, redirect: "manual" });
  const liveBody = live.status === 200 ? await live.text() : "";
  let role: unknown = null;
  try {
    role = (JSON.parse(liveBody || "{}") as { me?: { role?: unknown } }).me?.role;
  } catch {
    // aşağıda "personelin yanıtı değil" diye düşer
  }
  const liveKeys = liveLeaks(liveBody);
  if (live.status !== 200 || role !== "staff") failures.push(`/api/canli: personelin yanıtı değil (${live.status}, rol ${String(role)})`);
  else {
    checked++;
    if (liveKeys.length) failures.push(`/api/canli: yasak anahtar ya da tutar ${liveKeys.join(", ")}`);
  }
  log(`${live.status === 200 && role === "staff" && !liveKeys.length ? "✓" : "✗"} /api/canli (JSON) · ${Math.round(liveBody.length / 1024)} KB`);

  return { checked, admin: admin.length, failures };
}

async function main() {
  const base = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
  const cookie = process.env.PERSONEL_COOKIE ?? "";
  if (!cookie) {
    console.error("PERSONEL_COOKIE gerekli (personel hesabının oturum çerezi). Ayrıntı dosyanın başında.");
    process.exit(2);
  }
  const { checked, admin, failures, cookie: cookieProblem } = await scanStaffLeaks({ base, cookie });
  if (cookieProblem) {
    console.error(cookieProblem);
    process.exit(2);
  }
  console.log(`\n${checked} yanıt tarandı, ${admin} yönetici adresi denendi.`);
  if (failures.length) {
    console.error(`\n${failures.length} sorun:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Sızıntı yok.");
}

if (process.argv[1]?.endsWith("personel-sizinti.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
