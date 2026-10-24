/**
 * Satış tahmininin Türkçe metinleri tek yerde (saf; tests/satis-tahmini.test.ts): yüzdeler, gün başlıkları, etiketler,
 * "Nasıl hesaplandı" satırları, veri uyarısı, personelin görünümü (tutarsız), Bugün kartının alt satırı ve sabah
 * e-postasının kutusu.
 */

import { money, monthLabel, num, tl } from "@/lib/format";
import { dayMonthTR, longDateTR, todayTR } from "@/lib/reminders";
import type { DigestBox } from "@/server/notify/digest-template";

import { pairFor, type Accuracy, type SnapshotLite } from "./accuracy";
import { coverageNote, rangeTR, shortRangeTR, WEEKDAY_NAMES, WEEKDAY_SHORT } from "./calendar";
import { dessertPlan, type DessertPlan, type ProductMix } from "./desserts";
import { DEFAULT_FACTORS, DEFAULT_WEEKDAY, FACTOR_CLAMP, SPECIAL_KIND_LABEL, type Forecast, type ForecastDay, type ForecastLevel, type SpecialDay } from "./model";
import { staffFor, type ForecastSettings } from "./staffing";
import { symbolWord, weatherKind } from "./weather";

/** Pazartesiden başlayan hafta (ekrandaki sıra) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "+%20", "−%8" (U+2212), "%0": oran farkı (0,2 → +%20) */
export function signedPct(v: number): string {
  const p = Math.round(v * 100);
  if (p === 0) return "%0";
  return p > 0 ? `+%${p}` : `−%${-p}`;
}

/** "%11": işaretsiz yüzde (sapma) */
export const plainPct = (v: number) => `%${Math.round(Math.abs(v) * 100)}`;

export const LEVEL_LABEL: Record<ForecastLevel, string> = { yuksek: "Yüksek", normal: "Normal", dusuk: "Düşük", kapali: "Kapalı" };

export function levelLabel(level: ForecastLevel): string {
  return LEVEL_LABEL[level];
}

/** "Bugün · 22 Ekim Perşembe", "Yarın · 23 Ekim Cuma", sonra "24 Ekim Cumartesi" */
export function dayTitle(date: string, offset: number): string {
  if (offset === 0) return `Bugün · ${longDateTR(date)}`;
  if (offset === 1) return `Yarın · ${longDateTR(date)}`;
  return longDateTR(date);
}

/**
 * Günün etiketleri: çarpanlar yüzdesiyle ("Cumhuriyet Bayramı +%20", "Yağmur +%5", "Eğilim +%12"); etkisi olmayan
 * takvim olayı (hafta sonuna düşen resmî tatil, Kurban Bayramı) ve etkisi bilinmeyen özel gün yalnız adıyla.
 */
export function reasonChips(day: ForecastDay): string[] {
  const out = day.factors.map((f) => `${f.chip} ${signedPct(f.value - 1)}`);
  if (day.calendar.event && !day.factors.some((f) => f.key === day.calendar.event!.kind)) out.unshift(day.calendar.event.short);
  for (const s of day.special) if (s.kind !== "kapali" && !s.effect) out.push(s.title);
  return out;
}

/**
 * Yoğunluğun nedenleri, yüzdesiz (personel satırı ve e-posta): takvim olayı, mevsim, hava, özel günler. Eğilim iç
 * hesaptır, yazılmaz.
 */
export function reasonNames(day: ForecastDay): string[] {
  const out: string[] = [];
  const e = day.calendar.event;
  if (e) out.push(e.kind === "arife" ? e.name : e.short);
  for (const f of day.factors) {
    if (f.key === "ramazan") out.push("Ramazan");
    else if (f.key === "okul-tatili") out.push("okul tatili");
    else if (f.key === "yagmur") out.push("yağmur");
    else if (f.key === "sicak") out.push("sıcak hava");
  }
  for (const s of day.special) if (s.kind !== "kapali") out.push(s.title);
  return out;
}

const SOURCE_TEXT = { varsayilan: "varsayılan", sizin: "sizin seçiminiz", egilim: "kendi verinizden" } as const;

/** Bir hafta gününün payı: "%95" */
const sharePct = (v: number) => `%${Math.round(v * 100)}`;

