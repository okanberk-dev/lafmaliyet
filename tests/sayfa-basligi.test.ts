// Sayfa başlığı ve bir ekran bir ad (docs/planlar/ux-sade.md §3.6-§3.8): bağlam satırı ağaçtan türer ve telefonda gizli,
// başlıkta "Excel: …" yok, her başlık adresini verir; kenar çubuğu, H1, sekme başlığı ve paletin adı aynı; paletin kare
// adresli kayıtları var olan bir çapaya iner. (§8'in açıklama uzunluğu denetimi açıklamalar kısalınca eklenir.)
// Çalıştırma: npx tsx --test tests/sayfa-basligi.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { mobileTitleFor, NAV_FOOTER, NAV_GROUPS, navTreeFor } from "../src/components/panel/nav";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** src/app/panel altındaki bütün .tsx dosyaları */
function panelFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx")) out.push(p);
    }
  };
  walk("src/app/panel");
  return out;
}

test("başlıkta elle bağlam ve Excel yok: eyebrow ve excel prop'ları kalktı, bağlam satırı ağaçtan ve telefonda gizli", () => {
  for (const f of panelFiles()) {
    const src = read(f);
    assert.doesNotMatch(src, /\beyebrow=/, f);
    assert.doesNotMatch(src, /<PageHeader[^>]*\bexcel=/, f);
  }
  const header = read("src/components/panel/page-header.tsx");
  assert.doesNotMatch(header, /EYEBROW_ALIAS|Excel: /);
  assert.match(header, /groupLabelOf\(path, role\)/);
  // Bağlam satırı yalnız masaüstünde (telefonda üst çubuk ekranın adını zaten yazar)
  assert.match(header, /\{group \? <p className="[^"]*\bmax-sm:hidden\b[^"]*">\{group\}<\/p> : null\}/);
  // "Nasıl çalışır?" ⓘ ve tek satırlık meta
  assert.match(header, /<InfoTip text=\{more\} label="Nasıl çalışır\?" \/>/);
});

