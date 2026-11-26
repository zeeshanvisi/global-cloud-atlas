// Discounted pricing models — kept in SEPARATE files from on-demand and never mixed.
//   spot       : AWS Spot (point-in-time snapshot), Azure Spot, GCP Spot (Preemptible SKUs)
//   commit-1y  : Azure 1-year Reserved Instance, GCP 1-year resource CUD. (AWS RI / Savings Plans not ingested.)
// Output: public/data/pricing/<provider>-<compute|gpu>-<model>.json
import { fetchJson, regionsOf, catalog, record, writeOut, pool } from './lib.mjs';

const cat = catalog();
const out = { aws: { compute: { spot: [] }, gpu: { spot: [] } }, azure: { compute: { spot: [], 'commit-1y': [] }, gpu: { spot: [], 'commit-1y': [] } }, gcp: { compute: { spot: [], 'commit-1y': [] }, gpu: { spot: [], 'commit-1y': [] } } };

// ── AWS Spot (pricing page JSON; prices move continuously — this is a snapshot) ──────────────
{
  const url = 'https://website.spot.ec2.aws.a2z.com/spot.json';
  const known = new Set(regionsOf('aws').map((r) => r.id));
  const gpuSpec = new Map(cat.gpu.aws.map(([t, model, count, mem]) => [t, { model, count, memGiB: mem }]));
  // reuse on-demand records for specs (vCPU / RAM / family)
  const od = JSON.parse((await import('node:fs')).readFileSync(new URL('../../public/data/pricing/aws-compute.json', import.meta.url), 'utf8')).records;
  const spec = new Map(od.map((r) => [r.sku, r]));
  const d = await fetchJson(url, { cacheHours: 3 });
  for (const reg of d.config.regions) {
    if (!known.has(reg.region)) continue;
    for (const t of reg.instanceTypes) for (const s of t.sizes) {
      const p = parseFloat(s.valueColumns.find((v) => v.name === 'linux')?.prices?.USD); if (!(p > 0)) continue;
      const base = { provider: 'aws', regionId: reg.region, productId: `spot:${s.size}`, sku: s.size, price: p, unit: 'hour', os: 'Linux',
        effectiveDate: new Date().toISOString(), sourceUrl: 'https://aws.amazon.com/ec2/spot/pricing/', sourceApi: url, service: 'Amazon EC2 Spot' };
      const o = spec.get(s.size), g = gpuSpec.get(s.size);
      if (o) out.aws.compute.spot.push(record({ ...base, pricingModel: 'spot', category: 'compute', family: o.family, config: { ...o.config, note: 'Spot price snapshot; can be interrupted' } }));
      if (g) out.aws.gpu.spot.push(record({ ...base, pricingModel: 'spot', category: 'gpu', family: s.size.split('.')[0], config: { gpuModel: g.model, gpuCount: g.count, gpuMemGiB: g.memGiB, note: 'Spot price snapshot; can be interrupted' } }));
    }
  }
}

// ── Azure Spot + 1-year Reserved (Retail Prices API) ───────────────────────────────────────
{
  const API = 'https://prices.azure.com/api/retail/prices';
  const known = new Set(regionsOf('azure').map((r) => r.id));
  const computeSpec = new Map();
  for (const f of cat.azureCompute) for (const n of f.sizes) computeSpec.set(f.pattern.replace('{n}', n), { family: f.family, vcpu: n, memoryGiB: n * f.memPerVcpu, arch: f.arch, cpu: f.cpu });
  const gpuSpec = new Map(cat.gpu.azure.map(([s, model, count, mem]) => [s, { model, count, memGiB: mem }]));
  async function query(filter) {
    let url = `${API}?$filter=${encodeURIComponent(filter)}`; const items = [];
    while (url) { const d = await fetchJson(url); items.push(...d.Items); url = d.NextPageLink; }
    return items;
  }
  await pool([...computeSpec.keys(), ...gpuSpec.keys()], 6, async (sku) => {
    const items = await query(`serviceName eq 'Virtual Machines' and armSkuName eq '${sku}'`);
    for (const i of items) {
      if (!known.has(i.armRegionName) || /Windows/.test(i.productName) || /Low Priority/.test(i.skuName)) continue;
      let model = null, price = i.retailPrice, note = '';
      if (i.type === 'Consumption' && /Spot/.test(i.skuName) && i.unitOfMeasure === '1 Hour') { model = 'spot'; note = 'Azure Spot; evictable'; }
      if (i.type === 'Reservation' && i.reservationTerm === '1 Year') { model = 'commit-1y'; price = i.retailPrice / 8760; note = `Reserved Instance 1-yr: $${i.retailPrice} per term ÷ 8,760 h`; }
      if (!model) continue;
      const c = computeSpec.get(sku), g = gpuSpec.get(sku);
      const base = { provider: 'azure', regionId: i.armRegionName, productId: i.productId, sku, price, unit: 'hour', os: 'Linux', pricingModel: model,
        effectiveDate: i.effectiveStartDate, sourceApi: API, service: 'Azure Virtual Machines',
        sourceUrl: model === 'spot' ? 'https://azure.microsoft.com/pricing/spot-advisor/' : 'https://azure.microsoft.com/pricing/reserved-vm-instances/' };
      if (c) out.azure.compute[model].push(record({ ...base, category: 'compute', family: c.family, config: { vcpu: c.vcpu, memoryGiB: c.memoryGiB, arch: c.arch, cpu: c.cpu, note } }));
      if (g) out.azure.gpu[model].push(record({ ...base, category: 'gpu', family: sku.split('_')[1], config: { gpuModel: g.model, gpuCount: g.count, gpuMemGiB: g.memGiB, note } }));
    }
  });
}

