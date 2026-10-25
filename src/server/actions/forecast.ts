"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { businessDate } from "@/lib/cash-report";
import { rangeTR } from "@/lib/forecast/calendar";
import { effectiveDessertCategories, foldTR, isDessertCategory } from "@/lib/forecast/desserts";
import { DEFAULT_FORECAST_SETTINGS, MAX_DESSERT_CATEGORIES, PER_PERSON_MAX, PER_PERSON_MIN, STAFF_MAX, type ForecastSettings } from "@/lib/forecast/staffing";
import { clockTR, specialSummary } from "@/lib/forecast/text";
import { money } from "@/lib/format";
import { addDays, daysBetween } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { lockSpecialDays, revokeClosedRequests } from "@/server/closed-days";
import { getDb, schema as s } from "@/server/db";
import { runForecastJob } from "@/server/forecast/job";
import { FORECAST_SETTINGS_KEY, loadForecastSettings, SPECIAL_MAX_AHEAD_DAYS, SPECIAL_PAST_DAYS } from "@/server/forecast/load";

import { logActivity } from "./log";
import { attempt, UserError, type ActionResult } from "./util";

// Satış tahmini (yalnız yönetici; docs/SATIS-TAHMINI.md): özel günler, tahmin ayarları ve "Güncelle" (hava durumu ve
// bugünün tahmin kaydı). Personel bu ekranı açamaz; her eylem yöneticiyi ayrıca denetler.

/** Özel gün en çok bu kadar gün sürer; geriye ve ileriye sınırlar sayfanın listesiyle aynı (load.ts) */
const MAX_SPAN_DAYS = 14;

/** Gerçek bir gün (2026-02-31 değil) */
const zDay = (empty: string) =>
  z
    .string({ message: empty })
    .regex(/^\d{4}-\d{2}-\d{2}$/, empty)
    .refine((v) => addDays(v, 0) === v, empty);

const specialInput = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(["derbi", "avm", "kampanya", "kapali", "diger"], { message: "Ne olduğunu seçin" }),
  title: z.string({ message: "Ad gerekli" }).trim().min(1, "Ad gerekli").max(60, "Ad en çok 60 karakter"),
  dateFrom: zDay("Başlangıç gününü seçin"),
  dateTo: z.union([zDay("Bitiş gününü seçin"), z.literal(""), z.null()]).optional(),
  effect: z.union([z.literal(0.3), z.literal(0.15), z.literal(0), z.literal(-0.15), z.literal(-0.3)], { message: "Satışa etkisini seçin" }),
  note: z
    .string()
    .trim()
    .max(200, "Not en çok 200 karakter")
    .nullish()
    .transform((v) => v || null),
});

export type SpecialDayInput = z.input<typeof specialInput>;
export interface SpecialDayValues {
  kind: "derbi" | "avm" | "kampanya" | "kapali" | "diger";
  title: string;
  dateFrom: string;
  dateTo: string;
  effect: 0.3 | 0.15 | 0 | -0.15 | -0.3;
  note: string | null;
}

/**
 * Özel gün ekler ya da (id ile) düzenler. Kafe kapalıda etki −1 (tahmin 0). Bitiş boşsa aynı gün; en çok 14 gün. Geriye
 * bitişi en çok 60 gün önce olan (tahmin 60 günün kasa raporunu okur: geçmiş gün normal günlerin ortalamasından çıkar,
 * daha eskisi hiçbir şeyi değiştirmez ve listede görünmez), ileriye 1 yıl.
 */
