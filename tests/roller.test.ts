// Roller (docs/ROLLER.md): dört rolün girebildiği ekranlar ve yapabildikleri tek kaynakta (src/lib/roles.ts); menü, alt
// menü, proxy ve sayfalar aynı kurala bakar; yol parçası sınırında eşleşir (/panel/sayimx açılmaz). Her sunucu eylemi bir
// yetki kapısından geçer ve muhasebeciye yazma izni veren eylem yoktur (kaynak taraması). Kullanıcı düzenlemede e-posta
// değişince bağlantılar iptal olur.
// Çalıştırma: npx tsx --test tests/roller.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { NextRequest } from "next/server";

import { BOTTOM_NAV, BOTTOM_SPARES, NAV_FOOTER, NAV_GROUPS, NAV_TREE, navTreeFor, sectionTabsFor } from "../src/components/panel/nav";
import { needsTwoFactorSetup, twoFactorRequiredFor } from "../src/lib/admin-security";
import { featureAudience } from "../src/lib/branch-features";
import { sheetCashOutsByDate } from "../src/lib/cash-outs";
import { alertRecipients } from "../src/lib/checklist-alerts";
import { ROLE_ORDER, ROLES, type Role } from "../src/lib/constants";
import { karaokeAudience } from "../src/lib/karaoke/staff-mail";
import { blockReasonOf } from "../src/lib/notify-recipients";
import {
  ACCOUNTANT_CLOSED_PATHS,
  ACCOUNTANT_HOME,
  ACCOUNTANT_PATHS,
  ADMIN_ONLY_PATHS,
  adminLevel,
  asActor,
  BRANCH_REQUIRED_ROLES,
  BRANCH_ROLES,
  can,
  canOpen,
  CAPABILITIES,
  cashAudience,
  homeFor,
  isRole,
  linksAnyPhoto,
  MANAGER_CLOSED_PATHS,
  MANAGER_EXTRA_PATHS,
  opsLevel,
  realRoleOf,
  ROLE_HINTS,
  ROLE_PERMISSIONS,
  rolePaths,
  STAFF_HOME,
  STAFF_PATHS,
  TWO_FACTOR_ROLES,
  type Capability,
} from "../src/lib/roles";
import { MANAGER_HELP } from "../src/app/panel/yardim/personel/mudur";
import { canEditShifts } from "../src/lib/vardiya";
import { proxy } from "../src/proxy";
import { SESSION_COOKIE, signSession, verifySession } from "../src/server/auth/session";

import { allActionGates } from "./helpers/action-gates";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NON_ADMIN: Role[] = ["manager", "staff", "accountant"];

test("personel yalnız kendi ekranlarını açar; yol parçası sınırında eşleşir", () => {
  for (const p of STAFF_PATHS) {
    assert.ok(canOpen("staff", p), p);
    assert.ok(canOpen("staff", `${p}/alt`), `${p}/alt`);
  }
  for (const p of ["/panel", "/panel/urunler", "/panel/urunler/12", "/panel/onaylar", "/panel/hatirlaticilar", "/panel/kullanicilar", "/panel/tutarlilik", "/panel/ayarlar", "/panel/muhasebe"]) {
    assert.equal(canOpen("staff", p), false, p);
  }
  // Önek benzerliği kapı açmaz (eski proxy startsWith ile açıyordu)
  assert.equal(canOpen("staff", "/panel/sayimlar"), false);
  assert.equal(canOpen("staff", "/panel/receteler-arsiv"), false);
  // Ödemeler (işletme) ile kişisel hatırlatıcılar karışmaz
  assert.equal(canOpen("staff", "/panel/hatirlaticilar"), false);
  assert.equal(canOpen("staff", "/panel/hatirlaticilarim"), true);
  // Yönetici her yere, panel dışı adresler kuralın dışında
  assert.ok(canOpen("admin", "/panel/kullanicilar"));
  assert.ok(canOpen("staff", "/menu"));
  assert.equal(homeFor("admin"), "/panel");
  assert.equal(homeFor("staff"), STAFF_HOME);
  assert.ok(canOpen("staff", STAFF_HOME));
  // Personel girişte Bugün'de açılır (günün işleri; ay sonu sayımı orada satır olarak çıkar)
  assert.equal(STAFF_HOME, "/panel/bugun");
  assert.equal(canOpen("staff", "/panel/bugunler"), false);
  // Kontrol listeleri: personel bugünün listelerini açar ve doldurur, son 7 günü Geçmiş'ten görür; listeleri
  // düzenlemek yöneticinin (proxy personeli sokmaz, sayfa da requireAdmin)
  assert.ok(canOpen("staff", "/panel/kontrol"));
  assert.ok(canOpen("staff", "/panel/kontrol/3"));
  assert.ok(canOpen("staff", "/panel/kontrol/gecmis"));
  assert.equal(canOpen("staff", "/panel/kontrol/duzenle"), false);
  assert.equal(canOpen("staff", "/panel/kontrol/duzenle/2"), false);
  assert.equal(canOpen("staff", "/panel/kontroller"), false);
  for (const p of ["src/app/panel/kontrol/duzenle/page.tsx", "src/app/panel/kontrol/duzenle/[id]/page.tsx"]) {
    assert.match(read(p), /await requireAdmin\(\)/, p);
  }
  // Kasadaki fiyatlar (dalga 10 §2.2): personel kasanın altında işaretler; Ürünler › Fiyatlar kapalı
  assert.ok(canOpen("staff", "/panel/kasa/fiyatlar"));
  assert.equal(canOpen("staff", "/panel/urunler/fiyatlar"), false);
  // Özel günler ve personelin Yardım'ı; yöneticinin Yardım'ı ve Onaylar kapalı
  assert.ok(canOpen("staff", "/panel/ozel-gunler"));
  assert.ok(canOpen("staff", "/panel/yardim/personel"));
  assert.equal(canOpen("staff", "/panel/yardim"), false);
  assert.equal(canOpen("staff", "/panel/yardim/personelx"), false);
  assert.equal(canOpen("staff", "/panel/onaylar"), false);
  assert.ok(canOpen("admin", "/panel/yardim/personel"));
  // Vergi (dalga 12) ve üç alt sayfası personele kapalı; personelin ağacında Vergi yok (proxy Bugün'e gönderir)
  for (const p of ["/panel/vergi", "/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar"]) {
    assert.equal(canOpen("staff", p), false, p);
    assert.ok(canOpen("admin", p), p);
  }
  // Raporlar (docs/RAPORLAR.md) personele kapalı; İşçilik / ciro müdüre de açık, öbürleri yalnız yöneticinin
  for (const p of ["/panel/raporlar", "/panel/raporlar/kacak", "/panel/raporlar/kayip"]) {
    assert.equal(canOpen("staff", p), false, p);
    assert.equal(canOpen("manager", p), false, p);
    assert.ok(canOpen("admin", p), p);
    assert.match(read(`src/app${p}/page.tsx`), /await requireAdmin\(\)/, `${p}: sayfa requireAdmin ile`);
  }
  assert.match(read("src/app/panel/raporlar/iscilik/page.tsx"), /await requireCan\("rapor\.sube"\)/);
  const staffIds = navTreeFor("staff").flatMap((n) => [n.id, ...(n.children ?? []).map((c) => c.id)]);
  assert.ok(!staffIds.includes("vergi") && !staffIds.includes("finans") && !staffIds.includes("raporlar"));
  assert.ok(navTreeFor("admin").find((n) => n.id === "vergi")?.children?.some((c) => c.href === "/panel/vergi"));
});

