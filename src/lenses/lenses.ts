// Visualization lenses: each maps a region to a scalar (beam height) given loaded indexes and context.
import { PRICING_MODELS, type Region } from '../domain/types';
import { indexKeyFor, modelApplies, pickOffering, type Indexes, type Workload, type WorkloadKind } from '../engine/compare';
import { estRttMs } from '../engine/latency';
import type { IndexKey } from '../data/loader';

export type LensId = 'infrastructure' | 'compute' | 'gpu' | 'storage' | 'network' | 'database' | 'ai' | 'compare' | 'latency' | 'carbon';
export interface LensCtx { origin: { lat: number; lon: number } | null }
export interface Lens {
  id: LensId; label: string; key: string; unit?: string;
  needs: (w: Workload) => IndexKey[];
  describe: (w: Workload, ctx: LensCtx) => string;
  value?: (r: Region, idx: Indexes, w: Workload, ctx: LensCtx) => number | null;
  format?: (v: number) => string;
}

const pm = (kind: WorkloadKind, w: Workload) => (modelApplies(kind, w.pricingModel) ? w.pricingModel : 'on-demand');
const priced = (kind: WorkloadKind) => (r: Region, idx: Indexes, w: Workload) =>
  pickOffering(idx[indexKeyFor(kind, pm(kind, w))]?.byRegion.get(r.key), { ...w, kind, pricingModel: pm(kind, w) })?.unitPrice ?? null;
const pmLabel = (kind: WorkloadKind, w: Workload) => PRICING_MODELS[pm(kind, w)].short;

export const LENSES: Lens[] = [
  { id: 'infrastructure', label: 'Infrastructure', key: '1', needs: () => [], describe: () => 'Regions and availability zones. Beam height = verified AZ count.', value: (r) => r.azs, format: (v) => `${v} availability zones` },
  { id: 'compute', label: 'Compute', key: '2', unit: '/hr', needs: (w) => [indexKeyFor('compute', w.pricingModel)], value: priced('compute'),
    describe: (w) => `Cheapest general-purpose ${w.arch} Linux VM, ${w.computeConfig.replace('x', ' vCPU / ')} GB · ${pmLabel('compute', w)}` },
  { id: 'gpu', label: 'GPU', key: '3', unit: '/hr', needs: (w) => [indexKeyFor('gpu', w.pricingModel)], value: priced('gpu'),
    describe: (w) => `${w.gpuCount}× ${w.gpuModel} VM, hourly · ${pmLabel('gpu', w)}` },
  { id: 'storage', label: 'Storage', key: '4', unit: '/GB-mo', needs: () => ['storage'], value: priced('storage'),
    describe: (w) => `${w.storageType === 'object' ? 'Object storage (hot/standard)' : 'Block storage capacity'}, USD per GB-month · on-demand` },
  { id: 'network', label: 'Network', key: '5', unit: '/GB', needs: () => ['network'], value: priced('network'), describe: () => 'Internet egress, first paid tier, USD per GB' },
  { id: 'database', label: 'Database', key: '6', unit: '/hr', needs: () => ['database'], value: priced('database'),
    describe: (w) => `Managed ${w.dbEngine}, ${w.dbConfig.replace('x', ' vCPU / ')} GB, single zone · on-demand` },
  { id: 'ai', label: 'AI', key: '7', needs: () => ['ai', 'gpu'], format: () => 'AI offerings present',
    describe: () => 'Beam = number of AI offerings (GPU/accelerator VM types + managed model API meters)',
    value: (r, idx) => { const g = new Set(idx.gpu?.byRegion.get(r.key)?.map((x) => x.config.gpuModel)).size; const a = idx.ai?.byRegion.get(r.key)?.length ?? 0; return g + a > 0 ? g + Math.min(a, 40) / 4 : null; } },
  { id: 'compare', label: 'Price Compare', key: '8', needs: (w) => [indexKeyFor(w.kind, w.pricingModel)], describe: (w) => `Cheapest provider per market for: ${w.kind} · ${pmLabel(w.kind, w)}` },
  { id: 'latency', label: 'Latency', key: '9', unit: ' ms', needs: () => [], format: (v) => `~${Math.round(v)} ms est. RTT`,
    describe: (_w, ctx) => ctx.origin ? 'Estimated round-trip time from your users. Short beams are closer. Estimate only (distance-based), not measured.' : 'Set where your users are (Region Finder or click “set location”) to see estimated latency.',
    value: (r, _i, _w, ctx) => (ctx.origin ? estRttMs(ctx.origin, r) : null) },
  { id: 'carbon', label: 'Carbon', key: '0', unit: ' g/kWh', needs: () => [], format: (v) => `${Math.round(v)} gCO₂e/kWh grid`,
    describe: () => 'Grid carbon intensity (gCO₂e/kWh, 2025) as published by Google per region. AWS and Azure do not publish comparable per-region figures, so they show as no data.',
    value: (r) => r.carbon?.gridIntensity ?? null },
];
export const lensById = (id: LensId) => LENSES.find((l) => l.id === id)!;
