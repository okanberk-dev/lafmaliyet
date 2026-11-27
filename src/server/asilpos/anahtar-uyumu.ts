import "server-only";

import { eq, sql } from "drizzle-orm";

import {
  ANAHTAR_UYUMU_KEY,
  anahtarUyarilari,
  dagitilanHedefler,
  gecerliSinama,
  HEDEF_ADI,
  kasalarinDurumu,
  kasaRaporuYazilsin,
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
 * değiştiyse ya da son yazım bir saatten eskiyse: kasa 10 dakikada bir sorar). Değiştiyse ve bu değerler son bir saatte
 * sınanmadıysa Uzaktan ve site sınanır: kasa yeni değeri ilk kez gördü (gün kapanmadan uyarı) ya da uyguladı (şimdi
 * reddediliyor mu). Uçtan `after()` ile çağrılır: yanıtı bekletmez; hata fırlatmaz
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
    const { yaz, degisti } = kasaRaporuYazilsin(state.kasalar[branchId], rapor, now);
    if (!yaz) return { yazildi: false, sinama: null };
    const kasa = JSON.stringify({ [branchId]: { ...rapor, at: now.toISOString() } });
    await db.execute(sql`
      insert into integration_state (key, value) values (${ANAHTAR_UYUMU_KEY}, jsonb_build_object('kasalar', ${kasa}::jsonb))
      on conflict (key) do update
        set value = integration_state.value || jsonb_build_object('kasalar', coalesce(integration_state.value->'kasalar', '{}'::jsonb) || ${kasa}::jsonb),
            updated_at = now()`);
    if (!degisti || !otomatikSinamaGerekli(state, rapor.guncel, now)) return { yazildi: true, sinama: null };
    return { yazildi: true, sinama: await sinaAnahtarlar(db, { tetik: "kasa", now, env: opts.env, fetchImpl: opts.fetchImpl }) };
  } catch (e) {
    console.error("[asilpos anahtar] kasa raporu yazılamadı:", e instanceof Error ? e.message : e);
    return { yazildi: false, sinama: null };
  }
}

/** Bir ucu panelin anahtarıyla imzalı GET ile sınar; gövde okunmaz. Ağ hatası ve zaman aşımı "hata" */
export async function sinaHedef(h: { hedef: Hedef; url: string; secret: string }, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<HedefSonucu> {
  try {
    const url = sinamaAdresi(h.hedef, h.url);
    const req = signedRequest(h.secret, "GET", url, "", now.getTime());
    const res = await fetchImpl(url, { ...req, signal: AbortSignal.timeout(SINAMA_ZAMAN_ASIMI_MS), cache: "no-store" });
    await res.body?.cancel().catch(() => undefined);
    return { durum: yanitDurumu(res.status), http: res.status };
  } catch {
    return { durum: "hata", http: null };
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
  const [onceki, sonuclar] = await Promise.all([
    readAnahtarUyumu(db).then((st) => st.sinama),
    Promise.all(hedefler.map(async (h) => [h.hedef, await sinaHedef(h, opts.fetchImpl, now)] as const)),
  ]);
  // Bu kez sınanamayan uçta (ağ) önceki sorun kalır (sonucBirlestir)
  const sinama = sonucBirlestir(onceki, { at: now.toISOString(), surum, tetik: opts.tetik, sonuc: Object.fromEntries(sonuclar) });
  // Üst düzey alan birleştirilerek: kasaların raporu kalır
  const patch = JSON.stringify({ sinama });
  await db.execute(sql`
    insert into integration_state (key, value) values (${ANAHTAR_UYUMU_KEY}, ${patch}::jsonb)
    on conflict (key) do update set value = integration_state.value || ${patch}::jsonb, updated_at = now()`);
  // Yalnız uç, durum ve HTTP kodu (anahtar ve sürüm yok)
  console.info(`[asilpos anahtar] tetik=${opts.tetik} ${sonuclar.map(([h, r]) => `${h}=${r.durum}${r.http ? `(${r.http})` : ""}`).join(" ")}`);
  return sinama;
}

/** Ayarlar › AsilPOS kartının anahtar bölümü */
export interface AnahtarUyumuKarti {
  /** Panelin dağıttığı uçlar ve bu değerlerle son sınamanın sonucu (yoksa null: henüz sınanmadı) */
  hedefler: { hedef: Hedef; ad: string; sonuc: HedefSonucu | null }[];
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
    hedefler: hedefler.map(({ hedef }) => ({ hedef, ad: HEDEF_ADI[hedef], sonuc: sinama?.sonuc[hedef] ?? null })),
    sinama,
    eskiDegerlerle: state.sinama !== null && sinama === null,
    kasalar: kasalarinDurumu(state, surum, now),
    uyarilar: anahtarUyarilari({ state, surum, now, env }),
  };
}
