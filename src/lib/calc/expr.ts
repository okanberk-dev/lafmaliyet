import { RECIPE_PARAMS } from "../constants";
import type { Settings } from "./types";

// Reçete miktarları için küçük ve güvenli bir formül değerlendirici.
// Desteklenen: sayılar (1,5 veya 1.5), + - * / ve parantez, Ayarlar'daki değişkenler (ShotTek, Pompa ...).
// eval kullanılmaz; yalnızca bu dilbilgisi kabul edilir.

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if ("+-*/()×".includes(ch)) {
      out.push({ t: "op", v: ch === "×" ? "*" : ch });
      i++;
      continue;
    }
    if (/[0-9.,]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      const raw = src.slice(i, j).replace(",", ".");
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Geçersiz sayı: ${src.slice(i, j)}`);
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (/[A-Za-zÇĞİÖŞÜçğıöşü_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9ÇĞİÖŞÜçğıöşü_]/.test(src[j])) j++;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Beklenmeyen karakter: "${ch}"`);
  }
  return out;
}

const PARAM_LOOKUP = new Map(RECIPE_PARAMS.map((p) => [p.name.toLowerCase(), p.key]));

export function evaluateExpression(src: string, settings: Settings): number {
  const tokens = tokenize(src.trim().replace(/^=/, ""));
  let pos = 0;

  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

  function expr(): number {
    let v = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = take().v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function term(): number {
    let v = factor();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = take().v;
      const r = factor();
      if (op === "/" && r === 0) throw new Error("Sıfıra bölme");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function factor(): number {
    const tok = take();
    if (!tok) throw new Error("Formül eksik");
    if (tok.t === "num") return tok.v;
    if (tok.t === "id") {
      const key = PARAM_LOOKUP.get(tok.v.toLowerCase());
      if (!key) throw new Error(`Bilinmeyen değişken: ${tok.v}`);
      return Number(settings[key]);
    }
    if (tok.v === "(") {
      const v = expr();
      const close = take();
      if (!close || close.v !== ")") throw new Error("Kapanmayan parantez");
      return v;
    }
    if (tok.v === "-") return -factor();
    if (tok.v === "+") return factor();
    throw new Error(`Beklenmeyen ifade: ${tok.v}`);
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error("Formülün sonu anlaşılamadı");
  if (!Number.isFinite(result)) throw new Error("Geçersiz sonuç");
  return result;
}

/** Formül geçerliyse null, değilse hata mesajı döner. */
export function validateExpression(src: string, settings: Settings): string | null {
  try {
    evaluateExpression(src, settings);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Geçersiz formül";
  }
}

/** "1.234,5" / "1234.5" / "51,85" gibi Türkçe veya İngilizce yazılmış sayıları çözer. */
export function parseNumberTR(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/\s|₺|TL/gi, "");
  if (!s) return null;
  const pct = s.startsWith("%") || s.endsWith("%");
  s = s.replace(/%/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  } else if (/^-?\d{1,3}\.\d{3}$/.test(s)) {
    // "1.022" Türkçede bin ayıracıdır
    s = s.replace(".", "");
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return pct ? v / 100 : v;
}
