# TokenX kablolu: "Cihaz görünmedi" — kök neden (28 Kasım 2026, doğrulandı)

Sahibin bildirdiği: kasada Yönetim › Yazarkasa POS › Token kablolu › "Kurulumu yap" → "Cihaz görünmedi; Token sürücüsü
kuruluyor (birkaç dakika sürebilir)".

## Kök neden
`server/okc/token-kablo-kurulum.ts` › `installDriver()` Token'ın "TokenX Connect (Wired) Sürücü Kurulum Aracı v2.9.3"
zip'ini indirir (SHA-256 sabit, hâlâ tutuyor: 82c81d1d…86b3, 57.603.722 bayt), içindeki tek .exe'yi
`Start-Process … -ArgumentList '/quiet','/norestart' -Wait` ile çalıştırır. Koddaki yorum aracı "WiX" sanıyor. DEĞİL:

- Zip'teki `TokenX Connect (Wired) Sürücü Kurulum Aracı v2.9.3.exe` (66.132.992 bayt) bir **.NET WinForms sihirbazı**
  (assembly `hizlisepetcheck` 2.9.3, `Program.Main` = `Application.Run(new CheckForm())`; komut satırı argümanı HİÇ
  okunmuyor). Kasa sunucusu SYSTEM olarak oturum 0'da çalıştığı için pencere görünmez açılır ve sonsuza dek bekler.
- Sonuç: `runPowershell` 10 dk sonra "Kurulum süre sınırını aştı" der; `p.kill()` yalnız powershell.exe'yi öldürür,
  sihirbaz süreci yetim kalır ve `…\token-kablo\surucu\*.exe` dosyasını kilitli tutar. `finally`'deki ve bir sonraki
  denemenin başındaki `rmSync(dir, { recursive: true, force: true })` kilitli dosyada EPERM/EBUSY atar. Sürücü hiç
  kurulmaz, `surucu.json` yazılmaz. X30TR'nin libusbK sürücüsü Windows'ta kendiliğinden gelmediği için X30TR bu yolla
  asla bağlanamaz; 300TR'nin FTDI sürücüsü çoğu Windows'ta Windows Update'ten gelir ama garanti değil.

## Aracın gerçekte yaptığı (IL'den okundu)
Araç gömülü kaynaklarından kurucuları %TEMP%'e çıkarıp çalıştırır:
- **X30TR** (`installDriversX30TR`): `Installers.wdi-simple.x64.exe`'yi ARGÜMANSIZ çalıştırır, bitmesini bekler; sonra
  `registerDriverX30TR`: `C:\Windows\System32\DriverStore\FileRepository\token_x30tr_libusbk_vid*` klasörlerinde
  `Token_X30TR_libusbK_VID_18D1_PID_2D00.inf` ve `…_PID_4EE1.inf` için `cmd /C pnputil /add-driver <inf> /install`.
  wdi-simple Token'ın özel derlemesi (konsol programı, x64): argümansız iki PID için libusbK sürücüsünü çıkarır ve kurar
  ("Extracting driver files for VID 18D1 PID 2D00…", "Installing driver(s) for VID 18D1 PID 4EE1…", cihaz yoksa "Device
  was not detected (Copying driver files for next time device is plugged in)"), `X30TR_driver_install.log` yazar.
  Kurulu mu denetimi: VID_18D1 & PID_2D00/4EE1 aygıtının sürücü sağlayıcısı "libusbK".
- **300TR** (`installDrivers300TR`): `Installers.ftdi_usb_installer.exe`'yi argümansız çalıştırır. Bu, FTDI CDM 2.12.36.4
  sürücülerinin **FreeExtractor** ile yapılmış pencereli kendi kendini açan paketi (sessiz çalışmaz). İçinde düz bir zip
  var: `ftdibus.inf/.cat`, `ftdiport.inf/.cat`, `amd64/*.sys`, `i386/*`, `dpinst-amd64.exe`, `dpinst.xml`… (28 dosya).
  Sürücüler WHQL imzalı: `pnputil /add-driver ftdibus.inf /install` ve `ftdiport.inf` sessiz kurar.
  Kurulu mu denetimi: VID_0403 & PID_6001 aygıtının sağlayıcısı "FTDI".
- Araç ayrıca VC++ (x86/x64) kurar (`/install /norestart /quiet`; biz zaten kendi adımımızda kuruyoruz).

## Sabit değerler (aracın SHA-256'sı sabit olduğu için konumlar da sabit; her dilim kendi SHA-256'sıyla doğrulanır)
Dış .exe içinde (dosya başından bayt konumu, uzunluk, SHA-256):
- `wdi-simple.x64.exe`: konum 43042185, uzunluk 7307776,
  sha256 b735e912b465cb7bb958cad251b25068ed8c2ad9026e713f1dfd7473e24902a0
  (x86 adlı kaynak da bayt bayt aynı dosya; ikisi de PE32+ x86-64.)
- `ftdi_usb_installer.exe`: konum 503353, uzunluk 2264632,
  sha256 835dd64b199190d20dc37c0cadeb064b7eaaaef271703781b2b259b7085437a4
  Bunun içindeki zip: EOCD imzası (PK\x05\x06) dilimin 2257936. baytında, merkez dizin boyu 1896, konumu 2182549 (zip
  başına göre) → zip başı = 2257936 − 1896 − 2182549 = 73491; zip = dilim[73491 .. 2257936+22). Arkada 6674 baytlık imza
  artığı var: zip dilimi EOCD'nin sonunda kesilmeli. (Konumu sabit yazmak yerine EOCD'den hesaplamak daha sağlam.)
