/**
 * Fotoğrafta okunanın kısa dökümü (saf; tests/foto-ozet.test.ts): yöneticinin e-postası "fotoğrafta ne okundu" sorusunu
 * karşılaştırmadan bağımsız yanıtlasın (sahibin isteği, 25 Kasım 2026: "z raporu yükleyince mail gelmedi, rapor ve z
 * raporları okunmuyor"). Yalnız fişte basılı olup okunan rakamlar yazılır; okunmayan satır yazılmaz, hiçbir rakam
 * uydurulmaz. Güveni düşük rakamın yanına "(belirsiz)" eklenir. Kümülatif (KÜM.) satırlar günün rakamı değildir, yazılmaz.
 */

import { money } from "@/lib/format";

import { printedAmount } from "./common";
import { isAsilposPaper, okcPaperView } from "./okc";
import type { AmountRaw, KasaOkc } from "./schemas";

const DOC_LABEL: Record<KasaOkc["documentType"], string> = {
  z_report: "Z raporu",
  x_report: "X raporu (gün içi, Z değil)",
  period_report: "Dönem / mali hafıza raporu",
  batch_slip: "Banka gün sonu fişi",
  software_z: "Kasa programının raporu (mali Z değil)",
  other: "Tanınmayan belge",
};

const PAY_LABEL: Record<KasaOkc["payments"][number]["kind"], string> = {
  cash: "Nakit",
  card: "Kart",
  meal_card: "Yemek kartı",
  other: "Diğer",
  bank_subline: "Banka",
  drawer: "Çekmece",
  unknown: "Diğer",
};

/** Basılı ve okunmuş tutar: "9.350 ₺", güveni düşükse "9.350 ₺ (belirsiz)"; okunmadıysa null */
function amountText(a: AmountRaw): string | null {
  const p = printedAmount(a);
  if (p.value === null) return null;
  return `${money(p.value)}${p.confidence === "low" || p.mismatch ? " (belirsiz)" : ""}`;
}

/** Belgenin türü: Pavo'nun detaylı Z'si (Z + banka gün sonu tek fişte) ayrıca adlandırılır */
export function okcDocumentLabel(raw: KasaOkc): string {
  if (isAsilposPaper(raw)) return raw.batches.length ? "AsilPOS'un gün sonu kâğıdı (banka bölümü)" : "AsilPOS'un gün sonu kâğıdı (mali Z değil)";
  if (raw.documentType === "z_report" && raw.batches.length) return "Z raporu ve banka gün sonu (tek fişte)";
  return DOC_LABEL[raw.documentType];
}

/**
 * Yazarkasa / banka gün sonu fotoğrafının okunanı satır satır: belge, tarih, Z no, fiş sayısı, günün toplamı, ödemeler,
 * KDV dökümü, toplam KDV, batch'ler. AsilPOS'un kendi kâğıdında yalnız banka kısmı (Z'si mali değildir; okcPaperView)
 */
export function okcReadRows(read: KasaOkc): [string, string][] {
  const raw = okcPaperView(read);
  const rows: [string, string][] = [["Belge", okcDocumentLabel(read)]];
  if (!raw.readable) rows.push(["Durum", "rakamlar seçilmedi (bulanık, kesik ya da soluk)"]);
  if (raw.date) rows.push(["Tarih", `${raw.date.split("-").reverse().join(".")}${raw.time ? ` ${raw.time}` : ""}`]);
  const zNo = raw.zNo.text ?? (raw.zNo.value !== null ? String(raw.zNo.value) : null);
  if (zNo) rows.push(["Z no", `${zNo}${raw.zNo.confidence === "low" ? " (belirsiz)" : ""}`]);
  const receipts = raw.receiptCount.value ?? (raw.receiptCount.text ? Number(raw.receiptCount.text) : null);
  if (receipts !== null && Number.isFinite(receipts)) rows.push(["Fiş sayısı", String(receipts)]);
  const total = amountText(raw.dailyTotal);
  if (total) rows.push(["Günün toplamı", total]);
  for (const p of raw.payments) {
    if (p.kind === "drawer") continue;
    const v = amountText(p.amount);
    if (v) rows.push([`${PAY_LABEL[p.kind]}${p.label && PAY_LABEL[p.kind] === "Diğer" ? ` (${p.label})` : ""}`, v]);
  }
  for (const g of raw.kdvGroups) {
    const t = amountText(g.total);
    const v = amountText(g.vat);
    if (t || v) rows.push([`KDV %${g.rate}`, [t ? `toplam ${t}` : null, v ? `KDV ${v}` : null].filter(Boolean).join(" · ")]);
  }
  const vat = amountText(raw.totalVat);
  if (vat) rows.push(["Toplam KDV", vat]);
  for (const b of raw.batches) {
    const net = amountText(b.netTotal) ?? amountText(b.salesTotal);
    const name = [b.batchNo ? `Batch ${b.batchNo}` : "Batch", b.bank].filter(Boolean).join(" · ");
    rows.push([name, net ?? "tutar okunamadı"]);
  }
  return rows;
}
