import { Badge } from "@/components/ui/badge";

/*
 * Onaylar kartlarının şubesi (docs/SUBE.md › Kasa raporu "Tümü"de): birden çok kasa açıkken isteğin şubesi kartın
 * başında adıyla durur ve "Günü aç" bağlantısı `?sube=` ile o şubenin gününü açar; tek kasada ikisi de yok (`branch`
 * null). Kasa kartları (kasa-cards, kasa-out-cards) ve zayi kartları (ops-cards) buradan alır: kasa-cards
 * kasa-out-cards'ı içe aktardığı için ayrı dosyada (döngü olmasın).
 */

/** İsteğin şubesi (birden çok şube açıkken): onay bu şubeye yazar */
export function BranchBadge({ branch }: { branch?: { id: string; name: string } | null }) {
  return branch ? (
    <Badge tone="blue" dot>
      {branch.name}
    </Badge>
  ) : null;
}

/** Günün sayfası; birden çok şube açıkken isteğin şubesinde açılır (`?sube=`) */
export const branchDayHref = (path: "/panel/kasa" | "/panel/zayi", card: { date: string; branch?: { id: string } | null }) =>
  `${path}?gun=${card.date}${card.branch ? `&sube=${encodeURIComponent(card.branch.id)}` : ""}`;

/** Günün kasa sayfası, isteğin şubesinde */
export const kasaDayHref = (card: { date: string; branch?: { id: string } | null }) => branchDayHref("/panel/kasa", card);
