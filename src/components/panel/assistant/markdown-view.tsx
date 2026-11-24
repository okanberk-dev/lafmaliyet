import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type Block, type Inline } from "@/lib/assistant/markdown";
import { cn } from "@/lib/utils";

/**
 * Asistan yanıtının ekranı: src/lib/assistant/markdown.ts'in ağacı React öğeleriyle çizilir. HTML'e çevrilmez,
 * `dangerouslySetInnerHTML` yok; her metni React kaçışlar. Bağlantı yalnız ayrıştırıcının izin verdiği adrese:
 * panelin ekranı (Link, aynı sekme) ya da https (yeni sekme, noopener). `onNavigate`: panel bağlantısına tıklanınca
 * (telefonda pencere kapanır, sayfa görünsün). Tablo kendi kabında yatay kayar (telefonda sayfa yana kaymaz).
 *
 * Göz yormasın: tutar ve yüzde düz yazıda yalnız orta kalınlıkta ve bölünmez, rengi yazının rengidir (koyu temada
 * yanıtın kısık tonu: saf beyaz parlamaz); tabloda vurgu yok (sağa hizalı tabular rakam yeter, sütunlar tek tip).
 * Kalın yazı, başlık ve bağlantı da kendi rengini taşımaz, yanıtın tonunu alır.
 */

/** `table`: tablo hücresi (tutar vurgusuz) */
function inlines(nodes: Inline[], onNavigate?: () => void, table = false): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "br":
        return <br key={i} />;
      case "num":
        // Tutar ve yüzde: bölünmez, tabular rakam; düz yazıda orta kalınlık, tabloda vurgusuz. Renk yazınınki
        return (
          <span key={i} className={cn("whitespace-nowrap tabular-nums", !table && "font-medium")} data-num>
            {n.v}
          </span>
        );
      case "code":
        return (
          <code key={i} className="rounded-md bg-note px-1 py-0.5 font-mono text-[0.92em]">
            {n.v}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold">
            {inlines(n.c, onNavigate, table)}
          </strong>
        );
      case "em":
        return <em key={i}>{inlines(n.c, onNavigate, table)}</em>;
      case "link":
        return n.external ? (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium underline decoration-ink-quiet underline-offset-2 hover:decoration-current">
            {inlines(n.c, onNavigate, table)}
          </a>
        ) : (
          <Link key={i} href={n.href} onClick={onNavigate} className="font-medium underline decoration-ink-quiet underline-offset-2 hover:decoration-current">
            {inlines(n.c, onNavigate, table)}
          </Link>
        );
    }
  });
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

function block(b: Block, key: number, onNavigate?: () => void): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={key}>{inlines(b.c, onNavigate)}</p>;
    case "h":
      return (
        <p key={key} className={cn("pt-1 font-semibold", b.level === 1 && "text-[15px] max-lg:text-[17px]")}>
          {inlines(b.c, onNavigate)}
        </p>
      );
    case "ul":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5 marker:text-ink-quiet max-lg:space-y-1.5">
          {b.items.map((it, i) => (
            <li key={i}>{inlines(it, onNavigate)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-ink-mute max-lg:space-y-1.5">
          {b.items.map((it, i) => (
            <li key={i}>{inlines(it, onNavigate)}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="-mx-1 overflow-x-auto overscroll-x-contain px-1">
          <table className="w-full border-collapse text-[13px] tabular-nums max-lg:text-[14px]">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className={cn("border-b border-line-strong px-2 py-1.5 text-left font-semibold whitespace-nowrap text-ink-soft", b.align[i] && ALIGN[b.align[i]!])}>
                    {inlines(c, onNavigate, true)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {r.map((c, k) => (
                    <td key={k} className={cn("px-2 py-1.5 align-top", b.align[k] && ALIGN[b.align[k]!])}>
                      {inlines(c, onNavigate, true)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "pre":
      return (
        <pre key={key} className="overflow-x-auto rounded-xl bg-note px-3 py-2 font-mono text-[12.5px] leading-5 whitespace-pre">
          {b.v}
        </pre>
      );
    case "hr":
      return <hr key={key} className="border-line-strong" />;
  }
}

export function MarkdownView({ text, onNavigate, className }: { text: string; onNavigate?: () => void; className?: string }) {
  return <div className={cn("space-y-2 text-[14px] leading-6 break-words text-ink max-lg:space-y-3", className)}>{parseMarkdown(text).map((b, i) => block(b, i, onNavigate))}</div>;
}
