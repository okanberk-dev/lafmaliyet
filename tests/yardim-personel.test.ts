// Personelin Yardım'ı (plan docs/planlar/personel-yetki.md §2.10): erişim, personelin menü yolları (staffPathOf),
// yöneticinin Yardım'ından yalıtım, bağlantılar, kapsam (her personel ekranı ve onaya giden her tür), yasak sözcükler
// ve yönetici etiketleri. Çalıştırma: npx tsx --test tests/yardim-personel.test.ts

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { textOf } from "../src/app/panel/yardim/faq-build";
import { staffPathOf } from "../src/app/panel/yardim/nav-paths";
import { STAFF_FAQ_GROUPS, STAFF_ROUTINE, staffPathText } from "../src/app/panel/yardim/personel/content";
import { BOTTOM_NAV, NAV_FOOTER, NAV_GROUPS, NAV_TREE, SECTION_TABS, mobileTitleFor } from "../src/components/panel/nav";
import { canOpen, STAFF_PATHS } from "../src/lib/roles";
import { CHANGE_LABELS, SENSITIVE } from "../src/lib/cash-report";
import { OKC_PREFILL_ENABLED } from "../src/lib/okc-z";
import { STAFF_APPROVAL_KINDS } from "../src/lib/staff-requests";

const DIR = join(process.cwd(), "src/app/panel/yardim");
const read = (p: string) => readFileSync(join(DIR, p), "utf8");
const STAFF_PAGE = read("personel/page.tsx");
const CONTENT = read("personel/content.tsx");
const BUILD = read("faq-build.tsx");
const ADMIN_PAGE = read("page.tsx");

const fold = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Her sorunun ve her adımın düz metni (StaffPath menüdeki adlarla) */
const FAQ_TEXTS = STAFF_FAQ_GROUPS.flatMap((g) =>
  g.items.map((f) => ({ group: g.title, id: f.id, text: `${g.title} ${f.q} ${textOf(f.a, staffPathText)} ${f.links?.map((l) => l.label).join(" ") ?? ""}` })),
);
const ROUTINE_TEXTS = STAFF_ROUTINE.map((r) => `${r.title} ${textOf(r.body, staffPathText)}`);
const ALL_TEXT = [...FAQ_TEXTS.map((t) => t.text), ...ROUTINE_TEXTS].join("\n");

/** Sayfanın ve içeriğin bütün iç bağlantıları: StaffPath, adım ve soru bağlantıları */
const HREFS = [
  ...new Set([
    ...[...CONTENT.matchAll(/<StaffPath href="([^"]+)"/g)].map((m) => m[1]),
    ...[...CONTENT.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]),
    ...STAFF_ROUTINE.map((r) => r.href),
    ...STAFF_FAQ_GROUPS.flatMap((g) => g.items.flatMap((f) => f.links?.map((l) => l.href) ?? [])),
  ]),
];

test("erişim: personel kendi Yardım'ını açar, yöneticinin Yardım'ını açamaz; yönetici ikisini de", () => {
  assert.ok(canOpen("staff", "/panel/yardim/personel"));
  assert.equal(canOpen("staff", "/panel/yardim"), false);
  assert.ok(canOpen("admin", "/panel/yardim/personel"));
  assert.ok(canOpen("admin", "/panel/yardim"));
});

test("staffPathOf: personelin menüsündeki adlar; ?sorgu ve #çapa atılır; yönetici ekranı boş", () => {
  assert.deepEqual(staffPathOf("/panel/bugun"), ["Bugün"]);
  assert.deepEqual(staffPathOf("/panel/kasa"), ["Kasa raporu"]);
  assert.deepEqual(staffPathOf("/panel/kasa?gun=2026-10-20#isteklerim"), ["Kasa raporu"]);
  // Menü grubunda personele tek alt sayfa kalır: grup doğrudan o sayfa
  assert.deepEqual(staffPathOf("/panel/receteler"), ["Reçete defteri"]);
  assert.deepEqual(staffPathOf("/panel/sayim"), ["Stok", "Stok sayımı"]);
  assert.deepEqual(staffPathOf("/panel/zayi"), ["Stok", "Zayi & ikram"]);
  // Kaldırılan ekranlar (Hızlı sayım, Mal siparişi; 26 Eki 2026) personelin menüsünde yok
  assert.deepEqual(staffPathOf("/panel/hizli-sayim"), []);
  assert.deepEqual(staffPathOf("/panel/hizli-sayim/siparis"), []);
  assert.deepEqual(staffPathOf("/panel/kontrol/gecmis"), ["Kontrol listeleri", "Geçmiş"]);
  assert.deepEqual(staffPathOf("/panel/kasa/fiyatlar"), ["Bugün", "Kasadaki fiyatlar"]);
  assert.deepEqual(staffPathOf("/panel/hesap"), ["Hesabım"]);
  assert.deepEqual(staffPathOf("/panel/yardim/personel"), ["Yardım"]);
  for (const admin of ["/panel", "/panel/onaylar", "/panel/urunler", "/panel/yardim", "/panel/kontrol/duzenle"]) {
    assert.deepEqual(staffPathOf(admin), [], admin);
  }
});

