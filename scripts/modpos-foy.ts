// ModPOS (Gafdigi) kasa föyünü komut satırından çeker ya da bir yanıt dosyasını okur ve özetini yazar
// (docs/MODPOS-API.md › Sorun giderme; kitapçık docs/modpos-kasa-foyu-api.md). Panelin okuduğu biçimdedir: ayrıştırıcı,
// eşleme ve kota sunucuyla aynı kod (src/lib/modpos/*, src/server/modpos/*). Anahtar hiçbir satıra yazılmaz.
//
// Kullanım:
//   npm run modpos:foy -- 2026-11-02                 -> günü ModPOS'tan çeker, özetini yazar (bir hak kullanır;
//                                                       veritabanına yazmaz). Anahtar ortamdan: MODPOS_API_KEY
//                                                       (.env.local ya da komutun önünde)
//   npm run modpos:foy -- 2026-11-02 --kaydet        -> çeker ve DATABASE_URL'e yazar (panelin "Bu günü çek"iyle aynı
//                                                       yol: kalan hak, son çekim ve çalışma kaydı da yazılır)
//   npm run modpos:foy -- --dosya yanit.xml          -> yalnız dosyayı okur (istek yok, hak harcanmaz)
//   npm run modpos:foy -- --dosya yanit.xml --kaydet -> dosyadaki föyü DATABASE_URL'e yazar
//   (--dosya ile gün de verilirse dosyanın günü onunla aynı olmalı)

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { loadEnvConfig } from "@next/env";

import { databaseTarget, databaseUrl } from "../src/lib/backup/format";
import { money } from "../src/lib/format";
import { isFoyDay, MODPOS_UYARI, parseKasaFoyu, type FoyKasa, type FoyOdeme, type KasaFoyu } from "../src/lib/modpos/foy";
import { modposKeyProblem, quotaLeft, quotaRenewsAt, renewText, requestableDay, type ModposQuota } from "../src/lib/modpos/request";
import { timeText } from "../src/lib/modpos/status";
import { foyWarnings, foyZ, isFinalFoy, modposBucket, modposChannels, type ModposBucket } from "../src/lib/modpos/z";
import { longDateTR } from "../src/lib/reminders";

const USAGE = "Kullanım: npm run modpos:foy -- <YYYY-MM-DD> [--kaydet] | --dosya <yanit.xml> [YYYY-MM-DD] [--kaydet]";

export interface FoyArgs {
  /** İstenen kasa günü (dosyada isteğe bağlı: verilirse dosyanın günü onunla aynı olmalı) */
  day: string | null;
  /** Okunacak yanıt dosyası (verilirse istek gitmez) */
  file: string | null;
  /** Veritabanına da yaz */
  save: boolean;
}

/** Komut satırının seçenekleri; anlaşılmayan seçenek, takvimde olmayan ya da ileri gün hata (kullanımıyla) */
export function parseFoyArgs(argv: string[], now: Date = new Date()): FoyArgs {
  const out: FoyArgs = { day: null, file: null, save: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--kaydet") out.save = true;
    else if (a === "--dosya") {
      const f = argv[i + 1];
      if (!f || f.startsWith("--")) throw new Error(`--dosya bir dosya yolu ister. ${USAGE}`);
      out.file = f;
      i++;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(a)) {
      if (out.day) throw new Error(`Tek gün verilir (bir istek = bir kasa günü). ${USAGE}`);
      if (!isFoyDay(a)) throw new Error(`Takvimde olmayan gün: ${a}. ${USAGE}`);
      if (!requestableDay(a, now)) throw new Error(`${a} ileri tarih: ModPOS yalnız bugünü ve önceki günleri verir`);
      out.day = a;
    } else throw new Error(`Anlaşılmayan seçenek: ${a}. ${USAGE}`);
  }
  if (!out.day && !out.file) throw new Error(USAGE);
  return out;
}