test("personel yolunun altındaki yönetici ekranları (Karaoke › Doluluk, Kontrol › Listeler) personele kapalı", () => {
  assert.deepEqual([...ADMIN_ONLY_PATHS], ["/panel/karaoke/doluluk", "/panel/kontrol/duzenle", "/panel/kasa/teslim"]);
  // Teslim defteri (Dalga 2): Kasa raporu personele açık, defteri personele kapalı (müdüre açık)
  assert.equal(canOpen("staff", "/panel/kasa/teslim"), false);
  assert.ok(canOpen("staff", "/panel/kasa"));
  assert.match(read("src/app/panel/kasa/teslim/page.tsx"), /await requireCan\("isletme\.yonet"\)/);
  assert.equal(canOpen("staff", "/panel/karaoke/doluluk"), false);
  assert.equal(canOpen("staff", "/panel/karaoke/doluluk/x"), false);
  assert.equal(canOpen("staff", "/panel/karaoke"), true);
  assert.equal(canOpen("staff", "/panel/karaoke/dolulukx"), true, "yol parçası sınırında");
  assert.equal(canOpen("admin", "/panel/karaoke/doluluk"), true);
  // Her yönetici ekranı gerçekten bir personel yolunun altında (yoksa liste gereksiz)
  for (const p of ADMIN_ONLY_PATHS) assert.ok(STAFF_PATHS.some((s) => p.startsWith(`${s}/`)), p);
});

