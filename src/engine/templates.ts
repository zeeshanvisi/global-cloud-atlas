// Workload templates → itemised monthly bill per region. Assumptions are explicit on every line.
import { HOURS_MONTH, type PriceRecord, type PricingModel, type Region } from '../domain/types';
import { indexKeyFor, pickOffering, type Indexes, type Workload, DEFAULT_WORKLOAD } from './compare';

export interface Template {
  id: string; label: string; blurb: string;
  vms?: { count: number; cfg: string; arch: 'x86_64' | 'arm64' };
  gpu?: { model: string; count: number; instances: number };
  storageGB: number; egressGB: number;
  db?: { engine: 'PostgreSQL' | 'MySQL'; cfg: string };
}

export const TEMPLATES: Template[] = [
  { id: 'web', label: 'Web application', blurb: '4 app servers, Postgres, 500 GB assets, 1 TB egress',
    vms: { count: 4, cfg: '4x16', arch: 'x86_64' }, storageGB: 500, egressGB: 1000, db: { engine: 'PostgreSQL', cfg: '2x8' } },
  { id: 'api', label: 'Small API / SaaS', blurb: '2 small servers, Postgres, 100 GB, 200 GB egress',
    vms: { count: 2, cfg: '2x8', arch: 'x86_64' }, storageGB: 100, egressGB: 200, db: { engine: 'PostgreSQL', cfg: '2x8' } },
  { id: 'data', label: 'Data platform', blurb: '8 workers 8 vCPU/32 GB, 20 TB lake, Postgres 4/16',
    vms: { count: 8, cfg: '8x32', arch: 'x86_64' }, storageGB: 20000, egressGB: 2000, db: { engine: 'PostgreSQL', cfg: '4x16' } },
  { id: 'arm', label: 'Arm fleet', blurb: '6 Arm servers 4/16, 1 TB, 1 TB egress',
    vms: { count: 6, cfg: '4x16', arch: 'arm64' }, storageGB: 1000, egressGB: 1000 },
  { id: 'inference', label: 'AI inference (L4)', blurb: '2× single-L4 GPU VMs, 500 GB models, 500 GB egress',
    gpu: { model: 'NVIDIA L4', count: 1, instances: 2 }, storageGB: 500, egressGB: 500 },
  { id: 'training', label: 'AI training (8× H100)', blurb: 'One 8× H100 node, 5 TB datasets',
    gpu: { model: 'NVIDIA H100', count: 8, instances: 1 }, storageGB: 5000, egressGB: 100 },
];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];

export interface BillLine { item: string; qty: string; unit: number | null; monthly: number | null; record?: PriceRecord; note?: string }
export interface Bill { lines: BillLine[]; total: number | null; missing: string[] }

/** Itemised monthly bill. `model` applies to VM and GPU lines only; storage, egress and DB stay on-demand. */
export function billFor(region: Region, t: Template, indexes: Indexes, model: PricingModel): Bill {
  const w = (p: Partial<Workload>): Workload => ({ ...DEFAULT_WORKLOAD, pricingModel: model, ...p });
  const recs = (kind: Workload['kind']) => indexes[indexKeyFor(kind, model)]?.byRegion.get(region.key);
  const lines: BillLine[] = [];
  if (t.vms) {
    const p = pickOffering(recs('compute'), w({ kind: 'compute', computeConfig: t.vms.cfg, arch: t.vms.arch }));
    lines.push({ item: `VM ${t.vms.cfg.replace('x', ' vCPU / ')} GB ${t.vms.arch}`, qty: `${t.vms.count} × 730 h`, unit: p?.unitPrice ?? null,
      monthly: p ? p.unitPrice * HOURS_MONTH * t.vms.count : null, record: p?.record, note: p?.label });
  }
  if (t.gpu) {
    const p = pickOffering(recs('gpu'), w({ kind: 'gpu', gpuModel: t.gpu.model, gpuCount: t.gpu.count }));
    lines.push({ item: `GPU VM ${t.gpu.count}× ${t.gpu.model.replace('NVIDIA ', '')}`, qty: `${t.gpu.instances} × 730 h`, unit: p?.unitPrice ?? null,
      monthly: p ? p.unitPrice * HOURS_MONTH * t.gpu.instances : null, record: p?.record, note: p?.label });
  }
  const st = pickOffering(indexes.storage?.byRegion.get(region.key), w({ kind: 'storage', storageType: 'object', pricingModel: 'on-demand' }));
  lines.push({ item: 'Object storage', qty: `${t.storageGB.toLocaleString()} GB`, unit: st?.unitPrice ?? null, monthly: st ? st.unitPrice * t.storageGB : null, record: st?.record });
  const eg = pickOffering(indexes.network?.byRegion.get(region.key), w({ kind: 'network', pricingModel: 'on-demand' }));
  lines.push({ item: 'Internet egress', qty: `${t.egressGB.toLocaleString()} GB`, unit: eg?.unitPrice ?? null, monthly: eg ? eg.unitPrice * t.egressGB : null, record: eg?.record });
  if (t.db) {
    const p = pickOffering(indexes.database?.byRegion.get(region.key), w({ kind: 'database', dbEngine: t.db.engine, dbConfig: t.db.cfg, pricingModel: 'on-demand' }));
    lines.push({ item: `${t.db.engine} ${t.db.cfg.replace('x', '/')} GB`, qty: '730 h', unit: p?.unitPrice ?? null, monthly: p ? p.unitPrice * HOURS_MONTH : null, record: p?.record, note: p?.label });
  }
  const missing = lines.filter((l) => l.monthly == null).map((l) => l.item);
  return { lines, total: missing.length ? null : lines.reduce((a, l) => a + l.monthly!, 0), missing };
}

/** Index keys a template needs under a pricing model. */
export const neededIndexes = (t: Template, model: PricingModel) => [
  ...(t.vms ? [indexKeyFor('compute', model)] : []), ...(t.gpu ? [indexKeyFor('gpu', model)] : []),
  'storage', 'network', ...(t.db ? ['database'] : []),
] as const;
