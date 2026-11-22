# Özel günler

Maç, AVM etkinliği, kampanya ve "kafe kapalı" günleri. **Takvim notudur:** hiçbir hesaba, rapora ya da toplama
girmez; ekranda ve bildirimde görünür, kapalı gün akışını besler.

Satış tahmini 4 Kasım 2026'da tamamen kaldırıldı (sahibin isteği). Özel günler kaldı, çünkü kapalı gün akışı,
Bugün ekranı, zil ve Komisyon ekranı bunları okuyor. "Beklenen etki" yüzdesi (+%15, −%30 …) artık hiçbir sayıyı
değiştirmez; notun yanında bir ipucu olarak durur ve eski kayıtlar okunabilsin diye alan korundu.

## Ekran

**Kafe → Özel günler** (`/panel/ozel-gunler`), iki role de açık:

- **Yönetici** bütün listeyi görür ve düzenler: ekleme, düzenleme, silme; geçmiş (son 60 gün) ayrı bölümde.
  En çok 14 gün süren bir kayıt, ileriye en çok 1 yıl.
- **Personel** yalnız kendi girdiklerini ekler ve siler; onaysızdır ama sınırlıdır (yarından 60 güne,
  `STAFF_SPECIAL_LIMITS`). Yöneticinin dokunduğu satırı personel artık değiştiremez.

Aynı günlerde aynı adla ikinci bir kayıt engellenir (aynı maç iki kez girilmesin).

Personelin onaylanmış "Kafe kapalıydı" bildiriminin satırı silinir ya da düzenlenip o günü artık kapatmazsa (tür, gün
ya da şube değişti) bildirim "geri alındı" olur; personelin İsteklerim'inde ve zilinde bayat bir "onaylandı" kalmaz
(denetim SB-04; [KASA-RAPORU.md](KASA-RAPORU.md) › Kafe kapalıydı).

## Kod

| Ne | Nerede |
|---|---|
| Metinler ve kurallar (saf) | `src/lib/ozel-gun.ts` |
| Türkçe takvim (bayram, hafta günü, tarih biçimi) | `src/lib/takvim.ts` |
| Okuma ve pencere | `src/server/special-days.ts` |
| Personelin girdileri | `src/server/staff-special.ts` |
| Yöneticinin eylemleri | `src/server/actions/special-days.ts` |
| Personelin eylemleri | `src/server/actions/special-days-staff.ts` |
| Ekran | `src/app/panel/ozel-gunler/` |

Kapalı gün akışı `docs/KASA-RAPORU.md` ve `docs/ONAYLAR.md`'de.
