import "server-only";

import { num } from "@/lib/format";
import { approvalsDigestLines } from "@/lib/staff-requests";
import { opsDigestLines } from "@/server/bell/ops";
import { getDb } from "@/server/db";
import type { DigestExtraLoad } from "@/server/notify/digest-template";

import { pendingRequests } from "./core";

/**
 * Sabah e-postasının "Onay bekleyenler" kutusu (src/server/notify/digest-extras.ts; docs/ONAYLAR.md): bekleyen personel
 * istekleri (sayı, en eskisinin beklediği, istek başına başlık ve isteyenin adı) ve operasyonun bilgi satırları
 * (opsDigestLines; ör. personelin tükendi yaptığı ürünler). Tutar yok. Karar verilene kadar her sabah listelenir; bir
 * şey yoksa kutu yok (e-posta kutusuz hâliyle aynı).
 */
export async function loadApprovalsDigest(now = new Date()): Promise<DigestExtraLoad | null> {
  const [rows, ops] = await Promise.all([pendingRequests(getDb(), { now }), opsDigestLines(now)]);
  const lines = [...approvalsDigestLines(rows, now), ...ops];
  if (!lines.length) return null;
  const n = rows.length;
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
      : { title: "Personelden", lines, href: "/panel/bugun", link: "Bugün'ü aç", subjectPart: null, headline: null },
    logKeys: [],
  };
}
