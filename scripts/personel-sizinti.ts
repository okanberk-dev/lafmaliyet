// Personel sızıntı denetimi, çalışan sunucuya karşı (plan docs/planlar/personel-yetki.md §6.2). CI'da koşmaz; dalga
// birleşmeden önce elle çalıştırılır.
//
// Yerel `next dev` (ya da bir önizleme) ve bir personel hesabının oturum çerezi verilir. Betik personelin ekranlarının
// hem HTML'ini hem RSC yükünü (`RSC: 1`) çeker ve her yanıtta maliyet / tutar anahtarlarını (tests/helpers/leak-scan.ts
// › COST_KEYS) arar; ₺'yi yalnız tutar göstermemesi gereken ekranlarda arar. Kasa sayfaları (personelin kendi yazdığı
// sayılar, herkese açık satış fiyatı), Bugün (kasa farkı) ve reçete defteri (satış fiyatı) ₺ gösterebilir. Yöneticinin
// adresleri personel çereziyle Bugün'e dönmelidir. Bir şey tutmazsa çıkış kodu 1.
//
// Çalıştırma:
//   PERSONEL_COOKIE='laf_session=…' npx tsx scripts/personel-sizinti.ts [http://localhost:3176]
// Çerez: personel hesabıyla girişten sonra tarayıcının geliştirici araçlarında (Application › Cookies) panelin
// çerezleri (yerelde laf_session, https'te __Host-laf_session); "ad=değer; ad=değer" biçiminde hepsi verilebilir.
// Anlamlı bir tarama için ekranlarda veri olmalı: bekleyen istekler, taslak, tükenen ürün, kasa raporları, zayi.

import { businessDate } from "../src/lib/cash-report";
import { addDays } from "../src/lib/reminders";
import { COST_KEYS, OKC_ADMIN_KEYS } from "../tests/helpers/leak-scan";

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3176").replace(/\/+$/, "");
const COOKIE = process.env.PERSONEL_COOKIE ?? "";

const today = businessDate(new Date());
const yesterday = addDays(today, -1);
const fiveAgo = addDays(today, -5);

/** Personelin ekranları; `lira: false` olanlarda ₺ yasak */
const STAFF_PAGES: { path: string; lira: boolean }[] = [
  { path: "/panel/bugun", lira: true },
  { path: "/panel/karaoke", lira: false },
  { path: "/panel/kasa", lira: true },
  { path: `/panel/kasa?gun=${yesterday}`, lira: true },
  { path: `/panel/kasa?gun=${fiveAgo}`, lira: true },
  { path: "/panel/kasa/fiyatlar", lira: true },
  { path: "/panel/kontrol/gecmis", lira: false },
  { path: `/panel/zayi?gun=${fiveAgo}`, lira: false },
  { path: "/panel/hizli-sayim", lira: false },
  // Stok sayımı: FIFO katmanları ve fiyatlar yalnız yöneticiye (havuzun `unitCost`u, ₺; docs/STOK-DEGERLEME.md)
  { path: "/panel/sayim", lira: false },
  { path: "/panel/hizli-sayim/siparis", lira: false },
  { path: "/panel/ozel-gunler", lira: false },
  { path: "/panel/yardim/personel", lira: false },
  { path: "/panel/receteler", lira: true },
  { path: "/panel/hatirlaticilarim", lira: true },
];

/** Personel çereziyle Bugün'e dönmesi gereken yönetici adresleri */
const ADMIN_PAGES = ["/panel/onaylar", "/panel/urunler/fiyatlar", "/panel/mal-siparisi", "/panel/kontrol/duzenle", "/panel/tahmin", "/panel/yardim"];

/** JSON anahtarı olarak (HTML'deki RSC parçalarında tırnaklar kaçışlı: \"cost\":) */
const KEY_RE = new RegExp(`(?:^|[^A-Za-z0-9_$])\\\\?"(${COST_KEYS.join("|")})\\\\?"\\s*:`, "g");
const LIRA_RE = /₺|\\u20ba/i;
/** Kasa sayfalarında yazarkasa Z'sinin yönetici anahtarları da (kümülatif, toplam dışı tahsilat; okc-z.md D17) */
const OKC_RE = new RegExp(`(?:^|[^A-Za-z0-9_$])\\\\?"(${OKC_ADMIN_KEYS.join("|")})\\\\?"\\s*:`, "g");

