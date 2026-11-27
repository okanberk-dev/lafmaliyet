import "server-only";

import { eq, sql } from "drizzle-orm";

import {
  ANAHTAR_BASLIGI,
  ANAHTAR_UYUMU_KEY,
  anahtarEslesmesi,
  anahtarUyarilari,
  dagitilanHedefler,
  destekGuncelle,
  gecerliSinama,
  HEDEF_ADI,
  hedefNotlari,
  kasalarinDurumu,
  kasaRaporuYazilsin,
  ONCEKI_BAYRAGI_YOLU,
  oncekiBayragi,
  otomatikSinamaGerekli,
  parseAnahtarUyumu,
  SINAMA_ZAMAN_ASIMI_MS,
  sinamaAdresi,
  sonucBirlestir,
  yanitDurumu,
  type AnahtarUyarisi,
  type AnahtarUyumu,
  type Hedef,
  type HedefSonucu,
  type Sinama,
  type SinamaTetigi,
} from "@/lib/asilpos/anahtar-uyumu";
import { dagitilanBaglantilar } from "@/lib/asilpos/baglanti-dagitim";
import { signedRequest } from "@/lib/karaoke/signature";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Anahtar değişiminin uyumu, sunucu tarafı (kurallar ve metinler src/lib/asilpos/anahtar-uyumu.ts; docs/ASILPOS.md ›
 * Şube kurulumu › Anahtar değişimi): kasaların bağlantı sorgusunun raporu, Uzaktan'ın ve sitenin panelin anahtarını
 * kabul edip etmediğinin sınaması ve ikisinin kaydı (`integration_state` › ANAHTAR_UYUMU_KEY). Anahtar, imza ve uçların
 * yanıt gövdesi hiçbir yere yazılmaz; günlükte yalnız uç, durum ve HTTP kodu.
 */

type Env = Record<string, string | undefined>;

export async function readAnahtarUyumu(db: DB = getDb()): Promise<AnahtarUyumu> {
  const [row] = await db.select({ value: s.integrationState.value }).from(s.integrationState).where(eq(s.integrationState.key, ANAHTAR_UYUMU_KEY)).limit(1);
  return parseAnahtarUyumu(row?.value);
}

/**
 * Kasanın bağlantı sorgusu (`GET /api/panel/pos/baglanti`): uyguladığı ve güncel sürüm şubenin satırına yazılır (yalnız
 * değiştiyse ya da son yazım bir saatten eskiyse: kasa 10 dakikada bir sorar). Bu değerler son bir saatte sınanmadıysa
 * Uzaktan ve site sınanır (değerler değişince hemen): kasa yeni değeri ilk kez gördü (gün kapanmadan uyarı), uyguladı
 * (şimdi reddediliyor mu) ya da hiçbir şey değişmedi ama Uzaktan ya da site değişmiş olabilir (`_ONCEKI` erken silindi,
 * değer `_ONCEKI`'siz değişti; inceleme 27 Kasım: önceden yalnız kasanın raporu değişince sınanıyordu, uyarı ertesi
 * sabaha kalıyordu). Uçtan `after()` ile çağrılır: yanıtı bekletmez; hata fırlatmaz
 */
