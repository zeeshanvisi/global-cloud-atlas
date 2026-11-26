import { useEffect, useMemo, useState } from 'react';
import { useAtlas, useMoney, ALL_SOVEREIGNTY } from '../store/useAtlas';
import { PROVIDERS, PRICING_MODELS, type PricingModel, type Sovereignty } from '../domain/types';
import { TEMPLATES, templateById, neededIndexes } from '../engine/templates';
import { rankRegions } from '../engine/finder';
import { LATENCY_METHOD } from '../engine/latency';
import { Term } from './Glossary';

const countryName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();
const SOV_LABEL: Record<Sovereignty, string> = { commercial: 'Commercial', government: 'Government', sovereign: 'Sovereign', partner: 'Partner-operated' };

export function FinderPanel() {
  const regions = useAtlas((s) => s.regions), indexes = useAtlas((s) => s.indexes), providers = useAtlas((s) => s.providers);
  const origin = useAtlas((s) => s.origin), pickingOrigin = useAtlas((s) => s.pickingOrigin), f = useAtlas((s) => s.finder);
  const model = useAtlas((s) => s.workload.pricingModel), selected = useAtlas((s) => s.selected);
  const { set, setFinder, ensure, select, flyTo, setWorkload } = useAtlas.getState();
  const money = useMoney();
  const [geoErr, setGeoErr] = useState<string | null>(null), [openBill, setOpenBill] = useState<string | null>(null);
  const template = templateById(f.templateId);
  useEffect(() => { neededIndexes(template, model).forEach((k) => ensure(k as never)); }, [template, model, ensure]);

  const out = useMemo(() => rankRegions(regions, indexes, {
    origin, template, model, providers, residency: f.residency, sovereignty: new Set(f.sovereignty), maxRtt: f.maxRtt, weights: f.weights,
  }), [regions, indexes, origin, template, model, providers, f]);
  const top = out.results.slice(0, 12);
  useEffect(() => { set({ finderTop: top.map((r) => r.region.key) }); }, [top.map((r) => r.region.key).join(), set]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => set({ finderTop: [], pickingOrigin: false }), [set]);

  const cities = useMemo(() => {
    const m = new Map<string, { lat: number; lon: number; country: string }>();
    regions.forEach((r) => { if (!m.has(r.city)) m.set(r.city, { lat: r.lat, lon: r.lon, country: r.country }); });
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [regions]);
  const countries = useMemo(() => [...new Set(regions.map((r) => r.country))].sort((a, b) => countryName(a).localeCompare(countryName(b))), [regions]);

  const useMyLocation = () => {
    setGeoErr(null);
    if (!navigator.geolocation) { setGeoErr('Geolocation unavailable in this browser'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { const { latitude: lat, longitude: lon } = p.coords; set({ origin: { lat, lon, label: 'My location' } }); flyTo(lat, lon, 2.8); },
      () => setGeoErr('Location permission denied — pick a city or click the globe instead'), { timeout: 8000 });
  };
  const W = f.weights;
  const weight = (k: keyof typeof W, label: string, hint: string) => (
    <label className="flex items-center gap-2" title={hint}>
      <span className="kv-k w-[54px]">{label}</span>
      <input type="range" min={0} max={5} value={W[k]} onChange={(e) => setFinder({ weights: { ...W, [k]: +e.target.value } })} className="flex-1 accent-[#9fd8ff]" />
      <span className="mono text-[10px] text-[var(--ink-2)] w-3">{W[k]}</span>
    </label>
  );

  return (
    <div className="panel absolute z-40 top-[52px] w-[440px] max-w-[calc(100vw-24px)] bottom-[84px] flex flex-col" style={{ left: 'max(12px, calc(296px + 12px))' }}>
      <div className="flex items-center px-4 py-3 border-b border-[var(--line)]">
        <div>
          <div className="cond text-[10px] tracking-[0.2em] text-[var(--accent)]">REGION FINDER</div>
          <div className="text-[13.5px] text-[var(--ink)] font-light">Where should this workload run?</div>
        </div>
        <button onClick={() => set({ finderOpen: false })} className="ml-auto btn !h-6 !px-2">close</button>
      </div>
      <div className="flex-1 overflow-auto">
        {/* 1 — users */}
        <section className="sec">
          <div className="sec-h"><span className="sec-n">1</span><span className="sec-t">Your users are in</span></div>
          <div className="flex gap-1.5 flex-wrap">
            <select className="field flex-1 min-w-[140px]" value="" onChange={(e) => { const c = cities.find(([n]) => n === e.target.value); if (c) { set({ origin: { lat: c[1].lat, lon: c[1].lon, label: c[0], country: c[1].country } }); flyTo(c[1].lat, c[1].lon, 2.8); } }}>
              <option value="">{origin ? origin.label : 'choose a city…'}</option>
              {cities.map(([n]) => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className={`btn ${pickingOrigin ? 'on' : ''}`} onClick={() => set({ pickingOrigin: !pickingOrigin })}>{pickingOrigin ? 'click the globe…' : 'pick on globe'}</button>
            <button className="btn" onClick={useMyLocation}>my location</button>
            {origin && <button className="btn" onClick={() => set({ origin: null })} title="Clear location">clear</button>}
          </div>
          {geoErr && <div className="note-warn mt-1.5">{geoErr}</div>}
          {!origin && <div className="note mt-1.5">Without a location, regions are ranked on cost (and carbon) only.</div>}
        </section>

        {/* 2 — workload */}
        <section className="sec">
          <div className="sec-h"><span className="sec-n">2</span><span className="sec-t">Workload</span></div>
          <div className="grid grid-cols-2 gap-1.5">
            {TEMPLATES.map((t) => (
              <button key={t.id} onClick={() => setFinder({ templateId: t.id })}
                className={`text-left px-2.5 py-2 border ${t.id === f.templateId ? 'border-[rgba(159,216,255,0.45)] bg-[rgba(159,216,255,0.06)]' : 'border-[var(--line)] hover:border-[var(--line-2)]'}`}>
                <div className="text-[11.5px] text-[var(--ink)]">{t.label}</div>
                <div className="text-[9.5px] text-[var(--ink-3)] leading-snug mt-0.5">{t.blurb}</div>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <span className="kv-k">Pricing</span>
            <div className="seg">{(['on-demand', 'spot', 'commit-1y'] as PricingModel[]).map((m) => <button key={m} className={m === model ? 'on' : ''} onClick={() => setWorkload({ pricingModel: m })} title={PRICING_MODELS[m].note}>{PRICING_MODELS[m].short}</button>)}</div>
          </div>
          {model !== 'on-demand' && <div className="note mt-1.5">{PRICING_MODELS[model].note}. Applies to VM/GPU lines; storage, egress and databases stay on-demand.</div>}
        </section>

        {/* 3 — constraints */}
        <section className="sec">
          <div className="sec-h"><span className="sec-n">3</span><span className="sec-t">Constraints</span></div>
          <div className="grid grid-cols-[72px_1fr] gap-y-2 items-center">
            <span className="kv-k"><Term k="residency">Residency</Term></span>
            <select className="field" value={f.residency.mode === 'country' ? `c:${f.residency.country}` : f.residency.mode}
              onChange={(e) => { const v = e.target.value; setFinder({ residency: v === 'any' ? { mode: 'any' } : v === 'eu' ? { mode: 'eu' } : { mode: 'country', country: v.slice(2) } }); }}>
              <option value="any">Anywhere</option><option value="eu">EU / EEA only</option>
              {countries.map((c) => <option key={c} value={`c:${c}`}>{countryName(c)} only</option>)}
            </select>
            <span className="kv-k"><Term k="rtt">Latency</Term></span>
            <select className="field" value={f.maxRtt ?? ''} disabled={!origin} onChange={(e) => setFinder({ maxRtt: e.target.value ? +e.target.value : null })}>
              <option value="">no limit</option>{[20, 40, 60, 100, 150].map((m) => <option key={m} value={m}>≤ {m} ms (estimated)</option>)}
            </select>
            <span className="kv-k"><Term k="sovereignty">Region type</Term></span>
            <div className="flex flex-wrap gap-1">
              {ALL_SOVEREIGNTY.map((s) => { const on = f.sovereignty.includes(s); return (
                <button key={s} className={`btn !h-6 ${on ? 'on' : ''}`} onClick={() => setFinder({ sovereignty: on ? f.sovereignty.filter((x) => x !== s) : [...f.sovereignty, s] })}>{SOV_LABEL[s]}</button>); })}
            </div>
          </div>
          <div className="note mt-1.5">Providers follow the AWS / Azure / GCP toggles in the top bar.</div>
        </section>

        {/* 4 — priorities */}
        <section className="sec">
          <div className="sec-h"><span className="sec-n">4</span><span className="sec-t">Priorities</span></div>
          <div className="space-y-1.5">
            {weight('cost', 'Cost', 'Monthly bill from verified list prices')}
            {weight('latency', 'Latency', origin ? LATENCY_METHOD : 'Set a location to use latency')}
            {weight('carbon', 'Carbon', 'Google-published grid intensity; regions without published data are neither rewarded nor penalised')}
          </div>
        </section>

        {/* results */}
        <section className="sec !border-b-0">
          <div className="sec-h"><span className="sec-n">→</span><span className="sec-t">Recommended</span><span className="sec-m">{out.results.length} eligible</span></div>
          {!top.length && <div className="note">No region satisfies every constraint with verified pricing. Loosen residency or latency, or switch pricing model.</div>}
          <div className="space-y-px">
            {top.map((r, i) => (
              <div key={r.region.key} className={`border ${selected === r.region.key ? 'border-[rgba(159,216,255,0.4)]' : 'border-transparent'}`}>
                <button onClick={() => select(r.region.key)} onMouseEnter={() => set({ hovered: r.region.key })} onMouseLeave={() => set({ hovered: null })}
                  className={`w-full text-left px-2 py-2 flex items-center gap-2.5 ${i === 0 ? 'bg-[rgba(159,216,255,0.06)]' : 'hover:bg-[rgba(150,180,220,0.03)]'}`}>
                  <span className="mono text-[11px] w-4 text-[var(--ink-3)]">{i + 1}</span>
                  <span className="sw" style={{ background: PROVIDERS[r.region.provider].color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] text-[var(--ink)] truncate">{PROVIDERS[r.region.provider].label} · {r.region.name}</div>
                    <div className="mono text-[9.5px] text-[var(--ink-3)] truncate">{r.region.id}{r.reasons.length ? ` · ${r.reasons.join(' · ')}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="mono text-[11.5px] text-[var(--ink)]">{money(r.bill.total, 0)}<span className="text-[var(--ink-3)]">/mo</span></div>
                    <div className="mono text-[9.5px] text-[var(--ink-3)]">{r.rtt != null ? `~${Math.round(r.rtt)} ms` : '—'}{r.carbon != null ? ` · ${Math.round(r.carbon)}g` : ''}</div>
                  </div>
                </button>
                <div className="flex items-center gap-2 px-2 pb-1.5">
                  <div className="flex-1 h-[3px] bg-[rgba(150,180,220,0.06)]"><div className="h-full" style={{ width: `${Math.round(r.score * 100)}%`, background: i === 0 ? 'var(--accent)' : 'var(--ink-3)' }} /></div>
                  <button className="link mono text-[9.5px]" onClick={() => setOpenBill(openBill === r.region.key ? null : r.region.key)}>{openBill === r.region.key ? 'hide bill' : 'bill'}</button>
                </div>
                {openBill === r.region.key && (
                  <table className="dt mx-2 mb-2" style={{ width: 'calc(100% - 16px)' }}><tbody>
                    {r.bill.lines.map((l) => <tr key={l.item}><td className="text-[10px]">{l.item}{l.note ? <span className="text-[var(--ink-3)]"> · {l.note.replace('Standard_', '')}</span> : null}</td><td className="text-[10px]">{l.qty}</td><td className="n hi">{money(l.monthly, 0)}</td></tr>)}
                    <tr><td className="text-[10px] text-[var(--ink)]">Total / month</td><td /><td className="n hi">{money(r.bill.total, 0)}</td></tr>
                  </tbody></table>
                )}
              </div>
            ))}
          </div>
          {out.excluded.length > 0 && <div className="note mt-2">Excluded: {out.excluded.map((e) => `${e.count} ${e.reason}`).join(' · ')}</div>}
          <div className="note mt-2">Bills cover the listed items only (no OS licences, boot disks, request fees, support or tax). Latency is a distance estimate. Scores are relative to the eligible set.</div>
        </section>
      </div>
    </div>
  );
}
