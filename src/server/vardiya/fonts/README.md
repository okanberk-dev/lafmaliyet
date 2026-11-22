# Vardiya PDF'inin yazı tipi

`Inter-Regular.subset.ttf` ve `Inter-SemiBold.subset.ttf`: [Inter](https://github.com/rsms/inter) 4.001'in (The Inter
Project Authors; SIL Open Font License 1.1, `OFL.txt`) Latin ve Türkçe harflere indirilmiş kopyaları. Vardiya planının
PDF'i (`../pdf.ts`) bunları gömer: PDF'in standart yazı tiplerinde ğ, ş, ı, İ yoktur.

Kaynak dosyalar Google Fonts'un sabit ağırlıklı TrueType yapıları (`Inter_400Regular.ttf`, `Inter_600SemiBold.ttf`;
npm `@expo-google-fonts/inter@0.4.1`). Alt küme fonttools ile çıkarıldı (dosya başına ≈ 30 KB; özgün dosya 342 KB):

```bash
pyftsubset Inter_400Regular.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013,U+2014,U+2018-201D,U+2022,U+2026,U+203A,U+20BA,U+2192,U+2212" \
  --layout-features="kern" --no-hinting --name-IDs="*" --output-file=Inter-Regular.subset.ttf
```

Kapsam: temel Latin, Latin-1 ve Latin Extended-A (Türkçenin bütün harfleri), tire ve tırnaklar, "…", "›", "₺", "→".
Kapsam dışındaki karakter (emoji, başka alfabe) PDF'te "?" olur (`pdf.ts` › `safe`).

Dosyalar çalışma anında diskten okunur; Vercel işlevine `next.config.ts` › `outputFileTracingIncludes` ile konur
(`tests/vardiya.test.ts` ikisini de denetler).