test("her sayfa başlığı adresini verir (bağlam satırı ondan); iki rolün açtığı sayfada rol de", () => {
  let n = 0;
  for (const f of panelFiles()) {
    const src = read(f);
    for (const m of src.matchAll(/<PageHeader\b([\s\S]*?)\/>/g)) {
      n++;
      assert.match(m[1], /\bpath=/, `${f}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.ok(n > 60, `${n} başlık`);
  // Vergi'nin ortak başlığı bulunulan sekmenin adresini verir
  assert.match(read("src/app/panel/vergi/ui.tsx"), /<PageHeader path=\{current\}/);
  // İki rolün açtığı ve bağlamı role göre değişen sayfalar: yüklenirken personelin (en dar), yüklenince kullanıcının rolü
  for (const p of ["karaoke", "hatirlaticilarim", "receteler", "kontrol"]) {
    const src = read(`src/app/panel/${p}/page.tsx`);
    assert.match(src, /role="staff"/, `${p}: yükleme başlığı`);
    assert.match(src, /role=\{user\.role\}/, `${p}: yüklenen başlık`);
  }
});

test("bir ekran bir ad: kenar çubuğu, H1, sekme başlığı, palet ve telefon (yalnız kısaltır)", () => {
  // [adres, kenar çubuğu, H1 (ve metadata.title), palet, telefon]
  const TABLE: [string, string, string, string, string][] = [
    ["/panel/urunler", "Ürünler & kârlılık", "Ürünler & kârlılık", "Ürünler & kârlılık", "Ürünler"],
    ["/panel/urunler/fiyatlar", "Fiyatlar", "Fiyatlar", "Fiyatlar", "Fiyatlar"],
    ["/panel/tutarlilik", "Tutarlılık", "Tutarlılık", "Tutarlılık", "Tutarlılık"],
    ["/panel/personel", "Giderler & maaşlar", "Maaşlar", "Maaşlar", "Maaşlar"],
    ["/panel/hatirlaticilar", "Ödemeler", "Ödemeler", "Ödemeler", "Ödemeler"],
    ["/panel/hatirlaticilar/nakit", "Nakit planı", "Nakit planı", "Nakit planı", "Nakit planı"],
    ["/panel/vergi", "Özet", "Vergi, KDV, SGK", "Vergi, KDV, SGK", "Vergi, KDV, SGK"],
    ["/panel/vergi/gelir-gider", "Vergi kârı", "Vergi kârı", "Vergi kârı", "Vergi kârı"],
    ["/panel/vergi/demirbas", "Demirbaş", "Demirbaş", "Demirbaş", "Demirbaş"],
    ["/panel/vergi/kurallar", "Muhasebeci", "Muhasebeci", "Muhasebeci", "Muhasebeci"],
  ];
  const tree = navTreeFor("admin");
  const palette = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];
  for (const [href, side, h1, cmd, phone] of TABLE) {
    const row = tree.flatMap((n) => n.children ?? []).find((c) => c.href === href || c.match?.includes(href));
    assert.equal(row?.label, side, `${href} kenar çubuğu`);
    assert.equal(palette.find((i) => i.href === href)?.label, cmd, `${href} palet`);
    assert.equal(mobileTitleFor(href), phone, `${href} telefon`);
    const page = read(`src/app${href}/page.tsx`);
    assert.match(page, new RegExp(`export const metadata: Metadata = \\{ title: "${h1}" \\};`), `${href} metadata.title`);
  }
  // H1'ler: sabit ya da doğrudan başlıkta
  assert.match(read("src/app/panel/tutarlilik/page.tsx"), /const TITLE = "Tutarlılık";/);
  assert.match(read("src/app/panel/personel/page.tsx"), /title="Maaşlar"/);
  assert.match(read("src/app/panel/hatirlaticilar/reminders-client.tsx"), /title="Ödemeler"/);
  assert.match(read("src/app/panel/vergi/page.tsx"), /title="Vergi, KDV, SGK"/);
  assert.match(read("src/app/panel/vergi/gelir-gider/page.tsx"), /const TITLE = "Vergi kârı";/);
  assert.match(read("src/app/panel/vergi/demirbas/page.tsx"), /const TITLE = "Demirbaş";/);
  assert.match(read("src/app/panel/vergi/kurallar/page.tsx"), /const TITLE = "Muhasebeci";/);
  // Ödemeler ↔ Nakit planı sekmeyle bağlı; Ödemeler başlığındaki "Nakit planı" düğmesi kalktı (K7)
  const reminders = read("src/app/panel/hatirlaticilar/reminders-client.tsx");
  assert.match(reminders, /<SectionTabs section="odeme" current="\/panel\/hatirlaticilar" role="admin" \/>/);
  assert.doesNotMatch(reminders, /href="\/panel\/hatirlaticilar\/nakit"/);
  assert.match(read("src/app/panel/hatirlaticilar/nakit/cash-plan-client.tsx"), /<SectionTabs section="odeme" current="\/panel\/hatirlaticilar\/nakit" role="admin" \/>/);
});

test("paletin kare adresli her kaydı var olan bir çapaya iner", () => {
  // Çapa → onu taşıyan dosya ve kaynaktaki biçimi
  const ANCHORS: Record<string, [string, RegExp]> = {
    "/panel/vergi#kdv": ["src/app/panel/vergi/tax-calendar.tsx", /kdv1: "kdv"/],
    "/panel/vergi#sgk": ["src/app/panel/vergi/tax-calendar.tsx", /sgk: "sgk"/],
    "/panel/vergi#muhtasar": ["src/app/panel/vergi/tax-calendar.tsx", /mphb: "muhtasar"/],
    "/panel/vergi#kar-vergisi": ["src/app/panel/vergi/page.tsx", /id="kar-vergisi"/],
    "/panel/vergi/gelir-gider#siniflandir": ["src/app/panel/vergi/gelir-gider/classify-list.tsx", /id="siniflandir"/],
    "/panel/vergi/kurallar#sorular": ["src/app/panel/vergi/kurallar/page.tsx", /id="sorular"/],
    "/panel/gelir-gider#kar-zarar": ["src/app/panel/gelir-gider/page.tsx", /id="kar-zarar"/],
    "/panel/personel#sgk-oranlari": ["src/app/panel/personel/staff-editor.tsx", /const RATES_ANCHOR = "sgk-oranlari";/],
    "/panel/ayarlar#oranlar": ["src/app/panel/ayarlar/sections.ts", /id: "oranlar"/],
    "/panel/ayarlar#gecmis": ["src/app/panel/ayarlar/sections.ts", /id: "gecmis"/],
    "/panel/ayarlar#yedek": ["src/app/panel/ayarlar/sections.ts", /id: "yedek"/],
    "/panel/parasut#urun-baglantilari": ["src/app/panel/parasut/breakdowns.ts", /export const LINKS_ID = "urun-baglantilari";/],
  };
  const hashed = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((i) => i.href.includes("#")).map((i) => i.href);
  assert.deepEqual([...hashed].sort(), Object.keys(ANCHORS).sort());
  for (const [href, [file, re]] of Object.entries(ANCHORS)) assert.match(read(file), re, href);
  // Takvimde çapa türün ilk satırında; satır kapalı kalır, halkayla belirir
  const cal = read("src/app/panel/vergi/tax-calendar.tsx");
  assert.match(cal, /<li id=\{anchor\} className=\{anchor \? "scroll-mt-20 target:ring-2 target:ring-ink\/20 target:ring-inset" : undefined\}>/);
  // SGK oranları bölümü adres çapası olunca açık başlar (Ayarlar'ın bölüm deseni)
  const staff = read("src/app/panel/personel/staff-editor.tsx");
  assert.match(staff, /window\.location\.hash !== `#\$\{RATES_ANCHOR\}`/);
  assert.match(staff, /window\.addEventListener\("hashchange", fromHash\)/);
  // Karaoke bağlantı kartının çapası (uyarının eylemi buraya iner)
  assert.match(read("src/app/panel/karaoke/karaoke-admin.tsx"), /<Card id="baglanti" className="scroll-mt-20">/);
  // Başka sayfadan gelen çapa: sayfa sunucudan sonradan aktığı için Next'in kaydırması hedefi bulamayabilir; hedef
  // sayfanın akan içeriği çizilince kendisi iner (HashScroll ya da bölümün kendi hash dinleyicisi)
  const LANDS: Record<string, [string, RegExp]> = {
    "/panel/vergi": ["src/app/panel/vergi/page.tsx", /<HashScroll key=\{`capa-\$\{year\}`\} \/>/],
    "/panel/vergi/gelir-gider": ["src/app/panel/vergi/gelir-gider/page.tsx", /<HashScroll key=\{`capa-\$\{q\.key\}`\} \/>/],
    "/panel/vergi/kurallar": ["src/app/panel/vergi/kurallar/page.tsx", /<HashScroll \/>/],
    "/panel/gelir-gider": ["src/app/panel/gelir-gider/page.tsx", /<HashScroll key=\{`capa-\$\{year\}`\} \/>/],
    "/panel/personel": ["src/app/panel/personel/staff-editor.tsx", /window\.addEventListener\("hashchange", fromHash\)/],
    "/panel/ayarlar": ["src/app/panel/ayarlar/section-card.tsx", /window\.location\.hash !== `#\$\{id\}`/],
    "/panel/parasut": ["src/app/panel/parasut/page.tsx", /<HashScroll \/>/],
  };
  assert.deepEqual([...new Set(hashed.map((h) => h.split("#")[0]))].sort(), Object.keys(LANDS).sort());
  for (const [path, [file, re]] of Object.entries(LANDS)) assert.match(read(file), re, path);
});
