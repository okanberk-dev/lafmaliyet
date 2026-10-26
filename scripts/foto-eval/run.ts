/**
 * Fotoğraftan okumanın canlı değerlendirmesi (docs/FOTOGRAF.md § 8). Para harcar (okuma başına ~0,03 $): yalnız
 * FOTO_EVAL=1 ve ANTHROPIC_API_KEY verilince çalışır. Canlıdaki istekle aynı yol (runExtraction) ve aynı denetimler
 * (src/lib/photo-read); veritabanına dokunmaz. Görseller: python3 scripts/foto-eval/make-images.py (→ .data/foto-eval/),
 * beklenenler cases.json'da. İstem, şema, küçültme ayarı ya da model değişince çalıştırın.
 *
 *   FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/foto-eval/run.ts [--max 4] [--only z-raporu]   # --max yoksa hepsi
 *   npx tsx scripts/foto-eval/run.ts --kayitli     # ağsız ve parasız: betiğin kendisini kayıtlı yanıtlarla sınar
 *
 * Anahtarı yalnız kabukta verin; depoya ya da .env dosyasına yazmayın.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import { money } from "../../src/lib/format";
import { normalizePos, normalizeZ, type CashReading, type ReadField } from "../../src/lib/photo-read/kasa";
import { POS_TASK, RECEIPT_TASK, SYSTEM, Z_TASK } from "../../src/lib/photo-read/prompts";
import { normalizeReceipt, type ReceiptField, type ReceiptReading } from "../../src/lib/photo-read/receipt";
import { KasaPosRaw, KasaZRaw, ReceiptRaw, type KasaPos, type KasaZ, type Receipt } from "../../src/lib/photo-read/schemas";
import { costUsd } from "../../src/server/ai/pricing";
import { replayClient } from "../../src/server/ai/replay";
import { AI_MODEL, runExtraction, type AiClient, type AiFeature, type ExtractRequest } from "../../src/server/ai/run";

interface Case {
  name: string;
  image: string;
  feature: AiFeature;
  day: string;
  prevZNo?: string | null;
  expect: {
    documentType?: string;
    ok?: boolean;
    /** Öteki bölüme okut düğmesi; null: düğme yok */
    switchTo?: string | null;
    /** Okunmayan (`ok: false`) belgenin metninde geçmesi gereken (yönerge, ör. "K.KARTI") */
    errorIncludes?: string;
    values?: Record<string, number | string>;
    /** Yalnız net (high) okunan alanlar karşılaştırılır; okunmayan ya da tahmin edilen hata sayılmaz */
    highOnly?: boolean;
    /** "Okunamadı" da geçer (çok bulanık fotoğraf) */
    unreadableOk?: boolean;
    issues?: string[];
    checksInclude?: string[];
    noWarn?: boolean;
    toExpensesDefault?: boolean;
  };
}

/** Fişte seçilebilen kategoriler (personelin göreceğine benzer; veritabanından değil) */
const CATEGORIES = [
  { id: 1, name: "Nakit malzeme alımı", section: "mal" },
  { id: 2, name: "Bakım & onarım", section: "genel" },
  { id: 3, name: "Diğer fatura dışı", section: "genel" },
  { id: 4, name: "Temizlik malzemesi", section: "genel" },
];

const ROOT = join(__dirname, "..", "..");
const IMAGE_DIRS = [join(ROOT, ".data", "foto-eval"), join(ROOT, "docs", "planlar", "ekler", "fotograf-eval", "img")];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function imagePath(name: string): string | null {
  for (const dir of IMAGE_DIRS) if (existsSync(join(dir, name))) return join(dir, name);
  return null;
}

function request(c: Case, bytes: Uint8Array): ExtractRequest<KasaZ | KasaPos | Receipt> {
  const image = { bytes, mediaType: "image/jpeg" as const };
  if (c.feature === "kasa-z") return { image, system: SYSTEM, task: Z_TASK(c.day), schema: KasaZRaw };
  if (c.feature === "kasa-pos") return { image, system: SYSTEM, task: POS_TASK(c.day), schema: KasaPosRaw };
  return { image, system: SYSTEM, task: RECEIPT_TASK(c.day, CATEGORIES), schema: ReceiptRaw };
}

type Reading = { kind: "cash"; r: CashReading } | { kind: "receipt"; r: ReceiptReading };

function normalize(c: Case, raw: KasaZ | KasaPos | Receipt): Reading {
  if (c.feature === "kasa-z") return { kind: "cash", r: normalizeZ(raw as KasaZ, { day: c.day, prevZNo: c.prevZNo ?? null }) };
  if (c.feature === "kasa-pos") return { kind: "cash", r: normalizePos(raw as KasaPos, { day: c.day }) };
  return { kind: "receipt", r: normalizeReceipt(raw as Receipt, { day: c.day, categories: CATEGORIES, recent: [], staff: true }) };
}

/** Okunan değer ve güveni */
function valueOf(reading: Reading, field: string): { value: number | string | null; confidence: string | null } {
  if (reading.kind === "cash") {
    const v = reading.r.values[field as ReadField];
    return { value: v?.value ?? null, confidence: v?.confidence ?? null };
  }
  const value = (reading.r.values as Record<string, number | string | null>)[field] ?? null;
  return { value, confidence: reading.r.confidence[field as ReceiptField] ?? (value === null ? null : "high") };
}

const same = (a: number | string | null, b: number | string) =>
  a !== null && (typeof b === "number" ? Math.abs(Number(a) - b) < 0.005 : String(a).replace(/^0+(?=\d)/, "") === b.replace(/^0+(?=\d)/, ""));

const shown = (v: number | string | null) => (v === null ? "—" : typeof v === "number" ? money(v) : v);

