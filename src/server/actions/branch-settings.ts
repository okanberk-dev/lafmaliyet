"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_FEATURE_IDS } from "@/lib/branch-features";
import {
  BLIND_COUNT_GROUP,
  branchSettingGroup,
  CALENDAR_GROUP,
  EVENING_HOUR_MAX,
  EVENING_HOUR_MIN,
  ASILPOS_GROUP,
  PARASUT_GROUP,
  SHIFT_PRESET_GROUP,
  TILL_DEVICE_GROUP,
  tillDeviceLabel,
  type TillDevice,
} from "@/lib/branch-settings/groups";
import { BRANCH_ID_MAX } from "@/lib/branches";
import { ASILPOS_SECRET_MIN } from "@/lib/asilpos/request";
import { LEGACY_POS_BRANCH_ID } from "@/lib/pos/tills";
import type { StepUpConfirm } from "@/lib/step-up";
import { PRESET_KEYS, PRESET_LABELS, presetHours, presetText, shiftPresetsError, shiftPresetsOf, type SavedShiftPreset } from "@/lib/vardiya";
import { requireAdmin, requireAnaAdmin } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { setBranchFeatureTx } from "@/server/branch-features";
import { linkBranchSetting, lockGroup, logSetting, putBranchSetting, resolveBranchSetting, unlinkBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb, schema as s } from "@/server/db";
import { forgetPosKeys, posKeyTaken } from "@/server/asilpos/branch";
import { loadPosTillIds } from "@/server/pos/tills";
import { beforeParasutLink } from "@/server/parasut/accounts";

import { attempt, UserError } from "./util";

// Şube başına ayarların "Diğer şubeyle aynı" seçimi (docs/SUBE.md › Şube başına ayarlar). Yalnız yönetici. Değerlerin
// kendisi grubun kendi ucundan yazılır (kasa raporu alıcıları: cash-report.ts updateCashSettings).

const linkInput = z.object({
  branchId: z.string().trim().min(1).max(BRANCH_ID_MAX),
  group: z.string().trim().min(1).max(40),
  /** Bağlanacak şube; null: "aynı" kapatılır, o anki değer şubeye kopyalanır */
  sameAs: z.string().trim().min(1).max(BRANCH_ID_MAX).nullable(),
});

/**
 * Şubenin bir gruptaki "Diğer şubeyle aynı" seçimini değiştirir. Açılınca şubenin kendi değeri silinir, değer hedeften
 * okunur; kapatılınca o anki değer şubeye kopyalanır (gizli alanlar kopyalanmaz: `secretsLeft` yeniden girilecekler).
 * Tek işlem; işlem geçmişine yazılır.
 *
 * Paraşüt hesabı (docs/PARASUT.md › Şube başına Paraşüt hesabı) istisnadır: kapatılınca hiçbir şey kopyalanmaz (aynı
 * firma iki hesaptan iki kez eşitlenip faturaları çiftlerdi), şube boş bir hesapla başlar ve bağlanmayı bekler. Açılınca
 * şubenin kendi hesabından fatura geldiyse reddedilir; gelmediyse hesabın ayarları, oturumu ve eşitleme durumu aynı
 * işlemde silinir (beforeParasutLink).
 */
export async function setBranchSettingLink(input: z.input<typeof linkInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = linkInput.parse(input);
    const group = branchSettingGroup(d.group);
    if (!group) throw new UserError("Ayar grubu bulunamadı");
    const branches = await listBranches();
    const name = (id: string) => branches.find((b) => b.id === id)?.name ?? id;
    const out = await getDb().transaction(async (tx) => {
      if (d.sameAs) {
        if (group.id === PARASUT_GROUP.id) await beforeParasutLink(tx, d.branchId);
        await linkBranchSetting(tx, group, d.branchId, d.sameAs, me.name);
        await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${name(d.sameAs)} ile aynı`, d.branchId);
        return { secretsLeft: [] as string[] };
      }
      const r = await unlinkBranchSetting(tx, group, d.branchId, me.name);
      const what = group.id === PARASUT_GROUP.id ? "ayrı hesap (boş; Paraşüt ekranından bağlanacak)" : "kendi ayarı (değerler kopyalandı)";
      await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${what}`, d.branchId);
      return r;
    });
    refresh();
    return out;
  });
}

const featureInput = z.object({
  branchId: z.string().trim().min(1).max(BRANCH_ID_MAX),
  feature: z.enum(BRANCH_FEATURE_IDS),
  on: z.boolean(),
});

