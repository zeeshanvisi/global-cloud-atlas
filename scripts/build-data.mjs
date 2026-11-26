// Merges provider outputs into the frontend data layer:
//   public/data/regions.json             — region metadata, sovereignty, carbon (visualization data)
//   public/data/pricing/<cat>.json        — on-demand PriceRecords per category, all providers
//   public/data/pricing/<cat>-<model>.json — discounted models (spot, commit-1y), never mixed with on-demand
//   public/data/manifest.json             — freshness + coverage per provider/category/model
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, OUT_DIR, regionsOf, fetchJson, NOW } from './ingest/lib.mjs';

const providers = ['aws', 'azure', 'gcp'];
const cats = ['compute', 'gpu', 'storage', 'network', 'database', 'ai'];
const discountModels = ['spot', 'commit-1y'];
const manifest = { generatedAt: NOW, providers: {}, discounts: {}, carbon: null, sampleData: false };
const pub = path.join(ROOT, 'public/data');

function merge(c, model) {
  const all = []; const suffix = model ? `-${model}` : '';
  for (const p of providers) {
    const f = path.join(OUT_DIR, `${p}-${c}${suffix}.json`);
    const slot = model ? ((manifest.discounts[model] ??= {})[p] ??= {}) : (manifest.providers[p] ??= {});
    if (!fs.existsSync(f)) { slot[c] = { status: 'unavailable', count: 0 }; continue; }
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    let recs = d.records;
    if (c === 'ai') recs = recs.filter((r) => /gpt-4o|gpt-4\.1|gpt-5|o3|o4-mini/i.test(r.sku) && !/Data Zone|DZ|Regional|rgnl|Glbl|Global/i.test(r.sku + r.config.product)).slice(0, 4000);
    recs.forEach((r, i) => (r.id = `${p}:${c}${suffix}:${r.regionId}:${r.sku}:${i}`));
    all.push(...recs);
    slot[c] = { status: recs.length ? 'verified' : 'unavailable', count: recs.length, generatedAt: d.generatedAt };
  }
  fs.writeFileSync(path.join(OUT_DIR, `${c}${suffix}.json`), JSON.stringify(all));
}
for (const c of cats) merge(c);
for (const m of discountModels) for (const c of ['compute', 'gpu']) merge(c, m);

// AWS regional service availability (official regional services table)
let awsServices = {};
try {
  const t = await fetchJson('https://api.regional-table.region-services.aws.a2z.com/index.json');
  for (const x of t.prices) (awsServices[x.attributes['aws:region']] ??= []).push(x.attributes['aws:serviceName']);
} catch (e) { console.warn('aws services table', e.message); }

// Carbon: Google publishes per-region carbon-free energy % and grid intensity. AWS and Azure publish no
// equivalent per-region figures, so those stay null (shown as "not published", never estimated).
const CARBON_URL = 'https://raw.githubusercontent.com/GoogleCloudPlatform/region-carbon-info/main/data/yearly/2025.csv';
const carbon = {};
try {
  const res = await fetch(CARBON_URL); const csv = await res.text();
  for (const line of csv.trim().split('\n').slice(1)) {
    const [id, , cfe, intensity] = line.split(',');
    carbon[id] = { cfe: cfe === '' ? null : Number(cfe), gridIntensity: intensity === '' ? null : Number(intensity) };
  }
  manifest.carbon = { source: CARBON_URL, year: 2025, providers: { gcp: 'verified', aws: 'not published', azure: 'not published' } };
} catch (e) { console.warn('carbon', e.message); }

// Sovereignty class — derived from official region names
const sovereignty = (p, id, name) =>
  /gov/i.test(id) || /GovCloud|Gov /i.test(name) ? 'government' : /^eusc-/.test(id) || /Sovereign/i.test(name) ? 'sovereign' : /^jioindia/.test(id) ? 'partner' : 'commercial';

const regions = providers.flatMap((p) => regionsOf(p).map((r) => {
  const c = p === 'gcp' ? carbon[r.id] : null;
  return {
    ...r, provider: p, key: `${p}:${r.id}`,
    services: p === 'aws' && awsServices[r.id] ? [...new Set(awsServices[r.id])].sort() : null,
    sovereignty: sovereignty(p, r.id, r.name),
    carbon: c ? { ...c, lowCarbon: c.cfe != null ? c.cfe >= 0.75 : c.gridIntensity != null ? c.gridIntensity <= 200 : null, year: 2025 } : null,
  };
}));
fs.writeFileSync(path.join(pub, 'regions.json'), JSON.stringify({ generatedAt: NOW, regions }));
fs.writeFileSync(path.join(pub, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('regions', regions.length, 'carbon', Object.keys(carbon).length);
console.log(JSON.stringify(manifest.discounts));
