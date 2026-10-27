import {
  AlarmClock,
  Banknote,
  BookOpen,
  CalendarHeart,
  CalendarX2,
  Camera,
  ClipboardCheck,
  ClipboardList,
  Coffee,
  Gift,
  History,
  Inbox,
  ListChecks,
  ListTodo,
  MicVocal,
  Moon,
  PackageX,
  Pencil,
  Receipt,
  ScrollText,
  Sun,
  Tags,
  Trash2,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { CASH_EVENING_HOUR, DAY_TURN_HOUR, LATE_REPORT_DAYS } from "@/lib/cash-report";
import { OKC_PREFILL_ENABLED } from "@/lib/okc-z";
import { MAX_OKC_PHOTOS } from "@/lib/photo-rules";
import { REQUEST_DAYS } from "@/lib/cash-out-requests";
import { CASH_OUT_UNDO_TOAST_MS } from "@/lib/cash-outs";
import { ANSWER_GRACE_MIN, STAFF_HISTORY_DAYS } from "@/lib/checklists";
import { STAFF_SPECIAL_LIMITS } from "@/lib/closed-days";
import { POS_UNDO_WINDOW_MS } from "@/lib/prices/pos";
import { clockSuffixTR } from "@/lib/reminders";
import { STAFF_SOLD_OUT_MAX } from "@/lib/site-menu/sold-out";
import { STAFF_APPROVAL_KINDS } from "@/lib/staff-requests";
import { LATE_WINDOW_DAYS } from "@/lib/waste-requests";

import type { FaqItem, PathText } from "../faq-build";
import { staffPathOf } from "../nav-paths";

/**
 * Personelin Yardım'ının içeriği (plan docs/planlar/personel-yetki.md §2.10): yalnız personelin ekranları, yalnız
 * personelin menüsündeki adlarla (staffPathOf). Yöneticinin Yardım'ından (../page.tsx) hiçbir şey almaz; ortak olan
 * yalnız soru listesinin kurucusu (../faq-build.tsx). Sayılar koddan gelir. Metinde maliyet, ücret ya da para sözcüğü
 * yoktur; "fiyat" yalnız satış fiyatı ve paket fiyatı olarak geçer (tests/yardim-personel.test.ts tutar). Yeni bir
 * personel ekranı ya da onaya giden yeni bir tür eklenince buraya da yazılır: test her STAFF_PATHS öğesini ve her
 * STAFF_APPROVAL_KINDS satırını arar.
 */

/** "05:00" */
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** "05:30": başlamış listenin yeni günde bitirilebildiği son an */
const graceEnd = `${String(DAY_TURN_HOUR).padStart(2, "0")}:${String(ANSWER_GRACE_MIN).padStart(2, "0")}`;
const minutes = (ms: number) => `${Math.round(ms / 60_000)} dakika`;
const seconds = (ms: number) => `${Math.round(ms / 1000)} saniye`;

/** Personelin menüsündeki yol, ör. "Stok › Stok sayımı" */
export function StaffPath({ href }: { href: string }) {
  return <span className="font-medium text-ink">{staffPathOf(href).join(" › ")}</span>;
}

/** Arama metninde <StaffPath> menüdeki adlarla okunur */
export const staffPathText: PathText = (el) => (el.type === StaffPath && el.props.href ? staffPathOf(el.props.href).join(" ") : undefined);

/** Gövdedeki düğme ve ekran adları */
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

// ---------------------------------------------------------------- Ne zaman ne yapılır?

export const STAFF_ROUTINE: { title: string; body: ReactNode; href: string; icon: LucideIcon }[] = [
  {
    title: "Açılışta",
    body: (
      <>
        <StaffPath href="/panel/bugun" /> günün işlerini sırayla gösterir; sıradaki iş öne çıkar. Önce dünden kalan varsa (dünün kasa raporu, dünün listeleri) onu
        bitirin, sonra açılış listesini <StaffPath href="/panel/kontrol" /> ekranında doldurun.
      </>
    ),
    href: "/panel/kontrol",
    icon: Sun,
  },
  {
    title: "Bar ekranı açık kalsın",
    body: (
      <>
        <StaffPath href="/panel/karaoke" /> barın ekranıdır: uygulama siparişleri, karaoke odası ve biten ürünler. Yeni siparişte ve rezervasyonda çalar; biten ürünü
        hemen Tükendi yapın.
      </>
    ),
    href: "/panel/karaoke",
    icon: MicVocal,
  },
  {
    title: "Gün içinde",
    body: (
      <>
        Atılan ya da ikram edilen her şeyi <StaffPath href="/panel/zayi" /> ekranına, kasadan çıkan her parayı fişiyle <StaffPath href="/panel/kasa" /> ekranına
        girin. Akşama bırakmayın; akşam hatırlamak zordur. Kasada LafPOS kullanılmaya başlandıysa ürün ikramı LafPOS&apos;ta işaretlenir; panele yalnız zayi
        ve hammadde ikramı girilir.
      </>
    ),
    href: "/panel/zayi",
    icon: Gift,
  },
  {
    title: "Akşam kasa raporu",
    body: (
      <>
        Kapanışta ModPOS&apos;tan ve banka POS&apos;tan (yazarkasa) Z raporunu alın, kasadaki nakdi sayın ve <StaffPath href="/panel/kasa" /> ekranına girin.{" "}
        {clockSuffixTR(hour(CASH_EVENING_HOUR), "abl")} sonra
        Bugün ekranı hatırlatır.
      </>
    ),
    href: "/panel/kasa",
    icon: Banknote,
  },
  {
    title: "Kapanış listesi",
    body: (
      <>
        Kapatırken kapanış listesini doldurun. Gün gece {clockSuffixTR(hour(DAY_TURN_HOUR))} döner: gece yarısından sonra doldurulan liste ve girilen rapor bir önceki güne yazılır.
      </>
    ),
    href: "/panel/kontrol",
    icon: Moon,
  },
  {
    title: "Ayın son günü",
    body: (
      <>
        Kapanıştan sonra <StaffPath href="/panel/sayim" /> ekranında listedeki her kalemi sayın; sayılmayan kalemin stoğu 0 sayılır. Bugün ekranı o gün
        hatırlatır.
      </>
    ),
    href: "/panel/sayim",
    icon: ClipboardList,
  },
];

// ---------------------------------------------------------------- Nasıl yapılır?

/** "Yöneticinin onayına gidenler": onaya giden her tür bir satır (ortak kuyruğun listesi, src/lib/staff-requests.ts) */
const APPROVAL_LIST = (
  <span className="mt-1 block">
    <ul className="list-disc space-y-0.5 pl-5">
      {STAFF_APPROVAL_KINDS.map((a) => (
        <li key={a.kind}>{a.text}</li>
      ))}
    </ul>
  </span>
);

export const STAFF_FAQ_GROUPS: { title: string; items: FaqItem[] }[] = [
  {
    title: "Kasa raporu",
    items: [
      {
        id: "kasa-aksam",
        q: "Akşam kasa raporunu nasıl girerim?",
        a: (
          <>
            <StaffPath href="/panel/kasa" /> ekranında ModPOS Z raporunun ve banka POS Z raporunun (yazarkasa) fotoğrafını çekin. ModPOS&apos;un rakamları forma
            dolar; banka POS Z&apos;si için aşağıdaki soruya bakın. Turuncu alanları fişle karşılaştırın; hiçbir şey kendiliğinden kaydedilmez,{" "}
            <B>Raporu gönder</B>&apos;e siz basarsınız. Kasada sayılan nakdi, sayımdan sonra teslim edileni ve kasayı kimin saydığını
            yazın. Satış dışında kasaya para konduysa (bozuk para, tahsilat, nakit bahşiş) <B>Kasaya giren ekle</B> ile yazın. Kasa farkı yazarken
            hesaplanır; fark varsa nedenini nota yazın. Gece {hour(DAY_TURN_HOUR)}&apos;e kadar kapanan gün bir önceki güne yazılır.
          </>
        ),
        icon: Banknote,
        links: [{ href: "/panel/kasa", label: "Kasa raporu" }],
      },
      {
        id: "kasa-yazarkasa",
        q: "Banka POS Z raporu (yazarkasa)",
        a: (
          <>
            Banka POS&apos;tan (yazarkasa) aldığınız Z raporudur: üstünde Z RAPORU ve KDV dökümü yazar, banka gün sonu fişi değil. <StaffPath href="/panel/kasa" />{" "}
            ekranındaki Banka POS Z raporu (yazarkasa) kartında fotoğrafını çekin: fişi düz koyun, ekranı fişle doldurun; uzunsa önce üst yarısını, sonra alt
            yarısını çekin (en çok {MAX_OKC_PHOTOS} fotoğraf).{" "}
            {OKC_PREFILL_ENABLED ? (
              <>Birbirini tutan rakamlar forma dolar; tutmayan rakam turuncu kalır, altında nedeni yazar: fişe bakıp yazın.</>
            ) : (
              <>
                Okunan rakamlar şimdilik forma kendiliğinden yazılmaz: her alanın altında fotoğrafta okunan rakam ve <B>Fotoğraftakini yaz</B> çıkar. Fişle
                karşılaştırıp aynıysa düğmeye basın, değilse fişteki rakamı yazın.
              </>
            )}{" "}
            Fotoğraf çekemediyseniz dört alanı fişten yazın: <B>Günlük toplam</B> (NET SATIŞ ya da TOPLAM satırı, en büyük rakam değil), <B>Z no</B> (Z NO
            ya da Z SAYAÇ, fiş no değil), <B>Nakit</B> ve <B>Kredi kartı</B> (K.KARTI satırı, altındaki banka satırları değil). KDV dökümü, fiş sayısı, yemek
            kartı ve banka gün sonu <B>Ayrıntılar</B>&apos;dadır ve isteğe bağlıdır. Bölümü bütünüyle boş bırakabilirsiniz; bir rakam yazdıysanız günlük
            toplam, nakit ve kredi kartı da gerekir (yoksa 0 yazın). Rakamlar birbirini tutmazsa tutmayan alan turuncu olur ve altında nedeni yazar: fişe bakıp
            düzeltin. Kartın altında yazarkasanın kartı ModPOS&apos;taki kartla karşılaştırılır; farklıysa kartla alınan bir ödeme ModPOS&apos;ta başka ödeme
            türüyle girilmiş olabilir. Yanlış bölüme çekilen fotoğraf hiçbir alanı doldurmaz: altındaki <B>ModPOS bölümüne okut</B> ya da{" "}
            <B>Banka POS Z bölümüne okut</B> ile doğru bölüme okutun.
          </>
        ),
        icon: ScrollText,
        links: [{ href: "/panel/kasa", label: "Kasa raporu" }],
      },
      {
        id: "kasa-cikan",
        q: "Gün içinde kasadan para çıktı",
        a: (
          <>
            <StaffPath href="/panel/kasa" /> ekranının üstündeki kartta <B>Fiş ekle</B> ile fişin fotoğrafını çekin: yer, ne alındığı ve tarih okunur, bakıp{" "}
            <B>Kaydet</B>&apos;e basın. Fişiniz yoksa <B>Fişsiz ekle</B>. Tedarikçinin şoförüne verilen para <B>Teslim · ödeme</B>&apos;dir (kime verildiğini yazın).
            Akşam raporunun &quot;Gün içinde kasadan çıkan&quot; alanı bu satırlardan dolar. Satıra dokununca düzeltir ya da silersiniz; silince bildirimdeki{" "}
            <B>Geri al</B> {seconds(CASH_OUT_UNDO_TOAST_MS)} görünür. Kilit simgeli satır yöneticinin kaydına bağlıdır; değişmesi gerekiyorsa yöneticiye haber verin.
            Yöneticinin seçtiği bir kategorideki satırı değiştirmek ya da silmek de yöneticinin onayıyla olur.
          </>
        ),
        icon: Wallet,
      },
      {
        id: "kasa-cikan-gec",
        q: "Kapanmış ya da eski bir güne kasadan çıkan eklemek",
        a: (
          <>
            Ertesi günün raporu girildiyse o gün kapanmıştır: satır ekleme, düzeltme ve silme yöneticinin onayıyla olur (<B>Ekleme iste</B>, <B>Düzeltme iste</B>,{" "}
            <B>Silinmesini iste</B>). Dünden eski bir güne, son {REQUEST_DAYS} günün içinde, <B>Eski bir güne ekle</B> ile önce günü seçip fişin fotoğrafını çekin.
            Fotoğrafı olmayan bir satıra sonradan fiş eklemek onaysızdır: satırdaki <B>Fiş fotoğrafı ekle</B>.
          </>
        ),
        icon: Receipt,
      },
      {
        id: "kasa-duzelt",
        q: "Kasa raporunu düzeltmek",
        a: (
          <>
            Aynı gece ({clockSuffixTR(hour(DAY_TURN_HOUR), "abl")} önce) raporu <B>Düzenle</B> ile doğrudan düzeltirsiniz. Ertesi gün toplam satış, kart ve
            Z&apos;nin öteki tutarları, fiş sayısı ve not yine doğrudan düzelir; açılış, nakit satış, gün içinde giren, gün içinde çıkan, sayılan nakit, teslim edilen ya da
            kasayı sayan değişirse rapor kaydedilmez, yazdıklarınız yerinde kalır ve nedenini yazıp{" "}
            <B>Onaya gönder</B>&apos;e basarsınız. Düzeltme yöneticiye eski hâliyle görünür; onaylanınca rapor yeni sürüm olur. Rapor kilitliyse (ertesi günün
            raporu girildi) <B>Düzeltme öner</B>; yönetici yoksa ertesi günün raporunun notuna yazın. Bekleyen önerinizi <B>Öneriyi düzenle</B> ile değiştirir,{" "}
            <B>Geri çek</B> ile kaldırırsınız. Yanlış girilmiş bir raporun silinmesini <B>Silinmesini iste</B> ile istersiniz.
          </>
        ),
        icon: Pencil,
      },
      {
        id: "kasa-gec",
        q: "Unutulan bir günün raporunu girmek",
        a: (
          <>
            Dünün raporunu bugün doğrudan girersiniz. Daha eski bir gün, son {LATE_REPORT_DAYS} günün içindeyse, <StaffPath href="/panel/kasa" /> ekranındaki{" "}
            <B>Girilmemiş günler</B> kartında çip olarak durur: güne dokunun, Z raporunun fotoğrafını ekleyin, Z no&apos;yu ve neden geç girildiğini yazıp{" "}
            <B>Onaya gönder</B>&apos;e basın. Rapor yönetici onaylayınca kayda geçer. Fotoğrafsız gönderilemez. Daha eski bir günü yönetici girer; Z raporunu ona
            iletin. Kasada LafPOS kullanılmaya başlandıysa o günün rakamları LafPOS&apos;un gün sonundan dolar ve fotoğraf gerekmez; LafPOS o günü göndermediyse
            banka POS Z raporunun fotoğrafını ekleyin ve Z no&apos;yu LafPOS&apos;un Kasa › Geçmiş günler ekranından yazın.
          </>
        ),
        icon: History,
      },
      {
        id: "kasa-kapali",
        q: "Dün kafe kapalıydı",
        a: (
          <>
            <StaffPath href="/panel/kasa" /> ekranında dünün raporu yokken formun üstünde &quot;Dün kafe kapalı mıydı?&quot; ve <B>Kafe kapalıydı</B> çıkar. Yönetici
            onaylayınca dünün eksik rapor ve liste uyarıları kalkar. O gün panelde bir kayıt varsa (rapor, kasadan çıkan, zayi, açılan liste, karaoke; LafPOS
            kullanılıyorsa LafPOS&apos;taki satış) bildirim açılmaz: kafe açıktıysa raporu girin.
          </>
        ),
        icon: CalendarX2,
      },
      {
        id: "kasa-foto",
        q: "Rapora yanlış fotoğraf eklendi",
        a: (
          <>
            Kayıtlı raporda yanlış ModPOS Z ya da banka POS Z fotoğrafının yanındaki <B>Kaldırılmasını iste</B> ile nedenini yazıp gönderin; yönetici onaylayınca
            fotoğraf rapordan çıkar. Fotoğrafın okumasıyla rapordaki rakam farklıysa, raporun tek ModPOS Z fotoğrafıysa ya da banka POS Z rakamları yazılmış
            raporun tek banka POS Z fotoğrafıysa bu düğme yoktur.
          </>
        ),
        icon: Camera,
      },
      {
        id: "kasa-fiyatlar",
        q: "Kasadaki (ModPOS) satış fiyatları",
        a: (
          <>
            Menüde satış fiyatı değişince ModPOS&apos;ta da elle değiştirilir. Bekleyenler <StaffPath href="/panel/kasa/fiyatlar" /> ekranında, kasadaki adlarıyla
            durur; Bugün&apos;de satır olarak da çıkar. ModPOS&apos;ta değiştirdikçe ürüne tek tek dokunun: satır listeden düşer, bildirimde <B>Geri al</B> vardır.
            Son işaretledikleriniz listenin üstünde {minutes(POS_UNDO_WINDOW_MS)} kalır, oradan da geri alırsınız; sonrasını yönetici geri alır. Her işaret adınızla
            kaydedilir.
          </>
        ),
        icon: Tags,
        links: [{ href: "/panel/kasa/fiyatlar", label: "Kasadaki fiyatlar" }],
      },
    ],
  },
  {
    title: "Bar ekranı ve karaoke",
    items: [
      {
        id: "bar-siparis",
        q: "Uygulamadan sipariş geldi",
        a: (
          <>
            <StaffPath href="/panel/karaoke" /> ekranının en üstünde <B>Uygulama siparişleri</B> durur: nereye (masa, gel-al, kurye), müşterinin adı ve satırlar.
            Hazırlamaya başlayınca <B>Hazırlanıyor</B>, bitince <B>Hazır</B>, <B>Masaya götürüldü</B> ya da <B>Kuryeye verildi</B>; tezgâhta bekleyen gel-al
            alınınca <B>Teslim edildi</B>. Tek dokunuş yeter, onay sorulmaz. İptal ve iade bu panelde yapılmaz: yöneticiye haber verin.
          </>
        ),
        icon: Coffee,
      },
      {
        id: "tukendi",
        q: "Bir ürün bitti (Tükendi)",
        a: (
          <>
            Bar ekranındaki <B>Tükenenler</B> kartında <B>Tükendi işaretle</B>: ürünü arayıp seçin. Ürün laffogato.net&apos;te, uygulamada ve QR menüde hemen
            kapanır; M ve L birlikte kapanır. Ürün gelince aynı kartta <B>Satışa aç</B>. Onay gerekmez, her dokunuş adınızla kaydedilir. Aynı anda en çok{" "}
            {STAFF_SOLD_OUT_MAX} ürün tükendi olabilir. Yöneticinin kapattığı ürünü yönetici açar.
          </>
        ),
        icon: PackageX,
        links: [{ href: "/panel/karaoke#tukenenler", label: "Tükenenler" }],
      },
      {
        id: "karaoke-sayac",
        q: "Karaoke odası sayacı",
        a: (
          <>
            laffogato.net&apos;te rezervasyon açılınca bar ekranı çalar. Oturum başlayınca kısa ses, bitime az kala uyarı çalar; süre dolunca alarm, siz{" "}
            <B>Haber verdim</B>&apos;e basana kadar çalar. <B>+15</B> / <B>+30 dk</B> ile uzatın, erken çıkan grupta <B>Erken bitir</B>. Rezervasyonsuz gelen grup
            için hızlı sayacı başlatın; o saatte sitede rezervasyon varsa ekran sorar.
          </>
        ),
        icon: MicVocal,
      },
      {
        id: "bar-cihaz",
        q: "Bar ekranı çalmıyor ya da sarı satır var",
        a: (
          <>
            Barın cihazında <StaffPath href="/panel/karaoke" /> ekranındaki <B>Bu cihazda uyarılar</B> kartından bildirimlere izin verin ve ekranın açık kalmasını
            açın. &quot;Siteden alınamıyor&quot; diyen sarı satır çıkarsa yeni sipariş ve rezervasyon görünmeyebilir: sorun sürerse yöneticiye haber verin.
          </>
        ),
        icon: ListTodo,
      },
    ],
  },
  {
    title: "Kontrol listeleri",
    items: [
      {
        id: "liste-doldur",
        q: "Açılış ve kapanış listesi",
        a: (
          <>
            <StaffPath href="/panel/kontrol" /> ekranında maddeyi işaretleyin, buzdolabı sıcaklığını yazın, istenen yerde fotoğraf çekin; her dokunuş hemen kaydedilir.
            Sıcaklık aralık dışındaysa ne yaptığınızı nota yazın; sorun kaydı silinmez, düzelince yeni hâlini işaretleyin. Fotoğrafta müşteri ya da ekipten kimse
            görünmesin. Gün {clockSuffixTR(hour(DAY_TURN_HOUR))} döner; başlamış liste {graceEnd}&apos;a kadar bitirilebilir. Geçmiş bir gün sonradan doldurulamaz.
          </>
        ),
        icon: ListChecks,
      },
      {
        id: "liste-gecmis",
        q: "Dünkü listede ne eksikti?",
        a: (
          <>
            <StaffPath href="/panel/kontrol/gecmis" /> son {STAFF_HISTORY_DAYS} günü gösterir: hangi listeyi kim, ne zaman doldurdu, eksik maddeler ve sorunlar. Salt
            okunurdur; Bugün ekranı da dünün eksik listesini söyler.
          </>
        ),
        icon: ClipboardCheck,
        links: [{ href: "/panel/kontrol/gecmis", label: "Geçmiş" }],
      },
    ],
  },
  {
    title: "Zayi ve ikram",
    items: [
      {
        id: "zayi-gir",
        q: "Zayi ve ikram nasıl girilir?",
        a: (
          <>
            <StaffPath href="/panel/zayi" /> ekranında türü seçin: zayi (atılan, bozulan, dökülen, yanlış hazırlanan) ya da ikram (müşteriye, ekibe, tadım). Menü
            ürününü adetle (2× Latte M), malzemeyi sayım biriminde (Süt 1,5 LT) yazın, nedeni seçin. Uygulamadaki ödülle verilen içecek ikram değildir; buraya
            girmeyin. Kasada LafPOS kullanılmaya başlandıysa ürün ikramı LafPOS&apos;ta işaretlenir; burada yalnız zayi ve hammadde ikramı girilir. LafPOS&apos;ta
            “Zayi yaz” ile işaretlenen ürünü burada ayrıca girmeyin.
          </>
        ),
        icon: Gift,
      },
      {
        id: "zayi-sil",
        q: "Yanlış girdiğim zayi kaydını silmek",
        a: (
          <>
            Kendi kaydınızı bugün ve dün (kasa raporu girilene kadar) silebilirsiniz. Başkasının kaydı ya da kasa raporu girilmiş günün kaydı için satırdaki{" "}
            <B>Silinmesini iste</B>: nedenini yazın, yönetici onaylayınca silinir.
          </>
        ),
        icon: Trash2,
      },
      {
        id: "zayi-gec",
        q: "Geçmiş bir güne zayi ya da ikram yazmak",
        a: (
          <>
            Gün şeridindeki <B>Önceki gün</B> seçicisinden günü seçin (son {LATE_WINDOW_DAYS} gün). Kart &quot;Geç kayıt isteği&quot; olur: yöneticiye açıklamayı
            yazıp <B>Onaya gönder</B>. Kayıt onaylanınca adınızla girer. Daha eski bir gün yöneticinindir.
          </>
        ),
        icon: History,
      },
    ],
  },
  {
    title: "Stok sayımı",
    items: [
      {
        id: "sayim",
        q: "Ay sonu stok sayımı",
        a: (
          <>
            Ayın son günü kapanıştan sonra <StaffPath href="/panel/sayim" /> ekranında miktarları sayım biriminde (KG, LT, ADET, DİLİM) girin (telefonda Zayi
            ekranının başındaki <B>Sayım</B> sekmesinden de açılır). Listede olmayan ama her
            ay sayılacak bir kalem için <B>Listeye ekle</B>; paket fiyatını biliyorsanız fişteki gibi yazın, bilmiyorsanız boş bırakın. Geçen ayın sayımını
            ayın 10&apos;una kadar düzeltebilirsiniz; sonrası için yöneticiye haber verin. Kaydetmeden çıkarsanız yazdıklarınız bu cihazda durur, sayfayı
            yeniden açınca <B>Geri yükle</B>&apos;ye basın.
          </>
        ),
        icon: ClipboardList,
      },
    ],
  },
  {
    title: "Reçete ve özel günler",
    items: [
      {
        id: "recete",
        q: "Reçete yanlış ya da eksik",
        a: (
          <>
            <StaffPath href="/panel/receteler" /> ekranında ürünü açıp <B>Değişiklik öner</B>: miktarı düzeltin, malzeme ekleyin ve <B>Onaya gönder</B>. Onaylanana
            kadar eski reçeteyle yapın. Ürün başına bir bekleyen öneriniz olur: yeniden önerirseniz bekleyen öneriniz güncellenir, vazgeçerseniz Önerilerim&apos;de{" "}
            <B>Geri çek</B>. Yeni bir ürün için <B>Yeni ürün öner</B>; biliyorsanız satış fiyatını da yazın.
          </>
        ),
        icon: BookOpen,
      },
      {
        id: "ozel-gun",
        q: "Maç, AVM etkinliği ya da kampanya günü",
        a: (
          <>
            <StaffPath href="/panel/ozel-gunler" /> ekranında yarından itibaren en çok {STAFF_SPECIAL_LIMITS.aheadDays} gün sonrasına özel gün ekleyin: tür, ad ve
            yoğunluğa etkisi. Bir özel gün en çok {STAFF_SPECIAL_LIMITS.maxSpan} gün sürer; ileriye girdiğiniz günler toplam {STAFF_SPECIAL_LIMITS.futureDays} günü
            geçemez. Kendi girdiğiniz ve başlamamış günü düzeltir ya da silersiniz. Bugün&apos;deki yoğunluk ve tatlı sayısı bunlara göre ayarlanır.
          </>
        ),
        icon: CalendarHeart,
      },
    ],
  },
  {
    title: "İstekler ve bildirimler",
    items: [
      {
        id: "onaya-gidenler",
        q: "Yöneticinin onayına gidenler",
        a: (
          <>
            Şunlar kayda doğrudan yazılmaz, yönetici onaylayınca geçer:
            {APPROVAL_LIST}
            <span className="mt-1 block">
              Gönderdiğiniz isteği karar verilene kadar düzeltir ya da <B>Geri çek</B> ile kaldırırsınız. Reddedilirse yöneticinin notu yanında yazar.
            </span>
          </>
        ),
        icon: ClipboardCheck,
      },
      {
        id: "isteklerim",
        q: "İsteğim ne oldu?",
        a: (
          <>
            Zildeki <B>İsteklerim</B> başlığı isteklerinizin ve reçete önerilerinizin sonucunu söyler (onaylandı, reddedildi, kapandı); dokununca ilgili ekran açılır.{" "}
            <StaffPath href="/panel/kasa" /> ekranının altındaki İsteklerim son 7 günün kasa isteklerini gösterir.
          </>
        ),
        icon: Inbox,
      },
      {
        id: "bugun",
        q: "Bugün ekranında ne var?",
        a: (
          <>
            <StaffPath href="/panel/bugun" /> girişte açılır: dünün ve bugünün kasa raporu, açılış ve kapanış listeleri, zayi, ay sonu sayımı ve kasadaki satış
            fiyatları. Sıradaki iş öne çıkar, bitenler Tamamlananlar&apos;a iner. Bugün kafede kartı yoğunluğu ve tükenen ürünleri söyler.
          </>
        ),
        icon: ListTodo,
      },
      {
        id: "hatirlaticilarim",
        q: "Kendime hatırlatıcı kurmak",
        a: (
          <>
            <StaffPath href="/panel/hatirlaticilarim" /> ekranında kendinize not ve hatırlatma yazın (sipariş verilecekler, temizlik, aranacaklar); yalnız siz
            görürsünüz. Saat verirseniz panel açıkken saatinde sesli uyarır; bildirim açıksa sabah özetini telefonda alırsınız.
          </>
        ),
        icon: AlarmClock,
      },
      {
        id: "hesabim",
        q: "Parolamı değiştirmek, Yardım'ı bulmak",
        a: (
          <>
            Kenar çubuğunun altında adınıza dokunun: <StaffPath href="/panel/hesap" /> parolayı değiştirir ve iki adımlı doğrulamayı (Google Authenticator vb.) açar.
            Bu sayfa menünün en altında ve aynı profil menüsünde <StaffPath href="/panel/yardim/personel" /> adıyla durur.
          </>
        ),
        icon: UserRound,
      },
    ],
  },
];
