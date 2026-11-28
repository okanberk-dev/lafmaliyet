import "server-only";

import { constants, createPublicKey, publicEncrypt, type KeyObject } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import {
  ILK_PERSONEL_ROLLERI,
  ilkPersonelDurumu,
  ilkPersonelKaydi,
  ilkPersonelTemizle,
  type IlkPersonel,
  type IlkPersonelDurumu,
  type IlkPersonelKaydi,
  type IlkPersonelRolu,
} from "@/lib/asilpos/kasa-acilis";
import { getDb, schema as s, type DB } from "@/server/db";
import { open, seal } from "@/server/secret-box";

/*
 * İlk personel (docs/ASILPOS.md › Kasa açılışı › İlk personel): asıl yönetici şube eklerken ya da Şube ekleme'deki
 * şube satırından patron, müdür ve baristanın adını ve PIN'ini girer. Kayıt integration_state'te, PIN'ler mühürlü
 * (src/server/secret-box.ts, amaç "asilpos-ilk-personel"); düz PIN hiçbir sütunda, işlem geçmişinde ya da forma dönen
 * yanıtta olmaz, yedeğe girmez (src/lib/backup/format.ts › EXCLUDED_STATE_PREFIXES). Kasa açık anahtarını gönderirse
 * (bağlama ya da kurulum kodu yanıtı) her PIN kasanın RSA-OAEP açık anahtarıyla şifrelenip gider; kasa aldığını şube
 * anahtarıyla imzalı onaylayınca mühür silinir ("teslim edildi" izi kalır). Onay gelmezse gönderimden 24 saat sonra,
 * hiç gönderilmeyen kayıt 30 gün sonra silinir: okuma anında (ayrı zamanlayıcı yok).
 */

/** integration_state anahtarının öneki: `asilpos.ilk-personel:<şube>` (yedek dışı) */
export const ILK_PERSONEL_PREFIX = "asilpos.ilk-personel:";
/** Mühür amacı (src/server/secret-box.ts SealPurpose) */
export const ILK_PERSONEL_AMACI = "asilpos-ilk-personel";

type Db = Pick<DB, "select" | "insert" | "update" | "delete">;

const keyOf = (id: string) => `${ILK_PERSONEL_PREFIX}${id}`;

async function put(db: Db, id: string, value: IlkPersonelKaydi): Promise<void> {
  await db
    .insert(s.integrationState)
    .values({ key: keyOf(id), value })
    .onConflictDoUpdate({ target: s.integrationState.key, set: { value, updatedAt: new Date() } });
}

async function drop(db: Db, id: string): Promise<void> {
  await db.delete(s.integrationState).where(eq(s.integrationState.key, keyOf(id)));
}

/** Şubelerin kayıtları, tembel temizlikten geçmiş (süresi dolan mühür silinir, hiç gönderilmeyen eski kayıt silinir) */
export async function readIlkPersonel(ids: readonly string[], db: Db = getDb(), now: Date = new Date()): Promise<Map<string, IlkPersonelKaydi>> {
  const out = new Map<string, IlkPersonelKaydi>();
  if (!ids.length) return out;
  const rows = await db.select({ key: s.integrationState.key, value: s.integrationState.value }).from(s.integrationState).where(inArray(s.integrationState.key, ids.map(keyOf)));
  for (const r of rows) {
    const id = r.key.slice(ILK_PERSONEL_PREFIX.length);
    const k = ilkPersonelKaydi(r.value);
    if (!k) {
      await drop(db, id);
      continue;
    }
    const t = ilkPersonelTemizle(k, now);
    if (t.degisti) {
      if (t.kayit) await put(db, id, t.kayit);
      else await drop(db, id);
    }
    if (t.kayit) out.set(id, t.kayit);
  }
  return out;
}

