import { checkModposDaysRequest, type ModposDaysCheck } from "./modpos-gunler";

/*
 * `GET /api/panel/pos/personel` isteğinin denetimi (LM-4b; docs/ASILPOS.md › Personel bağlantısı). Ayrı dosyada: imza
 * modülü node:crypto okur, src/lib/asilpos/personel.ts ise hesap motorunun (src/lib/calc/engine.ts, "use client"
 * bileşenleri içe aktarır) ağacındadır; denetim orada olsaydı node:crypto istemci paketlerine girerdi.
 */

/**
 * İsteğin denetimi (ModPOS dönemi ucuyla aynı kural ve sıra: src/lib/asilpos/modpos-gunler.ts): anahtar (503), imza (401;
 * sorgu imzanın içinde), şube yoksa 400 `{ error: "invalid", field: "sube" }`, anahtarın şubesi (`expected`; çok şube,
 * imzanın tuttuğu anahtarın şubesi) değilse 409 `{ error: "wrong_branch", sube, expected }`
 */
export function checkPosStaffRequest(input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: number; expected: string | null }): ModposDaysCheck {
  return checkModposDaysRequest(input);
}
