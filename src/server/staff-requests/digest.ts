import "server-only";

import { ALL_BRANCHES, type BranchScope } from "@/lib/branches";
import { num } from "@/lib/format";
import { approvalsDigestLines } from "@/lib/staff-requests";
import { modposDigestLines } from "@/server/bell/modpos";
import { opsDigestLines, pastCountDigestLines } from "@/server/bell/ops";
import { getDb } from "@/server/db";
import type { DigestExtraLoad } from "@/server/notify/digest-template";

import { requestsInScope } from "./branch";
import { pendingRequests } from "./core";

/**
 * Sabah e-postasının "Onay bekleyenler" kutusu (src/server/notify/digest-extras.ts; docs/ONAYLAR.md): bekleyen personel
 * istekleri (sayı, en eskisinin beklediği, istek başına başlık ve isteyenin adı), operasyonun bilgi satırları
 * (opsDigestLines; ör. personelin tükendi yaptığı ürünler), ilk 10 günde geçen ayın yarım sayımı (pastCountDigestLines) ve
 * ModPOS kasa föyü (modposDigestLines: dünün raporu föyden farklı, anahtar çalışmıyor; docs/MODPOS-API.md). Personelin
 * isteklerinde tutar yok (ModPOS satırının tutarı yöneticinin föyüdür; e-posta yalnız yöneticiye gider). Karar
 * verilene kadar her sabah listelenir; bir şey yoksa kutu yok (e-posta kutusuz hâliyle aynı). Bekleyen istek yokken
 * başlık satırların kaynağını söyler: yalnız personelin satırları "Personelden", yalnız sayım "Stok sayımı" (o ayın
 * sayımına götürür), yalnız ModPOS "ModPOS kasa föyü" (farkın gününe ya da Ayarlar'a), karışıksa "Operasyon".
 * `scope`: şubeye bağlı alıcının e-postası (şube kapsamı C P1-11): yalnız o şubenin istekleri (`requestBranches`),
 * sayımı ve ModPOS föyü. Tükendi satırı bütün şubelerindir (sitenin sözleşmesinde şube yok)
 */
export async function loadApprovalsDigest(now = new Date(), scope: BranchScope = ALL_BRANCHES): Promise<DigestExtraLoad | null> {
  const [all, ops, count, modpos] = await Promise.all([pendingRequests(getDb(), { now }), opsDigestLines(now), pastCountDigestLines(now, scope), modposDigestLines(now, scope)]);
  // Şubenin istekleri: şube konudan ya da yükten okunur (src/server/staff-requests/branch.ts); satırın metni yine başlık ve ad
  const rows = scope === ALL_BRANCHES ? all : await requestsInScope(getDb(), all, scope);
  const lines = [...approvalsDigestLines(rows, now), ...ops, ...count.lines, ...modpos.lines];
  if (!lines.length) return null;
  const n = rows.length;
  const onlyCount = !ops.length && !modpos.lines.length && count.lines.length > 0;
  const onlyModpos = !ops.length && !count.lines.length && modpos.lines.length > 0;
  return {
    box: n
      ? {
          title: "Onay bekleyenler",
          lines,
          href: "/panel/onaylar",
          link: "Onaylar'da aç",
          subjectPart: `${num(n)} istek onay bekliyor`,
          headline: n === 1 ? "1 personel isteği onay bekliyor" : `${num(n)} personel isteği onay bekliyor`,
        }
      : onlyCount
        ? { title: "Stok sayımı", lines, href: count.href ?? "/panel/sayim", link: "Sayımı aç", subjectPart: null, headline: null }
        : onlyModpos
          ? { title: "ModPOS API", lines, href: modpos.href ?? "/panel/kasa", link: modpos.link ?? "Kasa'yı aç", subjectPart: null, headline: null }
          : { title: count.lines.length || modpos.lines.length ? "Operasyon" : "Personelden", lines, href: "/panel/bugun", link: "Bugün'ü aç", subjectPart: null, headline: null },
    logKeys: [],
  };
}