export async function saveSpecialDay(input: SpecialDayInput): Promise<ActionResult<{ id: number; summary: string }>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = specialInput.parse(input);
    const dateTo = d.dateTo || d.dateFrom;
    if (dateTo < d.dateFrom) throw new UserError("Bitiş başlangıçtan önce olamaz");
    if (daysBetween(d.dateFrom, dateTo) + 1 > MAX_SPAN_DAYS) throw new UserError(`En çok ${MAX_SPAN_DAYS} gün seçilebilir`);
    const today = businessDate();
    if (dateTo < addDays(today, -SPECIAL_PAST_DAYS)) throw new UserError(`En çok ${SPECIAL_PAST_DAYS} gün geriye işaretlenebilir`);
    if (dateTo > addDays(today, SPECIAL_MAX_AHEAD_DAYS)) throw new UserError("En çok 1 yıl ileriye girilebilir");
    const effect = d.kind === "kapali" ? -1 : d.effect;
    const values = { kind: d.kind, title: d.title, dateFrom: d.dateFrom, dateTo, effect, note: d.note };
    // Personelin yazımlarıyla aynı danışma kilidi (src/server/closed-days.ts lockSpecialDays): çakışma ve sınırlar yarışmaz
    const id = await getDb().transaction(async (tx) => {
      await lockSpecialDays(tx);
      // Aynı adla üst üste binen ikinci kayıt etkiyi iki kez çarpar (aynı maç yanlışlıkla iki kez girilmiş)
      const overlapping = await tx
        .select({ id: s.specialDays.id, title: s.specialDays.title, dateFrom: s.specialDays.dateFrom, dateTo: s.specialDays.dateTo })
        .from(s.specialDays)
        .where(and(lte(s.specialDays.dateFrom, dateTo), gte(s.specialDays.dateTo, d.dateFrom)));
      const twin = overlapping.find((r) => r.id !== d.id && foldTR(r.title) === foldTR(d.title));
      if (twin) throw new UserError(`Bu günlerde aynı adla bir özel gün var (${rangeTR(twin.dateFrom, twin.dateTo)}); onu düzenleyin`);
      if (d.id) {
        // Son düzenleyen yazılır: yöneticinin dokunduğu personel satırını personel artık değiştiremez
        const [row] = await tx
          .update(s.specialDays)
          .set({ ...values, updatedBy: me.id, updatedByName: me.name, updatedAt: new Date() })
          .where(eq(s.specialDays.id, d.id))
          .returning({ id: s.specialDays.id });
        if (!row) throw new UserError("Özel gün bulunamadı (sayfayı yenileyin)");
        return row.id;
      }
      const [row] = await tx
        .insert(s.specialDays)
        .values({ ...values, createdBy: me.id, createdByName: me.name })
        .returning({ id: s.specialDays.id });
      return row.id;
    });
    const summary = specialSummary(values);
    await logActivity(me, d.id ? "Özel gün güncellendi" : "Özel gün", summary);
    refresh();
    return { id, summary };
  });
}

/** Özel günü siler; önceki değerleri döner (bildirimdeki "Geri al" onlarla yeniden ekler) */
export async function deleteSpecialDay(id: number): Promise<ActionResult<SpecialDayValues>> {
  return attempt(async () => {
    const me = await requireAdmin();
    const key = z.number().int().positive().parse(id);
    const row = await getDb().transaction(async (tx) => {
      await lockSpecialDays(tx);
      const [gone] = await tx.delete(s.specialDays).where(eq(s.specialDays.id, key)).returning();
      if (!gone) throw new UserError("Özel gün bulunamadı (sayfayı yenileyin)");
      // Onaylanmış kapalı gün bildiriminin satırı: istek "geri alındı" olur, eksik rapor uyarıları geri gelir
      if (gone.kind === "kapali") await revokeClosedRequests(tx, gone.id, "Yönetici kapalı işaretini kaldırdı");
      return gone;
    });
    const values: SpecialDayValues = {
      kind: row.kind,
      title: row.title,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      // Kapalı günün etkisi formda yok (−1 kendiliğinden); öteki değerler formun seçenekleri
      effect: row.kind === "kapali" ? 0 : ([0.3, 0.15, 0, -0.15, -0.3].find((v) => Math.abs(v - row.effect) < 1e-9) as SpecialDayValues["effect"] | undefined) ?? 0,
      note: row.note,
    };
    await logActivity(me, "Özel gün silindi", specialSummary({ ...values, effect: row.effect }));
    refresh();
    return values;
  });
}

const settingsInput = z
  .object({
    perPerson: z
      .number({ message: "Kişi başı satışı yazın" })
      .finite("Kişi başı satışı yazın")
      .min(PER_PERSON_MIN, `Kişi başı satış ${money(PER_PERSON_MIN)} ile ${money(PER_PERSON_MAX)} arasında olmalı`)
      .max(PER_PERSON_MAX, `Kişi başı satış ${money(PER_PERSON_MIN)} ile ${money(PER_PERSON_MAX)} arasında olmalı`),
    minStaff: z
      .number({ message: `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı` })
      .int(`Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`)
      .min(0, `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`)
      .max(STAFF_MAX, `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`),
    maxStaff: z
      .number({ message: `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı` })
      .int(`Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`)
      .min(0, `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`)
      .max(STAFF_MAX, `Kişi sayısı 0 ile ${STAFF_MAX} arasında olmalı`),
    dessertCategories: z.array(z.string().trim().min(1).max(100)).max(MAX_DESSERT_CATEGORIES, "En çok 30 kategori seçilebilir"),
    weather: z.boolean(),
    staffSeesLevel: z.boolean(),
    emailLine: z.boolean(),
  })
  .refine((v) => v.maxStaff >= v.minStaff, "En çok kişi en az kişiden küçük olamaz");

