// Vardiyayı yazarak doldurma (docs/VARDIYA.md "Yazarak doldurma"): modelin atamalarının ızgara hücrelerine çevrilmesi
// (hazır vardiya, izin, saat, boşaltma, herkes, yeni kişi, sıra, okunamayan atama), taslağın ızgaraya uygulanması, isteğin
// biçimi (yalnız metin; görsel yok), yanıtın şeması (yapılandırılmış çıktıya sığar), sahte istemciyle uçtan uca okuma,
// yöneticinin göreceği hata metinleri ve bağlantılar (eylem yalnız yönetici, kayıt yok, günlük sınır ayrı).
// Anahtar gerekmez; ağ yok. Çalıştırma: npx tsx --test tests/vardiya-taslak.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { claudeSchema, fitsStructuredOutputs, schemaComplexity } from "../src/lib/photo-read/claude-schema";
import { nameRef, userRef } from "../src/lib/vardiya";
import {
  applyDraft,
  DRAFT_DAYS,
  draftPeople,
  draftSummary,
  draftToCells,
  draftWeekSchema,
  SHIFT_DRAFT_DAILY_CAP,
  SHIFT_DRAFT_SYSTEM,
  SHIFT_PROMPT_MAX,
  ShiftDraftRaw,
  shiftDraftTask,
} from "../src/lib/vardiya-taslak";
import { replayShiftAnswer } from "../src/server/ai/replay";
import { AI_FALLBACK_BETA, AI_MODEL, aiErrorText, buildRequest, runExtraction, type AiClient, type AiErrorCode, type CreateParams } from "../src/server/ai/run";

const ROOT = join(__dirname, "..");
const src = (path: string) => readFileSync(join(ROOT, path), "utf8");

const EMPTY = Array<string>(7).fill("");
const rows = [
  { ref: userRef(2), userId: 2, name: "Ayşe Yılmaz", cells: EMPTY },
  { ref: userRef(3), userId: 3, name: "Mehmet Kaya", cells: ["09:00–18:00", "", "", "", "", "", ""] },
  { ref: nameRef("Zeynep"), userId: null, name: "Zeynep", cells: EMPTY },
];
const people = draftPeople(rows);
const tuzla = { branch: { id: "tuzla", name: "Tuzla" }, people };
const WEEK = ["mon", "tue", "wed", "thu", "fri"] as const;
type Assignment = ShiftDraftRaw["assignments"][number];
const a = (over: Partial<Assignment> & Pick<Assignment, "person" | "days" | "shift">): Assignment => ({ newName: null, start: null, end: null, note: null, ...over });
const cellsOf = (r: ReturnType<typeof draftToCells>, ref: string) =>
  Array.from({ length: 7 }, (_, day) => r.cells.find((c) => c.ref === ref && c.day === day)?.text ?? null);

test("kişi listesi: ızgaranın sırasıyla p1, p2, …; ad kırpılır", () => {
  assert.deepEqual(
    people.map((p) => [p.key, p.name, p.ref]),
    [
      ["p1", "Ayşe Yılmaz", "u:2"],
      ["p2", "Mehmet Kaya", "u:3"],
      ["p3", "Zeynep", "n:zeynep"],
    ],
  );
  assert.equal(draftPeople([{ ref: "n:x", userId: null, name: "  Ali   Can ", cells: EMPTY }])[0].name, "Ali Can");
});

test("hazır vardiyalar şubenin saatleriyle yazılır: Tuzla ve Marina ayrı", () => {
  const raw = { assignments: [a({ person: "p1", days: [...WEEK], shift: "morning" }), a({ person: "p2", days: ["sat", "sun"], shift: "evening" })], unclear: null };
  const t = draftToCells(raw, tuzla);
  assert.deepEqual(cellsOf(t, "u:2"), ["09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", "09:00–18:00", null, null]);
  assert.deepEqual(cellsOf(t, "u:3").slice(5), ["16:00–01:00", "16:00–01:00"]);
  assert.deepEqual([t.added, t.skipped, t.unclear], [[], [], null]);
  const m = draftToCells(raw, { branch: { id: "marina", name: "Marina" }, people });
  assert.equal(cellsOf(m, "u:2")[0], "09:30–18:30");
  assert.equal(cellsOf(m, "u:3")[5], "13:00–22:00");
});

