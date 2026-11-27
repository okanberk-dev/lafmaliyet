# DURUM (bulut oturumu günlüğü)

Bu dosya yalnız `claude/lafmaliyet-lafpos-devam-ee29y5` dalında durur, main'e girmez. Mac'teki
`~/Downloads/lafmaliyet-ekler/DURUM.md`'nin devamıdır: bu oturum bulutta çalışıyor ve Mac'teki dosyalara erişemiyor
(DURUM.md, DENETIM-2026-11-27.md, RAPOR-ara, yedek klasörü, p8-kdv görselleri, `~/Downloads/lafmaliyet-p5` kopyası).
Saatler İstanbul saatidir.

## Ortam farkları (bu oturum)

- Depolar: `/workspace/lafmaliyet`, `/workspace/lafpos`, `/workspace/laffogato` (GitHub'dan taze klon).
- `get_usage` aracı yok: kullanım yüzdesi okunamıyor. Saatlik tetik (her saatin 07'si) kuruldu; yalnız durum ve sıra kontrolü yapar.
- Yerel `lm_yedek_prova` yok. Göç provası için canlı veri kopyası gerekir (Blob'daki otomatik yedek); göçlü işte ayrıca not düşülecek.
- Commit kimliği depodaki önceki commit'lerle aynı tutuldu (yapay zekâ izi yok kuralı).

## Günlük

- **27 Kas 23:40** Oturum açıldı. Üç depo klonlandı, panel bağımlılıkları kuruldu, yerel Postgres 16 açıldı. Açık PR: panel 0, kasa 0, site yalnız #297 (dokunulmuyor).
- **27 Kas 23:44** İş 1 (kasa #191): kanal #191 derlemesini yayımlıyor (build 1795803043). Kasanın son nabzı 22:28, son özeti 22:29 (gün kapandı). Kurulu derleme hâlâ eski (1795757630), güncelleme "bekliyor", seçim "gün sonunda". 22:30'dan beri nabız yok: bilgisayar gün kapanınca kapatılmış görünüyor (bu sabahki kurulum da 10:15'te, açılışta olmuş). Uzaktan `/api/health` 200. Sabah açılışta yeniden bakılacak.
