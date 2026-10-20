// Faturalar ekranında belge: hangi dosya olduğu gibi gider / küçültülür / reddedilir, adresler, dosya adı, özet ve
// hata metinleri (src/app/panel/faturalar/document-rules.ts).
// Çalıştırma: npx tsx --test tests/faturalar-belge.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canHaveDocument,
  COMPRESS_OVER_BYTES,
  documentErrorText,
  documentKind,
  documentSummary,
  documentUrl,
  fileNameFromDisposition,
  fitWithin,
  groupDocuments,
  isParasutDocument,
  isRetryable,
  jpegName,
  sizeError,
  uploadErrorText,
  uploadKindOf,
  uploadPlan,
} from "../src/app/panel/faturalar/document-rules";
import { contentDisposition, MAX_UPLOAD_BYTES } from "../src/lib/documents";

const MB = 1024 * 1024;

test("uploadPlan: PDF olduğu gibi gider, 4 MB'tan büyüğü reddedilir", () => {
  assert.deepEqual(uploadPlan({ name: "fatura.pdf", type: "application/pdf", size: 900_000 }), { action: "send" });
  assert.deepEqual(uploadPlan({ name: "fatura.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES }), { action: "send" });
  const big = uploadPlan({ name: "tarama.pdf", type: "application/pdf", size: 6 * MB });
  assert.equal(big.action, "reject");
  assert.match(big.action === "reject" ? big.error : "", /6,0 MB.*4 MB/);
});

test("uploadPlan: küçük JPEG olduğu gibi; büyük JPEG ve JPEG olmayan fotoğraf küçültülür", () => {
  assert.deepEqual(uploadPlan({ name: "IMG_1.jpg", type: "image/jpeg", size: 800_000 }), { action: "send" });
  assert.deepEqual(uploadPlan({ name: "IMG_1.jpg", type: "image/jpeg", size: COMPRESS_OVER_BYTES }), { action: "send" });
  assert.deepEqual(uploadPlan({ name: "IMG_1.jpg", type: "image/jpeg", size: COMPRESS_OVER_BYTES + 1 }), { action: "compress" });
  // 4 MB'tan büyük fotoğraf da reddedilmez: küçültülünce sığar
  assert.deepEqual(uploadPlan({ name: "IMG_2.jpg", type: "image/jpeg", size: 9 * MB }), { action: "compress" });
  assert.deepEqual(uploadPlan({ name: "ekran.png", type: "image/png", size: 120_000 }), { action: "compress" });
  assert.deepEqual(uploadPlan({ name: "foto.webp", type: "image/webp", size: 90_000 }), { action: "compress" });
  assert.deepEqual(uploadPlan({ name: "IMG_3.HEIC", type: "image/heic", size: 2 * MB }), { action: "compress" });
});

test("uploadPlan: tür boşsa uzantıya bakılır; desteklenmeyen ve boş dosya reddedilir", () => {
  assert.equal(uploadKindOf({ name: "Fatura.PDF", type: "" }), "pdf");
  assert.equal(uploadKindOf({ name: "foto.jpeg", type: "application/octet-stream" }), "image");
  assert.equal(uploadKindOf({ name: "liste.xlsx", type: "" }), null);
  assert.deepEqual(uploadPlan({ name: "foto.jpg", type: "", size: 500_000 }), { action: "send" });
  assert.deepEqual(uploadPlan({ name: "Fatura.PDF", type: "", size: 500_000 }), { action: "send" });
  const word = uploadPlan({ name: "not.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10_000 });
  assert.deepEqual(word, { action: "reject", error: "Yalnız PDF ya da fotoğraf (JPG, PNG, WebP) yüklenebilir." });
  assert.equal(uploadPlan({ name: "bos.pdf", type: "application/pdf", size: 0 }).action, "reject");
});

test("sizeError: küçültmeden sonra da sınırı aşan dosya", () => {
  assert.equal(sizeError(MAX_UPLOAD_BYTES), null);
  assert.equal(sizeError(MAX_UPLOAD_BYTES + 1), "Dosya 4,0 MB; en çok 4 MB yüklenebilir.");
});

test("fitWithin: en uzun kenar 2000px, oran korunur, küçük görsel büyütülmez", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(1200, 900), { width: 1200, height: 900 });
  assert.deepEqual(fitWithin(2000, 2000), { width: 2000, height: 2000 });
  assert.deepEqual(fitWithin(8000, 100), { width: 2000, height: 25 });
  assert.deepEqual(fitWithin(10000, 1), { width: 2000, height: 1 });
  assert.deepEqual(fitWithin(500, 400, 100), { width: 100, height: 80 });
});

test("jpegName: uzantı .jpg olur, adsız dosyaya ad verilir", () => {
  assert.equal(jpegName("IMG_1234.HEIC"), "IMG_1234.jpg");
  assert.equal(jpegName("ekran görüntüsü.png"), "ekran görüntüsü.jpg");
  assert.equal(jpegName("fatura.tar.webp"), "fatura.tar.jpg");
  assert.equal(jpegName("foto"), "foto.jpg");
  assert.equal(jpegName(".png"), "fotograf.jpg");
  assert.equal(jpegName(""), "fotograf.jpg");
});

test("fileNameFromDisposition: sunucunun başlığından Türkçe ad geri okunur", () => {
  assert.equal(fileNameFromDisposition(contentDisposition("inline", "Sütaş_2026-10-14_STS1.pdf")), "Sütaş_2026-10-14_STS1.pdf");
  assert.equal(fileNameFromDisposition(contentDisposition("attachment", "Kaldi_2026-10-12.jpg")), "Kaldi_2026-10-12.jpg");
  assert.equal(fileNameFromDisposition('inline; filename="eski.pdf"'), "eski.pdf");
  assert.equal(fileNameFromDisposition("attachment; filename=duz.pdf"), "duz.pdf");
  // Bozuk UTF-8 kodlaması: düz ada düşülür
  assert.equal(fileNameFromDisposition(`inline; filename="yedek.pdf"; filename*=UTF-8''%E0%A4%A`), "yedek.pdf");
  assert.equal(fileNameFromDisposition(null), null);
  assert.equal(fileNameFromDisposition("inline"), null);
});

test("documentKind: PDF, görsel, diğer", () => {
  assert.equal(documentKind("application/pdf"), "pdf");
  assert.equal(documentKind("application/pdf; charset=binary"), "pdf");
  assert.equal(documentKind("image/jpeg"), "image");
  assert.equal(documentKind("IMAGE/PNG"), "image");
  assert.equal(documentKind("application/json"), "other");
  assert.equal(documentKind(null), "other");
});

test("documentUrl: asıl belge, belirli dosya ve indirme", () => {
  assert.equal(documentUrl(42), "/api/faturalar/42/belge");
  assert.equal(documentUrl(42, { download: true }), "/api/faturalar/42/belge?indir=1");
  assert.equal(documentUrl(42, { docId: 7 }), "/api/faturalar/42/belge?belge=7");
  assert.equal(documentUrl(42, { docId: 7, download: true }), "/api/faturalar/42/belge?belge=7&indir=1");
  assert.equal(documentUrl(42, { docId: null }), "/api/faturalar/42/belge");
});

test("canHaveDocument: Paraşüt'e bağlı ya da dosya yüklenmiş faturada belge düğmesi çıkar", () => {
  assert.equal(isParasutDocument({ eInvoiceId: "e1" }), true);
  assert.equal(isParasutDocument({ externalId: "9001" }), true);
  assert.equal(isParasutDocument({ eInvoiceId: null, externalId: null }), false);
  assert.equal(canHaveDocument({ eInvoiceId: "e1", externalId: null }, 0), true);
  assert.equal(canHaveDocument({ externalId: "9001" }, 0), true);
  // Elle / Excel'le girilmiş: yalnız fotoğraf yüklenmişse
  assert.equal(canHaveDocument({}, 0), false);
  assert.equal(canHaveDocument({}, 1), true);
});

test("groupDocuments: faturaya göre, gelen sıra (yeni önce) korunur", () => {
  const docs = [
    { id: 9, invoiceId: 2 },
    { id: 8, invoiceId: 1 },
    { id: 5, invoiceId: 2 },
  ];
  assert.deepEqual(groupDocuments(docs), { 1: [{ id: 8, invoiceId: 1 }], 2: [{ id: 9, invoiceId: 2 }, { id: 5, invoiceId: 2 }] });
  assert.deepEqual(groupDocuments([]), {});
});

test("documentSummary: e-fatura, Paraşüt gider faturası, yalnız yükleme, belgesiz", () => {
  const upload = { source: "upload" as const };
  const parasut = { source: "parasut" as const };
  assert.deepEqual(documentSummary({ eInvoiceId: "e1" }, []), { title: "E-fatura PDF'i", hint: "Paraşüt'ten gelir" });
  assert.deepEqual(documentSummary({ eInvoiceId: "e1" }, [parasut, upload]), { title: "E-fatura PDF'i", hint: "Paraşüt'ten gelir · 1 dosya eklendi" });
  assert.equal(documentSummary({ externalId: "9001" }, []).title, "Paraşüt belgesi");
  assert.deepEqual(documentSummary({}, [upload, upload]), { title: "2 dosya eklendi", hint: "Fotoğraf ya da PDF" });
  assert.equal(documentSummary({}, [upload]).title, "1 dosya eklendi");
  assert.equal(documentSummary({}, []).title, "Belge yok");
});

test("hata metinleri: sunucunun JSON hatası olduğu gibi, yoksa duruma göre Türkçe", () => {
  const parasut = "Paraşüt bu fatura için belge vermedi (elle girilmiş fiş olabilir). Fotoğrafını ya da PDF'ini ekleyebilirsiniz.";
  assert.equal(documentErrorText(404, { error: parasut }), parasut);
  assert.equal(documentErrorText(502, { error: "Paraşüt'ten alınamadı: zaman aşımı" }), "Paraşüt'ten alınamadı: zaman aşımı");
  assert.equal(documentErrorText(502, null), "Paraşüt'e ulaşılamadı; biraz sonra yeniden deneyin.");
  assert.equal(documentErrorText(0, null), "Bağlantı kurulamadı; internetinizi kontrol edip yeniden deneyin.");
  assert.equal(documentErrorText(403, "<html>"), "Oturum kapanmış; sayfayı yenileyip yeniden giriş yapın.");
  assert.equal(documentErrorText(404, { error: "  " }), "Belge bulunamadı; silinmiş olabilir.");
  assert.equal(uploadErrorText(415, { error: "Yalnız PDF, JPG, PNG ya da WebP yüklenebilir." }), "Yalnız PDF, JPG, PNG ya da WebP yüklenebilir.");
  // Barındırmanın kendi 413'ü JSON değildir
  assert.equal(uploadErrorText(413, null), "Dosya çok büyük; en çok 4 MB yüklenebilir.");
  assert.equal(uploadErrorText(500, {}), "Dosya kaydedilemedi; biraz sonra yeniden deneyin.");
  assert.equal(uploadErrorText(400, null), "Dosya yüklenemedi (hata 400).");
  assert.equal(isRetryable(0), true);
  assert.equal(isRetryable(502), true);
  assert.equal(isRetryable(404), false);
});