/**
 * Şube özelliğini (karaoke, uygulama siparişi, garson çağır, yemek kartı; docs/SUBE.md › Şube özellikleri) açar ya da
 * kapatır. Yalnız yönetici; tek işlem, özellik kilidiyle (karaoke iki şubede açılamaz); işlem geçmişine yazılır. Kapalı
 * özelliğin menüsü, ekranı ve bildirimi o şubede gizlenir.
 */
export async function setBranchFeature(input: z.input<typeof featureInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = featureInput.parse(input);
    const out = await getDb().transaction((tx) => setBranchFeatureTx(tx, d, me));
    refresh();
    return out;
  });
}

const zBranch = z.string().trim().min(1).max(BRANCH_ID_MAX);

const calendarInput = z.object({
  branchId: zBranch,
  openDays: z.number({ message: "Açık gün sayısını yazın" }).int("Tam gün yazın").min(1, "En az 1 gün").max(31, "En fazla 31 gün"),
  eveningHour: z
    .number({ message: "Saati seçin" })
    .int("Saati seçin")
    .min(EVENING_HOUR_MIN, `En erken ${EVENING_HOUR_MIN}:00`)
    .max(EVENING_HOUR_MAX, `En geç ${EVENING_HOUR_MAX}:00`),
});

/**
 * Şubenin çalışma takvimi (şube ayarı isletme.takvim; docs/SUBE.md › Şube başına ayarlar): ayda açık gün (başabaş ve
 * günlük giderler) ve kasa raporunun beklendiği saat (zil ve Bugün). Yalnız yönetici; tek işlem, işlem geçmişine eski →
 * yeni. Şube başka şubenin takvimini kullanıyorsa yazılmaz (önce "aynı" kapatılır)
 */
export async function saveBranchCalendar(input: z.input<typeof calendarInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = calendarInput.parse(input);
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    const changed = await getDb().transaction(async (tx) => {
      await lockGroup(tx, CALENDAR_GROUP.id);
      const prev = (await resolveBranchSetting(CALENDAR_GROUP, d.branchId, tx)).value;
      const parts = [
        prev.openDays !== d.openDays ? `ayda açık gün ${prev.openDays} → ${d.openDays}` : null,
        prev.eveningHour !== d.eveningHour ? `kasa raporu saati ${prev.eveningHour}:00 → ${d.eveningHour}:00` : null,
      ].filter((x): x is string => x !== null);
      if (!parts.length) return 0;
      await putBranchSetting(tx, CALENDAR_GROUP, d.branchId, { openDays: d.openDays, eveningHour: d.eveningHour }, me.name);
      await logSetting(tx, me, "Şube ayarı", `${name} · ${CALENDAR_GROUP.label}: ${parts.join(", ")}`, d.branchId);
      return parts.length;
    });
    if (changed) refresh();
    return { changed };
  });
}

const deviceInput = z.object({
  branchId: zBranch,
  device: z.enum(["pavo", "tokenx", "diger"] as const satisfies readonly TillDevice[]).nullable(),
  registerNo: z.string().trim().max(40, "Sicil no en çok 40 karakter").nullable(),
  bank: z.string().trim().max(60, "Banka adı en çok 60 karakter").nullable(),
});

/**
 * Şubenin banka POS'u ve yazarkasası (şube ayarı kasa.cihaz): cihazın türü, sicil no ve bankası. Kasa raporu
 * e-postasının yazarkasa başlığı, akşam hatırlatmasının metni ve AsilPOS'un cihazı henüz göndermediği gündeki fotoğraf
 * okuması bunu kullanır. Yalnız yönetici; tek işlem, işlem geçmişine yazılır
 */
export async function saveTillDevice(input: z.input<typeof deviceInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = deviceInput.parse(input);
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    const value = await getDb().transaction(async (tx) => {
      const v = await putBranchSetting(
        tx,
        TILL_DEVICE_GROUP,
        d.branchId,
        { device: d.device, registerNo: d.registerNo || null, bank: d.bank || null },
        me.name,
      );
      const what = [v.device ? tillDeviceLabel(v.device) : "cihaz belirtilmedi", v.registerNo ? `sicil ${v.registerNo}` : null, v.bank].filter(Boolean).join(" · ");
      await logSetting(tx, me, "Şube ayarı", `${name} · ${TILL_DEVICE_GROUP.label}: ${what}`, d.branchId);
      return v;
    });
    refresh();
    return value;
  });
}

