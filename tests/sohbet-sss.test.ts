// Sohbet görünümlü SSS (src/components/ui/faq-chat.tsx, rare-ui faq'tan uyarlandı) ve Yardım'ın iki sayfasında kullanımı:
// sunucu HTML'inde her soru, açık cevap bölgesi ve bağlantıları, çapa, klavye, panel belirteçleri.
// Çalıştırma: npx tsx --test tests/sohbet-sss.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { openFor, stepTo } from "../src/components/ui/faq-chat";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CHAT = read("src/components/ui/faq-chat.tsx");
const SEARCH = read("src/app/panel/yardim/faq-search.tsx");
const BUILD = read("src/app/panel/yardim/faq-build.tsx");

async function render(props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { FaqChat } = await import("../src/components/ui/faq-chat");
  return renderToStaticMarkup(createElement(FaqChat, props as never));
}

const ITEMS = [
  { id: "zam", question: "Menüye zam yaptım", answer: "Ürünler ekranında fiyatı değiştirin." },
  { id: "kdv", question: "KDV nasıl hesaplanır?", answer: "Vergi Özet'te." },
  { id: "yedek", question: "Yedek nerede?", answer: "Ayarlar › Yedek." },
];

test("sunucu HTML'i: her soru düğme, kapalıyken cevap DOM'da yok", async () => {
  const html = await render({ items: ITEMS });
  for (const i of ITEMS) assert.ok(html.includes(i.question), i.id);
  assert.equal(html.match(/<button[^>]*data-slot="faq-question"/g)?.length, 3);
  assert.equal(html.match(/aria-expanded="false"/g)?.length, 3);
  assert.doesNotMatch(html, /data-slot="faq-answer"/);
  assert.doesNotMatch(html, /aria-controls=/, "kapalı sorunun gösterdiği bölge yok");
  for (const i of ITEMS) assert.ok(!html.includes(String(i.answer)), `${i.id} cevabı kapalıyken çizilmez`);
});

test("açık cevap: soruya bağlı bölge, L'Af işareti süs (aria-hidden), soru aria-controls ile bölgeyi gösterir", async () => {
  const html = await render({ items: ITEMS, defaultValue: "kdv" });
  assert.equal(html.match(/data-slot="faq-answer"/g)?.length, 1);
  assert.ok(html.includes("Vergi Özet&#x27;te.") || html.includes("Vergi Özet'te."));
  const button = html.match(/<button[^>]*aria-expanded="true"[^>]*>/)?.[0] ?? "";
  const questionId = button.match(/ id="([^"]+)"/)?.[1];
  const controls = button.match(/aria-controls="([^"]+)"/)?.[1];
  assert.ok(questionId && controls, button);
  assert.match(html, new RegExp(`<div[^>]*id="${controls}"[^>]*role="region"[^>]*aria-labelledby="${questionId}"`));
  // Cevabın yanındaki işaret L'Af karosu, ekran okuyucuya okunmaz
  assert.match(html, /<span aria-hidden="true"[^>]*data-slot="faq-avatar"[^>]*>.*?<svg[^>]*aria-hidden="true"/);
});

test("çapa: anchors verilince soru kimliği sorunun kimliği (/panel/yardim#claude), telefon üst çubuğunun altında durur", async () => {
  const html = await render({ items: ITEMS, anchors: true });
  for (const i of ITEMS) assert.match(html, new RegExp(`<button[^>]*id="${i.id}"`), i.id);
  assert.match(html, /scroll-mt-\[calc\(var\(--mobile-top-h\)\+1\.5rem\)\]/);
  const plain = await render({ items: ITEMS });
  assert.doesNotMatch(plain, /id="zam"/, "çapasız listede kimlik useId'den");
});

test("openFor: çapadaki soru kendi grubunda açılır; bilinmeyen çapa bir şey açmaz", () => {
  const groups = [
    { title: "Menü", items: [{ id: "zam" }, { id: "recete" }] },
    { title: "Vergi", items: [{ id: "kdv" }] },
  ];
  assert.deepEqual(openFor(groups, "#kdv"), { Vergi: "kdv" });
  assert.deepEqual(openFor(groups, "recete"), { Menü: "recete" });
  assert.equal(openFor(groups, "#yok"), null);
  assert.equal(openFor(groups, ""), null);
  assert.equal(openFor(groups, "#%E0"), null, "bozuk çapa hata atmaz");
});

