import type { Metadata } from "next";
import Link from "next/link";

import { NAV_GROUPS } from "@/components/panel/nav";
import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Yardım" };

const ROUTINE = [
  { title: "Ay sonu stok sayımı", body: "Ayın son günü kapanıştan sonra Stok sayımı sayfasında miktarları sayım biriminde (KG, LT, ADET, DİLİM) girin. Personel hesabıyla telefondan da yapılabilir.", href: "/panel/sayim" },
  { title: "Satış raporunu yükleyin", body: "Patron > Raporlar > Satış ekranından ürün listesini (ad, adet, ciro) kopyalayıp Satışlar > Satış raporu yükle ile yapıştırın ya da dosyayı seçin. Daha önce eşleştirilen ürünler otomatik tanınır; sarı satırları bir kez eşleştirin.", href: "/panel/satislar" },
  { title: "Ay bilgilerini girin", body: "Satışlar sayfasında POS cirosunu (KDV dahil), açık gün sayısını, yönetici indirimlerini ve ödenmez/ikram tutarını yazın.", href: "/panel/satislar" },
  { title: "Faturaları girin", body: "Paraşüt'teki alış faturalarını Faturalar sayfasına ekleyin. Fiyatı değişen malzemenin paket fiyatını Hammaddeler sayfasında güncelleyin; bütün ürün maliyetleri kendiliğinden değişir.", href: "/panel/faturalar" },
  { title: "Değişken giderleri yazın", body: "Su faturası, doğalgaz, bakım-tamir gibi ay ay değişen giderleri Gelir-gider tablosundaki ilgili hücreye girin. Elektrik gibi sabit görünen ama değişen kalemlerin gerçek tutarını da hücrenin üzerine yazabilirsiniz.", href: "/panel/gelir-gider" },
  { title: "Kontrol edin", body: "Tutarlılık sayfasında alınan malzeme ile reçeteye göre harcanması gerekeni karşılaştırın; Panel'de kâr/zarar, başabaş ve fiyatı gözden geçirilecek ürünlere bakın.", href: "/panel/tutarlilik" },
];

const HOWTO = [
  ["Yeni fatura geldi", "Hammaddeler'de o malzemenin paket fiyatını değiştirin (fiyat geçmişi saklanır), Faturalar'a faturayı ekleyin."],
  ["Menüye zam yaptım", "Ürünler sayfasında satış fiyatı hücresini değiştirip Enter'a basın ya da ürün kartında fiyatı değiştirin. Kartta fiyat simülatörü ile önce deneyebilirsiniz."],
  ["Reçeteyi değiştirdim", "Ürün adına tıklayın; reçete kartında miktarı değiştirin, malzeme ekleyin/silin ve Kaydet'e basın. Maliyet anında yeniden hesaplanır."],
  ["Yeni ürün eklemek", "Ürünler > Yeni ürün. İsterseniz benzer bir ürünün reçetesini kopyalayarak başlayın. Excel'deki gibi \"bana söyleyin\" demeye gerek yok."],
  ["Yeni malzeme eklemek", "Hammaddeler > Yeni hammadde. Eklediğiniz malzeme reçete kartlarındaki listede çıkar; sayım birimini seçerseniz sayım listesine de girer."],
  ["Maaş / kira değişti", "Personel sayfasında net maaşı, Sabit giderler sayfasında kirayı değiştirin."],
  ["Shot gramajı / pompa değişti", "Ayarlar > Reçete ölçüleri. Formülle bağlı bütün reçeteler (ShotTek, Pompa …) birlikte güncellenir."],
  ["Personele hesap açmak", "Ayarlar > Kullanıcılar > Kullanıcı ekle, rol: Personel. Personel yalnızca stok sayımını ve reçete defterini görür."],
];

