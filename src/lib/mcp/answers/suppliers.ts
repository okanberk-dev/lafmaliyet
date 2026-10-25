/*
 * tedarikci_ozeti: bir tedarikçinin (ya da hepsinin) dönemdeki faturaları, ödendi işaretli tutar, kalan borç, geciken
 * ve yaklaşanlar; cari hesabı (faturasız borçlar, hesaptaki sayılmamış ödeme, net bakiye, son ödemeler). Gruplama
 * Tedarikçiler ekranınınki (groupSuppliers; vergi numarasıyla eşleşme dahil), toplamlar summarize ve accountOf ile.
 * Ödemeler panelde elle girilir; banka bağlı değil. IBAN, vergi no, telefon, e-posta, adres, yetkili kişi, not, fatura
 * ve kayıt açıklaması gönderilmez. Saf; tests/claude-araclar.test.ts.
 */

import { supplierMatchKey } from "../../../app/panel/faturalar/rules";
import { supplierHref, summarize, dueOf, methodLabel, payState, type LedgerInvoice, type PaymentMethod } from "../../../app/panel/tedarikciler/logic";
import { openBalance } from "../../calc/insights";
import { METHOD_LABEL, type CariMethod } from "../../cari/balance";
import { dateTR } from "../../format";
import { checkRange, cleanName, foldName, money, nameMatches, num, panelUrl, r2 } from "./common";

/** Tedarikçinin bu araca gereken alanları (kartın gizli alanları burada hiç yok) */
export interface LedgerGroupLike {
  key: string;
  keys: string[];
  slug: string;
  name: string;
  names: string[];
  termDays: number;
  card: { paidOnDelivery: boolean; paymentMethod: PaymentMethod | null } | null;
  invoices: (LedgerInvoice & { invoiceNo: string | null; category: string })[];
  summary: { open: number };
  /** Cari hesap (faturalar ve elle kayıtlar; kayıt yokken açık = faturaların açığı, hesaptaki para 0) */
  account?: { open: number; balance: number; credit: number; debtOpen: number; debtOpenCount: number };
  /** Ödeme kayıtları, en yeni önce */
  cariPayments?: { date: string; amount: number; method: CariMethod; items: number }[];
}

export type SupplierAnswer =
  | {
      tedarikci: { ad: string; digerAdlar: string[]; vadeGunu: number; pesin: boolean; odemeSekli: string | null };
      donem: { baslangic: string; bitis: string };
      ozet: {
        faturaSayisi: number;
        faturaToplamiKdvDahil: number;
        odendiIsaretli: number;
        odendiFaturaSayisi: number;
        acikBorc: number;
        acikFaturaSayisi: number;
        geciken: number;
        gecikenSayisi: number;
        yakinda7Gun: number;
        sonFatura: string | null;
        sonOdeme: string | null;
        /** Tarihi dönemin dışında kalanlar dahil bütün açık borç (faturalar ve faturasız borçlar) */
        toplamAcikBorc: number;
        /** Açık faturasız borçlar (elle girilen alımlar; tarih süzgeci yok) */
        faturasizBorc: { adet: number; tutar: number };
        /** Hesapta duran, hiçbir kaleme sayılmamış ödeme */
        hesaptakiOdeme: number;
        /** Bütün açık borç − hesaptaki ödeme; eksiyse alacak (fazla ödeme) */
        netBakiye: number;
      };
      /** Son ödeme kayıtları (en çok 10, en yeni önce) */
      sonOdemeler: { tarih: string; tutar: number; sekil: string; sayildigiKalem: number }[];
      faturalar: {
        tarih: string;
        no: string | null;
        kategori: string;
        tutarKdvDahil: number;
        durum: "ödendi" | "ödenmedi" | "ödemesi istendi";
        odemeTarihi: string | null;
        vade: string | null;
        vadeTahmini: boolean;
        kalan: number;
      }[];
      hesap: string[];
      kaynak: string[];
      panelAdresi: string;
    }
  | { bulunamadi: true; aranan: string; adaylar: { ad: string; faturaSayisi: number }[]; panelAdresi: string }
  | { birdenFazla: true; aranan: string; adaylar: { ad: string; faturaSayisi: number }[]; panelAdresi: string }
  | {
      donem: { baslangic: string; bitis: string };
      tedarikciler: {
        ad: string;
        faturaSayisi: number;
        faturaToplamiKdvDahil: number;
        odendiIsaretli: number;
        acikBorc: number;
        geciken: number;
        toplamAcikBorc: number;
        hesaptakiOdeme: number;
        netBakiye: number;
      }[];
      toplam: {
        tedarikciSayisi: number;
        faturaSayisi: number;
        faturaToplamiKdvDahil: number;
        odendiIsaretli: number;
        acikBorc: number;
        geciken: number;
        toplamAcikBorc: number;
        hesaptakiOdeme: number;
      };
      hesap: string[];
      kaynak: string[];
      panelAdresi: string;
    };

