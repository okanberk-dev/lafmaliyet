// Sayfa başlığı ve bir ekran bir ad (docs/planlar/ux-sade.md §3.6-§3.8): bağlam satırı ağaçtan türer ve telefonda gizli,
// başlıkta "Excel: …" yok, her başlık adresini verir; kenar çubuğu, H1, sekme başlığı ve paletin adı aynı; paletin kare
// adresli kayıtları var olan bir çapaya iner; §8'in yeni açıklamaları tek cümle, en çok 100 harf (Bölüm 3), eski uzun
// metin "Nasıl çalışır?" ⓘ'sinde (`more`).
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
  // Grubun adını taşıyan giriş ekranında (Vergi, KDV, SGK; Ayarlar) satır başlığı tekrarlamaz (contextLineOf)
  assert.match(header, /const group = path \? contextLineOf\(path, role, title\) : undefined;/);
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
    // Bölüm 3: çapa "Şirketin kâr vergisi" kartının kendisinde (docs/planlar/ux-sade.md §7.6)
    "/panel/vergi#kar-vergisi": ["src/app/panel/vergi/tax-cards.tsx", /<Card id="kar-vergisi"/],
    "/panel/vergi/gelir-gider#siniflandir": ["src/app/panel/vergi/gelir-gider/classify-list.tsx", /id="siniflandir"/],
    "/panel/vergi/kurallar#sorular": ["src/app/panel/vergi/kurallar/page.tsx", /id="sorular"/],
    "/panel/gelir-gider#kar-zarar": ["src/app/panel/gelir-gider/page.tsx", /id="kar-zarar"/],
    "/panel/personel#sgk-oranlari": ["src/app/panel/personel/staff-editor.tsx", /const RATES_ANCHOR = "sgk-oranlari";/],
    "/panel/ayarlar#oranlar": ["src/app/panel/ayarlar/sections.ts", /id: "oranlar"/],
    // Koyu tema seçimi (docs/KOYU-TEMA.md)
    "/panel/ayarlar#gorunum": ["src/app/panel/ayarlar/sections.ts", /id: "gorunum"/],
    "/panel/ayarlar#gecmis": ["src/app/panel/ayarlar/sections.ts", /id: "gecmis"/],
    "/panel/ayarlar#yedek": ["src/app/panel/ayarlar/sections.ts", /id: "yedek"/],
    "/panel/parasut#urun-baglantilari": ["src/app/panel/parasut/breakdowns.ts", /export const LINKS_ID = "urun-baglantilari";/],
  };
  const hashed = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].filter((i) => i.href.includes("#")).map((i) => i.href);
  assert.deepEqual([...hashed].sort(), Object.keys(ANCHORS).sort());
  for (const [href, [file, re]] of Object.entries(ANCHORS)) assert.match(read(file), re, href);
  // Takvimde çapa türün ilk satırında; satır kapalı kalır, halkayla belirir
  const cal = read("src/app/panel/vergi/tax-calendar.tsx");
  // Halka iki yoldan: :target (adres çubuğu, aynı sayfada ⌘K) ve HashScroll'un işareti (uygulamanın içinden gelince:
  // Next pushState'le gezer, :target boş kalır)
  assert.match(cal, /<li\s+id=\{anchor\}\s+className=\{\s*anchor\s*\?\s*"scroll-mt-20 target:ring-2 target:ring-ink\/20 target:ring-inset data-\[hash-hit\]:ring-2 data-\[hash-hit\]:ring-ink\/20 data-\[hash-hit\]:ring-inset"/);
  const hashScroll = read("src/components/panel/hash-scroll.tsx");
  assert.match(hashScroll, /export const HASH_HIT_ATTR = "data-hash-hit";/);
  assert.match(hashScroll, /hit\?\.removeAttribute\(HASH_HIT_ATTR\);[\s\S]*hit\?\.setAttribute\(HASH_HIT_ATTR, ""\);/);
  // Aynı sayfada başka çapaya geçilince işaret taşınır; sayfa gizlenince (Next'in sakladığı kopya) silinir
  assert.match(hashScroll, /window\.addEventListener\("hashchange", onHash\);/);
  assert.match(hashScroll, /return \(\) => \{[\s\S]*hit\?\.removeAttribute\(HASH_HIT_ATTR\);\s*\};/);
  // SGK oranları bölümü adres çapası olunca açık başlar ve açılış işlendikten sonra iner (Ayarlar'ın bölüm deseni):
  // kapalı bölümle sayfa kısa kalır, eskiden kaydırma alt sınırda kırpılıyordu (bölümün üstü ekranın altında)
  const staff = read("src/app/panel/personel/staff-editor.tsx");
  assert.match(staff, /window\.location\.hash !== `#\$\{RATES_ANCHOR\}`/);
  assert.match(staff, /window\.addEventListener\("hashchange", fromHash\)/);
  assert.match(staff, /setRatesOpen\(true\);\s*setHashHits\(\(n\) => n \+ 1\);/);
  assert.match(staff, /if \(!hashHits \|\| !ratesRef\.current\) return;\s*return pinSection\(ratesRef\.current\);/);
  assert.doesNotMatch(staff, /ratesRef\.current\?\.scrollIntoView/);
  const section = read("src/app/panel/ayarlar/section-card.tsx");
  assert.match(section, /if \(!hashHits \|\| !ref\.current\) return;\s*return pinSection\(ref\.current\);/);
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

test("eski adlar ekranda kalmadı: Muhasebeci (eski Kurallar sekmesi), Maaşlar (eski Personel), Giderler & maaşlar", () => {
  // [dosya, eski metin, yeni metin]
  const RENAMED: [string, string, string][] = [
    // Bölüm 3: kartın adı "Şirketin vergi ayarları" (docs/planlar/ux-sade.md §7.9)
    ["src/lib/tax/corporate.ts", "(Kurallar › Vergi ayarları)", "(Muhasebeci › Şirketin vergi ayarları)"],
    ["src/app/panel/vergi/demirbas/page.tsx", "(Kurallar › Vergi ayarları)", "(Muhasebeci › Şirketin vergi ayarları)"],
    ["src/app/panel/vergi/demirbas/page.tsx", "(Giderler &amp; personel)", "(Giderler &amp; maaşlar)"],
    ["src/app/panel/vergi/gelir-gider/page.tsx", "Kurallar › Vergi ayarları'ndan", "Muhasebeci › Şirketin vergi ayarları'ndan"],
    ["src/app/panel/giderler/expenses-client.tsx", ">Personel sayfasından</TD>", ">Maaşlar sayfasından</TD>"],
    ["src/app/panel/giderler/expenses-client.tsx", 'label="Personel sayfasına git"', 'label="Maaşlar sayfasına git"'],
    ["src/app/panel/giderler/expenses-client.tsx", "</Badge> Personel sayfasından", "</Badge> Maaşlar sayfasından"],
    ["src/app/panel/gelir-gider/row-links.ts", 'label: "Personel", scope: "row"', 'label: "Maaşlar", scope: "row"'],
    ["src/lib/tax/pnl.ts", "\"Personel'e ekleyin\"", "\"Maaşlar'a ekleyin\""],
    ["src/lib/tax/rules.ts", "\"Bordroda (Personel'e ekleyin)\"", "\"Bordroda (Maaşlar'a ekleyin)\""],
  ];
  for (const [file, before, after] of RENAMED) {
    const text = read(file);
    assert.ok(!text.includes(before), `${file}: ${before}`);
    assert.ok(text.includes(after), `${file}: ${after}`);
  }
});

/**
 * §8 tablosunda açıklaması yenilenen ekranlar (docs/planlar/ux-sade.md §3.11, Ek C 6): dosyadaki `*DESCRIPTION*`
 * sabitlerinin, `description="…"` düz metinlerinin ve `description={…}` ifadesindeki düz dizelerin hepsi ≤ 100 harf.
 * "aynı" kalanlar (Onaylar, Kasadaki fiyatlar, Kontrol geçmişi ve düzenleme, Özel günler, Hesabım, personelin Yardım'ı,
 * Nakit planı, Sayım, Bugün, ürün kartı) listede yok; dinamik açıklamalar sayılmaz
 */
const NEW_DESCRIPTIONS: readonly string[] = [
  "src/app/panel/kasa/page.tsx",
  "src/app/panel/karaoke/page.tsx",
  "src/app/panel/karaoke/doluluk/page.tsx",
  "src/app/panel/kontrol/page.tsx",
  "src/app/panel/hatirlaticilarim/page.tsx",
  "src/app/panel/urunler/page.tsx",
  "src/app/panel/urunler/fiyatlar/page.tsx",
  "src/app/panel/urunler/site/page.tsx",
  "src/app/panel/hammaddeler/page.tsx",
  "src/app/panel/receteler/page.tsx",
  "src/app/panel/zayi/page.tsx",
  "src/app/panel/tutarlilik/page.tsx",
  "src/app/panel/satislar/page.tsx",
  "src/app/panel/komisyonlar/page.tsx",
  "src/app/panel/analiz/page.tsx",
  "src/app/panel/faturalar/page.tsx",
  "src/app/panel/tedarikciler/page.tsx",
  "src/app/panel/giderler/page.tsx",
  "src/app/panel/harcamalar/page.tsx",
  "src/app/panel/personel/page.tsx",
  "src/app/panel/gelir-gider/page.tsx",
  "src/app/panel/hatirlaticilar/page.tsx",
  "src/app/panel/hatirlaticilar/reminders-client.tsx",
  "src/app/panel/vergi/ui.tsx",
  "src/app/panel/vergi/gelir-gider/page.tsx",
  "src/app/panel/vergi/demirbas/page.tsx",
  "src/app/panel/vergi/kurallar/page.tsx",
  "src/app/panel/ayarlar/page.tsx",
  "src/app/panel/kullanicilar/page.tsx",
  "src/app/panel/parasut/page.tsx",
  "src/app/panel/parasut/parasut-client.tsx",
  "src/app/panel/yardim/page.tsx",
];

/** Başlık öğesinin (`<PageHeader`, `<VergiHeader`, yerel `<Header`) öznitelik metni: süslü parantez derinliği 0'daki ilk `>` */
function headerAttrs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<(?:PageHeader|VergiHeader|Header)\b/g)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push(src.slice(m.index! + m[0].length, i));
  }
  return out;
}