test("kaynak yalıtımı: personelin sayfası yöneticinin Yardım'ını almaz, yönetici denetimi yok, içerik oturumdan sonra", () => {
  for (const src of [STAFF_PAGE, CONTENT]) {
    assert.doesNotMatch(src, /from "\.\.\/page"|from "\.\/\.\.\/page"|yardim\/page/);
    assert.doesNotMatch(src, /requireAdmin/);
    assert.doesNotMatch(src, /\bFAQ_GROUPS\b|\bROUTINE\b|\bFORMULAS\b|\bMENU_LAYOUT\b|\bpathOf\b/);
    assert.doesNotMatch(src, /@\/server\/(?!auth\/dal)/, "sunucu verisi okunmaz");
  }
  assert.doesNotMatch(BUILD, /FAQ_GROUPS|STAFF_FAQ_GROUPS|ROUTINE|from "\.\/page"|from "\.\/personel/);
  // İçerik bir Suspense çocuğunda, requireUser'dan sonra
  assert.match(STAFF_PAGE, /<Suspense[\s\S]*<StaffHelpContent \/>/);
  assert.match(STAFF_PAGE, /async function StaffHelpContent\(\) \{\s*(const me = )?await requireUser\(\);/);
  // Yöneticinin sayfası içeriği requireAdmin ile başlayan iç bileşende çizer; sabitler yalnız orada kullanılır
  assert.match(ADMIN_PAGE, /async function HelpContent\(\) \{\s*await requireAdmin\(\);/);
  const outer = ADMIN_PAGE.slice(ADMIN_PAGE.indexOf("export default function HelpPage"), ADMIN_PAGE.indexOf("async function HelpContent"));
  assert.ok(outer.length > 0);
  for (const name of ["FAQ", "FAQ_GROUPS", "ROUTINE", "FORMULAS", "MENU_LAYOUT"]) assert.doesNotMatch(outer, new RegExp(`\\b${name}\\b`), name);
  assert.match(outer, /<Suspense fallback=\{<PageSkeleton/);
  assert.match(outer, /href="\/panel\/yardim\/personel"/, "başlıkta Personelin Yardım'ı");
  for (const name of ["FAQ_GROUPS", "ROUTINE", "FORMULAS", "MENU_LAYOUT", "FAQ"]) assert.doesNotMatch(ADMIN_PAGE, new RegExp(`export const ${name}\\b`), `${name} dışarı açılmaz`);
});

test("Yardım klasöründe sarmalayıcı dosya yok (layout, template, loading, error)", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [e.name]));
  const files = walk(DIR);
  for (const f of files) assert.doesNotMatch(f, /^(layout|template|loading|error|not-found)\.(t|j)sx?$/, f);
});

test("bağlantılar: her yol personelin açabildiği, var olan ve menüde yolu çözülen bir ekran", () => {
  // Personelin bütün ekranları ve iki alt ekranı (Hızlı sayım ve sipariş taslağı 26 Eki 2026'da kaldırıldı)
  assert.ok(HREFS.length >= 13, `${HREFS.length} bağlantı`);
  for (const h of HREFS) {
    const path = h.replace(/[?#].*$/, "");
    assert.ok(canOpen("staff", path), `${h} personele kapalı`);
    assert.ok(existsSync(join(process.cwd(), "src/app", path, "page.tsx")), `${h} ekranı yok`);
    assert.ok(staffPathOf(h).length, `${h} personelin menüsünde yok`);
  }
});

test("kapsam: her personel ekranı ve onaya giden her tür Yardım'da geçer", () => {
  for (const p of STAFF_PATHS) assert.ok(HREFS.some((h) => h.replace(/[?#].*$/, "") === p), `${p} anlatılmıyor`);
  for (const sub of ["/panel/kasa/fiyatlar", "/panel/kontrol/gecmis"]) assert.ok(HREFS.includes(sub), sub);
  const approvals = FAQ_TEXTS.find((t) => t.id === "onaya-gidenler")?.text ?? "";
  for (const a of STAFF_APPROVAL_KINDS) assert.ok(approvals.includes(a.text), a.kind);
  // Liste koddan kurulur, elle yazılmaz
  assert.match(CONTENT, /STAFF_APPROVAL_KINDS\.map/);
});

test("sayılar koddan gelir (elle yazılmaz)", () => {
  for (const name of ["DAY_TURN_HOUR", "CASH_EVENING_HOUR", "CASH_OUT_UNDO_TOAST_MS", "STAFF_HISTORY_DAYS", "LATE_REPORT_DAYS"]) {
    assert.match(CONTENT, new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}`), name);
  }
  assert.match(ALL_TEXT, /05:00/);
  assert.match(ALL_TEXT, /20:00/);
  assert.match(ALL_TEXT, /8 saniye/);
  // Metin parçaları birleşirken sayının iki yanına boşluk düşer
  assert.match(ALL_TEXT, /son\s+7\s+gün/);
  assert.match(ALL_TEXT, /son\s+14\s+gün/);
  // Kasadan çıkan penceresi aynı sabitle (Geri al'ın bildirimi)
  assert.match(readFileSync(join(process.cwd(), "src/app/panel/kasa/cash-out-dialog.tsx"), "utf8"), /duration: CASH_OUT_UNDO_TOAST_MS/);
});

test("metinler: tutar, maliyet ve para sözcüğü yok (tr-TR katlamalı); fiyat yalnız satış ve paket fiyatı", () => {
  // \btl\b Türkçe harfleri sözcük saymaz ("kayıtlı"): sınır harf sınıfıyla
  const banned =
    /maliyet|maaş|komisyon|hakediş|kâr|kârlılık|marj|ciro|kira|sgk|fatura|₺|(?<!\p{L})tl(?!\p{L})|lira|kuruş|\$|gelir|gider|zarar|borç|alış|birim fiyat|iban|ödeme talebi/u;
  for (const t of [...FAQ_TEXTS.map((x) => x.text), ...ROUTINE_TEXTS]) {
    const m = fold(t).match(banned);
    assert.equal(m, null, `"${m?.[0]}" geçiyor: ${t.slice(0, 80)}`);
  }
  // Ekranın adı ("Kasadaki fiyatlar") dışında fiyat yalnız "satış fiyatı" ve "paket fiyatı" olarak
  const rest = fold(ALL_TEXT).replaceAll("kasadaki fiyatlar", "").replace(/(satış|paket) fiyat/g, "");
  assert.doesNotMatch(rest, /fiyat/);
  // Karaoke ve bar ekranının cevaplarında tutar yok
  for (const t of FAQ_TEXTS.filter((x) => x.group === "Bar ekranı ve karaoke")) assert.doesNotMatch(fold(t.text), /tutar|\d+\s*₺/, t.id);
});

test("yöneticinin ekran adları ve adresleri personelin Yardım'ında yok", () => {
  // Yönetici etiketleri: personelin açamadığı ekranların menü, sekme ve kısa başlık adları (büyük-küçük harfe duyarlı, tam
  // ifade); genel tek kelimeler hariç (Personel bu sayfanın bağlam satırı, Yardım iki rolde de var; Kafe ve Satış
  // yöneticinin başlıkları ama ekran değil, personelin "Kafe kapalıydı" düğmesinde ve "Satış dışında" cümlesinde de geçer;
  // KDV 29 Eki 2026'dan beri yöneticinin paletinde Vergi Özet'inin bir satırına giden kısayol, ekran değil; personel onu
  // Z raporu fişinin "KDV dökümü" satırı olarak okur, docs/planlar/ux-sade.md §3.4)
  const GENERIC = new Set(["Personel", "Yardım", "Kafe", "Satış", "KDV"]);
  const labels = new Map<string, string>();
  for (const i of [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER]) labels.set(i.label, i.href);
  for (const n of NAV_TREE) {
    if (n.href) labels.set(n.label, n.href);
    else if (!n.roles.includes("staff")) labels.set(n.label, "/panel/__grup");
    for (const c of n.children ?? []) labels.set(c.label, c.href);
  }
  for (const tabs of Object.values(SECTION_TABS)) for (const t of tabs) labels.set(t.label, t.href);
  for (const href of ["/panel/urunler/fiyatlar", "/panel/hatirlaticilar/nakit", "/panel/karaoke/doluluk", "/panel/kontrol/duzenle"]) {
    labels.set(mobileTitleFor(href), href);
  }
  const adminOnly = [...labels].filter(([label, href]) => !canOpen("staff", href) && !GENERIC.has(label)).map(([label]) => label);
  assert.ok(adminOnly.includes("Onaylar") && adminOnly.includes("Tutarlılık") && adminOnly.includes("Komisyon & hakediş"));
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const label of adminOnly) assert.doesNotMatch(ALL_TEXT, new RegExp(`(^|[^\\p{L}])${escape(label)}([^\\p{L}]|$)`, "u"), label);
  // Kaynakta yönetici adresi yok
  for (const m of CONTENT.matchAll(/["'](\/panel[^"'?#\s]*)/g)) assert.ok(canOpen("staff", m[1]), m[1]);
  // Personelin alt menüsünde olmayan yönetici sekmesi yok
  assert.ok(BOTTOM_NAV.staff.every((i) => !i.href || canOpen("staff", i.href)));
});

test("soru kimlikleri benzersiz, her grupta soru var", () => {
  const ids = STAFF_FAQ_GROUPS.flatMap((g) => g.items.map((f) => f.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const g of STAFF_FAQ_GROUPS) assert.ok(g.items.length > 0, g.title);
  assert.equal(STAFF_ROUTINE.length, 6);
});

test("günün sırası: ay sonu sayımı kapanıştan sonra, son adım (Bugün'deki sırayla aynı: kasa raporu, sonra ay sonu sayımı)", () => {
  const titles = STAFF_ROUTINE.map((r) => r.title);
  assert.equal(titles.at(-1), "Ayın son günü");
  assert.ok(titles.indexOf("Akşam kasa raporu") < titles.indexOf("Kapanış listesi"));
  assert.ok(titles.indexOf("Kapanış listesi") < titles.indexOf("Ayın son günü"));
});

test("kasa düzeltmesi: ertesi gün onaya giden her alan (SENSITIVE) yanıtta; saatlerin eki okunuşa göre", () => {
  const text = fold(FAQ_TEXTS.find((t) => t.id === "kasa-duzelt")!.text);
  for (const key of SENSITIVE) assert.ok(text.includes(fold(CHANGE_LABELS[key])), `"${CHANGE_LABELS[key]}" kasa düzeltmesi yanıtında yok`);
  // "Ertesi gün Z … doğrudan" bütün Z bölümünü kapsıyordu (Nakit satış Z kartında ama onaya gider)
  assert.doesNotMatch(text, /ertesi gün z, kart ve not alanları/);
  const flat = ALL_TEXT.replace(/\s+/g, " ");
  assert.ok(flat.includes("20:00'den sonra"));
  assert.doesNotMatch(flat, /\d\d:\d\d'dan sonra/);
  assert.doesNotMatch(CONTENT, /\}&apos;(?:te|ten|da|dan|de|den|ta|tan)\b/);
});

test("banka POS Z (yazarkasa): ayırt edici cümle, doldurma kapısı; yöneticinin rakamları ve jargon yok (docs/planlar/okc-z.md §14, İlke 8)", () => {
  const okc = FAQ_TEXTS.find((t) => t.id === "kasa-yazarkasa")?.text ?? "";
  assert.ok(okc, "kasa-yazarkasa sorusu yok");
  assert.match(okc, /Banka POS Z raporu \(yazarkasa\)/);
  assert.match(okc, /Z RAPORU ve KDV dökümü yazar, banka gün sonu fişi değil/);
  // Kapı kapalıyken okunan rakam yalnız öneri: personel "rakamlar dolar" sanmasın
  if (OKC_PREFILL_ENABLED) assert.match(okc, /tutmayan rakam turuncu kalır/);
  else {
    assert.match(okc, /forma kendiliğinden yazılmaz/);
    assert.match(okc, /Fotoğraftakini yaz/);
  }
  assert.match(CONTENT, /OKC_PREFILL_ENABLED \?/, "metin kapıya bağlı (sabit değişince yardım da değişir)");
  // Personele yalnız kart satırı: toplam / nakit farkı, kümülatif ve yazarkasa dışı tahsilat anlatılmaz; jargon yok
  for (const t of [okc, ALL_TEXT]) {
    assert.doesNotMatch(fold(t), /kümülatif|zincir|küm\.|matrah|cihaz açılışından|toplam farkı|nakit farkı|toplam dışı|yazarkasa dışı/);
  }
  assert.match(okc, /yazarkasanın kartı ModPOS'taki kartla karşılaştırılır/);
  // Akşamın ilk sorusu yazarkasa Z'sini ayrı bölüm olarak anar, eski PR-a yönergesi ("Banka POS'a K.KARTI yazın") kalktı
  const aksam = FAQ_TEXTS.find((t) => t.id === "kasa-aksam")?.text ?? "";
  assert.match(aksam, /banka POS Z raporunun \(yazarkasa\)/);
  assert.doesNotMatch(aksam, /gün sonu fişinin fotoğrafını|Banka POS'a yazarkasanın/);
});

test("LafPOS: ürün ikramı LafPOS'ta işaretlenir cümlesi zayi sorusunda ve günün sırasında (koşullu; denetim B10)", () => {
  const zayi = FAQ_TEXTS.find((t) => t.id === "zayi-gir")?.text ?? "";
  assert.match(zayi, /Kasada LafPOS kullanılmaya başlandıysa ürün ikramı LafPOS'ta işaretlenir; burada yalnız zayi ve hammadde ikramı girilir\./);
  assert.match(zayi, /“Zayi yaz” ile işaretlenen ürünü burada ayrıca girmeyin/);
  const gun = ROUTINE_TEXTS.find((t) => t.startsWith("Gün içinde")) ?? "";
  assert.match(gun, /Kasada LafPOS kullanılmaya başlandıysa ürün ikramı LafPOS'ta işaretlenir; panele yalnız zayi ve hammadde ikramı girilir\./);
});

test("sade metin (24.11.2026): her cevap en çok 800, her adım en çok 400 harf; başlık açıklaması aramayı yeniden anlatmaz", () => {
  for (const t of FAQ_TEXTS) {
    const g = STAFF_FAQ_GROUPS.find((x) => x.title === t.group)!;
    const len = textOf(g.items.find((f) => f.id === t.id)!.a, staffPathText).length;
    assert.ok(len <= 800, `${t.id}: ${len} harf`);
  }
  for (const r of STAFF_ROUTINE) assert.ok(textOf(r.body, staffPathText).length <= 400, r.title);
  assert.doesNotMatch(STAFF_PAGE, /[Ss]oruya dokunun ya da arayın/);
});

test("LafPOS günü (gün sonu tam, #132): rapor LafPOS'tan salt okunur gelir, personelin tek işi Pavo'nun gün sonu fotoğrafı", () => {
  const aksam = FAQ_TEXTS.find((t) => t.id === "kasa-aksam")?.text ?? "";
  const routine = ROUTINE_TEXTS.find((t) => t.startsWith("Akşam kasa raporu")) ?? "";
  for (const [name, t] of [["kasa-aksam", aksam], ["Akşam kasa raporu", routine]] as const) {
    assert.match(t, /Pavo'dan gün sonu fişini \(detaylı Z\)/, name);
    assert.match(t, /Gün sonu fotoğrafı/, name);
  }
  assert.match(aksam, /salt okunur/);
  assert.match(aksam, /düzeltme LafPOS'ta yapılır/);
  // Eski akış (form LafPOS'tan dolar, personel karşılaştırıp gönderir) ve personelin görmediği karşılaştırma anlatılmaz
  assert.doesNotMatch(ALL_TEXT, /form (ondan|LafPOS'un gün sonundan) dolar/);
  assert.doesNotMatch(ALL_TEXT, /LafPOS'takiyle/);
  assert.doesNotMatch(ALL_TEXT, /fotoğraf gerekmez/);
  const gec = FAQ_TEXTS.find((t) => t.id === "kasa-gec")?.text ?? "";
  assert.match(gec, /Gün sonu fotoğrafı/);
});

test("Rapora yanlış fotoğraf: düğme fotoğraf rapordan farklı okunduğunda da çıkmaz (photoRemovalStates)", () => {
  const foto = FAQ_TEXTS.find((t) => t.id === "kasa-foto")?.text ?? "";
  assert.match(foto, /dayanıyorsa/);
  assert.match(foto, /farklı okunduysa/);
});

test("Kasadaki satış fiyatları: Marina'nın ModPOS dönemi kapandı (CONTRACT §9), soru ModPOS'a bağlı değil", () => {
  assert.doesNotMatch(CONTENT, /Kasadaki \(ModPOS\)/);
  const item = STAFF_FAQ_GROUPS.flatMap((g) => g.items).find((f) => f.id === "kasa-fiyatlar");
  assert.ok(item);
  assert.doesNotMatch(item.q, /ModPOS/);
  const text = FAQ_TEXTS.find((t) => t.id === "kasa-fiyatlar")?.text ?? "";
  assert.match(text, /Kasada ModPOS kullanılıyorsa/);
  assert.match(text, /Kasada LafPOS kullanılıyorsa/);
});
