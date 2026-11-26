// GCP ingestion — Cloud Billing Catalog API. Requires an API key (server-side only):
//   GCP_API_KEY=... npm run ingest:gcp
// Create one at https://console.cloud.google.com/apis/credentials with the Cloud Billing API enabled.
// The key is read from the environment and never written to output or bundled into the frontend.
import { fetchJson, regionsOf, catalog, record, writeOut } from './lib.mjs';

const KEY = process.env.GCP_API_KEY;
if (!KEY) { console.log('GCP: GCP_API_KEY not set — skipping. GCP prices will show as "unavailable".'); process.exit(0); }
const API = 'https://cloudbilling.googleapis.com/v1';
const cat = catalog();
const regionIds = new Set(regionsOf('gcp').map((r) => r.id));

async function skus(serviceName) {
  const svcs = await fetchJson(`${API}/services?pageSize=5000&key=${KEY}`);
  const svc = svcs.services.find((s) => s.displayName === serviceName);
  const out = []; let token = '';
  do {
    const d = await fetchJson(`${API}/${svc.name}/skus?pageSize=5000&currencyCode=USD&key=${KEY}${token ? `&pageToken=${token}` : ''}`);
    out.push(...(d.skus ?? [])); token = d.nextPageToken;
  } while (token);
  return out;
}
const unitPrice = (s) => {
  const p = s.pricingInfo?.[0]?.pricingExpression; const r = p?.tieredRates?.find((t) => +t.unitPrice.units || t.unitPrice.nanos) ?? p?.tieredRates?.[0];
  return r ? { price: Number(r.unitPrice.units || 0) + (r.unitPrice.nanos || 0) / 1e9, unit: p.usageUnit, effective: s.pricingInfo[0].effectiveTime } : null;
};
const onDemand = (s) => s.category?.usageType === 'OnDemand';
const src = 'https://cloud.google.com/compute/vm-instance-pricing';

