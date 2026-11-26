// AWS ingestion — public, credential-free sources:
//  • EC2 on-demand (Linux): AWS pricing-page JSON (same data the AWS Pricing Calculator/pricing page uses)
//  • S3, Data Transfer, RDS: AWS Price List Bulk API (pricing.us-east-1.amazonaws.com offer files)
import { fetchJson, regionsOf, catalog, record, writeOut, pool } from './lib.mjs';

const regions = regionsOf('aws');
const cat = catalog();
const gpuSpec = new Map(cat.gpu.aws.map(([t, model, count, mem]) => [t, { model, count, memGiB: mem }]));
const BULK = 'https://pricing.us-east-1.amazonaws.com';
const locNames = await fetchJson('https://b0.p.awsstatic.com/locations/1.0/aws/current/locations.json');
const nameOf = Object.fromEntries(Object.values(locNames).filter((v) => v.type === 'AWS Region').map((v) => [v.code, v.name]));

const compute = [], gpu = [], storage = [], network = [], database = [];
const coverage = {};

function firstOnDemand(offer, sku) {
  const terms = offer.terms?.OnDemand?.[sku]; if (!terms) return [];
  return Object.values(terms).flatMap((t) => Object.values(t.priceDimensions)).map((d) => ({ ...d, usd: parseFloat(d.pricePerUnit.USD) }));
}

await pool(regions, 6, async (r) => {
  coverage[r.id] = {};
  const loc = nameOf[r.id];
  // ── EC2 compute + GPU ─────────────────────────────────────────────
  if (loc) {
    const url = `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(loc)}/Linux/index.json`;
    try {
      const d = await fetchJson(url);
      const effective = d.manifest?.hawkFilePublicationDate;
      for (const it of Object.values(Object.values(d.regions)[0] ?? {})) {
        const type = it['Instance Type']; const fam = type.split('.')[0];
        const price = parseFloat(it.price); if (!(price > 0)) continue;
        const vcpu = parseInt(it.vCPU); const mem = parseFloat(it.Memory);
        const arch = /g(d|n)?$/.test(fam) && /^(m|c|r|t)\d/.test(fam) ? 'arm64' : 'x86_64';
        const base = { provider: 'aws', regionId: r.id, productId: it.rateCode, sku: type, price, unit: 'hour', effectiveDate: effective,
          sourceUrl: 'https://aws.amazon.com/ec2/pricing/on-demand/', sourceApi: url, os: 'Linux' };
        if (cat.awsComputeFamilies.includes(fam)) {
          compute.push(record({ ...base, category: 'compute', service: 'Amazon EC2', family: fam,
            config: { vcpu, memoryGiB: mem, arch, instanceFamily: it['Instance Family'], network: it['Network Performance'] } }));
        }
        const g = gpuSpec.get(type);
        if (g) gpu.push(record({ ...base, category: 'gpu', service: 'Amazon EC2', family: fam,
          config: { vcpu, memoryGiB: mem, gpuModel: g.model, gpuCount: g.count, gpuMemGiB: g.memGiB } }));
      }
      coverage[r.id].compute = true;
    } catch (e) { console.warn('  ec2', r.id, e.message); }
  }
  // ── S3 Standard (object storage) ─────────────────────────────────
  try {
    const url = `${BULK}/offers/v1.0/aws/AmazonS3/current/${r.id}/index.json`;
    const o = await fetchJson(url);
    for (const [sku, p] of Object.entries(o.products)) {
      const a = p.attributes;
      if (a.storageClass === 'General Purpose' && a.volumeType === 'Standard' && /TimedStorage-ByteHrs$/.test(a.usagetype)) {
        const dims = firstOnDemand(o, sku).sort((x, y) => parseFloat(x.beginRange) - parseFloat(y.beginRange));
        if (dims[0]) storage.push(record({ provider: 'aws', regionId: r.id, category: 'storage', storageType: 'object', tier: 'S3 Standard',
          service: 'Amazon S3', productId: sku, sku: 'S3 Standard', price: dims[0].usd, unit: 'GB-month', config: { firstTierUpToGB: Number(dims[0].endRange) || null },
          effectiveDate: o.publicationDate, sourceUrl: 'https://aws.amazon.com/s3/pricing/', sourceApi: url }));
      }
    }
    coverage[r.id].storage = true;
  } catch (e) { console.warn('  s3', r.id, e.message); }
  // ── Data transfer out to Internet ────────────────────────────────
  try {
    const url = `${BULK}/offers/v1.0/aws/AWSDataTransfer/current/${r.id}/index.json`;
    const o = await fetchJson(url);
    for (const [sku, p] of Object.entries(o.products)) {
      const a = p.attributes;
      const isEgress = a.transferType === 'AWS Outbound' && a.toLocation === 'External';
      const isInter = a.transferType === 'InterRegion Outbound';
      if (!isEgress && !(isInter && !network.some((n) => n.regionId === r.id && n.metric === 'inter-region'))) continue;
      const dims = firstOnDemand(o, sku).filter((d) => d.usd > 0).sort((x, y) => parseFloat(x.beginRange) - parseFloat(y.beginRange));
      if (!dims[0]) continue;
      network.push(record({ provider: 'aws', regionId: r.id, category: 'network', metric: isEgress ? 'internet-egress' : 'inter-region',
        service: 'AWS Data Transfer', productId: sku, sku: a.usagetype, price: dims[0].usd, unit: 'GB',
        config: { tierFromGB: Number(dims[0].beginRange), tierToGB: dims[0].endRange === 'Inf' ? null : Number(dims[0].endRange), to: isEgress ? 'Internet' : a.toLocation },
        effectiveDate: o.publicationDate, sourceUrl: 'https://aws.amazon.com/ec2/pricing/on-demand/#Data_Transfer', sourceApi: url }));
    }
    coverage[r.id].network = true;
  } catch (e) { console.warn('  dt', r.id, e.message); }
  // ── RDS PostgreSQL / MySQL Single-AZ ─────────────────────────────
  try {
    const url = `${BULK}/offers/v1.0/aws/AmazonRDS/current/${r.id}/index.json`;
    const o = await fetchJson(url);
    for (const [sku, p] of Object.entries(o.products)) {
      const a = p.attributes;
      if (p.productFamily !== 'Database Instance' || a.deploymentOption !== 'Single-AZ') continue;
      if (!['PostgreSQL', 'MySQL'].includes(a.databaseEngine)) continue;
      if (!/^db\.(m6i|m7g|m7i|m8g|r7g|t4g)\./.test(a.instanceType)) continue;
      const d = firstOnDemand(o, sku)[0]; if (!d || !(d.usd > 0)) continue;
      database.push(record({ provider: 'aws', regionId: r.id, category: 'database', engine: a.databaseEngine, service: 'Amazon RDS',
        productId: sku, sku: a.instanceType, price: d.usd, unit: 'hour',
        config: { vcpu: Number(a.vcpu), memoryGiB: parseFloat(a.memory), deployment: 'Single-AZ' },
        effectiveDate: o.publicationDate, sourceUrl: `https://aws.amazon.com/rds/${a.databaseEngine === 'MySQL' ? 'mysql' : 'postgresql'}/pricing/`, sourceApi: url }));
    }
    coverage[r.id].database = true;
  } catch (e) { console.warn('  rds', r.id, e.message); }
  process.stdout.write('.');
});
console.log('\nAWS:');
writeOut('aws-compute', compute); writeOut('aws-gpu', gpu); writeOut('aws-storage', storage);
writeOut('aws-network', network); writeOut('aws-database', database, { coverage });
