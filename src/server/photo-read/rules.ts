import "server-only";

import { and, asc, eq, gte, sql } from "drizzle-orm";

import { businessDate, staffCanReport, staffDayEditable, staffLateDay } from "@/lib/cash-report";
import { CashOutRequestPayload } from "@/lib/cash-out-requests";
import { staffExpenseLocked } from "@/lib/cash-outs";
import { KEEP_DAYS, uploadRule, type PhotoKind } from "@/lib/photo-rules";
import type { CurrentUser } from "@/server/auth/dal";
import { can, opsLevel, ownerRowAmountOnly } from "@/lib/roles";
import { currentTillBranch, staffBranchRefusal } from "@/server/branch-scope";
import { isClosedDay } from "@/server/closed-days";
import { getDb, schema as s } from "@/server/db";
import { lafposPhotoDayOpen } from "@/server/lafpos/foto";
import { reviewBranchRefusal } from "@/server/staff-requests/branch";
import type { PhotoKindRules } from "@/server/storage/photo-access";
import type { PhotoRow } from "@/server/storage/photos";

/*
 * Kasa ve fiş fotoğraflarının personel kuralları. Personel yalnız hâlâ düzenleyebildiği günlerin fotoğraflarını görür
 * ve o günlere fotoğraf ve kasadan çıkan satırı ekler; kasa raporunun kuralıyla aynı (staffDayEditable): bugün ve dün,
 * ama günün raporu varken ertesi günün raporu da girildiyse o gün kapanır. Daha eskisini yalnız yönetici; geç kasa
 * raporu (raporu olmayan, son 14 günden biri) için personel o güne Z ve POS fotoğrafı, kasadan çıkan isteği için son 7
 * güne fiş ekler (bağlanmadan bekler; kendi yüklediğini görür). Şubesine kilitli personel yalnız kendi şubesinin kasa ve
 * fiş fotoğrafını görür (staffBranchRefusal; günün açıklığı başka şubenin fotoğrafını açmaz, 21 Kasım denetimi #14).
 * Onay bekleyen isteğin tuttuğu fotoğrafı isteğe karar veren görür (heldForReview; müdür yalnız şubesininkini).
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Personel bu günün kasasına (rapor, kasadan çıkanlar, fotoğraflar) hâlâ dokunabilir mi; bir sorgu. Kasa şube başınadır:
 * verilen şubenin (yoksa kasanın şubesinin: seçili fiziksel şube, "Tümü"de Tuzla) raporlarına bakılır. Önceden başka
 * şubenin ertesi gün raporu bu şubenin gününü personele kapatıyordu.
 */
export async function staffDayOpen(day: string, db: Db | Tx = getDb(), now: Date = new Date(), branchId?: string): Promise<boolean> {
  if (!staffCanReport(day, now)) return false;
  const sube = branchId ?? (await currentTillBranch());
  // Bu gün ve sonrası en çok iki rapor: günün raporu var mı, ondan sonra bir rapor var mı
  const rows = await db
    .select({ date: s.cashReports.date })
    .from(s.cashReports)
    .where(and(gte(s.cashReports.date, day), eq(s.cashReports.branchId, sube)))
    .orderBy(asc(s.cashReports.date))
    .limit(2);
  return staffDayEditable(day, { hasReport: rows[0]?.date === day, laterReport: rows.some((r) => r.date > day) }, now);
}

export const cashPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS["kasa-z"],
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb()
      .select({ date: s.cashReports.date, branchId: s.cashReports.branchId })
      .from(s.cashReportPhotos)
      .innerJoin(s.cashReports, eq(s.cashReports.id, s.cashReportPhotos.reportId))
      .where(eq(s.cashReportPhotos.photoId, photo.id))
      .limit(1);
    // Geç kasa raporunun tuttuğu Z ve POS fotoğrafı (rapor satırı onayda yazılır): karar veren görür
    if (!row) return heldForReview(me, photo, "kasa-gec");
    // Rakam gören rol (müdür şubesinin, muhasebeci bütün şubelerin) raporun fotoğrafını her gün görür; kilit oturumdan
    if (can(me.role, "kasa.rakam")) return Boolean(row && !(await staffBranchRefusal(me, row.branchId)));
    return Boolean(row && !(await staffBranchRefusal(me, row.branchId)) && (await staffDayOpen(row.date, undefined, undefined, row.branchId)));
  },
};

