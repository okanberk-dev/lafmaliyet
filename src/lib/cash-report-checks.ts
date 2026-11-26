import { CASH_TOLERANCE, carryDiffText, computeCash, nextWarning, revenueWord, unreceiptedText, withCardExtra, type CarryCheck, type CashOffDevice, type CashReportFields } from "./cash-report";
import { money } from "./format";
import { lafposDiffText, type LafposDiff } from "./lafpos/diffs";
import { modposDiffText, type ModposDiff } from "./modpos/compare";
import { okcHasFigures, okcReconcile } from "./okc-z";
import { photoDiffText, type PhotoDiff } from "./photo-read/kasa";
import { dayMonthTR } from "./reminders";
import { emailFailedLine } from "./staff-errors";

/**
 * Yöneticinin kasa raporu penceresinin "Kontrol" listesi (sahibin kararı, 4 Kasım 2026: sade, profesyonel, gereksiz
 * bilgi yok): raporun kendi denetimleri ve dış kaynaklarla farkları tek listede, her biri tek satır. Kasa farkı başlıkta
 * olduğu için burada yok. Sıra: e-posta, raporun kendi içi (ödeme türleri, fişsiz çıkış, açılış ↔ devir), kart ve yazarkasa, dış
 * kaynaklar (ModPOS API, LafPOS, fotoğraf). Saf: tests/kasa-raporu-sade.test.ts
 */
export interface ReportCheck {
  key: string;
  text: string;
  tone: "warn" | "bad";
}

export function reportChecks(i: {
  report: CashReportFields;
  cardExtra?: number | null;
  /** LafPOS gününde yazarkasadan geçmeyen satış ödemeleri (Faz 2): kart karşılaştırması düşer (withCardExtra) */
  offDevice?: CashOffDevice | null;
  kasa?: "ModPOS" | "LafPOS";
  carry?: CarryCheck | null;
  next?: CarryCheck | null;
  modposDiffs?: readonly ModposDiff[] | null;
  lafposDiffs?: readonly LafposDiff[] | null;
  photoDiffs?: readonly PhotoDiff[] | null;
  emailError?: string | null;
  /** Fişsiz çıkış (bulgu 2; unreceiptedCashOut): "Gün içinde çıkan"ın kasadan çıkan satırlarından fazlası */
  unreceipted?: number | null;
}): ReportCheck[] {
  const kasa = i.kasa ?? "ModPOS";
  const f = withCardExtra(i.report, i.cardExtra, i.offDevice, kasa);
  const c = computeCash(f);
  const out: ReportCheck[] = [];
  // Müdürün ve muhasebecinin sabit metni zaten tam cümle: "E-posta gitmedi:" yinelenmez (emailFailedLine; bulgu 9)
  if (i.emailError) out.push({ key: "email", tone: "bad", text: emailFailedLine(i.emailError) });
  if (Math.abs(c.paymentsDiff) >= CASH_TOLERANCE) {
    out.push({
      key: "payments",
      tone: "warn",
      text: `Ödeme türleri toplamı ${money(c.paymentsTotal)}: ${revenueWord(c)} ${money(Math.abs(c.paymentsDiff))} ${c.paymentsDiff > 0 ? "fazla" : "az"}`,
    });
  }
  // Fişsiz çıkış: satır girilmeden yazılan çıkış olması gerekeni düşürür, açığı örtebilir; neye çıktığı yanında (bulgu 2)
  if (i.unreceipted && i.unreceipted >= CASH_TOLERANCE) {
    const note = i.report.cashOutNote?.trim();
    out.push({ key: "unreceipted", tone: "warn", text: `${unreceiptedText(i.unreceipted)}${note ? `; neye çıktı: ${note}` : "; neye çıktığı yazılmadı"}` });
  }
  if (i.carry) out.push({ key: "carry", tone: "warn", text: `Açılış ${money(i.carry.opening)}, ${dayMonthTR(i.carry.prevDate)} devri ${money(i.carry.carry)}: ${carryDiffText(i.carry)}` });
  if (i.next) out.push({ key: "next", tone: "warn", text: nextWarning(i.next) });
  if (okcHasFigures(f)) {
    for (const l of okcReconcile({ ...f, bankPos: f.bankPos ?? null }, "admin", kasa)) if (l.tone === "warn") out.push({ key: l.key, tone: "warn", text: l.text });
  } else if (c.cardDiff !== null && Math.abs(c.cardDiff) >= CASH_TOLERANCE) {
    out.push({ key: "card", tone: "warn", text: `Banka POS ${kasa} kartından ${money(Math.abs(c.cardDiff))} ${c.cardDiff > 0 ? "fazla" : "az"}` });
  }
  for (const d of i.modposDiffs ?? []) out.push({ key: `modpos:${d.field}`, tone: "warn", text: `ModPOS API'den farklı: ${modposDiffText(d)}` });
  for (const d of i.lafposDiffs ?? []) out.push({ key: `lafpos:${d.field}`, tone: "warn", text: `LafPOS'tan farklı: ${lafposDiffText(d)}` });
  for (const [n, d] of (i.photoDiffs ?? []).entries()) out.push({ key: `photo:${n}`, tone: "warn", text: `Fotoğraftan farklı: ${photoDiffText(d)}` });
  return out;
}