const FORMULAS = [
  ["Birim maliyet", "Paket fiyatı ÷ paket içeriği"],
  ["Ürün maliyeti", "Σ (miktar × birim maliyet) × (1 + fire oranı)"],
  ["Net satış", "Satış fiyatı ÷ (1 + KDV)"],
  ["POS komisyonu", "Satış fiyatı × komisyon × kartlı satış oranı"],
  ["Birim kâr", "Net satış − ürün maliyeti − POS komisyonu"],
  ["Maliyet oranı", "Ürün maliyeti ÷ net satış (hedef ≤ %30)"],
  ["Önerilen fiyat", "TAVAN(maliyet ÷ hedef oran × (1 + KDV); 5 ₺)"],
  ["Durum", "İyi ≤ hedef · Dikkat ≤ hedef + 10 puan · Düşük kâr > hedef + 10 puan"],
  ["Eşleşmeyen POS ürünü", "Net ciro × eşleşen ürünlerin ortalama maliyet oranı"],
  ["Başabaş günlük ciro", "Aylık sabit giderler ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün"],
  ["Aylık sabit gider (gelir-gider)", "Aylık tutar × açık gün ÷ ayın gün sayısı (günlük giderler × açık gün)"],
  ["Satılan malın maliyeti", "Önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)"],
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Yardım" excel="Nasıl Kullanılır" description="Sistemin nasıl çalıştığı, her ay ne yapmanız gerektiği ve Excel'deki sayfaların karşılıkları." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader title="Her ay ne yapmalı?" description="Bu altı adımı her ay sonunda yaptığınızda bütün raporlar doğru olur." />
          <CardContent>
            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ROUTINE.map((r, i) => (
                <li key={r.title} className="rounded-xl border border-coffee-100 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-coffee-800 text-sm font-semibold text-white">{i + 1}</span>
                    <Link href={r.href} className="font-semibold text-coffee-950 hover:underline">
                      {r.title}
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-coffee-700">{r.body}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Nasıl güncellenir?" />
          <CardContent>
            <dl className="space-y-3 text-sm">
              {HOWTO.map(([q, a]) => (
                <div key={q}>
                  <dt className="font-semibold text-coffee-950">{q}</dt>
                  <dd className="text-coffee-700">{a}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Renkler ve işaretler" />
            <CardContent className="space-y-2.5 text-sm">
              <p>
                <span className="cell-input font-semibold">Mavi yazı</span> — sizin girdiğiniz / değiştirebileceğiniz değerler. Gelir-gider tablosunda mavi noktalı hücre, hesaplananın üzerine yazılmış demektir.
              </p>
              <p>
                <Badge tone="amber">Tahmini</Badge> — faturada bulunamayan, tahmin edilen değer. Gerçek değeri yazınca hesaplar düzelir.
              </p>
              <p>
                <Badge tone="green">İyi</Badge> <Badge tone="amber">Dikkat</Badge> <Badge tone="red">Düşük kâr</Badge> — ürünün maliyet oranı hedefe göre.
              </p>
              <p>ⓘ simgesinin üzerine gelince Excel&apos;deki hücre notlarının karşılığı olan açıklama çıkar.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Önemli notlar" />
            <CardContent className="space-y-2 text-sm text-coffee-800">
              <p>
                <strong>KDV:</strong> Menü fiyatları KDV dahil (%10). Malzeme maliyetleri KDV hariç, çünkü alışta ödenen KDV indirilebiliyor.
              </p>
              <p>
                <strong>Boylar:</strong> Sıcak içecekler M = 8 oz, L = 12 oz (14 oz bardakla). Soğuk içecekler M = 12 oz, L = 16 oz.
              </p>
              <p>
                <strong>İki kâr hesabı:</strong> Panel reçeteye göre (teorik) kârı, Gelir-gider tablosu ise faturaya göre (gerçekleşen) kârı gösterir. Aradaki fark fire, ikram, stok birikmesi ya da reçetede eksik malzemedir. Stok sayımı girdikçe iki rakam birbirine yaklaşır.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader title="Formüller" description="Hesaplama motoru Excel'deki formüllerin birebir karşılığıdır ve otomatik testlerle Excel'e karşı doğrulanır." />
          <CardContent>
            <dl className="divide-y divide-coffee-50 text-sm">
              {FORMULAS.map(([k, v]) => (
                <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
                  <dt className="font-medium text-coffee-950">{k}</dt>
                  <dd className="text-coffee-700">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Excel sayfalarının karşılıkları" />
          <CardContent>
            <ul className="divide-y divide-coffee-50 text-sm">
              {NAV_GROUPS.flatMap((g) => g.items).map((i) => (
                <li key={i.href} className="flex items-center justify-between gap-3 py-2">
                  <Link href={i.href} className="flex items-center gap-2 font-medium hover:underline">
                    <i.icon size={15} className="text-coffee-400" /> {i.label}
                  </Link>
                  <span className="text-right text-xs text-coffee-500">{i.excel ?? "yeni"}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
