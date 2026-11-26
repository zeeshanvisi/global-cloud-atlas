// Shared helpers for pricing ingestion. Runs in Node only — never bundled into the frontend.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const RAW_DIR = path.join(ROOT, 'data/raw');
export const OUT_DIR = path.join(ROOT, 'public/data/pricing');
export const NOW = new Date().toISOString();

export const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
export const regionsOf = (provider) =>
  readJson(`data/source/regions/${provider}.json`).regions.map(([id, name, city, country, lat, lon, azs, precision]) => ({ id, name, city, country, lat, lon, azs, precision }));
export const catalog = () => readJson('data/source/catalog.json');

/** Fetch JSON with an on-disk raw cache (data/raw) so re-runs are cheap and auditable. */
export async function fetchJson(url, { cacheHours = 20, headers = {} } = {}) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(RAW_DIR, `${key}.json`);
  if (fs.existsSync(file) && (Date.now() - fs.statSync(file).mtimeMs) / 36e5 < cacheHours) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'accept-encoding': 'gzip', ...headers } });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const text = await res.text();
    fs.writeFileSync(file, text);
    return JSON.parse(text);
  }
  throw new Error(`retries exhausted ${url}`);
}

export async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { console.warn('  !', e.message); out[idx] = null; } }
  }));
  return out;
}

/** Every record follows the PriceRecord schema in src/domain/types.ts */
export function record(r) {
  if (!(typeof r.price === 'number' && isFinite(r.price))) throw new Error('bad price ' + JSON.stringify(r));
  return { currency: 'USD', pricingModel: 'on-demand', lastUpdated: NOW, ...r };
}

export function writeOut(name, records, meta = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: NOW, count: records.length, ...meta, records }));
  console.log(`  wrote ${records.length} records → public/data/pricing/${name}.json`);
}
