import "server-only";

import { num } from "@/lib/format";
import { approvalsDigestLines } from "@/lib/staff-requests";
import { opsDigestLines, pastCountDigestLines } from "@/server/bell/ops";
import { getDb } from "@/server/db";
import type { DigestExtraLoad } from "@/server/notify/digest-template";

import { pendingRequests } from "./core";

/**
 * Sabah e-postasının "Onay bekleyenler" kutusu (src/server/notify/digest-extras.ts; docs/ONAYLAR.md): bekleyen personel
 * istekleri (sayı, en eskisinin beklediği, istek başına başlık ve isteyenin adı), operasyonun bilgi satırları
 * (opsDigestLines; ör. personelin tükendi yaptığı ürünler) ve ilk 10 günde geçen ayın yarım sayımı (pastCountDigestLines).
 * Tutar yok. Karar verilene kadar her sabah listelenir; bir şey yoksa kutu yok (e-posta kutusuz hâliyle aynı). Bekleyen
 * istek yokken başlık satırların kaynağını söyler: yalnız personelin satırları "Personelden", yalnız sayım "Stok
 * sayımı" (o ayın sayımına götürür), ikisi birden "Operasyon".
 */
export async function loadApprovalsDigest(now = new Date()): Promise<DigestExtraLoad | null> {
  const [rows, ops, count] = await Promise.all([pendingRequests(getDb(), { now }), opsDigestLines(now), pastCountDigestLines(now)]);
  const lines = [...approvalsDigestLines(rows, now), ...ops, ...count.lines];
  if (!lines.length) return null;
  const n = rows.length;
  const onlyCount = !ops.length && count.lines.length > 0;
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
        : { title: count.lines.length ? "Operasyon" : "Personelden", lines, href: "/panel/bugun", link: "Bugün'ü aç", subjectPart: null, headline: null },
    logKeys: [],
  };
}