test("izin, başka saat (gece yarısını geçen dahil), not ve boşaltma", () => {
  const r = draftToCells(
    {
      assignments: [
        a({ person: "p3", days: ["tue"], shift: "off" }),
        a({ person: "p3", days: ["wed"], shift: "off", note: "rapor" }),
        a({ person: "p1", days: ["fri"], shift: "hours", start: "12:00", end: "20:00", note: "kasa" }),
        a({ person: "p1", days: ["sat"], shift: "hours", start: "18.00", end: "02.00" }),
        a({ person: "p2", days: ["mon"], shift: "clear" }),
        a({ person: "p2", days: ["tue"], shift: "morning", note: "açılış" }),
      ],
      unclear: null,
    },
    tuzla,
  );
  assert.deepEqual(cellsOf(r, "n:zeynep").slice(1, 3), ["İzin", "İzin · rapor"]);
  assert.equal(cellsOf(r, "u:2")[4], "12:00–20:00 · kasa");
  assert.equal(cellsOf(r, "u:2")[5], "18:00–02:00");
  // Boşaltma boş metinle gelir (kutu silinir); hazır vardiyaya not eklenir
  assert.deepEqual(cellsOf(r, "u:3").slice(0, 2), ["", "09:00–18:00 · açılış"]);
  assert.deepEqual(r.skipped, []);
});

test("herkes ve sıra: sonraki atama öncekinin üstüne yazar", () => {
  const r = draftToCells(
    {
      assignments: [a({ person: "all", days: ["sat", "sun"], shift: "evening" }), a({ person: "p1", days: ["sun"], shift: "off" }), a({ person: "p1", days: ["sun", "sun"], shift: "morning" })],
      unclear: null,
    },
    tuzla,
  );
  assert.equal(r.cells.length, 6);
  assert.deepEqual(cellsOf(r, "u:2").slice(5), ["16:00–01:00", "09:00–18:00"]);
  assert.deepEqual(cellsOf(r, "n:zeynep").slice(5), ["16:00–01:00", "16:00–01:00"]);
});

test("yeni kişi: adıyla eklenir; adı bir hesabınkiyse o hesabın satırı; listedeki ad yeniden eklenmez", () => {
  const raw = {
    assignments: [
      a({ person: "", newName: "Can", days: ["fri"], shift: "morning" }),
      a({ person: "", newName: "okan demir", days: ["mon"], shift: "evening" }),
      a({ person: "", newName: "ZEYNEP", days: ["mon"], shift: "morning" }),
      // Yeni eklenen kişi sonraki "herkes"e girer
      a({ person: "all", days: ["sun"], shift: "off" }),
    ],
    unclear: null,
  };
  const r = draftToCells(raw, tuzla, [{ id: 9, name: "Okan Demir" }]);
  assert.deepEqual(r.added, [
    { ref: "n:can", userId: null, name: "Can" },
    { ref: "u:9", userId: 9, name: "Okan Demir" },
  ]);
  assert.equal(cellsOf(r, "n:can")[4], "09:00–18:00");
  assert.equal(cellsOf(r, "u:9")[0], "16:00–01:00");
  assert.equal(cellsOf(r, "n:zeynep")[0], "09:00–18:00");
  assert.deepEqual([cellsOf(r, "n:can")[6], cellsOf(r, "u:9")[6], cellsOf(r, "u:2")[6]], ["İzin", "İzin", "İzin"]);
});