const STATE = { paid: "ödendi", unpaid: "ödenmedi", requested: "ödemesi istendi" } as const;

const KAYNAK = [
  "Faturalar Paraşüt'ten ve elle girilenlerden; 'ödendi' bilgisi panel/Paraşüt işareti, banka hareketi değil.",
  "Ödemeler panelde elle girilir; banka bağlı değil. Faturasız borçlar (elden ya da veresiye alım, eski borç) da elle girilir.",
  "Ödeme günü girilmemiş faturalarda ödeme tarihi bilinmiyor.",
];

/** Tedarikçinin cari hesabı (kayıt yokken faturaların açığı ve sıfırlar) */
const accountOf = (g: LedgerGroupLike) => g.account ?? { open: g.summary.open, balance: g.summary.open, credit: 0, debtOpen: 0, debtOpenCount: 0 };

/** Aranan adla eşleşen tedarikçiler: önce ad anahtarı birebir, sonra adın bir parçası */
export function matchSuppliers<G extends Pick<LedgerGroupLike, "name" | "names" | "keys">>(groups: readonly G[], q: string): { exact: G[]; partial: G[] } {
  const key = foldName(q);
  // Ad anahtarı Tedarikçiler ekranınınki (supplierMatchKey: "KALDI" ile "Kaldi" aynı)
  const exact = groups.filter((g) => [g.name, ...g.names].some((n) => foldName(n) === key) || g.keys.includes(supplierMatchKey(q)));
  const partial = groups.filter((g) => [g.name, ...g.names].some((n) => nameMatches(n, q)));
  return { exact, partial };
}

function inPeriod<I extends { date: string }>(invoices: readonly I[], from: string, to: string): I[] {
  return invoices.filter((i) => i.date >= from && i.date <= to);
}

