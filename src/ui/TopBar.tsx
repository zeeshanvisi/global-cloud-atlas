import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlas } from '../store/useAtlas';
import { PROVIDERS, PROVIDER_IDS } from '../domain/types';
import { buildSearch, type SearchResult } from '../search/search';
import { loadWorld, type Country } from '../data/world';
import { copyLink } from './share';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'SGD', 'BRL'];
const KIND_LABEL: Record<string, string> = { region: 'REGION', city: 'CITY', country: 'COUNTRY', provider: 'PROVIDER', service: 'SERVICE', instance: 'INSTANCE', gpu: 'GPU' };

export function ProviderToggles() {
  const providers = useAtlas((s) => s.providers), toggle = useAtlas((s) => s.toggleProvider), regions = useAtlas((s) => s.regions);
  return (
    <div className="flex">
      {PROVIDER_IDS.map((p, i) => (
        <button key={p} onClick={() => toggle(p)} aria-pressed={providers[p]}
          className={`btn ${providers[p] ? '' : 'off'} ${i ? '-ml-px' : ''}`} title={`Toggle ${PROVIDERS[p].label}`}>
          <span className="sw" style={{ background: providers[p] ? PROVIDERS[p].color : 'transparent', outline: `1px solid ${PROVIDERS[p].color}` }} />
          {PROVIDERS[p].label}
          <span className="mono text-[10px] text-[var(--ink-3)] normal-case tracking-normal hidden xl:inline">{regions.filter((r) => r.provider === p).length}</span>
        </button>
      ))}
    </div>
  );
}

