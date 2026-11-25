import {
  ArrowUpRight,
  Bell,
  Bot,
  CalendarCheck,
  CalendarClock,
  ChartNoAxesColumn,
  ClipboardList,
  Coffee,
  CupSoda,
  FileText,
  Globe,
  Grid3x3,
  HardDriveDownload,
  Info,
  Landmark,
  LayoutList,
  Lightbulb,
  ListChecks,
  ListTodo,
  Newspaper,
  Package,
  Palette,
  Pencil,
  Percent,
  Receipt,
  Ruler,
  Scale,
  ScanText,
  Search,
  ShieldCheck,
  ShoppingBag,
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
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { IconTile, toneFor } from "@/components/ui/icon-tile";
import { PageSkeleton } from "@/components/ui/misc";
import { OKC_PREFILL_ENABLED } from "@/lib/okc-z";
import { requireAdmin } from "@/server/auth/dal";

import { buildFaq, type FaqItem, type PathText } from "./faq-build";
import { HelpFaq, HelpFaqFallback, type FaqGroup } from "./faq-search";
import { pathOf, tabsOf } from "./nav-paths";
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
        Ayın son günü kapanıştan sonra <Path href="/panel/sayim" /> ekranında miktarları sayım biriminde (KG, LT, ADET, DİLİM) girin; personel telefondan da
        sayabilir. Ayın ilk 10 gününde ekran, bitmemişse geçen ayın sayımını açar; personel geçen ayı ayın 10&apos;una kadar düzeltir, sonrasında yalnız siz.
        Tutarlılık&apos;taki sayım sapması o ayın alım miktarını da ister: Paraşüt faturaları kendiliğinden yazar, hiç alınmadıysa &quot;Alım yok (0)&quot;a
        dokunun.
      </>
    ),
    href: "/panel/sayim",
    icon: ClipboardList,
  },
  {
    title: "Satış raporunu yükleyin (ModPOS'lu şube)",
    body: (
      <>
        ModPOS Patron › Raporlar › Satış ekranındaki ürün listesini <Path href="/panel/satislar" /> ekranındaki İçe aktar kartına yapıştırın ya da dosyasını
        seçin; eşleşmeyen satırları bir kez eşleştirin, sonraki aylar hatırlanır. LafPOS&apos;lu şubenin satışları her gün sonunda LafPOS&apos;tan gelir, ona
        liste yüklenmez.
      </>
    ),
    href: "/panel/satislar",
    icon: Receipt,
  },
  {
    title: "Ay bilgilerini girin",
    body: (
      <>
        <Path href="/panel/satislar" /> ekranında POS cirosunu (KDV dahil), açık gün sayısını, yönetici indirimlerini ve ödenmez/ikram tutarını yazın; süren ayda
        açık günü bugüne kadar olarak yazın, ay sonu tahmini bununla yapılır. Boş bıraktığınız alanlar kasa raporlarından dolar; elle yazdığınız her zaman
        geçerlidir.
      </>
    ),
    href: "/panel/satislar",
    icon: CalendarCheck,
  },
  {
    title: "Faturaları gözden geçirin",
    body: (
      <>
        Paraşüt&apos;teki faturalar her sabah <Path href="/panel/faturalar" /> ekranına kendiliğinden gelir. Kontrol bekleyen süzgecinde tahminle yazılan
        kategorileri onaylayın; yeni gelen ürünü <Path href="/panel/parasut" /> ekranında bir kez hammaddeye bağlayın, sonraki faturalar miktarı ve fiyatı
        kendisi günceller. Yalnız Paraşüt&apos;te olmayan faturayı (kâğıt, e-Arşiv) Fatura ekle ile girin. Personelin kasadan yaptığı faturalı alımlar
        Kasadan faturalı alımlar kartında bekler.
      </>
    ),
    href: "/panel/faturalar?durum=kontrol",
    icon: FileText,
  },
  {
    title: "Değişken giderleri yazın",
    body: (
      <>
        Su faturasını <Path href="/panel/gelir-gider" /> tablosundaki SU GİDERİ satırına KDV hariç yazın (reçetelere su + buz maliyeti olarak dağılır). Reklam,
        influencer, nakit alım ve bakım gibi her ay değişen giderleri <Path href="/panel/harcamalar" /> ekranına girin. Elektrik gibi değişen bir sabit giderin
        gerçek tutarını hücrenin üzerine yazabilirsiniz.
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

/** Sık sorulanlar, konuya göre gruplu; her grup kendi sohbet listesi (ui/faq-chat.tsx) */
const FAQ_GROUPS: { title: string; items: FaqItem[] }[] = [
  {
    title: "Menü ve reçete",
    items: [
      {
        id: "zam",
        q: "Menüye zam yaptım",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranında satış fiyatı hücresini değiştirip Enter&apos;a basın ya da ürün kartında değiştirin (kartta fiyat simülatörü
            var). Birçok ürüne birden: Fiyatlar › Toplu değiştir; önizleme her ürünün yeni fiyatını, maliyet oranını ve aylık kâra etkisini gösterir, Fiyatlar ›
            Geçmiş&apos;ten geri alınır. Siteye bağlı ürünün (adın yanındaki küre) fiyatı önce laffogato.net&apos;te değişir; sonra sitede Ayarlar ›
            Vergi&apos;den fiyat listesinin tarihini güncelleyin. Kasada elle değişmesi gerekenler Fiyatlar › Kasaya işle listesine girer.
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
        q: "Kasadaki fiyatlar (Kasaya işle)",
        a: (
          <>
            Panelde, toplu ya da laffogato.net&apos;te değişen satış fiyatı <Path href="/panel/urunler" /> › Fiyatlar › Kasaya işle listesine kasadaki adı, eski
            ve yeni fiyatıyla girer; zil de söyler. ModPOS&apos;lu şubede fiyatı ModPOS&apos;ta elle değiştirip işaretleyin (personel de Bugün&apos;den işaretler,
            bildirimdeki Geri al geri getirir); Metni kopyala listeyi WhatsApp&apos;a hazırlar. LafPOS&apos;lu şubede siteye bağlı ürünlerin fiyatını LafPOS
            siteden kendisi alır: listede yalnız siteye bağlı olmayanlar kalır, onları Ürünler › Site menüsü&apos;nde bağlayın ya da LafPOS&apos;ta elle
            değiştirip işaretleyin. LafPOS&apos;ta fiyatı kasiyer değiştiremez.
          </>
        ),
        icon: Receipt,
        links: [
          { href: "/panel/urunler/fiyatlar?sekme=kasa", label: "Kasaya işle" },
          { href: "/panel/urunler/site", label: "Site menüsü" },
        ],
      },
      {
        id: "site-menusu",
        q: "Site menüsüyle bağlantı (fiyat ve Tükendi)",
        a: (
          <>
            laffogato.net menüsündeki kalemine bağlı ürünün satış fiyatı ve menü durumu iki yerde aynı kalır, doğru kaynak sitedir: sitede fiyat değişince ya da
            kalem “Tükendi” olunca panel birkaç saniyede alır; panelde fiyatı, “Menüde aktif”i ya da QR menü anahtarını değiştirince önce siteye yazılır, site
            ulaşılamazsa kaydedilmez. Eşleştirme <Path href="/panel/urunler" /> › Site menüsü&apos;nde: öneriyi seçip bağlayın, hiçbiri kendiliğinden bağlanmaz.
            Ad, kategori, reçete ve maliyet eşitlenmez. Sitede yeni açılan kalem &quot;Yalnız sitede&quot; sekmesinde: Panelde aç ve bağla onu panelde açar.
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
            <Path href="/panel/urunler" /> › Yeni ürün; isterseniz benzer bir ürünün reçetesini kopyalayarak başlayın. Ürün laffogato.net menüsünde zaten varsa Site
            menüsü › Yalnız sitede › Panelde aç ve bağla daha kısadır: ad, boylar ve fiyat siteden gelir. Satışı, zayi kaydı ya da fiyat geçmişi olan ürün
            silinmez (geçmiş ayların maliyeti değişirdi): menüden kaldırmak için reçete kartında Menüde aktif anahtarını kapatın.
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
            Personel <Path href="/panel/receteler" /> ekranında Yeni ürün öner&apos;e dokunur: adı, kategoriyi, boyları ve her boyun reçetesini yazar; biliyorsa
            satış fiyatını da yazar, maliyet görmez. Listede olmayan malzemeyi formdan çıkmadan ekleyebilir. Öneri <Path href="/panel/onaylar" /> ekranına ve
            zile düşer: malzemelerin maliyetini satır satır görürsünüz, satış fiyatını ve adı değiştirebilirsiniz, kâr marjı hemen hesaplanır. &quot;Onayla ve
            ürünü ekle&quot; ürünü reçetesiyle açar; onaylanamayan durumu kart kendisi söyler. Reddederseniz notunuz personelin Önerilerim listesinde görünür.
            Yeni ürün laffogato.net menüsüne kendiliğinden bağlanmaz.
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
            (Pompa) ve püre pompası (PurePompa) ayrı yazılır; sizinkiler başlangıçtaki 10 ml ve 30 ml&apos;den farklıysa ölçüp yazın. Miktarı ml yazılı satır
            pompa değişince aynı kalır; pompayla birlikte değişsin isterseniz reçete kartında miktara 1,5*PurePompa gibi yazın.
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
            Paraşüt&apos;e gelen fatura ertesi sabah <Path href="/panel/faturalar" /> ekranına düşer; beklemek istemezseniz <Path href="/panel/parasut" /> › Şimdi
            eşitle. Fatura “ödenmedi” gelir; ödeyince Tedarikçiler ya da Faturalar&apos;da ödendi işaretleyin. “Mal alışı sayılmıyor” diyorsa kategorisini bir mal
            kategorisi yapın. Yeni bir ürünü Bağlanmayı bekleyenler listesinde hammaddeye bağlayın. Fiyatı %40&apos;tan fazla değişen ya da çarpanı kesin olmayan
            ilk fiyat uygulanmaz, <Path href="/panel/hammaddeler" /> › Onay bekleyen fiyatlar&apos;da bekler. Tedarikçiye iadenizi Faturalar&apos;a aynı
            tedarikçiye eksi tutarla girin.
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
            alınan miktar da yanlış çıkar. <Path href="/panel/hammaddeler" /> › Onay bekleyen fiyatlar öneriyi kalemin adındaki paket boyundan, faturanın
            kendisinden (kartta “Faturada: …”) ya da aynı ürünün eski faturalarından yapar; yanında o çarpanla çıkan birim fiyat yazar. Fiyat gerçekten
            değiştiyse çarpanı değiştirmeden onaylayın. Hiçbir şey kendiliğinden değişmez.
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
            <Path href="/panel/hammaddeler" /> › Yeni hammadde. Eklediğiniz malzeme reçete kartlarındaki listede çıkar; sayım birimini seçerseniz bu aydan itibaren sayım listesine de girer (geçen ayın sayımına da girecekse o ayın sayımında Listeye ekle).
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
            <Path href="/panel/sayim" /> ekranında Listeye ekle: ad, grup, sayım birimi, isteğe bağlı paket ve paket fiyatı. Personel de ekleyebilir; kalem bu aydan
            itibaren her ay sayılır. Paket fiyatı yazıldıysa Tahmini açılır (personel KDV dahil yazar, KDV düşülür), yazılmadıysa zil &quot;Fiyatı
            girilmemiş&quot; der: <Path href="/panel/hammaddeler" /> ekranındaki Fiyat yok süzgecinden girin. Yalnız bu ay rafta duran tek seferlik bir şey için
            sayımdaki Listede olmayanlar yeter.
          </>
        ),
        icon: ClipboardList,
        links: [
          { href: "/panel/sayim", label: "Stok sayımı" },
          { href: "/panel/hammaddeler?durum=fiyatsiz", label: "Fiyatı girilmemiş hammaddeler" },
        ],
      },
      {
        id: "stok-degerleme",
        q: "Stok ve maliyet hangi yöntemle hesaplanıyor?",
        a: (
          <>
            Ay sonu stoğu ve kâr-zararın mal maliyeti ilk giren ilk çıkar (FIFO) ile: rafta kalan mal en son alınandır, sayılan miktar en yeni Paraşüt faturasından geriye
            doğru dağıtılır ve her parça kendi faturasının birim fiyatıyla (KDV hariç) değerlenir. Faturası olmayan alım (elle girilen fatura, nakit alım, bağlanmamış
            ürün) havuzda görünmez: havuz yettiği sürece sayılan miktar eski faturalara dağılır, yalnız havuzun karşılamadığı kalan ay sonu fiyatıyla. Tedarikçiye iade
            yalnız elle girilmiş eksi fatura olarak geldiyse (kalemsiz) partiden düşülmez. Mal maliyeti = açılış + alınan − bu kapanış. Sayım girilmeyen ayda Gelir-gider tahmin eder: iki sayım arasındaki aylarda aralığın mal maliyeti ayların reçeteye göre tüketimi oranında dağıtılır; son sayımdan sonraki ayda reçeteye göre tüketim (fire bir kez) ve ödenmezlerin malzeme maliyeti düşülür. Ayın yöntemi mal maliyeti satırının altında yazar; vergi hesabı yalnız sayımı kullanır. <Path href="/panel/sayim" /> ekranında toplamın yanında FIFO rozeti,
            faturadan gelen payı ve satırın ⓘ işaretinde hangi faturalardan geldiği görünür. Yöntem <Path href="/panel/ayarlar" /> › Stok değerleme&apos;de: başlangıç ayı
            (Ekim 2026) ve önceki aylar ay sonu fiyatıyla kalır; başlangıcı geriye almak kapanmış ayların kârını değiştirir, önizleme farkı gösterir. Reçete ve menü maliyeti
            ise son alış fiyatıyla (yenileme maliyeti): fiyat kararı için. Resmi defterlerdeki yöntem muhasebecinizindir; vergi kanunu FIFO&apos;yu ve ağırlıklı ortalamayı
            kabul eder.
          </>
        ),
        icon: ClipboardList,
        links: [
          { href: "/panel/sayim", label: "Stok sayımı" },
          { href: "/panel/ayarlar#stok", label: "Stok değerleme" },
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
            <Path href="/panel/giderler" /> ekranında: Maaşlar sekmesinde net maaşı, Sabit giderler sekmesinde kirayı değiştirin. Kaydederken &quot;Hangi aydan
            itibaren?&quot; sorusunda ayı seçin; önceki aylar eski tutarla kalır. Yanlış girilmiş bir tutarı bütün aylarda düzeltmek için Gelişmiş › Tüm aylar.
            Biten bir gider ya da ayrılan personel için Durdur ile son ayı verin; geçmiş aylar etkilenmez.
          </>
        ),
        icon: Wallet,
        links: [
          { href: "/panel/personel", label: "Maaşlar" },
          { href: "/panel/giderler", label: "Sabit giderler" },
        ],
      },
      {
        id: "harcama",
        q: "Nakit alım, bakım, reklam ya da influencer ödemesi",
        a: (
          <>
            <Path href="/panel/harcamalar" /> ekranında ayı seçip Harcama ekle kartını doldurun: kategori, tutar (KDV ayrılmaz), tarih, açıklama ve ödeme şekli. Her
            kategori Gelir-gider&apos;de kendi satırında sayılır; ＋ Yeni kategori ile kategori açabilirsiniz. Faturası Paraşüt&apos;ten gelen gideri buraya ayrıca
            yazmayın, iki kez sayılır. Tutarı aydan aya değişen sabit gideri (ör. Instagram reklamı) aynı ekranda aylık girişe çevirin.
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
            ModPOS&apos;lu şubede <Path href="/panel/kasa" /> ekranında ModPOS Z&apos;nin ve banka POS Z raporunun (yazarkasa) fotoğrafı çekilir; ModPOS
            Z&apos;nin rakamları forma dolar.{" "}
            {OKC_PREFILL_ENABLED
              ? "Banka POS Z'sinde yalnız birbirini tutan ve net okunan rakamlar dolar."
              : "Banka POS Z'sinin rakamları şimdilik forma yazılmaz, her alanın altında öneri olarak çıkar."}{" "}
            Turuncu alanları fişle karşılaştırıp gönderin; hiçbir şey kendiliğinden kaydedilmez. LafPOS&apos;lu şubede rapor LafPOS&apos;un gün sonundan
            kendisi yazılır; personel yalnız Pavo&apos;nun gün sonu fişinin (detaylı Z) fotoğrafını Gün sonu fotoğrafı kartına ekler. Kasadan çıkan paranın fişini aynı ekranda Fiş ekle ile çekin;
            kaydedince Harcamalar&apos;a da yazılır. Okuma Claude ile yapılır (fotoğraf başına birkaç sent); aç / kapat ve bu ayın tutarı Ayarlar › Fotoğraftan
            okuma&apos;da.
          </>
        ),
        icon: Receipt,
        links: [
          { href: "/panel/kasa", label: "Kasa raporu" },
          { href: "/panel/ayarlar#foto", label: "Fotoğraftan okuma" },
        ],
      },
      {
        id: "yazarkasa-z",
        q: "ModPOS Z ve banka POS Z raporu (yazarkasa)",
        a: (
          <>
            İki ayrı sayaçtır: kasanın Z&apos;si (ModPOS ya da LafPOS gün sonu) satış programınındır, banka POS Z raporu yazarkasanın mali Z&apos;sidir
            (üstünde Z RAPORU ve KDV dökümü yazar; banka gün sonu fişi değil). ModPOS&apos;lu şubede banka POS Z&apos;si isteğe bağlıdır; raporda
            yazarkasa kasayla karşılaştırılır: kart, nakit, toplam, yemek kartı ve yazarkasanın kendi içindeki denetimleri. Toplam ve nakit farkı
            kendiliğinden hata değildir (online satış, faturalı satış, Z&apos;nin saati); personel yalnız kart satırını görür. LafPOS&apos;lu şubede
            Pavo&apos;nun gün sonu fişi istenir ve LafPOS&apos;la batch batch karşılaştırılır; fark yalnız size görünür (Gün sonu fotoğrafı kartı ve
            zil). Günden güne&apos;de Yazarkasa tutmuyor ve Yazarkasa Z yok rozetleri çıkar. Yanlış saklanan kümülatifi gün
            ayrıntısındaki Kümülatifi temizle siler.
          </>
        ),
        icon: ScanText,
        links: [{ href: "/panel/kasa", label: "Kasa raporu" }],
      },
      {
        id: "yazarkasa-oneri",
        q: "Banka POS Z'sinin fotoğraftan doldurulması",
        a: (
          <>
            {OKC_PREFILL_ENABLED ? (
              <>
                Banka POS Z&apos;sinin okuması kafenin gerçek fişleriyle denendi: birbirini tutan ve net okunan rakamlar forma dolar, tutmayan rakam altında
                nedeniyle öneri olur.
              </>
            ) : (
              <>
                Banka POS Z&apos;sinin rakamları şimdilik forma yazılmaz: okuma kafenin gerçek fişleriyle denenene kadar her alanın altında öneri olarak çıkar,
                personel fişle karşılaştırıp yazar. Denemek için geliştiriciye 5–8 günün banka POS Z fotoğrafını (asıl çözünürlükte: WhatsApp&apos;tan belge
                olarak ya da e-postayla; 2–3&apos;ü ardışık günler) ve aynı günlerin kâğıttaki doğru rakamlarını verin. Yanlış dolan rakam çıkmazsa doldurma
                açılır.
              </>
            )}
          </>
        ),
        icon: Lightbulb,
        links: [{ href: "/panel/kasa", label: "Kasa raporu" }],
      },
      {
        id: "kontrol",
        q: "Açılış ve kapanış listeleri",
        a: (
          <>
            Personel sabah açılışta ve gece kapanışta listeyi telefondan <Path href="/panel/kontrol" /> ekranında doldurur: maddeyi işaretler, buzdolabı
            sıcaklığını yazar, istenen yerde fotoğraf çeker. Geçmiş bir gün sonradan doldurulamaz (gün 05:00&apos;te döner). Aralık dışı sıcaklık not ister ve
            size bildirilir; yapılmayan liste ertesi sabah e-postada çıkar. Maddeleri ve saatleri Kontrol listeleri › Listeler&apos;den düzenlersiniz. Fotoğraflar
            60 gün saklanır.
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
        id: "vardiya",
        q: "Vardiya planını yazmak ve PDF'ini almak",
        a: (
          <>
            <Path href="/panel/vardiya" /> ekranında haftayı kişi kişi yazın: günün kutusuna saatleri (“10-18”, gece yarısını geçen vardiyada “18-02”), isterseniz
            görevi (“10-18 kasa”), izin için “izin”. Okunamayan kutu kırmızı olur. Kaydet bütün haftayı yazar; PDF kaydedilen plandan çizilir. Geçen haftayı
            kopyala boş kutuları doldurur, hesabı olmayan çalışanı Kişi ekle ile yazarsınız. Personel planı görür, değiştiremez. Plan şube şubedir.
          </>
        ),
        icon: CalendarClock,
        links: [{ href: "/panel/vardiya", label: "Vardiya ayarlama" }],
      },
      {
        id: "tedarikci",
        q: "Tedarikçinin bilgileri ve ödemesi",
        a: (
          <>
            <Path href="/panel/tedarikciler" /> faturalardan kendiliğinden listelenir: kalan borç, vadesi geçen ve en yakın vade. Düzenle&apos;den unvanı, vergi
            no&apos;yu, IBAN&apos;ı, iletişimi ve vade gününü yazın; Faturadan doldur bunları en yeni Paraşüt faturasından okur. Aynı vergi numarasıyla gelen
            faturalar tek tedarikçide toplanır. Ödediğiniz faturanın durum hapından Ödendi&apos;yi seçin (birden çoğunu toplu); Ödeme talebi tutarı, IBAN&apos;ı
            ve açıklamayı hazır metin yapar. Peşin ya da kartla ödediğiniz tedarikçide Faturaları ödendi gelsin&apos;i açın. IBAN değişikliğini tedarikçiyi
            arayarak teyit edin.
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
            bölünür: gerçek oran. Yemek kartında %6&apos;yı aşan oran ve komisyon dışı ücretler işaretlenir; uyarılar kalem adlarına bakar, kesin hüküm değildir.
            Satış Z toplamından gelir; aynı ay birden çok yemek kartı varsa kanalın ekstresindeki satışı Satışı yaz ile girin. LafPOS&apos;lu şubede satış
            LafPOS&apos;un ödeme türlerinden kart kart gelir. Hakediş bankaya gelince Hakediş geldi&apos;ye dokunun; son gün geçerse zil çalar.
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
        q: "Yanlışlıkla “Ödedim”e bastım",
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
            <Path href="/panel/hatirlaticilar" /> ekranının başındaki Nakit planı önümüzdeki 6 haftayı hafta hafta gösterir: gelecek para (son 4 haftanın günlük
            satışı, laffogato.net online) ve ödenecekler (vadesi gelen faturalar, hatırlatıcılar, maaş, SGK, KDV, sabit giderler). Önce Bakiyeyi gir ile bankadaki
            ve kasadaki parayı yazın; plan en sıkışık günü ve para yetmeyecekse hangi gün yetmeyeceğini söyler. Tutarı belli olanlar kesin, ötekiler “tahmini”
            yazar: kesinleştirmek için Ödemeler&apos;e tutarıyla hatırlatıcı ekleyin. Faturası ayrıca gelen sabit gideri Tahmine katılanlar&apos;dan kapatın.
            Varsayımların hepsi ekrandaki Nasıl hesaplandı kartında.
          </>
        ),
        icon: ChartNoAxesColumn,
        links: [{ href: "/panel/hatirlaticilar/nakit", label: "Nakit planı" }],
      },
      {
        id: "kdv-tahmini",
        q: "Bu ay ne kadar KDV ödeyeceğim?",
        a: (
          <>
            Kısa cevap <Path href="/panel/vergi" /> ekranında, takvimin KDV satırında: tahmini tutar ve son gün. Döküm Nakit planındaki KDV tahmini kartında:
            önceki ayın satışlarındaki KDV&apos;den (kafe %10, karaoke %20, laffogato.net) alış faturalarındaki KDV düşülür; sonuç ayın 28&apos;inde plana girer.
            Eksi çıkarsa ödeme beklenmez, fark sonraki aya devreder. Bu bir tahmindir; kesin tutar muhasebecinizin beyannamesindedir. Muhasebeciniz tutarı
            söyleyince Ödemeler&apos;deki KDV hatırlatıcısına yazın, plan onu kullanır.
          </>
        ),
        icon: Percent,
        links: [
          { href: "/panel/vergi#kdv", label: "KDV" },
          { href: "/panel/hatirlaticilar/nakit#kdv", label: "KDV tahmini" },
        ],
      },
      {
        // Vergi bölümü (dalga 12, docs/VERGI.md): tahmin, beyanname değil
        id: "vergi",
        q: "Vergi sayfasındaki rakamlar beyanname mi?",
        a: (
          <>
            Hayır, tahmindir.{" "}
            <Path href="/panel/vergi" /> sayfası satışlardan, faturalardan ve bordrodan muhtasarı, SGK&apos;yı, damga vergisini ve kafenin geçici ve kurumlar
            vergisine katkısını Türkiye&apos;nin 2026 kurallarıyla tahmin eder; her rakamın yanında nasıl hesaplandığı ve dayanağı yazar. Geçici ve kurumlar
            vergisi şirketin tamamının beyannamesidir: tutarı muhasebecinizden isteyin ve Vergi&apos;ye girin. Muhasebeci sekmesindeki &apos;Muhasebeciye
            sorulacaklar&apos; listesini muhasebecinizle bir kez gözden geçirin. Günü geçmiş bir vergi ya da SGK ödemesi Özet&apos;in başında turuncu satır olur;
            Ödemeler&apos;de &quot;Ödedim&quot; ile kapanır.
          </>
        ),
        icon: Landmark,
        links: [
          { href: "/panel/vergi", label: "Vergi, KDV, SGK" },
          { href: "/panel/vergi/kurallar#sorular", label: "Muhasebeciye sorulacaklar" },
        ],
      },
      {
        id: "zam-etkisi",
        q: "Zamlar bana ayda kaça mal oluyor?",
        a: (
          <>
            <Path href="/panel/urunler" /> ekranındaki Hammadde zamları kartı, son 30 günde fiyatı artan malzemelerin ayda kaç lira kâr götürdüğünü yazar: her ürünün
            maliyet artışı (fire payı dahil; Zayi &amp; ikram kayıtları sayılmaz) son satış ayındaki adediyle çarpılır; adetler Ayarlar&apos;daki ayda açık gün
            sayısına çevrilir. Toplamı Genel bakış&apos;taki uyarıda, zilde ve sabah e-postasında da yazar. Ürün satış raporu yüklenmemişse yalnız birim maliyet
            farkı görünür. Ucuzlayan malzemenin aylık kazancı yeşil yazar.
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
            <Path href="/panel/kullanicilar" /> › Kullanıcı ekle: giriş e-postası, rol Personel; parolayı siz belirleyin ya da 72 saat geçerli davet bağlantısı
            gönderin. Personel Bugün, Siparişler, Karaoke, Kasa raporu, Kontrol listeleri, Vardiya, Zayi &amp; ikram, Reçete defteri (öneri ve satış fiyatı),
            Stok sayımı (Listeye ekle), Özel günler, Hatırlatıcılarım, kendi Yardım&apos;ı ve Hesabım ekranlarını görür; maliyet, maaş, kâr ve karaoke tutarlarını
            görmez. Geçmiş kasa, silme ve geç kayıt gibi işler isteğe döner, kararı <Path href="/panel/onaylar" /> ekranında verirsiniz. Her kullanıcı
            Hesabım&apos;dan iki adımlı doğrulamayı açabilir; yönetici eklerken ya da bir yöneticinin rolünü, parolasını, e-postasını değiştirirken kendi parolanız
            sorulur.
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
        id: "sube-secimi",
        q: "Şube seçimi: Tuzla, Marina, Tümü",
        a: (
          <>
            Şube seçiliyken ekranlar, zil, Bugün ve Claude yalnız o şubenin verisini gösterir; Vergi, Nakit planı, Ödemeler ve cari firma geneli kalır,
            ekran bunu söyler. Tümü seçiliyken şubeye ait bir kayıt (kasa raporu, sayım, zayi, ay bilgisi, satış listesi) yazacaksanız ekran önce şubeyi
            sorar; sessizce Tuzla&apos;ya yazılmaz. Şubeye kilitli personel yalnız kendi şubesini görür ve yazar.
          </>
        ),
        icon: Globe,
        links: [{ href: "/panel/subeler", label: "Şubeler" }],
      },
      {
        id: "sube-ayarlari",
        q: "Şube ayarları ve “Tuzla ile aynı”",
        a: (
          <>
            <Path href="/panel/subeler" /> ekranında şubeye dokunun: kasa raporu alıcıları, çalışanların gün sonu e-postası ve Paraşüt hesabı şube başınadır.
            “Tuzla ile aynı” açıkken şube Tuzla&apos;nın ayarını kullanır, değer tek yerden düzenlenir; kapatınca o anki değerler kopyalanır (şifreler
            kopyalanmaz, yeniden girilir). Ayrı Paraşüt hesabına bağlanan şubenin faturaları o şubenindir; aynı hesaptaysa faturalar işletme geneli.
            Aynı ekranda şubede kullanılan özellikler açılıp kapanır: karaoke, uygulama siparişleri, garson çağır, yemek kartı.
          </>
        ),
        icon: Landmark,
        links: [{ href: "/panel/subeler", label: "Şubeler" }],
      },
      {
        id: "iki-kar",
        q: "İki kâr hesabı: neden iki farklı kâr görüyorum?",
        a: (
          <>
            <Path href="/panel" /> reçeteye göre (teorik) kârı, <Path href="/panel/gelir-gider" /> tablosu ise faturaya göre (gerçekleşen) kârı gösterir. Aradaki fark fire, ikram,
            stok birikmesi ya da reçetede eksik malzemedir. Stok sayımı girdikçe iki rakam birbirine yaklaşır. İkisi de laffogato.net online satışını (uygulama
            siparişleri, mağaza, karaoke) içerir: Genel bakış&apos;ta online satış reçetesiyle, menüye bağlı olmayan satırlar ve reçetesi boş ürünler ortalama maliyet oranıyla sayılır.
          </>
        ),
        icon: Scale,
      },
      {
        id: "sabit-gider-farki",
        q: "Net kârdaki sabit gider neden standart aylık tutardan farklı olabilir?",
        a: (
          <>
            Standart aylık sabit gider, Sabit giderler ve Maaşlar&apos;daki kalemlerin bir aylık tutarıdır. <Path href="/panel" /> net kârda o ayın{" "}
            <Path href="/panel/gelir-gider" /> tutarlarını kullanır: kalemler gün oranıyla bölünür (açık günü kasa raporlarından gelen ayda takvim günüyle: kapalı bir
            gün kirayı ve maaşı düşürmez), elle düzeltilen hücreler ve yalnızca o aya yazılan giderler (doğalgaz, ciro kirası, harici…) eklenir. &quot;Para nereye
            gitti?&quot; kartındaki &quot;Bu ay düşülen sabit gider&quot; kutusu farkı satır satır gösterir; net kârın ipucu da aynı ayrımı yazar. SU GİDERİ
            reçetelerde su + buz maliyeti olarak sayıldığı için sabit giderde ikinci kez düşülmez. Net kâr laffogato.net online satışının brüt kârını da içerir.
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
            Yalnızca devam eden ay için; formülü bu sayfanın Formüller kartında. Bitmiş bir ayda tahmin yapılmaz, yerine Gelir-gider&apos;deki gerçek sonuç
            (faturaya göre kâr/zarar) görünür.
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
            Ay sürerken ModPOS&apos;un satış raporunu <Path href="/panel/satislar" /> ekranına yüklerken Liste hangi güne kadar? alanına raporun son gününü yazın
            (varsayılan dün); Genel bakış günlük ortalamayı, indirimi ve sabit gideri listenin günleriyle hesaplar. Ay bitince ayın tamamının listesini Yenisiyle
            değiştir ile yükleyin. LafPOS&apos;lu şubenin satışları her gün sonunda LafPOS&apos;tan gelir; geçiş ayında ModPOS listesi yalnız geçiş gününden
            önceki günleri sayar (fazlası iki kez sayılırdı).
          </>
        ),
        icon: CalendarCheck,
        links: [
          { href: "/panel/satislar", label: "Satışlar" },
          { href: "/panel/ayarlar#lafpos", label: "Ayarlar › LafPOS" },
        ],
      },
      {
        id: "gunluk-isler",
        q: "Sabah e-postası ya da Paraşüt faturaları gelmedi",
        a: (
          <>
            Her sabah iki iş kendiliğinden çalışır: 07:00–08:00 Paraşüt eşitlemesi, 08:00–09:00 sabah işi (sabah e-postası, hatırlatıcılar, laffogato.net
            eşitlemeleri). Biri çalışmazsa zilde <strong className="font-semibold text-ink">Sistem</strong> başlığında ve <Path href="/panel" />&apos;ta kırmızı
            şeritle görünür; son çalışmalar Ayarlar › Günlük işler&apos;de. Beklemek istemezseniz <Path href="/panel/parasut" /> › Şimdi eşitle ya da{" "}
            <Path href="/panel/hatirlaticilar" /> › Bugünküleri şimdi gönder. Personel hesabının ve pasif hesabın adresine e-posta gitmez.
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
            Her pazartesi sabah yöneticilere kısa bir e-posta gider: geçen haftanın ve bekleyen işlerin kasanıza etkisine göre sıralı en çok 5 maddesi (zam, nakit
            planı, kasa farkı, komisyon, kasa fiyatları, zayi, stok farkı …), geçen haftanın cirosu ve önümüzdeki 7 günün beklenen satışı. Her madde ilgili
            ekranı açar. Açıp kapatmak ve önizlemek için <Path href="/panel/hatirlaticilar" /> › E-posta bildirimleri › Haftalık özet.
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
            <Path href="/panel/siparisler" /> ekranı uygulama siparişlerini ve masa çağrılarını, <Path href="/panel/karaoke" /> ekranı rezervasyonları
            laffogato.net&apos;ten alır. Site ulaşılamazsa sarı satırda son başarılı kontrolün saati yazar; ekran açık kaldıkça panel kendisi yeniden dener, o
            arada yenileri sitenin panelinde kontrol edin (Siparişler › laffogato.net&apos;te aç). Barın tabletinde Bu cihazda uyarılar kartından bildirimlere izin
            verin: yeni rezervasyon ve sipariş anında gelir.
          </>
        ),
        icon: Wifi,
        links: [
          { href: "/panel/siparisler", label: "Siparişler" },
          { href: "/panel/karaoke", label: "Karaoke (bar ekranı)" },
        ],
      },
      {
        id: "masa-cagrisi",
        q: "Uygulama siparişleri ve masa çağrıları nerede?",
        a: (
          <>
            <Path href="/panel/siparisler" /> ekranında: laffogato.net&apos;te (uygulama ve web) ödenmiş açık kafe siparişleri ve masadaki QR menüden gelen
            &quot;Garson çağır&quot; (garson, su, peçete). Personel siparişin aşamasını tek dokunuşla ilerletir, çağrıda Gördüm&apos;e basar. Yeni siparişte ve
            çağrıda zil çalar (çağrı ayrı sesle). İade, iptal ve geçmiş sitenin panelinde (başlıktaki laffogato.net&apos;te aç).
          </>
        ),
        icon: ShoppingBag,
        links: [{ href: "/panel/siparisler", label: "Siparişler" }],
      },
      {
        id: "yedek",
        q: "Yedek nasıl alınır, nasıl geri yüklenir?",
        a: (
          <>
            <Path href="/panel/ayarlar" /> › Yedek › Yedeği indir: parolanızı girince paneldeki bütün veri tek dosyada iner. Ayda bir indirip bilgisayarınızda ya
            da Google Drive&apos;da saklayın; son yedek 30 günü geçince zil hatırlatır. Dosyada ciro, maaş ve IBAN&apos;lar var (parolalar yok), kimseyle
            paylaşmayın. Geri yükleme panelden yapılmaz: gerekirse dosyayı geliştiriciye verin. Aynı karttaki Dışa aktar (.xlsx) çalışma kitabı okumak içindir, geri yüklenmez.
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
            <Path href="/panel/karaoke" /> › Bu ay › Doluluk haritası odanın hangi gün ve saatte dolu olduğunu gösterir (son 4 hafta, son 12 hafta ya da bir ay);
            hücreye dokununca o saatin ayrıntısı çıkar. Doluluk ekranın altındaki Oda saatlerine göre hesaplanır. İlk kullanımda Geçmişi siteden al ile eski
            rezervasyonları alın (ad ve not alınmaz). Yalnız yönetici görür.
          </>
        ),
        icon: Grid3x3,
        links: [{ href: "/panel/karaoke/doluluk", label: "Karaoke doluluğu" }],
      },
      {
        id: "karaoke-sayac-silme",
        q: "Karaoke sayacını kim bitirdi, kim sildi?",
        a: (
          <>
            Karaoke ekranındaki Haber verdim, Erken bitir, Geri aç ve sayaç silme <Path href="/panel/ayarlar" /> › İşlem geçmişi&apos;ne kimin yaptığıyla
            yazılır. Personel panelden açılan sayacı ilk 10 dakikada silebilir; sonrası <Path href="/panel/onaylar" /> › Karaoke&apos;ye istek olarak gelir.
            Onaylarsanız sayaç karaoke geçmişinden ve doluluktan çıkar; oda kullanıldıysa reddedin.
          </>
        ),
        icon: Timer,
        links: [
          { href: "/panel/onaylar", label: "Onaylar" },
          { href: "/panel/karaoke", label: "Karaoke (bar ekranı)" },
        ],
      },
      {
        id: "karaoke-eposta",
        q: "Karaoke rezervasyonunda kime, ne zaman e-posta gider?",
        a: (
          <>
            <Path href="/panel/karaoke" /> › Elle ekle&apos;de e-posta yazarsanız misafire onay e-postası, rezervasyona bir günden fazla varsa bir gün kala
            hatırlatma gider; satırdaki zarf rozeti durumunu söyler. Misafirin adresi yalnız bu e-posta gidene kadar şifreli tutulur, sonra silinir. Personele
            rezervasyon günü sabah o günün listesi ve her rezervasyondan 3 saat önce o rezervasyon gider; sitede ödenmemiş rezervasyon kırmızıyla öne çıkar, tutar
            yazmaz. Alıcılar o gün <Path href="/panel/vardiya" /> planında çalışanlardır, plan yoksa Tuzla&apos;nın bütün personeli; E-posta bildirimleri
            kapalıysa personele gitmez.
          </>
        ),
        icon: Bell,
        links: [
          { href: "/panel/karaoke", label: "Karaoke (bar ekranı)" },
          { href: "/panel/vardiya", label: "Vardiya" },
        ],
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
            <Path href="/panel/bugun" /> günün işlerini tek listede toplar: kasa raporları, açılış ve kapanış listeleri, ödemeler, kontrol bekleyen faturalar,
            onaylar, kasada değişecek fiyatlar, ay sonu sayımı ve hatırlatıcılarınız. Her satır ilgili ekranı açar; sıradaki iş öne çıkar, bitenler
            Tamamlananlar&apos;da. Personel girişte bu ekranda açılır ve yalnız kendi işlerini görür.
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
            Sol üstte L&apos;Affogato adının yanındaki zil (telefonda üst çubukta) bildirimleri başlıklar altında toplar: Onaylar, Kontrol listeleri, Ödemeler,
            Faturalar ve Uyarılar. Günlük işlerden biri çalışmadıysa ya da son yedek 30 günden eskiyse en üstte{" "}
            <strong className="font-semibold text-ink">Sistem</strong> başlığı çıkar. Bir bildirime dokununca ilgili ekran açılır.
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
  ["POS komisyonu (ürün başına)", "Satış fiyatı × komisyon × kartlı satış oranı"],
  ["Birim kâr", "Net satış − ürün maliyeti − POS komisyonu (ürün başına)"],
  ["Maliyet oranı", "Ürün maliyeti ÷ net satış (hedef: Ayarlar › Oranlar, ör. %30)"],
  ["Önerilen fiyat", "Maliyet ÷ hedef oran × (1 + KDV), 5\u00a0₺'ye yukarı yuvarlanır"],
  ["Durum", "İyi ≤ hedef · Dikkat ≤ hedef + 10 puan · Düşük kâr > hedef + 10 puan"],
  ["Eşleşmeyen POS ürünü", "Net ciro × reçeteli eşleşen ürünlerin ortalama maliyet oranı"],
  [
    "Reçetesi boş ürün",
    "Satışı eşleşmeyen satır gibi: net ciro × ortalama maliyet oranı (orana girmez). Kâr sıralamalarına, Analiz'deki gruplara ve Ürünler'in brüt kâr kartına girmez",
  ],
  [
    "Banka POS komisyonu (ay)",
    "Σ şube (kasa raporlarındaki banka kartı, yemek kartı hariç × şubenin POS oranı, Şubeler). Satışlar satırlara ciro payıyla dağıtır. Kasa kartı olmayan ayda: ciro × komisyon × kart payı",
  ],
  ["Brüt kâr", "Net satış − malzeme/ambalaj (reçeteye göre) − banka POS komisyonu (ay); Genel bakış'ta laffogato.net online satışı da dahil"],
  [
    "Net kâr / zarar (reçeteye göre)",
    "Brüt kâr (laffogato.net online dahil) − indirimler ÷ (1 + KDV) − o ayın sabit giderleri (Gelir-gider: gün oranı + bu aya özel giderler). Satış listesi ayın bir kısmını kapsıyorsa indirim o günlerin kasa raporlarından, sabit gider ve online satış o günlere düşen payla",
  ],
  [
    "Kâr / zarar (faturaya göre)",
    "Ciro ÷ (1 + KDV) − satılan malın maliyeti − giderler (Gelir-gider tablosu). Satışlar'daki HİZMET satırları (karaoke) kadarı hizmet KDV'siyle (%20) ayrılır. Şube seçiliyken adı “Gelir-gider'e göre”: mal maliyeti şubenin satışından reçeteye göre",
  ],
  ["Faturaya göre maliyet oranı", "Faturayla alınan mal (KDV hariç) ÷ net satış (laffogato.net online dahil). Yalnız Tümü'de: faturalar işletme genelinde, şubeye bölünmez"],
  ["Günlük ortalama ciro", "Satış listesi toplamı (yoksa POS cirosu) ÷ açık gün; liste ayın bir kısmını kapsıyorsa listenin kendi açık günü"],
  [
    "Başabaş günlük ciro",
    "(Standart aylık sabit gider + Aylık harcamalar'da her ay girilenler − kapanmış son ayın laffogato.net online brüt kârı) ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün. Genel bakış, Sabit giderler ve Analiz aynı rakamı gösterir",
  ],
  [
    "Ay sonu tahmini (yalnızca devam eden ay)",
    "POS cirosu ÷ açık gün × ayın açık günü (ayın gün sayısı − kafe kapalı işaretli günler) × son satış ayının brüt kâr oranı + laffogato.net online brüt kârı (aynı tempoyla) − standart aylık sabit gider − her ay girilen harcamalar",
  ],
  [
    "Her ay girilen harcama (başabaş, tahmin, nakit planı)",
    "Biten ayda o ay girilen; süren ve gelecek ayda o ay girilen, daha azsa geçen ayın gerçekleşeni",
  ],
  [
    "Aylık sabit gider (gelir-gider)",
    "Aylık tutar × gün ÷ ayın gün sayısı. Gün: açık gün elle yazıldıysa o; kasa raporlarından geliyorsa raporların kapsadığı takvim günü (kapalı bir gün kirayı ve maaşı düşürmez). Günlük giderler × açık gün",
  ],
  [
    "Su + buz litre maliyeti",
    "SU GİDERİ ÷ satış listesine ve aynı ayın laffogato.net siparişlerine göre su + buz litresi (fatura girilmiş ve satış listesi olan son ay)",
  ],
  ["Satılan malın maliyeti", "Önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım; sayım yoksa sayım aralığına dağıtılmış ya da reçeteye göre tahmini devir)"],
];

// ---------------------------------------------------------------- Sayfa

/** Yöneticinin cevaplarındaki <Path>'in arama metni: kenar çubuğundaki adlarla */
const adminPathText: PathText = (el) => (el.type === Path && el.props.href ? pathOf(el.props.href).join(" ") : undefined);

const FAQ: FaqGroup[] = buildFaq(FAQ_GROUPS, adminPathText);

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
        path="/panel/yardim"
        description="Ne zaman ne yapılır, sık sorular, formüller ve menüdeki ekranlar."
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
                Bu adımlar her ay sonunda yapılınca raporlar doğru olur; hangilerinin yapıldığını{" "}
                <Link href="/panel" className="font-medium text-ink hover:underline">
                  Genel bakış
                </Link>
                &apos;taki &quot;Bu ayın işleri&quot; kartı gösterir.
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
            <CardHeader icon={<Info />} title="Nasıl yapılır?" description="Sık yapılan değişiklikler ve bilinmesi gerekenler" />
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
                    hesaplananın üzerine yazılmış demektir; noktalı çizgili tutar ve ok simgesi tutarın geldiği sayfayı (o ayın faturaları, komisyon
                    faturaları dahil; harcamaları, stok sayımı, satışları: ciro ve kartlı satış oranı; personel, sabit giderler) açar. Telefonda satıra
                    ya da düzenleme penceresindeki bağlantıya dokunun.
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
                    <span className="sr-only">Bilgi</span> simgesinin üzerine gelince ya da dokununca rakamın nasıl hesaplandığını anlatan açıklama çıkar.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={<Sigma />}
                title="Formüller"
                description="Paneldeki hesapların kuralı; ayrıntılar (ör. net kârda o ayın sabit giderleri) Nasıl yapılır? listesinde."
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
          <CardHeader icon={<Table2 />} title="Ekranlar" description="Menüdeki her ekran ve sekmeleri; adına dokununca açılır." />
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
                              </div>
                              {tabs ? (
                                <ul className="ml-1 border-l border-line pl-3" aria-label={`${c.label} sekmeleri`}>
                                  {tabs.map((t) => (
                                    <li key={t.href} className="flex items-center justify-between gap-3">
                                      <Link href={t.href} className="inline-flex min-h-9 items-center pointer-coarse:min-h-11 text-[13px] text-ink-mute hover:text-ink hover:underline">
                                        {t.label}
                                      </Link>
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