test("işlenemeyenler yazılmaz, yöneticinin okuyacağı cümleyle döner", () => {
  const r = draftToCells(
    {
      assignments: [
        a({ person: "p9", days: ["mon"], shift: "morning" }),
        a({ person: "p1", days: ["mon"], shift: "hours", start: "akşam", end: null }),
        a({ person: "p1", days: ["tue"], shift: "hours", start: "08:00", end: "08:00" }),
        a({ person: "p1", days: ["wed"], shift: "hours", start: "06:00", end: "23:30" }),
        a({ person: "p2", days: [], shift: "morning" }),
        a({ person: "", newName: "Ece", days: ["mon"], shift: "hours", start: "25:00", end: "26:00" }),
      ],
      unclear: "  Perşembe   hangi hafta anlaşılamadı. ",
    },
    tuzla,
  );
  assert.deepEqual(r.cells, []);
  // Hücresi kalmayan yeni kişi satır olmaz
  assert.deepEqual(r.added, []);
  assert.equal(r.unclear, "Perşembe hangi hafta anlaşılamadı.");
  assert.equal(r.skipped.length, 5);
  assert.match(r.skipped[0], /tanınamadı/);
  assert.match(r.skipped[1], /^Ayşe Yılmaz, Pazartesi: saatleri anlaşılamadı\.$/);
  assert.match(r.skipped[2], /Salı: Bitiş başlangıçla aynı olamaz/);
  assert.match(r.skipped[3], /Çarşamba: Vardiya 16 saatten uzun olamaz/);
  assert.match(r.skipped[4], /^Ece, Pazartesi: saatleri anlaşılamadı\.$/);
});

test("hazır vardiyası olmayan şubede sabahçı / akşamcı yazılmaz; saat ve izin yazılır", () => {
  const ctx = { branch: { id: "depo", name: "Depo" }, people };
  const r = draftToCells({ assignments: [a({ person: "p1", days: ["mon"], shift: "morning" }), a({ person: "p1", days: ["tue"], shift: "hours", start: "10:00", end: "18:00" }), a({ person: "p1", days: ["wed"], shift: "off" })], unclear: null }, ctx);
  assert.deepEqual(cellsOf(r, "u:2").slice(0, 3), [null, "10:00–18:00", "İzin"]);
  assert.match(r.skipped[0], /hazır sabahçı vardiyası yok/);
});

test("kişi sınırı: fazladan yeni kişi eklenmez; not 40 karakterde kesilir", () => {
  const many = draftPeople(Array.from({ length: 60 }, (_, i) => ({ ref: `n:k${i}`, userId: null, name: `Kişi ${i}`, cells: EMPTY })));
  const full = draftToCells({ assignments: [a({ person: "", newName: "Yeni", days: ["mon"], shift: "off" })], unclear: null }, { branch: tuzla.branch, people: many });
  assert.deepEqual([full.cells, full.added], [[], []]);
  assert.match(full.skipped[0], /en çok 60 kişi/);
  const long = draftToCells({ assignments: [a({ person: "p1", days: ["mon"], shift: "morning", note: "x".repeat(80) })], unclear: null }, tuzla);
  assert.equal(cellsOf(long, "u:2")[0], `09:00–18:00 · ${"x".repeat(40)}`);
});

