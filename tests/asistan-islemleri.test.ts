// Panel asistanının işlemleri (docs/ASISTAN-ISLEMLER.md), veritabanısız: işlem araçlarının şemaları (model girdisi zod ile
// yeniden ayrıştırılır, fazla alan ve yanlış tür reddedilir), araç listesinde silme / toplu / şifreli işlem olmaması
// (kaynak taraması), sohbet ucunun hiçbir yazma eylemine uzanmaması, bir yanıtta tek kart, kartın akıştaki olayı, uçta
// kart olayı ve personel 403, tarayıcıdaki kart durumu ve geçmişe giden satırı, işlem rehberi. Veritabanıyla uçtan uca:
// tests/asistan-islemleri-db.test.ts. Çalıştırma: npx tsx --test tests/asistan-islemleri.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";

import { NAV_FOOTER, NAV_GROUPS } from "../src/components/panel/nav";
import { OP_GUIDES, searchGuides } from "../src/lib/assistant/guides";
import { OP_INPUTS, OP_NAMES, OP_SPECS, OP_TAIL, type OpName } from "../src/lib/assistant/op-specs";
import { cardExpired, cardHistoryLine, isOpCard, OP_EFFECTS, OP_TTL_MS, type OpCard } from "../src/lib/assistant/ops";
import { eventReader, historyForRequest, replyText, RESTORED_RUNNING, restoreCards, type AssistantEvent, type ChatMessage } from "../src/lib/assistant/protocol";
import { ToolInputError } from "../src/lib/mcp/answers/common";
import { handleAssistantPost, type AssistantDeps } from "../src/server/ai/assistant/handler";
import { runAssistant, type AssistantClient } from "../src/server/ai/assistant/loop";
import { CARDS_PER_REPLY, islemRehberi, opTools, type OpToolContext } from "../src/server/ai/assistant/op-tools";
import { contextBlock, SYSTEM_PROMPT } from "../src/server/ai/assistant/prompt";
import { scriptedMessage, scriptedStream } from "../src/server/ai/assistant/scripted";
import { toolParams } from "../src/server/ai/assistant/tool-adapter";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Yorum satırları atılmış kaynak */
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");

const card = (over: Partial<OpCard> = {}): OpCard => ({
  id: "11111111-2222-4333-8444-555555555555",
  tool: "urun_fiyati_degistir",
  title: "Latte M fiyatı 90 ₺ olacak",
  subject: "Latte M",
  branch: "Bütün şubeler (menü ortak)",
  day: "24 Kasım Salı 2026",
  lines: [{ label: "Satış fiyatı", from: "85 ₺", to: "90 ₺" }],
  effects: ["site", "lafpos"],
  undo: "Sonuç kartındaki Geri al eski fiyatı geri yazar.",
  undoable: true,
  warnings: [],
  note: null,
  expiresAt: new Date(Date.now() + OP_TTL_MS).toISOString(),
  ...over,
});

// ---------------------------------------------------------------- Şemalar