/** Hava satırı: "Hava (MET Norway): Yağmurlu · gün içi 6 mm · en yüksek 19 °C." */
export function weatherLine(day: ForecastDay): string | null {
  const w = day.weather;
  if (!w) return null;
  const word = symbolWord(w.symbol) ?? (weatherKind(w) === "yagmur" ? "Yağmurlu" : null);
  const parts = [word, w.precipMm !== null && w.precipMm >= 0.5 ? `gün içi ${num(w.precipMm)} mm` : null, w.tMax !== null ? `en yüksek ${num(w.tMax)} °C` : null].filter(Boolean);
  return parts.length ? `Hava (MET Norway): ${parts.join(" · ")}.` : null;
}

export interface ExplainCtx {
  forecast: Forecast;
  settings: ForecastSettings;
  /** Bu ay kadrodaki kişi (Personel); bilinmiyorsa null */
  roster: number | null;
  mix: ProductMix | null;
  /** Günün tatlı adedi (dessertPlan.perDay) */
  desserts: number | null;
  /** O günün bu sabah kaydedilen tahmini */
  snapshot: SnapshotLite | null;
}

/** Satış ayları: "Eylül 2026", "Temmuz–Eylül 2026", "Kasım 2026 – Ocak 2027" */
export function monthsLabel(months: readonly string[]): string {
  if (!months.length) return "";
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return monthLabel(first);
  if (first.slice(0, 4) === last.slice(0, 4)) return `${monthLabel(first).split(" ")[0]}–${monthLabel(last)}`;
  return `${monthLabel(first)} – ${monthLabel(last)}`;
}

/** Günün "Nasıl hesaplandı" satırları */
export function explainLines(day: ForecastDay, ctx: ExplainCtx): string[] {
  if (day.closed) return [`${day.closed.title}: kafe kapalı olarak işaretli; satış, kişi ve tatlı önerisi yok.`];
  const f = ctx.forecast;
  const lines: string[] = [];
  const wd = WEEKDAY_NAMES[day.weekday];
  const b = day.base;
  if (b.source === "hafta-gunu") {
    lines.push(`Taban: son ${b.n} ${wd} gününün ortalaması ${tl(b.amount)} (${b.n >= 5 ? "en yüksek ve en düşük gün hariç" : "ortanca"}).`);
  } else if (b.source === "ortalama" && f.level) {
    lines.push(`Taban: son ${f.level.windowDays} günün ${f.level.n} kasa raporuna göre ortalama gün ${tl(f.level.value)} × ${wd} payı ${sharePct(b.share ?? 1)} (varsayılan) = ${tl(b.amount)}.`);
  } else if (b.source === "ay" && f.level?.month) {
    lines.push(`Taban: ${monthLabel(f.level.month)} ortalaması günde ${tl(f.level.value)} (${f.level.openDays} açık gün) × ${wd} payı ${sharePct(b.share ?? 1)} (varsayılan) = ${tl(b.amount)}.`);
  }
  for (const x of day.factors) {
    if (x.key === "egilim") {
      lines.push(`Son 2 hafta tabanın %${Math.round(Math.abs(x.value - 1) * 100)} ${x.value >= 1 ? "üstünde" : "altında"}: ×${num(x.value, 2)}.`);
    } else {
      lines.push(`${x.label}: ${signedPct(x.value - 1)} (${SOURCE_TEXT[x.source]}).`);
    }
  }
  const raw = day.factors.reduce((a, x) => a * x.value, 1);
  if (Math.abs(raw - day.factor) > 1e-9) lines.push(`Çarpanların toplamı sınırda tutuldu (×${num(FACTOR_CLAMP[0], 1)}–${num(FACTOR_CLAMP[1], 1)}).`);
  const wl = weatherLine(day);
  if (wl) lines.push(wl);
  const spread = day.spreadPct !== null ? ` (veri az: ±%${Math.round(day.spreadPct * 100)}).` : " (geçmiş tahminlerin sapmalarına göre).";
  lines.push(`Tahmin ≈ ${tl(day.amount)}; çoğu gün ${num(day.low)}–${tl(day.high)} arasında kalır${spread}`);
  const s = ctx.settings;
  const staff = staffFor(day, s);
  const rawCount = Math.ceil(day.amount / s.perPerson - 1e-9);
  const clampNote = rawCount < staff.count ? ` (en az ${s.minStaff} kişi)` : rawCount > staff.count ? ` (en çok ${s.maxStaff} kişi)` : "";
  lines.push(
    `Personel: ${num(day.amount)} ÷ ${tl(s.perPerson)} kişi başı → ${staff.count} kişi${clampNote}${staff.ifBusy ? `; yoğun geçerse ${staff.ifBusy}` : ""}.${
      ctx.roster !== null && staff.count > ctx.roster ? ` Kadroda ${ctx.roster} kişi var.` : ""
    }`,
  );
  if (ctx.mix && ctx.desserts !== null) {
    const per10k = Math.round(ctx.mix.dessertsPerTL * 10_000 * 10) / 10;
    lines.push(`Tatlı: ≈ ${ctx.desserts} (${monthsLabel(ctx.mix.basis.months)} satışlarına göre her 10.000 ₺'de ${num(per10k, 1)} tatlı).`);
  }
  const snap = ctx.snapshot;
  if (snap && !snap.closed && day.amount > 0 && Math.abs(snap.amount - day.amount) / day.amount >= 0.02) {
    lines.push(`Bu sabah kaydedilen tahmin: ${tl(snap.amount)}; tutturma bununla ölçülür.`);
  }
  return lines;
}

