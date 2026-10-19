import {
  ArrowUpRight,
  Bell,
  CalendarCheck,
  ClipboardList,
  Coffee,
  CupSoda,
  FileText,
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
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BouncyAccordionList, type BouncyAccordionItem } from "@/components/akmanos/bouncy-accordion";
import { NAV_FOOTER, NAV_GROUPS, NAV_TREE, SECTION_TABS } from "@/components/panel/nav";
import { PageHeader } from "@/components/panel/page-header";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, Well } from "@/components/ui/card";
import { IconTile, toneFor } from "@/components/ui/icon-tile";

export const metadata: Metadata = { title: "Yardım" };

// ---------------------------------------------------------------- Menü yolları (kabuktaki adlarla)

/** Bir ekranın kenar çubuğundaki yolu, ör. "/panel/satislar" → ["Satış & gider", "Satışlar"] */
function pathOf(href: string): string[] {
  for (const n of NAV_TREE) {
    if (n.href === href) return [n.label];
    const c = n.children?.find((ch) => ch.href === href);
    if (c) return [n.label, c.label];
  }
  return [];
}

const NAV_ITEMS = [...NAV_GROUPS.flatMap((g) => g.items), ...NAV_FOOTER];

/** Ekranın Excel karşılığı; sekmeli ekranlarda ("Sabit Giderler + Personel") her sekmenin kendi sayfası */
function excelFor(href: string): string | undefined {
  for (const tabs of Object.values(SECTION_TABS)) {
    const i = tabs.findIndex((t) => t.href === href);
    if (i < 0) continue;
    const parts = NAV_ITEMS.find((n) => n.href === tabs[0].href)?.excel?.split(" + ");
    if (parts && parts.length === tabs.length) return parts[i];
  }
  return NAV_ITEMS.find((n) => n.href === href)?.excel;
}

/** Aynı menü öğesinin altındaki sekmeler (Giderler & personel → Sabit giderler, Personel) */
const tabsOf = (href: string) => Object.values(SECTION_TABS).find((tabs) => tabs[0].href === href);

/** "Genel bakış · Menü (Ürünler, Hammaddeler, Reçete defteri) · …" */
const MENU_LAYOUT = NAV_TREE.map((n) => (n.children ? `${n.label} (${n.children.map((c) => c.label).join(", ")})` : n.label)).join(" · ");
const STAFF_SCREENS = NAV_TREE.flatMap((n): { label: string }[] =>
  n.children ? n.children.filter((c) => c.roles.includes("staff")) : n.roles.includes("staff") ? [n] : [],
).map((n) => n.label);

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
        Ayın son günü kapanıştan sonra <Path href="/panel/sayim" /> ekranında miktarları sayım biriminde (KG, LT, ADET, DİLİM) girin. Personel hesabıyla telefondan da yapılabilir.
      </>
    ),
    href: "/panel/sayim",
    icon: ClipboardList,
  },
  {
    title: "Satış raporunu yükleyin",
    body: (
      <>
        Patron › Raporlar › Satış ekranından ürün listesini (ad, adet, ciro) kopyalayıp <Path href="/panel/satislar" /> ekranında Satış raporu yükle ile yapıştırın ya da dosyayı seçin.
        Daha önce eşleştirilen ürünler otomatik tanınır; eşleşmeyen satırları bir kez eşleştirin.
      </>
    ),
    href: "/panel/satislar",
    icon: Receipt,
  },
  {
    title: "Ay bilgilerini girin",
    body: (
      <>
        <Path href="/panel/satislar" /> ekranında POS cirosunu (KDV dahil), açık gün sayısını, yönetici indirimlerini ve ödenmez/ikram tutarını yazın.
      </>
    ),
    href: "/panel/satislar",
    icon: CalendarCheck,
  },
  {
    title: "Faturaları girin",
    body: (
      <>
        Paraşüt&apos;teki alış faturalarını <Path href="/panel/faturalar" /> ekranına ekleyin. Fiyatı değişen malzemenin paket fiyatını <Path href="/panel/hammaddeler" /> ekranında
        güncelleyin; bütün ürün maliyetleri kendiliğinden değişir.
      </>
    ),
    href: "/panel/faturalar",
    icon: FileText,
  },
  {
    title: "Değişken giderleri yazın",
    body: (
      <>
        Su faturası, doğalgaz, bakım-tamir gibi ay ay değişen giderleri <Path href="/panel/gelir-gider" /> tablosundaki ilgili hücreye girin. Elektrik gibi sabit görünen ama değişen
        kalemlerin gerçek tutarını da hücrenin üzerine yazabilirsiniz.
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
            deneyebilirsiniz.
          </>
        ),
        icon: Tag,
        links: [{ href: "/panel/urunler", label: "Ürünler" }],
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
            <Path href="/panel/hammaddeler" /> ekranında o malzemenin paket fiyatını değiştirin (fiyat geçmişi saklanır), <Path href="/panel/faturalar" /> ekranına faturayı ekleyin.
          </>
        ),
        icon: FileText,
        links: [
          { href: "/panel/hammaddeler", label: "Hammaddeler" },
          { href: "/panel/faturalar", label: "Faturalar" },
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
    title: "Gider ve ekip",
    items: [
      {
        id: "maas",
        q: "Maaş / kira değişti",
        a: (
          <>
            <Path href="/panel/giderler" /> ekranında: Personel sekmesinde net maaşı, Sabit giderler sekmesinde kirayı değiştirin.
          </>
        ),
        icon: Wallet,
        links: [
          { href: "/panel/personel", label: "Personel" },
          { href: "/panel/giderler", label: "Sabit giderler" },
        ],
      },
      {
        id: "hesap",
        q: "Personele hesap açmak",
        a: (
          <>
            <Path href="/panel/ayarlar" /> › Kullanıcılar › Kullanıcı ekle, rol: Personel. Personel yalnızca stok sayımını ve reçete defterini görür.
          </>
        ),
        icon: UserPlus,
        links: [{ href: "/panel/ayarlar#kullanicilar", label: "Kullanıcılar" }],
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
            Sol menü: {MENU_LAYOUT}. Alt sayfası olan öğeye dokununca liste açılır. Personel yalnızca {STAFF_SCREENS.join(" ve ")} ekranlarını görür.
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
            Sol üstte L&apos;Affogato adının yanındaki zil, son ayın uyarılarını (<Path href="/panel" />&apos;taki &quot;Dikkat edilmesi gerekenler&quot;) listeler. Bir uyarıya
            dokununca ilgili ekran açılır; &quot;Genel bakışta gör&quot; bütün listeyi gösterir.
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
  ["Maliyet oranı", "Ürün maliyeti ÷ net satış (hedef ≤ %30)"],
  ["Önerilen fiyat", "TAVAN(maliyet ÷ hedef oran × (1 + KDV); 5 ₺)"],
  ["Durum", "İyi ≤ hedef · Dikkat ≤ hedef + 10 puan · Düşük kâr > hedef + 10 puan"],
  ["Eşleşmeyen POS ürünü", "Net ciro × eşleşen ürünlerin ortalama maliyet oranı"],
  ["Başabaş günlük ciro", "Aylık sabit giderler ÷ (brüt kâr ÷ ciro) ÷ ayda açık gün"],
  ["Aylık sabit gider (gelir-gider)", "Aylık tutar × açık gün ÷ ayın gün sayısı (günlük giderler × açık gün)"],
  ["Satılan malın maliyeti", "Önceki aydan devir + ay içinde alınan − sonraki aya devreden (sayım)"],
];

// ---------------------------------------------------------------- Sayfa

function GoLinks({ links }: { links: { href: string; label: string }[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-4">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center gap-1 text-[13px] font-medium text-ink hover:underline">
          {l.label}
          <ArrowUpRight size={13} className="text-ink-quiet" aria-hidden="true" />
        </Link>
      ))}
    </span>
  );
}