describe("müdür: şubesinin günlük işletmesi", () => {
  test("personelin her ekranı, Onaylar, İşçilik ve Teslim defteri; yönetimin ekranları kapalı", () => {
    for (const p of STAFF_PATHS) assert.ok(canOpen("manager", p), p);
    for (const p of MANAGER_EXTRA_PATHS) assert.ok(canOpen("manager", p), p);
    assert.ok(canOpen("manager", "/panel/kasa/teslim"));
    assert.ok(canOpen("manager", "/panel/onaylar"));
    assert.ok(canOpen("manager", "/panel/raporlar/iscilik"));
    for (const p of MANAGER_CLOSED_PATHS) assert.equal(canOpen("manager", p), false, p);
    for (const p of [
      "/panel",
      "/panel/personel",
      "/panel/personel/belgeler",
      "/panel/personel/avans",
      "/panel/vergi",
      "/panel/parasut",
      "/panel/ayarlar",
      "/panel/kullanicilar",
      "/panel/subeler",
      "/panel/faturalar",
      "/panel/gelir-gider",
      "/panel/hatirlaticilar",
      "/panel/raporlar",
      "/panel/urunler",
      "/panel/hammaddeler",
      "/panel/muhasebe",
      "/panel/yardim",
      "/panel/onaylarx",
    ]) {
      assert.equal(canOpen("manager", p), false, p);
    }
    assert.equal(homeFor("manager"), STAFF_HOME);
  });

  test("yetenekleri: işletmeyi yönetir, maaş, vergi, yönetim ve öteki şubeler yok", () => {
    for (const cap of ["kayit.yaz", "isletme.yonet", "kasa.rakam", "onay", "vardiya.yaz", "rapor.sube"] as const) assert.ok(can("manager", cap), cap);
    for (const cap of ["maas", "yonetim", "muhasebe.oku", "sube.tumu", "kategori.tum"] as const) assert.equal(can("manager", cap), false, cap);
    // Kasadan çıkanda maaş, kira gibi kategorileri seçemez ve adını görmez; sunucu da reddeder. Kural yazım yolunda
    // (writeCashOut, gerçek rol): doğrudan kayıt da Onaylar'daki isteğin onayı da aynı kuraldan geçer
    const write = read("src/server/cash-outs/write.ts");
    assert.match(write, /const allCategories = admin && can\(realRoleOf\(me\), "kategori\.tum"\);/);
    assert.match(write, /if \(\(!admin \|\| \(!allCategories && !o\.restore\)\) && !staffCategory\(cat\) && !unchanged\) throw new UserError\(CATEGORY_ADMIN_ONLY\);/);
    assert.match(read("src/server/actions/cash-out-requests.ts"), /reviewCashOutRequestCore\(getDb\(\), asActor\(me, opsLevel\(me\.role\)\), /);
    assert.match(read("src/app/panel/kasa/page.tsx"), /cashOutCategories\(allCategories \? "admin" : "staff"\)/);
    assert.match(read("src/app/panel/onaylar/kasa-section.tsx"), /const allCategories = can\(me\.role, "kategori\.tum"\);[\s\S]*cashOutCategories\(allCategories \? "admin" : "staff"\)/);
    // Çekirdeğe giden kişi gerçek rolünü taşır; elle kurulan kişide (LafPOS, fatura eşleme) düzeyin kendisi
    assert.deepEqual(asActor({ id: 1, role: "manager" as Role }, "admin"), { id: 1, role: "admin", realRole: "manager" });
    assert.equal(realRoleOf(asActor(asActor({ id: 1, role: "manager" as Role }, "admin"), "staff")), "manager");
    assert.equal(realRoleOf({ role: "admin" }), "admin");
    assert.equal(opsLevel("manager"), "admin");
    assert.equal(adminLevel("manager"), "staff");
    assert.equal(cashAudience("manager"), "admin");
    assert.ok(canEditShifts("manager"));
    assert.equal(canEditShifts("staff"), false);
    // Şube zorunlu ve kilitli
    assert.ok(BRANCH_REQUIRED_ROLES.includes("manager"));
    assert.ok(BRANCH_ROLES.includes("manager") && BRANCH_ROLES.includes("staff"));
    assert.equal(BRANCH_ROLES.includes("accountant"), false);
  });

  test("şube kilidi oturumdan: eyleme gelen rol değil (müdür çekirdeğe 'admin' düzeyinde girer)", () => {
    const scope = read("src/server/branch-scope.ts");
    // staffBranchRefusal artık rolün 'admin' kısa yolunu kullanmaz
    assert.doesNotMatch(scope, /if \(me\.role === "admin"\) return null;/);
    assert.match(scope, /BRANCH_ROLES as readonly string\[\]\)\.includes\(user\.role\)/);
    // Müdürde withBranchScope("hepsi" ya da başka şube) de şubesine daralır
    assert.match(scope, /const lock = await managerLock\(\);\s*return lock \?\? override;/);
    // Şubesiz ya da şubesi pasif müdürün oturumu yok, girişi de reddedilir
    const dal = read("src/server/auth/dal.ts");
    assert.match(dal, /if \(managerWithoutBranch\(u\)\) return null;/);
    assert.match(read("src/server/actions/auth.ts"), /return fail\(MANAGER_NO_BRANCH\);/);
    // Kasadan çıkanın kapısı şube denetimini yöneticinin kısa yolundan önce yapar
    const guard = read("src/server/cash-outs/guard.ts");
    assert.ok(guard.indexOf("staffBranchRefusal(me, target.row.branchId)") < guard.indexOf('if (me.role === "admin") return "direct";'));
    // Onay kararları müdürde isteğin şubesine bakar
    for (const f of ["cash-requests", "cash-out-requests", "waste-requests", "closed-days"]) {
      assert.match(read(`src/server/actions/${f}.ts`), /reviewBranchRefusal\(getDb\(\), me, /, f);
    }
  });

  test("Kasa ay görünümü: rapor penceresine kasadan çıkanın yalnız adı, tutarı ve fişi gider; maaş / kira kategorisinin adı gitmez (bulgu 8)", () => {
    // Sunucunun okuduğu bütün satır (cashOutsBetween): bağlı harcama kaydı, kategorisi ve yazanıyla
    type CashOutDTO = import("../src/server/data/cash-outs").CashOutDTO;
    const full = (o: Pick<CashOutDTO, "id" | "date" | "photoId" | "expenseEntryId" | "categoryId" | "categoryName">) =>
      ({
        kind: "harcama",
        amount: 15_000,
        store: null,
        description: "Kasım ödemesi",
        receiptDate: null,
        receiptNo: null,
        vat: null,
        docType: "yok",
        createdBy: 3,
        createdByName: "Ali",
        createdAt: "2026-11-03T10:00:00.000Z",
        updatedAt: "2026-11-03T10:00:00.000Z",
        lafposId: null,
        lafposAwaitingCategory: false,
        ...o,
      }) satisfies CashOutDTO;
    const rows = [
      full({ id: 7, date: "2026-11-03", photoId: null, expenseEntryId: 41, categoryId: 12, categoryName: "Maaş" }),
      full({ id: 8, date: "2026-11-04", photoId: 5, expenseEntryId: 42, categoryId: 13, categoryName: "Kira" }),
    ];
    const byDate = sheetCashOutsByDate(rows);
    assert.deepEqual(Object.keys(byDate), ["2026-11-03", "2026-11-04"]);
    // Tutar kalır (müdür öbür satırların tutarını görür), fiş simgesi kalır
    assert.deepEqual(byDate["2026-11-03"], [{ id: 7, kind: "harcama", amount: 15_000, store: null, description: "Kasım ödemesi", photoId: null }]);
    assert.deepEqual(byDate["2026-11-04"], [{ id: 8, kind: "harcama", amount: 15_000, store: null, description: "Kasım ödemesi", photoId: 5 }]);
    // Tarayıcıya giden prop (RSC yükü): kategorinin adı ve kimliği, harcama kaydı, yazanı yok
    assert.doesNotMatch(JSON.stringify(byDate), /Maaş|Kira|categoryName|categoryId|expenseEntryId|createdBy|lafposId/);
    // Sayfa pencereye bütün satırı değil beyaz listeden geçeni verir (gün görünümündeki hideName kuralının ay karşılığı)
    const page = read("src/app/panel/kasa/page.tsx");
    assert.match(page, /cashOuts=\{sheetCashOutsByDate\(monthOuts\)\}/);
    assert.doesNotMatch(page, /cashOuts=\{outsByDate\}/);
    // İstemci bileşeni sunucunun satır tipini almaz
    assert.doesNotMatch(read("src/app/panel/kasa/cash-history.tsx"), /CashOutDTO/);
  });
});

test("müdür başkasının fotoğrafını bağlayamaz ('admin' düzeyi değil gerçek rol); onayladığı isteğinkini bağlar", () => {
  const manager = asActor({ id: 2, role: "manager" as Role }, opsLevel("manager"));
  assert.equal(linksAnyPhoto(manager), false);
  assert.equal(linksAnyPhoto(manager, true), true, "onayladığı isteğin tuttuğu fotoğraf");
  assert.equal(linksAnyPhoto(asActor({ id: 1, role: "admin" as Role }, "admin")), true);
  assert.equal(linksAnyPhoto({ role: "admin" }), true, "elle kurulan yönetici (LafPOS, fatura eşleme)");
  assert.equal(linksAnyPhoto({ role: "staff" }, true), false);
  // Fotoğraf sahipliğinin dört yeri aynı kurala bakar
  assert.match(read("src/server/cash/report-store.ts"), /\(!linksAnyPhoto\(actor, o\.heldBy !== undefined\) && p\.createdBy !== actor\.id\)/);
  const write = read("src/server/cash-outs/write.ts");
  assert.match(write, /const foreign = !linksAnyPhoto\(me, o\.heldBy !== undefined\) && p\?\.createdBy !== me\.id/);
  assert.match(write, /\(!linksAnyPhoto\(me\) && p\.createdBy !== me\.id\)\) throw new UserError\(PHOTO_GONE\)/);
  assert.match(read("src/server/lafpos/foto.ts"), /\(!linksAnyPhoto\(me\) && p\.createdBy !== me\.id\)/);
  for (const f of ["src/server/cash/report-store.ts", "src/server/cash-outs/write.ts", "src/server/lafpos/foto.ts"]) {
    assert.doesNotMatch(read(f), /role !== "admin" && p\??\.createdBy !== /, f);
  }
});

