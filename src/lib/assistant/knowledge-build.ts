/*
 * Panel asistanının bilgi tabanının derlenmesi (saf; scripts/asistan-bilgi.ts yazar, tests/panel-asistani.test.ts
 * tazeliğini sınar). docs/*.md belgeleri `##` başlıklarından bölümlere ayrılır, markdown ve geliştirici ayrıntısı (kod
 * blokları, dosya yolları, işlev adları) atılır, her bölüm kısaltılır. Sonuç src/lib/assistant/knowledge-data.ts'e
 * TS modülü olarak gömülür: sunucu paketine kendiliğinden girer (docs/ klasörü Next'in işlev izine girmez; çalışma
 * anında dosya okunmaz), testler doğrudan içe aktarır. Belge değişince `npm run asistan:bilgi` yeniden yazar; unutulursa
 * test düşer.
 */

export interface KnowledgeSection {
  /** Belgenin dosya adı (ör. KASA-RAPORU.md) */
  doc: string;
  /** Belgenin başlığı ("Gün sonu kasa raporu") */
  docTitle: string;
  /** Bölümün başlığı (giriş bölümünde belgenin başlığı) */
  title: string;
  /** İlgili ekran (bölümde geçen ilk /panel yolu, yoksa belgenin) */
  path: string | null;
  /** Bölümün sadeleşmiş metni (en çok SECTION_MAX karakter) */
  text: string;
}

/** Geliştirici belgeleri: kurulum, tasarım dili, API ayrıntıları, eski plan. Asistanın bilgisine girmez */
export const EXCLUDED_DOCS = [
  "DEPLOY.md",
  "TASARIM.md",
  "PROMPT-VE-PLAN.md",
  "KOYU-TEMA.md",
  "MODPOS-API.md",
  "modpos-kasa-foyu-api.md",
  "parasut-api-spec.md",
  "hesap-sozlesmesi.md",
  "YAZARKASA-Z.md",
  "SENKRON.md",
  // Panelden kaldırılan özelliğin belgesi (26 Ekim 2026): asistan kalkmış ekranı anlatmasın
  "MAL-SIPARISI.md",
] as const;

/**
 * Panelden kaldırılan ekranlar (docs/MAL-SIPARISI.md; tests/hizli-siparis-kaldirildi.test.ts): öteki belgelerde bunları
 * anan satır ve başlığında "kaldırıldı" yazan bölüm bilgi tabanına girmez, böyle bir yol bölümün ekranı olmaz. Asistan
 * kalkmış ekranı anlatmaz, ona bağlantı vermez. Katlanmış metinde (küçük harf, aksansız; fold) aranır.
 */
const REMOVED = /hizli[ -]sayim|mal[ -]siparis|siparis taslag/;
const REMOVED_SECTION = /\(kaldirildi\)|; kaldirildi\)/;

/** Küçük harf, ı → i, aksansız (knowledge.ts foldText ile aynı) */
const fold = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

/** Geliştiriciye yönelik bölümler (başlığa göre) */
const DEV_SECTION = /\(teknik\)|^test|^dosyalar|^kod\b|geliştirici|migration|^uç(lar)?\b|^api\b|^ortam değişken|\(prompt\)|\bprompt\b|^(npm run )?db:/i;

export const SECTION_MAX = 1500;
/** Bölüm başına en çok parça (uzun teknik bölümlerin sonu düşer) */
export const SECTION_CHUNKS = 4;

