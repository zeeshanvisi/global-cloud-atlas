import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAtlas, useMoney } from '../store/useAtlas';
import { PROVIDERS, HOURS_MONTH, PRICING_MODELS, type Category, type PriceRecord, type PricingModel } from '../domain/types';
import { estRttMs, LATENCY_METHOD } from '../engine/latency';
import { downloadCsv } from './share';
import { Term } from './Glossary';
import { haversineKm } from '../engine/geo';
import { COMPUTE_CONFIGS, indexKeyFor, pickOffering, type Workload } from '../engine/compare';
import { Sec } from './LeftPanel';

const ALL: Category[] = ['compute', 'gpu', 'storage', 'network', 'database', 'ai'];
const Src = ({ r }: { r: PriceRecord }) => (
  <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="link ml-1.5" title={`Official source · effective ${r.effectiveDate?.slice(0, 10) ?? 'n/a'} · product ${r.productId}`}>
    <svg className="inline -mt-px" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 17L17 7M9 7h8v8" /></svg>
  </a>
);
const Unavailable = ({ what }: { what: string }) => <div className="note">{what}: no verified data from an official source.</div>;
const Row = ({ k, v, r }: { k: string; v: string; r?: PriceRecord }) => (
  <div className="flex items-baseline py-[4px] border-t border-[var(--line)] first:border-t-0">
    <span className="text-[11px] text-[var(--ink-2)] truncate pr-2">{k}</span>
    <span className="ml-auto mono text-[11px] text-[var(--ink)] shrink-0">{v}</span>{r && <Src r={r} />}
  </div>
);