/** Sayfanın veri uyarısı (kaba tahminde); tam veride ve takvim notu yoksa null */
export function qualityBanner(f: Forecast): string | null {
  let text: string | null = null;
  if (f.quality === "ay" && f.level?.month) {
    const head = f.reports.total ? `Henüz ${f.reports.total} günlük kasa raporu var.` : "Henüz kasa raporu yok.";
    text = `${head} Tahmin şimdilik ${monthLabel(f.level.month)} ortalamasına (günde ${tl(f.level.value)}, ${f.level.openDays} açık gün) ve AVM'lerde tipik hafta günü farklarına dayanıyor; aralık bu yüzden geniş. Her hafta günü için 3 rapor birikince (yaklaşık 3 hafta) kendi verinizle hesaplanır.`;
  } else if (f.quality === "ortalama" && f.level) {
    text = `Son ${f.level.windowDays} günde ${f.level.n} günlük kasa raporu var. Hafta günü farkları şimdilik varsayılan; her gün için 3 rapor birikince kendi verinizden hesaplanır.`;
  } else if (f.quality === "karma") {
    const names = WEEK_ORDER.filter((w) => f.missingWeekdays.includes(w)).map((w) => WEEKDAY_NAMES[w]);
    text = `${names.join(", ")} için henüz 3 rapor yok; o günler ortalama güne göre hesaplandı.`;
  }
  const note = coverageNote(f.today);
  return [text, note].filter(Boolean).join(" ") || null;
}

/** "Takvim ve etkiler" tablosu: varsayılan etkiler ve hafta günü payları */
export function factorTable(f: Forecast): { label: string; effect: string; basis: string }[] {
  const ownCount = f.shares.filter((s) => s.own).length;
  const shares = WEEK_ORDER.map((w) => `${WEEKDAY_SHORT[w]} ${sharePct(f.shares[w]?.value ?? DEFAULT_WEEKDAY[w])}`).join(" · ");
  const D = DEFAULT_FACTORS;
  return [
    { label: "Hafta içi resmî tatil", effect: signedPct(D.resmi - 1), basis: "varsayılan" },
    { label: "Arife (hafta içi yarım gün)", effect: signedPct(D.arife - 1), basis: "varsayılan" },
    { label: "Ramazan Bayramı", effect: signedPct(D["ramazan-bayrami"] - 1), basis: "varsayılan" },
    { label: "Kurban Bayramı", effect: signedPct(D["kurban-bayrami"] - 1), basis: "varsayılan" },
    { label: "Ramazan ayı", effect: signedPct(D.ramazan - 1), basis: "varsayılan" },
    { label: "Okul tatili (hafta içi)", effect: signedPct(D["okul-tatili"] - 1), basis: "varsayılan" },
    { label: "Yağmurlu gün (5 mm ve üstü)", effect: signedPct(D.yagmur - 1), basis: "varsayılan" },
    { label: "Çok sıcak gün (35 °C ve üstü)", effect: signedPct(D.sicak - 1), basis: "varsayılan" },
    { label: "Hafta günü payları", effect: shares, basis: ownCount === 7 ? "kendi verinizden" : ownCount ? "kısmen kendi verinizden" : "varsayılan" },
    ...(f.trend !== null ? [{ label: "Son 2 hafta eğilimi", effect: signedPct(f.trend - 1), basis: "kendi verinizden" }] : []),
  ];
}

