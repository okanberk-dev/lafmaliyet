import { LATE_REPORT_DAYS } from "./cash-report";
import { addDays } from "./reminders";

/**
 * Kasa raporu formunun bu cihazdaki taslağı (denetim 25 Kasım 2026, bulgu 87; docs/KASA-RAPORU.md › Ekranın düzeni ›
 * Taslak ve ayrılma uyarısı). Personel gün sonunda 8-12 tutar yazıp Z fişini çekerken telefon kamera yüzünden arka
 * plandaki sekmeyi yeniden yükleyebilir, alt menüye ya da zile yanlışlıkla dokunabilir: yazılanlar React durumunda
 * kayboluyordu. Stok sayımının
 * deseni (src/app/panel/sayim/logic.ts countDraftKey): değerler, kasayı sayan ve formda yüklenen fotoğrafların kimlikleri
 * şube ve gün anahtarıyla localStorage'a yazılır, form açılınca "Geri yükle" bandı çıkar. Saf: tests/kasa-taslak.test.ts
 */

const PREFIX = "laf:kasa-taslak:";

/** Taslağın anahtarı: şube ve iş günü (Tuzla'nın taslağı Marina'nın formunda, dünkü bugünkünde önerilmez) */
export function cashDraftKey(branch: string, date: string): string {
  return `${PREFIX}${branch}:${date}`;
}

/** Taslaktaki fotoğraf (formun yüklediği, rapora henüz bağlanmamış) */
export interface CashDraftPhoto {
  id: number;
  kind: "kasa-z" | "kasa-pos" | "kasa-okc";
  createdAt: string;
  byName: string;
}

export interface CashDraft {
  /** Formun metin kutuları (alan → yazılan) */
  values: Record<string, string>;
  /** Kasayı sayan (kullanıcı kimliği) */
  counter: number | null;
  photos: CashDraftPhoto[];
  /** Taslağın dayandığı rapor sürümü (yeni raporda 0): arada başkası gönderdiyse taslak önerilmez */
  revision: number;
  branch: string;
  date: string;
  /** Yazanın adı (ortak telefonda sonraki kişi kimin yazdığını görsün) */
  by: string | null;
  /** Son yazılış (ISO) */
  at: string;
}

export function cashDraftJson(d: CashDraft): string {
  return JSON.stringify({ v: d.values, c: d.counter, p: d.photos, r: d.revision, s: d.branch, d: d.date, by: d.by, t: d.at });
}

const PHOTO_KINDS = new Set(["kasa-z", "kasa-pos", "kasa-okc"]);

/**
 * Taslağı okur. Başka şubenin, başka günün ya da başka sürümün taslağı (arada rapor gönderildi ya da düzeltildi) ve
 * okunamayan metin null: yanlış kasaya ya da eski rakamın üstüne geri yüklenmez. `keys`: formun bildiği alanlar (bilinmeyen
 * alan atılır)
 */
export function parseCashDraft(json: string | null, expect: { branch: string; date: string; revision: number; keys: readonly string[] }): CashDraft | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!o || typeof o !== "object") return null;
    if (o.s !== expect.branch || o.d !== expect.date || o.r !== expect.revision) return null;
    const known = new Set(expect.keys);
    const raw = o.v && typeof o.v === "object" ? (o.v as Record<string, unknown>) : {};
    const values = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => known.has(e[0]) && typeof e[1] === "string"));
    const photos = Array.isArray(o.p)
      ? o.p.filter(
          (p): p is CashDraftPhoto =>
            !!p && typeof p === "object" && Number.isInteger((p as CashDraftPhoto).id) && PHOTO_KINDS.has((p as CashDraftPhoto).kind) && typeof (p as CashDraftPhoto).createdAt === "string",
        )
      : [];
    if (!Object.keys(values).length && !photos.length) return null;
    return {
      values,
      counter: Number.isInteger(o.c) ? (o.c as number) : null,
      photos: photos.map((p) => ({ id: p.id, kind: p.kind, createdAt: p.createdAt, byName: typeof p.byName === "string" ? p.byName : "" })),
      revision: expect.revision,
      branch: expect.branch,
      date: expect.date,
      by: typeof o.by === "string" ? o.by : null,
      at: typeof o.t === "string" ? o.t : "",
    };
  } catch {
    return null;
  }
}

/**
 * Artık açılamayacak günlerin taslakları (temizlik; form açılınca): personelin geç rapor penceresinden (14 gün) eski
 * günün taslağı silinir. Anahtar biçimi bozuk olan kasa taslağı da
 */
export function staleCashDraftKeys(keys: readonly string[], today: string): string[] {
  const oldest = addDays(today, -LATE_REPORT_DAYS);
  return keys.filter((k) => {
    if (!k.startsWith(PREFIX)) return false;
    const date = k.slice(k.lastIndexOf(":") + 1);
    return !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < oldest;
  });
}

/**
 * "Göndermeden geç" taslağı siler mi: başka güne ya da şubeye geçilince evet (o günün formu artık açık değil; gün ve
 * şube değişince temizlenir), başka bir sayfaya (Zayi & ikram, Bugün…) gidilince hayır: dönünce geri yüklenir. Şube
 * seçicisinin adresi `?sube=` taşır; Kasa sayfasının günü `?gun=` (yoksa bugün)
 */
export function leaveDropsDraft(href: string, date: string, today: string): boolean {
  let url: URL;
  try {
    url = new URL(href, "https://panel.invalid");
  } catch {
    return false;
  }
  if (url.searchParams.has("sube")) return true;
  if (url.pathname !== "/panel/kasa") return false;
  return (url.searchParams.get("gun") ?? today) !== date;
}

/**
 * Taslaktan geri yüklenecek fotoğraflar (inceleme, 25 Kasım 2026): ortak telefonda B, A'nın bıraktığı taslağı geri
 * yükleyince A'nın yüklediği fotoğraflar forma gelmez; sunucu personelin yalnız kendi yüklediğini bağlar, gönderim
 * "Fotoğraf bulunamadı" diye düşerdi. Yönetici her fotoğrafı bağlar: hepsi gelir. `dropped`: gelmeyenlerin sayısı (bant ve
 * bildirim söyler)
 */
export function restorableDraftPhotos(photos: readonly CashDraftPhoto[], o: { admin: boolean; me: string }): { kept: CashDraftPhoto[]; dropped: number } {
  if (o.admin) return { kept: [...photos], dropped: 0 };
  const kept = photos.filter((p) => p.byName === o.me);
  return { kept, dropped: photos.length - kept.length };
}

/** Taslağın geri yüklenmeyen fotoğraflarının cümlesi (sonda nokta) */
export function droppedPhotosText(n: number): string {
  return `Başkasının yüklediği ${n} fotoğraf geri yüklenmez; yeniden çekin.`;
}

/**
 * Gönderilmemiş rapordan çıkış penceresinin metni, hedefe göre (inceleme, 25 Kasım 2026): başka güne ya da şubeye
 * geçilince taslak silinir (yıkıcı, kırmızı), başka sayfaya gidilince bu cihazda kalır (nötr)
 */
export function leaveDialogText(drops: boolean): { description: string; confirmLabel: string; tone: "danger" | "primary" } {
  return drops
    ? { description: "Yazdığınız rakamlar henüz gönderilmedi. Başka güne ya da şubeye geçerseniz bu taslak silinir.", confirmLabel: "Taslağı silip geç", tone: "danger" }
    : { description: "Yazdığınız rakamlar henüz gönderilmedi. Bu cihazda kalır; sayfaya dönünce geri yükleyebilirsiniz.", confirmLabel: "Sayfadan çık", tone: "primary" };
}