describe("muhasebeci: salt okunur", () => {
  test("yalnız muhasebe ekranları ve kasa raporları; yazan ve kişisel ekranlar kapalı", () => {
    for (const p of ACCOUNTANT_PATHS) assert.ok(canOpen("accountant", p), p);
    for (const p of ["/panel/vergi/gelir-gider", "/panel/vergi/demirbas", "/panel/vergi/kurallar"]) assert.ok(canOpen("accountant", p), p);
    for (const p of ACCOUNTANT_CLOSED_PATHS) assert.equal(canOpen("accountant", p), false, p);
    for (const p of [
      "/panel",
      "/panel/bugun",
      "/panel/zayi",
      "/panel/sayim",
      "/panel/kontrol",
      "/panel/vardiya",
      "/panel/onaylar",
      "/panel/personel",
      "/panel/personel/belgeler",
      "/panel/giderler",
      "/panel/ayarlar",
      "/panel/kullanicilar",
      "/panel/parasut",
      "/panel/hatirlaticilarim",
      "/panel/yardim/personel",
      "/panel/receteler",
    ]) {
      assert.equal(canOpen("accountant", p), false, p);
    }
    assert.equal(homeFor("accountant"), ACCOUNTANT_HOME);
    assert.ok(canOpen("accountant", ACCOUNTANT_HOME));
  });

  test("yetenekleri: okur, hiçbir şey yazmaz", () => {
    for (const cap of ["kasa.rakam", "muhasebe.oku", "sube.tumu"] as const) assert.ok(can("accountant", cap), cap);
    for (const cap of ["kayit.yaz", "isletme.yonet", "onay", "vardiya.yaz", "rapor.sube", "maas", "yonetim"] as const) assert.equal(can("accountant", cap), false, cap);
    assert.equal(cashAudience("accountant"), "admin");
    assert.equal(opsLevel("accountant"), "staff");
    assert.equal(canEditShifts("accountant"), false);
  });

  test("vergide kişi kişi bordro dökümü yalnız maaşı görene; fatura belgesi ve paket muhasebeciye açık, yükleme kapalı", () => {
    assert.match(read("src/app/panel/vergi/page.tsx"), /const payroll = can\(viewer\.role, "maas"\) \?/);
    const belge = read("src/app/api/faturalar/[id]/belge/route.ts");
    assert.match(belge, /if \(!\(await reader\(\)\)\) return Response\.json/);
    assert.match(belge, /const me = await admin\(\);/, "yükleme yalnız yöneticinin");
    assert.match(read("src/app/api/muhasebe/paket/route.ts"), /can\(user\.role, "muhasebe\.oku"\)/);
    // Tam dışa aktarım (kişi kişi maaş, reçeteler, ayarlar) yalnız yöneticinin
    assert.match(read("src/app/api/export/route.ts"), /user\.role !== "admin"/);
    for (const f of ["src/app/api/foto/route.ts", "src/app/api/kontrol/foto/route.ts", "src/app/api/siparisler/route.ts"]) {
      assert.match(read(f), /if \(!can\(me\.role, "kayit\.yaz"\)\) return Response\.json\(\{ error: READ_ONLY_TEXT \}/, f);
    }
    // Eylemde reddedilen muhasebeci yönlendirilmez, "salt okunur" hatası alır
    assert.match(read("src/server/auth/dal.ts"), /if \(user\.role === "accountant" && \(await headers\(\)\)\.has\("next-action"\)\) throw new UserError\(READ_ONLY_TEXT\);/);
  });
});

test("tanınmayan rol hiçbir panel ekranını açmaz, oturum da saymaz", async () => {
  const ghost = "patron" as unknown as Role;
  assert.equal(canOpen(ghost, "/panel/bugun"), false);
  assert.equal(can(ghost, "kayit.yaz"), false);
  assert.equal(isRole("patron"), false);
  for (const r of ROLE_ORDER) assert.ok(isRole(r), r);
  const token = await signSession({ sub: "9", name: "X", role: ghost, sv: 1 });
  assert.equal(await verifySession(token), null);
  assert.equal(rolePaths("admin"), null);
});

test("yetenek tablosu varsayılan kapalı: her yetenekte yönetici var, rol listesi dışı yok", () => {
  for (const [cap, roles] of Object.entries(CAPABILITIES) as [Capability, readonly Role[]][]) {
    assert.ok(roles.includes("admin"), `${cap}: yönetici`);
    for (const r of roles) assert.ok(isRole(r), `${cap}: ${r}`);
  }
  // Muhasebecinin yazdığı tek bir yetenek bile yok
  assert.equal(
    (Object.entries(CAPABILITIES) as [Capability, readonly Role[]][]).filter(([cap, roles]) => roles.includes("accountant") && ["kayit.yaz", "isletme.yonet", "onay", "vardiya.yaz", "yonetim", "maas"].includes(cap)).length,
    0,
  );
});

test("menüdeki her öğenin rolü erişim kuralıyla aynı (her rol menüde gördüğü her ekrana girebilir, başkasını görmez)", () => {
  const items = [
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...NAV_FOOTER,
    ...NAV_TREE.flatMap((n) => [...(n.href ? [{ href: n.href, roles: n.roles }] : []), ...(n.children ?? [])]),
  ];
  for (const role of NON_ADMIN) {
    for (const item of items) {
      // Kare adresli kayıtlar (yalnız yöneticinin paleti) ve ağaçtaki kısayolu bilerek olmayan ekranlar hariç: rolde menüde
      // görünen her öğe açılır
      if (item.roles.includes(role)) assert.ok(canOpen(role, item.href.split("#")[0]), `${role}: ${item.href} menüde ama açılmıyor`);
    }
    for (const item of items.filter((i) => !i.href.includes("#"))) {
      assert.equal(item.roles.includes(role), canOpen(role, item.href), `${role}: ${item.href}: menü rolü ile erişim kuralı aynı olmalı`);
    }
    const tree = navTreeFor(role).flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
    for (const href of tree) assert.ok(canOpen(role, href), `${role}: ${href}`);
    for (const item of [...BOTTOM_NAV[role], ...BOTTOM_SPARES[role]]) if (item.href) assert.ok(canOpen(role, item.href), `${role} alt menü: ${item.href}`);
    for (const section of ["giderler", "stok", "vergi", "odeme", "raporlar"] as const) {
      for (const t of sectionTabsFor(section, role)) assert.ok(canOpen(role, t.href), `${role} sekme: ${t.href}`);
    }
  }
  const staffTree = navTreeFor("staff").flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
  // Personel menüsünde her ekran (Hesabım profil menüsünde)
  for (const p of STAFF_PATHS.filter((x) => x !== "/panel/hesap")) assert.ok(staffTree.includes(p), `${p} personel menüsünde yok`);
  // Müdür menüsünde personelin her ekranı ve Onaylar, İşçilik; muhasebecininkinde Muhasebe ve Kasa
  const managerTree = navTreeFor("manager").flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
  for (const p of [...STAFF_PATHS.filter((x) => x !== "/panel/hesap"), ...MANAGER_EXTRA_PATHS]) assert.ok(managerTree.includes(p), `${p} müdür menüsünde yok`);
  const accountantTree = navTreeFor("accountant").flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href!]));
  for (const p of ACCOUNTANT_PATHS.filter((x) => x !== "/panel/hesap")) assert.ok(accountantTree.includes(p), `${p} muhasebeci menüsünde yok`);
  assert.deepEqual(BOTTOM_NAV.accountant.map((i) => i.href), ["/panel/muhasebe", "/panel/faturalar", "/panel/gelir-gider", "/panel/vergi", "/panel/kasa"]);
  // Personelin ağacı aynı kaldı (müdürün öğeleri ona eklenmez)
  assert.equal(staffTree.includes("/panel/onaylar"), false);
});

