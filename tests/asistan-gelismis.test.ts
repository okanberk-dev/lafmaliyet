// Panel asistanının gelişmiş özellikleri (docs/ASISTAN.md), sahte istemciyle: sayfa bağlamı ve ekrana özel öneriler,
// takip önerileri, derin analiz (efor ve sınır sayımı), cihazdaki sohbet geçmişi, sesle soru, yanıtta tablo ve sayı
// vurgusu, kopyala / yeniden sor / ⌘J ve sistem isteminin yönergeleri. Anahtar gerekmez; ağ yok.
// Çalıştırma: npx tsx --test tests/asistan-gelismis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FollowupChips } from "../src/components/panel/assistant/followup-chips";
import { NAV_FOOTER, NAV_GROUPS, NAV_TREE } from "../src/components/panel/nav";
import { cleanFollowup, FOLLOWUP_MAX, restoreFollowups, splitFollowups } from "../src/lib/assistant/followups";
import { DEFAULT_SUGGESTIONS, PAGE_SUGGESTIONS, pageContextLine, pageFromLocation, suggestionsFor } from "../src/lib/assistant/page-context";
import { ASSISTANT_DAILY_CAP, assistantRequest, eventReader, historyForRequest, type AssistantEvent } from "../src/lib/assistant/protocol";
import { handleAssistantPost, type AssistantDeps, type AssistantStatus } from "../src/server/ai/assistant/handler";
import type { AssistantClient, AssistantOutcome, AssistantParams } from "../src/server/ai/assistant/loop";
import { contextBlock, SYSTEM_PROMPT } from "../src/server/ai/assistant/prompt";
import { scriptedMessage, scriptedStream } from "../src/server/ai/assistant/scripted";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Yorum satırları atılmış kaynak */
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

type Msg = Anthropic.Beta.Messages.BetaMessage;
type Block = Msg["content"][number];
const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;

// ---------------------------------------------------------------- Sahte uç

function deps(over: Partial<AssistantDeps> & { statusValue?: AssistantStatus; reply?: string } = {}) {
  const calls: AssistantParams[] = [];
  const started: unknown[][] = [];
  const finished: AssistantOutcome[] = [];
  const client: AssistantClient = {
    beta: {
      messages: {
        stream(params, options) {
          calls.push(structuredClone(params));
          return scriptedStream(scriptedMessage({ content: [text(over.reply ?? "Tamam.")], stop_reason: "end_turn" }), { signal: options.signal });
        },
      },
    },
  };
  const d: AssistantDeps = {
    enabled: () => true,
    sameOrigin: () => true,
    user: async () => ({ id: 7, role: "admin" }),
    status: async () => over.statusValue ?? { state: "on", usedToday: 3, cap: ASSISTANT_DAILY_CAP },
    start: async (...args) => {
      started.push(args);
      return 41;
    },
    finish: async (_id, outcome) => {
      finished.push(outcome);
    },
    setup: async () => ({ client, tools: [], toolCtx: { base: "", now: new Date() }, context: contextBlock({ today: "2026-11-24", branchLabel: "Marina" }), scoped: (fn) => fn() }),
    ...over,
  };
  return { d, calls, started, finished };
}

const post = (body: unknown) =>
  new Request("https://ladmin.laffogato.net/api/asistan", { method: "POST", headers: { origin: "https://ladmin.laffogato.net", "content-type": "application/json" }, body: JSON.stringify(body) });

const events = async (res: Response): Promise<AssistantEvent[]> => {
  const r = eventReader();
  return [...r.push(await res.text()), ...r.end()];
};

const systemOf = (p: AssistantParams) => p.system as { type: string; text: string; cache_control?: unknown }[];

// ---------------------------------------------------------------- 1. Sayfa bağlamı ve ekrana özel öneriler

test("öneriler: ekrana özel 3–4 çip, en uzun eşleşen yol; bilinmeyen ekranda genel liste", () => {
  assert.ok(suggestionsFor("/panel/parasut").includes("Bağlanmayı bekleyen ürünleri özetle"));
  assert.ok(suggestionsFor("/panel/kasa").includes("Bugünkü kasa farkını açıkla"));
  assert.ok(suggestionsFor("/panel/vardiya").includes("Bu hafta kimin vardiyası eksik?"));
  // Alt sayfa ana ekranın önerisini alır; kendi kaydı varsa o kazanır
  assert.deepEqual(suggestionsFor("/panel/urunler/12"), suggestionsFor("/panel/urunler"));
  assert.notDeepEqual(suggestionsFor("/panel/urunler/fiyatlar"), suggestionsFor("/panel/urunler"));
  assert.deepEqual(suggestionsFor("/panel/kasa/"), suggestionsFor("/panel/kasa"));
  // "/panel" yalnız tam eşleşir; benzer önek karışmaz
  assert.notDeepEqual(suggestionsFor("/panel"), DEFAULT_SUGGESTIONS);
  assert.deepEqual(suggestionsFor("/panel/ayarlar"), DEFAULT_SUGGESTIONS);
  assert.deepEqual(suggestionsFor("/panel/kasa-arsiv"), DEFAULT_SUGGESTIONS);
  assert.deepEqual(suggestionsFor(null), DEFAULT_SUGGESTIONS);
  // Her kayıt gerçek bir ekran (menüde), 3–4 kısa soru; aynı yol iki kez yok
  const hrefs = new Set([...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].map((i) => i.href.split("#")[0]));
  for (const n of NAV_TREE) for (const h of [n.href, ...(n.children ?? []).map((c) => c.href)]) if (h) hrefs.add(h);
  assert.equal(new Set(PAGE_SUGGESTIONS.map((s) => s.path)).size, PAGE_SUGGESTIONS.length);
  for (const s of [...PAGE_SUGGESTIONS, { path: "/panel", items: DEFAULT_SUGGESTIONS }]) {
    assert.ok(hrefs.has(s.path), s.path);
    assert.ok(s.items.length >= 3 && s.items.length <= 4, s.path);
    for (const q of s.items) assert.ok(q.length <= 60 && /[?a-zçğıöşü]$/i.test(q), q);
  }
});