export function RegionPanel() {
  const key = useAtlas((s) => s.selected), regions = useAtlas((s) => s.regions), indexes = useAtlas((s) => s.indexes);
  const workload = useAtlas((s) => s.workload);
  const { ensure, select } = useAtlas.getState();
  const money = useMoney();
  const [showSvc, setShowSvc] = useState(false);
  const origin = useAtlas((s) => s.origin);
  useEffect(() => { if (key) { ALL.forEach(ensure); (['compute:spot', 'compute:commit-1y', 'gpu:spot', 'gpu:commit-1y'] as const).forEach(ensure); } }, [key, ensure]);
  const r = regions.find((x) => x.key === key);
  const recs = (c: Category) => (r ? indexes[c]?.byRegion.get(r.key) ?? [] : []);
  const peers = useMemo(() => !r ? [] : regions.filter((x) => x.provider !== r.provider && haversineKm(x, r) < 450)
    .map((x) => ({ x, km: Math.round(haversineKm(x, r)) })).sort((a, b) => a.km - b.km), [r, regions]);
  if (!r) return null;
  const pc = PROVIDERS[r.provider].color;

  const w = (p: Partial<Workload>): Workload => ({ ...workload, ...p });
  const computeRows = COMPUTE_CONFIGS.map((cfg) => ({ cfg, x86: pickOffering(recs('compute'), w({ kind: 'compute', computeConfig: cfg, arch: 'x86_64' })), arm: pickOffering(recs('compute'), w({ kind: 'compute', computeConfig: cfg, arch: 'arm64' })) }));
  const gpus = [...recs('gpu')].sort((a, b) => a.price - b.price);
  const storage = recs('storage'), network = recs('network'), ai = recs('ai');
  const dbRows = (['PostgreSQL', 'MySQL'] as const).flatMap((engine) => ['2x8', '4x16', '8x32'].map((cfg) => ({ engine, cfg, p: pickOffering(recs('database'), w({ kind: 'database', dbEngine: engine, dbConfig: cfg })) })));
  const egress = network.filter((n) => n.metric === 'internet-egress' && (n.provider !== 'aws' || /DataTransfer-Out-Bytes$/.test(n.sku)));
  const inter = network.filter((n) => n.metric === 'inter-region').sort((a, b) => a.price - b.price).slice(0, 1);
  const market = [{ x: r, km: 0 }, ...peers];
  const marketKinds: { label: string; wl: Workload }[] = [
    { label: `VM ${workload.computeConfig.replace('x', '/')}G x86`, wl: w({ kind: 'compute', arch: 'x86_64' }) },
    { label: 'Object storage', wl: w({ kind: 'storage', storageType: 'object' }) },
    { label: 'Internet egress', wl: w({ kind: 'network' }) },
    { label: 'PostgreSQL 2/8G', wl: w({ kind: 'database', dbEngine: 'PostgreSQL', dbConfig: '2x8' }) },
  ];
  const pmRows = [
    { label: `VM ${workload.computeConfig.replace('x', '/')}G ${workload.arch}`, kind: 'compute' as const, wl: w({ kind: 'compute' }) },
    { label: `${workload.gpuCount}× ${workload.gpuModel.replace('NVIDIA ', '')}`, kind: 'gpu' as const, wl: w({ kind: 'gpu' }) },
  ].map((row) => {
    const picks = (['on-demand', 'spot', 'commit-1y'] as PricingModel[]).map((m) => pickOffering(indexes[indexKeyFor(row.kind, m)]?.byRegion.get(r.key), { ...row.wl, pricingModel: m }));
    const od = picks[0]?.unitPrice; const min = Math.min(...picks.filter(Boolean).map((p) => p!.unitPrice));
    return { label: row.label, cells: picks.map((p) => p ? { pick: p, best: p.unitPrice === min && picks.filter(Boolean).length > 1, save: od ? 1 - p.unitPrice / od : 0 } : null) };
  });
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['provider', 'region', 'category', 'pricing_model', 'service', 'sku', 'config', 'price_usd', 'unit', 'effective_date', 'source_url']];
    for (const [k, idx] of Object.entries(indexes)) for (const x of idx?.byRegion.get(r.key) ?? [])
      rows.push([x.provider, x.regionId, k.split(':')[0], x.pricingModel, x.service, x.sku, JSON.stringify(x.config), x.price, x.unit, x.effectiveDate ?? '', x.sourceUrl]);
    downloadCsv(`${r.provider}-${r.id}-prices.csv`, rows);
  };
  const chart = market.map(({ x }) => ({ name: x.id, provider: x.provider, v: pickOffering(indexes.compute?.byRegion.get(x.key), marketKinds[0].wl)?.unitPrice ?? null })).filter((d) => d.v != null);

  return (
    <aside className="rail rail-r overflow-auto">
      <div className="px-4 pt-4 pb-3.5 border-b border-[var(--line)] sticky top-0 z-10 bg-[#03060c]/96 backdrop-blur" style={{ boxShadow: `inset 3px 0 0 ${pc}` }}>
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <div className="cond text-[10px] tracking-[0.2em] uppercase" style={{ color: pc }}>{PROVIDERS[r.provider].label} · Region</div>
            <div className="text-[17px] font-light text-[var(--ink)] leading-tight mt-1">{r.name}</div>
            <div className="mono text-[11px] text-[var(--ink-2)] mt-0.5">{r.id}</div>
          </div>
          <div className="ml-auto flex gap-1">
            <button onClick={exportCsv} className="btn !h-6 !px-2" title="Download every verified price for this region as CSV">csv</button>
            <button onClick={() => select(null, false)} className="btn !h-6 !px-2" title="Close (Esc)">esc</button>
          </div>
        </div>
        <div className="grid grid-cols-3 mt-3.5 border-t border-[var(--line)] pt-2.5">
          <div><div className="kv-k">Location</div><div className="kv-v mt-0.5">{r.city}, {r.country}</div></div>
          <div className="pl-3 border-l border-[var(--line)]"><div className="kv-k"><Term k="az">Avail. zones</Term></div><div className="kv-v mt-0.5">{r.azs ?? <span className="text-[var(--ink-3)]">unverified</span>}</div></div>
          <div className="pl-3 border-l border-[var(--line)]"><div className="kv-k">Services</div><div className="kv-v mt-0.5">{r.services ? r.services.length : <span className="text-[var(--ink-3)]">n/p</span>}</div></div>
        </div>
        <div className="mono text-[9.5px] text-[var(--ink-3)] mt-2">{Math.abs(r.lat).toFixed(2)}°{r.lat >= 0 ? 'N' : 'S'} {Math.abs(r.lon).toFixed(2)}°{r.lon >= 0 ? 'E' : 'W'} · {r.precision}-level · DC coordinates unpublished{r.sovereignty !== 'commercial' ? ` · ${r.sovereignty} region` : ''}</div>
        {origin && (
          <div className="mt-2 flex items-center gap-2 border border-[var(--line)] px-2 py-1.5" title={LATENCY_METHOD}>
            <span className="kv-k"><Term k="rtt">From your users</Term></span>
            <span className="mono text-[11px] text-[var(--ink)] ml-auto">~{Math.round(estRttMs(origin, r))} ms</span>
            <span className="mono text-[9.5px] text-[var(--ink-3)]">est. · {Math.round(haversineKm(origin, r)).toLocaleString()} km</span>
          </div>
        )}
      </div>

      {r.services && (
        <Sec n="A" t="Services" m={<button className="link" onClick={() => setShowSvc(!showSvc)}>{showSvc ? 'hide' : 'show all'}</button>}>
          {showSvc ? <div className="flex flex-wrap gap-1">{r.services.map((s) => <span key={s} className="mono text-[9.5px] px-1.5 py-[1px] border border-[var(--line)] text-[var(--ink-2)]">{s}</span>)}</div>
            : <div className="note">{r.services.length} services · source: AWS Regional Services List</div>}
        </Sec>
      )}

      <Sec n="B" t="Compute" m="on-demand · linux">
        {computeRows.some((c) => c.x86 || c.arm) ? (
          <table className="dt">
            <thead><tr><th>vCPU/GB</th><th>x86 · cheapest</th><th className="n">/hr</th><th>arm</th><th className="n">/hr</th></tr></thead>
            <tbody>{computeRows.map(({ cfg, x86, arm }) => (
              <tr key={cfg}>
                <td>{cfg.replace('x', '/')}</td>
                <td className="text-[10px]" title={x86 ? `${money(x86.unitPrice * HOURS_MONTH, 0)}/month at 730 h` : ''}>{x86?.label.replace('Standard_', '') ?? '—'}</td>
                <td className="n hi">{money(x86?.unitPrice)}</td>
                <td className="text-[10px]">{arm?.label.replace('Standard_', '') ?? '—'}</td>
                <td className="n hi">{money(arm?.unitPrice)}{(x86 || arm) && <Src r={(x86 ?? arm)!.record} />}</td>
              </tr>))}</tbody>
          </table>) : <Unavailable what="Compute" />}
      </Sec>

      <Sec n="B2" t="Pricing models" m="per hour">
        <table className="dt">
          <thead><tr><th />{(['on-demand', 'spot', 'commit-1y'] as PricingModel[]).map((m) => <th key={m} className="n"><Term k={m === 'on-demand' ? 'ondemand' : m === 'spot' ? 'spot' : 'commit'}>{PRICING_MODELS[m].short}</Term></th>)}</tr></thead>
          <tbody>
            {pmRows.map((row) => (
              <tr key={row.label}><td className="text-[10px]">{row.label}</td>
                {row.cells.map((c, i) => <td key={i} className={`n ${c && c.best ? 'best' : 'hi'}`} title={c ? `${c.pick.label} · ${c.pick.record.config.note ?? ''}` : 'Not available / not ingested'}>
                  {c ? <>{money(c.pick.unitPrice)}{c.save > 0.005 ? <span className="text-[9px] text-[var(--ink-3)]"> −{Math.round(c.save * 100)}%</span> : null}</> : '—'}</td>)}
              </tr>))}
          </tbody>
        </table>
        <div className="note mt-1.5">Spot can be interrupted. Commitments lock in a year. AWS reserved/savings-plan prices are not ingested.</div>
      </Sec>

      <Sec n="C" t="Accelerators" m={`${gpus.length} configs`}>
        {gpus.length ? (
          <table className="dt">
            <thead><tr><th>Instance</th><th>GPU</th><th className="n">/hr</th><th className="n">/gpu-hr</th></tr></thead>
            <tbody>{gpus.map((g) => (
              <tr key={g.id}>
                <td className="text-[10px] text-[var(--ink)]">{g.sku.replace('Standard_', '')}</td>
                <td className="text-[10px]">{g.config.gpuCount}× {g.config.gpuModel.replace('NVIDIA ', '')}</td>
                <td className="n hi">{money(g.price, 2)}</td>
                <td className="n">{money(g.price / g.config.gpuCount, 2)}<Src r={g} /></td>
              </tr>))}</tbody>
          </table>) : <Unavailable what="GPU instances" />}
        {gpus.some((g) => g.config.availabilityVerified === false) && (
          <div className="note-warn mt-2">Listed in Google's billing catalog for this region; actual GPU capacity is not verified. Prices exclude bundled local SSD.</div>
        )}
      </Sec>

      <Sec n="D" t="Storage" m="per GB-month">
        {storage.length ? storage.map((s) => <Row key={s.id} k={`${s.storageType} · ${s.tier}`} v={money(s.price, 4)} r={s} />) : <Unavailable what="Storage" />}
        <div className="note mt-1.5">Capacity only — requests, retrieval, IOPS and throughput excluded.</div>
      </Sec>

      <Sec n="E" t="Network" m="per GB">
        {egress.map((n) => <Row key={n.id} k={`Internet egress${n.config.to && n.provider === 'gcp' ? ` · ${n.config.to.replace('Internet ', '')}` : ''}`} v={money(n.price, 4)} r={n} />)}
        {inter.map((n) => <Row key={n.id} k={`Inter-region → ${String(n.config.to).slice(0, 26)}`} v={money(n.price, 4)} r={n} />)}
        {!egress.length && !inter.length && <Unavailable what="Networking" />}
        <Row k="Inbound transfer" v="free" />
        <div className="note mt-1.5">Arcs on the globe show routes to this provider's other regions. They are schematic, not physical cable paths.</div>
      </Sec>

      <Sec n="F" t="Managed databases" m="instance-hours">
        {dbRows.some((d) => d.p) ? (
          <table className="dt"><tbody>{dbRows.filter((d) => d.p).map(({ engine, cfg, p }) => (
            <tr key={engine + cfg}><td>{engine} {cfg.replace('x', '/')}</td><td className="text-[10px]">{p!.label}</td>
              <td className="n hi">{money(p!.unitPrice)}</td><td className="n">{money(p!.unitPrice * HOURS_MONTH, 0)}<Src r={p!.record} /></td></tr>))}</tbody></table>
        ) : <Unavailable what="Managed databases" />}
      </Sec>

      <Sec n="G" t="AI infrastructure">
        <div className="kv-k mb-1">GPU-backed infrastructure</div>
        <div className="mono text-[10.5px] text-[var(--ink-2)] mb-3">{[...new Set(gpus.map((g) => g.config.gpuModel.replace('NVIDIA ', '')))].join(' · ') || 'none verified'}</div>
        <div className="kv-k mb-1">Managed model APIs · per token</div>
        {ai.length ? ai.slice(0, 8).map((a) => <Row key={a.id} k={a.sku} v={`${money(a.price, 4)}/${a.unit.replace(' tokens', '')}`} />)
          : <div className="note">No verified managed AI API pricing ingested for this region.</div>}
      </Sec>

      <Sec n="G2" t="Carbon" m={r.carbon ? `Google · ${r.carbon.year}` : undefined}>
        {r.carbon ? (
          <>
            <Row k="Grid carbon intensity" v={r.carbon.gridIntensity != null ? `${Math.round(r.carbon.gridIntensity)} gCO₂e/kWh` : 'n/a'} />
            <Row k="Carbon-free energy (CFE)" v={r.carbon.cfe != null ? `${Math.round(r.carbon.cfe * 100)}%` : 'n/a'} />
            <Row k="Google 'low carbon' label" v={r.carbon.lowCarbon ? 'yes' : 'no'} />
          </>
        ) : <div className="note">{PROVIDERS[r.provider].label} does not publish per-region carbon intensity, so none is shown.</div>}
      </Sec>

      <Sec n="H" t="Same market" m={peers.length ? `${peers.length} nearby` : undefined} className="!border-b-0">
        {!peers.length ? <div className="note">No other provider region within 450 km.</div> : (
          <>
            <table className="dt">
              <thead><tr><th />{market.map(({ x, km }) => <th key={x.key} className="n"><span style={{ color: PROVIDERS[x.provider].color }}>{PROVIDERS[x.provider].label}</span><div className="mono normal-case tracking-normal text-[9px]">{x.id}{km ? ` ${km}km` : ''}</div></th>)}</tr></thead>
              <tbody>{marketKinds.map((k) => {
                const vals = market.map(({ x }) => pickOffering(indexes[k.wl.kind]?.byRegion.get(x.key), k.wl));
                const have = vals.filter(Boolean); const min = Math.min(...have.map((v) => v!.unitPrice));
                return <tr key={k.label}><td className="text-[10px]">{k.label}</td>
                  {vals.map((v, i) => <td key={i} className={`n ${v && v.unitPrice === min && have.length > 1 ? 'best' : 'hi'}`} title={v ? `${v.label} — ${v.notes.join('; ')}` : 'No verified comparable offering'}>{v ? money(v.unitPrice) : '—'}</td>)}</tr>;
              })}</tbody>
            </table>
            {chart.length > 1 && (
              <div className="h-[110px] mt-3 -ml-3"><ResponsiveContainer><BarChart data={chart} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: '#566273', fontSize: 9, fontFamily: 'IBM Plex Mono' }} axisLine={{ stroke: 'rgba(150,180,220,0.11)' }} tickLine={false} interval={0} />
                <YAxis width={34} tick={{ fill: '#566273', fontSize: 9, fontFamily: 'IBM Plex Mono' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(159,216,255,0.04)' }} formatter={(v) => money(Number(v))} contentStyle={{ background: '#03060c', border: '1px solid rgba(150,180,220,0.2)', borderRadius: 0, fontSize: 11, fontFamily: 'IBM Plex Mono' }} />
                <Bar dataKey="v" name="$/hr" barSize={18}>{chart.map((d) => <Cell key={d.name} fill={PROVIDERS[d.provider].color} fillOpacity={0.8} />)}</Bar>
              </BarChart></ResponsiveContainer></div>
            )}
            <div className="note mt-2">Nearby regions aren't geographically identical; latency, sovereignty and service catalogues differ.</div>
          </>
        )}
      </Sec>
      <div className="px-4 pb-4 note">Public on-demand list prices, USD (converted for display only). Discounted models are kept separate.</div>
    </aside>
  );
}
