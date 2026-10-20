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
  } else if (/^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) {
    // "1.022" Türkçede bin ayıracıdır; "0.125" ise ondalıktır (bin ayıracı 0 ile başlamaz)
    s = s.replace(".", "");
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return null;
  return pct ? v / 100 : v;
}

/**
 * Yüzde alanları için: yazılan değer her zaman **yüzde puanı**dır ve oran (0–1) olarak döner.
 * Paneldeki yüzde alanları değeri puan olarak gösterir ("KDV oranı (%)" alanında 10 yazar), bu yüzden:
 *
 * - "10", "10,5", "85.6" → %10, %10,5, %85,6 (0,1 / 0,105 / 0,856)
 * - "%10", "10%", "% 10" → yine %10: "%" işareti ikinci kez 100'e böldürmez
 * - "0,1" → %0,1 (0,001). Excel'in "otomatik yüzde girişi" 1'den küçük sayıyı ×100 yapar (0,1 → %10);
 *   panel bunu yapmaz, çünkü %0,5 fire ya da %0,79 komisyon gibi gerçek küçük oranlar var ve alan
 *   zaten puan gösteriyor. Alan altındaki "= %0,1" yankısı yanlış yazımı görünür kılar.
 *
 * Boş ya da okunamayan metin için null döner.
 */
export function parsePercentInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const points = typeof raw === "number" ? (Number.isFinite(raw) ? raw : null) : parseNumberTR(raw.replace(/%/g, ""));
  return points === null ? null : points / 100;
}

/** Oranı (0,856) yüzde alanına yazılacak metne çevirir ("85,6"); parsePercentInput'un tersi. */
export function formatPercentInput(rate: number | null | undefined, maxDecimals = 2): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "";
  const points = Math.round(rate * 100 * 10 ** maxDecimals) / 10 ** maxDecimals;
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: maxDecimals, useGrouping: false }).format(Object.is(points, -0) ? 0 : points);
}