- Dış .exe zip içinde UTF-8 bayraklı Türkçe adla, deflate ile durur (tek girdi).

Doğrulama dosyaları bu klasörde: `surucu.zip` (indirilen), `arac.exe` (dış .exe), `wdi-simple.x64.exe`,
`ftdi_usb_installer.exe`. Depoya KONMAZ; yalnız yerelde dilimleme kodunu gerçek dosyayla sınamak için.

## Önerilen düzeltme
1. `installDriver()` dış sihirbazı ASLA çalıştırmaz. Zip açılır (var olan Expand-Archive), dış .exe Node ile okunur,
   iki kurucu sabit konum + SHA-256 ile dilimlenir (saf, testli işlev), dosyaya yazılır.
2. X30TR: `wdi-simple.exe` argümansız, gizli pencereyle, çalışma klasörü geçici klasör; bitince DriverStore'daki
   `token_x30tr_libusbk_vid*` klasörlerinin .inf'leri için `pnputil /add-driver … /install`.
3. 300TR: FTDI zip'i dilimden çıkarılır (EOCD'den hesaplanan temiz zip), açılır, `pnputil /add-driver ftdibus.inf
   /install` ve `ftdiport.inf`.
4. pnputil çıkış kodları: 0 tamam, 3010 yeniden başlatma ister, 259 (ERROR_NO_MORE_ITEMS: paket eklendi, takılı aygıt
   yok ya da zaten güncel) tamam sayılır. İki model birbirinden bağımsız: biri düşse öteki denenir; işaret dosyası
   (`surucu.json`) model başına sonucu tutar; `driverInstalled()` ancak ikisi de tamamsa true (eksik kalan sonraki
   "Kurulumu yap"ta yeniden denenir).
5. Süre aşımında süreç AĞACI öldürülür (`taskkill /T /F /PID`), yalnız powershell değil. Kurulum başında, eski
   sürümün bıraktığı yetim sihirbaz süreçleri (yolu `…\token-kablo\surucu\` altında olanlar) öldürülür; yoksa `rmSync`
   kilitli dosyada düşer.
6. Sürücü yeni kurulduysa ve cihaz 45 sn'de yine görünmezse ileti: kabloyu çıkarıp yeniden takın (Token'ın aracı da
   bunu ister), sonra CABLE_HINT.
7. Yorumlardaki "(WiX)" düzeltilir; docs/04-YAZARKASA.md §9 (585. satır civarı) güncellenir.
8. Gerçek Windows'ta kanıt: ayrı küçük bir iş akışı (ör. `.github/workflows/token-surucu.yml`; `pull_request` yalnız
   `server/okc/token-kablo-kurulum.ts`, betik ve iş akışının kendisi değişince, ayrıca `workflow_dispatch`),
   `windows-latest`'te gerçek `installDriver()`'ı koşar: araç indirilir, dilimlenir, wdi-simple ve pnputil sessiz çalışır;
   iddia: süre sınırında biter, hiçbir pencere/süreç asılı kalmaz, DriverStore'da `token_x30tr_libusbk_vid*` ve FTDI
   paketi (`pnputil /enum-drivers` çıktısında ftdibus.inf / ftdiport.inf) vardır. Cihaz takılı olmadığı için bağlantı
   sınanamaz; bu açıkça yazılır.