const blindInput = z.object({ branchId: zBranch, enabled: z.boolean() });

/**
 * Şubenin kör sayım ayarı (şube ayarı kasa.kor; docs/KASA-RAPORU.md › Kör sayım): açıkken personel kasa raporunda önce
 * sayımı kilitler, fark sonra görünür. Yalnız yönetici; tek işlem, işlem geçmişine yazılır. Bugün kilitlenmiş sayımlar
 * yerinde kalır; kapatılınca personelin raporu kilidi beklemez
 */
export async function saveBlindCount(input: z.input<typeof blindInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = blindInput.parse(input);
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    const value = await getDb().transaction(async (tx) => {
      const v = await putBranchSetting(tx, BLIND_COUNT_GROUP, d.branchId, { enabled: d.enabled }, me.name);
      await logSetting(tx, me, "Şube ayarı", `${name} · ${BLIND_COUNT_GROUP.label}: ${d.enabled ? "açık" : "kapalı"}`, d.branchId);
      return v;
    });
    refresh();
    return value;
  });
}

/** Hazır vardiyanın saatleri ("09:00", "18:00"); null: şubede bu vardiya yok */
const presetClock = z.object({ start: z.string().trim().max(5), end: z.string().trim().max(5) }).nullable();
const presetInput = z.object({ branchId: zBranch, morning: presetClock, evening: presetClock });

/** Hazır vardiyaların işlem geçmişindeki metni: "Sabahçı 09:00–18:00 · Akşamcı 16:00–01:00" ya da "hazır vardiya yok" */
const presetsLogText = (list: readonly SavedShiftPreset[]) => (list.length ? list.map((p) => `${PRESET_LABELS[p.key]} ${presetText(p)}`).join(" · ") : "hazır vardiya yok");

/**
 * Şubenin hazır vardiyaları (şube ayarı vardiya.hazir; docs/VARDIYA.md › Hazır vardiyalar): Vardiya ekranındaki S
 * (sabahçı) ve A (akşamcı) düğmelerinin saatleri. Saatler kutunun okuyucusuyla aynı kuralla okunur (bitiş başlangıçtan
 * önceyse ertesi gün, en çok 16 saat, en geç 06:00); iki vardiya aynı saatte olamaz. Yalnız yönetici; tek işlem, işlem
 * geçmişine eski → yeni. Kayıtlı haftaların hücreleri değişmez (yeni saatle eşleşmeyen eski hücre "başka saat" görünür)
 */
export async function saveShiftPresets(input: z.input<typeof presetInput>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = presetInput.parse(input);
    const list: SavedShiftPreset[] = [];
    for (const key of PRESET_KEYS) {
      const v = d[key];
      if (!v) continue;
      const hours = presetHours(v.start, v.end);
      if ("error" in hours) throw new UserError(`${PRESET_LABELS[key]}: ${hours.error}`);
      list.push({ key, ...hours });
    }
    const clash = shiftPresetsError(list);
    if (clash) throw new UserError(clash);
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    const changed = await getDb().transaction(async (tx) => {
      await lockGroup(tx, SHIFT_PRESET_GROUP.id);
      const prev = (await resolveBranchSetting(SHIFT_PRESET_GROUP, d.branchId, tx)).value.presets;
      const before = presetsLogText(shiftPresetsOf(d.branchId, prev));
      const after = presetsLogText(list);
      // Varsayılan saatlerle aynısı da bir kez yazılır (seçim kaydedilir); kayıtlı değerle aynıysa yazılmaz
      if (prev !== null && before === after) return false;
      await putBranchSetting(tx, SHIFT_PRESET_GROUP, d.branchId, { presets: list }, me.name);
      await logSetting(tx, me, "Şube ayarı", `${name} · ${SHIFT_PRESET_GROUP.label}: ${before === after ? after : `${before} → ${after}`}`, d.branchId);
      return true;
    });
    if (changed) refresh();
    return { changed };
  });
}

const secretInput = z.object({
  branchId: zBranch,
  /**
   * Yeni anahtar; null: panelde saklanan anahtar silinir (Marina'da ortamdaki ASILPOS_SYNC_SECRET kullanılır, öbür şubede
   * kasa bağlantısız kalır)
   */
  secret: z.string().trim().min(ASILPOS_SECRET_MIN, `Anahtar en az ${ASILPOS_SECRET_MIN} karakter olmalı`).max(256, "Anahtar çok uzun").nullable(),
});

