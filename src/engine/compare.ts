// Comparison engine: selects comparable offerings and only names a winner when like-for-like data exists.
import type { PriceRecord, PricingModel, ProviderId, Region } from '../domain/types';
import type { IndexKey, PriceIndex } from '../data/loader';

export type Indexes = Partial<Record<string, PriceIndex>>;

export type WorkloadKind = 'compute' | 'gpu' | 'storage' | 'network' | 'database';
export interface Workload {
  kind: WorkloadKind;
  computeConfig: string;   // '2x8' etc.
  arch: 'x86_64' | 'arm64';
  gpuModel: string;        // e.g. 'NVIDIA H100'
  gpuCount: number;
  storageType: 'object' | 'block';
  dbEngine: 'PostgreSQL' | 'MySQL';
  dbConfig: string;        // '2x8'
  pricingModel: PricingModel; // discounted models apply to compute and GPU only
}
export const DEFAULT_WORKLOAD: Workload = { kind: 'compute', computeConfig: '4x16', arch: 'x86_64', gpuModel: 'NVIDIA H100', gpuCount: 8, storageType: 'object', dbEngine: 'PostgreSQL', dbConfig: '2x8', pricingModel: 'on-demand' };
export const COMPUTE_CONFIGS = ['2x8', '4x16', '8x32', '16x64'];
const parseCfg = (c: string) => { const [v, m] = c.split('x').map(Number); return { vcpu: v, mem: m }; };

// General-purpose families considered comparable for the compute workload.
const GP_FAMILIES = new Set(['m6i', 'm7i', 'm7a', 'm7g', 'm8g', 'Dsv5', 'Dsv6', 'Dasv5', 'Dpsv5', 'n2-standard', 'n4-standard', 'e2-standard', 'c4a-standard']);

export interface Pick { record: PriceRecord; hourly?: number; unitPrice: number; unit: string; label: string; notes: string[] }

/** Returns the cheapest comparable offering for the workload in one region, or null when not verifiable. */
export function pickOffering(records: PriceRecord[] | undefined, w: Workload): Pick | null {
  if (!records?.length) return null;
  let cands: PriceRecord[] = [];
  const notes: string[] = [];
  switch (w.kind) {
    case 'compute': {
      const { vcpu, mem } = parseCfg(w.computeConfig);
      cands = records.filter((r) => r.category === 'compute' && GP_FAMILIES.has(r.family!) && r.config.vcpu === vcpu && r.config.memoryGiB === mem && r.config.arch === w.arch);
      notes.push('Linux, on-demand, general-purpose family, exact vCPU/RAM match; compute only (no disk, egress or licences)');
      break;
    }
    case 'gpu':
      cands = records.filter((r) => r.category === 'gpu' && r.config.gpuModel === w.gpuModel && r.config.gpuCount === w.gpuCount);
      notes.push('Whole-VM price incl. host CPU/RAM; GPU interconnect and local NVMe differ by provider');
      break;
    case 'storage':
      cands = records.filter((r) => r.category === 'storage' && r.storageType === w.storageType && (w.storageType === 'object' || /SSD v2|gp3|Balanced/.test(r.tier ?? '')));
      notes.push(w.storageType === 'object' ? 'Hot/standard class, first pricing tier, capacity only (requests and retrieval excluded)' : 'Capacity only; provisioned IOPS/throughput billed separately');
      break;
    case 'network':
      cands = records.filter((r) => r.category === 'network' && r.metric === 'internet-egress' && (r.provider !== 'aws' || /DataTransfer-Out-Bytes$/.test(r.sku)));
      notes.push('First paid tier of internet egress per GB; free allowances (100 GB/month) excluded');
      break;
    case 'database': {
      const { vcpu, mem } = parseCfg(w.dbConfig);
      cands = records.filter((r) => r.category === 'database' && r.engine === w.dbEngine && r.config.vcpu === vcpu && r.config.memoryGiB === mem);
      notes.push('Single-zone instance (no HA), instance hours only — storage and backup billed separately');
      break;
    }
  }
  if (!cands.length) return null;
  const best = cands.reduce((a, b) => (b.price < a.price ? b : a));
  if (best.family === 'e2-standard') notes.push('GCP E2 is cost-optimised (dynamic resource management); included by design');
  return { record: best, unitPrice: best.price, unit: best.unit, hourly: best.unit === 'hour' ? best.price : undefined, label: best.sku, notes };
}

/** Which price index serves a workload kind under a pricing model. Non-compute kinds are on-demand only. */
export const indexKeyFor = (kind: WorkloadKind, model: PricingModel): IndexKey =>
  model !== 'on-demand' && (kind === 'compute' || kind === 'gpu') ? (`${kind}:${model}` as IndexKey) : kind;
export const modelApplies = (kind: WorkloadKind, model: PricingModel) => model === 'on-demand' || kind === 'compute' || kind === 'gpu';

export interface MarketResult { winner: ProviderId | null; reason: string; picks: Partial<Record<ProviderId, { region: Region; pick: Pick }>> }

/** Determine the cheapest provider across the regions of one geographic market. */
export function compareMarket(regions: Region[], indexes: Indexes, w: Workload): MarketResult {
  const idx = indexes[indexKeyFor(w.kind, w.pricingModel)];
  const picks: MarketResult['picks'] = {};
  if (idx) for (const r of regions) {
    const p = pickOffering(idx.byRegion.get(r.key), w);
    if (p && (!picks[r.provider] || p.unitPrice < picks[r.provider]!.pick.unitPrice)) picks[r.provider] = { region: r, pick: p };
  }
  const entries = Object.entries(picks) as [ProviderId, { pick: Pick }][];
  if (entries.length < 2) return { winner: null, reason: entries.length ? 'Only one provider has verified comparable pricing here' : 'No verified comparable pricing', picks };
  entries.sort((a, b) => a[1].pick.unitPrice - b[1].pick.unitPrice);
  if (entries[0][1].pick.unitPrice === entries[1][1].pick.unitPrice) return { winner: null, reason: 'Tie', picks };
  return { winner: entries[0][0], reason: `${entries.length} providers compared`, picks };
}

export const pctDiff = (a: number, b: number) => ((a - b) / b) * 100;