test("şema: her işlem aracının girdisi strict zod; fazla alan, yanlış tür, ileri biçim reddedilir", () => {
  assert.deepEqual([...OP_NAMES].sort(), Object.keys(OP_INPUTS).sort());
  assert.equal(OP_SPECS.length, 13);
  // Fazla alan (model "id" ya da "silinsin" eklese de) geçmez
  assert.equal(OP_INPUTS.urun_fiyati_degistir.safeParse({ urun: "Latte", yeniFiyat: 90, urunId: 5 }).success, false);
  assert.equal(OP_INPUTS.urun_fiyati_degistir.safeParse({ urun: "Latte", yeniFiyat: -1 }).success, false);
  assert.equal(OP_INPUTS.urun_fiyati_degistir.safeParse({ urun: "Latte", yeniFiyat: "90" }).success, false);
  assert.equal(OP_INPUTS.urun_fiyati_degistir.safeParse({ urun: "Latte", boy: "XL", yeniFiyat: 90 }).success, false);
  assert.equal(OP_INPUTS.urun_fiyati_degistir.safeParse({ urun: "Latte", boy: "M", yeniFiyat: 90 }).success, true);
  // Tarih takvimde olmalı
  assert.equal(OP_INPUTS.harcama_ekle.safeParse({ kategori: "Temizlik", tutar: 10, tarih: "2026-02-30" }).success, false);
  assert.equal(OP_INPUTS.harcama_ekle.safeParse({ kategori: "Temizlik", tutar: 0, tarih: "2026-11-20" }).success, false);
  // Ödenmedi yapmak bu araçla olmaz (yalnız ödendi ya da ödeme talebi)
  assert.equal(OP_INPUTS.fatura_odendi.safeParse({ tedarikci: "Sütaş", durum: "odenmedi" }).success, false);
  // Kasadan ödeme bu araçla olmaz (kasa raporuna satır açar)
  assert.equal(OP_INPUTS.tedarikci_odemesi_ekle.safeParse({ tedarikci: "Sütaş", tutar: 100, tarih: "2026-11-20", odemeSekli: "kasa", dagitim: "otomatik" }).success, false);
  // Zayi: ya ürün ya hammadde
  assert.equal(OP_INPUTS.zayi_ikram_ekle.safeParse({ tur: "zayi", miktar: 1 }).success, false);
  assert.equal(OP_INPUTS.zayi_ikram_ekle.safeParse({ tur: "zayi", urun: "Latte", hammadde: "Süt", miktar: 1 }).success, false);
  assert.equal(OP_INPUTS.zayi_ikram_ekle.safeParse({ tur: "zayi", urun: "Latte", boy: "M", miktar: 1 }).success, true);
  // Vardiya: tek kişi, en çok 7 gün
  const day = (i: number) => ({ gun: `2026-11-${String(23 + i).padStart(2, "0")}`, metin: "10-18" });
  assert.equal(OP_INPUTS.vardiya_hucre_yaz.safeParse({ kisi: "Ayşe", gunler: Array.from({ length: 8 }, (_, i) => day(i % 7)) }).success, false);
  assert.equal(OP_INPUTS.vardiya_hucre_yaz.safeParse({ kisi: "Ayşe", gunler: [] }).success, false);
  assert.equal(OP_INPUTS.vardiya_hucre_yaz.safeParse({ kisiler: ["Ayşe", "Ali"], gunler: [day(0)] }).success, false);
});

// ---------------------------------------------------------------- Kaynak taraması: silme, toplu, şifre yok

/** apply.ts'in çağırdığı eylemler (kaynak: @/server/actions/...) */
function importedActions(file: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of read(file).matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@\/server\/actions\/([^"]+)"/g)) {
    if (m[1]) continue;
    out[m[3]] = m[2]
      .split(",")
      .map((x) => x.trim().replace(/^type\s+/, ""))
      .filter((x) => x && !/^[A-Z]/.test(x))
      .sort();
  }
  return out;
}