test("taslak ızgaraya uygulanır: değişen kutu sayılır, yeni kişi sona eklenir, kaynak satırlar değişmez", () => {
  const grid = [
    { ref: "u:2", userId: 2, name: "Ayşe Yılmaz", texts: ["09:00–18:00", "", "", "", "", "", ""] },
    { ref: "u:3", userId: 3, name: "Mehmet Kaya", texts: [...EMPTY] },
  ];
  const draft = {
    cells: [
      { ref: "u:2", day: 0, text: "09:00–18:00" },
      { ref: "u:2", day: 1, text: "İzin" },
      { ref: "u:3", day: 0, text: "16:00–01:00" },
      { ref: "n:can", day: 4, text: "09:00–18:00" },
      { ref: "u:77", day: 0, text: "İzin" },
      { ref: "u:2", day: 9, text: "İzin" },
    ],
    added: [{ ref: "n:can", userId: null, name: "Can" }],
  };
  const out = applyDraft(grid, draft);
  // Aynı metin değişiklik sayılmaz; satırı olmayan kişi ve hafta dışı gün yok sayılır
  assert.deepEqual([out.changed, out.people], [3, 1]);
  assert.deepEqual(out.rows.map((r) => r.ref), ["u:2", "u:3", "n:can"]);
  assert.deepEqual(out.rows[0].texts.slice(0, 2), ["09:00–18:00", "İzin"]);
  assert.deepEqual([(out.rows[2] as { added?: boolean }).added, out.rows[2].texts[4]], [true, "09:00–18:00"]);
  assert.deepEqual(grid[0].texts.slice(0, 2), ["09:00–18:00", ""]);
  assert.equal(draftSummary(3, 1), "3 kutu değişti · 1 kişi eklendi");
  assert.equal(draftSummary(12, 0), "12 kutu değişti");
  // Boşaltma: dolu kutu boşalır ve değişiklik sayılır
  assert.equal(applyDraft(grid, { cells: [{ ref: "u:2", day: 0, text: "" }], added: [] }).changed, 1);
});

test("görev metni: şube, haftanın takvimi, hazır saatler, kişiler anahtarıyla, o anki plan ve yöneticinin metni", () => {
  const task = shiftDraftTask({ ...tuzla, monday: "2026-11-23", today: "2026-11-22" }, "Ayşe hafta içi sabahçı");
  assert.match(task, /^Branch: Tuzla$/m);
  assert.match(task, /mon=2026-11-23, tue=2026-11-24, .*sun=2026-11-29/);
  assert.match(task, /^Today: 2026-11-22$/m);
  assert.match(task, /morning \(sabahçı\) 09:00–18:00; evening \(akşamcı\) 16:00–01:00/);
  assert.match(task, /^p1: Ayşe Yılmaz\np2: Mehmet Kaya\np3: Zeynep$/m);
  assert.match(task, /Current plan \(filled cells only\):\np2 mon: 09:00–18:00/);
  assert.match(task, /<instruction>\nAyşe hafta içi sabahçı\n<\/instruction>$/);
  // Kişinin yalnız adı gider: anahtar, e-posta, hesap kimliği yok
  assert.doesNotMatch(task, /u:2|u:3|n:zeynep|@/);
  const empty = shiftDraftTask({ branch: { id: "depo", name: "Depo" }, people: [], monday: "2026-11-23", today: "2026-11-23" }, "x");
  assert.match(empty, /Preset shifts: none/);
  assert.match(empty, /People: nobody/);
  assert.match(empty, /Current plan: every cell is empty/);
  assert.deepEqual([...DRAFT_DAYS], ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
});

test("girdi: metin kırpılır, çok kısa ve çok uzun metin reddedilir", () => {
  const base = { branchId: "tuzla", week: "2026-11-23", rows: [] };
  assert.equal(draftWeekSchema.parse({ ...base, prompt: "  Ayşe sabahçı \r\n" }).prompt, "Ayşe sabahçı");
  assert.equal(draftWeekSchema.safeParse({ ...base, prompt: " a " }).success, false);
  assert.equal(draftWeekSchema.safeParse({ ...base, prompt: "x".repeat(SHIFT_PROMPT_MAX + 1) }).success, false);
  assert.equal(draftWeekSchema.safeParse({ ...base, week: "2026-02-30", prompt: "Ayşe sabahçı" }).success, false);
});

test("istek: yalnız metin (görsel yok), Opus 5.5, efor low, şema yapılandırılmış çıktıda, yedek model açık", () => {
  const task = shiftDraftTask({ ...tuzla, monday: "2026-11-23", today: "2026-11-22" }, "Ayşe sabahçı");
  const { params, options } = buildRequest({ system: SHIFT_DRAFT_SYSTEM, task, schema: ShiftDraftRaw });
  assert.equal(params.model, AI_MODEL);
  assert.equal(params.model, "claude-opus-5-5");
  const content = params.messages[0].content as { type: string; text?: string }[];
  assert.deepEqual(content.map((b) => b.type), ["text"]);
  assert.equal(content[0].text, task);
  assert.equal(params.system, SHIFT_DRAFT_SYSTEM);
  assert.equal(params.output_config?.effort, "low");
  assert.equal(params.output_config?.format?.type, "json_schema");
  assert.deepEqual(params.betas, [AI_FALLBACK_BETA]);
  assert.equal(params.fallbacks, "default");
  // Bu modelde 400 alan alanlar gönderilmez
  for (const key of ["thinking", "temperature", "top_p", "top_k", "tool_choice"]) assert.equal(key in params, false, key);
  assert.equal(options.maxRetries, 1);
  // Şema sınırların içinde (birleşim türlü en çok 16, isteğe bağlı en çok 24) ve her nesne kapalı
  const schema = claudeSchema(ShiftDraftRaw);
  assert.deepEqual(schemaComplexity(schema), { unionParams: 5, optionalParams: 0 });
  assert.equal(fitsStructuredOutputs(schema), true);
  assert.equal(schema.additionalProperties, false);
  assert.doesNotMatch(JSON.stringify(schema), /minItems|maxLength|pattern/);
});

function fake(json: unknown, over: Partial<{ stop_reason: string }> = {}) {
  const calls: CreateParams[] = [];
  const client: AiClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          return { model: AI_MODEL, stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }], usage: { input_tokens: 900, output_tokens: 120 }, _request_id: "req_test", ...over };
        },
      },
    },
  };
  return { client, calls };
}