test("klavye: ↓ ↑ sorular arasında döner, Home / End uçlara, başka tuş dokunulmaz", () => {
  assert.equal(stepTo("ArrowDown", 0, 3), 1);
  assert.equal(stepTo("ArrowDown", 2, 3), 0);
  assert.equal(stepTo("ArrowUp", 0, 3), 2);
  assert.equal(stepTo("ArrowUp", 2, 3), 1);
  assert.equal(stepTo("Home", 2, 3), 0);
  assert.equal(stepTo("End", 0, 3), 2);
  assert.equal(stepTo("Enter", 1, 3), null);
  assert.equal(stepTo("ArrowDown", 0, 0), null);
});

test("panel uyarlaması: belirteçler, 44 px dokunma, sakin hareket; rare-ui'nin rengi ve logosu yok", () => {
  assert.match(CHAT, /useCalmMotion\(\)/, "sunucu HTML'i ve hidrasyon hareketsiz");
  assert.match(CHAT, /min-h-11/);
  assert.match(CHAT, /from "@\/components\/brand"/);
  assert.match(CHAT, /bg-brand-100/);
  assert.doesNotMatch(CHAT, /#FC4C01|#F4F4F9|#262626|#333333|#868593|RareMark|rare-ui\.dev/i);
  assert.doesNotMatch(CHAT, /useReducedMotion/, "hareket kancası panelinki");
  // Renk yalnız belirteçten: elle yazılmış onaltılık renk yok
  assert.doesNotMatch(CHAT, /#[0-9a-f]{3,8}\b/i);
});

test("Yardım: iki sayfanın listesi sohbet SSS'i; arama, grup başlığı, bağlantılar ve Suspense yedeği yerinde", () => {
  assert.match(SEARCH, /import \{ FaqChat, openFor \} from "@\/components\/ui\/faq-chat"/);
  assert.doesNotMatch(SEARCH, /BouncyAccordion/);
  assert.match(SEARCH, /<h3 [^>]*>\{g\.title\}<\/h3>/);
  assert.match(SEARCH, /matches\(`\$\{g\.title\} \$\{f\.title\} \$\{f\.text\}`, q\)/);
  assert.match(SEARCH, /export function HelpFaqFallback/);
  // Cevabın altındaki bağlantılar cevap balonunun içinde
  assert.match(BUILD, /<GoLinks links=\{f\.links\} \/>/);
  for (const p of ["src/app/panel/yardim/page.tsx", "src/app/panel/yardim/personel/page.tsx"]) {
    assert.match(read(p), /<Suspense fallback=\{<HelpFaqFallback groups=\{FAQ\} \/>\}>\s*<HelpFaq groups=\{FAQ\} \/>/, p);
  }
});

test("personelin Yardım'ı: yedek liste (sunucu HTML'i) her soruyu yazar, açık cevap bağlantılarıyla balonda", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { buildFaq } = await import("../src/app/panel/yardim/faq-build");
  const { HelpFaqFallback } = await import("../src/app/panel/yardim/faq-search");
  const { STAFF_FAQ_GROUPS, staffPathText } = await import("../src/app/panel/yardim/personel/content");
  const groups = buildFaq(STAFF_FAQ_GROUPS, staffPathText);
  const unescape = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const html = unescape(renderToStaticMarkup(createElement(HelpFaqFallback, { groups })));
  for (const g of groups) {
    assert.ok(html.includes(g.title), g.title);
    for (const f of g.items) {
      assert.ok(html.includes(f.title), f.id);
      assert.match(html, new RegExp(`<button[^>]*id="${f.id}"`), `${f.id} çapası`);
    }
  }
  // Bağlantılı bir cevap açıkken bağlantı cevap bölgesinin içinde
  const linked = groups.flatMap((g) => g.items).find((f) => STAFF_FAQ_GROUPS.some((g) => g.items.some((i) => i.id === f.id && i.links?.length)));
  assert.ok(linked, "bağlantılı soru var");
  const { FaqChat } = await import("../src/components/ui/faq-chat");
  const one = unescape(
    renderToStaticMarkup(createElement(FaqChat, { items: [{ id: linked.id, question: linked.title, answer: linked.description, icon: linked.icon }], defaultValue: linked.id })),
  );
  const region = one.slice(one.indexOf('role="region"'));
  const href = STAFF_FAQ_GROUPS.flatMap((g) => g.items).find((i) => i.id === linked.id)!.links![0].href;
  assert.ok(region.includes(`href="${href}"`), href);
});
