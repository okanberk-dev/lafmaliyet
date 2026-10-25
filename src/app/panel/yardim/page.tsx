import {
  ArrowUpRight,
  Bell,
  Bot,
  CalendarCheck,
  ChartNoAxesColumn,
  ClipboardList,
  Coffee,
  CupSoda,
  FileText,
  Globe,
  Grid3x3,
  HardDriveDownload,
  Info,
  LayoutList,
  Lightbulb,
  ListChecks,
  ListTodo,
  Newspaper,
  Package,
  PackageCheck,
  Palette,
  Pencil,
  Percent,
  Receipt,
  Ruler,
  Scale,
  ScanText,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sigma,
  Table2,
  Tag,
  Timer,
  TrendingUp,
  UserPlus,
  Undo2,
  UserRound,
  UsersRound,
  Wallet,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { NAV_FOOTER, navTreeFor } from "@/components/panel/nav";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { IconTile, toneFor } from "@/components/ui/icon-tile";

import { ButtonLink } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/misc";
import { requireAdmin } from "@/server/auth/dal";

import { buildFaq, type FaqItem, type PathText } from "./faq-build";
import { HelpFaq, HelpFaqFallback, type FaqGroup } from "./faq-search";
import { excelFor, pathOf, tabsOf } from "./nav-paths";
import { RoutineSteps } from "./routine-steps";

export const metadata: Metadata = { title: "Yardım" };

// ---------------------------------------------------------------- Menü yolları (kabuktaki adlarla, nav-paths.ts)

/**
 * "Genel bakış · Menü (Ürünler, Hammaddeler, Reçete defteri) · …": kenar çubuğunun rolüne göre gösterdiği ağaç
 * (navTreeFor), personelin üst düzey "Kasa raporu"su yöneticinin menüsünde sayılmasın
 */
const MENU_LAYOUT = navTreeFor("admin")
  .map((n) => (n.children ? `${n.label} (${n.children.map((c) => c.label).join(", ")})` : n.label))
  .join(" · ");
/** Personelin menüsü (tek alt sayfalı grup doğrudan o sayfa) ve profil menüsündeki Hesabım; aynı ekran bir kez */
const STAFF_SCREENS = [...navTreeFor("staff").flatMap((n): { label: string }[] => n.children ?? [n]).map((n) => n.label), "Hesabım"];
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
        personel listede olmayan kalemleri de yazabilir ya da her ay sayılacaksa Listeye ekle ile listeye ekler (paket fiyatını biliyorsa yazar, yoksa yönetici girer). &quot;Geçen aydan doldur&quot; ek
        kalemleri de taşır. Ayın ilk 10 gününde ekran, sayımı
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
        açık gün sayısını bugüne kadar olarak yazın: ay sonu tahmini bununla yapılır. Kasa raporu girilen aylarda boş bıraktığınız alanlar kasa raporlarından
        kendiliğinden dolar; elle yazdığınız her zaman geçerlidir.
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

/** Sık sorulanlar, konuya göre gruplu; her grup kendi yaylı akordeonu */
const FAQ_GROUPS: { title: string; items: FaqItem[] }[] = [
  {
    title: "Menü ve reçete",
    items: [
      {
        id: "zam",
        q: "Menüye zam yaptım",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranında satış fiyatı hücresini değiştirip Enter&apos;a basın ya da ürün kartında fiyatı değiştirin. Kartta fiyat simülatörü ile önce
            deneyebilirsiniz. Birçok ürüne birden zam için <Path href="/panel/urunler" /> › Fiyatlar › Toplu değiştir: kategoriyi ve boyu seçin, yüzde ya da tutar
            yazın (ör. %10, 5 ₺&apos;ye yukarı yuvarlanır); önizlemede her ürünün yeni fiyatı, maliyet oranı ve ayda kâra etkisi görünür, istemediğinizi çıkarın ya da
            fiyatını elle yazın. Toplu değişiklik Fiyatlar › Geçmiş&apos;ten geri alınabilir (sonradan değişen ürüne dokunulmaz). Ürün laffogato.net menüsüne bağlıysa
            (adın yanındaki küre) fiyat önce sitede değişir; sonra sitede Ayarlar › Vergi&apos;den fiyat listesinin tarihini güncelleyin. Kasadaki (ModPOS) fiyatı elle
            değiştirin: değişen her fiyat Fiyatlar › Kasaya işle listesine girer.
          </>
        ),
        icon: Tag,
        links: [
          { href: "/panel/urunler", label: "Ürünler" },
          { href: "/panel/urunler/fiyatlar", label: "Toplu fiyat" },
        ],
      },
      {
        id: "kasa-fiyat",
        q: "Kasadaki (ModPOS) fiyatlar",
        a: (
          <>
            Panelde, toplu ya da laffogato.net&apos;te değişen satış fiyatı ModPOS&apos;a kendiliğinden geçmez. Panel bunu unutmaz: fiyatı değişen her ürün{" "}
            <Path href="/panel/urunler" /> › Fiyatlar › Kasaya işle listesine kasadaki adı, eski ve yeni fiyatıyla girer; zil de &quot;Kasada değişecek N
            fiyat&quot; der. Kasada değiştirdikçe işaretleyin, işaretlenen listeden düşer (bildirimdeki Geri al geri getirir); liste açıkken fiyat yeniden
            değiştiyse işaretlenmez, yeni fiyatıyla listede kalır. Metni kopyala ile listeyi
            WhatsApp&apos;a yapıştırabilirsiniz. Fiyat kasadaki fiyata geri dönerse (ör. toplu değişiklik geri alındı) kendiliğinden düşer. Yeni ürün listeye girmez;
            kasaya zaten elle eklenir. Ürün kartının Fiyat geçmişi kartı da kasadaki eski fiyatı gösterir.
          </>
        ),
        icon: Receipt,
        links: [{ href: "/panel/urunler/fiyatlar?sekme=kasa", label: "Kasaya işle" }],
      },
      {
        id: "site-menusu",
        q: "Site menüsüyle bağlantı (fiyat ve Tükendi)",
        a: (
          <>
            Bir ürün laffogato.net menüsündeki kalemine bağlıysa satış fiyatı ve menü durumu iki yerde aynı kalır, doğru kaynak sitedir: sitede fiyat değişince ya da kalem
            “Tükendi” olunca panel birkaç saniyede alır; panelde fiyatı, “Menüde aktif”i ya da “QR menüde görünür / gizli” anahtarını değiştirince önce siteye yazılır, site ulaşılamazsa
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
            yok. Satışı, zayi kaydı ya da fiyat geçmişi olan ürün silinmez (geçmiş ayların maliyeti değişirdi): menüden kaldırmak için reçete kartında Menüde aktif
            anahtarını kapatın.
          </>
        ),
        icon: Coffee,
        links: [{ href: "/panel/urunler", label: "Ürünler" }],
      },
      {
        id: "personel-yeni-urun",
        q: "Personel yeni ürünü nasıl ekler?",
        a: (
          <>
            Personel <Path href="/panel/receteler" /> ekranında Yeni ürün öner&apos;e dokunur: adı, kategoriyi, boyları ve her boyun reçetesini yazar; biliyorsa boy
            başına satış fiyatını da yazar, maliyet görmez. Reçetedeki malzeme listede yoksa aramada &quot;Listede yok: … ekle&quot; ile formdan çıkmadan açar (Listeye
            ekle&apos;nin kuralıyla, sayım listesine de girer; paket fiyatı yazıldıysa Tahmini). Değişiklik önerisinde de tahmini fiyatlı malzeme onay kartında
            &quot;Tahmini fiyatlı&quot; diye yazar. Öneri <Path href="/panel/onaylar" /> ekranına ve zile düşer. Orada
            malzemelerin maliyetini satır satır görün (tahmini fiyatlı malzeme işaretli); satış fiyatı personelin önerisiyle dolu gelir, değiştirebilirsiniz, kâr marjı
            hemen hesaplanır; gerekirse adı ve kategoriyi düzeltin. &quot;Onayla ve ürünü ekle&quot; ürünü reçetesiyle Yeni ürün&apos;deki kuralla açar (zayi oranı
            kategoriden); reddederseniz notunuz personelin Önerilerim listesinde görünür. Yeni ürün laffogato.net menüsüne kendiliğinden bağlanmaz.
          </>
        ),
        icon: Lightbulb,
        links: [
          { href: "/panel/onaylar", label: "Onaylar" },
          { href: "/panel/receteler", label: "Reçete defteri" },
        ],
      },
      {
        id: "olcu",
        q: "Shot gramajı / pompa değişti",
        a: (
          <>
            <Path href="/panel/ayarlar" /> › Reçete ölçüleri. Formülle bağlı bütün reçeteler (ShotTek, Pompa, PurePompa …) birlikte güncellenir. Şurup pompası
            (Pompa) ve püre pompası (PurePompa) ayrı yazılır: başta 10 ml ve 30 ml; sizinkiler farklıysa ölçüp yazın. <Path href="/panel/receteler" /> şurup, sos ve
            püre satırlarında miktarın altında kaç pompa olduğunu gösterir (45 ml püre: 1,5 pompa). Miktarı ml yazılı satır pompa değişince aynı kalır, yalnız
            pompa sayısı değişir; pompayla birlikte değişsin isterseniz ürünün reçete kartında miktara 1,5*PurePompa yazın.
          </>
        ),
        icon: Ruler,
        links: [
          { href: "/panel/ayarlar#olculer", label: "Reçete ölçüleri" },
          { href: "/panel/receteler", label: "Reçete defteri" },
        ],
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
            bağlayın: alınan miktar ve (&quot;Fiyatı güncelle&quot; açıksa) paket fiyatı oradan güncellenir. Faturadaki fiyat şimdikinden %40&apos;tan fazla farklıysa
            uygulanmaz: <Path href="/panel/hammaddeler" /> › Onay bekleyen fiyatlar&apos;da onaylayın ya da reddedin (çoğu zaman çarpan yanlıştır, oradan düzeltilir).
            Paraşüt&apos;te olmayan (kâğıt, e-Arşiv) faturayı Faturalar ›
            Fatura ekle ile girin, fotoğrafını ya da PDF&apos;ini ekleyin; sonradan Paraşüt&apos;e girilirse aynı kayda bağlanır, iki kez sayılmaz. Bağlı olmayan bir malzemenin fiyatını{" "}
            <Path href="/panel/hammaddeler" /> ekranında elle değiştirin (fiyat geçmişi saklanır). Satışın iadesi (site ya da müşteri iadesi) Paraşüt&apos;te gider
            listesine düşse de gider sayılmaz; tedarikçiye iadeniz panele kendiliğinden girmez: ikisi de <Path href="/panel/parasut" /> ekranının başında yazar,
            tedarikçiye iadeyi Faturalar&apos;a aynı tedarikçiye eksi tutarla girin.
          </>
        ),
        icon: FileText,
        links: [
          { href: "/panel/faturalar?durum=kontrol", label: "Kontrol bekleyen faturalar" },
          { href: "/panel/parasut?durum=bekleyen", label: "Bağlanmayı bekleyen ürünler" },
          { href: "/panel/hammaddeler#fiyat-onayi", label: "Onay bekleyen fiyatlar" },
          { href: "/panel/hammaddeler", label: "Hammaddeler" },
        ],
      },
      {
        id: "carpan",
        q: "Fiyat onayındaki “Çarpanı … yap” önerisi",
        a: (
          <>
            Çarpan, faturadaki 1 birimin kaç hammadde birimi ettiğidir: 1 koli = 12 adet, adında “150 AD.” yazan 1 adet bardak = 150 adet. Yanlışsa fiyat da
            alınan miktar da yanlış çıkar. <Path href="/panel/hammaddeler" /> › Onay bekleyen fiyatlar öneriyi kanıtla yapar: kalemin adında yazan paket
            boyu, yoksa faturanın kendisi (Claude okur, kartta “Faturada: …” yazar), yoksa aynı ürünün eski faturaları. Önerinin yanında o çarpanla çıkan
            birim fiyat ve şimdikine göre farkı yazar; fiyat gerçekten değiştiyse çarpanı değiştirmeden onaylayın. Şimdiki fiyat tahminiyse kart söyler,
            onaylayınca Tahmini kalkar. <Path href="/panel/parasut" /> ekranındaki Kontrol edilecek bağlantılar, adında yazan paket boyuyla tutmayan
            bağlantıları gösterir; hiçbir şey kendiliğinden değişmez.
          </>
        ),
        icon: ScanText,
        links: [
          { href: "/panel/hammaddeler#fiyat-onayi", label: "Onay bekleyen fiyatlar" },
          { href: "/panel/parasut?durum=bagli#urun-baglantilari", label: "Bağlı ürünler" },
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
      {
        id: "sayim-kalem",
        q: "Sayım listesine nasıl kalem eklenir?",
        a: (
          <>
            <Path href="/panel/sayim" /> ekranında Listeye ekle: ad, grup, sayım birimi, isteğe bağlı paket ve paket fiyatı. Personel de ekleyebilir; kalem hemen
            listeye girer ve bu aydan itibaren her ay sayılır. Paket fiyatı yazıldıysa o fiyatla Tahmini açılır (yönetici KDV hariç yazar; personel fişteki gibi KDV dahil
            yazar, KDV düşülüp kaydedilir; Hammaddeler&apos;in Tahmini süzgecinde doğrulayın);
            yazılmadıysa 0 ve Tahmini açılır, zil &quot;Fiyatı girilmemiş&quot; der:{" "}
            <Path href="/panel/hammaddeler" /> ekranındaki Fiyat yok süzgecinden paket fiyatını girin (ilk fiyat zam sayılmaz). Yalnız bu ay rafta duran tek seferlik bir
            şey için sayımdaki Listede olmayanlar yeter.
          </>
        ),
        icon: ClipboardList,
        links: [
          { href: "/panel/sayim", label: "Stok sayımı" },
          { href: "/panel/hammaddeler?durum=fiyatsiz", label: "Fiyatı girilmemiş hammaddeler" },
        ],
      },
      {
        id: "mal-siparisi",
        q: "Mal siparişi nasıl verilir?",
        a: (
          <>
            Önce <Path href="/panel/mal-siparisi/kalemler" /> ekranında 10–15 kritik kalem seçin; hedef stok satışlara göre önerilir, isterseniz elle yazın.
            Sayım gününde (varsayılan Pazartesi) personel ya da siz <Path href="/panel/hizli-sayim" /> ekranında bu kalemleri sayarsınız; ay sonu sayımı ayrıdır.{" "}
            <Path href="/panel/mal-siparisi" /> ekranı her tedarikçi için ne kadar sipariş edileceğini hazırlar (hedef − eldeki − siparişte, koli ya da pakete
            yuvarlanmış); miktarı değiştirip WhatsApp ile gönder&apos;e dokunun. Mesaj tedarikçinin kartındaki cep telefonuna hazır açılır; telefon yoksa ya da sabit
            hatsa WhatsApp&apos;ta kişiyi siz seçersiniz. Gönderilen sipariş kaydedilir ve gelene kadar siparişte sayılır; mal gelince personel Hızlı sayım ekranında Geldi&apos;ye
            dokunur. Yanlışlıkla denen Geldi&apos;yi <Path href="/panel/mal-siparisi/gonderilen" /> ekranında geri alırsınız.
          </>
        ),
        icon: ShoppingBasket,
        links: [
          { href: "/panel/mal-siparisi", label: "Mal siparişi" },
          { href: "/panel/mal-siparisi/kalemler", label: "Sipariş kalemleri" },
        ],
      },
      {
        id: "teslim",
        q: "Gelen mal siparişle tutmuyor",
        a: (
          <>
            Paraşüt faturası gelip kalemleri okununca sipariş kalem kalem karşılaştırılır: eksik, fazla, fiyat farkı ve siparişte olmayan kalem{" "}
            <Path href="/panel/mal-siparisi/gonderilen" /> ekranında ve zilde görünür. Fark yoksa sipariş kendiliğinden kapanır. Tedarikçiyle konuştuktan sonra
            Kapat&apos;a dokunun (not yazabilirsiniz). Yanlış faturayla eşleştiyse Faturayı değiştir. Miktar 12 kat gibi tuhaf görünüyorsa faturadaki ürünün
            hammadde bağlantısındaki çarpanı <Path href="/panel/parasut" /> ekranında düzeltin; karşılaştırma kendiliğinden yenilenir. Tahmini fiyatlı kalemde
            fiyat farkı aranmaz.
          </>
        ),
        icon: PackageCheck,
        links: [
          { href: "/panel/mal-siparisi/gonderilen?durum=fark", label: "Farkı olan siparişler" },
          { href: "/panel/parasut?durum=bagli#urun-baglantilari", label: "Bağlı ürünler" },
        ],
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
        id: "fotograf",
        q: "Fiş ve Z raporunu fotoğraftan doldurmak",
        a: (
          <>
            <Path href="/panel/kasa" /> ekranında Z raporunun ve banka POS gün sonu fişinin fotoğrafını çekin; rakamlar forma dolar. Turuncu alanları fişle
            karşılaştırıp gönderin; hiçbir şey kendiliğinden kaydedilmez. Gün içinde kasadan para çıkınca aynı ekranda Fiş ekle ile fişin fotoğrafını çekin: tutar, KDV
            ve ne alındığı okunur, kaydedince <Path href="/panel/harcamalar" />&apos;a da yazılır. Okuma Claude ile yapılır (fotoğraf başına yaklaşık 0,03 $); aç / kapat
            ve bu ayın tutarı Ayarlar › Fotoğraftan okuma&apos;da. Fotoğraflar kasa için 6 ay, fiş için 13 ay saklanır.
          </>
        ),
        icon: Receipt,
        links: [
          { href: "/panel/kasa", label: "Kasa raporu" },
          { href: "/panel/ayarlar#foto", label: "Fotoğraftan okuma" },
        ],
      },
      {
        id: "kontrol",
        q: "Açılış ve kapanış listeleri",
        a: (
          <>
            Personel sabah açılışta ve gece kapanışta listeyi telefondan <Path href="/panel/kontrol" /> ekranında doldurur: maddeyi işaretler, buzdolabı
            sıcaklığını yazar, istenen yerde fotoğraf çeker. Her dokunuş hemen kaydedilir; geçmiş bir gün sonradan doldurulamaz (gün 05:00&apos;te döner). Sıcaklık aralık
            dışındaysa not ister ve size bildirilir. Listeler Bugün ekranında görünür; yapılmayan liste ertesi sabah e-postada çıkar. Maddeleri ve saatleri
            Kontrol listeleri › Listeler&apos;den, geçmişi Kontrol listeleri › Geçmiş&apos;ten görürsünüz. Personel de son 7 günü Geçmiş&apos;ten görür; geçmiş gün
            doldurulamaz. Fotoğraflar 60 gün saklanır.
          </>
        ),
        icon: ListChecks,
        links: [
          { href: "/panel/kontrol", label: "Kontrol listeleri" },
          { href: "/panel/kontrol/gecmis", label: "Geçmiş" },
          { href: "/panel/kontrol/duzenle", label: "Listeler" },
        ],
      },
      {
        id: "tedarikci",
        q: "Tedarikçinin bilgileri ve ödemesi",
        a: (
          <>
            <Path href="/panel/tedarikciler" /> ekranında her tedarikçi faturalarından kendiliğinden listelenir: kalan borç, vadesi geçen ve en yakın vade. Tedarikçiye
            dokunup Düzenle&apos;den unvanı, vergi no ve dairesini, IBAN&apos;ı (kontrol hanesi denetlenir), telefon ve e-postayı, vade gününü yazın; Faturadan doldur unvan,
            vergi no, adres, iletişim ve IBAN&apos;ı en yeni Paraşüt faturasından okur. Geçmiş faturaları al, tedarikçinin Paraşüt&apos;teki eski faturalarını da getirir.
            Aynı vergi numarasıyla farklı adla gelen faturalar (“Kaldi” ile “KALDI KAHVE TİC. A.Ş.”) tek tedarikçide toplanır; kartta yazdığınız ad ve diğer adlar hep
            önce gelir. Aynı numara iki tedarikçide duruyorsa sayfasının üstünde yazar. Sil: faturası olmayan tedarikçi silinir; faturası olan listeden kalkar (faturaları ve giderler yerinde kalır, borcu olan kaldırılamaz). Paraşüt&apos;ten gelen fatura “ödenmedi” gelir: ödediğinizde durum hapına dokunup
            Ödendi&apos;yi seçin (ödeme günü ve şekliyle), birden çok faturayı seçip toplu işaretleyin. Ödeme talebi seçtiğiniz faturaların tutarını, IBAN&apos;ı ve havale
            açıklamasını hazır metin yapar (son iade faturaları seçilirse düşülür); kopyalayın ya da WhatsApp&apos;la gönderin, Talep edildi işaretle ile faturalar “talep
            edildi” olur. Komisyon faturaları (Trendyol, Yemek Sepeti, yemek kartları) hakedişten düşüldüğü için ödendi gelir; hakedişin gelip gelmediğini Komisyon
            &amp; hakediş&apos;te işaretleyin. Peşin ya da kartla otomatik ödediğiniz tedarikçinin bilgilerinde Faturaları ödendi gelsin&apos;i açın. IBAN değişikliğini
            tedarikçiyi arayarak teyit edin.
          </>
        ),
        icon: Wallet,
        links: [{ href: "/panel/tedarikciler", label: "Tedarikçiler" }],
      },
      {
        id: "komisyon",
        q: "Yemek kartı ve platform komisyonu doğru mu?",
        a: (
          <>
            <Path href="/panel/komisyonlar" /> ekranında her kart ve platformun o ay kestiği her şey (komisyon, erken ödeme, diğer ücretler; KDV hariç) satışa
            bölünür: gerçek oran. Yemek kartında %6&apos;yı aşan oran, kira / cihaz / destek gibi komisyon dışı ücret ve erken ödeme ücreti işaretlenir;
            platformda sipariş ve ödeme altyapısı ücreti. Uyarılar faturadaki kalem adlarına bakar, kesin hüküm değildir. Satış, o ay tek yemek kartı (ya da tek
            platform) faturası varsa kasa raporlarındaki Z toplamından gelir; birden çoksa Z&apos;de tek toplam olduğu için kanalın aylık ekstresindeki satışı
            Satışı yaz ile girin. Hakediş bankaya gelince Hakediş geldi&apos;ye dokunup günü ve tutarı yazın; son gün (ayın son faturası + Kanallar&apos;daki
            süre, yemek kartında en çok 30 gün) geçerse zil çalar ve sabah e-postasında yazar.
          </>
        ),
        icon: Percent,
        links: [
          { href: "/panel/komisyonlar", label: "Komisyon & hakediş" },
          { href: "/panel/komisyonlar#kanallar", label: "Kanallar" },
        ],
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
        id: "nakit-plani",
        q: "Önümüzdeki haftalarda param yeter mi?",
        a: (
          <>
            <Path href="/panel/hatirlaticilar" /> ekranının başındaki Nakit planı önümüzdeki 6 haftayı hafta hafta gösterir: gelecek para (son 4 haftanın kasa
            raporlarından günlük satış, laffogato.net online), vade gününde ödenmemiş faturalar, hatırlatıcılar, maaş, SGK, KDV ve hatırlatıcısı olmayan sabit
            giderler (faturadaki KDV&apos;siyle: kira ve faturalar %20, personel KDV&apos;siz; oran Giderler&apos;de kalemin Faturadaki KDV alanında). Önce Bakiyeyi gir ile bankadaki ve kasadaki paranın bugünkü toplamını yazın; plan bu tutardan başlar, en sıkışık günü ve para
            yetmeyecekse hangi gün yetmeyeceğini söyler. Bakiye girilmezse bugün elinizde olması gereken en az parayı yazar. Tutarı belli olanlar (fatura,
            tutarı girilmiş hatırlatıcı) kesindir, ötekiler “tahmini” yazar: bir tahmini kesinleştirmek için Ödemeler&apos;e tutarıyla hatırlatıcı ekleyin, plan
            onun gününü ve tutarını kullanır. Faturası ayrıca gelen bir sabit gideri Tahmine katılanlar&apos;dan kapatın, iki kez sayılmasın. Her varsayım
            ekrandaki Nasıl hesaplandı kartında rakamlarıyla yazar.
          </>
        ),
        icon: ChartNoAxesColumn,
        links: [{ href: "/panel/hatirlaticilar/nakit", label: "Nakit planı" }],
      },
      {
        id: "satis-tahmini",
        q: "Önümüzdeki hafta ne kadar satarız, kaç kişi çalışmalı?",
        a: (
          <>
            <Path href="/panel/tahmin" /> her sabah önümüzdeki 7 günün satışını (Z toplamı) kasa raporlarından, hafta gününden, bayram ve tatillerden, Ramazan ve
            okul tatilinden, hava durumundan (Tuzla, MET Norway) ve sizin girdiğiniz özel günlerden (derbi, AVM etkinliği, kampanya, kapalı gün) hesaplar. Kaç kişi
            önerisi &apos;bir kişinin günde karşıladığı satış&apos; ayarından, tatlı önerisi son satış aylarındaki tatlı payından gelir. Her sabahki tahmin kaydedilir ve
            gerçekleşen Z toplamıyla karşılaştırılır; ilk haftalarda veri az olduğu için aralık geniştir. Personel Bugün ekranında yalnız yoğunluğu ve tatlı sayısını
            görür, tutarı görmez.
          </>
        ),
        icon: TrendingUp,
        links: [{ href: "/panel/tahmin", label: "Satış tahmini" }],
      },
      {
        id: "kdv-tahmini",
        q: "Bu ay ne kadar KDV ödeyeceğim?",
        a: (
          <>
            Nakit planındaki KDV tahmini kartı, önceki ayın satışlarındaki KDV&apos;den (kafe %10, karaoke %20, laffogato.net) alış faturalarındaki KDV&apos;yi düşer;
            sonuç ayın 28&apos;inde plana girer. Eksi çıkarsa ödeme beklenmez, fark sonraki aya devreder. Bu bir tahmindir; kesin tutar muhasebecinizin
            beyannamesindedir. Muhasebeciniz tutarı söyleyince{" "}
            <Path href="/panel/hatirlaticilar" /> ekranındaki KDV hatırlatıcısına yazın, plan onu kullanır; ödendi deyince tutar silinir, çünkü her ay farklıdır.
          </>
        ),
        icon: Percent,
        links: [{ href: "/panel/hatirlaticilar/nakit#kdv", label: "KDV tahmini" }],
      },
      {
        id: "zam-etkisi",
        q: "Zamlar bana ayda kaça mal oluyor?",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranındaki Hammadde zamları kartı, son 30 günde fiyatı artan malzemelerin ayda kaç lira kâr götürdüğünü yazar: her ürünün
            maliyet artışı (fire payı dahil; Zayi &amp; ikram kayıtları sayılmaz) son satış ayındaki adediyle çarpılır; adetler Ayarlar&apos;daki ayda açık gün
            sayısına çevrilir. Toplamı Genel bakış&apos;taki uyarıda, zilde ve sabah e-postasında da yazar; ürün kartı o ürünün payını gösterir. Satışlar&apos;a ürün
            satış raporu yüklenmemişse yalnız birim maliyet farkı görünür; ürüne eşleşmeyen satışlar sayılmaz. Ucuzlayan malzemenin aylık kazancı yeşil yazar.
          </>
        ),
        icon: TrendingUp,
        links: [{ href: "/panel/urunler#zamlar", label: "Hammadde zamları" }],
      },
      {
        id: "hesap",
        q: "Personele hesap açmak",
        a: (
          <>
            <Path href="/panel/kullanicilar" /> › Kullanıcı ekle: giriş e-postasını siz yazarsınız, rol: Personel. Parolayı siz belirleyebilir ya da davet bağlantısı
            gönderebilirsiniz: kişi parolasını 72 saat geçerli bağlantıdan kendisi belirler; bağlantıyı kopyalayın, WhatsApp&apos;ta ya da e-postayla paylaşın. Personel
            Bugün, Karaoke (bar ekranı: uygulama siparişleri, oda sayacı), Kasa raporu (Z raporu ve fişler fotoğraftan), Kontrol listeleri, Zayi &amp; ikram, Reçete
            defteri (değişiklik ve yeni ürün önerir, önerirken satış fiyatı yazabilir), Stok sayımı (Listeye ekle ile kalem ekler), Hızlı sayım (haftalık kritik kalemler, gelen mal siparişine Geldi, sipariş taslağı), Özel günler, Hatırlatıcılarım, kendi Yardım&apos;ı ve Hesabım
            ekranlarını görür; önemli düzeltmeler isteğe döner, <Path href="/panel/onaylar" /> ekranında karar verirsiniz. Personelin Yardım&apos;ı
            (Yardım başlığındaki Personelin Yardım&apos;ı düğmesi) yalnız onun ekranlarını anlatır; hesabı açtıktan sonra ona gösterin. maliyet, maaş, kâr ve karaoke tutarlarını görmez. Her kullanıcı Hesabım&apos;dan parolasını değiştirip iki adımlı doğrulamayı (Google
            Authenticator vb.) açabilir. Yönetici eklerken ya da bir yöneticinin rolünü, parolasını, e-postasını değiştirirken kendi parolanız sorulur.
          </>
        ),
        icon: UserPlus,
        links: [
          { href: "/panel/kullanicilar", label: "Kullanıcılar & roller" },
          { href: "/panel/hesap", label: "Hesabım (iki adımlı doğrulama)" },
          { href: "/panel/yardim/personel", label: "Personelin Yardım'ı" },
        ],
      },
      {
        id: "claude",
        q: "Claude'dan panele soru sormak",
        a: (
          <>
            {/* Claude'un menü adları İngilizce (Anthropic'in belgesindeki gibi); bağlantı doğrudan o sayfayı açar */}
            Claude&apos;da (web ya da masaüstü){" "}
            <a href="https://claude.ai/customize/connectors" target="_blank" rel="noopener noreferrer" className="font-medium whitespace-nowrap text-ink underline underline-offset-2">
              Customize › Connectors
            </a>{" "}
            sayfasında <strong className="font-semibold text-ink">Add custom connector</strong> düğmesine basıp{" "}
            {/* Telefonda adres kendi satırına geçer, ortadan bölünmez */}
            <code className="inline-block max-w-full rounded bg-surface px-1 font-mono text-[12px] break-all text-ink ring-1 ring-line sm:text-[13px]">https://ladmin.laffogato.net/api/mcp</code>{" "}
            adresini girin, <strong className="font-semibold text-ink">Connect</strong>&apos;e basın, panele girip parolanızla izin verin. Claude rakamları panelden okur ve
            hesabı gösterir; hiçbir şeyi değiştiremez.
            IBAN, vergi no, telefon, e-posta, notlar, personel ve müşteri adları gönderilmez. Bağlantıyı Hesabım&apos;dan kaldırabilirsiniz; 90 günde bir ya da parolanızı
            değiştirince yeniden bağlanmanız gerekir. Yalnız yönetici bağlayabilir.
          </>
        ),
        icon: Bot,
        links: [{ href: "/panel/hesap#bagli-uygulamalar", label: "Hesabım (Bağlı uygulamalar)" }],
      },
    ],
  },
  {
    title: "Bilinmesi gerekenler",
    items: [
      {
        id: "kdv",
        q: "KDV",
        a: "Menü fiyatları KDV dahil (%10). Kasada çalınan karaoke gibi hizmet satışları %20: Satışlar'da HİZMET olarak işaretlenen satırlar kendi oranıyla ayrılır (Ayarlar › Oranlar › Hizmet satışı KDV oranı). Malzeme maliyetleri KDV hariç, çünkü alışta ödenen KDV indirilebiliyor.",
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
            stok birikmesi ya da reçetede eksik malzemedir. Stok sayımı girdikçe iki rakam birbirine yaklaşır. İkisi de laffogato.net online satışını (uygulama
            siparişleri, mağaza, karaoke) içerir: Genel bakış&apos;ta online satış reçetesiyle, menüye bağlı olmayan satırlar ortalama maliyet oranıyla sayılır.
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
            kullanır: kalemler gün oranıyla bölünür (açık günü kasa raporlarından gelen ayda takvim günüyle: kapalı bir gün kirayı ve maaşı düşürmez), elle düzeltilen hücreler ve yalnızca o aya yazılan giderler (doğalgaz, ciro kirası, harici…) eklenir. Fark varsa net
            kârın altında &quot;Excel temeli&quot; ayrıca yazar; &quot;Para nereye gitti?&quot; kartındaki &quot;Bu ay düşülen sabit gider&quot; kutusu farkı satır satır gösterir.
            SU GİDERİ reçetelerde su + buz maliyeti olarak sayıldığı için sabit giderde ikinci kez düşülmez. Panel kâra laffogato.net online satışının brüt kârını da
            katar; Excel&apos;de online satış yoktu.
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
            Yalnızca devam eden ay için: POS cirosu ÷ açık gün × ayın gün sayısı × son satış ayının brüt kâr oranı + online satışın brüt kârı (aynı tempoyla) −
            standart aylık sabit gider (Excel&apos;deki &quot;Ekim tahmini&quot;). Bitmiş bir ayda tahmin yapılmaz; yerine Gelir-gider&apos;deki gerçek sonuç (faturaya göre
            kâr/zarar) görünür.
          </>
        ),
        icon: CalendarCheck,
        links: [{ href: "/panel/satislar", label: "Açık gün ve POS cirosu" }],
      },
      {
        id: "ay-ortasi-liste",
        q: "Ay bitmeden satış listesi yüklemek",
        a: (
          <>
            Ay sürerken Patron&apos;un satış raporunu <Path href="/panel/satislar" /> ekranına yüklerken Liste hangi güne kadar? alanına raporun son gününü yazın
            (varsayılan dün). Kasa raporları her akşam ilerler; Genel bakış günlük ortalamayı, POS cirosuyla karşılaştırmayı, indirimi ve reçeteye göre kârın sabit
            giderini listenin günleriyle hesaplar, &quot;POS cirosu tutmuyor&quot; uyarısı yanlış yere çıkmaz. Ay bitince ayın tamamının listesini Yenisiyle değiştir ile
            yükleyin; biten aya yüklenen liste ayın tamamı sayılır.
          </>
        ),
        icon: CalendarCheck,
        links: [{ href: "/panel/satislar", label: "Satışlar" }],
      },
      {
        id: "gunluk-isler",
        q: "Sabah e-postası ya da Paraşüt faturaları gelmedi",
        a: (
          <>
            Her sabah iki iş kendiliğinden çalışır: 07:00–08:00 Paraşüt eşitlemesi, 08:00–09:00 sabah işi (sabah e-postası, hatırlatıcı bildirimi, laffogato.net
            eşitlemeleri). Biri çalışmazsa ya da hata verirse zilde <strong className="font-semibold text-ink">Sistem</strong> başlığında,{" "}
            <Path href="/panel" />&apos;ta kırmızı şeritle ve <Path href="/panel/bugun" />&apos;de ilk satırda görünür, ertesi sabah e-postayla
            da gelir. Son çalışmalar ve hataları Ayarlar › Günlük işler&apos;de.
            Beklemek istemezseniz <Path href="/panel/parasut" /> › Şimdi eşitle ya da <Path href="/panel/hatirlaticilar" /> › Bugünküleri şimdi gönder.
          </>
        ),
        icon: Timer,
        links: [{ href: "/panel/ayarlar#isler", label: "Günlük işler" }],
      },
      {
        id: "haftalik-ozet",
        q: "Pazartesi gelen haftalık özet nedir?",
        a: (
          <>
            Her pazartesi sabah 08:00–09:00 arasında yöneticilere kısa bir e-posta gider: geçen haftanın ve bekleyen işlerin en
            önemli en çok 5 maddesi, kasanıza etkisine göre sıralı (zam, nakit planı, kasa farkı, komisyon, ModPOS fiyatları,
            zayi, stok farkı; karaoke doluluğu ve kontrol listeleri sonda). Her madde ilgili ekranı açar. Maddelerin üstünde geçen
            haftanın kasa cirosu ve satış tahmini kendi verisiyle çalışıyorsa önümüzdeki 7 günün beklenen satışı yazar. Bir bilgi
            okunamazsa o madde atlanır, e-posta yine gider. Açıp kapatmak, önizlemek ve kendinize örnek göndermek için{" "}
            <Path href="/panel/hatirlaticilar" /> › E-posta bildirimleri › Haftalık özet.
          </>
        ),
        icon: Newspaper,
        links: [{ href: "/panel/hatirlaticilar", label: "E-posta bildirimleri" }],
      },
      {
        id: "bar-baglanti",
        q: "Bar ekranında “Son kontrol başarısız” yazıyor",
        a: (
          <>
            <Path href="/panel/karaoke" /> ekranı yeni rezervasyon ve siparişleri laffogato.net&apos;ten alır. Site ulaşılamazsa sarı satırda son başarılı
            kontrolün saati yazar; ekran açık kaldıkça panel kendisi yeniden dener (karaokede iki dakikada, siparişlerde dakikada bir), o arada
            yenileri sitenin panelinde de kontrol edin. Personel bu satırda hatanın ayrıntısı yerine size haber vermesini söyleyen kısa sözü görür. Barın tabletinde ekrandaki Bu cihazda uyarılar kartından bildirimlere izin verin: yeni rezervasyon
            ve sipariş anında gelir, ekran panelin veritabanını daha seyrek sorar (ücretsiz planın aylık süresi bitmesin).
          </>
        ),
        icon: Wifi,
        links: [{ href: "/panel/karaoke", label: "Karaoke (bar ekranı)" }],
      },
      {
        id: "yedek",
        q: "Yedek nasıl alınır, nasıl geri yüklenir?",
        a: (
          <>
            <Path href="/panel/ayarlar" /> › Yedek › Yedeği indir: parolanızı girince paneldeki bütün veri tek dosyada iner. Ayda bir indirip bilgisayarınızda ya
            da Google Drive&apos;da saklayın; son yedek 30 günü geçince zil hatırlatır. Dosyada ciro, maaş ve IBAN&apos;lar var (parolalar yok), kimseyle
            paylaşmayın. Geri yükleme panelden yapılmaz: gerekirse dosyayı geliştiriciye verin, bilgisayardan bir komutla yükler (docs/YEDEK.md). Aynı
            karttaki Excel kopyası okumak içindir, geri yüklenmez.
          </>
        ),
        icon: HardDriveDownload,
        links: [{ href: "/panel/ayarlar#yedek", label: "Yedek" }],
      },
      {
        id: "karaoke-doluluk",
        q: "Karaoke odası ne zaman boş?",
        a: (
          <>
            Karaoke doluluğu ekranı (<Path href="/panel/karaoke" /> › Bu ay › Doluluk haritası) odanın hangi gün ve saatte dolu olduğunu gösterir: son 4 hafta,
            son 12 hafta ya da bir ay. Hücreye dokununca o saatin ayrıntısı çıkar; üstte doluluk, saat başına gelir, uzatma, son dakika iptal ve rezervasyonların
            kaç gün önceden yapıldığı, altta ay ay karşılaştırma var. Doluluk oda saatlerine göre hesaplanır (ekranın altındaki Oda saatleri; başta her gün
            12:00–24:00, sitedeki karaoke saatleri). İlk kullanımda Geçmişi siteden al ile laffogato.net&apos;teki eski rezervasyonları alın (ad ve not
            alınmaz); rezervasyonsuz gruplar yalnız bar ekranındaki hızlı sayaçla sayılır. Yalnız yönetici görür.
          </>
        ),
        icon: Grid3x3,
        links: [{ href: "/panel/karaoke/doluluk", label: "Karaoke doluluğu" }],
      },
    ],
  },
  {
    title: "Panelde gezinme",
    items: [
      {
        id: "bugun",
        q: "Bugün ekranında ne var?",
        a: (
          <>
            <Path href="/panel/bugun" /> günün işlerini tek listede toplar: dünkü ve bugünkü kasa raporu, açılış ve kapanış listeleri, gecikmiş ve bugünkü ödemeler, kontrol bekleyen
            faturalar, onay bekleyen reçete ve fiyatlar, kasada değişecek fiyatlar, ay sonu sayımı, hızlı sayım ve mal siparişi, hatırlatıcılarınız. Her satır ilgili ekranı açar;
            sıradaki iş siyah çerçeveyle öne çıkar, biten işler Tamamlananlar&apos;da. Personel girişte bu ekranda açılır ve yalnız kendi işlerini (kasa
            raporu, kontrol listeleri, zayi, sayım, hızlı sayım) görür. Telefonda alt menüde Genel bakış, Bugün, Kasa, Ödemeler ve Menü var; Satışlar ve Faturalar Menü&apos;de.
          </>
        ),
        icon: ListTodo,
        links: [{ href: "/panel/bugun", label: "Bugün" }],
      },
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
            Sol üstte L&apos;Affogato adının yanındaki zil (telefonda üst çubukta) bildirimleri başlıklar altında toplar, örneğin{" "}
            <strong className="font-semibold text-ink">Onaylar</strong> (personelin reçete değişiklikleri ve yeni ürün önerileri, faturada şimdikinden %40&apos;tan fazla farklı gelen hammadde fiyatları), <strong className="font-semibold text-ink">Kontrol listeleri</strong>{" "}
            (geciken ve dünden eksik listeler, aralık dışı değerler), <strong className="font-semibold text-ink">Ödemeler</strong>{" "}
            (gecikmiş, bugün ve yakında ödenecekler), <strong className="font-semibold text-ink">Faturalar</strong> (başarısız Paraşüt eşitlemesi, son 24 saatte gelen
            faturalar, kontrol bekleyenler, hammaddeye bağlanmayı bekleyen ürünler, mal siparişlerinin teslim farkları ve gelmeyenleri) ve <strong className="font-semibold text-ink">Uyarılar</strong> (hammadde zammı, fiyatı girilmemiş hammaddeler ve son
            satış ayının <Path href="/panel" />&apos;taki &quot;Dikkat edilmesi gerekenler&quot; uyarıları). Günlük işlerden biri (Paraşüt eşitlemesi, sabah
            e-postası) çalışmadıysa ya da hata verdiyse, ya da son yedek 30 günden eskiyse en üstte <strong className="font-semibold text-ink">Sistem</strong>{" "}
            başlığı çıkar. Bir bildirime dokununca
            ilgili ekran açılır; alttaki &quot;Ödemeler&quot; ve &quot;Genel bakış&quot; düğmeleri o ekranlara gider.
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
  ["Brüt kâr", "Net satış − malzeme/ambalaj (reçeteye göre) − POS komisyonu; Genel bakış'ta laffogato.net online satışı da dahil"],
  [
    "Net kâr / zarar (reçeteye göre)",
    "Brüt kâr (laffogato.net online dahil) − indirimler ÷ (1 + KDV) − o ayın sabit giderleri (Gelir-gider: gün oranı + bu aya özel giderler). Satış listesi ayın bir kısmını kapsıyorsa indirim o günlerin kasa raporlarından, sabit gider ve online satış o günlere düşen payla. Excel temeli: standart aylık sabit gider",
  ],
  [
    "Kâr / zarar (faturaya göre)",
    "Ciro ÷ (1 + KDV) − satılan malın maliyeti − giderler (Gelir-gider tablosu). Satışlar'daki HİZMET satırları (karaoke) kadarı hizmet KDV'siyle (%20) ayrılır",
  ],
  ["Faturaya göre maliyet oranı", "Faturayla alınan mal (KDV hariç) ÷ net satış (laffogato.net online dahil)"],
  ["Günlük ortalama ciro", "Satış listesi toplamı (yoksa POS cirosu) ÷ açık gün; liste ayın bir kısmını kapsıyorsa listenin kendi açık günü"],
  ["Başabaş günlük ciro", "(Standart aylık sabit gider − kapanmış son ayın laffogato.net online brüt kârı) ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün"],
  [
    "Ay sonu tahmini (yalnızca devam eden ay)",
    "POS cirosu ÷ açık gün × ayın gün sayısı × son satış ayının brüt kâr oranı + laffogato.net online brüt kârı (aynı tempoyla) − standart aylık sabit gider",
  ],
  [
    "Aylık sabit gider (gelir-gider)",
    "Aylık tutar × gün ÷ ayın gün sayısı. Gün: açık gün elle yazıldıysa o; kasa raporlarından geliyorsa raporların kapsadığı takvim günü (kapalı bir gün kirayı ve maaşı düşürmez). Günlük giderler × açık gün",
  ],
  ["Su + buz litre maliyeti", "SU GİDERİ ÷ satışlara göre su + buz litresi (fatura girilmiş ve satış listesi olan son ay)"],
  ["Satılan malın maliyeti", "Önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)"],
];

// ---------------------------------------------------------------- Sayfa

/** Yöneticinin cevaplarındaki <Path>'in arama metni: kenar çubuğundaki adlarla */
const adminPathText: PathText = (el) => (el.type === Path && el.props.href ? pathOf(el.props.href).join(" ") : undefined);

const FAQ: FaqGroup[] = buildFaq(FAQ_GROUPS, adminPathText);

function ExcelValue({ value }: { value: string | undefined }) {
  return value ? <span className="text-right text-xs text-ink-mute">{value}</span> : <Badge tone="blue">yeni</Badge>;
}

/**
 * Yöneticinin Yardım'ı. Başlık hemen çizilir; içerik (FAQ, FAQ_GROUPS, ROUTINE, FORMULAS, MENU_LAYOUT) yalnız iç
 * bileşende, yönetici denetiminden sonra: personel bu adrese gelse de (proxy zaten Bugün'e döndürür) yöneticinin
 * bölümleri sayfa verisine hiç girmez. Personelin kendi Yardım'ı /panel/yardim/personel (plan personel-yetki.md §2.10).
 */
export default function HelpPage() {
  return (
    <>
      <PageHeader
        title="Yardım"
        eyebrow="Sistem"
        excel="Nasıl Kullanılır"
        description="Sistemin nasıl çalıştığı, her ay ne yapmanız gerektiği ve Excel'deki sayfaların karşılıkları."
        actions={
          <ButtonLink href="/panel/yardim/personel" variant="secondary">
            <UsersRound size={16} aria-hidden="true" /> Personelin Yardım&apos;ı
          </ButtonLink>
        }
      />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <HelpContent />
      </Suspense>
    </>
  );
}

async function HelpContent() {
  await requireAdmin();
  // Profil menüsündeki Hesabım da bir ekran; kenar çubuğu ağacından sonra listelenir
  const account = NAV_FOOTER.find((i) => i.href === "/panel/hesap");
  return (
    <>
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
              {navTreeFor("admin").map((n) => (
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
