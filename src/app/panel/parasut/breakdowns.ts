import type { BreakdownGroup, BreakdownRow } from "@/lib/breakdown";
import { dateTimeTR, dateTR, monthLabel, num } from "@/lib/format";
import { PARASUT_SETTINGS, REQUIRED_SETTINGS, type ParasutSettingsView, type SettingSource } from "@/lib/parasut/settings";

/**
 * Paraşüt entegrasyonu sayfasındaki dört özet kartının dökümü (karta dokununca açılan pencere). Saf fonksiyonlar:
 * fatura dökümünü sayfa sunucuda kurar (kartın sayısını veren sorgunun ay ve tür kırılımından, sayı da aynı
 * satırlardan toplanır); bağlantı, bağlı ürün ve son eşitleme dökümlerini istemci bileşeni zaten aldığı verilerden.
 */

/** Ürün → hammadde bağlantıları kartının çapası: dökümdeki bağlantı süzülmüş listeye kayar */
export const LINKS_ID = "urun-baglantilari";

const query = (filters: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));

/** Bu sayfadaki ürün listesine inen bağlantı (?durum=bagli|bekleyen&ara=…); liste süzgeçleri adresten okur */
export function linksHref(filters: { durum?: "bekleyen" | "bagli"; ara?: string }): string {
  return `/panel/parasut?${query(filters)}#${LINKS_ID}`;
}

