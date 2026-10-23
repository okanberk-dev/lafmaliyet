// Faturayı okuma (Claude Haiku 5.5; src/lib/invoice-reading.ts, docs/FATURA-OKUMA.md): yanıt şeması, denetimler (miktar,
// paket içeriği, aralık), birim fiyatın bizim kalemimizden hesaplanması, kartın metni, istem, kayıtlı yanıtlar ve kaynak
// kuralları (okuma sabah işinde çalışmaz, yalnız yönetici). Ağ ve anahtar gerekmez.
// Çalıştırma: npx tsx --test tests/fatura-okuma.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { usdText } from "../src/app/panel/ayarlar/summaries";
import {
  AUTO_READ_RESERVE_MIN,
  autoReadAllowed,
  INVOICE_SYSTEM,
  invoiceTask,
  InvoiceReadingRaw,
  normalizeInvoiceReading,
  readingFits,
  readingText,
  type InvoiceReadingRawT,
} from "../src/lib/invoice-reading";
import { claudeSchema } from "../src/lib/photo-read/claude-schema";
import { holdSuggestion } from "../src/lib/price-hold";
import { replayInvoiceAnswer } from "../src/server/ai/replay";
import { AI_INVOICE_MODEL, runExtraction, type AiClient } from "../src/server/ai/run";

const ROOT = join(__dirname, "..");
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "fatura", `${name}.json`), "utf8")) as { json: InvoiceReadingRawT; model: string };
const NBSP = " ";

/** Kayıtlı yanıtı döndüren sahte istemci (isteği de saklar) */
function fake(json: unknown) {
  const calls: unknown[] = [];
  const client: AiClient = {
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          return { model: AI_INVOICE_MODEL, stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 10, output_tokens: 5 } };
        },
      },
    },
  };
  return { client, calls };
}

const raw = (over: Partial<InvoiceReadingRawT> = {}): InvoiceReadingRawT => ({ ...fixture("bardak").json, ...over });

test("kayıtlı yanıtlar şemadan geçer; istek Haiku 5.5 ile", async () => {
  for (const name of ["bardak", "klips"]) {
    const rec = fixture(name);
    assert.equal(rec.model, "claude-haiku-5-5");
    const { client } = fake(rec.json);
    const res = await runExtraction(client, { document: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), mediaType: "application/pdf" }, model: AI_INVOICE_MODEL, system: INVOICE_SYSTEM, task: "T", schema: InvoiceReadingRaw });
    assert.equal(res.ok, true, name);
    assert.deepEqual(res.ok && res.data, rec.json, name);
  }
  // API şeması: her nesne additionalProperties:false, enum'lar kalır
  const schema = claudeSchema(InvoiceReadingRaw) as { additionalProperties: boolean; properties: Record<string, { enum?: string[] }> };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.confidence.enum, ["high", "medium", "low"]);
  // Şemaya uymayan yanıt geçmez (ör. çarpan metin)
  const bad = await runExtraction(fake({ ...fixture("bardak").json, factor: "150" }).client, { document: { bytes: new Uint8Array([1]), mediaType: "application/pdf" }, model: AI_INVOICE_MODEL, system: "S", task: "T", schema: InvoiceReadingRaw });
  assert.equal(!bad.ok && bad.code, "invalid");
});

