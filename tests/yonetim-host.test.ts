// Yönetim konsolunun adresi ve alan adı kuralı (src/lib/yonetim-host.ts, src/proxy.ts, next.config.ts;
// docs/planlar/yonetim-konsolu.md › K-A). Saf: veritabanı yok. Proxy'nin eşleştiricisi Next'in kendi kodlarıyla denenir.
// Panel adresinde (ladmin.laffogato.net) proxy'nin kapsamı bugünküyle aynı olmalı; konsolun girdileri yalnız konsol
// alan adında eşleşir.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { ESKI_ENV_ONEKI, ESKI_INDIR_YOLU, ESKI_KURULUM_YOLU, KANAL_ALANI } from "../src/lib/asilpos/eski-adlar";
import { config, proxy } from "../src/proxy";
import {
  isYonetimHost,
  KONSOL_SEKMELERI,
  konsolYolu,
  LISANS_ACIKLAMA,
  merkezUrl,
  panelBaglantilari,
  panelYonetimYonlendirmesi,
  YANLIS_ADRES,
  YONETIM_GIRIS,
  YONETIM_HOSTLARI,
  yonetimLink,
  yonetimUrl,
  yonetimUrlAcik,
} from "../src/lib/yonetim-host";

const ROOT = join(__dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const require = createRequire(import.meta.url);

type Matcher = { regexp: string; has?: unknown[]; missing?: unknown[] };
const { getMiddlewareMatchers } = require("next/dist/build/analysis/get-page-static-info") as {
  getMiddlewareMatchers: (m: unknown, c: Record<string, unknown>) => Matcher[];
};
const { getMiddlewareRouteMatcher } = require("next/dist/shared/lib/router/utils/middleware-route-matcher") as {
  getMiddlewareRouteMatcher: (m: Matcher[]) => (path: string, req: { headers: Record<string, string> }, query: Record<string, string>) => boolean;
};
const eslesir = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
const proxyGirer = (host: string, path: string) => eslesir(path, { headers: { host } }, {});

/** Panelin bugünkü kapsamı (değişmez): yalnız bu üç kalıp */
const PANEL_KAPSAMI = getMiddlewareRouteMatcher(getMiddlewareMatchers(["/panel/:path*", "/giris", "/api/export/:path*"], {}));

test("Host: konsolun iki adı (canlı ve yerel), kapı ve büyük harf önemsiz; panel ve başka adlar değil", () => {
  assert.deepEqual([...YONETIM_HOSTLARI], ["yonetim.laffogato.net", "yonetim.localhost"]);
  for (const h of ["yonetim.laffogato.net", "YONETIM.laffogato.net", "yonetim.laffogato.net:443", "yonetim.localhost:3000", "yonetim.laffogato.net."]) assert.ok(isYonetimHost(h), h);
  for (const h of ["ladmin.laffogato.net", "lafmaliyet.vercel.app", "localhost:3000", "yonetim.laffogato.net.kotu.com", "xyonetim.laffogato.net", "", null, undefined]) {
    assert.ok(!isYonetimHost(h), String(h));
  }
});

test("izin matrisi: konsol adresinde yalnız konsol, derlenmiş dosyalar, simgeler, robots, CSP raporu ve hata bildirimi", () => {
  for (const p of ["/yonetim", "/yonetim/", "/yonetim/giris", "/yonetim/lisans", "/yonetim/oturum-bitti", "/_next/static/x.js", "/favicon.ico", "/icon.png", "/apple-icon.png", "/robots.txt", "/api/csp-rapor", "/api/hata", "/icons/a.png", "/brand/b.svg"]) {
    assert.deepEqual(konsolYolu(p), { tur: "gec" }, p);
  }
  for (const p of ["/", "/panel", "/panel/sube-ekleme", "/panel/kullanicilar"]) assert.deepEqual(konsolYolu(p), { tur: "yonlendir", hedef: "/yonetim" }, p);
  for (const p of ["/giris", "/giris/parola"]) assert.deepEqual(konsolYolu(p), { tur: "yonlendir", hedef: YONETIM_GIRIS }, p);
  for (const p of ["/api/pos/gun", "/api/asilpos/kurulum", "/api/asilpos/acilis/giris", "/api/panel/pos/x", "/api/cron/gunluk", "/api/export/x", "/api/mcp", ESKI_KURULUM_YOLU]) {
    assert.deepEqual(konsolYolu(p), { tur: "yanlis-adres" }, p);
  }
  for (const p of ["/asilpos/indir/abc", `${ESKI_INDIR_YOLU}/abc`, "/davet/abc", "/baglan", "/menu", "/oauth/authorize", "/.well-known/oauth-authorization-server", "/manifest.webmanifest", "/sw.js", "/yonetimx", "/_nextx"]) {
    assert.deepEqual(konsolYolu(p), { tur: "yok" }, p);
  }
});

test("proxy konsol adresinde: /panel konsola, /giris konsol girişine, /api/pos/gun 404 yanlis_adres, kurucu 404, /yonetim geçer", async () => {
  const istek = (path: string, host = "yonetim.laffogato.net") => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  let r = await istek("/panel/sube-ekleme?x=1");
  assert.equal(r.status, 307);
  assert.equal(r.headers.get("location"), "https://yonetim.laffogato.net/yonetim");
  r = await istek("/");
  assert.equal(r.headers.get("location"), "https://yonetim.laffogato.net/yonetim");
  r = await istek("/giris");
  assert.equal(r.headers.get("location"), "https://yonetim.laffogato.net/yonetim/giris");
  r = await istek("/api/pos/gun");
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), YANLIS_ADRES);
  assert.deepEqual(YANLIS_ADRES, { error: "yanlis_adres" });
  r = await istek("/asilpos/indir/kod");
  assert.equal(r.status, 404);
  r = await istek("/yonetim");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-middleware-next"), "1");
  // Yerel deneme adı da aynı
  r = await istek("/api/asilpos/kurulum", "yonetim.localhost:3000");
  assert.equal(r.status, 404);
});

