# Turkish fiscal Z report (YN ÖKC / yazarkasa-POS "Z raporu") - layout, identities, misread traps

Research notes for wave 13 (Kasa: ModPOS Z and the fiscal Z of the yazarkasa-POS as separate photos). 24 Oct 2026.

## 0. How this was researched (and its limits)

- This sandbox's egress proxy refused every direct fetch (gib.gov.tr, tokeninc.com, muhasebetr, alomaliye,
  wikipedia: CONNECT 403; WebFetch: ENOTFOUND). The GİB technical guides and the brand manuals with sample Z
  printouts could only be seen through **WebSearch snippets**, not read in full.
- One full, concrete source was readable: the public MIT repo **witchivip34/z-rapor-okuyucu** (Python, a Z-report
  photo reader built on Claude/Gemini, 7 arithmetic checks, commit 549414d, 19 Oct 2026), cloned read-only to
  a temporary folder (not in this repository). Its prompt, schema,
  checks and synthetic sample Z are the best "real-world" reference found. Nothing from it was run.
- Labels below are marked **[seen]** (in a source: manual snippet, GİB doc, or the repo's real-layout sample) or
  **[likely]** (reported in secondary blogs / plausible variant, not confirmed verbatim). Device firmware differs; the
  first month on the café's actual device should be checked against the paper.

## 1. What a fiscal Z is (legal frame)

- Z = "günlük kapanış fişi": all ÖKC sales of one business day, the revenue and the KDV collected, with a
  sequential number (müteselsil sıra no). Taking it **transfers the day's totals to fiscal memory (mali hafıza /
  mali bellek) and resets the daily counters**. No buyer personal data on it. (GİB özelge 22.02.2016/4; Token help
  "Beko 300TR Z raporu"; PAX A910SF manual.)
- X report = intraday, informational, **does not reset**, can be taken many times, not written to fiscal memory.
  Mali hafıza / mali bellek report = past days, by date range or Z range ("İKİ Z ARASI", "İKİ TARİH ARASI"),
  i.e. **multi-day totals**. (Lexpera özelge citing 68 seri no; PAX A910SF manual.)
- GİB's draft report-format guide (YN ÖKC fiş ve e-belge formatları kılavuzu, taslak 16.12.2025, §5) lists the
  report types: **X-Gün İçi Anlık Rapor, Y-Kasa Devir Raporu, Z-Gün Sonu Raporu (§5.3, p.27), Günlük Satış Raporu,
  Aylık Satış Raporu, Denetim Raporu**. Only the Z is the day's fiscal close.