function costKeys(body: string): string[] {
  return [...new Set([...body.matchAll(KEY_RE)].map((m) => m[1]))];
}

/** Bulunan yerin çevresi (rapor için) */
function around(body: string, re: RegExp): string {
  const m = new RegExp(re.source, re.flags.replace("g", "")).exec(body);
  if (!m) return "";
  return body.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, " ");
}

async function fetchPage(path: string, rsc: boolean): Promise<Response> {
  const headers: Record<string, string> = { cookie: COOKIE };
  if (rsc) headers.RSC = "1";
  const res = await fetch(BASE + path, { headers, redirect: "manual" });
  // RSC isteği `_rsc` önbellek anahtarı olmadan gelirse Next aynı adrese `?_rsc=<özet>` ile 307 döner
  // (node_modules/next/dist/docs/01-app/02-guides/cdn-caching.md); yalnız o yönlendirme bir kez izlenir.
  const to = res.headers.get("location");
  if (rsc && res.status === 307 && to) {
    const next = new URL(to, BASE);
    if (next.pathname === new URL(path, BASE).pathname && next.searchParams.has("_rsc")) {
      return fetch(next.href, { headers, redirect: "manual" });
    }
  }
  return res;
}

async function main() {
  if (!COOKIE) {
    console.error("PERSONEL_COOKIE gerekli (personel hesabının oturum çerezi). Ayrıntı dosyanın başında.");
    process.exit(2);
  }
  const failures: string[] = [];
  let checked = 0;

  // Çerez gerçekten personel mi: Bugün açılır, yöneticinin ana sayfası açılmaz
  const home = await fetchPage("/panel", false);
  const homeTo = home.headers.get("location") ?? "";
  if (!(home.status >= 300 && home.status < 400 && homeTo.includes("/panel/bugun"))) {
    console.error(`Çerez personelin değil ya da geçersiz: /panel → ${home.status} ${homeTo}`);
    process.exit(2);
  }

  for (const p of STAFF_PAGES) {
    for (const rsc of [false, true]) {
      const label = `${p.path} (${rsc ? "RSC" : "HTML"})`;
      const res = await fetchPage(p.path, rsc);
      if (res.status !== 200) {
        failures.push(`${label}: durum ${res.status} ${res.headers.get("location") ?? ""}`);
        continue;
      }
      const body = await res.text();
      checked++;
      const keys = costKeys(body);
      if (p.path.startsWith("/panel/kasa")) keys.push(...new Set([...body.matchAll(OKC_RE)].map((m) => m[1])));
      if (keys.length) failures.push(`${label}: yasak anahtar ${keys.join(", ")} · …${around(body, KEY_RE)}…`);
      if (!p.lira && LIRA_RE.test(body)) failures.push(`${label}: ₺ var · …${around(body, LIRA_RE)}…`);
      console.log(`${keys.length || (!p.lira && LIRA_RE.test(body)) ? "✗" : "✓"} ${label} · ${Math.round(body.length / 1024)} KB`);
    }
  }

  for (const path of ADMIN_PAGES) {
    const res = await fetchPage(path, false);
    const to = res.headers.get("location") ?? "";
    const ok = res.status >= 300 && res.status < 400 && new URL(to, BASE).pathname === "/panel/bugun";
    if (!ok) failures.push(`${path}: personel Bugün'e dönmedi (${res.status} ${to})`);
    console.log(`${ok ? "✓" : "✗"} ${path} → ${res.status} ${to}`);
  }

  console.log(`\n${checked} yanıt tarandı, ${ADMIN_PAGES.length} yönetici adresi denendi.`);
  if (failures.length) {
    console.error(`\n${failures.length} sorun:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("Sızıntı yok.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