test("yetki tablosu (Kullanıcılar & roller) ekran ve yetenek kuralıyla aynı; rol seçicinin açıklamaları dört rolde", () => {
  for (const p of ROLE_PERMISSIONS) {
    // Müdür personelin her satırını yapar; ekranı yazan satırların müdür ve muhasebeci sütunu ekran kuralıyla aynı
    if (p.staff) assert.ok(p.manager, `${p.label}: müdür personelin işini yapar`);
    for (const path of p.paths ?? []) {
      assert.equal(p.manager, canOpen("manager", path), `${p.label}: müdür`);
      if (p.accountant) assert.ok(canOpen("accountant", path), `${p.label}: muhasebeci`);
    }
  }
  const row = (re: RegExp) => ROLE_PERMISSIONS.find((p) => re.test(p.label))!;
  assert.ok(row(/^Maaşlar, kişisel ücretler/).admin && !row(/^Maaşlar, kişisel ücretler/).manager && !row(/^Maaşlar, kişisel ücretler/).accountant);
  assert.ok(row(/^Paraşüt, ayarlar/).admin && !row(/^Paraşüt, ayarlar/).manager && !row(/^Paraşüt, ayarlar/).accountant);
  assert.ok(row(/^Kasa raporlarının rakamları/).accountant && row(/^Kasa raporlarının rakamları/).manager);
  assert.ok(!row(/^Kasa raporunu onaysız düzeltme/).accountant && row(/^Kasa raporunu onaysız düzeltme/).manager);
  assert.ok(row(/^Vergi, KDV, SGK/).accountant && !row(/^Vergi, KDV, SGK/).manager);
  for (const r of ROLE_ORDER) assert.ok(ROLE_HINTS[r].length > 20, r);
  assert.deepEqual(Object.keys(ROLES).sort(), [...ROLE_ORDER].sort());
  const users = read("src/app/panel/kullanicilar/users-client.tsx");
  assert.match(users, /\{ value: "manager", label: ROLES\.manager, hint: MANAGER_ROLE_HINT \}/);
  assert.match(users, /\{ value: "accountant", label: ROLES\.accountant, hint: ACCOUNTANT_ROLE_HINT \}/);
  // Müdürde şube zorunlu: form ve sunucu
  assert.match(users, /required=\{branchRequired\(role\)\}/);
  assert.match(read("src/server/actions/settings.ts"), /if \(required\) throw new UserError\(MANAGER_BRANCH_REQUIRED\);/);
});

