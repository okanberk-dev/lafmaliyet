/**
 * Anahtarsız geliştirmede okuma akışını denemek için kayıtlı yanıtlar (tests/fixtures/foto/*.json: canlıda alınmış
 * beş yanıt, docs/planlar/fotograf.md §10). Yalnız `next dev`te ve AI_REPLAY=1 iken açılır; canlıda (NODE_ENV
 * production) hiçbir koşulda devreye girmez. Hangi yanıtın döneceği türe ve deneme görsellerinin ölçüsüne göre seçilir
 * (docs/planlar/ekler/fotograf-eval/img: telefonda küçültülünce ölçüleri değişmez; yazarkasanın mali Z'si
 * scripts/foto-eval/make-images.py'nin `yazarkasa-z.jpg`'sidir); başka bir fotoğrafa türün olağan yanıtı döner.
 * Yazarkasa Z bölümünün (`kasa-okc`; geçişte eski sayfanın `kasa-pos`'u da buraya okunur) yanıtları
 * tests/fixtures/foto/okc*.json'dur ve sentetiktir (adım b2'de gerçek yanıtlarla değişir). Fatura okuması (tests/fixtures/fatura/*.json) istemdeki kalem adına göre seçilir; bunlar sentetiktir
 * (yerelde anahtar yok, canlı istek yapılmadı). Ürün → hammadde önerisinin yanıtı da sentetiktir: istemdeki hammadde
 * listesinden ve ürün adlarından kurulur (replayMatchAnswer). Panel asistanının yanıtı da sentetiktir ve akışlıdır
 * (replayAssistantClient): araç gerçekten çalışır, yanıt aracın sonucundan kısa bir özettir. Görsel ve belge hiçbir
 * yere gönderilmez.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageSize } from "@/lib/photo-rules";
import { guessLinkFactor, packEvidence, suggestIngredient } from "@/lib/product-match";

import type { AssistantClient, AssistantParams } from "./assistant/loop";
import { scriptedMessage, scriptedStream } from "./assistant/scripted";
import type { AiClient, AiFeature, AiMessage } from "./run";

export function replayEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development" && env.AI_REPLAY === "1";
}

/** Deneme görsellerinin ölçüsü → adı */
const IMAGES: Record<string, "z" | "pos" | "market" | "talimat" | "okc"> = {
  "864x1390": "z",
  "768x965": "pos",
  "864x1069": "market",
  "864x862": "talimat",
  "731x1600": "okc",
};

const NONE = { text: null, value: null, confidence: "low" } as const;

/**
 * Kaydı olmayan çapraz durumlar (Z raporu POS bölümüne, POS fişi fiş olarak; yazarkasanın Z'si iki kasa bölümüne):
 * modelin belge türünü doğru bildiği yanıt. Yazarkasa Z'sinin yanıtları sentetiktir (canlıda alınmadı)
 */
const SYNTHETIC: Record<string, unknown> = {
  "kasa-z:market": synthZ("purchase_receipt"),
  "kasa-z:talimat": synthZ("purchase_receipt"),
  "kasa-pos:z": synthPos("z_report"),
  "kasa-pos:market": synthPos("purchase_receipt"),
  "kasa-pos:talimat": synthPos("purchase_receipt"),
  "fis:z": synthReceipt("z_report"),
  "fis:pos": synthReceipt("bank_pos_end_of_day"),
  "kasa-z:okc": synthZ("fiscal_z_report"),
  "kasa-pos:okc": synthPos("fiscal_z_report"),
  "fis:okc": synthReceipt("z_report"),
  "kasa-okc:z": synthOkc("software_z"),
  "kasa-okc:market": synthOkc("other"),
  "kasa-okc:talimat": synthOkc("other"),
};

function synthOkc(documentType: string) {
  const count = { text: null, value: null, confidence: "low" };
  return {
    documentType,
    fiscalMarks: { mfLogo: false, ekuNo: false, cumulativeLines: false, vatBlock: false },
    readable: true,
    title: null,
    date: "2026-10-21",
    time: null,
    dateConfidence: "medium",
    zNo: count,
    receiptCount: count,
    dailyTotal: NONE,
    dailyTotalLabel: null,
    kdvGroups: [],
    totalVat: NONE,
    payments: [],
    outside: [],
    voids: NONE,
    discounts: NONE,
    cumulativeTotal: NONE,
    cumulativeVat: NONE,
    batches: [],
    issues: [],
  };
}

function synthZ(documentType: string) {
  return { documentType, readable: true, date: "2026-10-21", time: null, zNo: null, receiptCount: null, total: NONE, paymentLines: [], discounts: NONE, comps: NONE, refunds: NONE, issues: [] };
}

