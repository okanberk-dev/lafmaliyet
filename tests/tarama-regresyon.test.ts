// Belge tarayıcı: regresyon örnekleri (tests/fixtures/tarama; `npx tsx scripts/tarama-veri.ts --fixture` üretir).
// Telefonla çekilmiş gibi on sentetik fotoğraf (540×720, JPEG < 60 KB): ahşapta eğik Pavo Z, beyaz tezgâhta uzun market
// fişi, koyu tezgâhta banka batch fişi, mermerde karanlık ve odak bulanık A4 fatura, gri masada ModPOS Z, elde 58 mm
// fiş, üst ucu kadraj dışında kalan gün sonu fişi, kareyi dolduran A4, belge olmayan POS ekranı ve koli. Her görselde
// çekirdeğin kararı (kırp / kareyi dolduruyor / belge yok) ve köşe hatası (en kötü köşe, köşegenin oranı) bugünkü
// sonucun biraz gevşeğiyle sınanır; bilinen hatalar yalnız kötüleşmesin diye gevşek tutulur. Çekirdek iyileşince
// eşikleri sıkılaştırın (`npm run tarama:olc -- --fixture --ocr 0` bugünkü değerleri yazar). Ayrıca ölçümün kendi
// hesapları (köşe hatası, karakter doğruluğu, tutar bulma). docs/FOTOGRAF.md › Tarayıcının ölçümü.
// Çalıştırma: npx tsx --test tests/tarama-regresyon.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { scanDocument } from "../src/lib/scan";
import {
  dortgen,
  gorselOku,
  karakterDogrulugu,
  koseHatasi,
  sharpAl,
  sonucu,
  tutarBulma,
  type Karar,
  type VeriYaniti,
} from "../scripts/tarama/olcu";

const DIZIN = join(__dirname, "fixtures/tarama");
const yanit = JSON.parse(readFileSync(join(DIZIN, "yanit.json"), "utf8")) as VeriYaniti;

/**
 * Bugünkü sonuç (çekirdek: wip/tarama-2) ve eşik. `hata`: en kötü köşe, köşegenin oranı, en çok; `karar`: kabul edilen
 * kararlar; `bilinen`: bugün yanlış (eşik yalnız kötüleşmeyi yakalar; düzelince sıkılaştırın).
 */
const BEKLENTI: Record<string, { karar?: Karar[]; hata?: number; bilinen?: string }> = {
  // bugün %0,01
  "000-pavo-z-ahsap": { karar: ["kirp"], hata: 0.012 },
  "001-market-uzun-beyaz-tezgah": {
    karar: ["kirp"],
    hata: 0.15,
    bilinen: "beyaz tezgâhta parlamalı uzun fiş: soluk sol kenar bulunmuyor, dörtgen yazının içinden geçiyor (bugün hata %10,2)",
  },
  // bugün %0,01
  "002-banka-batch-koyu-tezgah": { karar: ["kirp"], hata: 0.012 },
  // bugün %0,1 (karanlık, odak bulanık A4; önce dörtgen kâğıttan taşıyordu, hata %28,5)
  "003-fatura-a4-mermer": { karar: ["kirp"], hata: 0.012 },
  // bugün %0,07
  "004-modpos-z-gri-masa": { karar: ["kirp"], hata: 0.012 },
  // bugün %0,04
  "005-market-58-elde": { karar: ["kirp"], hata: 0.012 },
  // bugün %0,45 (üst kenar karenin kenarında)
  "006-pavo-gunsonu-ahsap-kadraj-disi": { karar: ["kirp"], hata: 0.015 },
  // bugün "kareyi dolduruyor"
  "007-fatura-a4-gri-masa-yakin": { karar: ["tam-kare", "yok"] },
  // renkli döşemeli POS ekranı: belge yok (renkli içerik)
  "008-degil-ekran-pos-koyu-tezgah": { karar: ["yok"] },
  // koli: belge yok (yazısız ince şerit, bandı)
  "009-degil-kutu-ahsap": { karar: ["yok"] },
};
/** Bugün 10 görselin 9'u doğru; azalmasın */
const EN_AZ_DOGRU = 9;

test("regresyon örnekleri: on görsel, her biri < 60 KB, yanıtta köşe ve kategori", () => {
  assert.equal(yanit.gorseller.length, 10);
  for (const g of yanit.gorseller) {
    assert.ok(existsSync(join(DIZIN, g.dosya)), g.dosya);
    assert.ok(statSync(join(DIZIN, g.dosya)).size < 60_000, `${g.dosya} 60 KB'tan büyük`);
    assert.ok(g.ad in BEKLENTI, `${g.ad} için beklenti yok`);
    if (g.beklenen === "belge-degil") assert.equal(g.koseler, null);
    else assert.equal(g.koseler?.length, 4);
  }
});

