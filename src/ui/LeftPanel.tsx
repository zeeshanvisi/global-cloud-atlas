import { useMemo, useState } from 'react';
import { useAtlas, filterRegions, ALL_SOVEREIGNTY } from '../store/useAtlas';
import { Term } from './Glossary';
import { PROVIDERS, PROVIDER_IDS, type Category } from '../domain/types';
import { lensById } from '../lenses/lenses';
import { WINNER_COLORS } from '../globe/GlobeScene';

const CATS: Category[] = ['compute', 'gpu', 'storage', 'network', 'database', 'ai'];
const CONTINENT: Record<string, string> = {
  US: 'North America', CA: 'North America', MX: 'North America', BR: 'South America', CL: 'South America',
  ZA: 'Africa', IL: 'Middle East', AE: 'Middle East', BH: 'Middle East', QA: 'Middle East', SA: 'Middle East',
  AU: 'Oceania', NZ: 'Oceania',
  IN: 'Asia', SG: 'Asia', JP: 'Asia', KR: 'Asia', HK: 'Asia', TW: 'Asia', ID: 'Asia', MY: 'Asia', TH: 'Asia',
};

export function Sec({ n, t, m, children, className = '' }: { n: string; t: string; m?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`sec ${className}`}>
      <div className="sec-h"><span className="sec-n">{n}</span><span className="sec-t">{t}</span>{m != null && <span className="sec-m">{m}</span>}</div>
      {children}
    </section>
  );
}