test("eşleştirici: panel adresinde kapsam bugünküyle aynı; konsol girdileri yalnız konsol alan adında", () => {
  const ilkUc = (config.matcher as unknown[]).slice(0, 3);
  assert.deepEqual(ilkUc, ["/panel/:path*", "/giris", "/api/export/:path*"]);
  for (const m of (config.matcher as unknown[]).slice(3)) {
    const has = (m as { has?: { type: string; value: string }[] }).has ?? [];
    assert.ok(has.length === 1 && has[0].type === "host", JSON.stringify(m));
    assert.ok(YONETIM_HOSTLARI.some((h) => has[0].value === h.replace(/\./g, "\\.")), has[0].value);
  }
  const yollar = [
    "/",
    "/panel",
    "/panel/sube-ekleme",
    "/giris",
    "/yonetim",
    "/yonetim/giris",
    "/api/pos/gun",
    "/api/asilpos/kurulum",
    "/api/asilpos/acilis/giris",
    "/api/panel/pos/x",
    "/api/cron/gunluk",
    "/api/export/csv",
    "/api/mcp",
    "/asilpos/indir/x",
    "/davet/x",
    "/baglan",
    "/menu",
    "/_next/static/a.js",
  ];
  for (const host of ["ladmin.laffogato.net", "lafmaliyet.vercel.app", "localhost:3000"]) {
    for (const p of yollar) assert.equal(proxyGirer(host, p), PANEL_KAPSAMI(p, { headers: { host } }, {}), `${host}${p}`);
  }
  // Konsol adresinde derlenmiş dosyalar dışında her yol proxy'den geçer
  for (const host of ["yonetim.laffogato.net", "yonetim.localhost:3000"]) {
    for (const p of yollar.filter((y) => !y.startsWith("/_next/static"))) assert.ok(proxyGirer(host, p), `${host}${p}`);
    assert.ok(!proxyGirer(host, "/_next/static/a.js"));
  }
});

