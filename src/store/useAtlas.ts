import { create } from 'zustand';
import type { Manifest, ProviderId, Region, Sovereignty } from '../domain/types';
import type { IndexKey } from '../data/loader';
import { loadIndex } from '../data/loader';
import { DEFAULT_WORKLOAD, type Indexes, type Workload } from '../engine/compare';
import type { Cluster } from '../engine/geo';
import type { LensId } from '../lenses/lenses';
import type { Residency } from '../engine/finder';

interface Focus { lat: number; lon: number; distance: number; t: number }
export interface Origin { lat: number; lon: number; label: string; country?: string }
export interface FinderState {
  templateId: string; residency: Residency; sovereignty: Sovereignty[]; maxRtt: number | null;
  weights: { cost: number; latency: number; carbon: number };
}

interface AtlasState {
  regions: Region[];
  manifest: Manifest | null;
  indexes: Indexes;
  providers: Record<ProviderId, boolean>;
  /** Global region filters (left rail): sovereignty classes and optional country */
  regionFilter: { sovereignty: Sovereignty[]; country: string | null };
  lens: LensId;
  workload: Workload;
  selected: string | null;
  hovered: string | null;
  highlight: { label: string; keys: Set<string> } | null;
  focus: Focus | null;
  currency: string;
  fx: Record<string, number>;
  overlayClusters: Cluster[]; showClusters: boolean; hoverText: string;
  leftOpen: boolean; rightOpen: boolean; compareOpen: boolean; finderOpen: boolean; guideOpen: boolean;
  /** Where the user's users are — drives latency estimates, rings and the Region Finder */
  origin: Origin | null;
  pickingOrigin: boolean;
  finder: FinderState;
  finderTop: string[]; // keys of top-ranked regions, drawn on the globe
  set: (p: Partial<AtlasState>) => void;
  ensure: (c: IndexKey) => Promise<void>;
  toggleProvider: (p: ProviderId) => void;
  select: (key: string | null, fly?: boolean) => void;
  flyTo: (lat: number, lon: number, distance?: number) => void;
  setWorkload: (p: Partial<Workload>) => void;
  setFinder: (p: Partial<FinderState>) => void;
}

export const ALL_SOVEREIGNTY: Sovereignty[] = ['commercial', 'government', 'sovereign', 'partner'];

export const useAtlas = create<AtlasState>((set, get) => ({
  regions: [], manifest: null, indexes: {},
  providers: { aws: true, azure: true, gcp: true },
  regionFilter: { sovereignty: [...ALL_SOVEREIGNTY], country: null },
  lens: 'infrastructure', workload: DEFAULT_WORKLOAD,
  selected: null, hovered: null, highlight: null, focus: null,
  currency: 'USD', fx: { USD: 1 },
  overlayClusters: [], showClusters: false, hoverText: '',
  leftOpen: true, rightOpen: true, compareOpen: false, finderOpen: false, guideOpen: false,
  origin: null, pickingOrigin: false,
  finder: { templateId: 'web', residency: { mode: 'any' }, sovereignty: ['commercial'], maxRtt: null, weights: { cost: 3, latency: 2, carbon: 1 } },
  finderTop: [],
  set: (p) => set(p),
  ensure: async (c) => {
    if (get().indexes[c]) return;
    const idx = await loadIndex(c);
    set((s) => ({ indexes: { ...s.indexes, [c]: idx } }));
  },
  toggleProvider: (p) => set((s) => ({ providers: { ...s.providers, [p]: !s.providers[p] } })),
  select: (key, fly = true) => {
    set({ selected: key, rightOpen: key ? true : get().rightOpen });
    const r = key && get().regions.find((x) => x.key === key);
    if (r && fly) get().flyTo(r.lat, r.lon, 2.0);
  },
  flyTo: (lat, lon, distance = 2.2) => set({ focus: { lat, lon, distance, t: performance.now() } }),
  setWorkload: (p) => set((s) => ({ workload: { ...s.workload, ...p } })),
  setFinder: (p) => set((s) => ({ finder: { ...s.finder, ...p } })),
}));

/** Regions passing provider + sovereignty + country filters. Use everywhere regions are displayed. */
export function filterRegions(s: Pick<AtlasState, 'regions' | 'providers' | 'regionFilter'>) {
  return s.regions.filter((r) => s.providers[r.provider] && s.regionFilter.sovereignty.includes(r.sovereignty) && (!s.regionFilter.country || r.country === s.regionFilter.country));
}

/** Format a USD amount in the selected display currency. */
export function useMoney() {
  const currency = useAtlas((s) => s.currency), fx = useAtlas((s) => s.fx);
  const rate = fx[currency] ?? 1;
  return (usd: number | null | undefined, digits?: number) => {
    if (usd == null || !isFinite(usd)) return '—';
    const v = usd * rate;
    const d = digits ?? (v < 0.1 ? 4 : v < 10 ? 3 : 2);
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  };
}

if (import.meta.env.DEV) (window as any).__atlas = useAtlas;
