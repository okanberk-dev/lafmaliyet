import "server-only";

import { ALL_BRANCHES, DEFAULT_BRANCH_ID, tillBranches, type BranchScope } from "@/lib/branches";
import { asilposBranchOf } from "@/lib/asilpos/switch";
import { businessDate } from "@/lib/cash-report";
import { dateTR } from "@/lib/format";
import { modposKeyProblem } from "@/lib/modpos/request";
import { modposBranchIds, modposKeyEnv } from "@/lib/modpos/sube";
import { modposKeyAlert, modposKeyDigestText, modposMismatchDigestText, modposMismatches, type ModposKeyAlert } from "@/lib/modpos/zil";
import { addDays, todayTR } from "@/lib/reminders";
import type { PanelNotification } from "@/server/actions/notifications";
import { listBranches } from "@/server/branches";
import { cashReportsBetween } from "@/server/data/cash-reports";
import { loadAsilposSwitchDay } from "@/server/asilpos/status";
import { loadModposSheets, readModposState } from "@/server/modpos/store";
import { canFetchModpos, sharedKeyText } from "@/server/modpos/sync";
import type { DigestBox } from "@/server/notify/digest-template";

/*
 * ModPOS kasa föyünün zil ve sabah e-postası satırları (yalnız yönetici; docs/MODPOS-API.md › Nerede görünür,
 * docs/BILDIRIMLER.md). Kurallar saf modülde (src/lib/modpos/zil.ts); föyünden farklı yazılan raporun zil satırı kasa
 * modülünde (src/server/bell/kasa.ts cashIntegrityNotifications). Hiçbiri istek göndermez: yalnız saklanan föyü ve
 * integration_state › modpos'u okur (günde 2 hak yalnız sabah işi ve "Bu günü çek" içindir).
 */

/** Ayarlar'daki kartın adresi (SectionCard id "modpos") */
export const MODPOS_SETTINGS_HREF = "/panel/ayarlar#modpos";

/**
 * Anahtarların uyarıları, şube şube (docs/MODPOS-API.md › Şubeler): her ModPOS şubesinin kendi anahtarı ve durumu var.
 * Anahtarı olmayan şubede sorgu yok; biçimi bozuk ya da başka şubeyle ortaksa durum okunmaz.
 */
async function loadKeyAlerts(env: Record<string, string | undefined> = process.env): Promise<(ModposKeyAlert & { branchId: string })[]> {
  // Hiçbir şubenin anahtarı yoksa (Tuzla'nınki de) kütük de okunmaz
  if (!Object.keys(env).some((k) => k === "MODPOS_API_KEY" || k.startsWith("MODPOS_API_KEY_"))) return [];
  const branches = await listBranches();
  const peers = modposBranchIds(branches);
  const alerts = await Promise.all(
    peers.map(async (id) => {
      const keyProblem = modposKeyProblem(env, id, peers);
      if (keyProblem === "missing") return null;
      const state = keyProblem ? null : await readModposState(undefined, id);
      const branch = { id, name: branches.find((b) => b.id === id)?.name ?? id };
      const alert = modposKeyAlert({ keyProblem, preview: !canFetchModpos(env), state, branch, keyEnv: modposKeyEnv(id), sharedText: sharedKeyText(id, branches) });
      return alert ? { ...alert, branchId: id } : null;
    }),
  );
  return alerts.filter((a) => a !== null);
}

/**
 * Zilin Sistem başlığında "ModPOS kasa föyü çekilemiyor" (yalnız yönetici: toplayıcı src/server/actions/notifications.ts
 * yönetici dalında çağırır). Gövde son hatanın metni (ne yapılacağıyla), Ayarlar › ModPOS (kasa föyü)'ne götürür.
 * Anahtar yokken satır yok (kart "Kurulmadı" der).
 */
export async function modposKeyBell(now = new Date()): Promise<PanelNotification[]> {
  const today = todayTR(now);
  return (await loadKeyAlerts()).map((a) => {
    const day = a.at ? todayTR(new Date(a.at)) : null;
    return {
      id: a.id,
      kind: "danger",
      title: a.title,
      body: a.body,
      timeLabel: !day ? "" : day === today ? "Bugün" : day === addDays(today, -1) ? "Dün" : dateTR(day),
      unread: true,
      href: MODPOS_SETTINGS_HREF,
      group: "sistem",
    };
  });
}

/**
 * Sabah e-postasının "Onay bekleyenler" kutusuna ModPOS satırları (src/server/staff-requests/digest.ts): anahtar
 * çalışmıyorsa "ModPOS kasa föyü çekilemiyor. …" (kırmızı) ve dünün kasa raporu föyünden farklıysa "Kasa raporu ModPOS
 * föyünden farklı. 2 Kasım · Nakit 8.190 ₺ (ModPOS föyünde 8.210 ₺)" (turuncu). Yalnız dün: e-posta her sabah bir
 * kez gider, satır kendiliğinden bir kez görünür (sabah işi föyü e-postadan önce çeker). E-posta yalnız yöneticilere
 * gider. Kutu yalnız bunlarla açılırsa adresi farkın gününe, yoksa Ayarlar'a. Okunamayan kaynak satırsız düşer.
 *
 * Şubeler (docs/MODPOS-API.md › Şubeler): her şubenin raporu kendi föyüyle karşılaştırılır, farklı olan her şube bir
 * satır; birden çok kasa açıkken satırda şubenin adı, adreste ilk farkın şubesi (`&sube=`; seçici onu seçer).
 */
export async function modposDigestLines(now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<{ lines: DigestBox["lines"]; href: string | null; link: string | null }> {
  const yesterday = addDays(businessDate(now), -1);
  // Şubeye bağlı alıcının e-postası (şube kapsamı C P1-11): yalnız o şubenin raporu ve anahtarı
  const inScope = (id: string | null | undefined) => scope === ALL_BRANCHES || (id ?? DEFAULT_BRANCH_ID) === scope;
  const [found, key] = await Promise.all([
    Promise.all([cashReportsBetween(yesterday, yesterday), loadModposSheets(yesterday, yesterday), loadAsilposSwitchDay(), listBranches()])
      .then(([reports, sheets, switchDay, branches]) => ({ mismatches: modposMismatches(reports, sheets, switchDay, asilposBranchOf(branches)).filter((m) => inScope(m.report.branchId)), branches }))
      .catch(() => null),
    loadKeyAlerts()
      .then((all) => all.filter((k) => inScope(k.branchId)))
      .catch(() => []),
  ]);
  const lines: DigestBox["lines"] = [];
  for (const k of key) lines.push({ text: modposKeyDigestText(k), tone: "bad" });
  const mismatches = found?.mismatches ?? [];
  const named = found ? tillBranches(found.branches).length > 1 : false;
  const nameOf = (id: string | null | undefined) => {
    const b = id ?? DEFAULT_BRANCH_ID;
    return found?.branches.find((x) => x.id === b)?.name ?? b;
  };
  for (const m of mismatches) lines.push({ text: modposMismatchDigestText(m.report.date, m.diffs, named ? nameOf(m.report.branchId) : undefined), tone: "warn" });
  const first = mismatches[0];
  if (first) {
    const sube = named ? `&sube=${encodeURIComponent(first.report.branchId ?? DEFAULT_BRANCH_ID)}` : "";
    return { lines, href: `/panel/kasa?gun=${first.report.date}${sube}`, link: "Kasa raporunu aç" };
  }
  return key.length ? { lines, href: MODPOS_SETTINGS_HREF, link: "Ayarlar'da aç" } : { lines, href: null, link: null };
}
