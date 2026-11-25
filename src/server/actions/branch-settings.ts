"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { BRANCH_FEATURE_IDS } from "@/lib/branch-features";
import {
  branchSettingGroup,
  CALENDAR_GROUP,
  EVENING_HOUR_MAX,
  EVENING_HOUR_MIN,
  LAFPOS_GROUP,
  PARASUT_GROUP,
  TILL_DEVICE_GROUP,
  tillDeviceLabel,
  type TillDevice,
} from "@/lib/branch-settings/groups";
import { BRANCH_ID_MAX } from "@/lib/branches";
import { LAFPOS_SECRET_MIN } from "@/lib/lafpos/request";
import type { StepUpConfirm } from "@/lib/step-up";
import { requireAdmin } from "@/server/auth/dal";
import { requireStepUp } from "@/server/auth/step-up";
import { setBranchFeatureTx } from "@/server/branch-features";
import { linkBranchSetting, lockGroup, logSetting, putBranchSetting, resolveBranchSetting, unlinkBranchSetting } from "@/server/branch-settings";
import { listBranches } from "@/server/branches";
import { getDb } from "@/server/db";
import { forgetLafposSecret, lafposBranchId } from "@/server/lafpos/branch";
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
        await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${name(d.sameAs)} ile aynı`);
        return { secretsLeft: [] as string[] };
      }
      const r = await unlinkBranchSetting(tx, group, d.branchId, me.name);
      const what = group.id === PARASUT_GROUP.id ? "ayrı hesap (boş; Paraşüt ekranından bağlanacak)" : "kendi ayarı (değerler kopyalandı)";
      await logSetting(tx, me, "Şube ayarı", `${name(d.branchId)} · ${group.label}: ${what}`);
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
      await logSetting(tx, me, "Şube ayarı", `${name} · ${CALENDAR_GROUP.label}: ${parts.join(", ")}`);
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
 * e-postasının yazarkasa başlığı, akşam hatırlatmasının metni ve LafPOS'un cihazı henüz göndermediği gündeki fotoğraf
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
      await logSetting(tx, me, "Şube ayarı", `${name} · ${TILL_DEVICE_GROUP.label}: ${what}`);
      return v;
    });
    refresh();
    return value;
  });
}

const secretInput = z.object({
  branchId: zBranch,
  /** Yeni anahtar; null: panelde saklanan anahtar silinir (ortamdaki LAFPOS_SYNC_SECRET kullanılır) */
  secret: z.string().trim().min(LAFPOS_SECRET_MIN, `Anahtar en az ${LAFPOS_SECRET_MIN} karakter olmalı`).max(256, "Anahtar çok uzun").nullable(),
});

/**
 * LafPOS'un imza anahtarı, LafPOS'un şubesinde (şube ayarı pos.lafpos; şifreli, secret-box). Saklanan anahtar ortamdaki
 * LAFPOS_SYNC_SECRET'ın önüne geçer; LafPOS'ta aynı anahtar (LAFMALIYET_SYNC_SECRET) yazılmalıdır. Sitenin anahtarıyla
 * (KARAOKE_SYNC_SECRET) aynısı reddedilir. Anahtar hiçbir yere yazılmaz: işlem geçmişine yalnız "değişti" ya da
 * "silindi", istemciye yalnız durumu döner. Yalnız yönetici ve parolasıyla (anahtar makinenin gün sonu yazımlarının
 * güven kökü: açık kalmış bir oturum sahte gün sonu imzalayamasın, gerçek kasayı 401'e düşüremesin). Yeni anahtar yalnız
 * LafPOS'un şubesine yazılır; silme her şubede (kasa kaynağı başka şubeye geçtiyse eski şubede kalan anahtar silinebilsin)
 */
export async function saveLafposSecret(input: z.input<typeof secretInput>, confirm?: StepUpConfirm) {
  return attempt(async () => {
    const me = await requireAdmin();
    const d = secretInput.parse(input);
    const db = getDb();
    if (d.secret !== null && d.branchId !== (await lafposBranchId(db))) throw new UserError("LafPOS anahtarı yalnız kasası LafPOS olan şubede saklanır (Ayarlar › Şubeler › kasa kaynağı)");
    if (d.secret && d.secret === process.env.KARAOKE_SYNC_SECRET?.trim()) throw new UserError("Bu, sitenin anahtarı (KARAOKE_SYNC_SECRET); LafPOS için ayrı bir anahtar üretin");
    if (d.secret === null && (await resolveBranchSetting(LAFPOS_GROUP, d.branchId, db)).secrets.secret === "none") throw new UserError("Bu şubede panelde saklanan LafPOS anahtarı yok");
    await requireStepUp(me, confirm, `LafPOS anahtarı ${d.secret ? "değiştirme" : "silme"}`, "LafPOS");
    const name = (await listBranches()).find((b) => b.id === d.branchId)?.name ?? d.branchId;
    await db.transaction(async (tx) => {
      await putBranchSetting(tx, LAFPOS_GROUP, d.branchId, { secret: d.secret }, me.name);
      await logSetting(tx, me, "Şube ayarı", `${name} · LafPOS anahtarı ${d.secret ? "değiştirildi (panelde, şifreli)" : "silindi (ortamdaki anahtar kullanılır)"}`);
    });
    forgetLafposSecret();
    refresh();
    return { saved: d.secret !== null };
  });
}