export function LeftPanel() {
  const regions = useAtlas((s) => s.regions), providers = useAtlas((s) => s.providers), manifest = useAtlas((s) => s.manifest);
  const origin = useAtlas((s) => s.origin);
  const lens = useAtlas((s) => s.lens), workload = useAtlas((s) => s.workload), highlight = useAtlas((s) => s.highlight), selected = useAtlas((s) => s.selected);
  const { set, select } = useAtlas.getState();
  const [filter, setFilter] = useState(''), [minAz, setMinAz] = useState(0);
  const regionFilter = useAtlas((s) => s.regionFilter);
  const vis = filterRegions({ regions, providers, regionFilter });
  const countryName = useMemo(() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } }, []);
  const allCountries = useMemo(() => [...new Set(regions.map((r) => r.country))].sort((a, b) => countryName(a).localeCompare(countryName(b))), [regions, countryName]);

  const byContinent = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const r of vis) { const c = CONTINENT[r.country] ?? 'Europe'; m[c] ??= { aws: 0, azure: 0, gcp: 0 }; m[c][r.provider]++; }
    return Object.entries(m).map(([c, v]) => ({ c, v, total: v.aws + v.azure + v.gcp })).sort((a, b) => b.total - a.total);
  }, [vis]);
  const maxC = Math.max(1, ...byContinent.map((x) => x.total));

  const list = vis.filter((r) => (r.azs ?? 0) >= minAz && (!highlight || highlight.keys.has(r.key)) &&
    (!filter || `${r.id} ${r.name} ${r.city}`.toLowerCase().includes(filter.toLowerCase())));
  const L = lensById(lens);
  const countries = new Set(vis.map((r) => r.country)).size;

  return (
    <aside className="rail rail-l">
      <Sec n="01" t="Footprint" m={`${vis.length} regions · ${countries} countries`}>
        <div className="grid grid-cols-3">
          {PROVIDER_IDS.map((p, i) => {
            const rs = regions.filter((r) => r.provider === p);
            return (
              <div key={p} className={`${i ? 'pl-3 border-l border-[var(--line)]' : ''} ${providers[p] ? '' : 'opacity-30'}`}>
                <div className="flex items-center gap-1.5 kv-k"><span className="sw" style={{ background: PROVIDERS[p].color }} />{PROVIDERS[p].label}</div>
                <div className="big mt-1.5">{String(rs.length).padStart(2, '0')}</div>
                <div className="mono text-[9.5px] text-[var(--ink-3)] mt-1">{rs.reduce((a, r) => a + (r.azs ?? 0), 0)}+ AZ</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 space-y-[5px]">
          {byContinent.map(({ c, v, total }) => (
            <div key={c} className="flex items-center gap-2">
              <span className="cond text-[9.5px] tracking-[0.08em] uppercase text-[var(--ink-3)] w-[84px] shrink-0">{c}</span>
              <div className="flex-1 flex h-[5px] bg-[rgba(150,180,220,0.04)]">
                {PROVIDER_IDS.filter((p) => providers[p]).map((p) => <div key={p} style={{ width: `${(v[p] / maxC) * 100}%`, background: PROVIDERS[p].color, opacity: 0.85 }} title={`${PROVIDERS[p].label}: ${v[p]}`} />)}
              </div>
              <span className="mono text-[9.5px] text-[var(--ink-2)] w-5 text-right">{total}</span>
            </div>
          ))}
        </div>
      </Sec>

      <Sec n="02" t={`Lens · ${L.label}`} m={`key ${L.key}`}>
        <p className="text-[11.5px] text-[var(--ink-2)] leading-snug font-light">{L.describe(workload, { origin })}</p>
        {lens === 'compare' && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2.5">
            {(['aws', 'azure', 'gcp', 'none'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5 mono text-[9.5px] text-[var(--ink-2)]">
                <span className="w-2.5 h-2.5 border" style={{ borderColor: WINNER_COLORS[k], background: `${WINNER_COLORS[k]}33` }} />
                {k === 'none' ? 'insufficient data' : `${PROVIDERS[k].label} cheapest`}
              </span>
            ))}
          </div>
        )}
        {lens !== 'infrastructure' && lens !== 'compare' && <p className="note mt-2">Beam height ∝ price. Dimmed markers have no verified comparable offering.</p>}
      </Sec>

      <Sec n="03" t="Verified sources">
        <table className="dt">
          <thead><tr><th />{PROVIDER_IDS.map((p) => <th key={p} className="n">{PROVIDERS[p].label}</th>)}</tr></thead>
          <tbody>
            {CATS.map((c) => (
              <tr key={c}><td className="cond uppercase tracking-[0.08em] text-[10px]">{c}</td>
                {PROVIDER_IDS.map((p) => { const s = manifest?.providers[p]?.[c]; const ok = s?.status === 'verified'; return (
                  <td key={p} className="n" title={ok ? `${s!.count} records from official source` : 'Not ingested — shown as unavailable'}>
                    {ok ? <span className="text-[var(--ink)]">{s!.count.toLocaleString()}</span> : <span className="text-[var(--ink-4)]">—</span>}
                  </td>); })}
              </tr>
            ))}
          </tbody>
        </table>
      </Sec>

      <section className="sec !border-b-0 !pb-2">
        <div className="sec-h !mb-2"><span className="sec-n">04</span><span className="sec-t">Regions</span><span className="sec-m">{list.length}</span></div>
        <div className="flex">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" className="field flex-1 h-[26px]" />
          <select value={minAz} onChange={(e) => setMinAz(+e.target.value)} className="field h-[26px] -ml-px" title="Minimum verified AZs">
            <option value={0}>any AZ</option><option value={3}>≥3 AZ</option><option value={4}>≥4 AZ</option>
          </select>
        </div>
        <div className="flex mt-1.5">
          <select value={regionFilter.country ?? ''} onChange={(e) => set({ regionFilter: { ...regionFilter, country: e.target.value || null } })} className="field h-[26px] flex-1" title="Show only regions in one country (data residency)">
            <option value="">all countries</option>
            {allCountries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <span className="kv-k mr-1"><Term k="sovereignty">Type</Term></span>
          {ALL_SOVEREIGNTY.map((sv) => { const on = regionFilter.sovereignty.includes(sv); const n = regions.filter((r) => r.sovereignty === sv).length; return (
            <button key={sv} className={`btn !h-[22px] !px-1.5 !text-[9.5px] ${on ? 'on' : 'off'}`} onClick={() => set({ regionFilter: { ...regionFilter, sovereignty: on ? regionFilter.sovereignty.filter((x) => x !== sv) : [...regionFilter.sovereignty, sv] } })}>
              {sv === 'commercial' ? 'comm' : sv === 'government' ? 'gov' : sv === 'sovereign' ? 'sovrn' : 'partner'} <span className="mono normal-case tracking-normal opacity-70">{n}</span>
            </button>); })}
        </div>
        {highlight && (
          <div className="mt-2 flex items-center gap-2 mono text-[10px] text-[var(--accent)] border border-[rgba(159,216,255,0.25)] px-2 py-1">
            <span className="truncate">{highlight.label} · {highlight.keys.size}</span>
            <button className="ml-auto text-[var(--ink-3)] hover:text-[var(--ink)]" onClick={() => set({ highlight: null })}>clear</button>
          </div>
        )}
      </section>
      <div className="flex-1 overflow-auto pb-2">
        {list.map((r) => (
          <button key={r.key} onClick={() => select(r.key)} onMouseEnter={() => set({ hovered: r.key })} onMouseLeave={() => set({ hovered: null })}
            className={`w-full text-left pl-4 pr-3 py-[5px] flex items-center gap-2.5 border-l-2 ${selected === r.key ? 'border-[var(--accent)] bg-[rgba(159,216,255,0.05)]' : 'border-transparent hover:bg-[rgba(150,180,220,0.03)]'}`}>
            <span className="sw" style={{ background: PROVIDERS[r.provider].color }} />
            <span className="text-[11.5px] text-[var(--ink-2)] truncate">{r.name}</span>
            <span className="mono text-[9.5px] text-[var(--ink-3)] ml-auto shrink-0">{r.id}</span>
          </button>
        ))}
        {!list.length && <div className="note px-4 py-2">No regions match.</div>}
      </div>
    </aside>
  );
}