function synthPos(documentType: string) {
  return { documentType, readable: true, date: "2026-10-21", time: null, bank: null, batchNo: null, salesTotal: NONE, refundTotal: NONE, netTotal: NONE, transactionCount: null, issues: [] };
}

function synthReceipt(documentType: string) {
  return { documentType, readable: true, store: null, storeTaxNo: null, date: "2026-10-21", time: null, receiptNo: null, total: NONE, vatTotal: NONE, vatLines: [], paymentMethod: "unknown", items: [], itemSummary: "", categoryId: null, issues: [] };
}

const FILES: Record<string, string> = {
  "kasa-z:pos": "yanlis-belge",
  // Yazarkasa Z bölümü (dalga 13 PR-b; sentetik): banka gün sonu fişi yedek alanı doldurur, öteki her görsele örnek Z
  "kasa-okc:pos": "okc-batch",
  "kasa-okc": "okc",
  "kasa-z": "z",
  "kasa-pos": "pos",
  "fis:talimat": "fis-talimat",
  fis: "fis-soluk",
};

interface Recorded {
  json: unknown;
  usage: AiMessage["usage"];
  ms: number;
  model: string;
}

/** Türe ve görsele göre kayıtlı yanıt (fotoğraflar) */
export function replayAnswer(feature: Exclude<AiFeature, "fatura" | "vardiya" | "eslestirme" | "asistan">, size: { width: number; height: number } | null): Recorded {
  const image = size ? IMAGES[`${size.width}x${size.height}`] : undefined;
  const key = image ? `${feature}:${image}` : feature;
  const usage = { input_tokens: 4000, output_tokens: 300, iterations: [{ type: "message", model: null, input_tokens: 4000, output_tokens: 300 }] };
  if (SYNTHETIC[key]) return { json: SYNTHETIC[key], usage, ms: 1500, model: "claude-opus-5-5" };
  const file = FILES[key] ?? FILES[feature];
  const rec = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "foto", `${file}.json`), "utf8")) as Recorded;
  return rec;
}

/** Fatura okumasının kayıtlı yanıtları: istemdeki kalem adına göre; tanınmayan kalem "bulunamadı" */
const INVOICE_FILES: [RegExp, string][] = [
  [/YENİLEBİLİR BARDAK 150 AD/, "bardak"],
  [/PLASTİK KAPAK KLIPS/, "klips"],
];

export function replayInvoiceAnswer(task: string): Recorded {
  const hit = INVOICE_FILES.find(([re]) => re.test(task));
  if (hit) return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "fatura", `${hit[1]}.json`), "utf8")) as Recorded;
  const usage = { input_tokens: 2500, output_tokens: 200, iterations: [{ type: "message", model: null, input_tokens: 2500, output_tokens: 200 }] };
  return { json: { found: false, line: null, perPackage: null, factor: null, confidence: "low", evidence: "", note: "Kayıtlı yanıtı olmayan kalem" }, usage, ms: 1200, model: "claude-haiku-5-5" };
}

/**
 * Vardiyayı yazarak doldurmanın geliştirmedeki yanıtı (sentetik; canlı istek yapılmaz, yazılan metin okunmaz): listedeki
 * ilk kişi hafta içi sabahçı, ikinci kişi akşamcı, herkes Pazar izinli. Ekranın akışını (taslak, Kaydet) denemeye yeter.
 */
export function replayShiftAnswer(task: string): Recorded {
  const keys = [...task.matchAll(/^(p\d+): /gm)].map((m) => m[1]);
  const week = ["mon", "tue", "wed", "thu", "fri"];
  const assignments = [
    ...keys.slice(0, 2).map((person, i) => ({ person, newName: null, days: week, shift: i === 0 ? "morning" : "evening", start: null, end: null, note: null })),
    ...(keys.length ? [{ person: "all", newName: null, days: ["sun"], shift: "off", start: null, end: null, note: null }] : []),
  ];
  const usage = { input_tokens: 900, output_tokens: 200, iterations: [{ type: "message", model: null, input_tokens: 900, output_tokens: 200 }] };
  return { json: { assignments, unclear: "Kayıtlı yanıt (geliştirme): yazdığınız metin okunmadı." }, usage, ms: 900, model: "claude-opus-5-5" };
}

/** İstemdeki birim sözcüğü → hammaddenin birimi (src/lib/product-match-ai.ts UNIT_WORD'ün tersi) */
const UNIT_OF: Record<string, string> = { gram: "gr", millilitre: "ml", piece: "adet", slice: "dilim" };
const NOT_INGREDIENT = /kargo|nakliye|hizmet|servis|tamir|bakim|bakım/i;