test("kaynak: araç listesinde silme, toplu işlem ve şifre onayı yok; uygulayıcı yalnız izinli eylemleri çağırır", () => {
  // Araç adlarında silme / toplu yok
  for (const n of OP_NAMES) assert.doesNotMatch(n, /sil|kaldir|toplu|hepsi|delete|remove|bulk|parola|sifre/, n);
  // Uygulayıcının eylemleri: tam liste (yeni bir eylem eklenince bilerek güncellenir)
  assert.deepEqual(importedActions("src/server/assistant-ops/apply.ts"), {
    cari: ["saveSupplierPayment"],
    "cash-outs": ["saveCashOut"],
    expenses: ["saveExpenseEntry"],
    ingredients: ["setIngredientEstimate", "updateIngredientPrice"],
    invoices: ["restoreInvoicePayment", "setInvoicePayment"],
    log: ["logActivity"],
    "menu-status": ["setSoldOut"],
    parasut: ["saveProductLink"],
    products: ["updateProductPrice"],
    reminders: ["markReminderDone", "restoreReminder", "saveReminder", "setReminderActive"],
    vardiya: ["saveShiftWeekAction"],
    waste: ["addWasteEntry"],
  });
  const dir = "src/server/assistant-ops";
  for (const f of readdirSync(join(ROOT, dir))) {
    const src = code(`${dir}/${f}`);
    // Silen, toplu çalışan ve şifre onayı isteyen hiçbir şey çağrılmaz
    assert.doesNotMatch(src, /\b(delete[A-Z]\w*|remove[A-Z]\w*|forget[A-Z]\w*|unlink[A-Z]\w*|applyBulk\w*|saveProductLinks|undoPriceBatch|runParasutSync|requireStepUp|StepUp)\b/, f);
    assert.doesNotMatch(src, /\.delete\(/, f);
  }
  // Dizi alan eylemler tek elemana sabit
  const apply = code(`${dir}/apply.ts`);
  assert.match(apply, /setInvoicePayment\(\[args\.invoiceId\]/);
  assert.match(apply, /rows: \[\{ ref: args\.ref, name, cells \}\]/);
  assert.match(apply, /allocation: \{ mode: args\.mode, lines: \[\] \}/);
  // Hatırlatıcı: tek dönem (through yok); geri al hiçbir kaydı silmez (removeId yok)
  assert.match(apply, /markReminderDone\(args\.reminderId\);/);
  assert.match(apply, /restoreReminder\(args\.reminderId, prev as Parameters<typeof restoreReminder>\[1\]\)/);
  // Kasadan ödeme, kasa satırı ve fotoğraf yok
  assert.match(apply, /cashOut: null,/);
  assert.match(apply, /photoId: null,/);
  // Kişisel sırlar ve ayarlar araç listesinde yok
  for (const bad of ["saveSettings", "saveParasutSettings", "createAccessLink", "prepareBackupDownload", "changePasswordAction", "saveStaff", "saveRecipe", "saveInvoice("]) {
    for (const f of readdirSync(join(ROOT, dir))) assert.equal(code(`${dir}/${f}`).includes(bad), false, `${f}: ${bad}`);
  }
});

test("kaynak: sohbet ucu hiçbir yazma eylemine uzanmaz; yazım yalnız kartın sunucu eyleminde", () => {
  // Plan tarafı (sohbet ucunun çağırdıkları) eylem içe aktarmaz
  for (const f of ["plan.ts", "preview.ts", "store.ts", "resolve.ts", "types.ts"]) {
    const src = read(`src/server/assistant-ops/${f}`);
    assert.doesNotMatch(src, /from "@\/server\/actions\/(?!util")/, f);
    assert.doesNotMatch(src, /from "\.\/(apply|confirm)"/, f);
  }
  // Asistanın klasörü uygulayıcıya ve onaya uzanmaz
  for (const f of readdirSync(join(ROOT, "src/server/ai/assistant"))) {
    const src = read(`src/server/ai/assistant/${f}`);
    assert.doesNotMatch(src, /assistant-ops\/(apply|confirm)|actions\/assistant-ops/, f);
  }
  assert.match(read("src/server/ai/assistant/tools.ts"), /import \{ planOp \} from "@\/server\/assistant-ops\/plan";/);
  // Onay eylemi bir Server Action; onay, vazgeç ve geri al yalnız orada
  const action = read("src/server/actions/assistant-ops.ts");
  assert.match(action, /^"use server";/);
  for (const fn of ["confirmAssistantOp", "cancelAssistantOp", "undoAssistantOp"]) assert.match(action, new RegExp(`export async function ${fn}\\(opId: string\\)[\\s\\S]*?await requireUser\\(\\);`), fn);
  // Tüketim tek koşullu UPDATE: sahibi, durumu ve süresi aynı sorguda
  const store = code("src/server/assistant-ops/store.ts");
  assert.match(store, /eq\(s\.assistantOps\.id, id\), eq\(s\.assistantOps\.userId, userId\), eq\(s\.assistantOps\.status, "pending"\), gt\(s\.assistantOps\.expiresAt, now\)/);
  // Onayda: yeniden ayrıştırma, bayatlık, asistan bağlamı ve planın şubesi
  const confirm = code("src/server/assistant-ops/confirm.ts");
  for (const must of ["OP_INPUTS[name].safeParse(row.input)", "preview.args.safeParse", "preview.before.safeParse", "parts.preview.stale(", "runViaAssistant(", "withBranchScope(row.branch"]) {
    assert.ok(confirm.includes(must), must);
  }
  // İşlem geçmişi: asistan bağlamı dört yazıcıda
  assert.match(code("src/server/actions/log.ts"), /via: currentVia\(\)/);
  for (const f of ["src/server/closed-days.ts", "src/server/karaoke/timer.ts", "src/server/cash/report-store.ts"]) assert.match(code(f), /via: currentVia\(\)/, f);
});

// ---------------------------------------------------------------- Araçlar

function ctx(over: Partial<OpToolContext> = {}): OpToolContext & { emitted: OpCard[] } {
  const emitted: OpCard[] = [];
  return { base: "", now: new Date(), user: { id: 7, role: "admin" }, emitCard: (c) => emitted.push(c), cards: { count: 0 }, emitted, ...over };
}

test("araç: kart açar, Claude'a 'henüz hiçbir şey değişmedi' döner; bir yanıtta tek kart; personel açamaz; hata sayacı geri alır", async () => {
  const calls: { name: OpName; input: unknown }[] = [];
  const tools = opTools({
    plan: async (name, input) => {
      calls.push({ name, input });
      if ((input as { urun?: string }).urun === "Yok") throw new ToolInputError("Ürün bulunamadı");
      return card({ tool: name });
    },
  });
  assert.deepEqual(
    tools.map((t) => t.name),
    OP_NAMES,
  );
  for (const t of tools) assert.ok(t.description.endsWith(OP_TAIL), t.name);
  const price = tools.find((t) => t.name === "urun_fiyati_degistir")!;
  const c = ctx();
  const out = await price.run({ urun: "Latte", boy: "M", yeniFiyat: 90 }, c);
  assert.equal(c.emitted.length, 1);
  assert.match(String(out.durum), /henüz hiçbir şey değişmedi/);
  // Araç çıktısı yalnız durum verisi: talimat taşımaz (ne söyleneceği sistem isteminde ve aracın açıklamasında)
  assert.equal("talimat" in out, false);
  assert.match(OP_TAIL, /işlemin yapıldığını söyleme/);
  assert.deepEqual(out.satirlar, ["Satış fiyatı: 85 ₺ → 90 ₺"]);
  // İkinci kart aynı yanıtta açılmaz (toplu işlem yok)
  assert.equal(CARDS_PER_REPLY, 1);
  await assert.rejects(price.run({ urun: "Mocha", yeniFiyat: 95 }, c), (e: unknown) => e instanceof ToolInputError && /zaten bir onay kartı/.test(e.message));
  assert.equal(calls.length, 1);
  // Açılamayan kart sayılmaz: sıradaki açılabilir
  const c2 = ctx();
  await assert.rejects(price.run({ urun: "Yok", yeniFiyat: 90 }, c2), ToolInputError);
  assert.equal(c2.cards!.count, 0);
  await price.run({ urun: "Latte", yeniFiyat: 90 }, c2);
  assert.equal(c2.emitted.length, 1);
  // Personel kart açamaz (uç zaten 403 döner; araç da ikinci kez denetler)
  const staff = ctx({ user: { id: 9, role: "staff" } });
  await assert.rejects(price.run({ urun: "Latte", yeniFiyat: 90 }, staff), /yalnız yönetici/);
  assert.equal(staff.emitted.length, 0);
  // Süre sınırı ya da Durdur: geç gelen kart ekrana konmaz, hak hemen geri verilir (model aynı yanıtta yeniden dener)
  let finish: (() => void) | null = null;
  const slowTools = opTools({
    plan: (name) =>
      new Promise((resolve) => {
        finish = () => resolve(card({ tool: name }));
      }),
  });
  const slowPrice = slowTools.find((t) => t.name === "urun_fiyati_degistir")!;
  const stop = new AbortController();
  const c3 = { ...ctx(), signal: stop.signal };
  const late = slowPrice.run({ urun: "Latte", yeniFiyat: 90 }, c3);
  assert.equal(c3.cards!.count, 1);
  stop.abort();
  assert.equal(c3.cards!.count, 0, "hak süre dolunca geri verilir");
  finish!();
  await assert.rejects(late, /zamanında hazırlanamadı/);
  assert.equal(c3.emitted.length, 0, "geç kart ekrana konmaz");
  assert.equal(c3.cards!.count, 0, "hak iki kez geri verilmez");
});

test("araç listesi: okuma araçları önce ve strict; işlem araçları sonra (sığmayan strict'siz); rehber araç okur", async () => {
  const tools = [islemRehberi, ...opTools({ plan: async () => card() })];
  const params = toolParams(tools as never);
  assert.equal(params[0].name, "islem_rehberi");
  assert.equal(params[0].strict, true);
  for (const p of params) assert.equal((p.input_schema as { additionalProperties?: boolean }).additionalProperties, false, p.name);
  const r = await islemRehberi.run({ konu: "faturayı silmek istiyorum" }, { base: "", now: new Date() });
  const first = (r.rehberler as { konu: string; ekran: string }[])[0];
  assert.match(first.konu, /Silme/);
  const pw = await islemRehberi.run({ konu: "parolamı değiştir" }, { base: "", now: new Date() });
  assert.ok((pw.rehberler as { sifreOnayi?: string; ekran: string }[]).some((g) => g.ekran === "/panel/hesap" && g.sifreOnayi));
});

// ---------------------------------------------------------------- Döngü ve uç

type Msg = Anthropic.Beta.Messages.BetaMessage;
type Block = Msg["content"][number];
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input }) as Block;
const text = (t: string): Block => ({ type: "text", text: t, citations: null }) as Block;
const usage = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function client(script: (call: number) => Msg) {
  const sent: unknown[] = [];
  const c: AssistantClient = {
    beta: {
      messages: {
        stream(params, options) {
          sent.push(structuredClone(params));
          return scriptedStream(script(sent.length - 1), { signal: options.signal });
        },
      },
    },
  };
  return { c, sent };
}

