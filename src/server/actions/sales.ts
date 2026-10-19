"use server";

import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { normalizePosName } from "@/lib/calc/engine";
import { parseNumberTR } from "@/lib/calc/expr";
import { monthLabel, num, tl } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { getDb, schema as s } from "@/server/db";

import { logActivity } from "./log";
import { attempt, UserError, zMonth, zOptText, zText } from "./util";

async function ensureMonth(month: string) {
  await getDb().insert(s.months).values({ month }).onConflictDoNothing();
}

const monthInfoSchema = z.object({
  month: zMonth,
  openDays: z.number().int().min(0).max(31).nullable(),
  posRevenue: z.number().finite().min(0).nullable(),
  discounts: z.number().finite().min(0),
  offRevenue: z.number().finite().min(0),
  note: zOptText(1000),
});

export async function saveMonthInfo(input: z.input<typeof monthInfoSchema>) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = monthInfoSchema.parse(input);
    await getDb()
      .insert(s.months)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: s.months.month,
        set: {
          openDays: data.openDays,
          posRevenue: data.posRevenue,
          discounts: data.discounts,
          offRevenue: data.offRevenue,
          note: data.note,
          updatedAt: new Date(),
        },
      });
    await logActivity(me, "Ay bilgisi", `${monthLabel(data.month)}: ciro ${tl(data.posRevenue)}, ${data.openDays ?? "–"} gün`);
    refresh();
    return null;
  });
}

const lineSchema = z.object({
  posName: zText("Ürün adı", 160),
  qty: z.number().finite(),
  revenue: z.number().finite(),
});

export async function importSales(input: { month: string; lines: z.input<typeof lineSchema>[]; mode: "replace" | "append" }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const month = zMonth.parse(input.month);
    const lines = z.array(lineSchema).min(1, "Satır bulunamadı").max(2000).parse(input.lines);
    const db = getDb();
    const mappings = await db.select().from(s.posMappings);
    const map = new Map(mappings.map((m) => [m.posName, m]));
    let matched = 0;
    await ensureMonth(month);
    await db.transaction(async (tx) => {
      if (input.mode === "replace") await tx.delete(s.salesLines).where(eq(s.salesLines.month, month));
      const [{ m }] = await tx.select({ m: max(s.salesLines.sortOrder) }).from(s.salesLines).where(eq(s.salesLines.month, month));
      const base = input.mode === "replace" ? 0 : (m ?? 0);
      await tx.insert(s.salesLines).values(
        lines.map((l, i) => {
          const mp = map.get(normalizePosName(l.posName));
          if (mp && (mp.productId || mp.isService)) matched++;
          return {
            month,
            posName: l.posName.trim(),
            qty: l.qty,
            revenue: l.revenue,
            productId: mp?.productId ?? null,
            isService: mp?.isService ?? false,
            sortOrder: base + i + 1,
          };
        }),
      );
    });
    await logActivity(me, "Satış raporu yüklendi", `${monthLabel(month)}: ${lines.length} satır, ${matched} eşleşti`);
    refresh();
    return { count: lines.length, matched };
  });
}

