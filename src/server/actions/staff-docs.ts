"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { dateTR, tl } from "@/lib/format";
import { ADVANCE_KIND_LABEL } from "@/lib/staff-advances";
import { DOC_KINDS, docTitle, MAX_DOC_BYTES } from "@/lib/staff-docs";
import { todayTR } from "@/lib/reminders";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { addAdvance, deleteAdvance } from "@/server/staff-advances";
import { addStaffDoc, deleteStaffDoc, updateStaffDoc } from "@/server/staff-docs";

import { logActivity } from "./log";
import { attempt, UserError, zDate, zOptText } from "./util";

/*
 * Personel belgeleri ve avansları (yalnız yönetici; docs/PERSONEL-BELGE.md). Kurallar çekirdeklerde
 * (src/server/staff-docs.ts, src/server/staff-advances.ts) ve saf modüllerde; burada yetki, girdi şeması, işlem geçmişi
 * ve ekranın yenilenmesi. Dosya FormData ile gelir (next.config serverActions.bodySizeLimit 4,5 MB; belge en çok 4 MB).
 */

const zOptDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .pipe(zDate.nullable());

const docSchema = z.object({
  kind: z.enum(DOC_KINDS as [string, ...string[]], { message: "Belge türü seçin" }),
  label: zOptText(80),
  issuedOn: zOptDate,
  validUntil: zOptDate,
  note: zOptText(300),
});

const formText = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : null;
};

/** Belge ekler (form: kisi, tur, ad, duzenlenme, bitis, not, isteğe bağlı dosya) */
export async function addStaffDocument(form: FormData) {
  return attempt(async () => {
    const me = await requireAdmin();
    const staffId = z.coerce.number({ message: "Kişi seçin" }).int().positive("Kişi seçin").parse(formText(form, "kisi"));
    const data = docSchema.parse({
      kind: formText(form, "tur"),
      label: formText(form, "ad"),
      issuedOn: formText(form, "duzenlenme"),
      validUntil: formText(form, "bitis"),
      note: formText(form, "not"),
    });
    const raw = form.get("dosya");
    let file: { bytes: Uint8Array; name: string | null } | null = null;
    if (raw instanceof File && raw.size > 0) {
      if (raw.size > MAX_DOC_BYTES) throw new UserError("Dosya 4 MB'tan büyük; fotoğrafı küçültüp yeniden deneyin.");
      file = { bytes: new Uint8Array(await raw.arrayBuffer()), name: raw.name || null };
    }
    const saved = await addStaffDoc(getDb(), me, { staffId, ...data }, file);
    await logActivity(me, "Personel belgesi eklendi", `${saved.staffName} · ${docTitle(data)}${data.validUntil ? ` · bitiş ${dateTR(data.validUntil)}` : ""}${file ? " · dosyalı" : ""}`);
    refresh();
    return { id: saved.id };
  });
}

/** Belgenin türünü, adını, tarihlerini ve notunu düzeltir */
export async function updateStaffDocument(id: number, input: z.input<typeof docSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const docId = z.number().int().positive().parse(id);
    const data = docSchema.parse(input);
    const saved = await updateStaffDoc(getDb(), docId, data);
    await logActivity(me, "Personel belgesi düzeltildi", `${saved.staffName} · ${docTitle(data)}${data.validUntil ? ` · bitiş ${dateTR(data.validUntil)}` : " · süresiz"}`);
    refresh();
    return null;
  });
}

/** Belgeyi ve dosyasını siler (geri alınmaz; ekran onay sorar) */
export async function deleteStaffDocument(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const gone = await deleteStaffDoc(getDb(), z.number().int().positive().parse(id));
    await logActivity(me, "Personel belgesi silindi", `${gone.staffName} · ${docTitle(gone)}`);
    refresh();
    return null;
  });
}

const advanceSchema = z.object({
  staffId: z.number({ message: "Kişi seçin" }).int().positive("Kişi seçin"),
  kind: z.enum(["avans", "kesinti"], { message: "Hareket türü seçin" }),
  amount: z.number({ message: "Tutar girin" }).finite("Geçersiz tutar"),
  date: zDate,
  note: zOptText(200),
});

/** Avans ya da maaştan kesinti yazar; kalan bakiye döner */
export async function addStaffAdvance(input: z.input<typeof advanceSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = advanceSchema.parse(input);
    const saved = await addAdvance(getDb(), me, data, todayTR());
    await logActivity(me, data.kind === "avans" ? "Personel avansı verildi" : "Avans maaştan düşüldü", `${saved.staffName} · ${dateTR(data.date)} · ${tl(data.amount, 2)} · kalan ${tl(saved.balance, 2)}`);
    refresh();
    return { id: saved.id, balance: saved.balance };
  });
}

/** Avans hareketini siler (kesintisi yazılmış avans silinmez) */
export async function deleteStaffAdvance(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const gone = await deleteAdvance(getDb(), z.number().int().positive().parse(id));
    await logActivity(me, "Avans hareketi silindi", `${gone.staffName} · ${ADVANCE_KIND_LABEL[gone.kind]} · ${dateTR(gone.date)} · ${tl(gone.amount, 2)}`);
    refresh();
    return null;
  });
}
