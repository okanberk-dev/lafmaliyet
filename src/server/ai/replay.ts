/**
 * Anahtarsız geliştirmede okuma akışını denemek için kayıtlı yanıtlar (tests/fixtures/foto/*.json: canlıda alınmış
 * beş yanıt, docs/planlar/fotograf.md §10). Yalnız `next dev`te ve AI_REPLAY=1 iken açılır; canlıda (NODE_ENV
 * production) hiçbir koşulda devreye girmez. Hangi yanıtın döneceği türe ve deneme görsellerinin ölçüsüne göre seçilir
 * (docs/planlar/ekler/fotograf-eval/img: telefonda küçültülünce ölçüleri değişmez; yazarkasanın mali Z'si
 * scripts/foto-eval/make-images.py'nin `yazarkasa-z.jpg`'sidir); başka bir fotoğrafa türün olağan yanıtı döner.
 * Yazarkasa Z bölümünün (`kasa-okc`; geçişte eski sayfanın `kasa-pos`'u da buraya okunur) yanıtları
 * tests/fixtures/foto/okc*.json'dur ve sentetiktir (adım b2'de gerçek yanıtlarla değişir). Fatura okuması (tests/fixtures/fatura/*.json) istemdeki kalem adına göre seçilir; bunlar sentetiktir
 * (yerelde anahtar yok, canlı istek yapılmadı). Görsel ve belge hiçbir yere gönderilmez.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { imageSize } from "@/lib/photo-rules";

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
export function replayAnswer(feature: Exclude<AiFeature, "fatura">, size: { width: number; height: number } | null): Recorded {
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

/** Kayıtlı yanıtı gerçek bir çağrı gibi (kısa bir beklemeyle) döndüren istemci */
export function replayClient(feature: AiFeature): AiClient {
  return {
    beta: {
      messages: {
        async create(params) {
          const first = params.messages[0]?.content;
          const block = Array.isArray(first) ? first.find((b) => b.type === "image") : undefined;
          const data = block && block.type === "image" && block.source.type === "base64" ? block.source.data : "";
          const task = Array.isArray(first) ? first.map((b) => (b.type === "text" ? b.text : "")).join("\n") : "";
          const rec = feature === "fatura" ? replayInvoiceAnswer(task) : replayAnswer(feature, imageSize(new Uint8Array(Buffer.from(data, "base64"))));
          await new Promise((r) => setTimeout(r, Math.min(rec.ms, 2500)));
          return { model: rec.model, stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(rec.json) }], usage: rec.usage, _request_id: "kayitli-yanit" };
        },
      },
    },
  };
}