export async function noteBaglantiRaporu(
  db: DB,
  branchId: string,
  rapor: { uygulanan: string; guncel: string },
  opts: { now?: Date; env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<{ yazildi: boolean; sinama: Sinama | null }> {
  const now = opts.now ?? new Date();
  try {
    const state = await readAnahtarUyumu(db);
    const { yaz } = kasaRaporuYazilsin(state.kasalar[branchId], rapor, now);
    if (yaz) {
      const kasa = JSON.stringify({ [branchId]: { ...rapor, at: now.toISOString() } });
      await db.execute(sql`
        insert into integration_state (key, value) values (${ANAHTAR_UYUMU_KEY}, jsonb_build_object('kasalar', ${kasa}::jsonb))
        on conflict (key) do update
          set value = integration_state.value || jsonb_build_object('kasalar', coalesce(integration_state.value->'kasalar', '{}'::jsonb) || ${kasa}::jsonb),
              updated_at = now()`);
    }
    // Kasanın raporu değişmese de (yalnız uçlar değişmiş olabilir): bu değerlerin son sınaması bir saatten eskiyse
    if (!otomatikSinamaGerekli(state, rapor.guncel, now)) return { yazildi: yaz, sinama: null };
    return { yazildi: yaz, sinama: await sinaAnahtarlar(db, { tetik: "kasa", now, env: opts.env, fetchImpl: opts.fetchImpl }) };
  } catch (e) {
    console.error("[asilpos anahtar] kasa raporu yazılamadı:", e instanceof Error ? e.message : e);
    return { yazildi: false, sinama: null };
  }
}

/**
 * Bir ucu panelin anahtarıyla imzalı GET ile sınar; gövde okunmaz. Ağ hatası ve zaman aşımı "hata". 2xx yanıtta
 * `ANAHTAR_BASLIGI` (panelin anahtarı uçta şimdiki mi, önceki mi) okunur; ucun açık durum ucu varsa
 * (`ONCEKI_BAYRAGI_YOLU`, yalnız Uzaktan) aynı anda `_ONCEKI` tanımlı mı okunur. Bilinmeyen alan sonuca girmez
 */
export async function sinaHedef(h: { hedef: Hedef; url: string; secret: string }, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<HedefSonucu> {
  const [sonuc, oncekiTanimli] = await Promise.all([imzaliSinama(h, fetchImpl, now), oncekiTanimliMi(h, fetchImpl)]);
  return oncekiTanimli === null ? sonuc : { ...sonuc, oncekiTanimli };
}

async function imzaliSinama(h: { hedef: Hedef; url: string; secret: string }, fetchImpl: typeof fetch, now: Date): Promise<HedefSonucu> {
  try {
    const url = sinamaAdresi(h.hedef, h.url);
    const req = signedRequest(h.secret, "GET", url, "", now.getTime());
    const res = await fetchImpl(url, { ...req, signal: AbortSignal.timeout(SINAMA_ZAMAN_ASIMI_MS), cache: "no-store" });
    await res.body?.cancel().catch(() => undefined);
    const durum = yanitDurumu(res.status);
    const anahtar = durum === "ok" ? anahtarEslesmesi(res.headers.get(ANAHTAR_BASLIGI)) : null;
    return { durum, http: res.status, ...(anahtar ? { anahtar } : {}) };
  } catch {
    return { durum: "hata", http: null };
  }
}

/** Uçta `_ONCEKI` tanımlı mı (açık durum ucu, imzasız); ucu yoksa, ulaşılamadıysa ya da alan yoksa null (bilinmiyor) */
async function oncekiTanimliMi(h: { hedef: Hedef; url: string }, fetchImpl: typeof fetch): Promise<boolean | null> {
  const yol = ONCEKI_BAYRAGI_YOLU[h.hedef];
  if (!yol) return null;
  try {
    const res = await fetchImpl(new URL(`${h.url.replace(/\/+$/, "")}${yol}`), { signal: AbortSignal.timeout(SINAMA_ZAMAN_ASIMI_MS), cache: "no-store" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return oncekiBayragi(await res.json());
  } catch {
    return null;
  }
}

/**
 * Panelin dağıttığı uçları (Uzaktan, site) şimdi sınar, sonucu yazar ve döner. Dağıtılan uç yoksa null (hiçbir şey
 * yazılmaz). İki uç aynı anda, her biri en çok SINAMA_ZAMAN_ASIMI_MS. Bu kez sınanamayan uçta aynı değerlerin önceki
 * sorunu kalır (sonucBirlestir). `now` imzanın saati de olduğu için yalnız testler verir
 */
export async function sinaAnahtarlar(db: DB, opts: { tetik: SinamaTetigi; now?: Date; env?: Env; fetchImpl?: typeof fetch }): Promise<Sinama | null> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const hedefler = dagitilanHedefler(env);
  if (!hedefler.length) return null;
  const { surum } = dagitilanBaglantilar(env);
  const [state, sonuclar] = await Promise.all([
    readAnahtarUyumu(db),
    Promise.all(hedefler.map(async (h) => [h.hedef, await sinaHedef(h, opts.fetchImpl, now)] as const)),
  ]);
  const sonuc = Object.fromEntries(sonuclar);
  // Bu kez sınanamayan uçta (ağ) önceki sorun kalır (sonucBirlestir)
  const sinama = sonucBirlestir(state.sinama, { at: now.toISOString(), surum, tetik: opts.tetik, sonuc });
  // Uçların önceki anahtar desteği: 2xx veren uçta başlık var mıydı (bu kez sınanamayanda eski bilgi kalır)
  const destek = destekGuncelle(state.destek, sonuc);
  // Üst düzey alanlar birleştirilerek: kasaların raporu kalır
  const patch = JSON.stringify({ sinama, destek });
  await db.execute(sql`
    insert into integration_state (key, value) values (${ANAHTAR_UYUMU_KEY}, ${patch}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${patch}::jsonb, updated_at = now()`);
  // Yalnız uç, durum, HTTP kodu ve eşleşen değerin türü (anahtar ve sürüm yok)
  console.info(`[asilpos anahtar] tetik=${opts.tetik} ${sonuclar.map(([h, r]) => `${h}=${r.durum}${r.http ? `(${r.http})` : ""}${r.anahtar ? `[${r.anahtar}]` : ""}`).join(" ")}`);
  return sinama;
}

/** Ayarlar › AsilPOS kartının anahtar bölümü */
export interface AnahtarUyumuKarti {
  /**
   * Panelin dağıttığı uçlar, bu değerlerle son sınamanın sonucu (yoksa null: henüz sınanmadı) ve notlar (önceki anahtarı
   * tanır mı, önceki anahtar tanımlı mı)
   */
  hedefler: { hedef: Hedef; ad: string; sonuc: HedefSonucu | null; notlar: string[] }[];
  /** Bu değerlerle son sınama */
  sinama: Sinama | null;
  /** Son sınama önceki değerlerle yapılmış (değerler sonra değişti) */
  eskiDegerlerle: boolean;
  /** Son KASA_RAPORU_GUN günde soran kasalar: güncel değerleri uygulayan ve bekleyen şubeler */
  kasalar: { uygulayan: string[]; bekleyen: string[] };
  uyarilar: AnahtarUyarisi[];
}

/** Kartın verisi; panel Uzaktan ya da site bağlantısı dağıtmıyorsa null (bölüm görünmez) */
export async function loadAnahtarUyumuKarti(db: DB = getDb(), now: Date = new Date(), env: Env = process.env): Promise<AnahtarUyumuKarti | null> {
  const hedefler = dagitilanHedefler(env);
  const { surum } = dagitilanBaglantilar(env);
  if (!hedefler.length || !surum) return null;
  const state = await readAnahtarUyumu(db);
  const sinama = gecerliSinama(state, surum);
  return {
    hedefler: hedefler.map(({ hedef }) => {
      const sonuc = sinama?.sonuc[hedef] ?? null;
      return { hedef, ad: HEDEF_ADI[hedef], sonuc, notlar: hedefNotlari(sonuc, state.destek[hedef]) };
    }),
    sinama,
    eskiDegerlerle: state.sinama !== null && sinama === null,
    kasalar: kasalarinDurumu(state, surum, now),
    uyarilar: anahtarUyarilari({ state, surum, now, env }),
  };
}