// ── GCP Spot + 1-year CUD (Cloud Billing Catalog; needs GCP_API_KEY) ───────────────────────
if (process.env.GCP_API_KEY) {
  const KEY = process.env.GCP_API_KEY, API = 'https://cloudbilling.googleapis.com/v1';
  const svcs = await fetchJson(`${API}/services?pageSize=5000&key=${KEY}`);
  const svc = svcs.services.find((s) => s.displayName === 'Compute Engine');
  const ce = []; let token = '';
  do { const d = await fetchJson(`${API}/${svc.name}/skus?pageSize=5000&currencyCode=USD&key=${KEY}${token ? `&pageToken=${token}` : ''}`); ce.push(...(d.skus ?? [])); token = d.nextPageToken; } while (token);
  const unit = (s) => { const r = s.pricingInfo?.[0]?.pricingExpression?.tieredRates?.find((t) => +t.unitPrice.units || t.unitPrice.nanos); return r ? Number(r.unitPrice.units || 0) + (r.unitPrice.nanos || 0) / 1e9 : null; };
  const regionIds = regionsOf('gcp').map((r) => r.id);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const usage = { spot: 'Preemptible', 'commit-1y': 'Commit1Yr' };
  for (const [model, usageType] of Object.entries(usage)) {
    const pool2 = ce.filter((s) => s.category?.usageType === usageType && !/Custom|Sole|DWS|Reserved|Calendar/i.test(s.description));
    const find = (region, re) => pool2.find((s) => s.serviceRegions.includes(region) && re.test(s.description));
    for (const region of regionIds) {
      // GPU machines: core + RAM + GPU, same composition as on-demand
      for (const m of cat.gpu.gcp) {
        const fam = m.core.replace(' Instance', '').replace(' Predefined', '');
        const core = model === 'spot' ? find(region, new RegExp(`^Spot Preemptible ${esc(m.core)} Core running in`)) : find(region, new RegExp(`^Commitment v1: ${esc(fam)} (Cpu|Core) in`));
        const ram = model === 'spot' ? find(region, new RegExp(`^Spot Preemptible ${esc(m.core)} Ram running in`)) : find(region, new RegExp(`^Commitment v1: ${esc(fam)} Ram in`));
        const g = model === 'spot' ? find(region, new RegExp(`^${esc(m.gpuSku)} attached to Spot Preemptible VMs running in`)) : find(region, new RegExp(`^Commitment v1: ${esc(m.gpuSku)} running in`));
        const [pc, pr, pg] = [core, ram, g].map((s) => s && unit(s)); if (!pc || !pr || !pg) continue;
        out.gcp.gpu[model].push(record({ provider: 'gcp', regionId: region, category: 'gpu', service: 'Compute Engine', family: m.machine.split('-')[0], pricingModel: model,
          sku: m.machine, productId: `${core.skuId}+${ram.skuId}+${g.skuId}`, price: m.vcpu * pc + m.memGiB * pr + m.count * pg, unit: 'hour', os: 'Linux',
          config: { vcpu: m.vcpu, memoryGiB: m.memGiB, gpuModel: m.model, gpuCount: m.count, gpuMemGiB: m.gpuMem, availabilityVerified: false, note: model === 'spot' ? 'Spot VM; preemptible' : '1-year committed use discount' },
          effectiveDate: g.pricingInfo[0].effectiveTime, sourceUrl: 'https://cloud.google.com/compute/gpus-pricing', sourceApi: API }));
      }
      for (const fam of cat.gcpCompute) {
        const pfx = model === 'spot' ? `Spot Preemptible ${fam.skuPrefix}` : `Commitment v1: ${fam.skuPrefix.replace(' Instance', '')} `;
        const core = find(region, new RegExp(`^${esc(pfx)}.*(Core|Cpu)`)), ram = find(region, new RegExp(`^${esc(pfx)}.*Ram`));
        const pc = core && unit(core), pr = ram && unit(ram); if (!pc || !pr) continue;
        for (const n of fam.sizes) out.gcp.compute[model].push(record({ provider: 'gcp', regionId: region, category: 'compute', service: 'Compute Engine', family: fam.family, pricingModel: model,
          sku: `${fam.family}-${n}`, productId: `${core.skuId}+${ram.skuId}`, price: n * pc + n * fam.memPerVcpu * pr, unit: 'hour', os: 'Linux',
          config: { vcpu: n, memoryGiB: n * fam.memPerVcpu, arch: fam.arch, cpu: fam.cpu, note: model === 'spot' ? 'Spot VM; preemptible' : '1-year resource-based committed use discount' },
          effectiveDate: core.pricingInfo[0].effectiveTime, sourceUrl: model === 'spot' ? 'https://cloud.google.com/spot-vms/pricing' : 'https://cloud.google.com/compute/docs/instances/committed-use-discounts-overview', sourceApi: API }));
      }
    }
  }
} else console.log('GCP discounts: GCP_API_KEY not set — skipped');

for (const [p, cats] of Object.entries(out)) for (const [c, ms] of Object.entries(cats)) for (const [m, recs] of Object.entries(ms)) writeOut(`${p}-${c}-${m}`, recs);