test("döngü: işlem aracı kartı akışa koyar; araç sonucu tek mesajda, asistanın içeriği değişmeden geri gider", async () => {
  const { c, sent } = client((n) =>
    n === 0
      ? scriptedMessage({ content: [text("Kartı hazırlıyorum."), toolUse("t1", "urun_tukendi_yap", { urun: "Ice Latte" })], stop_reason: "tool_use", usage })
      : scriptedMessage({ content: [text("Kartı kontrol edip Onayla'ya basın.")], stop_reason: "end_turn", usage }),
  );
  const emitted: OpCard[] = [];
  const events: AssistantEvent[] = [];
  const tools = opTools({ plan: async (name) => card({ tool: name, title: "Ice Latte Tükendi yapılacak" }) });
  const out = await runAssistant(c, {
    system: SYSTEM_PROMPT,
    context: contextBlock({ today: "2026-11-24", branchLabel: "Tuzla" }),
    tools,
    toolCtx: { base: "", now: new Date(), user: { id: 7, role: "admin" }, emitCard: (k: OpCard) => emitted.push(k), cards: { count: 0 } } as OpToolContext,
    history: [],
    message: "Ice Latte bitti, tükendi yap",
    emit: (e) => events.push(e),
  });
  assert.equal(out.done, "end");
  assert.equal(emitted.length, 1);
  const second = sent[1] as { messages: { role: string; content: unknown }[] };
  const last = second.messages[second.messages.length - 1];
  assert.equal(last.role, "user");
  const results = last.content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[];
  assert.equal(results.length, 1);
  assert.equal(results[0].type, "tool_result");
  assert.match(results[0].content, /"kart":"gösterildi"/);
  assert.equal(results[0].is_error, undefined);
  const echoed = second.messages[second.messages.length - 2];
  assert.deepEqual(echoed, { role: "assistant", content: [text("Kartı hazırlıyorum."), toolUse("t1", "urun_tukendi_yap", { urun: "Ice Latte" })] });
});

