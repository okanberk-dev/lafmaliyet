// Komisyon & hakediş ekranının metinleri (saf; tests/komisyon.test.ts): hakediş satırı, kartın durum rozeti, satışın
// kaynağı, oranın parçaları, bekleyen hakedişler, Z toplamının alt satırı, Platformlar satırı ve yemek kartı oranı
// karosu. Kurallar src/lib/commission/report.ts'te.

import type { Tone } from "@/components/ui/badge";
import { LINE_CLASSES, LINE_LABEL, type ChannelDef, type ChannelKind } from "@/lib/commission/channels";
import { approxMoney, MEAL_LIMIT, LIMIT_TOLERANCE, type ChannelMonth, type ChannelSales, type GroupMonth } from "@/lib/commission/report";
import { money, pct } from "@/lib/format";
import { genitive } from "@/lib/recipe-change";
import { dayAblativeTR, dayLocativeTR, dayMonthTR } from "@/lib/reminders";

import type { ChannelMonthData } from "./channel-month-dialog";

/**
 * Satışın kaynağı (Satış satırının altında, sönük): yazılan ekstre, AsilPOS'un ödemeleri (ModPOS föyünde markası bulunan
 * ödemeler de; markası belirsiz tutar kanala yazılmaz) ya da (AsilPOS'tan önceki ayda, grupta tek kanal varken) Z toplamı
 */
export function sourceLabel(sales: Pick<ChannelSales, "source"> & Partial<Pick<ChannelSales, "foy" | "amount">>, kind: ChannelKind): string {
  if (sales.source === "elle") return "Kanalın ekstresinden (elle)";
  if (sales.source === "asilpos") {
    if (!sales.foy) return "AsilPOS ödemelerinden";
    return sales.amount !== undefined && sales.amount <= sales.foy ? "ModPOS föyünden" : "AsilPOS ödemeleri ve ModPOS föyünden";
  }
  return kind === "meal" ? "Z'deki yemek kartı toplamı (tek kart)" : "Z'deki online (platformlar) toplamı (tek platform)";
}

/** Yemek kartında oran %6'nın üstünde mi (yuvarlamayı yutan payla) */
export const overMealLimit = (rate: number | null | undefined) => rate !== null && rate !== undefined && rate > MEAL_LIMIT + LIMIT_TOLERANCE;

/**
 * Kartın durum rozeti, en kötüsü: Sınırın üstünde (kesin %6 aşımı), Hakediş gecikti, Kontrol edin (kırmızı: komisyon
 * dışı ücret; turuncu: öteki uyarılar), oran yoksa nedeni (Satış bilinmiyor; satış yazıldı ama Fatura bekleniyor;
 * satış ve fatura var ama iade ayı eksiye düşürdü ya da satış 0: Oran yok), Takip öncesi, Tamam (oran belli, uyarı yok,
 * hakediş geldi ya da bekliyor). O ay satırı yoksa "Bu ay fatura yok".
 */
export function statusBadge(row: ChannelMonth | null): { text: string; tone: Tone } {
  if (!row) return { text: "Bu ay fatura yok", tone: "gray" };
  if (row.flags.some((f) => f.key === "oran-sinir" && f.level === "bad")) return { text: "Sınırın üstünde", tone: "red" };
  if (row.payout.status === "gecikti") return { text: "Hakediş gecikti", tone: "red" };
  if (row.flags.some((f) => f.level === "bad")) return { text: "Kontrol edin", tone: "red" };
  if (row.flags.some((f) => f.level === "warn") || row.payout.status === "eksik") return { text: "Kontrol edin", tone: "amber" };
  if (!row.sales) return { text: "Satış bilinmiyor", tone: "gray" };
  if (!row.invoices.length) return { text: "Fatura bekleniyor", tone: "gray" };
  if (row.rate === null) return { text: "Oran yok", tone: "gray" };
  if (row.payout.status === "takip-oncesi") return { text: "Takip öncesi", tone: "gray" };
  return { text: "Tamam", tone: "green" };
}

