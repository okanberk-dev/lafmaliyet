/**
 * Geç girilen gider faturalarının kimlik taraması (sync.ts catchLateBills). Saf; tests/parasut-gec-fatura.test.ts.
 *
 * Tarihi 75 günlük pencereden eski ama Paraşüt'e yeni girilmiş fatura (kâğıt fatura) tarihe göre okunan günlük
 * listede görünmez; kimliği ise büyüktür (Paraşüt kimlikleri artarak verir). Liste kimliğe göre azalan (`sort=-id`)
 * okunur, önceki taramanın en büyük kimliğine (`id`) inilince tarama biter, bu taramanın en büyüğü (`top`) yeni sınır
 * olur.
 *
 * Bir çalışma en çok birkaç sayfa okur. Tarama bitmezse kaldığı yer saklanır (`scan`), sonraki çalışma oradan sürer.
 * Eskiden her çalışma ilk sayfadan başlıyordu: iki tam eşitleme arasında 100'den fazla fatura girilince (ay sonu toplu
 * giriş, haftalarca duran eşitleme) sınıra hiç inilmiyor, aradaki eski tarihli fatura hiç alınmıyordu.
 *
 * Çalışmalar arasında sayfalar kayar. Yeni fatura girilince kayıtlar aşağı iner: aynı faturalar yeniden okunur,
 * işlenmiş kimlikler atlanır (zararsız). Fatura silinince yukarı çıkar: işlenmemiş bir fatura önceki sayfaya geçebilir.
 * Bu yüzden sürdürme en son işlenen sayfayı yeniden okur; o sayfanın ilk kimliği işlenmiş en küçük kimlikten (`edge`)
 * küçükse (ya da sayfa boşsa) bir önceki sayfaya dönülür.
 */

/**
 * Yazılamayıp ertelenen fatura (yeniden içeri alınmış e-faturanın eski gider faturası Paraşüt'e sorulamadı) taramayı
 * durdurur, sonraki çalışma o faturadan sürer. Art arda bu kadar çalışmada ertelenirse geçilir: e-faturası paneldeki
 * başka bir kayıtta durduğu için gider kaybolmaz, tarama da takılı kalmaz.
 */
export const LATE_HOLD_RUNS = 3;

export interface LateScan {
  /** Taramanın başındaki en büyük kimlik: tarama bitince sınır olur; bundan büyükler sonraki taramanın */
  top: number;
  /** Sonraki çalışmanın ilk okuyacağı sayfa (en son işlenen sayfa: yeniden okunur) */
  page: number;
  /** Bu taramada işlenmiş en küçük kimlik (`edge`…`top` işlendi; hiçbiri işlenmediyse `top + 1`) */
  edge: number;
  /** Taramayı durduran ertelenmiş fatura ve art arda kaç çalışmada ertelendiği */
  held?: { id: number; runs: number };
}

export interface LateCursor {
  /** Bu kimlik ve altındaki bütün faturalar görüldü */
  id: number;
  /** Birden çok çalışmaya yayılan, bitmemiş tarama */
  scan?: LateScan;
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Saklanan imleç; bozuk tarama düşer (tarama ilk sayfadan yeniden başlar), eski biçim (`{ id, at }`) aynen okunur */
export function parseLateCursor(raw: unknown): LateCursor | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!count(r.id)) return null;
  const s = r.scan && typeof r.scan === "object" ? (r.scan as Record<string, unknown>) : null;
  if (!s || !count(s.top) || !count(s.page) || !count(s.edge) || s.page < 1 || s.top < r.id || s.edge <= r.id || s.edge > s.top + 1) return { id: r.id };
  const h = s.held && typeof s.held === "object" ? (s.held as Record<string, unknown>) : null;
  const held = h && count(h.id) && count(h.runs) && h.runs >= 1 ? { id: h.id, runs: h.runs } : null;
  return { id: r.id, scan: { top: s.top, page: s.page, edge: s.edge, ...(held ? { held } : {}) } };
}

/** Kimliğe göre azalan listenin bir sayfası: geçerli kimlikli faturalar (sayfadaki sırayla) ve toplam sayfa */
export interface LatePage<B> {
  bills: { n: number; bill: B }[];
  totalPages?: number;
}