// ---------------------------------------------------------------- Personel (tutarsız)

/** Personelin Bugün'de gördüğü: yalnız yoğunluk, nedenlerin adı ve tatlı sayısı. Tutar, aralık, kişi önerisi yok */
export interface StaffForecastView {
  level: ForecastLevel;
  reasons: string[];
  desserts: { today: number; top: string[] } | null;
  closed: boolean;
}

/** Bugünün personel görünümü; tahmin yoksa null. Sunucu bunu kurup yalnız bunu personele verir */
export function staffView(f: Forecast, mix: ProductMix | null): StaffForecastView | null {
  const day = f.days[0];
  if (f.quality === "yok" || !day) return null;
  if (day.closed) return { level: "kapali", reasons: [], desserts: null, closed: true };
  let desserts: StaffForecastView["desserts"] = null;
  if (mix) {
    const plan = dessertPlan([day], mix);
    const top = plan.items
      .filter((x) => x.perDay[0] > 0)
      .slice(0, 2)
      .map((x) => x.item.label);
    if (plan.perDay[0] > 0) desserts = { today: plan.perDay[0], top };
  }
  return { level: day.level, reasons: reasonNames(day), desserts, closed: false };
}

/** Personelin "Bugün kafede" satırları (bugun/logic.ts cafeLines bunları başa koyar) */
export function staffForecastLines(v: StaffForecastView): { key: "yogunluk" | "tatli"; text: string; tone: "info" | "warn" }[] {
  if (v.closed) return [{ key: "yogunluk", text: "Bugün kafe kapalı olarak işaretli.", tone: "info" }];
  const out: { key: "yogunluk" | "tatli"; text: string; tone: "info" | "warn" }[] = [
    { key: "yogunluk", text: `Bugün yoğunluk: ${levelLabel(v.level)}${v.reasons.length ? ` · ${v.reasons.join(", ")}` : ""}`, tone: v.level === "yuksek" ? "warn" : "info" },
  ];
  if (v.desserts) out.push({ key: "tatli", text: `Tatlı: bugün ≈ ${v.desserts.today} satılır${v.desserts.top.length ? ` (en çok ${v.desserts.top.join(", ")})` : ""}`, tone: "info" });
  return out;
}

// ---------------------------------------------------------------- Bugün kartı ve sabah e-postası

/**
 * Bugün kartının alt satırı, sırayla: bugünün raporu girildiyse gerçekleşen (bu sabahki tahmine göre), yoksa dünün
 * tahmini ve gerçekleşeni, yoksa son 4 haftanın sapması; hiçbiri yoksa null.
 */
export function cardFooter(f: Forecast, snaps: readonly SnapshotLite[], actuals: ReadonlyMap<string, number>, acc: Accuracy, yesterday: string): string | null {
  const today = f.days[0];
  const actual = actuals.get(f.today);
  if (today && !today.closed && actual !== undefined && actual > 0) {
    const ref = pairFor(snaps, actuals, f.today)?.forecast ?? today.amount;
    return `Bugün gerçekleşen ${tl(actual)} (${signedPct((actual - ref) / ref)})`;
  }
  const y = pairFor(snaps, actuals, yesterday);
  if (y) return `Dün: tahmin ${tl(y.forecast)}, gerçekleşen ${tl(y.actual)} (${signedPct(y.deviation)})`;
  if (acc.miss !== null) return `Son 4 haftada ortalama sapma ${plainPct(acc.miss)}`;
  return null;
}