const compute = [], gpu = [], storage = [], network = [];
const ce = await skus('Compute Engine');
// GCP prices vCPU and memory separately; we compose machine-type prices from the two SKUs.
for (const fam of cat.gcpCompute) {
  for (const region of regionIds) {
    const pick = (re) => ce.find((s) => onDemand(s) && s.serviceRegions.includes(region) && s.description.startsWith(fam.skuPrefix) && re.test(s.description) && !/Custom|Sole|Spot|Preemptible|Commit/i.test(s.description));
    const core = pick(/Core/), ram = pick(/Ram/);
    const pc = core && unitPrice(core), pr = ram && unitPrice(ram);
    if (!pc || !pr) continue;
    for (const n of fam.sizes) {
      const mem = n * fam.memPerVcpu;
      compute.push(record({ provider: 'gcp', regionId: region, category: 'compute', service: 'Compute Engine', family: fam.family,
        sku: `${fam.family}-${n}`, productId: `${core.skuId}+${ram.skuId}`, price: n * pc.price + mem * pr.price, unit: 'hour', os: 'Linux',
        config: { vcpu: n, memoryGiB: mem, arch: fam.arch, cpu: fam.cpu, composedFrom: { corePerHour: pc.price, ramGiBPerHour: pr.price } },
        effectiveDate: pc.effective, sourceUrl: src, sourceApi: `${API}/services/6F81-5844-456A/skus` }));
    }
  }
}
// Storage: Standard storage class (regional)
const gcs = await skus('Cloud Storage');
for (const s of gcs) {
  // Regional Standard class only — dual/multi-region SKUs are a different product
  if (!onDemand(s) || !/^Standard Storage/.test(s.description) || /Dual-region|Multi-region/i.test(s.description)) continue;
  const p = unitPrice(s); if (!p) continue;
  for (const region of s.serviceRegions.filter((r) => regionIds.has(r))) storage.push(record({ provider: 'gcp', regionId: region, category: 'storage', storageType: 'object', tier: 'Standard', service: 'Cloud Storage',
    sku: 'Standard', productId: s.skuId, price: p.price, unit: 'GB-month', effectiveDate: p.effective, sourceUrl: 'https://cloud.google.com/storage/pricing', sourceApi: API }));
}
// Block storage: pd-balanced
for (const s of ce) {
  if (!onDemand(s) || !/^Balanced PD Capacity/.test(s.description)) continue;
  const p = unitPrice(s); if (!p) continue;
  for (const r of s.serviceRegions) if (regionIds.has(r)) storage.push(record({ provider: 'gcp', regionId: r, category: 'storage', storageType: 'block', tier: 'Balanced PD', service: 'Persistent Disk',
    sku: 'pd-balanced', productId: s.skuId, price: p.price, unit: 'GB-month', effectiveDate: p.effective, sourceUrl: 'https://cloud.google.com/compute/disks-image-pricing', sourceApi: API }));
}
// GPU machines: vCPU × core SKU + GiB × RAM SKU + GPUs × GPU SKU (bundled local SSD excluded)
const isPlain = (s) => onDemand(s) && !/Custom|Sole|Spot|Preemptible|Commit|DWS|Reserved|Calendar|attached/i.test(s.description);
for (const m of cat.gpu.gcp) {
  for (const region of regionIds) {
    const find = (re) => ce.find((s) => isPlain(s) && s.serviceRegions.includes(region) && re.test(s.description));
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const core = find(new RegExp(`^${esc(m.core)} Core running in`)), ram = find(new RegExp(`^${esc(m.core)} Ram running in`));
    const g = find(new RegExp(`^${esc(m.gpuSku)} running in`));
    const [pc, pr, pg] = [core, ram, g].map((s) => s && unitPrice(s));
    if (!pc || !pr || !pg) continue;
    gpu.push(record({ provider: 'gcp', regionId: region, category: 'gpu', service: 'Compute Engine', family: m.machine.split('-')[0],
      sku: m.machine, productId: `${core.skuId}+${ram.skuId}+${g.skuId}`, price: m.vcpu * pc.price + m.memGiB * pr.price + m.count * pg.price, unit: 'hour', os: 'Linux',
      config: { vcpu: m.vcpu, memoryGiB: m.memGiB, gpuModel: m.model, gpuCount: m.count, gpuMemGiB: m.gpuMem,
        composedFrom: { corePerHour: pc.price, ramGiBPerHour: pr.price, gpuPerHour: pg.price }, note: 'Excludes bundled local SSD', availabilityVerified: false },
      effectiveDate: pg.effective, sourceUrl: 'https://cloud.google.com/compute/gpus-pricing', sourceApi: `${API}/services/6F81-5844-456A/skus` }));
  }
}
// Networking: premium-tier internet egress and inter-region transfer (first paid tier, cheapest destination group)
const firstPaid = (s) => {
  const p = s.pricingInfo?.[0]?.pricingExpression; const t = p?.tieredRates?.find((x) => +x.unitPrice.units || x.unitPrice.nanos);
  return t ? { price: Number(t.unitPrice.units || 0) + (t.unitPrice.nanos || 0) / 1e9, from: t.startUsageAmount, effective: s.pricingInfo[0].effectiveTime } : null;
};
for (const region of regionIds) {
  for (const [group, metric, re] of [['PremiumInternetEgress', 'internet-egress', /^Network Internet Data Transfer Out from .+ to (.+)$/], ['InterregionEgress', 'inter-region', /^Network Inter Region Data Transfer Out from .+ to (.+)$/]]) {
    let best = null;
    for (const s of ce) {
      if (!onDemand(s) || s.category.resourceGroup !== group || !s.serviceRegions.includes(region)) continue;
      const dest = re.exec(s.description)?.[1]; const p = firstPaid(s);
      if (dest && p && (!best || p.price < best.p.price)) best = { s, p, dest };
    }
    if (best) network.push(record({ provider: 'gcp', regionId: region, category: 'network', metric, service: 'Cloud Networking (Premium Tier)',
      sku: best.s.description, productId: best.s.skuId, price: best.p.price, unit: 'GB',
      config: { to: metric === 'internet-egress' ? `Internet (${best.dest})` : best.dest, tierFromGB: best.p.from, note: 'Cheapest destination group; rates vary by destination' },
      effectiveDate: best.p.effective, sourceUrl: 'https://cloud.google.com/vpc/network-pricing', sourceApi: API }));
  }
}
console.log('GCP:');
writeOut('gcp-compute', compute); writeOut('gcp-gpu', gpu); writeOut('gcp-storage', storage); writeOut('gcp-network', network);
