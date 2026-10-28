"use client";

import { Plus } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { useQueryState } from "@/components/ui/filters";

/**
 * Yöneticinin Reçete defterindeki "Yeni ürün"ü: Ürünler › Yeni ürün penceresini açık getirir (`?yeni=1`; denetim E-48).
 * Defterde bir kategori çipi seçiliyse (`?kategori=<id>`) o kategori pencerede seçili gelir (personelin "Yeni ürün
 * öner"i gibi); Ürünler listesi de o kategoriyle açılır.
 */
export function NewProductLink() {
  const [cat] = useQueryState<string>("kategori", "");
  const href = `/panel/urunler?yeni=1${/^\d+$/.test(cat) ? `&kategori=${cat}` : ""}`;
  return (
    <ButtonLink href={href} variant="secondary">
      <Plus size={16} aria-hidden="true" /> Yeni ürün
    </ButtonLink>
  );
}
