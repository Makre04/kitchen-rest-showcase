// Session-scoped catalog cache. TTL = 5 minutes.
// Prevents re-fetching categories/products on every POS mount within the same session.

const CACHE_KEY = "kitchen_catalog_cache";
const TTL_MS = 5 * 60 * 1000;

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  productType?: string;
  allowModifiers?: boolean;
  allowNotes?: boolean;
  requiresCustomization?: boolean;
}

export interface CatalogCategory {
  id: string;
  name: string;
  destination: "COCINA" | "BARRA";
  products: CatalogProduct[];
}

export interface CatalogModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  active: boolean;
}

export interface CatalogModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiple: boolean;
  options: CatalogModifierOption[];
}

export interface Catalog {
  categories: CatalogCategory[];
  modifierGroups: CatalogModifierGroup[];
}

interface CacheEntry {
  data: Catalog;
  ts: number;
}

export function getCachedCatalog(): Catalog | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > TTL_MS) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedCatalog(data: Catalog): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

export function invalidateCatalogCache(): void {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