test("YONETIM_URL: yalnız konsolun adlarından biri; panel adresindeki /yonetim yalnız açıkça tanımlıysa yönlenir", () => {
  assert.equal(yonetimUrl({}), "https://yonetim.laffogato.net");
  assert.equal(yonetimUrlAcik({}), null);
  assert.equal(yonetimUrlAcik({ YONETIM_URL: "https://yonetim.laffogato.net/" }), "https://yonetim.laffogato.net");
  assert.equal(yonetimUrlAcik({ YONETIM_URL: "http://yonetim.localhost:3000" }), "http://yonetim.localhost:3000");
  for (const kotu of ["http://yonetim.laffogato.net", "https://ladmin.laffogato.net", "https://kotu.com", "https://u:p@yonetim.laffogato.net", "yonetim.laffogato.net", " "]) {
    assert.equal(yonetimUrlAcik({ YONETIM_URL: kotu }), null, kotu);
    assert.equal(yonetimUrl({ YONETIM_URL: kotu }), "https://yonetim.laffogato.net", kotu);
  }
  assert.equal(yonetimLink("/yonetim/lisans", {}), "https://yonetim.laffogato.net/yonetim/lisans");
  assert.deepEqual(panelYonetimYonlendirmesi("ladmin.laffogato.net", {}), []);
  assert.deepEqual(panelYonetimYonlendirmesi("ladmin.laffogato.net", { YONETIM_URL: "https://ladmin.laffogato.net" }), [], "panelin kendisine yönlenmez");
  const [y] = panelYonetimYonlendirmesi("ladmin.laffogato.net", { YONETIM_URL: "https://yonetim.laffogato.net" });
  assert.deepEqual(y, {
    source: "/yonetim/:path*",
    has: [{ type: "host", value: "ladmin\\.laffogato\\.net" }],
    destination: "https://yonetim.laffogato.net/yonetim/:path*",
    permanent: false,
  });
  assert.match(read("next.config.ts"), /\.\.\.panelYonetimYonlendirmesi\(PANEL_HOST, process\.env\)/);
  assert.match(read(".env.example"), /# YONETIM_URL=https:\/\/yonetim\.laffogato\.net/);
});

test("bağlantılar APP_URL'den (isteğin adresinden değil); Merkez Uzaktan'ın adresinden", () => {
  assert.deepEqual(panelBaglantilari({ APP_URL: "https://ladmin.laffogato.net/" }), {
    ladmin: "https://ladmin.laffogato.net/panel",
    giris: "https://ladmin.laffogato.net/giris",
    parolaUnuttum: "https://ladmin.laffogato.net/giris?parola=unuttum",
  });
  assert.equal(panelBaglantilari({}).ladmin, "https://ladmin.laffogato.net/panel");
  assert.equal(merkezUrl({}), `https://${KANAL_ALANI}/merkez`);
  assert.equal(merkezUrl({ ASILPOS_CLOUD_URL: "https://uzak.ornek.com/" }), "https://uzak.ornek.com/merkez");
  assert.equal(merkezUrl({ [`${ESKI_ENV_ONEKI}CLOUD_URL`]: "https://eski.ornek.com" }), "https://eski.ornek.com/merkez");
  assert.equal(merkezUrl({ ASILPOS_CLOUD_URL: "http://uzak.ornek.com" }), `https://${KANAL_ALANI}/merkez`, "https değilse varsayılan");
  // Giriş sayfası ve kabuk bağlantıları buradan alır
  assert.match(read("src/app/yonetim/giris/page.tsx"), /const p = panelBaglantilari\(\);/);
  assert.match(read("src/app/yonetim/(konsol)/layout.tsx"), /const ladmin = panelBaglantilari\(\)\.ladmin;/);
  assert.match(read("src/app/giris/login-form.tsx"), /params\.get\("parola"\) === "unuttum" \? "forgot" : "login"/);
});

test("kabuk ve sekmeler: panelin kabuğu yok, noindex, iki sekme, her sayfa requireYonetim ister, metinler sabit", () => {
  assert.deepEqual(
    KONSOL_SEKMELERI.map((s) => [s.href, s.label]),
    [
      ["/yonetim", "Şubeler ve kasalar"],
      ["/yonetim/lisans", "Lisans ve güncelleme"],
    ],
  );
  const layout = read("src/app/yonetim/(konsol)/layout.tsx");
  assert.ok(layout.includes("Yönetim konsolu") && layout.includes("ladmin&apos;e git") && layout.includes("Çıkış"));
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
  assert.match(layout, /action=\{yonetimCikisAction\}/);
  assert.ok(!layout.includes("@/components/panel/"), "panelin kabuğundan bileşen yok");
  assert.match(read("src/app/yonetim/giris/page.tsx"), /robots: \{ index: false, follow: false \}/);
  for (const f of ["src/app/yonetim/(konsol)/page.tsx", "src/app/yonetim/(konsol)/lisans/page.tsx"]) assert.match(read(f), /await requireYonetim\(\);/, f);
  // Şubeler ve kasalar: ladmin'deki Şube ekleme ile aynı bileşen, veri ve eylemler
  for (const f of ["src/app/yonetim/(konsol)/page.tsx", "src/app/panel/sube-ekleme/page.tsx"]) {
    const t = read(f);
    assert.ok(t.includes('from "@/components/sube-ekleme/sube-ekleme-client"'), f);
    assert.ok(t.includes("await subeEklemeVerisi()"), f);
    assert.match(t, /createAction=\{createBranch\}\s*installAction=\{sendBranchInstall\}\s*staffAction=\{saveBranchStaff\}\s*releaseAction=\{releaseBranchTill\}/, f);
  }
  const konsolSayfasi = read("src/app/yonetim/(konsol)/page.tsx") + read("src/components/sube-ekleme/sube-ekleme-client.tsx");
  assert.ok(!/["'`>][^"'`<]*ladmin › Şube ekleme/.test(konsolSayfasi), "konsolun metinleri ladmin › Şube ekleme demez");
  assert.equal(LISANS_ACIKLAMA, "Lisans, dükkânlar ve güncelleme gönderme AsilPOS Merkez'de; AsilPOS Uzaktan'daki üye girişinizle girilir, ladmin parolasıyla değil.");
  // Konsolun giriş kartı: sabit iki cümle
  const form = read("src/app/yonetim/giris/giris-form.tsx");
  assert.ok(form.includes("Bu adres yalnız asıl yöneticinin."));
  assert.ok(form.includes("İlk girişte yeni cihaz e-postası gelebilir."));
  // Yeni metinde uzun tire yok
  for (const f of [
    "src/lib/yonetim-host.ts",
    "src/server/actions/yonetim-giris.ts",
    "src/server/sube-ekleme.ts",
    "src/app/yonetim/giris/page.tsx",
    "src/app/yonetim/giris/giris-form.tsx",
    "src/app/yonetim/oturum-bitti/route.ts",
    "src/app/yonetim/(konsol)/layout.tsx",
    "src/app/yonetim/(konsol)/sekmeler.tsx",
    "src/app/yonetim/(konsol)/page.tsx",
    "src/app/yonetim/(konsol)/lisans/page.tsx",
  ]) {
    assert.doesNotMatch(read(f), /[–—]/, f);
  }
});

test("konsol girişi: yalnız konsol çerezi; parola, kod ve belirteç günlüğe yazılmaz", () => {
  const eylem = read("src/server/actions/yonetim-giris.ts");
  assert.ok(!eylem.includes("startSession("), "panel oturumu açılmaz");
  assert.match(eylem, /await startYonetimSession\(user\);/);
  assert.doesNotMatch(eylem, /console\.(log|info|warn|error)\([^)]*\b(password|code|token)\b/);
  // Asıl yönetici dışındaki adres: hesap hiç okunmaz, hayalet deneme
  assert.match(eylem, /isAnaAdminEmail\(email\) \? await getDb\(\)/);
  assert.match(eylem, /if \(!user \|\| !user\.active \|\| !isAnaAdmin\(user\)\) \{\s*const g = await ghostAttempt\(email, password\);/);
});

test("iki oturum türü birbirini reddeder: panel belirteci konsolu, konsol belirteci paneli açmaz; iki adım belirteçleri de ayrı", async () => {
  const ss = await import("../src/server/auth/session");
  const kisi = { sub: "7", name: "Asıl", role: "admin" as const, sv: 1 };
  const panel = await ss.signSession(kisi);
  const konsol = await ss.signYonetim(kisi);
  assert.equal((await ss.verifySession(panel))?.sub, "7");
  assert.equal((await ss.verifyYonetim(konsol))?.sub, "7");
  assert.equal(await ss.verifySession(konsol), null, "konsol belirteci panel oturumu değil");
  assert.equal(await ss.verifyYonetim(panel), null, "panel belirteci konsol oturumu değil");
  const panelBekleyen = await ss.signPending({ sub: "7", sv: 1 });
  const konsolBekleyen = await ss.signYonetimPending({ sub: "7", sv: 1 });
  assert.deepEqual(await ss.verifyYonetimPending(konsolBekleyen), { sub: "7", sv: 1 });
  assert.equal(await ss.verifyYonetimPending(panelBekleyen), null);
  assert.equal(await ss.verifyPending(konsolBekleyen), null);
  for (const t of [konsolBekleyen, panelBekleyen]) {
    assert.equal(await ss.verifySession(t), null);
    assert.equal(await ss.verifyYonetim(t), null);
  }
  // Ayrı çerezler, __Host- önekli (yerelde öneksiz)
  assert.notEqual(ss.YONETIM_COOKIE, ss.SESSION_COOKIE);
  assert.match(ss.YONETIM_COOKIE, /laf_yonetim$/);
  assert.notEqual(ss.YONETIM_PENDING_COOKIE, ss.YONETIM_COOKIE);
});
