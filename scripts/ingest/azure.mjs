// Azure ingestion — Azure Retail Prices API (public, no credentials): https://prices.azure.com/api/retail/prices
import { fetchJson, regionsOf, catalog, record, writeOut, pool } from './lib.mjs';

const API = 'https://prices.azure.com/api/retail/prices';
const regions = regionsOf('azure');
const cat = catalog();

async function query(filter) {
  let url = `${API}?$filter=${encodeURIComponent(filter)}`; const items = [];
  while (url) { const d = await fetchJson(url); items.push(...d.Items); url = d.NextPageLink; }
  return items;
}
const isPayg = (i) => i.type === 'Consumption' && !/Spot|Low Priority/.test(i.skuName + i.meterName);
const base = (i) => ({ provider: 'azure', regionId: i.armRegionName, productId: i.productId, sku: i.armSkuName || i.skuName,
  price: i.retailPrice, effectiveDate: i.effectiveStartDate, sourceApi: API });

const computeSpec = new Map();
for (const f of cat.azureCompute) for (const n of f.sizes)
  computeSpec.set(f.pattern.replace('{n}', n), { family: f.family, vcpu: n, memoryGiB: n * f.memPerVcpu, arch: f.arch, cpu: f.cpu });
const gpuSpec = new Map(cat.gpu.azure.map(([s, model, count, mem]) => [s, { model, count, memGiB: mem }]));
const known = new Set(regions.map((r) => r.id));

const compute = [], gpu = [], storage = [], network = [], database = [], ai = [];
const skuList = (skus) => '(' + skus.map((s) => `armSkuName eq '${s}'`).join(' or ') + ')';

// Compute & GPU: query per SKU across all regions (fewer calls than per region).
const vmSkus = [...computeSpec.keys(), ...gpuSpec.keys()];
await pool(vmSkus, 6, async (sku) => {
  const items = await query(`serviceName eq 'Virtual Machines' and priceType eq 'Consumption' and armSkuName eq '${sku}'`);
  for (const i of items) {
    if (!isPayg(i) || !known.has(i.armRegionName) || /Windows/.test(i.productName) || i.unitOfMeasure !== '1 Hour') continue;
    const c = computeSpec.get(sku), g = gpuSpec.get(sku);
    const common = { ...base(i), unit: 'hour', os: 'Linux', family: c?.family ?? sku.split('_')[1],
      sourceUrl: 'https://azure.microsoft.com/pricing/details/virtual-machines/linux/' };
    if (c) compute.push(record({ ...common, category: 'compute', service: 'Azure Virtual Machines', config: { vcpu: c.vcpu, memoryGiB: c.memoryGiB, arch: c.arch, cpu: c.cpu } }));
    if (g) gpu.push(record({ ...common, category: 'gpu', service: 'Azure Virtual Machines', config: { gpuModel: g.model, gpuCount: g.count, gpuMemGiB: g.memGiB } }));
  }
  process.stdout.write('.');
});