/** Oranın parçaları, sıfır olmayan sınıflar: "Komisyon %3,0 · erken ödeme %3,2"; satış bilinmiyorsa tutarlarla */
export function ratePartsText(row: Pick<ChannelMonth, "fees" | "sales">): string | null {
  const sales = row.sales && row.sales.amount > 0 ? row.sales.amount : null;
  const parts = LINE_CLASSES.filter((c) => Math.abs(row.fees[c]) >= 0.005).map((c, i) => {
    const label = i === 0 ? LINE_LABEL[c] : LINE_LABEL[c].toLocaleLowerCase("tr-TR");
    return `${label} ${sales !== null ? pct(row.fees[c] / sales) : money(row.fees[c])}`;
  });
  return parts.length ? parts.join(" · ") : null;
}

/** Beklenen hakedişin formülü: "Satış 9.300 ₺ − faturalar 694,80 ₺" */
export function expectedFormula(row: Pick<ChannelMonth, "sales" | "payable">): string | null {
  return row.sales ? `Satış ${money(row.sales.amount)} − faturalar ${money(row.payable)}` : null;
}

export type TextTone = "default" | "good" | "bad" | "warn" | "muted";

/** Kanal-ayın hakediş satırı (kartın altında); satır yoksa bu ay fatura yok */
export function payoutText(row: ChannelMonth | null): { text: string; sub: string | null; tone: TextTone } {
  if (!row) return { text: "Fatura gelince hakedişin son günü burada çıkar.", sub: null, tone: "muted" };
  const p = row.payout;
  const due = p.due ? dayMonthTR(p.due) : null;
  const formula = expectedFormula(row);
  switch (p.status) {
    case "geldi":
      return {
        text: `Hakediş geldi: ${dayMonthTR(p.receivedOn!)} · ${money(p.received)}${p.lateDays ? ` · ${p.lateDays} gün geç` : ""}`,
        sub: p.expected !== null && p.expected > 0 ? `Beklenen ${approxMoney(row.kind, p.expected)} (${formula!.toLocaleLowerCase("tr-TR")})` : null,
        tone: "good",
      };
    case "eksik":
      return {
        text: `Hakediş geldi: ${dayMonthTR(p.receivedOn!)} · ${money(p.received)} · beklenenden ${money(Math.round((p.expected! - p.received!) * 100) / 100)} az`,
        sub: formula ? `Beklenen ${approxMoney(row.kind, p.expected!)} (${formula.toLocaleLowerCase("tr-TR")})` : null,
        tone: "warn",
      };
    case "bekliyor":
    case "gecikti": {
      const late = p.status === "gecikti" ? ` · ${p.daysOverdue} gün gecikti` : "";
      const tone = p.status === "gecikti" ? "bad" : "default";
      if (p.expected === null) return { text: `Hakediş: son gün ${due}${late}`, sub: "Beklenen tutar satış bilinince çıkar.", tone };
      return { text: `Hakediş: beklenen ${approxMoney(row.kind, p.expected)} · son gün ${due}${late}`, sub: formula, tone };
    }
    case "takip-oncesi":
      return { text: `Hakediş: son gün ${due} geçti (takip öncesi). İsterseniz işaretleyin.`, sub: null, tone: "muted" };
    case "faturasiz":
      return { text: "Hakediş: fatura gelince son gün belli olur.", sub: null, tone: "muted" };
    default:
      return { text: row.invoices.length ? "Hakediş: beklenecek tutar yok." : "Hakediş: bu ay fatura yok.", sub: null, tone: "muted" };
  }
}

/** Bekleyen hakedişler kartının rozeti: Gecikti (kırmızı), Bu hafta, Eksik geldi (turuncu) */
export function pendingBadge(row: ChannelMonth): { text: string; tone: Tone } {
  if (row.payout.status === "gecikti") return { text: "Gecikti", tone: "red" };
  if (row.payout.status === "eksik") return { text: "Eksik geldi", tone: "amber" };
  return { text: "Bu hafta", tone: "amber" };
}

/** Bekleyen hakedişler kartının alt satırı: "~8.605,20 ₺ · son gün 30 Kasım" */
export function pendingSub(row: ChannelMonth): string {
  const p = row.payout;
  if (p.status === "eksik") return `Gelen ${money(p.received)} · beklenen ${approxMoney(row.kind, p.expected!)}`;
  const amount = p.expected !== null ? approxMoney(row.kind, p.expected) : "Tutar bilinmiyor";
  return `${amount} · son gün ${p.due ? dayMonthTR(p.due) : "–"}${p.status === "gecikti" && p.daysOverdue ? ` · ${p.daysOverdue} gün gecikti` : ""}`;
}