export interface LateRun {
  /** Saklanacak imleç; null: değişmedi */
  save: LateCursor | null;
  /** Tarama bitti (sınıra ya da listenin sonuna inildi, ertelenen fatura yok) */
  complete: boolean;
  /** Art arda ertelendiği için geçilen faturaların kimlikleri */
  passed: number[];
}

/**
 * Taramanın bir çalışması: sayfaları okur (`read`; null dönerse süre doldu, okunanlarla devam edilir), işlenecek
 * faturaları sırayla yazar (`apply`; "deferred" dönerse fatura bu çalışmada yazılamadı) ve saklanacak imleci verir.
 * İmleç yoksa (ilk çalışma) yalnız en büyük kimlik kaydedilir; daha önce kaçanlar "Tarihten eşitle" ile alınır.
 */
export async function runLateScan<B>(
  cursor: LateCursor | null,
  io: {
    read: (page: number) => Promise<LatePage<B> | null>;
    /** Okunan faturalar yazılmadan önce (tedarikçi adları, "listede görüldü") */
    prepare?: (bills: B[]) => Promise<void>;
    apply: (bill: B) => Promise<"deferred" | void>;
  },
  o: { pages: number; until: number },
): Promise<LateRun> {
  if (!cursor) {
    const first = await io.read(1);
    const top = first?.bills.reduce((a, b) => Math.max(a, b.n), 0) ?? 0;
    return { save: top ? { id: top } : null, complete: Boolean(first), passed: [] };
  }
  const last = cursor.id;
  const scan = cursor.scan;
  const fresh = !scan;
  let top = scan?.top ?? last;
  const edge0 = scan?.edge ?? Number.POSITIVE_INFINITY;
  let page = scan?.page ?? 1;
  let resume = page;
  // Taze tarama ilk sayfadan başlar, araya kayma giremez; sürdürmede önce yerin tuttuğu doğrulanır
  let anchored = fresh;
  let complete = false;
  const found: { bill: B; n: number; page: number }[] = [];
  for (let reads = 0; reads < o.pages; reads++) {
    if (reads > 0 && Date.now() > o.until) break;
    const res = await io.read(page);
    if (!res) {
      // Süre doldu: hiç sayfa okunamadıysa imleç olduğu gibi kalır
      if (reads === 0) return { save: null, complete: false, passed: [] };
      break;
    }
    if (!anchored && page > 1 && (!res.bills.length || res.bills[0].n < edge0)) {
      // Sayfa boş ya da ilk kimliği işlenmiş en küçük kimlikten küçük: silmeler sayfaları yukarı kaydırmış, işlenmemiş
      // faturalar önceki sayfada olabilir. Liste çok kısaldıysa doğrudan son sayfaya dönülür
      page = !res.bills.length && res.totalPages !== undefined && res.totalPages < page ? Math.max(1, res.totalPages) : page - 1;
      resume = page;
      continue;
    }
    anchored = true;
    resume = page;
    let reached = false;
    for (const { n, bill } of res.bills) {
      if (n <= last) {
        reached = true;
        break;
      }
      if (fresh) top = Math.max(top, n);
      // Bu taramada işlendi (`edge`…`top`) ya da tarama başladıktan sonra girildi (`top`tan büyük: sonraki taramanın)
      if (n >= edge0) continue;
      found.push({ bill, n, page });
    }
    if (reached || !res.bills.length || (res.totalPages !== undefined && page >= res.totalPages)) {
      complete = true;
      break;
    }
    page++;
  }

  await io.prepare?.(found.map((f) => f.bill));
  let edge = edge0;
  let held: LateScan["held"];
  const passed: number[] = [];
  for (const f of found) {
    if ((await io.apply(f.bill)) === "deferred") {
      const runs = (scan?.held?.id === f.n ? scan.held.runs : 0) + 1;
      if (runs < LATE_HOLD_RUNS) {
        held = { id: f.n, runs };
        resume = f.page;
        complete = false;
        break;
      }
      passed.push(f.n);
    }
    edge = f.n;
  }
  if (complete) return { save: top > last || scan ? { id: top } : null, complete, passed };
  return { save: { id: last, scan: { top, page: resume, edge: Math.min(edge, top + 1), ...(held ? { held } : {}) } }, complete, passed };
}
