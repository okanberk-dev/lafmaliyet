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
import { HistoryList } from "../src/components/panel/assistant/history-list";
import { MarkdownView } from "../src/components/panel/assistant/markdown-view";
import { VoiceButton } from "../src/components/panel/assistant/voice-button";
import { NAV_FOOTER, NAV_GROUPS, NAV_TREE } from "../src/components/panel/nav";
import { cleanFollowup, FOLLOWUP_MAX, restoreFollowups, splitFollowups } from "../src/lib/assistant/followups";
import {
  conversationTitle,
  forgetAssistantData,
  fromStored,
  HISTORY_MAX,
  historyKey,
  loadHistory,
  parseConversations,
  removeConversation,
  saveHistory,
  toStored,
  upsertConversation,
  type KeyValueStore,
} from "../src/lib/assistant/history";
import { markdownToPlain, parseInline, parseMarkdown, splitAmounts } from "../src/lib/assistant/markdown";
import type { OpCard } from "../src/lib/assistant/ops";
import { configureRecognition, mergeTranscript, speechErrorText, speechRecognitionCtor, transcriptOf, type SpeechRecognitionLike } from "../src/lib/assistant/speech";
import { DEFAULT_SUGGESTIONS, PAGE_SUGGESTIONS, pageContextLine, pageFromLocation, suggestionsFor } from "../src/lib/assistant/page-context";
import { ASSISTANT_DAILY_CAP, ASSISTANT_DEEP_WEIGHT, assistantRequest, eventReader, historyForRequest, type AssistantEvent, type ChatMessage } from "../src/lib/assistant/protocol";
import { handleAssistantPost, type AssistantDeps, type AssistantStatus } from "../src/server/ai/assistant/handler";
import { ASSISTANT_DEEP, ASSISTANT_EFFORT, ASSISTANT_MAX_TOKENS, ASSISTANT_TIMING, assistantParams, runAssistant, type AssistantClient, type AssistantOutcome, type AssistantParams } from "../src/server/ai/assistant/loop";
import { contextBlock, screenLines, SYSTEM_PROMPT } from "../src/server/ai/assistant/prompt";
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

// ---------------------------------------------------------------- 4. Sohbet geçmişi (cihazda)

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const CARD: OpCard = {
  id: "op_gizli_kimlik_123",
  tool: "urun_fiyati_degistir",
  title: "Latte M fiyatı",
  subject: "Latte M",
  branch: "Bütün şubeler",
  day: "24 Kasım 2026 Salı",
  lines: [{ label: "Fiyat", from: "85 ₺", to: "90 ₺" }],
  effects: ["site"],
  undo: "Kartın Geri al düğmesi (1 saat)",
  undoable: true,
  warnings: ["Kasada eski fiyat duruyor: GIZLI_UYARI"],
  note: "GIZLI_NOT modelin açıklaması",
  expiresAt: "2026-11-24T10:00:00Z",
} as OpCard;

test("geçmiş: kullanıcıya özel anahtar; yalnız görünen metin, kartın yalnız özeti (kimlik, satır, uyarı, not yok)", () => {
  assert.equal(historyKey(7), "lafm.asistan.gecmis.v1.7");
  assert.notEqual(historyKey(7), historyKey(8));
  const messages: ChatMessage[] = [
    { role: "user", text: "  Latte M 90 ₺ olsun\nlütfen  ", deep: true },
    { role: "assistant", text: "Kartı hazırladım.", cards: [{ card: CARD, status: "done", message: "GIZLI_SONUC", undoUntil: "2026-11-24T11:00:00Z" }], followups: ["Kâra etkisi ne?"] },
    { role: "assistant", text: "", note: "Durduruldu." },
  ];
  const stored = toStored(messages);
  assert.deepEqual(stored, [
    { role: "user", text: "Latte M 90 ₺ olsun\nlütfen" },
    { role: "assistant", text: "Kartı hazırladım.\n\n[Onay kartı: Latte M fiyatı — yapıldı]" },
    { role: "assistant", text: "", note: "Durduruldu." },
  ]);
  const json = JSON.stringify(stored);
  for (const secret of ["op_gizli_kimlik_123", "85 ₺", "GIZLI_UYARI", "GIZLI_NOT", "GIZLI_SONUC", "undoUntil", "Kâra etkisi", "urun_fiyati_degistir"]) assert.ok(!json.includes(secret), secret);
  // Geçmişten açılan sohbette kart yok (onaylanamaz); özet metnin içinde
  const back = fromStored({ id: "a", title: "x", updatedAt: "2026-11-24T09:00:00Z", messages: stored });
  assert.ok(back.every((m) => !("cards" in m)));
  assert.match(back[1].text, /\[Onay kartı: Latte M fiyatı — yapıldı\]$/);
  assert.equal(conversationTitle(messages), "Latte M 90 ₺ olsun lütfen");
  assert.equal(conversationTitle([{ role: "user", text: "x".repeat(200) }]).length, 60);
  assert.equal(conversationTitle([]), "Yeni sohbet");
});