/** Faturalar'da yalnız Paraşüt'ten gelenler (?kaynak=parasut), istenirse ayıyla ya da kontrol bekleyenler */
export function invoicesHref(filters: { ay?: string; durum?: "kontrol" } = {}): string {
  return `/panel/faturalar?${query({ kaynak: "parasut", ...filters })}#fatura-listesi`;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const parts = (xs: (string | null | false | undefined)[]) => xs.filter(Boolean).join(" · ") || undefined;
/** Uzun ileti (Paraşüt hatası) pencereyi uzatmasın */
const clip = (s: string | null | undefined, max = 240) => {
  const t = s?.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// ---------------------------------------------------------------- Paraşüt'ten gelen fatura

/** Paraşüt'e bağlı faturaların (source = parasut) ay ve tür kırılımı: sayfanın sorgusundan bir satır */
export interface InvoiceMix {
  /** YYYY-MM (faturanın tarihi) */
  month: string;
  /** Kaydı ilk kim açtı: Paraşüt eşitlemesi ya da panel (içe aktarılmış ya da elle); bağlanınca değişmez */
  origin: "manual" | "excel" | "parasut";
  /** Paraşüt'teki gider faturasına bağlı (içeri alınmış ya da Paraşüt'e elle girilmiş) */
  bill: boolean;
  /** Gelen e-faturaya bağlı */
  eInvoice: boolean;
  n: number;
  /** Eşitlemenin kategorisini tahmin ettiği, kontrol bekleyen */
  review: number;
  /** Bu kırılımda en son eşitlenme (ISO) */
  last: string | null;
}

/** Kartın rakamları: fatura sayısı, son eşitlenme ve kontrol bekleyen; döküm de aynı satırlardan (hep tutar) */
export function invoiceStats(mix: InvoiceMix[]): { invoices: number; lastSyncedAt: string | null; needsReview: number } {
  let last: string | null = null;
  for (const r of mix) if (r.last && (!last || r.last > last)) last = r.last;
  return { invoices: sum(mix.map((r) => r.n)), lastSyncedAt: last, needsReview: sum(mix.map((r) => r.review)) };
}

type InvoiceKind = "einvoice" | "bill" | "matched" | "other";
const KINDS: Record<InvoiceKind, { label: string; note: string }> = {
  einvoice: {
    label: "Gelen e-fatura",
    note: "Paraşüt'te “içeri al” yapılmadan panele alınanlar; tutar, KDV, kalemler ve PDF e-faturadan gelir.",
  },
  bill: {
    label: "Gider faturası",
    note: "Paraşüt'te içeri alınmış ya da Paraşüt'e elle girilmiş gider faturaları.",
  },
  matched: {
    label: "Panel kaydı, Paraşüt'e bağlandı",
    note: "Elle girilmiş ya da içe aktarılmış (eski) kayıt Paraşüt'teki karşılığıyla eşleşti; yenisi açılmadı, kategorisi korundu.",
  },
  other: { label: "Diğer", note: "Paraşüt'teki gider faturası ya da e-fatura kimliği kalmamış kayıtlar." },
};

function kindOf(r: InvoiceMix): InvoiceKind {
  if (r.origin !== "parasut") return "matched";
  if (r.bill) return "bill";
  return r.eInvoice ? "einvoice" : "other";
}

/**
 * Paraşüt'ten gelen fatura kartı: türüne göre bölümler (en kalabalık önce), bölümde ay ay (en yeni önce); aya
 * dokununca o ayın Paraşüt faturaları Faturalar'da açılır. Kontrol bekleyenler ayrı, toplama girmez (zaten içinde).
 */
export function invoiceBreakdown(mix: InvoiceMix[]): BreakdownGroup[] {
  const countOf = (kind: InvoiceKind) => sum(mix.filter((r) => kindOf(r) === kind).map((r) => r.n));
  // Bölümler en kalabalıktan; aylar takvim sırasıyla kalsın diye sıra burada verilir (pencerede order="given")
  const kinds = (Object.keys(KINDS) as InvoiceKind[]).filter((k) => countOf(k) > 0).sort((a, b) => countOf(b) - countOf(a));
  const review = sum(mix.map((r) => r.review));
  return [
    ...kinds.map((kind): BreakdownGroup => {
      const xs = mix.filter((r) => kindOf(r) === kind);
      const months = [...new Set(xs.map((r) => r.month))].sort().reverse();
      return {
        key: kind,
        label: KINDS[kind].label,
        note: KINDS[kind].note,
        rows: months.map((m): BreakdownRow => {
          const inMonth = xs.filter((r) => r.month === m);
          const n = sum(inMonth.map((r) => r.n));
          const reviewed = sum(inMonth.map((r) => r.review));
          const withEInvoice = kind === "bill" ? sum(inMonth.filter((r) => r.eInvoice).map((r) => r.n)) : 0;
          const imported = kind === "matched" ? sum(inMonth.filter((r) => r.origin === "excel").map((r) => r.n)) : 0;
          return {
            key: `${kind}:${m}`,
            label: monthLabel(m),
            sub: parts([
              withEInvoice ? `${num(withEInvoice)} e-faturalı` : null,
              kind === "matched" && imported ? `${num(imported)} içe aktarılmış (eski)` : null,
              kind === "matched" && n - imported ? `${num(n - imported)} elle` : null,
              reviewed ? `${num(reviewed)} kontrol bekliyor` : null,
            ]),
            amount: n,
            href: invoicesHref({ ay: m }),
          };
        }),
      };
    }),
    {
      key: "kontrol",
      label: "Kontrol bekleyen",
      apart: true,
      note: "Kategorisini eşitlemenin tahmin ettiği faturalar (yukarıdakilerin içinde); onaylayınca ya da değiştirince düşer.",
      rows: [{ key: "kontrol", label: "Kategorisi tahmin edilen fatura", amount: review, tone: "warn", href: invoicesHref({ durum: "kontrol" }) }],
    },
  ];
}

// ---------------------------------------------------------------- Bağlı ürün

/** Dökümün kullandığı bağlantı alanları (sayfadaki `LinkRow` bunu karşılar) */
export interface LinkedProduct {
  productName: string;
  ingredientId: number;
  ingredientName: string;
}

/** Hammaddeye bağlı ürün adları: çok ürünlü hammaddede ilk beşi ve kalan sayısı */
function productNames(names: string[]): string {
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "tr"));
  return sorted.length > 6 ? `${sorted.slice(0, 5).join(", ")} ve ${num(sorted.length - 5)} ürün daha` : sorted.join(", ");
}

/**
 * Bağlı ürün kartı: bağlı Paraşüt ürünleri hammadde kategorisine göre, kategoride hammadde hammadde (o hammaddeye
 * bağlı ürün sayısı, adları alt satırda). Bağlanmayı bekleyen ve "hammadde değil" denen ürünler ayrı, toplama girmez.
 */
