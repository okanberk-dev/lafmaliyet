import type { z } from "zod";

import type { BranchRow, BranchScope } from "@/lib/branches";
import type { OpCard } from "@/lib/assistant/ops";
import type { OpInput, OpName } from "@/lib/assistant/op-specs";

/*
 * İşlem uyarlayıcılarının sözleşmesi (docs/ASISTAN-ISLEMLER.md). Her işlemin iki yarısı ayrı dosyadadır:
 * - önizleme (src/server/assistant-ops/preview.ts): salt okur, kartı yazar, sunucunun çözdüğü bağımsız değişkenleri ve
 *   önceki değerleri verir; onayda bayatlığı aynı okumayla denetler. Sohbet ucu yalnız bunu çağırır.
 * - uygulama (src/server/assistant-ops/apply.ts): mevcut eylemi aynı doğrulama ve yetkiyle düz işlev gibi çağırır;
 *   yalnız kartın Onayla düğmesinin sunucu eyleminden (src/server/actions/assistant-ops.ts) çalışır.
 */

/** Önizlemenin bağlamı: kim, panelde hangi şube seçili, şubeler, saat */
export interface PreviewCtx {
  userId: number;
  scope: BranchScope;
  branches: BranchRow[];
  now: Date;
}

/** Kartın sunucunun yazdığı kısmı (kimlik, süre, araç ve asistanın notu sonra eklenir) */
export type CardBody = Omit<OpCard, "id" | "expiresAt" | "note" | "tool">;

export interface Plan<A, B> {
  card: CardBody;
  /** Sunucunun çözdüğü bağımsız değişkenler (kimlikler); onayda kendi şemasıyla yeniden ayrıştırılır */
  args: A;
  /** Önizlemede okunan önceki değerler: onayda yeniden okunup karşılaştırılır */
  before: B;
  /** Yazımın şube kapsamı (withBranchScope); şubesiz işte null */
  branch: BranchScope | null;
}

export interface OpPreview<N extends OpName, A, B> {
  args: z.ZodType<A>;
  before: z.ZodType<B>;
  preview(input: OpInput<N>, ctx: PreviewCtx): Promise<Plan<A, B>>;
  /** Şimdiki değer önizlemedekinden farklıysa kullanıcıya gösterilecek metin; aynıysa null */
  stale(args: A, before: B): Promise<string | null>;
}

export type ApplyResult = { ok: true; message: string; undo: unknown } | { ok: false; error: string };
export type UndoResult = { ok: true; message: string } | { ok: false; error: string };

/** Uygulamanın bağlamı: planın kimliği ve onaylayan yönetici (işlem geçmişine kendi satırını yazan uyarlayıcı için) */
export interface ApplyCtx {
  opId: string;
  me: { id: number; name: string };
}

export interface OpApplier<A, B> {
  apply(args: A, before: B, ctx: ApplyCtx): Promise<ApplyResult>;
  /** Katalogda geri alması tanımlıysa: sonuç kartının Geri al'ı */
  undo?(args: A, before: B, undo: unknown, ctx: ApplyCtx): Promise<UndoResult>;
}
