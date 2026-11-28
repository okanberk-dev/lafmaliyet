import "server-only";

import { anaAdminEmail } from "@/lib/asil-yonetici";
import { ilkPersonelDurumlari } from "@/server/asilpos/ilk-personel";
import { loadKasaDurumlari, loadSerbestBilgileri } from "@/server/asilpos/kasa-durumu";
import { listBranches } from "@/server/branches";
import { getDb, schema as s, type DB } from "@/server/db";

/**
 * Şube ekleme ekranının verisi (docs/SUBE.md › Şube ekleme): Yönetim konsolu › "Şubeler ve kasalar" (/yonetim; bileşen
 * src/components/sube-ekleme). Şubeler, kayıtlı e-postaları, fiziksel şubelerin kasa durumu, ilk personel durumu
 * (PIN'siz) ve kurulu kasaların serbest bırakma bilgisi. Yetki denetimi burada değil: çağıran sayfa requireYonetim ister
 */
export async function subeEklemeVerisi(db: DB = getDb()) {
  const [rows, emailRows] = await Promise.all([listBranches(db), db.select({ id: s.branches.id, email: s.branches.email }).from(s.branches)]);
  const fiziksel = rows.filter((b) => b.kind === "fiziksel").map((b) => b.id);
  const durum = await loadKasaDurumlari(fiziksel, db);
  const [personel, serbest] = await Promise.all([
    ilkPersonelDurumlari(fiziksel, db),
    loadSerbestBilgileri(
      fiziksel.filter((id) => durum[id]?.durum === "kurulu"),
      db,
    ),
  ]);
  return {
    rows,
    emails: Object.fromEntries(emailRows.map((r) => [r.id, r.email])) as Record<string, string | null>,
    durum,
    personel,
    serbest,
    girisHesabi: anaAdminEmail(),
  };
}