export function linkedBreakdown(links: LinkedProduct[], ingredients: { id: number; category: string }[], waiting: number, ignored: number): BreakdownGroup[] {
  const categoryOf = new Map(ingredients.map((i) => [i.id, i.category?.trim() || "Diğer"]));
  const byCategory = new Map<string, Map<number, { name: string; products: string[] }>>();
  for (const l of links) {
    const c = categoryOf.get(l.ingredientId) ?? "Diğer";
    const ings = byCategory.get(c) ?? new Map<number, { name: string; products: string[] }>();
    const x = ings.get(l.ingredientId) ?? { name: l.ingredientName, products: [] };
    x.products.push(l.productName);
    ings.set(l.ingredientId, x);
    byCategory.set(c, ings);
  }
  return [
    ...[...byCategory].map(
      ([c, ings]): BreakdownGroup => ({
        key: `kategori:${c}`,
        label: c,
        rows: [...ings].map(([id, x]) => ({
          key: `hammadde:${id}`,
          label: x.name,
          sub: productNames(x.products),
          amount: x.products.length,
          href: linksHref({ durum: "bagli", ara: x.name }),
        })),
      }),
    ),
    {
      key: "bagli-degil",
      label: "Bağlı olmayan ürünler",
      apart: true,
      rows: [
        {
          key: "bekleyen",
          label: "Bağlanmayı bekleyen",
          sub: "Mal alışı faturalarının kalemleri; hammadde seçilince bağlanır.",
          amount: waiting,
          tone: "warn",
          href: linksHref({ durum: "bekleyen" }),
        },
        { key: "hammadde-degil", label: "Hammadde değil denen", sub: "Kargo, hizmet, ekipman gibi kalemler; bekleyenlere girmez.", amount: ignored },
      ],
    },
  ];
}

// ---------------------------------------------------------------- Bağlantı

const SETTING_HELP: Record<(typeof REQUIRED_SETTINGS)[number], string> = {
  clientId: "DevHub'daki uygulamanın client_id'si",
  clientSecret: "DevHub'daki uygulamanın client_secret'ı; gösterilmez",
  companyId: "Paraşüt adresindeki sayı",
};

/** Ayarın nereden geldiği, dökümde */
const SOURCE: Record<"panel" | "env" | "none", Pick<BreakdownRow, "display" | "tone">> = {
  panel: { display: "Panelde", tone: "good" },
  env: { display: "Vercel'den", tone: "good" },
  none: { display: "Eksik", tone: "bad" },
};
const sourceRow = (source: SettingSource) => SOURCE[source ?? "none"];

/** "Bağlantı" kartının kısa durumu: kart ve dökümü aynı kurala bakar */
export function connectionHeadline(x: {
  configured: boolean;
  connected: boolean;
  stale: boolean;
  cronSet: boolean;
}): { value: string; tone: "good" | "warn" | "bad"; sub: string } {
  if (!x.configured) return { value: "Kurulmadı", tone: "warn", sub: "Bağlantı kartından ayarları girin" };
  if (x.connected) {
    return { value: x.stale ? "Yenilenmeli" : "Bağlı", tone: x.stale ? "warn" : "good", sub: `Her sabah 07:00–08:00${x.cronSet ? "" : " · CRON_SECRET eksik"}` };
  }
  return { value: "Bağlı değil", tone: "warn", sub: "“Paraşüt hesabını bağla” ile bir kez yetkilendirin" };
}

/**
 * Bağlantı kartı: bağlantı ayarları (panelde, Vercel'den ya da eksik; client_secret'ın değeri yok) ve eşitlemenin
 * zamanı: otomatik eşitleme, ilk eşitlemenin başlangıcı, son alınan fatura tarihi (imleç) ve son başarılı eşitleme.
 * Toplanamaz: bilgi satırları. CRON_SECRET yalnız eksikse "Otomatik eşitleme" satırında söylenir.
 */