/** Açık hakedişlerin toplamı (gecikti, bekliyor, eksik; tutarı bilinenler), sayısı, geciken ve tutarı bilinmeyen sayısı */
export function openPayouts(rows: readonly ChannelMonth[]): { total: number | null; late: number; count: number; unknown: number } {
  const open = rows.filter((r) => r.payout.status === "gecikti" || r.payout.status === "bekliyor" || r.payout.status === "eksik");
  const known = open.filter((r) => r.payout.expected !== null && r.payout.expected > 0);
  const total = known.reduce((a, r) => a + Math.max(0, r.payout.expected! - (r.payout.received ?? 0)), 0);
  return {
    total: known.length ? Math.round(total * 100) / 100 : null,
    late: open.filter((r) => r.payout.status === "gecikti").length,
    count: open.length,
    unknown: open.length - known.length,
  };
}

/** Bekleyen hakediş karosunun alt satırı: gecikme önce; toplam tutarı bilinmeyenleri içermiyorsa bunu söyler */
export function openPayoutsSub(o: ReturnType<typeof openPayouts>): { text: string; bad: boolean } {
  if (o.late) return { text: `${o.late} gecikti`, bad: true };
  if (o.unknown && o.total === null) return { text: `${o.count} hakediş · tutar bilinmiyor`, bad: false };
  if (o.unknown) return { text: `${o.unknown} hakedişin tutarı bilinmiyor`, bad: false };
  return { text: "Gecikme yok", bad: false };
}

/**
 * Z toplamının alt satırı: "31 / 31 gün raporlu", "3 gün rapor yok", "kasa raporları 16 Ekim'de başladı", "kasa raporu
 * yok". AsilPOS'un girdiği ayda (geçiş gününden itibaren) günler kasa raporu ya da AsilPOS gün sonuyla kayıtlıdır:
 * "30 / 30 gün kayıtlı · AsilPOS'tan", "2 gün kayıt yok · 10 Kasım'dan AsilPOS"
 */
export function tillSub(g: (Pick<GroupMonth, "zTotal" | "reportDays" | "missing" | "partialFrom"> & { closed?: readonly string[]; asilposFrom?: string | null }) | null): string {
  if (!g || g.zTotal === null) return "kasa raporu yok";
  if (g.asilposFrom) {
    const from = g.asilposFrom.endsWith("-01") ? "AsilPOS'tan" : `${dayAblativeTR(g.asilposFrom)} AsilPOS`;
    const closedText = g.closed?.length ? `${g.closed.length} gün kapalı` : null;
    if (g.partialFrom) return `${from} · öncesinin kasa raporu yok`;
    const days = g.missing.length ? `${g.missing.length} gün kayıt yok` : `${g.reportDays} / ${g.reportDays + (g.closed?.length ?? 0)} gün kayıtlı`;
    return [days, closedText, from].filter(Boolean).join(" · ");
  }
  if (g.partialFrom) return `kasa raporları ${dayLocativeTR(g.partialFrom)} başladı`;
  // Kapalı işaretli günler eksik sayılmaz ama sessizce düşmez: "2 gün kapalı"
  const closed = g.closed?.length ? `${g.closed.length} gün kapalı` : null;
  if (g.missing.length) return [`${g.missing.length} gün rapor yok`, closed].filter(Boolean).join(" · ");
  return [`${g.reportDays} / ${g.reportDays + (g.closed?.length ?? 0)} gün raporlu`, closed].filter(Boolean).join(" · ");
}

/** Platformlar bölümünün satırı: "Z'deki online (platformlar): 0 ₺ · 31 / 31 gün raporlu"; o ay kasa raporu yoksa "Kasa raporu yok" */
export function platformTillLine(g: (Pick<GroupMonth, "zTotal" | "reportDays" | "missing" | "partialFrom"> & { closed?: readonly string[]; asilposFrom?: string | null }) | null): string {
  return g?.zTotal != null ? `Z'deki online (platformlar): ${money(g.zTotal)} · ${tillSub(g)}` : "Kasa raporu yok";
}

/**
 * Grubun markası belirsiz satırı (AsilPOS'un girdiği ayda; GroupMonth.unbranded): hiçbir kanala yazılmayan tutar ve
 * nereden geldiği. Belirsiz tutar yoksa null
 */