/** Satırı bir ürünle (ya da HİZMET ile) eşleştirir ve POS adını hatırlar. */
export async function setLineMatch(lineId: number, productId: number | null, isService: boolean, applyToSameName = true) {
  return attempt(async () => {
    const me = await requireAdmin();
    const db = getDb();
    const [line] = await db.select().from(s.salesLines).where(eq(s.salesLines.id, lineId));
    if (!line) throw new UserError("Satır bulunamadı");
    const key = normalizePosName(line.posName);
    await db.transaction(async (tx) => {
      await tx.update(s.salesLines).set({ productId, isService }).where(eq(s.salesLines.id, lineId));
      if (applyToSameName) {
        // Aynı ay içinde aynı isimli diğer eşleşmemiş satırlar
        const others = await tx
          .select({ id: s.salesLines.id, posName: s.salesLines.posName })
          .from(s.salesLines)
          .where(and(eq(s.salesLines.month, line.month), isNull(s.salesLines.productId)));
        const ids = others.filter((o) => o.id !== lineId && normalizePosName(o.posName) === key).map((o) => o.id);
        if (ids.length) await tx.update(s.salesLines).set({ productId, isService }).where(inArray(s.salesLines.id, ids));
      }
      if (productId || isService) {
        await tx
          .insert(s.posMappings)
          .values({ posName: key, productId, isService, updatedAt: new Date() })
          .onConflictDoUpdate({ target: s.posMappings.posName, set: { productId, isService, updatedAt: new Date() } });
      } else {
        await tx.delete(s.posMappings).where(eq(s.posMappings.posName, key));
      }
    });
    await logActivity(me, "POS eşleştirmesi", `${line.posName} → ${isService ? "HİZMET" : productId ? `ürün #${productId}` : "eşleşmedi"}`);
    refresh();
    return null;
  });
}

export async function saveLine(input: { id: number | null; month: string; posName: string; qty: number; revenue: number; note?: string | null }) {
  return attempt(async () => {
    const me = await requireAdmin();
    const data = lineSchema.parse(input);
    const month = zMonth.parse(input.month);
    const note = zOptText(300).parse(input.note);
    const db = getDb();
    if (input.id) {
      await db.update(s.salesLines).set({ ...data, note }).where(eq(s.salesLines.id, input.id));
    } else {
      await ensureMonth(month);
      const [mp] = await db.select().from(s.posMappings).where(eq(s.posMappings.posName, normalizePosName(data.posName)));
      const [{ m }] = await db.select({ m: max(s.salesLines.sortOrder) }).from(s.salesLines).where(eq(s.salesLines.month, month));
      await db.insert(s.salesLines).values({
        month,
        ...data,
        note,
        productId: mp?.productId ?? null,
        isService: mp?.isService ?? false,
        sortOrder: (m ?? 0) + 1,
      });
    }
    await logActivity(me, input.id ? "Satış satırı düzenlendi" : "Satış satırı eklendi", `${data.posName}: ${num(data.qty)} adet, ${tl(data.revenue)}`);
    refresh();
    return null;
  });
}

export async function deleteLine(id: number) {
  return attempt(async () => {
    const me = await requireAdmin();
    const [l] = await getDb().delete(s.salesLines).where(eq(s.salesLines.id, id)).returning();
    if (l) await logActivity(me, "Satış satırı silindi", `${l.posName} (${monthLabel(l.month)})`);
    refresh();
    return null;
  });
}

export async function clearMonthSales(month: string) {
  return attempt(async () => {
    const me = await requireAdmin();
    const m = zMonth.parse(month);
    await getDb().delete(s.salesLines).where(eq(s.salesLines.month, m));
    await logActivity(me, "Ay satışları silindi", monthLabel(m));
    refresh();
    return null;
  });
}

/** Yüklenen .xlsx / .csv dosyasından (ürün adı, adet, ciro) satırlarını çıkarır; önizleme için döner. */
export async function parseSalesFile(formData: FormData) {
  return attempt(async () => {
    await requireAdmin();
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("Dosya seçin");
    if (file.size > 5 * 1024 * 1024) throw new UserError("Dosya 5 MB'tan büyük olamaz");
    const name = file.name.toLowerCase();
    let table: unknown[][] = [];
    if (name.endsWith(".xlsx")) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (!ws) throw new UserError("Dosyada sayfa yok");
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => {
          if (v && typeof v === "object") {
            const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
            if (o.result !== undefined) return o.result;
            if (o.richText) return o.richText.map((r) => r.text).join("");
            if (o.text !== undefined) return o.text;
          }
          return v;
        });
        table.push(vals);
      });
    } else if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
      const text = await file.text();
      const sep = text.includes("\t") ? "\t" : text.split("\n")[0].includes(";") ? ";" : ",";
      table = text.split(/\r?\n/).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
    } else {
      throw new UserError("Desteklenen dosyalar: .xlsx, .csv");
    }
    return extractRows(table);
  });
}

function extractRows(table: unknown[][]) {
  const rows: { posName: string; qty: number; revenue: number }[] = [];
  for (const r of table) {
    const cells = r.map((c) => (c === null || c === undefined ? "" : c));
    const nameIdx = cells.findIndex((c) => typeof c === "string" && c.trim() && parseNumberTR(c) === null);
    if (nameIdx < 0) continue;
    const nums = cells
      .slice(nameIdx + 1)
      .map((c) => (typeof c === "number" ? c : parseNumberTR(String(c))))
      .filter((v): v is number => v !== null);
    if (nums.length < 2) continue;
    const posName = String(cells[nameIdx]).trim();
    if (/^(toplam|genel toplam|ürün|urun|ürün adı)$/i.test(posName)) continue;
    rows.push({ posName, qty: nums[0], revenue: nums[1] });
  }
  if (!rows.length) throw new UserError("Dosyada 'ürün adı, adet, ciro' sütunları bulunamadı");
  return rows;
}
