import "server-only";

import { FOY_MAX_BYTES, parseKasaFoyu, type FoyHata, type KasaFoyu } from "@/lib/modpos/foy";
import {
  foyUrl,
  isKeyError,
  modposErrorText,
  modposKeyFrom,
  modposKeyProblem,
  modposUrlFrom,
  MODPOS_DAILY_QUOTA,
  MODPOS_TIMEOUT_MS,
  quotaFromHeaders,
  type ModposQuota,
} from "@/lib/modpos/request";
import { todayTR } from "@/lib/reminders";

/**
 * ModPOS (Gafdigi) Kasa Föyü API'sinin istemcisi (docs/MODPOS-API.md; belge docs/modpos-kasa-foyu-api.md). Tek istek =
 * tek kasa günü; başarılı istek günde 2 hakkın birini harcar (400 / 401 / 403 harcamaz, 500'de hak geri verilir). Bu
 * yüzden **yeniden denemez**: 429'da da 5xx'te de sonuç çağırana döner, sonraki çalışma yeniden dener.
 *
 * Anahtar `x-api-key` başlığında gider, günlüğe ve hata metnine yazılmaz; yanıtın gövdesi günlüğe yazılmaz.
 */

export type FoyFetch =
  | { status: "ok"; foy: KasaFoyu; quota: ModposQuota | null }
  | { status: "off"; problem: "missing" | "format" }
  | { status: "kota"; quota: ModposQuota; text: string }
  | { status: "error"; kod: string; http: number; text: string; keyError: boolean; quota: ModposQuota | null };

type Env = Record<string, string | undefined>;

export interface FetchOptions {
  now?: Date;
  /** İsteğin süresi (en çok belgenin önerdiği 60 sn) */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: Env;
}

/** Bağlantı kurulu mu (anahtar var ve biçimi doğru) */
export function isModposConfigured(env: Env = process.env): boolean {
  return modposKeyProblem(env) === null;
}

/** Bir kasa gününün föyü. Hata fırlatmaz: her sonuç (ağ, zaman aşımı, bozuk yanıt dahil) birleşik türdür */
export async function fetchKasaFoyu(day: string, o: FetchOptions = {}): Promise<FoyFetch> {
  const env = o.env ?? process.env;
  const problem = modposKeyProblem(env);
  if (problem) return { status: "off", problem };
  const key = modposKeyFrom(env)!;
  const now = o.now ?? new Date();
  const timeoutMs = Math.min(o.timeoutMs ?? MODPOS_TIMEOUT_MS, MODPOS_TIMEOUT_MS);
  const doFetch = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(foyUrl(modposUrlFrom(env), day), {
      method: "GET",
      headers: { "x-api-key": key, accept: "application/xml" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      return { status: "error", kod: "ZAMAN_ASIMI", http: 0, text: `ModPOS ${Math.round(timeoutMs / 1000)} saniyede yanıt vermedi: sonra yeniden denenecek`, keyError: false, quota: null };
    }
    return { status: "error", kod: "BAGLANTI", http: 0, text: "ModPOS'a bağlanılamadı: sonra yeniden denenecek", keyError: false, quota: null };
  }
  const quota = quotaFromHeaders((n) => res.headers.get(n), now);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FOY_MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    return { status: "error", kod: "BUYUK", http: res.status, text: "ModPOS'un yanıtı beklenenden büyük; okunmadı", keyError: false, quota };
  }
  let body: string;
  try {
    body = await res.text();
  } catch {
    return { status: "error", kod: "BAGLANTI", http: res.status, text: "ModPOS'un yanıtı yarıda kesildi: sonra yeniden denenecek", keyError: false, quota };
  }
  const parsed = parseKasaFoyu(body, res.ok ? day : undefined);
  if (res.ok && parsed.ok) {
    return { status: "ok", foy: parsed.foy, quota: quota ?? quotaFromBody(parsed.foy, now) };
  }
  const raw: FoyHata | null = !parsed.ok && "hata" in parsed ? parsed.hata : null;
  if (res.ok && !raw) {
    const field = !parsed.ok && "bozuk" in parsed ? parsed.bozuk : "govde";
    return { status: "error", kod: "BOZUK", http: res.status, text: `ModPOS'un yanıtı okunamadı (${field}): sonra yeniden denenecek`, keyError: false, quota };
  }
  // Tanınmayan kodda metin servisin kodunu ve mesajını taşır: servis anahtarı geri yazsa da metne (durum satırına,
  // yedeğe) geçmez. Metin kısaltılmadan önce temizlenir (yarım anahtar kalmasın)
  const hata: FoyHata | null = raw ? { ...raw, kod: redactKey(raw.kod, key), mesaj: redactKey(raw.mesaj, key) } : null;
  const text = modposErrorText(res.status, hata, now);
  if (hata?.kod === "KOTA_DOLDU" || (res.status === 429 && !hata)) {
    const hak = hata?.gunlukHak ?? quota?.hak ?? MODPOS_DAILY_QUOTA;
    return { status: "kota", quota: { day: todayTR(now), hak, kalan: 0, yenilenme: hata?.yenilenme ?? quota?.yenilenme ?? null, at: now.toISOString() }, text };
  }
  const kod = hata?.kod ?? `HTTP_${res.status}`;
  return { status: "error", kod, http: res.status, text, keyError: isKeyError(kod), quota };
}

/** Metindeki anahtar "[anahtar]" olur (büyük / küçük harf fark etmeksizin: servisin kodu büyük harfe çevrilir) */
function redactKey(text: string, key: string): string {
  return text.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[anahtar]");
}

/** Başlık yoksa föyün `<kota>`'sı */
function quotaFromBody(foy: KasaFoyu, now: Date): ModposQuota | null {
  const k = foy.kota;
  if (!k || k.gunlukHak === null || k.kalan === null) return null;
  return { day: todayTR(now), hak: k.gunlukHak, kalan: k.kalan, yenilenme: k.yenilenme, at: now.toISOString() };
}
