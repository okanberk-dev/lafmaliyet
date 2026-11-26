/*
 * Panel asistanının işlemleri: onay kartının biçimi ve durumları (saf; tarayıcı ve sunucu ortak kullanır;
 * tests/asistan-islemleri.test.ts; docs/ASISTAN-ISLEMLER.md). Kartın içeriğini model değil sunucu yazar (önizleme
 * okumasından); modelin açıklaması kartta ayrı, "Asistanın notu" diye durur.
 *
 * Akış: model bir işlem aracını çağırır → sunucu salt okuyarak önizler, planı `assistant_ops`'a yazar ve kartı sohbete
 * koyar (hiçbir şey değişmez) → kullanıcı Onayla'ya basar → sunucu eylemi (`confirmAssistantOp`) planı tek kullanımlık
 * tüketir, girdiyi yeniden ayrıştırır, önceki değeri yeniden okur, asıl eylemi çağırır.
 */

/** Kartın geçerlilik süresi: bundan sonra Onayla hiçbir şey yazmaz ("süresi doldu") */
export const OP_TTL_MS = 10 * 60_000;
/** Sonuç kartındaki "Geri al" bu kadar süre durur (katalogda geri alması tanımlı işlemlerde) */
export const OP_UNDO_MS = 60 * 60_000;

/** Dış etki rozetleri: işlem panelin dışında neyi değiştirir */
export const OP_EFFECTS = {
  site: "Site / QR menü",
  lafpos: "LafPOS",
  modpos: "ModPOS kasası",
  eposta: "E-posta",
  kasa: "Kasa raporu",
  gelirGider: "Gelir-gider",
  nakit: "Nakit planı",
  maliyet: "Ürün maliyetleri",
  stok: "Stok / alınan miktar",
  personel: "Personelin vardiyası",
} as const;

export type OpEffect = keyof typeof OP_EFFECTS;

/** Kartın bir satırı: alan, önceki değer (yeni kayıtta yok) ve yeni değer. `danger`: kırmızı (ör. boşaltılacak hücre) */
export interface OpCardLine {
  label: string;
  from?: string | null;
  to: string;
  danger?: boolean;
}

/** Onay kartı (sunucu yazar) */
export interface OpCard {
  /** Planın kimliği (assistant_ops.id) */
  id: string;
  /** Araç (src/lib/assistant/op-specs.ts) */
  tool: string;
  /** Ne yapılacak, tek cümle */
  title: string;
  /** Kişi, tedarikçi, ürün ya da hammadde */
  subject: string;
  /** Şube ("Tuzla", "İşletme geneli", "Bütün şubeler (menü ortak)") */
  branch: string;
  /** Tarih ya da gün ("24 Kasım 2026 Salı") */
  day: string;
  /** Eski → yeni, alan alan */
  lines: OpCardLine[];
  effects: OpEffect[];
  /** Geri alma yolu (metin): kartın Geri al'ı ya da ekrandaki yol */
  undo: string;
  /** Sonuç kartında Geri al düğmesi olacak mı */
  undoable: boolean;
  /** Dikkat edilecekler (sunucunun) */
  warnings: string[];
  /** Asistanın notu (modelin açıklaması; sunucunun yazdıklarından ayrı) */
  note: string | null;
  /** Son geçerlilik (ISO) */
  expiresAt: string;
  /** Sohbete eklenen fiş fotoğrafı (kartta küçük resmi; onaylanınca kayda bağlanır; docs/ASISTAN-ISLEMLER.md › Fiş fotoğrafı) */
  photoId?: number | null;
}

/** Planın durumu (assistant_ops.status) */
export type OpStatus = "pending" | "running" | "done" | "failed" | "unknown" | "cancelled" | "expired" | "undoing" | "undone";

/**
 * Onay, vazgeç ve geri al eylemlerinin yanıtı. `refused`: hiçbir şey yapılmadı ve plan değişmedi (başkasının kartı,
 * zaten kullanılmış, yetki yok). Plan zaten işlenmişse (ikinci dokunuş, ağ hatasından sonra yeniden deneme, başka
 * sekme) sunucunun bildiği gerçek durumu `current`'ta döner: kart onu gösterir (iletiyi aramaz).
 */
export interface OpOutcome {
  status: OpStatus | "refused";
  message: string;
  /** Geri al bu ana kadar (ISO); geri alınamıyorsa null */
  undoUntil: string | null;
  /** Yalnız `refused`'ta, plan bulunduysa: planın şimdiki durumu ve (yapılmışsa) geri al süresi */
  current?: { status: OpStatus; undoUntil: string | null };
}

/** Tarayıcıdaki kart: kart + son durum */
export interface OpCardState {
  card: OpCard;
  status: OpStatus;
  message?: string;
  undoUntil?: string | null;
  /** Sekmeden geri yüklenen ve işlem sürerken kalan kart: durumu sunucudan yeniden okunacak */
  recheck?: boolean;
}

export const OP_STATUS_LABEL: Record<OpStatus, string> = {
  pending: "onay bekliyor",
  running: "işleniyor",
  done: "yapıldı",
  failed: "yapılamadı",
  unknown: "sonucu belirsiz",
  cancelled: "vazgeçildi",
  expired: "süresi doldu",
  undoing: "geri alınıyor",
  undone: "geri alındı",
};

/** Bitmiş durum: kart artık Onayla / Vazgeç göstermez */
export const isSettled = (s: OpStatus) => s !== "pending" && s !== "running" && s !== "undoing";

/** Kart süresi doldu mu (tarayıcı düğmeleri kapatır; sunucu ayrıca denetler) */
export const cardExpired = (card: Pick<OpCard, "expiresAt">, now: number = Date.now()) => Date.parse(card.expiresAt) <= now;

/**
 * Sonraki sorunun geçmişine giden kısa satır: asistan bir sonraki turda kartın ne olduğunu bilsin ("Onay kartı:
 * Latte M fiyatı 85 ₺ → 90 ₺ — yapıldı"). Kartın satırları gitmez; başlık sunucunun yazdığıdır.
 */
export function cardHistoryLine(s: Pick<OpCardState, "card" | "status" | "message">): string {
  const tail = s.status === "failed" && s.message ? ` (${s.message.slice(0, 160)})` : "";
  return `[Onay kartı: ${s.card.title} — ${OP_STATUS_LABEL[s.status]}${tail}]`;
}

/** Kartın satırının metni: "85 ₺ → 90 ₺" ya da yeni kayıtta yalnız "90 ₺" */
export function lineText(l: OpCardLine): string {
  return l.from === undefined || l.from === null ? l.to : `${l.from} → ${l.to}`;
}

/** Tarayıcıdan gelen kart geçerli biçimde mi (sessionStorage elle bozulmuş olabilir) */
export function isOpCard(v: unknown): v is OpCard {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.tool === "string" &&
    typeof c.title === "string" &&
    typeof c.expiresAt === "string" &&
    Array.isArray(c.lines) &&
    Array.isArray(c.effects) &&
    Array.isArray(c.warnings) &&
    typeof c.undo === "string"
  );
}

const STATUSES = new Set<string>(Object.keys(OP_STATUS_LABEL));
export const isOpStatus = (v: unknown): v is OpStatus => typeof v === "string" && STATUSES.has(v);