/** Sabah e-postasının "Satış tahmini" kutusu: hiçbir zaman haber değil, konuya ve başlığa girmez */
export function digestForecastBox(o: {
  forecast: Forecast;
  settings: ForecastSettings;
  plan: DessertPlan | null;
  snapshots: readonly SnapshotLite[];
  actuals: ReadonlyMap<string, number>;
  accuracy: Accuracy;
  yesterday: string;
  weatherUsed: boolean;
}): DigestBox | null {
  const f = o.forecast;
  const day = f.days[0];
  if (f.quality === "yok" || !day) return null;
  const lines: DigestBox["lines"] = [];
  if (day.closed) lines.push({ text: `Bugün kafe kapalı olarak işaretli (${day.closed.title}).` });
  else {
    const st = staffFor(day, o.settings);
    const reasons = reasonNames(day);
    lines.push({
      text: `Bugün ≈ ${tl(day.amount)} (${num(day.low)}–${num(day.high)}) · yoğunluk ${levelLabel(day.level).toLocaleLowerCase("tr-TR")} · ${st.count} kişi${st.ifBusy ? ` (yoğunsa ${st.ifBusy})` : ""}${reasons.length ? ` · ${reasons.join(", ")}` : ""}`,
    });
  }
  const y = pairFor(o.snapshots, o.actuals, o.yesterday);
  if (y) {
    lines.push({
      text: `Dün: tahmin ${tl(y.forecast)}, gerçekleşen ${tl(y.actual)} (${signedPct(y.deviation)})${o.accuracy.miss !== null ? ` · son 4 hafta ortalama sapma ${plainPct(o.accuracy.miss)}` : ""}`,
    });
  }
  const open = f.days.filter((d) => !d.closed);
  if (open.length) {
    const top = open.reduce((a, d) => (d.amount > a.amount ? d : a));
    const name = top.offset === 0 ? "bugün" : top.offset === 1 ? "yarın" : WEEKDAY_NAMES[top.weekday];
    lines.push({ text: `Haftanın en yoğun günü: ${name} ≈ ${tl(top.amount)}${o.plan && o.plan.weekTotal > 0 ? ` · 7 günde ≈ ${o.plan.weekTotal} tatlı` : ""}` });
  }
  if (o.weatherUsed) lines.push({ text: "Hava durumu: MET Norway verisi (CC BY 4.0)", tone: "muted" });
  return { title: "Satış tahmini", lines, href: "/panel/tahmin", link: "Ayrıntı", subjectPart: null, headline: null };
}

/** Bugün kartında ve listede günün tutarı: "≈ 18.500 ₺" */
export const approx = (v: number) => `≈ ${money(v)}`;

// ---------------------------------------------------------------- Özel günler ve saat

/** Özel günün etkisinin seçenekleri (formdaki sıra) */
export const EFFECT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0.3, label: "Çok artırır (+%30)" },
  { value: 0.15, label: "Artırır (+%15)" },
  { value: 0, label: "Etkisini bilmiyorum (yalnız not)" },
  { value: -0.15, label: "Azaltır (−%15)" },
  { value: -0.3, label: "Çok azaltır (−%30)" },
];

/** Özel günün türü ve etkisi: "Derbi / maç · +%15", "Diğer" (etkisi bilinmiyor), "Kafe kapalı" */
export function specialTail(d: Pick<SpecialDay, "kind" | "effect">): string {
  return d.kind === "kapali" ? SPECIAL_KIND_LABEL.kapali : `${SPECIAL_KIND_LABEL[d.kind]}${d.effect ? ` · ${signedPct(d.effect)}` : ""}`;
}

/** Listedeki satır: "25 Eki Cmt · Fenerbahçe – Galatasaray maçı · Derbi / maç · +%15", kapalıda "… · Kafe kapalı" */
export function specialRow(d: Pick<SpecialDay, "dateFrom" | "dateTo" | "kind" | "title" | "effect">): string {
  return `${shortRangeTR(d.dateFrom, d.dateTo)} · ${d.title} · ${specialTail(d)}`;
}

/** İşlem geçmişi ve bildirim: "25 Ekim Cumartesi · Fenerbahçe – Galatasaray maçı (Derbi / maç, +%15)" */
export function specialSummary(d: Pick<SpecialDay, "dateFrom" | "dateTo" | "kind" | "title" | "effect">): string {
  const effect = d.kind === "kapali" ? "" : d.effect ? `, ${signedPct(d.effect)}` : ", etkisi bilinmiyor";
  return `${rangeTR(d.dateFrom, d.dateTo)} · ${d.title} (${SPECIAL_KIND_LABEL[d.kind]}${effect})`;
}

const CLOCK = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "08:02" (Türkiye) */
export function clockTR(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/** "22 Ekim 08:02" (Türkiye) */
export function stampTR(iso: string): string {
  const d = new Date(iso);
  const day = todayTR(d);
  return `${dayMonthTR(day)} ${CLOCK.format(d)}`;
}