/** Yazarkasa Z'si: personel kuralı kasanınki, saklama kendi süresi (400 gün, docs/planlar/okc-z.md D12) */
export const okcPhotoRules: PhotoKindRules = { ...cashPhotoRules, keepDays: KEEP_DAYS["kasa-okc"] };

/**
 * Fiş fotoğrafı: kasadan çıkan satırının günü açıksa; yalnız harcamaya bağlı fiş yöneticinin. Müdür (rakamları görür,
 * bütün kategorileri görmez; ownerRowAmountOnly) şubesinin her gününün fişini görür, yöneticinin kategorisindeki (maaş,
 * kira, avans) satırınkini görmez: o satırın yalnız tutarı ona gider (docs/ROLLER.md › Kararlar)
 */
export const receiptPhotoRules: PhotoKindRules = {
  keepDays: KEEP_DAYS.fis,
  async canView(me, photo) {
    if (me.role === "admin") return true;
    const [row] = await getDb()
      .select({
        date: s.cashOuts.date,
        branchId: s.cashOuts.branchId,
        // Bağlı harcama kaydının kategorisi (kayıt yoksa null)
        section: s.expenseCategories.section,
        panelGroup: s.expenseCategories.panelGroup,
        active: s.expenseCategories.active,
      })
      .from(s.cashOuts)
      .leftJoin(s.expenseEntries, eq(s.expenseEntries.cashOutId, s.cashOuts.id))
      .leftJoin(s.expenseCategories, eq(s.expenseCategories.id, s.expenseEntries.categoryId))
      .where(eq(s.cashOuts.photoId, photo.id))
      .limit(1);
    // Kasadan çıkan ekleme isteğinin tuttuğu fiş (satır onayda yazılır): karar veren görür
    if (!row) return heldForReview(me, photo, "kasa-cikan");
    const category = row && row.section !== null && row.panelGroup !== null && row.active !== null ? { section: row.section, panelGroup: row.panelGroup, active: row.active } : null;
    if (ownerRowAmountOnly(me.role) && staffExpenseLocked(category)) return false;
    if (can(me.role, "kasa.rakam")) return Boolean(row && !(await staffBranchRefusal(me, row.branchId)));
    return Boolean(row && !(await staffBranchRefusal(me, row.branchId)) && (await staffDayOpen(row.date, undefined, undefined, row.branchId)));
  },
};

/**
 * Onay bekleyen isteğin tuttuğu fotoğraf (src/server/storage/photos.ts › holdPhoto: bağlanmamış, yükleyeni personel;
 * raporun ya da kasadan çıkanın satırı onayda yazılır): geç kasa raporunun Z, POS ve yazarkasa Z'si (`kasa-gec`) ve
 * kasadan çıkan ekleme isteğinin fişi (`kasa-cikan`). Onaylar'ın kartı bu fotoğrafları gösterir, onay onları bağlar:
 * isteğe karar veren görür. Yönetici buraya gelmeden görür (photoViewDecision); müdür yalnız karar verebildiği isteğin
 * fotoğrafını (`reviewBranchRefusal`: şubesinin isteği; şubesi bilinmeyen istek kapalı). Önerilen kategori yöneticinin
 * (personelin seçemediği ya da kapatılmış) ise fiş müdüre gitmez (bağlı fişin kuralı). Muhasebeci ve personel karar
 * vermez (`onay` yok): personel yalnız kendi yüklediğini görür (photoViewDecision). İstek karara bağlanınca kural
 * kapanır: onayda fotoğraf kayda bağlanır (türün kuralı), retde bırakılır.
 */