export function supplierSummary(
  ledger: { today: string; groups: readonly LedgerGroupLike[] },
  input: { tedarikci?: string; baslangic: string; bitis: string; limit: number; siralama?: "fatura" | "borc" },
  ctx: { base: string },
): SupplierAnswer {
  checkRange(input.baslangic, input.bitis, { maxDays: 3 * 366 + 1 });
  const { today } = ledger;
  const listUrl = panelUrl(ctx.base, "/panel/tedarikciler");
  const donem = { baslangic: input.baslangic, bitis: input.bitis };
  const candidate = (g: LedgerGroupLike) => ({ ad: cleanName(g.name), faturaSayisi: g.invoices.length });

  if (input.tedarikci) {
    const q = input.tedarikci;
    const { exact, partial } = matchSuppliers(ledger.groups, q);
    const hits = exact.length ? exact : partial;
    if (!hits.length) {
      // Yazım farkı olabilir: ilk üç harfi tutanlar aday
      const head = foldName(q).slice(0, 3);
      const near = ledger.groups.filter((g) => foldName(g.name).startsWith(head)).slice(0, 5);
      return { bulunamadi: true, aranan: cleanName(q, 60), adaylar: near.map(candidate), panelAdresi: listUrl };
    }
    if (hits.length > 1) {
      const top = [...hits].sort((a, b) => b.invoices.length - a.invoices.length).slice(0, 5);
      return { birdenFazla: true, aranan: cleanName(q, 60), adaylar: top.map(candidate), panelAdresi: listUrl };
    }
    const g = hits[0];
    const list = inPeriod(g.invoices, input.baslangic, input.bitis);
    const s = summarize(list, { today, termDays: g.termDays });
    const paid = list.filter((i) => !i.unpaid);
    const paidTotal = r2(paid.reduce((a, i) => a + i.payable, 0));
    const open = list.filter((i) => i.unpaid && openBalance(i) !== 0);
    const hesap = [
      `Dönemde ${num(s.count)} fatura, toplam ${money(s.invoiced)} (KDV dahil)`,
      `Ödendi işaretli ${num(paid.length)} fatura = ${money(paidTotal)}`,
    ];
    if (open.length) {
      const first = [...open].sort((a, b) => a.date.localeCompare(b.date))[0];
      const due = dueOf(first, g.termDays);
      const dueText = `vade ${dateTR(due.date)}${due.estimated ? `, tahmini: fatura günü + ${num(g.termDays)} gün` : ""}`;
      hesap.push(
        `Kalan borç ${num(open.length)} fatura = ${money(s.open)} (${open.length === 1 ? `${dateTR(first.date)} faturası; ${dueText}` : `en eskisi ${dateTR(first.date)}; ${dueText}`})`,
      );
    } else {
      hesap.push("Dönemde ödenmemiş fatura yok");
    }
    if (s.overdueCount) hesap.push(`Geciken ${num(s.overdueCount)} fatura = ${money(s.overdue)}`);
    const acc = accountOf(g);
    // Son ödeme (§4.7): en yeni ödeme olayı; faturada işaretli ödeme ya da dönemdeki cari ödeme kaydı (defterin kapattığı
    // fatura olay sayılmaz, parası ödeme kaydında)
    const invoicePaid = s.lastPaid?.slice(0, 10) ?? null;
    const cariPaid = (g.cariPayments ?? []).reduce<string | null>((m, p) => (p.date >= input.baslangic && p.date <= input.bitis && (!m || p.date > m) ? p.date : m), null);
    const lastPaid = cariPaid && (!invoicePaid || cariPaid > invoicePaid) ? cariPaid : invoicePaid;
    if (r2(acc.open) !== r2(s.open)) hesap.push(`Dönem dışındakiler dahil bütün açık borç ${money(acc.open)}`);
    if (acc.debtOpenCount) hesap.push(`Faturasız borç ${num(acc.debtOpenCount)} alım = ${money(acc.debtOpen)} (elle girilen; açık borca dahil)`);
    if (acc.credit > 0.005) {
      hesap.push(
        `Hesapta sayılmamış ödeme ${money(acc.credit)}; net bakiye ${acc.balance < 0 ? `${money(-acc.balance)} alacak (fazla ödeme)` : money(acc.balance)} (açık borç − hesaptaki ödeme)`,
      );
    }
    return {
      tedarikci: {
        ad: cleanName(g.name),
        digerAdlar: g.names
          .filter((n) => foldName(n) !== foldName(g.name))
          .slice(0, 10)
          .map((n) => cleanName(n)),
        vadeGunu: g.termDays,
        pesin: Boolean(g.card?.paidOnDelivery),
        odemeSekli: methodLabel(g.card?.paymentMethod ?? null),
      },
      donem,
      ozet: {
        faturaSayisi: s.count,
        faturaToplamiKdvDahil: r2(s.invoiced),
        odendiIsaretli: paidTotal,
        odendiFaturaSayisi: paid.length,
        acikBorc: r2(s.open),
        acikFaturaSayisi: s.openCount,
        geciken: r2(s.overdue),
        gecikenSayisi: s.overdueCount,
        yakinda7Gun: r2(s.soon),
        sonFatura: s.lastInvoice,
        sonOdeme: lastPaid,
        toplamAcikBorc: r2(acc.open),
        faturasizBorc: { adet: acc.debtOpenCount, tutar: r2(acc.debtOpen) },
        hesaptakiOdeme: r2(acc.credit),
        netBakiye: r2(acc.balance),
      },
      sonOdemeler: (g.cariPayments ?? []).slice(0, 10).map((p) => ({ tarih: p.date, tutar: r2(p.amount), sekil: METHOD_LABEL[p.method], sayildigiKalem: p.items })),
      faturalar: list.slice(0, input.limit).map((i) => {
        const balance = openBalance(i);
        return {
          tarih: i.date,
          no: i.invoiceNo ? cleanName(i.invoiceNo, 40) : null,
          kategori: cleanName(i.category, 40),
          tutarKdvDahil: r2(i.payable),
          durum: STATE[payState(i)],
          odemeTarihi: i.paidAt?.slice(0, 10) ?? null,
          vade: i.unpaid ? dueOf(i, g.termDays).date : (i.dueDate ?? null),
          // Vade yalnız ödenmemişte gösterilir; yazılmamışsa tahminidir
          vadeTahmini: i.unpaid && !i.dueDate,
          kalan: r2(balance),
        };
      }),
      hesap,
      kaynak: KAYNAK,
      panelAdresi: panelUrl(ctx.base, supplierHref(g.slug)),
    };
  }

  const rows = ledger.groups
    .map((g) => {
      const list = inPeriod(g.invoices, input.baslangic, input.bitis);
      const s = summarize(list, { today, termDays: g.termDays });
      const paid = list.filter((i) => !i.unpaid).reduce((a, i) => a + i.payable, 0);
      return { g, s, paid };
    })
    .filter((x) => x.s.count > 0 || accountOf(x.g).open > 0 || accountOf(x.g).credit > 0.005)
    // "En çok kime borcumuz var?": borç sırası bütün açık borca göre (dönem dışındakiler dahil)
    .sort((a, b) =>
      input.siralama === "borc"
        ? accountOf(b.g).open - accountOf(a.g).open || b.s.invoiced - a.s.invoiced
        : b.s.invoiced - a.s.invoiced || accountOf(b.g).open - accountOf(a.g).open,
    );
  const sum = (f: (x: (typeof rows)[number]) => number) => r2(rows.reduce((a, x) => a + f(x), 0));
  const toplam = {
    tedarikciSayisi: rows.length,
    faturaSayisi: rows.reduce((a, x) => a + x.s.count, 0),
    faturaToplamiKdvDahil: sum((x) => x.s.invoiced),
    odendiIsaretli: sum((x) => x.paid),
    acikBorc: sum((x) => x.s.open),
    geciken: sum((x) => x.s.overdue),
    toplamAcikBorc: sum((x) => accountOf(x.g).open),
    hesaptakiOdeme: sum((x) => accountOf(x.g).credit),
  };
  return {
    donem,
    tedarikciler: rows.slice(0, input.limit).map((x) => ({
      ad: cleanName(x.g.name),
      faturaSayisi: x.s.count,
      faturaToplamiKdvDahil: r2(x.s.invoiced),
      odendiIsaretli: r2(x.paid),
      acikBorc: r2(x.s.open),
      geciken: r2(x.s.overdue),
      toplamAcikBorc: r2(accountOf(x.g).open),
      hesaptakiOdeme: r2(accountOf(x.g).credit),
      netBakiye: r2(accountOf(x.g).balance),
    })),
    toplam,
    hesap: [
      `Dönemde ${num(toplam.tedarikciSayisi)} tedarikçiden ${num(toplam.faturaSayisi)} fatura, toplam ${money(toplam.faturaToplamiKdvDahil)} (KDV dahil)`,
      `Ödendi işaretli ${money(toplam.odendiIsaretli)}; dönemin kalan borcu ${money(toplam.acikBorc)}, geciken ${money(toplam.geciken)}`,
      `Dönem dışındakiler dahil bütün açık borç ${money(toplam.toplamAcikBorc)} (toplamAcikBorc; faturasız borçlar dahil)`,
      ...(toplam.hesaptakiOdeme > 0.005 ? [`Hesaplarda sayılmamış ödeme ${money(toplam.hesaptakiOdeme)} (netBakiye = açık borç − hesaptaki ödeme)`] : []),
      input.siralama === "borc" ? "Sıra: bütün açık borç büyükten küçüğe" : "Sıra: dönemdeki fatura toplamı büyükten küçüğe",
    ],
    kaynak: KAYNAK,
    panelAdresi: listUrl,
  };
}
