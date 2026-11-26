import { useState } from 'react';

/** Plain-language definitions shown on hover/focus of key terms. */
export const GLOSSARY: Record<string, { term: string; def: string }> = {
  az: { term: 'Availability zone (AZ)', def: 'A physically separate data-centre group inside a region with its own power and networking. Spreading across AZs protects you from a single-facility outage.' },
  region: { term: 'Region', def: 'A geographic area where a provider runs data centres. You choose one when you create resources; prices and services differ by region.' },
  egress: { term: 'Egress', def: 'Data leaving the cloud — to the internet or another region. Providers charge per GB for it; inbound data is usually free.' },
  ondemand: { term: 'On-demand', def: 'Pay-as-you-go list price, billed per hour or second, no commitment. The baseline every other model is compared against.' },
  spot: { term: 'Spot', def: 'Spare capacity sold at a deep discount that the provider can reclaim at short notice. Good for batch and fault-tolerant work. AWS spot prices move continuously; we show a snapshot.' },
  commit: { term: '1-year commitment', def: 'A discount for committing to a year of usage: Azure Reserved VM Instances or Google committed-use discounts. AWS Reserved Instances / Savings Plans are not ingested yet.' },
  rtt: { term: 'Round-trip time (RTT)', def: 'How long a packet takes to reach a region and come back. Shown here as an ESTIMATE from distance (fibre speed × typical route detour), not a measurement.' },
  residency: { term: 'Data residency', def: 'A requirement that data is stored and processed inside a particular country or bloc (e.g. the EU) — often legal or contractual.' },
  sovereignty: { term: 'Region type', def: 'Commercial regions are general-purpose. Government regions (e.g. AWS GovCloud, Azure Government) and sovereign clouds serve regulated customers and need separate accounts. Partner-operated regions (e.g. Jio India) are run with a local partner.' },
  carbon: { term: 'Grid carbon intensity', def: 'Grams of CO₂-equivalent emitted per kWh on the local electricity grid. Lower is cleaner. Google publishes this per region; AWS and Azure do not publish comparable per-region figures.' },
  cfe: { term: 'Carbon-free energy (CFE%)', def: "Google's hourly-matched share of a region's electricity that came from carbon-free sources. Google labels a region low-carbon at ≥ 75% CFE." },
  vcpu: { term: 'vCPU', def: 'A virtual CPU — usually one hardware thread. Equal vCPU counts across providers do not mean equal performance; CPU generations differ.' },
};

export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: React.ReactNode }) {
  const g = GLOSSARY[k]; const [open, setOpen] = useState(false);
  if (!g) return <>{children}</>;
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} tabIndex={0}>
      <span className="border-b border-dotted border-[var(--ink-3)] cursor-help">{children ?? g.term}</span>
      {open && (
        <span className="absolute z-[60] left-0 top-[calc(100%+6px)] w-[250px] block normal-case tracking-normal text-left p-2.5 bg-[#03060c] border border-[var(--line-2)] border-l-2 border-l-[var(--accent)] shadow-[0_8px_30px_rgba(0,0,0,.6)]" role="tooltip">
          <span className="block cond text-[10px] tracking-[0.14em] uppercase text-[var(--accent)] mb-1">{g.term}</span>
          <span className="block text-[11px] leading-snug text-[var(--ink-2)] font-[var(--sans)]" style={{ fontFamily: 'var(--sans)' }}>{g.def}</span>
        </span>
      )}
    </span>
  );
}