test("uç: kart `card` olayıyla akar; personel 403 (kart açılmaz)", async () => {
  const { c } = client((n) =>
    n === 0
      ? scriptedMessage({ content: [toolUse("t1", "hatirlatici_ekle", { baslik: "Kira", tur: "kira", ilkTarih: "2026-12-01", tekrar: "monthly" })], stop_reason: "tool_use", usage })
      : scriptedMessage({ content: [text("Kart hazır.")], stop_reason: "end_turn", usage }),
  );
  const planned: number[] = [];
  const tools = opTools({
    plan: async (name, _input, ctx) => {
      planned.push(ctx.user!.id);
      return card({ tool: name, title: "Hatırlatıcı eklenecek: Kira" });
    },
  });
  const deps = (role: "admin" | "staff"): AssistantDeps => ({
    enabled: () => true,
    sameOrigin: () => true,
    user: async () => ({ id: role === "admin" ? 7 : 9, role }),
    status: async () => ({ state: "on", usedToday: 0, cap: 60 }),
    start: async () => 1,
    finish: async () => {},
    setup: async () => ({ client: c, tools, toolCtx: { base: "", now: new Date() }, context: "C", scoped: (fn) => fn() }),
  });
  const req = () => new Request("https://ladmin.laffogato.net/api/asistan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Kira hatırlatıcısı ekle" }) });
  const staff = await handleAssistantPost(req(), deps("staff"));
  assert.equal(staff.status, 403);
  assert.deepEqual(planned, []);
  const res = await handleAssistantPost(req(), deps("admin"));
  const r = eventReader();
  const events = [...r.push(await res.text()), ...r.end()];
  const cardEvent = events.find((e): e is Extract<AssistantEvent, { type: "card" }> => e.type === "card");
  assert.ok(cardEvent, "kart olayı");
  assert.equal(cardEvent.card.title, "Hatırlatıcı eklenecek: Kira");
  assert.deepEqual(planned, [7]);
  assert.equal(events[events.length - 1].type, "done");
});