export function connectionBreakdown(x: {
  configured: boolean;
  settings: Pick<ParasutSettingsView, "clientId" | "clientSecret" | "companyId" | "syncFrom">;
  cronSet: boolean;
  cursor: string | null;
  /** Paraşüt hesabı tarayıcıdan yetkilendirilmiş mi (refresh_token kayıtlı) */
  connected: boolean;
  /** refresh_token'ın son yenilenme anı (ISO) */
  refreshedAt: string | null;
  /** 30 günlük yenileme süresinin sonuna yaklaşıldı */
  stale: boolean;
  /** En son başarılı eşitleme (geçmişteki son 8 içinde) */
  lastOk: { startedAt: string; trigger: "cron" | "manual" | "history" } | null;
}): BreakdownGroup[] {
  const set = REQUIRED_SETTINGS.filter((k) => x.settings[k].source !== null).length;
  const syncFrom = x.settings.syncFrom;
  const auto: Pick<BreakdownRow, "display" | "tone" | "sub"> = !x.configured
    ? { display: "Kurulum bekliyor", tone: "warn", sub: "Bağlantı ayarları tamamlanınca her sabah çalışır." }
    : !x.connected
      ? { display: "Hesap bağlanmadı", tone: "warn", sub: "“Paraşüt hesabını bağla”ya basıp Paraşüt'te onay verin." }
      : !x.cronSet
        ? { display: "Kapalı", tone: "warn", sub: "CRON_SECRET eksik: yalnız “Şimdi eşitle” ile çalışır." }
        : { display: "Her sabah", tone: "good", sub: "07:00–08:00 arasında; gelen e-faturalar ve gider faturaları." };
  const account: Pick<BreakdownRow, "display" | "tone" | "sub"> = x.connected
    ? {
        display: x.stale ? "Yenilenmeli" : "Bağlı",
        tone: x.stale ? "warn" : "good",
        sub: x.stale
          ? "Yetki yenilenmeli: refresh_token 30 gün geçerli ve son yenileme eskidi."
          : x.refreshedAt
            ? `Son yenileme ${dateTimeTR(x.refreshedAt)}; her eşitlemede kendiliğinden yenilenir.`
            : "Bağlı.",
      }
    : { display: "Bağlı değil", tone: "bad", sub: "Bir kez tarayıcıdan yetkilendirin: “Paraşüt hesabını bağla” (Authorization Code + PKCE)." };
  return [
    {
      key: "ayarlar",
      label: "Bağlantı ayarları",
      note: "Bağlantı kartından girilir; panelde olmayan değer Vercel'deki ortam değişkeninden okunur.",
      display: `${num(set)} / ${num(REQUIRED_SETTINGS.length)}`,
      rows: REQUIRED_SETTINGS.map((k) => ({
        key: k,
        label: PARASUT_SETTINGS[k].label,
        sub: k === "companyId" && x.settings.companyId.value ? `${x.settings.companyId.value} · ${SETTING_HELP[k]}` : SETTING_HELP[k],
        amount: x.settings[k].source ? 1 : 0,
        ...sourceRow(x.settings[k].source),
      })),
    },
    {
      key: "esitleme",
      label: "Eşitleme",
      noSubtotal: true,
      rows: [
        { key: "hesap", label: "Paraşüt hesabı", amount: 0, ...account },
        { key: "otomatik", label: "Otomatik eşitleme", amount: 0, ...auto },
        {
          key: "baslangic",
          label: "İlk eşitlemenin başlangıcı",
          sub: syncFrom.value
            ? `${syncFrom.source === "panel" ? "Panelde kayıtlı" : "Vercel'den"}; yalnız ilk eşitlemede kullanılır.`
            : "Girilmedi: ilk eşitleme bu yılın başından alır.",
          amount: 0,
          display: syncFrom.value ? dateTR(syncFrom.value) : "Yıl başı",
        },
        {
          key: "imlec",
          label: "Son alınan fatura tarihi",
          sub: x.cursor ? "Sonraki eşitlemeler bu tarihten 75 gün geriye bakar." : "İlk eşitlemeden sonra yazılır.",
          amount: 0,
          display: x.cursor ? dateTR(x.cursor) : "Henüz yok",
        },
        {
          key: "son-basarili",
          label: "Son başarılı eşitleme",
          sub: x.lastOk ? (x.lastOk.trigger === "cron" ? "Otomatik" : "Elle") : "Son 8 eşitlemede başarılı olan yok.",
          amount: 0,
          display: x.lastOk ? dateTimeTR(x.lastOk.startedAt) : "Yok",
          tone: x.lastOk ? undefined : "warn",
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------- Son eşitleme

/** Eşitleme geçmişinden bir satır (sayfadaki `Run` bunu karşılar) */
export interface SyncRun {
  id: number;
  trigger: "cron" | "manual" | "history";
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
}

const STATUS: Record<SyncRun["status"], Pick<BreakdownRow, "display" | "tone">> = {
  ok: { display: "Başarılı", tone: "good" },
  error: { display: "Hata", tone: "bad" },
  running: { display: "Sürüyor", tone: "warn" },
};

/** Eşitlemenin süresi: "42 sn", "1 dk 5 sn"; bitmemişse ya da saat bozuksa yok */
export function runDuration(r: Pick<SyncRun, "startedAt" | "finishedAt">): string | null {
  if (!r.finishedAt) return null;
  const secs = Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  if (secs < 60) return `${num(secs)} sn`;
  const m = Math.floor(secs / 60);
  return secs % 60 ? `${num(m)} dk ${num(secs % 60)} sn` : `${num(m)} dk`;
}

/**
 * Son eşitleme kartı: geçmişteki son eşitlemeler (en yeni üstte; zaman, otomatik/elle, süre, sonuç ve özeti) ve
 * eşitlemenin bıraktığı durum: son alınan fatura, okunan e-fatura kalemleri, sıradaki e-faturalar.
 */
export function runsBreakdown(
  runs: SyncRun[],
  x: {
    lastSyncedAt: string | null;
    lineReads: { read: number; pending: number };
    pendingEInvoices: { count: number; ingested?: boolean } | null;
  },
): BreakdownGroup[] {
  const ok = runs.filter((r) => r.status === "ok").length;
  const failed = runs.filter((r) => r.status === "error").length;
  const lines = x.lineReads.read + x.lineReads.pending;
  const pending = x.pendingEInvoices?.count ? x.pendingEInvoices : null;
  return [
    {
      key: "gecmis",
      label: `Son ${num(runs.length)} eşitleme`,
      display: parts([ok ? `${num(ok)} başarılı` : null, failed ? `${num(failed)} hata` : null]) ?? "–",
      rows: runs.map((r) => ({
        key: `run:${r.id}`,
        label: parts([dateTimeTR(r.startedAt), r.trigger === "cron" ? "otomatik" : r.trigger === "history" ? "tedarikçi geçmişi" : "elle", runDuration(r)]) ?? "–",
        sub: clip(r.message) ?? (r.status === "running" ? "Sürüyor…" : undefined),
        amount: 0,
        ...STATUS[r.status],
      })),
    },
    {
      key: "durum",
      label: "Eşitlemenin bıraktığı",
      noSubtotal: true,
      rows: [
        ...(x.lastSyncedAt
          ? [{ key: "son-fatura", label: "Son fatura güncellemesi", sub: "Paraşüt'ten gelen bir faturanın en son yazıldığı an.", amount: 0, display: dateTimeTR(x.lastSyncedAt) }]
          : []),
        ...(lines
          ? [
              {
                key: "kalemler",
                label: "Kalemleri okunan e-fatura",
                sub: x.lineReads.pending ? `${num(x.lineReads.pending)} fatura sırada; her eşitleme kalan süre kadarını okur.` : "Hepsi okundu.",
                amount: 0,
                display: `${num(x.lineReads.read)} / ${num(lines)}`,
                tone: x.lineReads.pending ? ("warn" as const) : ("good" as const),
              },
            ]
          : []),
        ...(pending
          ? [
              pending.ingested
                ? {
                    key: "e-fatura",
                    label: "Doğrudan alınan e-fatura",
                    sub: "Paraşüt'te içeri alınmamış e-faturalar panele alındı.",
                    amount: 0,
                    display: num(pending.count),
                  }
                : {
                    key: "e-fatura",
                    label: "Sıradaki gelen e-fatura",
                    sub: "Paraşüt'te içeri alınmamış; bir sonraki eşitlemede panele alınır.",
                    amount: 0,
                    display: `~${num(pending.count)}`,
                    tone: "warn" as const,
                  },
            ]
          : []),
      ],
    },
  ];
}