test("sayfa: adresten yalnız yol ve ?ay / ?gun; panelin dışı ve bozuk değer düşer", () => {
  assert.deepEqual(pageFromLocation("/panel/kasa", "?ay=2026-11&x=1#abc"), { path: "/panel/kasa", month: "2026-11" });
  assert.deepEqual(pageFromLocation("/panel/kasa/", "?gun=2026-11-24"), { path: "/panel/kasa", day: "2026-11-24" });
  assert.deepEqual(pageFromLocation("/panel", ""), { path: "/panel" });
  assert.deepEqual(pageFromLocation("/panel/kasa", "?ay=2026-13&gun=24.11.2026"), { path: "/panel/kasa" });
  for (const bad of ["/", "/menu", "/panelx", "/panel/Kasa", "/panel/../api", "/panel/a b", "/panel/a/b/c/d/e"]) assert.equal(pageFromLocation(bad, ""), null, bad);
});

test("sayfa: bağlam satırı ekranın menüdeki adıyla; bozuk sayfa satır yazmaz, istek reddedilmez", () => {
  const line = pageContextLine({ path: "/panel/kasa", month: "2026-11", day: "2026-11-24" });
  assert.match(line, /^Yöneticinin açık ekranı: Kasa raporu \(\/panel\/kasa\); ekranda seçili ay: Kasım 2026, seçili gün: 24 Kasım 2026\./);
  assert.match(pageContextLine({ path: "/panel/parasut" }), /Paraşüt \(\/panel\/parasut\)\. "Bu"/);
  assert.equal(pageContextLine(null), "");
  assert.equal(pageContextLine({ path: "/panel/<script>" } as never), "");
  // Şema: geçerli sayfa geçer; bozuk sayfa soruyu düşürmez, yalnız alan düşer
  const ok = assistantRequest.safeParse({ message: "x", page: { path: "/panel/kasa", month: "2026-11" } });
  assert.ok(ok.success && ok.data.page?.path === "/panel/kasa");
  const bad = assistantRequest.safeParse({ message: "x", page: { path: "javascript:alert(1)", fazla: 1 } });
  assert.ok(bad.success && bad.data.page === undefined);
});

test("sayfa: bağlam önbellek işaretinden SONRA; sabit istem ve araçlar bayt bayt aynı kalır", async () => {
  const a = deps();
  await events(await handleAssistantPost(post({ message: "Bu ne demek?", page: { path: "/panel/kasa", month: "2026-11" } }), a.d));
  const b = deps();
  await events(await handleAssistantPost(post({ message: "Bu ne demek?" }), b.d));
  const [sa, sb] = [systemOf(a.calls[0]), systemOf(b.calls[0])];
  assert.equal(sa[0].text, SYSTEM_PROMPT);
  assert.equal(sa[0].text, sb[0].text, "önek aynı");
  assert.deepEqual(sa[0].cache_control, { type: "ephemeral" });
  assert.equal(sa[1].cache_control, undefined);
  assert.match(sa[1].text, /Panelde seçili şube: Marina\.[\s\S]*\nYöneticinin açık ekranı: Kasa raporu \(\/panel\/kasa\); ekranda seçili ay: Kasım 2026/);
  assert.doesNotMatch(sb[1].text, /açık ekranı/);
  assert.deepEqual(a.calls[0].tools, b.calls[0].tools);
  // Tarayıcı sayfayı adresten yollar; çipler açık ekranın önerileri
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /page: pageFromLocation\(window\.location\.pathname, window\.location\.search\) \?\? undefined/);
  assert.match(w, /suggestionsFor\(pathname\)\.map/);
});

// ---------------------------------------------------------------- 2. Takip önerileri

