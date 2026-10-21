import {
  ArrowUpRight,
  Bell,
  CalendarCheck,
  ClipboardList,
  Coffee,
  CupSoda,
  FileText,
  Globe,
  Info,
  LayoutList,
  Package,
  Palette,
  Pencil,
  Percent,
  Receipt,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Sigma,
  Table2,
  Tag,
  UserPlus,
  Undo2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { isValidElement, Suspense, type ReactNode } from "react";

import { NAV_FOOTER, NAV_TREE } from "@/components/panel/nav";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { IconTile, toneFor } from "@/components/ui/icon-tile";

import { HelpFaq, HelpFaqFallback, type FaqGroup } from "./faq-search";
import { excelFor, pathOf, tabsOf } from "./nav-paths";
import { RoutineSteps } from "./routine-steps";

export const metadata: Metadata = { title: "Yardım" };

// ---------------------------------------------------------------- Menü yolları (kabuktaki adlarla, nav-paths.ts)

/** "Genel bakış · Menü (Ürünler, Hammaddeler, Reçete defteri) · …" */
const MENU_LAYOUT = NAV_TREE.map((n) => (n.children ? `${n.label} (${n.children.map((c) => c.label).join(", ")})` : n.label)).join(" · ");
const STAFF_SCREENS = NAV_TREE.flatMap((n): { label: string }[] =>
  n.children ? n.children.filter((c) => c.roles.includes("staff")) : n.roles.includes("staff") ? [n] : [],
).map((n) => n.label);
/** "A, B ve C" */
const STAFF_LIST = STAFF_SCREENS.length > 1 ? `${STAFF_SCREENS.slice(0, -1).join(", ")} ve ${STAFF_SCREENS.at(-1)}` : (STAFF_SCREENS[0] ?? "");

// ---------------------------------------------------------------- İçerik

function Path({ href }: { href: string }) {
  return <span className="font-medium text-ink">{pathOf(href).join(" › ")}</span>;
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-soft ring-1 ring-line-strong">{children}</kbd>;
}

const ROUTINE: { title: string; body: ReactNode; href: string; icon: LucideIcon }[] = [
  {
    title: "Ay sonu stok sayımı",
    body: (
      <>
        Ayın son günü kapanıştan sonra <Path href="/panel/sayim" /> ekranında miktarları sayım biriminde (KG, LT, ADET, DİLİM) girin. Personel hesabıyla telefondan da yapılabilir;
        personel listede olmayan kalemleri de yazabilir, fiyatını yönetici girer. &quot;Geçen aydan doldur&quot; ek kalemleri de taşır. Ayın ilk 10 gününde ekran, sayımı
        girilmemişse geçen ayı açar. Tutarlılık&apos;ta sayım sapması için o ayın alım miktarı da gerekir: hiç alınmadıysa 0 yazın.
      </>
    ),
    href: "/panel/sayim",
    icon: ClipboardList,
  },
  {
    title: "Satış raporunu yükleyin",
    body: (
      <>
        Patron › Raporlar › Satış ekranından ürün listesini (ad, adet, ciro) kopyalayıp <Path href="/panel/satislar" /> ekranındaki İçe aktar kartında Yapıştır&apos;ı seçip
        yapıştırın ya da Dosya ile dosyayı seçin. Daha önce eşleştirilen ürünler otomatik tanınır; eşleşmeyen satırları bir kez eşleştirin.
      </>
    ),
    href: "/panel/satislar",
    icon: Receipt,
  },
  {
    title: "Ay bilgilerini girin",
    body: (
      <>
        <Path href="/panel/satislar" /> ekranında POS cirosunu (KDV dahil), açık gün sayısını, yönetici indirimlerini ve ödenmez/ikram tutarını yazın. Devam eden ayda
        açık gün sayısını bugüne kadar olarak yazın: ay sonu tahmini bununla yapılır.
      </>
    ),
    href: "/panel/satislar",
    icon: CalendarCheck,
  },
  {
    title: "Faturaları gözden geçirin",
    body: (
      <>
        Paraşüt&apos;e gelen e-faturalar ve gider faturaları her sabah <Path href="/panel/faturalar" /> ekranına kendiliğinden gelir; elle girmeyin. Kategorisi tahminle
        yazılanları Kontrol bekleyen süzgecinde onaylayın. Yeni gelen ürünü <Path href="/panel/parasut" /> ekranında bir kez hammaddeye bağlayın (çarpan, &quot;Fiyatı
        güncelle&quot;): alınan miktar ve paket fiyatı sonraki faturalardan güncellenir, ürün maliyetleri kendiliğinden değişir. Yalnızca Paraşüt&apos;te olmayan
        faturaları (kâğıt, e-Arşiv) Fatura ekle ile girin, fotoğrafını ya da PDF&apos;ini ekleyin.
      </>
    ),
    href: "/panel/faturalar?durum=kontrol",
    icon: FileText,
  },
  {
    title: "Değişken giderleri yazın",
    body: (
      <>
        Su faturasını <Path href="/panel/gelir-gider" /> tablosundaki SU GİDERİ satırına KDV hariç yazın: su + buzun litre maliyeti buradan reçetelere dağıtılır, reçeteye göre
        kârda sabit gider olarak ikinci kez sayılmaz. Reklam, influencer gibi her ay farklı olan giderleri ve fatura dışı harcamaları (nakit alım, bakım){" "}
        <Path href="/panel/harcamalar" /> ekranına girin: kategori ekleyebilirsiniz, her kategori Gelir-gider&apos;de kendi satırında sayılır; sabit giderdeki
        &quot;Instagram reklamı&quot; gibi kalemleri oradan tek dokunuşla aylık girişe çevirirsiniz. Elektrik gibi sabit görünen ama değişen kalemlerin gerçek tutarını hücrenin
        üzerine yazabilirsiniz.
      </>
    ),
    href: "/panel/gelir-gider",
    icon: Wallet,
  },
  {
    title: "Kontrol edin",
    body: (
      <>
        <Path href="/panel/tutarlilik" /> ekranında alınan malzeme ile reçeteye göre harcanması gerekeni karşılaştırın; <Path href="/panel" />&apos;ta kâr/zarar, başabaş ve fiyatı gözden
        geçirilecek ürünlere bakın.
      </>
    ),
    href: "/panel/tutarlilik",
    icon: ShieldCheck,
  },
];

type Faq = { id: string; q: string; a: ReactNode; icon: LucideIcon; links?: { href: string; label: string }[] };

/** Sık sorulanlar, konuya göre gruplu; her grup kendi yaylı akordeonu */
const FAQ_GROUPS: { title: string; items: Faq[] }[] = [
  {
    title: "Menü ve reçete",
    items: [
      {
        id: "zam",
        q: "Menüye zam yaptım",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranında satış fiyatı hücresini değiştirip Enter&apos;a basın ya da ürün kartında fiyatı değiştirin. Kartta fiyat simülatörü ile önce
            deneyebilirsiniz. Ürün laffogato.net menüsüne bağlıysa (adın yanındaki küre) fiyat önce sitede değişir; sonra sitede Ayarlar › Vergi&apos;den fiyat listesinin
            tarihini güncelleyin, kasadaki (ModPOS) fiyatı da elle değiştirin.
          </>
        ),
        icon: Tag,
        links: [{ href: "/panel/urunler", label: "Ürünler" }],
      },
      {
        id: "site-menusu",
        q: "Site menüsüyle bağlantı (fiyat ve Tükendi)",
        a: (
          <>
            Bir ürün laffogato.net menüsündeki kalemine bağlıysa satış fiyatı ve menü durumu iki yerde aynı kalır, doğru kaynak sitedir: sitede fiyat değişince ya da kalem
            “Tükendi” olunca panel birkaç saniyede alır; panelde fiyatı, “Menüde aktif”i ya da “QR menüde göster”i değiştirince önce siteye yazılır, site ulaşılamazsa
            kaydedilmez. Eşleştirme <Path href="/panel/urunler" /> › Site menüsü ekranında: ada göre öneriler seçilip bağlanır (hiçbiri kendiliğinden bağlanmaz), bağlanan
            ürün sitenin fiyatını alır. Ad, kategori, reçete ve maliyet eşitlenmez; yeni kalem iki yanda da elle açılır.
          </>
        ),
        icon: Globe,
        links: [{ href: "/panel/urunler/site", label: "Site menüsü" }],
      },
      {
        id: "recete",
        q: "Reçeteyi değiştirdim",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranında ürün adına tıklayın; reçete kartında miktarı değiştirin, malzeme ekleyin/silin ve Kaydet&apos;e basın. Maliyet anında yeniden
            hesaplanır.
          </>
        ),
        icon: Pencil,
        links: [{ href: "/panel/urunler", label: "Ürünler" }],
      },
      {
        id: "yeni-urun",
        q: "Yeni ürün eklemek",
        a: (
          <>
            <Path href="/panel/urunler" /> › Yeni ürün. İsterseniz benzer bir ürünün reçetesini kopyalayarak başlayın. Excel&apos;deki gibi &quot;bana söyleyin&quot; demeye gerek
            yok.
          </>
        ),
        icon: Coffee,
        links: [{ href: "/panel/urunler", label: "Ürünler" }],
      },
      {
        id: "olcu",
        q: "Shot gramajı / pompa değişti",
        a: (
          <>
            <Path href="/panel/ayarlar" /> › Reçete ölçüleri. Formülle bağlı bütün reçeteler (ShotTek, Pompa …) birlikte güncellenir.
          </>
        ),
        icon: Ruler,
        links: [{ href: "/panel/ayarlar#olculer", label: "Reçete ölçüleri" }],
      },
    ],
  },
  {
    title: "Alış ve malzeme",
    items: [
      {
        id: "fatura",
        q: "Yeni fatura geldi",
        a: (
          <>
            Paraşüt&apos;e gelen fatura ertesi sabah <Path href="/panel/faturalar" /> ekranına kendiliğinden düşer; beklemek istemezseniz <Path href="/panel/parasut" /> › Şimdi
            eşitle. Fatura “ödenmedi” gelir; ödediğinizde <Path href="/panel/tedarikciler" /> ya da Faturalar ekranında ödendi işaretleyin. Kontrol bekleyen varsa kategorisini onaylayın. Yeni bir ürün geldiyse Paraşüt entegrasyonu ekranındaki Bağlanmayı bekleyenler listesinde hammaddeye
            bağlayın: alınan miktar ve (&quot;Fiyatı güncelle&quot; açıksa) paket fiyatı oradan güncellenir. Paraşüt&apos;te olmayan (kâğıt, e-Arşiv) faturayı Faturalar ›
            Fatura ekle ile girin, fotoğrafını ya da PDF&apos;ini ekleyin; sonradan Paraşüt&apos;e girilirse aynı kayda bağlanır, iki kez sayılmaz. Bağlı olmayan bir malzemenin fiyatını{" "}
            <Path href="/panel/hammaddeler" /> ekranında elle değiştirin (fiyat geçmişi saklanır).
          </>
        ),
        icon: FileText,
        links: [
          { href: "/panel/faturalar?durum=kontrol", label: "Kontrol bekleyen faturalar" },
          { href: "/panel/parasut?durum=bekleyen", label: "Bağlanmayı bekleyen ürünler" },
          { href: "/panel/hammaddeler", label: "Hammaddeler" },
        ],
      },
      {
        id: "kafe-disi",
        q: "Karaoke box ve Alp Koç faturaları",
        a: (
          <>
            Aynı Paraşüt hesabına gelen karaoke box faturaları ve ortak Alp Koç&apos;un aldıkları (kola ile Damla suyun geldiği Pruva faturaları) kafe dışıdır: kategorisi
            Karaoke box ya da Alp Koç olan fatura kafenin fatura toplamına, gelir-giderine, mal maliyetine ve hammaddelerin alınan miktarına girmez;{" "}
            <Path href="/panel/faturalar" /> ekranının aylık özetinde Toplam&apos;ın altında ayrı satırda görünür. Yanlış tarafta duran bir faturanın kategorisini
            değiştirin; bir tedarikçinin faturaları hep aynı kategoriye gidecekse <Path href="/panel/parasut" /> › Kategori kuralları&apos;na tedarikçi kuralı ekleyin.
          </>
        ),
        icon: Receipt,
        links: [
          { href: "/panel/faturalar", label: "Faturalar" },
          { href: "/panel/parasut", label: "Kategori kuralları" },
        ],
      },
      {
        id: "malzeme",
        q: "Yeni malzeme eklemek",
        a: (
          <>
            <Path href="/panel/hammaddeler" /> › Yeni hammadde. Eklediğiniz malzeme reçete kartlarındaki listede çıkar; sayım birimini seçerseniz sayım listesine de girer.
          </>
        ),
        icon: Package,
        links: [{ href: "/panel/hammaddeler", label: "Hammaddeler" }],
      },
    ],
  },
  {
    title: "Gider, ödeme ve ekip",
    items: [
      {
        id: "maas",
        q: "Maaş / kira değişti",
        a: (
          <>
            <Path href="/panel/giderler" /> ekranında: Personel sekmesinde net maaşı, Sabit giderler sekmesinde kirayı değiştirin. Kaydederken &quot;Hangi aydan
            itibaren?&quot; sorusunda ayı seçin (varsayılan bu ay); önceki aylar eski tutarla kalır. Yanlış girilmiş bir tutarı bütün aylarda düzeltmek için Gelişmiş ›
            Tüm aylar. Biten bir gider ya da ayrılan personel için Durdur ile son ayı verin (eski &quot;Pasif&quot; yerine); geçmiş aylar etkilenmez. Silme yalnızca hiçbir
            kapanmış ayın hesabına girmemiş kayıtta açıktır.
          </>
        ),
        icon: Wallet,
        links: [
          { href: "/panel/personel", label: "Personel" },
          { href: "/panel/giderler", label: "Sabit giderler" },
        ],
      },
      {
        id: "harcama",
        q: "Nakit alım, bakım, reklam ya da influencer ödemesi",
        a: (
          <>
            <Path href="/panel/harcamalar" /> ekranında ayı seçip Harcama ekle kartını doldurun: kategori, tutar (KDV ayrılmaz), tarih, açıklama ve ödeme şekli. Her
            kategori Gelir-gider&apos;de kendi satırında ve Genel bakış&apos;taki &quot;Para nereye gitti?&quot; kartında sayılır; ＋ Yeni kategori ile kategori
            açabilirsiniz. Faturası Paraşüt&apos;ten gelen gideri buraya ayrıca yazmayın, iki kez sayılır. Tutarı aydan aya değişen sabit gideri (ör. Instagram reklamı)
            aynı ekranda aylık girişe çevirin.
          </>
        ),
        icon: Wallet,
        links: [{ href: "/panel/harcamalar", label: "Aylık harcamalar" }],
      },
      {
        id: "tedarikci",
        q: "Tedarikçinin bilgileri ve ödemesi",
        a: (
          <>
            <Path href="/panel/tedarikciler" /> ekranında her tedarikçi faturalarından kendiliğinden listelenir: kalan borç, vadesi geçen ve en yakın vade. Tedarikçiye
            dokunup Düzenle&apos;den unvanı, vergi no ve dairesini, IBAN&apos;ı (kontrol hanesi denetlenir), telefon ve e-postayı, vade gününü yazın; Faturadan doldur unvan,
            vergi no, adres, iletişim ve IBAN&apos;ı en yeni Paraşüt faturasından okur. Geçmiş faturaları al, tedarikçinin Paraşüt&apos;teki eski faturalarını da getirir.
            Sil: faturası olmayan tedarikçi silinir; faturası olan listeden kalkar (faturaları ve giderler yerinde kalır, borcu olan kaldırılamaz). Paraşüt&apos;ten gelen fatura “ödenmedi” gelir: ödediğinizde durum hapına dokunup
            Ödendi&apos;yi seçin (ödeme günü ve şekliyle), birden çok faturayı seçip toplu işaretleyin. Ödeme talebi seçtiğiniz faturaların tutarını, IBAN&apos;ı ve havale
            açıklamasını hazır metin yapar (son iade faturaları seçilirse düşülür); kopyalayın ya da WhatsApp&apos;la gönderin, Talep edildi işaretle ile faturalar “talep
            edildi” olur. Komisyon faturaları (Trendyol, Yemek Sepeti, yemek kartları) hakedişten düşüldüğü için ödendi gelir; peşin ya da kartla otomatik ödediğiniz
            tedarikçinin bilgilerinde Faturaları ödendi gelsin&apos;i açın. IBAN değişikliğini tedarikçiyi arayarak teyit edin.
          </>
        ),
        icon: Wallet,
        links: [{ href: "/panel/tedarikciler", label: "Tedarikçiler" }],
      },
      {
        id: "odendi-geri-al",
        q: "Yanlışlıkla “Ödendi” dedim",
        a: (
          <>
            Hemen çıkan bildirimdeki Geri al&apos;a dokunun (birkaç saniye durur). Kaçırdıysanız <Path href="/panel/hatirlaticilar" /> ekranında yaklaşan ödemelerin altındaki Son
            ödenenler&apos;i açın: son 30 günde ödendi denen faturalar ve hatırlatıcılar orada; Geri al ile fatura ödenmemişe, hatırlatıcı önceki tarihine döner.
            Faturalar&apos;da ve Tedarikçiler&apos;de ödendi işaretlenen fatura da bu listeye girer.
          </>
        ),
        icon: Undo2,
        links: [{ href: "/panel/hatirlaticilar#son-odenenler", label: "Son ödenenler" }],
      },
      {
        id: "hesap",
        q: "Personele hesap açmak",
        a: (
          <>
            <Path href="/panel/kullanicilar" /> › Kullanıcı ekle: giriş e-postasını siz yazarsınız, rol: Personel. Parolayı siz belirleyebilir ya da davet bağlantısı
            gönderebilirsiniz: kişi parolasını 72 saat geçerli bağlantıdan kendisi belirler; bağlantıyı kopyalayın, WhatsApp&apos;ta ya da e-postayla paylaşın. Personel
            yalnızca stok sayımını ve reçete defterini görür. Her kullanıcı Hesabım&apos;dan parolasını değiştirip iki adımlı doğrulamayı (Google Authenticator vb.)
            açabilir.
          </>
        ),
        icon: UserPlus,
        links: [{ href: "/panel/kullanicilar", label: "Kullanıcılar & roller" }, { href: "/panel/hesap", label: "Hesabım (iki adımlı doğrulama)" }],
      },
    ],
  },
  {
    title: "Bilinmesi gerekenler",
    items: [
      {
        id: "kdv",
        q: "KDV",
        a: "Menü fiyatları KDV dahil (%10). Malzeme maliyetleri KDV hariç, çünkü alışta ödenen KDV indirilebiliyor.",
        icon: Percent,
      },
      {
        id: "boylar",
        q: "Boylar",
        a: "Sıcak içecekler M = 8 oz, L = 12 oz (14 oz bardakla). Soğuk içecekler M = 12 oz, L = 16 oz.",
        icon: CupSoda,
      },
      {
        id: "iki-kar",
        q: "İki kâr hesabı: neden iki farklı kâr görüyorum?",
        a: (
          <>
            <Path href="/panel" /> reçeteye göre (teorik) kârı, <Path href="/panel/gelir-gider" /> tablosu ise faturaya göre (gerçekleşen) kârı gösterir. Aradaki fark fire, ikram,
            stok birikmesi ya da reçetede eksik malzemedir. Stok sayımı girdikçe iki rakam birbirine yaklaşır.
          </>
        ),
        icon: Scale,
      },
      {
        id: "excel-fark",
        q: "Net kâr Excel'deki Panel'den neden farklı olabilir?",
        a: (
          <>
            Excel Panel&apos;i her ay standart aylık sabit gideri (Sabit Giderler + Personel) düşer. <Path href="/panel" /> o ayın <Path href="/panel/gelir-gider" /> tutarlarını
            kullanır: kalemler açık gün oranıyla bölünür, elle düzeltilen hücreler ve yalnızca o aya yazılan giderler (doğalgaz, ciro kirası, harici…) eklenir. Fark varsa net
            kârın altında &quot;Excel temeli&quot; ayrıca yazar; &quot;Para nereye gitti?&quot; kartındaki &quot;Bu ay düşülen sabit gider&quot; kutusu farkı satır satır gösterir.
            SU GİDERİ reçetelerde su + buz maliyeti olarak sayıldığı için sabit giderde ikinci kez düşülmez.
          </>
        ),
        icon: Sigma,
        links: [{ href: "/panel", label: "Genel bakış" }],
      },
      {
        id: "tahmin",
        q: "Ay sonu tahmini ne zaman çıkar?",
        a: (
          <>
            Yalnızca devam eden ay için: POS cirosu ÷ açık gün × ayın gün sayısı × son satış ayının brüt kâr oranı − standart aylık sabit gider (Excel&apos;deki &quot;Ekim
            tahmini&quot;). Bitmiş bir ayda tahmin yapılmaz; yerine Gelir-gider&apos;deki gerçek sonuç (faturaya göre kâr/zarar) görünür.
          </>
        ),
        icon: CalendarCheck,
        links: [{ href: "/panel/satislar", label: "Açık gün ve POS cirosu" }],
      },
    ],
  },
  {
    title: "Panelde gezinme",
    items: [
      {
        id: "menu",
        q: "Menü düzeni",
        a: (
          <>
            Sol menü: {MENU_LAYOUT}. Alt sayfası olan öğeye dokununca liste açılır. Personel yalnızca {STAFF_LIST} ekranlarını görür.
          </>
        ),
        icon: LayoutList,
      },
      {
        id: "ara",
        q: "Arama (⌘K)",
        a: (
          <>
            <span className="inline-flex gap-1 align-middle">
              <Kbd>⌘K</Kbd>
              <Kbd>Ctrl K</Kbd>
            </span>{" "}
            ya da sol menünün üstündeki <strong className="font-semibold text-ink">Ara</strong> kutusu: ekran, ürün ve hammadde adında arar; Enter ile açar.
          </>
        ),
        icon: Search,
      },
      {
        id: "zil",
        q: "Bildirim zili",
        a: (
          <>
            Sol üstte L&apos;Affogato adının yanındaki zil (telefonda üst çubukta) bildirimleri üç başlıkta toplar: <strong className="font-semibold text-ink">Ödemeler</strong>{" "}
            (gecikmiş, bugün ve yakında ödenecekler), <strong className="font-semibold text-ink">Faturalar</strong> (başarısız Paraşüt eşitlemesi, son 24 saatte gelen
            faturalar, kontrol bekleyenler, hammaddeye bağlanmayı bekleyen ürünler) ve <strong className="font-semibold text-ink">Uyarılar</strong> (hammadde zammı ve son
            satış ayının <Path href="/panel" />&apos;taki &quot;Dikkat edilmesi gerekenler&quot; uyarıları). Bir bildirime dokununca ilgili ekran açılır; alttaki
            &quot;Ödemeler&quot; ve &quot;Genel bakış&quot; düğmeleri o ekranlara gider.
          </>
        ),
        icon: Bell,
      },
      {
        id: "profil",
        q: "Profil menüsü",
        a: "Sol alttaki adınıza dokununca açılır: Hesabım (parola değiştirme), Ayarlar, Yardım, laffogato.net, QR menü önizleme ve Çıkış yap.",
        icon: UserRound,
        links: [{ href: "/panel/hesap", label: "Hesabım" }],
      },
    ],
  },
];

