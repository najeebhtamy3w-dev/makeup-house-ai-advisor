// CP05 client view of the unified taxonomy. Loaded once from the server (single source of truth).
import { api } from './api.js';
import { CATEGORIES } from './util.js';

let TX = null;
export async function loadTaxonomy() {
  if (TX) return TX;
  TX = await api('GET', '/api/taxonomy');
  CATEGORIES.splice(0, CATEGORIES.length, ...TX.categories);
  return TX;
}
export const tx = () => TX ?? { categories: CATEGORIES, product_types: [], areas: [], functions: [], statuses: {} };
export const typeLabel = (id) => tx().product_types.find((t) => t.id === id)?.ar ?? '';
export const areaLabel = (id) => tx().areas.find((t) => t.id === id)?.ar ?? '';
/** Forms typical for a category first (organisational only — any form stays selectable for any category). */
export const typicalTypes = (cat) => tx().product_types.filter((t) => t.cats.includes(cat));