const faqItems = (items: Faq[]): BouncyAccordionItem[] =>
  items.map((f) => ({
    id: f.id,
    title: f.q,
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
          <CardHeader icon={<CalendarCheck />} title="Her ay ne yapmalı?" description="Bu altı adımı her ay sonunda yaptığınızda bütün raporlar doğru olur." />
          <CardContent>
            <ol className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {ROUTINE.map((r, i) => (
                <li key={r.title}>
                  <Link href={r.href} className="group flex h-full flex-col gap-2 rounded-2xl bg-surface p-4 ring-1 ring-line transition-shadow hover:shadow-lift">
                    <span className="flex items-center gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-white tabular">{i + 1}</span>
                      <span className="min-w-0 flex-1 font-semibold text-ink group-hover:underline">{r.title}</span>
                      <IconTile size="sm" tone={toneFor(r.href)}>
                        <r.icon />
                      </IconTile>
                    </span>
                    <span className="text-[13px] leading-5 text-ink-mute">{r.body}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader icon={<Info />} title="Nasıl yapılır?" description="Sık yapılan değişiklikler ve bilinmesi gerekenler. Açmak için soruya dokunun." />
            <CardContent className="space-y-5">
              {FAQ_GROUPS.map((g) => (
                <section key={g.title} aria-label={g.title}>
                  <h3 className="mb-2 px-1 text-[13px] font-medium text-ink-mute">{g.title}</h3>
                  <BouncyAccordionList
                    items={faqItems(g.items)}
                    classNames={{
                      trigger: "min-h-[52px] gap-3 px-4 py-2.5",
                      // Uzun sorular telefonda kısaltılmasın, alt satıra geçsin
                      title: "text-sm font-medium text-pretty text-ink whitespace-normal!",
                      content: "[&>div]:px-4",
                      description: "text-sm leading-6 text-ink-soft sm:pl-10",
                    }}
                  />
                </section>
              ))}
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
                    <span className="sr-only">Bilgi</span> simgesinin üzerine gelince Excel&apos;deki hücre notlarının karşılığı olan açıklama çıkar.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader
                icon={<Sigma />}
                title="Formüller"
                description="Hesaplama motoru Excel'deki formüllerin birebir karşılığıdır ve otomatik testlerle Excel'e karşı doğrulanır."
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
                        <Link href={n.href} className="flex min-h-9 min-w-0 flex-1 items-center gap-1 text-sm font-medium text-ink hover:underline">
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
                                <Link href={c.href} className="inline-flex min-h-9 items-center gap-1 text-[13px] text-ink-soft hover:text-ink hover:underline">
                                  {c.label}
                                </Link>
                                {tabs ? null : <ExcelValue value={excelFor(c.href)} />}
                              </div>
                              {tabs ? (
                                <ul className="ml-1 border-l border-line pl-3" aria-label={`${c.label} sekmeleri`}>
                                  {tabs.map((t) => (
                                    <li key={t.href} className="flex items-center justify-between gap-3">
                                      <Link href={t.href} className="inline-flex min-h-9 items-center text-[13px] text-ink-mute hover:text-ink hover:underline">
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
                      <Link href={account.href} className="flex min-h-9 min-w-0 flex-1 items-center gap-1 text-sm font-medium text-ink hover:underline">
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