/** Dosyadaki sayfa açıklaması dizeleri: `*DESCRIPTION*` sabitleri (Record dahil) ve başlık öğesinin `description`'ı (düz
 * metin ya da ifadedeki düz dizeler). Kartların `description`'ı (CardHeader) sayılmaz: yalnız sayfanın başlığı */
function descriptionStrings(src: string): string[] {
  const out: string[] = [];
  const lit = /"((?:[^"\\\n]|\\.)*)"/g;
  // `const X_DESCRIPTION… = …;` (Satışlar'ın Record'u dahil): ifadenin içindeki bütün düz dizeler
  for (const m of src.matchAll(/const \w*DESCRIPTION\w*\s*(?::[^=]+)?=([\s\S]*?);\n/g)) for (const x of m[1].matchAll(lit)) out.push(x[1]);
  for (const attrs of headerAttrs(src)) {
    for (const m of attrs.matchAll(/\bdescription="([^"]*)"/g)) out.push(m[1]);
    // description={…} (iç içe süslü parantez yok): üçlü ifadelerin dalları
    for (const m of attrs.matchAll(/\bdescription=\{([^{}]*)\}/g)) for (const x of m[1].matchAll(lit)) out.push(x[1]);
  }
  return out;
}

test("§8: yeni açıklamalar tek cümle, en çok 100 harf; eski uzun metin ⓘ'de", () => {
  const long: string[] = [];
  for (const f of NEW_DESCRIPTIONS) {
    const strings = descriptionStrings(read(f));
    assert.ok(strings.length > 0, `${f}: açıklama bulunamadı`);
    for (const s of strings) if ([...s].length > 100) long.push(`${f}: ${[...s].length} · ${s.slice(0, 60)}`);
  }
  assert.deepEqual(long, []);
  // Örnekler (metin aynen)
  assert.match(read("src/app/panel/vergi/ui.tsx"), /export const OZET_DESCRIPTION = "Devlete ödenecekler: KDV, SGK, maaş vergileri ve kâr vergisi; tahmini tutar ve son gün\.";/);
  assert.match(read("src/app/panel/zayi/page.tsx"), /description="Atılan, bozulan \(zayi\) ve ödenmeden verilen \(ikram\) ürünleri girin\."/);
  assert.doesNotMatch(read("src/app/panel/zayi/page.tsx"), /Tutarlılık ekranı/, "personel Tutarlılık'ı açamaz");
  // Yöneticinin "Nasıl çalışır?"u: başlıkta ⓘ; personelin ekranında yönetici kavramı içeren `more` yok
  const header = read("src/components/panel/page-header.tsx");
  assert.match(header, /<InfoTip text=\{more\} label="Nasıl çalışır\?" \/>/);
  assert.match(read("src/app/panel/karaoke/page.tsx"), /more=\{role === "admin" \? MORE : undefined\}/);
  const kasa = read("src/app/panel/kasa/page.tsx");
  // Personel: AsilPOS'un otomatik gününde yalnız fotoğrafı isteyen cümle (ASILPOS_STAFF_DESCRIPTION), öteki günlerde eskisi
  assert.match(kasa, /if \(!can\(user\.role, "kasa\.rakam"\)\) return \(await staffAsilposDescription\(searchParams\)\) \?\? STAFF_DESCRIPTION;/);
  for (const f of ["src/app/panel/receteler/page.tsx", "src/app/panel/kontrol/page.tsx", "src/app/panel/zayi/page.tsx", "src/app/panel/hatirlaticilarim/page.tsx"]) assert.doesNotMatch(read(f), /\bmore=/, f);
});