test("iki adımlı doğrulama rakam gören her rolde zorunlu; yeni cihaz uyarısı da", () => {
  assert.deepEqual([...TWO_FACTOR_ROLES].sort(), ["accountant", "admin", "manager"]);
  for (const r of ["admin", "manager", "accountant"] as const) {
    assert.ok(twoFactorRequiredFor(r, true), r);
    assert.ok(needsTwoFactorSetup({ role: r, totpEnabled: false }, true), r);
    assert.equal(needsTwoFactorSetup({ role: r, totpEnabled: true }, true), false, r);
  }
  assert.equal(twoFactorRequiredFor("staff", true), false);
  assert.equal(twoFactorRequiredFor("manager", false), false, "ADMIN_2FA_OPTIONAL=1 hepsini kapatır");
});

test("e-posta alıcıları: personel ve müdür hesabına kasa ve sabah e-postası gitmez; muhasebeci alır", () => {
  assert.equal(blockReasonOf({ role: "staff", active: true }), "staff");
  assert.equal(blockReasonOf({ role: "manager", active: true }), "manager");
  assert.equal(blockReasonOf({ role: "accountant", active: true }), null);
  assert.equal(blockReasonOf({ role: "accountant", active: false }), "inactive");
  assert.equal(blockReasonOf({ role: "admin", active: true }), null);
  assert.equal(blockReasonOf({ role: "patron" as unknown as Role, active: true }), "staff", "tanınmayan rol de almaz");
});

test("karaoke tutarı: kasa e-postasının kitlesiyle aynı (müdür ve personel görmez)", () => {
  for (const r of ROLE_ORDER) assert.equal(can(r, "karaoke.tutar"), blockReasonOf({ role: r, active: true }) === null, r);
  assert.equal(can("manager", "karaoke.tutar"), false);
  assert.equal(can("staff", "karaoke.tutar"), false);
  assert.equal(can("accountant", "karaoke.tutar"), true);
  // Müdür kasa rakamlarını görür ("admin" kitlesi) ama karaoke tutarını değil: iki kapı ayrı
  assert.ok(can("manager", "kasa.rakam") && cashAudience("manager") === "admin");
});