/** Ekranın durumu (PIN'siz): "yok", "ayarli", "gonderildi", "teslim" */
export async function ilkPersonelDurumlari(ids: readonly string[], db: Db = getDb(), now: Date = new Date()): Promise<Record<string, IlkPersonelDurumu>> {
  const kayitlar = await readIlkPersonel(ids, db, now);
  return Object.fromEntries(ids.map((id) => [id, ilkPersonelDurumu(kayitlar.get(id) ?? null)]));
}

/** Kaydeder (eskisinin yerine geçer); liste boşsa kaydı siler. Liste önceden denetlenmiş olmalı (ilkPersonelHatasi) */
export async function saveIlkPersonel(db: Db, id: string, list: readonly IlkPersonel[], by: string, now: Date = new Date()): Promise<void> {
  if (!list.length) return drop(db, id);
  const sirali = ILK_PERSONEL_ROLLERI.flatMap((r) => list.filter((p) => p.rol === r.rol)).map((p) => ({ rol: p.rol, ad: p.ad, pin: p.pin }));
  await put(db, id, { v: 1, muhur: seal(JSON.stringify(sirali), ILK_PERSONEL_AMACI), at: now.toISOString(), by, roller: sirali.map((p) => p.rol) });
}

/** Kasanın açık anahtarı: SPKI DER (base64 ya da base64url), RSA ve en az 2048 bit; değilse null */
export function kasaAcikAnahtari(b64: string): KeyObject | null {
  try {
    const key = createPublicKey({ key: Buffer.from(b64, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return null;
    return key;
  } catch {
    return null;
  }
}

/**
 * PIN'i kasanın açık anahtarıyla şifreler: RSA-OAEP, SHA-256 (MGF1 de SHA-256), düz metin PIN'in UTF-8 baytları,
 * sonuç base64. Kasa AsilPOS Uzaktan'ın PIN'ini çözdüğü gibi çözer (server/sync/kontrol.ts pinCoz)
 */
export function pinSifrele(pin: string, key: KeyObject): string {
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(pin, "utf8")).toString("base64");
}

export type KasaPersoneli = { rol: IlkPersonelRolu; ad: string; pin: string }[];

/**
 * Kasaya gidecek ilk personel: kayıt mühürlüyse ve kasa geçerli bir açık anahtar gönderdiyse her PIN şifrelenir;
 * kayda ilk gönderim anı yazılır (onay gelmezse 24 saat sonra silinir). Yoksa null (yanıtta `personel` alanı olmaz)
 */
export async function personelForKasa(db: Db, id: string, acikAnahtar: string | null, now: Date = new Date()): Promise<KasaPersoneli | null> {
  if (!acikAnahtar) return null;
  const key = kasaAcikAnahtari(acikAnahtar);
  if (!key) return null;
  const kayit = (await readIlkPersonel([id], db, now)).get(id);
  if (!kayit?.muhur) return null;
  const raw = open(kayit.muhur, ILK_PERSONEL_AMACI);
  if (!raw) return null;
  let list: IlkPersonel[];
  try {
    list = JSON.parse(raw) as IlkPersonel[];
  } catch {
    return null;
  }
  const out = list.filter((p) => ILK_PERSONEL_ROLLERI.some((r) => r.rol === p.rol)).map((p) => ({ rol: p.rol, ad: p.ad, pin: pinSifrele(p.pin, key) }));
  if (!kayit.gonderildi) await put(db, id, { ...kayit, gonderildi: now.toISOString() });
  return out.length ? out : null;
}

/**
 * Kasa aldığını onayladı: mühür silinir, PIN'siz iz kalır (`teslim`). Yalnız gönderilmiş kayıtta; döner: silindi mi
 */
export async function ilkPersonelTeslim(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const kayit = (await readIlkPersonel([id], db, now)).get(id);
  if (!kayit?.muhur || !kayit.gonderildi) return false;
  const iz: IlkPersonelKaydi = { ...kayit, teslim: now.toISOString() };
  delete iz.muhur;
  await put(db, id, iz);
  return true;
}