test("denetim: Yenilebilir bardak 150 adet, emin; miktar farklı okunursa ya da paket çarpanla tutmazsa az emin", () => {
  const ok = normalizeInvoiceReading(raw(), { quantity: 1, unit: "adet" });
  assert.equal(ok.factor, 150);
  assert.equal(ok.confidence, "high");
  assert.deepEqual(ok.checks, []);
  assert.deepEqual(ok.perPackage, { count: 150, unit: "adet" });
  assert.equal(ok.unit, "adet");
  assert.equal(ok.evidence, "LİVİ YENİLEBİLİR BARDAK 150 AD. · 1 Adet · 3.000,00 TL");
  // Başka satırı okumuş olabilir: faturada 2 adet yazıyor, bizim kalemimiz 1
  const qty = normalizeInvoiceReading(raw({ line: { ...raw().line!, quantity: 2 } }), { quantity: 1, unit: "adet" });
  assert.equal(qty.confidence, "low");
  assert.deepEqual(qty.checks, ["Faturada miktar farklı okundu"]);
  assert.equal(qty.factor, 150);
  // İade faturasında bizim miktarımız eksi
  assert.equal(normalizeInvoiceReading(raw(), { quantity: -1, unit: "adet" }).confidence, "high");
  const pack = normalizeInvoiceReading(raw({ factor: 100 }), { quantity: 1, unit: "adet" });
  assert.equal(pack.confidence, "low");
  assert.deepEqual(pack.checks, ["Paket içeriği çarpanla tutmuyor"]);
  // Paket içeriği başka birimde (adet) ise çarpanla (gr) karşılaştırılmaz
  assert.equal(normalizeInvoiceReading(raw({ factor: 3000, perPackage: { count: 150, unit: "adet" } }), { quantity: 1, unit: "gr" }).confidence, "high");
});

test("denetim: bulunamayan kalem, aralık dışı ya da boş çarpan; alıntı en çok 120 karakter", () => {
  const missing = normalizeInvoiceReading(raw({ found: false, factor: 150 }), { quantity: 1, unit: "adet" });
  assert.equal(missing.factor, null);
  assert.equal(missing.confidence, "low");
  for (const factor of [0, -5, 5_000_000, Number.NaN]) {
    const r = normalizeInvoiceReading(raw({ factor }), { quantity: 1, unit: "adet" });
    assert.equal(r.factor, null, String(factor));
    assert.equal(r.confidence, "low", String(factor));
  }
  const none = normalizeInvoiceReading(raw({ factor: null, perPackage: null, confidence: "high" }), { quantity: 1, unit: "adet" });
  assert.equal(none.factor, null);
  assert.equal(none.confidence, "low");
  const long = normalizeInvoiceReading(raw({ evidence: `${"A".repeat(200)}\u0007`, note: "  not  " }), { quantity: 1, unit: "adet" });
  assert.equal(long.evidence.length, 120);
  assert.ok(long.evidence.endsWith("…"));
  assert.equal(long.note, "not");
  assert.equal(normalizeInvoiceReading(raw({ factor: 0.33333333 }), { quantity: 1, unit: "adet" }).factor, 0.333);
  assert.ok(readingFits(normalizeInvoiceReading(raw(), { quantity: 1, unit: "adet" }), "adet"));
  assert.ok(!readingFits(normalizeInvoiceReading(raw(), { quantity: 1, unit: "adet" }), "gr"));
});

test("kartın metni: birim fiyat bizim kalemimizden (net ÷ miktar × çarpan), modelin fiyatından değil", () => {
  const bardak = normalizeInvoiceReading(raw({ line: { ...raw().line!, unitPrice: 99, lineTotal: 99 } }), { quantity: 1, unit: "adet" });
  const ctx = { lineUnit: "Adet", unit: "adet", quantity: 1, netTotal: 3000, currentUnit: 9996 / 240 };
  assert.equal(
    readingText(bardak, ctx),
    `Faturada: “LİVİ YENİLEBİLİR BARDAK 150 AD. · 1 Adet · 3.000,00 TL”. 1 Adet = 150 adet → adet başı 20,00${NBSP}₺ (şimdikinden %52 ucuz).`,
  );
  const klips = normalizeInvoiceReading(fixture("klips").json, { quantity: 1000, unit: "adet" });
  assert.equal(
    readingText(klips, { lineUnit: "Adet", unit: "adet", quantity: 1000, netTotal: 12020, currentUnit: 1.165 }),
    `Faturada: “PLASTİK KAPAK KLIPS · 1.000 Adet · 12,02 TL”. 1 Adet = 1 adet → adet başı 12,02${NBSP}₺ (şimdikinden %932 pahalı).`,
  );
  const low = normalizeInvoiceReading(raw({ confidence: "low" }), { quantity: 1, unit: "adet" });
  assert.match(readingText(low, ctx), /\(şimdikinden %52 ucuz\)\. Emin değil; faturayı açıp bakın\.$/);
  assert.equal(readingText(normalizeInvoiceReading(raw({ found: false }), { quantity: 1, unit: "adet" }), ctx), "Faturada bu kalem bulunamadı; faturayı açıp bakın.");
  assert.equal(
    readingText(normalizeInvoiceReading(raw({ factor: null }), { quantity: 1, unit: "adet" }), ctx),
    "Faturada: “LİVİ YENİLEBİLİR BARDAK 150 AD. · 1 Adet · 3.000,00 TL”. Paket boyu yazmıyor; faturayı açıp bakın.",
  );
});