/**
 * Ürün → hammadde önerisinin geliştirmedeki yanıtı (sentetik; canlı istek yapılmaz): sistem istemindeki hammadde
 * listesinden adı ürün adında geçen hammadde "bagla" (addaki paket kanıtı varsa onun çarpanıyla, yüksek güven; yoksa
 * formun tahminiyle, orta güven), kargo / hizmet "hammadde_degil", gerisi "emin_degil". Ekranın akışını (rozetler,
 * Uygula, toplu pencere) denemeye yeter.
 */
export function replayMatchAnswer(system: string, task: string): Recorded {
  const ingredients = [...system.matchAll(/^(\d+) \| ([^|\n]+?) \| (gram|millilitre|piece|slice) \|/gm)].map((m) => ({ id: Number(m[1]), name: m[2], unit: UNIT_OF[m[3]] }));
  const products = [...task.matchAll(/^(u\d+) \| ("(?:[^"\\]|\\.)*") \| invoice unit ("(?:[^"\\]|\\.)*")/gm)].map((m) => ({
    key: m[1],
    name: JSON.parse(m[2]) as string,
    unit: JSON.parse(m[3]) as string,
  }));
  const oneriler = products.map((p) => {
    if (NOT_INGREDIENT.test(p.name)) return { urun_anahtari: p.key, karar: "hammadde_degil", hammadde_id: null, carpan: null, guven: "yuksek", gerekce: "Kayıtlı yanıt: hizmet ya da kargo kalemi" };
    const hit = suggestIngredient(p.name, ingredients);
    const ing = hit ? ingredients.find((i) => i.id === hit.ingredientId) : undefined;
    if (!ing) return { urun_anahtari: p.key, karar: "emin_degil", hammadde_id: null, carpan: null, guven: "dusuk", gerekce: "Kayıtlı yanıt: listede uyan hammadde bulunamadı" };
    const line = { name: p.name, unit: p.unit };
    const ev = packEvidence(line, ing.unit);
    const guess = guessLinkFactor(line, ing.unit);
    return {
      urun_anahtari: p.key,
      karar: "bagla",
      hammadde_id: ing.id,
      carpan: ev ? ev.factor : guess ? Number(guess.replace(",", ".")) : 1,
      guven: ev ? "yuksek" : "orta",
      gerekce: `Kayıtlı yanıt: ad ${ing.name} ile örtüşüyor`,
    };
  });
  const usage = { input_tokens: 600, output_tokens: 60 * products.length, cache_read_input_tokens: 4000, iterations: [{ type: "message", model: null, input_tokens: 600, output_tokens: 60 * products.length, cache_read_input_tokens: 4000 }] };
  return { json: { oneriler }, usage, ms: 1500, model: "claude-sonnet-5-5" };
}

/** Kayıtlı yanıtı gerçek bir çağrı gibi (kısa bir beklemeyle) döndüren istemci (asistanınki akışlı: replayAssistantClient) */
export function replayClient(feature: Exclude<AiFeature, "asistan">): AiClient {
  return {
    beta: {
      messages: {
        async create(params) {
          const first = params.messages[0]?.content;
          const block = Array.isArray(first) ? first.find((b) => b.type === "image") : undefined;
          const data = block && block.type === "image" && block.source.type === "base64" ? block.source.data : "";
          const task = Array.isArray(first) ? first.map((b) => (b.type === "text" ? b.text : "")).join("\n") : "";
          const system = typeof params.system === "string" ? params.system : (params.system ?? []).map((b) => b.text).join("\n");
          const rec =
            feature === "fatura"
              ? replayInvoiceAnswer(task)
              : feature === "vardiya"
                ? replayShiftAnswer(task)
                : feature === "eslestirme"
                  ? replayMatchAnswer(system, task)
                  : replayAnswer(feature, imageSize(new Uint8Array(Buffer.from(data, "base64"))));
          await new Promise((r) => setTimeout(r, Math.min(rec.ms, 2500)));
          return { model: rec.model, stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(rec.json) }], usage: rec.usage, _request_id: "kayitli-yanit" };
        },
      },
    },
  };
}

