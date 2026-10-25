import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { IconTile, toneFor } from "@/components/ui/icon-tile";

import type { FaqGroup } from "./faq-search";

/**
 * Yardım sayfalarının ortak "Nasıl yapılır?" kurucusu: yöneticinin Yardım'ı (page.tsx) ve personelin Yardım'ı
 * (personel/content.tsx) kendi sorularını ve kendi yol bileşenlerini (Path, StaffPath) verir; buradaki kurucu ikisinin
 * içeriğine de bakmaz. Arama metni cevaptan düz metin olarak çıkar; menü yolu öğesini yol metni çözücüsü okur.
 */

export type FaqLink = { href: string; label: string };
export type FaqItem = { id: string; q: string; a: ReactNode; icon: LucideIcon; links?: FaqLink[] };

/** Yol öğesinin (Path, StaffPath) arama metni; öğe yol değilse undefined */
export type PathText = (el: ReactElement<{ href?: string }>) => string | undefined;

export function GoLinks({ links }: { links: FaqLink[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-4">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center pointer-coarse:min-h-11 gap-1 text-[13px] font-medium text-ink hover:underline">
          {l.label}
          <ArrowUpRight size={13} className="text-ink-quiet" aria-hidden="true" />
        </Link>
      ))}
    </span>
  );
}

/** Cevaptaki düz metin (arama ve testler için): menü yolları kenar çubuğundaki adlarıyla okunur */
export function textOf(node: ReactNode, pathText: PathText): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map((n) => textOf(n, pathText)).join(" ");
  if (isValidElement<{ href?: string; children?: ReactNode }>(node)) {
    const path = pathText(node);
    if (path !== undefined) return path;
    return textOf(node.props.children, pathText);
  }
  return "";
}

/** Soru gruplarından arama kutulu listenin grupları: ikon karosu, cevap ve altındaki bağlantılar */
export function buildFaq(groups: readonly { title: string; items: readonly FaqItem[] }[], pathText: PathText): FaqGroup[] {
  return groups.map((g) => ({
    title: g.title,
    items: g.items.map((f) => ({
      id: f.id,
      title: f.q,
      text: `${textOf(f.a, pathText)} ${f.links?.map((l) => l.label).join(" ") ?? ""}`,
      icon: (
        <IconTile size="sm" tone={toneFor(f.q)}>
          <f.icon />
        </IconTile>
      ),
      description: (
        <>
          <span className="block">{f.a}</span>
          {f.links ? <GoLinks links={f.links} /> : null}
        </>
      ),
    })),
  }));
}
