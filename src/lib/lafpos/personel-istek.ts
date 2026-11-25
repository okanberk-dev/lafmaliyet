import { checkModposDaysRequest, type ModposDaysCheck } from "./modpos-gunler";

/*
 * `GET /api/panel/pos/personel` isteğinin denetimi (LM-4b; docs/LAFPOS.md › Personel bağlantısı). Ayrı dosyada: imza
 * modülü node:crypto okur, src/lib/lafpos/personel.ts ise hesap motorunun (src/lib/calc/engine.ts, "use client"
 * bileşenleri içe aktarır) ağacındadır; denetim orada olsaydı node:crypto istemci paketlerine girerdi.
 */

/**
 * İsteğin denetimi (ModPOS dönemi ucuyla aynı kural ve sıra: src/lib/lafpos/modpos-gunler.ts): anahtar (503), imza (401;
 * sorgu imzanın içinde), şube yoksa 400 `{ error: "invalid", field: "sube" }`, LafPOS'un şubesi (`expected`; sunucu
 * kütükten okur, verilmezse LAFPOS_BRANCH_ID) değilse 409 `{ error: "wrong_branch", sube, expected }`
 */
export function checkPosStaffRequest(input: { secret: string | null; url: URL; timestamp: string | null; signature: string | null; now?: number; expected?: string }): ModposDaysCheck {
  return checkModposDaysRequest(input);
}