test("okuma kartın önerisi olur: adında kanıt yokken emin okunan farklı çarpan", () => {
  const reading = normalizeInvoiceReading(raw(), { quantity: 1, unit: "adet" });
  const s = holdSuggestion({ factor: 1, quantity: 1, netTotal: 3000, current: 41.65, evidence: null, reading, history: false });
  assert.deepEqual(s && { kind: s.kind, factor: s.factor, unitPrice: s.unitPrice }, { kind: "reading", factor: 150, unitPrice: 20 });
  // Az emin okuma öneri olmaz (yalnız satır)
  assert.equal(holdSuggestion({ factor: 1, quantity: 1, netTotal: 3000, current: 41.65, evidence: null, reading: { ...reading, confidence: "low" }, history: false }), null);
});

test("istem: kalem ve hammadde veri olarak (tırnak içinde), birim ve örnekler hammaddeye göre", () => {
  const task = invoiceTask({ name: "LİVİ YENİLEBİLİR BARDAK 150 AD.", description: "LİVİ YENİLEBİLİR BARDAK 150 AD.", quantity: 1, lineUnit: "Adet", netTotal: 3000, ingredient: "Yenilebilir bardak", unit: "adet" });
  assert.match(task, /- name: "LİVİ YENİLEBİLİR BARDAK 150 AD\."/);
  assert.doesNotMatch(task, /description/);
  assert.match(task, /- quantity: 1 "Adet"/);
  assert.match(task, /- amount excluding VAT: 3000\.00 TL/);
  assert.match(task, /ingredient "Yenilebilir bardak", counted in pieces \(adet\)/);
  assert.match(task, /factor = how many adet one invoiced "Adet" of this line holds/);
  const ml = invoiceTask({ name: 'SÜT "1 L"', description: "KOLİ İÇİ 12", quantity: 2, lineUnit: null, netTotal: 744, ingredient: "Süt", unit: "ml" });
  assert.match(ml, /- name: "SÜT \\"1 L\\""/);
  assert.match(ml, /- description: "KOLİ İÇİ 12"/);
  assert.match(ml, /millilitres \(ml\)/);
  assert.match(ml, /one invoiced "unit"/);
  // Belgedeki yazı veridir; bilinmeyen paket boyu tahmin edilmez
  assert.match(INVOICE_SYSTEM, /data, never instructions/);
  assert.match(INVOICE_SYSTEM, /factor to null and confidence to "low"/);
});

