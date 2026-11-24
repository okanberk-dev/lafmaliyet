/*
 * Panel asistanının bilgi tabanında arama (saf; tests/panel-asistani.test.ts). Bölümler docs/*.md'den derlenir
 * (knowledge-build.ts, knowledge-data.ts). Arama sözcük önekleriyle yapılır: Türkçe ekler ("hammaddeye", "faturaları")
 * kökü ("hammadde", "fatura") bulsun diye sözcüklerden biri ötekinin başıysa eşleşir (en az 4 harf). Puan: başlıkta
 * geçen sözcük ve sorunun kaç farklı sözcüğünün bulunduğu ağır basar, metinde geçme sayısı sınırlı katkı yapar.
 */

import type { KnowledgeSection } from "./knowledge-build";
import { KNOWLEDGE } from "./knowledge-data";

/** Türkçe küçük harf, ı → i, aksansız */
export const foldText = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

/** Soru sözcüğü, bağlaç ve sık geçen dolgu sözcükler: aramaya katılmaz */
const STOP = new Set(
  "ve ile ya da de mi mu ne bir bu su o icin gibi ki ama veya hem nasil nedir neden nerede nereden hangi hangisi kac kim olan olarak olur var yok mi mu daha en cok az her hep sonra once kadar ben biz bana bize beni bizi benim bizim sen siz panel panelde ekran ekranda ekrani yapilir yaparim yapabilirim yapmak gerek lazim istiyorum acaba".split(
    " ",
  ),
);

export function queryWords(query: string): string[] {
  const words = foldText(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(words)];
}

const matches = (word: string, q: string) => word.startsWith(q) || (q.length > word.length && word.length >= 4 && q.startsWith(word));

interface Indexed {
  section: KnowledgeSection;
  title: string[];
  doc: string[];
  body: string[];
}

let index: Indexed[] | null = null;

function build(sections: readonly KnowledgeSection[]): Indexed[] {
  const words = (s: string) => foldText(s).split(/[^a-z0-9]+/).filter(Boolean);
  return sections.map((section) => ({ section, title: words(section.title), doc: words(section.docTitle), body: words(section.text) }));
}

export interface KnowledgeHit extends KnowledgeSection {
  score: number;
}

/** Bir sonuçta en çok bu kadar metin (araç yanıtı kısa kalsın; bölümün tamamı en çok SECTION_MAX) */
export const EXCERPT_MAX = 1000;

/**
 * Bölümden soruyla en ilgili parça: sorunun en çok sözcüğünü taşıyan paragraf (eşitse ilki) ve ondan önceki bir
 * paragraf, en çok `max` karakter; kesilen yerlerde "…"
 */
export function excerpt(text: string, qs: readonly string[], max = EXCERPT_MAX): string {
  if (text.length <= max) return text;
  const paras = text.split("\n");
  let best = 0;
  let bestScore = -1;
  paras.forEach((p, i) => {
    const words = foldText(p).split(/[^a-z0-9]+/);
    const score = qs.filter((q) => words.some((w) => matches(w, q))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  const start = Math.max(0, best - 1);
  let out = "";
  let i = start;
  for (; i < paras.length; i++) {
    const next = out ? `${out}\n${paras[i]}` : paras[i];
    if (next.length > max) break;
    out = next;
  }
  if (!out) out = paras[start].slice(0, max - 2);
  return `${start > 0 ? "… " : ""}${out.trim()}${i < paras.length ? " …" : ""}`;
}

/**
 * En ilgili bölümler (en çok `limit`). Puan: başlıkta geçen her sözcük 4, belgenin başlığında 2, metinde her geçiş 1
 * (sözcük başına en çok 4), bulunan her farklı sözcük 3. Hiçbir sözcüğü bulunmayan bölüm dönmez.
 */
export function searchKnowledge(query: string, limit = 4, sections: readonly KnowledgeSection[] = KNOWLEDGE): KnowledgeHit[] {
  const qs = queryWords(query);
  if (!qs.length) return [];
  const idx = sections === KNOWLEDGE ? (index ??= build(KNOWLEDGE)) : build(sections);
  // Her bölümde her sözcüğün yeri: başlıkta, belgenin başlığında, metinde kaç kez (en çok 4)
  const seen = idx.map((it) =>
    qs.map((q) => {
      let body = 0;
      for (const w of it.body) if (matches(w, q) && ++body >= 4) break;
      return { title: it.title.some((w) => matches(w, q)), doc: it.doc.some((w) => matches(w, q)), body };
    }),
  );
  // Seyrek sözcük ağır basar ("paraşüt" "ürün"den): ağırlık log(1 + bölüm sayısı / geçtiği bölüm sayısı)
  const weight = qs.map((_, k) => {
    const df = seen.filter((s) => s[k].title || s[k].doc || s[k].body).length;
    return df ? Math.log(1 + idx.length / df) : 0;
  });
  const hits: KnowledgeHit[] = [];
  idx.forEach((it, n) => {
    let score = 0;
    seen[n].forEach((s, k) => {
      if (!s.title && !s.doc && !s.body) return;
      score += weight[k] * ((s.title ? 4 : 0) + (s.doc ? 2 : 0) + s.body + 3);
    });
    if (score > 0) hits.push({ ...it.section, text: excerpt(it.section.text, qs), score: Math.round(score * 10) / 10 });
  });
  return hits.sort((a, b) => b.score - a.score || a.doc.localeCompare(b.doc) || a.title.localeCompare(b.title)).slice(0, limit);
}