test("geçmiş: en çok 10 sohbet, en yenisi başta, aynı sohbet bir kez; sorusuz sohbet saklanmaz; silme", () => {
  let list = [] as ReturnType<typeof upsertConversation>;
  for (let i = 0; i < 13; i++) list = upsertConversation(list, `s${i}`, [{ role: "user", text: `Soru ${i}` }, { role: "assistant", text: `Yanıt ${i}` }], new Date(Date.UTC(2026, 10, 24, 9, i)));
  assert.equal(list.length, HISTORY_MAX);
  assert.equal(HISTORY_MAX, 10);
  assert.deepEqual(list.slice(0, 2).map((c) => c.id), ["s12", "s11"]);
  assert.ok(!list.some((c) => c.id === "s0"));
  // Aynı sohbet güncellenince başa geçer, iki kez yazılmaz
  list = upsertConversation(list, "s5", [{ role: "user", text: "Soru 5" }, { role: "assistant", text: "Yeni yanıt" }]);
  assert.equal(list[0].id, "s5");
  assert.equal(list.filter((c) => c.id === "s5").length, 1);
  assert.equal(list.length, 10);
  assert.equal(upsertConversation([], "bos", []).length, 0);
  assert.equal(upsertConversation([], "bos", [{ role: "assistant", text: "Merhaba" }]).length, 0);
  // Uzun sohbet: son 40 mesaj
  const long = Array.from({ length: 60 }, (_, i): ChatMessage => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` }));
  assert.equal(upsertConversation([], "uzun", long)[0].messages.length, 40);
  assert.equal(removeConversation(list, "s5").length, 9);
});

test("geçmiş: depo kullanıcıya özel; bozuk veri düşer; çıkışta silinir; depo kapalıysa sessiz", () => {
  const store = memoryStore();
  saveHistory(store, 7, upsertConversation([], "a1", [{ role: "user", text: "Benim sorum" }]));
  assert.equal(loadHistory(store, 7).length, 1);
  assert.equal(loadHistory(store, 8).length, 0, "başka yönetici görmez");
  assert.deepEqual([...store.data.keys()], ["lafm.asistan.gecmis.v1.7"]);
  // Bozuk kayıtlar
  assert.deepEqual(parseConversations("{bozuk"), []);
  assert.deepEqual(parseConversations(JSON.stringify({ a: 1 })), []);
  const parsed = parseConversations(
    JSON.stringify([
      { id: "<script>", title: "x", updatedAt: "2026", messages: [{ role: "user", text: "a" }] },
      { id: "ok-1", title: "<b>Başlık</b>", updatedAt: "2026-11-24T09:00:00Z", messages: [{ role: "system", text: "x" }, { role: "user", text: "Soru", cards: [{ card: CARD }] }] },
      { id: "ok-1", title: "kopya", updatedAt: "2026", messages: [{ role: "user", text: "b" }] },
      { id: "bos", title: "t", updatedAt: "2026", messages: [] },
    ]),
  );
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].messages, [{ role: "user", text: "Soru" }], "kart ve tanınmayan rol düşer");
  // Başlık ekranda React yazısı (HTML çizilmez)
  const html = renderToStaticMarkup(createElement(HistoryList, { items: parsed, activeId: "ok-1", onOpen: () => {}, onDelete: () => {}, onBack: () => {} }));
  assert.doesNotMatch(html, /<b>Başlık/);
  assert.match(html, /&lt;b&gt;Başlık&lt;\/b&gt;/);
  assert.match(html, /aria-label="Sil: &lt;b&gt;Başlık&lt;\/b&gt;"/);
  assert.match(html, /max-lg:size-11/);
  // Çıkış: bu kullanıcının geçmişi ve etkin sohbeti gider, başkasınınki kalır
  const session = memoryStore();
  session.setItem("lafm.asistan.v1.7", "[]");
  session.setItem("lafm.asistan.v1.7.id", "a1");
  saveHistory(store, 8, upsertConversation([], "b1", [{ role: "user", text: "Öteki" }]));
  forgetAssistantData(7, [store, session, null]);
  assert.equal(loadHistory(store, 7).length, 0);
  assert.equal(loadHistory(store, 8).length, 1);
  assert.equal(session.data.size, 0);
  // Depo fırlatırsa (gizli sekme) sessiz
  const broken: KeyValueStore = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  assert.deepEqual(loadHistory(broken, 7), []);
  saveHistory(broken, 7, parsed);
  forgetAssistantData(7, [broken]);
});

test("geçmiş: ekranda Geçmiş düğmesi, sunucuya yine yalnız etkin sohbetin turları; çıkışta silinir", () => {
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /aria-label="Sohbet geçmişi"/);
  assert.match(w, /saveHistory\(store, userId, upsertConversation\(loadHistory\(store, userId\), convId, messages\)\)/);
  assert.match(w, /if \(busy \|\| !convId \|\| messages === initialMessages\.current\) return;/);
  assert.match(w, /const history = historyForRequest\(base\);/);
  assert.match(w, /base: ChatMessage\[\] = messages/);
  assert.match(w, /window\.localStorage/);
  assert.match(code("src/components/panel/sidebar.tsx"), /forgetAssistantData\(user\.id, \[safeStore\("localStorage"\), safeStore\("sessionStorage"\)\]\)/);
});

// ---------------------------------------------------------------- 5. Sesle soru

test("ses: tanıyıcı yoksa null (düğme çizilmez); Türkçe, ara sonuç, tek cümle", () => {
  assert.equal(speechRecognitionCtor({}), null);
  assert.equal(speechRecognitionCtor(null), null);
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: "değil" }), null);
  class Fake {}
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: Fake }), Fake);
  assert.equal(speechRecognitionCtor({ SpeechRecognition: Fake, webkitSpeechRecognition: class {} }), Fake);
  const r = configureRecognition({} as SpeechRecognitionLike);
  assert.deepEqual({ lang: r.lang, interimResults: r.interimResults, continuous: r.continuous, maxAlternatives: r.maxAlternatives }, { lang: "tr-TR", interimResults: true, continuous: false, maxAlternatives: 1 });
  // Sunucuda (ve hidrasyonda) tarayıcı bilinmez: düğme hiç çizilmez
  assert.equal(renderToStaticMarkup(createElement(VoiceButton, { value: "", onChange: () => {}, onNote: () => {} })), "");
});

test("ses: tanınan metin kutudakinin sonuna yazılır, gönderilmez; sınırda kesilir; hata notu kısa", () => {
  assert.equal(mergeTranscript("", "dün kasa tuttu mu"), "Dün kasa tuttu mu");
  assert.equal(mergeTranscript("Marina'da ", "  dün kasa\ntuttu mu "), "Marina'da dün kasa tuttu mu");
  assert.equal(mergeTranscript("Soru", ""), "Soru");
  assert.equal(mergeTranscript("", "ışık").charAt(0), "I", "Türkçe büyük harf");
  assert.equal(mergeTranscript("x".repeat(3999), "uzun konuşma").length, 4000);
  assert.equal(transcriptOf([Object.assign([{ transcript: "dün kasa" }], { isFinal: true }), Object.assign([{ transcript: " tuttu mu" }], { isFinal: false })]), "dün kasa tuttu mu");
  assert.match(speechErrorText("not-allowed")!, /Mikrofon izni/);
  assert.equal(speechErrorText("no-speech"), null);
  assert.equal(speechErrorText("aborted"), null);
  // Ses sunucuya gitmez: düğme yalnız metni kutuya yazar, istek atmaz; yalnız telefonda
  const v = code("src/components/panel/assistant/voice-button.tsx");
  assert.doesNotMatch(v, /fetch\(|XMLHttpRequest|MediaRecorder|getUserMedia|send\(/);
  assert.match(v, /rec\.onresult = \(e\) => onChange\(mergeTranscript\(base, transcriptOf\(e\.results\)\)\);/);
  assert.match(v, /if \(!supported\) return null;/);
  assert.match(v, /inline-flex size-11 shrink-0/);
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /\{sheet \? <VoiceButton value=\{input\} onChange=\{setInput\} onNote=\{setVoiceNote\} disabled=\{blocked \|\| busy\} \/> : null\}/);
});

// ---------------------------------------------------------------- 6. Tablo, sayı vurgusu, Kopyala, Yeniden sor, ⌘J

const md = (text: string) => renderToStaticMarkup(createElement(MarkdownView, { text }));

test("tablo: telefonda yatay kayan kap; hücrede HTML ve tehlikeli bağlantı çizilmez (XSS)", () => {
  const html = md(
    [
      "| Ürün | Ciro | Pay |",
      "|---|---:|---:|",
      "| <img src=x onerror=alert(1)> | 12.450,50 ₺ | %12,5 |",
      "| [Tıkla](javascript:alert(1)) | <script>alert(1)</script> | [Kasa](/panel/kasa) |",
      "| \"><svg onload=alert(1)> | [x](data:text/html,1) | [y](//kotu.site) |",
    ].join("\n"),
  );
  assert.match(html, /<div class="[^"]*overflow-x-auto[^"]*"><table/);
  assert.doesNotMatch(html, /<img|<script|<svg|javascript:|data:text|href="\/\/kotu/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a [^>]*href="\/panel\/kasa"/, "panel bağlantısı kalır");
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  // Sağa hizalı sayı sütunu, tutar ve yüzde vurgulu
  assert.match(html, /<td class="[^"]*text-right[^"]*"><span class="[^"]*font-semibold whitespace-nowrap[^"]*" data-num="true">12\.450,50 ₺<\/span>/);
  const t = parseMarkdown("| a | b |\n|---|---|\n| 1 |")[0];
  assert.equal(t.t, "table");
});

test("sayı vurgusu: ₺ ve yüzde ayrı düğüm; tarih, saat, adet ve kelime içi rakam değil; kod içinde değil", () => {
  const nums = (s: string) => splitAmounts(s).filter((n) => n.t === "num").map((n) => (n as { v: string }).v);
  assert.deepEqual(nums("Ciro 12.450,50 ₺, gider ₺3.200 ve −1.250 ₺ fark; marj %12,5, düşüş -3,2% ve % 8."), ["12.450,50 ₺", "₺3.200", "−1.250 ₺", "%12,5", "-3,2%", "% 8"]);
  assert.deepEqual(nums("24.11.2026 saat 14:30, 3 adet, A4 kâğıt, 2026 yılı"), []);
  assert.deepEqual(nums("85 TL"), ["85 TL"]);
  assert.deepEqual(nums("v2%"), [], "kelimeye yapışık değil");
  assert.deepEqual(parseInline("`90 ₺`"), [{ t: "code", v: "90 ₺" }]);
  assert.deepEqual(parseInline("**90 ₺** oldu"), [{ t: "strong", c: [{ t: "num", v: "90 ₺" }] }, { t: "text", v: " oldu" }]);
  const html = md("Latte M 90 ₺ oldu (%5,9 artış).");
  assert.match(html, /<span class="font-semibold whitespace-nowrap text-ink tabular-nums" data-num="true">90 ₺<\/span>/);
  assert.match(html, /data-num="true">%5,9<\/span>/);
});

test("Kopyala: düz metin (bağlantının etiketi, işaretsiz, madde ve tablo); Yeniden sor son soruyu bir kez yollar; ⌘J", () => {
  const plain = markdownToPlain("## Özet\n\n**Ciro** 12.450 ₺ — [Kasa](/panel/kasa).\n\n- bir\n- iki\n\n1. ilk\n2. ikinci\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(plain, "Özet\n\nCiro 12.450 ₺ — Kasa.\n\n• bir\n• iki\n\n1. ilk\n2. ikinci\n\na | b\n1 | 2");
  assert.equal(markdownToPlain("<b>yok</b> [x](javascript:void)"), "<b>yok</b> x", "tehlikeli bağlantı yalnız etiket");
  const w = code("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(w, /navigator\.clipboard\.writeText\(markdownToPlain\(text\)\)/);
  // Yeniden sor: son soru ve yanıtı çıkar, geçmiş ondan kurulur (aynı soru iki kez gitmez)
  assert.match(w, /void send\(messages\[at\]\.text, messages\.slice\(0, at\)\);/);
  assert.match(w, /const history = historyForRequest\(base\);/);
  assert.match(w, /i === messages\.length - 1 && !blocked \? \(\s*<button[^>]*onClick=\{retry\}/);
  // Eylem düğmeleri telefonda 44 px
  assert.equal((w.match(/max-lg:h-11 max-lg:px-2\.5 max-lg:text-\[13px\] pointer-coarse:h-11/g) ?? []).length, 2);
  // ⌘J / Ctrl+J yalnız masaüstünde, açar ve kapatır
  assert.match(w, /if \(sheet\) return;\s*const onKey = \(e: globalThis\.KeyboardEvent\) => \{\s*if \(!\(e\.metaKey \|\| e\.ctrlKey\) \|\| e\.altKey \|\| e\.shiftKey \|\| e\.key\.toLowerCase\(\) !== "j"/);
  assert.match(w, /e\.preventDefault\(\);\s*toggleAssistant\(\);/);
  assert.match(w, /aria-keyshortcuts="Meta\+J Control\+J"/);
});

// ---------------------------------------------------------------- 7. Sistem istemi

test("sistem istemi: araç seçimi, önce veri sonra sonuç, tablo ölçüsü, rakam uydurmama, belirsizlikte soru, rehber, tek kart", () => {
  for (const must of [
    "Hangi soru hangi araç",
    "önce gereken veriyi topla, sonra yaz",
    "birbirinden bağımsız araçları aynı turda birlikte çağır",
    "Örnek birleşimler: kâr düşüşü → ay_ozeti (bu ay ve geçen ay) + zam_etkisi",
    "en çok 4 sütun ve 8 satır, sayı sütunları sağa hizalı",
    "Veri uydurma",
    "Araç çıktısında olmayan bir rakamı",
    "hangi iki rakamdan hesapladığınla birlikte yaz",
    "tek kısa soru sor",
    "Araç birden çok aday döndürdüyse adayları göster, tahmin etme",
    "Yöneticinin açık ekranı",
    "islem_rehberi",
    "bir yanıtta en çok BİR işlem aracı çağır",
    "Kart açıldı diye işlemin yapıldığını asla söyleme",
    "<takip>",
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(must), must);
  }
  // Ölçülü: önbelleğe alınacak kadar uzun, 30 bin karakterin altında
  assert.ok(SYSTEM_PROMPT.length > 15_000 && SYSTEM_PROMPT.length < 30_000, String(SYSTEM_PROMPT.length));
});

test("önbellek öneki bayt bayt sabit: sayfa, şube, gün, derin analiz ve son tur önü değiştirmez; değişken bilgi istemde yok", () => {
  const msgs = [{ role: "user" as const, content: "x" }];
  const variants = [
    assistantParams({ system: SYSTEM_PROMPT, context: contextBlock({ today: "2026-11-24", branchLabel: "Tümü" }), tools: [], messages: msgs }),
    assistantParams({ system: SYSTEM_PROMPT, context: `${contextBlock({ today: "2026-12-31", branchLabel: "Marina" })}\n${pageContextLine({ path: "/panel/kasa", month: "2026-12" })}`, tools: [], messages: msgs, deep: true }),
    assistantParams({ system: SYSTEM_PROMPT, context: contextBlock({ today: "2027-01-01", branchLabel: "Tuzla" }), tools: [], messages: msgs, final: true }),
  ];
  const first = JSON.stringify(systemOf(variants[0])[0]);
  for (const v of variants) {
    assert.equal(JSON.stringify(systemOf(v)[0]), first, "sabit blok ve işareti aynı");
    assert.equal(systemOf(v).length, 2);
    assert.equal(systemOf(v)[1].cache_control, undefined, "değişken blok işaretsiz, sonda");
  }
  // İstemde değişen hiçbir şey yok: tarih, ay adı + yıl, şube seçimi, açık ekran satırı, efor
  assert.doesNotMatch(SYSTEM_PROMPT, /\b20\d\d-\d\d-\d\d\b/);
  assert.doesNotMatch(SYSTEM_PROMPT, /Panelde seçili şube|Yöneticinin açık ekranı: |Bugün: \d/);
  // Ekran listesi menüden hesaplanır, sıra sabit: istem her yüklemede aynı
  assert.ok(SYSTEM_PROMPT.includes(screenLines().join("\n")));
});