const FORMULAS = [
  ["Birim maliyet", "Paket fiyatı ÷ paket içeriği"],
  ["Ürün maliyeti", "Σ (miktar × birim maliyet) × (1 + fire oranı)"],
  ["Net satış", "Satış fiyatı ÷ (1 + KDV)"],
  ["POS komisyonu", "Satış fiyatı × komisyon × kartlı satış oranı"],
  ["Birim kâr", "Net satış − ürün maliyeti − POS komisyonu"],
  ["Maliyet oranı", "Ürün maliyeti ÷ net satış (hedef: Ayarlar › Oranlar, ör. %30)"],
  ["Önerilen fiyat", "TAVAN(maliyet ÷ hedef oran × (1 + KDV); 5\u00a0₺)"],
  ["Durum", "İyi ≤ hedef · Dikkat ≤ hedef + 10 puan · Düşük kâr > hedef + 10 puan"],
  ["Eşleşmeyen POS ürünü", "Net ciro × eşleşen ürünlerin ortalama maliyet oranı"],
  ["Brüt kâr", "Net satış − malzeme/ambalaj (reçeteye göre) − POS komisyonu"],
  [
    "Net kâr / zarar (reçeteye göre)",
    "Brüt kâr − indirimler ÷ (1 + KDV) − o ayın sabit giderleri (Gelir-gider: açık gün oranı + bu aya özel giderler). Excel temeli: standart aylık sabit gider",
  ],
  ["Kâr / zarar (faturaya göre)", "Ciro ÷ (1 + KDV) − satılan malın maliyeti − giderler (Gelir-gider tablosu)"],
  ["Faturaya göre maliyet oranı", "Faturayla alınan mal (KDV hariç) ÷ net satış"],
  ["Günlük ortalama ciro", "Satış listesi toplamı (yoksa POS cirosu) ÷ açık gün"],
  ["Başabaş günlük ciro", "Standart aylık sabit gider ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün"],
  [
    "Ay sonu tahmini (yalnızca devam eden ay)",
    "POS cirosu ÷ açık gün × ayın gün sayısı × son satış ayının brüt kâr oranı − standart aylık sabit gider",
  ],
  ["Aylık sabit gider (gelir-gider)", "Aylık tutar × açık gün ÷ ayın gün sayısı (günlük giderler × açık gün)"],
  ["Su + buz litre maliyeti", "SU GİDERİ ÷ satışlara göre su + buz litresi (fatura girilmiş ve satış listesi olan son ay)"],
  ["Satılan malın maliyeti", "Önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)"],
];