// ---------------------------------------------------------------- Panel asistanı

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Sorudaki sözcüğe göre kayıtlı yanıtın çağıracağı araç ve girdisi (sıra önemli: ilk eşleşen) */
const ASSISTANT_ROUTES: [RegExp, string, (today: string, question: string) => Record<string, unknown>][] = [
  [/\bsil\b|silmek|toplu|parolamı|şifremi/i, "islem_rehberi", (_t, q) => ({ konu: q.slice(0, 200) })],
  [/gün sonu|gun sonu|kasa tuttu/i, "gun_sonu", () => ({})],
  [/lafpos/i, "lafpos_durumu", () => ({})],
  [/en çok ne sat|kaç .*sattı|sattık/i, "gunluk_satislar", () => ({})],
  [/tüken|tuken/i, "menu_durumu", () => ({})],
  [/kim çalışıyor|vardiya/i, "vardiya", () => ({})],
  [/bitmek üzere|stok/i, "stok_tahmini", () => ({})],
  [/bekleyen (ne|iş)|onay bekleyen/i, "bekleyen_isler", () => ({})],
  [/bugün ne|günün özeti/i, "bugun_ozeti", () => ({})],
  [/bağlan|bekle|paraşüt|parasut/i, "parasut_bekleyenler", () => ({ limit: 10 })],
  [/borç|borc|tedarikçi|tedarikci/i, "tedarikci_ozeti", () => ({ siralama: "borc", limit: 5 })],
  [/zam/i, "zam_etkisi", () => ({ limit: 5 })],
  [/ödeme|odeme|vade/i, "odemeler", () => ({})],
  [/kasa|z raporu/i, "kasa_raporlari", (today) => ({ baslangic: shiftDay(today, -7), bitis: shiftDay(today, -1) })],
  [/ürün|urun|kâr|marj/i, "urun_karliligi", () => ({ limit: 5 })],
  [/\bay\b|ciro|gidiyor/i, "ay_ozeti", () => ({})],
];

const textOf = (content: AssistantParams["messages"][number]["content"]) =>
  typeof content === "string" ? content : content.map((b) => (b.type === "text" ? b.text : "")).join("\n");

/**
 * Asistanın geliştirmedeki yanıtı (sentetik; canlı istek yapılmaz, soru Claude'a gitmez): ilk turda sorudaki sözcüğe göre
 * bir araç çağrılır (araç yerel veritabanında gerçekten çalışır), ikinci turda aracın sonucunun boyu ve ekran
 * bağlantısı. Ekranın akışını (yazıyor, araç durumu, bağlantı, Durdur) denemeye yeter.
 */
export function replayAssistantMessage(params: AssistantParams) {
  const usage = { input_tokens: 3200, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const last = params.messages[params.messages.length - 1];
  const results = last && Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  if (results.length || params.tool_choice?.type === "none") {
    const lines = results.map((r) => {
      const raw = typeof r.content === "string" ? r.content : "";
      let link: string | null = null;
      try {
        const v = JSON.parse(raw) as { panelAdresi?: unknown };
        link = typeof v.panelAdresi === "string" ? v.panelAdresi : null;
      } catch {
        // Hata metni JSON değildir
      }
      return r.is_error ? `- Araç hata verdi: ${raw.slice(0, 160)}` : `- Araç ${raw.length} karakterlik veri döndü.${link ? ` [Ekranı aç](${link})` : ""}`;
    });
    const text = [
      "**Kayıtlı yanıt** (geliştirme, AI_REPLAY=1): sorunuz Claude'a gitmedi.",
      ...lines,
      "",
      "Gerçek yanıt için ortamda `ANTHROPIC_API_KEY` gerekir. Ekranlar: [Genel bakış](/panel), [Tedarikçiler](/panel/tedarikciler).",
      // Takip önerileri (src/lib/assistant/followups.ts): ekranın çipleri anahtarsız da denensin
      "<takip>",
      "- Dünkü gün sonu nasıldı?",
      "- Bu ay nasıl gidiyor?",
      "</takip>",
    ].join("\n");
    return scriptedMessage({ content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", usage });
  }
  const question = last ? textOf(last.content) : "";
  const route = ASSISTANT_ROUTES.find(([re]) => re.test(question));
  const name = route ? route[1] : "panel_rehberi";
  const input = route ? route[2](new Date().toISOString().slice(0, 10), question) : { soru: question.slice(0, 200) || "panel" };
  return scriptedMessage({
    content: [
      { type: "text", text: "Panelden bakıyorum.", citations: null },
      { type: "tool_use", id: `toolu_kayitli_${name}`, name, input },
    ] as ReturnType<typeof scriptedMessage>["content"],
    stop_reason: "tool_use",
    usage,
  });
}

/** Asistanın kayıtlı yanıt istemcisi: gerçek akış gibi parça parça (yazıyor göstergesi ve Durdur denensin) */
export function replayAssistantClient(): AssistantClient {
  return { beta: { messages: { stream: (params, options) => scriptedStream(replayAssistantMessage(params), { signal: options.signal, delayMs: 40, chunk: 6 }) } } };
}