export function unbrandedLine(u: GroupMonth["unbranded"], kind: ChannelKind): string | null {
  if (!u || !(u.amount > 0)) return null;
  const parts = [
    u.pre > 0 ? `AsilPOS'tan önceki günlerin Z'si ${money(u.pre)}` : null,
    u.modpos > 0 ? `ModPOS'ta kalan şubenin Z'si ${money(u.modpos)}` : null,
    u.loose > 0 ? `AsilPOS'ta kanalı seçilmemiş ödeme ${money(u.loose)}` : null,
    u.fallback > 0 ? `gün sonu gelmemiş günlerin kasa raporu ${money(u.fallback)}` : null,
  ].filter((p): p is string => p !== null);
  const [to, what] = kind === "meal" ? ["karta", "kartın"] : ["platforma", "platformun"];
  return `Marka belirsiz: ${money(u.amount)} (${parts.join(", ")}). Hiçbir ${to} yazılmaz; ${what} oranı yalnız markası bilinen satışla hesaplanır.`;
}

/**
 * Şube seçiliyken Komisyon & hakediş'in notu (docs/SUBE.md): satış şubenin, komisyon faturaları ve hakediş işletmenin
 * (faturalar şubeye bölünmez); oran işletmenin, şubenin payı = şube satışı × oran
 */
export function commissionBranchNote(name: string): { title: string; text: string } {
  return {
    title: `${name} seçili: satış yalnız bu şubenin, faturalar ve hakediş işletmenin`,
    text:
      "Komisyon faturaları şubeye bölünmez: kartlar ve platformlar, oran, beklenen hakediş ve uyarılar işletmenin toplamıdır; oran bütün şubelerin satışıyla hesaplanır. " +
      `${genitive(name)} payı = şubenin satışı × oran (aşağıdaki tablo). İşletmenin tamamı için soldan Tümü'nü seçin.`,
  };
}

/**
 * Şube payı kartının alt satırı (BranchShareCard; şubenin raporunun grupları, GroupMonth.unbranded): şubenin markası
 * belirsiz tutarı hiçbir kanala yazılmaz, şubenin payına da girmez (işletmenin oranı da onsuz hesaplanır). Yoksa null
 */
export function branchUnbrandedNote(meal: GroupMonth["unbranded"] | undefined, platform: GroupMonth["unbranded"] | undefined): string | null {
  const parts = [meal && meal.amount > 0 ? `yemek kartı ${money(meal.amount)}` : null, platform && platform.amount > 0 ? `online ${money(platform.amount)}` : null].filter(
    (p): p is string => p !== null,
  );
  if (!parts.length) return null;
  return `Şubenin markası belirsiz satışı: ${parts.join(", ")}. Hiçbir kanala yazılmaz, paya girmez (oran da yalnız markası bilinen satışla hesaplanır).`;
}

/** Yemek kartı oranı karosunun alt satırı: Z'deki yemek kartı (kasa raporu olan ayda 0 da) ve oran yoksa nedeni */
export function mealStatSub(g: Pick<GroupMonth, "zTotal" | "rate" | "partialFrom" | "invoiceCount"> | null): string {
  if (!g || g.zTotal === null) return "Satış bilinmiyor";
  const why = g.rate !== null || g.zTotal <= 0 ? null : g.partialFrom ? "Z ayın bir kısmı" : !g.invoiceCount ? "fatura yok" : null;
  return `Satış ${money(g.zTotal)}${why ? ` · ${why}` : ""}`;
}

/** Hakediş penceresinin verisi: kayıtlı işaret, ayın faturaları ve Z toplamı (o ay satırı yoksa boş işaretle) */
export function dialogData(def: Pick<ChannelDef, "key" | "label" | "kind">, month: string, row: ChannelMonth | null): ChannelMonthData {
  return {
    channel: def.key,
    label: def.label,
    kind: def.kind,
    month,
    receivedOn: row?.mark?.receivedOn ?? null,
    received: row?.mark?.received ?? null,
    sales: row?.mark?.sales ?? null,
    note: row?.mark?.note ?? null,
    payable: row?.payable ?? 0,
    invoiced: Boolean(row?.invoices.length),
    autoSales: row?.autoSales ?? null,
  };
}