function Search() {
  const regions = useAtlas((s) => s.regions), indexes = useAtlas((s) => s.indexes);
  const { select, flyTo, set, ensure } = useAtlas.getState();
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { loadWorld().then((w) => setCountries(w.countries)); ensure('compute'); ensure('gpu'); }, [ensure]);
  const search = useMemo(() => buildSearch(regions, countries, indexes), [regions, countries, indexes]);
  const results = useMemo(() => search(q), [search, q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== input.current) { e.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const choose = (r: SearchResult) => {
    setOpen(false); setQ(''); input.current?.blur();
    if (r.regionKey) { set({ highlight: null }); select(r.regionKey); return; }
    if (r.keys && r.kind !== 'city') set({ highlight: { label: `${KIND_LABEL[r.kind]} · ${r.label}`, keys: new Set(r.keys) } });
    else set({ highlight: r.keys ? { label: r.label, keys: new Set(r.keys) } : null });
    if (r.lat != null) flyTo(r.lat, r.lon!, r.kind === 'country' ? 2.6 : 2.0);
    if (r.kind === 'city' && r.keys?.length === 1) select(r.keys[0]);
  };

  return (
    <div className="relative w-[340px] max-w-[26vw] min-w-[150px]">
      <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-3)]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input ref={input} value={q} placeholder="region, city, country, service, gpu…"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, results.length - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter' && results[active]) choose(results[active]);
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
        }}
        className="field w-full pl-8 pr-8" />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 mono text-[9.5px] text-[var(--ink-3)] border border-[var(--line)] px-1">/</span>
      {open && results.length > 0 && (
        <div className="absolute top-[31px] left-0 right-0 z-50 border border-[var(--line-2)] bg-[#03060c]/96 backdrop-blur max-h-[60vh] overflow-auto">
          {results.map((r, i) => (
            <button key={r.kind + r.label + r.sub} onMouseDown={() => choose(r)} onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-3 py-[7px] flex items-center gap-2.5 border-b border-[var(--line)] ${i === active ? 'bg-[rgba(159,216,255,0.06)]' : ''}`}>
              <span className="cond text-[9px] tracking-[0.14em] text-[var(--ink-3)] w-[58px] shrink-0">{KIND_LABEL[r.kind]}</span>
              {r.provider && <span className="sw" style={{ background: PROVIDERS[r.provider].color }} />}
              <span className="text-[12px] text-[var(--ink)] truncate">{r.label}</span>
              <span className="mono text-[10px] text-[var(--ink-3)] truncate ml-auto">{r.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const manifest = useAtlas((s) => s.manifest), currency = useAtlas((s) => s.currency), fx = useAtlas((s) => s.fx), set = useAtlas((s) => s.set);
  const compareOpen = useAtlas((s) => s.compareOpen), finderOpen = useAtlas((s) => s.finderOpen);
  const [copied, setCopied] = useState<string | null>(null);
  const age = manifest ? (Date.now() - new Date(manifest.generatedAt).getTime()) / 36e5 : null;
  const fresh = age == null ? 'SYNC' : age < 48 ? 'LIVE' : age < 24 * 14 ? 'AGING' : 'STALE';
  const color = { SYNC: 'var(--ink-3)', LIVE: 'var(--aws)', AGING: 'var(--warn)', STALE: '#ef4444' }[fresh];
  return (
    <header className="absolute top-0 inset-x-0 z-30 h-11 flex items-center gap-5 pl-4 pr-3 border-b border-[var(--line)] bg-[var(--bg)]/80 backdrop-blur">
      <div className="flex items-center gap-2.5 select-none shrink-0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.1">
          <circle cx="12" cy="12" r="9.5" /><ellipse cx="12" cy="12" rx="4.2" ry="9.5" /><path d="M2.5 12h19M4 7.5h16M4 16.5h16" opacity=".5" />
          <circle cx="16.5" cy="8" r="1.4" fill="var(--accent)" stroke="none" />
        </svg>
        <div className="leading-none">
          <div className="cond text-[12.5px] font-semibold tracking-[0.3em] text-[var(--ink)]">GLOBAL CLOUD ATLAS</div>
          <div className="mono text-[8.5px] text-[var(--ink-3)] mt-[3px] tracking-[0.08em] hidden 2xl:block">HYPERSCALER INFRASTRUCTURE · PRICING</div>
        </div>
      </div>
      <ProviderToggles />
      <div className="flex-1 flex justify-center"><Search /></div>
      <div className="flex gap-1 shrink-0">
      <button onClick={() => set({ finderOpen: !finderOpen, compareOpen: false })} className={`btn ${finderOpen ? 'on' : ''} !text-[var(--accent)] !border-[rgba(159,216,255,0.35)]`} title="Region Finder (F)">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3" /><path d="M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z" /></svg>Find region
      </button>
      <button onClick={() => set({ compareOpen: !compareOpen, finderOpen: false })} className={`btn ${compareOpen ? 'on' : ''}`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>Compare
      </button>
      <button onClick={async () => { const ok = await copyLink(); setCopied(ok ? 'copied' : 'copy failed'); setTimeout(() => setCopied(null), 1600); }} className="btn" title="Copy a link to this exact view">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></svg>{copied ?? 'Share'}
      </button>
      <button onClick={() => set({ guideOpen: true })} className="btn !px-2" title="Getting started (?)">?</button>
      </div>
      <select value={currency} onChange={(e) => set({ currency: e.target.value })} className="field h-[26px]"
        title={currency === 'USD' ? 'Source prices are USD' : 'Converted from USD at ECB reference rate (display only)'}>
        {CURRENCIES.filter((c) => c === 'USD' || fx[c]).map((c) => <option key={c}>{c}</option>)}
      </select>
      <div className="flex items-center gap-2 mono text-[10px] text-[var(--ink-3)] pl-3 border-l border-[var(--line)] h-full" title={manifest ? `Pricing ingested ${new Date(manifest.generatedAt).toLocaleString()}` : ''}>
        <span className="sw animate-pulse" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ color }}>{fresh}</span>
        <span className="hidden xl:inline">{manifest ? new Date(manifest.generatedAt).toISOString().slice(0, 10) : '—'}</span>
      </div>
    </header>
  );
}