await pool(regions, 6, async (r) => {
  const R = `armRegionName eq '${r.id}'`;
  // Object storage — Block Blob Hot LRS, first tier
  const blob = await query(`${R} and serviceName eq 'Storage' and productName eq 'General Block Blob v2' and meterName eq 'Hot LRS Data Stored'`);
  const first = blob.filter(isPayg).sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits)[0];
  if (first) storage.push(record({ ...base(first), category: 'storage', storageType: 'object', tier: 'Blob Hot LRS', service: 'Azure Blob Storage', unit: 'GB-month', sku: 'Hot LRS',
    sourceUrl: 'https://azure.microsoft.com/pricing/details/storage/blobs/' }));
  // Block storage — Premium SSD v2 capacity (per GiB-hour → GiB-month at 730h) + Standard SSD E10
  const disks = await query(`${R} and serviceName eq 'Storage' and (meterName eq 'Premium LRS Provisioned Capacity' or meterName eq 'P10 LRS Disk' or meterName eq 'E10 LRS Disk')`);
  for (const i of disks.filter(isPayg)) {
    if (i.meterName === 'Premium LRS Provisioned Capacity' && /Premium SSD v2/.test(i.productName))
      storage.push(record({ ...base(i), category: 'storage', storageType: 'block', tier: 'Premium SSD v2 (capacity)', service: 'Azure Managed Disks', unit: 'GB-month',
        price: /Hour/.test(i.unitOfMeasure) ? i.retailPrice * 730 : i.retailPrice, config: { rawUnit: i.unitOfMeasure, note: 'Capacity only; IOPS above 3,000 and throughput above 125 MB/s billed separately' },
        sourceUrl: 'https://azure.microsoft.com/pricing/details/managed-disks/' }));
    if (/^(P10|E10) LRS Disk$/.test(i.meterName) && /Month/.test(i.unitOfMeasure))
      storage.push(record({ ...base(i), category: 'storage', storageType: 'block', tier: i.meterName.startsWith('P') ? 'Premium SSD P10 (128 GiB)' : 'Standard SSD E10 (128 GiB)',
        service: 'Azure Managed Disks', unit: 'GB-month', price: i.retailPrice / 128, config: { diskPricePerMonth: i.retailPrice, diskGiB: 128 },
        sourceUrl: 'https://azure.microsoft.com/pricing/details/managed-disks/' }));
  }
  // Networking — internet egress (Microsoft premium routing), inter-region
  const bw = await query(`${R} and serviceName eq 'Bandwidth'`);
  const egress = bw.filter((i) => isPayg(i) && i.productName === 'Rtn Preference: MGN' && i.meterName === 'Standard Data Transfer Out' && i.retailPrice > 0)
    .sort((a, b) => a.tierMinimumUnits - b.tierMinimumUnits)[0];
  if (egress) network.push(record({ ...base(egress), category: 'network', metric: 'internet-egress', service: 'Azure Bandwidth', unit: 'GB', sku: egress.meterName,
    config: { tierFromGB: egress.tierMinimumUnits, routing: 'Microsoft premium global network', to: 'Internet' }, sourceUrl: 'https://azure.microsoft.com/pricing/details/bandwidth/' }));
  const inter = bw.find((i) => isPayg(i) && i.meterName === 'Standard Inter-Region Data Transfer' && i.productName === 'Rtn Preference: MGN');
  if (inter) network.push(record({ ...base(inter), category: 'network', metric: 'inter-region', service: 'Azure Bandwidth', unit: 'GB', sku: inter.meterName,
    config: { to: 'Other Azure region (same continent pricing applies per Microsoft schedule)' }, sourceUrl: 'https://azure.microsoft.com/pricing/details/bandwidth/' }));
  // Databases — PostgreSQL / MySQL flexible server, General Purpose Ddsv5 vCore
  const db = await query(`${R} and (serviceName eq 'Azure Database for PostgreSQL' or serviceName eq 'Azure Database for MySQL') and priceType eq 'Consumption'`);
  for (const i of db.filter(isPayg)) {
    const m = /^(\d+) vCore$/.exec(i.skuName);
    if (!m || !/Flexible Server General Purpose Ddsv5/.test(i.productName) || i.unitOfMeasure !== '1 Hour') continue;
    const vcpu = Number(m[1]);
    database.push(record({ ...base(i), category: 'database', engine: /PostgreSQL/.test(i.serviceName) ? 'PostgreSQL' : 'MySQL', service: i.serviceName + ' — Flexible Server',
      sku: `GP_Standard_D${vcpu}ds_v5`, unit: 'hour', config: { vcpu, memoryGiB: vcpu * 4, deployment: 'Single zone (no HA)' },
      sourceUrl: /PostgreSQL/.test(i.serviceName) ? 'https://azure.microsoft.com/pricing/details/postgresql/flexible-server/' : 'https://azure.microsoft.com/pricing/details/mysql/flexible-server/' }));
  }
  // Managed AI — Azure OpenAI is listed under 'Foundry Models' / 'Cognitive Services'; take a small set of meter names
  const aoai = await query(`${R} and (serviceName eq 'Foundry Models' or productName eq 'Azure OpenAI') and priceType eq 'Consumption'`);
  for (const i of aoai.filter(isPayg)) {
    if (!/1K|1M/.test(i.unitOfMeasure) || !/(inp|outp|Inp|Outp)/.test(i.meterName) || /Batch|cached|Cached|Fine|Audio|aud|Rltm|realtime/i.test(i.meterName)) continue;
    ai.push(record({ ...base(i), category: 'ai', aiKind: 'managed-api', service: 'Azure OpenAI / Foundry Models', sku: i.meterName, unit: i.unitOfMeasure + ' tokens',
      config: { product: i.productName, deployment: i.skuName }, sourceUrl: 'https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/' }));
  }
  process.stdout.write('+');
});
console.log('\nAzure:');
writeOut('azure-compute', compute); writeOut('azure-gpu', gpu); writeOut('azure-storage', storage);
writeOut('azure-network', network); writeOut('azure-database', database); writeOut('azure-ai', ai);