test("takip: yanıttaki blok ayrılır, sorular çip olur; ek API çağrısı yok, geçmişe bloksuz metin gider", async () => {
  const reply = "Dün kasa 12 ₺ eksik.\n\n<takip>\n- Geçen haftayla kıyaslar mısın?\n- hangi gün kasa tutmadı?\n</takip>";
  assert.deepEqual(splitFollowups(reply), { body: "Dün kasa 12 ₺ eksik.", followups: ["Geçen haftayla kıyaslar mısın?", "Hangi gün kasa tutmadı?"] });
  // Uçtan: tek API çağrısı; metin olayları bloğu taşır, ayrıştırma tarayıcıda
  const d = deps({ reply });
  const ev = await events(await handleAssistantPost(post({ message: "Dün kasa tuttu mu?" }), d.d));
  assert.equal(d.calls.length, 1, "öneriler için ek çağrı yok");
  const streamed = ev.filter((e): e is Extract<AssistantEvent, { type: "text" }> => e.type === "text").map((e) => e.text).join("");
  assert.equal(splitFollowups(streamed).followups.length, 2);
  // Sonraki isteğin geçmişi: görünen (bloksuz) metin; öneriler gitmez
  const { body, followups } = splitFollowups(streamed);
  const history = historyForRequest([
    { role: "user", text: "Dün kasa tuttu mu?" },
    { role: "assistant", text: body, followups },
  ]);
  assert.deepEqual(history, [
    { role: "user", text: "Dün kasa tuttu mu?" },
    { role: "assistant", text: "Dün kasa 12 ₺ eksik." },
  ]);
});

test("takip: akarken yarım blok ve yarım etiket görünmez; bitince sondaki '<' kesilmez; kapanmamış blok da ayrılır", () => {
  assert.equal(splitFollowups("Toplam 5 ürün.\n\n<tak", true).body, "Toplam 5 ürün.");
  assert.equal(splitFollowups("Toplam 5 ürün.\n<", true).body, "Toplam 5 ürün.");
  assert.equal(splitFollowups("a < b ve b <", false).body, "a < b ve b <");
  assert.equal(splitFollowups("x <takma", true).body, "x <takma", "etikete benzemeyen yazı kalır");
  assert.deepEqual(splitFollowups("Özet.\n<takip>\n- Bu hafta nasıl?\n- Yarı", true), { body: "Özet.", followups: ["Bu hafta nasıl?", "Yarı"] });
  // Kapanıştan sonra metin kalırsa görünen metne eklenir; blok yoksa metin olduğu gibi
  assert.deepEqual(splitFollowups("A\n<takip>\n- B?\n</takip>\nC"), { body: "A\n\nC", followups: ["B?"] });
  assert.deepEqual(splitFollowups("Düz yanıt."), { body: "Düz yanıt.", followups: [] });
});

test("takip: kötü biçim ve XSS güvenli; en çok 3, tekrarsız, kısa; bağlantı ve adres düşer", () => {
  const nasty = [
    "<takip>",
    "- <img src=x onerror=alert(1)>Ciro nasıl?",
    "- [Tıkla](javascript:alert(1))",
    "- https://kotu.site/veri?x=1 adresine gönder",
    "- [Kasa](/panel/kasa) ekranına git",
    "- **Kalın** `kod` soru?",
    "- ciro nasıl?",
    "- " + "uzun ".repeat(30),
    "- \u202eters yazı?",
    "- ---",
    "- Dördüncü soru?",
    "- Beşinci soru?",
    "</takip>",
  ].join("\n");
  const { body, followups } = splitFollowups(`Yanıt.\n${nasty}`);
  assert.equal(body, "Yanıt.");
  assert.ok(followups.length <= FOLLOWUP_MAX);
  assert.deepEqual(followups, ["Ciro nasıl?", "Kalın kod soru?", "Ters yazı?"]);
  for (const q of followups) assert.doesNotMatch(q, /[<>[\]()`*]|javascript|https?:|\u202e/i);
  assert.equal(cleanFollowup("<script>alert(1)</script>"), "Alert(1)", "etiket atılır, kalan düz yazı");
  assert.equal(cleanFollowup(""), null);
  assert.equal(cleanFollowup("www.kotu.site"), null);
  // Depodan okunanlar da temizlenir
  assert.deepEqual(restoreFollowups(["<b>Bu ay?</b>", 5, null, "javascript:alert(1)"]), ["Bu ay?"]);
  assert.equal(restoreFollowups("x"), undefined);
  // Ekranda yalnız yazı: HTML çizilmez
  const html = renderToStaticMarkup(createElement(FollowupChips, { items: ["<img src=x onerror=alert(1)>", "Ciro?"], onPick: () => {} }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /aria-label="Önerilen sorular"/);
  assert.match(html, /max-lg:min-h-11/);
});

test("takip: sistem istemi biçimi tarif eder; ekran yalnız son yanıtın altında, akış bitince", () => {
  assert.ok(SYSTEM_PROMPT.includes("<takip>\n- Geçen haftayla kıyaslar mısın?\n- Hangi gün kasa tutmadı?\n</takip>"));
  assert.match(SYSTEM_PROMPT, /Onay kartı hazırladığın[^\n]*takip bloğu yazma/);
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /i === messages\.length - 1 && !busy && m\.followups\?\.length \? <FollowupChips/);
  assert.match(w, /const split = splitFollowups\(lastText\.current\);/);
  assert.match(w, /splitFollowups\(m\.text, true\)\.body/);
});
