# Global Cloud Atlas

Interactive 3D globe of AWS, Azure and GCP infrastructure and pricing. React + TypeScript + Three.js (React Three Fiber/Drei), Tailwind, Zustand, Recharts.

```bash
npm install
npm run dev          # app
npm run ingest       # refresh pricing from official sources, then rebuild public/data
```

## Architecture

| Layer | Path | Notes |
|---|---|---|
| Source data (curated, no prices) | `data/source/regions/*.json`, `data/source/catalog.json` | Region IDs, metro, AZ count (`null` = not verified), product specs (GPU model/count) |
| Raw API cache | `data/raw/` (gitignored) | Every fetched response, for auditability |
| Ingestion pipelines | `scripts/ingest/{aws,azure,gcp}.mjs` | Node only; never bundled into the frontend |
| Normalization / merge | `scripts/build-data.mjs` | Writes `public/data/{regions,manifest}.json` and `public/data/pricing/<category>.json` |
| Domain model | `src/domain/types.ts` | `Region`, `PriceRecord` (provider, region, service, productId, config, currency, price, unit, pricingModel, effectiveDate, lastUpdated, sourceUrl) |
| Data access + cache | `src/data/loader.ts` | Lazy per-category loading + per-region index |
| Comparison engine | `src/engine/compare.ts` | Like-for-like selection; no winner unless ≥2 providers have verified comparable data |
| Geo | `src/engine/geo.ts` | Projection, clustering, cross-provider "markets" (≤400 km) |
| Lenses | `src/lenses/lenses.ts` | Each lens maps a region to a value |
| Globe | `src/globe/*` | Canvas-painted Natural Earth texture, border lines, atmosphere shader, instanced markers/spikes, DOM label projector |
| UI | `src/ui/*`, `src/search/*` | Panels, lens bar, search, compare/calculator |

Adding a provider means adding a `ProviderId`, a region file, and an ingest script. The UI needs no changes.

## Data sources and coverage

| | Source | Credentials |
|---|---|---|
| AWS regions | `b0.p.awsstatic.com/locations` + AWS Regional Services List | none |
| AWS EC2/GPU | AWS pricing-page JSON (same data as aws.amazon.com/ec2/pricing) | none |
| AWS S3, data transfer, RDS | AWS Price List Bulk API | none |
| Azure everything | Azure Retail Prices API | none |
| GCP pricing | Cloud Billing Catalog API | **`GCP_API_KEY`** (server-side env only, see `.env.example`) |

Not yet ingested (shown as *unavailable*, never estimated): GCP managed databases, AWS EBS, AWS Bedrock, Azure Files, CDN and private connectivity, and all discounted pricing models (reserved, savings plans, spot, CUD/SUD).

GCP GPU prices are composed from vCPU + RAM + GPU SKUs (bundled local SSD excluded); a listed price does not prove regional GPU capacity, so GCP GPU availability is flagged as unverified. GCP egress uses the cheapest premium-tier destination group.

Data-centre coordinates are not published by any provider. Markers sit at the published metro (`precision` field), and availability zones are drawn schematically.

## Decision features

- **Region Finder** (`F`): set where your users are (city, click on globe, or browser location), pick a workload template and pricing model, add residency / latency / region-type constraints and weight cost vs latency vs carbon. Ranks every eligible region with an itemised monthly bill. Logic: `src/engine/finder.ts`, `src/engine/templates.ts`.
- **Latency**: distance-based *estimates* only (`src/engine/latency.ts`): RTT ≈ 2 ms + distance × 1.5 route factor ÷ 200 km/ms in fibre, both directions. Not measurements.
- **Carbon**: Google's published 2025 per-region CFE% and grid intensity ([region-carbon-info](https://github.com/GoogleCloudPlatform/region-carbon-info)). AWS and Azure publish no comparable per-region figures, so they show as "not published".
- **Pricing models**: `spot` (AWS spot snapshot, Azure Spot, GCP Spot) and `commit-1y` (Azure 1-year RI, GCP 1-year CUD) are stored in separate files (`*-spot.json`, `*-commit-1y.json`) and never mixed with on-demand. AWS RI / Savings Plans are not ingested. `npm run ingest:discounts`.
- **Sovereignty filters**: commercial / government / sovereign / partner-operated, plus single-country filtering.
- **Sharing**: the URL hash always encodes the current view; "Share" copies it. CSV export is in the region dossier and the Compare drawer.
- **First-run guide** (`?`) and glossary tooltips on key terms.

## Deploying

GitHub Pages rebuilds automatically on every push to `main` (`.github/workflows/deploy.yml`).

If `git push` is blocked on your network, commit locally and run `npm run deploy:api`. It publishes your latest commit through the GitHub API using the signed-in `gh` CLI (`scripts/deploy/api_push.py`). It refuses to run with uncommitted changes or if GitHub has commits you don't, and afterwards re-syncs your local branch.