test("saha kitleleri: muhasebeci karaoke, özellik ve kontrol uyarısı almaz; müdür şubesininkini alır", () => {
  const users = [
    { id: 1, role: "admin" as Role, branchId: null },
    { id: 2, role: "manager" as Role, branchId: "marina" },
    { id: 3, role: "staff" as Role, branchId: "tuzla" },
    { id: 4, role: "accountant" as Role, branchId: null },
  ];
  assert.deepEqual(
    karaokeAudience(users, "marina").map((u) => u.id),
    [1, 2],
  );
  const branches = [
    { id: "tuzla", kind: "fiziksel" as const, active: true, features: ["siparis"] },
    { id: "marina", kind: "fiziksel" as const, active: true, features: ["siparis"] },
  ];
  assert.deepEqual(
    featureAudience(users, branches as never, "siparis").map((u) => u.id),
    [1, 2, 3],
  );
  // Plan yokken kontrol uyarısı listeyi doldurabilen sahadakilere (personel ve müdür), muhasebeciye değil
  const reach = alertRecipients("marina", users, [], { date: "2026-11-26", minute: 600 }).map((u) => u.id);
  assert.ok(reach.includes(2) && !reach.includes(4) && !reach.includes(1), reach.join(","));
});

describe("proxy yönlendirmesi: her rol izinsiz adresten kendi ana ekranına", () => {
  const req = async (role: Role, path: string) => {
    const token = await signSession({ sub: "11", name: "Deneme", role, sv: 1 });
    return proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
  };
  const where = (res: Response) => res.headers.get("location");
  const cases: [Role, string, string | null][] = [
    ["manager", "/panel/onaylar", null],
    ["manager", "/panel/kasa/teslim", null],
    ["manager", "/panel/raporlar/iscilik", null],
    ["manager", "/panel/personel", "/panel/bugun"],
    ["manager", "/panel/raporlar", "/panel/bugun"],
    ["manager", "/panel/kontrol/duzenle", "/panel/bugun"],
    ["accountant", "/panel/faturalar", null],
    ["accountant", "/panel/vergi/demirbas", null],
    ["accountant", "/panel/kasa", null],
    ["accountant", "/panel/kasa/fiyatlar", "/panel/muhasebe"],
    ["accountant", "/panel/bugun", "/panel/muhasebe"],
    ["accountant", "/panel/personel", "/panel/muhasebe"],
    ["accountant", "/panel", "/panel/muhasebe"],
    ["staff", "/panel/onaylar", "/panel/bugun"],
    ["admin", "/panel/kullanicilar", null],
  ];
  for (const [role, path, to] of cases) {
    test(`${role} ${path} → ${to ?? "açılır"}`, async () => {
      const res = await req(role, path);
      if (to === null) assert.equal(where(res), null, `${role} ${path}`);
      else assert.equal(new URL(where(res)!).pathname, to, `${role} ${path}`);
    });
  }
  test("giriş sayfası oturumlu rolü ana ekranına gönderir", async () => {
    for (const r of ROLE_ORDER) assert.equal(new URL(where(await req(r, "/giris"))!).pathname, homeFor(r), r);
  });
});

