/*
 * Asistan yanıtının güvenli markdown'u (saf; tests/panel-asistani.test.ts). Metin HTML'e çevrilmez: düz bir ağaca
 * (blok ve satır içi düğümler) ayrılır, ekranda React öğeleri olarak çizilir (src/components/panel/assistant/
 * markdown-view.tsx); React her metni kaçışlar, `dangerouslySetInnerHTML` yok. Ham HTML (`<script>`, `<img onerror>`)
 * olduğu gibi yazı olarak görünür.
 *
 * Desteklenen alt küme: paragraf, satır sonu, başlık (#–###), madde ve numaralı liste, tablo (| a | b |), kod bloğu,
 * **kalın**, *eğik*, `kod`, [bağlantı](adres). Bağlantı yalnız panelin kendi ekranlarına (`/panel`, `/panel/...`) ya da
 * https adresine olur; başka her adres (javascript:, data:, http:, //başka-site, göreli yol) bağlantısız yazı kalır.
 * Akış sırasında yarım gelen metin de ayrışır (kapanmamış ** düz yazı kalır).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][]; align: ("left" | "right" | "center" | null)[] }
  | { t: "pre"; v: string }
  | { t: "hr" };

/** İzin verilen bağlantı adresi; değilse null. Panel yolu: `/panel` ya da `/panel/…`, `/panel?…`, `/panel#…` */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  // Görünmeyen ve denetim karakterleri, ters bölü ve boşluk: tarayıcıların farklı okuduğu adresler
  if (!href || /[\u0000-\u001f\u007f\s\\]/.test(href)) return null;
  if (/^\/panel(?:[/?#]|$)/.test(href)) {
    if (href.includes("//") || /(^|\/)\.\.?(\/|$|[?#])/.test(href)) return null;
    return { href, external: false };
  }
  if (/^https:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
      return { href: url.toString(), external: true };
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- Satır içi

/** Kapanışı bulunan işaret: [başlangıç, bitiş) aralığı; yoksa -1 */
function closing(src: string, from: number, mark: string): number {
  const i = src.indexOf(mark, from);
  return i > from ? i : -1;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#|-]/.test(src[i + 1])) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const end = closing(src, i + 1, "`");
      if (end > 0) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const mark = rest.slice(0, 2);
      const end = closing(src, i + 2, mark);
      if (end > 0 && src[i + 2] !== " ") {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " " && src[i + 1] !== undefined) {
      // Kelime içindeki alt çizgi (ay_ozeti) eğik yazı değildir
      const wordBefore = ch === "_" && i > 0 && /[\p{L}\p{N}]/u.test(src[i - 1]);
      const end = wordBefore ? -1 : closing(src, i + 1, ch);
      if (end > 0 && src[end - 1] !== " " && !(ch === "_" && /[\p{L}\p{N}]/u.test(src[end + 1] ?? ""))) {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]*(?:\s+"[^"]*")?)\)/.exec(rest);
      if (m) {
        flush();
        const label = parseInline(m[1]);
        const target = safeHref(m[2].replace(/\s+"[^"]*"$/, ""));
        if (target) out.push({ t: "link", href: target.href, external: target.external, c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- Bloklar

const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const ORDERED = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}```/;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join("\n")) });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // kapanış (yoksa metnin sonu)
      blocks.push({ t: "pre", v: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: "h", level: Math.min(h[1].length, 3) as 1 | 2 | 3, c: parseInline(h[2]) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flushPara();
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flushPara();
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        const row = cells(lines[i]);
        rows.push(head.map((_, k) => parseInline(row[k] ?? "")));
        i++;
      }
      blocks.push({ t: "table", head: head.map(parseInline), rows, align: head.map((_, k) => align[k] ?? null) });
      continue;
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      flushPara();
      const ordered = !BULLET.test(line);
      const start = ordered ? Number(ORDERED.exec(line)![1]) : 1;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = ordered ? ORDERED.exec(l) : BULLET.exec(l);
        if (m) items.push(ordered ? m[2] : m[1]);
        else if (l.trim() && /^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += `\n${l.trim()}`;
        else break;
        i++;
      }
      const parsed = items.map(parseInline);
      blocks.push(ordered ? { t: "ol", start, items: parsed } : { t: "ul", items: parsed });
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
}

/** Düğümlerin düz yazısı (ekran okuyucu özeti, testler) */
export function plainText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "br" ? "\n" : plainText(n.c))).join("");
}