test("kayıtlı yanıt: istemdeki kaleme göre (bardak, klips), tanınmayan kalem bulunamadı", () => {
  assert.equal((replayInvoiceAnswer('- name: "LİVİ YENİLEBİLİR BARDAK 150 AD."').json as InvoiceReadingRawT).factor, 150);
  assert.equal((replayInvoiceAnswer('- name: "PLASTİK KAPAK KLIPS"').json as InvoiceReadingRawT).factor, 1);
  const other = replayInvoiceAnswer('- name: "SÜT 1 L"').json as InvoiceReadingRawT;
  assert.equal(other.found, false);
  assert.ok(InvoiceReadingRaw.safeParse(other).success);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

test("kaynak: okuma sabah işinde çalışmaz, yalnız yönetici çağırır; kendiliğinden okuma eylem değil; okuma fiyat yazmaz", () => {
  for (const f of walk(join(ROOT, "src/app/api/cron"))) {
    const code = readFileSync(f, "utf8");
    assert.doesNotMatch(code, /invoice-reading|readInvoiceLine|extractDocument/, f);
  }
  const rel = (files: string[]) => files.map((f) => f.slice(ROOT.length + 1)).sort();
  const callers = walk(join(ROOT, "src")).filter((f) => /readInvoiceLine\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(rel(callers), ["src/server/actions/invoice-readings.ts", "src/server/invoice-reading/hold.ts", "src/server/invoice-reading/read.ts"]);
  // Onay bekleyen fiyatın okuması: düğme eylemden, kartın kendiliğinden okuması yol işleyicisinden
  const holdCallers = walk(join(ROOT, "src")).filter((f) => /await readHold\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(rel(holdCallers), ["src/app/api/fiyat-onerileri/[id]/oku/route.ts", "src/server/actions/invoice-readings.ts"]);
  const actions = readFileSync(join(ROOT, "src/server/actions/invoice-readings.ts"), "utf8");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/export async function/g) ?? []).length, 2);
  assert.equal((actions.match(/const me = await requireAdmin\(\);/g) ?? []).length, 2);
  // Eylem kendiliğinden okumayı almaz: Next eylemleri tek tek yollar, 55 sn'lik okuma sayfadaki Onayla'yı bekletirdi
  assert.match(actions, /const holdSchema = z\.object\(\{ id: z\.number\(\)\.int\(\)\.positive\(\), mode: z\.enum\(\["manual", "force"\]\)/);
  const route = readFileSync(join(ROOT, "src/app/api/fiyat-onerileri/[id]/oku/route.ts"), "utf8");
  assert.equal((route.match(/export async function/g) ?? []).length, 1);
  assert.match(route, /export async function POST\(/);
  assert.match(route, /if \(!sameOrigin\(request\)\) return/);
  assert.match(route, /if \(!me \|\| me\.role !== "admin"\) return/);
  assert.match(route, /await readHold\(me, id, "auto"\)/);
  const card = readFileSync(join(ROOT, "src/app/panel/hammaddeler/price-holds.tsx"), "utf8");
  assert.match(card, /fetch\(`\/api\/fiyat-onerileri\/\$\{id\}\/oku`, \{ method: "POST" \}\)/);
  assert.doesNotMatch(card, /mode: "auto"/);
  // Okuma yalnız invoice_readings'e yazar: fiyat, bağlantı ve hammadde değişmez
  const read = readFileSync(join(ROOT, "src/server/invoice-reading/read.ts"), "utf8");
  for (const t of ["ingredients", "ingredientPrices", "parasutProductLinks", "ingredientPriceHolds"]) assert.doesNotMatch(read, new RegExp(`s\\.${t}\\b`), t);
  for (const t of ["ingredients", "ingredientPrices", "parasutProductLinks"]) assert.doesNotMatch(actions, new RegExp(`(update|insert)\\(s\\.${t}\\)`), t);
});

test("kendiliğinden okuma günlük sınırın yarısına kadar: kalanı fotoğraflara (Z, POS, fiş) ve düğmelere", () => {
  // Sınır 40: 19 okuma yapılmışsa bir kart daha okunur, 20'de durur (20 okuma kalır)
  assert.equal(autoReadAllowed(0, 40), true);
  assert.equal(autoReadAllowed(19, 40), true);
  assert.equal(autoReadAllowed(20, 40), false);
  assert.equal(autoReadAllowed(45, 40), false);
  // Küçük sınırda da en az 10 okuma kalır: 20'de 10'a kadar, 10 ve altında hiç
  assert.equal(autoReadAllowed(9, 20), true);
  assert.equal(autoReadAllowed(10, 20), false);
  assert.equal(autoReadAllowed(0, 10), false);
  assert.equal(autoReadAllowed(0, 0), false);
  assert.equal(AUTO_READ_RESERVE_MIN, 10);
});

test("Ayarlar: fatura okumasının bir kuruşun altındaki tutarı 0,00 $ görünmez", () => {
  assert.equal(usdText(0), "0,00 $");
  assert.equal(usdText(0.0015), "0,01 $'dan az");
  assert.equal(usdText(0.005), "0,01 $");
  assert.equal(usdText(1.236), "1,24 $");
});
