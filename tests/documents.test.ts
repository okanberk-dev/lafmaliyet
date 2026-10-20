import assert from "node:assert/strict";
import { test } from "node:test";

import { contentDisposition, documentFileName, formatBytes, parasutPhotoUrl, sniffMime } from "../src/lib/documents";

test("dosya türü içerikten tanınır", () => {
  assert.equal(sniffMime(new TextEncoder().encode("%PDF-1.7\n...")), "application/pdf");
  assert.equal(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffMime(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffMime(new TextEncoder().encode("<html>")), null);
  assert.equal(sniffMime(new TextEncoder().encode("%PD")), null);
});

test("dosya adı Türkçe harfleri sadeleştirir", () => {
  assert.equal(documentFileName({ supplier: "Sütaş Süt Ürünleri A.Ş.", date: "2026-10-14", invoiceNo: "STS2026000001234", mime: "application/pdf" }), "Sutas-Sut-Urunleri-A-S_2026-10-14_STS2026000001234.pdf");
  assert.equal(documentFileName({ supplier: "Kaldi", date: "2026-10-12T00:00:00", invoiceNo: null, mime: "image/jpeg" }), "Kaldi_2026-10-12.jpg");
  assert.equal(documentFileName({ supplier: "???", date: "2026-10-12", mime: "image/png" }), "fatura_2026-10-12.png");
});

test("indirme başlığı ASCII ve UTF-8 adı birlikte verir", () => {
  assert.equal(contentDisposition("attachment", "Kaldi_2026-10-12.pdf"), `attachment; filename="Kaldi_2026-10-12.pdf"; filename*=UTF-8''Kaldi_2026-10-12.pdf`);
  const h = contentDisposition("inline", 'Süt "fatura".pdf');
  assert.ok(h.startsWith('inline; filename="S_t _fatura_.pdf"'));
  assert.ok(h.includes("filename*=UTF-8''S%C3%BCt%20%22fatura%22.pdf"));
});

test("Paraşüt fotoğraf alanının farklı biçimleri", () => {
  assert.equal(parasutPhotoUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
  assert.equal(parasutPhotoUrl({ url: "https://cdn.example.com/b.jpg" }), "https://cdn.example.com/b.jpg");
  assert.equal(parasutPhotoUrl({ original: { url: "https://cdn.example.com/c.jpg" } }), "https://cdn.example.com/c.jpg");
  assert.equal(parasutPhotoUrl({ url: null }), null);
  assert.equal(parasutPhotoUrl("http://insecure.example.com/x.jpg"), null);
  assert.equal(parasutPhotoUrl(null), null);
});

test("boyut yazımı", () => {
  assert.equal(formatBytes(500), "500 B");
  assert.equal(formatBytes(88_000), "86 KB");
  assert.equal(formatBytes(1_300_000), "1,2 MB");
});
