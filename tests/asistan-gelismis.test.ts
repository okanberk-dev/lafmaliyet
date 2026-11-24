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
import { ASSISTANT_DAILY_CAP, ASSISTANT_DEEP_WEIGHT, assistantRequest, eventReader, historyForRequest, type AssistantEvent } from "../src/lib/assistant/protocol";
import { handleAssistantPost, type AssistantDeps, type AssistantStatus } from "../src/server/ai/assistant/handler";
import { ASSISTANT_DEEP, ASSISTANT_EFFORT, ASSISTANT_MAX_TOKENS, ASSISTANT_TIMING, assistantParams, runAssistant, type AssistantClient, type AssistantOutcome, type AssistantParams } from "../src/server/ai/assistant/loop";
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

// ---------------------------------------------------------------- 3. Derin analiz

test("derin analiz: istek gövdesi efor high ve yüksek çıktı sınırı; olağan soru medium; öteki alanlar aynı", () => {
  const base = { system: "S", context: "C", tools: [], messages: [{ role: "user" as const, content: "x" }] };
  const normal = assistantParams(base);
  const deep = assistantParams({ ...base, deep: true });
  assert.deepEqual(normal.output_config, { effort: ASSISTANT_EFFORT });
  assert.equal(ASSISTANT_EFFORT, "medium");
  assert.deepEqual(deep.output_config, { effort: "high" });
  assert.equal(normal.max_tokens, ASSISTANT_MAX_TOKENS);
  assert.equal(deep.max_tokens, ASSISTANT_DEEP.maxTokens);
  assert.ok(ASSISTANT_DEEP.maxTokens > ASSISTANT_MAX_TOKENS);
  assert.notEqual(ASSISTANT_DEEP.effort, ASSISTANT_EFFORT, "sınır sayımı satırın eforundan ayırt eder");
  // Model, yedek model, önbellek, sistem ve araçlar aynı; düşünme / sıcaklık / zorunlu araç yine yok
  const rest = (p: AssistantParams) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== "output_config" && k !== "max_tokens"));
  assert.deepEqual(rest(deep), rest(normal));
  for (const key of ["thinking", "temperature", "top_p", "top_k", "tool_choice"]) assert.equal(key in deep, false, key);
  // Şema: varsayılan kapalı
  const p = assistantRequest.safeParse({ message: "x" });
  assert.ok(p.success && p.data.deep === false);
  assert.equal(assistantRequest.safeParse({ message: "x", deep: "evet" }).success, false);
});

test("derin analiz: uçtan high gider, sınıra 2 sayılır (kalan hak −2); hak 1 ise 429 deep_cap, Claude'a gitmez", async () => {
  const d = deps({ statusValue: { state: "on", usedToday: 10, cap: ASSISTANT_DAILY_CAP } });
  const ev = await events(await handleAssistantPost(post({ message: "Bu ayı derinlemesine incele", deep: true }), d.d));
  assert.deepEqual(d.calls[0].output_config, { effort: "high" });
  assert.equal(d.calls[0].max_tokens, ASSISTANT_DEEP.maxTokens);
  assert.deepEqual(d.started, [[7, { deep: true }]]);
  assert.deepEqual(ev[ev.length - 1], { type: "done", reason: "end", left: ASSISTANT_DAILY_CAP - 10 - ASSISTANT_DEEP_WEIGHT });
  assert.equal(ASSISTANT_DEEP_WEIGHT, 2);
  // Olağan soru: medium, 1 sayılır
  const n = deps({ statusValue: { state: "on", usedToday: 10, cap: ASSISTANT_DAILY_CAP } });
  const ne = await events(await handleAssistantPost(post({ message: "x" }), n.d));
  assert.deepEqual(n.calls[0].output_config, { effort: "medium" });
  assert.deepEqual(n.started, [[7, { deep: false }]]);
  assert.deepEqual(ne[ne.length - 1], { type: "done", reason: "end", left: ASSISTANT_DAILY_CAP - 11 });
  // Tek hak kaldı: derin analiz reddedilir (kapı açık kalır), olağan soru gider
  const one = deps({ statusValue: { state: "on", usedToday: ASSISTANT_DAILY_CAP - 1, cap: ASSISTANT_DAILY_CAP } });
  const r = await handleAssistantPost(post({ message: "x", deep: true }), one.d);
  assert.equal(r.status, 429);
  const body = (await r.json()) as { code: string; left: number; error: string };
  assert.equal(body.code, "deep_cap");
  assert.equal(body.left, 1);
  assert.match(body.error, /Derin analiz 2 soru sayılır; bugün 1 soru hakkı kaldı/);
  assert.equal(one.calls.length, 0);
  assert.equal(one.started.length, 0);
  assert.equal((await handleAssistantPost(post({ message: "x" }), one.d)).status, 200);
  // Aynı anda gelen soru hakkı yedi: start null → yine deep_cap (bir hak duruyorsa) ya da cap
  const raced = deps({ start: async () => null, statusValue: { state: "on", usedToday: 50, cap: ASSISTANT_DAILY_CAP } });
  const rr = await handleAssistantPost(post({ message: "x", deep: true }), raced.d);
  assert.equal(rr.status, 429);
  assert.equal(((await rr.json()) as { code: string }).code, "deep_cap");
});