async function heldForReview(me: CurrentUser, photo: PhotoRow, kind: "kasa-gec" | "kasa-cikan"): Promise<boolean> {
  if (!can(me.role, "onay") || photo.linkedAt !== null) return false;
  const db = getDb();
  const r = s.staffRequests;
  const rows = await db
    .select({ id: r.id, payload: r.payload })
    .from(r)
    .where(and(eq(r.kind, kind), eq(r.status, "pending"), sql`${r.photoIds} @> array[${photo.id}]::integer[]`));
  for (const row of rows) {
    if (await reviewBranchRefusal(db, me, row.id)) continue;
    if (kind === "kasa-cikan" && ownerRowAmountOnly(me.role)) {
      const p = CashOutRequestPayload.safeParse(row.payload);
      if (!p.success) continue;
      const categoryId = p.data.line?.categoryId ?? null;
      if (categoryId !== null) {
        const [cat] = await db
          .select({ section: s.expenseCategories.section, panelGroup: s.expenseCategories.panelGroup, active: s.expenseCategories.active })
          .from(s.expenseCategories)
          .where(eq(s.expenseCategories.id, categoryId))
          .limit(1);
        if (staffExpenseLocked(cat)) continue;
      }
    }
    return true;
  }
  return false;
}

/**
 * Personel bu güne geç kasa raporu (yöneticinin onayıyla) girebilir mi: geç rapor penceresinde (dünden eski, son 14
 * takvim günü; staffLateDay), ilk raporun gününden sonra, o gün raporu yok ve gün kapalı işaretli değil. Fotoğraf
 * ekleme ve geç rapor isteği aynı kurala bakar (docs/KASA-RAPORU.md › Geç rapor).
 */
export async function staffLateDayOpen(day: string, db: Db | Tx = getDb(), branchId?: string): Promise<boolean> {
  if (!staffLateDay(day)) return false;
  // Şubenin kendi kasası: başka şubenin raporu bu günü "raporlu" yapmaz, ilk rapor da şubenin ilk raporu
  const till = branchId ?? (await currentTillBranch());
  const sube = eq(s.cashReports.branchId, till);
  const [[first], [same]] = await Promise.all([
    db.select({ date: s.cashReports.date }).from(s.cashReports).where(sube).orderBy(asc(s.cashReports.date)).limit(1),
    db.select({ date: s.cashReports.date }).from(s.cashReports).where(and(eq(s.cashReports.date, day), sube)).limit(1),
  ]);
  if (!first || first.date >= day || same) return false;
  // Kapalı gün de şubenin (ve işletme genelinin): öteki şubenin kapalı günü bu şubenin geç raporunu kapatmaz
  return !(await isClosedDay(day, db, till));
}

/**
 * Fotoğraf ekleme kuralı (POST /api/foto ve yeniden okuma; src/lib/photo-rules.ts uploadRule): gün gerekli ve ileri bir
 * gün değil; personel Z ve POS fotoğrafını açık güne ya da geç rapor gününe, fişi son 7 güne (kapanmış ya da eski günde
 * kasadan çıkan isteğine; fiş bağlanmadan bekler)
 */
export async function canUploadPhoto(me: CurrentUser, kind: PhotoKind, day: string | null): Promise<boolean> {
  if (kind === "kontrol") return false; // kontrol listelerinin kendi yolu var
  // Muhasebeci salt okur: fotoğraf yükleyemez (docs/ROLLER.md)
  if (!can(me.role, "kayit.yaz")) return false;
  const rule = uploadRule(opsLevel(me.role), kind, day, businessDate());
  if (rule === "no" || !day) return false;
  if (rule === "yes") return true;
  if (await staffDayOpen(day)) return true;
  if (rule === "open-or-late" && (await staffLateDayOpen(day))) return true;
  // Gün sonu tam (24 Kasım 2026): LafPOS gününün gün sonu fotoğrafı (yazarkasa bölümü) günden 14 gün içinde, ertesi günün
  // raporu girilmiş olsa da (rakam değişmez; src/server/lafpos/foto.ts)
  return (kind === "kasa-okc" || kind === "kasa-pos") && lafposPhotoDayOpen(getDb(), day, await currentTillBranch(), opsLevel(me.role));
}