/**
 * AsilPOS'un imza anahtarı, kasanın şubesinde (şube ayarı SUBE_AYAR_GRUBU; şifreli, secret-box). Eski kurulumun şubesinde
 * (Marina) saklanan anahtar ortamdaki ASILPOS_SYNC_SECRET'ın önüne geçer; öbür şubeye ortamdaki anahtar hiç hizmet etmez
 * (silinirse kasa bağlantısız kalır). AsilPOS'ta aynı anahtar (LAFMALIYET_SYNC_SECRET) yazılmalıdır. Sitenin anahtarıyla
 * (KARAOKE_SYNC_SECRET) aynısı reddedilir. Anahtar hiçbir yere yazılmaz: işlem geçmişine yalnız "değişti" ya da
 * "silindi", istemciye yalnız durumu döner. Yalnız yönetici ve parolasıyla (anahtar makinenin gün sonu yazımlarının
 * güven kökü: açık kalmış bir oturum sahte gün sonu imzalayamasın, gerçek kasayı 401'e düşüremesin). Çok şube: yeni anahtar
 * kasası AsilPOS olan ya da AsilPOS kurulumu yapılmış şubeye yazılır (kurulu kasanın deneme günleri için); başka şubenin
 * anahtarıyla ya da ortamdaki eski kurulum anahtarıyla aynı olamaz (anahtar şubeyi tanıtır: aynı anahtar bir şubenin
 * günlerini öbürüne yazdırırdı). Silme her şubede (kasa kaynağı değiştiyse eski şubede kalan anahtar silinebilsin).
 * Döndürmek ve silmek yalnız asıl yöneticide (docs/ROLLER.md › Asıl yönetici; 28 Kasım 2026)
 */
export async function saveAsilposSecret(input: z.input<typeof secretInput>, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAnaAdmin("kasaAnahtari");
    const d = secretInput.parse(input);
    const db = getDb();
    if (d.secret !== null) {
      const [{ ids }, [install]] = await Promise.all([
        loadPosTillIds(db, Date.now(), true),
        db.select({ id: s.asilposInstalls.id }).from(s.asilposInstalls).where(eq(s.asilposInstalls.branchId, d.branchId)).limit(1),
      ]);
      if (!ids.includes(d.branchId) && !install) throw new UserError("AsilPOS anahtarı yalnız kasası AsilPOS olan (ya da AsilPOS kurulumu yapılmış) şubede saklanır (Ayarlar › Şubeler › kasa kaynağı)");
      const taken = await posKeyTaken(d.branchId, d.secret, db);
      if (taken) {
        const owner = (await listBranches()).find((b) => b.id === taken)?.name ?? taken;
        throw new UserError(`Bu anahtar ${owner} şubesinin AsilPOS anahtarı; her şubenin kasası kendi anahtarını kullanır, yeni bir anahtar üretin`);
      }
    }
    if (d.secret && d.secret === process.env.KARAOKE_SYNC_SECRET?.trim()) throw new UserError("Bu, sitenin anahtarı (KARAOKE_SYNC_SECRET); AsilPOS için ayrı bir anahtar üretin");
    if (d.secret === null && (await resolveBranchSetting(ASILPOS_GROUP, d.branchId, db)).secrets.secret === "none") throw new UserError("Bu şubede panelde saklanan AsilPOS anahtarı yok");
    await requireStepUp(me, confirm, `AsilPOS anahtarı ${d.secret ? "değiştirme" : "silme"}`, "AsilPOS");
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    await db.transaction(async (tx) => {
      await putBranchSetting(tx, ASILPOS_GROUP, d.branchId, { secret: d.secret }, me.name);
      // Silinince: ortamdaki anahtar yalnız eski kurulumun şubesine (Marina) hizmet eder; öbür şubenin kasası bağlantısız kalır
      const dropped = d.branchId === LEGACY_POS_BRANCH_ID ? "silindi (ortamdaki anahtar kullanılır)" : "silindi (şubenin kasası bağlantısız kalır)";
      await logSetting(tx, me, "Şube ayarı", `${name} · AsilPOS anahtarı ${d.secret ? "değiştirildi (panelde, şifreli)" : dropped}`, d.branchId);
    });
    forgetPosKeys();
    refresh();
    return { saved: d.secret !== null };
  });
}