const BUCKET_TEXT: Record<ModposBucket, string> = {
  cash: "Nakit",
  card: "Kredi / banka kartı",
  mealCard: "Yemek kartı",
  online: "Online",
  other: "Diğer",
  off: "ödeme alanına girmez",
};

const DAYANAK_TEXT: Record<string, string> = {
  Z_RAPORU: "Z raporu",
  CANLI: "anlık, gün açık",
  OTOMATIK_KAPANIS: "kendiliğinden kapanış, sayım yerine defterdeki nakit",
};

const NO_COUNT_TEXT = {
  acik: "gün açık (ModPOS'ta sayım yok; tutarlar değişebilir)",
  otomatik: "gün 06:00'da kendiliğinden kapandı (sayım yok, defterdeki nakit kullanıldı)",
  foysuz: "kasa açılmamış (föysüz gün)",
} as const;

/** Saatin yazısı (TR): "09:42" */
function hm(iso: string | null): string {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function payLine(o: FoyOdeme): string[] {
  const head = `${o.kod} (${o.yontem})`;
  if (!o.ciroyaDahil && modposBucket(o) === "off") return [`  ${head}: ciroya dahil değil · ${money(o.satis)}`];
  const parts = [`satış ${money(o.satis)}`];
  if (o.cariTahsilat) parts.push(`cari tahsilat ${money(o.cariTahsilat)}`);
  parts.push(`sistem ${money(o.sistem)}`);
  if (o.defter !== null) parts.push(`defter ${money(o.defter)}`);
  if (o.fark !== null) parts.push(`fark ${money(o.fark)}`);
  const channels = modposChannels(o).flatMap((c) => (c.channel ? [c.channel] : []));
  const where = `→ ${BUCKET_TEXT[modposBucket(o)]}${channels.length ? ` (komisyon kanalı: ${[...new Set(channels)].join(", ")})` : ""}`;
  return [`  ${head}: ${parts.join(" · ")} ${where}`, ...o.kirilim.map((k) => `      ${k.ad} ${money(k.tutar)}`)];
}

function kasaLines(k: FoyKasa, many: boolean): string[] {
  const out: string[] = [];
  const durum = k.durum === "ACIK" ? "açık" : k.otomatikKapandi ? "kendiliğinden kapandı (06:00)" : "kapalı";
  out.push(
    `Kasa: ${[k.sube, k.kasaAdi].filter(Boolean).join(" › ") || "adsız"} · gün no ${k.gunNo ?? "–"} · Z no ${k.zNo ?? "yok"} · ${durum} · açılış ${hm(k.acilis.zaman)} (${money(k.acilis.nakit)}) · kapanış ${hm(k.kapanis.zaman)} (${money(k.kapanis.nakit)})`,
  );
  const ind = many ? "  " : "";
  out.push(`${ind}Satış: ciro ${money(k.satis.ciro)} · ciro dışı ${money(k.satis.ciroDisi)} · adisyon ${k.satis.adisyonSayisi} · kişi ${k.satis.kisiSayisi ?? "–"} · bahşiş ${money(k.satis.bahsis)}`);
  out.push(`${ind}Ödeme yöntemleri (koda göre):`);
  for (const o of k.odemeler) out.push(...payLine(o).map((l) => `${ind}${l}`));
  out.push(`${ind}Kasa defteri: ${k.defterGirildi ? "girildi" : "girilmedi"}`);
  const n = k.nakitKasa;
  if (n) {
    const dayanak = n.dayanak ? (DAYANAK_TEXT[n.dayanak] ?? n.dayanak) : "dayanak yok";
    out.push(
      `${ind}Nakit mutabakatı (${dayanak}): açılış ${money(n.acilis)} + nakit satış ${money(n.nakitSatis)} + nakit cari tahsilat ${money(n.nakitCariTahsilat)} − gider ${money(n.gider)} = beklenen ${money(n.beklenen)} · sayılan ${money(n.sayilan)} · fark ${money(n.fark)}`,
    );
  } else out.push(`${ind}Nakit mutabakatı: föyde yok`);
  if (k.giderler.kalemler.length || k.giderler.toplam) {
    const items = k.giderler.kalemler.map((g) => `${[g.kategori, g.aciklama].filter(Boolean).join(": ") || "gider"} ${money(g.tutar)}`);
    out.push(`${ind}Giderler: ${money(k.giderler.toplam)}${items.length ? ` · ${items.join(" · ")}` : ""}`);
  }
  if (k.cariTahsilatlar.kalemler.length || k.cariTahsilatlar.toplam) {
    out.push(`${ind}Cari tahsilat: ${money(k.cariTahsilatlar.toplam)} (nakit ${money(k.cariTahsilatlar.nakit)}) · ${k.cariTahsilatlar.kalemler.length} kalem (müşteri adı okunmaz)`);
  }
  for (const a of k.araKasalar) {
    out.push(`${ind}Ara kasa ${a.no ?? "–"} (${hm(a.zaman)}): ciro ${money(a.ciro)} · nakit ${money(a.nakit)} · gider ${money(a.gider)} · beklenen ${money(a.beklenen)} · sayılan ${money(a.sayilan)} · fark ${money(a.fark)}`);
  }
  if (k.notlar.kapanis) out.push(`${ind}Not (kapanış): ${k.notlar.kapanis}`);
  if (k.notlar.fark) out.push(`${ind}Not (fark): ${k.notlar.fark}`);
  return out;
}

/**
 * Föyün komut satırı özeti: durum, Z no, ciro, kasa raporunun alanları (panelin eşlemesi, src/lib/modpos/z.ts), kod
 * kod ödemeler ve kırılım, nakit mutabakatı, giderler, uyarılar, kalan hak. `fetchedAt` çekilme anıdır (kesinlik ona
 * göre); dosyada null: föyün hazırlanma anı kullanılır. `quota` yanıtın kotası (dosyada null: föydeki <kota>)
 */
export function foySummaryLines(foy: KasaFoyu, o: { now: Date; fetchedAt: Date | null; quota: ModposQuota | null }): string[] {
  const out: string[] = [];
  const z = foyZ(foy);
  out.push(`ModPOS API: ${longDateTR(foy.kasaGunu)} (${foy.kasaGunu})`);
  if (foy.olusturulma) out.push(`Hazırlandığı an: ${timeText(foy.olusturulma, o.now)}`);
  const at = o.fetchedAt ?? (foy.olusturulma ? new Date(foy.olusturulma) : null);
  const final = at ? isFinalFoy(foy, at) : null;
  const finalText = final === null ? "kesinliği bilinmiyor" : final ? "kesin" : "kesin değil";
  if (!foy.kasalar.length) {
    out.push(z ? `Durum: kasa açılmamış (föysüz gün) · ${finalText}` : `Durum: satış yok (kasa açılmamış, föysüz satış da yok) · ${finalText}`);
  } else {
    const state = z?.durum === "ACIK" ? "açık (gün sürüyor, tutarlar değişebilir)" : z?.otomatikKapandi ? "kendiliğinden kapandı (06:00)" : "kapalı";
    const why = final === false && z?.durum === "KAPALI" ? " (ertesi sabah 07:00'den önce alındı; sabah işi yeniden çeker)" : "";
    out.push(`Durum: ${state} · ${finalText}${why}`);
  }
  if (z) {
    const zNos = foy.kasalar.map((k) => k.zNo ?? "yok");
    out.push(`Z no: ${z.zNo ?? (foy.kasalar.length > 1 ? `yok (${foy.kasalar.length} kasa: ${zNos.join(", ")})` : "yok")}`);
    out.push(`Ciro: ${money(z.zTotal)} · ciro dışı ${money(z.offRevenue)} · adisyon ${z.receipts} · kişi ${z.covers ?? "–"} · bahşiş ${money(z.tips)}`);
    out.push("");
    out.push("Kasa raporunun alanları (panelin eşlemesi):");
    out.push(`  Fiş sayısı: ${z.foysuz ? "– (kasa yok)" : z.receipts}`);
    out.push(`  Toplam satış: ${money(z.zTotal)}`);
    out.push(`  Nakit: ${money(z.cash)}`);
    out.push(`  Kredi / banka kartı: ${money(z.card)}`);
    out.push(`  Yemek kartı: ${money(z.mealCard)}`);
    out.push(`  Online: ${money(z.online)}`);
    out.push(`  Diğer: ${money(z.other)}`);
    out.push(`  Ödenmez / ikram (ciro dışı): ${money(z.offRevenue)}`);
    if (!z.foysuz) {
      out.push(`  Açılış: ${money(z.openingCash)}`);
      out.push(`  Gün içinde çıkan (ModPOS gideri, bilgi): ${money(z.cashOut)}`);
      out.push(`  Gün içinde giren (nakit cari tahsilat, bilgi): ${money(z.cashIn)}`);
      out.push(`  Olması gereken nakit (ModPOS): ${money(z.expectedCash)}`);
    }
    out.push(z.countedCash !== null ? `  Sayılan nakit: ${money(z.countedCash)} · kasa farkı ${money(z.cashDiff)}` : `  Sayılan nakit yok: ${z.noCount ? NO_COUNT_TEXT[z.noCount] : "föyde Z raporuna dayanan sayım yok"}`);
    if (z.cardCollections) out.push(`  Kartla alınan cari tahsilat (banka POS'unda var, Z'nin kartında yok): ${money(z.cardCollections)}`);
    if (Math.abs(z.paymentsGap) >= 0.01) out.push(`  ! Ödemelerin ciroya dahil toplamı ciroyu tutmuyor: ${money(z.paymentsGap)} (föy kendi içinde tutmuyor)`);
    if (z.unknownCodes.length) out.push(`  ! Kitapçıkta olmayan ödeme kodu: ${z.unknownCodes.join(", ")} (ciroya dahilse Diğer'e)`);
    if (z.foysuzCiro && !z.foysuz) out.push(`  Föysüz satış (kasa açılmamış şube; toplamlara girmez): ${money(z.foysuzCiro)}`);
  }
  for (const k of foy.kasalar) {
    out.push("");
    out.push(...kasaLines(k, foy.kasalar.length > 1));
  }
  for (const f of foy.foysuzGunler) {
    out.push("");
    out.push(`Föysüz satış: ${f.sube || "adsız şube"} · ciro ${money(f.ciro)} · adisyon ${f.adisyonSayisi ?? "–"}`);
    for (const p of f.odemeler) out.push(`  ${p.kod} (${p.yontem}): ${money(p.tutar)} → ${BUCKET_TEXT[modposBucket({ kod: p.kod, ciroyaDahil: true })]}`);
  }
  // Kişiler (sahibin kararı: föy kişi adlarıyla saklanır, yalnız yöneticiye) ve kitapçıkta olmayan alanlar
  const people = foy.kasalar.flatMap((k) => [
    k.acilis.personel ? `açan ${k.acilis.personel}` : null,
    k.kapanis.personel ? `kapatan ${k.kapanis.personel}` : null,
    ...k.araKasalar.map((a) => (a.personel ? `${a.no ?? ""}. ara kasa ${a.personel}`.trim() : null)),
    ...k.cariTahsilatlar.kalemler.map((t) => (t.musteri ? `cari tahsilat ${t.musteri} (${money(t.tutar)})` : null)),
  ]).filter((t): t is string => t !== null);
  out.push("");
  out.push(people.length ? `Kişiler: ${people.join(" · ")}` : "Kişiler: föyde ad yok");
  if (foy.ekAlanlar?.length) {
    out.push(`Kitapçıkta olmayan alanlar (${foy.ekAlanlar.length}):`);
    for (const e of foy.ekAlanlar) out.push(`  ${e.yol}: ${e.deger || "(boş)"}`);
  }
  const warnings = foyWarnings(foy);
  out.push("");
  if (warnings.length) {
    out.push("Uyarılar (ModPOS):");
    for (const w of warnings) {
      const known = (MODPOS_UYARI as Record<string, string>)[w.kod];
      out.push(`  ${w.kod}: ${w.mesaj || known || "–"}${w.tutar !== null ? ` (${money(w.tutar)})` : ""}`);
    }
  } else out.push("Uyarılar (ModPOS): yok");
  if (o.quota) {
    const left = quotaLeft(o.quota, o.now);
    out.push(`Kalan hak (bugün): ${left} / ${o.quota.hak}${left < o.quota.hak ? ` · hak ${renewText(quotaRenewsAt(o.quota, o.now), o.now)} yenilenir` : ""}`);
  } else if (foy.kota) {
    const k = foy.kota;
    out.push(`Kalan hak (föyde): ${k.kalan ?? "–"} / ${k.gunlukHak ?? "–"}${k.yenilenme ? ` · yenilenme ${timeText(k.yenilenme, o.now)}` : ""}`);
  } else out.push("Kalan hak: bilinmiyor (yanıtta kota yok)");
  return out;
}

/** Sunucu modülleri ("server-only") komut satırında yüklenebilsin: işaret paketi Next'in derlemesi dışında hata fırlatır */
function allowServerModules() {
  const require = createRequire(import.meta.url);
  const marker = require.resolve("server-only");
  require.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeJS.Module;
}

/** Çalıştırır; çıkış kodu döner. Her satır anahtardan temizlenerek yazılır */
export async function runModposFoy(argv: string[], env: Record<string, string | undefined> = process.env, now: Date = new Date()): Promise<number> {
  const key = env.MODPOS_API_KEY?.trim();
  const clean = (s: string) => (key && key.length >= 8 ? s.split(key).join("[anahtar]") : s);
  const say = (s = "") => console.log(clean(s));
  const fail = (s: string) => {
    console.error(clean(`✗ ${s}`));
    return 1;
  };
  let args: FoyArgs;
  try {
    args = parseFoyArgs(argv, now);
  } catch (e) {
    return fail((e as Error).message);
  }
  const dbUrl = args.save ? databaseUrl(env) : undefined;
  if (args.save && !dbUrl) return fail("DATABASE_URL tanımlı değil (--kaydet veritabanına yazar)");
  allowServerModules();

  // Dosya: istek yok
  if (args.file) {
    let body: string;
    try {
      body = readFileSync(resolve(args.file), "utf8");
    } catch (e) {
      return fail(`Dosya okunamadı: ${(e as Error).message}`);
    }
    const parsed = parseKasaFoyu(body, args.day ?? undefined);
    if (!parsed.ok) {
      if ("hata" in parsed) return fail(`ModPOS hata döndü: ${parsed.hata.kod}${parsed.hata.mesaj ? ` · ${parsed.hata.mesaj}` : ""}`);
      const own = args.day && parsed.bozuk === "kasaGunu" ? parseKasaFoyu(body) : null;
      if (own?.ok) return fail(`Dosyanın kasa günü ${own.foy.kasaGunu}, istenen gün ${args.day}: başka günün föyü`);
      return fail(parsed.bozuk === "govde" ? "Dosya iyi biçimli bir kasa föyü XML'i değil (yarıda kesilmiş ya da başka bir belge)" : `Dosya okunamadı: ${parsed.bozuk} alanı bozuk ya da eksik`);
    }
    for (const l of foySummaryLines(parsed.foy, { now, fetchedAt: null, quota: null })) say(l);
    say();
    if (!args.save) {
      say("Veritabanına yazılmadı (--kaydet ile yazılır). İstek gönderilmedi.");
      return 0;
    }
    const { createDb } = await import("../src/server/db");
    const { storeFoy } = await import("../src/server/modpos/store");
    say(`Hedef: ${databaseTarget(dbUrl!).label}`);
    const db = createDb(dbUrl!, 1);
    try {
      const r = await storeFoy(db, parsed.foy, now, body);
      say(`✓ Veritabanına yazıldı: ${r.change === "yeni" ? "yeni föy" : r.change === "degisti" ? `föy değişti (sürüm ${r.revision})` : "föy aynı (yalnız çekilme anı)"} · ${r.final ? "kesin" : "kesin değil"}`);
      return 0;
    } finally {
      await db.$client.end();
    }
  }

  // ModPOS'tan çekme
  const day = args.day!;
  const problem = modposKeyProblem(env);
  if (problem === "missing") return fail("MODPOS_API_KEY tanımlı değil: .env.local'a ya da komutun önüne yazın (anahtar ekrana yazılmaz)");
  if (problem === "format") return fail("MODPOS_API_KEY'in biçimi bozuk (boşluk ya da satır sonu var, ya da çok kısa)");
  if (!args.save) {
    const { fetchKasaFoyu } = await import("../src/server/modpos/client");
    say(`İstek: ${day} (günün çekim haklarından birini kullanır; panelin kalan hak bilgisi güncellenmez)`);
    const r = await fetchKasaFoyu(day, { env, now });
    if (r.status === "off") return fail("MODPOS_API_KEY tanımlı değil");
    if (r.status === "kota") return fail(r.text);
    if (r.status === "error") return fail(`${r.text} (${r.kod}${r.http ? `, HTTP ${r.http}` : ""})`);
    say();
    for (const l of foySummaryLines(r.foy, { now, fetchedAt: now, quota: r.quota })) say(l);
    say();
    say("Veritabanına yazılmadı (--kaydet ile yazılır).");
    return 0;
  }
  // --kaydet: panelin "Bu günü çek"iyle aynı koşucu (kalan hak saklanan kotadan; sonuç, kota ve çalışma kaydı yazılır)
  const { createDb } = await import("../src/server/db");
  const { syncModpos } = await import("../src/server/modpos/sync");
  const { loadModposSheet } = await import("../src/server/modpos/store");
  say(`Hedef: ${databaseTarget(dbUrl!).label}`);
  const db = createDb(dbUrl!, 1);
  try {
    const r = await syncModpos("elle", { days: [day], db, env, now, deadlineAt: Date.now() + 75_000 });
    if (r.status === "preview") return fail("Önizleme ortamı (VERCEL_ENV=preview): çekilmez");
    if (r.status === "off") return fail("MODPOS_API_KEY tanımlı değil");
    if (r.status === "kota") return fail(r.error ?? "ModPOS'un bugünkü çekim hakkı doldu");
    if (r.status === "nothing" || !r.days.length) return fail("Çekilecek gün yok");
    const d = r.days[0];
    if (d.result === "hata") return fail(d.text ?? r.error ?? "ModPOS API verisi alınamadı");
    const sheet = await loadModposSheet(day, db);
    if (sheet) {
      say();
      for (const l of foySummaryLines(sheet.foy, { now, fetchedAt: new Date(sheet.fetchedAt), quota: null })) say(l);
    }
    say();
    say(`✓ Veritabanına yazıldı: ${d.result === "yeni" ? "yeni föy" : d.result === "degisti" ? `föy değişti (sürüm ${d.revision})` : "föy aynı (yalnız çekilme anı)"} · kalan hak ${r.left ?? "bilinmiyor"}`);
    return 0;
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1]?.endsWith("modpos-foy.ts")) {
  loadEnvConfig(process.cwd());
  runModposFoy(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      const key = process.env.MODPOS_API_KEY?.trim();
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ ${key && key.length >= 8 ? msg.split(key).join("[anahtar]") : msg}`);
      process.exit(1);
    },
  );
}
