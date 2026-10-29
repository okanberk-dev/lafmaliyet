/**
 * Beyanname damgaları (plan docs/planlar/vergi.md §3.9, K22): her KDV-1, KDV-2 (yalnız tevkifat ya da yurt dışı hizmet
 * olan ay), muhtasar ve prim hizmet (personel varsa) ya da muhtasar (yalnız stopaj), geçici vergi ve kurumlar vergisi
 * beyannamesi için kural tablosunun maktu tutarı; kurumlar vergisiyle bilanço ve gelir tablosu da. Damga beyannamenin
 * verildiği yılın tutarıyla ödenir: o yılın tablosu yoksa en son bilinen yılın tutarı "açıklanmadı" notuyla (K7).
 * Ücretin damgası bordrodadır (payroll.ts); sözleşme damgası hesaplanmaz (§19). Saf modül; tests/vergi-damga.test.ts.
 */

import { r2, rulesFor, type TaxOverrides } from "./rules";

export interface ReturnStampFlags {
  /** Ayın KDV-2'si var (alış faturalarında tevkifat ya da yurt dışı hizmet) */
  kdv2: boolean;
  /** Ayın personeli var: muhtasar ve prim hizmet beyannamesi */
  personnel: boolean;
  /** Personel yokken muhtasarın vergisi var (stopaj): yalnız muhtasar beyannamesi */
  withholding: boolean;
}

export interface ReturnStamps {
  kdv: number;
  kdv2: number;
  /** Muhtasar ve prim hizmet ya da yalnız muhtasar beyannamesinin damgası; ikisi de yoksa 0 */
  muhtasar: number;
  muhtasarKind: "mphb" | "muhtasar" | null;
  total: number;
  /** Beyannamenin verildiği yıl ve tutarın tahmini olup olmadığı */
  year: number;
  estimated: boolean;
}

/** Ay P'nin beyannamelerinin damgası (P+1'de verilir; o yılın tutarı) */
export function returnStamps(month: string, flags: ReturnStampFlags, overrides?: TaxOverrides): ReturnStamps {
  const [y, m] = month.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const { rules, estimated } = rulesFor(year, overrides);
  const b = rules.damga.beyanname;
  const kdv = b.kdv.value;
  const kdv2 = flags.kdv2 ? b.kdv.value : 0;
  const muhtasarKind = flags.personnel ? "mphb" : flags.withholding ? "muhtasar" : null;
  const muhtasar = muhtasarKind === "mphb" ? b.mphb.value : muhtasarKind === "muhtasar" ? b.muhtasar.value : 0;
  return { kdv, kdv2, muhtasar, muhtasarKind, total: r2(kdv + kdv2 + muhtasar), year, estimated };
}

/** Muhtasar beyannamesinin damgası tek başına (muhtasar.ts) */
export function muhtasarStamp(month: string, personnel: boolean, withholding: boolean, overrides?: TaxOverrides): { amount: number; kind: "mphb" | "muhtasar" | null; estimated: boolean; year: number } {
  const s = returnStamps(month, { kdv2: false, personnel, withholding }, overrides);
  return { amount: s.muhtasar, kind: s.muhtasarKind, estimated: s.estimated, year: s.year };
}

/** Geçici vergi beyannamesinin damgası (sıfır beyanda da); 4. dönem izleyen yılın Şubat'ında verilir */
export function geciciStamp(quarter: string, overrides?: TaxOverrides): { amount: number; year: number; estimated: boolean } {
  const [y, q] = [Number(quarter.slice(0, 4)), Number(quarter.slice(-1))];
  const year = q === 4 ? y + 1 : y;
  const r = rulesFor(year, overrides);
  return { amount: r.rules.damga.gecici.value, year, estimated: r.estimated };
}

export interface KvStamps {
  beyanname: number;
  bilanco: number;
  gelirTablosu: number;
  total: number;
  /** Beyannamenin verildiği yıl (izleyen yıl) */
  year: number;
  estimated: boolean;
  /** "2027 tutarları açıklanmadı" (tahmini yılda) */
  note: string | null;
}

/** Kurumlar vergisi beyannamesiyle tahakkuk eden damgalar: beyanname + bilanço + gelir tablosu (2026: 2.516,30) */
export function kvStamps(year: number, overrides?: TaxOverrides): KvStamps {
  const r = rulesFor(year + 1, overrides);
  const d = r.rules.damga;
  const beyanname = d.beyanname.kv.value;
  const bilanco = d.mali.bilanco.value;
  const gelirTablosu = d.mali.gelirTablosu.value;
  return {
    beyanname,
    bilanco,
    gelirTablosu,
    total: r2(beyanname + bilanco + gelirTablosu),
    year: year + 1,
    estimated: r.estimated,
    note: r.estimated ? `${year + 1} tutarları açıklanmadı` : null,
  };
}
