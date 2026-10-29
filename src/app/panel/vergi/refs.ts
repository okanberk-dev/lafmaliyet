import { accountantCheck } from "@/lib/tax/checks";
import { type Confidence, findRule, overrideText, type RuleSource, ruleValueText, rulesFor, type TaxOverrides } from "@/lib/tax/rules";

/*
 * "Nasıl hesaplandı"nın kullanılan kuralları (plan docs/planlar/vergi.md §4.0): başlık, değer, dayanak, güven, kaynak ve
 * varsa muhasebeciye sorulacak madde. Değerler yılın kural tablosundan, elle değer uygulanmış (rulesFor). Sunucuda kurulur.
 */

export interface RuleRef {
  key: string;
  title: string;
  value: string;
  basis: string;
  confidence: Confidence;
  sources: readonly RuleSource[];
  /** Elle değer: "Elle: 820,00 ₺ (tablo: 791,00 ₺) · not · kim, ne zaman" */
  override: string | null;
  /** "Muhasebecinize sorun: SGK oranı" */
  ask: string | null;
}

/** Takvim satırının türüne göre kullanılan kurallar */
export const CALENDAR_RULES: Record<string, readonly string[]> = {
  kdv1: ["takvim", "damga.beyanname.kdv"],
  kdv2: ["takvim", "kdv.sorumluYurtDisi", "damga.beyanname.kdv"],
  mphb: ["ucret.tarife", "ucret.asgariIstisna", "ucret.damgaOrani", "stopaj.kira", "stopaj.serbestMeslek", "stopaj.internetReklam", "damga.beyanname.mphb", "damga.beyanname.muhtasar"],
  sgk: ["sgk.pek", "sgk.isciOran", "sgk.isciIssizlik", "sgk.isverenOran", "sgk.isverenIssizlik", "takvim"],
  gecici: ["gecici.oran", "gecici.gun", "kv.asgariOran", "damga.gecici"],
  kv: ["kv.oran", "kv.asgariOran", "kv.beyan", "gecici.mahsup", "damga.beyanname.kv", "damga.mali.bilanco", "damga.mali.gelirTablosu"],
  ctv: [],
  yerel: [],
};

/** Geçici vergi kartının kuralları */
export const GECICI_RULES = ["gecici.oran", "kv.asgariOran", "kv.asgariMuafDonem", "kv.asgariZararDusulur", "kv.devredenZarar", "damga.gecici", "vuk.dogrudanGider"] as const;
/** Kurumlar vergisi kartının kuralları */
export const KV_RULES = ["kv.oran", "kv.asgariOran", "kv.asgariMuafDonem", "kv.devredenZarar", "kv.beyan", "gecici.mahsup", "damga.beyanname.kv", "damga.mali.bilanco", "damga.mali.gelirTablosu"] as const;

/** Anahtarların kural künyesi; tabloda olmayan anahtar atlanır */
export function ruleRefs(keys: readonly string[], year: number, overrides?: TaxOverrides): RuleRef[] {
  const { rules } = rulesFor(year, overrides);
  const out: RuleRef[] = [];
  for (const key of keys) {
    const r = findRule(rules, key);
    if (!r) continue;
    out.push({
      key,
      title: r.title,
      value: ruleValueText(r),
      basis: r.basis,
      confidence: r.confidence,
      sources: r.sources,
      override: overrideText(r),
      ask: r.confirm ? accountantCheck(r.confirm).title : null,
    });
  }
  return out;
}