/** Satır içi kod: panel yolu ve düz sözcük kalır; işlev, tablo, dosya, ortam değişkeni adı düşer */
function inlineCode(code: string): string {
  if (/^\/panel[\w/#?=&-]*$/.test(code)) return code;
  if (/^[\p{Ll}\d çğıöşü'’ .,:%-]+$/u.test(code) && !/[._]\w/.test(code) && code.length <= 40) return code;
  return "";
}

/**
 * Markdown → düz metin. Belgeler ~120 karakterde satır kırar: paragrafın satırları birleşir; madde, tablo satırı (" · "
 * ile hücreler, başında "- ") ve ara başlık ayrı satırda kalır, paragraflar boş satırla ayrılır.
 */
export function plainDoc(md: string): string {
  let s = md.replace(/\r\n?/g, "\n");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/^\s*```[\s\S]*?^\s*```\s*$/gm, "");
  s = s.replace(/\*\*/g, "");
  const out: string[] = [];
  let joinable = false;
  for (let line of s.split("\n")) {
    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      joinable = false;
      continue;
    }
    // Tablo: ayırıcı satır düşer, hücreler " · " ile
    if (/^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line)) continue;
    const table = /^\s*\|.*\|\s*$/.test(line);
    if (table) {
      line = `- ${line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join(" · ")}`;
    }
    const heading = /^\s{0,3}#{1,6}\s+/.test(line);
    const item = table || /^\s{0,3}(?:[-*•]|\d{1,3}[.)])\s+/.test(line);
    const continuation = !heading && !item && /^\s{2,}\S/.test(line);
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    // Düşen kod adının eki de düşer ("`x`'in")
    line = line.replace(/`([^`]+)`(['’]\p{Ll}+)?/gu, (_, code: string, suffix?: string) => {
      const kept = inlineCode(code);
      return kept ? kept + (suffix ?? "") : "";
    });
    line = line.replace(/__([^_]+)__/g, "$1");
    line = line.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2").replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:]|$)/g, "$1$2");
    line = line.replace(/^\s*>\s?/, "");
    line = line.replace(/^\s{0,3}#{1,6}\s+(.*)$/, "$1:");
    line = line.replace(/^\s{0,3}[*•]\s+/, "- ");
    // Kaynak dosyası adı geçen ayraç ("(engine.ts)", "(src/lib/x.ts; …)") ve tek başına dosya adı düşer
    line = line.replace(/\s*\([^()]*\b[\w./-]+\.(?:tsx?|mjs|sql|json)\b[^()]*\)/g, "").replace(/\b[\w./-]+\.(?:tsx?|mjs|sql)\b/g, "");
    // Kod adı düşünce kalan boş ayraçlar ve tekrarlanan ayırıcılar
    line = line.replace(/\(\s*(?:[;,·]\s*)*\)/g, "").replace(/\(\s*[;,]\s*/g, "(").replace(/\s*[;,]\s*\)/g, ")");
    line = line.replace(/[ \t]+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
    if (!line) continue;
    if (joinable && (continuation || (!heading && !item))) out[out.length - 1] += ` ${line}`;
    else out.push(line);
    joinable = !heading && !table;
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Metni en çok `max` karaktere, cümle ya da satır sonunda keser */
export function clipText(text: string, max = SECTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("\n"));
  return `${(at > max * 0.6 ? cut.slice(0, at + 1) : cut).trimEnd()} …`;
}

/**
 * Uzun bölüm parçalara ayrılır (her biri en çok SECTION_MAX, paragraf sınırında; tek paragraf uzunsa cümle sonunda):
 * arama her parçayı ayrı bulur, araç yanıtı kısa kalır. Bölüm başına en çok SECTION_CHUNKS parça.
 */
export function chunkText(text: string, max = SECTION_MAX, limit = SECTION_CHUNKS): string[] {
  const out: string[] = [];
  let cur = "";
  for (const para of text.split("\n")) {
    const pieces = para.length <= max ? [para] : (para.match(new RegExp(`[^]{1,${max - 1}}(?:\\.\\s|$)|[^]{1,${max}}`, "g")) ?? [para]);
    for (const piece of pieces) {
      const next = cur ? `${cur}\n${piece}` : piece;
      if (next.length > max && cur) {
        out.push(cur.trim());
        cur = piece;
      } else cur = next;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean).slice(0, limit);
}

/** Metinde geçen ilk panel yolu (önce satır içi kod, sonra bağlantı); kaldırılan ekranın yolu sayılmaz */
function firstPanelPath(text: string): string | null {
  for (const re of [/`(\/panel[\w/#?=&-]*)`/g, /\((\/panel[\w/#-]*)\)/g]) {
    for (const m of text.matchAll(re)) if (!REMOVED.test(fold(m[1]))) return m[1];
  }
  return null;
}

/** Kaldırılan ekranı anan satırlar düşer (madde, tablo satırı ya da paragraf) */
const withoutRemoved = (plain: string) =>
  plain
    .split("\n")
    .filter((line) => !REMOVED.test(fold(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Tek belgenin bölümleri */
export function sectionsOf(doc: string, md: string): KnowledgeSection[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const docTitle = (/^#\s+(.+)$/m.exec(md)?.[1] ?? doc.replace(/\.md$/, "")).trim();
  const parts: { title: string; body: string[] }[] = [{ title: docTitle, body: [] }];
  let inFence = false;
  let h2Title = docTitle;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^#\s+/.test(line) && parts.length === 1 && !parts[0].body.some((l) => l.trim())) continue;
    // Bölüm: ## ve ### başlıkları (alt bölümün başlığında üst bölümün adı da: "5. Kalemler › 5a. Zam uyarısı")
    const h = !inFence ? /^(#{2,3})\s+(.+?)\s*$/.exec(line) : null;
    if (h) {
      const title = h[2].replace(/`/g, "").trim();
      if (h[1] === "##") h2Title = title;
      parts.push({ title: h[1] === "##" ? title : `${h2Title} › ${title}`, body: [] });
    } else parts[parts.length - 1].body.push(line);
  }
  const docPath = firstPanelPath(parts[0].body.join("\n"));
  const out: KnowledgeSection[] = [];
  for (const p of parts) {
    if (DEV_SECTION.test(p.title) || REMOVED_SECTION.test(fold(p.title))) continue;
    const raw = p.body.join("\n");
    const plain = withoutRemoved(plainDoc(raw));
    if (plain.length < 40) continue;
    const title = plainDoc(p.title);
    chunkText(plain).forEach((text, i) =>
      out.push({ doc, docTitle: plainDoc(docTitle), title: i ? `${title} (devam ${i + 1})` : title, path: firstPanelPath(raw) ?? docPath, text }),
    );
  }
  return out;
}

/** Bütün belgelerin bölümleri (dosya adına göre sıralı; dışarıda bırakılanlar hariç) */
export function compileKnowledge(files: readonly { name: string; text: string }[]): KnowledgeSection[] {
  const skip = new Set<string>(EXCLUDED_DOCS);
  return [...files]
    .filter((f) => f.name.endsWith(".md") && !skip.has(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((f) => sectionsOf(f.name, f.text));
}

/** Gömülen modülün kaynağı (scripts/asistan-bilgi.ts yazar) */
export function knowledgeModule(sections: readonly KnowledgeSection[]): string {
  return [
    "// Bu dosya üretilir, elle değiştirmeyin: npm run asistan:bilgi (scripts/asistan-bilgi.ts, src/lib/assistant/knowledge-build.ts).",
    "// Kaynak: docs/*.md (geliştirici belgeleri hariç). Panel asistanının panel_rehberi aracı bunda arar.",
    "",
    'import type { KnowledgeSection } from "./knowledge-build";',
    "",
    // Satır başına bir bölüm: belge değişince fark yalnız o bölümlerin satırında görünür
    `export const KNOWLEDGE: readonly KnowledgeSection[] = [\n${sections.map((s) => `  ${JSON.stringify(s)},`).join("\n")}\n];`,
    "",
  ].join("\n");
}