// ---------------------------------------------------------------- Sayfa

function GoLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-4">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center pointer-coarse:min-h-11 gap-1 text-[13px] font-medium text-ink hover:underline">
          {l.label}
          <ArrowUpRight size={13} className="text-ink-quiet" aria-hidden="true" />
        </Link>
      ))}
    </span>
  );
}

/** Cevaptaki düz metin (arama için): menü yolları kenar çubuğundaki adlarıyla okunur */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement<{ href?: string; children?: ReactNode }>(node)) {
    if (node.type === Path && node.props.href) return pathOf(node.props.href).join(" ");
    return textOf(node.props.children);
  }
  return "";
}

const FAQ: FaqGroup[] = FAQ_GROUPS.map((g) => ({
  title: g.title,
  items: g.items.map((f) => ({
    id: f.id,
    title: f.q,
    text: `${textOf(f.a)} ${f.links?.map((l) => l.label).join(" ") ?? ""}`,
    icon: (
      <IconTile size="sm" tone={toneFor(f.q)}>
        <f.icon />
      </IconTile>
    ),
    description: (
      <>
        <span className="block">{f.a}</span>
        {f.links ? <GoLinks links={f.links} /> : null}
      </>
    ),
  })),
}));

function ExcelValue({ value }: { value: string | undefined }) {
  return value ? <span className="text-right text-xs text-ink-mute">{value}</span> : <Badge tone="blue">yeni</Badge>;
}