async function main() {
  // Kayıtlı yanıtlar (tests/fixtures/foto) türe ve görselin ölçüsüne göre seçilir; yeni durumlarda beklenenle tutmaz
  const recorded = process.argv.includes("--kayitli");
  if (!recorded && (process.env.FOTO_EVAL !== "1" || !process.env.ANTHROPIC_API_KEY?.trim())) {
    console.error("Bu betik gerçek okuma yapar ve para harcar. Çalıştırmak için: FOTO_EVAL=1 ANTHROPIC_API_KEY=… npx tsx scripts/foto-eval/run.ts");
    process.exit(2);
  }
  const max = Math.max(1, Number(arg("max") ?? Infinity) || Infinity);
  const only = arg("only");
  const cases = (JSON.parse(readFileSync(join(__dirname, "cases.json"), "utf8")) as Case[]).filter((c) => !only || c.name === only).slice(0, max);
  if (!cases.length) {
    console.error(only ? `Durum yok: ${only}` : "cases.json boş");
    process.exit(2);
  }
  const missing = cases.filter((c) => !imagePath(c.image)).map((c) => c.image);
  if (missing.length) {
    console.error(`Görsel yok: ${[...new Set(missing)].join(", ")}. Önce: python3 scripts/foto-eval/make-images.py`);
    process.exit(2);
  }

  const anthropic = recorded ? null : new Anthropic();
  const clientFor = (feature: AiFeature): AiClient =>
    anthropic ? { beta: { messages: { create: (params, options) => anthropic.beta.messages.create(params, options) } } } : replayClient(feature);
  let totalUsd = 0;
  let failed = 0;
  console.log(`${cases.length} durum · ${AI_MODEL}${recorded ? " · kayıtlı yanıtlar (ağ yok)" : ""}\n`);

  for (const c of cases) {
    const bytes = new Uint8Array(readFileSync(imagePath(c.image)!));
    const t0 = Date.now();
    const res = await runExtraction(clientFor(c.feature), request(c, bytes));
    const ms = Date.now() - t0;
    const cost = res.usage ? costUsd(res.usage, AI_MODEL) : null;
    totalUsd += cost?.usd ?? 0;
    const head = `${c.name} (${c.feature}, ${c.image}) · ${(ms / 1000).toFixed(1)} sn · ${cost ? `${cost.usd.toFixed(4)} $` : "—"}${cost?.fallback ? " · yedek model" : ""}`;
    if (!res.ok) {
      failed++;
      console.log(`✗ ${head}\n    okuma başarısız: ${res.code} · ${res.detail}\n`);
      continue;
    }
    const raw = res.data;
    const reading = normalize(c, raw);
    const e = c.expect;
    const problems: string[] = [];
    const notes: string[] = [];
    if (e.documentType && raw.documentType !== e.documentType) problems.push(`belge türü ${raw.documentType}, beklenen ${e.documentType}`);
    const unreadable = !reading.r.ok && e.unreadableOk;
    if (!unreadable && e.ok !== undefined && reading.r.ok !== e.ok) problems.push(`ok ${reading.r.ok}, beklenen ${e.ok}`);
    if (e.ok !== false && !reading.r.ok && !unreadable) problems.push(`okunamadı: ${reading.r.error}`);
    if (e.switchTo && (reading.kind !== "cash" || reading.r.switchTo !== e.switchTo)) problems.push(`öteki bölüme okut önerilmedi (${e.switchTo})`);
    if (e.switchTo === null && reading.kind === "cash" && reading.r.switchTo) problems.push(`öteki bölüme okut önerildi (${reading.r.switchTo})`);
    if (e.errorIncludes && !(reading.r.error ?? "").includes(e.errorIncludes)) problems.push(`metin yok: "${e.errorIncludes}"`);
    if (reading.r.ok && e.values) {
      let exact = 0;
      for (const [field, want] of Object.entries(e.values)) {
        const got = valueOf(reading, field);
        if (e.highOnly && got.confidence !== "high") {
          notes.push(`${field}: ${got.value === null ? "okunmadı" : `${shown(got.value)} (${got.confidence})`}`);
          continue;
        }
        if (same(got.value, want)) exact++;
        else problems.push(`${field}: ${shown(got.value)}${got.confidence ? ` (${got.confidence})` : ""}, beklenen ${shown(want)}`);
      }
      notes.unshift(`${exact}/${Object.keys(e.values).length} alan doğru`);
    }
    for (const issue of e.issues ?? []) if (!raw.issues.includes(issue as never) && !unreadable) problems.push(`"${issue}" işaretlenmedi`);
    const texts = reading.r.checks.map((k) => k.text);
    for (const part of e.checksInclude ?? []) if (!texts.some((t) => t.includes(part))) problems.push(`uyarı yok: "${part}"`);
    if (e.noWarn && reading.r.checks.some((k) => k.level === "warn")) problems.push("beklenmeyen uyarı");
    if (e.toExpensesDefault !== undefined && (reading.kind !== "receipt" || reading.r.toExpensesDefault !== e.toExpensesDefault)) problems.push(`Aylık harcamalar varsayılanı beklenen ${e.toExpensesDefault}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? "✗" : "✓"} ${head}`);
    if (notes.length) console.log(`    ${notes.join(" · ")}`);
    for (const p of problems) console.log(`    ✗ ${p}`);
    if (raw.issues.length) console.log(`    işaretler: ${raw.issues.join(", ")}`);
    for (const k of reading.r.checks) console.log(`    ${k.level === "warn" ? "uyarı" : "bilgi"}: ${k.text}`);
    console.log("");
  }
  console.log(`Toplam: ${cases.length - failed}/${cases.length} geçti · ${totalUsd.toFixed(4)} $${recorded ? " (kayıtlı yanıtların tutarı; bu çalışma ücretsiz)" : ""}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