test("uçtan uca (sahte istemci): yanıt şemadan geçer ve hücrelere çevrilir; ret ve bozuk yanıt hata kodu olur", async () => {
  const answer = { assignments: [a({ person: "p1", days: [...WEEK], shift: "morning" }), a({ person: "p3", days: ["tue"], shift: "off" })], unclear: null };
  const { client, calls } = fake(answer);
  const res = await runExtraction(client, { system: SHIFT_DRAFT_SYSTEM, task: "GÖREV", schema: ShiftDraftRaw });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  if (!res.ok) return;
  const draft = draftToCells(res.data, tuzla);
  assert.equal(draft.cells.length, 6);
  assert.equal(cellsOf(draft, "n:zeynep")[1], "İzin");
  // Bilinmeyen vardiya türü ya da gün şemadan geçmez
  const wrong = await runExtraction(fake({ assignments: [{ ...a({ person: "p1", days: ["mon"], shift: "morning" }), shift: "night" }], unclear: null }).client, { system: "S", task: "T", schema: ShiftDraftRaw });
  assert.deepEqual([wrong.ok, !wrong.ok && wrong.code], [false, "invalid"]);
  const refusal = await runExtraction(fake(answer, { stop_reason: "refusal" }).client, { system: "S", task: "T", schema: ShiftDraftRaw });
  assert.deepEqual([refusal.ok, !refusal.ok && refusal.code], [false, "refusal"]);
  const cut = await runExtraction(fake('{"assignments": [', { stop_reason: "max_tokens" }).client, { system: "S", task: "T", schema: ShiftDraftRaw });
  assert.deepEqual([cut.ok, !cut.ok && cut.code], [false, "incomplete"]);
});

test("geliştirmedeki kayıtlı yanıt şemaya uyar ve listedeki kişilere yazılır", () => {
  const task = shiftDraftTask({ ...tuzla, monday: "2026-11-23", today: "2026-11-22" }, "herhangi bir metin");
  const rec = replayShiftAnswer(task);
  const parsed = ShiftDraftRaw.parse(rec.json);
  const draft = draftToCells(parsed, tuzla);
  assert.equal(cellsOf(draft, "u:2")[0], "09:00–18:00");
  assert.equal(cellsOf(draft, "u:3")[0], "16:00–01:00");
  assert.deepEqual([cellsOf(draft, "u:2")[6], cellsOf(draft, "n:zeynep")[6]], ["İzin", "İzin"]);
  assert.deepEqual(draft.skipped, []);
  // Kişi yoksa atama da yok
  assert.deepEqual(ShiftDraftRaw.parse(replayShiftAnswer("People: nobody is on the list yet.").json).assignments, []);
});

