// Provider-agnostic domain model. Adding a provider = adding a ProviderId + its ingest script.
export type ProviderId = 'aws' | 'azure' | 'gcp';
export type Category = 'compute' | 'gpu' | 'storage' | 'network' | 'database' | 'ai';
export type PricingModel = 'on-demand' | 'spot' | 'commit-1y';
export const PRICING_MODELS: Record<PricingModel, { label: string; short: string; note: string }> = {
  'on-demand': { label: 'On-demand', short: 'on-demand', note: 'Pay-as-you-go list price' },
  spot: { label: 'Spot', short: 'spot', note: 'Interruptible capacity; AWS spot is a point-in-time snapshot' },
  'commit-1y': { label: '1-yr commit', short: '1y commit', note: 'Azure 1-yr Reserved Instance or GCP 1-yr CUD; AWS reserved pricing not ingested' },
};
export type Sovereignty = 'commercial' | 'government' | 'sovereign' | 'partner';
export type CoordPrecision = 'city' | 'state' | 'country';

export interface Region {
  key: string;            // `${provider}:${id}`
  provider: ProviderId;
  id: string;             // provider region identifier, e.g. ap-south-1
  name: string;           // provider display name
  city: string;
  country: string;        // ISO-3166 alpha-2
  lat: number; lon: number;
  precision: CoordPrecision;
  azs: number | null;     // null = not verified
  services: string[] | null; // null = not available from an official machine-readable source
  sovereignty: Sovereignty;
  carbon: { cfe: number | null; gridIntensity: number | null; lowCarbon: boolean | null; year: number } | null; // GCP only — others don't publish
  dlat?: number; dlon?: number; // display-only position (de-overlapped); never used for distance maths
}

export interface PriceRecord {
  id: string;
  provider: ProviderId;
  regionId: string;
  category: Category;
  service: string;
  productId: string;
  sku: string;
  family?: string;
  config: Record<string, any>;
  currency: 'USD';
  price: number;
  unit: string;           // 'hour' | 'GB-month' | 'GB' | '1M tokens' ...
  pricingModel: PricingModel;
  effectiveDate?: string;
  lastUpdated: string;
  sourceUrl: string;
  sourceApi?: string;
  os?: string;
  storageType?: 'object' | 'block' | 'file';
  tier?: string;
  metric?: 'internet-egress' | 'inter-region';
  engine?: string;
  aiKind?: 'managed-api' | 'gpu-infra';
}

export interface Manifest {
  generatedAt: string;
  sampleData: boolean;
  providers: Record<ProviderId, Partial<Record<Category, { status: 'verified' | 'unavailable'; count: number; generatedAt?: string }>>>;
  discounts?: Record<string, Record<ProviderId, Partial<Record<Category, { status: 'verified' | 'unavailable'; count: number }>>>>;
  carbon?: { source: string; year: number } | null;
}

export const PROVIDERS: Record<ProviderId, { label: string; color: string; hex: number }> = {
  aws: { label: 'AWS', color: '#34d399', hex: 0x34d399 },
  azure: { label: 'Azure', color: '#60a5fa', hex: 0x60a5fa },
  gcp: { label: 'GCP', color: '#facc15', hex: 0xfacc15 },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const HOURS_MONTH = 730;
export const HOURS_YEAR = 8760;
