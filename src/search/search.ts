import type { Category, ProviderId, Region } from '../domain/types';
import { PROVIDERS } from '../domain/types';
import type { Country } from '../data/world';
import type { PriceIndex } from '../data/loader';

export type ResultKind = 'region' | 'country' | 'city' | 'provider' | 'service' | 'instance' | 'gpu';
export interface SearchResult { kind: ResultKind; label: string; sub: string; lat?: number; lon?: number; regionKey?: string; provider?: ProviderId; keys?: string[]; score: number }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function buildSearch(regions: Region[], countries: Country[], indexes: Partial<Record<Category, PriceIndex>>) {
  const docs: Omit<SearchResult, 'score'>[] = [];
  for (const r of regions) docs.push({ kind: 'region', label: `${PROVIDERS[r.provider].label} ${r.name}`, sub: `${r.id} · ${r.city}`, lat: r.lat, lon: r.lon, regionKey: r.key, provider: r.provider });
  const cities = new Map<string, Region[]>();
  for (const r of regions) (cities.get(r.city) ?? cities.set(r.city, []).get(r.city)!).push(r);
  for (const [city, rs] of cities) docs.push({ kind: 'city', label: city, sub: `${rs.length} region${rs.length > 1 ? 's' : ''} · ${rs.map((r) => PROVIDERS[r.provider].label).join(', ')}`, lat: rs[0].lat, lon: rs[0].lon, keys: rs.map((r) => r.key) });
  for (const c of countries) if (c.name) docs.push({ kind: 'country', label: c.name, sub: 'Country', lat: c.lat, lon: c.lon });
  for (const p of Object.keys(PROVIDERS) as ProviderId[]) docs.push({ kind: 'provider', label: PROVIDERS[p].label, sub: `${regions.filter((r) => r.provider === p).length} regions`, provider: p, keys: regions.filter((r) => r.provider === p).map((r) => r.key) });
  const services = new Map<string, string[]>();
  for (const r of regions) for (const s of r.services ?? []) (services.get(s) ?? services.set(s, []).get(s)!).push(r.key);
  for (const [s, keys] of services) docs.push({ kind: 'service', label: s, sub: `AWS service · ${keys.length} regions`, keys });
  const inst = new Map<string, Set<string>>(), gpus = new Map<string, Set<string>>();
  for (const c of ['compute', 'gpu'] as const) for (const rec of indexes[c]?.all ?? []) {
    const k = `${rec.provider}:${rec.regionId}`;
    (inst.get(rec.sku) ?? inst.set(rec.sku, new Set()).get(rec.sku)!).add(k);
    if (rec.config.gpuModel) (gpus.get(rec.config.gpuModel) ?? gpus.set(rec.config.gpuModel, new Set()).get(rec.config.gpuModel)!).add(k);
  }
  for (const [s, keys] of inst) docs.push({ kind: 'instance', label: s, sub: `Instance type · ${keys.size} regions`, keys: [...keys] });
  for (const [g, keys] of gpus) docs.push({ kind: 'gpu', label: g, sub: `Accelerator · ${keys.size} regions`, keys: [...keys] });
  const hay = docs.map((d) => norm(`${d.label} ${d.sub}`));
  const order: Record<ResultKind, number> = { region: 0, city: 1, country: 2, provider: 0, gpu: 1, service: 3, instance: 2 };

  return (q: string, limit = 12): SearchResult[] => {
    const t = norm(q.trim()); if (!t) return [];
    const terms = t.split(/\s+/);
    const out: SearchResult[] = [];
    docs.forEach((d, i) => {
      if (!terms.every((x) => hay[i].includes(x))) return;
      const l = norm(d.label);
      const score = (l === t ? 0 : l.startsWith(t) ? 1 : 2) * 10 + order[d.kind];
      out.push({ ...d, score });
    });
    return out.sort((a, b) => a.score - b.score || a.label.length - b.label.length).slice(0, limit);
  };
}