test("hata metinleri: her kod yöneticiyi kutuları elle doldurmaya ya da yeniden denemeye yollar; fotoğraf sözü geçmez", () => {
  const codes: AiErrorCode[] = ["nokey", "off", "cap", "timeout", "connection", "rate", "overloaded", "auth", "billing", "toolarge", "badrequest", "refusal", "incomplete", "invalid", "photo-limit"];
  for (const code of codes) {
    const t = aiErrorText(code, SHIFT_DRAFT_DAILY_CAP, "vardiya");
    assert.ok(t.length > 10, code);
    if (code !== "off" && code !== "photo-limit") assert.doesNotMatch(t, /[Ff]otoğraf|rakam/, code);
  }
  assert.match(aiErrorText("cap", SHIFT_DRAFT_DAILY_CAP, "vardiya"), /sınırı doldu \(40\)/);
  assert.match(aiErrorText("nokey", undefined, "vardiya"), /kurulu değil/);
  // Fotoğraf okumanın metinleri değişmedi
  assert.match(aiErrorText("nokey"), /Fotoğraftan okuma bu ortamda kurulu değil/);
});

test("bağlantılar: eylem yalnız yönetici ve kayıt yapmaz; günlük sınır okumadan ayrı; sayfa süresi 60 sn", () => {
  const action = src("src/server/actions/vardiya.ts");
  const draftAction = action.slice(action.indexOf("export async function draftShiftWeekAction"));
  assert.match(draftAction, /requireAdmin\(\)/);
  assert.doesNotMatch(draftAction, /logActivity|refresh\(\)|saveShiftWeek\(/);
  // Taslak sunucuda hiçbir tabloya yazmaz
  const draft = src("src/server/vardiya/draft.ts");
  assert.doesNotMatch(draft, /\.insert\(|\.update\(|\.delete\(/);
  assert.match(draft, /extractText\(/);
  // Okumanın günlük sınırı vardiya taslaklarını saymaz; taslağın kendi sınırı var; istem ve yanıt saklanmaz. Kendi sınırı
  // olan türler (vardiya, ürün önerisi; tests/urun-eslestirme-ai.test.ts) tek tabloda: okuma sınırı hepsini dışarıda bırakır
  const claude = src("src/server/ai/claude.ts");
  assert.match(claude, /const OWN_CAP: Partial<Record<AiFeature, number>> = \{ \[SHIFT_FEATURE\]: SHIFT_DRAFT_DAILY_CAP,/);
  assert.match(claude, /notInArray\(s\.aiCalls\.feature, OWN_CAP_FEATURES\)/);
  assert.match(claude, /const ownCap = OWN_CAP\[req\.feature\];\s*if \(ownCap !== undefined\) \{\s*if \(\(await featureCallsSince\(req\.feature, dayStart\(new Date\(\)\)\)\) >= ownCap\) return gate\("cap", ownCap\);/);
  assert.match(claude, /feature: SHIFT_FEATURE, photoId: null, model: AI_MODEL, keepResult: false/);
  const page = src("src/app/panel/vardiya/page.tsx");
  assert.match(page, /export const maxDuration = 60;/);
  assert.match(page, /canEdit \? shiftDraftState\(\) : Promise\.resolve\(null\)/);
  // Sayfa Claude kapısını doğrudan içeri almaz (tests/foto-altyapi.test.ts çağıran listesi)
  assert.doesNotMatch(page, /@\/server\/ai\/claude/);
  // Ekran: taslak hazırlanırken ızgara kilitli, sonuç Notice ile, geri alma var
  const grid = src("src/app/panel/vardiya/shift-grid.tsx");
  assert.match(grid, /inert=\{drafting\}/);
  assert.match(grid, /Taslağı geri al/);
  assert.match(grid, /draftState === "on"/);
});