test("derin analiz: araç turu sınırı 8 yerine 12; süre sınırları aynı", async () => {
  const rounds = async (deep: boolean) => {
    const calls: AssistantParams[] = [];
    const client: AssistantClient = {
      beta: {
        messages: {
          stream(params, options) {
            calls.push(structuredClone(params));
            const final = params.tool_choice?.type === "none";
            const content = final ? [text("Sonuç.")] : [{ type: "tool_use", id: `t${calls.length}`, name: "yok", input: {} } as Block];
            return scriptedStream(scriptedMessage({ content, stop_reason: final ? "end_turn" : "tool_use" }), { signal: options.signal });
          },
        },
      },
    };
    const out = await runAssistant(client, { system: "S", context: "C", tools: [], toolCtx: { base: "", now: new Date() }, history: [], message: "x", deep, emit: () => {} });
    return { out, calls };
  };
  const n = await rounds(false);
  assert.equal(n.calls.length, ASSISTANT_TIMING.maxToolRounds + 1);
  assert.equal(n.out.done, "limit");
  const d = await rounds(true);
  assert.equal(d.calls.length, ASSISTANT_DEEP.maxToolRounds + 1);
  assert.equal(ASSISTANT_DEEP.maxToolRounds, 12);
  assert.ok(d.calls.every((c) => (c.output_config as { effort: string }).effort === "high"));
  assert.equal(d.calls[d.calls.length - 1].tool_choice?.type, "none");
});

test("derin analiz: ekranda varsayılan kapalı, bir soruluk; hak 2'den azsa kapalı; maliyet notu kodda ve belgede", () => {
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /const \[deep, setDeep\] = useState\(false\);/);
  assert.match(w, /aria-pressed=\{deep\}/);
  assert.match(w, /disabled=\{busy \|\| !deepAllowed\}/);
  assert.match(w, /gate\.left >= ASSISTANT_DEEP_WEIGHT/);
  assert.match(w, /setDeep\(false\);/);
  assert.match(w, /\.\.\.\(asDeep \? \{ deep: true \} : \{\}\)/);
  assert.match(read("src/server/ai/assistant/loop.ts"), /Maliyet notu: high eforda/);
  const claude = read("src/server/ai/claude.ts");
  assert.match(claude, /case when \$\{s\.aiCalls\.effort\} = \$\{ASSISTANT_DEEP\.effort\} then \$\{ASSISTANT_DEEP\.weight\} else 1 end/);
  assert.match(claude, /if \(Number\(row\?\.n \?\? 0\) \+ weight > cap\) return null;/);
  assert.match(read("docs/ASISTAN.md"), /## Derin analiz/);
});
