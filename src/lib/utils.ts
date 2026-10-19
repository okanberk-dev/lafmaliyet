import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Türkçe karakter duyarlı arama eşleşmesi */
export function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  const norm = (x: string) => x.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return norm(text).includes(norm(query));
}