export default function HelpPage() {
  // Profil menüsündeki Hesabım da bir ekran; kenar çubuğu ağacından sonra listelenir
  const account = NAV_FOOTER.find((i) => i.href === "/panel/hesap");
  return (
    <>
      <PageHeader
        title="Yardım"
        eyebrow="Sistem"
        excel="Nasıl Kullanılır"
        description="Sistemin nasıl çalıştığı, her ay ne yapmanız gerektiği ve Excel'deki sayfaların karşılıkları."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={<CalendarCheck />}
            title="Her ay ne yapmalı?"
            description={
              <>
                Bu altı adımı her ay sonunda yaptığınızda bütün raporlar doğru olur. Hangilerinin yapıldığını <Link href="/panel" className="font-medium text-ink hover:underline">Genel bakış</Link>
                &apos;taki &quot;Bu ayın işleri&quot; kartı ay ay gösterir.
              </>
            }
          />
          <CardContent>
            <RoutineSteps
              steps={ROUTINE.map((r) => ({
                title: r.title,
                href: r.href,
                body: r.body,
                icon: (
                  <IconTile size="sm" tone={toneFor(r.href)}>
                    <r.icon />
                  </IconTile>
                ),
              }))}
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader icon={<Info />} title="Nasıl yapılır?" description="Sık yapılan değişiklikler ve bilinmesi gerekenler. Açmak için soruya dokunun ya da arayın." />
            <CardContent>
              <Suspense fallback={<HelpFaqFallback groups={FAQ} />}>
                <HelpFaq groups={FAQ} />
              </Suspense>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader icon={<Palette />} title="Renkler ve işaretler" />
              <CardContent>
                <ul className="space-y-3 text-sm leading-6 text-ink-soft">
                  <li>
                    <span className="cell-input font-semibold">Mavi yazı</span> — sizin girdiğiniz / değiştirebileceğiniz değerler. Gelir-gider tablosunda mavi noktalı hücre,
                    hesaplananın üzerine yazılmış demektir.
                  </li>
                  <li>
                    <Badge tone="amber">Tahmini</Badge> — faturada bulunamayan, tahmin edilen değer. Gerçek değeri yazınca hesaplar düzelir.
                  </li>
                  <li>
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      <StatusBadge status="İyi" />
                      <StatusBadge status="Dikkat" />
                      <StatusBadge status="Düşük kâr" />
                    </span>{" "}
                    — ürünün maliyet oranı hedefe göre. <StatusBadge status="Reçete yok" /> reçetesi girilmemiş ürün.
                  </li>
                  <li>
                    <Info size={14} className="inline align-[-2px] text-ink-quiet" aria-hidden="true" />
                    <span className="sr-only">Bilgi</span> simgesinin üzerine gelince ya da dokununca Excel&apos;deki hücre notlarının karşılığı olan açıklama çıkar.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={<Sigma />}
                title="Formüller"
                description="Hesaplama motoru Excel'deki formüllerin karşılığıdır ve otomatik testlerle Excel'in Eylül rakamlarına karşı doğrulanır. Bilerek yapılan farklar (ör. net kârda o ayın sabit giderleri) Nasıl yapılır? listesinde."
              />
              <CardContent>
                <Well className="px-4 py-0 ring-1 ring-line">
                  <dl className="divide-y divide-line text-sm">
                    {FORMULAS.map(([k, v]) => (
                      <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2.5">
                        <dt className="font-medium text-ink">{k}</dt>
                        <dd className="text-ink-soft">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Well>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader icon={<Table2 />} title="Excel sayfalarının karşılıkları" description="Menüdeki her ekran ve Excel'deki karşılığı." />
          <CardContent>
            <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {NAV_TREE.map((n) => (
                <li key={n.id}>
                  <Well className="h-full px-3 py-2 ring-1 ring-line">
                    <div className="flex min-h-9 items-center gap-3">
                      <IconTile size="sm" tone={toneFor(n.label)}>
                        <n.icon />
                      </IconTile>
                      {n.href ? (
                        <Link href={n.href} className="flex min-h-9 min-w-0 pointer-coarse:min-h-11 flex-1 items-center gap-1 text-sm font-medium text-ink hover:underline">
                          {n.label}
                          <ArrowUpRight size={13} className="shrink-0 text-ink-quiet" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{n.label}</span>
                      )}
                      {n.href ? <ExcelValue value={excelFor(n.href)} /> : null}
                    </div>
                    {n.children ? (
                      <ul className="mb-1 ml-[13px] border-l border-line-strong pl-[25px]" aria-label={`${n.label} sayfaları`}>
                        {n.children.map((c) => {
                          const tabs = c.match ? tabsOf(c.href) : undefined;
                          return (
                            <li key={c.id}>
                              <div className="flex items-center justify-between gap-3">
                                <Link href={c.href} className="inline-flex min-h-9 items-center pointer-coarse:min-h-11 gap-1 text-[13px] text-ink-soft hover:text-ink hover:underline">
                                  {c.label}
                                </Link>
                                {tabs ? null : <ExcelValue value={excelFor(c.href)} />}
                              </div>
                              {tabs ? (
                                <ul className="ml-1 border-l border-line pl-3" aria-label={`${c.label} sekmeleri`}>
                                  {tabs.map((t) => (
                                    <li key={t.href} className="flex items-center justify-between gap-3">
                                      <Link href={t.href} className="inline-flex min-h-9 items-center pointer-coarse:min-h-11 text-[13px] text-ink-mute hover:text-ink hover:underline">
                                        {t.label}
                                      </Link>
                                      <ExcelValue value={excelFor(t.href)} />
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </Well>
                </li>
              ))}
              {account ? (
                <li>
                  <Well className="h-full px-3 py-2 ring-1 ring-line">
                    <div className="flex min-h-9 items-center gap-3">
                      <IconTile size="sm" tone={toneFor(account.label)}>
                        <account.icon />
                      </IconTile>
                      <Link href={account.href} className="flex min-h-9 min-w-0 pointer-coarse:min-h-11 flex-1 items-center gap-1 text-sm font-medium text-ink hover:underline">
                        {account.label}
                        <ArrowUpRight size={13} className="shrink-0 text-ink-quiet" aria-hidden="true" />
                      </Link>
                      <span className="text-xs text-ink-mute">Profil menüsü</span>
                      <ExcelValue value={account.excel} />
                    </div>
                  </Well>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
