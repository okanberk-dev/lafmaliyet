import "server-only";

import { asc } from "drizzle-orm";

import { groupSuppliers, supplierHref } from "@/app/panel/tedarikciler/logic";
import { SIZE_LABELS } from "@/lib/constants";
import { getDb, schema as s } from "@/server/db";

import { loadSupplierCards, loadSupplierRefs } from "./suppliers";

export interface SearchEntry {
  kind: "product" | "ingredient" | "supplier";
  label: string;
  hint: string;
  href: string;
}

/** Komut paletinin (⌘K) ürün, hammadde ve tedarikçi listesi: yalnızca adlar (ve unvan, vergi no), tutar yok */
export async function loadSearchIndex(): Promise<SearchEntry[]> {
  const db = getDb();
  const [products, ingredients, cards, supplierRefs] = await Promise.all([
    db
      .select({ id: s.products.id, name: s.products.name, size: s.products.size, active: s.products.active })
      .from(s.products)
      .orderBy(asc(s.products.sortOrder), asc(s.products.id)),
    db.select({ name: s.ingredients.name, category: s.ingredients.category }).from(s.ingredients).orderBy(asc(s.ingredients.sortOrder)),
    loadSupplierCards(),
    loadSupplierRefs(),
  ]);
  // Tedarikçiler ekranındaki gibi: kartlar ve faturalardaki (ad, vergi no) çiftleri (adres parçası aynı atamayla);
  // tarih ve tutar gerekmez
  const suppliers = groupSuppliers(
    supplierRefs.map((r) => ({ ...r, date: r.date ?? "", payable: 0, unpaid: false })),
    cards,
    { today: "", termDays: 0 },
  );
  return [
    ...products.map((p) => ({
      kind: "product" as const,
      label: p.size === "Tek" ? p.name : `${p.name} · ${SIZE_LABELS[p.size as keyof typeof SIZE_LABELS] ?? p.size}`,
      hint: p.active ? "Ürün" : "Ürün · pasif",
      href: `/panel/urunler/${p.id}`,
    })),
    ...ingredients.map((i) => ({
      kind: "ingredient" as const,
      label: i.name,
      hint: i.category ? `Hammadde · ${i.category}` : "Hammadde",
      href: `/panel/hammaddeler?ara=${encodeURIComponent(i.name)}`,
    })),
    // Alt satırda unvan ve vergi no (kartta ve faturalarda) da aranır ("SÜTAŞ SÜT", "1234567890")
    ...suppliers.map((g) => ({
      kind: "supplier" as const,
      label: g.name,
      hint: ["Tedarikçi", g.card?.legalName, ...new Set([g.card?.taxNumber, ...g.taxNumbers.map((t) => t.taxNumber)].filter(Boolean)), ...g.names.filter((n) => n !== g.name)]
        .filter(Boolean)
        .join(" · "),
      href: supplierHref(g.slug),
    })),
  ];
}
