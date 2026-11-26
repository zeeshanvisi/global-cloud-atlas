import { useEffect, useMemo, useState } from 'react';
import { useAtlas } from '../store/useAtlas';
import { LENSES, lensById, type LensId } from '../lenses/lenses';
import { COMPUTE_CONFIGS, type Workload, type WorkloadKind } from '../engine/compare';
import { PRICING_MODELS, type PricingModel } from '../domain/types';

const ICONS: Record<LensId, string> = {
  infrastructure: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z', compute: 'M6 6h12v12H6zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  gpu: 'M3 7h18v10H3zM7 11h2v2H7zM11 11h2v2h-2zM15 11h2v2h-2zM6 17v3M18 17v3', storage: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  network: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', database: 'M5 5h14v4H5zM5 10h14v4H5zM5 15h14v4H5z',
  ai: 'M12 3v3M12 18v3M3 12h3M18 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2M12 9a3 3 0 110 6 3 3 0 010-6z', compare: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  latency: 'M12 21a9 9 0 110-18 9 9 0 010 18zM12 7v5l3 2', carbon: 'M12 3c4 4 6 7 6 10a6 6 0 01-12 0c0-3 2-6 6-10zM12 13v8',
};

const Seg = <T extends string | number>({ value, options, onChange, fmt }: { value: T; options: T[]; onChange: (v: T) => void; fmt?: (v: T) => string }) => (
  <div className="seg">
    {options.map((o) => <button key={String(o)} onClick={() => onChange(o)} className={o === value ? 'on' : ''}>{fmt ? fmt(o) : String(o)}</button>)}
  </div>
);

function Params({ kind }: { kind: WorkloadKind | 'ai' | 'infrastructure' }) {
  const w = useAtlas((s) => s.workload), setW = useAtlas((s) => s.setWorkload), gpuIdx = useAtlas((s) => s.indexes.gpu);
  const gpuOpts = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const r of gpuIdx?.all ?? []) (m.get(r.config.gpuModel) ?? m.set(r.config.gpuModel, new Set()).get(r.config.gpuModel)!).add(r.config.gpuCount);
    return m;
  }, [gpuIdx]);
  const fmtCfg = (c: string) => c.replace('x', '/') + 'G';
  switch (kind) {
    case 'compute': return <><Seg value={w.computeConfig} options={COMPUTE_CONFIGS} onChange={(v) => setW({ computeConfig: v })} fmt={fmtCfg} /><Seg value={w.arch} options={['x86_64', 'arm64'] as Workload['arch'][]} onChange={(v) => setW({ arch: v })} /></>;
    case 'gpu': {
      const counts = [...(gpuOpts.get(w.gpuModel) ?? [])].sort((a, b) => a - b);
      return <>
        <select value={w.gpuModel} onChange={(e) => { const c = [...(gpuOpts.get(e.target.value) ?? [1])]; setW({ gpuModel: e.target.value, gpuCount: c.includes(w.gpuCount) ? w.gpuCount : Math.max(...c) }); }}
          className="field !h-[26px]">
          {[...gpuOpts.keys()].sort().map((g) => <option key={g}>{g}</option>)}
        </select>
        {counts.length > 0 && <Seg value={w.gpuCount} options={counts} onChange={(v) => setW({ gpuCount: v })} fmt={(v) => `${v}×`} />}
      </>;
    }
    case 'storage': return <Seg value={w.storageType} options={['object', 'block'] as Workload['storageType'][]} onChange={(v) => setW({ storageType: v })} />;
    case 'database': return <><Seg value={w.dbEngine} options={['PostgreSQL', 'MySQL'] as Workload['dbEngine'][]} onChange={(v) => setW({ dbEngine: v })} /><Seg value={w.dbConfig} options={['2x8', '4x16', '8x32']} onChange={(v) => setW({ dbConfig: v })} fmt={fmtCfg} /></>;
    default: return null;
  }
}

export function LensBar() {
  const lens = useAtlas((s) => s.lens), w = useAtlas((s) => s.workload);
  const { set, ensure, setWorkload } = useAtlas.getState();
  const choose = (id: LensId) => set({ lens: id });
  // load whatever the active lens needs under the current workload / pricing model
  useEffect(() => { lensById(lens).needs(w).forEach(ensure); }, [lens, w, ensure]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      const l = LENSES.find((x) => x.key === e.key); if (l) choose(l.id);
      if (e.key === 'Escape') useAtlas.getState().select(null, false);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const paramKind = lens === 'compare' ? w.kind : (lens as any);
  const leftOpen = useAtlas((s) => s.leftOpen), rightOpen = useAtlas((s) => s.rightOpen), selected = useAtlas((s) => s.selected);
  const L = leftOpen ? 296 : 0, R = selected && rightOpen ? 392 : 0;
  const [vw, setVw] = useState(window.innerWidth);
  useEffect(() => { const f = () => setVw(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  const compact = vw - L - R < 640;
  return (
    <div className="absolute bottom-3 z-30 flex flex-col items-center pointer-events-none" style={{ left: L, right: R }}>
      {(lens === 'compare' || ['compute', 'gpu', 'storage', 'database'].includes(lens)) && (
        <div className={`dock pointer-events-auto flex items-center gap-2 px-2.5 py-2 ${compact ? "compact" : ""}`}>
          <span className="cond text-[9.5px] tracking-[0.16em] uppercase text-[var(--ink-3)] pr-1">Workload</span>
          {lens === 'compare' && <Seg value={w.kind} options={['compute', 'gpu', 'storage', 'network', 'database'] as WorkloadKind[]} onChange={(v) => { setWorkload({ kind: v }); ensure(v); }} />}
          <Params kind={paramKind} />
          {(paramKind === 'compute' || paramKind === 'gpu') ? (
            <Seg value={w.pricingModel} options={['on-demand', 'spot', 'commit-1y'] as PricingModel[]} onChange={(v) => setWorkload({ pricingModel: v })} fmt={(v) => PRICING_MODELS[v].short} />
          ) : <span className="mono text-[9.5px] text-[var(--ink-3)] pl-1">on-demand · USD</span>}
        </div>
      )}
      <nav className={`dial pointer-events-auto ${compact ? "compact" : ""}`}>
        {LENSES.map((l) => (
          <button key={l.id} onClick={() => choose(l.id)} title={`${l.label} (${l.key})`} className={lens === l.id ? 'on' : ''}>
            <span className="k">{l.key}</span>
            <svg className="ic" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[l.id]} /></svg>
            <span className="l">{l.id === 'compare' ? 'Compare' : l.id === 'infrastructure' ? 'Infra' : l.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
