import type { Category, Manifest, PriceRecord, Region } from '../domain/types';

/** Vite base path — '/' locally, '/global-cloud-atlas/' on GitHub Pages. */
const BASE = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<any>>();
const get = <T,>(url: string): Promise<T> => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }));
  return cache.get(url)!;
};

export const loadRegions = () => get<{ generatedAt: string; regions: Region[] }>(`${BASE}data/regions.json`).then((d) => d.regions);
export const loadManifest = () => get<Manifest>(`${BASE}data/manifest.json`);
/** Lazily loaded per category — only fetched when a lens/panel needs it. */
export const loadPricing = (file: string) => get<PriceRecord[]>(`${BASE}data/pricing/${file}.json`).catch(() => [] as PriceRecord[]);

export interface PriceIndex {
  all: PriceRecord[];
  byRegion: Map<string, PriceRecord[]>; // key provider:regionId
}
/** Index key: 'compute' (on-demand) or 'compute:spot' / 'gpu:commit-1y' for discounted models. */
export type IndexKey = Category | `${'compute' | 'gpu'}:${'spot' | 'commit-1y'}`;
const idx = new Map<string, Promise<PriceIndex>>();
export function loadIndex(c: IndexKey): Promise<PriceIndex> {
  if (!idx.has(c)) idx.set(c, loadPricing(c.replace(':', '-')).then((all) => {
    const byRegion = new Map<string, PriceRecord[]>();
    for (const r of all) { const k = `${r.provider}:${r.regionId}`; (byRegion.get(k) ?? byRegion.set(k, []).get(k)!).push(r); }
    return { all, byRegion };
  }));
  return idx.get(c)!;
}

/** FX from ECB reference rates (frankfurter). Prices are stored in USD; conversion is display-only. */
export const loadFx = () => get<{ rates: Record<string, number>; date: string }>('https://api.frankfurter.dev/v1/latest?base=USD')
  .catch(() => ({ rates: {}, date: '' }));
