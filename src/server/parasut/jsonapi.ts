/**
 * Paraşüt API v4 JSON:API yanıt tipleri ve "included" çözümleme yardımcıları (saf; testlerde de kullanılır).
 */

export interface ResourceIdentifier {
  id: string;
  type: string;
}

export interface Resource<A = Record<string, unknown>> extends ResourceIdentifier {
  attributes: A;
  relationships?: Record<string, { data?: ResourceIdentifier | ResourceIdentifier[] | null }>;
}

export interface ListResponse<A = Record<string, unknown>> {
  data: Resource<A>[];
  included?: Resource[];
  meta?: { current_page?: number; total_pages?: number; total_count?: number; per_page?: number };
  links?: { next?: string | null };
}

export interface ShowResponse<A = Record<string, unknown>> {
  data: Resource<A>;
  included?: Resource[];
}

/** included dizisini type:id anahtarıyla bulunur hâle getirir */
export function indexIncluded(included: Resource[] | undefined): Map<string, Resource> {
  const map = new Map<string, Resource>();
  for (const r of included ?? []) map.set(`${r.type}:${r.id}`, r);
  return map;
}

export function relOne(res: Resource, name: string, index: Map<string, Resource>): Resource | null {
  const d = res.relationships?.[name]?.data;
  if (!d || Array.isArray(d)) return null;
  return index.get(`${d.type}:${d.id}`) ?? null;
}

export function relMany(res: Resource, name: string, index: Map<string, Resource>): Resource[] {
  const d = res.relationships?.[name]?.data;
  if (!d || !Array.isArray(d)) return [];
  return d.map((x) => index.get(`${x.type}:${x.id}`)).filter((x): x is Resource => Boolean(x));
}

/** Paraşüt ondalıkları metin olarak döner ("1234.50"); sayıya çevirir, boşsa 0 */
export function dec(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