- Daily memory per GİB technical guide: revenue per KDV rate, total KDV, revenue per payment type, **faturalı
  satışlar toplamı (if any)**, number of receipts given, other collections. Receipt total and KDV are written to the
  daily memory **as each receipt closes** (so KDV is rounded per receipt, then summed). The Z also carries the
  **cumulative** totals since the device was put in service (total sales + total KDV). (TK v7.0, 08.09.2023, via
  snippets; Mali Rapor Bildirim TK v1.0, 20.06.2024: `zRaporuBilgisi` = last Z's cumulative info, mandatory.)
- Z data is reported electronically to GİB (VUK 483 → from 1.1.2019; VUK 566, 25.09.2024). Paper Z printing is not
  mandatory on YN ÖKC since VUK 450 (2015) - the paper is a convenience copy; the EKÜ/fiscal memory is the record.
- **VUK 593 (RG 8 May 2026):** YN ÖKC may now issue e-Fatura / e-Arşiv itself (signed with the device's fiscal
  certificate). Expect newer firmware to print e-belge counts/amounts on the Z, separate from mali fiş totals.
- Bilgi fişi (non-fiscal info slip) types (GİB bilgi fişi kılavuzu 2015/2016/2020): **Faturalı satış (incl.
  e-Fatura / e-Arşiv), Yemek fişi / yemek kartı, Avans, Otopark giriş, Fatura tahsilatı, Cari hesap tahsilatı**.
  X and Z reports carry **count and amount fields for these**. Per the 2020 guide, a sale paid fully by meal card is
  recorded with a no-fiscal-value bilgi fişi (the meal-card company is invoiced); a **partial** meal-card payment gets
  a normal fiscal receipt. In practice many venues ring meal cards as a fiscal receipt with a "YEMEK KARTI"
  payment type - so YEMEK KARTI can appear **inside** or **outside** the fiscal total depending on how it was rung.
- KDV rates since 10 Jul 2023: **%1, %10, %20** (and %0). Café food and non-alcoholic drinks %10, alcohol %20.
  Old groups **%8 / %18** may still be printed on devices that were not reprogrammed, usually with 0,00.
  No 2026 rate change found (a Feb 2026 TBMM proposal mentions the sector but no confirmed change).

## 2. Typical layout of a yazarkasa-POS Z (top to bottom)

Paper is 57-58 mm thermal, ~32-42 characters per line; a café Z with departments + bank breakdown is long
(tens of cm). Amounts carry a leading `*` ("*8.110,00"). Common pattern on several devices: **label line with the
COUNT on the right, the AMOUNT on the next line** (repo prompt, "Fiş düzeni").

```
<İŞLETME UNVANI / SAHİBİ>                      header: name, address, vergi dairesi + VKN/TCKN
TARİH 01.09.2026                SAAT 23:50     date/time of the Z
FİŞ NO                                0612     the Z's own document number (NOT a count, NOT Z no)
              Z RAPORU                         title
----------------------------------------
Yiyecek  %10                            40     DEPARTMAN / KISIM lines: name, rate, count
                                 *8.110,00     ... and amount (KDV dahil)
İçecek   %20                            35
                                 *1.240,00
----------------------------------------
NET SATIŞ                        *9.350,00     DAILY fiscal total (KDV dahil)
NAKİT                                    9     payment type + count
                                 *2.450,00
KASA NAKİT                       *2.450,00     cash-in-drawer figure (≠ cash sales if PARA GİRİŞ/ÇIKIŞ)
K.KARTI                                 31     card payments + count
                                 *6.900,00
ÖRNEKBANK                        *6.900,00     per-bank sub-line UNDER K.KARTI (do not add again)
FİŞ İPTAL                                0     voided receipts (count, then amount)
----------------------------------------
MÜŞTERİ FİŞ ADEDİ                       40     sales receipts
MALİ FİŞ ADEDİ                           0
SLIP FİŞ ADEDİ                          31     bank slips (non-fiscal)
TOPLAM FİŞ ADEDİ                        71     = 40 + 0 + 31  (NOT the sales receipt count)
----------------------------------------
VERGİ DÖKÜMÜ
%10 TOPLAM                       *8.110,00     group total, KDV DAHİL
%10 TOPKDV                         *737,27     group KDV  (= 8110 × 10/110)
%20 TOPLAM                       *1.240,00
%20 TOPKDV                         *206,67
----------------------------------------
MALİ VERİ TOPLAM                 *9.350,00     DAILY (= NET SATIŞ)
MALİ VERİ TOPKDV                   *943,94     DAILY KDV (= 737,27 + 206,67)
KÜM. TOPLAM                  *1.259.350,00     CUMULATIVE since device start - NOT today
KÜM. TOPKDV                    *118.943,94     CUMULATIVE KDV - NOT today
----------------------------------------
Z SAYAÇ                               0101     Z number (same as "Z NO" at the bottom)
EKÜ NO 0001                                    electronic journal unit number (small, rarely changes)
MF  AV0000000001                               fiscal logo + brand code + device sicil no
```
(Synthetic sample from the repo, built on the common real layout: `ornekler/uret_fis.py`, image
`ornekler/z_ornek.png` in that repo - fictional business, safe to use as a test fixture reference.)

Beko 300TR manual sample (2015, via snippet): per-KDV-group blocks of **TOP** and **KDV**, then **KÜMSAT** and
**KÜMKDV**, then **EKÜ NO** and **Z NO**; a Yapı Kredi-hosted copy of the same manual shows the Z without KÜM lines
(firmware/config dependent). GİB 220TR manual sample receipts: "KDV ... TOP ... NAKİT ... EKÜ NO:1 Z NO:1".
Hugin (POS dosya desenleri v2.0): X report shows "MALİ BELLEKTE MEVCUT SON Z-SAYISI 0087 15.11.2007" with
KÜMSAT/KÜMKDV under it; fiscal memory report has TOPSAT/TOPKDV per Z.

On integrated yazarkasa-POS (Hugin S1, inPOS m530, others): **"Z raporu al" prints the fiscal Z and then
automatically the bank end-of-day (gün sonu) slip(s) of each banking app** on the same paper strip.

## 3. Label variants (by meaning)

| Meaning | Variants | Daily / cumulative |
|---|---|---|
| Title | Z RAPORU [seen], Z GÜNLÜK RAPORU / Z-GÜNLÜK [seen], Z-GÜN SONU RAPORU [seen, GİB draft], GÜN SONU RAPORU [likely; also used by bank slips and ModPOS!] | - |
| Not a Z | X RAPORU / X-GÜN İÇİ ANLIK RAPOR, MALİ HAFIZA / MALİ BELLEK RAPORU, İKİ Z ARASI, İKİ TARİH ARASI, GÜNLÜK / AYLIK SATIŞ RAPORU, Y-KASA DEVİR RAPORU, EKÜ RAPORU (reprint of a past day from the journal), KASA / KASİYER RAPORU, DENETİM RAPORU, BİLGİ FİŞİ | - |
| Z number | Z NO, Z SAYAÇ [seen], Z SAYACI, Z-NO [seen] | increments by 1 per Z |
| Other numbers that are NOT the Z no | FİŞ NO (document no of the Z itself; resets daily on many devices), EKÜ NO, SİCİL NO / MF line, BATCH NO (bank), "SON Z-SAYISI" on X reports | - |
| Daily total (KDV dahil) | NET SATIŞ, MALİ VERİ TOPLAM [seen], TOPSAT [seen], TOPLAM / TOP [seen], GÜNLÜK TOPLAM, TOPLAM SATIŞ, SATIŞ TOPLAMI [likely] | daily |
| Daily KDV | TOPKDV, MALİ VERİ TOPKDV [seen], TOPLAM KDV, GÜNLÜK KDV [likely] | daily |
| Per-rate block | VERGİ DÖKÜMÜ [seen], KDV DÖKÜMÜ / KDV GRUPLARI [likely]; "%10 TOPLAM / %10 TOPKDV" [seen], "KDV %10 ... TOP ... KDV" [seen], "%10 MATRAH" (KDV hariç) [likely on some] | daily |
| Cumulative | KÜM. TOPLAM, KÜM. TOPKDV [seen], KÜMSAT, KÜMKDV [seen], KÜMÜLATİF TOPLAM / KDV [likely]; possibly GENEL TOPLAM on some devices [unconfirmed - treat as ambiguous] | **cumulative since device start** |
| Departments | DEPARTMAN, KISIM, named (Yiyecek %10, İçecek %20) [seen] | daily |
| Payments | NAKİT [seen], K.KARTI [seen], KREDİ KARTI, KREDİ, BANKA KARTI, YEMEK KARTI / YEMEK ÇEKİ, KUPON [seen in GİB manual: nakit, kupon, kredi kartı], HAVALE/EFT, AÇIK HESAP, DİĞER | daily |
| Bank breakdown under card | bank names / app names with amount (ÖRNEKBANK *6.900,00) [seen] | daily, subset of card |
| Cash drawer | KASA NAKİT [seen], PARA GİRİŞ / PARA ÇIKIŞ, KASA AVANS [likely] | daily |
| Voids / adjustments | FİŞ İPTAL [seen] (count + amount), İPTAL, DÜZELTME (line correction), İNDİRİM / ARTIRIM (+ "ORAN") [seen in snippet] | daily, already netted out of the total |
| Counts | MÜŞTERİ FİŞ ADEDİ, MALİ FİŞ ADEDİ, SLIP FİŞ ADEDİ, TOPLAM FİŞ ADEDİ [seen], FİŞ SAYISI / FİŞ ADEDİ [seen/likely], İŞLEM SAYISI | daily |
| Non-fiscal collections | FATURALI SATIŞ, e-FATURA, e-ARŞİV, YEMEK KARTI/ÇEKİ (bilgi fişi), AVANS, FATURA TAHSİLATI, CARİ HESAP TAHSİLATI, OTOPARK GİRİŞ [seen as types; exact Z wording device-specific] | daily, **outside** TOPSAT |

## 4. Arithmetic identities that must hold on a real Z

Tolerances: sums are exact to the kuruş (0,01); KDV formula needs slack because KDV is rounded **per receipt**
and then summed (the repo uses 0,05 TL; with many receipts allow ~0,005 × receipt count).

1. **Σ per-rate TOPLAM (KDV dahil) = daily total** (NET SATIŞ = MALİ VERİ TOPLAM = TOPSAT).
2. **Σ per-rate KDV = TOPKDV** (daily).
3. **Per rate: KDV ≈ TOPLAM × r / (100 + r)** (%10 → /11, %20 → /6, %1 → /101). If MATRAH is printed:
   MATRAH + KDV = TOPLAM.
4. **Σ department amounts = daily total**; every department's rate appears in the KDV block.
5. **Σ fiscal payment lines = daily total** - *unless* the device also lists collections for bilgi fişi /
   faturalı satış / e-belge / avans / cari tahsilat in the same payment block; then Σ payments = daily total +
   those amounts. Bank sub-lines under the card line are **not** extra payments.
6. Σ bank sub-lines = card payment line (warning level).
7. Σ payment counts = sales receipt count (MÜŞTERİ FİŞ / MALİ FİŞ) - warning only (split payments break it).
   TOPLAM FİŞ ADEDİ = sales + other fiscal + slip/bilgi counts.
8. **Cumulative chain** (strongest misread detector, needs the previous Z which the panel already stores):
   KÜM. TOPLAM(today) − KÜM. TOPLAM(previous Z) = today's daily total, and same for KÜM. KDV, when Z NO(today) =
   Z NO(previous) + 1. Always KÜM ≫ daily. A gap in Z NO means an untransmitted day; the gap's total = Δ cumulative.
9. **Z NO strictly increasing by 1**; FİŞ NO/EKÜ NO are not Z numbers. Z NO only "jumps back" with a new EKÜ /
   device (EKÜ NO or sicil changes too).
10. Ratio sanity: TOPKDV / total between 1/101 (all %1) and 1/6 (all %20); a café that sells only %10 and %20
    sits between 9,09 % and 16,67 %. Outside → a figure is misread or matrah/cumulative was taken.
11. Date: printed date = business day, or the next calendar day if the Z was printed after midnight (panel's
    05:00 rule). Fiscal Z covers "since the previous Z", not the panel's 05:00 business day: if the Z was taken
    before closing, late sales fall into tomorrow's Z, so ModPOS-Z vs fiscal-Z can differ by those sales.

## 5. Classic misread traps (and the counter-check)

| Trap | What happens | Counter |
|---|---|---|
| Cumulative instead of daily | KÜM. TOPLAM / KÜMSAT (millions) read as the day's total; KÜM. TOPKDV as KDV | magnitude vs history, identity 1, chain 8 |
| "GENEL TOPLAM" ambiguity | means day total on ModPOS; on some fiscal devices may mean grand/cumulative total | prefer NET SATIŞ / MALİ VERİ TOPLAM / TOPSAT; chain check |
| KDV'li vs matrah | MATRAH (KDV hariç) read as group total, or group total read as matrah | MATRAH + KDV = TOPLAM; Σ groups = daily total |
| KDV vs total per group | TOPKDV line (small) taken as the group total or vice versa | formula 3 |
| Card vs total | K.KARTI amount (or a bank sub-line) taken as the daily total; bank sub-line added twice to card | identity 5/6 |
| Payment-count vs amount | count on the label line ("K.KARTI 31") read as an amount, or amount shifted to the next payment label because amounts sit on the line BELOW the label | identity 5; label/amount pairing rule in prompt |
| FİŞ NO / EKÜ NO / sicil / batch read as Z NO | Z NO looks out of sequence | Z NO = previous + 1 |
| TOPLAM FİŞ ADEDİ as receipt count | includes slips / bilgi fişi | read MÜŞTERİ/MALİ FİŞ; Σ payment counts |
| Voids/discounts subtracted twice | FİŞ İPTAL / İNDİRİM already excluded from the net | never subtract; record separately |
| Bilgi fişi / e-belge amounts | FATURALI SATIŞ / YEMEK KARTI (bilgi fişi) / e-ARŞİV added into the fiscal total, or payments ≠ total flagged as error | keep in a separate field; identity 5 exception |
| Faded thermal digits | 0/8, 6/0, 5/9, 1/7, 3/8, 5/6 confusions; lost decimal comma (×100 error) | identities 1-3, chain; "medium/low" confidence; never fix in the model |
| Thin long strip in one photo | 57 mm strip occupies ~375 px width of a phone photo (panel's own comment in src/lib/photo-compress.ts) → ~8-11 px characters | top/bottom halves, or crop; repo approach: full image + 3×3 overlapping crops upscaled 2× in one call; two independent reads and diff |
| Two documents in one photo | fiscal Z followed by bank gün sonu slip(s) on the same strip; yesterday's and today's Z; Z of a second device | return each document once; pick by title + Z NO + date; flag `multiple_documents` |
| X report instead of Z | intraday, no reset, same-looking totals | title must be Z; X often shows "SON Z-SAYISI" rather than a new Z NO |
| Mali hafıza / iki Z arası / EKÜ raporu | multi-day totals or a reprint of an old day | title; Z range / old date |
| ModPOS Z photographed as fiscal Z (or the reverse) | ModPOS has tables, products, ikram/ödenmez, garson; no MF logo, no EKÜ NO, no KÜM, no VKN header | document-type detection by those marks |
| Old KDV groups | %8 / %18 rows with 0,00 confused with live groups | read the printed % only; ignore zero groups |
| Wrong date | Z printed after midnight shows next date | 05:00 rule (already in panel) |

## 6. Bank end-of-day (gün sonu / batch) slip - how it differs

- Titles: GÜN SONU, GÜN SONU RAPORU, GRUP KAPAMA, BATCH KAPAMA, MUTABAKAT; bank logo/name.
- Fields: ÜYE İŞYERİ NO (MID), TERMİNAL NO / TERM NO / TID (usually 8 digits), BATCH NO (increments per
  end-of-day), date/time, per card scheme or ONUS / NOT ONUS / YABANCI lines, SATIŞ (adet, tutar), TAKSİTLİ SATIŞ,
  İADE, İPTAL, NET / TOPLAM, MUTABAKAT (should be zero / "başarılı"), "GÜN SONU TAMAMLANDI".
- **No** KDV, no Z NO, no EKÜ NO, no MF logo / sicil, no cumulative totals, no cash.
- Scope: only card transactions of that bank app/terminal, **since the last batch close** (a missed day rolls two
  days into one slip). İPTAL = void before batch (not in the net), İADE = refund of a settled sale (subtract).
- Fiscal Z's card line vs bank net differ legitimately when: a card sale was rung as cash (or reverse), card was
  taken for a bilgi fişi/fatura collection, a stand-alone bank POS outside the ÖKC was used, a batch was missed or
  auto-closed at another hour, or two bank apps run on the same device (one slip per bank). Commission and value
  date only matter for the bank statement, not for the slip.

## 7. Implications for this panel (not edits, observations)

- Current `Z_TASK` (src/lib/photo-read/prompts.ts) is ModPOS-shaped: it accepts "GENEL TOPLAM" as the total and
  says "Ignore the KDV breakdown". For the fiscal Z the KDV block, KÜM lines, Z NO/EKÜ NO and departments are the
  cross-checks that catch misreads, and wave 12 needs daily total + KDV per rate.
- `KasaZRaw` has no fields for per-rate totals/KDV, TOPKDV, cumulative total/KDV, EKÜ NO, sicil, departments,
  bilgi fişi/e-belge amounts. A separate `KasaOkcZRaw` (fiscal) schema next to the ModPOS one would let `kasa.ts`
  run identities 1-3, 5, 8, 9 in code (the model only transcribes; code checks, as the panel already does).
- Storing KÜM. TOPLAM / KÜM. KDV and Z NO per report enables the chain check against the previous fiscal Z,
  which turns most "faded digit" misreads into provable corrections or precise warnings.
- Card reconciliation becomes three-way: ModPOS card, fiscal Z card line, bank gün sonu net(s).
- Wave 12 revenue basis: fiscal Z daily total and per-rate KDV **plus** invoices (Paraşüt, or ÖKC e-belge after
  VUK 593) kept separate so faturalı satış is not double counted.

## 8. Sources and sample references (not downloaded unless noted)

- Repo (read locally, MIT): https://github.com/witchivip34/z-rapor-okuyucu - `zrapor/okuma.py` (prompt),
  `zrapor/model.py` (schema), `zrapor/kontrol.py` (7 checks, chain), `ornekler/uret_fis.py` + `ornekler/z_ornek.png`
  (synthetic sample Z image, fictional data), `ornekler/okuma_ornek.json` (5 consecutive synthetic Z readings with
  a deliberately broken department total and a broken cumulative).
- GİB draft: https://ynokc.gib.gov.tr/UploadedFiles/Files/yn-okc-fis-ve-e-belge-formatlari-kilavuz_taslak_16122025.pdf (§5.3 Z-Gün Sonu Raporu, p.27)
- GİB YN ÖKC Teknik Kılavuzu v7.0: https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_TEKNIK_KILAVUZU_08092023.pdf
- GİB Mali Rapor Bildirim TK v1.0: https://ynokc.gib.gov.tr/UploadedFiles/Files/YN_OKC_Mali_Rapor_Bildirim_Teknik_Kilavuz_v1_20062024.pdf
- GİB Bilgi Fişi kılavuzu 2020: https://ynokc.gib.gov.tr/UploadedFiles/Files/Bilgi_Fisi_Teknik_Kilavuzu_24072020.pdf
- GİB YN ÖKC SSS: https://ynokc.gib.gov.tr/UploadedFiles/Files/yn_okc_sss_pdf.pdf
- Manuals with sample Z printouts: Beko 300TR https://ynokc.gib.gov.tr/UploadedFiles/Files/300tr.pdf ,
  https://m.yapikredipos.com.tr/_assets/pdf/BEKO-300-TR-Yazarkasa-POS-Kullanim-Kilavuzu.pdf ,
  http://download.beko.com/Download.UsageManualsBeko/300tr-restaurant-pos-sistemleri-yazar-kasalar-kullanim-kilavuzu-tr_TR_201505281111678_User-20Manual-20-20Filetur-A.pdf ;
  Beko 220TR https://ynokc.gib.gov.tr/UploadedFiles/Files/220tr.pdf ; Hugin https://ynokc.gib.gov.tr/UploadedFiles/Files/hugin300.pdf ;
  Vera Delta Plus https://ynokc.gib.gov.tr/UploadedFiles/Files/VERADeltaPlusKullanmaKlavuzu.pdf ;
  Pidion MT360E https://ynokc.gib.gov.tr/UploadedFiles/Files/PidionMT360E_KullanimKlavuzu.pdf ;
  PAX A910SF https://ikasa.com.tr/wp-content/uploads/2025/04/PAX-A910SF_Kullanim-Klavuzu-1.pdf ;
  Olivetti PBT-900 https://blog.dorapos.com.tr/wp-content/uploads/2018/02/Kullanim-Kilavuzu-Olivetti-PBT-900.pdf ;
  Hugin POS dosya desenleri v2.0 https://silo.tips/download/hugin-pos-dosya-desenler-v20
- Token help: https://www.tokeninc.com/yardim-merkezi/beko-300tr-urun-kullanimi/z-raporu/ and /mail-hafiza-raporlari/
- Z then bank EOD on one press: https://blog.dorapos.com.tr/hugin-s1-z-raporu-ve-gun-sonu-nasil-yapilir/ ,
  https://blog.dorapos.com.tr/inpos-m530-z-raporu-nasil-alinir/
- TOPSAT/TOPKDV, faturalı satış outside TOPSAT, payments = TOPSAT: https://www.fisle.co/blog/z-raporu-muhasebe-kaydi
- X vs Z vs mali hafıza: https://www.lexpera.com.tr/mevzuat/ozelgeler/b-07-4-def-0-78-10-00-okc-4-sayili-ozelge-1
- VUK 593 (8 May 2026): https://www.alomaliye.com/2026/05/08/vergi-usul-kanunu-genel-tebligi-sira-no-593-vuk-593/ ,
  https://www.tokeninc.com/blog/vuk-593-tebligi-yeni-nesil-okclerden-e-belge-duzenlenebilecek/
- Bank EOD: https://www.akbankpos.com/doc/AkbankPOS_Kullanim_Kilavuzu.pdf ,
  https://www.qnb.com.tr/isim-icin/kobi/kobi-pos-cozumleri/pos-kilavuzu/pos-menusu ,
  https://arifunal.com/yazi/batch-numarasi-nedir/ , https://odeal.com/blog/pos-cihazi-gun-sonu-alma-nasil-yapilir/
