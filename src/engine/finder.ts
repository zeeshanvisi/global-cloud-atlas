// Region Finder: rank every region for a workload by cost, estimated latency and carbon.
// Scores are relative within the candidate set (0–1, higher is better); weights are user-set.
import type { PricingModel, ProviderId, Region, Sovereignty } from '../domain/types';
import { estRttMs } from './latency';
import { billFor, type Bill, type Template } from './templates';
import type { Indexes } from './compare';

export const EU_EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']);

export type Residency = { mode: 'any' } | { mode: 'country'; country: string } | { mode: 'eu' };
export interface FinderInput {
  origin: { lat: number; lon: number; country?: string } | null;
  template: Template; model: PricingModel;
  providers: Record<ProviderId, boolean>;
  residency: Residency;
  sovereignty: Set<Sovereignty>;
  maxRtt: number | null;
  weights: { cost: number; latency: number; carbon: number };
}
export interface FinderResult {
  region: Region; bill: Bill; rtt: number | null; carbon: number | null;
  scores: { cost: number; latency: number; carbon: number | null }; score: number; reasons: string[];
}
export interface FinderOutput { results: FinderResult[]; excluded: { reason: string; count: number }[] }

export function rankRegions(regions: Region[], indexes: Indexes, inp: FinderInput): FinderOutput {
  const ex = new Map<string, number>(); const bump = (r: string) => ex.set(r, (ex.get(r) ?? 0) + 1);
  const cands: Omit<FinderResult, 'scores' | 'score' | 'reasons'>[] = [];
  for (const r of regions) {
    if (!inp.providers[r.provider]) { bump('provider filtered out'); continue; }
    if (!inp.sovereignty.has(r.sovereignty)) { bump(`${r.sovereignty} region excluded`); continue; }
    if (inp.residency.mode === 'country' && r.country !== inp.residency.country) { bump('outside required country'); continue; }
    if (inp.residency.mode === 'eu' && !EU_EEA.has(r.country)) { bump('outside EU/EEA'); continue; }
    const rtt = inp.origin ? estRttMs(inp.origin, r) : null;
    if (rtt != null && inp.maxRtt != null && rtt > inp.maxRtt) { bump('over latency budget'); continue; }
    const bill = billFor(r, inp.template, indexes, inp.model);
    if (bill.total == null) { bump('incomplete verified pricing'); continue; }
    cands.push({ region: r, bill, rtt, carbon: r.carbon?.gridIntensity ?? null });
  }
  if (!cands.length) return { results: [], excluded: [...ex].map(([reason, count]) => ({ reason, count })) };
  const minCost = Math.min(...cands.map((c) => c.bill.total!));
  const rtts = cands.map((c) => c.rtt).filter((x): x is number => x != null), minRtt = rtts.length ? Math.min(...rtts) : 0;
  const carbs = cands.map((c) => c.carbon).filter((x): x is number => x != null), minC = carbs.length ? Math.min(...carbs) : 0;
  const W = inp.weights;
  const results = cands.map((c) => {
    const cost = minCost / c.bill.total!;
    const latency = c.rtt == null ? 0.5 : Math.exp(-(c.rtt - minRtt) / 50); // 1 at the closest region, 0.37 at +50 ms
    const carbon = c.carbon == null ? null : (minC + 50) / (c.carbon + 50);
    const wC = W.carbon && carbon != null ? W.carbon : 0;          // regions without published carbon data aren't penalised or rewarded
    const wl = inp.origin ? W.latency : 0;
    const denom = W.cost + wl + wC || 1;
    const score = (W.cost * cost + wl * latency + wC * (carbon ?? 0)) / denom;
    const reasons: string[] = [];
    if (cost > 0.97) reasons.push('lowest cost'); else if (cost > 0.85) reasons.push(`within ${Math.round((1 / cost - 1) * 100)}% of cheapest`);
    if (c.rtt != null && c.rtt - minRtt < 8) reasons.push('closest to users');
    if (c.region.carbon?.lowCarbon) reasons.push('low-carbon (Google)');
    return { ...c, scores: { cost, latency, carbon }, score, reasons };
  }).sort((a, b) => b.score - a.score);
  return { results, excluded: [...ex].map(([reason, count]) => ({ reason, count })) };
}