/** Ayarların işlem geçmişindeki özeti: "kişi başı 10.000 ₺, en az 2, en çok 6, hava açık, personel görür, e-posta açık" */
function settingsText(v: ForecastSettings): string {
  return [
    `kişi başı ${money(v.perPerson)}`,
    `en az ${v.minStaff}`,
    `en çok ${v.maxStaff}`,
    `hava ${v.weather ? "açık" : "kapalı"}`,
    `personel ${v.staffSeesLevel ? "görür" : "görmez"}`,
    `e-posta ${v.emailLine ? "açık" : "kapalı"}`,
    v.dessertCategories ? `tatlı: ${v.dessertCategories.join(", ")}` : "tatlı: adında “tatlı” geçenler",
  ].join(", ");
}

/**
 * Tahmin ayarları. Tatlı kategorileri adla tutulur (db:reset kimlikleri baştan sayar); yalnız var olan kategoriler
 * kalır, seçim varsayılanla (adında "tatlı" geçenler) aynıysa ya da boşsa null: kategori adı değişse de kural sürer.
 */
export async function saveForecastSettings(input: z.input<typeof settingsInput>): Promise<ActionResult> {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = settingsInput.parse(input);
    const cats = (await getDb().select({ name: s.categories.name }).from(s.categories)).map((c) => c.name);
    const picked = effectiveDessertCategories(d.dessertCategories, cats) ?? [];
    const byDefault = cats.filter((c) => isDessertCategory(c, null));
    const sameAsDefault = picked.length === byDefault.length && byDefault.every((c) => picked.some((p) => isDessertCategory(c, [p])));
    const next: ForecastSettings = {
      ...DEFAULT_FORECAST_SETTINGS,
      perPerson: Math.round(d.perPerson),
      minStaff: d.minStaff,
      maxStaff: d.maxStaff,
      dessertCategories: picked.length && !sameAsDefault ? [...new Set(picked)] : null,
      weather: d.weather,
      staffSeesLevel: d.staffSeesLevel,
      emailLine: d.emailLine,
    };
    const before = await loadForecastSettings();
    if (settingsText(before) === settingsText(next)) return null;
    await getDb()
      .insert(s.integrationState)
      .values({ key: FORECAST_SETTINGS_KEY, value: next })
      .onConflictDoUpdate({ target: s.integrationState.key, set: { value: next, updatedAt: new Date() } });
    await logActivity(me, "Tahmin ayarları", settingsText(next));
    refresh();
    return null;
  });
}

/**
 * "Güncelle": hava durumunu alır (Expires'a uyarak; en çok 6 sn) ve bugünün 7 günlük tahminini kaydeder (zaten
 * kayıtlıysa dokunmaz). Önizlemede hiçbir şey yazmaz. İşlem geçmişine yazılmaz (iş verisi değişmez).
 */
export async function refreshForecastNow(): Promise<ActionResult<{ text: string; tone: "success" | "info" | "error" }>> {
  return attempt(async () => {
    await requireAdmin();
    const r = await runForecastJob();
    refresh();
    if (r.preview) return { text: "Önizlemede tahmin kaydedilmez (canlının veritabanı).", tone: "info" as const };
    if (r.status === "error") return { text: "Tahmin kaydedilemedi; biraz sonra yeniden deneyin.", tone: "error" as const };
    if (r.status === "skipped") return { text: "Tahmin için veri yok: önce kasa raporu ya da Satışlar'da bir ayın cirosu ve açık günü gerekli.", tone: "info" as const };
    const saved = r.saved ? `${r.saved} günün tahmini kaydedildi` : "tahminler zaten kayıtlı";
    switch (r.weather) {
      case "fetched":
      case "not-modified":
        return { text: `Hava durumu alındı · ${saved}`, tone: "success" as const };
      case "fresh":
        return { text: `Hava durumu güncel${r.fetchedAt ? ` (alındı: ${clockTR(r.fetchedAt)})` : ""} · ${saved}`, tone: "success" as const };
      case "off":
        return { text: `Hava durumu kapalı · ${saved}`, tone: "success" as const };
      default:
        return { text: r.saved ? "Hava durumu alınamadı; tahmin havasız kaydedildi" : "Hava durumu alınamadı; tahminler zaten kayıtlı", tone: "info" as const };
    }
  });
}
