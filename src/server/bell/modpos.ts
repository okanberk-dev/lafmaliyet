import "server-only";

import { businessDate } from "@/lib/cash-report";
import { dateTR } from "@/lib/format";
import { modposKeyProblem } from "@/lib/modpos/request";
import { modposKeyAlert, modposKeyDigestText, modposMismatchDigestText, modposMismatches, type ModposKeyAlert } from "@/lib/modpos/zil";
import { addDays, todayTR } from "@/lib/reminders";
import type { PanelNotification } from "@/server/actions/notifications";
import { cashReportsBetween } from "@/server/data/cash-reports";
import { loadLafposSwitchDay } from "@/server/lafpos/status";
import { loadModposSheets, readModposState } from "@/server/modpos/store";
import { canFetchModpos } from "@/server/modpos/sync";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * ModPOS kasa föyünün zil ve sabah e-postası satırları (yalnız yönetici; docs/MODPOS-API.md › Nerede görünür,
 * docs/BILDIRIMLER.md). Kurallar saf modülde (src/lib/modpos/zil.ts); föyünden farklı yazılan raporun zil satırı kasa
 * modülünde (src/server/bell/kasa.ts cashIntegrityNotifications). Hiçbiri istek göndermez: yalnız saklanan föyü ve
 * integration_state › modpos'u okur (günde 2 hak yalnız sabah işi ve "Bu günü çek" içindir).
 */

/** Ayarlar'daki kartın adresi (SectionCard id "modpos") */
export const MODPOS_SETTINGS_HREF = "/panel/ayarlar#modpos";

/** Anahtarın uyarısı: anahtar yoksa sorgu yok; biçimi bozuksa durum okunmaz */
async function loadKeyAlert(env: Record<string, string | undefined> = process.env): Promise<ModposKeyAlert | null> {
  const keyProblem = modposKeyProblem(env);
  if (keyProblem === "missing") return null;
  const state = keyProblem ? null : await readModposState();
  return modposKeyAlert({ keyProblem, preview: !canFetchModpos(env), state });
}

/**
 * Zilin Sistem başlığında "ModPOS kasa föyü çekilemiyor" (yalnız yönetici: toplayıcı src/server/actions/notifications.ts
 * yönetici dalında çağırır). Gövde son hatanın metni (ne yapılacağıyla), Ayarlar › ModPOS (kasa föyü)'ne götürür.
 * Anahtar yokken satır yok (kart "Kurulmadı" der).
 */
export async function modposKeyBell(now = new Date()): Promise<PanelNotification[]> {
  const a = await loadKeyAlert();
  if (!a) return [];
  const day = a.at ? todayTR(new Date(a.at)) : null;
  const today = todayTR(now);
  return [
    {
      id: a.id,
      kind: "danger",
      title: a.title,
      body: a.body,
      timeLabel: !day ? "" : day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : dateTR(day),
      unread: true,
      href: MODPOS_SETTINGS_HREF,
      group: "sistem",
    },
  ];
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna ModPOS satırları (src/server/staff-requests/digest.ts): anahtar
 * çalışmıyorsa "ModPOS kasa föyü çekilemiyor. …" (kırmızı) ve dünün kasa raporu föyünden farklıysa "Kasa raporu ModPOS
 * föyünden farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)" (turuncu). Yalnız dün: e-posta her sabah bir
 * kez gider, satır kendiliğinden bir kez görünür (sabah işi föyü e-postadan önce çeker). E-posta yalnız yöneticilere
 * gider. Kutu yalnız bunlarla açılırsa adresi farkın gününe, yoksa Ayarlar'a. Okunamayan kaynak satırsız düşer.
 */
export async function modposDigestLines(now = new Date()): Promise<{ lines: DigestBox["lines"]; href: string | null; link: string | null }> {
  const yesterday = addDays(businessDate(now), -1);
  const [mismatch, key] = await Promise.all([
    Promise.all([cashReportsBetween(yesterday, yesterday), loadModposSheets(yesterday, yesterday), loadLafposSwitchDay()])
      .then(([reports, sheets, switchDay]) => modposMismatches(reports, sheets, switchDay)[0] ?? null)
      .catch(() => null),
    loadKeyAlert().catch(() => null),
  ]);
  const lines: DigestBox["lines"] = [];
  if (key) lines.push({ text: modposKeyDigestText(key), tone: "bad" });
  if (mismatch) lines.push({ text: modposMismatchDigestText(mismatch.report.date, mismatch.diffs), tone: "warn" });
  if (mismatch) return { lines, href: `/panel/kasa?gun=${mismatch.report.date}`, link: "Kasa raporunu aç" };
  return key ? { lines, href: MODPOS_SETTINGS_HREF, link: "Ayarlar'da aç" } : { lines, href: null, link: null };
}