// ---------------------------------------------------------------- Tarayıcı

test("tarayıcı: kart olayı doğrulanır; kartın durumu sekmede saklanır; geçmişe kısa satır gider", () => {
  const r = eventReader();
  const good = JSON.stringify({ type: "card", card: card() });
  const bad = JSON.stringify({ type: "card", card: { id: 1, title: "x" } });
  const evs = r.push(`${good}\n${bad}\n`);
  assert.equal(evs.length, 1, "biçimi bozuk kart atlanır");
  assert.equal(isOpCard(card()), true);
  assert.equal(isOpCard({ ...card(), lines: "x" }), false);
  // sessionStorage'dan: bozuk durum düşer
  const k = card();
  assert.deepEqual(restoreCards([{ card: k, status: "done", message: "Fiyat 90 ₺ oldu." }, { card: k, status: "uçtu" }, null]), [{ card: k, status: "done", message: "Fiyat 90 ₺ oldu." }]);
  assert.equal(restoreCards("x"), undefined);
  // İşlem sürerken kaydedilen kart takılı kalmaz: işleniyor → sonucu belirsiz, geri alınıyor → yapıldı; durum sunucudan
  // yeniden okunur (recheck); geçmişe "işleniyor" satırı gitmez
  const restored = restoreCards([
    { card: k, status: "running" },
    { card: k, status: "undoing", undoUntil: "2026-11-24T12:00:00.000Z" },
  ])!;
  assert.deepEqual(
    restored.map((c) => [c.status, c.recheck, c.undoUntil ?? null]),
    [
      ["unknown", true, null],
      ["done", true, "2026-11-24T12:00:00.000Z"],
    ],
  );
  assert.equal(restored[0].message, RESTORED_RUNNING);
  assert.doesNotMatch(replyText({ text: "", cards: restored }), /işleniyor|geri alınıyor/);
  // Geçmiş: yanıtın metni + kartın sonucu (asistan sonraki turda bilsin); kart tek başına da yanıt sayılır
  const msgs: ChatMessage[] = [
    { role: "user", text: "Latte M 90 olsun" },
    { role: "assistant", text: "Kartı hazırladım.", cards: [{ card: card(), status: "done", message: "Fiyat 90 ₺ oldu." }] },
    { role: "user", text: "Mocha da 95" },
    { role: "assistant", text: "", cards: [{ card: card({ title: "Mocha M fiyatı 95 ₺ olacak" }), status: "failed", message: "Değer değişti" }] },
  ];
  const h = historyForRequest(msgs);
  assert.equal(h.length, 4);
  assert.equal(h[1].text, "Kartı hazırladım.\n\n[Onay kartı: Latte M fiyatı 90 ₺ olacak — yapıldı]");
  assert.equal(h[3].text, "[Onay kartı: Mocha M fiyatı 95 ₺ olacak — yapılamadı (Değer değişti)]");
  assert.equal(cardHistoryLine({ card: card(), status: "cancelled" }), "[Onay kartı: Latte M fiyatı 90 ₺ olacak — vazgeçildi]");
  assert.equal(cardExpired(card({ expiresAt: new Date(Date.now() - 1).toISOString() })), true);
});