test("proxy, giriş ve requireAdmin aynı kaynağa bakar", () => {
  const proxySrc = read("src/proxy.ts");
  assert.match(proxySrc, /canOpen\(session\.role, pathname\)/);
  assert.doesNotMatch(proxySrc, /STAFF_ALLOWED/);
  assert.match(read("src/server/actions/auth.ts"), /canOpen\(role, next\.split/);
  const dal = read("src/server/auth/dal.ts");
  assert.match(dal, /redirect\(homeFor\(user\.role\)\)/);
  assert.match(dal, /export async function requireCan\(cap: Capability\)/);
  assert.match(dal, /export async function requireRole\(\.\.\.roles: readonly Role\[\]\)/);
});

describe("sunucu eylemleri: her biri bir yetki kapısından geçer; muhasebeciye yazma izni veren yok", () => {
  const all = allActionGates(process.cwd());
  /** Oturumsuz uçlar (giriş, davet, parola sıfırlama) ve kendi denetimini yapanlar (Claude bağlantısı yöneticiye bakar) */
  const PUBLIC: Record<string, RegExp | null> = {
    loginAction: null,
    verifyLoginCodeAction: null,
    cancelLoginCodeAction: null,
    logoutAction: null,
    setPasswordWithToken: null,
    requestPasswordReset: null,
    approveConnection: /if \(me\.role !== "admin"\) throw new UserError/,
    denyConnection: /if \(me\.role !== "admin"\) throw new UserError/,
    // Zil: yalnız okur; muhasebeciye boş liste döner
    loadPanelNotifications: /if \(user\.role === "accountant"\) return \[\];/,
  };
  /**
   * Muhasebecinin de geçtiği kapılar (requireUser, requireSignedIn): yalnız kendi hesabı (parola, iki adımlı, oturumlar,
   * bu cihazın bildirim aboneliği) ya da salt okuma (şube seçimi çerezi, kasa raporunun WhatsApp metni)
   */
  const OWN_OR_READ = new Set([
    "changePasswordAction",
    "updateProfile",
    "signOutOtherSessions",
    "beginTotpSetup",
    "confirmTotpSetup",
    "cancelTotpSetup",
    "disableTotp",
    "regenerateRecoveryCodes",
    "savePushSubscription",
    "deletePushSubscription",
    "setPushTopics",
    "sendTestPush",
    "chooseBranchScope",
    "cashReportWhatsapp",
  ]);

  test("tarama sağlam: eylemler bulundu", () => {
    assert.ok(all.length > 250, `${all.length} eylem`);
    assert.ok(all.some((a) => a.name === "submitCashReport"));
    assert.ok(all.some((a) => a.file === "src/app/panel/sayim/actions.ts"));
  });

  test("her dışa verilen eylem requireAdmin / requireUser / requireCan / requireRole / requireSignedIn çağırır", () => {
    const missing = all.filter((a) => !a.gates.length && !(a.name in PUBLIC)).map((a) => `${a.file} › ${a.name}`);
    assert.deepEqual(missing, []);
    for (const [name, re] of Object.entries(PUBLIC)) {
      const hit = all.find((a) => a.name === name);
      assert.ok(hit, `${name} bulunamadı`);
      if (re) assert.match(read(hit.file), re, name);
    }
  });

  test("hiçbir eylem muhasebeciye yazma izni vermez", () => {
    const leaks: string[] = [];
    for (const a of all) {
      if (a.name in PUBLIC || OWN_OR_READ.has(a.name)) continue;
      for (const g of a.gates) {
        const where = `${a.file} › ${a.name}: ${g.kind}(${g.args.join(", ")})`;
        if (g.kind === "requireUser" || g.kind === "requireSignedIn") leaks.push(where);
        if (g.kind === "requireCan") {
          const cap = g.args[0] as Capability;
          if (!(cap in CAPABILITIES)) leaks.push(`${where} (bilinmeyen yetenek)`);
          else if (can("accountant", cap)) leaks.push(where);
        }
        if (g.kind === "requireRole" && g.args.some((r) => r.includes("accountant"))) leaks.push(where);
      }
    }
    assert.deepEqual(leaks, []);
  });

  test("kendi hesabı ve salt okuma listesi gerçekten requireUser / requireSignedIn ile ve listedekiler var", () => {
    for (const name of OWN_OR_READ) {
      const hit = all.find((a) => a.name === name);
      assert.ok(hit, `${name} bulunamadı`);
      assert.ok(hit.gates.some((g) => g.kind === "requireUser" || g.kind === "requireSignedIn"), name);
    }
  });

  test("müdüre açılan eylemler doğru yeteneği ister", () => {
    const gate = (name: string) => all.find((a) => a.name === name)?.gates.map((g) => `${g.kind}(${g.args.join(",")})`).join(" ");
    for (const n of ["reviewCashRequest", "reviewCashOutRequest", "reviewPhotoRemoval", "reviewWasteRequest", "reviewClosedDay"]) assert.equal(gate(n), "requireCan(onay)", n);
    for (const n of ["saveShiftWeekAction", "draftShiftWeekAction"]) assert.equal(gate(n), "requireCan(vardiya.yaz)", n);
    for (const n of ["markClosedDay", "deleteCashReport"]) assert.equal(gate(n), "requireCan(isletme.yonet)", n);
    // Yalnız yöneticinin kalanlardan örnekler
    for (const n of ["saveUser", "createUser", "createAccessLink", "updateCashSettings", "reviewKaraokeDeleteRequest", "reviewRecipeChange", "clearOkcCumulative"]) {
      assert.equal(gate(n), "requireAdmin()", n);
    }
  });
});

test("kullanıcı düzenleme: e-posta değişince ya da pasif yapılınca bekleyen bağlantılar iptal olur", () => {
  const src = read("src/server/actions/settings.ts");
  assert.match(src, /data\.password \|\| before\.email !== data\.email \|\| \(before\.active && !data\.active\)\) await expireUserTokens\(data\.id\)/);
});

test("personelin her sunucu eylemi kendi kaydına dokunur: hatırlatıcı sorguları kullanıcıya göre süzülür", () => {
  const src = read("src/server/actions/user-reminders.ts");
  // Her güncelleme / silme mine(id, me.id) ile; başka sorgu yolu yok
  const writes = src.match(/\.(update|delete)\(s\.userReminders\)/g) ?? [];
  const scoped = src.match(/\.where\(mine\([^)]*me\.id\)\)/g) ?? [];
  assert.ok(writes.length > 0);
  assert.ok(scoped.length >= writes.length, "her yazım mine(…, me.id) ile süzülmeli");
  assert.doesNotMatch(src, /requireAdmin/);
});

test("müdürün Yardım'ı: her bağlantı müdüre açık; personelin Yardım'ı ona da açık ve kart yalnız müdürde", () => {
  assert.ok(MANAGER_HELP.length >= 5);
  for (const m of MANAGER_HELP) assert.ok(canOpen("manager", m.href), m.href);
  assert.ok(canOpen("manager", "/panel/yardim/personel"));
  assert.equal(canOpen("accountant", "/panel/yardim/personel"), false, "muhasebecinin anlatımı Muhasebe ekranında");
  assert.match(read("src/app/panel/yardim/personel/page.tsx"), /me\.role === "manager" \? \(/);
});