test("regresyon örnekleri: karar ve köşe hatası bugünkünden kötü değil", async (t) => {
  try {
    await sharpAl();
  } catch {
    t.skip("sharp yok (JPEG çözülemiyor)");
    return;
  }
  let dogruSayisi = 0;
  const ozet: string[] = [];
  for (const g of yanit.gorseller) {
    const img = await gorselOku(join(DIZIN, g.dosya));
    assert.equal(img.width, g.genislik);
    const r = scanDocument(img, { deskew: false, maxEdge: 400 });
    const karar: Karar = r.fillsFrame ? (r.method === "tam-kare" ? "tam-kare" : "yok") : "kirp";
    const hata = g.koseler ? koseHatasi(r.corners, dortgen(g.koseler), img.width, img.height).enKotu : null;
    const sonuc = sonucu(g.beklenen, karar, hata);
    if (sonuc === "dogru") dogruSayisi++;
    ozet.push(`${g.ad}: ${karar} ${hata == null ? "" : `%${(hata * 100).toFixed(2)}`} ${sonuc}`);
    const b = BEKLENTI[g.ad];
    if (b.karar) assert.ok(b.karar.includes(karar), `${g.ad}: karar ${karar}, beklenen ${b.karar.join("/")}`);
    if (b.hata != null && hata != null) assert.ok(hata <= b.hata, `${g.ad}: köşe hatası %${(hata * 100).toFixed(2)} > %${(b.hata * 100).toFixed(1)}`);
  }
  for (const s of ozet) t.diagnostic(s);
  assert.ok(dogruSayisi >= EN_AZ_DOGRU, `doğru ${dogruSayisi}/10 < ${EN_AZ_DOGRU}\n${ozet.join("\n")}`);
});

test("ölçüm: köşe hatası köşe sırasından bağımsız (döngüsel kayma, ters yön)", () => {
  const q = dortgen([
    [10, 10],
    [110, 12],
    [108, 210],
    [8, 205],
  ]);
  assert.equal(koseHatasi(q, q, 300, 400).enKotu, 0);
  const kaymis = [q[2], q[3], q[0], q[1]];
  assert.equal(koseHatasi(kaymis, q, 300, 400).enKotu, 0);
  const ters = [q[0], q[3], q[2], q[1]];
  assert.equal(koseHatasi(ters, q, 300, 400).enKotu, 0);
  const oynak = [{ x: 15, y: 10 }, q[1], q[2], q[3]];
  const h = koseHatasi(oynak, q, 300, 400);
  assert.ok(Math.abs(h.enKotu - 5 / 500) < 1e-9);
  assert.ok(Math.abs(h.ort - 5 / 4 / 500) < 1e-9);
});

test("ölçüm: karar sonucu (kaçan, yanlış pozitif, kareyi dolduran)", () => {
  assert.equal(sonucu("kirp", "kirp", 0.01), "dogru");
  assert.equal(sonucu("kirp", "kirp", 0.05), "yanlis");
  assert.equal(sonucu("kirp", "yok", 0.3), "kacan");
  assert.equal(sonucu("kirp", "tam-kare", 0.3), "kacan");
  assert.equal(sonucu("tam-kare", "tam-kare", 0), "dogru");
  assert.equal(sonucu("tam-kare", "kirp", 0.01), "dogru");
  assert.equal(sonucu("tam-kare", "kirp", 0.2), "yanlis");
  assert.equal(sonucu("belge-degil", "yok", null), "dogru");
  assert.equal(sonucu("belge-degil", "kirp", null), "yanlis");
});

test("ölçüm: karakter doğruluğu ve tutar bulma", () => {
  const bilinen = "TOPLAM %10 *1.234,56\nKDV %10 *112,23";
  assert.equal(karakterDogrulugu("toplam %10 *1.234,56   kdv %10 *112,23", bilinen), 1);
  assert.ok(karakterDogrulugu("TOPLAM %1O *1.234,56 KDV %10 *112,23", bilinen) > 0.95);
  assert.equal(karakterDogrulugu("", bilinen), 0);
  assert.equal(tutarBulma("TOPLAM *1.234,56 KDV *112,28", bilinen), 0.5);
  assert.equal(tutarBulma("1.234, 56 ve 112 ,23", bilinen), 1);
  assert.equal(tutarBulma("yazı", "tutar yok"), null);
});