test("arayüz: kart Onayla / Vazgeç (≥ 44 px), dış etki rozetleri, geri alma yolu, süre; düğmeler sunucu eylemini çağırır", () => {
  const ui = read("src/components/panel/assistant/op-card.tsx");
  assert.match(ui, /^"use client";/);
  assert.match(ui, /from "@\/server\/actions\/assistant-ops"/);
  for (const must of ["Onayla", "Vazgeç", "Geri al", "Asistanın notu", "Geri alma:", "son geçerlilik", "min-h-11", "Dış etkiler"]) assert.ok(ui.includes(must), must);
  // Geri al yalnız katalogda tanımlı işlemde (kartın undoable'ı) ve süresi içinde
  assert.match(ui, /status === "done" && card\.undoable && !!state\.undoUntil/);
  for (const e of Object.values(OP_EFFECTS)) assert.ok(e.length > 2);
  const widget = read("src/components/panel/assistant/panel-assistant.tsx");
  assert.match(widget, /e\.type === "card"/);
  assert.match(widget, /<OpCardView key=\{c\.card\.id\}/);
});

// ---------------------------------------------------------------- Rehber

test("rehber: konular gerçek ekranlara gider; silme, toplu ve şifreli işler bulunur", () => {
  const hrefs = new Set([...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER].map((i) => i.href.split("#")[0]));
  for (const g of OP_GUIDES) {
    const path = g.path.split("#")[0];
    assert.ok(path === "/panel" || hrefs.has(path) || [...hrefs].some((h) => path.startsWith(`${h}/`)), `${g.topic}: ${g.path}`);
    assert.ok(g.steps.length >= 1 && g.steps.every((x) => x.length > 10) && g.why.length > 10, g.topic);
  }
  assert.match(searchGuides("bütün ürünlere toplu zam")[0].topic, /Toplu fiyat/);
  assert.match(searchGuides("faturayı ödenmedi yap")[0].topic, /ödenmedi/);
  assert.ok(searchGuides("yedek indir").some((g) => g.password));
  assert.deepEqual(searchGuides("zzzz"), []);
});

test("katalog belgesi: depoda, uygulanan araçlar 'uygula', eklenmeyenler 'henüz yok'", () => {
  const doc = read("docs/ASISTAN-ISLEMLER.md");
  for (const n of OP_NAMES) assert.ok(doc.includes(n), n);
  assert.match(doc, /henüz yok/);
  assert.match(doc, /assistant_ops/);
});
