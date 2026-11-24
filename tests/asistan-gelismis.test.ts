// Panel asistanının gelişmiş özellikleri (docs/ASISTAN.md), sahte istemciyle: sayfa bağlamı ve ekrana özel öneriler,
// takip önerileri, derin analiz (efor ve sınır sayımı), cihazdaki sohbet geçmişi, sesle soru, yanıtta tablo ve sayı
// vurgusu, kopyala / yeniden sor / ⌘J ve sistem isteminin yönergeleri. Anahtar gerekmez; ağ yok.
// Çalıştırma: npx tsx --test tests/asistan-gelismis.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { NAV_FOOTER, NAV_GROUPS, NAV_TREE } from "../src/components/panel/nav";
import { DEFAULT_SUGGESTIONS, PAGE_SUGGESTIONS, pageContextLine, pageFromLocation, suggestionsFor } from "../src/lib/assistant/page-context";
import { ASSISTANT_DAILY_CAP, assistantRequest, eventReader, type AssistantEvent } from "../src/lib/assistant/protocol";
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
